import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { getSourceCollectionCapture } from './source-message-conflicts.mjs';
import { sharedInfo } from './replication.mjs';
import { verifyWallpaperOriginal } from '../conversation-services/wallpaper.mjs';

const fail = (code) => {
  throw Object.assign(Error(code), { code, status: 409 });
};
const KEY = 'shiye-preview-appearance-v1';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const hex = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
async function noLinks(file) {
  for (let current = path.resolve(file); ;) {
    if ((await lstat(current)).isSymbolicLink()) fail('SOURCE_RESOURCE_UNSAFE');
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

/** Server-only data seam for a future fixed local-admin resource resolver.
 * The capture must have the existing private brand and a real same-owner source
 * receipt. A dry-run recipe or caller's `verified:true` never authorizes this.
 * No body, raw data URL, original path, key or credential is returned.
 */
export async function readDesktopPreferenceResourceProof({
  getDb,
  dataDir,
  proof,
  operationId,
  request,
} = {}) {
  if (typeof getDb !== 'function' || !path.isAbsolute(dataDir || ''))
    fail('SOURCE_RESOURCE_OWNER_REQUIRED');
  if (
    !request ||
    Object.keys(request).sort().join(',') !==
      'key,mime,rawBytes,rawSha256,sha256,size,sourceField' ||
    request.key !== KEY ||
    request.sourceField !== 'wallpaper' ||
    !hex(request.rawSha256) ||
    !hex(request.sha256) ||
    !Number.isSafeInteger(request.rawBytes) ||
    request.rawBytes < 1 ||
    request.rawBytes > 2 * 1024 * 1024 ||
    !Number.isSafeInteger(request.size) ||
    request.size < 1 ||
    request.size > 2 * 1024 * 1024 ||
    !/^image\/(png|jpeg|webp|gif|avif)$/.test(request.mime || '')
  )
    fail('SOURCE_RESOURCE_INVALID');
  const capture = getSourceCollectionCapture(proof),
    db = getDb(),
    info = sharedInfo(db);
  const receipt = db.sourceCollections?.receipts?.find((row) => row.operationId === operationId);
  if (
    !receipt ||
    receipt.status !== 'backend-mapped' ||
    receipt.libraryId !== info.libraryId ||
    receipt.epoch !== info.epoch ||
    receipt.sourceId !== capture.sourceId ||
    receipt.sourceManifestSha256 !== capture.manifestSha256 ||
    receipt.sourceSha256 !== capture.sourceSha256
  )
    fail('SOURCE_RESOURCE_RECEIPT_REQUIRED');
  const raw = capture.preferences.values[KEY];
  if (typeof raw !== 'string') fail('SOURCE_RESOURCE_CAPTURE_MISMATCH');
  let source;
  try {
    source = JSON.parse(raw);
  } catch {
    fail('SOURCE_RESOURCE_CAPTURE_MISMATCH');
  }
  const encoded =
    typeof source?.wallpaper === 'string' &&
    /^data:(image\/(?:png|jpeg|webp|gif|avif));base64,([A-Za-z0-9+/]*={0,2})$/.exec(
      source.wallpaper,
    );
  if (!encoded) fail('SOURCE_RESOURCE_CAPTURE_MISMATCH');
  const sourceBytes = Buffer.from(encoded[2], 'base64');
  if (
    sourceBytes.toString('base64') !== encoded[2] ||
    hash(sourceBytes) !== request.sha256 ||
    sourceBytes.length !== request.size ||
    encoded[1] !== request.mime
  )
    fail('SOURCE_RESOURCE_CAPTURE_MISMATCH');
  const binding = receipt.targets.preferenceResourceBindings?.find(
    (row) =>
      row.scope === 'desktop:thoughts' &&
      row.key === KEY &&
      row.sourceField === 'wallpaper' &&
      row.field === 'wallpaperAssetId',
  );
  if (
    !binding ||
    binding.sourceMemberSha256 !== capture.members.get('logical/preferences.json')?.sha256 ||
    binding.sha256 !== request.sha256 ||
    binding.size !== request.size ||
    !receipt.targets.originals.some(
      (row) =>
        row.assetId === binding.mediaId &&
        row.sha256 === binding.sha256 &&
        row.size === binding.size,
    )
  )
    fail('SOURCE_RESOURCE_BINDING_MISMATCH');
  const currentAppearance = db.sharedClientPreferences?.profiles?.find(
    (row) => row.scope === 'desktop:thoughts',
  )?.values?.[KEY];
  if (!currentAppearance || currentAppearance.wallpaperAssetId !== binding.mediaId)
    fail('SOURCE_RESOURCE_BINDING_CHANGED');
  const original = capture.members.get(binding.originalMemberPath);
  if (!original || original.sha256 !== binding.sha256 || original.size !== binding.size)
    fail('SOURCE_RESOURCE_CAPTURE_MISMATCH');
  await noLinks(path.join(dataDir, 'media', binding.mediaId));
  const verified = await verifyWallpaperOriginal(
    db,
    {
      conversationId: receipt.targets.rooms[0]?.conversationId,
      scope: 'shared',
      sharedAssetId: binding.mediaId,
    },
    dataDir,
  );
  if (getDb() !== db) fail('SOURCE_RESOURCE_BUSY');
  if (
    verified.sha256 !== binding.sha256 ||
    verified.size !== binding.size ||
    verified.type !== request.mime
  )
    fail('SOURCE_RESOURCE_ORIGINAL_MISMATCH');
  return {
    version: 1,
    scope: 'desktop:thoughts',
    key: KEY,
    sourceField: 'wallpaper',
    field: 'wallpaperAssetId',
    operationId,
    libraryId: info.libraryId,
    epoch: info.epoch,
    mediaId: binding.mediaId,
    sourceManifestSha256: capture.manifestSha256,
    sourceMemberSha256: binding.sourceMemberSha256,
    captureRawSha256: hash(Buffer.from(raw, 'utf8')),
    ...request,
  };
}
