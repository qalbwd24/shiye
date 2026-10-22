import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Channel, loadWorker } from './helpers/local-program-worker.mjs';
test('unquoted replies follow the latest historic message, while explicit quotes pin one stable delivery', async () => {
  const worker = await loadWorker();
  const client = {
    mockData: {
      users: [],
      chats: [],
      channels: [],
      dialogs: { active: [], archived: [] },
      messages: {},
      documents: [],
      dialogFilters: [],
      topPeers: [],
      availableReactions: [],
    },
    fireUpdate() {},
  };
  worker.installLocalRoomCommands(client);
  const channel = new Channel('shiye-local-rooms');
  const command = (action, fields = {}) =>
    new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      channel.onmessage = ({ data }) => {
        if (data.requestId === requestId) data.error ? reject(Error(data.error)) : resolve(data);
      };
      channel.postMessage({ action, requestId, ...fields });
    });
  const item = (id, minute) => ({
    id,
    batchId: 'batch-' + id,
    originalAt: `2025-10-17T00:${minute}:00Z`,
    replayAt: `2026-10-17T00:${minute}:00Z`,
    source: { available: true, title: '不要显示的旧页标题', markdown: '原文' },
    presentation: { message: '*简洁消息*' },
  });
  const feed = {
    config: { title: '朝花夕拾', sender: { name: '过去的我' }, timeZone: 'Asia/Shanghai' },
    deliveries: [item('a', '30'), item('b', '31')],
  };
  await command('program-feed', { feed });
  const roomId = '-900000001',
    originalId = client.mockData.messages[roomId][0].id;
  assert.equal(client.mockData.messages[roomId][0].message, '*简洁消息*');
  const send = async (replyTo) => {
    await worker.invokeLocalPreview(
      client,
      new worker.Api.messages.SendMessage({
        peer: { roomId },
        message: '今天的感想',
        ...(replyTo
          ? { replyTo: new worker.Api.InputReplyToMessage({ replyToMsgId: replyTo }) }
          : {}),
      }),
    );
    return client.mockData.messages[roomId].at(-1).shiyeComment;
  };
  await command('program-target', { batchId: 'batch-a', deliveryId: 'a' });
  assert.equal((await send()).deliveryId, 'b');
  assert.equal((await send(originalId)).deliveryId, 'a');
  // A late or retried older delivery must not become the newest visible record.
  await command('program-feed', { feed: { ...feed, deliveries: [item('older', '29')] } });
  assert.equal((await send()).deliveryId, 'b');
  await command('program-feed', {
    feed: { ...feed, deliveries: [{ ...item('b', '31'), source: { available: false } }] },
  });
  assert.equal((await send()).deliveryId, 'a');
  assert.equal(
    client.mockData.messages[roomId].filter((m) => m.shiyeProgram?.deliveryId === 'b').length,
    1,
  );
});
