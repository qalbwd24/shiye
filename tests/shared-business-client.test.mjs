import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createSharedBusinessClient } from '../public/shared/shared-business-client.js';
import { createMemorySyncStorage } from './helpers/sync-v2-client-memory.mjs';
import { createIndexedDbSyncStorage } from '../public/shared/sync-v2-client.js';
import { IDBFactory } from 'fake-indexeddb';

const libraryId = '12345678-1234-4567-8910-123456789012',
  epoch = '98765432-1234-4567-8910-123456789012';
const envelope = (title = 'original', revision = 1) => ({
  entityType: 'journalAggregate',
  entityId: 'entry-one',
  revision,
  seq: revision,
  state: 'active',
  data: { title, unknown: { keep: true } },
});
const command = (title = 'draft', operationId = randomUUID()) => ({
  operationId,
  action: 'entry-save',
  input: { entryId: 'entry-one', entry: { title, revision: 1 } },
  optimistic: [{ entityType: 'journalAggregate', entityId: 'entry-one', changes: { title } }],
});
function fixture(extra = {}) {
  const storage = createMemorySyncStorage();
  const server = {
    rows: [envelope()],
    info: { libraryId, epoch, seq: 1 },
    calls: [],
    receipts: new Map(),
    ...extra,
  };
  const request = async (action, input) => {
    server.calls.push({ action, input: structuredClone(input) });
    if (action === 'info') return structuredClone(server.info);
    if (action === 'snapshot' || action === 'pull')
      return {
        info: structuredClone(server.info),
        [action === 'snapshot' ? 'entities' : 'changes']: structuredClone(server.rows),
        next: { libraryId, epoch, after: server.info.seq },
        hasMore: false,
      };
    if (server.command) return server.command(input);
    if (!server.receipts.has(input.operationId)) {
      server.rows = [envelope(input.input.entry.title, server.info.seq + 1)];
      server.info.seq++;
      server.receipts.set(input.operationId, {
        info: structuredClone(server.info),
        operationId: input.operationId,
        result: { entryId: 'entry-one' },
        replayed: false,
      });
    }
    return structuredClone(server.receipts.get(input.operationId));
  };
  const client = createSharedBusinessClient({ request, storage, libraryId, epoch });
  return { server, storage, request, client };
}
test('remote pages persist base, unknown metadata and cursor without producing outbox commands', async () => {
  const { client, storage } = fixture();
  await client.receive();
  const record = await client.read('journalAggregate', 'entry-one');
  assert.deepEqual(record.local, record.base);
  assert.equal(record.base.data.unknown.keep, true);
  assert.equal((await client.status()).initialized, true);
  assert.equal((await storage.transaction((tx) => tx.listPending())).length, 0);
});
test('enqueue atomically persists immutable command and optimistic local state, rollback leaves both absent', async () => {
  const { client, storage } = fixture();
  await client.receive();
  const input = command();
  await client.enqueue(input);
  input.input.entry.title = 'caller mutation';
  assert.equal((await client.read('journalAggregate', 'entry-one')).local.data.title, 'draft');
  const head = (await storage.transaction((tx) => tx.listPending()))[0];
  assert.equal(head.wire.input.entry.title, 'draft');
  assert.equal(head.wire.libraryId, libraryId);
  assert.equal(head.wire.epoch, epoch);
  const badStorage = {
    transaction: (fn) =>
      storage.transaction(async (tx) => {
        const result = await fn(tx);
        throw Object.assign(new Error('disk failure'), { result });
      }),
  };
  const other = createSharedBusinessClient({
    request: async () => {},
    storage: badStorage,
    libraryId,
    epoch,
  });
  await assert.rejects(() => other.enqueue(command('must rollback')));
  assert.equal((await storage.transaction((tx) => tx.listPending())).length, 1);
  assert.equal((await client.read('journalAggregate', 'entry-one')).local.data.title, 'draft');
});
test('lost ACK survives client reopening and retries identical operationId/wire after server commit', async () => {
  const f = fixture();
  await f.client.receive();
  const input = command();
  await f.client.enqueue(input);
  let lost = true;
  const request = async (action, wire) => {
    const result = await f.request(action, wire);
    if (action === 'command' && lost) {
      lost = false;
      throw Error('network lost ACK');
    }
    return result;
  };
  const first = createSharedBusinessClient({ ...f, request, libraryId, epoch });
  await assert.rejects(() => first.flush());
  const sent = (await f.storage.transaction((tx) => tx.listPending()))[0];
  assert.equal(sent.sent, true);
  const reopened = createSharedBusinessClient({ ...f, request, libraryId, epoch });
  await reopened.sync();
  const wires = f.server.calls.filter((c) => c.action === 'command').map((c) => c.input);
  assert.equal(wires.length, 2);
  assert.deepEqual(wires[0], wires[1]);
  assert.equal((await reopened.status()).pending, 0);
  assert.equal((await reopened.read('journalAggregate', 'entry-one')).base.data.title, 'draft');
});
test('new edits queued while sending survive ACK and minimal ACK waits for authoritative receive', async () => {
  const f = fixture();
  await f.client.receive();
  await f.client.enqueue(command('first'));
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  f.server.command = async (wire) => {
    started();
    await gate;
    f.server.rows = [envelope('first', 2)];
    f.server.info.seq = 2;
    return { info: f.server.info, operationId: wire.operationId, result: { entryId: 'entry-one' } };
  };
  const flushing = f.client.flush();
  await ready;
  await f.client.enqueue(command('newer'));
  // Block the next command after the first ACK, so inspect the retained newer projection.
  f.server.command = async () => {
    throw Error('offline');
  };
  release();
  await assert.rejects(() => flushing);
  const record = await f.client.read('journalAggregate', 'entry-one');
  assert.equal(record.base.data.title, 'first');
  assert.equal(record.local.data.title, 'newer');
  assert.equal((await f.client.status()).pending, 1);
});
test('same operation cannot change wire pending or after acknowledged replay', async () => {
  const f = fixture();
  await f.client.receive();
  const input = command();
  await f.client.enqueue(input);
  await assert.rejects(() => f.client.enqueue({ ...input, input: { entryId: 'changed' } }), {
    code: 'SHARED_OPERATION_REUSED',
  });
  await f.client.flush();
  assert.equal((await f.client.enqueue(input)).acknowledged, true);
  await assert.rejects(() => f.client.enqueue({ ...input, input: { entryId: 'changed' } }), {
    code: 'SHARED_OPERATION_REUSED',
  });
});
test('wrong library/epoch rejects remote pages and reusing storage under another identity preserves outbox', async () => {
  const f = fixture();
  await f.client.receive();
  await f.client.enqueue(command());
  const before = await f.client.read('journalAggregate', 'entry-one');
  f.server.info.epoch = randomUUID();
  await assert.rejects(() => f.client.receive(), { code: 'SHARED_IDENTITY_MISMATCH' });
  assert.deepEqual(await f.client.read('journalAggregate', 'entry-one'), before);
  assert.equal((await f.client.status()).pending, 1);
  const wrong = createSharedBusinessClient({
    request: f.request,
    storage: f.storage,
    libraryId: randomUUID(),
    epoch,
  });
  await assert.rejects(() => wrong.enqueue(command()), { code: 'SHARED_IDENTITY_MISMATCH' });
});
test('401 pauses durably and explicit resume retries same command; CAS conflict retains edits and stops', async () => {
  const f = fixture();
  await f.client.receive();
  await f.client.enqueue(command());
  f.server.command = async () => {
    throw Object.assign(Error('unauthorized'), { status: 401 });
  };
  await assert.rejects(() => f.client.sync());
  assert.equal((await f.client.status()).paused.status, 401);
  const count = f.server.calls.length;
  await f.client.sync();
  assert.equal(f.server.calls.length, count);
  await f.client.resume();
  f.server.command = async () => {
    throw Object.assign(Error('CAS_CONFLICT'), { status: 409, code: 'CAS_CONFLICT' });
  };
  await assert.rejects(() => f.client.sync());
  assert.equal((await f.client.status()).pending, 1);
  assert.equal((await f.client.read('journalAggregate', 'entry-one')).local.data.title, 'draft');
  await assert.rejects(() => f.client.resume(), {
    code: 'SHARED_BLOCKED_COMMAND_REQUIRES_RECONCILIATION',
  });
});
test('readonly profile/projection and received withdrawal cannot be optimistically rewritten', async () => {
  const f = fixture();
  f.server.rows[0].data._product = { readOnlyProjection: true };
  await f.client.receive();
  await assert.rejects(() => f.client.enqueue(command()), { code: 'SHARED_READ_ONLY' });
  const input = command();
  input.optimistic[0].entityType = 'profile';
  await assert.rejects(() => f.client.enqueue(input), { code: 'SHARED_INVALID_OPTIMISTIC' });
  const g = fixture();
  await g.client.receive();
  await g.client.enqueue(command());
  g.server.rows = [
    { ...envelope('', 2), state: 'withdrawn', data: { private: 'must not retain' } },
  ];
  g.server.info.seq = 2;
  await g.client.receive();
  assert.deepEqual((await g.client.read('journalAggregate', 'entry-one')).local.data, {});
  assert.equal((await g.client.status()).pending, 1);
});
test('multi-page snapshot cursor commits with rows and initialized only after final page', async () => {
  const storage = createMemorySyncStorage();
  let pages = 0;
  const request = async (action, _input) =>
    action === 'info'
      ? { libraryId, epoch, seq: 2 }
      : action === 'pull'
        ? { info: { libraryId, epoch, seq: 2 }, changes: [], next: { after: 2 }, hasMore: false }
        : {
            info: { libraryId, epoch, seq: 2 },
            entities: [{ ...envelope('page', ++pages), entityId: `page-${pages}` }],
            next: { after: pages },
            hasMore: pages < 2,
          };
  const client = createSharedBusinessClient({ request, storage, libraryId, epoch });
  await client.receive();
  assert.equal((await client.list()).length, 2);
  assert.equal((await client.status()).initialized, true);
  assert.deepEqual((await client.status()).cursor, { after: 2 });
});
test('snapshot catches concurrent earlier-key changes from first watermark before flushing commands', async () => {
  const storage = createMemorySyncStorage(),
    calls = [];
  let page = 0;
  const request = async (action, input) => {
    calls.push({ action, input });
    if (action === 'info') return { libraryId, epoch, seq: 1 };
    if (action === 'snapshot') {
      page++;
      return {
        info: { libraryId, epoch, seq: page },
        entities: [{ ...envelope(`page${page}`, page), entityId: `key-${page}` }],
        next: { afterKey: `key-${page}` },
        watermark: page,
        hasMore: page === 1,
      };
    }
    assert.equal(input.after, 1);
    return {
      info: { libraryId, epoch, seq: 3 },
      changes: [
        { ...envelope('concurrent earlier key', 3), entityId: 'key-0' },
        { ...envelope('changed processed key', 4), entityId: 'key-1' },
      ],
      next: { after: 3 },
      hasMore: false,
    };
  };
  const client = createSharedBusinessClient({ storage, request, libraryId, epoch });
  await client.receive();
  assert.equal(
    (await client.read('journalAggregate', 'key-0')).base.data.title,
    'concurrent earlier key',
  );
  assert.equal(
    (await client.read('journalAggregate', 'key-1')).base.data.title,
    'changed processed key',
  );
  assert.equal(calls.at(-1).action, 'pull');
});
test('local revision CAS and draft compare/clear are inside enqueue transaction and outside immutable wire', async () => {
  const f = fixture();
  await f.client.receive();
  const firstDraft = await f.client.setDraft('room', { text: 'old', replyId: null });
  await f.client.setDraft('room', { text: 'newer', replyId: null });
  const input = command();
  await f.client.enqueue({
    ...input,
    expectedLocalRevisions: [
      { entityType: 'journalAggregate', entityId: 'entry-one', revision: 0 },
    ],
    draftClear: { scope: 'room', expectedRevision: firstDraft.revision },
  });
  assert.equal((await f.client.readDraft('room')).text, 'newer');
  await assert.rejects(
    () =>
      f.client.enqueue({
        ...command('stale'),
        expectedLocalRevisions: [
          { entityType: 'journalAggregate', entityId: 'entry-one', revision: 0 },
        ],
      }),
    { code: 'SHARED_LOCAL_REVISION_CONFLICT' },
  );
  const pending = (await f.storage.transaction((tx) => tx.listPending()))[0];
  assert.equal(Object.hasOwn(pending.wire, 'expectedLocalRevisions'), false);
  assert.equal((await f.client.status()).pending, 1);
});
test('readOperation exposes durable minimal ACK mapping and never stores arbitrary result bodies', async () => {
  const f = fixture();
  await f.client.receive();
  const input = command();
  await f.client.enqueue(input);
  assert.equal((await f.client.readOperation(input.operationId)).status, 'pending');
  f.server.command = async (wire) => ({
    info: f.server.info,
    operationId: wire.operationId,
    result: {
      entryId: 'entry-one',
      conversationId: 'canonical',
      body: 'private body',
      nested: { text: 'private text' },
    },
  });
  await f.client.flush();
  const receipt = await f.client.readOperation(input.operationId);
  assert.equal(receipt.status, 'acknowledged');
  assert.deepEqual(receipt.result, { entryId: 'entry-one', conversationId: 'canonical' });
  assert.equal(JSON.stringify(f.storage.persisted.meta).includes('private body'), false);
});
test('pull-only changeSeq metadata does not turn an identical revision into a conflict', async () => {
  const f = fixture();
  await f.client.receive();
  f.server.rows[0].changeSeq = 1;
  await f.client.receive();
  assert.equal((await f.client.read('journalAggregate', 'entry-one')).base.data.title, 'original');
});
test('fixed readonly query does not enter command outbox and rejects arbitrary actions', async () => {
  const f = fixture();
  f.server.command = async (wire) => ({
    info: f.server.info,
    operationId: wire.operationId,
    result: { entries: [] },
  });
  const answer = await f.client.query({ operationId: randomUUID(), action: 'entry-list' });
  assert.deepEqual(answer.result, { entries: [] });
  assert.equal((await f.client.status()).pending, 0);
  await assert.rejects(() => f.client.query({ operationId: randomUUID(), action: 'entry-save' }), {
    code: 'SHARED_INVALID_QUERY',
  });
  await assert.rejects(
    () => f.client.query({ operationId: randomUUID(), action: '/arbitrary/path' }),
    { code: 'SHARED_INVALID_QUERY' },
  );
});
test('existing IndexedDB port commits local projection/outbox together and reopens ordered immutable commands', async () => {
  const f = fixture(),
    indexedDB = new IDBFactory(),
    dbName = `shiye-sync-v2-shared-${randomUUID()}`;
  let storage = createIndexedDbSyncStorage({ indexedDB, dbName });
  let client = createSharedBusinessClient({ storage, request: f.request, libraryId, epoch });
  await client.receive();
  const first = command('one'),
    second = command('two');
  await client.enqueue(first);
  await client.enqueue(second);
  await storage.close();
  storage = createIndexedDbSyncStorage({ indexedDB, dbName });
  client = createSharedBusinessClient({ storage, request: f.request, libraryId, epoch });
  assert.equal((await client.read('journalAggregate', 'entry-one')).local.data.title, 'two');
  assert.deepEqual(
    (await storage.transaction((tx) => tx.listPending())).map((p) => p.operationId),
    [first.operationId, second.operationId],
  );
  await client.sync();
  assert.equal((await client.status()).pending, 0);
  assert.equal((await client.read('journalAggregate', 'entry-one')).local.data.title, 'two');
  await storage.close();
});
test('start/stop polls only fixed reads, stop ignores an in-flight late page and never installs anything', async () => {
  const f = fixture();
  const client = createSharedBusinessClient({ ...f, libraryId, epoch, pollMs: 15 });
  await client.start();
  client.stop();
  const count = f.server.calls.length;
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(f.server.calls.length, count);
  let release;
  const page = new Promise((resolve) => {
    release = resolve;
  });
  const late = createSharedBusinessClient({
    storage: createMemorySyncStorage(),
    libraryId,
    epoch,
    request: async (action) => (action === 'info' ? { libraryId, epoch, seq: 1 } : page),
  });
  const work = late.receive();
  await new Promise((resolve) => setTimeout(resolve, 0));
  late.stop();
  release({ info: { libraryId, epoch, seq: 1 }, entities: [envelope()], next: 1, hasMore: false });
  await assert.rejects(() => work, { code: 'SHARED_CANCELLED' });
  assert.equal((await late.list()).length, 0);
});
