import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { createDiaryServer } from '../src/server/app.mjs';
import { saveConversationSettings } from '../src/server/conversation-services/settings.mjs';
import { exportSharedSeed } from '../src/server/shared-sync/seed-package.mjs';
import { createSharedBusinessClient } from '../public/shared/shared-business-client.js';
import { createIndexedDbSyncStorage } from '../public/shared/sync-v2-client.js';
import { createSharedSeedImportController } from '../public/shared/shared-seed-import.js';
import { inspectSharedSeedFile } from '../public/shared/shared-seed-import.js';
import { createSharedDiaryClient } from '../public/shared/shared-diary-client.js';
async function fixture(t) {
  const work = path.resolve('tmp/shared-seed-feeds-import', randomUUID()),
    dataDir = path.join(work, 'data'),
    sourceId = randomUUID(),
    roomId = '-1',
    conversationId = `desktop:${sourceId}:${roomId}`,
    commentId = randomUUID(),
    entryId = randomUUID(),
    plainEntryId = randomUUID();
  const db = {
    schema: 1,
    categories: ['日常'],
    tags: [],
    media: [],
    chatJournal: {
      rooms: [{ sourceId, id: roomId, title: 'synthetic room', category: '日常', idleHours: 5 }],
      withdrawals: [],
    },
    entries: [
      {
        id: plainEntryId,
        revision: 1,
        title: 'plain editable',
        content: '<p>plain</p>',
        date: '2026-10-19T00:00:00Z',
        category: '日常',
        tags: [],
        attachments: [],
      },
      {
        id: entryId,
        revision: 1,
        title: 'ordinary',
        content: '<p>ordinary</p>',
        date: '2026-10-19T00:00:00Z',
        category: '日常',
        tags: [],
        attachments: [],
        chatJournal: {
          sourceId,
          roomId,
          messages: [
            { id: '1', sentAt: '2026-10-19T00:00:00Z', text: 'ordinary original', attachments: [] },
          ],
        },
      },
    ],
  };
  const saved = saveConversationSettings(db, {
    conversationId,
    slotId: 'assistant',
    providerId: 'external-program',
    expectedBindingRevision: 0,
    expectedConfigRevision: 0,
    config: {
      enabled: true,
      title: 'synthetic program',
      kind: 'ai',
      sender: { name: 'synthetic program' },
      parameters: {},
    },
  });
  db.conversationServices.instances.find((row) => row.id === saved.instanceId).state.comments = [
    {
      id: commentId,
      operationId: commentId,
      createdAt: '2026-10-19T00:00:01Z',
      state: 'active',
      text: '中'.repeat(190000),
      body: { format: 'shiye-richdoc', version: 1, content: [] },
      commentOn: [],
      targets: [],
      revision: 1,
    },
  ];
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(path.join(dataDir, 'diary.json'), JSON.stringify(db));
  const server = await createDiaryServer({ dataDir, seed: false, sharedSync: true });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });
  const base = 'http://127.0.0.1:' + server.address().port,
    state = { offline: false, hook: null, actions: [] };
  async function http(route, input) {
    const response = await fetch(base + route, {
      method: input === undefined ? 'GET' : 'POST',
      headers: { 'X-Diary-Client': 'desktop', 'Content-Type': 'application/json' },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    });
    const value = await response.json();
    if (!response.ok)
      throw Object.assign(Error(value.error?.code || JSON.stringify(value)), {
        code: value.error?.code,
        status: response.status,
      });
    return value;
  }
  const request = async (action, input) => {
    state.actions.push(action);
    if (state.offline) throw Error('synthetic offline');
    await state.hook?.(action, input);
    return http(
      '/api/shared/v1/' +
        ({ 'entity-read': 'entity/read', 'feed-item-read': 'feed-item/read' }[action] || action),
      action === 'info' ? undefined : input,
    );
  };
  const info = await request('info'),
    file = path.join(work, 'full.syseed');
  const initial = await http('/api/shared/v1/command', {
    ...info,
    operationId: randomUUID(),
    action: 'conversation-feed',
    input: { conversationId, limit: 100 },
  });
  assert.ok(initial.result.messages.some((row) => row.kind === 'comment'));
  await exportSharedSeed({
    file,
    directory: work,
    request,
    openOriginal: () => {
      throw Error('no originals');
    },
  });
  const storage = createIndexedDbSyncStorage({
      indexedDB: new IDBFactory(),
      dbName: 'shiye-sync-v2-feed-' + randomUUID(),
    }),
    client = createSharedBusinessClient({
      storage,
      request,
      libraryId: info.libraryId,
      epoch: info.epoch,
    });
  const controller = createSharedSeedImportController({
    storage,
    client,
    libraryId: info.libraryId,
    epoch: info.epoch,
  });
  t.after(() => storage.close());
  return {
    client,
    controller,
    storage,
    state,
    entryId,
    plainEntryId,
    conversationId,
    blob: new Blob([await fs.readFile(file)]),
    info,
    request,
    withdraw: () =>
      http('/api/conversation-services/conversations/withdraw', {
        conversationId,
        kind: 'comment',
        instanceId: saved.instanceId,
        operationId: commentId,
      }),
  };
}
test('v2 offline program/comment projections stay quarantined; legacy-only withdrawal at unchanged seq is scrubbed before same-IDB publish', async (t) => {
  const f = await fixture(t);
  await f.client.setDraft('existing', { text: 'keep', replyId: null });
  f.state.offline = true;
  const staged = await f.controller.importFile(f.blob, { resolve: false });
  assert.equal(staged.status, 'quarantined');
  assert.equal(await f.client.readInbox(f.conversationId), null);
  assert.equal(await f.client.read('entry', f.entryId), undefined);
  assert.ok(
    (await f.storage.transaction((tx) => tx.listEntities('local-seed-feed-row'))).some(
      (row) => row.message.kind === 'comment',
    ),
  );
  f.state.offline = false;
  await f.withdraw();
  assert.equal((await f.request('info')).seq, f.info.seq);
  const result = await f.controller.resume(staged.packageId);
  assert.equal(result.status, 'imported');
  const inbox = await f.client.readInbox(f.conversationId),
    comment = inbox.messages.find((row) => row.kind === 'comment');
  assert.equal(comment.state, 'withdrawn');
  assert.equal(comment.markdown, '');
  assert.equal(comment.body, null);
  assert.deepEqual(comment.attachments, []);
  assert.ok(inbox.messages.some((row) => row.markdown === 'ordinary original'));
  assert.equal((await f.client.readDraft('existing')).text, 'keep');
  assert.ok((await f.client.read('entry', f.entryId)).local);
});
test('signed first offline feed is readable immediately; reconnect applies legacy redaction before sending a durable offline entry edit', async (t) => {
  const f = await fixture(t),
    summary = await inspectSharedSeedFile(f.blob);
  f.state.offline = true;
  const first = await f.controller.importFile(f.blob, {
    offlineTrust: { explicit: true, keyFingerprintSha256: summary.keyFingerprintSha256 },
  });
  assert.equal(first.feedsPublished, 1);
  assert.equal(
    (await f.client.readInbox(f.conversationId)).messages.find((row) => row.kind === 'comment')
      .state,
    'active',
  );
  const row = await f.client.read('entry', f.plainEntryId);
  await createSharedDiaryClient({ client: f.client }).save(
    f.plainEntryId,
    { title: 'offline durable edit' },
    row.localRevision,
    { sync: false },
  );
  f.state.offline = false;
  await f.withdraw();
  assert.equal((await f.request('info')).seq, f.info.seq);
  let checked = false;
  f.state.hook = async (action, input) => {
    if (action === 'command' && input.action === 'entry-save') {
      checked = true;
      const inbox = await f.client.readInbox(f.conversationId);
      assert.equal(
        inbox.messages.find((row) => row.kind === 'comment').state,
        'withdrawn',
        'authoritative legacy tombstone commits before outbox replay',
      );
    }
  };
  await f.client.sync();
  assert.equal(checked, true);
  assert.equal(
    (await f.client.read('entry', f.plainEntryId)).base.data.title,
    'offline durable edit',
  );
});
test('v2 current comment uses verified large item hydration; reimport refreshes same package without reviving a withdrawn comment', async (t) => {
  const f = await fixture(t),
    first = await f.controller.importFile(f.blob);
  assert.equal(first.status, 'imported');
  const original = (await f.client.readInbox(f.conversationId)).messages.find(
    (row) => row.kind === 'comment',
  );
  assert.equal(original.markdown.length, 190000);
  assert.ok(f.state.actions.includes('feed-item-read'));
  await f.withdraw();
  const replay = await f.controller.importFile(f.blob);
  assert.equal(replay.status, 'imported');
  const comment = (await f.client.readInbox(f.conversationId)).messages.find(
    (row) => row.kind === 'comment',
  );
  assert.equal(comment.state, 'withdrawn');
  assert.equal(comment.body, null);
});
test('v2 generation fence preserves a newer live inbox and rolls back seed entity publication', async (t) => {
  const f = await fixture(t),
    staged = await f.controller.importFile(f.blob, { resolve: false });
  let reached, release;
  const waiting = new Promise((r) => (reached = r)),
    gate = new Promise((r) => (release = r));
  let once = true;
  f.state.hook = async (action, input) => {
    if (once && action === 'command' && input.action === 'conversation-feed') {
      once = false;
      reached();
      await gate;
    }
  };
  const resolving = f.controller.resume(staged.packageId);
  await waiting;
  const ticket = await f.client.beginInbox(f.conversationId);
  await f.client.replaceInbox(ticket, {
    details: { conversationId: f.conversationId },
    messages: [
      {
        id: 'newer-live',
        conversationId: f.conversationId,
        kind: 'message',
        state: 'active',
        markdown: 'keep newer live',
        attachments: [],
      },
    ],
  });
  release();
  await assert.rejects(resolving, { code: 'SHARED_INBOX_SUPERSEDED' });
  assert.equal((await f.client.readInbox(f.conversationId)).messages[0].id, 'newer-live');
  assert.equal(await f.client.read('entry', f.entryId), undefined);
  assert.equal((await f.controller.status(staged.packageId)).status, 'quarantined');
});
test('v2 final legacy feed revision check detects runtime change during fetch even when shared seq stays unchanged', async (t) => {
  const f = await fixture(t),
    staged = await f.controller.importFile(f.blob, { resolve: false });
  let reads = 0;
  f.state.hook = async (action, input) => {
    if (action === 'command' && input.action === 'conversation-feed' && ++reads === 2)
      await f.withdraw();
  };
  await assert.rejects(f.controller.resume(staged.packageId), { code: 'SHARED_FEED_CHANGED' });
  assert.equal(await f.client.readInbox(f.conversationId), null);
  assert.equal(await f.client.read('entry', f.entryId), undefined);
  assert.equal((await f.request('info')).seq, f.info.seq);
});
test('signed older offline reimport preserves known newer comment withdrawal at identical shared watermark and keeps local draft', async (t) => {
  const f = await fixture(t);
  await f.controller.importFile(f.blob);
  await f.withdraw();
  // Online refresh learns the legacy-only tombstone without any shared seq advance.
  const staged = await f.controller.importFile(f.blob);
  assert.equal(staged.status, 'imported');
  assert.equal((await f.request('info')).seq, f.info.seq);
  const before = await f.client.readInbox(f.conversationId);
  assert.equal(before.messages.find((row) => row.kind === 'comment').state, 'withdrawn');
  await f.client.setDraft('existing', { text: 'keep local draft', replyId: null });
  const { inspectSharedSeedFile } = await import('../public/shared/shared-seed-import.js'),
    summary = await inspectSharedSeedFile(f.blob);
  f.state.offline = true;
  const result = await f.controller.importFile(f.blob, {
    offlineTrust: { explicit: true, keyFingerprintSha256: summary.keyFingerprintSha256 },
  });
  assert.equal(result.feedsPublished, 0);
  assert.deepEqual(await f.client.readInbox(f.conversationId), before);
  assert.equal((await f.client.readDraft('existing')).text, 'keep local draft');
});
