import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { IDBFactory } from 'fake-indexeddb';
import { createDiaryServer } from '../src/server/app.mjs';
import { createSharedBusinessClient } from '../public/shared/shared-business-client.js';
import { createIndexedDbSyncStorage } from '../public/shared/sync-v2-client.js';
import { createSharedMediaClient } from '../public/shared/shared-media-client.js';
import { createSharedUploadJobs } from '../public/shared/shared-upload-jobs.js';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function gate() {
  let open;
  const promise = new Promise((resolve) => {
    open = resolve;
  });
  return { promise, open };
}
function leaseTimers(clock) {
  const records = new Set();
  const add = (fn, delay, interval) => {
    const timer = { fn, at: clock() + delay, interval, unref() {} };
    records.add(timer);
    return timer;
  };
  return {
    setTimeout: (fn, delay) => add(fn, delay, false),
    clearTimeout: (timer) => records.delete(timer),
    setInterval: (fn, delay) => add(fn, delay, true),
    clearInterval: (timer) => records.delete(timer),
    fireIntervals() {
      for (const timer of records) if (timer.interval) timer.fn();
    },
    fireDueTimeouts() {
      for (const timer of [...records])
        if (!timer.interval && timer.at <= clock()) {
          records.delete(timer);
          timer.fn();
        }
    },
    timeouts() {
      return [...records].filter((timer) => !timer.interval);
    },
    count() {
      return records.size;
    },
  };
}
async function fixture(t) {
  const dataDir = path.resolve('tmp/shared-upload-jobs', randomUUID()),
    sourceId = randomUUID(),
    roomId = '-103',
    conversationId = `desktop:${sourceId}:${roomId}`;
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(
    path.join(dataDir, 'diary.json'),
    JSON.stringify({
      schema: 1,
      categories: ['日常'],
      tags: [],
      media: [],
      entries: [],
      chatJournal: {
        rooms: [
          { sourceId, id: roomId, title: 'upload job fixture', category: '日常', idleHours: 5 },
        ],
        withdrawals: [],
      },
    }),
  );
  const server = await createDiaryServer({ dataDir, seed: false, sharedSync: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`,
    calls = [],
    state = { failAfterFirstChunk: false, loseCommandAck: false, resumed: [] };
  async function request(action, input) {
    calls.push({ action, input: structuredClone(input) });
    if (action === 'media-chunk' && state.failAfterFirstChunk && input.offset > 0) {
      state.failAfterFirstChunk = false;
      throw Object.assign(Error('synthetic interruption'), { code: 'SHARED_NETWORK_INTERRUPTED' });
    }
    const route = action.startsWith('media-')
      ? 'media/' + action.slice(6)
      : action === 'entity-read'
        ? 'entity/read'
        : action;
    const response = await fetch(base + '/api/shared/v1/' + route, {
      method: action === 'info' ? 'GET' : 'POST',
      headers: { 'X-Diary-Client': 'desktop', 'Content-Type': 'application/json' },
      ...(action === 'info' ? {} : { body: JSON.stringify(input) }),
    });
    const value = await response.json();
    if (!response.ok)
      throw Object.assign(Error(value.error?.code || 'HTTP'), {
        code: value.error?.code,
        status: response.status,
      });
    if (action === 'media-begin') state.resumed.push(value.next);
    if (action === 'command' && input.action === 'journal-send' && state.loseCommandAck) {
      state.loseCommandAck = false;
      throw Object.assign(Error('synthetic lost ACK'), { code: 'SHARED_ACK_LOST' });
    }
    return value;
  }
  const info = await request('info'),
    indexedDB = new IDBFactory(),
    dbName = 'shiye-sync-v2-upload-' + randomUUID();
  let storage = createIndexedDbSyncStorage({ dbName, indexedDB });
  let client = createSharedBusinessClient({
    storage,
    request,
    libraryId: info.libraryId,
    epoch: info.epoch,
  });
  await client.sync();
  const media = createSharedMediaClient({ request, libraryId: info.libraryId, epoch: info.epoch });
  const make = (options = {}) =>
    createSharedUploadJobs({
      storage,
      client,
      media,
      libraryId: info.libraryId,
      epoch: info.epoch,
      ...options,
    });
  const raw = () => fs.readFile(path.join(dataDir, 'diary.json'), 'utf8').then(JSON.parse);
  return {
    info,
    sourceId,
    roomId,
    conversationId,
    calls,
    state,
    media,
    make,
    raw,
    get client() {
      return client;
    },
    get storage() {
      return storage;
    },
    extraStorage() {
      return createIndexedDbSyncStorage({ dbName, indexedDB });
    },
    async reopen() {
      await storage.close?.();
      storage = createIndexedDbSyncStorage({ dbName, indexedDB });
      client = createSharedBusinessClient({
        storage,
        request,
        libraryId: info.libraryId,
        epoch: info.epoch,
      });
    },
  };
}

test('large media durable placeholder does not occupy text outbox; completion preserves original message identity/time/caption and room', async (t) => {
  const f = await fixture(t),
    uploadGate = gate(),
    entered = gate();
  const jobs = f.make({
    media: {
      upload: async (...args) => {
        entered.open();
        await uploadGate.promise;
        return f.media.upload(...args);
      },
    },
  });
  t.after(() => jobs.dispose());
  const first = await jobs.enqueue({
    conversationId: f.conversationId,
    messageId: '101',
    sentAt: '2026-10-19T01:00:00Z',
    text: 'video caption',
    attachments: [
      { blob: new Blob([new Uint8Array(600003)], { type: 'video/mp4' }), name: 'video.mp4' },
    ],
  });
  await jobs.start();
  await entered.promise;
  assert.equal((await jobs.read(first.operationId)).status, 'uploading');
  assert.equal((await f.storage.transaction((tx) => tx.listPending())).length, 0);
  const textOperation = randomUUID();
  await f.client.enqueue({
    operationId: textOperation,
    action: 'journal-send',
    input: {
      sourceId: f.sourceId,
      roomId: f.roomId,
      messages: [
        { id: '102', sentAt: '2026-10-19T01:00:01Z', text: 'later text', attachments: [] },
      ],
    },
  });
  await f.client.sync();
  assert.equal((await f.client.readOperation(textOperation)).status, 'acknowledged');
  assert.equal(
    f.calls.filter(
      (call) => call.action === 'command' && call.input.operationId === first.operationId,
    ).length,
    0,
  );
  uploadGate.open();
  await jobs.waitIdle();
  const done = await jobs.read(first.operationId);
  assert.equal(
    done.status,
    'acknowledged',
    JSON.stringify(await f.client.readOperation(first.operationId)),
  );
  assert.equal(done.sentAt, first.sentAt);
  assert.equal(done.messageId, '101');
  assert.equal(done.attachments.length, 1);
  assert.equal(done.attachments[0].transferred, 600003);
  const command = f.calls.find(
    (call) => call.action === 'command' && call.input.operationId === first.operationId,
  ).input;
  assert.equal(command.input.roomId, f.roomId);
  assert.equal(command.input.messages[0].id, '101');
  assert.equal(command.input.messages[0].text, 'video caption');
  assert.equal(command.input.messages[0].sentAt, '2026-10-19T01:00:00Z');
  assert.equal(command.input.messages.length, 1);
  const meta = await f.storage.transaction((tx) => tx.getMeta());
  assert.ok(JSON.stringify(meta).length < 1024 * 1024);
  assert.ok(!JSON.stringify(meta).includes('video/mp4'));
});

test('IDB reopen resumes same original operation from server chunk ACK, retains Blob and one ordered message for two attachments', async (t) => {
  const f = await fixture(t),
    bytes = new Uint8Array(600001);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
  let jobs = f.make();
  f.state.failAfterFirstChunk = true;
  const first = await jobs.enqueue({
    conversationId: f.conversationId,
    messageId: '201',
    sentAt: '2026-10-19T02:00:00Z',
    text: 'ordered caption',
    replyTo: '99',
    attachments: [
      { blob: new Blob([bytes]), name: 'first.bin' },
      { blob: new Blob(['second']), name: 'second.bin' },
    ],
  });
  await jobs.start();
  await jobs.waitIdle();
  const failed = await jobs.read(first.operationId);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.attachments[0].transferred, 262144);
  assert.equal(failed.error, 'SHARED_NETWORK_INTERRUPTED');
  const source = await f.storage.transaction(
    async (tx) =>
      (await tx.getEntity('local-media-job', first.operationId)).job.attachments[0].source,
  );
  assert.equal(source.blob.size, bytes.length);
  assert.ok(source.blob instanceof Blob);
  const operations = failed.attachments.map((a) => a.uploadOperationId);
  jobs.dispose();
  await f.reopen();
  jobs = f.make();
  t.after(() => jobs.dispose());
  await jobs.retry(first.operationId);
  await jobs.waitIdle();
  const done = await jobs.read(first.operationId);
  assert.equal(done.status, 'acknowledged');
  assert.deepEqual(
    done.attachments.map((a) => a.uploadOperationId),
    operations,
  );
  assert.ok(f.state.resumed.includes(262144));
  const commands = f.calls.filter(
    (call) => call.action === 'command' && call.input.operationId === first.operationId,
  );
  assert.equal(commands.length, 1);
  const message = commands[0].input.input.messages[0];
  assert.equal(message.replyTo, '99');
  assert.equal(message.text, 'ordered caption');
  assert.deepEqual(
    message.attachments,
    done.attachments.map((a) => a.asset.id),
  );
  assert.equal(done.attachments[0].asset.sha256, hash(bytes));
  const raw = await f.raw(),
    messages = raw.entries.flatMap((e) => e.chatJournal?.messages || []);
  assert.equal(messages.filter((m) => m.id === '201').length, 1);
});

test('dispose stops further work, fresh instance restores queued durable job, explicit cancellation does not publish', async (t) => {
  const f = await fixture(t);
  let jobs = f.make();
  const first = await jobs.enqueue({
    conversationId: f.conversationId,
    text: 'stop',
    attachments: [{ blob: new Blob(['keep bytes']) }],
  });
  jobs.dispose();
  await assert.rejects(jobs.start(), { code: 'SHARED_UPLOAD_DISPOSED' });
  assert.equal(f.calls.filter((c) => c.action === 'media-begin').length, 0);
  await f.reopen();
  jobs = f.make();
  t.after(() => jobs.dispose());
  await jobs.cancel(first.operationId);
  await jobs.start();
  await jobs.waitIdle();
  assert.equal((await jobs.read(first.operationId)).status, 'cancelled');
  assert.equal(f.calls.filter((c) => c.action === 'media-begin').length, 0);
  assert.equal((await jobs.list()).length, 0);
});

test('immutable duplicate operation, wrong room mapping/owner and nondurable path source are refused', async (t) => {
  const f = await fixture(t),
    jobs = f.make();
  t.after(() => jobs.dispose());
  const operationId = randomUUID();
  const input = {
    operationId,
    conversationId: f.conversationId,
    text: 'original',
    attachments: [{ blob: new Blob(['same-size1']) }],
  };
  await jobs.enqueue(input);
  await assert.rejects(jobs.enqueue({ ...input, text: 'changed' }), {
    code: 'SHARED_UPLOAD_JOB_EXISTS',
  });
  await assert.rejects(jobs.enqueue({ ...input, operationId: randomUUID(), roomId: '-104' }), {
    code: 'SHARED_UPLOAD_INVALID_JOB',
  });
  await assert.rejects(
    jobs.enqueue({ ...input, operationId: randomUUID(), messageOwner: 'conversation-services-v1' }),
    { code: 'SHARED_UPLOAD_INVALID_JOB' },
  );
  await assert.rejects(
    jobs.enqueue({
      ...input,
      operationId: randomUUID(),
      attachments: [{ path: 'C:/private.mp4' }],
    }),
    { code: 'SHARED_UPLOAD_DURABLE_SOURCE_REQUIRED' },
  );
  assert.equal((await jobs.read(operationId)).text, 'original');
});

test('native opaque source is read only in bounded ranges, verified before upload, and source SHA mismatch never publishes', async (t) => {
  const f = await fixture(t),
    bytes = new Uint8Array(300003),
    ranges = [];
  let changed = false;
  const jobs = f.make({
    openHandle: async (handle, metadata) => ({
      size: metadata.size,
      sha256: metadata.sha256,
      read: async (start, end) => {
        ranges.push([start, end]);
        const out = bytes.slice(start, end);
        if (changed) out[0] ^= 1;
        return out;
      },
    }),
  });
  t.after(() => jobs.dispose());
  const first = await jobs.enqueue({
    conversationId: f.conversationId,
    text: 'native',
    attachments: [
      {
        handle: 'shared-seed-original:' + randomUUID(),
        size: bytes.length,
        sha256: hash(bytes),
        name: 'native.bin',
        mime: 'application/octet-stream',
      },
    ],
  });
  await jobs.start();
  await jobs.waitIdle();
  assert.equal((await jobs.read(first.operationId)).status, 'acknowledged');
  assert.ok(ranges.every(([start, end]) => end - start <= 262144));
  changed = true;
  const second = await jobs.enqueue({
    conversationId: f.conversationId,
    text: 'changed',
    attachments: [
      {
        handle: 'shared-seed-original:' + randomUUID(),
        size: bytes.length,
        sha256: hash(bytes),
        name: 'native.bin',
        mime: 'application/octet-stream',
      },
    ],
  });
  await jobs.waitIdle();
  assert.equal((await jobs.read(second.operationId)).status, 'failed');
  assert.equal((await jobs.read(second.operationId)).error, 'SHARED_UPLOAD_SOURCE_CHANGED');
  assert.equal(
    f.calls.filter((c) => c.action === 'command' && c.input.operationId === second.operationId)
      .length,
    0,
  );
});

test('ambiguous command ACK resumes same immutable wire without reupload or duplicate message', async (t) => {
  const f = await fixture(t);
  let jobs = f.make();
  f.state.loseCommandAck = true;
  const first = await jobs.enqueue({
    conversationId: f.conversationId,
    messageId: '301',
    text: 'lost ack',
    attachments: [{ blob: new Blob(['durable ack bytes']) }],
  });
  await jobs.start();
  await jobs.waitIdle();
  assert.equal((await jobs.read(first.operationId)).status, 'submitted');
  const beginCount = f.calls.filter((call) => call.action === 'media-begin').length;
  jobs.dispose();
  await f.reopen();
  jobs = f.make();
  t.after(() => jobs.dispose());
  await jobs.resume();
  await jobs.waitIdle();
  assert.equal((await jobs.read(first.operationId)).status, 'acknowledged');
  assert.equal(f.calls.filter((call) => call.action === 'media-begin').length, beginCount);
  const sends = f.calls.filter(
    (call) => call.action === 'command' && call.input.operationId === first.operationId,
  );
  assert.equal(sends.length, 2);
  assert.deepEqual(sends[0].input, sends[1].input);
  assert.equal(
    (await f.raw()).entries
      .flatMap((entry) => entry.chatJournal?.messages || [])
      .filter((message) => message.id === '301').length,
    1,
  );
});

test('interrupted durable outbox handoff cannot cancel or replace a committed command; retry freezes original assets and IDs', async (t) => {
  const f = await fixture(t);
  let interrupted = true;
  let jobs = f.make({
    client: {
      ...f.client,
      async enqueue(command) {
        const result = await f.client.enqueue(command);
        if (interrupted) {
          interrupted = false;
          throw Object.assign(Error('handoff interrupted'), { code: 'SHARED_HANDOFF_INTERRUPTED' });
        }
        return result;
      },
    },
  });
  const first = await jobs.enqueue({
    conversationId: f.conversationId,
    messageId: '401',
    text: 'handoff',
    attachments: [{ blob: new Blob(['handoff original']) }],
  });
  await jobs.start();
  await jobs.waitIdle();
  const failed = await jobs.read(first.operationId);
  assert.equal(failed.status, 'failed');
  await assert.rejects(jobs.cancel(first.operationId), {
    code: 'SHARED_UPLOAD_COMMAND_ALREADY_QUEUED',
  });
  assert.equal((await f.storage.transaction((tx) => tx.listPending())).length, 1);
  jobs.dispose();
  await f.reopen();
  jobs = f.make();
  t.after(() => jobs.dispose());
  await jobs.retry(first.operationId);
  await jobs.waitIdle();
  const complete = await jobs.read(first.operationId);
  assert.equal(complete.status, 'acknowledged');
  assert.equal(complete.attachments[0].uploadOperationId, failed.attachments[0].uploadOperationId);
  assert.deepEqual(complete.command, failed.command);
  assert.equal(f.calls.filter((call) => call.action === 'media-begin').length, 1);
});

test('bounded independent media tasks run concurrently and cancellation of an active task never publishes its message', async (t) => {
  const f = await fixture(t),
    entered = gate(),
    release = gate();
  let count = 0,
    peak = 0;
  const jobs = f.make({
    maxConcurrent: 2,
    media: {
      async upload(file, options) {
        count++;
        peak = Math.max(peak, count);
        if (count === 2) entered.open();
        await release.promise;
        try {
          return await f.media.upload(file, options);
        } finally {
          count--;
        }
      },
    },
  });
  t.after(() => jobs.dispose());
  const tasks = [];
  for (let index = 0; index < 3; index++)
    tasks.push(
      await jobs.enqueue({
        conversationId: f.conversationId,
        messageId: String(501 + index),
        sentAt: '2026-10-19T05:00:00Z',
        text: 'parallel ' + index,
        attachments: [{ blob: new Blob(['original ' + index]) }],
      }),
    );
  await jobs.start();
  await entered.promise;
  assert.equal(peak, 2);
  await jobs.cancel(tasks[0].operationId);
  release.open();
  await jobs.waitIdle();
  assert.equal((await jobs.read(tasks[0].operationId)).status, 'cancelled');
  assert.equal((await jobs.read(tasks[1].operationId)).status, 'acknowledged');
  assert.equal((await jobs.read(tasks[2].operationId)).status, 'acknowledged');
  assert.equal(
    f.calls.filter(
      (call) => call.action === 'command' && call.input.operationId === tasks[0].operationId,
    ).length,
    0,
  );
  assert.equal(peak, 2);
});

test('job local ACK and matching draft clear commit together, stale revision/new room draft survives, oversized caption is refused upfront', async (t) => {
  const f = await fixture(t),
    jobs = f.make();
  t.after(() => jobs.dispose());
  const attachment = { blob: new Blob(['draft original']) };
  const firstDraft = await f.client.setDraft(f.conversationId, { text: 'caption', replyId: '99' });
  const first = await jobs.enqueue({
    conversationId: f.conversationId,
    text: 'caption',
    replyTo: '99',
    attachments: [attachment],
    draftClear: { scope: f.conversationId, expectedRevision: firstDraft.revision },
  });
  assert.equal(first.status, 'queued');
  assert.deepEqual(await f.client.readDraft(f.conversationId), {
    text: '',
    replyId: null,
    revision: firstDraft.revision + 1,
  });
  const next = await f.client.setDraft(f.conversationId, { text: 'new text', replyId: null });
  await jobs.enqueue({
    conversationId: f.conversationId,
    text: 'old caption',
    attachments: [attachment],
    draftClear: { scope: f.conversationId, expectedRevision: firstDraft.revision },
  });
  assert.deepEqual(await f.client.readDraft(f.conversationId), next);
  await assert.rejects(
    jobs.enqueue({
      conversationId: f.conversationId,
      text: 'x'.repeat(600000),
      attachments: [attachment],
    }),
    { code: 'SHARED_UPLOAD_INVALID_JOB' },
  );
  await assert.rejects(
    jobs.enqueue({
      conversationId: f.conversationId,
      text: 'caption',
      attachments: [attachment],
      draftClear: { scope: 'another-room', expectedRevision: next.revision },
    }),
    { code: 'SHARED_INVALID_DRAFT' },
  );
  assert.deepEqual(await f.client.readDraft(f.conversationId), next);
  const broken = f.make({
    storage: {
      transaction: (fn) =>
        f.storage.transaction(async (tx) => {
          const result = await fn(tx);
          throw Object.assign(Error('transaction rollback'), {
            code: 'SYNTHETIC_COMMIT_FAILURE',
            result,
          });
        }),
    },
  });
  t.after(() => broken.dispose());
  const failedOperation = randomUUID();
  await assert.rejects(
    broken.enqueue({
      operationId: failedOperation,
      conversationId: f.conversationId,
      text: 'new text',
      attachments: [attachment],
      draftClear: { scope: f.conversationId, expectedRevision: next.revision },
    }),
    { code: 'SYNTHETIC_COMMIT_FAILURE' },
  );
  assert.deepEqual(await f.client.readDraft(f.conversationId), next);
  assert.equal(await jobs.read(failedOperation), null);
  assert.equal(f.calls.filter((call) => call.action === 'media-begin').length, 0);
});

test('two real IDB connections/controllers atomically claim one job and never run a duplicate uploader', async (t) => {
  const f = await fixture(t),
    entered = gate(),
    release = gate(),
    secondStorage = f.extraStorage();
  let firstUploads = 0,
    secondUploads = 0;
  const first = f.make({
    media: {
      async upload(...args) {
        firstUploads++;
        entered.open();
        await release.promise;
        return f.media.upload(...args);
      },
    },
  });
  const second = f.make({
    storage: secondStorage,
    media: {
      async upload(...args) {
        secondUploads++;
        return f.media.upload(...args);
      },
    },
  });
  t.after(async () => {
    await first.dispose();
    await second.dispose();
    await secondStorage.close?.();
  });
  const job = await first.enqueue({
    conversationId: f.conversationId,
    text: 'one job',
    attachments: [{ blob: new Blob(['one durable original']) }],
  });
  await first.start();
  await entered.promise;
  await second.resume();
  await second.waitIdle();
  assert.equal(firstUploads, 1);
  assert.equal(secondUploads, 0);
  assert.equal((await second.read(job.operationId)).status, 'uploading');
  release.open();
  await first.waitIdle();
  await second.reconcile();
  assert.equal((await second.read(job.operationId)).status, 'acknowledged');
  assert.equal(secondUploads, 0);
  assert.equal((await first.read(job.operationId)).error, null);
});

test('expired lease takeover fences late progress/failure from the old worker after the new owner ACKs', async (t) => {
  const f = await fixture(t),
    entered = gate(),
    release = gate(),
    secondStorage = f.extraStorage();
  let at = Date.now();
  const first = f.make({
    clock: () => at,
    media: {
      async upload(file, options) {
        entered.open();
        await release.promise;
        options.onProgress({ transferred: 1, total: file.size });
        throw Object.assign(Error('late stale failure'), { code: 'SHARED_STALE_NETWORK_FAILURE' });
      },
    },
  });
  const second = f.make({ storage: secondStorage, clock: () => at });
  t.after(async () => {
    await first.dispose();
    await second.dispose();
    await secondStorage.close?.();
  });
  const job = await first.enqueue({
    conversationId: f.conversationId,
    text: 'takeover',
    attachments: [{ blob: new Blob(['lease original']) }],
  });
  await first.start();
  await entered.promise;
  at += 61000;
  await second.start();
  await second.waitIdle();
  const completed = await second.read(job.operationId);
  assert.equal(completed.status, 'acknowledged');
  assert.equal(completed.error, null);
  release.open();
  await first.waitIdle();
  const after = await second.read(job.operationId);
  assert.equal(after.status, 'acknowledged');
  assert.equal(after.error, null);
  assert.equal(after.attachments[0].transferred, after.attachments[0].size);
  assert.equal(after.attachments[0].asset.id, completed.attachments[0].asset.id);
  assert.equal(
    f.calls.filter(
      (call) => call.action === 'command' && call.input.operationId === job.operationId,
    ).length,
    1,
  );
});

test('dispose releases only its own lease so another controller resumes immediately and stale cleanup cannot erase the new lease', async (t) => {
  const f = await fixture(t),
    entered = gate(),
    release = gate(),
    secondStorage = f.extraStorage();
  const first = f.make({
    media: {
      async upload() {
        entered.open();
        await release.promise;
        throw Object.assign(Error('disposed'), { code: 'SHARED_DISPOSED_WORKER' });
      },
    },
  });
  const second = f.make({ storage: secondStorage });
  t.after(async () => {
    await first.dispose();
    await second.dispose();
    await secondStorage.close?.();
  });
  const job = await first.enqueue({
    conversationId: f.conversationId,
    text: 'immediate resume',
    attachments: [{ blob: new Blob(['dispose original']) }],
  });
  await first.start();
  await entered.promise;
  await first.dispose();
  await second.resume();
  await second.waitIdle();
  assert.equal((await second.read(job.operationId)).status, 'acknowledged');
  release.open();
  await first.waitIdle();
  assert.equal((await second.read(job.operationId)).status, 'acknowledged');
  assert.equal((await second.read(job.operationId)).error, null);
});

test('cold reopen waits once until the persisted lease expiry, re-arms after a renewal and automatically takes over a dead owner', async (t) => {
  const f = await fixture(t),
    entered = gate(),
    release = gate(),
    secondStorage = f.extraStorage();
  let at = Date.now(),
    secondUploads = 0;
  const firstTimers = leaseTimers(() => at),
    secondTimers = leaseTimers(() => at);
  const first = f.make({
    clock: () => at,
    timers: firstTimers,
    media: {
      async upload() {
        entered.open();
        await release.promise;
        throw Object.assign(Error('dead owner late result'), {
          code: 'SHARED_STALE_NETWORK_FAILURE',
        });
      },
    },
  });
  const second = f.make({
    clock: () => at,
    timers: secondTimers,
    storage: secondStorage,
    media: {
      async upload(...args) {
        secondUploads++;
        return f.media.upload(...args);
      },
    },
  });
  t.after(async () => {
    await first.dispose();
    await second.dispose();
    await secondStorage.close?.();
  });
  const job = await first.enqueue({
    conversationId: f.conversationId,
    text: 'cold reopen',
    attachments: [{ blob: new Blob(['restart original']) }],
  });
  await first.start();
  await entered.promise;
  await second.resume();
  await second.waitIdle();
  assert.equal(secondUploads, 0);
  assert.equal(secondTimers.timeouts().length, 1);
  const initialWake = secondTimers.timeouts()[0].at;
  at += 15000;
  firstTimers.fireIntervals();
  await f.storage.transaction((tx) => tx.getEntity('local-media-job', job.operationId));
  at = initialWake;
  secondTimers.fireDueTimeouts();
  await second.waitIdle();
  assert.equal(secondUploads, 0);
  assert.equal(secondTimers.timeouts().length, 1);
  assert.ok(secondTimers.timeouts()[0].at > initialWake);
  at = secondTimers.timeouts()[0].at;
  secondTimers.fireDueTimeouts();
  await second.waitIdle();
  assert.equal(secondUploads, 1);
  assert.equal((await second.read(job.operationId)).status, 'acknowledged');
  assert.equal(secondTimers.timeouts().length, 0);
  release.open();
  await first.waitIdle();
  assert.equal((await second.read(job.operationId)).error, null);
  await second.dispose();
  assert.equal(secondTimers.count(), 0);
  assert.equal(firstTimers.count(), 0);
});

test('dispose cancels the one lease-expiry wake without touching another controller lease', async (t) => {
  const f = await fixture(t),
    entered = gate(),
    release = gate(),
    secondStorage = f.extraStorage();
  let at = Date.now(),
    secondUploads = 0;
  const timers = leaseTimers(() => at),
    first = f.make({
      media: {
        async upload() {
          entered.open();
          await release.promise;
          throw Error('stopped');
        },
      },
    }),
    second = f.make({
      storage: secondStorage,
      clock: () => at,
      timers,
      media: {
        async upload() {
          secondUploads++;
          throw Error('unexpected');
        },
      },
    });
  t.after(async () => {
    await first.dispose();
    await second.dispose();
    await secondStorage.close?.();
  });
  const job = await first.enqueue({
    conversationId: f.conversationId,
    text: 'cancel wake',
    attachments: [{ blob: new Blob(['wake original']) }],
  });
  await first.start();
  await entered.promise;
  await second.resume();
  await second.waitIdle();
  assert.equal(timers.timeouts().length, 1);
  const lease = (
    await f.storage.transaction(
      async (tx) => (await tx.getEntity('local-media-job', job.operationId)).job.lease,
    )
  ).token;
  await second.dispose();
  assert.equal(timers.count(), 0);
  at += 61000;
  timers.fireDueTimeouts();
  assert.equal(secondUploads, 0);
  assert.equal(
    (
      await f.storage.transaction(
        async (tx) => (await tx.getEntity('local-media-job', job.operationId)).job.lease,
      )
    ).token,
    lease,
  );
  await first.dispose();
  release.open();
  await first.waitIdle();
});
