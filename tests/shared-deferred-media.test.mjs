import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, unlink, writeFile } from 'node:fs/promises';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import {
  appendChatMessages,
  saveChatRoom,
  withdrawChatMessage,
} from '../src/server/domain/chat-journal.mjs';
import { createDiaryServer } from '../src/server/app.mjs';

function room() {
  const sourceId = randomUUID(),
    roomId = '-1',
    mediaId = randomUUID(),
    now = Date.now();
  const db = {
    categories: ['日常', '其他'],
    entries: [],
    media: [{ id: mediaId, type: 'image/png' }],
  };
  saveChatRoom(db, { sourceId, id: roomId, title: '合成房', category: '日常', idleHours: 5 });
  const input = (id, at, media = false) => ({
    sourceId,
    roomId,
    messages: [
      {
        id,
        sentAt: new Date(at).toISOString(),
        text: media ? 'caption' : 'text',
        attachments: media ? [mediaId] : [],
      },
    ],
  });
  return { db, sourceId, roomId, mediaId, now, input };
}

test('trusted late media inserts in current untouched open window with min/max bounds, without splitting replacement chains', () => {
  const f = room(),
    at = f.now - 60000;
  appendChatMessages(f.db, f.input('100', at), f.now);
  withdrawChatMessage(
    f.db,
    {
      sourceId: f.sourceId,
      roomId: f.roomId,
      messageId: '100',
      operationId: randomUUID(),
      expectedRevision: 1,
    },
    f.now,
  );
  const replacement = f.input('300', at);
  replacement.messages[0].replacementOf = '100';
  appendChatMessages(f.db, replacement, f.now);
  appendChatMessages(f.db, f.input('400', at + 1000), f.now);
  const entry = f.db.entries[0],
    originalId = entry.id,
    deadline = entry.chatJournal.deadline;
  const deferred = f.input('200', at, true);
  const accepted = appendChatMessages(f.db, deferred, f.now, { deferredMedia: true });
  assert.equal(accepted.accepted[0].entryId, originalId);
  assert.deepEqual(
    entry.chatJournal.messages.map((m) => m.id),
    ['100', '300', '200', '400'],
  );
  assert.equal(entry.chatJournal.firstAt, new Date(at).toISOString());
  assert.equal(entry.chatJournal.lastAt, new Date(at + 1000).toISOString());
  assert.equal(entry.chatJournal.deadline, deadline);
  appendChatMessages(f.db, deferred, f.now, { deferredMedia: true });
  assert.equal(entry.chatJournal.messages.length, 4);
  const earlier = f.input('50', at - 1000, true);
  appendChatMessages(f.db, earlier, f.now, { deferredMedia: true });
  assert.equal(entry.chatJournal.firstAt, new Date(at - 1000).toISOString());
  assert.equal(entry.chatJournal.lastAt, new Date(at + 1000).toISOString());
});

test('closed/manual/too-old/different-category targets are isolated closed entries; original/latest neighbor remains byte-identical', () => {
  for (const variant of ['closed', 'manual', 'old', 'category', 'hidden', 'draft']) {
    const f = room(),
      at = f.now - 60000;
    appendChatMessages(f.db, f.input('200', at), f.now);
    const original = f.db.entries[0];
    if (variant === 'closed') original.chatJournal.status = 'closed';
    if (variant === 'manual') original.content += '<p>手工正文</p>';
    if (variant === 'hidden') original.hidden = true;
    if (variant === 'draft') original.draft = true;
    if (variant === 'category')
      saveChatRoom(f.db, {
        sourceId: f.sourceId,
        id: f.roomId,
        title: '合成房',
        category: '其他',
        idleHours: 5,
      });
    const before = JSON.stringify(original);
    const incoming = f.input('100', variant === 'old' ? at - 6 * 3600000 : at + 1000, true);
    appendChatMessages(f.db, incoming, f.now, { deferredMedia: true });
    assert.equal(JSON.stringify(original), before, variant);
    assert.equal(f.db.entries.length, 2);
    assert.equal(f.db.entries[0].chatJournal.status, 'closed');
    assert.equal(f.db.entries[0].chatJournal.closeReason, 'deferred-media');
    assert.equal(f.db.entries[0].chatJournal.messages[0].sentAt, incoming.messages[0].sentAt);
  }
});

test('actual shared command requires completed original proof; legacy spoof stays rejected and replay/restart cannot duplicate or reuse proof', async (t) => {
  const root = path.resolve('tmp/backend-shared-auth/deferred-media');
  await mkdir(root, { recursive: true });
  const dataDir = await mkdtemp(path.join(root, 'case-')),
    sourceId = randomUUID(),
    roomId = '-1';
  let server;
  async function start() {
    server = await createDiaryServer({ dataDir, seed: false, sharedSync: true });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
  }
  async function stop() {
    server.close();
    await once(server, 'close');
  }
  await start();
  t.after(stop);
  async function http(route, input, method = 'POST') {
    const response = await fetch(`http://127.0.0.1:${server.address().port}` + route, {
      method,
      headers: { 'X-Diary-Client': 'desktop', 'Content-Type': 'application/json' },
      ...(method === 'GET' ? {} : { body: JSON.stringify(input) }),
    });
    const value = await response.json();
    if (!response.ok)
      throw Object.assign(Error(value.error?.code || value.error), {
        code: value.error?.code,
        status: response.status,
      });
    return value;
  }
  await http(
    '/api/chat-journal/rooms',
    { sourceId, id: roomId, title: '合成房', category: '日常', idleHours: 5 },
    'PUT',
  );
  const info = await http('/api/shared/v1/info', null, 'GET'),
    uploadOperationId = randomUUID(),
    bytes = Buffer.from('synthetic original');
  const metadata = {
    name: 'synthetic.png',
    mime: 'image/png',
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  const upload = { libraryId: info.libraryId, epoch: info.epoch, operationId: uploadOperationId };
  await http('/api/shared/v1/media/begin', { ...upload, metadata });
  await http('/api/shared/v1/media/chunk', {
    ...upload,
    offset: 0,
    bytesBase64: bytes.toString('base64'),
    chunkSha256: metadata.sha256,
  });
  const asset = (await http('/api/shared/v1/media/complete', upload)).asset;
  const now = Date.now(),
    newer = {
      id: '200',
      sentAt: new Date(now - 1000).toISOString(),
      text: '文字先成功',
      attachments: [],
    };
  await http('/api/chat-journal/messages', { sourceId, roomId, messages: [newer] });
  const operationId = randomUUID(),
    old = {
      id: '100',
      sentAt: new Date(now - 2000).toISOString(),
      text: 'caption',
      attachments: [asset.id],
      replyTo: '200',
    };
  const input = {
    sourceId,
    roomId,
    messages: [old],
    deferredMedia: { uploadOperationIds: [uploadOperationId] },
  };
  await assert.rejects(
    () => http('/api/chat-journal/messages', input),
    (e) => e.status === 409,
  );
  const command = {
    libraryId: info.libraryId,
    epoch: info.epoch,
    operationId,
    action: 'journal-send',
    input,
  };
  await assert.rejects(
    () =>
      http('/api/shared/v1/command', {
        ...command,
        input: { ...input, deferredMedia: { uploadOperationIds: [randomUUID()] } },
      }),
    { code: 'SHARED_DEFERRED_MEDIA_NOT_COMPLETE' },
  );
  const dbFile = path.join(dataDir, 'diary.json'),
    durableBefore = await readFile(dbFile, 'utf8');
  await unlink(path.join(dataDir, 'media', asset.id));
  await assert.rejects(() => http('/api/shared/v1/command', command), {
    code: 'SHARED_DEFERRED_MEDIA_ORIGINAL_UNAVAILABLE',
  });
  assert.equal(await readFile(dbFile, 'utf8'), durableBefore);
  await writeFile(path.join(dataDir, 'media', asset.id), bytes);
  const rename = fs.rename;
  try {
    fs.rename = async (from, to) => {
      if (to === dbFile)
        throw Object.assign(Error('synthetic failed rename'), { code: 'SYNTHETIC_RENAME_FAILURE' });
      return rename(from, to);
    };
    await assert.rejects(
      () => http('/api/shared/v1/command', command),
      (e) => e.status === 500,
    );
  } finally {
    fs.rename = rename;
  }
  assert.equal(
    await readFile(dbFile, 'utf8'),
    durableBefore,
    'business, command receipt and media claim rollback with owner rename',
  );
  const accepted = await http('/api/shared/v1/command', command);
  assert.equal(accepted.replayed, false);
  let raw = JSON.parse(await readFile(path.join(dataDir, 'diary.json'), 'utf8'));
  const entry = raw.entries.find((e) => e.chatJournal.messages.some((m) => m.id === '100'));
  assert.deepEqual(
    entry.chatJournal.messages.map((m) => m.id),
    ['100', '200'],
  );
  assert.equal(entry.chatJournal.messages[0].sentAt, old.sentAt);
  assert.equal(entry.chatJournal.messages[0].replyTo, '200');
  assert.deepEqual(entry.chatJournal.messages[0].attachments, [asset.id]);
  await stop();
  await start();
  const replay = await http('/api/shared/v1/command', command);
  assert.equal(replay.replayed, true);
  await assert.rejects(
    () =>
      http('/api/shared/v1/command', {
        ...command,
        operationId: randomUUID(),
        input: { ...input, messages: [{ ...old, id: '101' }] },
      }),
    { code: 'SHARED_DEFERRED_MEDIA_ALREADY_USED' },
  );
  await unlink(path.join(dataDir, 'media', asset.id));
  assert.equal(
    (await http('/api/shared/v1/command', command)).replayed,
    true,
    'receipt replay does not rerun a previously successful write',
  );
  raw = JSON.parse(await readFile(path.join(dataDir, 'diary.json'), 'utf8'));
  assert.equal(
    raw.entries.flatMap((e) => e.chatJournal?.messages || []).filter((m) => m.id === '100').length,
    1,
  );
});
