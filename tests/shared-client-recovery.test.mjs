import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { IDBFactory } from 'fake-indexeddb';
import { createDiaryServer } from '../src/server/app.mjs';
import { createIndexedDbSyncStorage } from '../public/shared/sync-v2-client.js';
import { createSharedBusinessClient } from '../public/shared/shared-business-client.js';

const error = (code, status) => Object.assign(Error(code), { code, status });
const row = (revision) => ({
  entityType: 'entry',
  entityId: 'one',
  revision,
  seq: revision,
  state: 'active',
  data: { title: `v${revision}` },
});
async function fixture(t, custom) {
  const libraryId = randomUUID(),
    epoch = randomUUID(),
    info = { libraryId, epoch, seq: 20 };
  const indexedDB = new IDBFactory(),
    dbName = `shiye-sync-v2-recovery-${randomUUID()}`;
  let storage = createIndexedDbSyncStorage({ indexedDB, dbName });
  const calls = [];
  const request = async (action, input) => {
    calls.push({ action, input });
    const value = await custom?.(action, input, info);
    if (value !== undefined) return value;
    if (action === 'info') return info;
    if (action === 'command')
      return { info, operationId: input.operationId, result: { entryId: 'one' } };
    return {
      info,
      [action === 'snapshot' ? 'entities' : 'changes']: action === 'snapshot' ? [row(1)] : [],
      next: 20,
      watermark: 20,
      hasMore: false,
    };
  };
  let client = createSharedBusinessClient({
    storage,
    request,
    libraryId,
    epoch,
    preparePayload: async () => {},
  });
  t.after(() => storage.close());
  return {
    calls,
    info,
    get client() {
      return client;
    },
    get storage() {
      return storage;
    },
    async reopen() {
      await storage.close();
      storage = createIndexedDbSyncStorage({ indexedDB, dbName });
      client = createSharedBusinessClient({
        storage,
        request,
        libraryId,
        epoch,
        preparePayload: async () => {},
      });
    },
  };
}
const command = (operationId = randomUUID()) => ({
  operationId,
  action: 'entry-save',
  input: { entryId: 'one', revision: 1 },
  optimistic: [{ entityType: 'entry', entityId: 'one', changes: { title: '待发' } }],
});

test('expired cursor resnapshots once preserving base/drafts/outbox Blob and optimistic projection across IDB reopen', async (t) => {
  let expire = false,
    newSnapshot = false;
  const f = await fixture(t, (action, input, info) => {
    if (action === 'pull' && expire) {
      expire = false;
      newSnapshot = true;
      throw error('SHARED_RESNAPSHOT_REQUIRED', 409);
    }
    if (action === 'snapshot' && newSnapshot)
      return { info, entities: [row(2)], next: 'final', watermark: 20, hasMore: false };
  });
  await f.client.receive();
  await f.client.setDraft('room', { text: '原草稿', replyId: null });
  const blob = new Blob(['local ref']),
    payloadOperationId = randomUUID();
  const sha256 = createHash('sha256').update('local ref').digest('hex');
  await f.client.enqueue({
    ...command(),
    action: 'entry-save-ref',
    input: { entryId: 'one', payloadOperationId },
    localPayload: { operationId: payloadOperationId, blob, size: blob.size, sha256 },
  });
  const before = await f.client.status();
  expire = true;
  await f.client.receive();
  assert.equal((await f.client.read('entry', 'one')).base.revision, 2);
  assert.equal((await f.client.read('entry', 'one')).local.data.title, '待发');
  assert.deepEqual((await f.client.status()).drafts, before.drafts);
  assert.equal((await f.client.status()).pending, 1);
  await f.reopen();
  const pending = await f.storage.transaction((tx) => tx.listPending());
  assert.equal(pending[0].localPayload.blob instanceof Blob, true);
  assert.equal(await pending[0].localPayload.blob.text(), 'local ref');
  assert.equal((await f.client.status()).initialized, true);
});

test('one sync cannot spin repeated resnapshot; read concurrency failures preserve cursor and do not permanently pause', async (t) => {
  let mode = 'normal';
  const f = await fixture(t, async (action) => {
    if (action === 'pull' && mode === 'expired') throw error('SHARED_RESNAPSHOT_REQUIRED', 409);
    if (action === 'pull' && mode === 'changed') throw error('SHARED_ENTITY_CHANGED', 409);
    if (action === 'pull' && mode === 'cursor') {
      await f.storage.transaction(async (tx) => {
        const meta = await tx.getMeta();
        meta.cursor = 19;
        await tx.setMeta(meta);
      });
    }
  });
  await f.client.sync();
  mode = 'expired';
  f.calls.length = 0;
  await assert.rejects(() => f.client.sync(), { code: 'SHARED_RESNAPSHOT_REQUIRED' });
  assert.equal(f.calls.filter((c) => c.action === 'snapshot').length, 1);
  assert.equal(f.calls.filter((c) => c.action === 'pull').length, 2);
  assert.equal((await f.client.status()).paused, null);
  const resetCursor = (await f.client.status()).cursor;
  mode = 'changed';
  await assert.rejects(() => f.client.sync(), { code: 'SHARED_ENTITY_CHANGED' });
  assert.equal((await f.client.status()).paused, null);
  assert.deepEqual((await f.client.status()).cursor, resetCursor);
  mode = 'cursor';
  await assert.rejects(() => f.client.sync(), { code: 'SHARED_CURSOR_CHANGED' });
  assert.equal((await f.client.status()).paused, null);
  assert.equal((await f.client.status()).cursor, 19);
  mode = 'normal';
  await f.client.sync();
});

test('deterministic rejection stops automatic resend; retry is unchanged and discard durably recovers original command', async (t) => {
  let reject = true;
  const f = await fixture(t, (action) => {
    if (action === 'command' && reject) throw error('INVALID', 422);
  });
  await f.client.receive();
  await f.client.setDraft('room', { text: '保留草稿', replyId: null });
  const input = command();
  const blob = new Blob(['recovered local body']),
    payloadOperationId = randomUUID();
  input.action = 'entry-save-ref';
  input.input.payloadOperationId = payloadOperationId;
  input.localPayload = {
    operationId: payloadOperationId,
    blob,
    size: blob.size,
    sha256: createHash('sha256').update('recovered local body').digest('hex'),
  };
  await f.client.enqueue(input);
  await assert.rejects(() => f.client.sync(), { code: 'INVALID' });
  assert.equal(
    (await f.client.status()).paused.operationId,
    input.operationId,
    'outer run catch preserves command identity',
  );
  const count = f.calls.filter((c) => c.action === 'command').length;
  await f.client.sync();
  assert.equal(f.calls.filter((c) => c.action === 'command').length, count);
  await f.client.retryBlocked({ operationId: input.operationId, mode: 'retry-unchanged' });
  await assert.rejects(() => f.client.sync(), { code: 'INVALID' });
  assert.deepEqual(
    f.calls.filter((c) => c.action === 'command')[0].input,
    f.calls.filter((c) => c.action === 'command')[1].input,
  );
  await f.client.reconcileBlocked({ operationId: input.operationId, mode: 'discard' });
  assert.equal((await f.client.readOperation(input.operationId)).status, 'recovered');
  assert.equal((await f.client.status()).pending, 0);
  assert.equal((await f.client.readDraft('room')).text, '保留草稿');
  await f.reopen();
  const recovered = (await f.client.status()).recoveredCommands[0];
  assert.equal(recovered.wire.operationId, input.operationId);
  assert.deepEqual(recovered.optimistic, input.optimistic);
  assert.equal(await recovered.localPayload.blob.text(), 'recovered local body');
  assert.equal((await f.client.read('entry', 'one')).local.data.title, 'v1');
  await assert.rejects(() => f.client.enqueue(input), {
    code: 'SHARED_RECOVERED_OPERATION_REQUIRES_NEW_ID',
  });
  reject = false;
  await f.client.enqueue(command());
  await f.client.sync();
  assert.equal((await f.client.status()).pending, 0);
});

test('409 business conflict requires new operation; unknown ACK can never be discarded', async (t) => {
  let mode = 'conflict';
  const f = await fixture(t, (action) => {
    if (action === 'command') {
      if (mode === 'network') throw Error('NETWORK_UNKNOWN_ACK');
      if (mode === 'conflict') throw error('SHARED_BUSINESS_CONFLICT', 409);
    }
  });
  await f.client.receive();
  const old = command();
  await f.client.enqueue(old);
  await assert.rejects(() => f.client.sync());
  await assert.rejects(
    () => f.client.retryBlocked({ operationId: old.operationId, mode: 'retry-unchanged' }),
    { code: 'SHARED_COMMAND_REQUIRES_NEW_OPERATION' },
  );
  const next = command();
  await f.client.enqueue(next);
  await f.client.reconcileBlocked({ operationId: old.operationId, mode: 'discard' });
  mode = 'network';
  await assert.rejects(() => f.client.sync(), /NETWORK_UNKNOWN_ACK/);
  mode = 'conflict';
  await assert.rejects(() => f.client.sync());
  await assert.rejects(
    () => f.client.reconcileBlocked({ operationId: next.operationId, mode: 'discard' }),
    { code: 'SHARED_COMMAND_NOT_RECONCILABLE' },
  );
  assert.equal((await f.client.status()).pending, 1);
});

test('actual HTTP 404 command blocks once then explicit discard preserves recovered pending without ACK receipt', async (t) => {
  const root = path.resolve('tmp/backend-shared-auth/client-recovery');
  await mkdir(root, { recursive: true });
  const dataDir = await mkdtemp(path.join(root, 'case-'));
  const server = await createDiaryServer({ dataDir, seed: false, sharedSync: true });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.close();
    await once(server, 'close');
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (action, input) => {
    const r = await fetch(base + '/api/shared/v1/' + action, {
      method: action === 'info' ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Diary-Client': 'desktop' },
      ...(action === 'info' ? {} : { body: JSON.stringify(input) }),
    });
    const value = await r.json();
    if (!r.ok) throw error(value.error.code, r.status);
    return value;
  };
  const info = await request('info');
  const indexedDB = new IDBFactory();
  const storage = createIndexedDbSyncStorage({
    indexedDB,
    dbName: `shiye-sync-v2-http-recovery-${randomUUID()}`,
  });
  t.after(() => storage.close());
  const client = createSharedBusinessClient({
    request,
    storage,
    libraryId: info.libraryId,
    epoch: info.epoch,
  });
  await client.receive();
  const operationId = randomUUID();
  await client.enqueue({
    operationId,
    action: 'entry-delete',
    input: { entryId: randomUUID(), revision: 1 },
  });
  await assert.rejects(
    () => client.sync(),
    (e) => e.status === 404,
  );
  assert.equal((await client.status()).paused.operationId, operationId);
  assert.equal((await client.sync()).paused.operationId, operationId);
  await client.reconcileBlocked({ operationId, mode: 'discard' });
  assert.equal((await client.readOperation(operationId)).status, 'recovered');
  assert.equal((await client.status()).commandReceipts?.length || 0, 0);
});
