import { validateProductRecord, PRODUCT_ENTITY_TYPES } from './sync-product.js';
import { sha256Bytes } from './sync-v2-media.js';

export const PRODUCT_SEED_FORMAT = 'shiye-product-seed';
export const PRODUCT_SEED_MAGIC = 'SHIYE-SEED-V1\n';
export const PRODUCT_SEED_POLICY = Object.freeze({
  clientWallpaper: 'device-local',
  stickerMetadata: 'shared',
  conversationImage: 'avatar-fallback',
});
const entityTypes = new Set([...Object.values(PRODUCT_ENTITY_TYPES), 'asset']);
const reject = (code) => {
  throw Object.assign(new Error(code), { code, status: 422 });
};
export function validateSeedManifest(value) {
  if (
    value?.format !== PRODUCT_SEED_FORMAT ||
    value.version !== 1 ||
    value.mode !== 'product-bootstrap' ||
    typeof value.packageId !== 'string' ||
    !/^[a-f0-9-]{36}$/.test(value.packageId) ||
    typeof value.libraryId !== 'string' ||
    !value.libraryId ||
    typeof value.epoch !== 'string' ||
    !value.epoch ||
    typeof value.checkpoint !== 'string' ||
    !value.checkpoint ||
    !Number.isSafeInteger(value.watermark) ||
    value.watermark < 0 ||
    !Array.isArray(value.members) ||
    value.members.length < 1 ||
    value.members.length > 100001 ||
    value.policy?.clientWallpaper !== 'device-local' ||
    value.policy?.stickerMetadata !== 'shared' ||
    value.containsCredentials !== false ||
    value.containsSourceArchives !== false
  )
    reject('INVALID_SEED_MANIFEST');
  const paths = new Set();
  let total = 0;
  for (const [i, item] of value.members.entries()) {
    if (
      typeof item?.path !== 'string' ||
      (i === 0 ? item.path !== 'records.ndjson' : !/^media\/[a-f0-9]{64}$/.test(item.path)) ||
      paths.has(item.path) ||
      !/^[a-f0-9]{64}$/.test(item.sha256 || '') ||
      !Number.isSafeInteger(item.size) ||
      item.size < 0 ||
      item.size > (i === 0 ? 256 * 1024 ** 2 : 512 * 1024 ** 2)
    )
      reject('INVALID_SEED_MEMBER');
    if (i && item.path !== 'media/' + item.sha256) reject('SEED_MEMBER_HASH_PATH_MISMATCH');
    paths.add(item.path);
    total += item.size;
  }
  if (
    !Number.isSafeInteger(total) ||
    total > 64 * 1024 ** 3 ||
    !Number.isSafeInteger(value.entityCount) ||
    value.entityCount < 0 ||
    value.entityCount > 100000 ||
    !Number.isSafeInteger(value.assetCount) ||
    value.assetCount < 0 ||
    value.assetCount > 100000 ||
    value.bytes !== total
  )
    reject('SEED_LIMIT_EXCEEDED');
  return value;
}
export function validateSeedEntity(entity) {
  if (
    !entity ||
    typeof entity.entityType !== 'string' ||
    !entityTypes.has(entity.entityType) ||
    typeof entity.entityId !== 'string' ||
    !/^[A-Za-z0-9_:@.-]{1,160}$/.test(entity.entityId) ||
    !Number.isSafeInteger(entity.revision) ||
    entity.revision < 1 ||
    !['active', 'deleted', 'withdrawn'].includes(entity.state)
  )
    reject('INVALID_SEED_ENTITY');
  if (entity.state !== 'active') {
    if (JSON.stringify(entity.data) !== '{}') reject('SEED_WITHDRAWN_BODY');
    return entity;
  }
  if (entity.entityType === 'asset') {
    if (
      entity.data?.assetId !== entity.entityId ||
      !/^[a-f0-9]{64}$/.test(entity.data.sha256 || '') ||
      !Number.isSafeInteger(entity.data.size) ||
      entity.data.size < 0
    )
      reject('INVALID_SEED_ASSET');
    return entity;
  }
  validateProductRecord(entity.entityType, entity.entityId, entity.data);
  const { _product: meta } = entity.data;
  if (
    entity.state === 'active' &&
    meta.kind === 'entry' &&
    !meta.payload &&
    !meta.readOnlyProjection &&
    (entity.data.contentFormat !== 'richdoc' || !entity.data._canonical)
  )
    reject('SEED_CANONICAL_REQUIRED');
  return entity;
}

/** Render-only DTO. Never save this projection in place of the complete envelope. */
export function productConversationPresentation(record, localAppearance = {}) {
  const value = record.data || record;
  return {
    avatarAssetId:
      value.avatarAssetId ||
      value.configuration?.avatarAssetId ||
      value.wallpaperAssetId ||
      value.configuration?.wallpaperAssetId ||
      null,
    wallpaperAssetId: localAppearance.wallpaperAssetId || null,
    wallpaperOpacity: localAppearance.wallpaperOpacity ?? 1,
  };
}

/** Exact old details/summary display is a read-only compatibility projection.
 * Any body edit invalidates it; sanitize HTML with the application's existing reader.
 */
export function productSeedEntryPresentation(record) {
  const value = record.data || record;
  const compatibility = value.compatibilityView;
  if (
    compatibility?.version === 1 &&
    compatibility.reason === 'legacy-details' &&
    compatibility.bodySha256 ===
      sha256Bytes(new TextEncoder().encode(JSON.stringify(value.body))) &&
    typeof value.editorOriginalHtml === 'string'
  )
    return {
      mode: 'compatibility',
      html: value.editorOriginalHtml,
      requiresSanitization: true,
      readOnly: true,
      body: value.body,
    };
  return { mode: 'richdoc', body: value.body };
}
