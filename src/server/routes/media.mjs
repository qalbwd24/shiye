import { createHash } from 'node:crypto';
import { LIMITS } from '../../../public/shared/limits.js';
import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function createRoutes({ dataDir, getDb, mutate, reply, fail }) {
  return async (req, res, p) => {
    const db = getDb();
    if (['/api/media', '/api/chat-journal/media'].includes(p) && req.method === 'POST') {
      const mime = (req.headers['content-type'] || '').split(';')[0];
      if (
        p === '/api/chat-journal/media'
          ? !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(mime)
          : !/^(image\/(png|jpeg|webp|gif|avif)|video\/(mp4|webm|quicktime)|audio\/(mpeg|mp4|ogg|wav|x-wav|webm))$/.test(
              mime,
            )
      )
        throw fail(415, '暂支持常见图片、MP4/WebM 视频和音频文件');
      // Reject malformed percent-encoded metadata before creating any file.
      const header = (key, fallback = '') => {
        try {
          const value = req.headers[key];
          if (value !== undefined && typeof value !== 'string') throw Error('invalid header');
          return decodeURIComponent(value || fallback);
        } catch {
          throw fail(400, '附件名称或元数据编码格式错误');
        }
      };
      const name = header('x-file-name', '附件').slice(0, 250);
      const modifiedHeader = header('x-file-last-modified');
      const lastModified = modifiedHeader ? Number(modifiedHeader) : NaN;
      const originalSize = Number(header('x-original-size'));
      const captured = header('x-source-captured-at');
      const capturedTag = header('x-source-captured-tag');
      const offset = header('x-source-captured-offset');
      const compression = header('x-media-compression');
      const id = randomUUID(),
        pending = path.join(dataDir, 'media', id + '.uploading'),
        out = await fs.open(pending, 'wx');
      const hash = createHash('sha256');
      let size = 0;
      try {
        for await (const chunk of req) {
          size += chunk.length;
          hash.update(chunk);
          if (size > LIMITS.mediaUploadBytes) throw fail(413, '单个媒体超过 16 GB');
          await out.writeFile(chunk);
        }
      } catch (e) {
        await out.close();
        await fs.unlink(pending).catch(() => {});
        throw e;
      }
      await out.close();
      if (!size) {
        await fs.unlink(pending);
        throw fail(400, '文件为空');
      }
      await fs.rename(pending, path.join(dataDir, 'media', id));
      let item = {
        id,
        name,
        type: mime,
        size,
        sha256: hash.digest('hex'),
        importedAt: new Date().toISOString(),
        ...(compression === 'image-canvas' &&
        Number.isSafeInteger(originalSize) &&
        originalSize >= size
          ? { compression: { method: 'image-canvas', originalSize } }
          : {}),
        ...(/^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}$/.test(captured)
          ? {
              sourceCapturedAtRaw: captured,
              ...(['DateTimeOriginal', 'DateTime'].includes(capturedTag)
                ? { sourceCapturedTag: capturedTag }
                : {}),
            }
          : {}),
        ...(/^[+-]\d{2}:\d{2}$/.test(offset) ? { sourceCapturedOffset: offset } : {}),
        ...(Number.isSafeInteger(lastModified) &&
        lastModified >= 0 &&
        lastModified <= 8640000000000000
          ? { lastModified }
          : {}),
      };
      await mutate((d) => {
        const duplicate = d.media.find(
          (m) => !m.purpose && m.sha256 === item.sha256 && m.size === size && m.type === mime,
        );
        if (duplicate) {
          item = duplicate;
          return;
        }
        d.media.push(item);
      });
      if (item.id !== id) await fs.unlink(path.join(dataDir, 'media', id));
      return reply(res, 201, item);
    }
    if (p.startsWith('/media/') && req.method === 'GET') {
      const item = db.media.find((m) => m.id === p.slice(7));
      if (!item) throw fail(404, '附件不存在');
      const file = path.join(dataDir, 'media', item.id),
        stat = await fs.stat(file);
      let start = 0,
        end = stat.size - 1,
        status = 200;
      if (req.headers.range) {
        const m = req.headers.range.match(/^bytes=(\d+)-(\d*)$/);
        if (!m) throw fail(416, '不支持的媒体范围');
        start = Number(m[1]);
        end = m[2] ? Math.min(Number(m[2]), end) : end;
        if (start > end || start >= stat.size) throw fail(416, '媒体范围超出文件');
        status = 206;
        res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
      }
      res.writeHead(status, {
        'Content-Type': item.type,
        ...(!/^(image\/(png|jpeg|gif|webp|avif)|video\/(mp4|webm|quicktime)|audio\/(mpeg|mp4|ogg|wav|x-wav|webm))$/.test(
          item.type,
        )
          ? {
              'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(item.name)}`,
            }
          : {}),
        'Content-Length': end - start + 1,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, max-age=3600',
      });
      createReadStream(file, { start, end }).pipe(res);
      return true;
    }

    return false;
  };
}
