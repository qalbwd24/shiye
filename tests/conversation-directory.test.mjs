import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  directoryView,
  createDirectoryConversation,
  updateDirectoryState,
  saveDirectoryOrder,
} from '../src/server/conversation-services/directory.mjs';
import { saveConversation } from '../src/server/conversation-services/conversations.mjs';

const oldSource = '12345678-1234-4567-8910-123456789012';
const id = (room) => `desktop:${oldSource}:${room}`;
const dbFixture = () => ({
  entries: [{ id: 'diary-original', future: true }],
  media: [{ id: 'original-media' }],
  categories: ['日常'],
  chatJournal: {
    version: 1,
    rooms: [
      {
        sourceId: oldSource,
        id: '-9',
        title: '旧房',
        category: '日常',
        idleHours: 5,
        customOldRoom: { retained: true },
      },
    ],
  },
});
const request = (extra = {}) => ({
  operationId: randomUUID(),
  title: '新建共享会话',
  category: '日常',
  idleHours: 5,
  mode: 'session',
  selfName: '本人',
  ...extra,
});

test('view lists real old server rooms without allocating namespaces or mutating data', () => {
  const db = dbFixture(),
    before = structuredClone(db);
  const firstClient = directoryView(db),
    secondClient = directoryView(db);
  assert.deepEqual(firstClient, secondClient);
  assert.equal(firstClient.sourceId, null);
  assert.equal(firstClient.revision, 0);
  assert.deepEqual(firstClient.order, [id('-9')]);
  assert.equal(firstClient.conversations[0].messageOwner, 'legacy');
  assert.equal(firstClient.conversations[0].listStateRevision, 0);
  assert.deepEqual(db, before);
});

test('server namespace and negative IDs persist; exact creation replay returns current data without overwriting it', () => {
  const db = dbFixture(),
    input = request();
  const first = createDirectoryConversation(db, input);
  const source = db.conversationServices.directory.sourceId;
  assert.equal(first.conversationId, `desktop:${source}:-1`);
  assert.equal(first.messageOwner, 'legacy');
  assert.equal(first.replayed, false);
  saveConversation(db, {
    conversationId: first.conversationId,
    expectedRevision: first.revision,
    title: '后来修改',
    category: '日常',
    idleHours: 8,
    mode: 'group',
    selfName: '新署名',
  });
  const before = structuredClone(db);
  const replay = createDirectoryConversation(db, { ...input });
  assert.equal(replay.conversationId, first.conversationId);
  assert.equal(replay.title, '后来修改');
  assert.equal(replay.selfName, '新署名');
  assert.equal(replay.replayed, true);
  assert.deepEqual(db, before);
  assert.throws(() => createDirectoryConversation(db, { ...input, title: '异文同操作号' }), {
    code: 'DIRECTORY_OPERATION_REUSED',
  });
  const second = createDirectoryConversation(db, request());
  assert.equal(second.conversationId, `desktop:${source}:-2`);
  assert.equal(directoryView(db).sourceId, source);
  assert.equal(db.conversationServices.directory.creations.length, 2);
});

test('negative allocation avoids collisions without rounding long decimal room identifiers', () => {
  const db = dbFixture();
  createDirectoryConversation(db, request());
  const sourceId = db.conversationServices.directory.sourceId;
  db.chatJournal.rooms.push(
    { sourceId, id: '-2', title: '既存第二房', category: '日常', idleHours: 5 },
    { sourceId, id: '-9007199254740993001', title: '长字符串房', category: '日常', idleHours: 5 },
  );
  const next = createDirectoryConversation(db, request());
  assert.equal(next.conversationId, `desktop:${sourceId}:-3`);
  assert.ok(directoryView(db).order.includes(`desktop:${sourceId}:-9007199254740993001`));
  assert.equal(db.chatJournal.rooms.at(-2).id, '-9007199254740993001');
});

test('room state CAS rejects same-room stale edits while independent rooms can update concurrently', () => {
  const db = dbFixture(),
    a = createDirectoryConversation(db, request()),
    b = createDirectoryConversation(db, request());
  const head = directoryView(db).revision;
  const first = updateDirectoryState(db, {
    conversationId: a.conversationId,
    expectedRevision: 0,
    pinned: true,
  });
  assert.equal(first.listStateRevision, 1);
  assert.throws(
    () =>
      updateDirectoryState(db, {
        conversationId: a.conversationId,
        expectedRevision: 0,
        archived: true,
      }),
    { code: 'DIRECTORY_STATE_REVISION_CONFLICT' },
  );
  const other = updateDirectoryState(db, {
    conversationId: b.conversationId,
    expectedRevision: 0,
    archived: true,
  });
  assert.equal(other.listStateRevision, 1);
  assert.throws(
    () =>
      updateDirectoryState(db, {
        conversationId: a.conversationId,
        expectedRevision: 1,
        expectedDirectoryRevision: head,
        archived: true,
      }),
    { code: 'DIRECTORY_REVISION_CONFLICT' },
  );
});

test('archive/restore preserves content, media, bindings, receipt identity and unknown fields', () => {
  const db = dbFixture(),
    created = createDirectoryConversation(db, request());
  db.conversationServices.bindings.push({
    id: 'binding-original',
    conversationId: created.conversationId,
    instanceId: 'instance-original',
    active: false,
    revision: 1,
  });
  db.conversationServices.directory.future = { keep: true };
  updateDirectoryState(db, {
    conversationId: created.conversationId,
    expectedRevision: 0,
    pinned: true,
  });
  db.conversationServices.directory.states[0].futureState = { keep: true };
  const originals = structuredClone({
    entries: db.entries,
    media: db.media,
    bindings: db.conversationServices.bindings,
    rooms: db.chatJournal.rooms,
    creations: db.conversationServices.directory.creations,
  });
  const archived = updateDirectoryState(db, {
    conversationId: created.conversationId,
    expectedRevision: 1,
    archived: true,
  });
  assert.equal(archived.archived, true);
  assert.ok(directoryView(db).order.includes(created.conversationId));
  const restored = updateDirectoryState(db, {
    conversationId: created.conversationId,
    expectedRevision: 2,
    archived: false,
  });
  assert.equal(restored.archived, false);
  assert.equal(restored.pinned, true);
  assert.deepEqual(
    {
      entries: db.entries,
      media: db.media,
      bindings: db.conversationServices.bindings,
      rooms: db.chatJournal.rooms,
      creations: db.conversationServices.directory.creations,
    },
    originals,
  );
  assert.deepEqual(db.conversationServices.directory.future, { keep: true });
  assert.deepEqual(db.conversationServices.directory.states[0].futureState, { keep: true });
  assert.deepEqual(db.chatJournal.rooms[0].customOldRoom, { retained: true });
});

test('manual order requires current directory CAS and complete set including archived and pinned rooms', () => {
  const db = dbFixture(),
    a = createDirectoryConversation(db, request()),
    b = createDirectoryConversation(db, request());
  updateDirectoryState(db, {
    conversationId: a.conversationId,
    expectedRevision: 0,
    archived: true,
  });
  updateDirectoryState(db, { conversationId: b.conversationId, expectedRevision: 0, pinned: true });
  const view = directoryView(db),
    manual = [a.conversationId, id('-9'), b.conversationId];
  assert.throws(
    () => saveDirectoryOrder(db, { expectedRevision: view.revision - 1, order: manual }),
    { code: 'DIRECTORY_REVISION_CONFLICT' },
  );
  assert.throws(
    () => saveDirectoryOrder(db, { expectedRevision: view.revision, order: manual.slice(1) }),
    { code: 'DIRECTORY_ORDER_INCOMPLETE' },
  );
  assert.throws(
    () =>
      saveDirectoryOrder(db, {
        expectedRevision: view.revision,
        order: [manual[0], manual[0], manual[2]],
      }),
    { code: 'DIRECTORY_ORDER_INCOMPLETE' },
  );
  const reordered = saveDirectoryOrder(db, { expectedRevision: view.revision, order: manual });
  assert.deepEqual(reordered.order, manual);
  assert.equal(reordered.conversations[0].conversationId, b.conversationId);
  assert.equal(reordered.conversations[1].conversationId, a.conversationId);
  assert.equal(reordered.conversations[1].archived, true);
});

test('fixed original revisit room cannot be archived and creation receipt capacity never evicts old operations', () => {
  const db = dbFixture();
  db.chatJournal.rooms.push({
    sourceId: oldSource,
    id: '-900000001',
    title: '朝花夕拾',
    category: '日常',
    idleHours: 5,
  });
  assert.throws(
    () =>
      updateDirectoryState(db, {
        conversationId: id('-900000001'),
        expectedRevision: 0,
        archived: true,
      }),
    { code: 'DIRECTORY_SYSTEM_ARCHIVE_FORBIDDEN' },
  );
  assert.equal(db.conversationServices, undefined);
  const firstInput = request(),
    first = createDirectoryConversation(db, firstInput);
  const receipts = db.conversationServices.directory.creations;
  for (let i = receipts.length; i < 1024; i++)
    receipts.push({
      operationId: randomUUID(),
      digest: 'a'.repeat(64),
      conversationId: `desktop:${db.conversationServices.directory.sourceId}:${-i - 10000}`,
    });
  assert.throws(() => createDirectoryConversation(db, request()), { code: 'DIRECTORY_ROOM_LIMIT' });
  assert.equal(receipts.length, 1024);
  assert.equal(createDirectoryConversation(db, firstInput).conversationId, first.conversationId);
});

test('invalid input and unknown request fields fail explicitly without silently changing existing IDs', () => {
  const db = dbFixture(),
    before = structuredClone(db);
  for (const input of [
    request({ operationId: 'not-uuid' }),
    request({ servicePlan: 'undefined-business' }),
    request({ description: 'x'.repeat(2001) }),
    request({ idleHours: Infinity }),
  ])
    assert.throws(() => createDirectoryConversation(db, input));
  assert.deepEqual(db, before);
});
