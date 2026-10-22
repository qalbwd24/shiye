import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { createDiaryServer } from '../src/server/app.mjs';
import { createSharedBusinessClient } from '../public/shared/shared-business-client.js';
import { createSharedChatSource } from '../android/qq-chat/shared-source.js';
import { createMemorySyncStorage } from './helpers/sync-v2-client-memory.mjs';
import { JSDOM } from 'jsdom';
import { installQQPanels } from '../android/qq-chat/panels.js';

async function fixture(t) {
  const root = path.resolve('tmp/shared-chat-source-tests');
  await mkdir(root, { recursive: true });
  const dataDir = await mkdtemp(path.join(root, 'case-'));
  const server = await createDiaryServer({
    dataDir,
    seed: false,
    sharedSync: true,
    messageUnits: true,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.close();
    await once(server, 'close');
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const old = async (route, body, method = 'POST') => {
    const r = await fetch(base + route, {
      method: body === undefined ? 'GET' : method,
      headers: { 'Content-Type': 'application/json', 'X-Diary-Client': 'desktop' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await r.json();
    if (!r.ok)
      throw Object.assign(Error(result.error?.code || result.error || 'HTTP'), {
        status: r.status,
        code: result.error?.code,
      });
    return result;
  };
  const info = await old('/api/shared/v1/info');
  const sourceId = randomUUID(),
    roomId = '-100';
  await old(
    '/api/chat-journal/rooms',
    { sourceId, id: roomId, title: '共享原房', category: '日常', idleHours: 5 },
    'PUT',
  );
  const current = {
    value: {
      conversationId: `desktop:${sourceId}:${roomId}`,
      sourceId,
      roomId,
      title: '共享原房',
      messageOwner: 'legacy',
    },
  };
  const calls = [];
  let offline = false,
    lost = false;
  const request = async (action, input) => {
    calls.push({ action, input: structuredClone(input) });
    if (offline) throw Error('offline');
    const result = await old('/api/shared/v1/' + action, action === 'info' ? undefined : input);
    if (action === 'command' && input.action === 'journal-send' && lost) {
      lost = false;
      throw Error('ACK lost');
    }
    return result;
  };
  const storage = createMemorySyncStorage();
  let client = createSharedBusinessClient({
    request,
    storage,
    libraryId: info.libraryId,
    epoch: info.epoch,
  });
  let source = createSharedChatSource({
    client,
    currentRoom: () => current.value,
    autoSync: false,
  });
  return {
    base,
    old,
    info,
    current,
    sourceId,
    roomId,
    calls,
    request,
    storage,
    get client() {
      return client;
    },
    get source() {
      return source;
    },
    setOffline: (v) => {
      offline = v;
    },
    loseAck: () => {
      lost = true;
    },
    reopen() {
      source.dispose();
      client = createSharedBusinessClient({
        request,
        storage,
        libraryId: info.libraryId,
        epoch: info.epoch,
      });
      source = createSharedChatSource({
        client,
        currentRoom: () => current.value,
        autoSync: false,
      });
      return source;
    },
  };
}
test('actual HTTP desktop journal and QQ source share original message identity, reply and withdraw', async (t) => {
  const f = await fixture(t),
    originalId = '90071992547409930001',
    sentAt = '2026-10-18T00:00:00.000Z';
  await f.old('/api/chat-journal/messages', {
    sourceId: f.sourceId,
    roomId: f.roomId,
    messages: [{ id: originalId, sentAt, text: 'desktop original', attachments: [] }],
  });
  await f.source.refresh();
  assert.equal(f.source.getSnapshot().messages[0].id, originalId);
  assert.equal(f.source.getSnapshot().messages[0].sentAt, sentAt);
  await f.source.setDraft('phone reply', originalId);
  const local = await f.source.sendText('phone reply', originalId, {
    id: '90071992547409930002',
    sentAt: '2026-10-18T00:00:01.000Z',
  });
  assert.equal(local.localAck, true);
  assert.equal(local.serverConfirmed, false);
  assert.equal(f.source.getDraft().text, '');
  assert.equal(f.source.getSnapshot().messages.at(-1).replyId, originalId);
  await f.client.sync();
  await f.source.refresh();
  const entries = await f.old('/api/shared/v1/command', {
    libraryId: f.info.libraryId,
    epoch: f.info.epoch,
    operationId: randomUUID(),
    action: 'entry-list',
    input: {},
  });
  assert.ok(JSON.stringify(entries).includes('phone reply'));
  await f.source.withdraw(originalId);
  assert.equal(f.source.getSnapshot().messages.find((m) => m.id === originalId).kind, 'withdrawn');
  await f.client.sync();
  await f.source.refresh();
  assert.equal(f.source.getSnapshot().messages.find((m) => m.id === originalId).text, '');
  await assert.rejects(() => f.source.sendText('cannot restore', null, { id: originalId }), {
    code: 'MESSAGE_WITHDRAWN',
  });
});
test('offline durable send, lost server ACK and cross-client reopening keep same IDs and newest draft', async (t) => {
  const f = await fixture(t);
  await f.source.refresh();
  await f.source.setDraft('offline first');
  f.setOffline(true);
  const result = await f.source.sendText('offline first', null, { id: '99999999999999999991' });
  await f.source.setDraft('newer draft');
  assert.equal(f.source.getSnapshot().messages.filter((m) => m.id === result.messageId).length, 1);
  f.reopen();
  await f.source.refresh();
  assert.equal(f.source.getDraft().text, 'newer draft');
  assert.equal(f.source.getSnapshot().messages.filter((m) => m.id === result.messageId).length, 1);
  f.setOffline(false);
  f.loseAck();
  await assert.rejects(() => f.client.sync());
  f.reopen();
  await f.client.sync();
  await f.source.refresh();
  assert.equal(f.source.getSnapshot().messages.filter((m) => m.id === result.messageId).length, 1);
  assert.equal(f.source.getDraft().text, 'newer draft');
  const wires = f.calls
    .filter((c) => c.action === 'command' && c.input.action === 'journal-send')
    .map((c) => c.input);
  assert.equal(wires.length, 2);
  assert.deepEqual(wires[0], wires[1]);
});
test('actual replacement retains explicit original time/root and stale refresh cannot populate another room', async (t) => {
  const f = await fixture(t),
    id = '90071992547409930011',
    sentAt = '2026-10-18T00:00:00.000Z';
  await f.old('/api/chat-journal/messages', {
    sourceId: f.sourceId,
    roomId: f.roomId,
    messages: [{ id, sentAt, text: 'original', attachments: [] }],
  });
  await f.source.refresh();
  await f.source.withdraw(id);
  await f.client.sync();
  await f.source.sendText('replacement', null, {
    id: '90071992547409930012',
    sentAt,
    replacementOf: id,
    replacementRootId: id,
  });
  await f.client.sync();
  await f.source.refresh();
  const rows = f.source.getSnapshot().messages;
  assert.equal(rows.find((m) => m.id === '90071992547409930012').sentAt, sentAt);
  assert.equal(rows.find((m) => m.id === id).kind, 'withdrawn');
  const wire = f.calls.findLast(
    (c) => c.action === 'command' && c.input.action === 'journal-send',
  ).input;
  assert.equal(wire.input.messages[0].replacementRootId, id);
  const before = f.source.refresh();
  f.current.value = {
    conversationId: `desktop:${f.sourceId}:-200`,
    sourceId: f.sourceId,
    roomId: '-200',
    title: 'other',
    messageOwner: 'legacy',
  };
  await before;
  assert.equal(f.source.getSnapshot().conversationId, f.current.value.conversationId);
  assert.deepEqual(f.source.getSnapshot().messages, []);
});
test('unmapped rooms require explicit prepare callback and empty selection is safe', async () => {
  const storage = createMemorySyncStorage(),
    client = createSharedBusinessClient({
      request: async () => {
        throw Error('offline');
      },
      storage,
      libraryId: randomUUID(),
      epoch: randomUUID(),
    });
  let current = null;
  const source = createSharedChatSource({ client, currentRoom: () => current, autoSync: false });
  assert.equal(source.getSnapshot().inConversation, false);
  current = { localId: 'stable-local-one', title: 'same name' };
  await assert.rejects(() => source.sendText('x'), { code: 'ROOM_SERVER_MAPPING_REQUIRED' });
});
test('shared source satisfies real QQ panels contract and sends uploaded original through actual shared HTTP', async (t) => {
  const f = await fixture(t);
  f.source.dispose();
  const source = createSharedChatSource({
    client: f.client,
    currentRoom: () => f.current.value,
    autoSync: false,
    uploadFiles: async (files) => {
      const ids = [];
      for (const file of files) {
        const response = await fetch(f.base + '/api/chat-journal/media', {
          method: 'POST',
          headers: {
            'Content-Type': file.type,
            'X-Diary-Client': 'desktop',
            'X-File-Name': encodeURIComponent(file.name || 'image.png'),
          },
          body: await file.arrayBuffer(),
        });
        assert.equal(response.status, 201);
        ids.push((await response.json()).id);
      }
      return ids;
    },
  });
  await source.refresh();
  const dom = new JSDOM('<!doctype html><body></body>'),
    previousDocument = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    const panels = installQQPanels({ source });
    assert.ok(dom.window.document.querySelector('#shiye-qq-panels'));
    panels.destroy();
  } finally {
    globalThis.document = previousDocument;
    dom.window.close();
  }
  for (const method of [
    'getSnapshot',
    'getDraft',
    'setDraft',
    'sendText',
    'sendFiles',
    'withdraw',
    'getMedia',
    'openMedia',
    'loadOlder',
    'flush',
    'getContext',
    'settings',
    'openStickers',
    'saveSticker',
    'sendSticker',
    'subscribe',
    'refresh',
    'setActive',
    'dispose',
  ])
    assert.equal(typeof source[method], 'function', method);
  assert.throws(() => source.saveSticker({}), { code: 'STICKER_COLLECTION_UNAVAILABLE' });
  const file = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1])], {
    type: 'image/png',
  });
  file.name = 'original.png';
  const receipt = await source.sendFiles([file]);
  assert.equal(receipt.localAck, true);
  await f.client.sync();
  await source.refresh();
  const row = source.getSnapshot().messages.find((m) => m.id === receipt.messageId);
  assert.equal(row.attachments.length, 1);
  const original = await fetch(f.base + '/media/' + row.attachments[0]);
  assert.equal(original.status, 200);
  assert.deepEqual(
    new Uint8Array(await original.arrayBuffer()),
    new Uint8Array(await file.arrayBuffer()),
  );
  source.dispose();
});
test('new local draft saved during actual server send/late ACK is retained', async (t) => {
  const f = await fixture(t);
  f.source.dispose();
  let release, started;
  const gate = new Promise((r) => {
      release = r;
    }),
    ready = new Promise((r) => {
      started = r;
    });
  const client = createSharedBusinessClient({
    storage: f.storage,
    libraryId: f.info.libraryId,
    epoch: f.info.epoch,
    request: async (action, input) => {
      const answer = await f.request(action, input);
      if (action === 'command' && input.action === 'journal-send') {
        started();
        await gate;
      }
      return answer;
    },
  });
  const source = createSharedChatSource({
    client,
    currentRoom: () => f.current.value,
    autoSync: false,
  });
  await source.refresh();
  await source.setDraft('initial');
  await source.sendText('initial');
  const sending = client.sync();
  await ready;
  await source.setDraft('new input while ACK waiting');
  release();
  await sending;
  await source.refresh();
  assert.equal(source.getDraft().text, 'new input while ACK waiting');
  source.dispose();
});
