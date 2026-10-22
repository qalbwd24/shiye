import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';

const source = await fs.readFile(
  new URL('../previews/telegram-chat/shiye-journal.js', import.meta.url),
  'utf8',
);
const settle = async () => {
  for (let i = 0; i < 12; i++) await new Promise(setImmediate);
};
function harness() {
  let now = 1000;
  const h = {
    reads: 0,
    copiedBytes: 0,
    actions: [],
    channels: {},
    intervals: [],
    timers: [],
    fail: false,
    hold: false,
    held: [],
    library: {
      messages: { a: [] },
      documents: [{ id: 7, bytes: new Uint8Array(32) }],
      shiyeRooms: { a: { title: 'synthetic' } },
    },
  };
  const configuration = {
    sourceId: 'synthetic',
    rooms: { a: { enabled: true, category: 'test' } },
  };
  let listener;
  const respond = (request) => {
    h.actions.push(request.action);
    if (request.action === (h.holdAction || 'status') && h.hold) {
      h.held.push(request);
      return;
    }
    const error =
      request.action === (h.failAction || 'status') && h.fail ? 'synthetic offline' : undefined;
    const result =
      request.action === 'status'
        ? { categories: ['test'], rooms: [] }
        : { accepted: (request.payload?.ids || []).map((id) => ({ id })) };
    queueMicrotask(() =>
      listener({ data: { kind: 'journal-result', id: request.id, result, error } }),
    );
  };
  h.release = () => {
    h.hold = false;
    h.held.splice(0).forEach(respond);
  };
  const indexedDB = {
    open(name) {
      const request = {};
      queueMicrotask(() => {
        request.result = {
          close() {},
          transaction() {
            const tx = {
              objectStore() {
                return {
                  get() {
                    const r = {};
                    queueMicrotask(() => {
                      if (name === 'shiye-telegram-preview-v1') {
                        h.reads++;
                        h.copiedBytes += h.library?.documents?.[0]?.bytes.byteLength || 0;
                        r.result = structuredClone(h.library);
                      } else r.result = structuredClone(configuration);
                      r.onsuccess();
                    });
                    return r;
                  },
                  put() {
                    queueMicrotask(() => tx.oncomplete());
                  },
                };
              },
            };
            return tx;
          },
        };
        request.onsuccess();
      });
      return request;
    },
  };
  class Channel {
    constructor(name) {
      this.name = name;
      h.channels[name] = this;
    }
    postMessage(message) {
      if (message.action !== 'withdrawal-ack') return;
      h.library.shiyeWithdrawalOutbox = [];
      queueMicrotask(() => {
        h.channels['shiye-journal-changes'].onmessage({ data: { action: 'saved' } });
        this.onmessage({ data: { requestId: message.requestId } });
      });
    }
  }
  const window = {
    chrome: {
      webview: {
        postMessage: respond,
        addEventListener(_name, fn) {
          listener = fn;
        },
      },
    },
    dispatchEvent() {},
  };
  vm.runInNewContext(source, {
    window,
    indexedDB,
    BroadcastChannel: Channel,
    crypto: { randomUUID },
    structuredClone,
    Uint8Array,
    TextEncoder,
    Event,
    Date: class extends Date {
      static now() {
        return now;
      }
    },
    setTimeout(fn, ms) {
      const timer = { fn, ms };
      h.timers.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      timer.cleared = true;
    },
    setInterval(fn) {
      h.intervals.push(fn);
    },
  });
  h.api = window.shiyeJournal;
  h.background = async (ms = 20000) => {
    now += ms;
    h.intervals[0]();
    await settle();
  };
  h.saved = () => h.channels['shiye-journal-changes'].onmessage({ data: { action: 'saved' } });
  return h;
}

test('initial scan, idle copies skipped, forced scan, and five minute safety scan', async () => {
  const h = harness();
  h.timers.find((t) => t.ms === 2000).fn();
  await settle();
  assert.equal(h.reads, 1);
  const success = (await h.api.status()).lastSuccess;
  for (let i = 0; i < 14; i++) await h.background();
  assert.equal(h.reads, 1);
  assert.equal(h.copiedBytes, 32);
  assert.equal((await h.api.status()).lastSuccess, success);
  await h.background();
  assert.equal(h.reads, 2);
  await h.api.flush();
  assert.equal(h.reads, 3);
});

test('saved broadcasts during a held scan survive completion and force requests rerun', async () => {
  const h = harness();
  await h.api.flush();
  h.hold = true;
  h.saved();
  await settle();
  assert.equal(h.reads, 1, 'bridge wait has not read any media');
  h.saved();
  const forced = h.api.flush();
  h.release();
  await forced;
  assert.equal(h.reads, 3, 'initial + in-flight + required rerun');
  await h.background();
  assert.equal(h.reads, 3);
});

test('a forced request during otherwise clean in-flight scan is not swallowed', async () => {
  const h = harness();
  await h.api.flush();
  h.hold = true;
  const first = h.api.flush();
  await settle();
  const second = h.api.flush();
  h.release();
  await Promise.all([first, second]);
  assert.equal(h.reads, 3);
});

test('failed scans retry without broadcasts and never read media while bridge fails', async () => {
  const h = harness();
  await h.api.flush();
  h.fail = true;
  await assert.rejects(h.api.flush(), /offline/);
  assert.equal(h.reads, 1);
  h.fail = false;
  await h.background();
  assert.equal(h.reads, 2);
  await h.background();
  assert.equal(h.reads, 2);
});

test('withdrawal ACK saved notification causes one finite follow-up scan', async () => {
  const h = harness();
  h.library.shiyeWithdrawalOutbox = [
    {
      roomId: 'a',
      messageId: '12',
      operationId: 'withdraw-1',
      sentAt: '2026-01-01',
      requestedAt: '2026-01-02',
    },
  ];
  await h.api.flush();
  assert.equal(h.reads, 2);
  assert.equal(h.actions.filter((a) => a === 'withdraw').length, 1);
  await h.background();
  assert.equal(h.reads, 2);
});

test('configure enabled and stickerSource remain forced; missing library does not claim saved', async () => {
  const h = harness();
  await h.api.flush();
  await h.api.configure('a', true, 'test');
  assert.equal(h.reads, 2);
  await h.api.stickerSource('a', '42');
  assert.equal(h.reads, 3);
  const empty = harness();
  empty.library = undefined;
  await empty.api.flush();
  assert.equal((await empty.api.status()).lastSuccess, undefined);
  await empty.background();
  assert.equal(empty.reads, 1);
  empty.library = { messages: {}, documents: [], shiyeRooms: {} };
  empty.saved();
  await settle();
  assert.equal(empty.reads, 2);
});

test('broadcast after library read reruns, and failure after read stays retryable', async () => {
  const h = harness();
  await h.api.flush();
  h.holdAction = 'room';
  h.hold = true;
  h.saved();
  await settle();
  assert.equal(h.reads, 2);
  h.saved();
  h.release();
  await settle();
  assert.equal(h.reads, 3);
  h.failAction = 'room';
  h.fail = true;
  await assert.rejects(h.api.flush(), /offline/);
  assert.equal(h.reads, 4);
  h.fail = false;
  await h.background();
  assert.equal(h.reads, 5);
  await h.background();
  assert.equal(h.reads, 5);
});
