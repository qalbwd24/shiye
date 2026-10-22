import { Sha256, sha256Bytes } from './sync-v2-media.js';
const CHUNK = 256 * 1024,
  STAGE = 'local-seed-original',
  PART = 'local-seed-original-chunk';
const fail = (code) => {
  throw Object.assign(Error(code), { code });
};
const uuid = (value) =>
  typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const partId = (token, offset) => JSON.stringify([token, offset]);
/** Chunk bytes live in entity records in the SAME shared transaction store.
 * Only an opaque string enters the seed metadata index. No giant Blob in meta. */
export function createSharedSeedOriginalStore({
  storage,
  libraryId,
  epoch,
  idFactory = () => crypto.randomUUID(),
} = {}) {
  if (!storage?.transaction || !uuid(libraryId) || !uuid(epoch))
    fail('SHARED_SEED_ORIGINAL_STORE_REQUIRED');
  const hashes = new Map();
  async function transaction(fn) {
    return storage.transaction(async (tx) => {
      const meta = await tx.getMeta();
      if (
        meta &&
        (meta.sharedBusiness !== 1 || meta.libraryId !== libraryId || meta.epoch !== epoch)
      )
        fail('SHARED_IDENTITY_MISMATCH');
      return fn(tx);
    });
  }
  const tokenOf = (handle) => {
    if (
      typeof handle !== 'string' ||
      !handle.startsWith('shared-seed-idb:') ||
      !uuid(handle.slice(16))
    )
      fail('SHARED_SEED_INVALID_ORIGINAL_HANDLE');
    return handle.slice(16);
  };
  async function selected(tx, token) {
    const row = await tx.getEntity(STAGE, token);
    if (
      !row?.seedOriginal ||
      row.seedOriginal.libraryId !== libraryId ||
      row.seedOriginal.epoch !== epoch
    )
      fail('SHARED_SEED_ORIGINAL_NOT_FOUND');
    return row;
  }
  const stageOriginal = {
    async begin(asset) {
      const token = idFactory();
      if (!uuid(token)) fail('SHARED_SEED_INVALID_STAGE');
      await transaction(async (tx) => {
        if (await tx.getEntity(STAGE, token)) fail('SHARED_SEED_STAGE_REUSED');
        await tx.putEntity({
          entityType: STAGE,
          entityId: token,
          base: null,
          local: null,
          seedOriginal: {
            version: 1,
            libraryId,
            epoch,
            asset: structuredClone(asset),
            next: 0,
            status: 'staging',
          },
        });
      });
      hashes.set(token, new Sha256());
      return token;
    },
    async write(token, offset, bytes) {
      const digest = hashes.get(token);
      if (!digest || !(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > CHUNK)
        fail('SHARED_SEED_INVALID_STAGE');
      await transaction(async (tx) => {
        const row = await selected(tx, token),
          s = row.seedOriginal;
        if (
          s.status !== 'staging' ||
          offset !== s.next ||
          bytes.length > s.asset.size - offset ||
          offset % CHUNK !== 0
        )
          fail('SHARED_SEED_INVALID_RANGE');
        await tx.putEntity({
          entityType: PART,
          entityId: partId(token, offset),
          base: null,
          local: null,
          seedChunk: { bytes: new Uint8Array(bytes), sha256: sha256Bytes(bytes) },
        });
        s.next += bytes.length;
        await tx.putEntity(row);
      });
      digest.update(bytes);
    },
    async finish(token, asset) {
      const digest = hashes.get(token);
      if (!digest) fail('SHARED_SEED_INVALID_STAGE');
      const sha = digest.digest();
      await transaction(async (tx) => {
        const row = await selected(tx, token),
          s = row.seedOriginal;
        if (
          s.status !== 'staging' ||
          s.next !== s.asset.size ||
          s.next !== asset.size ||
          sha !== s.asset.sha256 ||
          asset.sha256 !== s.asset.sha256 ||
          asset.assetId !== s.asset.assetId
        )
          fail('SHARED_SEED_ORIGINAL_HASH_MISMATCH');
        s.status = 'complete';
        await tx.putEntity(row);
      });
      hashes.delete(token);
      return 'shared-seed-idb:' + token;
    },
    async abort(token) {
      hashes.delete(token);
      await transaction(async (tx) => {
        const row = await tx.getEntity(STAGE, token);
        if (!row?.seedOriginal) return;
        const s = row.seedOriginal;
        if (s.libraryId !== libraryId || s.epoch !== epoch) fail('SHARED_IDENTITY_MISMATCH');
        for (let offset = 0; offset < s.next; offset += CHUNK)
          await tx.putEntity({
            entityType: PART,
            entityId: partId(token, offset),
            base: null,
            local: null,
            seedChunk: null,
          });
        s.status = 'aborted';
        s.next = 0;
        await tx.putEntity(row);
      });
    },
  };
  async function open(handle) {
    const token = tokenOf(handle),
      record = await transaction((tx) => selected(tx, token)),
      s = record.seedOriginal;
    if (s.status !== 'complete') fail('SHARED_SEED_ORIGINAL_NOT_FOUND');
    return {
      size: s.asset.size,
      sha256: s.asset.sha256,
      async read(start, end) {
        if (
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          start < 0 ||
          end <= start ||
          end - start > CHUNK ||
          end > s.asset.size
        )
          fail('SHARED_SEED_INVALID_RANGE');
        return transaction(async (tx) => {
          const current = (await selected(tx, token)).seedOriginal;
          if (
            current.status !== 'complete' ||
            current.asset.size !== s.asset.size ||
            current.asset.sha256 !== s.asset.sha256
          )
            fail('SHARED_SEED_ORIGINAL_CHANGED');
          const result = new Uint8Array(end - start);
          let target = 0;
          for (let offset = Math.floor(start / CHUNK) * CHUNK; offset < end; offset += CHUNK) {
            const part = (await tx.getEntity(PART, partId(token, offset)))?.seedChunk;
            if (!(part?.bytes instanceof Uint8Array) || sha256Bytes(part.bytes) !== part.sha256)
              fail('SHARED_SEED_ORIGINAL_CHANGED');
            const a = Math.max(start, offset),
              b = Math.min(end, offset + part.bytes.length);
            if (b <= a) fail('SHARED_SEED_ORIGINAL_CHANGED');
            result.set(part.bytes.subarray(a - offset, b - offset), target);
            target += b - a;
          }
          if (target !== result.length) fail('SHARED_SEED_ORIGINAL_CHANGED');
          return result;
        });
      },
    };
  }
  return { stageOriginal, open };
}
