import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { LIMITS } from '../../../public/shared/limits.js';

const qualities = { balanced: { edge: 1280, crf: 26 }, high: { edge: 1920, crf: 23 } };
const executable =
  'C:\\Users\\微霖\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-9.0-full_build\\bin\\ffmpeg.exe';

/** External GPL runtime: never shipped inside a source package; no shell invocation. */
export async function resolveVideoRuntime() {
  const ffmpeg = process.env.SHIYE_FFMPEG_PATH || executable;
  const ffprobe = process.env.SHIYE_FFPROBE_PATH || path.join(path.dirname(ffmpeg), 'ffprobe.exe');
  if (!path.isAbsolute(ffmpeg) || !path.isAbsolute(ffprobe))
    throw Error('视频工具配置必须使用绝对路径');
  try {
    await Promise.all([fs.access(ffmpeg), fs.access(ffprobe)]);
  } catch {
    throw Error('本机视频压缩工具不可用，请选择原件上传');
  }
  return { ffmpeg, ffprobe };
}

function run(binary, args, progress) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '',
      settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(output);
    };
    const timer = setTimeout(
      () => {
        child.kill();
        finish(Error('视频处理超时，请选择原件或缩短视频后重试'));
      },
      6 * 60 * 60 * 1000,
    );
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      if (progress) progress(text);
      else {
        output += text;
        if (output.length > 1024 * 1024) {
          child.kill();
          finish(Error('视频信息过大，无法处理'));
        }
      }
    });
    // Drain diagnostic output without returning local paths or source metadata to the client.
    child.stderr.on('data', () => {});
    child.on('error', () => finish(Error('无法启动视频处理工具，请选择原件上传')));
    child.on('close', (code) =>
      finish(code === 0 ? null : Error('视频处理失败，请重试或选择原件上传')),
    );
  });
}

async function inspectVideo(runtime, file) {
  const output = await run(runtime.ffprobe, [
    '-v',
    'error',
    '-protocol_whitelist',
    'file,pipe',
    '-show_streams',
    '-show_format',
    '-of',
    'json',
    file,
  ]);
  let info;
  try {
    info = JSON.parse(output);
  } catch {
    throw Error('无法读取视频信息');
  }
  const video = info.streams?.find(
    (stream) => stream.codec_type === 'video' && !stream.disposition?.attached_pic,
  );
  if (
    !video?.codec_name ||
    !(video.width > 0) ||
    !(video.height > 0) ||
    video.width * video.height > 268435456
  )
    throw Error('文件不包含可处理的视频画面');
  if (['smpte2084', 'arib-std-b67'].includes(video.color_transfer))
    throw Error('此视频使用 HDR 色彩，请选择原件上传以保留色彩');
  const creationTime = video.tags?.creation_time || info.format?.tags?.creation_time;
  return {
    duration: Number(info.format?.duration || video.duration) || 0,
    creationTime: creationTime && Number.isFinite(Date.parse(creationTime)) ? creationTime : null,
    width: video.width,
    height: video.height,
  };
}
async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

/** New uploads only: original user files and existing library attachments are never modified. */
export function createRoutes({ dataDir, getDb, mutate, reply, fail }) {
  const staging = path.join(dataDir, 'media-staging');
  const jobs = new Map();
  let queue = Promise.resolve();
  const publicJob = (job) => ({
    id: job.id,
    state: job.state,
    progress: job.progress,
    ...(job.media ? { media: job.media } : {}),
    ...(job.error ? { error: job.error } : {}),
    ...(job.reason ? { reason: job.reason } : {}),
  });
  const cleanup = (file) => fs.unlink(file).catch(() => {});

  async function processJob(job) {
    const encoded = path.join(staging, job.id + '.encoded.mp4');
    let committedFile = null;
    try {
      job.state = 'processing';
      const existing = getDb().media.find(
        (m) =>
          !m.purpose && m.originalSha256 === job.sha256 && m.compressionQuality === job.quality,
      );
      if (existing) {
        job.media = existing;
        job.state = 'done';
        job.progress = 1;
        return;
      }
      const runtime = await resolveVideoRuntime();
      const info = await inspectVideo(runtime, job.source);
      const profile = qualities[job.quality];
      let progressBuffer = '';
      const args = [
        '-hide_banner',
        '-loglevel',
        'error',
        '-nostdin',
        '-n',
        '-protocol_whitelist',
        'file,pipe',
        '-i',
        job.source,
        '-map',
        '0:v:0',
        '-map',
        '0:a?',
        '-map_metadata',
        '0',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        String(profile.crf),
        '-vf',
        `scale=w='min(iw,${profile.edge})':h='min(ih,${profile.edge})':force_original_aspect_ratio=decrease:force_divisible_by=2`,
        '-pix_fmt',
        'yuv420p',
        '-fps_mode',
        'passthrough',
        '-c:a',
        'aac',
        '-b:a',
        job.quality === 'high' ? '192k' : '128k',
        '-movflags',
        '+faststart',
        ...(info.creationTime ? ['-metadata', 'creation_time=' + info.creationTime] : []),
        '-progress',
        'pipe:1',
        '-f',
        'mp4',
        encoded,
      ];
      await run(runtime.ffmpeg, args, (text) => {
        progressBuffer = (progressBuffer + text).slice(-8192);
        for (const match of progressBuffer.matchAll(/out_time_us=(\d+)/g))
          if (info.duration > 0)
            job.progress = Math.min(0.94, (Number(match[1]) / 1000000 / info.duration) * 0.94);
        const newline = progressBuffer.lastIndexOf('\n');
        if (newline >= 0) progressBuffer = progressBuffer.slice(newline + 1);
      });
      const outInfo = await inspectVideo(runtime, encoded);
      const encodedSize = (await fs.stat(encoded)).size;
      if (!encodedSize || (info.duration > 1 && outInfo.duration < info.duration * 0.9))
        throw Error('视频处理结果不完整，请选择原件上传');
      const smaller = encodedSize < job.size;
      const chosen = smaller ? encoded : job.source;
      const size = smaller ? encodedSize : job.size;
      const sha256 = smaller ? await hashFile(encoded) : job.sha256;
      const id = randomUUID();
      const target = path.join(dataDir, 'media', id);
      await fs.rename(chosen, target);
      committedFile = target;
      let item = {
        id,
        name: smaller ? job.name.replace(/\.[^.]*$/, '') + '.mp4' : job.name,
        type: smaller ? 'video/mp4' : job.type,
        size,
        sha256,
        importedAt: new Date().toISOString(),
        originalSize: job.size,
        originalName: job.name,
        originalSha256: job.sha256,
        compressionQuality: job.quality,
        compressed: smaller,
        ...(job.lastModified !== undefined
          ? { lastModified: job.lastModified, sourceLastModified: job.lastModified }
          : {}),
        ...(info.creationTime ? { creationTime: info.creationTime } : {}),
      };
      await mutate((d) => {
        const duplicate = d.media.find(
          (m) => !m.purpose && m.sha256 === sha256 && m.size === size && m.type === item.type,
        );
        if (duplicate) item = duplicate;
        else d.media.push(item);
      });
      if (item.id !== id) await cleanup(target);
      committedFile = null;
      job.media = item;
      job.progress = 1;
      job.state = 'done';
      if (!smaller) job.reason = '压缩结果未变小，已保存原件';
    } catch (error) {
      if (committedFile) await cleanup(committedFile);
      job.state = 'error';
      job.error = error.message || '视频处理失败，请重试或选择原件';
    } finally {
      await cleanup(job.source);
      await cleanup(encoded);
    }
  }

  return async (req, res, p) => {
    if (p === '/api/media-compression-upload' && req.method === 'POST') {
      const quality = new URL(req.url, 'http://localhost').searchParams.get('quality');
      if (!qualities[quality]) throw fail(400, '视频压缩质量无效');
      const type = (req.headers['content-type'] || '').split(';')[0];
      if (!['video/mp4', 'video/webm', 'video/quicktime'].includes(type))
        throw fail(415, '此接口只支持视频文件');
      if (
        [...jobs.values()].filter((job) =>
          ['queued', 'processing', 'uploading'].includes(job.state),
        ).length >= 12
      )
        throw fail(429, '视频处理队列已满，请稍后再试');
      try {
        await resolveVideoRuntime();
      } catch (e) {
        throw fail(503, e.message);
      }
      let name;
      try {
        name = decodeURIComponent(req.headers['x-file-name'] || '视频').slice(0, 250);
      } catch {
        throw fail(400, '文件名称格式错误');
      }
      await fs.mkdir(staging, { recursive: true });
      const id = randomUUID(),
        source = path.join(staging, id + '.uploading');
      const file = await fs.open(source, 'wx'),
        hash = createHash('sha256');
      const lastModified = Number(req.headers['x-file-last-modified']);
      const job = {
        id,
        state: 'uploading',
        progress: 0,
        source,
        name,
        type,
        quality,
        size: 0,
        ...(Number.isSafeInteger(lastModified) &&
        lastModified >= 0 &&
        lastModified <= 8640000000000000
          ? { lastModified }
          : {}),
      };
      jobs.set(id, job);
      try {
        for await (const chunk of req) {
          job.size += chunk.length;
          if (job.size > LIMITS.mediaUploadBytes) throw fail(413, '单个媒体超过 16 GB');
          hash.update(chunk);
          await file.writeFile(chunk);
        }
        if (!job.size) throw fail(400, '文件为空');
      } catch (error) {
        await file.close();
        await cleanup(source);
        jobs.delete(id);
        throw error;
      }
      await file.close();
      job.sha256 = hash.digest('hex');
      job.state = 'queued';
      // Keep bounded status history without evicting work that is still active.
      if (jobs.size > 256)
        for (const [key, old] of jobs) {
          if (jobs.size <= 256) break;
          if (['done', 'error'].includes(old.state)) jobs.delete(key);
        }
      reply(res, 202, publicJob(job));
      queue = queue.then(() => processJob(job)).catch(() => {});
      return true;
    }
    const match = p.match(/^\/api\/media-compression\/([a-f0-9-]{36})$/i);
    if (match && req.method === 'GET') {
      const job = jobs.get(match[1]);
      if (!job) throw fail(404, '视频任务不存在，服务可能已重启，请重新上传');
      reply(res, 200, publicJob(job));
      return true;
    }
    return false;
  };
}
