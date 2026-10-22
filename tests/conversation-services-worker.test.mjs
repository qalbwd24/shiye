import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadWorker, Channel } from './helpers/local-program-worker.mjs';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
async function fixture() {
  const worker = await loadWorker();
  const rooms = ['-1', '-2', '-3'];
  const data = {
    users: [{ id: '1', self: true }],
    chats: rooms.map((id) => ({ id, title: id })),
    channels: [],
    documents: [],
    availableReactions: [],
    dialogFilters: [],
    topPeers: [],
    dialogs: { active: rooms.map((id) => ({ id })), archived: [] },
    messages: Object.fromEntries(rooms.map((id) => [id, []])),
    shiyeRooms: Object.fromEntries(
      rooms.map((id) => [id, { id, title: id, kind: 'group', participants: [] }]),
    ),
  };
  const client = { mockData: data, fireUpdate() {} };
  worker.installLocalRoomCommands(client);
  const channel = new Channel('shiye-local-rooms');
  const pending = new Map();
  channel.onmessage = ({ data }) => {
    const item = pending.get(data.requestId);
    if (!item) return;
    pending.delete(data.requestId);
    clearTimeout(item.timer);
    if (data.error) item.reject(Error(data.error));
    else item.resolve(data);
  };
  const command = (action, payload = {}) =>
    new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timer = setTimeout(() => reject(Error('isolated worker command timeout')), 3000);
      pending.set(requestId, { resolve, reject, timer });
      channel.postMessage({ requestId, action, ...payload });
    });
  const binding = (instanceId, roomId, active = true) => ({
    instanceId,
    roomId,
    active,
    id: instanceId,
    providerId: 'revisit',
    revision: 1,
  });
  const feed = (instanceId, text, id = 'same-delivery') => ({
    config: { title: 'service-title', sender: { name: text } },
    scope: { instanceId },
    batches: [],
    next: 1,
    deliveries: [
      {
        id,
        batchId: 'batch',
        replayAt: '2026-10-19T08:00:00Z',
        source: { available: true, markdown: text, media: [] },
      },
    ],
  });
  const send = (roomId, message, replyToMsgId) =>
    worker.invokeLocalPreview(
      client,
      new worker.Api.messages.SendMessage({
        peer: { roomId },
        message,
        randomId: BigInt(Date.now()),
        ...(replyToMsgId ? { replyTo: new worker.Api.InputReplyToMessage({ replyToMsgId }) } : {}),
      }),
    );
  return { worker, client, command, binding, feed, send };
}

test('actual local worker isolates two feeds, senders and receipt identities without renaming rooms', async () => {
  const f = await fixture();
  await f.command('program-bindings', {
    replaceActive: true,
    bindings: [f.binding(A, '-1'), f.binding(B, '-2')],
  });
  await f.command('program-feed', { roomId: '-1', instanceId: A, feed: f.feed(A, 'sender-a') });
  await f.command('program-feed', { roomId: '-2', instanceId: B, feed: f.feed(B, 'sender-b') });
  await f.command('program-feed', { roomId: '-1', instanceId: A, feed: f.feed(A, 'sender-a') });
  assert.equal(f.client.mockData.messages['-1'].length, 1);
  assert.equal(f.client.mockData.messages['-2'].length, 1);
  assert.equal(f.client.mockData.shiyeRooms['-1'].title, '-1');
  assert.notEqual(
    f.client.mockData.messages['-1'][0].fromId.userId,
    f.client.mockData.messages['-2'][0].fromId.userId,
  );
  await assert.rejects(
    f.command('program-feed', { roomId: '-1', instanceId: A, feed: f.feed(B, 'wrong') }),
    /实例/,
  );
  assert.equal(f.client.mockData.messages['-1'][0].message, 'sender-a');
});

test('quoted detached history retains its instance while default replies follow current service', async () => {
  const f = await fixture();
  await f.command('program-bindings', { bindings: [f.binding(A, '-1')] });
  await f.command('program-feed', { roomId: '-1', instanceId: A, feed: f.feed(A, 'old') });
  const originalId = f.client.mockData.messages['-1'][0].id;
  await f.send('-1', 'old comment');
  await f.command('program-bindings', { replaceActive: true, bindings: [f.binding(C, '-1')] });
  await f.command('program-feed', { roomId: '-1', instanceId: C, feed: f.feed(C, 'new') });
  await f.send('-1', 'reply to old', originalId);
  await f.send('-1', 'reply to new');
  const comments = f.client.mockData.messages['-1'].filter((m) => m.shiyeComment);
  assert.deepEqual(
    comments.map((m) => m.shiyeComment.instanceId),
    [A, A, C],
  );
  assert.equal(f.client.mockData.shiyeRevisitComments[comments[1].id].instanceId, A);
  await f.command('program-feed', {
    roomId: '-1',
    instanceId: A,
    historical: true,
    feed: f.feed(A, 'must not append', 'unreceived'),
  });
  assert.equal(
    f.client.mockData.messages['-1'].filter((m) => m.shiyeProgram?.instanceId === A).length,
    1,
  );
  const hidden = f.feed(A, 'hidden');
  hidden.deliveries[0].source.available = false;
  await f.command('program-feed', { roomId: '-1', instanceId: A, historical: true, feed: hidden });
  assert.equal(f.client.mockData.messages['-1'][0].shiyeProgram.available, false);
  assert.equal(
    f.client.mockData.messages['-1'].find((m) => m.shiyeProgram?.instanceId === C).message,
    'new',
  );
});

test('feed persistence rebases on concurrent authored send, and scoped ACK does not acknowledge another instance', async () => {
  const f = await fixture();
  await f.command('program-bindings', { bindings: [f.binding(A, '-1'), f.binding(B, '-2')] });
  const receive = f.command('program-feed', {
    roomId: '-1',
    instanceId: A,
    feed: f.feed(A, 'source'),
  });
  await f.send('-3', 'concurrent ordinary send');
  await receive;
  assert.equal(f.client.mockData.messages['-3'][0].message, 'concurrent ordinary send');
  await f.send('-1', 'comment');
  const comment = f.client.mockData.messages['-1'].find((m) => m.shiyeComment);
  await f.command('program-ack', {
    roomId: '-2',
    instanceId: B,
    operationId: comment.shiyeComment.operationId,
  });
  assert.equal(comment.shiyeComment.acknowledged, undefined);
  await f.command('program-ack', {
    roomId: '-1',
    instanceId: A,
    operationId: comment.shiyeComment.operationId,
  });
  assert.equal(
    f.client.mockData.messages['-1'].find((m) => m.id === comment.id).shiyeComment.acknowledged,
    true,
  );
  const persisted = await f.worker.loadLocalPreview({});
  assert.equal(persisted.messages['-3'][0].message, 'concurrent ordinary send');
});
