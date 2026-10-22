import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createDiaryServer } from '../src/server/app.mjs';

const api = '/api/conversation-services/conversations';
const sourceA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const sourceB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const canonical = (source, room) => `desktop:${source}:${room}`;
const hash = (value) =>
  createHash('sha256')
    .update(JSON.stringify(value) ?? 'undefined')
    .digest('hex');

/** Separate invented JSON library per test; never imports the runtime selector or production data. */
async function laboratory(t) {
  const directory = path.resolve('tmp/2026-10-19-shared-conversation-directory/http', randomUUID());
  await fs.mkdir(directory, { recursive: true });
  const original = {
    schema: 1,
    categories: ['日常', '学习'],
    entries: [],
    media: [],
    settings: { preferences: {} },
    chatJournal: {
      version: 1,
      rooms: [
        { sourceId: sourceA, id: '-101', title: '既有房A', category: '日常', idleHours: 5 },
        { sourceId: sourceB, id: '-101', title: '既有房B', category: '学习', idleHours: 8 },
      ],
      withdrawals: [],
    },
  };
  await fs.writeFile(path.join(directory, 'diary.json'), JSON.stringify(original));
  let server;
  let url;
  async function open() {
    server = await createDiaryServer({ dataDir: directory, seed: false });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${server.address().port}`;
  }
  async function close() {
    if (!server?.listening) return;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  const read = () => fs.readFile(path.join(directory, 'diary.json'), 'utf8').then(JSON.parse);
  const raw = () => fs.readFile(path.join(directory, 'diary.json'), 'utf8');
  function client() {
    let cookie;
    async function request(
      route,
      data,
      method = data === undefined ? 'GET' : 'POST',
      headers = {},
    ) {
      const response = await fetch(url + route, {
        method,
        headers: {
          'X-Diary-Client': 'desktop',
          'Content-Type': 'application/json',
          ...(cookie ? { Cookie: cookie } : {}),
          ...headers,
        },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
      const next = response.headers.get('set-cookie');
      if (next) cookie = next.split(';')[0];
      return { status: response.status, data: await response.json() };
    }
    async function call(route, data, method) {
      const result = await request(route, data, method);
      assert(result.status >= 200 && result.status < 300, JSON.stringify(result));
      return result.data;
    }
    async function upload(bytes) {
      const response = await fetch(url + '/api/chat-journal/media', {
        method: 'POST',
        headers: {
          'X-Diary-Client': 'desktop',
          'Content-Type': 'application/octet-stream',
          'X-File-Name': 'directory-fixture.bin',
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: bytes,
      });
      assert.equal(response.status, 201);
      return response.json();
    }
    return { request, call, upload, list: () => call(api) };
  }
  await open();
  t.after(close);
  return { directory, original, read, raw, open, close, a: client(), b: client() };
}

const creation = (overrides = {}) => ({
  operationId: randomUUID(),
  title: '两端共享的新会话',
  category: '日常',
  idleHours: 5,
  mode: 'session',
  selfName: '本人',
  description: '完整保留新建资料',
  ...overrides,
});
function row(view, id) {
  const result = view.conversations.find((item) => item.conversationId === id);
  assert(result, `Missing shared conversation ${id}`);
  return result;
}
async function create(client, input = creation()) {
  const answer = await client.call(api, input);
  const view = await client.list();
  const matches = view.conversations.filter((item) => item.title === input.title);
  assert.equal(matches.length, 1);
  const id = matches[0].conversationId;
  assert.match(id, /^desktop:[a-f0-9-]{36}:-?\d{1,20}$/);
  return { answer, input, id, view };
}

test('directory GET is pure and old rooms retain distinct source-qualified identities and legacy reads', async (t) => {
  const l = await laboratory(t);
  const before = await l.raw();
  const view = await l.a.list();
  assert.equal(view.version, 1);
  assert(Number.isSafeInteger(view.revision));
  assert.equal(view.conversations.length, 2);
  assert.equal(row(view, canonical(sourceA, '-101')).title, '既有房A');
  assert.equal(row(view, canonical(sourceB, '-101')).idleHours, 8);
  assert.equal(row(view, canonical(sourceA, '-101')).messageOwner, 'legacy');
  assert.deepEqual(
    new Set(view.order),
    new Set(view.conversations.map((item) => item.conversationId)),
  );
  assert.equal(await l.raw(), before);
  assert.deepEqual((await l.b.call('/api/chat-journal')).rooms, l.original.chatJournal.rooms);
  assert.equal(await l.raw(), before);
});

test('two clients create one canonical room and preserve new-room receipt across retry and server restart', async (t) => {
  const l = await laboratory(t);
  const input = creation();
  const [first, retry] = await Promise.all([l.a.call(api, input), l.b.call(api, input)]);
  assert.equal(retry.conversationId, first.conversationId);
  assert.equal(retry.directoryRevision, first.directoryRevision);
  assert.deepEqual(new Set([first.replayed, retry.replayed]), new Set([false, true]));
  const view = await l.a.list();
  assert.equal(view.conversations.length, 3);
  const created = view.conversations.find((item) => item.title === input.title);
  assert(created);
  assert.match(view.sourceId, /^[a-f0-9-]{36}$/);
  assert(created.conversationId.startsWith(`desktop:${view.sourceId}:`));
  assert.equal(created.mode, 'session');
  assert.equal(created.description, input.description);
  assert.equal(created.idleHours, input.idleHours);
  assert.equal(created.participants.find((actor) => actor.id === 'self').name, input.selfName);
  assert.equal(created.messageOwner, 'legacy');
  const bytes = await l.raw();
  assert.equal((await l.a.request(api, { ...input, title: '不能复用操作ID改内容' })).status, 409);
  assert.equal(await l.raw(), bytes);
  await l.close();
  await l.open();
  const replay = await l.b.call(api, input);
  assert.equal(replay.conversationId, first.conversationId);
  assert.equal(replay.replayed, true);
  const reopened = await l.b.list();
  assert.equal(reopened.sourceId, view.sourceId);
  assert.equal(row(reopened, created.conversationId).title, input.title);
  assert.equal((await l.read()).chatJournal.rooms.length, 3);
});

test('directory and existing conversation state read/write refer to one room with independent profile/list-state revisions', async (t) => {
  const l = await laboratory(t);
  const { id, view } = await create(l.a);
  const initial = row(view, id);
  const read = await l.b.call(api + '/state', { conversationId: id });
  assert.equal(read.conversationId, id);
  assert.equal(read.revision, initial.revision);
  await l.b.call(
    api + '/state',
    {
      conversationId: id,
      expectedRevision: read.revision,
      mode: 'group',
      title: '另一端修改同一会话',
      selfName: '共同本人',
      category: '学习',
      idleHours: 8,
    },
    'PUT',
  );
  const updated = row(await l.a.list(), id);
  assert.equal(updated.title, '另一端修改同一会话');
  assert.equal(updated.category, '学习');
  assert.equal(updated.idleHours, 8);
  assert.equal(updated.mode, 'group');
  assert.equal(updated.listStateRevision, initial.listStateRevision);
  await l.a.call(
    api + '/list-state',
    { conversationId: id, expectedRevision: initial.listStateRevision, pinned: true },
    'PUT',
  );
  const pinned = row(await l.b.list(), id);
  assert.equal(pinned.pinned, true);
  assert.equal(pinned.title, updated.title);
  assert.equal((await l.b.call(api + '/state', { conversationId: id })).revision, updated.revision);
  const beforeBinding = await l.b.list();
  await l.a.call('/api/conversation-services/settings/save', {
    conversationId: id,
    slotId: 'profile-check',
    providerId: 'external-program',
    expectedBindingRevision: 0,
    expectedConfigRevision: 0,
    config: {
      enabled: true,
      title: '目录独立性',
      sender: { name: '合成助手' },
      kind: 'ai',
      parameters: {},
    },
  });
  const afterBinding = await l.b.list();
  assert.equal(row(afterBinding, id).listStateRevision, pinned.listStateRevision);
  assert.equal(row(afterBinding, id).pinned, true);
  assert.deepEqual(afterBinding.order, beforeBinding.order);
  assert.equal(afterBinding.sourceId, beforeBinding.sourceId);
  assert.equal(afterBinding.revision, beforeBinding.revision);
});

test('shared pin/archive states use per-room CAS while independent room writes do not conflict', async (t) => {
  const l = await laboratory(t);
  const initial = await l.a.list();
  const idA = canonical(sourceA, '-101');
  const idB = canonical(sourceB, '-101');
  const a = row(initial, idA);
  const b = row(initial, idB);
  await l.a.call(
    api + '/list-state',
    { conversationId: idA, expectedRevision: a.listStateRevision, pinned: true },
    'PUT',
  );
  assert.equal(row(await l.b.list(), idA).pinned, true);
  const bytes = await l.raw();
  assert.equal(
    (
      await l.b.request(
        api + '/list-state',
        { conversationId: idA, expectedRevision: a.listStateRevision, archived: true },
        'PUT',
      )
    ).status,
    409,
  );
  assert.equal(await l.raw(), bytes);
  await l.b.call(
    api + '/list-state',
    { conversationId: idB, expectedRevision: b.listStateRevision, archived: true },
    'PUT',
  );
  const next = await l.a.list();
  assert.equal(row(next, idA).pinned, true);
  assert.equal(row(next, idB).archived, true);
  assert(next.order.includes(idB));
});

test('new directory rooms retain legacy message ownership and existing append/receipt APIs', async (t) => {
  const l = await laboratory(t);
  const { id } = await create(l.a);
  const [, sourceId, roomId] = id.split(':');
  const input = {
    sourceId,
    roomId,
    messages: [
      {
        id: '202',
        sentAt: new Date().toISOString(),
        text: '新目录房的旧写口消息',
        attachments: [],
      },
    ],
  };
  await l.a.call('/api/chat-journal/messages', input);
  const receipts = await l.b.call('/api/chat-journal/receipts', { sourceId, roomId, ids: ['202'] });
  assert.equal(receipts.accepted.length, 1);
  assert.equal(row(await l.b.list(), id).messageOwner, 'legacy');
  const before = await l.read();
  assert(before.entries.length > 0);
  await l.b.call('/api/chat-journal/messages', input);
  assert.equal(hash((await l.read()).entries), hash(before.entries));
  assert.equal(
    (await l.a.call('/api/chat-journal')).rooms.filter(
      (room) => room.sourceId === sourceId && room.id === roomId,
    ).length,
    1,
  );
});

test('complete shared order supports two-client CAS and rejects duplicate/missing identities atomically', async (t) => {
  const l = await laboratory(t);
  await create(l.a);
  const first = await l.a.list();
  const order = [...first.order].reverse();
  await l.a.call(api + '/order', { expectedRevision: first.revision, order }, 'PUT');
  const current = await l.b.list();
  assert.deepEqual(current.order, order);
  const bytes = await l.raw();
  assert.equal(
    (
      await l.b.request(
        api + '/order',
        { expectedRevision: first.revision, order: first.order },
        'PUT',
      )
    ).status,
    409,
  );
  assert.equal(await l.raw(), bytes);
  for (const invalid of [[order[0], order[0], ...order.slice(2)], order.slice(1)]) {
    const result = await l.b.request(
      api + '/order',
      { expectedRevision: current.revision, order: invalid },
      'PUT',
    );
    assert([400, 409].includes(result.status));
    assert.equal(await l.raw(), bytes);
  }
  await l.close();
  await l.open();
  assert.deepEqual((await l.a.list()).order, order);
});

test('archive and restore preserve old messages, attachments, program bindings and instance parameters', async (t) => {
  const l = await laboratory(t);
  const conversationId = canonical(sourceA, '-101');
  const originalBytes = Buffer.from('synthetic shared directory attachment');
  const media = await l.a.upload(originalBytes);
  await l.a.call('/api/chat-journal/messages', {
    sourceId: sourceA,
    roomId: '-101',
    messages: [
      {
        id: '101',
        sentAt: new Date().toISOString(),
        text: '归档前的合成消息',
        attachments: [media.id],
      },
    ],
  });
  const program = await l.a.call('/api/conversation-services/settings/save', {
    conversationId,
    slotId: 'assistant',
    providerId: 'external-program',
    expectedBindingRevision: 0,
    expectedConfigRevision: 0,
    config: {
      enabled: true,
      title: '合成AI登记',
      sender: { name: '合成助手' },
      kind: 'ai',
      parameters: { model: 'test-only', future: { preserve: true } },
    },
  });
  const before = await l.read();
  assert(before.entries.length > 0);
  const current = row(await l.a.list(), conversationId);
  await l.b.call(
    api + '/list-state',
    { conversationId, expectedRevision: current.listStateRevision, archived: true },
    'PUT',
  );
  const archived = await l.read();
  for (const field of ['entries', 'messageStore'])
    assert.equal(hash(archived[field]), hash(before[field]));
  assert.deepEqual(await fs.readFile(path.join(l.directory, 'media', media.id)), originalBytes);
  assert.deepEqual(archived.media, before.media);
  assert.equal(
    hash(archived.conversationServices.instances),
    hash(before.conversationServices.instances),
  );
  assert.equal(
    hash(archived.conversationServices.bindings),
    hash(before.conversationServices.bindings),
  );
  const settings = await l.a.call('/api/conversation-services/settings/read', {
    conversationId,
    slotId: 'assistant',
  });
  assert.equal(settings.instanceId, program.instanceId);
  assert.equal(settings.config.parameters.future.preserve, true);
  assert.equal(
    (await l.a.call('/api/chat-journal')).rooms.find((room) => room.sourceId === sourceA).id,
    '-101',
  );
  await l.close();
  await l.open();
  const afterRestart = row(await l.b.list(), conversationId);
  assert.equal(afterRestart.archived, true);
  await l.b.call(
    api + '/list-state',
    { conversationId, expectedRevision: afterRestart.listStateRevision, archived: false },
    'PUT',
  );
  assert.equal(row(await l.a.list(), conversationId).archived, false);
  assert.equal(hash((await l.read()).entries), hash(before.entries));
  assert.deepEqual(await fs.readFile(path.join(l.directory, 'media', media.id)), originalBytes);
});

test('source guard and lock authentication reject unauthorized directory reads and writes without mutations', async (t) => {
  const l = await laboratory(t);
  const before = await l.raw();
  assert.equal((await l.a.request(api, creation(), 'POST', { 'X-Diary-Client': '' })).status, 403);
  assert.equal(
    (await l.a.request(api, creation(), 'POST', { Origin: 'https://other.invalid' })).status,
    403,
  );
  assert.equal(await l.raw(), before);
  await l.a.call('/api/access', { password: 'synthetic-directory-password' }, 'PUT');
  const locked = await l.raw();
  assert.equal((await l.b.request(api)).status, 401);
  assert.equal((await l.b.request(api, creation())).status, 401);
  assert.equal(await l.raw(), locked);
  await l.b.call('/api/unlock', { password: 'synthetic-directory-password' });
  assert.equal((await l.b.list()).conversations.length, 2);
});
