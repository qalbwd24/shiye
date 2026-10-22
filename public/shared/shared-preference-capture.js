/** Explicit portable setting collection. Never applies remote values or enumerates
 * localStorage, and never uses this sanitizer for messages, diary bodies or drafts.
 */
const fail = (code) => {
  throw Object.assign(Error(code), { code });
};
const normalize = (key) => key.replace(/[_\-\s]/g, '').toLowerCase();
const privateNames = new Set(
  'password passwd secret token authToken accessToken refreshToken apiKey privateKey encryptionKey pairingKey cookie credentials sessionCookie authorization clientSecret sessionToken secretKey bearerToken window windowPosition windowSize displays dpi deviceId localPath filePath absolutePath downloadDirectory stateDirectory profileDirectory sourceArchives rawArchive archiveBytes backupBytes wallpaper wallpaperUrl roomBackgrounds listBackground chatBackground activation activated runtime libraryId epoch shiye-shared-runtime-v1 draft drafts historyDraft historyDrafts readingPositions'
    .split(' ')
    .map(normalize),
);
const directoryNames = new Set(['pinIds', 'pins', 'order', 'roomOrder']);
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const scopes = new Set([
  'shared:thoughts',
  'desktop:thoughts',
  'android:thoughts',
  'android:diary',
]);

export function portablePreferences(values) {
  const excluded = [],
    seen = new Set();
  let nodes = 0;
  function visit(value, path, depth) {
    if (++nodes > 30000 || depth > 24) fail('SHARED_PREFERENCES_TOO_LARGE');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))
        fail('SHARED_INVALID_PREFERENCES');
      return value;
    }
    if (typeof value === 'string') {
      if (value.length > 256 * 1024) fail('SHARED_PREFERENCES_TOO_LARGE');
      if (/^(?:file:|blob:|data:|[a-z]:[\\/]|\\\\)/i.test(value)) {
        excluded.push({ path, reason: 'device-resource' });
        return undefined;
      }
      if (/^https?:\/\//i.test(value)) {
        let url;
        try {
          url = new URL(value);
        } catch {
          fail('SHARED_INVALID_PREFERENCES');
        }
        if (
          url.username ||
          url.password ||
          [...url.searchParams.keys()].some((key) => privateNames.has(normalize(key)))
        ) {
          excluded.push({ path, reason: 'credential-url' });
          return undefined;
        }
      }
      return value;
    }
    if (
      !value ||
      typeof value !== 'object' ||
      (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) ||
      seen.has(value)
    )
      fail('SHARED_INVALID_PREFERENCES');
    seen.add(value);
    let result;
    if (Array.isArray(value))
      result = value.map((item, index) => visit(item, `${path}[${index}]`, depth + 1) ?? null);
    else {
      result = {};
      for (const [key, item] of Object.entries(value)) {
        const location = path ? `${path}.${key}` : key;
        if (privateNames.has(normalize(key)) || (depth === 0 && directoryNames.has(key))) {
          excluded.push({
            path: location,
            reason: directoryNames.has(key) ? 'shared-directory-owner' : 'device-or-private',
          });
          continue;
        }
        if (item === undefined) {
          excluded.push({ path: location, reason: 'non-json-undefined' });
          continue;
        }
        const next = visit(item, location, depth + 1);
        if (next !== undefined)
          Object.defineProperty(result, key, { value: next, enumerable: true });
      }
    }
    seen.delete(value);
    return result;
  }
  if (!object(values) || Object.getPrototypeOf(values) !== Object.prototype)
    fail('SHARED_INVALID_PREFERENCES');
  const value = visit(values, '', 0);
  if (JSON.stringify(value).length > 256 * 1024) fail('SHARED_PREFERENCES_TOO_LARGE');
  return { value, excluded };
}

/** The known list is the only storage access boundary. JSON-backed namespaces
 * preserve object/array/scalar types; String()-backed setting keys remain strings.
 * Invalid JSON aborts capture rather than interpreting corruption as deletion.
 */
export function readLocalStoragePreferences({ storage = globalThis.localStorage, keys = [] } = {}) {
  const result = {};
  if (!storage?.getItem) fail('SHARED_PREFERENCES_STORAGE_UNAVAILABLE');
  for (const spec of keys) {
    const key = typeof spec === 'string' ? spec : spec.key;
    if (typeof key !== 'string' || !key || key.length > 256) fail('SHARED_INVALID_PREFERENCE_KEY');
    const raw = storage.getItem(key);
    if (raw === null) continue;
    if (typeof raw !== 'string' || raw.length > 256 * 1024) fail('SHARED_PREFERENCES_TOO_LARGE');
    let value = raw;
    if (typeof spec === 'object' && spec.json) {
      try {
        value = JSON.parse(raw);
      } catch {
        fail('SHARED_INVALID_PREFERENCE_JSON');
      }
    }
    Object.defineProperty(result, key, { value, enumerable: true });
  }
  return result;
}

/** client owns the transaction: cache checkpoint and immutable outbox are written
 * together. A pending checkpoint resumes its original op before a newer capture.
 */
export function createSharedPreferenceCapture({
  client,
  scope,
  keys,
  storage,
  localReader = keys ? () => readLocalStoragePreferences({ storage, keys }) : undefined,
  idFactory = () => crypto.randomUUID(),
} = {}) {
  if (!scopes.has(scope) || !client?.enqueue || !client?.readCache)
    fail('SHARED_INVALID_PREFERENCE_CAPTURE');
  const cacheScope = `preference-capture:${scope}`;
  let running;
  async function collect(explicit) {
    const input = explicit === undefined ? await localReader?.() : explicit;
    const { value: local, excluded } = portablePreferences(input);
    await client.sync();
    let previous = await client.readCache(cacheScope);
    if (previous?.operationId) {
      const receipt = await client.readOperation(previous.operationId);
      if (!receipt || receipt.status === 'recovered')
        return {
          conflicts: [
            {
              domain: 'preferences',
              code: 'SHARED_PREFERENCE_CHECKPOINT_REQUIRES_RECONCILIATION',
              operationId: previous.operationId,
            },
          ],
          pending: [],
          excluded,
        };
      if (receipt.status !== 'acknowledged')
        return { conflicts: [], pending: [previous.operationId], excluded };
      const pendingCheckpoint = previous;
      previous = {
        local: previous.local,
        revision: receipt.result?.revision ?? previous.revision + 1,
      };
      await client.writeCache(cacheScope, previous, pendingCheckpoint);
    }
    const row = await client.read('client-preferences', scope);
    const remote = row?.local?.data || { revision: 0, values: {} };
    const changed = Object.keys(local).filter(
      (key) => !previous || !equal(local[key], previous.local[key]),
    );
    const remove = previous
      ? Object.keys(previous.local).filter(
          (key) =>
            !Object.hasOwn(local, key) &&
            !excluded.some(
              (item) =>
                item.path === key ||
                item.path.startsWith(key + '.') ||
                item.path.startsWith(key + '['),
            ),
        )
      : [];
    if (previous && (changed.length || remove.length) && remote.revision !== previous.revision)
      return {
        conflicts: [{ domain: 'preferences', code: 'SHARED_REMOTE_PREFERENCES_CHANGED' }],
        pending: [],
        excluded,
      };
    if (
      !previous &&
      changed.some(
        (key) => Object.hasOwn(remote.values, key) && !equal(remote.values[key], local[key]),
      )
    )
      return {
        conflicts: [
          { domain: 'preferences', code: 'SHARED_EXISTING_PREFERENCES_REQUIRES_RECONCILIATION' },
        ],
        pending: [],
        excluded,
      };
    if (!changed.length && !remove.length) {
      await client.writeCache(cacheScope, { local, revision: remote.revision }, previous);
      return { conflicts: [], pending: [], excluded };
    }
    const operationId = idFactory();
    const checkpoint = { local, revision: remote.revision, operationId };
    await client.enqueue({
      operationId,
      action: 'client-preferences-save',
      input: {
        scope,
        expectedRevision: remote.revision,
        set: Object.fromEntries(changed.map((key) => [key, local[key]])),
        remove,
      },
      localCacheCommit: { scope: cacheScope, expectedValue: previous, value: checkpoint },
    });
    await client.sync();
    const receipt = await client.readOperation(operationId);
    if (receipt.status !== 'acknowledged')
      return { conflicts: [], pending: [operationId], excluded };
    // Keep the pending checkpoint until next capture; its ACK is independently
    // durable. A crash here therefore cannot turn the same local change into a new op.
    return { conflicts: [], pending: [], excluded };
  }
  return {
    capture(values) {
      if (!running)
        running = collect(values).finally(() => {
          running = null;
        });
      return running;
    },
  };
}
