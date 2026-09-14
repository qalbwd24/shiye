import { LIMITS } from '../../../public/shared/limits.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { extractZip } from '../imports/zip-stream.mjs';
import { decodeLegacy } from '../imports/legacy.mjs';
export function largeImporter({ dataDir, getDb, mutate, reply, fail }) {
  const uploads = new Map(),
    root = path.resolve(dataDir, 'import-staging');
  const cleanup = async (dir) => {
    const target = path.resolve(dir);
    if (!target.startsWith(root + path.sep) || !/^[-a-f0-9]{36}$/.test(path.basename(target)))
      throw Error('Invalid import staging path');
    await fs.rm(target, { recursive: true, force: true });
  };
  const space = async (bytes) => {
    const s = await fs.statfs(dataDir);
    if (bytes > s.bavail * s.bsize) throw fail(507, '所在磁盘剩余空间不足，请释放空间后重新导入');
  };
  return async (req, res, p) => {
    if (p === '/api/import-upload' && req.method === 'POST') {
      const id = randomUUID(),
        dir = path.join(root, id),
        name = decodeURIComponent(req.headers['x-file-name'] || 'backup.zip').slice(0, 250);
      const declared = Number(req.headers['content-length'] || 0);
      if (declared > LIMITS.archiveUploadBytes) throw fail(413, '备份超过 64 GB');
      await space(declared);
      await fs.mkdir(dir, { recursive: true });
      const file = path.join(dir, 'original'),
        out = await fs.open(file, 'wx'),
        hash = createHash('sha256');
      let size = 0;
      try {
        for await (const chunk of req) {
          size += chunk.length;
          if (size > LIMITS.archiveUploadBytes) throw fail(413, '备份超过 64 GB');
          hash.update(chunk);
          await out.writeFile(chunk);
        }
        await out.close();
      } catch (e) {
        await out.close().catch(() => {});
        await cleanup(dir);
        throw e;
      }
      uploads.set(id, { dir, file, name, size, hash: hash.digest('hex') });
      reply(res, 201, { id, bytes: size });
      return true;
    }
    const m = p.match(/^\/api\/import-upload\/([a-f0-9-]{36})\/commit$/);
    if (!m || req.method !== 'POST') return false;
    const job = uploads.get(m[1]);
    if (!job) throw fail(404, '导入文件不存在，请重新选择');
    if (job.busy) throw fail(409, '正在处理这份备份');
    job.busy = true;
    const created = [];
    let committed = false;
    try {
      if (getDb().imports.some((a) => a.sha256 === job.hash))
        throw fail(409, '这份备份已导入，无需重复添加');
      const handle = await fs.open(job.file, 'r'),
        head = Buffer.alloc(4);
      try {
        await handle.read(head, 0, 4, 0);
      } finally {
        await handle.close();
      }
      let imported;
      if (head.readUInt32LE(0) === 0x04034b50) {
        const members = await extractZip(job.file, job.dir);
        imported = await decodeLegacy(head, job.name, { members, sha256: job.hash });
      } else {
        if (job.size > LIMITS.legacyBundleBytes) throw fail(413, '非 ZIP 日记元数据超过 128 MB');
        imported = await decodeLegacy(await fs.readFile(job.file), job.name);
      }
      await space(
        job.size + imported.media.reduce((n, m) => n + (m.size ?? m.data?.length ?? 0), 0),
      );
      const original = path.join(dataDir, 'originals', imported.archive.id);
      created.push(original);
      await fs.copyFile(job.file, original, fs.constants.COPYFILE_EXCL);
      for (const media of imported.media) {
        const dest = path.join(dataDir, 'media', media.id);
        created.push(dest);
        if (media.sourcePath) await fs.copyFile(media.sourcePath, dest, fs.constants.COPYFILE_EXCL);
        else await fs.writeFile(dest, media.data, { flag: 'wx' });
      }
      await mutate((d) => {
        if (d.imports.some((a) => a.sha256 === job.hash)) throw fail(409, '这份备份已导入');
        d.imports.push(imported.archive);
        d.entries.push(...imported.entries);
        d.media.push(...imported.media.map(({ data, sourcePath, ...m }) => m));
        d.templates.push(...(imported.templates || []));
        d.categories = [
          ...new Set([
            ...d.categories,
            ...imported.categories,
            ...imported.entries.map((e) => e.category),
          ]),
        ];
      });
      committed = true;
      reply(res, 200, imported.report);
    } catch (e) {
      if (e.status) throw e;
      throw fail(
        e.code === 'ENOSPC' ? 507 : 422,
        e.code === 'ENOSPC' ? '磁盘空间不足，导入未完成' : e.message,
      );
    } finally {
      uploads.delete(m[1]);
      if (!committed) for (const file of created) await fs.unlink(file).catch(() => {});
      await cleanup(job.dir);
    }
    return true;
  };
}
