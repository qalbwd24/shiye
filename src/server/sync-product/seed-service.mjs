import path from 'node:path';
import { promises as fs, createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { writeSeedPackage, readSeedPackage, seedFileHash } from './seed-package.mjs';

const fail = (status, code) => Object.assign(new Error(code), { status, code });
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const read = (file) => fs.readFile(file, 'utf8').then(JSON.parse);
const validId = (id) => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id);
const CHUNK = 4 * 1024 ** 2;
export async function createProductSeedService({
  dataDir,
  store,
  media,
  publishPending,
  capture,
  initialize,
  clock = Date.now,
}) {
  const root = path.join(dataDir, 'product-seeds');
  await fs.mkdir(root, { recursive: true });
  const tasks = new Map();
  let queue = Promise.resolve();
  const serial = (fn) => {
    const next = queue.then(fn);
    queue = next.catch(() => {});
    return next;
  };
  const jobDir = (kind, id) => {
    if (!validId(id)) throw fail(400, 'INVALID_SEED_JOB');
    return path.join(root, kind + '-' + id);
  };
  const save = async (dir, job) => {
    const temporary = path.join(dir, 'job-' + randomUUID() + '.tmp');
    await fs.writeFile(temporary, JSON.stringify(job), { flag: 'wx' });
    // Windows can briefly deny replacement while a status poll has the old file open.
    for (let attempt = 0; ; attempt++) {
      try {
        await fs.rename(temporary, path.join(dir, 'job.json'));
        break;
      } catch (error) {
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 20) throw error;
        await delay(10 * (attempt + 1));
      }
    }
  };
  const load = async (kind, id) => {
    try {
      return await read(path.join(jobDir(kind, id), 'job.json'));
    } catch (error) {
      if (error.code === 'ENOENT') throw fail(404, 'SEED_JOB_NOT_FOUND');
      throw error;
    }
  };
  async function ensureExportCurrent(job, { allowRedactions = false } = {}) {
    let cursor = job.manifest.checkpoint,
      page;
    const affected = new Map();
    do {
      page = store.pull({ cursor, limit: 200 });
      for (const change of page.changes)
        if (change.entity.state !== 'active') {
          const entity = store.getEntity(change.entity.entityType, change.entity.entityId);
          if (entity.state !== 'active')
            affected.set(JSON.stringify([entity.entityType, entity.entityId]), entity);
        }
      cursor = page.cursor;
    } while (page.hasMore);
    if (affected.size) {
      job.status = 'revoked';
      job.error = 'SEED_EXPORT_REVOKED';
      const dir = jobDir('export', job.id);
      await save(dir, job);
      // Only this generated export's body caches are removed. Never touch library originals.
      for (const relative of ['package.syseed', 'package.partial', 'members/records.ndjson'])
        await fs.unlink(path.join(dir, ...relative.split('/'))).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
        });
      if (!allowRedactions) throw fail(409, 'SEED_EXPORT_REVOKED');
    }
    return [...affected.values()];
  }
  const view = (job) => {
    const { file: _file, directory: _directory, owner: _owner, ...value } = job;
    if (['building', 'committing'].includes(value.status) && !tasks.has(job.id))
      value.status = 'interrupted';
    return { ...value, chunkSize: CHUNK };
  };
  const run = (job, action) => {
    const task = Promise.resolve()
      .then(action)
      .catch(async (error) => {
        if (job.status !== 'revoked') job.status = 'failed';
        job.error = /^[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'SEED_JOB_FAILED';
        // A full/unwritable disk can also prevent the failure receipt. Keep the
        // service alive; a persisted running job then reads as interrupted.
        await save(jobDir(job.kind, job.id), job).catch(() => {});
      })
      .finally(() => tasks.delete(job.id));
    tasks.set(job.id, task);
    return task;
  };
  async function exportJob(input) {
    if (
      typeof input.operationId !== 'string' ||
      !/^[A-Za-z0-9_:@.-]{1,160}$/.test(input.operationId)
    )
      throw fail(400, 'SEED_OPERATION_ID_REQUIRED');
    const names = await fs.readdir(root);
    for (const name of names.filter((n) => n.startsWith('export-') && validId(n.slice(7)))) {
      const old = await load('export', name.slice(7));
      if (old.operationId === input.operationId) return view(old);
    }
    const job = {
      id: randomUUID(),
      kind: 'export',
      operationId: input.operationId,
      status: 'building',
      createdAt: new Date(clock()).toISOString(),
    };
    const dir = jobDir('export', job.id);
    await fs.mkdir(dir);
    await save(dir, job);
    run(job, async () => {
      const snapshot = await capture();
      const partial = path.join(dir, 'package.partial');
      const result = await writeSeedPackage({
        file: partial,
        directory: path.join(dir, 'members'),
        ...snapshot,
        openAsset: media.openContent,
        clock,
        packageId: job.id,
      });
      job.manifest = result.manifest;
      await ensureExportCurrent(job);
      await fs.rename(partial, path.join(dir, 'package.syseed'));
      Object.assign(job, result, { status: 'ready', file: path.join(dir, 'package.syseed') });
      await save(dir, job);
    });
    return view(job);
  }
  async function importJob(input, device) {
    if (
      input.mode !== 'initialize-empty' ||
      !/^[a-f0-9]{64}$/.test(input.sha256 || '') ||
      !Number.isSafeInteger(input.size) ||
      input.size < 20 ||
      input.size > 64 * 1024 ** 3 + 32 * 1024 ** 2
    )
      throw fail(400, 'INVALID_SEED_IMPORT');
    const existing = await fs.readdir(root);
    for (const name of existing.filter((n) => n.startsWith('import-') && validId(n.slice(7)))) {
      const old = await load('import', name.slice(7));
      if (old.owner === device.deviceId && old.sha256 === input.sha256) {
        if (old.size !== input.size) throw fail(409, 'SEED_IMPORT_SIZE_CHANGED');
        return view(old);
      }
    }
    const active = existing.filter((n) => n.startsWith('import-')).length;
    if (active >= 1000) throw fail(429, 'SEED_IMPORT_JOB_LIMIT');
    const available = await fs.statfs(root);
    if (input.size * 3 > available.bavail * available.bsize) throw fail(507, 'SEED_DISK_SPACE');
    const job = {
      id: randomUUID(),
      kind: 'import',
      owner: device.deviceId,
      mode: input.mode,
      sha256: input.sha256,
      size: input.size,
      status: 'uploading',
      received: [],
      createdAt: new Date(clock()).toISOString(),
    };
    const dir = jobDir('import', job.id);
    await fs.mkdir(dir);
    await save(dir, job);
    return view(job);
  }
  async function loadImport(id, device) {
    const job = await load('import', id);
    if (job.owner !== device.deviceId) throw fail(403, 'SEED_JOB_OWNER');
    return job;
  }
  async function upload(req, id, index, device) {
    const job = await loadImport(id, device);
    if (job.status === 'committed') return view(job);
    if (job.status !== 'uploading') throw fail(409, 'SEED_IMPORT_BUSY');
    const expected = Math.min(CHUNK, job.size - index * CHUNK);
    if (!Number.isSafeInteger(index) || index < 0 || expected <= 0)
      throw fail(400, 'SEED_CHUNK_INDEX');
    const parts = [];
    let size = 0;
    for await (const bytes of req) {
      size += bytes.length;
      if (size > expected) throw fail(413, 'SEED_CHUNK_SIZE');
      parts.push(bytes);
    }
    if (size !== expected) throw fail(422, 'SEED_CHUNK_SIZE');
    const bytes = Buffer.concat(parts),
      sha = digest(bytes);
    if (req.headers['x-chunk-sha256'] && req.headers['x-chunk-sha256'] !== sha)
      throw fail(422, 'SEED_CHUNK_HASH');
    const file = path.join(jobDir('import', id), 'chunk-' + index);
    try {
      await fs.writeFile(file, bytes, { flag: 'wx' });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if ((await seedFileHash(file)) !== sha) throw fail(409, 'SEED_CHUNK_CONFLICT');
    }
    if (!job.received.includes(index)) {
      job.received.push(index);
      job.received.sort((a, b) => a - b);
      await save(jobDir('import', id), job);
    }
    return view(job);
  }
  async function commitJob(id, device) {
    const job = await loadImport(id, device);
    if (job.status === 'committed' || tasks.has(id)) return view(job);
    if (job.received.length !== Math.ceil(job.size / CHUNK)) throw fail(409, 'SEED_CHUNKS_MISSING');
    job.status = 'committing';
    delete job.error;
    await save(jobDir('import', id), job);
    run(job, async () => {
      const dir = jobDir('import', id),
        file = path.join(dir, 'assembled-' + randomUUID() + '.syseed');
      const out = await fs.open(file, 'wx');
      try {
        for (let i = 0; i < Math.ceil(job.size / CHUNK); i++)
          for await (const bytes of createReadStream(path.join(dir, 'chunk-' + i)))
            await out.writeFile(bytes);
        await out.sync();
      } finally {
        await out.close();
      }
      const parsed = await readSeedPackage({
        file,
        directory: path.join(dir, 'verified-' + randomUUID()),
        expectedSha256: job.sha256,
      });
      // The atomic metadata import happens only after every resource is verified and registered.
      const receipt = await initialize(parsed, async () => {
        for (const record of parsed.records.filter(
          (r) => r.entityType === 'asset' && r.state === 'active',
        )) {
          const asset = record.data;
          const pending = await media.begin(asset);
          if (pending.missingChunks.length) {
            const input = await fs.open(path.join(parsed.directory, 'media', asset.sha256), 'r');
            try {
              for (const index of pending.missingChunks) {
                const bytes = Buffer.alloc(
                  Math.min(pending.chunkSize, asset.size - index * pending.chunkSize),
                );
                const { bytesRead } = await input.read(
                  bytes,
                  0,
                  bytes.length,
                  index * pending.chunkSize,
                );
                if (bytesRead !== bytes.length) throw fail(422, 'SEED_MEDIA_TRUNCATED');
                await media.putChunk(pending.uploadId, index, bytes);
              }
            } finally {
              await input.close();
            }
          }
          await media.complete(pending.uploadId);
        }
        await publishPending();
      });
      Object.assign(job, { status: 'committed', receipt, manifest: parsed.manifest });
      await save(dir, job);
    });
    return view(job);
  }
  async function resolve(input) {
    const info = store.info();
    if (input.libraryId !== info.libraryId || input.epoch !== info.epoch)
      throw fail(409, 'SEED_LIBRARY_MISMATCH');
    const job = await load('export', input.packageId);
    if (
      !['ready', 'revoked'].includes(job.status) ||
      job.sha256 !== input.sha256 ||
      job.manifest.checkpoint !== input.checkpoint
    )
      throw fail(409, 'SEED_CHECKPOINT_UNTRUSTED');
    const redactions = await ensureExportCurrent(job, { allowRedactions: true });
    store.pull({ cursor: input.checkpoint, limit: 1 });
    return {
      verified: true,
      packageId: job.id,
      sha256: job.sha256,
      libraryId: info.libraryId,
      epoch: info.epoch,
      checkpoint: job.manifest.checkpoint,
      watermark: job.manifest.watermark,
      policy: job.manifest.policy,
      catchUpRequired: true,
      redactions,
    };
  }
  return {
    async handle(req, res, { route, device, readJson, json }) {
      const prefix = 'api/product/v1/seed/';
      if (!route.startsWith(prefix)) return false;
      const action = route.slice(prefix.length);
      if (action === 'exports' && req.method === 'POST') {
        json(res, 202, await serial(async () => exportJob(await readJson(req, 16384))));
        return true;
      }
      if (action === 'imports' && req.method === 'POST') {
        json(res, 201, await serial(async () => importJob(await readJson(req, 16384), device)));
        return true;
      }
      if (action === 'resolve' && req.method === 'POST') {
        json(res, 200, await resolve(await readJson(req, 16384)));
        return true;
      }
      const match = /^(exports|imports)\/([a-f0-9-]{36})(?:\/(content|commit|chunks\/\d+))?$/.exec(
        action,
      );
      if (!match) throw fail(404, 'SEED_ROUTE_NOT_FOUND');
      const [, kind, id, suffix] = match;
      if (kind === 'imports') {
        if (!suffix && req.method === 'GET') {
          json(res, 200, view(await loadImport(id, device)));
          return true;
        }
        if (suffix === 'commit' && req.method === 'POST') {
          json(res, 202, await serial(() => commitJob(id, device)));
          return true;
        }
        if (suffix?.startsWith('chunks/') && req.method === 'PUT') {
          json(res, 200, await serial(() => upload(req, id, Number(suffix.slice(7)), device)));
          return true;
        }
      } else {
        const job = await load('export', id);
        if (!suffix && req.method === 'GET') {
          json(res, 200, view(job));
          return true;
        }
        if (suffix === 'content' && req.method === 'GET') {
          if (job.status !== 'ready') throw fail(409, 'SEED_EXPORT_NOT_READY');
          await ensureExportCurrent(job);
          let start = 0,
            end = job.size - 1,
            status = 200;
          if (req.headers.range) {
            const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
            if (!range) throw fail(416, 'SEED_INVALID_RANGE');
            start = Number(range[1]);
            if (range[2]) end = Math.min(Number(range[2]), end);
            if (
              !Number.isSafeInteger(start) ||
              !Number.isSafeInteger(end) ||
              start < 0 ||
              start > end
            )
              throw fail(416, 'SEED_INVALID_RANGE');
            status = 206;
            res.setHeader('Content-Range', `bytes ${start}-${end}/${job.size}`);
          }
          res.writeHead(status, {
            'Content-Type': 'application/octet-stream',
            'Content-Length': end - start + 1,
            'Accept-Ranges': 'bytes',
            ETag: '"' + job.sha256 + '"',
            'Content-Disposition': `attachment; filename="shiye-${id}.syseed"`,
          });
          const stream = createReadStream(job.file, { start, end });
          stream.on('error', () => res.destroy());
          res.once('close', () => stream.destroy());
          stream.pipe(res);
          return true;
        }
      }
      throw fail(405, 'SEED_METHOD_NOT_ALLOWED');
    },
    async close() {
      await queue;
      await Promise.allSettled([...tasks.values()]);
    },
  };
}
