import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { IDBFactory } from 'fake-indexeddb';
import { createSharedBusinessClient } from '../public/shared/shared-business-client.js';
import { createIndexedDbSyncStorage } from '../public/shared/sync-v2-client.js';
import { createSharedChatSource } from '../public/shared/shared-chat-source.js';
import { compareEditStamps } from '../public/shared/shared-edit-clock.js';
import { prepareSharedSeed } from '../public/shared/shared-seed.js';
import { createSharedRuntime } from '../android/qq-chat/shared-runtime.js';
import { sharedMessageEditUnitId } from '../public/shared/shared-message-edit-protocol.js';

let project = path.dirname(fileURLToPath(import.meta.url));
while (project !== path.dirname(project)) {
  try {
    await fs.access(
      path.join(
        project,
        'outputs/backend-runtimes/20261019-message-edits-1792447465520/runtime-manifest.json',
      ),
    );
    break;
  } catch {
    project = path.dirname(project);
  }
}
const backendRoot = path.join(
  project,
  'outputs/backend-runtimes/20261019-message-edits-1792447465520',
);
assert.equal(
  createHash('sha256')
    .update(await fs.readFile(path.join(backendRoot, 'runtime-manifest.json')))
    .digest('hex'),
  '786abbd316a79058b1c4334da7bde60c772579cf197ab72c8c7c4b6eeed5c84d',
);
const backend = (file) => import(pathToFileURL(path.join(backendRoot, file)).href);
const { createDiaryServer } = await backend('src/server/app.mjs');
const { createLibraryStore } = await backend('src/server/storage/library-store.mjs');
const { appendChatMessages, saveChatRoom } = await backend('src/server/domain/chat-journal.mjs');
const { exportSharedSeed } = await backend('src/server/shared-sync/seed-package.mjs');
const { verifySharedSeedAttestation } = await backend('public/shared/shared-seed-trust.js');
const sentAt = '2026-10-10T00:00:00.000Z';

async function fixture(t, { media = false, paired = false, diaryIndex = false } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shiye-message-client-'));
  const dataDir = path.join(dir, 'data'),
    sourceId = randomUUID(),
    roomId = '-1',
    rootMessageId = '1';
  const conversationId = `desktop:${sourceId}:${roomId}`,
    scope = { sourceId, roomId, rootMessageId };
  const store = await createLibraryStore({ dataDir, seed: false }),
    assetId = randomUUID();
  if (media) await fs.writeFile(path.join(dataDir, 'media', assetId), 'synthetic-original');
  await store.mutate((db) => {
    if (media)
      db.media.push({
        id: assetId,
        type: 'application/octet-stream',
        mime: 'application/octet-stream',
        name: 'original.dat',
        size: 18,
        sha256: createHash('sha256').update('synthetic-original').digest('hex'),
      });
    saveChatRoom(db, {
      sourceId,
      id: roomId,
      title: '合成本机原子编辑',
      category: '日常',
      idleHours: 5,
    });
    appendChatMessages(
      db,
      {
        sourceId,
        roomId,
        messages: [
          { id: '1', sentAt, text: 'original-private', attachments: media ? [assetId] : [] },
          { id: '2', sentAt, text: 'neighbour-unchanged', attachments: [] },
        ],
      },
      Date.now(),
      { messageUnitsEnabled: true },
    );
  });
  let server,
    url,
    device,
    offline = false,
    editWrites = true,
    loseAck = null;
  const calls = [],
    indexedDB = new IDBFactory(),
    dbName = 'shiye-sync-v2-shared-message-' + randomUUID(),
    storages = [];
  let wall = Date.now();
  async function open() {
    server = await createDiaryServer({
      dataDir,
      seed: false,
      sharedSync: true,
      messageUnits: true,
      sharedRemote: paired ? { enabled: true, allowedHosts: ['127.0.0.1'] } : false,
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${server.address().port}`;
  }
  async function close() {
    if (server?.listening) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  }
  async function raw(
    route,
    input,
    { method = input === undefined ? 'GET' : 'POST', auth = true, headers = {} } = {},
  ) {
    const response = await fetch(url + route, {
      method,
      headers: {
        'X-Diary-Client': 'desktop',
        'content-type': 'application/json',
        ...(device && auth
          ? { Authorization: `Bearer ${device.token}`, 'X-Sync-Device-Id': device.deviceId }
          : {}),
        ...headers,
      },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    });
    const value = await response.json();
    if (!response.ok)
      throw Object.assign(new Error(value.error?.code), {
        code: value.error?.code,
        status: response.status,
      });
    return value;
  }
  async function pair() {
    const code = await raw(
      '/api/shared/v1/auth/local-pairing',
      {},
      { auth: false, headers: { 'X-Sync-Client': 'local-admin' } },
    );
    device = await raw(
      '/api/shared/v1/auth/pair',
      { code: code.code, deviceName: 'isolated local client' },
      { auth: false },
    );
  }
  await open();
  if (paired) await pair();
  const info = await raw('/api/shared/v1/info');
  const request = async (action, input) => {
    calls.push({ action, input: structuredClone(input) });
    if (offline) throw Error('offline');
    const result = await raw(
      '/api/shared/v1/' + (action === 'entity-read' ? 'entity/read' : action),
      action === 'info' ? undefined : input,
    );
    if (action === 'info' && !editWrites) delete result.capabilities.messageEdits;
    if (action === 'command' && loseAck === input.operationId) {
      loseAck = null;
      throw Error('lost-ack');
    }
    return result;
  };
  const connect = ({ abort = () => false } = {}) => {
    const storage = createIndexedDbSyncStorage({ indexedDB, dbName, diaryIndex });
    storages.push(storage);
    const guarded = {
      transaction: (fn) =>
        storage.transaction(async (tx) => {
          const result = await fn(tx);
          if (abort()) throw Error('injected-transaction-abort');
          return result;
        }),
    };
    const client = createSharedBusinessClient({
      storage: guarded,
      request,
      libraryId: info.libraryId,
      epoch: info.epoch,
      messageEditClock: { now: () => wall },
    });
    return {
      client,
      storage,
      source: createSharedChatSource({
        client,
        currentRoom: () => ({ conversationId, sourceId, legacyRoomId: roomId }),
        autoSync: false,
      }),
    };
  };
  const first = connect();
  t.after(async () => {
    for (const s of storages) await s.close();
    await close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const input = (text, operationId = randomUUID()) => ({
    conversationId,
    messageId: '1',
    operationId,
    text,
  });
  const wireCommand = (action, input, operationId = input.operationId || randomUUID()) =>
    raw('/api/shared/v1/command', {
      libraryId: info.libraryId,
      epoch: info.epoch,
      action,
      input,
      operationId,
    });
  return {
    ...first,
    dir,
    scope,
    conversationId,
    sourceId,
    roomId,
    assetId,
    info,
    calls,
    connect,
    input,
    raw,
    request,
    wireCommand,
    offline: (value) => {
      offline = value;
    },
    editWrites: (value) => {
      editWrites = value;
    },
    rollbackClock: () => {
      wall -= 5000;
    },
    loseAck: (op) => {
      loseAck = op;
    },
    restart: async () => {
      await close();
      await open();
      if (paired) await pair();
    },
    readServer: () => fs.readFile(path.join(dataDir, 'diary.json')).then(JSON.parse),
    exportSeed: async () => {
      const work = path.join(dir, 'work');
      await fs.mkdir(work, { recursive: true });
      const file = path.join(dir, `synthetic-${randomUUID()}.syseed`);
      const result = await exportSharedSeed({
        file,
        directory: work,
        request: (action, input) =>
          raw(
            '/api/shared/v1/' + (action === 'entity-read' ? 'entity/read' : action),
            action === 'info' ? undefined : input,
          ),
        openOriginal: () => {
          throw Error('no media in offline seed test');
        },
      });
      const bytes = await fs.readFile(file);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), result.sha256);
      const start = Buffer.byteLength('SHIYE-SEED-V1\n'),
        size = bytes.readUInt32BE(start);
      const manifest = JSON.parse(bytes.subarray(start + 4, start + 4 + size));
      let offset = start + 4 + size;
      const members = new Map(
        manifest.members.map((member) => {
          const data = bytes.subarray(offset, offset + member.size);
          offset += member.size;
          return [member.path, data];
        }),
      );
      assert.equal(offset, bytes.length);
      const prepared = await prepareSharedSeed({
        manifest,
        readMember: async (name, at, length) =>
          new Uint8Array(members.get(name).subarray(at, at + length)),
      });
      return { manifest, prepared, dispose: () => prepared.discard() };
    },
  };
}
const localRows = async (f) =>
  (await f.client.listConversationEntries(f.conversationId))[0].local.data.chatJournal.messages;
const pending = (f) => f.storage.transaction((tx) => tx.listPending());

test('signed seed first import edits entirely offline, preserving sentAt, neighbour, draft and same wire after cold reopen', async (t) => {
  const f = await fixture(t),
    seed = await f.exportSeed();
  t.after(() => seed.dispose());
  const trust = await verifySharedSeedAttestation(seed.manifest);
  f.offline(true);
  await f.client.importSeed(seed.prepared, {
    offlineTrust: { explicit: true, keyFingerprintSha256: trust.keyFingerprintSha256 },
  });
  await f.client.setDraft('unrelated-room', { text: 'keep-independent-draft', replyId: null });
  const calls = f.calls.length,
    op = randomUUID(),
    ack = await f.source.edit('1', 'first-offline-edit', { operationId: op });
  assert.equal(f.calls.length, calls);
  assert.equal(ack.localAck, true);
  const rows = await localRows(f);
  assert.equal(rows.find((m) => m.id === ack.messageId).text, 'first-offline-edit');
  assert.equal(rows.find((m) => m.id === ack.messageId).sentAt, sentAt);
  assert.equal(rows.find((m) => m.id === '2').text, 'neighbour-unchanged');
  const wire = (await pending(f))[0].wire,
    state = await f.client.status();
  await f.storage.close();
  const reopened = f.connect();
  assert.deepEqual((await pending(reopened))[0].wire, wire);
  assert.deepEqual(
    (await reopened.client.editMessage(f.input('first-offline-edit', op))).stamp,
    ack.stamp,
  );
  assert.deepEqual((await reopened.client.status()).messageEditWriter, state.messageEditWriter);
  assert.equal((await reopened.client.readDraft('unrelated-room')).text, 'keep-independent-draft');
  f.offline(false);
  await reopened.client.sync();
  assert.equal((await pending(reopened)).length, 0);
  assert.equal(
    (await f.readServer()).entries[0].chatJournal.messages.find((m) => m.id === ack.messageId).text,
    'first-offline-edit',
  );
});

test('two controllers share one persistent writer/atomic HLC and causal local edits survive clock rollback', async (t) => {
  const f = await fixture(t);
  await f.client.sync();
  f.offline(true);
  const other = f.connect();
  const [a, b] = await Promise.all([
    f.client.editMessage(f.input('window-a')),
    other.client.editMessage(f.input('window-b')),
  ]);
  assert.equal(a.stamp.deviceId, b.stamp.deviceId);
  assert.equal(new Set([a.stamp.logical, b.stamp.logical]).size, 2);
  const last = compareEditStamps(a.stamp, b.stamp) > 0 ? a : b;
  f.rollbackClock();
  const c = await f.client.editMessage(f.input('after-wall-rollback'));
  assert.equal(compareEditStamps(c.stamp, last.stamp), 1);
  assert.equal(c.parentLocalOperationId, last.operationId);
  assert.ok(Date.parse(c.editedAt) < c.stamp.physicalMs);
  const wires = (await pending(f)).map((p) => p.wire);
  assert.equal(
    wires.every((w) => w.input.base.headMessageId === '1'),
    true,
  );
  f.offline(false);
  await f.client.sync();
  assert.equal(
    (await f.readServer()).entries[0].chatJournal.messages.filter(
      (m) => !m.withdrawn && m.id !== '2',
    )[0].text,
    'after-wall-rollback',
  );
});

test('actual IDB abort rolls back clock, optimistic entry, history, media references and outbox together', async (t) => {
  const f = await fixture(t, { media: true });
  await f.client.sync();
  let armed = true;
  const broken = f.connect({ abort: () => armed });
  const before = await f.storage.transaction(async (tx) => ({
    meta: await tx.getMeta(),
    entities: await tx.listEntities(),
    outbox: await tx.listPending(),
  }));
  await assert.rejects(
    broken.client.editMessage(f.input('must-rollback')),
    /injected-transaction-abort/,
  );
  armed = false;
  const after = await f.storage.transaction(async (tx) => ({
    meta: await tx.getMeta(),
    entities: await tx.listEntities(),
    outbox: await tx.listPending(),
  }));
  assert.deepEqual(after, before);
  const ack = await broken.client.editMessage(f.input('media-text-edit'));
  assert.deepEqual((await pending(broken))[0].wire.input.message.attachments, [f.assetId]);
  const rows = await localRows({ ...f, client: broken.client });
  assert.deepEqual(rows.find((m) => m.id === ack.messageId).attachments, [f.assetId]);
});

test('new/unready media is blocked before local commit and does not clear the user draft', async (t) => {
  const f = await fixture(t);
  await f.client.sync();
  await f.client.setDraft(f.conversationId, { text: 'keep-media-draft', replyId: null });
  const before = await f.client.status();
  await assert.rejects(f.source.edit('1', 'new caption', { attachments: [randomUUID()] }), {
    code: 'SHARED_MESSAGE_EDIT_NEW_MEDIA_UNSUPPORTED',
  });
  assert.deepEqual((await f.client.status()).messageEditWriter, before.messageEditWriter);
  assert.equal((await f.client.readDraft(f.conversationId)).text, 'keep-media-draft');
  assert.equal((await pending(f)).length, 0);
});

test('capability preflight blocks before command; explicit retry preserves the same operation wire and stamp', async (t) => {
  const f = await fixture(t);
  await f.client.sync();
  const ack = await f.client.editMessage(f.input('preserve-if-unsupported'));
  const wire = (await pending(f))[0].wire;
  f.editWrites(false);
  await assert.rejects(f.client.sync(), { code: 'SHARED_MESSAGE_EDITS_UNSUPPORTED' });
  assert.equal(
    f.calls.some((c) => c.action === 'command' && c.input.operationId === ack.operationId),
    false,
  );
  assert.deepEqual((await pending(f))[0].wire, wire);
  f.editWrites(true);
  await f.client.retryBlocked({ operationId: ack.operationId, mode: 'retry-unchanged' });
  await f.client.sync();
  const sent = f.calls.find(
    (c) => c.action === 'command' && c.input.operationId === ack.operationId,
  );
  assert.deepEqual(sent.input, wire);
  assert.equal((await pending(f)).length, 0);
});

test('lost ACK and moved server/re-paired credential preserve immutable wire and writer while historical commit remains its own mapping', async (t) => {
  const f = await fixture(t, { paired: true });
  await f.client.sync();
  const first = f.input('a-private'),
    ackA = await f.client.editMessage(first);
  f.loseAck(first.operationId);
  const wire = (await pending(f))[0].wire;
  await assert.rejects(f.client.sync(), /lost-ack/);
  const db = await f.readServer(),
    head = db._messageEdits.roots[0].head;
  const secondOp = randomUUID(),
    secondWire = {
      ...f.scope,
      operationId: secondOp,
      base: {
        headMessageId: head.headMessageId,
        headRevision: head.headRevision,
        headSha256: head.headSha256,
        editOperationId: head.editOperationId,
      },
      editedAt: new Date().toISOString(),
      stamp: {
        physicalMs: ackA.stamp.physicalMs + 1,
        logical: 0,
        deviceId: randomUUID(),
        operationId: secondOp,
      },
      message: { text: 'remote-b-private', attachments: [] },
    };
  const remoteB = await f.wireCommand('message-edit-local', secondWire);
  await f.restart();
  await f.client.resume();
  await f.client.sync();
  const sent = f.calls.filter(
    (c) => c.action === 'command' && c.input.operationId === first.operationId,
  );
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0].input, wire);
  assert.deepEqual(sent[1].input, wire);
  const receipt = (await f.client.status()).commandReceipts.find(
    (r) => r.operationId === first.operationId,
  );
  assert.equal(receipt.result.headMessageId, ackA.messageId);
  assert.equal(receipt.result.currentHead.headMessageId, remoteB.result.headMessageId);
  assert.equal(
    (await localRows(f)).filter((m) => !m.withdrawn && m.id !== '2')[0].text,
    'remote-b-private',
  );
  assert.equal((await f.client.status()).messageEditWriter.deviceId, ackA.stamp.deviceId);
});

test('server root terminal purges pending/private bodies and stale inbox cache without touching independent drafts', async (t) => {
  const f = await fixture(t);
  await f.client.sync();
  const a = await f.client.editMessage(f.input('applied-private'));
  await f.client.sync();
  const b = f.input('pending-private');
  await f.client.editMessage(b);
  await f.client.setDraft('independent', { text: 'keep-independent', replyId: null });
  const ticket = await f.client.beginInbox(f.conversationId);
  const stale = {
    id: sharedMessageEditUnitId(f.sourceId, f.roomId, a.messageId),
    conversationId: f.conversationId,
    entryId: (await f.readServer()).entries[0].id,
    kind: 'message',
    state: 'active',
    order: { lane: 'chat', sequence: a.messageId },
    markdown: 'applied-private',
    body: { private: true },
    attachments: [],
  };
  await f.client.replaceInbox(ticket, {
    details: { conversationId: f.conversationId },
    messages: [stale],
  });
  const current = (await f.readServer())._messageEdits.roots[0].head,
    op = randomUUID();
  await f.wireCommand('message-withdraw-local', {
    ...f.scope,
    operationId: op,
    base: {
      headMessageId: current.headMessageId,
      headRevision: current.headRevision,
      headSha256: current.headSha256,
      editOperationId: current.editOperationId,
    },
  });
  await f.client.sync();
  assert.equal((await pending(f)).length, 0);
  const stored = await f.storage.transaction(async (tx) => ({
    meta: await tx.getMeta(),
    entities: await tx.listEntities(),
    outbox: await tx.listPending(),
  }));
  const oldReceipt = await f.client.readOperation(a.operationId);
  assert.equal(oldReceipt.status, 'terminal');
  assert.equal(oldReceipt.result.base, null);
  for (const text of ['original-private', 'applied-private', 'pending-private'])
    assert.equal(
      JSON.stringify(stored).includes(text),
      false,
      text +
        ' in ' +
        JSON.stringify(
          stored.entities
            .filter((x) => JSON.stringify(x).includes(text))
            .map((x) => [x.entityType, x.entityId]),
        ),
    );
  assert.equal((await f.client.readDraft('independent')).text, 'keep-independent');
  const later = await f.client.beginInbox(f.conversationId);
  await f.client.replaceInbox(later, {
    details: { conversationId: f.conversationId },
    messages: [stale],
  });
  assert.equal((await f.client.readInbox(f.conversationId)).messages[0].markdown, '');
  const retry = await f.client.editMessage(b);
  assert.equal(retry.terminal, true);
  assert.equal((await pending(f)).length, 0);
});

test('explicit local root withdrawal scrubs old queued text immediately while preserving its own body-free durable command', async (t) => {
  const f = await fixture(t);
  await f.client.sync();
  f.offline(true);
  const old = await f.client.editMessage(f.input('queued-private'));
  const ack = await f.source.withdrawRoot('1');
  assert.equal(ack.localAck, true);
  const queue = await pending(f);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].wire.action, 'message-withdraw-local');
  const terminal = await f.client.readOperation(old.operationId);
  assert.equal(terminal.status, 'terminal');
  assert.equal(terminal.serverConfirmed, false);
  const stored = await f.storage.transaction(async (tx) => ({
    entities: await tx.listEntities(),
    meta: await tx.getMeta(),
    queue: await tx.listPending(),
  }));
  assert.equal(JSON.stringify(stored).includes('queued-private'), false);
  assert.equal(JSON.stringify(stored).includes('original-private'), false);
  f.offline(false);
  await f.client.sync();
  assert.equal((await pending(f)).length, 0);
  assert.equal((await f.readServer())._messageEdits.roots[0].state, 'withdrawn');
});

test('stale editor CAS aborts without advancing clock or changing another window committed edit', async (t) => {
  const f = await fixture(t);
  await f.client.sync();
  const entry = (await f.client.listConversationEntries(f.conversationId))[0];
  f.offline(true);
  const second = f.connect();
  await second.client.editMessage({
    ...f.input('committed-window'),
    expectedLocalRevision: entry.localRevision,
  });
  const before = await f.client.status(),
    wires = await pending(f);
  await assert.rejects(
    f.client.editMessage({
      ...f.input('stale-window'),
      expectedLocalRevision: entry.localRevision,
    }),
    { code: 'SHARED_LOCAL_REVISION_CONFLICT' },
  );
  assert.deepEqual((await f.client.status()).messageEditWriter, before.messageEditWriter);
  assert.deepEqual(await pending(f), wires);
  assert.equal(
    (await localRows(f)).some((m) => m.text === 'stale-window'),
    false,
  );
});

test('first empty terminal projection after unstamped baseline scrubs previously cached root without a local edit history', async (t) => {
  const f = await fixture(t);
  await f.client.sync();
  const root = (await localRows(f))[0];
  const stale = {
    id: sharedMessageEditUnitId(f.sourceId, f.roomId, root.id),
    conversationId: f.conversationId,
    kind: 'message',
    state: 'active',
    markdown: root.text,
    attachments: [],
    order: { lane: 'chat', sequence: root.id },
  };
  await f.client.replaceInbox(await f.client.beginInbox(f.conversationId), {
    details: { conversationId: f.conversationId },
    messages: [stale],
  });
  const operationId = randomUUID();
  await f.wireCommand('message-withdraw-local', { ...f.scope, operationId, base: root.editBase });
  await f.client.receive();
  const all = await f.storage.transaction((tx) => tx.listEntities());
  assert.equal(JSON.stringify(all).includes('original-private'), false);
  assert.equal((await f.client.readInbox(f.conversationId)).messages[0].state, 'withdrawn');
  assert.equal((await pending(f)).length, 0);
});

test('unified source overlays edited journal head in its canonical slot while neighbour stays unchanged', async (t) => {
  const f = await fixture(t);
  await f.client.sync();
  const rows = (await localRows(f)).map((m) => ({
    id: sharedMessageEditUnitId(f.sourceId, f.roomId, m.id),
    conversationId: f.conversationId,
    kind: 'message',
    state: 'active',
    markdown: m.text,
    attachments: m.attachments,
    sentAt: m.sentAt,
    order: { lane: 'chat', sequence: m.id },
  }));
  await f.client.replaceInbox(await f.client.beginInbox(f.conversationId), {
    details: { conversationId: f.conversationId, messageOwner: 'unified' },
    messages: rows,
  });
  await f.source.refreshLocal();
  const before = f.source.getSnapshot().messages.find((m) => m.id === rows[1].id);
  f.offline(true);
  const ack = await f.source.edit(rows[0].id, 'unified-offline');
  const current = f.source.getSnapshot().messages;
  assert.equal(current.find((m) => m.id === rows[0].id).kind, 'withdrawn');
  assert.equal(
    current.find((m) => m.id === sharedMessageEditUnitId(f.sourceId, f.roomId, ack.messageId)).text,
    'unified-offline',
  );
  assert.deepEqual(
    current.find((m) => m.id === rows[1].id),
    before,
  );
  assert.ok(
    current.findIndex((m) => m.text === 'unified-offline') <
      current.findIndex((m) => m.id === rows[1].id),
  );
});

test('Android runtime directory create acknowledges locally, reuses ID on retry/reopen and syncs once', async (t) => {
  const f = await fixture(t);
  await f.client.sync();
  const native = (method, input) =>
    f.request(
      {
        sharedInfo: 'info',
        sharedSnapshot: 'snapshot',
        sharedPull: 'pull',
        sharedCommand: 'command',
        sharedEntityRead: 'entity-read',
      }[method],
      input,
    );
  const create = () =>
    createSharedRuntime({
      config: { enabled: true, libraryId: f.info.libraryId, epoch: f.info.epoch },
      storage: f.storage,
      nativeRequest: native,
      currentRoom: () => ({
        conversationId: f.conversationId,
        sourceId: f.sourceId,
        legacyRoomId: f.roomId,
      }),
    });
  f.offline(true);
  let runtime = await create();
  const operationId = randomUUID(),
    input = { operationId, title: 'offline-room', category: '日常' },
    beforeCalls = f.calls.length;
  const first = await runtime.directoryCommand('create', input);
  const second = await runtime.directoryCommand('create', input);
  assert.equal(first.localAck, true);
  assert.equal(first.serverConfirmed, false);
  assert.equal(second.id, first.id);
  assert.equal(f.calls.length, beforeCalls);
  await runtime.dispose();
  runtime = await create();
  const reopened = await runtime.directoryCommand('create', input);
  assert.equal(reopened.id, first.id);
  assert.equal((await pending(f)).length, 1);
  f.offline(false);
  await runtime.client.sync();
  const confirmed = await runtime.directoryCommand('create', input);
  assert.equal(confirmed.id, first.id);
  assert.equal(confirmed.serverConfirmed, true);
  assert.equal(
    (await f.readServer()).chatJournal.rooms.filter((r) => r.title === 'offline-room').length,
    1,
  );
  await runtime.dispose();
});

test('approved diary query projection updates in the edit transaction and terminal removes all matching derived search', async (t) => {
  const f = await fixture(t, { diaryIndex: true });
  await f.client.sync();
  f.offline(true);
  await f.client.editMessage(f.input('hlc-query-needle'));
  const query = (q) =>
    f.storage.readDiaryPage({ libraryId: f.info.libraryId, epoch: f.info.epoch, query: q });
  assert.equal((await query('hlc-query-needle')).items.length, 1);
  assert.equal((await query('original-private')).items.length, 0);
  await f.client.withdrawMessage(f.input(undefined));
  assert.equal((await query('hlc-query-needle')).items.length, 0);
  assert.equal((await query('neighbour-unchanged')).items.length, 1);
});

test('received redacted intermediate replacement metadata still permits exact current-head offline edit and root withdrawal', async (t) => {
  const f = await fixture(t);
  await f.client.sync();
  await f.client.editMessage(f.input('first-head'));
  await f.client.editMessage(f.input('second-head'));
  await f.client.sync();
  const rows = await localRows(f),
    current = rows.find((m) => !m.withdrawn && m.id !== '2');
  assert.equal(current.text, 'second-head');
  f.offline(true);
  const third = await f.source.edit(current.id, 'third-head');
  assert.equal(third.rootMessageId, '1');
  f.offline(false);
  await f.client.sync();
  const withdrawn = await f.source.withdrawRoot('1');
  assert.equal(withdrawn.rootMessageId, '1');
  await f.client.sync();
  assert.equal((await f.readServer())._messageEdits.roots[0].state, 'withdrawn');
});

test('signed staging copies are scrubbed with terminal and old-package reimport, then resolve uses a fresh authoritative snapshot', async (t) => {
  const f = await fixture(t),
    a = await f.exportSeed(),
    b = await f.exportSeed();
  t.after(async () => {
    await a.dispose();
    await b.dispose();
  });
  const proof = await verifySharedSeedAttestation(a.manifest),
    options = {
      offlineTrust: { explicit: true, keyFingerprintSha256: proof.keyFingerprintSha256 },
    };
  f.offline(true);
  await f.client.importSeed(a.prepared, options);
  await f.client.editMessage(f.input('seed-local-private'));
  await f.client.withdrawMessage(f.input(undefined));
  const read = () => f.storage.transaction((tx) => tx.listEntities());
  assert.equal(JSON.stringify(await read()).includes('original-private'), false);
  await f.client.importSeed(b.prepared, options);
  for (const text of ['original-private', 'seed-local-private'])
    assert.equal(
      JSON.stringify(await read()).includes(text),
      false,
      JSON.stringify(
        (await read())
          .filter((r) => JSON.stringify(r).includes(text))
          .map((r) => [r.entityType, r.entityId]),
      ),
    );
  assert.equal(
    (await read())
      .filter((r) => r.entityType === 'local-seed-package')
      .every((r) => r.seed.localBodiesRedacted),
    true,
  );
  const start = f.calls.length;
  f.offline(false);
  await f.client.sync();
  assert.ok(f.calls.slice(start).some((c) => c.action === 'snapshot'));
  assert.equal((await pending(f)).length, 0);
  await f.client.resolveSeed(a.manifest.packageId);
  for (const text of ['original-private', 'seed-local-private'])
    assert.equal(JSON.stringify(await read()).includes(text), false);
});
