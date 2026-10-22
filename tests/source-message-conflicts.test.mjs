import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { IDBFactory } from 'fake-indexeddb';
import { captureDesktopSource } from '../previews/telegram-chat/shiye-desktop-source-capture.js';
import { createDiaryServer } from '../src/server/app.mjs';
import {
  computerOwnerTransport,
  registerComputerSourceConflicts,
} from '../src/server/shared-sync/computer-export.mjs';
import { exportSharedSeed, readSharedSeed } from '../src/server/shared-sync/seed-package.mjs';
import {
  sourceMessageFingerprint,
  purgeSourceMessageConflicts,
  registerSourceMessageConflicts,
} from '../src/server/shared-sync/source-message-conflicts.mjs';

async function put(factory, name, store, key, value) {
  await new Promise((resolve, reject) => {
    const request = factory.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(store);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result,
        tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
  });
}
async function fixture(t) {
  const root = path.resolve('tmp/source-message-conflicts-tests');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'case-')),
    exportsDir = path.join(directory, 'exports'),
    captureDir = path.join(exportsDir, 'capture'),
    dataDir = path.join(directory, 'data');
  await mkdir(captureDir, { recursive: true });
  await mkdir(dataDir);
  const sourceId = randomUUID(),
    entryId = randomUUID(),
    roomId = '-103',
    ids = ['20000000000000000001', '20000000000000000002'];
  const factory = new IDBFactory();
  await put(factory, 'shiye-journal-link-v1', 'settings', 'link', {
    sourceId,
    rooms: { [roomId]: { enabled: true } },
  });
  await put(factory, 'shiye-telegram-preview-v1', 'preview', 'library', {
    shiyeRooms: { [roomId]: { title: 'synthetic' } },
    messages: {
      [roomId]: ids.map((id, i) => ({
        id,
        out: true,
        message: `source candidate ${i}`,
        date: 1760832000 + i,
        privateRuntime: 'must not copy',
      })),
    },
  });
  const members = [];
  let chunks = [];
  const summary = await captureDesktopSource({
    indexedDB: factory,
    localStorage: { length: 0, key: () => null, getItem: () => null },
    emit: async (event) => {
      if (event.kind === 'member-start') chunks = [];
      if (event.kind === 'member-chunk') chunks.push(Buffer.from(event.dataBase64, 'base64'));
      if (event.kind === 'member-end') {
        const file = path.join(captureDir, event.path);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, Buffer.concat(chunks));
        members.push({ path: event.path, sha256: event.sha256, size: event.size });
      }
    },
  });
  const manifestBytes = Buffer.from(
    JSON.stringify({
      format: 'shiye-desktop-logical-capture',
      version: 1,
      members,
      summary,
      bytes: members.reduce((n, m) => n + m.size, 0),
    }),
  );
  await writeFile(path.join(captureDir, 'capture-manifest.json'), manifestBytes);
  const messages = ids.map((id, i) => ({
    id,
    sentAt: `2025-10-19T00:00:0${i}.000Z`,
    text: `owner candidate ${i}`,
    attachments: [],
    unknownNested: { history: `owner preserved ${i}` },
  }));
  const entry = {
    id: entryId,
    title: 'synthetic',
    content: '<p>owner aggregate</p>',
    contentFormat: 'html',
    date: '2025-10-19T00:00:00.000Z',
    createdAt: '2025-10-19T00:00:00.000Z',
    updatedAt: '2025-10-19T00:00:00.000Z',
    revision: 1,
    category: '日常',
    tags: [],
    attachments: [],
    history: [],
    chatJournal: {
      sourceId,
      roomId,
      messages,
      status: 'open',
      firstAt: messages[0].sentAt,
      lastAt: messages[1].sentAt,
    },
  };
  entry.chatJournal.projectionHash = createHash('sha256')
    .update(JSON.stringify([entry.title, entry.content, entry.category, entry.attachments]))
    .digest('hex');
  await writeFile(
    path.join(dataDir, 'diary.json'),
    JSON.stringify({
      schema: 1,
      categories: ['日常'],
      entries: [entry],
      media: [],
      imports: [],
      chatJournal: {
        rooms: [{ sourceId, id: roomId, title: 'synthetic', category: '日常', idleHours: 5 }],
        withdrawals: [],
      },
    }),
  );
  let server;
  async function start() {
    server = await createDiaryServer({
      dataDir,
      seed: false,
      sharedSync: true,
      sourceCollection: { exportsDir },
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() {
    if (server) {
      const s = server;
      server = null;
      s.close();
      await once(s, 'close');
    }
  }
  t.after(stop);
  let base = await start();
  const request = async (url, input, headers = {}, method = 'POST') => {
    const response = await fetch(base + url, {
      method,
      headers: { 'X-Diary-Client': 'desktop', 'Content-Type': 'application/json', ...headers },
      ...(method === 'GET' ? {} : { body: JSON.stringify(input) }),
    });
    return {
      status: response.status,
      value: await response.json(),
      cookie: response.headers.get('set-cookie')?.split(';')[0],
    };
  };
  const input = {
    operationId: randomUUID(),
    captureRelativePath: 'capture',
    captureManifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
    records: messages.map((message) => ({
      roomId,
      messageId: message.id,
      expectedOwnerSha256: sourceMessageFingerprint(message),
    })),
  };
  const db = async () => JSON.parse(await readFile(path.join(dataDir, 'diary.json'), 'utf8'));
  return {
    dataDir,
    exportsDir,
    captureDir,
    baseUrl: () => base,
    sourceId,
    entryId,
    roomId,
    ids,
    input,
    entry,
    request,
    db,
    restart: async () => {
      await stop();
      base = await start();
    },
  };
}

test('actual local-admin capture proof, all-or-nothing owner CAS, two readonly versions and durable replay', async (t) => {
  const f = await fixture(t),
    before = await f.db();
  assert.throws(() => registerSourceMessageConflicts(structuredClone(before), f.input, {}), {
    code: 'SOURCE_COLLECTION_INVALID',
  });
  for (const headers of [
    { Authorization: 'Bearer not-local-admin' },
    { 'X-Sync-Device-Id': randomUUID() },
    { Origin: 'https://evil.invalid' },
  ])
    assert.equal(
      (await f.request('/api/source-collection/messages', f.input, headers)).status,
      403,
    );
  assert.equal(
    (
      await f.request('/api/source-collection/messages', {
        ...f.input,
        captureRelativePath: '../capture',
      })
    ).status,
    400,
  );
  const bad = structuredClone(f.input);
  bad.records[1].expectedOwnerSha256 = '0'.repeat(64);
  assert.equal((await f.request('/api/source-collection/messages', bad)).status, 409);
  assert.deepEqual(await f.db(), before);
  const ok = await f.request('/api/source-collection/messages', f.input);
  assert.equal(ok.status, 200);
  assert.equal(ok.value.conflictCount, 2);
  const saved = await f.db();
  assert.deepEqual(saved.entries, before.entries);
  assert.equal(saved.sourceMessageConflicts.records.length, 2);
  const row = saved.sourceMessageConflicts.records[0];
  assert.equal(row.versions.owner.unknownNested.history, 'owner preserved 0');
  assert.equal(row.versions.source.text, 'source candidate 0');
  assert.equal(JSON.stringify(row.versions.source).includes('privateRuntime'), false);
  const info = (await f.request('/api/shared/v1/info', null, {}, 'GET')).value;
  const snapshot = (
    await f.request('/api/shared/v1/snapshot', {
      libraryId: info.libraryId,
      epoch: info.epoch,
      limit: 100,
    })
  ).value;
  assert.equal(
    snapshot.entities.filter(
      (row) => row.entityType === 'source-message-conflict' && row.data.readOnlyProjection,
    ).length,
    2,
  );
  const seed = await exportSharedSeed({
    file: path.join(f.exportsDir, 'pending-conflicts.syseed'),
    directory: path.join(f.exportsDir, 'seed-work'),
    request: computerOwnerTransport({ baseUrl: f.baseUrl() }),
  });
  assert.equal(
    seed.manifest.entities.filter((row) => row.entityType === 'source-message-conflict').length,
    2,
  );
  const opened = await readSharedSeed({
    file: seed.file,
    directory: path.join(f.exportsDir, 'seed-read'),
  });
  t.after(() => opened.dispose());
  const imported = opened.prepared.entities.filter(
    (row) => row.entityType === 'source-message-conflict',
  );
  assert.equal(imported.length, 2);
  assert.equal(
    imported.find((row) => row.data.messageId === f.ids[0]).data.versions.source.text,
    'source candidate 0',
  );
  await f.restart();
  assert.equal((await f.request('/api/source-collection/messages', f.input)).value.replayed, true);
  const changed = structuredClone(f.input);
  changed.records[0].expectedOwnerSha256 = 'f'.repeat(64);
  assert.equal((await f.request('/api/source-collection/messages', changed)).status, 409);
  assert.equal((await f.db()).sourceMessageConflicts.receipts.length, 1);
});

test('collector CLI preserves its private operation across unknown ACK and submits only fixed proof scope', async (t) => {
  const f = await fixture(t),
    requestFile = path.join(f.exportsDir, 'source-conflict-request.json');
  const request = computerOwnerTransport({ baseUrl: f.baseUrl() });
  let lose = true;
  const options = {
    dataDir: f.dataDir,
    captureDir: f.captureDir,
    exportsDir: f.exportsDir,
    requestFile,
    request: async (action, input) => {
      const result = await request(action, input);
      if (action === 'source-conflicts-register' && lose) {
        lose = false;
        throw Error('synthetic unknown ACK');
      }
      return result;
    },
  };
  await assert.rejects(() => registerComputerSourceConflicts(options), /synthetic unknown ACK/);
  const before = await readFile(requestFile, 'utf8');
  const result = await registerComputerSourceConflicts(options);
  assert.equal(result.replayed, true);
  assert.equal(result.conflictCount, 2);
  assert.equal(await readFile(requestFile, 'utf8'), before);
  const saved = await f.db();
  assert.equal(saved.entries.length, 1);
  assert.equal(saved.sourceMessageConflicts.receipts.length, 1);
});

test('withdraw and hidden/draft/deleted/missing parent purge both nested versions in original JSON transaction; replay is terminal', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/source-collection/messages', f.input)).status, 200);
  const pending = await f.db();
  for (const condition of ['hidden', 'draft', 'deleted', 'missing', 'message-missing']) {
    const db = structuredClone(pending);
    if (condition === 'missing') db.entries = [];
    else if (condition === 'message-missing') db.entries[0].chatJournal.messages = [];
    else db.entries[0][condition] = true;
    purgeSourceMessageConflicts(db);
    assert.ok(
      db.sourceMessageConflicts.records.every((row) => row.state === 'redacted' && !row.versions),
    );
    db.entries = structuredClone(pending.entries);
    purgeSourceMessageConflicts(db);
    assert.ok(db.sourceMessageConflicts.records.every((row) => !row.versions));
  }
  const withdrawn = await f.request('/api/chat-journal/withdraw', {
    sourceId: f.sourceId,
    roomId: f.roomId,
    messageId: f.ids[0],
    operationId: randomUUID(),
  });
  assert.equal(withdrawn.status, 200);
  const after = await f.db();
  assert.equal(after.sourceMessageConflicts.records[0].state, 'redacted');
  assert.equal(after.sourceMessageConflicts.records[0].versions, undefined);
  assert.equal(after.sourceMessageConflicts.records[1].state, 'pending');
  assert.equal(
    (await f.request('/api/source-collection/messages', f.input)).value.redactedCount,
    1,
  );
  const current = (await f.db()).entries[0];
  const hidden = await f.request(
    `/api/entries/${f.entryId}`,
    { ...current, hidden: true },
    {},
    'PUT',
  );
  assert.equal(hidden.status, 200, JSON.stringify(hidden.value));
  assert.ok(
    (await f.db()).sourceMessageConflicts.records.every(
      (row) => row.state === 'redacted' && !row.versions,
    ),
  );
  await f.restart();
  assert.equal(
    (await f.request('/api/source-collection/messages', f.input)).value.redactedCount,
    2,
  );
});

test('existing local lock protects source issuer; bearer does not substitute for an unlocked administrator', async (t) => {
  const f = await fixture(t),
    locked = await f.request('/api/access', { password: 'synthetic password' }, {}, 'PUT');
  assert.equal(locked.status, 200);
  assert.equal((await f.request('/api/source-collection/messages', f.input)).status, 401);
  assert.equal(
    (
      await f.request('/api/source-collection/messages', f.input, {
        Cookie: locked.cookie,
        Authorization: 'Bearer paired',
      })
    ).status,
    403,
  );
  assert.equal(
    (await f.request('/api/source-collection/messages', f.input, { Cookie: locked.cookie })).status,
    200,
  );
});
