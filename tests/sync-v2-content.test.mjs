import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { IDBFactory } from 'fake-indexeddb';
import { openSyncStore } from '../src/server/sync-v2/store.mjs';
import { createIndexedDbSyncStorage, createSyncClient } from '../public/shared/sync-v2-client.js';
import { prepareDiaryUnits, reassembleDiaryUnits } from '../public/shared/message-units.js';
import { projectDiaryParagraphMessages } from '../public/shared/diary-paragraph-messages.js';
import { chatUnitId } from '../src/server/domain/message-store.mjs';

const fixture = JSON.parse(
  await readFile(new URL('./fixtures/cross-device-content-v1.json', import.meta.url), 'utf8'),
);
async function setup(t) {
  const root = path.resolve(import.meta.dirname, '../tmp/sync-backend');
  await mkdir(root, { recursive: true });
  const store = await openSyncStore({ dataDir: await mkdtemp(path.join(root, 'content-')) });
  t.after(() => store.close());
  function device(deviceId) {
    const storage = createIndexedDbSyncStorage({
      dbName: `shiye-sync-v2-content-${deviceId}`,
      indexedDB: new IDBFactory(),
    });
    const client = createSyncClient({
      baseUrl: 'http://synthetic.invalid/',
      deviceId,
      token: 'synthetic',
      storage,
      fetchImpl: async (url, init = {}) => {
        const method = new URL(url).pathname.split('/').at(-1),
          input = init.body ? JSON.parse(init.body) : {};
        const result =
          method === 'info'
            ? await store.info()
            : method === 'push'
              ? await store.push(deviceId, input.operations)
              : await store[method](input);
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });
    t.after(async () => {
      client.stop();
      await storage.close();
    });
    return client;
  }
  return { store, desktop: device('desktop'), phone: device('phone') };
}
function prepare(entry) {
  let id = 0;
  return prepareDiaryUnits(entry, {
    media: fixture.media,
    timeZone: fixture.timeZone,
    createId: () => `fixture-${++id}`,
  });
}

test('sync retains complete current Entry, business revision, manual clocks, media appearances, canonical layout and unknown fields', async (t) => {
  const { desktop, phone } = await setup(t);
  const entry = structuredClone(fixture.entry);
  const before = prepare(entry);
  const data = {
    ...entry,
    units: before.units,
    layout: before.layout,
    futureField: { nested: ['keep', 42] },
  };
  await desktop.enqueue({
    entityType: 'journalAggregate',
    entityId: entry.id,
    command: 'create',
    data,
  });
  await desktop.sync();
  await phone.sync();
  const received = await phone.read('journalAggregate', entry.id);
  assert.equal(received.revision, 1);
  assert.equal(received.data.revision, 7);
  assert.deepEqual(received.data, data);
  assert.deepEqual(reassembleDiaryUnits(received.data.units, received.data.layout), entry.body);
  assert.deepEqual(
    projectDiaryParagraphMessages(prepare(received.data).units),
    projectDiaryParagraphMessages(before.units),
  );
  await desktop.enqueue({
    entityType: 'journalAggregate',
    entityId: entry.id,
    command: 'updateFields',
    changes: { category: '另一合成分类' },
  });
  await phone.enqueue({
    entityType: 'journalAggregate',
    entityId: entry.id,
    command: 'updateFields',
    changes: { tags: ['手机合成标签'] },
  });
  await desktop.sync();
  await phone.sync();
  await desktop.sync();
  const merged = (await desktop.read('journalAggregate', entry.id)).data;
  assert.equal(merged.category, '另一合成分类');
  assert.deepEqual(merged.tags, ['手机合成标签']);
  assert.deepEqual(merged.body, entry.body);
  assert.deepEqual(merged.units, before.units);
  assert.deepEqual(merged.layout, before.layout);
  assert.deepEqual(merged.futureField, data.futureField);
});

test('sync leaves legacy HTML/Markdown and attachment strings unchanged, and keeps chat identifiers beyond Number precision', async (t) => {
  const { desktop, phone } = await setup(t);
  const legacy = {
    id: 'synthetic-legacy',
    contentFormat: 'html',
    content: '<p>[2025/10/18 08:30:00]</p>\r\n<p>　旧段落<br>\t继续</p>',
    markdownSource: '==标记==\r\n\r\n---\r\n',
    attachments: ['fixture-image'],
    opaqueLegacy: { imported: true },
  };
  const { sourceId, roomId, messageId, sentAt } = fixture.chat;
  const id = chatUnitId(sourceId, roomId, messageId);
  const message = {
    ...fixture.chat,
    eventTime: { instant: sentAt },
    replyTo: { messageId: '9007199254740994', roomId },
    body: fixture.entry.body,
  };
  for (const [entityType, entityId, data] of [
    ['journalAggregate', legacy.id, legacy],
    ['chatMessage', id, message],
  ])
    await desktop.enqueue({ entityType, entityId, command: 'create', data });
  await desktop.sync();
  await phone.sync();
  assert.deepEqual((await phone.read('journalAggregate', legacy.id)).data, legacy);
  assert.deepEqual((await phone.read('chatMessage', id)).data, message);
  assert.equal((await phone.read('chatMessage', id)).data.messageId, '9007199254740993');
});
