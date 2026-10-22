import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';

const source = await fs.readFile(
  new URL('../previews/telegram-chat/shiye-journal.js', import.meta.url),
  'utf8',
);
function launch(indexedDB) {
  const window = { dispatchEvent() {} };
  class Channel {
    postMessage() {}
  }
  vm.runInNewContext(source, {
    window,
    indexedDB,
    BroadcastChannel: Channel,
    crypto: { randomUUID },
    structuredClone,
    Event,
    setTimeout() {},
    clearTimeout() {},
    setInterval() {},
  });
  return window.shiyeJournal;
}
async function read(indexedDB) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('shiye-journal-link-v1', 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('settings').objectStore('settings').get('link');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
test('concurrent first windows expose the one durably committed source identity', async () => {
  const indexedDB = new IDBFactory();
  const windows = Array.from({ length: 8 }, () => launch(indexedDB));
  const ids = await Promise.all(windows.map((w) => w.sourceId()));
  assert.equal(new Set(ids).size, 1);
  assert.match(ids[0], /^[a-f\d-]{36}$/);
  assert.equal((await read(indexedDB)).sourceId, ids[0]);
  assert.equal(await launch(indexedDB).sourceId(), ids[0]);
});
test('existing identity and per-room preferences survive new windows', async () => {
  const indexedDB = new IDBFactory();
  const first = launch(indexedDB),
    id = await first.sourceId();
  await first.configure('-101', false, '原分类');
  const before = await read(indexedDB);
  assert.equal(await launch(indexedDB).sourceId(), id);
  assert.deepEqual(await read(indexedDB), before);
});
