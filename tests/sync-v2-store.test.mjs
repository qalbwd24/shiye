import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { openSyncStore } from '../src/server/sync-v2/store.mjs';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'tmp',
  'sync-backend',
  'store-tests',
);
async function fixture(t) {
  const dataDir = path.join(root, randomUUID());
  await mkdir(dataDir, { recursive: true });
  const store = await openSyncStore({ dataDir, clock: () => 1792281600000 });
  t.after(() => store.close());
  return { store, dataDir };
}
const create = (id, data = {}, entityType = 'conversation') => ({
  operationId: randomUUID(),
  entityType,
  entityId: id,
  baseRevision: 0,
  command: 'create',
  data,
});
const update = (id, revision, changes, entityType = 'conversation') => ({
  operationId: randomUUID(),
  entityType,
  entityId: id,
  baseRevision: revision,
  command: 'updateFields',
  changes,
});
const state = (id, revision, command, entityType = 'conversation') => ({
  operationId: randomUUID(),
  entityType,
  entityId: id,
  baseRevision: revision,
  command,
});
const push = (store, op, device = 'desktop') => store.push(device, [op]).results[0];

test('sync v1 independent clients append stable identities and preserve unknown content', async (t) => {
  const { store } = await fixture(t);
  const source = {
    body: { format: 'shiye-richdoc', version: 1, content: [] },
    legacy: { futureSchema: ['kept'] },
    eventTime: '2025-01-01T00:00:00Z',
  };
  assert.equal(push(store, create('desktop-msg', source, 'chatMessage')).status, 'accepted');
  assert.equal(
    push(store, create('phone-msg', { content: '手机' }, 'chatMessage'), 'phone').status,
    'accepted',
  );
  assert.deepEqual(store.getEntity('chatMessage', 'desktop-msg').data, source);
  assert.equal(store.pull().changes.length, 2);
  assert.equal(store.info().seq, 2);
});

test('sync v1 preserves original Entry identity and business revision inside the sync envelope', async (t) => {
  const { store } = await fixture(t);
  const original = {
    id: 'legacy-entry-id',
    revision: 42,
    title: '原篇',
    createdAt: '2025-01-01T00:00:00Z',
    body: { format: 'shiye-richdoc', version: 1, content: [] },
  };
  const first = push(store, create('sync-journal-id', original, 'journalAggregate'));
  assert.equal(first.status, 'accepted');
  assert.equal(first.entity.revision, 1);
  assert.deepEqual(first.entity.data, original);
  const second = push(
    store,
    update('sync-journal-id', 1, { revision: 43, title: '业务版号更新' }, 'journalAggregate'),
  );
  assert.equal(second.entity.revision, 2);
  assert.equal(second.entity.data.revision, 43);
  assert.equal(second.entity.data.id, 'legacy-entry-id');
});

test('sync v1 stale different fields merge without overwriting unknown data', async (t) => {
  const { store } = await fixture(t);
  push(store, create('room', { title: '原名', wallpaper: 'old', custom: 9 }));
  push(store, update('room', 1, { title: '电脑改名' }));
  const result = push(store, update('room', 1, { wallpaper: 'phone-wallpaper' }), 'phone');
  assert.equal(result.status, 'accepted');
  assert.equal(result.conflict, undefined);
  assert.deepEqual(result.entity.data, {
    title: '电脑改名',
    wallpaper: 'phone-wallpaper',
    custom: 9,
  });
});

test('sync v1 body conflicts choose later server commit and retain both originals as a branch', async (t) => {
  const { store } = await fixture(t);
  push(store, create('journal', { title: '原篇', body: { text: '共同基准' } }, 'journalAggregate'));
  push(store, update('journal', 1, { body: { text: '电脑正文' } }, 'journalAggregate'));
  const result = push(
    store,
    update('journal', 1, { body: { text: '手机正文' } }, 'journalAggregate'),
    'phone',
  );
  assert.equal(result.status, 'accepted');
  assert.equal(result.conflict, true);
  assert.equal(result.resolvedBy, 'server-commit-order');
  assert.deepEqual(result.entity.data.body, { text: '手机正文' });
  const branch = store.getConflict(result.conflictId);
  assert.equal(branch.remote.data.body.text, '电脑正文');
  assert.equal(branch.local.changes.body.text, '手机正文');
  assert.equal(branch.base.data.body.text, '共同基准');
  assert.equal(store.snapshot().entities.length, 1);
  assert.equal(store.listConflicts({ entityId: 'journal' }).conflicts.length, 1);
  const restored = push(
    store,
    update('journal', 3, { body: branch.remote.data.body }, 'journalAggregate'),
  );
  assert.equal(restored.entity.revision, 4);
  assert.equal(restored.entity.data.body.text, '电脑正文');
});

test('sync v1 alternate body projections are one conflict domain', async (t) => {
  const { store } = await fixture(t);
  push(
    store,
    create('journal', { body: { text: 'base' }, contentFormat: 'richdoc' }, 'journalAggregate'),
  );
  push(store, update('journal', 1, { body: { text: 'desktop' } }, 'journalAggregate'));
  const result = push(
    store,
    update('journal', 1, { content: '<p>phone</p>', contentFormat: 'html' }, 'journalAggregate'),
    'phone',
  );
  assert.equal(result.conflict, true);
  assert.equal(store.getConflict(result.conflictId).resolvedBy, 'server-commit-order');
});

test('sync v1 immutable operation retry returns same receipt and different request throws 409', async (t) => {
  const { store } = await fixture(t);
  const op = create('room', { title: 'test' });
  const first = push(store, op);
  assert.deepEqual(push(store, { ...op, data: { title: 'test' } }), first);
  assert.equal(store.info().seq, 1);
  assert.throws(() => push(store, { ...op, data: { title: 'different' } }), {
    status: 409,
    code: 'OPERATION_ID_REUSED',
  });
  assert.equal(store.info().seq, 1);
});

test('sync v1 withdrawals clear changes, versions, receipt replay and conflict branches', async (t) => {
  const { store } = await fixture(t);
  const original = create('msg', { content: 'PRIVATE-BASE' }, 'chatMessage');
  push(store, original);
  push(store, update('msg', 1, { content: 'PRIVATE-DESKTOP' }, 'chatMessage'));
  const conflicted = push(
    store,
    update('msg', 1, { content: 'PRIVATE-PHONE' }, 'chatMessage'),
    'phone',
  );
  assert.equal(conflicted.conflict, true);
  assert.equal(push(store, state('msg', 1, 'withdraw', 'chatMessage')).entity.state, 'withdrawn');
  for (const response of [
    store.pull(),
    store.snapshot(),
    push(store, original),
    store.getConflict(conflicted.conflictId),
    store.listConflicts(),
    store.getEntity('chatMessage', 'msg'),
  ]) {
    assert.equal(JSON.stringify(response).includes('PRIVATE-'), false);
  }
  assert.equal(
    push(store, create('msg', { content: 'late' }, 'chatMessage'), 'phone').error.code,
    'TOMBSTONE_FINAL',
  );
  assert.equal(push(store, state('msg', 4, 'restore', 'chatMessage')).status, 'rejected');
  assert.equal(store.getEntity('chatMessage', 'msg').state, 'withdrawn');
});

test('sync v1 tombstones precede delayed creates and same-batch withdrawal redacts earlier receipts', async (t) => {
  const { store } = await fixture(t);
  push(store, state('not-here', 0, 'withdraw', 'chatMessage'));
  assert.equal(
    push(store, create('not-here', { content: 'delayed' }, 'chatMessage')).error.code,
    'TOMBSTONE_FINAL',
  );
  const results = store.push('desktop', [
    create('batch-msg', { content: 'PRIVATE-BATCH' }, 'chatMessage'),
    state('batch-msg', 1, 'withdraw', 'chatMessage'),
  ]);
  assert.equal(JSON.stringify(results).includes('PRIVATE-BATCH'), false);
});

test('sync v1 long-document delete retains content only for explicit recovery and stale edits conflict', async (t) => {
  const { store } = await fixture(t);
  push(store, create('journal', { body: { text: 'recoverable' } }, 'journalAggregate'));
  const deletion = push(store, state('journal', 1, 'delete', 'journalAggregate'));
  assert.deepEqual(deletion.entity.data, {});
  assert.equal(JSON.stringify(store.pull()).includes('recoverable'), false);
  assert.equal(
    push(store, update('journal', 1, { body: { text: 'offline' } }, 'journalAggregate'), 'phone')
      .status,
    'conflict',
  );
  const recovered = push(store, state('journal', 2, 'restore', 'journalAggregate'));
  assert.equal(recovered.entity.data.body.text, 'recoverable');
  assert.equal(recovered.entity.revision, 3);
});

test('sync v1 pull pages retain versions at a fixed watermark while writes continue', async (t) => {
  const { store } = await fixture(t);
  for (const id of ['a', 'b', 'c']) push(store, create(id, { title: `old-${id}` }));
  const first = store.pull({ limit: 1 });
  push(store, update('b', 1, { title: 'new-b' }));
  push(store, create('d', { title: 'new-d' }));
  const second = store.pull({ cursor: first.cursor, limit: 1 });
  const third = store.pull({ cursor: second.cursor, limit: 1 });
  assert.equal(second.changes[0].entity.data.title, 'old-b');
  assert.equal(third.hasMore, false);
  assert.deepEqual(
    [first, second, third].flatMap((page) => page.changes.map((change) => change.seq)),
    [1, 2, 3],
  );
  assert.deepEqual(
    store.pull({ cursor: third.cursor }).changes.map((change) => change.seq),
    [4, 5],
  );
});

test('sync v1 initial snapshot pagination is fixed and checkpoint bridges subsequent writes', async (t) => {
  const { store } = await fixture(t);
  for (const id of ['a', 'b', 'c']) push(store, create(id, { title: `old-${id}` }));
  const first = store.snapshot({ limit: 1 });
  push(store, update('b', 1, { title: 'new-b' }));
  push(store, create('d'));
  const second = store.snapshot({ cursor: first.cursor, limit: 1 });
  const third = store.snapshot({ cursor: second.cursor, limit: 1 });
  assert.equal(second.entities[0].data.title, 'old-b');
  assert.equal(third.hasMore, false);
  assert.deepEqual(
    [first, second, third].flatMap((page) => page.entities.map((entity) => entity.entityId)),
    ['a', 'b', 'c'],
  );
  assert.deepEqual(
    store.pull({ cursor: third.checkpoint }).changes.map((change) => change.entity.entityId),
    ['b', 'd'],
  );
});

test('sync v1 withdrawal during existing pull/snapshot pages overrides old watermark plaintext', async (t) => {
  const { store } = await fixture(t);
  push(store, create('first'));
  push(store, create('msg', { content: 'PRIVATE-PAGE' }, 'chatMessage'));
  const initialPull = store.pull({ limit: 1 });
  const initialSnapshot = store.snapshot({ limit: 1 });
  push(store, state('msg', 1, 'withdraw', 'chatMessage'));
  const pullPage = store.pull({ cursor: initialPull.cursor });
  const snapshotPage = store.snapshot({ cursor: initialSnapshot.cursor });
  assert.equal(JSON.stringify([pullPage, snapshotPage]).includes('PRIVATE-PAGE'), false);
  assert.equal(snapshotPage.entities[0].state, 'withdrawn');
});

test('sync v1 database identity, commits, receipts and cursor signatures survive reopen', async (t) => {
  const { store, dataDir } = await fixture(t);
  const op = create('room', { title: 'persisted' });
  push(store, op);
  const identity = store.info();
  const receipt = push(store, op);
  store.close();
  const reopened = await openSyncStore({ dataDir });
  t.after(() => reopened.close());
  assert.equal(reopened.info().libraryId, identity.libraryId);
  assert.equal(reopened.info().epoch, identity.epoch);
  assert.deepEqual(push(reopened, op), receipt);
  assert.equal(reopened.pull({ cursor: identity.cursor }).changes.length, 0);
  assert.equal(reopened.getEntity('conversation', 'room').data.title, 'persisted');
});

test('sync v1 cursor scope, malformed cursor and limits reject without mutation', async (t) => {
  const { store } = await fixture(t);
  const other = (await fixture(t)).store;
  assert.throws(() => store.pull({ cursor: other.info().cursor }), {
    status: 409,
    code: 'RESNAPSHOT_REQUIRED',
  });
  assert.throws(() => store.pull({ cursor: 'garbage' }), { status: 400, code: 'INVALID_CURSOR' });
  assert.throws(() => store.pull({ cursor: store.snapshot().cursor }), { code: 'INVALID_CURSOR' });
  assert.throws(() => store.snapshot({ limit: 201 }), { code: 'INVALID_LIMIT' });
  assert.equal(store.info().seq, 0);
});

test('sync v1 envelope, server-owned fields, JSON sizes and paths are strictly validated', async (t) => {
  const { store } = await fixture(t);
  for (const op of [
    create('bad/id'),
    create('ok', {}, 'serviceOutput'),
    create('asset', {}, 'asset'),
    create('owned', { serverRevision: 4 }),
    create('runtime', { cursor: 'fake' }, 'serviceConfig'),
    { ...create('extra'), execute: 'anything' },
    create('big', { text: 'x'.repeat(1024 * 1024) }),
  ])
    assert.equal(push(store, op).status, 'rejected');
  assert.throws(() => push(store, create('path', { localPath: 'C:\\private' })), {
    code: 'DEVICE_LOCAL_FIELD',
  });
  assert.throws(() => push(store, create('number', { value: NaN })), { code: 'INVALID_JSON' });
  assert.throws(() => store.push('desktop', Array(101).fill(create('too-many'))), {
    code: 'INVALID_BATCH',
  });
  assert.equal(store.info().seq, 0);
});

test('sync v1 trusted asset publication is durable, idempotent and in both change feeds', async (t) => {
  const { store } = await fixture(t);
  const asset = {
    assetId: 'media-1',
    sha256: 'a'.repeat(64),
    size: 4,
    mime: 'image/gif',
    name: '图.gif',
  };
  assert.equal(store.publishAsset(asset).entityType, 'asset');
  assert.deepEqual(store.publishAsset(asset), store.getEntity('asset', 'media-1'));
  assert.equal(store.info().seq, 1);
  assert.equal(store.pull().changes[0].operationId, `media-ready:media-1:${asset.sha256}`);
  assert.equal(store.snapshot().entities[0].data.mime, 'image/gif');
  assert.throws(() => store.publishAsset({ ...asset, sha256: 'b'.repeat(64) }), {
    status: 409,
    code: 'ASSET_ID_REUSED',
  });
  const longMime = `application/${'x'.repeat(180)}`;
  assert.equal(
    store.publishAsset({ ...asset, assetId: 'media-long-mime', mime: longMime }).data.mime,
    longMime,
  );
});

test('sync v1 receipt failure rolls back entity, version and change in the same transaction', async (t) => {
  const { store, dataDir } = await fixture(t);
  const inspector = new DatabaseSync(path.join(dataDir, 'sync.sqlite'));
  t.after(() => inspector.close());
  inspector.exec(
    "CREATE TRIGGER force_receipt_failure BEFORE INSERT ON receipts BEGIN SELECT RAISE(ABORT,'receipt fault'); END",
  );
  const op = create('atomic');
  assert.throws(() => push(store, op), /receipt fault/);
  assert.equal(store.info().seq, 0);
  assert.equal(store.getEntity('conversation', 'atomic'), null);
  assert.equal(inspector.prepare('SELECT COUNT(*) AS n FROM versions').get().n, 0);
  inspector.exec('DROP TRIGGER force_receipt_failure');
  assert.equal(push(store, op).entity.lastSeq, 1);
});

test('sync v1 concurrent SQLite writers commit one durable sequence without missing operations', async (t) => {
  const { store, dataDir } = await fixture(t);
  const moduleUrl = new URL('../src/server/sync-v2/store.mjs', import.meta.url).href;
  const work = (deviceId) =>
    new Promise((resolve, reject) => {
      const worker = new Worker(
        `
      const { parentPort, workerData } = require('node:worker_threads');
      (async () => {
        const { openSyncStore } = await import(workerData.moduleUrl);
        const store = await openSyncStore({dataDir:workerData.dataDir});
        try {
          for (let n=0; n<12; n++) {
            store.push(workerData.deviceId,[{operationId:workerData.deviceId+'-op-'+n,entityType:'conversation',entityId:workerData.deviceId+'-room-'+n,baseRevision:0,command:'create',data:{title:workerData.deviceId}}]);
          }
          parentPort.postMessage('done');
        } finally { store.close(); }
      })().catch(error => { throw error; });
    `,
        { eval: true, workerData: { moduleUrl, dataDir, deviceId } },
      );
      worker.once('error', reject);
      worker.once('exit', (code) =>
        code === 0 ? resolve() : reject(new Error(`Writer exited ${code}`)),
      );
    });
  await Promise.all([work('desktop'), work('phone')]);
  assert.equal(store.info().seq, 24);
  const changes = store.pull().changes;
  assert.deepEqual(
    changes.map((change) => change.seq),
    Array.from({ length: 24 }, (_, i) => i + 1),
  );
  assert.equal(new Set(changes.map((change) => change.operationId)).size, 24);
});
