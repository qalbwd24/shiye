import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { IDBFactory } from 'fake-indexeddb';
import { createSyncServer } from '../src/server/sync-v2/server.mjs';
import {
  createIndexedDbSyncStorage,
  createSyncClient,
  createSyncOperationId,
} from '../public/shared/sync-v2-client.js';
import { fromEditorJSON } from '../public/shared/rich-document.js';

async function fixture(t, { basePath = '/' } = {}) {
  const root = fileURLToPath(new URL('../tmp/sync-backend/', import.meta.url));
  await mkdir(root, { recursive: true });
  const dataDir = await mkdtemp(path.join(root, 'client-http-'));
  const service = await createSyncServer({
    dataDir,
    basePath,
    allowedOrigins: ['http://editor.invalid'],
    watchTimeoutMs: 500,
  });
  await new Promise((resolve, reject) => {
    service.server.once('error', reject);
    service.server.listen(0, '127.0.0.1', resolve);
  });
  const baseUrl = `http://127.0.0.1:${service.server.address().port}${basePath}`;
  t.after(() => service.close());
  const code = service.auth.pairingCode({ uses: 2 }).code;
  async function device(name, options = {}) {
    const response = await fetch(new URL('api/sync/v1/pair', baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, deviceName: name }),
    });
    assert.equal(response.status, 201);
    const credentials = await response.json();
    const indexedDB = new IDBFactory();
    const dbName = `shiye-sync-v2-http-${name}`;
    let storage = createIndexedDbSyncStorage({ indexedDB, dbName });
    t.after(() => storage.close());
    const clientOptions = {
      baseUrl,
      deviceId: credentials.deviceId,
      token: credentials.token,
      storage,
      pageLimit: 1,
      ...options,
    };
    let client = createSyncClient(clientOptions);
    t.after(() => client.stop());
    return {
      credentials,
      indexedDB,
      dbName,
      get storage() {
        return storage;
      },
      get client() {
        return client;
      },
      async reopen() {
        client.stop();
        await storage.close();
        storage = createIndexedDbSyncStorage({ indexedDB, dbName });
        client = createSyncClient({ ...clientOptions, storage });
        return client;
      },
    };
  }
  return { service, baseUrl, device };
}
const create = (entityType, entityId, data) => ({ entityType, entityId, command: 'create', data });
const edit = (entityType, entityId, changes) => ({
  entityType,
  entityId,
  command: 'updateFields',
  changes,
});

test('real HTTP paired devices synchronize paged richdoc/category/conversation data through a proxy prefix', async (t) => {
  const { device } = await fixture(t, { basePath: '/reverse/sync/' });
  const desktop = await device('desktop'),
    phone = await device('phone');
  const body = fromEditorJSON(
    {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { indent: 2 },
          content: [{ type: 'text', text: 'Synthetic rich text', marks: [{ type: 'bold' }] }],
        },
        {
          type: 'blockquote',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Synthetic quote' }] }],
        },
      ],
    },
    createSyncOperationId,
  );
  await desktop.client.edit(
    create('journalAggregate', 'entry-demo', {
      title: 'demo',
      body,
      contentFormat: 'richdoc',
      unknownEnvelope: { futureVersion: 7 },
    }),
  );
  await desktop.client.edit(
    create('taxonomy', 'category-demo', { name: 'category original', color: '#ccddee' }),
  );
  await desktop.client.edit(
    create('conversation', 'room-demo', { title: 'room original', wallpaper: 'asset-original' }),
  );
  await desktop.client.sync();
  await phone.client.sync();
  assert.deepEqual((await phone.client.read('journalAggregate', 'entry-demo')).data.body, body);
  assert.equal((await phone.client.list()).length, 3);
  const updatedBody = structuredClone(body);
  updatedBody.content[0].content[0].text = 'Synthetic phone edit';
  await phone.client.edit(edit('journalAggregate', 'entry-demo', { body: updatedBody }));
  await desktop.client.edit(edit('journalAggregate', 'entry-demo', { title: 'desktop metadata' }));
  await phone.client.edit(edit('taxonomy', 'category-demo', { color: '#ffeedd' }));
  await desktop.client.edit(edit('taxonomy', 'category-demo', { name: 'category renamed' }));
  await phone.client.edit(edit('conversation', 'room-demo', { wallpaper: 'asset-new' }));
  await desktop.client.edit(edit('conversation', 'room-demo', { title: 'room renamed' }));
  await desktop.client.sync();
  await phone.client.sync();
  await desktop.client.sync();
  for (const item of [desktop, phone]) {
    const entry = await item.client.read('journalAggregate', 'entry-demo');
    assert.deepEqual(entry.data.body, updatedBody);
    assert.equal(entry.data.title, 'desktop metadata');
    assert.deepEqual(entry.data.unknownEnvelope, { futureVersion: 7 });
    assert.deepEqual((await item.client.read('taxonomy', 'category-demo')).data, {
      name: 'category renamed',
      color: '#ffeedd',
    });
    assert.deepEqual((await item.client.read('conversation', 'room-demo')).data, {
      title: 'room renamed',
      wallpaper: 'asset-new',
    });
    assert.equal((await item.storage.transaction((tx) => tx.listPending())).length, 0);
  }
  await phone.reopen();
  assert.deepEqual(
    (await phone.client.read('journalAggregate', 'entry-demo')).data.body,
    updatedBody,
  );
  await phone.client.sync();
  assert.equal((await phone.client.list()).length, 3);
});

test('real HTTP lost ACK persists immutable wire across IDB reopen; newest accepted version keeps a recoverable branch', async (t) => {
  const { device, baseUrl } = await fixture(t);
  let dropAck = false;
  const sentOperations = [];
  const desktop = await device('desktop', {
    fetchImpl: async (url, options) => {
      const response = await fetch(url, options);
      if (url.endsWith('/push')) {
        sentOperations.push(JSON.parse(options.body).operations[0]);
        if (dropAck) {
          dropAck = false;
          await response.json();
          throw new Error('synthetic ACK loss');
        }
      }
      return response;
    },
  });
  const phone = await device('phone');
  await desktop.client.edit(create('conversation', 'room-demo', { title: 'base' }));
  dropAck = true;
  await desktop.client.sync();
  assert.equal(desktop.client.status().phase, 'retrying');
  assert.equal((await desktop.storage.transaction((tx) => tx.listPending())).length, 1);
  await desktop.reopen();
  await desktop.client.sync();
  assert.deepEqual(sentOperations[0], sentOperations[1]);
  assert.equal((await desktop.storage.transaction((tx) => tx.listPending())).length, 0);
  await phone.client.sync();
  await desktop.client.edit(edit('conversation', 'room-demo', { title: 'older accepted' }));
  await phone.client.edit(edit('conversation', 'room-demo', { title: 'newest accepted' }));
  await desktop.client.sync();
  await phone.client.sync();
  await desktop.client.sync();
  assert.equal(
    (await desktop.client.read('conversation', 'room-demo')).data.title,
    'newest accepted',
  );
  assert.equal((await phone.client.list('conversation')).length, 1);
  const conflicts = await phone.client.conflicts();
  assert.equal(conflicts.length, 1);
  const response = await fetch(
    new URL(`api/sync/v1/conflicts/${encodeURIComponent(conflicts[0].conflictId)}`, baseUrl),
    { headers: { Authorization: `Bearer ${phone.credentials.token}` } },
  );
  assert.equal(response.status, 200);
  const branch = await response.json();
  assert.equal(branch.remote.data.title, 'older accepted');
  assert.equal(branch.local.changes.title, 'newest accepted');
  assert.equal((await phone.storage.transaction((tx) => tx.listPending())).length, 0);
});

test('real HTTP watch notifies the client without advancing its persisted cursor and aborts on stop', async (t) => {
  const { device, baseUrl } = await fixture(t);
  const desktop = await device('desktop');
  let watcher,
    notifications = 0,
    notificationDone;
  const notified = new Promise((resolve) => {
    notificationDone = resolve;
  });
  const phone = await device('phone', {
    pollMs: 100000,
    watch: ({ notify }) => {
      const controller = new AbortController();
      watcher = controller;
      void (async () => {
        const { cursor } = await phone.storage.transaction((tx) => tx.getMeta());
        const url = new URL('api/sync/v1/watch', baseUrl);
        url.searchParams.set('cursor', cursor);
        url.searchParams.set('timeout', '500');
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${phone.credentials.token}` },
          signal: controller.signal,
        });
        const data = await response.json();
        if (data.changed) {
          assert.equal((await phone.storage.transaction((tx) => tx.getMeta())).cursor, cursor);
          notifications++;
          notify();
          notificationDone();
        }
      })().catch((error) => {
        if (!controller.signal.aborted) notificationDone(error);
      });
      return () => controller.abort();
    },
  });
  await phone.client.sync();
  await phone.client.start();
  await desktop.client.edit(create('conversation', 'notified-room', { title: 'watch event' }));
  await desktop.client.sync();
  const failure = await notified;
  if (failure) throw failure;
  await phone.client.sync();
  assert.equal(notifications, 1);
  assert.equal(
    (await phone.client.read('conversation', 'notified-room')).data.title,
    'watch event',
  );
  phone.client.stop();
  assert.equal(watcher.signal.aborted, true);
});

test('real HTTP revoked device pauses with durable edits retained; browser preflight allows client headers', async (t) => {
  const { device, service, baseUrl } = await fixture(t);
  const desktop = await device('desktop');
  await desktop.client.sync();
  await desktop.client.edit(create('conversation', 'offline-room', { title: 'local only' }));
  service.auth.revoke(desktop.credentials.deviceId);
  await desktop.client.sync();
  assert.equal(desktop.client.status().phase, 'paused');
  assert.equal(desktop.client.status().error, 'authentication-required');
  assert.equal((await desktop.storage.transaction((tx) => tx.listPending())).length, 1);
  assert.equal(
    (await desktop.client.read('conversation', 'offline-room')).data.title,
    'local only',
  );
  assert.equal(JSON.stringify(desktop.client.status()).includes(desktop.credentials.token), false);
  const preflight = await fetch(new URL('api/sync/v1/info', baseUrl), {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://editor.invalid',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'authorization,content-type,x-sync-device-id',
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), 'http://editor.invalid');
  assert.ok(
    preflight.headers
      .get('Access-Control-Allow-Headers')
      .toLowerCase()
      .includes('x-sync-device-id'),
  );
});
