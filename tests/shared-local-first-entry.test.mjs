import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { createIndexedDbSyncStorage } from '../public/shared/sync-v2-client.js';
import { createSharedBusinessClient } from '../public/shared/shared-business-client.js';
import { createSharedDiaryClient } from '../public/shared/shared-diary-client.js';
import { createSharedDirectoryClient } from '../public/shared/shared-directory-client.js';

const fixtureEntry = () => ({
  title: 'offline create',
  content: '<p>synthetic</p>',
  contentFormat: 'html',
  date: '2026-10-19T01:00:00Z',
  category: '日常',
  tags: [],
  attachments: [],
});

test('offline Entry create and dependent edit survive IndexedDB reopen with immutable wire', async () => {
  const indexedDB = new IDBFactory(),
    dbName = `shiye-sync-v2-shared-${randomUUID()}`;
  const libraryId = randomUUID(),
    epoch = randomUUID(),
    id = randomUUID();
  let storage = createIndexedDbSyncStorage({ indexedDB, dbName });
  let client = createSharedBusinessClient({
    storage,
    libraryId,
    epoch,
    request: async () => {
      throw Object.assign(new Error('OFFLINE'), { code: 'OFFLINE' });
    },
  });
  let diary = createSharedDiaryClient({ client });
  const created = await diary.create({ ...fixtureEntry(), id }, { sync: false });
  assert.equal(created.localAck, true);
  assert.equal(created.serverConfirmed, false);
  assert.equal(
    (await diary.list()).find((row) => row.entityId === id).local.data.title,
    'offline create',
  );
  await storage.close();
  storage = createIndexedDbSyncStorage({ indexedDB, dbName });
  client = createSharedBusinessClient({
    storage,
    libraryId,
    epoch,
    request: async () => {
      throw Object.assign(new Error('OFFLINE'), { code: 'OFFLINE' });
    },
  });
  diary = createSharedDiaryClient({ client });
  const before = await diary.read(id);
  const saved = await diary.save(id, { title: 'offline edit' }, before.localRevision, {
    sync: false,
  });
  assert.equal(saved.localAck, true);
  assert.ok(saved.localRevision > before.localRevision);
  assert.equal((await diary.read(id)).local.data.title, 'offline edit');
  const second = await diary.save(id, { content: '<p>second edit</p>' }, saved.localRevision, {
    sync: false,
  });
  assert.ok(second.localRevision > saved.localRevision);
  const pending = await storage.transaction((tx) => tx.listPending());
  assert.deepEqual(
    pending.map((row) => row.wire.action),
    ['entry-create-local', 'entry-save-local', 'entry-save-local'],
  );
  assert.equal(pending[1].wire.input.baseOperationId, created.operationId);
  assert.equal(pending[2].wire.input.baseOperationId, saved.operationId);
  assert.equal(pending[0].wire.input.entry.id, id);
  assert.equal(pending[0].wire.input.entry.title, 'offline create');
  await assert.rejects(() => diary.create({ ...fixtureEntry(), id }, { sync: false }), {
    code: 'SHARED_ENTRY_ID_COLLISION',
  });
  await storage.close();
});

test('old server capability blocks the immutable local create and retains local Entry', async () => {
  const libraryId = randomUUID(),
    epoch = randomUUID(),
    id = randomUUID();
  const storage = createIndexedDbSyncStorage({
    indexedDB: new IDBFactory(),
    dbName: `shiye-sync-v2-shared-${randomUUID()}`,
  });
  const client = createSharedBusinessClient({
    storage,
    libraryId,
    epoch,
    request: async (action) => {
      assert.equal(action, 'info');
      return { libraryId, epoch, seq: 0, capabilities: {} };
    },
  });
  const diary = createSharedDiaryClient({ client });
  const local = await diary.create({ ...fixtureEntry(), id }, { sync: false });
  await assert.rejects(() => client.flush(), { code: 'SHARED_LOCAL_CREATE_UNSUPPORTED' });
  assert.equal((await client.status()).pending, 1);
  assert.equal((await client.readOperation(local.operationId)).status, 'blocked');
  assert.equal((await diary.read(id)).local.data.title, 'offline create');
  const wire = (await storage.transaction((tx) => tx.listPending()))[0].wire;
  await client.reconcileBlocked({ operationId: local.operationId, mode: 'retry-unchanged' });
  assert.deepEqual((await storage.transaction((tx) => tx.listPending()))[0].wire, wire);
  assert.equal((await client.readOperation(local.operationId)).status, 'pending');
  await storage.close();
});

test('strict online failure reports that local create was already committed', async () => {
  const libraryId = randomUUID(),
    epoch = randomUUID(),
    id = randomUUID();
  const storage = createIndexedDbSyncStorage({
    indexedDB: new IDBFactory(),
    dbName: `shiye-sync-v2-shared-${randomUUID()}`,
  });
  const client = createSharedBusinessClient({
    storage,
    libraryId,
    epoch,
    request: async () => {
      throw Object.assign(new Error('OFFLINE'), { code: 'OFFLINE' });
    },
  });
  const diary = createSharedDiaryClient({ client });
  await assert.rejects(
    () => diary.create({ ...fixtureEntry(), id }, { sync: true }),
    (error) => error.localCommitted === true && error.entryId === id && !!error.operationId,
  );
  assert.equal((await diary.read(id)).local.data.title, 'offline create');
  assert.equal((await client.status()).pending, 1);
  await storage.close();
});

test('late local ACK identifies its own committed revision, not a newer draft', async () => {
  const libraryId = randomUUID(),
    epoch = randomUUID(),
    id = randomUUID();
  const storage = createIndexedDbSyncStorage({
    indexedDB: new IDBFactory(),
    dbName: `shiye-sync-v2-shared-${randomUUID()}`,
  });
  const client = createSharedBusinessClient({
    storage,
    libraryId,
    epoch,
    request: async () => {
      throw new Error('OFFLINE');
    },
  });
  const originalEnqueue = client.enqueue;
  client.enqueue = async (command) => {
    const first = await originalEnqueue(command);
    await originalEnqueue({
      operationId: randomUUID(),
      action: 'entry-save-local',
      input: {
        entryId: id,
        entry: { ...fixtureEntry(), id, title: 'newer draft' },
        baseOperationId: command.operationId,
      },
      optimistic: [{ entityType: 'entry', entityId: id, changes: { title: 'newer draft' } }],
    });
    return first;
  };
  const diary = createSharedDiaryClient({ client });
  const result = await diary.create({ ...fixtureEntry(), id }, { sync: false });
  assert.equal(result.committedLocalRevision, 1);
  assert.equal(result.localRevision, 2);
  assert.equal(result.serverRevision, null);
  assert.equal((await diary.read(id)).local.data.title, 'newer draft');
  await storage.close();
});

test('offline conversation has stable source and decimal room ids after reopen', async () => {
  const indexedDB = new IDBFactory(),
    dbName = `shiye-sync-v2-shared-${randomUUID()}`;
  const libraryId = randomUUID(),
    epoch = randomUUID(),
    sourceId = randomUUID();
  const request = async () => {
    throw Object.assign(new Error('OFFLINE'), { code: 'OFFLINE' });
  };
  let storage = createIndexedDbSyncStorage({ indexedDB, dbName });
  let client = createSharedBusinessClient({ storage, libraryId, epoch, request });
  let directory = createSharedDirectoryClient({ client });
  const fields = {
    title: 'local room',
    mode: 'session',
    selfName: '我',
    category: null,
    idleHours: 5,
    description: '',
    clientMetadata: {},
  };
  const first = await directory.create(fields, { sourceId, sync: false });
  assert.equal(first.conversationId, `desktop:${sourceId}:-1`);
  assert.equal((await directory.list()).rooms[0].title, 'local room');
  await storage.close();
  storage = createIndexedDbSyncStorage({ indexedDB, dbName });
  client = createSharedBusinessClient({ storage, libraryId, epoch, request });
  directory = createSharedDirectoryClient({ client });
  assert.equal((await directory.list()).rooms[0].id, first.conversationId);
  const second = await directory.create({ ...fields, title: 'second' }, { sourceId, sync: false });
  assert.equal(second.conversationId, `desktop:${sourceId}:-2`);
  const edited = await directory.update(
    first.conversationId,
    { title: 'edited locally' },
    { sync: false },
  );
  assert.ok(edited.localRevision > first.localRevision);
  assert.equal((await directory.row(first.conversationId)).title, 'edited locally');
  await directory.setState(first.conversationId, { pinned: true }, { sync: false });
  const order = await directory.setOrder([second.conversationId, first.conversationId], {
    sync: false,
  });
  assert.equal(order.localAck, true);
  assert.deepEqual((await directory.list()).order, [second.conversationId, first.conversationId]);
  const settings = await directory.saveSettings(
    {
      conversationId: first.conversationId,
      slotId: 'ai',
      providerId: 'external-program',
      expectedBindingRevision: 0,
      expectedConfigRevision: 0,
      config: { title: 'local program', parameters: { a: 1 } },
    },
    { sync: false },
  );
  assert.equal(settings.localAck, true);
  const projected = await directory.settings(first.conversationId, 'ai');
  assert.equal(projected.config.title, 'local program');
  assert.equal(projected.serverConfirmed, false);
  const pending = await storage.transaction((tx) => tx.listPending());
  assert.equal(pending[0].wire.input.conversationId, first.conversationId);
  assert.equal(pending[1].wire.input.conversationId, second.conversationId);
  assert.equal(pending[2].wire.action, 'conversation-save-local');
  assert.equal(pending[2].wire.input.baseOperationId, first.operationId);
  assert.equal(pending[4].wire.action, 'conversation-order-local');
  assert.equal(pending[4].wire.input.baseOperationId, pending[3].operationId);
  await storage.close();
});
