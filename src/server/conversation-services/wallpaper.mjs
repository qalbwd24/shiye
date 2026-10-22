import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { registry } from './registry.mjs';

const fail = (code, status = 409) => {
  throw Object.assign(Error(code), { code, status });
};
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const identity = (value) =>
  typeof value === 'string' &&
  /^desktop:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}:-?\d{1,20}$/.test(value);
const revision = (value) => Number.isSafeInteger(value) && value >= 0;
const scopes = ['shared', 'desktop', 'android'];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const defaults = (conversationId) => ({
  version: 1,
  conversationId,
  revision: 0,
  syncEnabled: true,
  sharedAssetId: null,
  independent: { desktop: { revision: 0, assetId: null }, android: { revision: 0, assetId: null } },
});
function room(db, id) {
  if (!identity(id)) fail('WALLPAPER_INVALID_CONVERSATION', 400);
  if (
    !(db.chatJournal?.rooms || []).some((r) => `desktop:${r.sourceId}:${r.id}` === id) &&
    !(db.conversationServices?.conversations || []).some((r) => r.id === id)
  )
    fail('WALLPAPER_ROOM_NOT_FOUND', 404);
}
export function readConversationWallpaper(db, { conversationId }) {
  room(db, conversationId);
  const old = (db.conversationServices?.wallpapers || []).find(
    (row) => row.conversationId === conversationId,
  );
  const value = { ...defaults(conversationId), ...structuredClone(old || {}) };
  if (
    value.version !== 1 ||
    !revision(value.revision) ||
    typeof value.syncEnabled !== 'boolean' ||
    !object(value.independent) ||
    ['desktop', 'android'].some(
      (scope) => !object(value.independent[scope]) || !revision(value.independent[scope].revision),
    )
  )
    fail('WALLPAPER_PERSISTED_STATE_INVALID');
  return value;
}
const assetIdentity = (asset) =>
  asset
    ? { id: asset.id, size: asset.size, sha256: asset.sha256, type: asset.type || asset.mime }
    : null;
function selectedAsset(input) {
  if (input.scope === undefined || input.scope === 'shared') return input.sharedAssetId;
  return input.assetId;
}
export function validateWallpaperInput(input) {
  const scope = input?.scope ?? 'shared',
    shared = scope === 'shared';
  if (
    !object(input) ||
    !scopes.includes(scope) ||
    !identity(input.conversationId) ||
    !revision(input.expectedRevision) ||
    Object.keys(input).some(
      (k) =>
        ![
          'conversationId',
          'scope',
          'expectedRevision',
          ...(shared ? ['syncEnabled', 'sharedAssetId'] : ['assetId']),
        ].includes(k),
    ) ||
    (shared
      ? !Object.hasOwn(input, 'syncEnabled') && !Object.hasOwn(input, 'sharedAssetId')
      : !Object.hasOwn(input, 'assetId')) ||
    (Object.hasOwn(input, 'syncEnabled') && typeof input.syncEnabled !== 'boolean')
  )
    fail('WALLPAPER_INVALID_INPUT', 400);
  const asset = selectedAsset(input);
  if (
    asset !== undefined &&
    asset !== null &&
    (typeof asset !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(asset))
  )
    fail('WALLPAPER_INVALID_ASSET', 400);
  return { ...input, scope };
}
// This preflight runs outside the JSON write queue; the immutable asset metadata
// is checked again inside the mutation before publishing its binding.
export async function verifyWallpaperOriginal(db, input, dataDir) {
  const id = selectedAsset(input);
  room(db, input.conversationId);
  if (id === undefined || id === null) return null;
  const asset = (db.media || []).find((row) => row.id === id && !row.deleted);
  if (
    !asset ||
    !/^image\/(png|jpeg|gif|webp|avif)$/.test(asset.type || asset.mime || '') ||
    !/^[a-f0-9]{64}$/.test(asset.sha256 || '') ||
    !Number.isSafeInteger(asset.size) ||
    asset.size < 1
  )
    fail('WALLPAPER_IMAGE_REQUIRED', 422);
  const file = path.join(dataDir, 'media', id);
  try {
    const info = await stat(file);
    if (!info.isFile() || info.size !== asset.size) fail('WALLPAPER_ORIGINAL_UNAVAILABLE', 422);
    const hash = createHash('sha256');
    let prefix = Buffer.alloc(0);
    for await (const bytes of createReadStream(file, { highWaterMark: 256 * 1024 })) {
      if (prefix.length < 32)
        prefix = Buffer.concat([prefix, bytes.subarray(0, 32 - prefix.length)]);
      hash.update(bytes);
    }
    if (hash.digest('hex') !== asset.sha256) fail('WALLPAPER_ORIGINAL_UNAVAILABLE', 422);
    const mime = asset.type || asset.mime;
    const valid =
      mime === 'image/png'
        ? prefix.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : mime === 'image/jpeg'
          ? prefix[0] === 255 && prefix[1] === 216 && prefix[2] === 255
          : mime === 'image/gif'
            ? /^GIF8[79]a$/.test(prefix.subarray(0, 6).toString('ascii'))
            : mime === 'image/webp'
              ? prefix.subarray(0, 4).toString('ascii') === 'RIFF' &&
                prefix.subarray(8, 12).toString('ascii') === 'WEBP'
              : prefix.subarray(4, 8).toString('ascii') === 'ftyp' &&
                /avif|avis/.test(prefix.subarray(8).toString('ascii'));
    if (!valid) fail('WALLPAPER_IMAGE_REQUIRED', 422);
  } catch (error) {
    if (error.code?.startsWith('WALLPAPER_')) throw error;
    fail('WALLPAPER_ORIGINAL_UNAVAILABLE', 422);
  }
  return assetIdentity(asset);
}
export function saveConversationWallpaper(db, raw, verifiedAsset) {
  const input = validateWallpaperInput(raw),
    old = readConversationWallpaper(db, input),
    shared = input.scope === 'shared';
  const current = shared ? old : old.independent[input.scope];
  if (current.revision !== input.expectedRevision) fail('WALLPAPER_REVISION_CONFLICT');
  const asset = selectedAsset(input);
  if (
    asset !== undefined &&
    asset !== null &&
    !same(
      assetIdentity((db.media || []).find((row) => row.id === asset && !row.deleted)),
      verifiedAsset,
    )
  )
    fail('WALLPAPER_ASSET_CHANGED');
  const next = structuredClone(old);
  if (shared) {
    if (Object.hasOwn(input, 'syncEnabled')) next.syncEnabled = input.syncEnabled;
    if (Object.hasOwn(input, 'sharedAssetId')) next.sharedAssetId = input.sharedAssetId;
    if (
      next.syncEnabled !== old.syncEnabled ||
      next.sharedAssetId !== old.sharedAssetId ||
      (old.revision === 0 && Object.hasOwn(input, 'sharedAssetId'))
    ) {
      if (old.revision === Number.MAX_SAFE_INTEGER) fail('WALLPAPER_REVISION_EXHAUSTED');
      next.revision++;
    }
  } else if (current.assetId !== input.assetId || current.revision === 0) {
    if (current.revision === Number.MAX_SAFE_INTEGER) fail('WALLPAPER_REVISION_EXHAUSTED');
    next.independent[input.scope] = {
      ...current,
      assetId: input.assetId,
      revision: current.revision + 1,
    };
  }
  db.conversationServices ||= structuredClone(registry(db));
  const rows = (db.conversationServices.wallpapers ||= []),
    index = rows.findIndex((row) => row.conversationId === input.conversationId);
  if (index < 0) rows.push(next);
  else rows[index] = next;
  return {
    conversationId: input.conversationId,
    scope: input.scope,
    revision: shared ? next.revision : next.independent[input.scope].revision,
  };
}
