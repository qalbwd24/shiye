import { createHash } from 'node:crypto';
import { sharedInfo } from './replication.mjs';
import { sourceMessageFingerprint as fingerprint } from './source-message-conflicts.mjs';
import { directoryView } from '../conversation-services/directory.mjs';
import { describeConversation } from '../conversation-services/conversations.mjs';
import { readConversationWallpaper } from '../conversation-services/wallpaper.mjs';
import { sharedConversationFeedRevision } from './conversation-feed.mjs';
import { collectSharedSeedFeeds } from './seed-feeds.mjs';
import { sharedSeedOwnerTransport } from './seed-package.mjs';
import {
  sharedSeedEntityBytes,
  validateSharedSeedManifest,
} from '../../../public/shared/shared-seed.js';

const sha = (value) => createHash('sha256').update(sharedSeedEntityBytes(value)).digest('hex');
const key = (row) => JSON.stringify([row.entityType, row.entityId]);
const currentProofs = new WeakMap();

/** Evidence evaluation only: never mutates, creates identity, trusts a complete
 * flag, or infers that a captured PC generation is the current live WebView. */
export function evaluateComputerExportCoverage({
  db,
  manifest,
  sourceOperationId,
  currentProof,
} = {}) {
  const blockers = new Set();
  let checked;
  try {
    checked = validateSharedSeedManifest(manifest);
  } catch {
    blockers.add('invalid-seed-manifest');
  }
  const info = sharedInfo(db),
    receipt = db.sourceCollections?.receipts?.find((r) => r.operationId === sourceOperationId);
  if (!info.enabled) blockers.add('original-owner-not-shared');
  if (!receipt) blockers.add('source-collection-receipt-missing');
  if (checked) {
    const revision = sharedConversationFeedRevision(db);
    if (checked.conversationFeeds?.some((feed) => feed.feedRevision !== revision))
      blockers.add('current-feed-generation-not-packaged');
    const proof = currentProofs.get(currentProof);
    if (!proof || proof.db !== db || proof.manifestSha256 !== sha(checked))
      blockers.add('current-owner-feed-proof-required');
    if (checked.libraryId !== info.libraryId || checked.epoch !== info.epoch)
      blockers.add('owner-identity-mismatch');
    if (
      checked.version !== 2 ||
      !checked.requiredFeatures?.includes('conversation-feeds-v1') ||
      !checked.requiredFeatures?.includes('seed-attestation-ed25519-v1') ||
      !checked.attestation
    )
      blockers.add('signed-full-seed-required');
    const registered = db._sharedSeedExports?.find((r) => r.packageId === checked.packageId);
    if (
      !registered ||
      registered.manifestSha256 !== sha(checked) ||
      registered.libraryId !== checked.libraryId ||
      registered.epoch !== checked.epoch ||
      registered.watermark !== checked.watermark ||
      registered.rosterDigest !== sha(checked.entities) ||
      registered.feedRosterDigest !== sha(checked.conversationFeeds) ||
      sha(registered.attestation || null) !== sha(checked.attestation || null)
    )
      blockers.add('owner-seed-registration-missing-or-changed');
    const index = db._sharedSync?.entities || [],
      packed = new Map(checked.entities.map((r) => [key(r), r]));
    if (
      checked.watermark !== info.seq ||
      packed.size !== index.length ||
      index.some((row) => {
        const item = packed.get(key(row));
        return !item || ['revision', 'seq', 'sha256'].some((field) => item[field] !== row[field]);
      })
    )
      blockers.add('owner-generation-not-packaged');
    if (
      receipt &&
      !packed.has(key({ entityType: 'source-collection-receipt', entityId: receipt.operationId }))
    )
      blockers.add('source-receipt-not-packaged');
  }
  if (receipt) {
    if (receipt.libraryId !== info.libraryId || receipt.epoch !== info.epoch)
      blockers.add('source-receipt-identity-mismatch');
    if (receipt.status !== 'backend-mapped' || !receipt.targets || !receipt.messageCoverage)
      blockers.add('source-receipt-incomplete');
    const targets = receipt.targets;
    if (targets) {
      const directory = directoryView(db);
      if (
        directory.revision !== targets.directoryRevision ||
        fingerprint(directory.order) !== targets.orderSha256
      )
        blockers.add('directory-changed-after-source-collection');
      for (const room of targets.rooms || []) {
        const state = describeConversation(db, { conversationId: room.conversationId }),
          list = directory.conversations.find((r) => r.conversationId === room.conversationId);
        if (
          fingerprint(state) !== room.sha256 ||
          list?.listStateRevision !== room.listStateRevision
        )
          blockers.add('room-changed-after-source-collection');
      }
      const profile = db.sharedClientPreferences?.profiles?.find(
        (r) => r.scope === targets.preferences?.scope,
      );
      if (fingerprint(profile || null) !== targets.preferences?.sha256)
        blockers.add('preferences-changed-after-source-collection');
      for (const original of targets.originals || []) {
        const media = db.media?.find((r) => r.id === original.assetId && !r.deleted),
          asset = checked?.assets.find((r) => r.assetId === original.assetId);
        if (
          !media ||
          !asset ||
          media.sha256 !== original.sha256 ||
          media.size !== original.size ||
          asset.sha256 !== original.sha256 ||
          asset.size !== original.size
        )
          blockers.add('required-original-not-packaged');
      }
      for (const row of targets.wallpapers || [])
        if (
          fingerprint(readConversationWallpaper(db, { conversationId: row.conversationId })) !==
          row.sha256
        )
          blockers.add('wallpaper-changed-after-source-collection');
      for (const row of targets.stickers || [])
        if (fingerprint(db.stickers?.find((r) => r.id === row.stickerId) || null) !== row.sha256)
          blockers.add('sticker-changed-after-source-collection');
      for (const row of targets.conflicts || []) {
        const conflict = db.sourceMessageConflicts?.records?.find((r) => r.id === row.id);
        if (
          !conflict ||
          ['revision', 'state', 'ownerSha256', 'sourceSha256'].some(
            (field) => conflict[field] !== row[field],
          )
        )
          blockers.add('source-conflict-changed-after-source-collection');
      }
    }
  }
  const snapshotComplete = blockers.size === 0;
  return {
    version: 1,
    snapshotComplete,
    completeComputerExport: snapshotComplete,
    completeSnapshotAt: snapshotComplete ? checked.attestation.issuedAt : null,
    sourceCaptureGeneration: receipt
      ? {
          sourceId: receipt.sourceId,
          manifestSha256: receipt.sourceManifestSha256,
          contentSha256: receipt.sourceSha256,
        }
      : null,
    sourceOperationId: receipt?.operationId || null,
    snapshotBlockers: [...blockers],
    continuousSyncReady: false,
    continuousSyncBlockers: ['pc-disabled-and-unlinked-room-message-port-not-connected'],
    rendererRestoration: receipt?.coverage?.rendererRestoration || 'not-proven',
    scope: ['original-owner-indexed-business', 'registered-desktop-source-capture-generation'],
    notes: 'excluded-by-user-scope',
  };
}

/** One-time actual-owner check, never an index-maintenance hook. The transport
 * projects every feed/part from one immutable COW object. A concurrent commit,
 * including runtime-only edits at the same shared seq, invalidates the proof. */
export async function evaluateCurrentComputerExportCoverage({
  getDb,
  manifest,
  sourceOperationId,
} = {}) {
  if (typeof getDb !== 'function')
    throw Object.assign(Error('SOURCE_COVERAGE_OWNER_REQUIRED'), {
      code: 'SOURCE_COVERAGE_OWNER_REQUIRED',
      status: 400,
    });
  const db = getDb(),
    info = sharedInfo(db);
  const preview = evaluateComputerExportCoverage({ db, manifest, sourceOperationId });
  // Structural/owner/target failures need no expensive full feed projection.
  if (preview.snapshotBlockers.some((reason) => reason !== 'current-owner-feed-proof-required'))
    return preview;
  const conversations = new Set(directoryView(db).conversations.map((row) => row.conversationId));
  const feeds = await collectSharedSeedFeeds({
    request: sharedSeedOwnerTransport(() => db),
    conversations: manifest.entities
      .filter((row) => row.entityType === 'conversation' && conversations.has(row.entityId))
      .map((row) => row.entityId),
    info,
  });
  if (getDb() !== db)
    throw Object.assign(Error('SOURCE_COVERAGE_BUSY'), {
      code: 'SOURCE_COVERAGE_BUSY',
      status: 409,
    });
  if (sha(feeds.map((row) => row.descriptor)) !== sha(manifest.conversationFeeds))
    return {
      ...preview,
      snapshotBlockers: [...preview.snapshotBlockers, 'current-feed-roster-not-packaged'],
    };
  const token = Object.freeze({});
  currentProofs.set(token, { db, manifestSha256: sha(manifest) });
  return evaluateComputerExportCoverage({ db, manifest, sourceOperationId, currentProof: token });
}
