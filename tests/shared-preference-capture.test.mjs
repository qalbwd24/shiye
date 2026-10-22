import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { createDiaryServer } from '../src/server/app.mjs';
import { createSharedBusinessClient } from '../public/shared/shared-business-client.js';
import { createSharedDirectoryClient } from '../public/shared/shared-directory-client.js';
import { createMemorySyncStorage } from './helpers/sync-v2-client-memory.mjs';
import {
  createSharedPreferenceCapture,
  readLocalStoragePreferences,
  portablePreferences,
} from '../public/shared/shared-preference-capture.js';
import {
  readDesktopPortablePreferences,
  DESKTOP_PORTABLE_PREFERENCE_KEYS,
  startDesktopDirectoryPort,
} from '../previews/telegram-chat/shiye-shared-directory-port.js';

const diaryKeys = [
  'shiye.android.diary.presentation.v2',
  'shiye.android.diary.entry-image-width.v1',
  'shiye.android.diary.image-width-modes.v1',
];
const storage = (initial = {}) => {
  const values = new Map(Object.entries(initial)),
    reads = [];
  return {
    values,
    reads,
    getItem(key) {
      reads.push(key);
      return values.get(key) ?? null;
    },
  };
};
async function fixture(t) {
  const root = path.resolve('tmp/shared-preference-capture-tests');
  await mkdir(root, { recursive: true });
  const server = await createDiaryServer({
    dataDir: await mkdtemp(path.join(root, 'case-')),
    seed: false,
    sharedSync: true,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.close();
    await once(server, 'close');
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const commands = [];
  let loseAck = false;
  const request = async (action, input) => {
    if (action === 'command') commands.push(structuredClone(input));
    const response = await fetch(`${base}/api/shared/v1/${action}`, {
      method: action === 'info' ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Diary-Client': 'desktop' },
      ...(action === 'info' ? {} : { body: JSON.stringify(input) }),
    });
    const result = await response.json();
    if (!response.ok)
      throw Object.assign(Error(JSON.stringify(result)), { status: response.status });
    if (loseAck && action === 'command') {
      loseAck = false;
      throw Error('lost preference ACK');
    }
    return result;
  };
  const info = await request('info');
  const connect = (persistent = createMemorySyncStorage()) => ({
    persistent,
    client: createSharedBusinessClient({
      request,
      storage: persistent,
      libraryId: info.libraryId,
      epoch: info.epoch,
    }),
  });
  return {
    connect,
    commands,
    loseAck() {
      loseAck = true;
    },
  };
}

test('PC explicit startup defaults to known localStorage capture; scalar strings/unknown JSON are preserved in shared HTTP profile', async (t) => {
  const f = await fixture(t),
    pc = f.connect(),
    android = f.connect();
  const local = storage({
    'shiye-preview-appearance-v1': JSON.stringify({
      fontSize: 16,
      future: { flags: [false, 1, 'x'] },
      wallpaper: 'C:\\private\\image.png',
      token: 'secret-never-send',
    }),
    'shiye-room-appearance-v1': JSON.stringify({
      '-12345678901234567890': { shade: 0.9, unknown: ['keep'] },
    }),
    'shiye-input-commands-v1': JSON.stringify({ aliases: [{ name: '/a', value: '🙂' }] }),
    'shiye-input-manual-height-v1': '36',
    'shiye-markdown-enabled': 'true',
    'shiye-room-order-v1': '["-1"]',
    'shiye-input-history-v1': 'private-body',
  });
  const old = globalThis.localStorage;
  globalThis.localStorage = local;
  t.after(() => {
    if (old === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = old;
  });
  const port = startDesktopDirectoryPort({
    client: pc.client,
    directory: createSharedDirectoryClient({ client: pc.client }),
    readSnapshot: async () => ({ sourceId: '11111111-1111-4111-8111-111111111111', rooms: {} }),
    BroadcastChannel: null,
    events: null,
    pollMs: 0,
  });
  t.after(() => port.stop());
  await port.ready;
  await android.client.sync();
  let profile = (await android.client.read('client-preferences', 'desktop:thoughts')).local.data;
  assert.equal(profile.values['shiye-input-manual-height-v1'], '36');
  assert.equal(profile.values['shiye-markdown-enabled'], 'true');
  assert.deepEqual(profile.values['shiye-room-appearance-v1']['-12345678901234567890'].unknown, [
    'keep',
  ]);
  assert.deepEqual(profile.values['shiye-input-commands-v1'].aliases, [
    { name: '/a', value: '🙂' },
  ]);
  assert.equal(profile.values['shiye-preview-appearance-v1'].wallpaper, undefined);
  assert.equal(profile.values['shiye-preview-appearance-v1'].token, undefined);
  assert.equal(local.reads.includes('shiye-room-order-v1'), false);
  assert.equal(local.reads.includes('shiye-input-history-v1'), false);
  assert.equal(JSON.stringify(f.commands).includes('secret-never-send'), false);
  const count = f.commands.length;
  await port.collect();
  assert.equal(f.commands.length, count);
  local.values.set('shiye-input-manual-height-v1', '48');
  local.values.delete('shiye-markdown-enabled');
  await port.collect();
  const patch = f.commands.at(-1).input;
  assert.deepEqual(patch.set, { 'shiye-input-manual-height-v1': '48' });
  assert.deepEqual(patch.remove, ['shiye-markdown-enabled']);
  await android.client.sync();
  profile = (await android.client.read('client-preferences', 'desktop:thoughts')).local.data;
  assert.equal(profile.values['shiye-input-manual-height-v1'], '48');
  assert.equal(profile.values['shiye-markdown-enabled'], undefined);
  assert.deepEqual(profile.values['shiye-preview-appearance-v1'].future, {
    flags: [false, 1, 'x'],
  });
});

test('UI022 three original namespaces retain object/array/string values and unknown remote keys through patch/delete', async (t) => {
  const f = await fixture(t),
    a = f.connect(),
    b = f.connect();
  const local = storage({
    [diaryKeys[0]]: JSON.stringify([{ id: 'paper', future: ['unknown', false] }]),
    [diaryKeys[1]]: JSON.stringify({ entry: 'original', future: { width: 91 } }),
    [diaryKeys[2]]: JSON.stringify(['original', 'fit', { custom: true }]),
  });
  const capture = createSharedPreferenceCapture({
    client: a.client,
    scope: 'android:diary',
    storage: local,
    keys: diaryKeys.map((key) => ({ key, json: true })),
  });
  await b.client.enqueue({
    operationId: randomUUID(),
    action: 'client-preferences-save',
    input: {
      scope: 'android:diary',
      expectedRevision: 0,
      set: { unknownRemote: { future: [1] } },
      remove: [],
    },
  });
  await b.client.sync();
  assert.deepEqual((await capture.capture()).conflicts, []);
  await b.client.sync();
  let data = (await b.client.read('client-preferences', 'android:diary')).local.data;
  assert.deepEqual(data.values[diaryKeys[0]], [{ id: 'paper', future: ['unknown', false] }]);
  assert.deepEqual(data.values[diaryKeys[2]], ['original', 'fit', { custom: true }]);
  local.values.set(diaryKeys[0], JSON.stringify([{ id: 'night', future: ['unknown', false] }]));
  local.values.delete(diaryKeys[1]);
  assert.deepEqual((await capture.capture()).conflicts, []);
  await b.client.sync();
  data = (await b.client.read('client-preferences', 'android:diary')).local.data;
  assert.deepEqual(data.values.unknownRemote, { future: [1] });
  assert.equal(data.values[diaryKeys[1]], undefined);
  assert.deepEqual(data.values[diaryKeys[0]][0].future, ['unknown', false]);
});

test('durable atomic checkpoint survives lost ACK/client reopen, then refuses simultaneous remote/local settings edits', async (t) => {
  const f = await fixture(t),
    a = f.connect(),
    b = f.connect();
  let values = { appearance: { fontSize: 17, unknown: [1] } };
  const make = (client) =>
    createSharedPreferenceCapture({ client, scope: 'android:thoughts', localReader: () => values });
  f.loseAck();
  await assert.rejects(make(a.client).capture(), /lost preference ACK/);
  const first = f.commands[0];
  const checkpoint = await a.client.readCache('preference-capture:android:thoughts');
  assert.equal(checkpoint.operationId, first.operationId);
  assert.equal((await a.client.status()).pending, 1);
  const reopened = f.connect(a.persistent),
    capture = make(reopened.client);
  assert.deepEqual((await capture.capture()).conflicts, []);
  assert.deepEqual(
    f.commands.filter((c) => c.operationId === first.operationId),
    [first, first],
  );
  await b.client.sync();
  const data = (await b.client.read('client-preferences', 'android:thoughts')).local.data;
  await b.client.enqueue({
    operationId: randomUUID(),
    action: 'client-preferences-save',
    input: {
      scope: 'android:thoughts',
      expectedRevision: data.revision,
      set: { appearance: { fontSize: 21, androidUnknown: true } },
      remove: [],
    },
  });
  await b.client.sync();
  values = { appearance: { fontSize: 19, unknown: [1] } };
  const result = await capture.capture();
  assert.equal(result.conflicts.length, 1);
  assert.equal(
    (await reopened.client.read('client-preferences', 'android:thoughts')).local.data.values
      .appearance.fontSize,
    21,
  );
  assert.equal(values.appearance.fontSize, 19);
});

test('explicit portable readers reject unavailable/corrupt input and exclude credentials/resources/directory/runtime while preserving arrays', async () => {
  const source = {
    version: 1,
    pinIds: ['-1'],
    order: ['-2'],
    appearance: {
      theme: 'dark',
      future: [1, false, 'x'],
      localPath: 'D:\\private',
      credentials: { token: 'secret' },
      url: 'https://host/?token=secret',
    },
    roomAppearance: { '-20': [{ density: 4 }] },
    roomBackgrounds: { path: 'private' },
    activation: { granted: true },
    historyDraft: 'private-text',
  };
  const result = portablePreferences(source);
  assert.deepEqual(result.value, {
    version: 1,
    appearance: { theme: 'dark', future: [1, false, 'x'] },
    roomAppearance: { '-20': [{ density: 4 }] },
  });
  assert.equal(JSON.stringify(result).includes('private-text'), false);
  assert.equal(JSON.stringify(result).includes('D:\\\\private'), false);
  assert.ok(result.excluded.length >= 6);
  assert.throws(
    () => readLocalStoragePreferences({ storage: {}, keys: diaryKeys }),
    /STORAGE_UNAVAILABLE/,
  );
  assert.throws(
    () =>
      readLocalStoragePreferences({
        storage: storage({ [diaryKeys[0]]: '{' }),
        keys: [{ key: diaryKeys[0], json: true }],
      }),
    /INVALID_PREFERENCE_JSON/,
  );
  assert.throws(() => portablePreferences(null), /INVALID_PREFERENCES/);
  const local = storage({ 'shiye-input-cap-v2': '640', password: 'never read' });
  assert.equal(readDesktopPortablePreferences({ storage: local })['shiye-input-cap-v2'], '640');
  assert.equal(local.reads.includes('password'), false);
  assert.equal(local.reads.length, DESKTOP_PORTABLE_PREFERENCE_KEYS.length);
});
