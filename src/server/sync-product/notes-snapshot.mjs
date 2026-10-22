import { createHash } from 'node:crypto';
import { productRecord } from '../../../public/shared/sync-product.js';
import { portableConfiguration } from './migration-metadata.mjs';

export const NOTES_SNAPSHOT_LIMITS = Object.freeze({
  maxJsonBytes: 48 * 1024 * 1024,
  maxAssetBytes: 20 * 1024 * 1024,
  maxTotalAssetBytes: 32 * 1024 * 1024,
  maxAssets: 2048,
  maxNodes: 200000,
  maxDepth: 128,
});
const digest = (value) => createHash('sha256').update(value).digest('hex');
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (code) => {
  throw Object.assign(new Error(code), { code, status: code.includes('TOO_LARGE') ? 413 : 400 });
};
const validId = (value) => typeof value === 'string' && /^[A-Za-z0-9_:@.-]{1,160}$/.test(value);
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : object(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;

function assetMetadata(asset, path, excluded) {
  function portable(value, location) {
    if (Array.isArray(value)) return value.map((child, i) => portable(child, `${location}[${i}]`));
    if (!object(value)) return value;
    const result = {};
    for (const [key, child] of Object.entries(value)) {
      const normalized = key.replace(/[_\-\s]/g, '').toLowerCase();
      const encoded = ['dataurl', 'base64', 'rawbytes', 'bytes', 'blob'].includes(normalized);
      const privateField =
        /(?:path|directory)$/.test(normalized) ||
        ['auth', 'rawprofile', 'withdrawalrecovery', 'withdrawalrecoveries'].includes(normalized);
      const privateValue =
        typeof child === 'string' &&
        (/^(?:[a-z]:[\\/]|\\\\|file:|blob:)/i.test(child) || /^data:.*;base64,/i.test(child));
      if (encoded || privateField || privateValue) {
        excluded.push({
          path: `${location}.${key}`,
          reason: encoded ? 'original-bytes-externalized' : 'device-or-private-metadata',
        });
      } else
        Object.defineProperty(result, key, {
          value: portable(child, `${location}.${key}`),
          enumerable: true,
        });
    }
    return result;
  }
  // A filename is literal business metadata, never interpreted as an endpoint URL.
  const { name, ...rest } = asset;
  return { ...portableConfiguration(portable(rest, path), { path, excluded }), name };
}

// Copy only inert JSON. Do not invoke getters, toJSON, or user-supplied callbacks.
function copyJson(input, limits) {
  let nodes = 0;
  let stringBytes = 0;
  const seen = new Set();
  function visit(value, depth) {
    if (++nodes > limits.maxNodes || depth > limits.maxDepth) fail('NOTES_JSON_TOO_LARGE');
    if (typeof value === 'string') {
      stringBytes += Buffer.byteLength(value);
      if (stringBytes > limits.maxJsonBytes) fail('NOTES_JSON_TOO_LARGE');
      return value;
    }
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (!object(value) && !Array.isArray(value)) fail('NOTES_INVALID_JSON');
    if (![Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(value)))
      fail('NOTES_INVALID_JSON');
    if (seen.has(value)) fail('NOTES_INVALID_JSON');
    seen.add(value);
    const result = Array.isArray(value) ? [] : {};
    const keys = Object.keys(value);
    if (
      Array.isArray(value) &&
      (keys.length !== value.length || keys.some((key, index) => key !== String(index)))
    )
      fail('NOTES_INVALID_JSON');
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!Object.hasOwn(descriptor, 'value')) fail('NOTES_INVALID_JSON');
      Object.defineProperty(result, key, {
        value: visit(descriptor.value, depth + 1),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    seen.delete(value);
    return result;
  }
  return visit(input, 0);
}

function readSnapshot(input, limits) {
  if (typeof input === 'string' || Buffer.isBuffer(input)) {
    if (Buffer.byteLength(input) > limits.maxJsonBytes) fail('NOTES_JSON_TOO_LARGE');
    try {
      const text = Buffer.isBuffer(input)
        ? new TextDecoder('utf-8', { fatal: true }).decode(input)
        : input;
      input = JSON.parse(text);
    } catch {
      fail('NOTES_INVALID_JSON');
    }
  }
  const snapshot = copyJson(input, limits);
  if (Buffer.byteLength(JSON.stringify(snapshot)) > limits.maxJsonBytes)
    fail('NOTES_JSON_TOO_LARGE');
  return snapshot;
}

/** Compile the existing UI rescue export, without applying preferences or defining Note schema. */
export function compileNotesSnapshot(input, options = {}) {
  const limits = { ...NOTES_SNAPSHOT_LIMITS };
  for (const key of Object.keys(limits)) {
    if (options.limits?.[key] !== undefined) {
      const value = options.limits[key];
      if (!Number.isSafeInteger(value) || value < 1 || value > limits[key])
        fail('NOTES_INVALID_LIMIT');
      limits[key] = value;
    }
  }
  const sourceId = options.sourceId;
  if (!validId(sourceId)) fail('NOTES_SOURCE_ID_REQUIRED');
  const snapshot = readSnapshot(input, limits);
  // Actual exportDrafts currently has experimental:true and no version field.
  if (
    !object(snapshot) ||
    snapshot.kind !== 'shiye-notes-ui-snapshot' ||
    (snapshot.version !== undefined && snapshot.version !== 1) ||
    (snapshot.version === undefined && snapshot.experimental !== true)
  )
    fail('NOTES_INVALID_FORMAT');
  if (typeof snapshot.exportedAt !== 'string' || !Number.isFinite(Date.parse(snapshot.exportedAt)))
    fail('NOTES_INVALID_EXPORTED_AT');
  const workspace = snapshot.workspace;
  if (
    !object(workspace) ||
    !Array.isArray(workspace.notes) ||
    !Array.isArray(workspace.openIds) ||
    (workspace.closedIds !== undefined && !Array.isArray(workspace.closedIds)) ||
    !Array.isArray(snapshot.assets)
  )
    fail('NOTES_INVALID_WORKSPACE');
  const snapshotRevision = workspace.revision ?? options.snapshotRevision;
  if (!Number.isSafeInteger(snapshotRevision) || snapshotRevision < 0)
    fail('NOTES_REVISION_REQUIRED');
  if (
    workspace.revision !== undefined &&
    options.snapshotRevision !== undefined &&
    options.snapshotRevision !== workspace.revision
  )
    fail('NOTES_REVISION_CONFLICT');
  const noteIds = new Set();
  for (const note of workspace.notes) {
    if (!object(note) || !validId(note.id) || noteIds.has(note.id)) fail('NOTES_INVALID_NOTE_ID');
    noteIds.add(note.id);
  }
  for (const id of [...workspace.openIds, ...(workspace.closedIds || [])])
    if (!noteIds.has(id)) fail('NOTES_INVALID_TAB_REFERENCE');
  if (
    workspace.activeId !== null &&
    workspace.activeId !== undefined &&
    !noteIds.has(workspace.activeId)
  )
    fail('NOTES_INVALID_TAB_REFERENCE');
  if (snapshot.assets.length > limits.maxAssets) fail('NOTES_ASSETS_TOO_LARGE');
  const mapping = [];
  const assets = [];
  const excluded = [];
  const bySourceId = new Map();
  let totalBytes = 0;
  for (const [index, asset] of snapshot.assets.entries()) {
    if (!object(asset) || !validId(asset.id) || bySourceId.has(asset.id))
      fail('NOTES_INVALID_ASSET_ID');
    if (
      typeof asset.name !== 'string' ||
      typeof asset.type !== 'string' ||
      typeof asset.dataUrl !== 'string'
    )
      fail('NOTES_INVALID_ASSET');
    const match = /^data:([a-zA-Z0-9!#$&^_.+\/-]*);base64,([A-Za-z0-9+/]*={0,2})$/.exec(
      asset.dataUrl,
    );
    if (!match || match[2].length % 4 || !match[2].length) fail('NOTES_INVALID_BASE64');
    const mime = (match[1] || 'application/octet-stream').toLowerCase();
    if (mime.length > 200 || !/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(mime))
      fail('NOTES_INVALID_ASSET_MIME');
    if (asset.type && asset.type.toLowerCase() !== mime) fail('NOTES_ASSET_MIME_MISMATCH');
    const size =
      (match[2].length / 4) * 3 - (match[2].endsWith('==') ? 2 : match[2].endsWith('=') ? 1 : 0);
    totalBytes += size;
    if (size > limits.maxAssetBytes || totalBytes > limits.maxTotalAssetBytes)
      fail('NOTES_ASSETS_TOO_LARGE');
    const bytes = Buffer.from(match[2], 'base64');
    if (bytes.length !== size || bytes.toString('base64') !== match[2])
      fail('NOTES_INVALID_BASE64');
    const sha256 = digest(bytes);
    if (asset.size !== undefined && asset.size !== size) fail('NOTES_ASSET_SIZE_MISMATCH');
    if (asset.sha256 !== undefined && asset.sha256 !== sha256) fail('NOTES_ASSET_HASH_MISMATCH');
    if (asset.id.startsWith('sha256:') && asset.id !== `sha256:${sha256}`)
      fail('NOTES_ASSET_HASH_MISMATCH');
    const assetId = `notes-asset-${digest(JSON.stringify([sourceId, asset.id, sha256]))}`;
    bySourceId.set(asset.id, assetId);
    mapping.push({
      sourceAssetId: asset.id,
      assetId,
      sha256,
      size,
      sourceMetadata: assetMetadata(asset, `assets[${index}]`, excluded),
    });
    assets.push({ assetId, sha256, size, mime, name: asset.name, bytes });
  }
  // Keep original workspace IDs verbatim; transport mapping resolves every resource separately.
  const required = new Set();
  function references(value) {
    if (typeof value === 'string' && (/^blob:/i.test(value) || /^data:.*;base64,/i.test(value)))
      fail('NOTES_NONPORTABLE_INLINE_RESOURCE');
    if (!value || typeof value !== 'object') return;
    if (['image', 'video'].includes(value.type) && !value.attrs?.assetId)
      fail('NOTES_MISSING_ASSET');
    for (const [key, child] of Object.entries(value)) {
      if (key === 'assetId' && child !== null && child !== '') {
        if (!validId(child) || !bySourceId.has(child)) fail('NOTES_MISSING_ASSET');
        required.add(child);
      }
      references(child);
    }
  }
  references(workspace);
  const snapshotId = `notes-snapshot:${digest(JSON.stringify([sourceId, snapshotRevision]))}`;
  const sourceSha256 = digest(
    JSON.stringify(
      canonical({
        schema: 1,
        sourceId,
        snapshotKind: 'notes',
        snapshotRevision,
        workspace,
        assetMapping: [...mapping].sort((a, b) =>
          a.assetId < b.assetId ? -1 : a.assetId > b.assetId ? 1 : 0,
        ),
        assets: assets
          .map(({ bytes: _bytes, ...asset }) => asset)
          .sort((a, b) => (a.assetId < b.assetId ? -1 : a.assetId > b.assetId ? 1 : 0)),
      }),
    ),
  );
  const record = productRecord(
    'profile',
    `profile:notes:${digest(sourceId)}`,
    {
      schema: 1,
      scope: 'notes-workspace-snapshot',
      sourceId,
      snapshotId,
      snapshotRevision,
      snapshotKind: 'notes',
      workspace,
      assetMapping: mapping,
    },
    { assets: assets.map((asset) => asset.assetId) },
  );
  record.data._product.readOnlyProjection = true;
  record.data._product.sourceSnapshot = { version: 1, kind: 'notes', sourceId };
  return {
    schema: 1,
    sourceId,
    snapshotKind: 'notes',
    snapshotRevision,
    sourceSha256,
    captureInfo: { exportedAt: snapshot.exportedAt },
    records: [record],
    assets,
    coverage: {
      sourceKind: snapshot.kind,
      formatVersion: snapshot.version ?? null,
      disposition: 'preserved-read-only-snapshot',
      noteCount: workspace.notes.length,
      assetCount: assets.length,
      requiredAssetCount: required.size,
      totalAssetBytes: totalBytes,
      portableSnapshotComplete: true,
      completeComputerExport: false,
      appliesPreferences: false,
      productionNoteSchema: false,
      participatesInRevisit: false,
      excluded,
    },
    issues: [],
  };
}
