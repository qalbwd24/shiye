import { LIMITS } from '../../../public/shared/limits.js';
import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { decodeLegacy, sha } from '../imports/legacy.mjs';

export function createRoutes({ dataDir, getDb, mutate, body, reply, fail }) {
  return async (req, res, p) => {
    const db = getDb();
    if (p === '/api/bundle' && req.method === 'GET') {
      const library = structuredClone(db),
        files = [];
      let total = 0;
      for (const [folder, items] of [
        ['media', library.media],
        ['originals', library.imports],
      ])
        for (const item of items) {
          const file = path.join(dataDir, folder, item.id),
            stat = await fs.stat(file);
          total += stat.size;
          if (total > LIMITS.legacyBundleBytes)
            throw fail(413, '旧版整包格式上限为 128 MB，请返回使用“创建完整加密备份”');
          const b = await fs.readFile(file);
          files.push({ folder, id: item.id, sha256: sha(b), data: b.toString('base64') });
        }
      return reply(res, 200, { format: 'shiye-bundle', version: 1, library, files });
    }
    if (p === '/api/import' && req.method === 'POST') {
      const raw = await body(req, LIMITS.legacyBundleBytes),
        name = decodeURIComponent(req.headers['x-file-name'] || 'backup').slice(0, 250);
      const hash = sha(raw);
      if (db.imports.some((a) => a.sha256 === hash))
        throw fail(409, '这个原始备份已导入，不会重复添加');
      let imported;
      try {
        imported = await decodeLegacy(raw, name);
      } catch (e) {
        throw fail(422, '无法导入：' + e.message);
      }
      await fs.writeFile(path.join(dataDir, 'originals', imported.archive.id), raw, { flag: 'wx' });
      for (const m of imported.media)
        await fs.writeFile(path.join(dataDir, 'media', m.id), m.data, { flag: 'wx' });
      await mutate((d) => {
        if (d.imports.some((a) => a.sha256 === hash)) throw fail(409, '这个备份已导入');
        d.imports.push(imported.archive);
        d.entries.push(...imported.entries);
        d.media.push(...imported.media.map(({ data, ...m }) => m));
        d.categories = [
          ...new Set([
            ...d.categories,
            ...imported.categories,
            ...imported.entries.map((e) => e.category),
          ]),
        ];
      });
      return reply(res, 200, imported.report);
    }
    if (p.startsWith('/api/original/') && req.method === 'GET') {
      const item = db.imports.find((a) => a.id === p.slice('/api/original/'.length));
      if (!item) throw fail(404, '原始备份不存在');
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(item.name),
        'Cache-Control': 'no-store',
      });
      createReadStream(path.join(dataDir, 'originals', item.id)).pipe(res);
      return true;
    }
    if (p === '/api/restore' && req.method === 'POST') {
      const bundle = JSON.parse((await body(req, 200 * 1024 * 1024)).toString('utf8'));
      if (
        bundle.format !== 'shiye-bundle' ||
        bundle.version !== 1 ||
        !Array.isArray(bundle.files) ||
        !Array.isArray(bundle.library?.entries) ||
        !Array.isArray(bundle.library?.media) ||
        !Array.isArray(bundle.library?.imports) ||
        !Array.isArray(bundle.library?.categories)
      )
        throw fail(400, '备份结构不正确');
      const lib = bundle.library,
        remap = new Map(),
        writes = [];
      let size = 0;
      for (const folder of ['media', 'originals'])
        for (const item of folder === 'media' ? lib.media : lib.imports) {
          if (typeof item.id !== 'string' || remap.has(folder + item.id))
            throw fail(400, '备份含重复文件标识');
          const file = bundle.files.find((f) => f.id === item.id && f.folder === folder);
          if (!file || typeof file.data !== 'string') throw fail(400, '备份缺少附件或原件');
          const data = Buffer.from(file.data, 'base64');
          size += data.length;
          if (size > LIMITS.legacyBundleBytes || sha(data) !== file.sha256)
            throw fail(400, '备份文件校验失败或超过大小限制');
          const id = randomUUID();
          remap.set(folder + item.id, id);
          writes.push({ folder, id, data });
        }
      const media = lib.media.map((m) => ({
        ...m,
        id: remap.get('media' + m.id),
        type: /^(image\/(png|jpeg|webp|gif|avif)|video\/(mp4|webm|quicktime)|audio\/(mpeg|mp4|ogg|wav|x-wav|webm|aac))$/.test(
          m.type,
        )
          ? m.type
          : 'application/octet-stream',
      }));
      const entries = lib.entries.map((e) => {
        if (
          typeof e.content !== 'string' ||
          typeof e.title !== 'string' ||
          !Array.isArray(e.tags) ||
          e.tags.some((t) => typeof t !== 'string') ||
          !Array.isArray(e.attachments) ||
          !Number.isFinite(Date.parse(e.date))
        )
          throw fail(400, '备份日记结构不正确');
        if (e.attachments.some((id) => !remap.has('media' + id)))
          throw fail(400, '备份日记缺少附件');
        const m = structuredClone(e);
        m.id = randomUUID();
        m.title = db.entries.some((old) => old.id === e.id) ? e.title + '（恢复副本）' : e.title;
        m.attachments = e.attachments.map((id) => remap.get('media' + id));
        m.revision = 1;
        m.history = (e.history || []).map((h) => ({
          ...h,
          attachments: (h.attachments || []).map((id) => remap.get('media' + id)).filter(Boolean),
        }));
        if (m.legacy?.mediaReferences)
          m.legacy.mediaReferences = m.legacy.mediaReferences.map((r) => ({
            ...r,
            mediaId: r.mediaId ? remap.get('media' + r.mediaId) || null : null,
          }));
        m.restoredFrom = { id: e.id, history: e.history || [] };
        return m;
      });
      const imports = lib.imports.map((a) => ({ ...a, id: remap.get('originals' + a.id) }));
      for (const f of writes)
        await fs.writeFile(path.join(dataDir, f.folder, f.id), f.data, { flag: 'wx' });
      await mutate((d) => {
        d.templates = [
          ...(d.templates || []),
          ...(lib.templates || []).map((t) => ({ ...t, id: randomUUID() })),
        ];
        d.entries.push(...entries);
        d.media.push(...media);
        d.imports.push(...imports);
        d.categories = [
          ...new Set([...d.categories, ...lib.categories.filter((c) => typeof c === 'string')]),
        ];
      });
      return reply(res, 200, { entries: entries.length, media: media.length });
    }
    if (p === '/api/export' && req.method === 'GET') {
      res.setHeader('Content-Disposition', 'attachment; filename="diary-library.json"');
      return reply(res, 200, db);
    }

    return false;
  };
}
