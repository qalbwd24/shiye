import { prepareStickers, reconcileStickers, prepareProfile } from '../domain/stickers.mjs';
import {
  reconcileImport,
  reconcileArchives,
  remapEntryMedia,
} from '../domain/import-reconciliation.mjs';
import { LIMITS } from '../../../public/shared/limits.js';
import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { decodeLegacy, sha } from '../imports/legacy.mjs';
import { legacySourceOptions } from '../imports/one-diary-source.mjs';
import {
  preserveMessageArchiveOwners,
  reconcileMessageArchive,
} from '../domain/message-store-archive.mjs';

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
        imported = await decodeLegacy(raw, name, legacySourceOptions(req.headers));
      } catch (e) {
        throw fail(422, '无法导入：' + e.message);
      }
      await fs.writeFile(path.join(dataDir, 'originals', imported.archive.id), raw, { flag: 'wx' });
      for (const m of imported.media)
        await fs.writeFile(path.join(dataDir, 'media', m.id), m.data, { flag: 'wx' });
      let reconciliation;
      await mutate((d) => {
        if (d.imports.some((a) => a.sha256 === hash)) throw fail(409, '这个备份已导入');
        d.imports.push(imported.archive);
        reconciliation = reconcileImport(d, {
          entries: imported.entries,
          media: imported.media.map(({ data, sourcePath, ...m }) => m),
        }).report;
        d.templates.push(...(imported.templates || []));
        d.tags = [...new Set([...(d.tags || []), ...(imported.tags || [])])];
        d.categories = [
          ...new Set([
            ...d.categories,
            ...imported.categories,
            ...imported.entries.map((e) => e.category),
          ]),
        ];
      });
      for (const id of reconciliation.redundantMedia)
        await fs.unlink(path.join(dataDir, 'media', id)).catch(() => {});
      Object.assign(imported.report, reconciliation);
      delete imported.report.redundantMedia;
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
        sha256: bundle.files.find((f) => f.folder === 'media' && f.id === m.id).sha256,
        type: /^(image\/(png|jpeg|webp|gif|avif)|video\/(mp4|webm|quicktime)|audio\/(mpeg|mp4|ogg|wav|x-wav|webm|aac))$/.test(
          m.type,
        )
          ? m.type
          : 'application/octet-stream',
      }));
      const mediaIdMap = new Map(
        lib.media.map((media) => [media.id, remap.get('media' + media.id)]),
      );
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
        const m = remapEntryMedia(e, mediaIdMap);
        m.id = randomUUID();
        m.title = e.title;
        m.attachments = e.attachments.map((id) => remap.get('media' + id));
        m.revision = 1;
        // remapEntryMedia already preserves/remaps history; do not duplicate raw snapshots.
        m.restoredFrom = { id: e.id };
        return m;
      });
      const imports = lib.imports.map((a) => ({ ...a, id: remap.get('originals' + a.id) }));
      const stickers = prepareStickers(lib.stickers, lib.media, mediaIdMap, fail);
      const profile =
        bundle.restoreAppearance === true || bundle.restoreProfile === true
          ? prepareProfile(lib.settings?.preferences?.profile, lib.media, mediaIdMap, fail)
          : undefined;
      for (const f of writes)
        await fs.writeFile(path.join(dataDir, f.folder, f.id), f.data, { flag: 'wx' });
      let reconciliation;
      await mutate((d) => {
        d.templates = [
          ...(d.templates || []),
          ...(lib.templates || []).map((t) => ({ ...t, id: randomUUID() })),
        ];
        const result = reconcileImport(d, {
          entries: preserveMessageArchiveOwners(d, lib, entries),
          media,
          chatJournal: lib.chatJournal,
        });
        reconciliation = result.report;
        reconcileStickers(d, stickers, result.mediaMap);
        if (profile !== undefined) {
          if (profile.authorAvatarId)
            profile.authorAvatarId =
              result.mediaMap.get(profile.authorAvatarId) || profile.authorAvatarId;
          d.settings.preferences ||= {};
          d.settings.preferences.profile = profile;
        }
        const entryIds = new Map(
          lib.entries.map((e, i) => [e.id, result.entryMap.get(entries[i].id)]),
        );
        Object.assign(
          reconciliation,
          reconcileMessageArchive(d, lib, {
            entryMap: entryIds,
            mediaMap: new Map(
              lib.media.map((item) => [
                item.id,
                result.mediaMap.get(mediaIdMap.get(item.id)) || mediaIdMap.get(item.id),
              ]),
            ),
          }),
        );
        for (const old of lib.conflicts || []) {
          const lookup = (id) =>
            old.kind === 'entry'
              ? entryIds.get(id)
              : result.mediaMap.get(remap.get('media' + id)) || remap.get('media' + id);
          const left = lookup(old.left),
            right = lookup(old.right);
          if (
            left &&
            right &&
            left !== right &&
            !(d.conflicts || []).some(
              (c) => c.kind === old.kind && c.left === left && c.right === right,
            )
          ) {
            d.conflicts ||= [];
            d.conflicts.push({
              ...old,
              id: randomUUID(),
              left,
              right,
              actions: (old.actions || []).map((action) => ({
                ...action,
                targets: (action.targets || [])
                  .map((target) => ({ ...target, id: entryIds.get(target.id) }))
                  .filter((target) => target.id),
              })),
            });
          }
        }
        d.tags = [...new Set([...(d.tags || []), ...(lib.tags || [])])];
        reconciliation.redundantOriginals = reconcileArchives(d, imports);
        d.categories = [
          ...new Set([...d.categories, ...lib.categories.filter((c) => typeof c === 'string')]),
        ];
      }).catch(async (error) => {
        for (const file of writes)
          await fs.unlink(path.join(dataDir, file.folder, file.id)).catch(() => {});
        throw error;
      });
      for (const id of reconciliation.redundantMedia)
        await fs.unlink(path.join(dataDir, 'media', id)).catch(() => {});
      for (const id of reconciliation.redundantOriginals)
        await fs.unlink(path.join(dataDir, 'originals', id)).catch(() => {});
      delete reconciliation.redundantOriginals;
      delete reconciliation.redundantMedia;
      return reply(res, 200, reconciliation);
    }
    if (p === '/api/export' && req.method === 'GET') {
      res.setHeader('Content-Disposition', 'attachment; filename="diary-library.json"');
      return reply(res, 200, db);
    }

    return false;
  };
}
