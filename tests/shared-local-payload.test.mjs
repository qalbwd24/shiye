import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { createIndexedDbSyncStorage } from '../public/shared/sync-v2-client.js';
import { createSharedBusinessClient } from '../public/shared/shared-business-client.js';

test('offline Blob and immutable ref survive IDB reopening/upload failure/lost ACK; ACK removes Blob with pending', async () => {
  const libraryId = randomUUID(),
    epoch = randomUUID(),
    operationId = randomUUID(),
    payloadOperationId = randomUUID();
  const blob = new Blob(['SYNTHETIC_LOCAL_BODY'.repeat(280000)], { type: 'application/json' });
  const sha256 = createHash('sha256')
    .update(Buffer.from(await blob.arrayBuffer()))
    .digest('hex');
  const indexedDB = new IDBFactory(),
    dbName = `shiye-sync-v2-blob-${randomUUID()}`;
  let storage = createIndexedDbSyncStorage({ indexedDB, dbName }),
    offline = true,
    lost = true,
    serverWrites = 0;
  const sent = [],
    prepared = [];
  const request = async (action, wire) => {
    const info = { libraryId, epoch, seq: 1 };
    if (action === 'info') return info;
    if (action !== 'command')
      return {
        info,
        [action === 'snapshot' ? 'entities' : 'changes']: [],
        hasMore: false,
        next: 1,
      };
    sent.push(structuredClone(wire));
    if (!serverWrites) serverWrites++;
    if (lost) {
      lost = false;
      throw Error('ACK_LOST');
    }
    return { info, operationId, result: { entryId: 'entry-one' }, replayed: true };
  };
  const preparePayload = async (job) => {
    assert.equal(job.blob instanceof Blob, true);
    assert.equal(job.blob.size, blob.size);
    assert.equal(
      createHash('sha256')
        .update(Buffer.from(await job.blob.arrayBuffer()))
        .digest('hex'),
      sha256,
    );
    prepared.push({ operationId: job.operationId, sha256: job.sha256, size: job.size });
    if (offline) throw Error('UPLOAD_OFFLINE');
  };
  const open = () =>
    createSharedBusinessClient({ request, preparePayload, storage, libraryId, epoch });
  let client = open();
  const command = {
    operationId,
    action: 'entry-create-ref',
    input: { payloadOperationId },
    localPayload: { operationId: payloadOperationId, blob, sha256, size: blob.size },
    optimistic: [{ entityType: 'entry', entityId: 'entry-one', changes: { title: '本地' } }],
  };
  await client.enqueue(command);
  await assert.rejects(() => client.flush(), /UPLOAD_OFFLINE/);
  assert.equal(sent.length, 0);
  await storage.close();
  storage = createIndexedDbSyncStorage({ indexedDB, dbName });
  client = open();
  const pending = await storage.transaction((tx) => tx.listPending());
  assert.equal(pending[0].localPayload.blob instanceof Blob, true);
  assert.equal(pending[0].localPayload.blob.size, blob.size);
  await assert.rejects(
    () =>
      client.enqueue({
        ...command,
        localPayload: { ...command.localPayload, sha256: 'a'.repeat(64) },
      }),
    { code: 'SHARED_OPERATION_REUSED' },
  );
  offline = false;
  await assert.rejects(() => client.flush(), /ACK_LOST/);
  assert.equal((await client.status()).pending, 1);
  await storage.close();
  storage = createIndexedDbSyncStorage({ indexedDB, dbName });
  client = open();
  await client.flush();
  assert.equal(serverWrites, 1);
  assert.deepEqual(sent[0], sent[1]);
  assert.equal(JSON.stringify(sent).includes('SYNTHETIC_LOCAL_BODY'), false);
  assert.equal(JSON.stringify(sent).includes('localPayload'), false);
  assert.equal((await client.status()).pending, 0);
  assert.equal(JSON.stringify(await client.status()).includes('blob'), false);
  assert.deepEqual(
    prepared.map((p) => p.operationId),
    [payloadOperationId, payloadOperationId, payloadOperationId],
  );
  await storage.close();
});
