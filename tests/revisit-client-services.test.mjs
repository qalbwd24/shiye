import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRevisitClient } from '../previews/telegram-chat/shiye-revisit-client.js';

function fixture(instanceId = 'A') {
  const data = {
    messages: { '-20': [] },
    shiyeServiceStates: {
      [instanceId]: { roomId: '-20', targetBatchId: 'saved', targetDeliveryId: 'saved-delivery' },
    },
    shiyeRevisitComments: {},
    shiyeWithdrawalOutbox: [],
  };
  const calls = [],
    commands = [];
  let feed = {
    config: { timeZone: 'Asia/Shanghai' },
    deliveries: [],
    batches: [],
    next: 0,
    total: 0,
  };
  const client = createRevisitClient({
    roomId: '-20',
    instanceId,
    readLibrary: async () => structuredClone(data),
    api: async (action, payload) => {
      calls.push({ action, payload });
      return {
        ...(action === 'status' ? { config: { enabled: true } } : action === 'feed' ? feed : {}),
        scope: { instanceId },
      };
    },
    command: async (action, payload) => {
      commands.push({ action, payload });
    },
  });
  return {
    data,
    calls,
    commands,
    client,
    setFeed: (value) => {
      feed = value;
    },
  };
}

test('instance outbox drains only its own comments and withdrawal after unbinding', async () => {
  const f = fixture();
  f.data.messages['-20'] = ['A', 'B', undefined].map((instanceId, id) => ({
    id,
    date: 1792396800,
    message: 'text',
    shiyeComment: {
      instanceId,
      operationId: `op-${id}`,
      batchId: `batch-${id}`,
      deliveryId: `d-${id}`,
    },
  }));
  f.data.shiyeRevisitComments = {
    7: { instanceId: 'A', operationId: 'withdraw-A' },
    8: { instanceId: 'B', operationId: 'withdraw-B' },
  };
  f.data.shiyeWithdrawalOutbox = [7, 8].map((messageId) => ({
    messageId,
    roomId: '-20',
    operationId: `local-${messageId}`,
  }));
  await f.client.drainComments();
  assert.deepEqual(
    f.calls.map((call) => [call.action, call.payload.operationId]),
    [
      ['withdraw', 'withdraw-A'],
      ['comment', 'op-0'],
    ],
  );
  assert.ok(
    f.commands.every(({ payload }) => payload.roomId === '-20' && payload.instanceId === 'A'),
  );
  assert.deepEqual(f.commands[0].payload.operationIds, ['local-7']);
});

test('instance restores its own saved target and keeps command scope', async () => {
  const f = fixture();
  f.data.shiyeRevisit = { targetBatchId: 'legacy' };
  await f.client.sync();
  assert.equal(f.client.status().target.batchId, 'saved');
  assert.equal(f.client.status().target.instanceId, 'A');
  assert.equal(f.commands[0].payload.instanceId, 'A');
});

test('a mismatched backend scope never reaches local worker', async () => {
  const commands = [];
  const client = createRevisitClient({
    roomId: '-20',
    instanceId: 'A',
    readLibrary: async () => ({}),
    api: async () => ({ scope: { instanceId: 'B' } }),
    command: async (...args) => commands.push(args),
  });
  await assert.rejects(client.sync(), /实例身份/);
  assert.equal(commands.length, 0);
});

test('unbound historical refresh updates cached own deliveries without importing new ones', async () => {
  const f = fixture();
  f.data.messages['-20'] = [
    { id: 1, shiyeProgram: { instanceId: 'A', deliveryId: 'old' } },
    { id: 2, shiyeProgram: { instanceId: 'B', deliveryId: 'other' } },
  ];
  f.setFeed({
    config: { timeZone: 'Asia/Shanghai' },
    batches: [{ id: 'new-batch' }],
    next: 3,
    total: 3,
    deliveries: ['old', 'other', 'new'].map((id) => ({ id, source: { available: false } })),
  });
  await f.client.sync({ historical: true });
  const feed = f.commands.find((call) => call.action === 'program-feed').payload;
  assert.equal(feed.historical, true);
  assert.deepEqual(
    feed.feed.deliveries.map((item) => item.id),
    ['old'],
  );
  assert.equal(
    f.calls.some((call) => call.action === 'context'),
    false,
  );
});
