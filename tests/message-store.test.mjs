import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createDiaryServer } from '../src/server/app.mjs';
import {
  commitDiaryUnits,
  readMessageUnits,
  readDiaryCandidate,
  chatUnitId,
} from '../src/server/domain/message-store.mjs';
import {
  appendChatMessages,
  saveChatRoom,
  withdrawChatMessage,
} from '../src/server/domain/chat-journal.mjs';
import { reassembleDiaryUnits } from '../public/shared/message-units.js';
import { fromEditorJSON } from '../public/shared/rich-document.js';
import { renderRichDocument } from '../public/shared/rich-document-renderer.js';

const body = (text = '合成正文') => ({
  format: 'shiye-richdoc',
  version: 1,
  content: [{ type: 'paragraph', attrs: { blockId: 'p1' }, content: [{ type: 'text', text }] }],
});
const entry = () => ({
  id: randomUUID(),
  contentFormat: 'richdoc',
  body: body(),
  content: '<p>合成正文</p>',
  revision: 1,
  date: '2026-10-10T00:00:00.000Z',
  contentEditedAt: '2026-10-10T01:00:00.000Z',
  title: '合成',
  category: '日常',
  tags: [],
  attachments: [],
});
const database = () => ({ entries: [], media: [], categories: ['日常'] });
const enabled = { messageUnitsEnabled: true };

test('rich editor key order does not reject marked text and inline media, while changed projections stay protected', () => {
  const db = database(),
    first = entry();
  db.media.push({ id: 'test-image', type: 'image/png' });
  first.attachments = ['test-image'];
  let block = 0;
  first.body = fromEditorJSON(
    {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '[2026/10/10 08:00:00]' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '加粗', marks: [{ type: 'bold' }] },
            { type: 'text', text: '斜体', marks: [{ type: 'italic' }] },
          ],
        },
        {
          type: 'image',
          attrs: {
            assetId: 'test-image',
            occurrenceId: 'image-one',
            insertedAt: '2026-10-10T00:00:10.000Z',
            caption: '图注',
            alt: '',
            align: 'center',
            widthRatio: 0.6,
          },
        },
      ],
    },
    () => `editor-${++block}`,
  );
  const editorBody = structuredClone(first.body);
  db.entries.push(first);
  commitDiaryUnits(db, first, null, enabled);
  const restored = reassembleDiaryUnits(
    db.messageStore.units,
    db.messageStore.layouts[first.id].layout,
  );
  assert.deepEqual(restored, first.body);
  assert.deepEqual(restored, editorBody);
  assert.notEqual(JSON.stringify(restored), JSON.stringify(editorBody));
  first.content = renderRichDocument(first.body);
  const previous = { ...structuredClone(first), body: editorBody },
    originalBody = structuredClone(first.body);
  first.title = '修改标题';
  commitDiaryUnits(db, first, previous, enabled);
  assert.deepEqual(first.body, originalBody);
  const tampered = structuredClone(first);
  tampered.body.content[1].content[0].text = '不一致正文';
  assert.throws(() => commitDiaryUnits(db, first, tampered, enabled), /不一致/);
});

test('canonical diary units roundtrip and keep identity across edits and metadata renames', () => {
  const db = database(),
    first = entry();
  db.entries.push(first);
  commitDiaryUnits(db, first, null, enabled);
  assert.deepEqual(
    reassembleDiaryUnits(db.messageStore.units, db.messageStore.layouts[first.id].layout),
    first.body,
  );
  const unitId = db.messageStore.units[0].id;
  const before = structuredClone(first);
  first.body = body('修改后的合成正文');
  first.revision++;
  commitDiaryUnits(db, first, before, enabled);
  assert.equal(db.messageStore.units[0].id, unitId);
  assert.equal(db.messageStore.units[0].revision, 2);
  const stored = JSON.stringify(db.messageStore);
  const old = structuredClone(first);
  first.title = '改名';
  first.category = '新分类';
  commitDiaryUnits(db, first, old, enabled);
  assert.equal(JSON.stringify(db.messageStore), stored);
  assert.equal(readMessageUnits(db, { entryId: first.id })[0].attributes.title, '改名');
  assert.equal(readMessageUnits(db, { entryId: first.id })[0].attributes.category, '新分类');
});

test('disabled writes and read-only legacy candidates never populate canonical storage', () => {
  const db = database(),
    first = entry();
  commitDiaryUnits(db, first);
  assert.equal(db.messageStore, undefined);
  const before = JSON.stringify(first);
  assert.equal(readDiaryCandidate(db, first).readOnly, true);
  assert.equal(db.messageStore, undefined);
  assert.equal(JSON.stringify(first), before);
  const legacy = { ...first, contentFormat: 'html', body: undefined };
  commitDiaryUnits(db, legacy, null, enabled);
  assert.equal(db.messageStore, undefined);
  assert.ok(readDiaryCandidate(db, legacy).units.length);
});

test('splitting a diary preserves retired identities as tombstones and rejects corrupted projection caches', () => {
  const db = database(),
    first = entry();
  first.body.content.push({
    type: 'paragraph',
    attrs: { blockId: 'p2' },
    content: [{ type: 'text', text: '第二段' }],
  });
  db.entries.push(first);
  commitDiaryUnits(db, first, null, enabled);
  const originalId = db.messageStore.units[0].id;
  const previous = structuredClone(first);
  first.body.content.splice(1, 0, {
    type: 'paragraph',
    attrs: { blockId: 'time' },
    content: [{ type: 'text', text: '2026-10-10 10:30' }],
  });
  first.revision++;
  commitDiaryUnits(db, first, previous, enabled);
  const tombstone = db.messageStore.units.find((unit) => unit.id === originalId);
  assert.equal(tombstone.state, 'deleted');
  assert.equal(tombstone.body, null);
  assert.ok(db.messageStore.layouts[first.id].mappings.some((mapping) => mapping.kind === 'split'));
  const corrupt = { ...structuredClone(first), content: '<p>非法缓存</p>' };
  assert.throws(
    () => commitDiaryUnits(db, { ...corrupt, title: '改名' }, corrupt, enabled),
    /兼容投影/,
  );
});

test('chat canonical richdoc parses markdown, namespaces replies and leaves only withdrawal tombstones', () => {
  const db = database(),
    sourceId = randomUUID();
  for (const id of ['-1', '-2'])
    saveChatRoom(db, { sourceId, id, title: '合成会话', category: '日常', idleHours: 5 });
  const input = (roomId, id, text, replyTo) => ({
    sourceId,
    roomId,
    messages: [
      {
        id,
        text,
        sentAt: '2026-10-10T00:00:00.000Z',
        attachments: [],
        ...(replyTo ? { replyTo } : {}),
      },
    ],
  });
  appendChatMessages(db, input('-1', '1', '**粗体** 与 `code`'), undefined, enabled);
  appendChatMessages(db, input('-2', '1', '另一会话'), undefined, enabled);
  appendChatMessages(db, input('-1', '2', '回复', '1'), undefined, enabled);
  assert.equal(new Set(db.messageStore.units.map((unit) => unit.id)).size, 3);
  const first = db.messageStore.units.find((unit) => unit.id === chatUnitId(sourceId, '-1', '1'));
  assert.ok(JSON.stringify(first.body).includes('"type":"bold"'));
  assert.ok(JSON.stringify(first.body).includes('"type":"code"'));
  assert.equal(
    db.messageStore.units.find((unit) => unit.origin.messageId === '2').replyTo,
    first.id,
  );
  const chatEntry = db.entries.find((item) => item.chatJournal.roomId === '-1');
  chatEntry.history = [structuredClone(chatEntry)];
  assert.throws(
    () => withdrawChatMessage(db, { sourceId, roomId: '-1', messageId: '1', expectedRevision: 99 }),
    /另一窗口/,
  );
  withdrawChatMessage(db, { sourceId, roomId: '-1', messageId: '1', expectedRevision: 1 });
  assert.equal(first.state, 'withdrawn');
  assert.equal(first.body, null);
  assert.ok(!JSON.stringify(db).includes('粗体'));
  assert.ok(
    db.entries.find((item) => item.chatJournal.roomId === '-1').content.includes('消息已撤回'),
  );
});

test('isolated HTTP saves persist atomically, reject stale revision, and reopen canonical storage', async () => {
  const dataDir = path.resolve('tmp/message-unification/backend', randomUUID());
  await fs.mkdir(dataDir, { recursive: true });
  let server;
  const start = async () => {
    server = await createDiaryServer({ dataDir, seed: false, messageUnits: true });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${server.address().port}`;
  };
  const close = () =>
    new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  try {
    let base = await start();
    const first = entry();
    let response = await fetch(base + '/api/entries', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Diary-Client': 'desktop' },
      body: JSON.stringify(first),
    });
    assert.equal(response.status, 201);
    const saved = await response.json();
    response = await fetch(base + `/api/message-units?entryId=${saved.id}`);
    const units = await response.json();
    assert.equal(units.persisted, true);
    assert.ok(units.units.length);
    response = await fetch(base + `/api/entries/${saved.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'X-Diary-Client': 'desktop' },
      body: JSON.stringify({ ...saved, revision: 0, body: body('过期') }),
    });
    assert.equal(response.status, 409);
    response = await fetch(base + '/api/chat-journal/messages', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'X-Diary-Client': 'desktop' },
      body: '{}',
    });
    assert.equal(response.status, 405);
    response = await fetch(base + '/api/message-units?limit=0');
    assert.equal(response.status, 400);
    await close();
    base = await start();
    const reopened = await (await fetch(base + `/api/message-units?entryId=${saved.id}`)).json();
    assert.deepEqual(reopened.units, units.units);
  } finally {
    if (server?.listening) await close();
  }
});
