import { readLocalStoragePreferences } from './shared-preference-capture.js';

const KEY = 'shiye-preview-appearance-v1';
const MAX_RAW = 2 * 1024 * 1024;
const fail = (code) => {
  throw Object.assign(Error(code), { code });
};
const digest = async (bytes) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
const uuid = (value) =>
  typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const hex = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const DESKTOP_PREFERENCE_RESOURCE_ACTION = 'source-preference-resource-proof';
function validMetadata(value) {
  return (
    value &&
    Object.keys(value).sort().join(',') === 'key,mime,rawBytes,rawSha256,sha256,size,sourceField' &&
    value.key === KEY &&
    value.sourceField === 'wallpaper' &&
    hex(value.rawSha256) &&
    hex(value.sha256) &&
    Number.isSafeInteger(value.rawBytes) &&
    value.rawBytes > 0 &&
    value.rawBytes <= MAX_RAW &&
    Number.isSafeInteger(value.size) &&
    value.size > 0 &&
    value.size <= MAX_RAW &&
    /^image\/(png|jpeg|webp|gif|avif)$/.test(value.mime || '')
  );
}

/** Fixed data-only seam. request must be the trusted local-admin transport,
 * never a generic paired-device command or an arbitrary-URL fetch callback. */
export function createDesktopPreferenceResourceResolver({ request, owner, source } = {}) {
  const selectedOwner = { libraryId: owner?.libraryId, epoch: owner?.epoch };
  const selectedSource = {
    operationId: source?.operationId,
    captureRelativePath: source?.captureRelativePath,
    captureManifestSha256: source?.captureManifestSha256,
  };
  if (
    typeof request !== 'function' ||
    !uuid(selectedOwner.libraryId) ||
    !uuid(selectedOwner.epoch) ||
    !uuid(selectedSource.operationId) ||
    !hex(selectedSource.captureManifestSha256) ||
    typeof selectedSource.captureRelativePath !== 'string' ||
    selectedSource.captureRelativePath.length > 240 ||
    !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(selectedSource.captureRelativePath)
  )
    fail('DESKTOP_RESOURCE_RESOLVER_INVALID');
  return async (metadata) => {
    if (!validMetadata(metadata)) fail('DESKTOP_RESOURCE_METADATA_INVALID');
    const proof = await request(DESKTOP_PREFERENCE_RESOURCE_ACTION, {
      ...selectedSource,
      request: { ...metadata },
    });
    if (
      proof?.libraryId !== selectedOwner.libraryId ||
      proof?.epoch !== selectedOwner.epoch ||
      proof?.operationId !== selectedSource.operationId ||
      proof?.sourceManifestSha256 !== selectedSource.captureManifestSha256
    )
      fail('DESKTOP_RESOURCE_PROOF_MISMATCH');
    return proof;
  };
}

/** PC data-only reader. A single known legacy resource may be replaced in the
 * returned portable projection after owner verification. Local storage and the
 * visible old wallpaper are never changed here; the generic 256KiB limit stays.
 */
export function createDesktopPreferenceResourceReader({
  storage = globalThis.localStorage,
  keys = [{ key: KEY, json: true }],
  resolveResource,
} = {}) {
  return async () => {
    if (!keys.some((spec) => typeof spec === 'object' && spec?.key === KEY && spec.json === true))
      return readLocalStoragePreferences({ storage, keys });
    const raw = storage?.getItem?.(KEY);
    if (typeof raw !== 'string') return readLocalStoragePreferences({ storage, keys });
    const rawBytes = new TextEncoder().encode(raw);
    if (rawBytes.length > MAX_RAW) fail('DESKTOP_RESOURCE_PREFERENCE_TOO_LARGE');
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      fail('SHARED_INVALID_PREFERENCE_JSON');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return readLocalStoragePreferences({ storage, keys });
    const match =
      typeof parsed.wallpaper === 'string' &&
      /^data:(image\/(?:png|jpeg|webp|gif|avif));base64,([A-Za-z0-9+/]*={0,2})$/.exec(
        parsed.wallpaper,
      );
    if (!match) {
      if (typeof parsed.wallpaper === 'string' && /^data:/i.test(parsed.wallpaper))
        fail('DESKTOP_RESOURCE_MIGRATION_REQUIRED');
      return readLocalStoragePreferences({ storage, keys });
    }
    if (match[2].length % 4 !== 0) fail('DESKTOP_RESOURCE_MIGRATION_REQUIRED');
    if (typeof resolveResource !== 'function') fail('DESKTOP_RESOURCE_MIGRATION_REQUIRED');
    let binary;
    try {
      const decoded = atob(match[2]);
      if (btoa(decoded) !== match[2]) fail('DESKTOP_RESOURCE_MIGRATION_REQUIRED');
      binary = Uint8Array.from(decoded, (c) => c.charCodeAt(0));
    } catch {
      fail('DESKTOP_RESOURCE_MIGRATION_REQUIRED');
    }
    const request = {
      key: KEY,
      sourceField: 'wallpaper',
      rawSha256: await digest(rawBytes),
      rawBytes: rawBytes.length,
      sha256: await digest(binary),
      size: binary.length,
      mime: match[1],
    };
    if (!validMetadata(request)) fail('DESKTOP_RESOURCE_METADATA_INVALID');
    const proof = await resolveResource(request);
    if (
      !proof ||
      proof.version !== 1 ||
      proof.scope !== 'desktop:thoughts' ||
      proof.key !== KEY ||
      proof.sourceField !== 'wallpaper' ||
      proof.field !== 'wallpaperAssetId' ||
      !uuid(proof.mediaId) ||
      !uuid(proof.operationId) ||
      !uuid(proof.libraryId) ||
      !uuid(proof.epoch) ||
      !/^[a-f0-9]{64}$/.test(proof.captureRawSha256 || '') ||
      !/^[a-f0-9]{64}$/.test(proof.sourceManifestSha256 || '') ||
      !/^[a-f0-9]{64}$/.test(proof.sourceMemberSha256 || '') ||
      ['rawSha256', 'rawBytes', 'sha256', 'size', 'mime'].some((key) => proof[key] !== request[key])
    )
      fail('DESKTOP_RESOURCE_PROOF_MISMATCH');
    if (parsed.wallpaperAssetId !== undefined && parsed.wallpaperAssetId !== proof.mediaId)
      fail('DESKTOP_RESOURCE_POINTER_CONFLICT');
    const value = { ...parsed, wallpaperAssetId: proof.mediaId };
    delete value.wallpaper;
    const projected = JSON.stringify(value);
    // Apply the unchanged generic reader to every key, including this one.
    const result = readLocalStoragePreferences({
      keys,
      storage: { getItem: (key) => (key === KEY ? projected : storage.getItem(key)) },
    });
    if (storage.getItem(KEY) !== raw) fail('DESKTOP_RESOURCE_PREFERENCE_CHANGED');
    return result;
  };
}
