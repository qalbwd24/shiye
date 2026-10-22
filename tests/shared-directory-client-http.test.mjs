import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createDiaryServer } from '../src/server/app.mjs';
import { createSharedBusinessClient } from '../public/shared/shared-business-client.js';
import { createSharedDirectoryClient } from '../public/shared/shared-directory-client.js';
import { createSharedDiaryClient } from '../public/shared/shared-diary-client.js';
import { createMemorySyncStorage } from './helpers/sync-v2-client-memory.mjs';

async function lab(t) {
  const dataDir = path.resolve('tmp/shared-directory-integration', randomUUID());
  await fs.mkdir(dataDir, { recursive: true });
  const server = await createDiaryServer({ dataDir, seed: false, sharedSync: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(route, input, method = input === undefined ? 'GET' : 'POST') {
    const response = await fetch(base + route, {
      method,
      headers: { 'X-Diary-Client': 'desktop', 'Content-Type': 'application/json' },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    });
    const value = await response.json();
    if (!response.ok)
      throw Object.assign(new Error(value.error?.code || 'HTTP_FAILURE'), {
        status: response.status,
        code: value.error?.code,
      });
    return value;
  }
  const info = await request('/api/shared/v1/info');
  const online = (options) => ({ ...options, sync: true });
  const connect = () => {
    const client = createSharedBusinessClient({
      storage: createMemorySyncStorage(),
      libraryId: info.libraryId,
      epoch: info.epoch,
      request: (action, input) =>
        request('/api/shared/v1/' + action, action === 'info' ? undefined : input),
    });
    const directory = createSharedDirectoryClient({ client });
    const diary = createSharedDiaryClient({ client });
    return {
      client,
      directory: {
        ...directory,
        create: (input, options) => directory.create(input, online(options)),
        update: (id, changes, options) => directory.update(id, changes, online(options)),
        setState: (id, changes, options) => directory.setState(id, changes, online(options)),
        setOrder: (order, options) => directory.setOrder(order, online(options)),
        saveSettings: (input, options) => directory.saveSettings(input, online(options)),
        register: (input, options) => directory.register(input, online(options)),
      },
      diary: {
        ...diary,
        save: (id, changes, revision, options) =>
          diary.save(id, changes, revision, online(options)),
        saveTemplate: (id, value, options) => diary.saveTemplate(id, value, online(options)),
        savePreferences: (values, revision, options) =>
          diary.savePreferences(values, revision, online(options)),
        saveClientPreferences: (scope, values, revision, options) =>
          diary.saveClientPreferences(scope, values, revision, online(options)),
      },
    };
  };
  return { request, connect };
}
const room = (title) => ({
  title,
  mode: 'session',
  selfName: '本人',
  category: '日常',
  idleHours: 5,
  description: '完整说明',
});

test('offline local-first Entry and room commands drain in order to the original business owner', async (t) => {
  const f = await lab(t),
    info = await f.request('/api/shared/v1/info');
  let offline = true;
  const client = createSharedBusinessClient({
    storage: createMemorySyncStorage(),
    libraryId: info.libraryId,
    epoch: info.epoch,
    request: (action, input) => {
      if (offline) throw Object.assign(new Error('OFFLINE'), { code: 'OFFLINE' });
      return f.request('/api/shared/v1/' + action, action === 'info' ? undefined : input);
    },
  });
  const diary = createSharedDiaryClient({ client }),
    directory = createSharedDirectoryClient({ client });
  const id = randomUUID();
  const created = await diary.create(
    {
      id,
      title: 'offline',
      content: '<p>one</p>',
      contentFormat: 'html',
      date: '2026-10-19T01:00:00.000Z',
      category: '日常',
      tags: [],
      attachments: [],
    },
    { sync: false },
  );
  const saved = await diary.save(id, { title: 'edited' }, created.localRevision, { sync: false });
  await diary.save(id, { content: '<p>two</p>' }, saved.localRevision, { sync: false });
  const sourceId = randomUUID();
  const roomMade = await directory.create(
    { ...room('new'), category: null },
    { sourceId, sync: false },
  );
  await directory.update(roomMade.conversationId, { title: 'updated' }, { sync: false });
  await directory.setState(roomMade.conversationId, { pinned: true }, { sync: false });
  await directory.setOrder([roomMade.conversationId], { sync: false });
  assert.equal((await client.status()).pending, 7);
  offline = false;
  await client.sync();
  assert.equal((await client.status()).pending, 0);
  assert.equal((await f.request('/api/entries/' + id)).title, 'edited');
  assert.equal((await f.request('/api/entries/' + id)).content, '<p>two</p>');
  const rooms = await f.request('/api/conversation-services/conversations');
  assert.equal(
    rooms.conversations.find((row) => row.conversationId === roomMade.conversationId).title,
    'updated',
  );
  assert.equal(
    rooms.conversations.find((row) => row.conversationId === roomMade.conversationId).pinned,
    true,
  );
});

test('existing Entry saves three times offline and a partial new room still edits and drains', async (t) => {
  const f = await lab(t),
    info = await f.request('/api/shared/v1/info');
  const existing = await f.request('/api/entries', {
    title: 'base',
    content: '<p>base</p>',
    contentFormat: 'html',
    date: '2026-10-19T01:00:00.000Z',
    category: '日常',
    tags: [],
    attachments: [],
  });
  let offline = false;
  const client = createSharedBusinessClient({
    storage: createMemorySyncStorage(),
    libraryId: info.libraryId,
    epoch: info.epoch,
    request: (action, input) => {
      if (offline) throw Object.assign(new Error('OFFLINE'), { code: 'OFFLINE' });
      return f.request('/api/shared/v1/' + action, action === 'info' ? undefined : input);
    },
  });
  const diary = createSharedDiaryClient({ client }),
    directory = createSharedDirectoryClient({ client });
  await client.receive();
  offline = true;
  for (const title of ['one', 'two', 'three']) {
    const row = await diary.read(existing.id);
    await diary.save(existing.id, { title }, row.localRevision, { sync: false });
  }
  const sourceId = randomUUID();
  const made = await directory.create(
    { title: 'partial', category: '日常', idleHours: 5, mode: 'session' },
    { sourceId, sync: false },
  );
  await directory.update(made.conversationId, { title: 'partial edited' }, { sync: false });
  await directory.setState(made.conversationId, { pinned: true }, { sync: false });
  await directory.setOrder([made.conversationId], { sync: false });
  const pending = await client.status();
  assert.equal(pending.pending, 7);
  offline = false;
  await client.sync();
  assert.equal((await client.status()).pending, 0);
  assert.equal((await f.request('/api/entries/' + existing.id)).title, 'three');
  const rooms = await f.request('/api/conversation-services/conversations');
  assert.equal(
    rooms.conversations.find((row) => row.conversationId === made.conversationId).title,
    'partial edited',
  );
});

test('existing room keeps content, list state, and directory order in separate offline dependency chains', async (t) => {
  const f = await lab(t),
    online = f.connect();
  const one = await online.directory.create(room('one')),
    two = await online.directory.create(room('two'));
  const firstId = one.conversationId,
    secondId = two.conversationId;
  const info = await f.request('/api/shared/v1/info');
  let offline = false;
  const client = createSharedBusinessClient({
    storage: createMemorySyncStorage(),
    libraryId: info.libraryId,
    epoch: info.epoch,
    request: (action, input) => {
      if (offline) throw Object.assign(new Error('OFFLINE'), { code: 'OFFLINE' });
      return f.request('/api/shared/v1/' + action, action === 'info' ? undefined : input);
    },
  });
  const directory = createSharedDirectoryClient({ client });
  await client.receive();
  offline = true;
  await directory.update(firstId, { title: 'edit one' }, { sync: false });
  await directory.update(firstId, { title: 'edit two' }, { sync: false });
  await directory.setState(firstId, { pinned: true }, { sync: false });
  await directory.setState(firstId, { archived: true }, { sync: false });
  await directory.setOrder([secondId, firstId], { sync: false });
  await directory.setOrder([firstId, secondId], { sync: false });
  const pending = await client.status();
  assert.equal(pending.pending, 6);
  offline = false;
  await client.sync();
  assert.equal((await client.status()).pending, 0);
  const row = await directory.row(firstId);
  assert.equal(row.title, 'edit two');
  assert.equal(row.pinned, true);
  assert.equal(row.archived, true);
  assert.deepEqual((await directory.list({ includeArchived: true })).order, [firstId, secondId]);
});

test('Entry save, delete, restore, and save retain one trusted revision chain', async (t) => {
  const f = await lab(t),
    info = await f.request('/api/shared/v1/info');
  const existing = await f.request('/api/entries', {
    title: 'base',
    content: '<p>base</p>',
    contentFormat: 'html',
    date: '2026-10-19T01:00:00.000Z',
    category: '日常',
    tags: [],
    attachments: [],
  });
  let offline = false;
  const client = createSharedBusinessClient({
    storage: createMemorySyncStorage(),
    libraryId: info.libraryId,
    epoch: info.epoch,
    request: (action, input) => {
      if (offline) throw Object.assign(new Error('OFFLINE'), { code: 'OFFLINE' });
      return f.request('/api/shared/v1/' + action, action === 'info' ? undefined : input);
    },
  });
  const diary = createSharedDiaryClient({ client });
  await client.receive();
  offline = true;
  const first = await diary.read(existing.id);
  await diary.save(existing.id, { title: 'first' }, first.localRevision, { sync: false });
  await diary.setDeleted(existing.id, true, { sync: false });
  await diary.setDeleted(existing.id, false, { sync: false });
  const latest = await diary.read(existing.id);
  await diary.save(existing.id, { title: 'last' }, latest.localRevision, { sync: false });
  offline = false;
  await client.sync();
  assert.equal((await client.status()).pending, 0);
  const result = await f.request('/api/entries/' + existing.id);
  assert.equal(result.title, 'last');
  assert.equal(result.deleted, false);
});

test('foreign room and wrong revision-domain receipts cannot authorize local successors', async (t) => {
  const f = await lab(t),
    online = f.connect();
  const a = await online.directory.create(room('a')),
    b = await online.directory.create(room('b'));
  const info = await f.request('/api/shared/v1/info');
  const command = (action, input) =>
    f.request('/api/shared/v1/command', {
      operationId: randomUUID(),
      action,
      input,
      libraryId: info.libraryId,
      epoch: info.epoch,
    });
  await assert.rejects(
    () =>
      command('conversation-save-local', {
        conversationId: b.conversationId,
        title: 'forged',
        baseOperationId: a.operationId,
      }),
    { status: 409, code: 'SHARED_CONVERSATION_DEPENDENCY_MISSING' },
  );
  await assert.rejects(
    () =>
      command('conversation-state-local', {
        conversationId: b.conversationId,
        pinned: true,
        baseOperationId: a.operationId,
      }),
    { status: 409, code: 'SHARED_CONVERSATION_STATE_DEPENDENCY_MISSING' },
  );
  const state = await online.directory.setState(a.conversationId, { pinned: true });
  await assert.rejects(
    () =>
      command('conversation-save-local', {
        conversationId: a.conversationId,
        title: 'wrong domain',
        baseOperationId: state.operationId,
      }),
    { status: 409, code: 'SHARED_CONVERSATION_DEPENDENCY_MISSING' },
  );
  assert.equal((await online.directory.row(b.conversationId)).title, 'b');
});
test('two directory clients share canonical creation, pin/archive/full order and atomic unknown program config', async (t) => {
  const f = await lab(t),
    a = f.connect(),
    b = f.connect();
  await a.client.receive();
  const made = await a.directory.create(room('来自安卓'));
  const id = made.result?.conversationId || (await a.directory.list()).rooms[0].id;
  const next = await a.directory.create(room('第二房'));
  const second =
    next.result?.conversationId || (await a.directory.list()).rooms.find((r) => r.id !== id).id;
  await a.directory.setState(id, { pinned: true });
  await a.directory.setOrder([second, id]);
  await b.client.receive();
  const rows = await b.directory.list();
  assert.deepEqual(rows.order, [second, id]);
  assert.equal(rows.rooms[0].id, id);
  assert.equal(rows.rooms[0].pinned, true);
  await b.directory.update(id, {
    mode: 'group',
    selfName: '同一个人',
    description: '跨端说明',
    idleHours: 7,
  });
  await b.directory.saveSettings({
    conversationId: id,
    slotId: 'ai',
    providerId: 'external-program',
    expectedBindingRevision: 0,
    expectedConfigRevision: 0,
    config: {
      enabled: true,
      title: '角色',
      kind: 'ai',
      sender: { name: '助手' },
      parameters: { future: { unknown: ['保留', false] } },
    },
  });
  await a.client.receive();
  assert.equal((await a.directory.row(id)).selfName, '同一个人');
  assert.deepEqual((await a.directory.settings(id, 'ai')).config.parameters.future, {
    unknown: ['保留', false],
  });
  await a.directory.setState(id, { archived: true });
  await b.client.receive();
  assert.equal(
    (await b.directory.list()).rooms.some((r) => r.id === id),
    false,
  );
  assert.equal(
    (await b.directory.list({ includeArchived: true })).rooms.find((r) => r.id === id).archived,
    true,
  );
  await b.directory.setState(id, { archived: false });
  const legacy = await f.request('/api/conversation-services/conversations');
  assert.equal(legacy.conversations.find((r) => r.conversationId === id).description, '跨端说明');
  assert.deepEqual(legacy.order, [second, id]);
});
test('explicit desktop registration preserves 20-digit string ID; same title creates separate conversations', async (t) => {
  const f = await lab(t),
    a = f.connect();
  await a.client.receive();
  const id = `desktop:${randomUUID()}:-12345678901234567890`;
  await a.directory.register({
    conversationId: id,
    expectedRevision: 0,
    ...room('同名'),
    clientMetadata: {
      desktop: { wallpaperAssetId: randomUUID(), future: { unknown: [false, 3, '保留'] } },
    },
  });
  await a.directory.create(room('同名'));
  const rows = (await a.directory.list()).rooms;
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.id === id).roomId, '-12345678901234567890');
  assert.equal(rows.find((r) => r.id === id).messageOwner, 'legacy');
  assert.deepEqual(rows.find((r) => r.id === id).clientMetadata.desktop.future, {
    unknown: [false, 3, '保留'],
  });
  await a.directory.update(id, { title: '更名' });
  assert.deepEqual((await a.directory.row(id)).clientMetadata.desktop.future, {
    unknown: [false, 3, '保留'],
  });
});
test('diary adapter uses old entry rules, preserves unseen fields, shares templates/preferences and blocks stale settings', async (t) => {
  const f = await lab(t),
    a = f.connect(),
    b = f.connect();
  await a.client.receive();
  const made = await f.request('/api/entries', {
    title: '电脑原篇',
    content: '<p>正文</p>',
    contentFormat: 'html',
    date: '2026-10-19T01:00:00.000Z',
    category: '日常',
    tags: [],
    attachments: [],
    location: '原位置',
    mood: '平静',
    weather: '晴',
  });
  await a.client.receive();
  const prior = await a.diary.read(made.id);
  await a.diary.save(made.id, { title: '安卓仅改标题' }, prior.localRevision);
  const old = await f.request('/api/entries/' + made.id);
  assert.equal(old.title, '安卓仅改标题');
  assert.equal(old.location, '原位置');
  assert.equal(old.history.length, 1);
  await a.diary.saveTemplate(null, {
    name: '共同模板',
    title: '标题',
    content: '<p>模板正文</p>',
    category: '日常',
    tags: [],
  });
  await b.client.receive();
  assert.equal(
    (await b.diary.templates()).some((r) => r.local.data.name === '共同模板'),
    true,
  );
  const settings = await a.diary.preferences();
  await a.diary.savePreferences({ theme: 'dark' }, settings.base.revision);
  const stale = await b.diary.preferences();
  await assert.rejects(
    b.diary.savePreferences({ theme: 'light' }, stale.base.revision),
    (e) => e.status === 409,
  );
  assert.equal((await b.client.status()).pending, 1);
  assert.ok((await b.client.status()).paused);
  assert.equal((await a.diary.preferences()).local.data.preferences.theme, 'dark');
});
test('portable WebView preferences share patch/CAS semantics and preserve unknown arrays without copying credentials or device paths', async (t) => {
  const f = await lab(t),
    a = f.connect(),
    b = f.connect();
  await a.client.receive();
  await a.diary.saveClientPreferences(
    'android:diary',
    {
      'shiye.android.diary.entry-image-width.v1': [
        { id: 'entry-one', width: 72, future: [false, '保留'] },
      ],
    },
    0,
  );
  await b.client.receive();
  const prior = await b.diary.clientPreferences('android:diary');
  assert.deepEqual(prior.local.data.values['shiye.android.diary.entry-image-width.v1'][0].future, [
    false,
    '保留',
  ]);
  await b.diary.saveClientPreferences(
    'android:diary',
    { 'future-appearance': { scale: 116 } },
    prior.local.data.revision,
  );
  await a.client.receive();
  const next = await a.diary.clientPreferences('android:diary');
  assert.equal(next.local.data.values['shiye.android.diary.entry-image-width.v1'][0].width, 72);
  assert.equal(next.local.data.values['future-appearance'].scale, 116);
  await assert.rejects(
    a.diary.saveClientPreferences('android:diary', { apiKey: 'secret' }, next.local.data.revision),
    (e) => e.status === 400,
  );
  const db = await f.request('/api/library');
  assert.equal(JSON.stringify(db.sharedClientPreferences).includes('secret'), false);
});
test('uncategorized desktop empty rooms register as metadata; sending still requires an explicit valid diary category', async (t) => {
  const f = await lab(t),
    a = f.connect(),
    id = `desktop:${randomUUID()}:-9999999999999999999`;
  await a.client.receive();
  await a.directory.register({
    conversationId: id,
    expectedRevision: 0,
    ...room('未归类空房'),
    category: null,
  });
  assert.equal((await a.directory.row(id)).category, null);
  const sourceId = id.split(':')[1],
    roomId = id.split(':')[2];
  const bad = await f
    .request('/api/chat-journal/messages', {
      sourceId,
      roomId,
      messages: [
        {
          id: '123',
          sentAt: '2026-10-19T12:00:00.000Z',
          text: '尚未配置归篇分类',
          attachments: [],
        },
      ],
    })
    .catch((e) => e);
  assert.equal(bad.status, 409);
  await a.directory.update(id, { category: '日常' });
  const sent = await f.request('/api/chat-journal/messages', {
    sourceId,
    roomId,
    messages: [
      { id: '123', sentAt: '2026-10-19T12:00:00.000Z', text: '明确分类后保存', attachments: [] },
    ],
  });
  assert.ok(sent);
});
