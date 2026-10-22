import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { createIndexedDbSyncStorage } from '../public/shared/sync-v2-client.js';
import {
  createSharedBusinessClient,
  SHARED_BUSINESS_ACTIONS,
} from '../public/shared/shared-business-client.js';
import { createSharedChatSource } from '../android/qq-chat/shared-source.js';

const libraryId = '12345678-1234-4567-8910-123456789012';
const epoch = '98765432-1234-4567-8910-123456789012';
const sourceA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const sourceB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const room = '-90071992547409930012';
const idA = `desktop:${sourceA}:${room}`,
  idB = `desktop:${sourceB}:${room}`;
const entry = (id, sourceId = sourceA, roomId = room, revision = 1) => ({
  entityType: 'entry',
  entityId: id,
  revision,
  seq: revision,
  state: 'active',
  data: {
    id,
    title: id,
    chatJournal: { sourceId, roomId, messages: [{ id: id === 'a1' ? '1' : '2', text: id }] },
  },
});
async function setup(t, rows) {
  const indexedDB = new IDBFactory(),
    dbName = `shiye-sync-v2-index-${randomUUID()}`;
  let real = createIndexedDbSyncStorage({ indexedDB, dbName });
  const calls = [];
  const storage = {
    transaction: (fn) =>
      real.transaction((tx) =>
        fn({
          ...tx,
          getEntity: (type, id) => {
            calls.push(['get', type, id]);
            return tx.getEntity(type, id);
          },
          listEntities: (type) => {
            calls.push(['list', type]);
            return tx.listEntities(type);
          },
        }),
      ),
  };
  let changes = [],
    seq = rows.length + 1;
  const request = async (action) => {
    const info = { libraryId, epoch, seq };
    if (action === 'info') return info;
    return {
      info,
      [action === 'snapshot' ? 'entities' : 'changes']: structuredClone(
        action === 'snapshot' ? rows : changes,
      ),
      next: { libraryId, epoch, after: seq },
      watermark: seq,
      hasMore: false,
    };
  };
  let client = createSharedBusinessClient({ storage, request, libraryId, epoch });
  t.after(() => real.close());
  return {
    get client() {
      return client;
    },
    storage,
    calls,
    changes(value) {
      changes = value;
      seq++;
    },
    async reopen() {
      await real.close();
      real = createIndexedDbSyncStorage({ indexedDB, dbName });
      client = createSharedBusinessClient({ storage, request, libraryId, epoch });
    },
  };
}

test('snapshot builds ID-only scope index atomically; room read fetches only matching entries and source avoids full-body scans', async (t) => {
  const rows = Array.from({ length: 3150 }, (_, i) => ({
    entityType: 'entry',
    entityId: `diary-${i}`,
    revision: 1,
    seq: i + 1,
    state: 'active',
    data: { content: '完全合成正文'.repeat(32) },
  }));
  rows.push(entry('a1'), entry('a2'), entry('b1', sourceB));
  const f = await setup(t, rows);
  await f.client.receive();
  assert.equal(
    f.calls.some((c) => c[0] === 'list'),
    false,
    'fresh snapshot does not rebuild by scanning entries',
  );
  f.calls.length = 0;
  assert.deepEqual(
    (await f.client.listConversationEntries(idA)).map((r) => r.entityId),
    ['a1', 'a2'],
  );
  assert.deepEqual(f.calls, [
    ['get', 'entry', 'a1'],
    ['get', 'entry', 'a2'],
  ]);
  const source = createSharedChatSource({
    client: f.client,
    currentRoom: () => ({ conversationId: idA, sourceId: sourceA, roomId: room }),
    autoSync: false,
  });
  t.after(() => source.dispose());
  f.calls.length = 0;
  await source.refreshLocal();
  assert.deepEqual(
    source.getSnapshot().messages.map((m) => m.text),
    ['a1', 'a2'],
  );
  assert.equal(
    f.calls.some((c) => c[0] === 'list' && (!c[1] || c[1] === 'entry')),
    false,
  );
  assert.deepEqual(
    f.calls.filter((c) => c[0] === 'get' && c[1] === 'entry').map((c) => c[2]),
    ['a1', 'a2'],
  );
  await f.reopen();
  f.calls.length = 0;
  assert.deepEqual(
    (await f.client.listConversationEntries(idB)).map((r) => r.entityId),
    ['b1'],
  );
  assert.deepEqual(f.calls, [['get', 'entry', 'b1']]);
  assert.equal(
    JSON.stringify((await f.client.status()).entryConversationIndex).includes('完全合成正文'),
    false,
  );
});

test('move/deletion/withdrawal and older replay keep index exact; rollback leaves cursor and index together', async (t) => {
  const f = await setup(t, [entry('a1'), entry('a2')]);
  await f.client.receive();
  f.changes([
    entry('a1', sourceB, room, 2),
    { ...entry('a2', sourceA, room, 2), state: 'deleted', data: {} },
  ]);
  await f.client.receive();
  assert.deepEqual(await f.client.listConversationEntries(idA), []);
  assert.deepEqual(
    (await f.client.listConversationEntries(idB)).map((r) => r.entityId),
    ['a1'],
  );
  const before = await f.client.status();
  f.changes([entry('a1', sourceA, room, 3), { ...entry('bad'), revision: 0 }]);
  await assert.rejects(() => f.client.receive(), { code: 'SHARED_INVALID_ENTITY' });
  const after = await f.client.status();
  assert.deepEqual(after.cursor, before.cursor);
  assert.deepEqual(after.entryConversationIndex, before.entryConversationIndex);
  f.changes([
    { ...entry('a1', sourceB, room, 3), state: 'withdrawn', data: { content: 'SECRET' } },
  ]);
  await f.client.receive();
  assert.deepEqual(await f.client.listConversationEntries(idB), []);
  f.changes([entry('a1')]);
  await f.client.receive();
  assert.deepEqual(await f.client.listConversationEntries(idA), []);
  assert.deepEqual((await f.client.read('entry', 'a1')).local.data, {});
  await f.reopen();
  assert.deepEqual(await f.client.listConversationEntries(idB), []);
});

test('old metadata upgrades only once without cursor/draft/outbox rewrite and reads tolerate missing/duplicate IDs', async (t) => {
  const f = await setup(t, [entry('a1'), entry('b1', sourceB)]);
  await f.client.receive();
  await f.client.setDraft(idA, { text: '草稿', replyId: null });
  await f.storage.transaction(async (tx) => {
    const meta = await tx.getMeta();
    delete meta.entryConversationIndex;
    await tx.setMeta(meta);
    await tx.putPending({ operationId: randomUUID(), wire: { keep: true }, optimistic: [] });
  });
  const before = await f.client.status();
  f.calls.length = 0;
  assert.deepEqual(
    (await f.client.listConversationEntries(idA)).map((r) => r.entityId),
    ['a1'],
  );
  assert.equal(f.calls.filter((c) => c[0] === 'list' && c[1] === 'entry').length, 1);
  const after = await f.client.status();
  assert.deepEqual(after.cursor, before.cursor);
  assert.deepEqual(after.drafts, before.drafts);
  assert.equal(after.pending, before.pending);
  await f.storage.transaction(async (tx) => {
    const meta = await tx.getMeta();
    meta.entryConversationIndex.byConversation[idA].push('a1', 'missing', 'b1');
    await tx.setMeta(meta);
  });
  await f.reopen();
  f.calls.length = 0;
  assert.deepEqual(
    (await f.client.listConversationEntries(idA)).map((r) => r.entityId),
    ['a1'],
  );
  assert.equal(
    f.calls.some((c) => c[0] === 'list'),
    false,
  );
  assert.equal(f.calls.filter((c) => c[0] === 'get' && c[2] === 'a1').length, 1);
  assert.throws(() => f.client.listConversationEntries(`desktop:${sourceA}:invalid`), {
    code: 'SHARED_INVALID_CONVERSATION',
  });
  for (const action of [
    'sticker-catalog',
    'sticker-from-message',
    'sticker-collect',
    'sticker-update',
  ])
    assert.equal(SHARED_BUSINESS_ACTIONS.includes(action), true);
});

test('optimistic entry scope/state changes share index transaction and preserve pending data across reopening', async (t) => {
  const f = await setup(t, [entry('a1')]);
  await f.client.receive();
  await f.client.enqueue({
    operationId: randomUUID(),
    action: 'entry-save',
    input: { entryId: 'a1' },
    optimistic: [
      {
        entityType: 'entry',
        entityId: 'a1',
        changes: { chatJournal: { sourceId: sourceB, roomId: room, messages: [] } },
      },
    ],
  });
  assert.deepEqual(await f.client.listConversationEntries(idA), []);
  assert.deepEqual(
    (await f.client.listConversationEntries(idB)).map((r) => r.entityId),
    ['a1'],
  );
  await f.reopen();
  assert.deepEqual(
    (await f.client.listConversationEntries(idB)).map((r) => r.entityId),
    ['a1'],
  );
  await f.client.enqueue({
    operationId: randomUUID(),
    action: 'entry-delete',
    input: { entryId: 'a1' },
    optimistic: [{ entityType: 'entry', entityId: 'a1', state: 'deleted' }],
  });
  assert.deepEqual(await f.client.listConversationEntries(idB), []);
  assert.equal((await f.client.status()).pending, 2);
});
