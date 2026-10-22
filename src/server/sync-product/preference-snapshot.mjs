import { createHash } from 'node:crypto';
import { productRecord } from '../../../public/shared/sync-product.js';
import { portableConfiguration } from './migration-metadata.mjs';

export const PREFERENCE_SNAPSHOT_LIMITS = Object.freeze({
  bytes: 4 * 1024 * 1024,
  recordBytes: 950000,
  namespaces: 64,
  depth: 64,
  nodes: 100000,
});
const declarations = new Map([
  ['shiye.android.diary.presentation.v2', 'android-diary-presentation'],
  ['shiye.android.diary.entry-image-width.v1', 'android-diary-entry-image-width'],
  ['shiye.desktop.application.preferences.v1', 'desktop-application-preferences'],
  ['shiye.desktop.chat.presentation.v1', 'desktop-chat-presentation'],
  ['shiye.desktop.notes.presentation.v1', 'desktop-notes-presentation'],
]);
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (code) => {
  throw Object.assign(new Error(code), { code, status: code.includes('TOO_LARGE') ? 413 : 400 });
};
const hash = (value) => createHash('sha256').update(value).digest('hex');

// Reject non-JSON inputs before serialization: no getters, toJSON, sparse arrays,
// prototype classes, cycles, symbols, non-finite numbers or silent undefined loss.
function checkedJson(value) {
  const ancestors = new Set();
  let nodes = 0;
  let estimatedBytes = 0;
  const visit = (item, depth) => {
    if (++nodes > PREFERENCE_SNAPSHOT_LIMITS.nodes || depth > PREFERENCE_SNAPSHOT_LIMITS.depth)
      fail('PREFERENCE_SNAPSHOT_TOO_LARGE');
    if (item === null || typeof item === 'boolean') return item;
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) fail('PREFERENCE_SNAPSHOT_NOT_JSON');
      return item;
    }
    if (typeof item === 'string') {
      estimatedBytes += Buffer.byteLength(item);
      if (estimatedBytes > PREFERENCE_SNAPSHOT_LIMITS.bytes) fail('PREFERENCE_SNAPSHOT_TOO_LARGE');
      return item;
    }
    if (typeof item !== 'object') fail('PREFERENCE_SNAPSHOT_NOT_JSON');
    if (ancestors.has(item)) fail('PREFERENCE_SNAPSHOT_NOT_JSON');
    const array = Array.isArray(item);
    if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(item)))
      fail('PREFERENCE_SNAPSHOT_NOT_JSON');
    if (array && item.length > PREFERENCE_SNAPSHOT_LIMITS.nodes)
      fail('PREFERENCE_SNAPSHOT_TOO_LARGE');
    const keys = Reflect.ownKeys(item).filter((key) => !(array && key === 'length'));
    if (array && keys.length !== item.length) fail('PREFERENCE_SNAPSHOT_NOT_JSON');
    ancestors.add(item);
    const values = new Map();
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (
        typeof key !== 'string' ||
        !descriptor.enumerable ||
        !Object.hasOwn(descriptor, 'value') ||
        (array && !/^(?:0|[1-9][0-9]*)$/.test(key))
      )
        fail('PREFERENCE_SNAPSHOT_NOT_JSON');
      estimatedBytes += Buffer.byteLength(key);
      if (estimatedBytes > PREFERENCE_SNAPSHOT_LIMITS.bytes) fail('PREFERENCE_SNAPSHOT_TOO_LARGE');
      values.set(key, visit(descriptor.value, depth + 1));
    }
    ancestors.delete(item);
    return array
      ? Array.from({ length: item.length }, (_, index) => {
          if (!values.has(String(index))) fail('PREFERENCE_SNAPSHOT_NOT_JSON');
          return values.get(String(index));
        })
      : Object.fromEntries([...values].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  };
  const canonical = visit(value, 0);
  const bytes = Buffer.from(JSON.stringify(canonical));
  if (bytes.length > PREFERENCE_SNAPSHOT_LIMITS.bytes) fail('PREFERENCE_SNAPSHOT_TOO_LARGE');
  return { canonical, bytes };
}

/** Compile an explicitly collected logical snapshot. No storage reads, writes,
 * UI application, automatic source discovery or server revisions are involved. */
export function compilePreferenceSnapshot(snapshot) {
  const { canonical: input, bytes } = checkedJson(snapshot);
  if (!object(input) || input.format !== 'shiye-client-preferences' || input.version !== 1)
    fail('INVALID_PREFERENCE_SNAPSHOT_FORMAT');
  const allowed = new Set(['format', 'version', 'sourceId', 'revision', 'namespaces']);
  if (Object.keys(input).some((key) => !allowed.has(key)))
    fail('UNKNOWN_PREFERENCE_SNAPSHOT_FIELD');
  if (typeof input.sourceId !== 'string' || !/^[A-Za-z0-9_:@.-]{1,160}$/.test(input.sourceId))
    fail('INVALID_PREFERENCE_SOURCE_ID');
  if (!Number.isSafeInteger(input.revision) || input.revision < 1)
    fail('INVALID_PREFERENCE_SNAPSHOT_REVISION');
  if (!object(input.namespaces) || Object.keys(input.namespaces).length < 1)
    fail('PREFERENCE_NAMESPACES_REQUIRED');
  if (Object.keys(input.namespaces).length > PREFERENCE_SNAPSHOT_LIMITS.namespaces)
    fail('PREFERENCE_SNAPSHOT_TOO_LARGE');
  const excluded = [],
    records = [],
    fields = [];
  const sourceSha256 = hash(bytes);
  for (const [namespace, value] of Object.entries(input.namespaces)) {
    if (namespace.length > 160 || !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(namespace))
      fail('INVALID_PREFERENCE_NAMESPACE');
    if (!object(value) && !Array.isArray(value)) fail('PREFERENCE_NAMESPACE_OBJECT_REQUIRED');
    const values = portableConfiguration(value, { path: `namespaces.${namespace}`, excluded });
    const record = productRecord(
      'profile',
      `profile:preferences:${hash(JSON.stringify([input.sourceId, namespace]))}`,
      {
        scope: 'client-preferences',
        schema: 1,
        sourceId: input.sourceId,
        namespace,
        snapshotKind: 'preferences',
        snapshotRevision: input.revision,
        sourceSha256,
        values,
      },
    );
    record.data._product.readOnlyProjection = true;
    record.data._product.sourceSnapshot = {
      version: 1,
      kind: 'preferences',
      sourceId: input.sourceId,
    };
    if (Buffer.byteLength(JSON.stringify(record)) > PREFERENCE_SNAPSHOT_LIMITS.recordBytes)
      fail('PREFERENCE_RECORD_TOO_LARGE');
    records.push(record);
    fields.push({
      path: `namespaces.${namespace}`,
      disposition: 'preserved-read-only-preference-snapshot',
      declaration: declarations.get(namespace) || 'unknown-read-only',
      sourceFieldCount: Object.keys(value).length,
      portableFieldCount: Object.keys(values).length,
      automaticApplication: false,
    });
  }
  return {
    schema: 1,
    sourceId: input.sourceId,
    snapshotKind: 'preferences',
    snapshotRevision: input.revision,
    sourceSha256,
    records,
    coverage: {
      version: 1,
      fields,
      excluded,
      completeComputerExport: false,
      sourceScope: 'explicit-client-preference-namespaces-only',
      verification: 'logical-snapshot-compiled-not-applied',
      credentialFiltering: 'known-configuration-field-names-and-http-url-components-only',
      policy: { clientWallpaper: 'device-local', stickerMetadata: 'shared' },
      automaticApplication: false,
    },
    issues: [],
  };
}
