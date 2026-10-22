import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { openSyncStore } from '../src/server/sync-v2/store.mjs';
import {
  createSyncClient,
  createIndexedDbSyncStorage,
  normalizeSyncBaseUrl,
  createSyncOperationId,
} from '../public/shared/sync-v2-client.js';
import { createMemorySyncStorage } from './helpers/sync-v2-client-memory.mjs';

const clone = (v) => structuredClone(v);
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const edit = (changes, id = 'demo') => ({
  entityType: 'conversation',
  entityId: id,
  command: 'updateFields',
  changes,
});
function server() {
  let seq = 0;
  const api = {
    libraryId: 'library-demo',
    epoch: 'epoch-demo',
    rows: new Map(),
    changes: [],
    receipts: new Map(),
    requests: [],
    failAfterCommit: false,
    status: 200,
    beforePush: null,
    pushResult: null,
  };
  api.write = (data, id = 'demo', state = 'active') => {
    const entity = {
      entityType: 'conversation',
      entityId: id,
      revision: (api.rows.get(id)?.revision || 0) + 1,
      state,
      data: clone(data),
      lastSeq: ++seq,
      updatedAt: '2026-10-18T00:00:00Z',
    };
    api.rows.set(id, entity);
    api.changes.push({ seq, entity: clone(entity) });
    return entity;
  };
  api.fetch = async (url, options) => {
    const path = new URL(url).pathname.split('/').at(-1);
    const body = options.body ? JSON.parse(options.body) : undefined;
    api.requests.push({ url, body: clone(body), signal: options.signal, headers: options.headers });
    if (api.status !== 200)
      return { status: api.status, ok: false, json: async () => ({ error: { code: 'demo' } }) };
    const response = (value) => ({ status: 200, ok: true, json: async () => clone(value) });
    if (path === 'info')
      return response({ protocol: 1, libraryId: api.libraryId, epoch: api.epoch, seq });
    if (path === 'snapshot')
      return response({
        entities: [...api.rows.values()],
        hasMore: false,
        cursor: 'snapshot-only-cursor',
        checkpoint: seq,
      });
    if (path === 'pull')
      return response({
        changes: api.changes.filter((c) => c.seq > (body.cursor || 0)),
        cursor: seq,
        hasMore: false,
      });
    if (path === 'push') {
      if (api.beforePush) await api.beforePush(body, options);
      const results = body.operations.map((op) => {
        if (api.receipts.has(op.operationId)) {
          assert.deepEqual(api.receipts.get(op.operationId).op, op);
          return api.receipts.get(op.operationId).result;
        }
        const old = api.rows.get(op.entityId);
        const entity = api.write(
          op.command === 'create' ? op.data : { ...old?.data, ...op.changes },
          op.entityId,
          op.command === 'withdraw' ? 'withdrawn' : op.command === 'delete' ? 'deleted' : 'active',
        );
        const result = {
          operationId: op.operationId,
          status: 'accepted',
          entity,
          ...api.pushResult,
        };
        api.receipts.set(op.operationId, { op, result });
        return result;
      });
      if (api.failAfterCommit) {
        api.failAfterCommit = false;
        throw new Error('secret response/network data');
      }
      return response({ results, cursor: seq });
    }
    throw new Error('unexpected synthetic endpoint');
  };
  return api;
}
function setup(options = {}) {
  const api = options.api || server();
  const storage = options.storage || createMemorySyncStorage();
  const client = createSyncClient({
    baseUrl: 'http://lan.invalid:18766/prefix/',
    deviceId: 'device-demo',
    token: 'secret-token-demo',
    storage,
    fetchImpl: api.fetch,
    ...options,
  });
  return { api, storage, client };
}

test('URL prefix and Bearer work on LAN, Tailscale, public HTTPS; secrets stay out of URLs/state', async () => {
  for (const baseUrl of [
    'http://192.0.2.1:18766/prefix',
    'http://100.64.0.1:18766/',
    'https://cloud.invalid/reverse/proxy',
  ]) {
    const { client, api } = setup({ baseUrl });
    await client.sync();
    assert.equal(api.requests[0].url, `${normalizeSyncBaseUrl(baseUrl)}api/sync/v1/info`);
    assert.equal(api.requests[0].headers.Authorization, 'Bearer secret-token-demo');
    assert.ok(api.requests.every((r) => !r.url.includes('secret')));
    assert.ok(!JSON.stringify(client.status()).includes('secret'));
    assert.equal(
      api.requests.at(-1).body.cursor,
      0,
      'snapshot checkpoint is used instead of its paging token',
    );
  }
  for (const bad of [
    'file:///D:/demo',
    'https://user:password@host',
    'https://host/?token=secret',
    'https://host/#secret',
    'https://host/?',
    'https://host/\\other',
    'https://host/%2fother',
  ])
    assert.throws(() => normalizeSyncBaseUrl(bad));
});

test('local save persists objects, unknown richdoc fields, and outbox together across reopen', async () => {
  const { client, storage, api } = setup();
  const doc = { type: 'doc', content: [{ type: 'paragraph', attrs: { future: 8 } }] };
  await client.enqueue({
    ...edit({}),
    command: 'create',
    data: { title: 'fake', body: doc, unknown: { keep: true } },
  });
  const reopened = setup({ api, storage: createMemorySyncStorage(storage.persisted) }).client;
  assert.deepEqual((await reopened.read('conversation', 'demo')).data.body, doc);
  await reopened.sync();
  assert.equal(api.receipts.size, 1);
  assert.equal(storage.persisted.pending.size, 0);
  assert.deepEqual((await reopened.read('conversation', 'demo')).data.unknown, { keep: true });
});

test('lost ACK reuses immutable operation and id after reopen without duplicate business effect', async () => {
  const { client, api, storage } = setup();
  await client.edit(edit({ title: 'first' }));
  api.failAfterCommit = true;
  await client.sync();
  const wire = clone([...storage.persisted.pending.values()][0].wire);
  assert.equal(client.status().phase, 'retrying');
  assert.equal(api.receipts.size, 1);
  await client.edit(edit({ wallpaper: 'asset-fake' }));
  const reopened = setup({ api, storage: createMemorySyncStorage(storage.persisted) }).client;
  await reopened.sync();
  const sent = api.requests.filter((r) => r.body?.operations).map((r) => r.body.operations[0]);
  assert.deepEqual(sent[0], wire);
  assert.deepEqual(sent[1], wire);
  assert.equal(sent[2].baseRevision, 1);
  assert.equal(api.receipts.size, 2);
  assert.deepEqual((await reopened.read('conversation', 'demo')).data, {
    title: 'first',
    wallpaper: 'asset-fake',
  });
});

test('ACK while typing cannot clear a newer durable edit or overwrite its overlay', async () => {
  const { client, api, storage } = setup();
  const entered = deferred(),
    release = deferred();
  api.beforePush = async () => {
    entered.resolve();
    await release.promise;
    api.beforePush = null;
  };
  await client.edit(edit({ title: 'first' }));
  const syncing = client.sync();
  await entered.promise;
  await client.edit(edit({ title: 'second', future: 17 }));
  assert.equal((await client.read('conversation', 'demo')).data.title, 'second');
  release.resolve();
  await syncing;
  assert.equal(api.receipts.size, 2);
  assert.equal(storage.persisted.pending.size, 0);
  assert.equal((await client.read('conversation', 'demo')).data.title, 'second');
});

test('remote inbox keeps pending overlay and never generates an echo outbox', async () => {
  const { client, api, storage } = setup();
  api.write({ title: 'remote', unknown: 'kept' });
  await client.sync();
  assert.equal(api.receipts.size, 0);
  assert.equal(storage.persisted.pending.size, 0);
  await client.edit(edit({ wallpaper: 'local' }));
  api.status = 503;
  await client.sync();
  api.status = 200;
  api.write({ title: 'new remote', unknown: 'kept' });
  api.pushResult = { status: 'conflict', conflictId: 'conflict-demo' };
  await client.sync();
  const row = await client.read('conversation', 'demo');
  assert.equal(row.data.wallpaper, 'local');
  assert.equal(storage.persisted.pending.size, 1);
  assert.equal((await client.conflicts()).length, 1);
  const attempts = api.receipts.size;
  await client.sync();
  assert.equal(api.receipts.size, attempts);
});

test('same-field newest accepted conflict is recorded without blocking next edit', async () => {
  const { client, api, storage } = setup();
  api.pushResult = { conflict: true, conflictId: 'branch-demo' };
  await client.edit(edit({ title: 'newest' }));
  await client.edit(edit({ title: 'later' }));
  await client.sync();
  assert.equal((await client.read('conversation', 'demo')).data.title, 'later');
  assert.equal(storage.persisted.pending.size, 0);
  assert.equal((await client.conflicts()).length, 2);
});

test('single-flight sync and cancellation do not apply late responses', async () => {
  const { client, api, storage } = setup();
  const entered = deferred(),
    release = deferred();
  api.beforePush = async () => {
    entered.resolve();
    await release.promise;
  };
  await client.edit(edit({ title: 'saved' }));
  const first = client.sync(),
    second = client.sync();
  assert.equal(first, second);
  await entered.promise;
  client.stop();
  release.resolve();
  await first;
  assert.equal(client.status().phase, 'stopped');
  assert.equal(storage.persisted.pending.size, 1);
  assert.ok(api.requests.find((r) => r.body?.operations).signal.aborted);
  api.beforePush = null;
  await client.sync();
  assert.equal(api.receipts.size, 1);
  assert.equal(storage.persisted.pending.size, 0);
});

test('401 pauses automatic work without clearing data or retrying credentials', async () => {
  const { client, api, storage } = setup({ retryBaseMs: 1, pollMs: 1 });
  await client.edit(edit({ title: 'saved offline' }));
  api.status = 401;
  await client.start();
  const count = api.requests.length;
  await new Promise((r) => setTimeout(r, 12));
  assert.equal(api.requests.length, count);
  assert.equal(client.status().phase, 'paused');
  assert.equal(storage.persisted.pending.size, 1);
  api.status = 200;
  client.setToken('replacement-demo');
  await client.sync();
  client.stop();
  assert.equal(storage.persisted.pending.size, 0);
});

test('retry delay backs off and stop cancels scheduled retries', async () => {
  const { client, api } = setup({ retryBaseMs: 30, retryMaxMs: 100 });
  api.status = 503;
  await client.start();
  const first = client.status().retryAt - Date.now();
  await client.sync();
  const second = client.status().retryAt - Date.now();
  assert.ok(first <= 30 && first > 0);
  assert.ok(second > first);
  client.stop();
  const count = api.requests.length;
  await new Promise((r) => setTimeout(r, 110));
  assert.equal(api.requests.length, count);
});

test('changing address retains all state and verifies library/epoch before pushing', async () => {
  const { client, api, storage } = setup();
  await client.sync();
  await client.edit(edit({ title: 'private local' }));
  await client.setBaseUrl('https://same.invalid/prefix');
  await client.sync();
  assert.equal(api.receipts.size, 1);
  await client.edit(edit({ title: 'another edit' }));
  api.libraryId = 'different-library';
  await client.setBaseUrl('https://wrong.invalid/');
  const before = api.requests.length;
  await client.sync();
  assert.equal(client.status().error, 'server-identity-mismatch');
  assert.equal(api.requests.length, before + 1);
  assert.equal(storage.persisted.pending.size, 1);
  assert.equal((await client.read('conversation', 'demo')).data.title, 'another edit');
  api.libraryId = 'library-demo';
  api.epoch = 'restored-server';
  await client.setBaseUrl('http://lan.invalid/');
  await client.sync();
  assert.equal(client.status().error, 'server-identity-mismatch');
  assert.equal(storage.persisted.pending.size, 1);
});

test('unknown type blocks cursor commit and leaves complete page unapplied', async () => {
  const { client, api, storage } = setup({ supportedEntityTypes: ['conversation'] });
  api.rows.set('future', {
    entityType: 'future-schema',
    entityId: 'future',
    revision: 1,
    state: 'active',
    data: { fake: true },
  });
  await client.sync();
  assert.equal(client.status().error, 'unsupported-entity-type');
  assert.equal(storage.persisted.entities.size, 0);
  assert.equal(storage.persisted.meta.cursor, undefined);
});

test('remote withdrawal suppresses and removes queued private bodies without resurrection', async () => {
  const { client, api, storage } = setup();
  api.write({ text: 'fake body' });
  await client.sync();
  await client.edit(edit({ text: 'fake unsent edit' }));
  // Frozen request receives an authoritative withdrawal rather than a valid update.
  api.pushResult = {
    status: 'conflict',
    entity: {
      entityType: 'conversation',
      entityId: 'demo',
      revision: 20,
      state: 'withdrawn',
      data: {},
    },
  };
  await client.sync();
  assert.equal((await client.read('conversation', 'demo')).state, 'withdrawn');
  assert.deepEqual((await client.read('conversation', 'demo')).data, {});
  assert.equal(storage.persisted.pending.size, 0);
  await assert.rejects(client.edit(edit({ text: 'late' })), /entity-withdrawn/u);
});

test('IDB commits atomically, rolls back cursor with objects, reopens and preserves queue order', async () => {
  const indexedDB = new IDBFactory(),
    dbName = 'shiye-sync-v2-synthetic';
  let storage = createIndexedDbSyncStorage({ indexedDB, dbName });
  const { client, api } = setup({ storage });
  await client.edit(edit({ title: 'one' }));
  await client.edit(edit({ title: 'two' }));
  await assert.rejects(
    storage.transaction(async (tx) => {
      await tx.setMeta({ cursor: 99 });
      await tx.putEntity({
        entityType: 'conversation',
        entityId: 'rolled-back',
        local: { fake: true },
      });
      throw new Error('simulated-crash');
    }),
    /simulated-crash/u,
  );
  assert.equal(await storage.transaction((tx) => tx.getMeta()), undefined);
  assert.equal(await client.read('conversation', 'rolled-back'), null);
  await storage.close();
  storage = createIndexedDbSyncStorage({ indexedDB, dbName });
  const reopened = setup({ api, storage }).client;
  await reopened.sync();
  assert.equal((await reopened.read('conversation', 'demo')).data.title, 'two');
  assert.equal(api.receipts.size, 2);
  await storage.close();
  assert.throws(
    () => createIndexedDbSyncStorage({ indexedDB, dbName: 'existing-TL-database' }),
    /explicit-sync/u,
  );
});

test('operation identities do not need secure-context crypto APIs', () => {
  const ids = Array.from({ length: 100 }, () => createSyncOperationId(null));
  assert.equal(new Set(ids).size, 100);
  const fakeCrypto = { getRandomValues: (bytes) => bytes.fill(7) };
  assert.notEqual(createSyncOperationId(fakeCrypto), createSyncOperationId(fakeCrypto));
});

test('snapshot pages use one checkpoint and pull catches writes during the snapshot', async () => {
  const api = server();
  api.write({ title: 'a' }, 'a');
  api.write({ title: 'b' }, 'b');
  const initial = clone([...api.rows.values()]);
  const fetchImpl = async (url, options) => {
    if (!url.endsWith('/snapshot')) return api.fetch(url, options);
    const { cursor } = JSON.parse(options.body);
    if (cursor === null)
      return {
        ok: true,
        status: 200,
        json: async () => ({ entities: [initial[0]], cursor: 'snapshot-page-two', hasMore: true }),
      };
    assert.equal(cursor, 'snapshot-page-two');
    api.write({ title: 'changed during snapshot' }, 'a');
    api.write({ title: 'new during snapshot' }, 'c');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        entities: [initial[1]],
        cursor: 'snapshot-end',
        checkpoint: 2,
        hasMore: false,
      }),
    };
  };
  const { client, storage } = setup({ api, fetchImpl });
  await client.sync();
  assert.equal((await client.read('conversation', 'a')).data.title, 'changed during snapshot');
  assert.equal((await client.list()).length, 3);
  assert.equal(storage.persisted.meta.cursor, 4);
  assert.equal(api.requests.find((r) => r.url.endsWith('/pull')).body.cursor, 2);
});

test('partial snapshot resumes after reopen with persisted page cursor and seen identities', async () => {
  const api = server();
  api.write({ title: 'a' }, 'a');
  api.write({ title: 'b' }, 'b');
  const initial = clone([...api.rows.values()]);
  let fail = true;
  const fetchImpl = async (url, options) => {
    if (!url.endsWith('/snapshot')) return api.fetch(url, options);
    const { cursor } = JSON.parse(options.body);
    if (cursor === null)
      return {
        ok: true,
        status: 200,
        json: async () => ({ entities: [initial[0]], cursor: 'persisted-page', hasMore: true }),
      };
    if (fail) {
      fail = false;
      throw new Error('synthetic disconnect');
    }
    assert.equal(cursor, 'persisted-page');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        entities: [initial[1]],
        cursor: 'snapshot-end',
        checkpoint: 2,
        hasMore: false,
      }),
    };
  };
  const { client, storage } = setup({ api, fetchImpl });
  await client.sync();
  assert.equal(storage.persisted.meta.snapshotCursor, 'persisted-page');
  const reopened = setup({
    api,
    fetchImpl,
    storage: createMemorySyncStorage(storage.persisted),
  }).client;
  await reopened.sync();
  assert.equal((await reopened.list()).length, 2);
  assert.equal(storage.persisted.meta.snapshotCursor, undefined);
});

test('expired cursor requests resnapshot while keeping local pending edits and immutable wires', async () => {
  const api = server();
  let expired = false;
  const fetchImpl = async (url, options) => {
    if (expired && url.endsWith('/pull')) {
      expired = false;
      return { ok: false, status: 409, json: async () => ({ error: { code: 'CURSOR_EXPIRED' } }) };
    }
    return api.fetch(url, options);
  };
  const { client, storage } = setup({ api, fetchImpl });
  await client.sync();
  await client.edit(edit({ title: 'local draft retained' }));
  api.pushResult = { status: 'rejected' };
  expired = true;
  await client.sync();
  const original = clone([...storage.persisted.pending.values()][0]);
  assert.equal(client.status().error, 'resnapshot-required');
  assert.equal(storage.persisted.meta.initialized, false);
  await client.sync();
  assert.deepEqual([...storage.persisted.pending.values()][0], original);
  assert.equal((await client.read('conversation', 'demo')).data.title, 'local draft retained');
});

test('watch hook notifies without owning the cursor and is detached on stop', async () => {
  let notify,
    detached = 0;
  const { client, api } = setup({
    pollMs: 100000,
    watch: (hooks) => {
      notify = hooks.notify;
      return () => {
        detached++;
      };
    },
  });
  await client.start();
  api.write({ title: 'notified change' });
  notify();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal((await client.read('conversation', 'demo')).data.title, 'notified change');
  client.stop();
  assert.equal(detached, 1);
  const count = api.requests.length;
  notify();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(api.requests.length, count);
});

test('assets remain read-only server metadata while unknown fields are preserved', async () => {
  const { client } = setup();
  await assert.rejects(
    client.edit({
      entityType: 'asset',
      entityId: 'fake-asset',
      command: 'create',
      data: { hash: 'fake' },
    }),
    /server-owned/u,
  );
});

test('actual SQLite protocol accepts client wires, merges fields, and retains newest conflict branch', async (t) => {
  const testRoot = fileURLToPath(new URL('../tmp/sync-v2-client/', import.meta.url));
  await mkdir(testRoot, { recursive: true });
  const dataDir = await mkdtemp(path.join(testRoot, 'protocol-'));
  const store = await openSyncStore({ dataDir });
  t.after(() => store.close());
  let dropAck = false;
  const fetchImpl = async (url, options) => {
    const endpoint = new URL(url).pathname.split('/').at(-1);
    const body = options.body ? JSON.parse(options.body) : undefined;
    let result;
    if (endpoint === 'info') result = store.info();
    else if (endpoint === 'push') {
      result = store.push('device-demo', body.operations);
      if (dropAck) {
        dropAck = false;
        throw new Error('synthetic lost ACK');
      }
    } else result = store[endpoint](body);
    return { ok: true, status: 200, json: async () => clone(result) };
  };
  const first = setup({ fetchImpl }),
    second = setup({ fetchImpl });
  await first.client.edit({
    entityType: 'conversation',
    entityId: 'actual-demo',
    command: 'create',
    data: { title: 'base', wallpaper: 'original', unknown: { retain: true } },
  });
  dropAck = true;
  await first.client.sync();
  assert.equal(first.storage.persisted.pending.size, 1);
  await first.client.sync();
  assert.equal(first.storage.persisted.pending.size, 0);
  await second.client.sync();
  await first.client.edit(edit({ title: 'first edit' }, 'actual-demo'));
  await second.client.edit(edit({ wallpaper: 'second edit' }, 'actual-demo'));
  await first.client.sync();
  await second.client.sync();
  await first.client.sync();
  assert.deepEqual((await first.client.read('conversation', 'actual-demo')).data, {
    title: 'first edit',
    wallpaper: 'second edit',
    unknown: { retain: true },
  });
  await first.client.edit(edit({ title: 'older commit' }, 'actual-demo'));
  await second.client.edit(edit({ title: 'newest commit' }, 'actual-demo'));
  await first.client.sync();
  await second.client.sync();
  await first.client.sync();
  assert.equal(
    (await first.client.read('conversation', 'actual-demo')).data.title,
    'newest commit',
  );
  assert.equal((await second.client.conflicts()).length, 1);
  assert.equal(second.storage.persisted.pending.size, 0);
  assert.equal(
    store.listConflicts({ entityType: 'conversation', entityId: 'actual-demo' }).conflicts.length,
    1,
  );
});
