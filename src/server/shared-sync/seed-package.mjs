import { createHash, randomUUID, createPublicKey, verify } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, open, link, unlink, rm } from 'node:fs/promises';
import path from 'node:path';
import {
  SHARED_SEED_MAGIC,
  SHARED_SEED_FORMAT,
  SHARED_SEED_LIMITS as LIMIT,
  validateSharedSeedEntity,
  validateSharedSeedManifest,
  prepareSharedSeed,
  sharedSeedEntityKey,
  sharedSeedEntityBytes,
  validateSharedSeedReferences,
} from '../../../public/shared/shared-seed.js';
import { sharedInfo, sharedSnapshot, sharedPull, sharedEntityRead } from './replication.mjs';
import { unwrapSharedSeedZip } from './seed-zip.mjs';
import { collectSharedSeedFeeds } from './seed-feeds.mjs';
import { readSharedConversationFeed, readSharedFeedItem } from './conversation-feed.mjs';
import { sharedSeedAttestationBytes } from '../../../public/shared/shared-seed-trust.js';

const fail = (code) => {
  throw Object.assign(Error(code), { code, status: 422 });
};
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (bytes) => {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    fail('SHARED_SEED_INVALID_JSON');
  }
};
async function writeAll(handle, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset);
    if (!bytesWritten) fail('SHARED_SEED_WRITE_FAILED');
    offset += bytesWritten;
  }
}
async function exact(handle, size, position) {
  const bytes = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const { bytesRead } = await handle.read(bytes, offset, size - offset, position + offset);
    if (!bytesRead) fail('SHARED_SEED_TRUNCATED');
    offset += bytesRead;
  }
  return bytes;
}
async function privateTask(directory) {
  if (!path.isAbsolute(directory || '')) fail('SHARED_SEED_PRIVATE_DIRECTORY_REQUIRED');
  const root = path.resolve(directory);
  await mkdir(root, { recursive: true });
  const selected = await mkdtemp(path.join(root, 'shared-seed-'));
  return {
    directory: selected,
    async cleanup() {
      if (
        path.dirname(path.resolve(selected)) !== root ||
        !path.basename(selected).startsWith('shared-seed-')
      )
        fail('SHARED_SEED_CLEANUP_BOUNDARY');
      await rm(selected, { recursive: true, force: true });
    },
  };
}
function identity(info, expected) {
  if (
    !info?.enabled ||
    info.version !== 1 ||
    !info.libraryId ||
    !info.epoch ||
    !Number.isSafeInteger(info.seq) ||
    info.seq < 0 ||
    (expected && (info.libraryId !== expected.libraryId || info.epoch !== expected.epoch))
  )
    fail('SHARED_SEED_SOURCE_IDENTITY');
  return info;
}
/** Fixed transport, already authenticated by its caller. Captures the FIRST
 * snapshot watermark, then drains pull from it; entity.seq never advances cursor.
 */
export async function collectSharedSeedSnapshot({ request, limit = 100, signal } = {}) {
  if (typeof request !== 'function') fail('SHARED_SEED_SOURCE_REQUIRED');
  const info = identity(await request('info', {})),
    rows = new Map();
  let snapshotWatermark,
    afterKey,
    after,
    pages = 0,
    jsonBytes = 0;
  const active = () => {
    if (signal?.aborted) fail('SHARED_SEED_CANCELLED');
    if (++pages > 10000) fail('SHARED_SEED_PAGE_LIMIT');
  };
  async function hydrate(raw) {
    if (!raw.payload) {
      const { changeSeq: _changeSeq, ...value } = raw;
      return validateSharedSeedEntity(value);
    }
    const p = raw.payload;
    if (
      p.kind !== 'shared-entity-json' ||
      p.version !== 1 ||
      !Number.isSafeInteger(p.byteLength) ||
      p.byteLength < 1 ||
      p.byteLength > LIMIT.entity ||
      !/^[a-f0-9]{64}$/.test(p.sha256 || '') ||
      !['entityType', 'entityId', 'revision', 'seq'].every((k) => p[k] === raw[k])
    )
      fail('SHARED_SEED_INVALID_ENTITY_PAYLOAD');
    const bytes = Buffer.alloc(p.byteLength);
    for (let offset = 0; offset < bytes.length;) {
      if (signal?.aborted) fail('SHARED_SEED_CANCELLED');
      const r = await request('entity-read', {
        libraryId: info.libraryId,
        epoch: info.epoch,
        entityType: p.entityType,
        entityId: p.entityId,
        revision: p.revision,
        offset,
        length: Math.min(LIMIT.chunk, bytes.length - offset),
      });
      identity(r.info, info);
      if (
        JSON.stringify(r.payload) !== JSON.stringify(p) ||
        r.offset !== offset ||
        typeof r.bytesBase64 !== 'string' ||
        r.bytesBase64.length > 350000 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(r.bytesBase64)
      )
        fail('SHARED_SEED_ENTITY_CHANGED');
      const chunk = Buffer.from(r.bytesBase64, 'base64');
      if (
        !chunk.length ||
        chunk.length > LIMIT.chunk ||
        offset + chunk.length > bytes.length ||
        r.next !== offset + chunk.length ||
        r.done !== (r.next === bytes.length) ||
        digest(chunk) !== r.chunkSha256
      )
        fail('SHARED_SEED_ENTITY_CHANGED');
      bytes.set(chunk, offset);
      offset = r.next;
    }
    if (digest(bytes) !== p.sha256) fail('SHARED_SEED_ENTITY_CHANGED');
    const row = validateSharedSeedEntity(json(bytes));
    if (
      !['entityType', 'entityId', 'revision', 'seq', 'state', 'sha256'].every(
        (k) => row[k] === raw[k],
      )
    )
      fail('SHARED_SEED_ENTITY_CHANGED');
    return row;
  }
  async function add(values) {
    if (!Array.isArray(values)) fail('SHARED_SEED_INVALID_PAGE');
    for (const value of values) {
      const row = await hydrate(value),
        key = sharedSeedEntityKey(row),
        old = rows.get(key);
      if (old && old.revision === row.revision && JSON.stringify(old) !== JSON.stringify(row))
        fail('SHARED_SEED_REVISION_CONFLICT');
      if (!old || row.revision > old.revision) {
        jsonBytes +=
          Buffer.byteLength(JSON.stringify(row)) -
          (old ? Buffer.byteLength(JSON.stringify(old)) : 0);
        if (jsonBytes > LIMIT.entityTotal || (!old && rows.size >= 100000))
          fail('SHARED_SEED_LIMIT_EXCEEDED');
        rows.set(key, row);
      }
    }
  }
  do {
    active();
    const page = await request('snapshot', {
      libraryId: info.libraryId,
      epoch: info.epoch,
      ...(afterKey === undefined ? {} : { afterKey }),
      limit,
    });
    identity(page.info, info);
    if (snapshotWatermark === undefined) snapshotWatermark = page.watermark;
    if (
      !Number.isSafeInteger(snapshotWatermark) ||
      snapshotWatermark < 0 ||
      typeof page.hasMore !== 'boolean' ||
      (page.next !== null && typeof page.next !== 'string') ||
      (page.hasMore && page.next === afterKey)
    )
      fail('SHARED_SEED_INVALID_PAGE');
    await add(page.entities);
    afterKey = page.next;
    if (!page.hasMore) break;
  } while (pages <= 10000);
  after = snapshotWatermark;
  do {
    active();
    const page = await request('pull', {
      libraryId: info.libraryId,
      epoch: info.epoch,
      after,
      limit,
    });
    identity(page.info, info);
    if (
      !Number.isSafeInteger(page.next) ||
      page.next < after ||
      typeof page.hasMore !== 'boolean' ||
      (page.hasMore && page.next === after)
    )
      fail('SHARED_SEED_INVALID_PAGE');
    await add(page.changes);
    after = page.next;
    if (!page.hasMore) break;
  } while (pages <= 10000);
  if ([...rows.values()].some((r) => r.seq > after)) fail('SHARED_SEED_UNSTABLE_CHECKPOINT');
  return {
    info: { ...info, seq: after },
    snapshotWatermark,
    watermark: after,
    entities: [...rows.values()].sort((a, b) =>
      sharedSeedEntityKey(a).localeCompare(sharedSeedEntityKey(b)),
    ),
  };
}

/** Pins the existing owner's immutable COW generation; never initializes a copy
 * or asks prepareSharedCommit to invent an identity. No server is started here.
 */
export function sharedSeedOwnerTransport(getDb) {
  if (typeof getDb !== 'function') fail('SHARED_SEED_SOURCE_REQUIRED');
  const db = getDb(),
    info = identity(sharedInfo(db));
  return async (action, input) => {
    if (action === 'info') return info;
    if (input.libraryId !== info.libraryId || input.epoch !== info.epoch)
      fail('SHARED_SEED_SOURCE_IDENTITY');
    if (action === 'snapshot') {
      const page = sharedSnapshot(db, input);
      return {
        info: sharedInfo(db),
        entities: page.entities,
        next: page.afterKey,
        hasMore: page.hasMore,
        watermark: page.watermark,
      };
    }
    if (action === 'pull') {
      const page = sharedPull(db, input);
      return {
        info: sharedInfo(db),
        changes: page.changes,
        next: page.after,
        hasMore: page.hasMore,
        watermark: page.watermark,
      };
    }
    if (action === 'entity-read') return { ...sharedEntityRead(db, input), info: sharedInfo(db) };
    if (action === 'command' && input.action === 'conversation-feed')
      return {
        info: sharedInfo(db),
        operationId: input.operationId,
        result: readSharedConversationFeed(db, input.input),
        readOnly: true,
      };
    if (action === 'feed-item-read')
      return { ...readSharedFeedItem(db, input), info: sharedInfo(db) };
    fail('SHARED_SEED_SOURCE_ACTION');
  };
}

/** openOriginal(assetId, mediaEnvelope) returns an async iterable of byte chunks
 * (or {stream}). Streamed originals are staged and re-hashed during publication.
 */
export async function exportSharedSeed({
  file,
  directory,
  request,
  getDb,
  openOriginal,
  register,
  signal,
  clock = Date.now,
  coreOnly = false,
} = {}) {
  if (!path.isAbsolute(file || '') || (request && getDb) || (!request && !getDb))
    fail('SHARED_SEED_EXPLICIT_SOURCE_REQUIRED');
  const task = await privateTask(directory),
    sources = [],
    members = [],
    entities = [],
    assets = [];
  const partial = file + '.' + randomUUID() + '.partial';
  let published = false;
  try {
    const stagedOriginals = new Map();
    const registrar = register || (request ? (input) => request('seed-register', input) : null);
    let manifest,
      registration,
      stagedBytes = 0;
    const capture = () =>
      collectSharedSeedSnapshot({ request: request || sharedSeedOwnerTransport(getDb), signal });
    for (let attempt = 0; attempt < 4; attempt++) {
      let snapshot = await capture();
      for (const row of snapshot.entities.filter(
        (r) => r.entityType === 'media' && r.state === 'active',
      )) {
        const old = stagedOriginals.get(row.entityId);
        if (old) {
          if (old.size !== row.data.size || (row.data.sha256 && old.sha256 !== row.data.sha256))
            fail('SHARED_SEED_ORIGINAL_CHANGED');
          continue;
        }
        if (typeof openOriginal !== 'function') fail('SHARED_SEED_ORIGINAL_PORT_REQUIRED');
        if (
          !Number.isSafeInteger(row.data.size) ||
          row.data.size < 1 ||
          row.data.size > LIMIT.original
        )
          fail('SHARED_SEED_INVALID_ORIGINAL');
        const opened = await openOriginal(row.entityId, structuredClone(row)),
          stream = opened?.stream || opened;
        if (!stream?.[Symbol.asyncIterator] && !stream?.[Symbol.iterator])
          fail('SHARED_SEED_ORIGINAL_PORT_REQUIRED');
        const source = path.join(task.directory, 'original-' + randomUUID()),
          handle = await open(source, 'wx'),
          h = createHash('sha256');
        let size = 0;
        try {
          for await (const raw of stream) {
            if (signal?.aborted) fail('SHARED_SEED_CANCELLED');
            if (!(raw instanceof Uint8Array) || raw.byteLength > LIMIT.chunk)
              fail('SHARED_SEED_ORIGINAL_CHUNK_TOO_LARGE');
            const bytes = Buffer.from(raw);
            size += bytes.length;
            stagedBytes += bytes.length;
            if (size > row.data.size || size > LIMIT.original || stagedBytes > LIMIT.total)
              fail('SHARED_SEED_ORIGINAL_CHANGED');
            h.update(bytes);
            await writeAll(handle, bytes);
          }
          await handle.sync();
        } finally {
          await handle.close();
        }
        const sha256 = h.digest('hex');
        if (size !== row.data.size || (row.data.sha256 && sha256 !== row.data.sha256))
          fail('SHARED_SEED_ORIGINAL_CHANGED');
        stagedOriginals.set(row.entityId, { source, sha256, size });
      }
      // Refresh metadata after slow original copying. Ordinary writes during the
      // copy are included without copying the same immutable original again.
      snapshot = await capture();
      if (
        snapshot.entities.some(
          (r) =>
            r.entityType === 'media' && r.state === 'active' && !stagedOriginals.has(r.entityId),
        )
      )
        continue;
      let collectedFeeds = [];
      if (!coreOnly) {
        try {
          collectedFeeds = await collectSharedSeedFeeds({
            request: request || sharedSeedOwnerTransport(getDb),
            conversations: snapshot.entities
              .filter((row) => row.entityType === 'conversation' && row.state === 'active')
              .map((row) => row.entityId),
            info: snapshot.info,
            signal,
          });
        } catch (error) {
          if (
            [
              'SHARED_SEED_CATCHUP_REQUIRED',
              'SHARED_FEED_CHANGED',
              'SHARED_SEED_FEED_CHANGED',
            ].includes(error.code) &&
            attempt < 3
          )
            continue;
          throw error;
        }
      }
      sources.length = members.length = entities.length = assets.length = 0;
      let entityBytes = 0;
      for (const row of snapshot.entities) {
        const bytes = Buffer.from(sharedSeedEntityBytes(row));
        if (bytes.length > LIMIT.entity) fail('SHARED_SEED_ENTITY_TOO_LARGE');
        const sha256 = digest(bytes),
          member = { path: `entities/${sha256}.json`, size: bytes.length, sha256 };
        const source = path.join(task.directory, randomUUID() + '.json'),
          handle = await open(source, 'wx');
        try {
          await writeAll(handle, bytes);
          await handle.sync();
        } finally {
          await handle.close();
        }
        sources.push(source);
        members.push(member);
        entityBytes += bytes.length;
        entities.push({
          entityType: row.entityType,
          entityId: row.entityId,
          revision: row.revision,
          seq: row.seq,
          sha256: row.sha256,
          path: member.path,
        });
      }
      const seen = new Set();
      for (const row of snapshot.entities.filter(
        (r) => r.entityType === 'media' && r.state === 'active',
      )) {
        const original = stagedOriginals.get(row.entityId);
        if (
          original.size !== row.data.size ||
          (row.data.sha256 && original.sha256 !== row.data.sha256)
        )
          fail('SHARED_SEED_ORIGINAL_CHANGED');
        const memberPath = `media/${original.sha256}`;
        assets.push({
          assetId: row.entityId,
          sha256: original.sha256,
          size: original.size,
          mime: row.data.type || row.data.mime || 'application/octet-stream',
          name: row.data.name || row.entityId,
          path: memberPath,
        });
        if (!seen.has(original.sha256)) {
          seen.add(original.sha256);
          sources.push(original.source);
          members.push({ path: memberPath, sha256: original.sha256, size: original.size });
        }
      }
      for (const feed of collectedFeeds)
        for (const part of feed.parts) {
          const { bytes, ...member } = part;
          const source = path.join(task.directory, randomUUID() + '.json'),
            handle = await open(source, 'wx');
          try {
            await writeAll(handle, bytes);
            await handle.sync();
          } finally {
            await handle.close();
          }
          sources.push(source);
          members.push({ path: member.path, size: member.size, sha256: member.sha256 });
          entityBytes += bytes.length;
        }
      validateSharedSeedReferences(
        snapshot.entities,
        assets,
        collectedFeeds.map((value) => value.feed),
      );
      manifest = validateSharedSeedManifest(
        {
          format: SHARED_SEED_FORMAT,
          version: coreOnly ? 1 : 2,
          mode: 'shared-bootstrap',
          packageId: randomUUID(),
          libraryId: snapshot.info.libraryId,
          epoch: snapshot.info.epoch,
          snapshotWatermark: snapshot.snapshotWatermark,
          watermark: snapshot.watermark,
          cursor: {
            libraryId: snapshot.info.libraryId,
            epoch: snapshot.info.epoch,
            after: snapshot.watermark,
          },
          complete: true,
          createdAt: new Date(clock()).toISOString(),
          entities,
          assets,
          members,
          bytes: members.reduce((n, x) => n + x.size, 0),
          entityBytes,
          entityCount: entities.length,
          assetCount: assets.length,
          containsCredentials: false,
          containsSourceArchives: false,
          ...(coreOnly
            ? {}
            : {
                requiredFeatures: registrar
                  ? ['conversation-feeds-v1', 'seed-attestation-ed25519-v1']
                  : ['conversation-feeds-v1'],
                conversationFeeds: collectedFeeds.map((value) => value.descriptor),
              }),
        },
        { allowUnsignedAttestation: true },
      );
      if (registrar) {
        try {
          registration = await registrar({
            libraryId: manifest.libraryId,
            epoch: manifest.epoch,
            manifest,
            manifestSha256: digest(sharedSeedEntityBytes(manifest)),
          });
          if (!coreOnly && registrar) {
            if (!registration?.attestation) fail('SHARED_SEED_REGISTRATION_REQUIRED');
            manifest = validateSharedSeedManifest({
              ...manifest,
              attestation: registration.attestation,
            });
            const a = manifest.attestation;
            const publicBytes = Buffer.from(a.publicKeyRawBase64, 'base64');
            const key = createPublicKey({
              key: { kty: 'OKP', crv: 'Ed25519', x: publicBytes.toString('base64url') },
              format: 'jwk',
            });
            if (
              digest(publicBytes) !== a.keyFingerprintSha256 ||
              !verify(
                null,
                sharedSeedAttestationBytes(manifest, a),
                key,
                Buffer.from(a.signatureBase64, 'base64'),
              )
            )
              fail('SHARED_SEED_INVALID_ATTESTATION');
          }
          if (
            !registration?.registered ||
            registration.manifestSha256 !== digest(sharedSeedEntityBytes(manifest)) ||
            registration.watermark !== manifest.watermark ||
            registration.info?.libraryId !== manifest.libraryId ||
            registration.info?.epoch !== manifest.epoch
          )
            fail('SHARED_SEED_REGISTRATION_REQUIRED');
        } catch (error) {
          if (
            ['SHARED_SEED_CATCHUP_REQUIRED', 'SHARED_SEED_FEED_ROSTER_MISMATCH'].includes(
              error.code || error.message,
            ) &&
            attempt < 3
          ) {
            manifest = null;
            continue;
          }
          throw error;
        }
      }
      break;
    }
    if (!manifest) fail('SHARED_SEED_EXPORT_UNSTABLE');
    const manifestBytes = Buffer.from(sharedSeedEntityBytes(manifest)),
      sizeBytes = Buffer.alloc(4);
    sizeBytes.writeUInt32BE(manifestBytes.length);
    const output = await open(partial, 'wx'),
      h = createHash('sha256');
    let size = 0;
    const put = async (bytes) => {
      h.update(bytes);
      size += bytes.length;
      await writeAll(output, bytes);
    };
    try {
      await put(Buffer.from(SHARED_SEED_MAGIC));
      await put(sizeBytes);
      await put(manifestBytes);
      for (let i = 0; i < sources.length; i++) {
        const check = createHash('sha256');
        let count = 0;
        for await (const bytes of createReadStream(sources[i], { highWaterMark: LIMIT.chunk })) {
          count += bytes.length;
          if (count > members[i].size) fail('SHARED_SEED_SOURCE_CHANGED');
          check.update(bytes);
          await put(bytes);
        }
        if (count !== members[i].size || check.digest('hex') !== members[i].sha256)
          fail('SHARED_SEED_SOURCE_CHANGED');
      }
      await output.sync();
    } finally {
      await output.close();
    }
    await link(partial, file);
    published = true;
    await unlink(partial);
    return {
      manifest,
      registration,
      manifestSha256: digest(manifestBytes),
      sha256: h.digest('hex'),
      size,
      file,
    };
  } finally {
    if (!published) await unlink(partial).catch(() => {});
    await task.cleanup();
  }
}

/** Raw framing or a strict data.syseed ZIP wrapper. Archive/member names never
 * become arbitrary filesystem destinations.
 */
export async function readSharedSeed({
  file,
  directory,
  expectedSha256,
  stageOriginal,
  signal,
} = {}) {
  if (!path.isAbsolute(file || '')) fail('SHARED_SEED_EXPLICIT_FILE_REQUIRED');
  const task = await privateTask(directory);
  let closed = false;
  let source;
  try {
    source = await open(file, 'r');
    const magic = Buffer.from(SHARED_SEED_MAGIC),
      prefix = await exact(source, Math.min(4, magic.length), 0);
    if (prefix.readUInt32LE() === 0x04034b50 || prefix.readUInt32LE() === 0x06054b50) {
      await source.close();
      closed = true;
      await task.cleanup();
      const zip = await unwrapSharedSeedZip({ file, directory, expectedSha256, signal });
      try {
        const raw = await readSharedSeed({ file: zip.file, directory, stageOriginal, signal });
        return {
          ...raw,
          container: 'zip',
          seedSha256: raw.sha256,
          sha256: zip.sha256,
          size: zip.size,
        };
      } finally {
        await zip.cleanup();
      }
    }
    if (!(await exact(source, magic.length, 0)).equals(magic)) fail('SHARED_SEED_MAGIC_MISMATCH');
    const length = (await exact(source, 4, magic.length)).readUInt32BE();
    if (length < 2 || length > LIMIT.manifest) fail('SHARED_SEED_MANIFEST_TOO_LARGE');
    const manifest = validateSharedSeedManifest(
      json(await exact(source, length, magic.length + 4)),
    );
    const start = magic.length + 4 + length,
      size = (await source.stat()).size;
    if (size !== start + manifest.bytes) fail('SHARED_SEED_LENGTH_MISMATCH');
    const packageHash = createHash('sha256');
    for await (const bytes of createReadStream(file, { highWaterMark: LIMIT.chunk })) {
      if (signal?.aborted) fail('SHARED_SEED_CANCELLED');
      packageHash.update(bytes);
    }
    const sha256 = packageHash.digest('hex');
    if (expectedSha256 && sha256 !== expectedSha256) fail('SHARED_SEED_PACKAGE_HASH_MISMATCH');
    const positions = new Map();
    let offset = start;
    for (const member of manifest.members) {
      positions.set(member.path, { position: offset, size: member.size });
      offset += member.size;
    }
    const tokenFiles = new Map();
    const sink = stageOriginal || {
      async begin() {
        const token = randomUUID(),
          file = path.join(task.directory, token);
        tokenFiles.set(token, file);
        const out = await open(file, 'wx');
        await out.close();
        return token;
      },
      async write(token, position, bytes) {
        const handle = await open(tokenFiles.get(token), 'r+');
        try {
          let n = 0;
          while (n < bytes.length) {
            const result = await handle.write(bytes, n, bytes.length - n, position + n);
            if (!result.bytesWritten) fail('SHARED_SEED_WRITE_FAILED');
            n += result.bytesWritten;
          }
        } finally {
          await handle.close();
        }
      },
      async finish(token) {
        const handle = await open(tokenFiles.get(token), 'r+');
        try {
          await handle.sync();
        } finally {
          await handle.close();
        }
        const opaque = `${path.basename(task.directory)}:${token}`;
        tokenFiles.set(opaque, tokenFiles.get(token));
        return opaque;
      },
      async abort(token) {
        const file = tokenFiles.get(token);
        if (file) await unlink(file).catch(() => {});
        tokenFiles.delete(token);
      },
    };
    const prepared = await prepareSharedSeed({
      manifest,
      signal,
      stageOriginal: sink,
      readMember: async (name, position, length) => {
        if (closed) fail('SHARED_SEED_READER_CLOSED');
        const member = positions.get(name);
        if (
          !member ||
          !Number.isSafeInteger(position) ||
          !Number.isSafeInteger(length) ||
          position < 0 ||
          length < 1 ||
          length > LIMIT.chunk ||
          position + length > member.size
        )
          fail('SHARED_SEED_INVALID_RANGE');
        return exact(source, length, member.position + position);
      },
    });
    await source.close();
    closed = true;
    return {
      prepared,
      manifest,
      sha256,
      size,
      async openOriginal(handle) {
        const file = tokenFiles.get(handle);
        if (!file || closed === 'disposed') fail('SHARED_SEED_ORIGINAL_NOT_FOUND');
        return createReadStream(file, { highWaterMark: LIMIT.chunk });
      },
      async dispose() {
        const result = await prepared.discard();
        closed = 'disposed';
        if (!result.retained) await task.cleanup();
      },
    };
  } catch (error) {
    if (!closed && source) await source.close();
    await task.cleanup();
    throw error;
  }
}

/** Resolves only this reader's opaque private stage names under an explicitly
 * supplied root. It never accepts a package member name or arbitrary file path. */
export function openSharedSeedOriginal({ directory, handle } = {}) {
  if (
    !path.isAbsolute(directory || '') ||
    typeof handle !== 'string' ||
    !/^shared-seed-[A-Za-z0-9]{6}:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(handle)
  )
    fail('SHARED_SEED_INVALID_ORIGINAL_HANDLE');
  const [task, token] = handle.split(':');
  return createReadStream(path.join(path.resolve(directory), task, token), {
    highWaterMark: LIMIT.chunk,
  });
}
