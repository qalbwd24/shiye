import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createDiaryServer } from '../src/server/app.mjs';
import { reassembleDiaryUnits } from '../public/shared/message-units.js';
import {
  appendChatMessages,
  saveChatRoom,
  withdrawChatMessage,
  chatMessageReceipt,
} from '../src/server/domain/chat-journal.mjs';

async function fixture(t) {
  const dir = path.resolve('tmp/message-unification/integration', randomUUID());
  await fs.mkdir(dir, { recursive: true });
  let server;
  let base;
  const close = async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  };
  const start = async () => {
    server = await createDiaryServer({ dataDir: dir, seed: false, messageUnits: true });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = 'http://127.0.0.1:' + server.address().port;
  };
  await start();
  t.after(close);
  const request = (route, method = 'GET', data) =>
    fetch(base + route, {
      method,
      headers: { 'X-Diary-Client': 'desktop', 'Content-Type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  const api = async (...args) => {
    const response = await request(...args);
    const data = await response.json();
    assert.ok(response.ok, data.error);
    return data;
  };
  const upload = async () => {
    const response = await fetch(base + '/api/media', {
      method: 'POST',
      headers: { 'X-Diary-Client': 'desktop', 'Content-Type': 'image/png' },
      body: 'synthetic-picture-bytes',
    });
    assert.equal(response.status, 201);
    return response.json();
  };
  return {
    request,
    api,
    upload,
    restart: async () => {
      await close();
      await start();
    },
  };
}

const paragraph = (id, text) => ({
  type: 'paragraph',
  attrs: { blockId: id },
  content: [{ type: 'text', text }],
});
const sample = () => ({
  title: '统一消息隔离样本',
  category: '日常',
  tags: ['样本'],
  date: '2026-10-10T00:00:00Z',
  attachments: [],
  contentFormat: 'richdoc',
  body: {
    format: 'shiye-richdoc',
    version: 1,
    content: [
      paragraph('p1', '[2026/10/10 08:00:00]'),
      paragraph('p2', '第一段'),
      paragraph('p3', '[2026/10/10 09:00:00]'),
      paragraph('p4', '第二段'),
    ],
  },
});

test('long writing, image comment anchors, taxonomy and restart share canonical units without retiming', async (t) => {
  const f = await fixture(t);
  const image = await f.upload(),
    draft = sample();
  draft.attachments = [image.id];
  const occurrenceId = randomUUID();
  draft.body.content.push({
    type: 'image',
    attrs: {
      blockId: randomUUID(),
      occurrenceId,
      assetId: image.id,
      insertedAt: '2026-10-10T02:00:00.000Z',
      widthRatio: 0.75,
      align: 'center',
      caption: '',
      alt: '',
    },
  });
  let entry = await f.api('/api/entries', 'POST', draft);
  let read = await f.api('/api/message-units?entryId=' + entry.id);
  assert.equal(read.units.length, 3);
  assert.deepEqual(reassembleDiaryUnits(read.units, read.layout), entry.body);
  const ids = read.units.map((unit) => unit.id),
    times = read.units.map((unit) => unit.eventTime.instant);
  const commentRoute = '/api/entries/' + entry.id + '/comments';
  entry = await f.api(commentRoute, 'POST', {
    body: '对第二条的评论',
    entryRevision: entry.revision,
    commentOn: [
      { kind: 'message', entryId: entry.id, unitId: ids[1] },
      { kind: 'media', entryId: entry.id, unitId: ids[2], occurrenceId },
    ],
  });
  assert.equal((await f.api('/api/message-units?entryId=' + entry.id)).units.length, 3);
  read = await f.api('/api/message-units?entryId=' + entry.id + '&includeComments=1');
  const comment = read.units.find((unit) => unit.origin.kind === 'comment');
  assert.deepEqual(comment.commentOn, [
    { kind: 'message', entryId: entry.id, unitId: ids[1] },
    { kind: 'media', entryId: entry.id, unitId: ids[2], occurrenceId },
  ]);
  const before = await f.api('/api/library');
  assert.equal(
    (
      await f.request(commentRoute, 'POST', {
        body: '错误目标',
        entryRevision: entry.revision,
        commentOn: [{ kind: 'message', entryId: entry.id, unitId: 'unknown' }],
      })
    ).status,
    409,
  );
  assert.deepEqual(await f.api('/api/library'), before);
  await f.api('/api/taxonomy', 'POST', {
    kind: 'category',
    action: 'rename',
    from: '日常',
    to: '新日常',
  });
  read = await f.api('/api/message-units?entryId=' + entry.id);
  assert.deepEqual(
    read.units.map((unit) => unit.id),
    ids,
  );
  assert.deepEqual(
    read.units.map((unit) => unit.eventTime.instant),
    times,
  );
  assert.ok(read.units.every((unit) => unit.attributes.category === '新日常'));
  for (const query of [
    'includeComments=true',
    'order=wrong',
    'unknown=1',
    'limit=2&limit=3',
    'from=2026-10-11&to=2026-10-10',
  ])
    assert.equal((await f.request('/api/message-units?' + query)).status, 400);
  await f.restart();
  assert.deepEqual((await f.api('/api/message-units?entryId=' + entry.id)).units, read.units);
});

test('withdrawal before upload and lost acknowledgements cannot resurrect source content', async () => {
  const db = { entries: [], media: [], categories: ['日常'] };
  const sourceId = randomUUID(),
    roomId = '-1',
    sentAt = '2026-10-10T00:00:00Z';
  saveChatRoom(db, { sourceId, id: roomId, title: '本地', category: '日常', idleHours: 5 });
  const pending = { sourceId, roomId, messageId: '1', operationId: randomUUID(), sentAt };
  assert.equal(withdrawChatMessage(db, pending).state, 'withdrawn');
  assert.equal(db.entries.length, 0);
  assert.equal(withdrawChatMessage(db, { ...pending, expectedRevision: 999 }).state, 'withdrawn');
  const payload = {
    sourceId,
    roomId,
    messages: [{ id: '1', text: '不得重新保存的原文', sentAt, attachments: ['missing-media'] }],
  };
  assert.equal(
    appendChatMessages(db, payload, undefined, { messageUnitsEnabled: true }).accepted[0].state,
    'withdrawn',
  );
  assert.equal(db.entries.length, 0);
  assert.ok(!JSON.stringify(db).includes('不得重新保存的原文'));
  payload.messages = [{ id: '2', text: '真正的新消息', sentAt, attachments: [] }];
  appendChatMessages(db, payload, undefined, { messageUnitsEnabled: true });
  const command = {
    sourceId,
    roomId,
    messageId: '2',
    operationId: randomUUID(),
    expectedRevision: 1,
  };
  const receipt = withdrawChatMessage(db, command);
  assert.equal(receipt.state, 'withdrawn');
  assert.deepEqual(withdrawChatMessage(db, command), receipt);
  const reopened = JSON.parse(JSON.stringify(db));
  assert.deepEqual(chatMessageReceipt(reopened, sourceId, roomId, '2'), receipt);
  assert.deepEqual(withdrawChatMessage(reopened, command), receipt);
  assert.ok(!JSON.stringify(reopened).includes('真正的新消息'));
  assert.equal(appendChatMessages(reopened, payload).accepted[0].state, 'withdrawn');
  payload.messages = [
    { id: '4', text: '后', sentAt: '2026-10-10T02:00:00Z', attachments: [] },
    { id: '1', text: '旧', sentAt, attachments: [] },
    { id: '3', text: '前', sentAt: '2026-10-10T01:00:00Z', attachments: [] },
  ];
  const accepted = appendChatMessages(reopened, payload).accepted;
  assert.deepEqual(
    accepted.map((item) => item.id),
    ['1', '3', '4'],
  );
});

test('legacy explicit withdrawal keeps only tombstone and category rename permits continued grouping', async (t) => {
  const f = await fixture(t);
  const sourceId = randomUUID(),
    roomId = '-2';
  await f.api('/api/chat-journal/rooms', 'PUT', {
    sourceId,
    id: roomId,
    title: '会话',
    category: '日常',
    idleHours: 5,
  });
  const send = (id, time) =>
    f.api('/api/chat-journal/messages', 'POST', {
      sourceId,
      roomId,
      messages: [{ id, sentAt: time, text: '**保留格式**', attachments: [] }],
    });
  const first = await send('1', '2026-10-10T00:00:00Z');
  await f.api('/api/taxonomy', 'POST', {
    kind: 'category',
    action: 'rename',
    from: '日常',
    to: '改名',
  });
  assert.equal(
    (await send('2', '2026-10-10T00:10:00Z')).accepted[0].entryId,
    first.accepted[0].entryId,
  );
  const operation = {
    sourceId,
    roomId,
    messageId: '1',
    operationId: randomUUID(),
    expectedRevision: 1,
  };
  const receipt = await f.api('/api/chat-journal/withdraw', 'POST', operation);
  await f.restart();
  assert.deepEqual(await f.api('/api/chat-journal/withdraw', 'POST', operation), receipt);
  const receipts = await f.api('/api/chat-journal/receipts', 'POST', {
    sourceId,
    roomId,
    ids: ['1', '2'],
  });
  assert.equal(receipts.accepted.find((item) => item.id === '1').state, 'withdrawn');
  assert.equal(receipts.accepted.find((item) => item.id === '2').revision, 1);
  assert.equal((await f.request('/api/chat-journal/receipts', 'POST', null)).status, 400);
});

test('explicit legacy withdrawal clears deep nested history without introducing a second original', () => {
  const db = { entries: [], media: [], categories: ['日常'] },
    sourceId = randomUUID(),
    roomId = '-3';
  saveChatRoom(db, { sourceId, id: roomId, title: '旧消息', category: '日常', idleHours: 5 });
  appendChatMessages(db, {
    sourceId,
    roomId,
    messages: [{ id: '1', text: '深层原文', sentAt: '2026-10-10T00:00:00Z', attachments: [] }],
  });
  const entry = db.entries[0],
    deep = structuredClone(entry);
  entry.history = [{ revision: 0, history: [deep] }];
  const result = withdrawChatMessage(db, { sourceId, roomId, messageId: '1' });
  assert.equal(result.state, 'withdrawn');
  assert.equal(db.messageStore.units[0].body, null);
  assert.ok(!JSON.stringify(db).includes('深层原文'));
  assert.match(entry.content, /消息已撤回/);
});

test('message queries honor hidden draft deleted and comment boundaries including read-only legacy candidates', async (t) => {
  const f = await fixture(t);
  const entries = [];
  for (const flag of ['hidden', 'draft', 'deleted'])
    entries.push(await f.api('/api/entries', 'POST', { ...sample(), [flag]: true }));
  const ordinary = await f.api('/api/entries', 'POST', sample());
  const legacy = await f.api('/api/entries', 'POST', {
    title: '旧格式仅候选',
    category: '日常',
    content: '<p>[2026/10/10 10:00:00]</p><p>旧原文</p>',
    date: '2026-10-10T00:00:00Z',
    attachments: [],
    tags: [],
  });
  const libraryBefore = await f.api('/api/library');
  const candidates = await f.api('/api/message-units?entryId=' + legacy.id);
  assert.equal(candidates.persisted, false);
  assert.equal(candidates.candidate.readOnly, true);
  assert.equal(candidates.units.length, 0);
  assert.deepEqual(await f.api('/api/library'), libraryBefore);
  assert.ok(
    (await f.api('/api/message-units')).units.every((unit) => unit.origin.entryId === ordinary.id),
  );
  for (const [index, flag] of ['Hidden', 'Draft', 'Deleted'].entries()) {
    const entryId = entries[index].id;
    const visible = await f.api('/api/message-units?entryId=' + entryId + '&include' + flag + '=1');
    const hidden = await f.api('/api/message-units?entryId=' + entryId);
    assert.equal(hidden.units.length, 0);
    assert.equal(hidden.layout, undefined);
    assert.equal(hidden.candidate, undefined);
    assert.equal(visible.units.length, 2);
    assert.equal(
      (await f.request('/api/message-units/' + encodeURIComponent(visible.units[0].id))).status,
      404,
    );
  }
});
