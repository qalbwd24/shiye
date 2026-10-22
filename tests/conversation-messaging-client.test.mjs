import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createConversationMessagingClient } from '../previews/telegram-chat/shiye-conversation-messaging.js';
import {
  describeConversation,
  saveConversation,
  readConversationFeed,
  conversationContext,
  sendConversationMessage,
  withdrawConversationMessage,
} from '../src/server/conversation-services/conversations.mjs';
import { saveConversationSettings } from '../src/server/conversation-services/settings.mjs';
import { commentLibrary } from './helpers/revisit-comment-fixtures.mjs';

function fixture(room = '-101') {
  const db = commentLibrary().db;
  const id = `desktop:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:${room}`;
  const storage = new Map(),
    queues = new Map(),
    calls = [];
  let localOwner = true,
    enabled = true,
    failCommit = false,
    loseSend = false;
  saveConversation(db, {
    conversationId: id,
    expectedRevision: 0,
    mode: 'group',
    title: '隔离会话',
    selfName: '我',
    category: db.categories[0],
    idleHours: 5,
    messageOwner: 'conversation-services-v1',
  });
  const actions = {
    'conversation-state': describeConversation,
    'conversation-feed': readConversationFeed,
    'conversation-context': conversationContext,
    'conversation-send': sendConversationMessage,
    'conversation-withdraw': withdrawConversationMessage,
  };
  const request = async (action, payload) => {
    calls.push({ action, payload: structuredClone(payload) });
    const result = actions[action](db, payload);
    if (loseSend && action === 'conversation-send') {
      loseSend = false;
      throw Error('lost receipt');
    }
    return result;
  };
  const options = {
    conversationId: id,
    request,
    capabilities: async () => ({
      conversationServices: { conversationMessaging: enabled ? 1 : 0 },
    }),
    isWriteOwner: async () => localOwner,
    store: {
      read: async (key) => structuredClone(storage.get(key)),
      transact: async (key, apply) => {
        const next = structuredClone(storage.get(key) || {});
        apply(next);
        if (failCommit) {
          failCommit = false;
          throw Error('synthetic storage failure');
        }
        storage.set(key, next);
      },
    },
    withLock: (key, action) => {
      const run = (queues.get(key) || Promise.resolve()).catch(() => {}).then(action);
      queues.set(key, run);
      return run;
    },
    now: () => new Date().toISOString(),
  };
  return {
    id,
    db,
    calls,
    options,
    make: () => createConversationMessagingClient(options),
    loseSend: () => {
      loseSend = true;
    },
    failCommit: () => {
      failCommit = true;
    },
    owner: (value) => {
      localOwner = value;
    },
    capability: (value) => {
      enabled = value;
    },
  };
}

test('durable local enqueue uses no network; receipt loss retries one canonical message across windows', async () => {
  const f = fixture(),
    a = f.make(),
    b = f.make();
  const queued = await a.enqueue({ text: 'ordinary', attachments: [f.db.media[0].id] });
  assert.equal(f.calls.length, 0);
  f.loseSend();
  await assert.rejects(a.flush(), /lost receipt/);
  assert.equal((await a.read()).outbox.length, 1);
  await Promise.all([a.flush(), b.flush()]);
  assert.equal((await a.read()).outbox.length, 0);
  await a.sync();
  assert.equal(Object.keys((await a.read()).messages).length, 1);
  assert.equal((await a.read()).receipts[queued.operationId].value.kind, 'message');
  const sends = f.calls.filter((call) => call.action === 'conversation-send');
  assert.equal(sends.length, 2);
  assert.deepEqual(sends[0].payload, sends[1].payload);
});

test('cursor and messages commit atomically; replay after storage failure dedupes', async () => {
  const f = fixture(),
    c = f.make();
  await c.enqueue({ text: 'one' });
  await c.flush();
  f.failCommit();
  await assert.rejects(c.sync(), /storage failure/);
  assert.deepEqual((await c.read()).cursor, {});
  assert.equal(Object.keys((await c.read()).messages).length, 0);
  await c.sync();
  await c.sync({ revalidate: true });
  assert.equal(Object.keys((await c.read()).messages).length, 1);
  assert.equal((await c.read()).cursor.positions.messages, 1);
});

test('queued withdrawal follows pending send and tombstone defeats a late active replay', async () => {
  const f = fixture(),
    c = f.make();
  const sent = await c.enqueue({
    text: 'to remove',
    sentAt: new Date(Date.now() + 60000).toISOString(),
  });
  await c.enqueueWithdrawal({ kind: 'message', sendOperationId: sent.operationId });
  await c.flush();
  await c.sync();
  const state = await c.read(),
    message = Object.values(state.messages)[0];
  assert.equal(message.state, 'withdrawn');
  assert.equal(message.markdown, '');
  assert.equal(JSON.stringify(state.receipts).includes('to remove'), false);
  const late = createConversationMessagingClient({
    ...f.options,
    request: async () => ({
      version: 1,
      conversationId: f.id,
      messages: [{ ...message, state: 'active', markdown: 'must stay removed' }],
      redactions: [],
      participants: [],
      next: { conversationId: f.id, positions: { messages: 1 } },
      hasMore: false,
    }),
  });
  await late.sync({ revalidate: true });
  assert.equal(Object.values((await late.read()).messages)[0].markdown, '');
});

test('legacy history target is frozen through context and program-authored comment withdraws in same scope', async () => {
  const f = fixture('-900000001'),
    c = f.make();
  const program = saveConversationSettings(f.db, {
    conversationId: f.id,
    slotId: 'assistant',
    providerId: 'external-program',
    expectedBindingRevision: 0,
    expectedConfigRevision: 0,
    config: {
      enabled: true,
      title: '外部执行器',
      sender: { name: '助手' },
      kind: 'ai',
      parameters: {},
    },
  });
  const delivery = f.db.revisit.deliveries[0];
  await c.freezeTarget('draft', {
    instanceId: 'legacy-revisit',
    batchId: delivery.batchId,
    deliveryId: delivery.id,
  });
  const actorId = `program:${program.instanceId}`;
  const sent = await c.enqueue({
    kind: 'comment',
    actorId,
    text: 'fixed comment',
    draftId: 'draft',
  });
  // A later draft selection does not alter the already queued command.
  await c.freezeTarget(
    'draft',
    { instanceId: 'legacy-revisit', batchId: delivery.batchId },
    { quoted: false },
  );
  await c.flush();
  const request = f.calls.find((call) => call.action === 'conversation-send');
  assert.equal(request.payload.reply.deliveryId, delivery.id);
  assert.equal(request.payload.displayedTarget, undefined);
  await c.enqueueWithdrawal({
    kind: 'comment',
    actorId,
    instanceId: 'legacy-revisit',
    operationId: sent.operationId,
  });
  await c.flush();
  await c.sync();
  const message = Object.values((await c.read()).messages).find((item) => item.kind === 'comment');
  assert.equal(message.actor.id, actorId);
  assert.equal(message.state, 'withdrawn');
  assert.equal(message.markdown, '');
});

test('foreign cursor response is rejected before storing, and no capability or ownership auto-migration occurs', async () => {
  const f = fixture(),
    c = f.make();
  f.owner(false);
  await assert.rejects(c.enqueue({ text: 'must not queue' }), /第二写口/);
  assert.equal(f.calls.length, 0);
  f.owner(true);
  f.capability(false);
  await assert.rejects(c.enqueue({ text: 'must not queue' }), /尚未提供/);
  f.capability(true);
  const bad = createConversationMessagingClient({
    ...f.options,
    request: async () => ({
      conversationId: f.id,
      messages: [],
      redactions: [],
      next: { conversationId: f.id + '2', positions: {} },
      hasMore: false,
    }),
  });
  await assert.rejects(bad.sync(), /其他会话/);
  assert.deepEqual((await c.read()).cursor, {});
});

test('a failed early send blocks later pending messages without replacing operation identity', async () => {
  const f = fixture(),
    c = f.make();
  const operationId = randomUUID();
  await c.enqueue({ text: 'first', operationId });
  await assert.rejects(c.enqueue({ text: 'different', operationId }), /不能更换/);
  await c.enqueue({ text: 'second' });
  const failing = createConversationMessagingClient({
    ...f.options,
    request: async (action, payload) => {
      if (action === 'conversation-send') throw Object.assign(Error('conflict'), { status: 409 });
      return f.options.request(action, payload);
    },
  });
  await assert.rejects(failing.flush(), { status: 409 });
  const pending = (await c.read()).outbox;
  assert.equal(pending.length, 2);
  assert.equal(pending[0].id, operationId);
  assert.equal(pending[0].error.status, 409);
  assert.equal(pending[1].error, undefined);
});

test('access lock clears cached bodies but preserves pending operations and forces full revalidation', async () => {
  const f = fixture(),
    c = f.make();
  await c.enqueue({ text: 'cached body' });
  await c.flush();
  await c.sync();
  const waiting = await c.enqueue({ text: 'offline draft' });
  const locked = createConversationMessagingClient({
    ...f.options,
    request: async () => {
      throw Object.assign(Error('locked'), { status: 401 });
    },
  });
  await assert.rejects(locked.sync(), { status: 401 });
  const state = await c.read();
  assert.equal(Object.values(state.messages)[0].markdown, '');
  assert.equal(state.outbox[0].id, waiting.operationId);
  assert.equal(state.needsRevalidation, true);
  await c.sync();
  assert.equal(Object.values((await c.read()).messages)[0].markdown, 'cached body');
  assert.equal((await c.read()).needsRevalidation, false);
  assert.deepEqual(
    f.calls.filter((call) => call.action === 'conversation-feed').at(-1).payload.after,
    {},
  );
});
