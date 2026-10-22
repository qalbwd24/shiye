import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { IDBFactory } from 'fake-indexeddb';
import { createDiaryServer } from '../src/server/app.mjs';
import { createIndexedDbSyncStorage } from '../public/shared/sync-v2-client.js';
import { createSharedBusinessClient } from '../public/shared/shared-business-client.js';
import { createSharedDiaryClient } from '../public/shared/shared-diary-client.js';

const entryInput = () => ({
  title: '原稿',
  content: '<p>合成正文</p>',
  date: '2026-10-19T00:00:00Z',
  category: '日常',
  tags: [],
  attachments: [],
});
async function lab(t) {
  const root = path.resolve('tmp/backend-shared-auth/editor-generation');
  await mkdir(root, { recursive: true });
  const dataDir = await mkdtemp(path.join(root, 'case-'));
  const server = await createDiaryServer({ dataDir, seed: false, sharedSync: true });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.close();
    await once(server, 'close');
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function http(route, input, method = input === undefined ? 'GET' : 'POST') {
    const response = await fetch(base + route, {
      method,
      headers: { 'X-Diary-Client': 'desktop', 'Content-Type': 'application/json' },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    });
    const value = await response.json();
    if (!response.ok)
      throw Object.assign(Error(value.error?.code || value.error), {
        code: value.error?.code,
        status: response.status,
      });
    return value;
  }
  const info = await http('/api/shared/v1/info'),
    indexedDB = new IDBFactory(),
    dbName = `shiye-sync-v2-editor-${randomUUID()}`;
  let storage = createIndexedDbSyncStorage({ indexedDB, dbName }),
    gate = null;
  const request = async (action, input) => {
    const result = await http('/api/shared/v1/' + action, action === 'info' ? undefined : input);
    if (action === 'command' && gate) await gate(result);
    return result;
  };
  let client, diary;
  function open() {
    client = createSharedBusinessClient({
      storage,
      request,
      libraryId: info.libraryId,
      epoch: info.epoch,
    });
    diary = createSharedDiaryClient({ client });
  }
  open();
  t.after(() => storage.close());
  return {
    http,
    get client() {
      return client;
    },
    get diary() {
      return diary;
    },
    setGate(value) {
      gate = value;
    },
    async reopen() {
      await storage.close();
      storage = createIndexedDbSyncStorage({ indexedDB, dbName });
      open();
    },
  };
}

test('real HTTP remote save invalidates persisted editor token; unchanged remote/no-op replay remains saveable', async (t) => {
  const f = await lab(t),
    made = await f.http('/api/entries', entryInput());
  await f.client.sync();
  const opened = await f.diary.read(made.id);
  await f.client.sync();
  assert.equal((await f.diary.read(made.id)).localRevision, opened.localRevision);
  await f.http('/api/entries/' + made.id, { ...made, title: 'PC新稿' }, 'PUT');
  await f.client.sync();
  await f.reopen();
  const current = await f.diary.read(made.id);
  assert.ok(current.localRevision > opened.localRevision);
  await assert.rejects(() => f.diary.save(made.id, { title: '旧草稿' }, opened.localRevision), {
    code: 'SHARED_LOCAL_REVISION_CONFLICT',
  });
  await assert.rejects(
    () => f.diary.setDeleted(made.id, true, { expectedLocalRevision: opened.localRevision }),
    { code: 'SHARED_LOCAL_REVISION_CONFLICT' },
  );
  assert.equal((await f.client.status()).pending, 0);
  const result = await f.diary.save(made.id, { title: '已看新稿后保存' }, current.localRevision);
  assert.equal((await f.client.readOperation(result.operationId)).status, 'acknowledged');
  assert.equal((await f.http('/api/entries/' + made.id)).title, '已看新稿后保存');
});

test('canonical/history/unknown/state authoritative generations advance token, equal or older replay does not', async (t) => {
  const libraryId = randomUUID(),
    epoch = randomUUID(),
    info = { libraryId, epoch, seq: 10 },
    indexedDB = new IDBFactory();
  const storage = createIndexedDbSyncStorage({
    indexedDB,
    dbName: `shiye-sync-v2-generation-${randomUUID()}`,
  });
  t.after(() => storage.close());
  let version = 1;
  const envelope = (revision) => ({
    entityType: 'entry',
    entityId: 'one',
    revision,
    seq: revision,
    state: revision === 5 ? 'withdrawn' : 'active',
    data: {
      title: 'same',
      unknownFuture: { value: revision >= 4 },
      history: [{ text: revision >= 3 ? 'changed history' : 'old history' }],
    },
    canonical: {
      units: [
        { id: 'u', body: { text: revision >= 2 ? 'canonical changed' : 'canonical original' } },
      ],
      layout: { ids: ['u'] },
    },
  });
  const client = createSharedBusinessClient({
    storage,
    libraryId,
    epoch,
    request: async (action) => {
      if (action === 'info') return info;
      return {
        info,
        [action === 'snapshot' ? 'entities' : 'changes']: [envelope(version)],
        next: 10,
        hasMore: false,
      };
    },
  });
  await client.receive();
  const initial = (await client.read('entry', 'one')).localRevision;
  await client.receive();
  assert.equal((await client.read('entry', 'one')).localRevision, initial);
  for (version = 2; version <= 5; version++) {
    const before = (await client.read('entry', 'one')).localRevision;
    await client.receive();
    assert.equal((await client.read('entry', 'one')).localRevision, before + 1);
  }
  const final = (await client.read('entry', 'one')).localRevision;
  version = 1;
  await client.receive();
  assert.equal((await client.read('entry', 'one')).localRevision, final);
  assert.deepEqual((await client.read('entry', 'one')).local.data, {});
});

test('same body metadata/history changes invalidate token; concurrent local saves share transaction CAS', async (t) => {
  const f = await lab(t),
    made = await f.http('/api/entries', entryInput());
  await f.client.sync();
  const opened = await f.diary.read(made.id);
  await f.http('/api/entries/' + made.id, { ...made, mood: '仅改元数据' }, 'PUT');
  await f.client.sync();
  const updated = await f.diary.read(made.id);
  assert.equal(updated.base.data.content, opened.base.data.content);
  assert.ok(updated.localRevision > opened.localRevision);
  await assert.rejects(
    () => f.diary.save(made.id, { title: '旧元数据token' }, opened.localRevision),
    { code: 'SHARED_LOCAL_REVISION_CONFLICT' },
  );
  const attempts = await Promise.allSettled([
    f.diary.save(made.id, { title: '并发A' }, updated.localRevision, { sync: false }),
    f.diary.save(made.id, { title: '并发B' }, updated.localRevision, { sync: false }),
  ]);
  assert.equal(attempts.filter((v) => v.status === 'fulfilled').length, 1);
  assert.equal(
    attempts.find((v) => v.status === 'rejected').reason.code,
    'SHARED_LOCAL_REVISION_CONFLICT',
  );
});

test('late real ACK updates base generation but retains newer optimistic edit/draft and first command receipt', async (t) => {
  const f = await lab(t),
    made = await f.http('/api/entries', entryInput());
  await f.client.sync();
  const opened = await f.diary.read(made.id);
  const first = await f.diary.save(made.id, { title: 'A先发送' }, opened.localRevision, {
    sync: false,
  });
  let release, arrived;
  const waiting = new Promise((resolve) => {
    arrived = resolve;
  });
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  f.setGate(async () => {
    f.setGate(null);
    arrived();
    await blocked;
  });
  const flush = f.client.flush();
  await waiting;
  const editing = await f.diary.read(made.id);
  await f.diary.save(made.id, { title: 'B保留本机' }, editing.localRevision, { sync: false });
  await f.client.setDraft('room', { text: 'ACK期间的新草稿', replyId: null });
  release();
  await assert.rejects(
    () => flush,
    (e) => e.status === 409,
  );
  const latest = await f.diary.read(made.id);
  assert.equal(latest.base.data.title, 'A先发送');
  assert.equal(latest.local.data.title, 'B保留本机');
  assert.ok(latest.localRevision > editing.localRevision);
  assert.equal((await f.client.readDraft('room')).text, 'ACK期间的新草稿');
  assert.equal((await f.client.readOperation(first.operationId)).status, 'acknowledged');
  assert.equal((await f.client.status()).pending, 1);
});
