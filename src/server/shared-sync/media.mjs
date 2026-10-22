import { promises as fs, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { sharedInfo } from './replication.mjs';
import { portableConfiguration } from '../sync-product/migration-metadata.mjs';

const MAX_CHUNK = 256 * 1024,
  MAX_SIZE = 16 * 1024 ** 3;
const uuid = (id) =>
  typeof id === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id);
const digest = (value) => createHash('sha256').update(value).digest('hex');
const fail = (status, code) => {
  throw Object.assign(new Error(code), { status, code });
};
const publicAsset = (item) => {
  const { originalPath: _originalPath, thumbnailPath: _thumbnailPath, ...value } = item;
  return portableConfiguration(value);
};
async function fileHash(file) {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(file)) h.update(chunk);
  return h.digest('hex');
}
/** Bounded JSON chunks for the fixed native bridge; original bytes stay in the
 * existing media directory. No alternate business owner or client-supplied path.
 */
export function createSharedMedia({ store, dataDir, body, reply }) {
  const directory = path.join(dataDir, '.shared-uploads'),
    locks = new Map();
  function identity(input) {
    const info = sharedInfo(store.getDb());
    if (!info.enabled) fail(503, 'SHARED_SYNC_NOT_ENABLED');
    if (info.libraryId !== input.libraryId || info.epoch !== input.epoch)
      fail(409, 'SHARED_LIBRARY_MISMATCH');
    return info;
  }
  async function serial(id, fn) {
    const prior = locks.get(id) || Promise.resolve();
    const task = prior.catch(() => {}).then(fn);
    locks.set(id, task);
    try {
      return await task;
    } finally {
      if (locks.get(id) === task) locks.delete(id);
    }
  }
  const files = (id) => ({
    meta: path.join(directory, id + '.json'),
    part: path.join(directory, id + '.part'),
  });
  async function spec(input) {
    if (!uuid(input.operationId)) fail(400, 'SHARED_INVALID_OPERATION');
    const selected = files(input.operationId);
    let saved;
    try {
      saved = JSON.parse(await fs.readFile(selected.meta, 'utf8'));
    } catch (e) {
      if (e.code === 'ENOENT') fail(404, 'SHARED_UPLOAD_NOT_FOUND');
      throw e;
    }
    if (saved.libraryId !== input.libraryId || saved.epoch !== input.epoch)
      fail(409, 'SHARED_LIBRARY_MISMATCH');
    return { ...selected, saved };
  }
  const receipt = (db, id) => db._sharedMedia?.find((r) => r.operationId === id);
  function uploadMetadata(value) {
    if (
      !value ||
      Array.isArray(value) ||
      typeof value !== 'object' ||
      Object.keys(value).some((k) => !['name', 'mime', 'size', 'sha256'].includes(k)) ||
      typeof value.name !== 'string' ||
      !value.name ||
      value.name.length > 250 ||
      typeof value.mime !== 'string' ||
      !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(value.mime) ||
      !Number.isSafeInteger(value.size) ||
      value.size < 1 ||
      value.size > MAX_SIZE ||
      !/^[a-f0-9]{64}$/.test(value.sha256)
    )
      fail(400, 'SHARED_INVALID_MEDIA');
    return { name: value.name, mime: value.mime, size: value.size, sha256: value.sha256 };
  }
  async function handle(req, res, pathname) {
    const prefix = '/api/shared/v1/media/';
    if (!pathname.startsWith(prefix)) return false;
    try {
      if (req.method !== 'POST') fail(404, 'SHARED_ACTION_NOT_FOUND');
      const input = JSON.parse((await body(req, MAX_CHUNK * 2)).toString('utf8'));
      identity(input);
      const action = pathname.slice(prefix.length);
      if (action === 'read') {
        if (
          !uuid(input.assetId) ||
          !Number.isSafeInteger(input.offset) ||
          input.offset < 0 ||
          !Number.isSafeInteger(input.length) ||
          input.length < 1 ||
          input.length > MAX_CHUNK
        )
          fail(400, 'SHARED_INVALID_MEDIA_RANGE');
        const item = store.getDb().media.find((m) => m.id === input.assetId);
        if (!item) fail(404, 'SHARED_MEDIA_NOT_FOUND');
        const file = path.join(dataDir, 'media', item.id),
          stat = await fs.stat(file);
        if (stat.size !== item.size || !item.sha256) fail(409, 'SHARED_MEDIA_CHANGED');
        if (input.offset > stat.size) fail(416, 'SHARED_INVALID_MEDIA_RANGE');
        const count = Math.min(input.length, stat.size - input.offset),
          bytes = Buffer.alloc(count),
          handle = await fs.open(file, 'r');
        try {
          const read = await handle.read(bytes, 0, count, input.offset);
          if (read.bytesRead !== count) fail(409, 'SHARED_MEDIA_CHANGED');
        } finally {
          await handle.close();
        }
        return reply(res, 200, {
          info: sharedInfo(store.getDb()),
          asset: publicAsset(item),
          offset: input.offset,
          next: input.offset + count,
          done: input.offset + count === stat.size,
          bytesBase64: bytes.toString('base64'),
          chunkSha256: digest(bytes),
        });
      }
      if (!['begin', 'chunk', 'complete'].includes(action) || !uuid(input.operationId))
        fail(400, 'SHARED_INVALID_MEDIA_ACTION');
      const result = await serial(input.operationId, async () => {
        const existing = receipt(store.getDb(), input.operationId);
        if (action === 'begin') {
          const metadata = uploadMetadata(input.metadata),
            requestDigest = digest(JSON.stringify(metadata));
          if (existing) {
            if (existing.digest !== requestDigest) fail(409, 'SHARED_OPERATION_REUSED');
            return { complete: true, asset: publicAsset(existing.result), next: metadata.size };
          }
          await fs.mkdir(directory, { recursive: true });
          const selected = files(input.operationId);
          let saved;
          try {
            saved = JSON.parse(await fs.readFile(selected.meta, 'utf8'));
          } catch (e) {
            if (e.code !== 'ENOENT') throw e;
          }
          if (saved) {
            if (
              saved.digest !== requestDigest ||
              saved.libraryId !== input.libraryId ||
              saved.epoch !== input.epoch
            )
              fail(409, 'SHARED_OPERATION_REUSED');
          } else {
            saved = {
              libraryId: input.libraryId,
              epoch: input.epoch,
              digest: requestDigest,
              metadata,
            };
            const temp = selected.meta + '.tmp';
            await fs.writeFile(temp, JSON.stringify(saved), { flag: 'w' });
            await fs.rename(temp, selected.meta);
          }
          const target = path.join(dataDir, 'media', input.operationId);
          try {
            const stat = await fs.stat(target);
            if (stat.size !== metadata.size || (await fileHash(target)) !== metadata.sha256)
              fail(409, 'SHARED_MEDIA_ID_CONFLICT');
            return {
              complete: false,
              operationId: input.operationId,
              next: metadata.size,
              maxChunkBytes: MAX_CHUNK,
            };
          } catch (e) {
            if (e.code !== 'ENOENT') throw e;
          }
          const file = await fs.open(selected.part, 'a');
          await file.close();
          return {
            complete: false,
            operationId: input.operationId,
            next: (await fs.stat(selected.part)).size,
            maxChunkBytes: MAX_CHUNK,
          };
        }
        if (existing)
          return {
            complete: true,
            asset: publicAsset(existing.result),
            next: existing.result.size,
          };
        const selected = await spec(input),
          metadata = selected.saved.metadata;
        if (action === 'chunk') {
          if (
            !Number.isSafeInteger(input.offset) ||
            input.offset < 0 ||
            typeof input.bytesBase64 !== 'string' ||
            input.bytesBase64.length > Math.ceil(MAX_CHUNK / 3) * 4 ||
            !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
              input.bytesBase64,
            )
          )
            fail(400, 'SHARED_INVALID_MEDIA_CHUNK');
          const bytes = Buffer.from(input.bytesBase64, 'base64');
          if (
            !bytes.length ||
            bytes.length > MAX_CHUNK ||
            digest(bytes) !== input.chunkSha256 ||
            input.offset + bytes.length > metadata.size
          )
            fail(400, 'SHARED_INVALID_MEDIA_CHUNK');
          const file = await fs.open(selected.part, 'r+');
          try {
            const length = (await file.stat()).size;
            if (input.offset < length) {
              if (input.offset + bytes.length > length) fail(409, 'SHARED_MEDIA_OFFSET_CONFLICT');
              const prior = Buffer.alloc(bytes.length);
              await file.read(prior, 0, prior.length, input.offset);
              if (!prior.equals(bytes)) fail(409, 'SHARED_MEDIA_OFFSET_CONFLICT');
              return { next: length, replayed: true };
            }
            if (input.offset !== length) fail(409, 'SHARED_MEDIA_OFFSET_CONFLICT');
            let written = 0;
            while (written < bytes.length) {
              const result = await file.write(
                bytes,
                written,
                bytes.length - written,
                length + written,
              );
              if (!result.bytesWritten) fail(500, 'SHARED_MEDIA_WRITE_FAILED');
              written += result.bytesWritten;
            }
            await file.sync();
            return { next: length + bytes.length, replayed: false };
          } finally {
            await file.close();
          }
        }
        let part = selected.part;
        const target = path.join(dataDir, 'media', input.operationId);
        try {
          await fs.stat(part);
        } catch (e) {
          if (e.code !== 'ENOENT') throw e;
          part = target;
        }
        if (
          (await fs.stat(part)).size !== metadata.size ||
          (await fileHash(part)) !== metadata.sha256
        )
          fail(409, 'SHARED_MEDIA_HASH_MISMATCH');
        if (part !== target) {
          try {
            await fs.link(part, target);
          } catch (e) {
            if (e.code !== 'EEXIST') throw e;
            if (
              (await fs.stat(target)).size !== metadata.size ||
              (await fileHash(target)) !== metadata.sha256
            )
              fail(409, 'SHARED_MEDIA_ID_CONFLICT');
          }
          await fs.unlink(part);
        }
        const verifiedDuplicates = new Set();
        for (const item of store
          .getDb()
          .media.filter(
            (m) =>
              !m.purpose &&
              m.sha256 === metadata.sha256 &&
              m.size === metadata.size &&
              m.type === metadata.mime,
          )) {
          const original = path.join(dataDir, 'media', item.id);
          try {
            if (
              !uuid(item.id) ||
              (await fs.stat(original)).size !== metadata.size ||
              (await fileHash(original)) !== metadata.sha256
            )
              fail(409, 'SHARED_EXISTING_ORIGINAL_UNAVAILABLE');
          } catch (error) {
            if (error.code === 'ENOENT') fail(409, 'SHARED_EXISTING_ORIGINAL_UNAVAILABLE');
            throw error;
          }
          verifiedDuplicates.add(item.id);
        }
        const result = await store.mutate((db) => {
          const duplicateReceipt = receipt(db, input.operationId);
          if (duplicateReceipt) return duplicateReceipt.result;
          if ((db._sharedMedia?.length || 0) >= 50000) fail(409, 'SHARED_RECEIPT_CAPACITY');
          let item = db.media.find(
            (m) =>
              !m.purpose &&
              m.sha256 === metadata.sha256 &&
              m.size === metadata.size &&
              m.type === metadata.mime,
          );
          if (item && !verifiedDuplicates.has(item.id))
            fail(409, 'SHARED_EXISTING_ORIGINAL_UNAVAILABLE');
          if (!item) {
            if (db.media.some((m) => m.id === input.operationId))
              fail(409, 'SHARED_MEDIA_ID_CONFLICT');
            item = {
              id: input.operationId,
              name: metadata.name,
              type: metadata.mime,
              size: metadata.size,
              sha256: metadata.sha256,
              importedAt: new Date().toISOString(),
            };
            db.media.push(item);
          }
          (db._sharedMedia ||= []).push({
            operationId: input.operationId,
            digest: selected.saved.digest,
            result: publicAsset(item),
          });
          return item;
        });
        // Committed duplicate bytes may be discarded. An uncommitted original is
        // deliberately retained for retry if JSON persistence failed.
        if (result.id !== input.operationId) await fs.unlink(target).catch(() => {});
        await fs.unlink(selected.meta).catch(() => {});
        return { complete: true, asset: publicAsset(result), next: metadata.size };
      });
      return reply(res, 200, { info: sharedInfo(store.getDb()), ...result });
    } catch (error) {
      return reply(res, error.status || 500, {
        error: {
          code: error.code && /^SHARED_/.test(error.code) ? error.code : 'SHARED_MEDIA_FAILED',
        },
      });
    }
  }
  return { handle };
}
