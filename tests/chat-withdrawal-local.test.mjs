import { test } from 'node:test';
import { Channel, loadWorker, loadJournal } from './helpers/local-program-worker.mjs';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const seed = () => ({
  users: [],
  chats: [],
  channels: [],
  dialogs: { active: [{ id: '-1', topMessage: 41 }], archived: [] },
  messages: {
    '-1': [
      { id: 41, date: 1790812800, message: 'synthetic-private-body', media: { id: 4 } },
      {
        id: 40,
        date: 1790812700,
        message: 'user-authored-comment',
        replyToMsgId: 41,
        replyPreview: 'synthetic-private-body',
        replyTo: { quoteText: 'synthetic-private-body', quoteEntities: [] },
      },
    ],
  },
  documents: [],
  dialogFilters: [],
  topPeers: [],
  availableReactions: [],
});

test('real local delete persists body-free outbox and tombstone, clears auto quotes, survives reload and never reuses ID', async () => {
  const worker = await loadWorker();
  const client = { mockData: seed() };
  await worker.invokeLocalPreview(client, new worker.Api.messages.DeleteMessages({ id: [41] }));
  const serialized = JSON.stringify(client.mockData);
  assert.ok(!serialized.includes('synthetic-private-body'));
  assert.ok(serialized.includes('user-authored-comment'));
  assert.equal(client.mockData.shiyeWithdrawalOutbox.length, 1);
  const operationId = client.mockData.shiyeWithdrawalOutbox[0].operationId;
  const restored = await worker.loadLocalPreview(seed());
  assert.equal(restored.shiyeWithdrawalOutbox[0].operationId, operationId);
  assert.equal(
    restored.messages['-1'].some((message) => message.id === 41),
    false,
  );
  client.mockData = restored;
  await worker.invokeLocalPreview(
    client,
    new worker.Api.messages.SendMessage({ peer: { roomId: '-1' }, message: 'synthetic-new-body' }),
  );
  assert.equal(client.mockData.messages['-1'].at(-1).id, 42);
});

test('program feed persists incoming group messages, deduplicates, captures comment targets and purges unavailable media', async () => {
  const worker = await loadWorker();
  const client = {
    mockData: { ...seed(), users: [] },
    updates: [],
    fireUpdate(update) {
      this.updates.push(update);
    },
  };
  worker.installLocalRoomCommands(client);
  const channel = new Channel('shiye-local-rooms');
  const command = (action, fields = {}) =>
    new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timer = setTimeout(() => reject(Error('worker command timeout')), 2000);
      channel.onmessage = ({ data }) => {
        if (data.requestId === requestId) {
          clearTimeout(timer);
          data.error ? reject(Error(data.error)) : resolve(data);
        }
      };
      channel.postMessage({ action, requestId, ...fields });
    });
  const feed = {
    config: { title: '朝花夕拾', sender: { name: '往年的我' }, timeZone: 'Asia/Shanghai' },
    deliveries: [
      {
        id: 'delivery-a',
        batchId: 'batch-a',
        replayAt: '2026-10-17T00:30:00Z',
        originalAt: '2025-10-17T00:30:00Z',
        source: { available: true, title: '旧页', markdown: '*合成文字*' },
        media: { bytes: [1, 2, 3], type: 'image/png', name: '图', width: 10, height: 10 },
      },
    ],
  };
  await command('program-feed', { feed });
  const roomId = '-900000001';
  const id = client.mockData.messages[roomId][0].id;
  assert.equal(Boolean(client.mockData.messages[roomId][0].out), false);
  assert.equal(client.updates.length, 1);
  await command('program-feed', { feed });
  assert.equal(client.mockData.messages[roomId].length, 1);
  await command('program-target', { batchId: 'batch-a' });
  await worker.invokeLocalPreview(
    client,
    new worker.Api.messages.SendMessage({ peer: { roomId }, message: '今天的评论' }),
  );
  const comment = client.mockData.messages[roomId].at(-1);
  assert.equal(comment.shiyeComment.batchId, 'batch-a');
  assert.equal(comment.shiyeComment.deliveryId, 'delivery-a');
  await command('program-target', { batchId: 'batch-b' });
  await worker.invokeLocalPreview(
    client,
    new worker.Api.messages.SendMessage({
      peer: { roomId },
      message: '引用回复',
      replyTo: new worker.Api.InputReplyToMessage({ replyToMsgId: id }),
    }),
  );
  assert.equal(client.mockData.messages[roomId].at(-1).shiyeComment.deliveryId, 'delivery-a');
  assert.equal(client.mockData.messages[roomId].at(-1).shiyeComment.batchId, 'batch-a');
  feed.deliveries[0].source = { available: false };
  await command('program-feed', { feed });
  assert.equal(client.mockData.messages[roomId][0].message, '原记录已变化或不可查看');
  assert.equal(client.mockData.documents.length, 0);
  const restored = await worker.loadLocalPreview(seed());
  assert.equal(restored.messages[roomId][0].message, '正在核对原记录…');
  assert.ok(restored.messages[roomId].some((item) => item.message === '今天的评论'));
  assert.equal(
    restored.shiyeRevisitComments[String(comment.id)].operationId,
    comment.shiyeComment.operationId,
  );
});

test('journal repairs a renamed invalid category but preserves a valid intentional choice', async () => {
  for (const selected of ['旧分类', '可选分类']) {
    const worker = await loadWorker();
    const client = { mockData: seed() };
    client.mockData.shiyeRooms = { '-1': { id: '-1', title: '测试会话', idleHours: 5 } };
    await worker.invokeLocalPreview(
      client,
      new worker.Api.messages.SendMessage({
        peer: { roomId: '-1' },
        message: 'synthetic-followup',
      }),
    );
    const roomUpdates = [];
    const journal = await loadJournal(
      ({ action, payload }) => {
        if (action === 'status')
          return {
            categories: ['新分类', '可选分类'],
            rooms: [{ sourceId: 'synthetic-source', id: '-1', category: '新分类' }],
          };
        if (action === 'room') {
          roomUpdates.push(payload);
          return { room: payload };
        }
        if (action === 'receipts')
          return { accepted: payload.ids.map((id) => ({ id, entryId: 'synthetic-entry' })) };
        throw Error(`Unexpected action ${action}`);
      },
      { sourceId: 'synthetic-source', rooms: { '-1': { enabled: true, category: selected } } },
    );
    await journal.flush();
    const expected = selected === '旧分类' ? '新分类' : selected;
    assert.equal(roomUpdates[0].category, expected);
    assert.equal((await journal.status()).rooms['-1'].category, expected);
  }
});

for (const fault of ['none', 'backend-ack-lost', 'local-ack-lost', 'archive-disabled']) {
  test(`real journal and worker persist withdrawal acknowledgement with ${fault}`, async () => {
    const worker = await loadWorker();
    const client = { mockData: seed() };
    await worker.invokeLocalPreview(client, new worker.Api.messages.DeleteMessages({ id: [41] }));
    worker.installLocalRoomCommands(client);
    let first = true;
    const withdrawals = [];
    const sent = [];
    let retired = false;
    const journal = await loadJournal(({ action, payload }) => {
      if (action === 'status') return { categories: ['随记'], rooms: [] };
      if (action === 'room') return { room: payload };
      if (action === 'receipts')
        return {
          accepted:
            retired && payload.ids.includes('41')
              ? [{ id: '41', revision: 2, state: 'withdrawn' }]
              : [],
        };
      if (action === 'withdraw') {
        withdrawals.push(structuredClone(payload));
        retired = true;
        if (first && fault === 'backend-ack-lost') {
          first = false;
          throw Error('Synthetic acknowledgement loss after commit');
        }
        if (first && fault === 'local-ack-lost') Channel.skipAck = true;
        first = false;
        return { id: payload.messageId, state: 'withdrawn', revision: 2 };
      }
      if (action === 'messages') {
        sent.push(...payload.messages);
        return { accepted: payload.messages.map(({ id }) => ({ id, entryId: 'synthetic-entry' })) };
      }
      throw Error(`Unexpected action ${action}`);
    });
    client.mockData.shiyeRooms = { '-1': { id: '-1', title: '测试会话', idleHours: 5 } };
    // Persist room metadata through the same worker transaction path as a normal write.
    await worker.invokeLocalPreview(
      client,
      new worker.Api.messages.SendMessage({
        peer: { roomId: '-1' },
        message: 'synthetic-followup',
      }),
    );
    if (fault === 'none') await journal.configure('-1', true, '随记');
    else if (fault === 'archive-disabled') {
      await journal.configure('-1', false, '随记');
      await journal.flush();
    } else {
      await assert.rejects(journal.configure('-1', true, '随记'));
      const beforeRetry = await worker.loadLocalPreview(seed());
      assert.equal(beforeRetry.shiyeWithdrawalOutbox.length, 1);
      await journal.flush();
    }
    const restored = await worker.loadLocalPreview(seed());
    assert.equal(restored.shiyeWithdrawalOutbox.length, 0);
    assert.equal(restored.shiyeWithdrawnMessages.length, 1);
    assert.equal(withdrawals.length, ['none', 'archive-disabled'].includes(fault) ? 1 : 2);
    assert.equal(new Set(withdrawals.map(({ operationId }) => operationId)).size, 1);
    assert.equal(JSON.stringify(withdrawals).includes('synthetic-private-body'), false);
    assert.equal(
      sent.some(({ id }) => id === '41'),
      false,
    );
    assert.equal(
      sent.some(({ id }) => id === '42'),
      fault !== 'archive-disabled',
    );
    assert.equal(
      JSON.stringify(restored, (_key, value) =>
        typeof value === 'bigint' ? String(value) : value,
      ).includes('synthetic-private-body'),
      false,
    );
  });
}

test('repeated deletion keeps one operation and channel deletion only affects the selected room', async () => {
  const worker = await loadWorker();
  const client = { mockData: seed() };
  client.mockData.messages['-2'] = [{ id: 41, date: 1790812800, message: 'synthetic-other-room' }];
  await worker.invokeLocalPreview(
    client,
    new worker.Api.channels.DeleteMessages({ channel: { roomId: '-1' }, id: [41] }),
  );
  await worker.invokeLocalPreview(
    client,
    new worker.Api.channels.DeleteMessages({ channel: { roomId: '-1' }, id: [41] }),
  );
  assert.equal(client.mockData.shiyeWithdrawalOutbox.length, 1);
  assert.equal(client.mockData.messages['-2'][0].message, 'synthetic-other-room');
});

test('C# withdrawal allowlist and JavaScript public mirror are identical to their source contract', async () => {
  const bridge = await fs.readFile(
    path.join(ROOT, 'previews/telegram-chat/ChatJournalBridge.cs'),
    'utf8',
  );
  assert.match(bridge, /case "withdraw": method = "POST"; path = "\/api\/chat-journal\/withdraw"/);
  assert.equal(
    await fs.readFile(path.join(ROOT, 'previews/telegram-chat/shiye-journal.js'), 'utf8'),
    await fs.readFile(
      path.join(ROOT, 'previews/telegram-chat/vendor/web-a/public/shiye-journal.js'),
      'utf8',
    ),
  );
});
