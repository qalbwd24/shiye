import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createLibraryStore } from '../src/server/storage/library-store.mjs';
import {
  appendChatMessages,
  chatMessageReceipt,
  saveChatRoom,
  withdrawChatMessage,
} from '../src/server/domain/chat-journal.mjs';
import {
  commitLocalMessageEdit,
  commitLocalMessageWithdrawal,
  describeLocalMessageEdit,
} from '../src/server/domain/local-message-edits.mjs';

const now = Date.parse('2026-10-18T12:00:00.000Z');
const sentAt = '2026-10-10T00:00:00.000Z';
async function fixture(t, { canonical = true, actor, owned = false } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shiye-local-edits-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let store = await createLibraryStore({ dataDir: dir, seed: false, sharedSync: true });
  const sourceId = randomUUID(),
    roomId = '-1',
    rootMessageId = '1';
  const scope = { sourceId, roomId, rootMessageId };
  const context = {
    sourceId,
    roomId,
    actor: { kind: 'self', id: 'self' },
    deviceId: 'device-a',
    now,
    ...(owned ? { conversationWriter: true } : {}),
  };
  await store.mutate((db) => {
    saveChatRoom(db, { sourceId, id: roomId, title: '合成隔离房', category: '日常', idleHours: 5 });
    if (owned) db.chatJournal.rooms[0].messageOwner = 'conversation-services-v1';
    appendChatMessages(
      db,
      {
        sourceId,
        roomId,
        messages: [
          { id: '2', sentAt, text: '引用邻居', attachments: [] },
          { id: '1', sentAt, text: '原始正文', attachments: [], replyTo: '2' },
        ],
      },
      now,
      { messageUnitsEnabled: canonical, ...(actor ? { actor } : {}), conversationWriter: owned },
    );
    db.testReferences = [{ targetMessageId: '1', quoteMessageId: '1' }];
  });
  const describe = () => describeLocalMessageEdit(store.getDb(), scope, context);
  const edit = (
    base = describe().base,
    physicalMs = now - 1000,
    deviceId = 'device-a',
    text = '新正文',
  ) => {
    const operationId = randomUUID();
    return {
      ...scope,
      operationId,
      base: structuredClone(base),
      editedAt: new Date(physicalMs).toISOString(),
      stamp: { physicalMs, logical: 0, deviceId, operationId },
      message: { text, attachments: [] },
    };
  };
  const ctx = (input) => ({
    ...context,
    operationId: input.operationId,
    deviceId: input.stamp?.deviceId || context.deviceId,
  });
  const commit = (input) => commitLocalMessageEdit(store, input, ctx(input));
  const withdraw = (base = describe().base) => ({
    ...scope,
    operationId: randomUUID(),
    base: structuredClone(base),
  });
  const messages = () => store.getDb().entries.flatMap((e) => e.chatJournal?.messages || []);
  return {
    dir,
    scope,
    context,
    describe,
    edit,
    ctx,
    commit,
    withdraw,
    messages,
    get store() {
      return store;
    },
    async reopen() {
      store = await createLibraryStore({ dataDir: dir, seed: false, sharedSync: true });
    },
  };
}

test('actual owner store replaces at original time and position, preserves references and reopens body-free ledger', async (t) => {
  const f = await fixture(t),
    before = structuredClone(f.store.getDb()),
    input = f.edit();
  const result = await f.commit(input);
  assert.equal(result.outcome, 'applied');
  const rows = f.messages(),
    root = rows.find((m) => m.id === '1'),
    head = rows.find((m) => m.id === result.headMessageId);
  assert.equal(root.text, '');
  assert.deepEqual(root.attachments, []);
  assert.equal(root.withdrawn, true);
  assert.equal(head.sentAt, sentAt);
  assert.equal(head.replyTo, '2');
  assert.equal(head.replacementOf, '1');
  assert.equal(head.replacementRootId, '1');
  assert.equal(rows.indexOf(head), rows.indexOf(root) + 1);
  assert.deepEqual(f.store.getDb().testReferences, before.testReferences);
  assert.deepEqual(
    rows.find((m) => m.id === '2'),
    before.entries[0].chatJournal.messages.find((m) => m.id === '2'),
  );
  const ledger = JSON.stringify(f.store.getDb()._messageEdits);
  for (const secret of ['原始正文', '新正文', 'attachments', 'replyTo'])
    assert.equal(ledger.includes(secret), false);
  await f.reopen();
  assert.equal(f.describe().base.headMessageId, result.headMessageId);
  assert.equal((await f.commit(input)).replayed, true);
  assert.equal(f.messages().filter((m) => !m.withdrawn && m.id !== '2').length, 1);
});

test('concurrent known initial base converges by registered HLC independent of arrival order', async (t) => {
  for (const latestFirst of [false, true]) {
    const f = await fixture(t),
      base = f.describe().base;
    const older = f.edit(base, now - 2000, 'device-z', '旧败版'),
      newer = f.edit(base, now - 1000, 'device-a', '新胜版');
    const results = await Promise.all(
      (latestFirst ? [newer, older] : [older, newer]).map(f.commit),
    );
    assert.equal(f.messages().filter((m) => !m.withdrawn && m.id !== '2')[0].text, '新胜版');
    if (latestFirst) assert.equal(results[1].outcome, 'superseded');
    assert.equal(JSON.stringify(f.store.getDb()._messageEdits).includes('旧败版'), false);
  }
});

test('exact current-base clock regression conflicts, known ancestor concurrency remains valid and HLC rollback wall time is retained', async (t) => {
  const f = await fixture(t),
    initial = f.describe().base;
  await f.commit(f.edit(initial));
  const sameHead = f.edit(f.describe().base, now - 2000),
    db = structuredClone(f.store.getDb());
  await assert.rejects(f.commit(sameHead), { code: 'LOCAL_MESSAGE_EDIT_CLOCK_REGRESSION' });
  assert.deepEqual(f.store.getDb(), db);
  const successor = f.edit(f.describe().base, now - 1000);
  successor.stamp.logical = 1;
  successor.editedAt = new Date(now - 5000).toISOString();
  await f.commit(successor);
  assert.equal(f.describe().editedAt, successor.editedAt);
  assert.equal((await f.commit(f.edit(initial, now - 3000))).outcome, 'superseded');
});

test('unknown base, spoofed creator/revision, unknown fields and cross-root op reuse are rejected without partial changes', async (t) => {
  const f = await fixture(t),
    initial = f.describe().base;
  for (const patch of [
    { headRevision: 999 },
    { editOperationId: randomUUID() },
    { headSha256: 'a'.repeat(64) },
  ]) {
    const input = f.edit({ ...initial, ...patch }),
      db = structuredClone(f.store.getDb());
    await assert.rejects(f.commit(input), { code: 'LOCAL_MESSAGE_EDIT_BASE_UNKNOWN' });
    assert.deepEqual(f.store.getDb(), db);
  }
  const input = f.edit();
  await f.commit(input);
  await assert.rejects(f.commit({ ...input, message: { text: '碰撞内容', attachments: [] } }), {
    code: 'LOCAL_MESSAGE_EDIT_OPERATION_COLLISION',
  });
  await assert.rejects(f.commit({ ...input, rootMessageId: '2' }), {
    code: 'LOCAL_MESSAGE_EDIT_OPERATION_COLLISION',
  });
  await assert.rejects(f.commit({ ...f.edit(), parentOpId: input.operationId }), { status: 400 });
});

test('authenticated owner scope and outer command identity cannot be replaced by a wire device label', async (t) => {
  const f = await fixture(t, { owned: true }),
    input = f.edit(),
    before = structuredClone(f.store.getDb());
  for (const patch of [
    { operationId: randomUUID() },
    { deviceId: 'forged' },
    { sourceId: randomUUID() },
    { roomId: '-2' },
    { actor: { kind: 'program', id: 'self' } },
    { conversationWriter: false },
  ])
    await assert.rejects(commitLocalMessageEdit(f.store, input, { ...f.ctx(input), ...patch }));
  assert.deepEqual(f.store.getDb(), before);
  assert.equal((await f.commit(input)).outcome, 'applied');
});

test('legacy no-stamp exact base initializes, program actors and quote rewrites cannot self-edit', async (t) => {
  const f = await fixture(t, { canonical: false });
  assert.equal(f.describe().base.headRevision, null);
  const wrongQuote = f.edit();
  wrongQuote.message.replyTo = '9';
  await assert.rejects(f.commit(wrongQuote), { code: 'LOCAL_MESSAGE_EDIT_QUOTE_CHANGED' });
  await f.commit(f.edit());
  assert.equal(f.describe().base.headRevision, 1);
  const program = await fixture(t, { actor: { kind: 'program', id: randomUUID() } });
  assert.throws(program.describe, { code: 'LOCAL_MESSAGE_EDIT_CHAIN_UNKNOWN' });
});

test('explicit root withdrawal is terminal for late edits and replay, with no old bodies in ledger or canonical units', async (t) => {
  const f = await fixture(t),
    initial = f.describe().base,
    input = f.edit();
  await f.commit(input);
  const withdrawal = f.withdraw(initial);
  const result = await commitLocalMessageWithdrawal(f.store, withdrawal, f.ctx(withdrawal));
  assert.equal(result.state, 'withdrawn');
  assert.equal(result.base, null);
  assert.equal(
    (await f.commit(f.edit(initial, now - 500, 'device-b', '迟到正文'))).state,
    'withdrawn',
  );
  assert.equal((await f.commit(input)).state, 'withdrawn');
  assert.equal(
    (await commitLocalMessageWithdrawal(f.store, withdrawal, f.ctx(withdrawal))).replayed,
    true,
  );
  assert.equal(f.messages().filter((m) => m.id !== '2' && !m.withdrawn).length, 0);
  assert.equal(
    f.store
      .getDb()
      .messageStore.units.filter((u) => u.origin.messageId !== '2')
      .every((u) => u.body === null && !u.attachments.length),
    true,
  );
  await f.reopen();
  assert.equal(f.describe().state, 'withdrawn');
  await assert.rejects(f.commit(f.edit({ ...initial, headSha256: '0'.repeat(64) })), {
    code: 'LOCAL_MESSAGE_EDIT_BASE_UNKNOWN',
  });
});

test('old root withdrawal alias does not delete newer head; external current-head withdrawal only marks unknown-stale', async (t) => {
  const f = await fixture(t);
  await f.commit(f.edit());
  const current = f.describe().base;
  await f.store.mutate((db) =>
    withdrawChatMessage(db, { ...f.scope, messageId: '1', operationId: randomUUID() }, now),
  );
  assert.equal(f.describe().base.headMessageId, current.headMessageId);
  await f.store.mutate((db) =>
    withdrawChatMessage(
      db,
      {
        ...f.scope,
        messageId: current.headMessageId,
        expectedRevision: current.headRevision,
        operationId: randomUUID(),
      },
      now,
    ),
  );
  const result = await f.commit(f.edit(current));
  assert.equal(result.accepted, false);
  assert.equal(result.state, 'unknown-stale');
  assert.equal(f.store.getDb()._messageEdits.roots[0].state, 'unknown-stale');
  assert.equal(f.messages().filter((m) => m.id !== '2' && !m.withdrawn).length, 0);
});

test('legacy explicit reedit remains valid but unregistered external head cannot be overwritten by old ledger stamp', async (t) => {
  const f = await fixture(t);
  await f.commit(f.edit());
  const old = f.describe().base;
  await f.store.mutate((db) => {
    withdrawChatMessage(
      db,
      {
        ...f.scope,
        messageId: old.headMessageId,
        expectedRevision: old.headRevision,
        operationId: randomUUID(),
      },
      now,
    );
    appendChatMessages(
      db,
      {
        ...f.scope,
        messages: [
          {
            id: '3',
            sentAt,
            text: '旧界面新后继',
            attachments: [],
            replyTo: '2',
            replacementOf: old.headMessageId,
            replacementRootId: '1',
          },
        ],
      },
      now,
    );
  });
  const result = await f.commit(f.edit(old, now - 10));
  assert.equal(result.code, 'LOCAL_MESSAGE_EDIT_UNKNOWN_STALE');
  assert.equal(f.messages().find((m) => !m.withdrawn && m.id !== '2').text, '旧界面新后继');
  await f.reopen();
  assert.throws(f.describe, { code: 'LOCAL_MESSAGE_EDIT_UNKNOWN_STALE' });
});

test('existing legacy replacement chain initializes only from its exact visible self head', async (t) => {
  const f = await fixture(t, { canonical: false }),
    initial = f.describe().base;
  await f.store.mutate((db) => {
    withdrawChatMessage(db, { ...f.scope, messageId: '1', operationId: randomUUID() }, now);
    appendChatMessages(
      db,
      {
        ...f.scope,
        messages: [
          {
            id: '3',
            sentAt,
            text: '已有legacy后继',
            attachments: [],
            replyTo: '2',
            replacementOf: '1',
            replacementRootId: '1',
          },
        ],
      },
      now,
    );
    db.entries[0].revision += 100; // Entry aggregation revision is not a message edit clock/base.
  });
  await assert.rejects(f.commit(f.edit(initial)), { code: 'LOCAL_MESSAGE_EDIT_BASE_UNKNOWN' });
  const actual = f.describe().base;
  assert.equal(actual.headMessageId, '3');
  const result = await f.commit(f.edit(actual));
  assert.equal(f.messages().find((m) => m.id === result.headMessageId).replacementOf, '3');
  assert.equal(f.messages().find((m) => m.id === result.headMessageId).sentAt, sentAt);
});

test('changed source projection is an external unknown conflict and never overwritten', async (t) => {
  const f = await fixture(t);
  await f.commit(f.edit());
  const base = f.describe().base;
  await f.store.mutate((db) => {
    db.entries[0].content += '<p>独立人工修改</p>';
  });
  const before = f.store.getDb().entries[0].content;
  const result = await f.commit(f.edit(base));
  assert.equal(result.state, 'unknown-stale');
  assert.equal(f.store.getDb().entries[0].content, before);
});

test('actual JSON write failure rolls back withdrawal, replacement, ledger and shared log before retry', async (t) => {
  const f = await fixture(t),
    before = structuredClone(f.store.getDb()),
    input = f.edit();
  const bytes = await fs.readFile(path.join(f.dir, 'diary.json'));
  await fs.mkdir(path.join(f.dir, 'diary.json.tmp'));
  await assert.rejects(f.commit(input));
  assert.deepEqual(f.store.getDb(), before);
  assert.deepEqual(await fs.readFile(path.join(f.dir, 'diary.json')), bytes);
  await fs.rmdir(path.join(f.dir, 'diary.json.tmp'));
  assert.equal((await f.commit(input)).outcome, 'applied');
});

test('same-millisecond concurrent tie is deterministic and a superseded operation is never a registered base', async (t) => {
  const f = await fixture(t),
    initial = f.describe().base;
  const winner = f.edit(initial, now - 1000, 'device-z', '稳定胜者');
  const loser = f.edit(initial, now - 1000, 'device-a', '稳定败者');
  await f.commit(winner);
  assert.equal((await f.commit(loser)).outcome, 'superseded');
  const fabricated = { ...f.describe().base, editOperationId: loser.operationId };
  await assert.rejects(f.commit(f.edit(fabricated, now - 500)), {
    code: 'LOCAL_MESSAGE_EDIT_BASE_UNKNOWN',
  });
  assert.equal(f.messages().find((m) => m.id !== '2' && !m.withdrawn).text, '稳定胜者');
});

test('late replay preserves its historical committed mapping while exposing the newer current head separately', async (t) => {
  const f = await fixture(t),
    initial = f.describe().base;
  const first = f.edit(initial, now - 3000),
    ackA = await f.commit(first);
  const loser = f.edit(initial, now - 4000, 'device-b', '败版');
  const loserAck = await f.commit(loser);
  const next = f.edit(f.describe().base, now - 2000),
    ackB = await f.commit(next);
  for (const [input, original] of [
    [first, ackA],
    [loser, loserAck],
  ]) {
    const replay = await f.commit(input);
    for (const field of ['operationId', 'outcome', 'state', 'version', 'headMessageId', 'base'])
      assert.deepEqual(replay[field], original[field], `stable historical ${field}`);
    assert.equal(replay.currentHead.headMessageId, ackB.headMessageId);
    assert.equal(replay.replayed, true);
  }
  await f.reopen();
  assert.deepEqual((await f.commit(first)).base, ackA.base);
  const withdrawal = f.withdraw();
  await commitLocalMessageWithdrawal(f.store, withdrawal, f.ctx(withdrawal));
  const terminal = await f.commit(first);
  assert.equal(terminal.terminal, true);
  assert.equal(terminal.state, 'withdrawn');
  assert.equal(terminal.base, null);
  assert.equal(terminal.currentHead.base, null);
});

test('first exact-base root withdrawal and source conflict/history purging share the original commit', async (t) => {
  const f = await fixture(t);
  await f.store.mutate((db) => {
    const entry = db.entries[0];
    entry.history = [structuredClone(entry)];
    db.sourceMessageConflicts = {
      version: 1,
      receipts: [],
      records: [
        {
          id: 'a'.repeat(64),
          ...f.scope,
          messageId: '1',
          ownerEntryId: entry.id,
          state: 'pending',
          revision: 1,
          ownerSha256: 'b'.repeat(64),
          sourceSha256: 'c'.repeat(64),
          versions: { owner: { text: '私有冲突正文' }, source: { text: '另一旧版' } },
        },
      ],
    };
  });
  const input = f.withdraw();
  const result = await commitLocalMessageWithdrawal(f.store, input, f.ctx(input));
  assert.equal(result.state, 'withdrawn');
  const db = f.store.getDb();
  assert.equal(db.sourceMessageConflicts.records[0].state, 'redacted');
  assert.equal(db.sourceMessageConflicts.records[0].versions, undefined);
  assert.equal(db.entries[0].history[0].chatJournal.messages.find((m) => m.id === '1').text, '');
  assert.equal(JSON.stringify(db.entries[0]).includes('原始正文'), false);
  assert.equal(JSON.stringify(db._messageEdits).includes('原始正文'), false);
  await f.reopen();
  assert.equal(f.describe().state, 'withdrawn');
});

test('bounded malformed edit is rejected before legacy head withdrawal', async (t) => {
  const f = await fixture(t),
    before = structuredClone(f.store.getDb());
  for (const input of [
    f.edit(undefined, now - 1000, 'device-a', 'x'.repeat(500001)),
    { ...f.edit(), message: { text: '缺原件', attachments: [randomUUID()] } },
    f.edit(undefined, now + 300001),
  ])
    await assert.rejects(f.commit(input), { status: 400 });
  assert.deepEqual(f.store.getDb(), before);
});

test('isolated real HTTP owner fixture serializes concurrent requests, loses ACK safely, and restarts persisted state', async (t) => {
  const f = await fixture(t),
    base = f.describe().base;
  // This narrow harness calls the actual store/domain, not the still-unwired product service.
  const server = http.createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const input = JSON.parse(Buffer.concat(chunks).toString());
      const context = {
        ...f.context,
        operationId: req.headers['x-operation-id'],
        deviceId: req.headers['x-device-id'],
      };
      const result = await commitLocalMessageEdit(f.store, input, context);
      res.writeHead(result.accepted ? 200 : 409, { 'content-type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (error) {
      res.writeHead(error.status || 500);
      res.end(JSON.stringify({ code: error.code || error.message }));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/fixture/local-edit`;
  const post = (input) =>
    fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-operation-id': input.operationId,
        'x-device-id': input.stamp.deviceId,
      },
      body: JSON.stringify(input),
    });
  const older = f.edit(base, now - 2000),
    newer = f.edit(base, now - 1000, 'device-b', 'HTTP胜版');
  const responses = await Promise.all([post(newer), post(older)]);
  assert.equal(
    responses.every((r) => r.status === 200),
    true,
  );
  await f.reopen();
  assert.equal((await (await post(newer)).json()).replayed, true);
  assert.equal(f.messages().filter((m) => !m.withdrawn && m.id !== '2')[0].text, 'HTTP胜版');
  assert.equal(
    (await post({ ...newer, message: { text: '同号不同内容', attachments: [] } })).status,
    409,
  );
  assert.equal(
    chatMessageReceipt(f.store.getDb(), f.scope.sourceId, f.scope.roomId, '1').state,
    'withdrawn',
  );
});
