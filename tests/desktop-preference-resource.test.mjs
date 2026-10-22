import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import {
  createDesktopPreferenceResourceReader,
  createDesktopPreferenceResourceResolver,
  DESKTOP_PREFERENCE_RESOURCE_ACTION,
} from '../public/shared/desktop-preference-resource.js';
import { readLocalStoragePreferences } from '../public/shared/shared-preference-capture.js';
import { startDesktopDirectoryPort } from '../previews/telegram-chat/shiye-shared-directory-port.js';
const key = 'shiye-preview-appearance-v1';
function fixture(size = 870000) {
  const image = Buffer.alloc(size, 3),
    raw = JSON.stringify({
      wallpaper: 'data:image/png;base64,' + image.toString('base64'),
      showSendButton: false,
      unknown: { futureFlag: false, values: [1, 2, 3] },
    });
  const values = { [key]: raw, other: 'false' };
  const storage = { getItem: (k) => values[k] ?? null };
  const mediaId = randomUUID(),
    operationId = randomUUID(),
    libraryId = randomUUID(),
    epoch = randomUUID();
  const resolveResource = async (request) => ({
    version: 1,
    scope: 'desktop:thoughts',
    field: 'wallpaperAssetId',
    mediaId,
    operationId,
    libraryId,
    epoch,
    captureRawSha256: createHash('sha256').update(raw).digest('hex'),
    sourceMemberSha256: 'a'.repeat(64),
    sourceManifestSha256: 'b'.repeat(64),
    ...request,
  });
  return {
    raw,
    values,
    storage,
    resolveResource,
    sourceId: randomUUID(),
    owner: { libraryId, epoch },
    source: {
      operationId,
      captureRelativePath: 'synthetic/capture',
      captureManifestSha256: 'b'.repeat(64),
    },
    keys: [{ key, json: true }, 'other'],
  };
}
test('only the known verified legacy resource is projected; false/unknown/sparse values and original raw remain intact', async () => {
  const f = fixture();
  let metadata;
  const reader = createDesktopPreferenceResourceReader({
    ...f,
    resolveResource: async (input) => {
      metadata = input;
      return f.resolveResource(input);
    },
  });
  assert.throws(() => readLocalStoragePreferences(f), { code: 'SHARED_PREFERENCES_TOO_LARGE' });
  const result = await reader();
  assert.equal(result[key].showSendButton, false);
  assert.equal(result[key].unknown.futureFlag, false);
  assert.deepEqual(result[key].unknown.values, [1, 2, 3]);
  assert.equal(result.other, 'false');
  assert.equal(result[key].wallpaper, undefined);
  assert.ok(result[key].wallpaperAssetId);
  assert.equal(f.values[key], f.raw);
  assert.deepEqual(Object.keys(metadata).sort(), [
    'key',
    'mime',
    'rawBytes',
    'rawSha256',
    'sha256',
    'size',
    'sourceField',
  ]);
  assert.ok(!JSON.stringify(metadata).includes('base64'));
});

test('continuous data port automatically uses the resource reader and keeps an unchanged projected capture idempotent', async () => {
  const f = fixture(),
    cache = new Map(),
    writes = [];
  const client = {
    sync: async () => {},
    readCache: async (key) => cache.get(key) ?? null,
    writeCache: async (key, value) => cache.set(key, value),
    read: async () => null,
    enqueue: async (row) => {
      writes.push(row);
      cache.set(row.localCacheCommit.scope, row.localCacheCommit.value);
    },
    readOperation: async () => ({ status: 'acknowledged', result: { revision: 1 } }),
  };
  const port = startDesktopDirectoryPort({
    client,
    directory: { list: async () => ({ rooms: [], order: [], revision: 0 }) },
    readSnapshot: async () => ({
      sourceId: f.sourceId,
      rooms: {},
      dialogs: { active: [], archived: [] },
      order: [],
    }),
    preferenceStorage: f.storage,
    preferenceResource: {
      owner: f.owner,
      source: f.source,
      request: async (action, input) => {
        assert.equal(action, DESKTOP_PREFERENCE_RESOURCE_ACTION);
        return f.resolveResource(input.request);
      },
    },
    BroadcastChannel: null,
    events: null,
    pollMs: 0,
  });
  try {
    await port.ready;
    await port.collect();
  } finally {
    port.stop();
  }
  assert.equal(writes.length, 1);
  assert.equal(writes[0].action, 'client-preferences-save');
  assert.equal(writes[0].input.set[key].showSendButton, false);
  assert.equal(writes[0].input.set[key].wallpaper, undefined);
  assert.ok(!JSON.stringify(writes[0]).includes('base64'));
  assert.equal(f.storage.getItem(key), f.raw);
});

test('small known data URLs require the same explicit proof and unknown inline formats never silently lose the old image', async () => {
  const f = fixture(64);
  await assert.rejects(
    createDesktopPreferenceResourceReader({ ...f, resolveResource: undefined }),
    { code: 'DESKTOP_RESOURCE_MIGRATION_REQUIRED' },
  );
  const value = await createDesktopPreferenceResourceReader(f)();
  assert.ok(value[key].wallpaperAssetId);
  assert.equal(value[key].showSendButton, false);
  assert.equal(f.values[key], f.raw);
  f.values[key] = JSON.stringify({
    wallpaper: 'data:image/svg+xml;base64,PHN2Zy8+',
    showSendButton: false,
  });
  await assert.rejects(createDesktopPreferenceResourceReader(f), {
    code: 'DESKTOP_RESOURCE_MIGRATION_REQUIRED',
  });
  assert.ok(f.values[key].includes('data:image/svg+xml'));
});

test('ordinary pointer/false preferences retain the original generic reader and unselected keys are not inspected', async () => {
  const f = fixture();
  f.values[key] = 'false';
  assert.equal(
    (
      await createDesktopPreferenceResourceReader({
        ...f,
        resolveResource: () => {
          throw Error('unexpected resolver');
        },
      })()
    )[key],
    false,
  );
  f.values[key] = JSON.stringify({
    wallpaperAssetId: randomUUID(),
    showSendButton: false,
    unknown: { future: false },
  });
  const value = await createDesktopPreferenceResourceReader({
    ...f,
    resolveResource: () => {
      throw Error('unexpected resolver');
    },
  })();
  assert.deepEqual(value[key], JSON.parse(f.values[key]));
  assert.deepEqual(
    await createDesktopPreferenceResourceReader({
      ...f,
      keys: ['other'],
      storage: {
        getItem: (name) => {
          assert.equal(name, 'other');
          return 'false';
        },
      },
    })(),
    { other: 'false' },
  );
});

test('fixed resource resolver binds owner/source and sends only bounded metadata to one action', async () => {
  const f = fixture(),
    calls = [];
  const resolver = createDesktopPreferenceResourceResolver({
    owner: f.owner,
    source: f.source,
    request: async (action, input) => {
      calls.push({ action, input });
      return f.resolveResource(input.request);
    },
  });
  await createDesktopPreferenceResourceReader({ ...f, resolveResource: resolver })();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, DESKTOP_PREFERENCE_RESOURCE_ACTION);
  assert.ok(JSON.stringify(calls[0]).length < 2048);
  assert.ok(!JSON.stringify(calls[0]).includes('base64'));
  await assert.rejects(resolver({ ...calls[0].input.request, raw: f.raw }), {
    code: 'DESKTOP_RESOURCE_METADATA_INVALID',
  });
  assert.equal(calls.length, 1);
  const wrongOwner = createDesktopPreferenceResourceResolver({
    owner: f.owner,
    source: f.source,
    request: async (_action, input) => ({
      ...(await f.resolveResource(input.request)),
      libraryId: randomUUID(),
    }),
  });
  await assert.rejects(
    createDesktopPreferenceResourceReader({ ...f, resolveResource: wrongOwner }),
    { code: 'DESKTOP_RESOURCE_PROOF_MISMATCH' },
  );
  assert.throws(
    () =>
      createDesktopPreferenceResourceResolver({
        request() {},
        owner: f.owner,
        source: { ...f.source, captureRelativePath: '../capture' },
      }),
    { code: 'DESKTOP_RESOURCE_RESOLVER_INVALID' },
  );
  assert.equal(f.values[key], f.raw);
});
test('missing/stale/wrong resource proofs and local races preserve the old image and reject instead of silently omitting the key', async () => {
  const f = fixture();
  await assert.rejects(
    createDesktopPreferenceResourceReader({ ...f, resolveResource: undefined }),
    { code: 'DESKTOP_RESOURCE_MIGRATION_REQUIRED' },
  );
  await assert.rejects(
    createDesktopPreferenceResourceReader({
      ...f,
      resolveResource: async (q) => ({ ...(await f.resolveResource(q)), sha256: 'c'.repeat(64) }),
    }),
    { code: 'DESKTOP_RESOURCE_PROOF_MISMATCH' },
  );
  await assert.rejects(
    createDesktopPreferenceResourceReader({
      ...f,
      resolveResource: async (q) => {
        const proof = await f.resolveResource(q);
        f.values[key] = f.raw + ' ';
        return proof;
      },
    }),
    { code: 'DESKTOP_RESOURCE_PREFERENCE_CHANGED' },
  );
  assert.ok(f.values[key].includes('data:image/png;base64,'));
});
test('generic limits remain in force for unknown large data and oversized non-resource appearance fields', async () => {
  const f = fixture();
  f.values.other = 'x'.repeat(300000);
  await assert.rejects(createDesktopPreferenceResourceReader(f), {
    code: 'SHARED_PREFERENCES_TOO_LARGE',
  });
  f.values.other = 'false';
  const value = JSON.parse(f.raw);
  value.future = 'x'.repeat(300000);
  f.values[key] = JSON.stringify(value);
  await assert.rejects(createDesktopPreferenceResourceReader(f), {
    code: 'SHARED_PREFERENCES_TOO_LARGE',
  });
});

test('data port retains the complete local image and does not enqueue a preference replacement when owner receipt is missing', async () => {
  const f = fixture(),
    writes = [];
  const client = {
    sync: async () => {},
    readCache: async () => null,
    writeCache: async () => {},
    read: async () => null,
    enqueue: async (row) => writes.push(row),
  };
  const port = startDesktopDirectoryPort({
    client,
    directory: { list: async () => ({ rooms: [], order: [], revision: 0 }) },
    readSnapshot: async () => ({
      sourceId: f.sourceId,
      rooms: {},
      dialogs: { active: [], archived: [] },
      order: [],
    }),
    preferenceStorage: f.storage,
    preferenceResource: {
      owner: f.owner,
      source: f.source,
      request: async () => {
        throw Object.assign(Error('No real collection receipt'), {
          code: 'SOURCE_RESOURCE_RECEIPT_REQUIRED',
        });
      },
    },
    BroadcastChannel: null,
    events: null,
    pollMs: 0,
  });
  try {
    await assert.rejects(port.ready, { code: 'SOURCE_RESOURCE_RECEIPT_REQUIRED' });
  } finally {
    port.stop();
  }
  assert.equal(writes.filter((row) => row.action === 'client-preferences-save').length, 0);
  assert.equal(f.values[key], f.raw);
});
