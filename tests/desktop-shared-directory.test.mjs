import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { IDBFactory } from 'fake-indexeddb';
import { createDiaryServer } from '../src/server/app.mjs';
import { createSharedBusinessClient } from '../public/shared/shared-business-client.js';
import { createSharedDirectoryClient } from '../public/shared/shared-directory-client.js';
import { captureDesktopDirectory } from '../previews/telegram-chat/shiye-shared-directory-adapter.js';
import {
  readDesktopDirectorySnapshot,
  startDesktopDirectoryPort,
} from '../previews/telegram-chat/shiye-shared-directory-port.js';
import { createMemorySyncStorage } from './helpers/sync-v2-client-memory.mjs';
import { loadWorker, Channel } from './helpers/local-program-worker.mjs';

async function fixture(t, { loseFirstRegistrationAck = false } = {}) {
  const root = path.resolve('tmp/desktop-shared-directory-tests');
  await mkdir(root, { recursive: true });
  const server = await createDiaryServer({
    dataDir: await mkdtemp(path.join(root, 'case-')),
    seed: false,
    sharedSync: true,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.close();
    await once(server, 'close');
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const commands = [];
  const request = async (action, input) => {
    if (action === 'command') commands.push(structuredClone(input));
    const response = await fetch(`${base}/api/shared/v1/${action}`, {
      method: action === 'info' ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Diary-Client': 'desktop' },
      ...(action === 'info' ? {} : { body: JSON.stringify(input) }),
    });
    const value = await response.json();
    if (!response.ok)
      throw Object.assign(Error(JSON.stringify(value)), { status: response.status });
    if (action === 'command' && input.action === 'conversation-save' && loseFirstRegistrationAck) {
      loseFirstRegistrationAck = false;
      throw Error('isolated lost registration ACK');
    }
    return value;
  };
  const info = await request('info');
  const makeClient = () =>
    createSharedBusinessClient({
      request,
      storage: createMemorySyncStorage(),
      libraryId: info.libraryId,
      epoch: info.epoch,
    });
  const pc = makeClient(),
    android = makeClient();
  const directory = createSharedDirectoryClient({ client: pc });
  const androidDirectory = createSharedDirectoryClient({ client: android });
  const sourceId = randomUUID();
  // Real MockTypes/shiyeLocal worker shape. No messages or document traversal.
  const rooms = {
    '-10000000000000000001': {
      id: '-10000000000000000001',
      title: '同名空房',
      category: '',
      description: '空房描述',
      idleHours: 5,
      kind: 'session',
      participants: [{ id: 'self', kind: 'self' }],
      servicePlan: '只登记，不执行',
      future: { nested: [1, 'keep'] },
    },
    '-2': {
      id: '-2',
      title: '同名空房',
      category: '日常',
      description: '',
      idleHours: 7,
      kind: 'group',
      participants: [{ id: 'self', kind: 'self' }],
      isArchived: true,
    },
  };
  const snapshot = {
    sourceId,
    rooms,
    dialogs: { active: [{ id: '-10000000000000000001' }], archived: [{ id: '-2' }] },
    order: ['-10000000000000000001', '-2'],
    journalRooms: {},
  };
  const port = startDesktopDirectoryPort({
    client: pc,
    directory,
    readSnapshot: async () => snapshot,
    readLocalPreferences: async () => ({}),
    BroadcastChannel: null,
    events: null,
    pollMs: 0,
  });
  t.after(() => port.stop());
  return {
    pc,
    android,
    directory,
    androidDirectory,
    snapshot,
    port,
    id: (room) => `desktop:${sourceId}:${room}`,
    commands,
  };
}

test('actual PC metadata port registers empty 20-digit rooms; Android sees same IDs/settings and later rename/pin/order/archive', async (t) => {
  const f = await fixture(t);
  assert.deepEqual((await f.port.ready).conflicts, []);
  await f.android.sync();
  let view = await f.androidDirectory.list({ includeArchived: true });
  assert.equal(view.rooms.length, 2);
  const first = view.rooms.find((r) => r.id === f.id('-10000000000000000001'));
  assert.equal(first.legacyRoomId, '-10000000000000000001');
  assert.equal(first.category, null);
  assert.equal(first.messageOwner, 'legacy');
  assert.deepEqual(first.clientMetadata.desktop.future, { nested: [1, 'keep'] });
  assert.equal(first.clientMetadata.desktop.servicePlan, '只登记，不执行');
  assert.equal((await f.androidDirectory.settings(first.id)).conversationId, first.id);
  assert.equal((await f.androidDirectory.settings(first.id)).providerId, null);
  await f.directory.saveSettings({
    conversationId: f.id('-2'),
    slotId: 'ai',
    providerId: 'external-program',
    expectedBindingRevision: 0,
    expectedConfigRevision: 0,
    config: {
      enabled: true,
      title: '只登记角色',
      kind: 'ai',
      sender: { name: '共享助手' },
      parameters: { future: { unknown: ['keep', false] } },
    },
  });
  await f.android.sync();
  assert.deepEqual((await f.androidDirectory.settings(f.id('-2'), 'ai')).config.parameters.future, {
    unknown: ['keep', false],
  });
  f.snapshot.rooms['-10000000000000000001'].title = '电脑后来改名';
  f.snapshot.rooms['-10000000000000000001'].isPinned = true;
  f.snapshot.rooms['-10000000000000000001'].isArchived = true;
  f.snapshot.order.reverse();
  assert.deepEqual((await f.port.collect()).conflicts, []);
  await f.android.sync();
  view = await f.androidDirectory.list({ includeArchived: true });
  const updated = view.rooms.find((r) => r.id === first.id);
  assert.equal(updated.title, '电脑后来改名');
  assert.equal(updated.pinned, true);
  assert.equal(updated.archived, true);
  assert.deepEqual(view.order, [f.id('-2'), first.id]);
  assert.equal(
    (await f.androidDirectory.settings(f.id('-2'), 'ai')).config.sender.name,
    '共享助手',
  );
  assert.equal((await f.pc.list('entry')).length, 0);
  assert.equal(f.snapshot.rooms['-10000000000000000001'].future.nested[1], 'keep');
});

test('lost PC registration ACK retries identical durable operation and adopts its existing room without duplicate IDs', async (t) => {
  const f = await fixture(t, { loseFirstRegistrationAck: true });
  await assert.rejects(f.port.ready, /lost registration ACK/);
  const first = f.commands[0];
  assert.equal((await f.pc.status()).pending, 1);
  assert.deepEqual((await f.port.collect()).conflicts, []);
  const retries = f.commands.filter((command) => command.operationId === first.operationId);
  assert.equal(retries.length, 2);
  assert.deepEqual(retries[0], retries[1]);
  await f.android.sync();
  const view = await f.androidDirectory.list({ includeArchived: true });
  assert.equal(view.rooms.length, 2);
  assert.equal(view.rooms.filter((row) => row.id === first.input.conversationId).length, 1);
  assert.equal((await f.pc.status()).pending, 0);
});

test('PC baseline refuses concurrent Android profile/state/order changes and preserves unknown remote rooms', async (t) => {
  const f = await fixture(t);
  await f.port.ready;
  await f.android.sync();
  const id = f.id('-10000000000000000001');
  await f.androidDirectory.update(id, { title: 'Android改名' });
  f.snapshot.rooms['-10000000000000000001'].title = 'PC冲突草稿';
  const conflict = await f.port.collect();
  assert.equal(conflict.conflicts[0].code, 'DESKTOP_REMOTE_PROFILE_CHANGED');
  assert.equal((await f.directory.row(id)).title, 'Android改名');
  assert.equal(f.snapshot.rooms['-10000000000000000001'].title, 'PC冲突草稿');
  f.snapshot.rooms['-10000000000000000001'].title = '同名空房'; // unchanged PC baseline adopts remote without writing
  await f.port.collect();
  await f.androidDirectory.setState(id, { pinned: true });
  f.snapshot.rooms['-10000000000000000001'].isArchived = true;
  assert.equal((await f.port.collect()).conflicts[0].code, 'DESKTOP_REMOTE_STATE_CHANGED');
  assert.equal((await f.directory.row(id)).archived, false);
});

test('continuous port captures portable preferences with unknown fields and keeps Android conflicts explicit', async (t) => {
  const f = await fixture(t);
  await f.port.ready;
  assert.deepEqual(
    (
      await f.port.capturePreferences({
        textSize: 17,
        future: { color: 'x' },
        localPath: 'private',
      })
    ).conflicts,
    [],
  );
  await f.android.sync();
  const data = (await f.android.read('client-preferences', 'desktop:thoughts')).local.data;
  assert.equal(data.values.textSize, 17);
  assert.deepEqual(data.values.future, { color: 'x' });
  assert.equal(data.values.localPath, undefined);
  await f.android.enqueue({
    operationId: randomUUID(),
    action: 'client-preferences-save',
    input: {
      scope: 'desktop:thoughts',
      expectedRevision: data.revision,
      set: { textSize: 19, androidUnknown: true },
      remove: [],
    },
  });
  await f.android.sync();
  const conflict = await f.port.capturePreferences({ textSize: 18, future: { color: 'x' } });
  assert.equal(conflict.conflicts[0].code, 'DESKTOP_REMOTE_PREFERENCES_CHANGED');
  assert.equal(
    (await f.pc.read('client-preferences', 'desktop:thoughts')).local.data.values.textSize,
    19,
  );
});

test('PC manual ordering retains Android-only archived rooms and refuses a simultaneous remote reorder', async (t) => {
  const f = await fixture(t);
  await f.port.ready;
  await f.android.sync();
  const made = await f.androidDirectory.create({
    title: '仅安卓',
    mode: 'session',
    selfName: '我',
    category: '日常',
    idleHours: 5,
  });
  const other = made.result.conversationId;
  await f.androidDirectory.setState(other, { archived: true, pinned: true });
  await f.port.collect(); // observe remote additions without changing PC's local order
  f.snapshot.order.reverse();
  assert.deepEqual((await f.port.collect()).conflicts, []);
  let view = await f.directory.list({ includeArchived: true });
  assert.deepEqual(
    view.order.filter((id) => id !== other),
    [f.id('-2'), f.id('-10000000000000000001')],
  );
  assert.equal(view.order.filter((id) => id === other).length, 1);
  await f.android.sync();
  await f.androidDirectory.setOrder([other, f.id('-10000000000000000001'), f.id('-2')]);
  f.snapshot.order.reverse();
  const conflict = await f.port.collect();
  assert.equal(conflict.conflicts[0].code, 'DESKTOP_REMOTE_ORDER_CHANGED');
  view = await f.directory.list({ includeArchived: true });
  assert.deepEqual(view.order, [other, f.id('-10000000000000000001'), f.id('-2')]);
  assert.equal(view.rooms.find((room) => room.id === other).archived, true);
});

test('real persisted worker IDB read is readonly and selects directory only; missing migration and numeric IDs fail closed', async () => {
  const indexedDB = new IDBFactory();
  const put = (name, store, key, value) =>
    new Promise((resolve, reject) => {
      const open = indexedDB.open(name, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(store);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result,
          tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(value, key);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  const sourceId = randomUUID();
  const worker = {
    shiyeRooms: {
      '-20': {
        id: '-20',
        title: '空房',
        category: '',
        description: '',
        idleHours: 5,
        kind: 'session',
        participants: [],
      },
    },
    dialogs: { active: [{ id: '-20' }], archived: [] },
    messages: { secretBody: 'not transported' },
    documents: { privatePath: 'not transported' },
  };
  await put('shiye-journal-link-v1', 'settings', 'link', { sourceId, rooms: {} });
  await put('shiye-telegram-preview-v1', 'preview', 'library', worker);
  const raw = await readDesktopDirectorySnapshot({
    indexedDB,
    localStorage: { getItem: () => '["-20"]' },
  });
  assert.equal(raw.sourceId, sourceId);
  assert.equal(raw.messages, undefined);
  assert.equal(raw.documents, undefined);
  const captured = captureDesktopDirectory(raw);
  assert.equal(captured.rooms[0].conversationId, `desktop:${sourceId}:-20`);
  assert.equal(JSON.stringify(captured).includes('secretBody'), false);
  assert.throws(
    () =>
      captureDesktopDirectory({
        sourceId,
        rooms: { '-20': { ...worker.shiyeRooms['-20'], id: -20 } },
      }),
    /ROOM_ID_MISMATCH/,
  );
  assert.throws(() => captureDesktopDirectory({ sourceId }), /WORKER_DIRECTORY_REQUIRED/);
  assert.throws(
    () =>
      captureDesktopDirectory({
        sourceId,
        rooms: {
          '-900000001': { ...worker.shiyeRooms['-20'], id: '-900000001', isArchived: true },
        },
      }),
    /FIXED_ROOM_ARCHIVE/,
  );
  await assert.rejects(
    readDesktopDirectorySnapshot({
      indexedDB: new IDBFactory(),
      localStorage: { getItem: () => null },
    }),
    /WORKER_NOT_INITIALIZED/,
  );
});

test('actual PC worker command persistence and save broadcasts drive the injectable HTTP directory entry', async (t) => {
  const f = await fixture(t);
  await f.port.ready;
  f.port.stop();
  const previous = {
    indexedDB: globalThis.indexedDB,
    BroadcastChannel: globalThis.BroadcastChannel,
  };
  t.after(() => Object.assign(globalThis, previous));
  const worker = await loadWorker();
  const sourceId = randomUUID(),
    roomId = '-10000000000000000002';
  const local = {
    mockData: await worker.loadLocalPreview({
      users: [{ id: '1', self: true, firstName: '电脑本人' }],
      chats: [{ id: roomId, title: '真实worker空房' }],
      channels: [],
      documents: [],
      availableReactions: [],
      dialogFilters: [],
      topPeers: [],
      dialogs: { active: [{ id: roomId }], archived: [] },
      messages: { [roomId]: [] },
    }),
    fireUpdate() {},
  };
  worker.installLocalRoomCommands(local);
  const control = new Channel('shiye-local-rooms');
  const command = (action, payload) =>
    new Promise((resolve, reject) => {
      const requestId = randomUUID();
      const timer = setTimeout(() => reject(Error('worker timeout')), 3000);
      control.onmessage = ({ data }) => {
        if (data.requestId !== requestId) return;
        clearTimeout(timer);
        data.error ? reject(Error(data.error)) : resolve(data);
      };
      control.postMessage({ requestId, action, ...payload });
    });
  // Update uses actual saveLocalPreview and persists optional undefined metadata.
  await command('update', {
    id: roomId,
    title: '真实worker空房',
    idleHours: 5,
    kind: 'session',
    category: '',
  });
  await new Promise((resolve, reject) => {
    const open = indexedDB.open('shiye-journal-link-v1', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('settings');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result,
        tx = db.transaction('settings', 'readwrite');
      tx.objectStore('settings').put({ sourceId, rooms: {} }, 'link');
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
  });
  let captures = 0;
  const port = startDesktopDirectoryPort({
    client: f.pc,
    directory: f.directory,
    readSnapshot: () =>
      readDesktopDirectorySnapshot({ indexedDB, localStorage: { getItem: () => null } }),
    readLocalPreferences: async () => ({}),
    BroadcastChannel: Channel,
    events: null,
    pollMs: 0,
    onResult: () => {
      captures++;
    },
  });
  t.after(() => port.stop());
  await port.ready;
  const id = `desktop:${sourceId}:${roomId}`;
  await f.android.sync();
  assert.equal((await f.androidDirectory.row(id)).selfName, '电脑本人');
  assert.equal((await f.androidDirectory.row(id)).category, null);
  await command('update', {
    id: roomId,
    title: 'worker后续改名',
    category: '日常',
    idleHours: 8,
    kind: 'group',
    description: 'worker元数据',
    servicePlan: '计划但不执行',
  });
  // The actual JOURNAL_CHANNEL saved event triggers collection without UI hooks.
  for (let i = 0; i < 100 && captures < 2; i++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(captures >= 2);
  await f.android.sync();
  assert.equal((await f.androidDirectory.row(id)).title, 'worker后续改名');
  assert.equal(
    (await f.androidDirectory.row(id)).clientMetadata.desktop.servicePlan,
    '计划但不执行',
  );
  await command('set-state', { id: roomId, isPinned: true, isArchived: true });
  for (let i = 0; i < 100 && captures < 3; i++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(captures >= 3);
  await f.android.sync();
  const room = await f.androidDirectory.row(id);
  assert.equal(room.pinned, true);
  assert.equal(room.archived, true);
  assert.equal(room.messageOwner, 'legacy');
  assert.equal((await f.pc.list('entry')).length, 0);
});
