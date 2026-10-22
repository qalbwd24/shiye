import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDiaryServer } from '../server.mjs';
import {
  appendChatMessages,
  closeIdleChatEntries,
  saveChatRoom,
} from '../src/server/domain/chat-journal.mjs';
import { reconcileImport } from '../src/server/domain/import-reconciliation.mjs';

const sourceId = randomUUID();
const start = Date.parse('2026-10-10T00:00:00Z');
const hour = 3600000;
const makeDb = () => ({ entries: [], media: [], categories: ['日常', '灵感'] });
const room = (id = '-10', category = '日常', idleHours = 5) => ({
  sourceId,
  id,
  title: '隔离测试',
  category,
  idleHours,
});
const msg = (id, at = 0, text = `合成消息 ${id}`, attachments = []) => ({
  id: String(id),
  text,
  sentAt: new Date(start + at * hour).toISOString(),
  attachments,
});
const append = (db, messages, roomId = '-10', now = start + 48 * hour) =>
  appendChatMessages(db, { sourceId, roomId, messages }, now);

test('chat inactivity follows last sent message, including exact five hours and continuous multi-day writing', () => {
  const db = makeDb();
  saveChatRoom(db, room());
  append(db, [msg(1), msg(2, 4.999)]);
  assert.equal(db.entries.length, 1);
  append(db, [msg(3, 9.999)]);
  assert.equal(db.entries.length, 2);
  assert.equal(db.entries[1].chatJournal.messages.length, 2);
  append(
    db,
    Array.from({ length: 12 }, (_, i) => msg(i + 4, 13.999 + i * 4)),
  );
  assert.equal(db.entries.length, 2);
  assert.equal(db.entries[0].chatJournal.messages.length, 13);
  assert.match(db.entries[1].content, /2026-10-10 08:00:00/);
});

test('idle deadline closes without another message and late offline delivery keeps the correct segment', () => {
  const db = makeDb();
  saveChatRoom(db, room());
  append(db, [msg(1)], '-10', start);
  assert.equal(closeIdleChatEntries(db, start + 5 * hour - 1), 0);
  assert.equal(closeIdleChatEntries(db, start + 5 * hour), 1);
  append(db, [msg(2, 4)], '-10', start + 12 * hour);
  assert.equal(db.entries.length, 1);
  assert.equal(db.entries[0].chatJournal.status, 'closed');
  append(db, [msg(3, 9)]);
  assert.equal(db.entries.length, 2);
});

test('category changes, room boundaries and new interval apply without rewriting previous entries', () => {
  const db = makeDb();
  saveChatRoom(db, room());
  append(db, [msg(1)]);
  saveChatRoom(db, room('-10', '灵感', 2));
  append(db, [msg(2, 1)]);
  assert.deepEqual(
    db.entries.map((e) => e.category),
    ['灵感', '日常'],
  );
  append(db, [msg(3, 3)]);
  assert.equal(db.entries.length, 3);
  saveChatRoom(db, room('-20'));
  append(db, [msg(1, 1)], '-20');
  assert.equal(db.entries.length, 4);
  assert.equal(db.entries[0].chatJournal.roomId, '-20');
});

test('retries are idempotent, conflicting message and out-of-order import do not overwrite', () => {
  const db = makeDb();
  saveChatRoom(db, room());
  append(db, [msg(1)]);
  const before = structuredClone(db);
  const retry = append(db, [msg(1)]);
  assert.equal(retry.accepted[0].entryId, db.entries[0].id);
  assert.deepEqual(db, before);
  assert.throws(() => append(db, [msg(1, 0, '不同内容')]), /内容不同/);
  assert.throws(() => append(db, [msg(2, -1)]), /时间早于/);
  assert.deepEqual(db, before);
});

test('hand edits and soft deletion detach automatic projections without resurrection or overwriting', () => {
  for (const change of [
    (e) => {
      e.content += '<p>人工补充</p>';
    },
    (e) => {
      e.deleted = true;
    },
  ]) {
    const db = makeDb();
    saveChatRoom(db, room());
    append(db, [msg(1)]);
    change(db.entries[0]);
    const before = structuredClone(db.entries[0]);
    append(db, [msg(2, 1)]);
    assert.equal(db.entries.length, 2);
    assert.equal(db.entries[1].content, before.content);
    assert.equal(db.entries[1].deleted, before.deleted);
    assert.equal(db.entries[0].chatJournal.messages.length, 1);
  }
});

test('markdown projection preserves formatting, code, tables, tasks, highlight and blocks unsafe HTML/URLs', () => {
  const db = makeDb();
  saveChatRoom(db, room());
  append(db, [
    msg(
      1,
      0,
      '# 标题\n\n*斜体* **粗体** ==高亮==\n\n- [x] 完成\n\n|甲|乙|\n|--|--|\n|一|二|\n\n```js\nconst x = "==literal==";\n```\n<script>alert(1)</script>\n[危险](javascript:alert)\n![远程](https://example.test/a.png)',
    ),
  ]);
  const html = db.entries[0].content;
  for (const part of [
    '<h1>',
    '<em>斜体</em>',
    '<strong>粗体</strong>',
    '<mark>高亮</mark>',
    '<table>',
    '☑ ',
    '==literal==',
  ])
    assert.ok(html.includes(part), part);
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('href="javascript:'));
  assert.ok(!html.includes('src="https:'));
  assert.ok(db.entries[0].chatJournal.messages[0].text.includes('<script>'));
});

test('backup reconciliation retains canonical messages and remaps nested media alongside ordinary attachment references', () => {
  const original = makeDb();
  original.media.push({
    id: 'old-media',
    name: '测试.png',
    type: 'image/png',
    sha256: 'abc',
    size: 12,
  });
  saveChatRoom(original, room());
  append(original, [msg(1, 0, '配图', ['old-media'])]);
  const target = makeDb();
  target.imports = [];
  target.media.push({ ...original.media[0], id: 'reused-media' });
  reconcileImport(target, structuredClone(original));
  assert.deepEqual(target.entries[0].attachments, ['reused-media']);
  assert.deepEqual(target.entries[0].chatJournal.messages[0].attachments, ['reused-media']);
  assert.deepEqual(target.chatJournal.rooms, original.chatJournal.rooms);
});

async function fixture(t) {
  const root = fileURLToPath(new URL('../tmp/chat-journal-tests/', import.meta.url));
  await fs.mkdir(root, { recursive: true });
  const dir = await fs.mkdtemp(path.join(root, 'case-'));
  let server;
  async function restart() {
    if (server) {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
    server = await createDiaryServer({ dataDir: dir, seed: false });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
  }
  await restart();
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    assert.ok(path.resolve(dir).startsWith(path.resolve(root) + path.sep));
    await fs.rm(dir, { recursive: true, force: true });
  });
  const request = (p, method = 'GET', data) =>
    fetch('http://127.0.0.1:' + server.address().port + p, {
      method,
      headers: { 'X-Diary-Client': 'desktop', 'Content-Type': 'application/json' },
      body: data ? JSON.stringify(data) : undefined,
    });
  return { dir, request, restart, base: () => 'http://127.0.0.1:' + server.address().port };
}

test('HTTP serial commits survive concurrent retries, restart and idle startup recovery; old diary remains unchanged', async (t) => {
  const { request, restart } = await fixture(t);
  const old = await (
    await request('/api/entries', 'POST', {
      title: '原日记',
      content: '<p>保持原样</p>',
      date: new Date(start).toISOString(),
      category: '日常',
      tags: [],
      attachments: [],
    })
  ).json();
  assert.equal((await request('/api/chat-journal/rooms', 'PUT', room())).status, 200);
  const payload = { sourceId, roomId: '-10', messages: [msg(1)] };
  const responses = await Promise.all([
    request('/api/chat-journal/messages', 'POST', payload),
    request('/api/chat-journal/messages', 'POST', payload),
  ]);
  assert.deepEqual(
    responses.map((r) => r.status),
    [200, 200],
  );
  const ids = await Promise.all(responses.map(async (r) => (await r.json()).accepted[0].entryId));
  assert.equal(ids[0], ids[1]);
  await restart();
  assert.equal((await request('/api/chat-journal/messages', 'POST', payload)).status, 200);
  const db = await (await request('/api/library')).json();
  assert.equal(db.entries.length, 2);
  assert.deepEqual(
    db.entries.find((e) => e.id === old.id),
    old,
  );
  const receipts = await (
    await request('/api/chat-journal/receipts', 'POST', {
      sourceId,
      roomId: '-10',
      ids: ['1', '2'],
    })
  ).json();
  assert.equal(receipts.accepted.length, 1);
  assert.equal(db.entries.find((e) => e.id === ids[0]).chatJournal.status, 'closed');
  assert.equal(
    (await request('/api/chat-journal/rooms', 'PUT', room('-10', '不存在'))).status,
    409,
  );
  assert.equal(
    (
      await request('/api/chat-journal/messages', 'POST', {
        ...payload,
        messages: [msg(2, 1), msg(1, 0, '改写')],
      })
    ).status,
    409,
  );
  assert.equal((await (await request('/api/library')).json()).entries.length, 2);
});

test('original binary media and generic files enter diary storage, deduplicate and are included in backup manifest', async (t) => {
  const { base, request, dir } = await fixture(t);
  const bytes = Buffer.from('synthetic original attachment\0\xff');
  const send = () =>
    fetch(base() + '/api/chat-journal/media', {
      method: 'POST',
      headers: {
        'X-Diary-Client': 'desktop',
        'Content-Type': 'application/octet-stream',
        'X-File-Name': encodeURIComponent('测试附件.bin'),
      },
      body: bytes,
    });
  const media = await (await send()).json();
  assert.equal((await (await send()).json()).id, media.id);
  assert.equal(media.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(await fs.readFile(path.join(dir, 'media', media.id)), bytes);
  await request('/api/chat-journal/rooms', 'PUT', room());
  assert.equal(
    (
      await request('/api/chat-journal/messages', 'POST', {
        sourceId,
        roomId: '-10',
        messages: [msg(1, 0, '', [media.id])],
      })
    ).status,
    200,
  );
  const manifest = await (await request('/api/backup-manifest')).json();
  assert.equal(manifest.files.length, 1);
  assert.deepEqual(manifest.library.entries[0].chatJournal.messages[0].attachments, [media.id]);
  const blocked = await fetch(base() + '/api/chat-journal/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://example.test' },
    body: '{}',
  });
  assert.equal(blocked.status, 403);
});
