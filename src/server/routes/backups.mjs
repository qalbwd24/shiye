import { LIMITS } from '../../../public/shared/limits.js';
import { normalizeAppearance, normalizeLayout } from '../../../public/shared/appearance.js';
import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
const hashFile = async (file) => {
  const h = createHash('sha256');
  for await (const b of createReadStream(file)) h.update(b);
  return h.digest('hex');
};
export function backupStore({ dataDir, getDb, mutate, body, reply, fail }) {
  const jobs = new Map(),
    restores = new Map(),
    root = path.join(dataDir, 'backups'),
    staging = path.join(dataDir, 'restore-staging');
  const safeId = (id) => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id);
  const cleanup = async (job) => {
    const target = path.resolve(job.dir);
    if (!target.startsWith(path.resolve(staging) + path.sep) || !safeId(path.basename(target)))
      throw Error('Invalid staging path');
    await fs.rm(target, { recursive: true, force: true });
  };
  return async (req, res, p) => {
    if (p === '/api/backup-manifest' && req.method === 'GET') {
      const library = structuredClone(getDb()),
        files = [];
      for (const [folder, items] of [
        ['media', library.media],
        ['originals', library.imports],
      ])
        for (const item of items) {
          const file = path.join(dataDir, folder, item.id);
          let stat;
          try {
            stat = await fs.stat(file);
          } catch {
            throw fail(
              422,
              '备份缺少文件：' + (item.name || item.id) + '。请先修复附件，避免生成不完整备份。',
            );
          }
          files.push({
            folder,
            id: item.id,
            name: item.name,
            size: stat.size,
            sha256: await hashFile(file),
            url: `/api/backup-file/${folder}/${item.id}`,
          });
        }
      reply(res, 200, { library, files, total: files.reduce((n, f) => n + f.size, 0) });
      return true;
    }
    const fileMatch = p.match(/^\/api\/backup-file\/(media|originals)\/([a-f0-9-]+)$/);
    if (fileMatch && req.method === 'GET') {
      const [, folder, id] = fileMatch,
        db = getDb();
      if (!(folder === 'media' ? db.media : db.imports).some((m) => m.id === id))
        throw fail(404, '备份文件不存在');
      const file = path.join(dataDir, folder, id),
        stat = await fs.stat(file);
      let start = 0,
        end = stat.size - 1,
        status = 200;
      if (req.headers.range) {
        const m = req.headers.range.match(/^bytes=(\d+)-(\d+)$/);
        if (!m) throw fail(416, '范围不正确');
        start = Number(m[1]);
        end = Math.min(Number(m[2]), end);
        if (start > end || start >= stat.size) throw fail(416, '范围超出文件');
        status = 206;
        res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
      }
      res.writeHead(status, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': Math.max(0, end - start + 1),
        'Cache-Control': 'no-store',
      });
      if (!stat.size) res.end();
      else createReadStream(file, { start, end }).pipe(res);
      return true;
    }
    if (p === '/api/backups' && req.method === 'GET') {
      await fs.mkdir(root, { recursive: true });
      const files = await fs.readdir(root);
      reply(
        res,
        200,
        await Promise.all(
          files
            .filter((f) => /^[a-f0-9-]+\.syvault2$/.test(f))
            .map(async (name) => {
              const stat = await fs.stat(path.join(root, name));
              return {
                id: name.slice(0, -9),
                name,
                size: stat.size,
                createdAt: stat.mtime.toISOString(),
              };
            }),
        ),
      );
      return true;
    }
    if (p === '/api/backups' && req.method === 'POST') {
      const h = JSON.parse(await body(req));
      if (h.format !== 'shiye-vault' || h.version !== 2) throw fail(400, '备份头格式错误');
      await fs.mkdir(root, { recursive: true });
      const id = randomUUID(),
        file = path.join(root, id + '.partial');
      await fs.writeFile(file, JSON.stringify(h) + '\n', { flag: 'wx' });
      jobs.set(id, { file, index: 0, busy: false });
      reply(res, 201, { id });
      return true;
    }
    const backup = p.match(/^\/api\/backups\/([a-f0-9-]+)(?:\/(record|finish|cancel))?$/);
    if (backup) {
      const [, id, action] = backup;
      if (!safeId(id)) throw fail(400, '备份标识不正确');
      const file = path.join(root, id + '.syvault2');
      if (req.method === 'GET' && !action) {
        const stat = await fs.stat(file);
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': stat.size,
          'Content-Disposition': `attachment; filename="diary-${id}.syvault2"`,
          'Cache-Control': 'no-store',
        });
        createReadStream(file).pipe(res);
        return true;
      }
      const job = jobs.get(id);
      if (!job) throw fail(404, '备份会话不存在，请重新创建');
      if (job.busy) throw fail(409, '数据块正在保存');
      job.busy = true;
      try {
        if (req.method !== 'POST') throw fail(405, '不支持的操作');
        const data = JSON.parse(await body(req, LIMITS.vaultRecordBytes));
        if (action === 'record') {
          if (
            data.index !== job.index ||
            typeof data.data !== 'string' ||
            typeof data.iv !== 'string'
          )
            throw fail(400, '备份块顺序错误');
          await fs.appendFile(job.file, JSON.stringify(data) + '\n');
          job.index++;
          reply(res, 200, { records: job.index });
        } else if (action === 'finish') {
          if (data.records !== job.index || job.index < 2) throw fail(400, '备份未完成');
          await fs.rename(job.file, file);
          jobs.delete(id);
          reply(res, 200, {
            id,
            path: file,
            size: (await fs.stat(file)).size,
            sha256: await hashFile(file),
          });
        } else if (action === 'cancel') {
          await fs.unlink(job.file);
          jobs.delete(id);
          reply(res, 200, { cancelled: true });
        } else throw fail(404, '未知操作');
      } finally {
        job.busy = false;
      }
      return true;
    }
    if (p === '/api/restore-jobs' && req.method === 'POST') {
      const manifest = JSON.parse(await body(req, LIMITS.vaultRecordBytes)),
        lib = manifest.library;
      if (
        !lib ||
        !Array.isArray(lib.entries) ||
        !Array.isArray(lib.media) ||
        !Array.isArray(lib.imports) ||
        !Array.isArray(lib.categories) ||
        !Array.isArray(manifest.files)
      )
        throw fail(400, '备份目录格式错误');
      const id = randomUUID(),
        dir = path.join(staging, id),
        files = new Map();
      for (const f of manifest.files) {
        const key = f.folder + '/' + f.id;
        if (
          !['media', 'originals'].includes(f.folder) ||
          !safeId(f.id) ||
          files.has(key) ||
          !Number.isSafeInteger(f.size) ||
          f.size < 0 ||
          !/^\w{64}$/.test(f.sha256)
        )
          throw fail(400, '附件目录错误');
        files.set(key, { ...f, path: path.join(dir, randomUUID()), written: 0 });
      }
      for (const [folder, items] of [
        ['media', lib.media],
        ['originals', lib.imports],
      ])
        for (const item of items)
          if (!files.has(folder + '/' + item.id)) throw fail(400, '备份目录缺少附件');
      await fs.mkdir(dir, { recursive: true });
      for (const f of files.values()) await fs.writeFile(f.path, '', { flag: 'wx' });
      restores.set(id, {
        dir,
        lib,
        files,
        busy: false,
        restoreAppearance: manifest.restoreAppearance === true,
      });
      reply(res, 201, { id });
      return true;
    }
    const restore = p.match(
      /^\/api\/restore-jobs\/([a-f0-9-]+)\/(commit|cancel|file\/(media|originals)\/([a-f0-9-]+))$/,
    );
    if (restore && req.method === 'POST') {
      const [, id, action, folder, fileId] = restore,
        job = restores.get(id);
      if (!job) throw fail(404, '恢复会话不存在');
      if (job.busy) throw fail(409, '恢复正在处理');
      job.busy = true;
      try {
        if (action === 'cancel') {
          await cleanup(job);
          restores.delete(id);
          reply(res, 200, { cancelled: true });
          return true;
        }
        if (action.startsWith('file/')) {
          const f = job.files.get(folder + '/' + fileId),
            offset = Number(req.headers['x-offset']),
            data = await body(req, LIMITS.requestBytes);
          if (!f || offset !== f.written || offset + data.length > f.size)
            throw fail(400, '恢复文件顺序或大小不正确');
          await fs.appendFile(f.path, data);
          f.written += data.length;
          reply(res, 200, { bytes: f.written });
          return true;
        }
        for (const f of job.files.values())
          if (f.written !== f.size || (await hashFile(f.path)) !== f.sha256)
            throw fail(422, '备份附件不完整或校验失败');
        const remap = new Map();
        for (const key of job.files.keys()) remap.set(key, randomUUID());
        const lib = job.lib,
          ids = new Set();
        const remapHistory = (e) => {
          const result = structuredClone(e);
          result.attachments = (e.attachments || []).map((id) => {
            const value = remap.get('media/' + id);
            if (!value) throw fail(400, '日记引用缺失附件');
            return value;
          });
          if (result.legacy?.mediaReferences)
            result.legacy.mediaReferences = result.legacy.mediaReferences.map((r) => ({
              ...r,
              mediaId: r.mediaId ? remap.get('media/' + r.mediaId) || null : null,
            }));
          return result;
        };
        const entries = lib.entries.map((e) => {
          if (
            typeof e.id !== 'string' ||
            ids.has(e.id) ||
            typeof e.title !== 'string' ||
            typeof e.content !== 'string' ||
            !Array.isArray(e.tags) ||
            e.tags.some((t) => typeof t !== 'string') ||
            !Array.isArray(e.attachments) ||
            !Number.isFinite(Date.parse(e.date))
          )
            throw fail(400, '备份日记结构错误');
          ids.add(e.id);
          const value = remapHistory(e);
          value.id = randomUUID();
          value.revision = 1;
          value.history = (e.history || []).map(remapHistory);
          value.restoredFrom = { id: e.id };
          return value;
        });
        const media = lib.media.map((m) => ({
            ...m,
            id: remap.get('media/' + m.id),
            type: /^(image\/(png|jpeg|webp|gif|avif)|video\/(mp4|webm|quicktime)|audio\/(mpeg|mp4|ogg|wav|x-wav|webm|aac))$/.test(
              m.type,
            )
              ? m.type
              : 'application/octet-stream',
          })),
          imports = lib.imports.map((m) => ({ ...m, id: remap.get('originals/' + m.id) }));
        const preferences = {};
        if (job.restoreAppearance) {
          const source = lib.settings?.preferences || {};
          try {
            if (source.appearance) {
              preferences.appearance = normalizeAppearance(source.appearance);
              preferences.appearance.backgrounds = preferences.appearance.backgrounds.map((b) => {
                const id = remap.get('media/' + b.id);
                if (!id || !lib.media.some((m) => m.id === b.id && m.purpose === 'background'))
                  throw Error('备份中缺少背景图片');
                return { ...b, id };
              });
            }
            if (source.layout) preferences.layout = normalizeLayout(source.layout);
            if (['light', 'dark', 'system'].includes(source.theme))
              preferences.theme = source.theme;
          } catch (e) {
            throw fail(400, e.message);
          }
        }
        for (const [key, f] of job.files)
          await fs.copyFile(f.path, path.join(dataDir, f.folder, remap.get(key)));
        await mutate((d) => {
          d.entries.push(...entries);
          d.media.push(...media);
          d.imports.push(...imports);
          d.tags = [
            ...new Set([
              ...(d.tags || []),
              ...(Array.isArray(lib.tags) ? lib.tags.filter((t) => typeof t === 'string') : []),
            ]),
          ];
          d.settings.preferences = { ...d.settings.preferences, ...preferences };
          d.categories = [
            ...new Set([...d.categories, ...lib.categories.filter((c) => typeof c === 'string')]),
          ];
          d.templates = [
            ...(d.templates || []),
            ...(lib.templates || [])
              .filter((t) => typeof t.name === 'string' && typeof t.content === 'string')
              .map((t) => ({ ...t, id: randomUUID() })),
          ];
        });
        await cleanup(job);
        restores.delete(id);
        reply(res, 200, { entries: entries.length, media: media.length });
        return true;
      } finally {
        job.busy = false;
      }
    }
    return false;
  };
}
