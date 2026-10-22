import { assertPreparedSharedSeed, consumePreparedSharedSeed } from './shared-seed.js';
import { catchupSharedSeed } from './shared-seed-catchup.js';
import { refreshSharedSeedFeeds } from './shared-seed-feeds.js';
import { applySharedInbox, prepareSharedInbox, reserveSharedInbox } from './shared-inbox.js';
import { assertSharedSeedTrust, verifySharedSeedAttestation } from './shared-seed-trust.js';

const clone = (value) => structuredClone(value);
const fail = (code) => {
  throw Object.assign(Error(code), { code });
};
const uuid = (value) =>
  typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const own = (value, name) => (Object.hasOwn(value, name) ? value[name] : undefined);
const assign = (value, name, data) =>
  Object.defineProperty(value, name, {
    value: data,
    enumerable: true,
    configurable: true,
    writable: true,
  });
const seedEntityId = (packageId, row) => JSON.stringify([packageId, row.entityType, row.entityId]);

/** Internal client extension. It receives the SAME accept/rebuild, transaction
 * and identity functions as live receive; no second writable business owner.
 */
export function createSharedSeedImporter({
  storage,
  metadata,
  accept,
  changed,
  request,
  identity,
  libraryId,
  epoch,
  receive,
  hydrate,
  hydrateFeed,
  verifyRemote,
  sanitizeStaging,
  filterBatch,
}) {
  async function seedPackage(tx, packageId) {
    if (!uuid(packageId)) fail('SHARED_SEED_INVALID_PACKAGE');
    const record = await tx.getEntity('local-seed-package', packageId);
    if (!record?.seed) fail('SHARED_SEED_PACKAGE_NOT_FOUND');
    return record;
  }
  async function resolveSeed(packageId) {
    const staged = await storage.transaction(async (tx) => {
      await metadata(tx);
      return seedPackage(tx, packageId);
    });
    const seed = staged.seed;
    if (seed.status === 'imported' && seed.manifest.version !== 2)
      return { packageId, status: 'imported', replayed: true };
    await verifyRemote?.();
    const proof = await request('seed-resolve', {
      libraryId,
      epoch,
      manifest: clone(seed.manifest),
      manifestSha256: seed.manifestSha256,
    });
    identity(proof.info);
    if (
      proof.resolved !== true ||
      proof.manifestSha256 !== seed.manifestSha256 ||
      proof.watermark !== seed.manifest.watermark ||
      proof.info.seq < proof.watermark ||
      (!proof.registered && proof.info.seq !== proof.watermark)
    )
      fail('SHARED_SEED_RESOLVE_REQUIRED');
    const rows = await storage.transaction(async (tx) => {
      await metadata(tx);
      const values = [];
      if (seed.localBodiesRedacted) return values;
      for (const descriptor of seed.manifest.entities) {
        const row = await tx.getEntity('local-seed-entity', seedEntityId(packageId, descriptor));
        if (!row?.seed) fail('SHARED_SEED_STAGING_CHANGED');
        values.push(row.seed);
      }
      return values;
    });
    const catchup = await catchupSharedSeed({
      rows,
      proof: seed.localBodiesRedacted ? { ...proof, snapshotRequired: true } : proof,
      request,
      identity,
      hydrate,
      libraryId,
      epoch,
    });
    const inboxes = await refreshSharedSeedFeeds({
      seed,
      entities: catchup.entities,
      after: catchup.after,
      storage,
      metadata,
      request,
      identity,
      hydrateFeed,
      libraryId,
      epoch,
    });
    const result = await storage.transaction(async (tx) => {
      const meta = await metadata(tx),
        current = await seedPackage(tx, packageId);
      if (current.seed.manifestSha256 !== seed.manifestSha256) fail('SHARED_SEED_STAGING_CHANGED');
      if (current.seed.status === 'imported' && seed.manifest.version !== 2)
        return { packageId, status: 'imported', replayed: true };
      for (const row of catchup.entities) await accept(tx, row, meta);
      for (const { ticket, batch } of inboxes) {
        await filterBatch?.(tx, meta, batch);
        await applySharedInbox(tx, meta, ticket, batch);
      }
      meta.sharedOriginals ||= {};
      for (const original of seed.originals) {
        const record = await tx.getEntity('media', original.assetId),
          base = record?.base;
        if (
          base?.state !== 'active' ||
          base.data.size !== original.size ||
          (base.data.sha256 && base.data.sha256 !== original.sha256)
        )
          continue;
        assign(meta.sharedOriginals, original.assetId, {
          ...clone(original),
          mediaRevision: base.revision,
        });
      }
      const oldAfter = meta.initialized
        ? meta.cursor && typeof meta.cursor === 'object'
          ? meta.cursor.after
          : meta.cursor
        : 0;
      if (meta.initialized && (!Number.isSafeInteger(oldAfter) || oldAfter < 0))
        fail('SHARED_INVALID_CURSOR');
      meta.initialized = true;
      meta.cursor = { libraryId, epoch, after: Math.max(oldAfter || 0, catchup.after) };
      delete meta.snapshotWatermark;
      current.seed.status = 'imported';
      meta.sharedSeedPendingSync = (meta.sharedSeedPendingSync || []).filter(
        (id) => id !== packageId,
      );
      if (meta.sharedLibraryTrust)
        meta.sharedLibraryTrust.syncStatus = meta.sharedSeedPendingSync.length
          ? 'offline-pending-sync'
          : 'synced';
      await tx.putEntity(current);
      await tx.setMeta(meta);
      return {
        packageId,
        status: 'imported',
        entities: catchup.entities.length,
        snapshotFallback: catchup.snapshotFallback,
        originals: seed.originals.length,
        cursor: clone(meta.cursor),
      };
    });
    changed();
    return result;
  }
  async function publishOffline(seed, proof, intent) {
    const verified = assertSharedSeedTrust(proof, seed.manifest),
      packageId = seed.manifest.packageId;
    const feeds = (seed.feeds || []).map((feed) => ({
      id: feed.conversationId,
      batch: prepareSharedInbox(feed.conversationId, {
        details: {
          ...(seed.entities.find(
            (row) =>
              row.entityType === 'conversation' &&
              row.entityId === feed.conversationId &&
              row.state === 'active',
          )?.data || {}),
          conversationId: feed.conversationId,
        },
        messages: feed.messages,
        redactions: feed.redactions,
      }),
    }));
    const result = await storage.transaction(async (tx) => {
      const meta = await metadata(tx),
        record = await seedPackage(tx, packageId),
        pin = meta.sharedLibraryTrust;
      if (record.seed.manifestSha256 !== verified.manifestSha256)
        fail('SHARED_SEED_STAGING_CHANGED');
      if (
        pin &&
        (pin.libraryId !== libraryId ||
          pin.epoch !== epoch ||
          pin.keyFingerprintSha256 !== verified.keyFingerprintSha256 ||
          pin.publicKeyRawBase64 !== verified.publicKeyRawBase64)
      )
        fail('SHARED_SEED_KEY_IDENTITY_MISMATCH');
      if (
        !pin &&
        (!intent ||
          intent.explicit !== true ||
          intent.keyFingerprintSha256 !== verified.keyFingerprintSha256)
      )
        fail('SHARED_SEED_EXPLICIT_TRUST_REQUIRED');
      const fresh =
        !meta.initialized &&
        meta.snapshotWatermark === undefined &&
        !Object.values(meta.inboxes || {}).some((inbox) => inbox.publishedGeneration);
      for (const row of seed.entities) await accept(tx, row, meta);
      if (fresh)
        for (const feed of feeds) {
          await filterBatch?.(tx, meta, feed.batch);
          await applySharedInbox(tx, meta, reserveSharedInbox(meta, feed.id), feed.batch);
        }
      meta.sharedOriginals ||= {};
      for (const original of record.seed.originals) {
        const media = (await tx.getEntity('media', original.assetId))?.base;
        if (
          media?.state !== 'active' ||
          media.data.size !== original.size ||
          (media.data.sha256 && media.data.sha256 !== original.sha256)
        )
          continue;
        const prior = own(meta.sharedOriginals, original.assetId);
        if (!prior || prior.sha256 !== original.sha256 || prior.size !== original.size)
          assign(meta.sharedOriginals, original.assetId, {
            ...clone(original),
            mediaRevision: media.revision,
          });
      }
      const oldAfter = meta.initialized
        ? typeof meta.cursor === 'object'
          ? meta.cursor?.after
          : meta.cursor
        : 0;
      if (!Number.isSafeInteger(oldAfter) || oldAfter < 0) fail('SHARED_INVALID_CURSOR');
      meta.initialized = true;
      meta.cursor = { libraryId, epoch, after: Math.max(oldAfter, seed.manifest.watermark) };
      delete meta.snapshotWatermark;
      meta.sharedLibraryTrust = {
        version: 1,
        libraryId,
        epoch,
        keyFingerprintSha256: verified.keyFingerprintSha256,
        publicKeyRawBase64: verified.publicKeyRawBase64,
        syncStatus: 'offline-pending-sync',
      };
      meta.sharedSeedPendingSync = [...new Set([...(meta.sharedSeedPendingSync || []), packageId])];
      record.seed.status = 'offline-pending-sync';
      await tx.putEntity(record);
      await tx.setMeta(meta);
      return {
        packageId,
        status: 'imported',
        offline: true,
        pendingSync: true,
        feedsPublished: fresh ? feeds.length : 0,
      };
    });
    changed();
    return result;
  }
  async function importSeed(prepared, { resolve = true, offlineTrust, verifiedProof } = {}) {
    const seed = assertPreparedSharedSeed(prepared),
      packageId = seed.manifest.packageId;
    if (seed.manifest.libraryId !== libraryId || seed.manifest.epoch !== epoch) {
      await prepared.discard();
      fail('SHARED_IDENTITY_MISMATCH');
    }
    let staged;
    try {
      staged = await storage.transaction(async (tx) => {
        const meta = await metadata(tx),
          old = await tx.getEntity('local-seed-package', packageId);
        if (old?.seed) {
          if (old.seed.manifestSha256 !== seed.manifestSha256) fail('SHARED_SEED_PACKAGE_REUSED');
          return { created: false, status: old.seed.status };
        }
        meta.sharedSeedImports ||= [];
        if (meta.sharedSeedImports.length >= 8) fail('SHARED_SEED_STAGING_LIMIT');
        for (const row of seed.entities)
          await tx.putEntity({
            entityType: 'local-seed-entity',
            entityId: seedEntityId(packageId, row),
            seed: row,
            base: null,
            local: null,
            localRevision: 0,
          });
        for (const feed of seed.feeds || []) {
          for (const row of feed.messages)
            await tx.putEntity({
              entityType: 'local-seed-feed-row',
              entityId: JSON.stringify([packageId, feed.conversationId, row.id]),
              message: clone(row),
              base: null,
              local: null,
            });
          for (const row of feed.redactions)
            await tx.putEntity({
              entityType: 'local-seed-feed-redaction',
              entityId: JSON.stringify([packageId, feed.conversationId, row.id]),
              redaction: clone(row),
              base: null,
              local: null,
            });
        }
        const { entities: _entities, feeds: _feeds, ...packageData } = seed;
        await tx.putEntity({
          entityType: 'local-seed-package',
          entityId: packageId,
          seed: { ...packageData, status: 'quarantined' },
          base: null,
          local: null,
          localRevision: 0,
        });
        meta.sharedSeedImports.push(packageId);
        await sanitizeStaging?.(tx, meta);
        await tx.setMeta(meta);
        return { created: true, status: 'quarantined' };
      });
    } catch (error) {
      await prepared.discard();
      throw error;
    }
    // Quarantine owns its handles too. Caller close must not erase a durable stage.
    if (staged.created) consumePreparedSharedSeed(prepared);
    else await prepared.discard();
    if (offlineTrust !== undefined || verifiedProof) {
      const proof = verifiedProof || (await verifySharedSeedAttestation(seed.manifest));
      return publishOffline(seed, proof, offlineTrust);
    }
    if (!resolve)
      return {
        packageId,
        status: staged.status,
        catchupRequired: staged.status !== 'imported',
        ...(staged.created ? {} : { replayed: true }),
      };
    try {
      return await resolveSeed(packageId);
    } catch (error) {
      return {
        packageId,
        status: 'quarantined',
        catchupRequired: true,
        errorCode: error.code || error.message || 'SHARED_SEED_RESOLVE_UNAVAILABLE',
      };
    }
  }
  async function adoptSeedOriginals(packageId) {
    await receive(); // Authenticated current redactions; never a seed cursor.
    const result = await storage.transaction(async (tx) => {
      const meta = await metadata(tx),
        record = await seedPackage(tx, packageId);
      meta.sharedOriginals ||= {};
      let adopted = 0;
      for (const original of record.seed.originals) {
        const media = (await tx.getEntity('media', original.assetId))?.base;
        if (
          media?.state !== 'active' ||
          media.data.sha256 !== original.sha256 ||
          media.data.size !== original.size
        )
          continue;
        assign(meta.sharedOriginals, original.assetId, {
          ...clone(original),
          mediaRevision: media.revision,
        });
        adopted++;
      }
      await tx.setMeta(meta);
      return { packageId, status: 'originals-only', adopted };
    });
    changed();
    return result;
  }
  return {
    importSeed,
    resolveSeed,
    adoptSeedOriginals,
    readSeedStatus: (packageId) =>
      storage.transaction(async (tx) => {
        const meta = await metadata(tx);
        const r = await seedPackage(tx, packageId);
        return {
          packageId,
          libraryId,
          epoch,
          keyFingerprintSha256: meta.sharedLibraryTrust?.keyFingerprintSha256 || null,
          status: r.seed.status === 'offline-pending-sync' ? 'imported' : r.seed.status,
          pendingSync: r.seed.status === 'offline-pending-sync',
          entities: r.seed.manifest.entityCount,
          originals: r.seed.originals.length,
        };
      }),
    readSeedTrust: () =>
      storage.transaction(async (tx) => {
        const meta = await metadata(tx),
          pin = meta.sharedLibraryTrust;
        return {
          libraryId,
          epoch,
          initialized: !!meta.initialized,
          pinned: !!pin,
          keyFingerprintSha256: pin?.keyFingerprintSha256 || null,
          publicKeyRawBase64: pin?.publicKeyRawBase64 || null,
          syncStatus: pin?.syncStatus || null,
          pendingSyncPackages: clone(meta.sharedSeedPendingSync || []),
        };
      }),
    readSeedOriginal: (assetId) =>
      storage.transaction(async (tx) => {
        const original = own((await metadata(tx)).sharedOriginals || {}, assetId),
          media = (await tx.getEntity('media', assetId))?.base;
        if (
          !original ||
          media?.state !== 'active' ||
          media.data.size !== original.size ||
          (media.data.sha256
            ? media.data.sha256 !== original.sha256
            : media.revision !== original.mediaRevision)
        )
          return null;
        return clone(original);
      }),
  };
}
