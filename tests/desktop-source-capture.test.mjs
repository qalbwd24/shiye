import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import {
  captureDesktopSource,
  DESKTOP_CAPTURE_PREFERENCE_KEYS,
} from '../previews/telegram-chat/shiye-desktop-source-capture.js';
import { DESKTOP_PORTABLE_PREFERENCE_KEYS } from '../previews/telegram-chat/shiye-shared-directory-port.js';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sourceId = '11111111-1111-4111-8111-111111111111';
const storage = () => {
  const values = new Map([
    ['shiye-room-appearance-v1', '{"-103":{"unknown":1}}'],
    ['shiye-room-order-v1', '["-103"]'],
    ['private-token-example', 'secret-not-captured'],
  ]);
  return {
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
    setItem: (key, value) => values.set(key, value),
  };
};
async function put(indexedDB, name, store, key, value) {
  await new Promise((resolve, reject) => {
    const open = indexedDB.open(name, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(store);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result,
        tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    };
  });
}
async function fixture() {
  const indexedDB = new IDBFactory(),
    localStorage = storage();
  const bytes = new Uint8Array(400000);
  bytes[1] = 255;
  const library = {
    messages: {
      '20000000000000000001': {
        id: '20000000000000000001',
        sentAt: '2026-10-19T00:00:00Z',
        replacementMediaIntent: 'keep',
        localForward: { requestId: 'private-pending' },
      },
    },
    documents: { doc: { bytes, size: 400000n } },
    shiyeRooms: { '-103': { unknown: { value: true } } },
    drafts: { '-103': { text: 'draft-only' } },
    unknownNested: [undefined, -0, BigInt('20000000000000000001')],
  };
  await put(indexedDB, 'shiye-journal-link-v1', 'settings', 'link', {
    sourceId,
    rooms: { '-103': {} },
  });
  await put(indexedDB, 'shiye-telegram-preview-v1', 'preview', 'library', library);
  return { indexedDB, localStorage, library, bytes };
}

test('private existing-IDB capture keeps bigint, 20-digit IDs, binary bytes, unknown fields and drafts with bounded verified messages', async () => {
  const f = await fixture(),
    events = [],
    members = new Map();
  const summary = await captureDesktopSource({ ...f, emit: async (event) => events.push(event) });
  for (const event of events) {
    assert.ok(Buffer.byteLength(JSON.stringify(event)) < 256 * 1024);
    if (event.kind === 'member-start') members.set(event.path, []);
    if (event.kind === 'member-chunk') {
      const list = members.get(event.path);
      assert.equal(event.index, list.length);
      list.push(Buffer.from(event.dataBase64, 'base64'));
    }
    if (event.kind === 'member-end') {
      const bytes = Buffer.concat(members.get(event.path));
      assert.equal(bytes.length, event.size);
      assert.equal(sha(bytes), event.sha256);
    }
  }
  const graph = JSON.parse(Buffer.concat(members.get('logical/library.typed.json')));
  const serialized = JSON.stringify(graph);
  assert.ok(serialized.includes('20000000000000000001'));
  assert.ok(
    graph.nodes.some((n) =>
      n.values?.some((pair) => pair[1]?.[0] === 'bigint' && pair[1][1] === '400000'),
    ),
  );
  assert.ok(serialized.includes('replacementMediaIntent'));
  assert.ok(serialized.includes('draft-only'));
  assert.deepEqual(Buffer.concat(members.get('media/' + sha(f.bytes))), Buffer.from(f.bytes));
  const preferences = JSON.parse(Buffer.concat(members.get('logical/preferences.json')));
  assert.equal(preferences.values['shiye-room-appearance-v1'], '{"-103":{"unknown":1}}');
  assert.deepEqual(preferences.uncollectedKeys, ['private-token-example']);
  assert.ok(!JSON.stringify(events).includes('secret-not-captured'));
  assert.equal(summary.sourceId, sourceId);
  assert.equal(summary.directlyImportable, false);
  assert.equal(summary.completeComputerExport, false);
  assert.equal(summary.counts.uncollectedStorageKeys, 1);
  assert.deepEqual(
    DESKTOP_CAPTURE_PREFERENCE_KEYS,
    DESKTOP_PORTABLE_PREFERENCE_KEYS.map((k) => (typeof k === 'string' ? k : k.key)),
  );
});

test('generation changes and sink failure cannot publish complete; missing databases do not get initialized', async () => {
  const f = await fixture(),
    events = [];
  let changed = false;
  await assert.rejects(
    () =>
      captureDesktopSource({
        ...f,
        emit: async (event) => {
          events.push(event);
          if (!changed) {
            changed = true;
            await put(f.indexedDB, 'shiye-telegram-preview-v1', 'preview', 'library', {
              ...f.library,
              late: 'new-generation',
            });
          }
        },
      }),
    { code: 'DESKTOP_SOURCE_CHANGED' },
  );
  assert.ok(!events.some((e) => e.kind === 'complete'));
  const again = await fixture();
  await assert.rejects(
    () =>
      captureDesktopSource({
        ...again,
        emit: async () => {
          throw Error('synthetic disk failure');
        },
      }),
    /synthetic disk failure/,
  );
  const empty = new IDBFactory();
  await assert.rejects(
    () => captureDesktopSource({ indexedDB: empty, localStorage: storage(), emit: async () => {} }),
    /DESKTOP_CAPTURE_DATABASE/,
  );
  assert.deepEqual(await empty.databases(), []);
});

test('existing wallpaper/sticker/mapping/order and withdrawal originals remain private typed resources; legacy data URL is split without migrating', async () => {
  const f = await fixture(),
    events = [];
  await put(f.indexedDB, 'shiye-preview-assets-v1', 'assets', 'wallpaper:room:fixture', {
    id: 'wallpaper:room:fixture',
    blob: new Blob(['wallpaper-original'], { type: 'image/png' }),
  });
  await put(f.indexedDB, 'shiye-preview-assets-v1', 'assets', 'sticker:fixture', {
    id: 'sticker:fixture',
    name: 'animated original',
    blob: new Blob(['GIF89a'], { type: 'image/gif' }),
    previewBlob: new Blob(['preview-only']),
    serverId: null,
    pending: true,
  });
  await put(f.indexedDB, 'shiye-preview-assets-v1', 'assets', 'mapping:fixture', {
    id: 'mapping:fixture',
    kind: 'sticker',
    assetId: 'sticker:fixture',
  });
  await put(f.indexedDB, 'shiye-withdrawal-recovery-v2', 'recoveries', 'private-recovery', {
    messageId: '20000000000000000001',
    text: 'withdrawn-private-not-shared',
    blob: new Blob(['recovery-only']),
  });
  const raw = JSON.stringify({ wallpaper: 'data:image/png;base64,AQID', unknown: false });
  f.localStorage.setItem('shiye-preview-appearance-v1', raw);
  f.localStorage.setItem(
    'shiye-room-switch-sidebar-v1',
    '{"previousMode":"direct","effectivePreviousMode":"sidebar"}',
  );
  f.localStorage.setItem('shiye-switch-timing-v2', '1');
  f.localStorage.setItem('tt-last-activity', 'never-read-or-restore-this-time');
  const readSetting = f.localStorage.getItem;
  f.localStorage.getItem = (key) => {
    assert.notEqual(key, 'tt-last-activity');
    return readSetting(key);
  };
  const summary = await captureDesktopSource({ ...f, emit: async (event) => events.push(event) });
  assert.equal(summary.counts.assetRecords, 3);
  assert.equal(summary.counts.withdrawalRecoveryRecords, 1);
  const memberBytes = (path) =>
    Buffer.concat(
      events
        .filter((e) => e.kind === 'member-chunk' && e.path === path)
        .map((e) => Buffer.from(e.dataBase64, 'base64')),
    );
  assert.ok(memberBytes('logical/assets.typed.json').toString().includes('sticker:fixture'));
  assert.ok(
    memberBytes('logical/withdrawal-recovery.typed.json')
      .toString()
      .includes('withdrawn-private-not-shared'),
  );
  assert.deepEqual(memberBytes('media/' + sha(Buffer.from([1, 2, 3]))), Buffer.from([1, 2, 3]));
  assert.equal(f.localStorage.getItem('shiye-preview-appearance-v1'), raw);
  const preferences = JSON.parse(memberBytes('logical/preferences.json'));
  assert.equal(preferences.values['shiye-switch-timing-v2'], '1');
  assert.equal(
    preferences.values['shiye-room-switch-sidebar-v1'],
    '{"previousMode":"direct","effectivePreviousMode":"sidebar"}',
  );
  assert.ok(
    preferences.excludedKeys.some(
      (item) =>
        item.key === 'tt-last-activity' && item.reason.includes('never-uploaded-or-restored'),
    ),
  );
  assert.ok(!JSON.stringify(events).includes('never-read-or-restore-this-time'));
  assert.ok(!JSON.stringify(summary).includes('withdrawn-private-not-shared'));
  assert.equal(summary.completeComputerExport, false);
});
