import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { sharedInfo } from './replication.mjs';
import { collectSharedSeedSnapshot, sharedSeedOwnerTransport } from './seed-package.mjs';
import { collectSharedSeedFeeds } from './seed-feeds.mjs';
import { sharedConversationFeedRevision } from './conversation-feed.mjs';
import { sharedSeedSigner } from './seed-attestation.mjs';
import { sharedSeedManifestPayloadSha256 } from '../../../public/shared/shared-seed-trust.js';
import {
  validateSharedSeedManifest,
  sharedSeedEntityBytes,
  sharedSeedEntityKey,
  SHARED_SEED_LIMITS,
} from '../../../public/shared/shared-seed.js';

const fail = (code, status = 409) => {
  throw Object.assign(Error(code), { code, status });
};
const hash = (value) => createHash('sha256').update(value).digest('hex');
/** Authority is a live authenticated complete-roster check, never the manifest's
 * self-reported UUID/cursor. No mutation, migration, key generation or body save.
 */
function seedInput(input, registration = false) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some(
      (key) => !['libraryId', 'epoch', 'manifest', 'manifestSha256'].includes(key),
    )
  )
    fail('SHARED_SEED_INVALID_RESOLVE', 400);
  const manifest = validateSharedSeedManifest(input.manifest, {
    allowUnsignedAttestation: registration,
  });
  if (
    hash(Buffer.from(sharedSeedEntityBytes(manifest))) !== input.manifestSha256 ||
    input.libraryId !== manifest.libraryId ||
    input.epoch !== manifest.epoch
  )
    fail('SHARED_SEED_INVALID_RESOLVE', 400);
  return manifest;
}
const rosterDigest = (manifest) => hash(Buffer.from(sharedSeedEntityBytes(manifest.entities)));
const feedDigest = (manifest) =>
  manifest.version === 2
    ? hash(Buffer.from(sharedSeedEntityBytes(manifest.conversationFeeds)))
    : null;
function exportsRegistry(db) {
  const rows = db._sharedSeedExports || [],
    ids = new Set();
  if (!Array.isArray(rows) || rows.length > 5000) fail('SHARED_SEED_EXPORT_SCHEMA');
  for (const row of rows) {
    if (
      !row ||
      typeof row !== 'object' ||
      typeof row.packageId !== 'string' ||
      ids.has(row.packageId) ||
      typeof row.exportId !== 'string' ||
      !/^[a-f0-9]{64}$/.test(row.manifestSha256 || '') ||
      !/^[a-f0-9]{64}$/.test(row.rosterDigest || '') ||
      !Number.isSafeInteger(row.watermark) ||
      row.watermark < 0 ||
      (row.feedRosterDigest !== undefined &&
        row.feedRosterDigest !== null &&
        !/^[a-f0-9]{64}$/.test(row.feedRosterDigest)) ||
      (row.attestation !== undefined &&
        (!/^[a-f0-9]{64}$/.test(row.manifestPayloadSha256 || '') ||
          !/^[a-f0-9]{64}$/.test(row.attestation?.keyFingerprintSha256 || '') ||
          row.attestation.exportId !== row.exportId ||
          row.attestation.manifestPayloadSha256 !== row.manifestPayloadSha256))
    )
      fail('SHARED_SEED_EXPORT_SCHEMA');
    ids.add(row.packageId);
  }
  return rows;
}
export async function readSharedSeedSigningKey({ db, dataDir }) {
  const info = sharedInfo(db);
  if (!info.enabled) return null;
  const requiredFingerprint = exportsRegistry(db).find((row) => row.attestation)?.attestation
    .keyFingerprintSha256;
  return (
    (
      await sharedSeedSigner({
        dataDir,
        libraryId: info.libraryId,
        requiredFingerprint,
        initialize: false,
      })
    )?.publicKey || null
  );
}
async function verifyCurrentSeed({
  getDb,
  dataDir,
  input,
  allowAdvance = false,
  registration = false,
}) {
  const manifest = seedInput(input, registration);
  const db = getDb(),
    info = sharedInfo(db);
  if (!info.enabled || info.libraryId !== manifest.libraryId || info.epoch !== manifest.epoch)
    fail('SHARED_LIBRARY_MISMATCH');
  if (info.seq !== manifest.watermark) fail('SHARED_SEED_CATCHUP_REQUIRED');
  const current = await collectSharedSeedSnapshot({ request: sharedSeedOwnerTransport(() => db) });
  if (current.entities.length !== manifest.entities.length) fail('SHARED_SEED_ROSTER_MISMATCH');
  const declared = new Map(manifest.entities.map((d) => [sharedSeedEntityKey(d), d]));
  for (const entity of current.entities) {
    // collectSharedSeedSnapshot re-computes the logical canonical fingerprint of
    // every actual server row. The canonical member hash binds its full envelope.
    const descriptor = declared.get(sharedSeedEntityKey(entity));
    const bytes = sharedSeedEntityBytes(entity);
    const member = descriptor && manifest.members.find((row) => row.path === descriptor.path);
    if (
      !descriptor ||
      descriptor.revision !== entity.revision ||
      descriptor.seq !== entity.seq ||
      descriptor.sha256 !== entity.sha256 ||
      descriptor.path !== `entities/${hash(bytes)}.json` ||
      !member ||
      member.size !== bytes.byteLength ||
      member.sha256 !== hash(bytes)
    )
      fail('SHARED_SEED_ROSTER_MISMATCH');
  }
  if (manifest.version === 2) {
    const feeds = await collectSharedSeedFeeds({
      request: sharedSeedOwnerTransport(() => db),
      conversations: current.entities
        .filter((row) => row.entityType === 'conversation' && row.state === 'active')
        .map((row) => row.entityId),
      info: current.info,
    });
    if (
      hash(Buffer.from(sharedSeedEntityBytes(feeds.map((value) => value.descriptor)))) !==
      feedDigest(manifest)
    )
      fail('SHARED_SEED_FEED_ROSTER_MISMATCH');
  }
  const media = current.entities.filter(
    (row) => row.entityType === 'media' && row.state === 'active',
  );
  if (media.length !== manifest.assets.length) fail('SHARED_SEED_MEDIA_BINDING_MISMATCH');
  if (media.length && !path.isAbsolute(dataDir || '')) fail('SHARED_SEED_ORIGINALS_UNAVAILABLE');
  for (const asset of manifest.assets) {
    const entity = media.find((row) => row.entityId === asset.assetId);
    if (
      !entity ||
      entity.data.size !== asset.size ||
      (entity.data.sha256 && entity.data.sha256 !== asset.sha256)
    )
      fail('SHARED_SEED_MEDIA_BINDING_MISMATCH');
    const h = createHash('sha256');
    let size = 0;
    try {
      for await (const bytes of createReadStream(path.join(dataDir, 'media', asset.assetId), {
        highWaterMark: SHARED_SEED_LIMITS.chunk,
      })) {
        size += bytes.length;
        if (size > asset.size) fail('SHARED_SEED_ORIGINAL_CHANGED');
        h.update(bytes);
      }
    } catch (error) {
      if (error.code === 'ENOENT') fail('SHARED_SEED_ORIGINAL_MISSING');
      throw error;
    }
    if (size !== asset.size || h.digest('hex') !== asset.sha256)
      fail('SHARED_SEED_ORIGINAL_CHANGED');
  }
  const latest = sharedInfo(getDb());
  if (
    latest.libraryId !== info.libraryId ||
    latest.epoch !== info.epoch ||
    (!allowAdvance && latest.seq !== info.seq)
  )
    fail('SHARED_SEED_CATCHUP_REQUIRED');
  return {
    resolved: true,
    manifestSha256: input.manifestSha256,
    watermark: info.seq,
    info: latest,
  };
}

/** A trusted export is registered while its exact immutable server generation is
 * current. Verification may stream originals while ordinary COW writes continue.
 * Durable metadata contains hashes/identities only, never body/credential copies.
 */
export async function registerSharedSeed({ store, dataDir, input } = {}) {
  const manifest = seedInput(input, true),
    digest = rosterDigest(manifest);
  const wantsSignature = manifest.requiredFeatures?.includes('seed-attestation-ed25519-v1');
  const payloadSha256 = wantsSignature ? sharedSeedManifestPayloadSha256(manifest) : null;
  const result = (row, info, replayed) => ({
    registered: true,
    exportId: row.exportId,
    manifestSha256: row.manifestSha256,
    watermark: row.watermark,
    info,
    replayed,
    ...(row.attestation
      ? { attestation: row.attestation, manifestPayloadSha256: row.manifestPayloadSha256 }
      : {}),
  });
  const matches = (row) =>
    row.attestation
      ? wantsSignature &&
        row.manifestPayloadSha256 === payloadSha256 &&
        (!manifest.attestation ||
          (input.manifestSha256 === row.manifestSha256 &&
            hash(sharedSeedEntityBytes(manifest.attestation)) ===
              hash(sharedSeedEntityBytes(row.attestation))))
      : !wantsSignature && row.manifestSha256 === input.manifestSha256;
  const known = exportsRegistry(store.getDb()).find((row) => row.packageId === manifest.packageId);
  if (known) {
    if (
      !matches(known) ||
      known.rosterDigest !== digest ||
      (known.feedRosterDigest || null) !== feedDigest(manifest) ||
      known.libraryId !== manifest.libraryId ||
      known.epoch !== manifest.epoch
    )
      fail('SHARED_SEED_EXPORT_REUSED');
    if (known.attestation)
      await sharedSeedSigner({
        dataDir,
        libraryId: manifest.libraryId,
        requiredFingerprint: known.attestation.keyFingerprintSha256,
      });
    return result(known, sharedInfo(store.getDb()), true);
  }
  if (manifest.attestation) fail('SHARED_SEED_CALLER_ATTESTATION_FORBIDDEN', 400);
  await verifyCurrentSeed({
    getDb: store.getDb,
    dataDir,
    input,
    allowAdvance: true,
    registration: true,
  });
  const previousKey = exportsRegistry(store.getDb()).find((row) => row.attestation)?.attestation
    .keyFingerprintSha256;
  const signer = wantsSignature
    ? await sharedSeedSigner({
        dataDir,
        libraryId: manifest.libraryId,
        requiredFingerprint: previousKey,
      })
    : null;
  return store.mutate((db) => {
    const info = sharedInfo(db);
    if (info.libraryId !== manifest.libraryId || info.epoch !== manifest.epoch)
      fail('SHARED_LIBRARY_MISMATCH');
    const registry = exportsRegistry(db);
    const old = registry.find((row) => row.packageId === manifest.packageId);
    if (old) {
      if (!matches(old) || old.rosterDigest !== digest) fail('SHARED_SEED_EXPORT_REUSED');
      return result(old, info, true);
    }
    if (registry.length >= 5000) fail('SHARED_SEED_EXPORT_CAPACITY');
    const value = {
      exportId: randomUUID(),
      packageId: manifest.packageId,
      manifestSha256: input.manifestSha256,
      libraryId: manifest.libraryId,
      epoch: manifest.epoch,
      watermark: manifest.watermark,
      rosterDigest: digest,
      ...(manifest.version === 2
        ? {
            feedRosterDigest: feedDigest(manifest),
            feedRevision: manifest.conversationFeeds[0]?.feedRevision || null,
          }
        : {}),
    };
    if (signer) {
      const signed = signer.attest(manifest, {
        exportId: value.exportId,
        issuedAt: new Date().toISOString(),
      });
      Object.assign(value, signed, { manifestPayloadSha256: payloadSha256 });
    }
    db._sharedSeedExports = [...registry, value];
    return result(value, info, false);
  });
}

export async function resolveSharedSeed({ getDb, dataDir, input } = {}) {
  const manifest = seedInput(input),
    info = sharedInfo(getDb());
  if (!info.enabled || info.libraryId !== manifest.libraryId || info.epoch !== manifest.epoch)
    fail('SHARED_LIBRARY_MISMATCH');
  const known = exportsRegistry(getDb()).find((row) => row.packageId === manifest.packageId);
  if (known) {
    if (
      known.manifestSha256 !== input.manifestSha256 ||
      known.rosterDigest !== rosterDigest(manifest) ||
      (known.feedRosterDigest || null) !== feedDigest(manifest) ||
      known.libraryId !== manifest.libraryId ||
      known.epoch !== manifest.epoch ||
      known.watermark !== manifest.watermark ||
      known.watermark > info.seq
    )
      fail('SHARED_SEED_EXPORT_MISMATCH');
    if (known.attestation) {
      if (
        !manifest.attestation ||
        known.manifestPayloadSha256 !== sharedSeedManifestPayloadSha256(manifest) ||
        hash(sharedSeedEntityBytes(known.attestation)) !==
          hash(sharedSeedEntityBytes(manifest.attestation))
      )
        fail('SHARED_SEED_EXPORT_MISMATCH');
      await sharedSeedSigner({
        dataDir,
        libraryId: manifest.libraryId,
        requiredFingerprint: known.attestation.keyFingerprintSha256,
      });
    }
    return {
      resolved: true,
      registered: true,
      exportId: known.exportId,
      manifestSha256: known.manifestSha256,
      watermark: known.watermark,
      catchupRequired: info.seq !== known.watermark,
      feedRefreshRequired: manifest.version === 2,
      feedChanged:
        manifest.version === 2 &&
        known.feedRevision !== null &&
        known.feedRevision !== sharedConversationFeedRevision(getDb()),
      snapshotRequired: known.watermark < info.earliestSeq,
      ...(known.attestation
        ? { keyFingerprintSha256: known.attestation.keyFingerprintSha256 }
        : {}),
      info,
    };
  }
  if (manifest.attestation) fail('SHARED_SEED_EXPORT_UNREGISTERED');
  return verifyCurrentSeed({ getDb, dataDir, input });
}
