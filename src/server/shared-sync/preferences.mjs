import { portableConfiguration } from '../sync-product/migration-metadata.mjs';
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const fail = (status, code) => {
  throw Object.assign(new Error(code), { status, code });
};
/** Portable, inert UI configuration lives in the same library. Explicit patch
 * semantics preserve fields not understood by an older desktop/Android client.
 */
export function saveSharedClientPreferences(db, input) {
  if (
    !object(input) ||
    Object.keys(input).some((k) => !['scope', 'expectedRevision', 'set', 'remove'].includes(k)) ||
    !['shared:thoughts', 'desktop:thoughts', 'android:thoughts', 'android:diary'].includes(
      input.scope,
    ) ||
    !Number.isSafeInteger(input.expectedRevision) ||
    input.expectedRevision < 0 ||
    !object(input.set) ||
    !Array.isArray(input.remove || []) ||
    input.remove?.some((k) => typeof k !== 'string') ||
    JSON.stringify(input.set).length > 262144
  )
    fail(400, 'SHARED_INVALID_PREFERENCES');
  const safe = portableConfiguration(input.set);
  if (JSON.stringify(safe) !== JSON.stringify(input.set)) fail(400, 'SHARED_PRIVATE_PREFERENCES');
  const registry = db.sharedClientPreferences || { version: 1, profiles: [] };
  if (registry.version !== 1 || !Array.isArray(registry.profiles))
    fail(409, 'SHARED_PREFERENCES_SCHEMA');
  const prior = registry.profiles.find((row) => row.scope === input.scope);
  if ((prior?.revision || 0) !== input.expectedRevision) fail(409, 'SHARED_PREFERENCES_CONFLICT');
  if (prior?.revision === Number.MAX_SAFE_INTEGER) fail(409, 'SHARED_REVISION_EXHAUSTED');
  const values = structuredClone(prior?.values || {});
  for (const [key, value] of Object.entries(safe))
    Object.defineProperty(values, key, {
      value: structuredClone(value),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  for (const key of input.remove || []) delete values[key];
  if (JSON.stringify(values).length > 524288) fail(413, 'SHARED_PREFERENCES_CAPACITY');
  const next = { scope: input.scope, revision: (prior?.revision || 0) + 1, values };
  db.sharedClientPreferences = {
    ...registry,
    profiles: prior
      ? registry.profiles.map((row) => (row.scope === input.scope ? next : row))
      : [...registry.profiles, next],
  };
  return structuredClone(next);
}
