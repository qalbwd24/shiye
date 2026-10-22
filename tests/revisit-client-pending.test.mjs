import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRevisitClient,
  REVISIT_ROOM,
} from '../previews/telegram-chat/shiye-revisit-client.js';

const comment = (id) => ({
  id,
  date: 1792396800,
  message: `comment-${id}`,
  shiyeComment: { operationId: `op-${id}`, batchId: 'fixed-batch', deliveryId: 'fixed-delivery' },
});

function fixture(messages, onApi = () => {}, onRead = () => {}) {
  const data = { messages: { [REVISIT_ROOM]: messages }, shiyeWithdrawalOutbox: [] };
  const calls = [],
    commands = [];
  let reads = 0;
  const client = createRevisitClient({
    readLibrary: async () => {
      reads += 1;
      onRead(reads, data);
      return structuredClone(data);
    },
    api: async (action, payload) => {
      calls.push({ action, payload });
      await onApi(action, payload, data);
      if (action === 'status') return { config: { enabled: true, timeZone: 'Asia/Shanghai' } };
      if (action === 'feed') return { deliveries: [], batches: [], next: 0, total: 0 };
      return {};
    },
    command: async (action, payload) => {
      commands.push({ action, payload });
      if (action === 'program-ack') {
        const message = data.messages[REVISIT_ROOM].find(
          (m) => m.shiyeComment?.operationId === payload.operationId,
        );
        if (message) message.shiyeComment.acknowledged = true;
      }
      if (action === 'withdrawal-ack') data.shiyeWithdrawalOutbox = [];
    },
  });
  return { client, data, calls, commands, reads: () => reads };
}

test('history and acknowledged comments use a constant number of library reads', async () => {
  for (const count of [0, 78, 300]) {
    const f = fixture(
      Array.from({ length: count }, (_, id) =>
        id % 2
          ? { id, shiyeProgram: { deliveryId: `history-${id}` } }
          : { ...comment(id), shiyeComment: { ...comment(id).shiyeComment, acknowledged: true } },
      ),
    );
    await f.client.sync();
    assert.equal(f.reads(), 4);
    assert.deepEqual(
      f.calls.map((c) => c.action),
      ['status', 'feed'],
    );
    assert.deepEqual(
      f.commands.map((c) => c.action),
      ['program-feed'],
    );
  }
});

test('pending comments retain their fixed target and newest text after an awaited request', async () => {
  const f = fixture([comment(1), comment(2)], (action, payload, data) => {
    if (action === 'comment' && payload.operationId === 'op-1')
      data.messages[REVISIT_ROOM][1].message = 'edited while waiting';
  });
  await f.client.sync();
  const sent = f.calls.filter((c) => c.action === 'comment').map((c) => c.payload);
  assert.equal(sent.length, 2);
  assert.equal(sent[1].text, 'edited while waiting');
  assert.equal(sent[1].batchId, 'fixed-batch');
  assert.equal(sent[1].deliveryId, 'fixed-delivery');
  assert.equal(f.reads(), 6);
});

for (const change of ['withdrawn', 'deleted', 'acknowledged']) {
  test(`rechecks a later pending comment ${change} during the previous request`, async () => {
    const f = fixture([comment(1), comment(2)], (action, payload, data) => {
      if (action !== 'comment' || payload.operationId !== 'op-1') return;
      if (change === 'withdrawn')
        data.shiyeWithdrawalOutbox.push({
          roomId: REVISIT_ROOM,
          messageId: 2,
          operationId: 'withdraw-2',
        });
      if (change === 'deleted') data.messages[REVISIT_ROOM].pop();
      if (change === 'acknowledged')
        data.messages[REVISIT_ROOM][1].shiyeComment.acknowledged = true;
    });
    await f.client.sync();
    assert.deepEqual(
      f.calls.filter((c) => c.action === 'comment').map((c) => c.payload.operationId),
      ['op-1'],
    );
    assert.deepEqual(
      f.commands.filter((c) => c.action === 'program-ack').map((c) => c.payload.operationId),
      ['op-1'],
    );
  });
}

test('existing withdrawals reach the backend before durable local acknowledgement', async () => {
  const f = fixture([]);
  f.data.shiyeRevisitComments = { 9: { operationId: 'saved-comment-9' } };
  f.data.shiyeWithdrawalOutbox = [
    { roomId: REVISIT_ROOM, messageId: 9, operationId: 'withdraw-9' },
  ];
  await f.client.sync();
  assert.deepEqual(
    f.calls.filter((c) => c.action === 'withdraw').map((c) => c.payload),
    [{ operationId: 'saved-comment-9' }],
  );
  assert.deepEqual(f.commands.find((c) => c.action === 'withdrawal-ack').payload.operationIds, [
    'withdraw-9',
  ]);
  assert.equal(f.data.shiyeWithdrawalOutbox.length, 0);
});

test('failed comment is retried on the next sync, without duplicating its local ack', async () => {
  let fail = true;
  const f = fixture([comment(1)], (action) => {
    if (action === 'comment' && fail) throw Error('synthetic offline');
  });
  await f.client.sync();
  assert.match(f.client.status().lastError, /offline/);
  assert.equal(f.commands.filter((c) => c.action === 'program-ack').length, 0);
  fail = false;
  await f.client.sync();
  await f.client.sync();
  assert.equal(f.calls.filter((c) => c.action === 'comment').length, 2);
  assert.equal(f.commands.filter((c) => c.action === 'program-ack').length, 1);
});

test('an edit appearing between withdrawal scan and pending scan waits for its predecessor ACK', async () => {
  const f = fixture(
    [],
    () => {},
    (reads, data) => {
      if (reads !== 2) return;
      data.messages[REVISIT_ROOM] = [{ ...comment(2), replacesMessageId: 1 }];
      data.shiyeRevisitComments = { 1: { operationId: 'old-comment-1' } };
      data.shiyeWithdrawalOutbox = [
        { roomId: REVISIT_ROOM, messageId: 1, operationId: 'withdraw-1' },
      ];
    },
  );
  await f.client.drainComments();
  assert.equal(f.calls.length, 0);
  assert.equal(f.commands.length, 0);
  await f.client.drainComments();
  assert.deepEqual(
    f.calls.map((c) => c.action),
    ['withdraw', 'comment'],
  );
  assert.deepEqual(
    f.commands.map((c) => c.action),
    ['withdrawal-ack', 'program-ack'],
  );
  assert.equal(f.calls[1].payload.operationId, 'op-2');
});
