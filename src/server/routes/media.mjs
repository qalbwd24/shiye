import { LIMITS } from '../../../public/shared/limits.js';
import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function createRoutes({ dataDir, getDb, mutate, reply, fail }) {
  return async (req, res, p) => {
    const db = getDb();
    if (p === '/api/media' && req.method === 'POST') {
      const mime = (req.headers['content-type'] || '').split(';')[0];
      if (
        !/^(image\/(png|jpeg|webp|gif|avif)|video\/(mp4|webm|quicktime)|audio\/(mpeg|mp4|ogg|wav|x-wav|webm))$/.test(
          mime,
        )
      )
        throw fail(415, '暂支持常见图片、MP4/WebM 视频和音频文件');
      const id = randomUUID(),
        pending = path.join(dataDir, 'media', id + '.uploading'),
        out = await fs.open(pending, 'wx');
      let size = 0;
      try {
        for await (const chunk of req) {
          size += chunk.length;
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
      const name = decodeURIComponent(req.headers['x-file-name'] || '附件').slice(0, 250);
      const item = { id, name, type: mime, size };
      await mutate((d) => {
        d.media.push(item);
      });
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
