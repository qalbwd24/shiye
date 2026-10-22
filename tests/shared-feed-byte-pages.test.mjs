import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createDiaryServer } from '../src/server/app.mjs';
import { prepareSharedCommit } from '../src/server/shared-sync/replication.mjs';
import {
  readSharedConversationFeed,
  readSharedFeedItem,
} from '../src/server/shared-sync/conversation-feed.mjs';
import { readConversationFeed } from '../src/server/conversation-services/conversations.mjs';
import { saveConversationSettings } from '../src/server/conversation-services/settings.mjs';
import { chatUnitId } from '../src/server/domain/message-store.mjs';
import { createSharedBusinessClient } from '../public/shared/shared-business-client.js';
import { createMemorySyncStorage } from './helpers/sync-v2-client-memory.mjs';

function fixture(count = 20, text = 'x'.repeat(500000)) {
  const sourceId = randomUUID(),
    roomId = '-103',
    conversationId = `desktop:${sourceId}:${roomId}`;
  const messages = Array.from({ length: count }, (_, i) => ({
    id: String(i + 1),
    sentAt: '2026-10-19T00:00:00Z',
    text,
    attachments: [],
  }));
  const db = {
    schema: 1,
    categories: ['日常'],
    media: [],
    chatJournal: {
      rooms: [{ sourceId, id: roomId, title: '合成房间', category: '日常', idleHours: 5 }],
      withdrawals: [],
    },
    entries: [
      {
        id: randomUUID(),
        revision: 1,
        title: '合成',
        content: '<p>合成</p>',
        date: '2026-10-19T00:00:00Z',
        category: '日常',
        tags: [],
        attachments: [],
        chatJournal: { sourceId, roomId, messages },
      },
    ],
  };
  return { db, sourceId, roomId, conversationId, messages };
}

test('shared byte pages preserve every exact lane position/ID, while legacy feed remains unchanged and cursors reject new watermark', () => {
  const { db, conversationId } = fixture();
  prepareSharedCommit({}, db, { enabled: true });
  assert.equal(readConversationFeed(db, { conversationId, limit: 100 }).messages.length, 20);
  const ids = [];
  let after;
  do {
    const page = readSharedConversationFeed(db, { conversationId, after, limit: 100 });
    assert.ok(Buffer.byteLength(JSON.stringify(page)) < 1024 * 1024);
    ids.push(...page.messages.map((row) => row.id));
    assert.deepEqual(page.nextCursor, page.next);
    assert.ok(!page.hasMore || JSON.stringify(page.next) !== JSON.stringify(after));
    after = page.hasMore ? page.next : null;
  } while (after);
  assert.equal(ids.length, 20);
  assert.equal(new Set(ids).size, 20);
  const first = readSharedConversationFeed(db, { conversationId, limit: 100 });
  const next = structuredClone(db);
  next.entries[0].chatJournal.messages[0].withdrawn = true;
  prepareSharedCommit(db, next);
  assert.throws(() => readSharedConversationFeed(next, { conversationId, after: first.next }), {
    code: 'SHARED_FEED_CHANGED',
  });
  assert.throws(
    () =>
      readSharedConversationFeed(db, {
        conversationId: `desktop:${randomUUID()}:-103`,
        after: first.next,
      }),
    (e) => e.status === 400,
  );
});

test('redactions have bounded independent progress and 100k-Chinese comment/body uses verified fixed item descriptor', () => {
  const f = fixture(1500, 'x');
  for (const message of f.messages) message.withdrawn = true;
  const settings = saveConversationSettings(f.db, {
    conversationId: f.conversationId,
    slotId: 'assistant',
    providerId: 'external-program',
    expectedBindingRevision: 0,
    expectedConfigRevision: 0,
    config: {
      enabled: true,
      title: '合成程序',
      kind: 'ai',
      sender: { name: '合成AI' },
      parameters: {},
    },
  });
  const service = f.db.conversationServices.instances.find((row) => row.id === settings.instanceId);
  service.state.comments = [
    {
      operationId: randomUUID(),
      createdAt: '2026-10-19T00:00:00Z',
      state: 'active',
      text: '中'.repeat(100000),
      body: { text: '文'.repeat(100000) },
      commentOn: [],
    },
  ];
  prepareSharedCommit({}, f.db, { enabled: true });
  const redactions = [],
    messages = [];
  let after, descriptor;
  do {
    const page = readSharedConversationFeed(f.db, {
      conversationId: f.conversationId,
      after,
      limit: 100,
    });
    assert.ok(Buffer.byteLength(JSON.stringify(page)) < 1024 * 1024);
    assert.ok(page.redactions.length <= 1000);
    redactions.push(...page.redactions.map((row) => row.id));
    messages.push(...page.messages);
    descriptor ||= page.messages.find((row) => row.payload);
    after = page.hasMore ? page.next : null;
  } while (after);
  assert.equal(new Set(redactions).size, 1500);
  assert.equal(redactions.length, 1500);
  assert.equal(new Set(messages.map((row) => row.id)).size, 1501);
  assert.equal(descriptor.payload.kind, 'shared-feed-item-json');
  const bytes = [];
  let offset = 0;
  do {
    const part = readSharedFeedItem(f.db, { payload: descriptor.payload, offset, length: 262144 });
    bytes.push(Buffer.from(part.bytesBase64, 'base64'));
    offset = part.next;
    if (part.done) break;
  } while (offset < descriptor.payload.byteLength);
  const row = JSON.parse(Buffer.concat(bytes));
  assert.equal(row.markdown, '中'.repeat(100000));
  assert.equal(row.body.text, '文'.repeat(100000));
  const pageBefore = readSharedConversationFeed(f.db, {
    conversationId: f.conversationId,
    limit: 100,
  });
  const changed = structuredClone(f.db);
  changed.conversationServices.instances.find(
    (item) => item.id === settings.instanceId,
  ).state.comments[0].state = 'withdrawn';
  prepareSharedCommit(f.db, changed);
  assert.equal(
    changed._sharedSync.seq,
    f.db._sharedSync.seq,
    'program runtime can change without shared entity seq',
  );
  assert.throws(
    () =>
      readSharedConversationFeed(changed, {
        conversationId: f.conversationId,
        after: pageBefore.next,
      }),
    { code: 'SHARED_FEED_CHANGED' },
  );
  assert.throws(
    () => readSharedFeedItem(changed, { payload: descriptor.payload, offset: 0, length: 100 }),
    { code: 'SHARED_FEED_CHANGED' },
  );
});

test('real HTTP feed and descriptor native responses stay below cap; common query hydrates canonical/markdown without partial publication', async (t) => {
  const f = fixture(2, '中'.repeat(500000));
  const canonicalBody = { text: 'canonical'.repeat(100000) };
  f.db.messageStore = {
    units: [{ id: chatUnitId(f.sourceId, f.roomId, '1'), revision: 1, body: canonicalBody }],
    layouts: {},
  };
  const root = path.resolve('tmp/backend-shared-auth/feed-byte-pages');
  await mkdir(root, { recursive: true });
  const dataDir = await mkdtemp(path.join(root, 'case-'));
  await writeFile(path.join(dataDir, 'diary.json'), JSON.stringify(f.db));
  const server = await createDiaryServer({ dataDir, seed: false, sharedSync: true });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.close();
    await once(server, 'close');
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  let change = false,
    responses = 0;
  const request = async (action, input) => {
    if (action === 'feed-item-read' && change && input.offset > 0) {
      change = false;
      const r = await fetch(base + '/api/categories', {
        method: 'POST',
        headers: { 'X-Diary-Client': 'desktop', 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '并发修改' }),
      });
      assert.equal(r.status, 200);
    }
    const response = await fetch(
      base + '/api/shared/v1/' + (action === 'feed-item-read' ? 'feed-item/read' : action),
      {
        method: action === 'info' ? 'GET' : 'POST',
        headers: { 'X-Diary-Client': 'desktop', 'Content-Type': 'application/json' },
        ...(action === 'info' ? {} : { body: JSON.stringify(input) }),
      },
    );
    const text = await response.text();
    responses++;
    assert.ok(Buffer.byteLength(text) < 1024 * 1024);
    const value = JSON.parse(text);
    if (!response.ok)
      throw Object.assign(Error(value.error.code), {
        code: value.error.code,
        status: response.status,
      });
    return value;
  };
  const info = await request('info');
  const client = createSharedBusinessClient({
    storage: createMemorySyncStorage(),
    request,
    libraryId: info.libraryId,
    epoch: info.epoch,
  });
  const result = await client.query({
    operationId: randomUUID(),
    action: 'conversation-feed',
    input: { conversationId: f.conversationId, limit: 100 },
  });
  assert.equal(result.result.messages.length, 2);
  assert.equal(result.result.messages[0].markdown, '中'.repeat(500000));
  assert.deepEqual(result.result.messages[0].body, canonicalBody);
  assert.equal(result.result.messages[0].payload, undefined);
  change = true;
  await assert.rejects(
    () =>
      client.query({
        operationId: randomUUID(),
        action: 'conversation-feed',
        input: { conversationId: f.conversationId, limit: 100 },
      }),
    { code: 'SHARED_FEED_CHANGED', status: 409 },
  );
  assert.ok(responses > 16);
});
