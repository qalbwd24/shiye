import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { IDBFactory } from 'fake-indexeddb';
import { createDiaryServer } from '../src/server/app.mjs';
import { createLibraryStore } from '../src/server/storage/library-store.mjs';
import { appendChatMessages, saveChatRoom } from '../src/server/domain/chat-journal.mjs';
import { createMessageEditProjection } from '../src/server/shared-sync/message-edit-projection.mjs';
import {
  buildLocalMessageEditBase,
  sharedMessageEditHeadSha256,
} from '../public/shared/shared-message-edit-protocol.js';
import { exportSharedSeed, readSharedSeed } from '../src/server/shared-sync/seed-package.mjs';
import { verifySharedSeedAttestation } from '../public/shared/shared-seed-trust.js';

const sentAt = '2026-10-10T00:00:00.000Z';
const admin = { 'X-Diary-Client': 'desktop', 'X-Sync-Client': 'local-admin' };
async function fixture(
  t,
  {
    remote = false,
    actor,
    oldIndex = false,
    deferInfo = false,
    oldRegisteredSeed = false,
    readOnly = false,
    sharedSync = true,
  } = {},
) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'shiye-message-http-'));
  const sourceId = randomUUID(),
    roomId = '-1',
    scope = { sourceId, roomId, rootMessageId: '1' },
    writer = randomUUID();
  const dataDir = path.join(directory, 'data'),
    store = await createLibraryStore({ dataDir, seed: false });
  let oldState, oldSeed;
  await store.mutate((db) => {
    saveChatRoom(db, {
      sourceId,
      id: roomId,
      title: '隔离消息编辑',
      category: '日常',
      idleHours: 5,
    });
    appendChatMessages(
      db,
      { sourceId, roomId, messages: [{ id: '1', sentAt, text: '原始合成正文', attachments: [] }] },
      Date.now(),
      { messageUnitsEnabled: true, ...(actor ? { actor } : {}) },
    );
  });
  if (oldIndex) {
    let parent = path.dirname(fileURLToPath(import.meta.url)),
      baseline;
    while (parent !== path.dirname(parent)) {
      const candidate = path.join(
        parent,
        'outputs/backend-runtimes/20261019-shared-business-1792445229399',
      );
      try {
        await fs.access(path.join(candidate, 'runtime-manifest.json'));
        baseline = candidate;
        break;
      } catch {
        parent = path.dirname(parent);
      }
    }
    assert.ok(baseline, 'exact approved149 fixture artifact must exist');
    const bytes = await fs.readFile(path.join(baseline, 'runtime-manifest.json'));
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      '633399b4960abd38be666bef6348e4714e37ffe15758a9661bf2a77f5286f50d',
    );
    const old = await import(
      pathToFileURL(path.join(baseline, 'src/server/shared-sync/replication.mjs')).href
    );
    const original = structuredClone(store.getDb()),
      indexed = structuredClone(original);
    old.prepareSharedCommit(original, indexed, { enabled: true });
    oldState = structuredClone(indexed);
    await fs.writeFile(path.join(dataDir, 'diary.json'), JSON.stringify(indexed));
    if (oldRegisteredSeed) {
      const { createDiaryServer: createOldServer } = await import(
        pathToFileURL(path.join(baseline, 'src/server/app.mjs')).href
      );
      const { exportSharedSeed: exportOldSeed } = await import(
        pathToFileURL(path.join(baseline, 'src/server/shared-sync/seed-package.mjs')).href
      );
      const oldServer = await createOldServer({
        dataDir,
        seed: false,
        sharedSync: true,
        messageUnits: true,
      });
      await new Promise((resolve) => oldServer.listen(0, '127.0.0.1', resolve));
      const work = path.join(directory, 'old-work');
      await fs.mkdir(work);
      try {
        oldSeed = await exportOldSeed({
          file: path.join(directory, 'old-registered.syseed'),
          directory: work,
          request: async (action, input) => {
            const response = await fetch(
              `http://127.0.0.1:${oldServer.address().port}/api/shared/v1/${action}`,
              {
                method: action === 'info' ? 'GET' : 'POST',
                headers: { 'X-Diary-Client': 'desktop', 'content-type': 'application/json' },
                ...(action === 'info' ? {} : { body: JSON.stringify(input) }),
              },
            );
            return ok({ status: response.status, value: await response.json() });
          },
          openOriginal: () => {
            throw Error('no fixture originals');
          },
        });
      } finally {
        oldServer.closeAllConnections();
        await new Promise((resolve) => oldServer.close(resolve));
      }
      oldState = JSON.parse(await fs.readFile(path.join(dataDir, 'diary.json')));
    }
  }
  let server, url, device;
  async function open() {
    const oldFlag = process.env.SHIYE_MESSAGE_EDIT_WRITES;
    if (readOnly) process.env.SHIYE_MESSAGE_EDIT_WRITES = '0';
    try {
      server = await createDiaryServer({
        dataDir,
        seed: false,
        sharedSync,
        messageUnits: true,
        sharedRemote: remote ? { enabled: true, allowedHosts: ['127.0.0.1'] } : false,
      });
    } finally {
      if (oldFlag === undefined) delete process.env.SHIYE_MESSAGE_EDIT_WRITES;
      else process.env.SHIYE_MESSAGE_EDIT_WRITES = oldFlag;
    }
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${server.address().port}`;
  }
  async function close() {
    if (server?.listening) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  }
  t.after(async () => {
    await close();
    await fs.rm(directory, { recursive: true, force: true });
  });
  await open();
  async function request(
    route,
    input,
    { method = input === undefined ? 'GET' : 'POST', auth = true, headers = {} } = {},
  ) {
    const response = await fetch(url + route, {
      method,
      headers: {
        'X-Diary-Client': 'desktop',
        'content-type': 'application/json',
        ...(auth && device
          ? { Authorization: `Bearer ${device.token}`, 'X-Sync-Device-Id': device.deviceId }
          : {}),
        ...headers,
      },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    });
    return { status: response.status, value: await response.json() };
  }
  async function pair() {
    const code = ok(
      await request('/api/shared/v1/auth/local-pairing', {}, { auth: false, headers: admin }),
    );
    const paired = await request(
      '/api/shared/v1/auth/pair',
      { code: code.code, deviceName: 'synthetic edit client' },
      { auth: false },
    );
    assert.equal(paired.status, 201);
    device = paired.value;
    return device;
  }
  if (remote) await pair();
  const info = !sharedSync
    ? {}
    : deferInfo
      ? { libraryId: oldState._sharedSync.libraryId, epoch: oldState._sharedSync.epoch }
      : ok(await request('/api/shared/v1/info'));
  const command = (action, input, operationId = input.operationId || randomUUID(), options) =>
    request(
      '/api/shared/v1/command',
      {
        libraryId: info.libraryId,
        epoch: info.epoch,
        action,
        input,
        operationId,
      },
      options,
    );
  const page = async () =>
    ok(
      await request('/api/shared/v1/snapshot', {
        libraryId: info.libraryId,
        epoch: info.epoch,
        limit: 200,
      }),
    );
  const base = async () => {
    const entry = (await page()).entities.find((row) => row.entityType === 'entry').data;
    const message = entry.chatJournal.messages.find((m) => !m.withdrawn);
    return buildLocalMessageEditBase(message);
  };
  const edit = (base, offset = 1000, text = 'HTTP新正文') => {
    const operationId = randomUUID(),
      physicalMs = Date.now() - offset;
    return {
      ...scope,
      operationId,
      base,
      editedAt: new Date(physicalMs).toISOString(),
      stamp: { physicalMs, logical: 0, deviceId: writer, operationId },
      message: { text, attachments: [] },
    };
  };
  return {
    dataDir,
    directory,
    sourceId,
    roomId,
    scope,
    writer,
    info,
    request,
    command,
    page,
    base,
    edit,
    pair,
    close,
    open,
    setReadOnly: (value) => {
      readOnly = value;
    },
    get device() {
      return device;
    },
    read: () => fs.readFile(path.join(dataDir, 'diary.json'), 'utf8').then(JSON.parse),
    oldState,
    oldSeed,
    restart: async () => {
      await close();
      await open();
    },
  };
}
function ok(response) {
  assert.equal(response.status, 200, JSON.stringify(response.value));
  return response.value;
}

test('actual fixed command publishes body-free heads and replay keeps historical commit separate from current authority', async (t) => {
  const f = await fixture(t),
    base = await f.base();
  assert.equal(f.info.capabilities.messageEdits.version, 1);
  assert.deepEqual(ok(await f.command('message-describe-local', f.scope)).result.base, base);
  const a = f.edit(base, 3000, '编辑A'),
    ackA = ok(await f.command('message-edit-local', a));
  const b = f.edit(ackA.result.base, 2000, '编辑B'),
    ackB = ok(await f.command('message-edit-local', b));
  const oldAck = ok(await f.command('message-edit-local', a));
  for (const name of ['version', 'headMessageId', 'base'])
    assert.deepEqual(oldAck.result[name], ackA.result[name]);
  assert.deepEqual(oldAck.result.currentHead.base, ackB.result.base);
  const db = await f.read(),
    rowA = db._sharedCommands.find((row) => row.operationId === a.operationId);
  assert.deepEqual(rowA.result.base, ackA.result.base);
  assert.equal(JSON.stringify(db._sharedCommands).includes('编辑A'), false);
  assert.equal(
    db.entries[0].chatJournal.messages.some((m) => m.editBase !== undefined),
    false,
  );
  const head = (await f.page()).entities.find((row) => row.entityType === 'message-edit-head');
  assert.deepEqual(head.data.base, ackB.result.base);
  assert.equal(head.data.readOnlyProjection, true);
  assert.equal(JSON.stringify(head).includes('编辑B'), false);
  assert.equal((await f.command('message-edit-head-save', {})).status, 400);
  await f.restart();
  assert.deepEqual(ok(await f.command('message-edit-local', a)).result.base, ackA.result.base);
});

test('real paired auth and re-pair at another port preserve writer identity and immutable pending wire', async (t) => {
  const f = await fixture(t, { remote: true }),
    base = await f.base(),
    input = f.edit(base);
  assert.notEqual(f.writer, f.device.deviceId);
  assert.equal(
    (await f.command('message-edit-local', input, input.operationId, { auth: false })).status,
    401,
  );
  const committed = ok(await f.command('message-edit-local', input));
  const oldDevice = f.device;
  const db = await f.read();
  assert.equal(db._messageEdits.operations[0].authenticatedDeviceId, oldDevice.deviceId);
  assert.equal(db._messageEdits.roots[0].head.stamp.deviceId, f.writer);
  ok(
    await f.request(`/api/shared/v1/auth/devices/${oldDevice.deviceId}`, undefined, {
      method: 'DELETE',
      auth: false,
      headers: admin,
    }),
  );
  assert.equal((await f.command('message-edit-local', input)).status, 401);
  await f.restart();
  await f.pair();
  assert.notEqual(f.device.deviceId, oldDevice.deviceId);
  assert.deepEqual(
    ok(await f.command('message-edit-local', input)).result.base,
    committed.result.base,
  );
  const impostor = {
    ...input,
    operationId: randomUUID(),
    stamp: { ...input.stamp, deviceId: 'not-a-uuid' },
  };
  assert.equal((await f.command('message-edit-local', impostor)).status, 400);
  assert.equal(
    (await f.command('message-edit-local', { ...input, operationId: randomUUID() })).status,
    400,
  );
});

test('old aliases remain single-message while new root-terminal action overrides all historical edit ACKs', async (t) => {
  const f = await fixture(t),
    initial = await f.base(),
    a = f.edit(initial),
    ackA = ok(await f.command('message-edit-local', a));
  ok(
    await f.command('journal-withdraw', {
      sourceId: f.sourceId,
      roomId: f.roomId,
      messageId: '1',
      operationId: randomUUID(),
    }),
  );
  assert.equal(
    ok(await f.command('message-describe-local', f.scope)).result.base.headMessageId,
    ackA.result.headMessageId,
  );
  const operationId = randomUUID();
  ok(await f.command('message-withdraw-local', { ...f.scope, operationId, base: initial }));
  const replay = ok(await f.command('message-edit-local', a));
  assert.equal(replay.result.terminal, true);
  assert.equal(replay.result.base, null);
  assert.equal(replay.result.currentHead.base, null);
  const tombstone = (await f.page()).entities.find((row) => row.entityType === 'message-edit-head');
  assert.equal(tombstone.state, 'withdrawn');
  assert.deepEqual(tombstone.data, {});
  assert.equal(
    (await f.read())._sharedCommands.find((r) => r.operationId === a.operationId).result.version,
    1,
  );
});

test('unknown external current-head withdrawal commits diagnosis before 409 and never adds a successful global receipt', async (t) => {
  const f = await fixture(t),
    a = f.edit(await f.base()),
    ack = ok(await f.command('message-edit-local', a));
  ok(
    await f.command('journal-withdraw', {
      sourceId: f.sourceId,
      roomId: f.roomId,
      messageId: ack.result.headMessageId,
      expectedRevision: ack.result.base.headRevision,
      operationId: randomUUID(),
    }),
  );
  const b = f.edit(ack.result.base),
    result = await f.command('message-edit-local', b);
  assert.equal(result.status, 409);
  assert.equal(result.value.error.code, 'LOCAL_MESSAGE_EDIT_UNKNOWN_STALE');
  const db = await f.read();
  assert.equal(db._messageEdits.roots[0].state, 'unknown-stale');
  assert.equal(
    db._sharedCommands.some((row) => row.operationId === b.operationId),
    false,
  );
  assert.equal((await f.command('message-edit-local', a)).status, 409); // no generic prior success bypass
  await f.restart();
  assert.equal((await f.command('message-edit-local', b)).status, 409);
  const head = (await f.page()).entities.find((row) => row.entityType === 'message-edit-head');
  assert.equal(head.data.state, 'unknown-stale');
  assert.equal(head.data.base, null);
});

test('hidden deleted and draft parents yield empty readonly tombstones; original writer rejects program messages and forged base', async (t) => {
  const f = await fixture(t),
    a = f.edit(await f.base());
  ok(await f.command('message-edit-local', a));
  for (const flag of ['hidden', 'deleted', 'draft']) {
    const entry = (await f.read()).entries[0];
    ok(await f.request(`/api/entries/${entry.id}`, { ...entry, [flag]: true }, { method: 'PUT' }));
    const row = (await f.page()).entities.find((item) => item.entityType === 'message-edit-head');
    assert.equal(row.state, 'deleted');
    assert.deepEqual(row.data, {});
    const current = (await f.read()).entries[0];
    ok(
      await f.request(
        `/api/entries/${current.id}`,
        { ...current, [flag]: false },
        { method: 'PUT' },
      ),
    );
  }
  const before = await f.read(),
    forged = f.edit({
      ...ok(await f.command('message-describe-local', f.scope)).result.base,
      editOperationId: randomUUID(),
    });
  assert.equal((await f.command('message-edit-local', forged)).status, 409);
  assert.deepEqual(await f.read(), before);
  const program = await fixture(t, { actor: { kind: 'program', id: randomUUID() } });
  assert.equal((await program.command('message-describe-local', program.scope)).status, 409);
  const projected = (await program.page()).entities.find((r) => r.entityType === 'entry').data
    .chatJournal.messages[0];
  assert.equal(projected.editBase, undefined);
});

test('signed full seed carries offline-verifiable exact base through local IDB reopen without online describe', async (t) => {
  const f = await fixture(t),
    file = path.join(f.directory, 'full.syseed'),
    work = path.join(f.directory, 'work');
  await fs.mkdir(work);
  const request = async (action, input) =>
    ok(await f.request(`/api/shared/v1/${action}`, action === 'info' ? undefined : input));
  const exported = await exportSharedSeed({
    file,
    directory: work,
    request,
    openOriginal: () => {
      throw Error('synthetic fixture has no media');
    },
  });
  await f.close(); // every subsequent operation until reopen is completely offline
  const opened = await readSharedSeed({ file, directory: work, expectedSha256: exported.sha256 });
  t.after(() => opened.dispose());
  assert.equal((await verifySharedSeedAttestation(opened.manifest)).verified, true);
  const entry = opened.prepared.entities.find((row) => row.entityType === 'entry').data;
  const indexedDB = new IDBFactory();
  const open = () =>
    new Promise((resolve, reject) => {
      const r = indexedDB.open('offline-seed-base', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('entries');
      r.onerror = () => reject(r.error);
      r.onsuccess = () => resolve(r.result);
    });
  let local = await open();
  await new Promise((resolve, reject) => {
    const tx = local.transaction('entries', 'readwrite');
    tx.objectStore('entries').put(entry, entry.id);
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error);
  });
  local.close();
  local = await open();
  const received = await new Promise((resolve, reject) => {
    const r = local.transaction('entries').objectStore('entries').get(entry.id);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  local.close();
  const offlineBase = buildLocalMessageEditBase(received.chatJournal.messages[0]);
  assert.equal(offlineBase.headRevision, 1);
  assert.equal(offlineBase.editOperationId, null);
  const tampered = structuredClone(received.chatJournal.messages[0]);
  tampered.text += 'tamper';
  assert.throws(() => buildLocalMessageEditBase(tampered), {
    code: 'LOCAL_MESSAGE_EDIT_BASE_UNAVAILABLE',
  });
  const input = f.edit(offlineBase);
  await f.open();
  assert.equal(ok(await f.command('message-edit-local', input)).result.outcome, 'applied');
});

test('projection is immutable and indexes entries only once for many roots', () => {
  const sourceId = randomUUID(),
    db = { entries: [], media: [], categories: ['日常'] };
  saveChatRoom(db, {
    sourceId,
    id: '-1',
    title: 'linear synthetic',
    category: '日常',
    idleHours: 5,
  });
  const messages = Array.from({ length: 50 }, (_, i) => ({
    id: String(i + 1),
    sentAt,
    text: `row-${i}`,
    attachments: [],
  }));
  appendChatMessages(db, { sourceId, roomId: '-1', messages }, Date.now(), {
    messageUnitsEnabled: true,
  });
  db._messageEdits = {
    version: 1,
    operations: [],
    roots: messages.map((message) => ({
      sourceId,
      roomId: '-1',
      rootMessageId: message.id,
      rootKey: createHash('sha256').update(message.id).digest('hex'),
      state: 'active',
      version: 0,
      head: {
        headMessageId: message.id,
        headRevision: 1,
        headSha256: sharedMessageEditHeadSha256(message, 1),
        editOperationId: null,
      },
    })),
  };
  const before = JSON.stringify(db),
    entries = db.entries;
  let scans = 0;
  db.entries = new Proxy(entries, {
    get(target, property, receiver) {
      if (property === Symbol.iterator)
        return function* () {
          scans++;
          yield* target;
        };
      if (['filter', 'find', 'flatMap'].includes(property))
        throw Error('per-root entry scanning forbidden');
      return Reflect.get(target, property, receiver);
    },
  });
  const projection = createMessageEditProjection(db);
  assert.equal(projection.heads().length, 50);
  assert.equal(
    projection.entry(entries[0]).chatJournal.messages.every((m) => !!m.editBase),
    true,
  );
  assert.equal(scans, 1);
  db.entries = entries;
  assert.equal(JSON.stringify(db), before);
});

test('approved149 existing shared index upgrades metadata once without changing library identity or original message bytes', async (t) => {
  const f = await fixture(t, { oldIndex: true });
  const db = await f.read(),
    identity = { libraryId: f.oldState._sharedSync.libraryId, epoch: f.oldState._sharedSync.epoch };
  assert.deepEqual({ libraryId: f.info.libraryId, epoch: f.info.epoch }, identity);
  assert.deepEqual(db.entries, f.oldState.entries);
  const first = await f.page();
  assert.equal(
    first.entities.find((row) => row.entityType === 'entry').data.chatJournal.messages[0].editBase
      .headRevision,
    1,
  );
  assert.equal(db.entries[0].chatJournal.messages[0].text, '原始合成正文');
  assert.equal(db.entries[0].chatJournal.messages[0].editBase, undefined);
  assert.equal(db._messageEditProjectionVersion, 1);
  const stable = JSON.stringify((await f.read())._sharedSync);
  await f.restart();
  const reopenedInfo = ok(await f.request('/api/shared/v1/info'));
  assert.deepEqual({ libraryId: reopenedInfo.libraryId, epoch: reopenedInfo.epoch }, identity);
  await f.page();
  assert.equal(JSON.stringify((await f.read())._sharedSync), stable);
  assert.equal(
    ok(await f.command('message-edit-local', f.edit(await f.base()))).result.outcome,
    'applied',
  );
});

test('old registered signed seed survives first concurrent migration reads/writes/export and historical delta keeps identity', async (t) => {
  const f = await fixture(t, { oldIndex: true, oldRegisteredSeed: true, deferInfo: true });
  const work = path.join(f.directory, 'new-work');
  await fs.mkdir(work);
  const request = async (action, input) =>
    ok(await f.request(`/api/shared/v1/${action}`, action === 'info' ? undefined : input));
  let exported;
  const exportOnce = () =>
    exportSharedSeed({
      file: path.join(f.directory, 'new-full.syseed'),
      directory: work,
      request,
      openOriginal: () => {
        throw Error('no originals');
      },
    });
  const [info, snapshot, write, exportAttempt] = await Promise.all([
    f.request('/api/shared/v1/info'),
    f.page(),
    f.command('client-preferences-save', {
      scope: 'desktop:thoughts',
      expectedRevision: 0,
      set: { synthetic: 1 },
      remove: [],
    }),
    exportOnce().then(
      (value) => ({ value }),
      (error) => ({ error }),
    ),
  ]);
  ok(info);
  ok(write);
  assert.ok(snapshot.entities.length);
  if (exportAttempt.error) {
    assert.match(
      exportAttempt.error.code || exportAttempt.error.message,
      /(?:CHANGED|STALE|WATERMARK)/,
    );
    exported = await exportOnce(); // bounded retry of a changing immutable snapshot, never a write op retry
  } else exported = exportAttempt.value;
  assert.equal(exported.manifest.libraryId, f.oldSeed.manifest.libraryId);
  assert.equal(exported.manifest.epoch, f.oldSeed.manifest.epoch);
  const beforeResolve = await f.read();
  const resolved = ok(
    await f.request('/api/shared/v1/seed-resolve', {
      ...f.info,
      manifest: f.oldSeed.manifest,
      manifestSha256: createHash('sha256')
        .update(JSON.stringify(sortJson(f.oldSeed.manifest)))
        .digest('hex'),
    }),
  );
  assert.equal(resolved.registered, true);
  assert.equal(resolved.watermark, f.oldSeed.manifest.watermark);
  const delta = ok(
    await f.request('/api/shared/v1/pull', {
      ...f.info,
      after: f.oldSeed.manifest.watermark,
      limit: 200,
    }),
  );
  assert.ok(
    delta.changes.some(
      (row) => row.entityType === 'entry' && row.data.chatJournal.messages[0].editBase,
    ),
  );
  assert.deepEqual((await f.read()).entries, f.oldState.entries);
  assert.equal((await f.read())._sharedSync.libraryId, f.oldState._sharedSync.libraryId);
  assert.equal((await f.read())._sharedSync.epoch, f.oldState._sharedSync.epoch);
  assert.equal(beforeResolve._messageEditProjectionVersion, 1);
  assert.equal(beforeResolve._sharedSync.seq, f.oldState._sharedSync.seq + 2); // one annotation migration + one preferences entity
});

test('metadata migration write failure leaves old identity/index/body intact and a single retry commits', async (t) => {
  const f = await fixture(t, { oldIndex: true, deferInfo: true });
  const file = path.join(f.dataDir, 'diary.json'),
    before = await fs.readFile(file);
  await fs.mkdir(file + '.tmp');
  assert.equal((await f.request('/api/shared/v1/info')).status, 500);
  assert.deepEqual(await fs.readFile(file), before);
  assert.equal((await f.read())._messageEditProjectionVersion, undefined);
  await fs.rmdir(file + '.tmp');
  const info = ok(await f.request('/api/shared/v1/info'));
  assert.equal(info.libraryId, f.oldState._sharedSync.libraryId);
  assert.equal(info.epoch, f.oldState._sharedSync.epoch);
  const index = JSON.stringify((await f.read())._sharedSync);
  await Promise.all([f.request('/api/shared/v1/info'), f.page(), f.request('/api/shared/v1/info')]);
  assert.equal(JSON.stringify((await f.read())._sharedSync), index);
});

test('marker1 compatible fallback disables only the new write actions while keeping projection/base reads', async (t) => {
  const f = await fixture(t);
  const applied = ok(await f.command('message-edit-local', f.edit(await f.base())));
  f.setReadOnly(true);
  await f.restart();
  const base = await f.base();
  assert.deepEqual(base, applied.result.base);
  assert.equal(
    ok(await f.request('/api/shared/v1/info')).capabilities.messageEdits.writeEnabled,
    false,
  );
  const before = await f.read();
  const input = f.edit(base);
  const result = await f.command('message-edit-local', input);
  assert.equal(result.status, 503);
  assert.equal(result.value.error.code, 'SHARED_MESSAGE_EDITS_READ_ONLY');
  assert.deepEqual(ok(await f.command('message-describe-local', f.scope)).result.base, base);
  assert.deepEqual(await f.read(), before);
  const operationId = randomUUID();
  assert.equal(
    (await f.command('message-withdraw-local', { ...f.scope, base, operationId })).status,
    503,
  );
  await f.restart();
  assert.ok((await f.page()).entities.length);
});

function sortJson(value) {
  return Array.isArray(value)
    ? value.map(sortJson)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, sortJson(value[key])]),
        )
      : value;
}

test('disabled shared service never creates an identity or projection marker on a legacy-only library', async (t) => {
  const f = await fixture(t, { sharedSync: false }),
    before = await f.read();
  assert.equal((await f.request('/api/shared/v1/info')).status, 404);
  const after = await f.read();
  assert.equal(after._sharedSync, undefined);
  assert.equal(after._messageEditProjectionVersion, undefined);
  assert.deepEqual(after, before);
});
