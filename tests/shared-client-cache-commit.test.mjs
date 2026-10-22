import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { createIndexedDbSyncStorage } from '../public/shared/sync-v2-client.js';
import { createSharedBusinessClient } from '../public/shared/shared-business-client.js';

test('real IDB enqueue atomically commits checkpoint/outbox/projection with canonical CAS; rollback and reopen preserve boundaries', async () => {
  const libraryId = randomUUID(),
    epoch = randomUUID(),
    indexedDB = new IDBFactory(),
    dbName = `shiye-sync-v2-cache-${randomUUID()}`;
  let storage = createIndexedDbSyncStorage({ indexedDB, dbName });
  const options = {
    libraryId,
    epoch,
    request: async () => {
      throw Error('offline');
    },
  };
  let client = createSharedBusinessClient({ ...options, storage });
  const operationId = randomUUID(),
    scope = 'capture:shared:thoughts';
  const input = {
    operationId,
    action: 'client-preferences-save',
    input: { scope: 'shared:thoughts', expectedRevision: 0, set: { theme: 'dark' } },
    optimistic: [
      { entityType: 'client-preferences', entityId: 'shared:thoughts', changes: { theme: 'dark' } },
    ],
    localCacheCommit: {
      scope,
      expectedValue: null,
      value: { operationId, baseline: { a: 1, b: 2 } },
    },
  };
  await client.enqueue(input);
  assert.deepEqual(await client.readCache(scope), input.localCacheCommit.value);
  const pending = await storage.transaction((tx) => tx.listPending());
  assert.equal(Object.hasOwn(pending[0].wire, 'localCacheCommit'), false);
  assert.equal(JSON.stringify(pending[0].wire).includes('baseline'), false);
  assert.equal(
    (await client.read('client-preferences', 'shared:thoughts')).local.data.theme,
    'dark',
  );
  const nextValue = { operationId: null, baseline: { a: 1, b: 2 } };
  await client.writeCache(scope, nextValue, { baseline: { b: 2, a: 1 }, operationId });
  await client.enqueue(input); // Idempotent replay cannot rewind a later checkpoint.
  assert.deepEqual(await client.readCache(scope), nextValue);
  await assert.rejects(() => client.enqueue({ ...input, operationId: randomUUID() }), {
    code: 'SHARED_CACHE_CONFLICT',
  });
  assert.equal((await client.status()).pending, 1);
  await assert.rejects(() => client.writeCache(scope, { overwritten: true }, null), {
    code: 'SHARED_CACHE_CONFLICT',
  });
  const failing = createSharedBusinessClient({
    ...options,
    storage: {
      transaction: (fn) =>
        storage.transaction(async (tx) => {
          await fn(tx);
          throw Error('DISK_ABORT');
        }),
    },
  });
  await assert.rejects(
    () =>
      failing.enqueue({
        ...input,
        operationId: randomUUID(),
        localCacheCommit: { scope, expectedValue: nextValue, value: { uncommitted: true } },
      }),
    /DISK_ABORT/,
  );
  assert.deepEqual(await client.readCache(scope), nextValue);
  assert.equal((await client.status()).pending, 1);
  await storage.close();
  storage = createIndexedDbSyncStorage({ indexedDB, dbName });
  client = createSharedBusinessClient({ ...options, storage });
  assert.deepEqual(await client.readCache(scope), nextValue);
  assert.equal((await client.status()).pending, 1);
  await client.writeCache('__proto__', { safe: true }, null);
  assert.deepEqual(await client.readCache('__proto__'), { safe: true });
  await client.writeCache(scope, 'legacy unconditional write');
  assert.equal(await client.readCache(scope), 'legacy unconditional write');
  await storage.close();
});
