import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { transform } from 'esbuild';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';

const source = await fs.readFile(
  new URL(
    '../previews/telegram-chat/vendor/web-a/src/util/shiyeWithdrawalRecoveryStore.ts',
    import.meta.url,
  ),
  'utf8',
);
const compiled = await transform(source, { loader: 'ts', format: 'esm', target: 'es2022' });
const { createWithdrawalRecoveryStore } = await import(
  'data:text/javascript;base64,' + Buffer.from(compiled.code).toString('base64')
);
const record = () => ({
  chatId: '-101',
  messageId: 317,
  date: 1,
  orderRootId: 311,
  replacesMessageId: 317,
  text: { text: '**原文**', entities: [{ type: 'bold', offset: 0, length: 2 }] },
  media: {
    id: '123456',
    mediaType: 'document',
    mimeType: 'image/gif',
    fileName: '原件.gif',
    isVideo: false,
    isLottie: false,
  },
  reply: { type: 'message', replyToMsgId: 300, replyToPeerId: '-101' },
  target: {
    instanceId: 'instance-a',
    batchId: 'batch-a',
    deliveryId: 'delivery-a',
    occurrenceId: 'media-a',
  },
  scope: { roomId: '-101', instanceId: 'instance-a', bindingId: 'binding-a' },
});

test('original formatted text, media identity, reply, scope and ordering survive close and reopen without expiry', async () => {
  const indexedDB = new IDBFactory();
  const first = createWithdrawalRecoveryStore({ indexedDB }),
    original = record();
  const saving = first.put('-101:317', original);
  original.text.text = '调用方随后修改';
  original.target.instanceId = 'changed';
  await saving;
  await first.close();
  const reopened = createWithdrawalRecoveryStore({ indexedDB });
  assert.deepEqual(await reopened.keys(), ['-101:317']);
  const restored = await reopened.get('-101:317');
  assert.deepEqual(restored, record());
  assert.equal(restored.date, 1, 'old messages have no TTL');
  restored.text.text = '修改读回副本';
  assert.equal((await reopened.get('-101:317')).text.text, '**原文**');
  await reopened.close();
});

test('keys startup scan uses only getAllKeys and never reads cached bodies', async (t) => {
  const store = createWithdrawalRecoveryStore({ indexedDB: new IDBFactory() });
  await store.put('a:1', record());
  await store.put('b:2', record());
  const originalGet = IDBObjectStore.prototype.get,
    originalGetAll = IDBObjectStore.prototype.getAll;
  IDBObjectStore.prototype.get = () => {
    throw Error('body read forbidden during key scan');
  };
  IDBObjectStore.prototype.getAll = () => {
    throw Error('bulk body read forbidden during key scan');
  };
  t.after(() => {
    IDBObjectStore.prototype.get = originalGet;
    IDBObjectStore.prototype.getAll = originalGetAll;
  });
  assert.deepEqual(await store.keys(), ['a:1', 'b:2']);
  await store.close();
});

test('put acknowledges only after transaction complete, never request success alone', async () => {
  const indexedDB = new IDBFactory(),
    events = [];
  const opening = indexedDB.open('transaction-proof', 1);
  opening.onupgradeneeded = () => opening.result.createObjectStore('recoveries');
  const database = await new Promise((resolve, reject) => {
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = reject;
  });
  const originalOpen = indexedDB.open.bind(indexedDB);
  indexedDB.open = (...args) => {
    const request = originalOpen(...args);
    request.addEventListener('success', () => {
      const db = request.result,
        transaction = db.transaction.bind(db);
      db.transaction = (...input) => {
        const tx = transaction(...input);
        if (input[1] === 'readwrite') {
          tx.addEventListener('complete', () => events.push('transaction-complete'));
          const objectStore = tx.objectStore.bind(tx);
          tx.objectStore = (...names) => {
            const object = objectStore(...names),
              put = object.put.bind(object);
            object.put = (...values) => {
              const result = put(...values);
              result.addEventListener('success', () => events.push('request-success'));
              return result;
            };
            return object;
          };
        }
        return tx;
      };
    });
    return request;
  };
  const store = createWithdrawalRecoveryStore({ indexedDB, dbName: 'transaction-proof' });
  await store.put('key', record());
  events.push('put-resolved');
  assert.deepEqual(events, ['request-success', 'transaction-complete', 'put-resolved']);
  await store.close();
  database.close();
});

test('a successful request followed by transaction abort never falsely acknowledges persistence', async () => {
  const indexedDB = new IDBFactory(),
    open = indexedDB.open.bind(indexedDB);
  indexedDB.open = (...args) => {
    const request = open(...args);
    request.addEventListener('success', () => {
      const db = request.result,
        transaction = db.transaction.bind(db);
      db.transaction = (...input) => {
        const tx = transaction(...input);
        if (input[1] === 'readwrite') tx.addEventListener('success', () => tx.abort());
        if (input[1] === 'readwrite') {
          const objectStore = tx.objectStore.bind(tx);
          tx.objectStore = (...names) => {
            const object = objectStore(...names),
              put = object.put.bind(object);
            object.put = (...values) => {
              const result = put(...values);
              result.addEventListener('success', () => tx.abort());
              return result;
            };
            return object;
          };
        }
        return tx;
      };
    });
    return request;
  };
  const store = createWithdrawalRecoveryStore({ indexedDB });
  await assert.rejects(store.put('key', record()), /取消|失败/);
  assert.equal(await store.get('key'), undefined);
  await store.close();
});

test('binary data and object URLs are rejected while original text remains unrestricted', async () => {
  const store = createWithdrawalRecoveryStore({ indexedDB: new IDBFactory() });
  for (const value of [
    new Uint8Array([1, 2]),
    new ArrayBuffer(8),
    new Blob(['file']),
    { media: { url: 'blob:https://app/temporary' } },
    { bytes: [1, 2] },
    { objectURL: 'temporary' },
  ]) {
    await assert.rejects(store.put('invalid', value), TypeError);
  }
  assert.deepEqual(await store.keys(), []);
  await store.put('original', { text: { text: 'blob: is literal original text' } });
  assert.equal((await store.get('original')).text.text, 'blob: is literal original text');
  await store.close();
});

test('remove commits independently and does not alter recovery records belonging to another room', async () => {
  const indexedDB = new IDBFactory(),
    store = createWithdrawalRecoveryStore({ indexedDB });
  await store.put('-101:317', record());
  await store.put('-202:317', { ...record(), chatId: '-202' });
  await store.remove('-101:317');
  await store.close();
  const reopened = createWithdrawalRecoveryStore({ indexedDB });
  assert.equal(await reopened.get('-101:317'), undefined);
  assert.deepEqual(await reopened.keys(), ['-202:317']);
  assert.equal((await reopened.get('-202:317')).chatId, '-202');
  await reopened.close();
});
