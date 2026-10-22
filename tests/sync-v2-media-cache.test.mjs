import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { createSyncServer } from '../src/server/sync-v2/server.mjs';
import { createSyncMediaCache } from '../public/shared/sync-v2-media-cache.js';
import { uploadAsset } from '../public/shared/sync-v2-media.js';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function fixture(t) {
  const temporaryRoot = path.resolve(import.meta.dirname, '../tmp/sync-backend');
  await mkdir(temporaryRoot, { recursive: true });
  const dataDir = await mkdtemp(path.join(temporaryRoot, 'media-cache-http-'));
  const service = await createSyncServer({ dataDir });
  service.server.listen(0, '127.0.0.1');
  await once(service.server, 'listening');
  t.after(() => service.close());
  const baseUrl = `http://127.0.0.1:${service.server.address().port}/`;
  const code = await (
    await fetch(`${baseUrl}api/sync/v1/local-pairing`, {
      method: 'POST',
      headers: { 'X-Sync-Client': 'local-admin' },
    })
  ).json();
  const paired = await (
    await fetch(`${baseUrl}api/sync/v1/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code.code, deviceName: 'isolated-media-cache' }),
    })
  ).json();
  return { baseUrl, token: paired.token, service };
}
async function inspectDatabase(indexedDB, name) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const result = await new Promise((resolve, reject) => {
    const tx = db.transaction(['records'], 'readonly');
    const request = tx.objectStore('records').getAll();
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () => reject(tx.error);
  });
  db.close();
  return result;
}

test('durable local original and pending task survive offline/reopen; connection credentials stay out of IDB', async (t) => {
  const remote = await fixture(t);
  const indexedDB = new IDBFactory();
  const dbName = 'shiye-sync-v2-cache-offline';
  const bytes = Buffer.from('offline-first original GIF-like fixture bytes');
  let offline = true;
  let fetches = 0;
  const fetchImpl = async (...args) => {
    fetches++;
    if (offline) throw new Error('Offline test');
    return fetch(...args);
  };
  let cache = await createSyncMediaCache({ indexedDB, dbName, ...remote, fetchImpl });
  t.after(async () => {
    await cache.close();
  });
  const local = await cache.add(new Blob([bytes], { type: 'image/gif' }), {
    assetId: 'local-offline',
  });
  assert.equal(fetches, 0);
  assert.equal(local.sha256, hash(bytes));
  assert.equal(local.uploadState, 'pending');
  assert.equal(local.localOriginal, true);
  const failed = await cache.sync();
  assert.equal(failed.pendingUploads, 1);
  assert.equal(failed.localOriginals, 1);
  assert.equal(failed.failed, 1);
  await cache.close();
  // No credentials supplied on reopen; the already-saved original/task remains.
  cache = await createSyncMediaCache({ indexedDB, dbName, fetchImpl });
  assert.deepEqual(Buffer.from(await (await cache.get('local-offline')).blob.arrayBuffer()), bytes);
  assert.equal((await cache.status()).pendingUploads, 1);
  assert.equal((await cache.sync()).items[0].error, 'CONNECTION_REQUIRED');
  const persisted = JSON.stringify(await inspectDatabase(indexedDB, dbName));
  assert.equal(persisted.includes(remote.token), false);
  assert.equal(persisted.includes(remote.baseUrl), false);
  offline = false;
  cache.setConnection({ baseUrl: remote.baseUrl, token: remote.token });
  const complete = await cache.sync();
  assert.equal(complete.pendingUploads, 0);
  assert.equal(complete.failed, 0);
  assert.equal(complete.items[0].uploadState, 'complete');
  assert.equal(remote.service.store.pull().changes.length, 1);
  const before = fetches;
  await cache.sync();
  assert.equal(fetches, before);
});

test('a second isolated cache downloads remote originals with verified bytes and keeps completed tasks across reopen', async (t) => {
  const remote = await fixture(t);
  const bytes = Uint8Array.from({ length: 400003 }, (_, index) => index % 251);
  await uploadAsset({
    ...remote,
    assetId: 'remote-video',
    bytes,
    mime: 'video/mp4',
    name: '原件.mp4',
  });
  const assets = remote.service.store.snapshot().entities;
  const indexedDB = new IDBFactory();
  const dbName = 'shiye-sync-v2-cache-download';
  let fetches = 0;
  const fetchImpl = (...args) => {
    fetches++;
    return fetch(...args);
  };
  let cache = await createSyncMediaCache({ indexedDB, dbName, ...remote, fetchImpl });
  t.after(async () => {
    await cache.close();
  });
  const complete = await cache.sync(assets);
  assert.equal(complete.pendingDownloads, 0);
  assert.equal(complete.localOriginals, 1);
  assert.equal(complete.items[0].uploadState, 'none');
  const original = await cache.get('remote-video');
  assert.equal(original.name, '原件.mp4');
  assert.equal(original.blob.type, 'video/mp4');
  assert.deepEqual(new Uint8Array(await original.blob.arrayBuffer()), bytes);
  await cache.close();
  cache = await createSyncMediaCache({ indexedDB, dbName, ...remote, fetchImpl });
  const before = fetches;
  await cache.sync(assets);
  assert.equal(fetches, before);
  assert.equal((await cache.status()).localOriginals, 1);
  assert.equal(remote.service.store.pull().changes.length, 1);
});

test('a corrupt downloaded original remains a persistent pending task and succeeds on retry', async (t) => {
  const remote = await fixture(t);
  const bytes = Buffer.from('unmodified original bytes must pass the metadata SHA-256');
  const asset = await uploadAsset({ ...remote, assetId: 'corrupt-download', bytes });
  const indexedDB = new IDBFactory();
  const dbName = 'shiye-sync-v2-cache-bad-download';
  let corrupt = true;
  const fetchImpl = async (url, options) => {
    const response = await fetch(url, options);
    if (!corrupt || !url.endsWith('/content')) return response;
    const corrupted = new Uint8Array(await response.arrayBuffer());
    corrupted[0] ^= 1;
    return new Response(corrupted, { status: 206 });
  };
  let cache = await createSyncMediaCache({ indexedDB, dbName, ...remote, fetchImpl });
  t.after(async () => {
    await cache.close();
  });
  const failed = await cache.sync([asset]);
  assert.equal(failed.pendingDownloads, 1);
  assert.equal(failed.localOriginals, 0);
  assert.equal((await cache.get(asset.assetId)).blob, null);
  await cache.close();
  corrupt = false;
  cache = await createSyncMediaCache({ indexedDB, dbName, ...remote, fetchImpl });
  const completed = await cache.sync();
  assert.equal(completed.pendingDownloads, 0);
  assert.equal(completed.failed, 0);
  assert.deepEqual(Buffer.from(await (await cache.get(asset.assetId)).blob.arrayBuffer()), bytes);
});

test('local original and upload record commit atomically; immutable IDs and isolated database names are enforced', async () => {
  const indexedDB = new IDBFactory();
  await assert.rejects(createSyncMediaCache({ indexedDB, dbName: 'Telegram-test' }), /isolated/);
  const cache = await createSyncMediaCache({ indexedDB, dbName: 'shiye-sync-v2-cache-atomic' });
  try {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'originals')
        throw new DOMException('Synthetic quota failure', 'QuotaExceededError');
      return put.apply(this, args);
    };
    try {
      await assert.rejects(cache.add(new Blob(['must not partly save']), { assetId: 'quota' }), {
        name: 'QuotaExceededError',
      });
    } finally {
      IDBObjectStore.prototype.put = put;
    }
    assert.equal(await cache.get('quota'), null);
    assert.equal((await cache.status()).total, 0);
    const first = await cache.add(new Blob(['original bytes']));
    assert.match(first.assetId, /^asset-[A-Za-z0-9_-]+$/);
    await assert.rejects(cache.add(new Blob(['different bytes']), { assetId: first.assetId }), {
      statusCode: 409,
    });
    assert.equal((await cache.get(first.assetId)).sha256, first.sha256);
    assert.equal((await cache.status()).total, 1);
    await assert.rejects(cache.add(new Blob(['path']), { assetId: '../bad' }), /Invalid assetId/);
  } finally {
    await cache.close();
  }
});

test('closing aborts network work while keeping the incomplete original download task durable', async () => {
  const indexedDB = new IDBFactory();
  const dbName = 'shiye-sync-v2-cache-close';
  let began;
  const started = new Promise((resolve) => {
    began = resolve;
  });
  const fetchImpl = (url, options) => {
    began();
    return new Promise((resolve, reject) => {
      options.signal.addEventListener(
        'abort',
        () => reject(new DOMException('Closed', 'AbortError')),
        { once: true },
      );
    });
  };
  const cache = await createSyncMediaCache({
    indexedDB,
    dbName,
    baseUrl: 'http://example.test/',
    token: 'not-persisted',
    fetchImpl,
  });
  const syncing = cache.sync([
    {
      assetId: 'closing-download',
      sha256: hash(Buffer.from('pending')),
      size: 7,
      mime: 'application/octet-stream',
    },
  ]);
  await started;
  await cache.close();
  await syncing;
  const reopened = await createSyncMediaCache({ indexedDB, dbName });
  try {
    assert.equal((await reopened.status()).pendingDownloads, 1);
    assert.equal((await reopened.get('closing-download')).blob, null);
  } finally {
    await reopened.close();
  }
});
