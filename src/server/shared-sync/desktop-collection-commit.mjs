import { lstat, open } from 'node:fs/promises';
import { lstatSync } from 'node:fs';
import path from 'node:path';
import { desktopCollectionRecipe } from './desktop-collection-recipe.mjs';
import {
  getSourceCollectionCapture,
  sourceMessageFingerprint,
} from './source-message-conflicts.mjs';
import { sharedInfo } from './replication.mjs';
import { describeConversation, saveConversation } from '../conversation-services/conversations.mjs';
import {
  directoryView,
  updateDirectoryState,
  saveDirectoryOrder,
} from '../conversation-services/directory.mjs';
import {
  verifyWallpaperOriginal,
  saveConversationWallpaper,
  readConversationWallpaper,
} from '../conversation-services/wallpaper.mjs';
import { saveSharedClientPreferences } from './preferences.mjs';
import { collectSticker } from '../domain/sticker-collection.mjs';

const ready = new WeakMap();
const fail = (code, status = 409) => {
  throw Object.assign(Error(code), { code, status });
};
const uuid = (value) =>
  typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
function receipts(db) {
  const registry = db.sourceCollections;
  if (registry === undefined) return { version: 1, receipts: [] };
  if (
    registry.version !== 1 ||
    !Array.isArray(registry.receipts) ||
    registry.receipts.length > 512 ||
    registry.receipts.some(
      (row) => !uuid(row.operationId) || !/^[a-f0-9]{64}$/.test(row.digest || ''),
    )
  )
    fail('SOURCE_COLLECTION_RECEIPT_SCHEMA');
  return registry;
}
function targetStamp(db, recipe) {
  const ids = new Set(
    recipe.resources.filter((row) => row.required && row.mediaId).map((row) => row.mediaId),
  );
  return sourceMessageFingerprint({
    directory: directoryView(db),
    preferences: db.sharedClientPreferences || null,
    stickers: db.stickers || [],
    assets: (db.media || []).filter((row) => ids.has(row.id)),
    sourceMessages: (db.entries || [])
      .filter((entry) => entry.chatJournal?.sourceId === recipe.sourceId)
      .map((entry) => ({
        id: entry.id,
        revision: entry.revision,
        hidden: !!entry.hidden,
        draft: !!entry.draft,
        deleted: !!entry.deleted,
        messages: entry.chatJournal.messages,
      })),
    conflicts: db.sourceMessageConflicts || null,
  });
}
async function noLinks(file) {
  for (let item = path.resolve(file); ;) {
    if ((await lstat(item)).isSymbolicLink()) fail('SOURCE_COLLECTION_ORIGINAL_UNSAFE');
    const parent = path.dirname(item);
    if (parent === item) break;
    item = parent;
  }
}
function originalStamp(file) {
  for (let item = path.resolve(file); ;) {
    if (lstatSync(item).isSymbolicLink()) fail('SOURCE_COLLECTION_ORIGINAL_UNSAFE');
    const parent = path.dirname(item);
    if (parent === item) break;
    item = parent;
  }
  const stat = lstatSync(file, { bigint: true });
  if (!stat.isFile()) fail('SOURCE_COLLECTION_ORIGINAL_INVALID');
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(String).join(':');
}

/** All originals are streamed and image-validated before the queue; the private
 * brand binds their exact media identities and a scoped owner CAS, never a flag. */
export async function prepareDesktopCollectionCommit({
  db,
  dataDir,
  proof,
  operationId,
  libraryId,
  epoch,
}) {
  if (!uuid(operationId)) fail('SOURCE_COLLECTION_INVALID', 400);
  const capture = getSourceCollectionCapture(proof),
    info = sharedInfo(db);
  if (!info.enabled || libraryId !== info.libraryId || epoch !== info.epoch)
    fail('SHARED_LIBRARY_MISMATCH');
  const digest = sourceMessageFingerprint({
    operationId,
    libraryId,
    epoch,
    sourceId: capture.sourceId,
    captureManifestSha256: capture.manifestSha256,
  });
  const prior = receipts(db).receipts.find((row) => row.operationId === operationId);
  if (prior) {
    if (prior.digest !== digest) fail('SOURCE_COLLECTION_OPERATION_REUSED');
    const token = Object.freeze({});
    ready.set(token, { prior, digest, operationId, info });
    return token;
  }
  const recipe = desktopCollectionRecipe(db, capture);
  if (recipe.summary.blockers.length) fail('SOURCE_COLLECTION_MAPPING_INCOMPLETE');
  const mediaIds = [
    ...new Set(recipe.resources.filter((row) => row.required).map((row) => row.mediaId)),
  ];
  const virtualRoom = recipe.directory.rooms[0]?.conversationId || `desktop:${capture.sourceId}:0`;
  const [, _sourceId, roomId] = virtualRoom.split(':');
  const verificationDb = {
    ...db,
    chatJournal: {
      ...db.chatJournal,
      rooms: [...(db.chatJournal?.rooms || []), { sourceId: _sourceId, id: roomId }],
    },
  };
  const verified = new Map(),
    originalStamps = new Map(),
    mimeCorrections = [];
  await noLinks(dataDir);
  for (const id of mediaIds) {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id))
      fail('SOURCE_COLLECTION_ORIGINAL_INVALID');
    const file = path.join(dataDir, 'media', id);
    await noLinks(file);
    const beforeStamp = originalStamp(file);
    const media = (db.media || []).find((row) => row.id === id && !row.deleted);
    let imageDb = verificationDb;
    // Only this exact legacy source mismatch is normalized. The proof remains
    // scoped to required capture resources and the unchanged original identity.
    if ((media?.type || media?.mime) === 'image/png') {
      const handle = await open(file, 'r');
      const prefix = Buffer.alloc(3);
      try {
        await handle.read(prefix, 0, prefix.length, 0);
      } finally {
        await handle.close();
      }
      if (prefix[0] === 255 && prefix[1] === 216 && prefix[2] === 255) {
        const required = recipe.resources.filter((row) => row.required && row.mediaId === id);
        if (
          !required.length ||
          required.some(
            (row) => row.original?.sha256 !== media.sha256 || row.original?.size !== media.size,
          )
        )
          fail('SOURCE_COLLECTION_ORIGINAL_INVALID');
        mimeCorrections.push({
          assetId: id,
          declaredMime: 'image/png',
          verifiedMime: 'image/jpeg',
          sha256: media.sha256,
          size: media.size,
        });
        imageDb = {
          ...verificationDb,
          media: verificationDb.media.map((row) =>
            row.id === id ? { ...row, type: 'image/jpeg' } : row,
          ),
        };
      }
    }
    const value = await verifyWallpaperOriginal(
      imageDb,
      { conversationId: virtualRoom, scope: 'shared', sharedAssetId: id },
      dataDir,
    );
    if (originalStamp(file) !== beforeStamp) fail('SOURCE_COLLECTION_ORIGINAL_CHANGED');
    originalStamps.set(id, { file, stamp: beforeStamp });
    verified.set(id, value);
  }
  const token = Object.freeze({});
  ready.set(token, {
    capture,
    recipe,
    verified,
    originalStamps,
    mimeCorrections,
    digest,
    operationId,
    info,
    stamp: targetStamp(db, recipe),
  });
  return token;
}

/** Synchronous original-owner transaction. Does not upload assets or write JSON
 * itself; any downstream failure rolls back profiles, bindings and receipt. */
export function commitDesktopCollection(db, token) {
  const prepared = ready.get(token);
  if (!prepared) fail('SOURCE_COLLECTION_INVALID', 400);
  const info = sharedInfo(db),
    registry = receipts(db);
  if (info.libraryId !== prepared.info.libraryId || info.epoch !== prepared.info.epoch)
    fail('SHARED_LIBRARY_MISMATCH');
  const existing = registry.receipts.find((row) => row.operationId === prepared.operationId);
  if (existing) {
    if (existing.digest !== prepared.digest) fail('SOURCE_COLLECTION_OPERATION_REUSED');
    return { registered: true, replayed: true, receipt: structuredClone(existing) };
  }
  if (prepared.prior) fail('SOURCE_COLLECTION_RECEIPT_CHANGED');
  if (registry.receipts.length >= 512) fail('SOURCE_COLLECTION_CAPACITY');
  if (targetStamp(db, prepared.recipe) !== prepared.stamp) fail('SOURCE_COLLECTION_TARGET_CHANGED');
  const recipe = desktopCollectionRecipe(db, prepared.capture);
  if (
    recipe.summary.blockers.length ||
    sourceMessageFingerprint(recipe.resources) !==
      sourceMessageFingerprint(prepared.recipe.resources)
  )
    fail('SOURCE_COLLECTION_TARGET_CHANGED');
  for (const { file, stamp } of prepared.originalStamps.values())
    if (originalStamp(file) !== stamp) fail('SOURCE_COLLECTION_ORIGINAL_CHANGED');
  for (const correction of prepared.mimeCorrections) {
    const media = (db.media || []).find((row) => row.id === correction.assetId && !row.deleted);
    if (
      !media ||
      (media.type || media.mime) !== correction.declaredMime ||
      media.sha256 !== correction.sha256 ||
      media.size !== correction.size
    )
      fail('SOURCE_COLLECTION_TARGET_CHANGED');
    if (Object.hasOwn(media, 'type')) media.type = correction.verifiedMime;
    else media.mime = correction.verifiedMime;
  }
  for (const resource of recipe.resources.filter((row) => row.required)) {
    const media = (db.media || []).find((row) => row.id === resource.mediaId && !row.deleted),
      verified = prepared.verified.get(resource.mediaId);
    if (
      !media ||
      !verified ||
      media.sha256 !== verified.sha256 ||
      media.size !== verified.size ||
      (media.type || media.mime) !== verified.type
    )
      fail('SOURCE_COLLECTION_TARGET_CHANGED');
  }
  for (const target of recipe.directory.rooms) {
    if (target.profile.disposition !== 'reuse') saveConversation(db, target.profile.input);
    if (target.listState.disposition !== 'reuse') updateDirectoryState(db, target.listState.input);
  }
  const view = directoryView(db);
  if (
    sourceMessageFingerprint(view.order) !== sourceMessageFingerprint(recipe.directory.order.order)
  )
    saveDirectoryOrder(db, {
      expectedRevision: view.revision,
      order: recipe.directory.order.order,
    });
  if (recipe.preferences.changedKeys.length)
    saveSharedClientPreferences(db, recipe.preferences.input);
  for (const wallpaper of recipe.wallpapers)
    if (wallpaper.disposition !== 'reuse')
      saveConversationWallpaper(
        db,
        wallpaper.input,
        prepared.verified.get(wallpaper.input.sharedAssetId),
      );
  for (const sticker of recipe.stickers) {
    if (sticker.disposition === 'collect-after-original')
      sticker.stickerId = collectSticker(db, sticker.input, {
        fail: (status, message) =>
          Object.assign(Error(message), { status, code: 'SOURCE_COLLECTION_STICKER_INVALID' }),
      }).sticker.id;
    else if (sticker.disposition !== 'reuse')
      fail('SOURCE_COLLECTION_STICKER_REQUIRES_RECONCILIATION');
  }
  const finalDirectory = directoryView(db),
    profile = (db.sharedClientPreferences?.profiles || []).find(
      (row) => row.scope === 'desktop:thoughts',
    );
  const conflictRows = (db.sourceMessageConflicts?.records || []).filter(
    (row) => row.sourceId === recipe.sourceId,
  );
  const receipt = {
    operationId: prepared.operationId,
    digest: prepared.digest,
    libraryId: info.libraryId,
    epoch: info.epoch,
    sourceId: recipe.sourceId,
    sourceManifestSha256: recipe.sourceManifestSha256,
    sourceSha256: recipe.sourceSha256,
    status: 'backend-mapped',
    coverage: {
      backendMapped: true,
      rendererRestoration: 'pending-explicit-pc-resolver',
      computerComplete: false,
    },
    targets: {
      directoryRevision: finalDirectory.revision,
      orderSha256: sourceMessageFingerprint(finalDirectory.order),
      rooms: recipe.directory.rooms.map((row) => {
        const state = describeConversation(db, { conversationId: row.conversationId }),
          list = finalDirectory.conversations.find(
            (item) => item.conversationId === row.conversationId,
          );
        return {
          conversationId: row.conversationId,
          revision: state.revision,
          listStateRevision: list.listStateRevision,
          sha256: sourceMessageFingerprint(state),
        };
      }),
      preferences: {
        scope: 'desktop:thoughts',
        revision: profile?.revision || 0,
        sha256: sourceMessageFingerprint(profile || null),
      },
      originals: [...prepared.verified.values()].map((row) => ({
        assetId: row.id,
        sha256: row.sha256,
        size: row.size,
      })),
      originalMimeCorrections: prepared.mimeCorrections,
      wallpapers: recipe.wallpapers.map((row) => {
        const state = readConversationWallpaper(db, row.input);
        return {
          conversationId: row.input.conversationId,
          revision: state.revision,
          sha256: sourceMessageFingerprint(state),
        };
      }),
      stickers: recipe.stickers.map((row) => ({
        sourceAssetId: row.sourceAssetId,
        stickerId: row.stickerId,
        mediaId: row.mediaId,
        sha256: sourceMessageFingerprint(
          (db.stickers || []).find((item) => item.id === row.stickerId),
        ),
      })),
      conflicts: conflictRows.map((row) => ({
        id: row.id,
        revision: row.revision,
        state: row.state,
        ownerSha256: row.ownerSha256,
        sourceSha256: row.sourceSha256,
      })),
      preferenceResourceBindings: recipe.preferenceResourceBindings,
      restorationCoverage: recipe.restorationCoverage,
    },
    messageCoverage: recipe.messageCoverage,
  };
  db.sourceCollections = { ...registry, receipts: [...registry.receipts, receipt] };
  return { registered: true, replayed: false, receipt: structuredClone(receipt) };
}

export function sourceCollectionReceiptEntities(db) {
  return receipts(db).receipts.map((receipt) => ({
    id: receipt.operationId,
    data: { ...receipt, readOnlyProjection: true },
  }));
}
