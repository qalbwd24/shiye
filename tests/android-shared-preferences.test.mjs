import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { IDBFactory } from 'fake-indexeddb';
import { createDiaryServer } from '../src/server/app.mjs';
import { createSharedRuntime, SHARED_RUNTIME_CONFIG } from '../android/qq-chat/shared-runtime.js';

test('explicit runtime captures actual known diary storage and native preferences into same-server profiles without applying remote values', async (t) => {
  const dataDir = path.resolve('tmp/shared-business-runtime/preferences', randomUUID());
  await fs.mkdir(dataDir, { recursive: true });
  const server = await createDiaryServer({ dataDir, seed: false, sharedSync: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`,
    commands = [];
  async function nativeRequest(action, input) {
    const methods = {
      sharedInfo: ['GET', 'info'],
      sharedSnapshot: ['POST', 'snapshot'],
      sharedPull: ['POST', 'pull'],
      sharedCommand: ['POST', 'command'],
    };
    const [method, suffix] = methods[action] || [];
    assert(method, action);
    if (action === 'sharedCommand') commands.push(structuredClone(input));
    const response = await fetch(`${base}/api/shared/v1/${suffix}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Diary-Client': 'desktop' },
      ...(method === 'GET' ? {} : { body: JSON.stringify(input) }),
    });
    const value = await response.json();
    if (!response.ok)
      throw Object.assign(Error(value.error?.code), {
        code: value.error?.code,
        status: response.status,
      });
    return value;
  }
  const info = await nativeRequest('sharedInfo', {});
  const presentation = 'shiye.android.diary.presentation.v2',
    widths = 'shiye.android.diary.entry-image-width.v1',
    modes = 'shiye.android.diary.image-width-modes.v1';
  const local = new Map([
    [presentation, JSON.stringify({ fontSize: 18, future: { array: [{ key: 'preserved' }] } })],
    [widths, JSON.stringify([{ id: randomUUID(), width: 72, future: [1, 2] }])],
    [modes, JSON.stringify({ futureMode: { nested: [1, 'wide'] } })],
    [
      SHARED_RUNTIME_CONFIG,
      JSON.stringify({ enabled: true, libraryId: info.libraryId, epoch: info.epoch }),
    ],
    ['accessToken', 'never-read-token'],
  ]);
  const readKeys = [],
    writes = [];
  const preferenceStorage = {
    getItem: (key) => {
      readKeys.push(key);
      return local.get(key) ?? null;
    },
    setItem: (key, value) => {
      writes.push(key);
      local.set(key, value);
    },
  };
  let loads = 0,
    commits = 0;
  const thoughtState = {
    version: 1,
    pinIds: ['-2'],
    order: ['-2'],
    roomOrder: ['-2'],
    appearance: { theme: 'dark', future: { retained: [true, 3] } },
    roomAppearance: { '-2': { messageFontSize: 19, unknown: ['portable'] } },
    listRowOpacity: 80,
    roomBackgrounds: { '-2': { url: 'file:///private/wallpaper' } },
    listBackground: { url: 'blob:local' },
    chatBackground: { url: 'file:///private/chat' },
    futureTop: { unknown: [1, 2] },
    libraryId: 'never-upload-binding',
    epoch: 'never-upload-epoch',
    activation: { enabled: true },
    token: 'never-upload-token',
  };
  const nativePreferences = {
    load: async () => {
      loads++;
      return structuredClone(thoughtState);
    },
    commit: async () => {
      commits++;
      throw Error('must never apply preferences');
    },
  };
  const timers = new Map();
  let timerId = 0,
    cleared = 0;
  const captureTimers = {
    setTimeout: (callback, ms) => {
      assert.equal(ms, 30000);
      timers.set(++timerId, callback);
      return timerId;
    },
    clearTimeout: (id) => {
      timers.delete(id);
      cleared++;
    },
  };
  const runtime = await createSharedRuntime({
    config: { enabled: true, libraryId: info.libraryId, epoch: info.epoch },
    nativeRequest,
    indexedDB: new IDBFactory(),
    currentRoom: () => null,
    preferenceStorage,
    readThoughtPreferences: nativePreferences.load,
    captureTimers,
    pollMs: 60000,
  });
  t.after(() => runtime.dispose());
  await runtime.start();
  const profile = async (scope) =>
    (await runtime.client.read('client-preferences', scope)).local.data;
  const diary = await profile('android:diary'),
    thoughts = await profile('android:thoughts');
  assert.deepEqual(diary.values[presentation], JSON.parse(local.get(presentation)));
  assert(Array.isArray(diary.values[widths]));
  assert.deepEqual(diary.values[widths], JSON.parse(local.get(widths)));
  assert.deepEqual(diary.values[modes], JSON.parse(local.get(modes)));
  assert.deepEqual(thoughts.values.appearance, thoughtState.appearance);
  assert.deepEqual(thoughts.values.roomAppearance, thoughtState.roomAppearance);
  assert.deepEqual(thoughts.values.futureTop, thoughtState.futureTop);
  assert.equal(thoughts.values.listRowOpacity, 80);
  for (const key of [
    'pinIds',
    'order',
    'roomOrder',
    'roomBackgrounds',
    'listBackground',
    'chatBackground',
    'libraryId',
    'epoch',
    'activation',
    'token',
  ])
    assert(!Object.hasOwn(thoughts.values, key), key);
  assert(
    !JSON.stringify(await fs.readFile(path.join(dataDir, 'diary.json'), 'utf8')).includes(
      'never-upload',
    ),
  );
  assert.deepEqual(new Set(readKeys), new Set([presentation, widths, modes]));
  assert.equal(loads, 1);
  assert.equal(commits, 0);
  assert.deepEqual(writes, []);
  assert.equal(timers.size, 1);
  await runtime.client.receive();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(loads, 1, 'onChange/page receipt must not capture again');
  const beforeCommands = commands.filter(
    (command) => command.action === 'client-preferences-save',
  ).length;
  const callback = [...timers.values()][0];
  timers.clear();
  callback();
  await runtime.preferences.capture();
  assert.equal(
    commands.filter((command) => command.action === 'client-preferences-save').length,
    beforeCommands,
    'unchanged timer capture must not rewrite profiles',
  );
  const current = await profile('android:thoughts');
  await nativeRequest('sharedCommand', {
    libraryId: info.libraryId,
    epoch: info.epoch,
    operationId: randomUUID(),
    action: 'client-preferences-save',
    input: {
      scope: 'android:thoughts',
      expectedRevision: current.revision,
      set: { appearance: { theme: 'remote-light' } },
      remove: [],
    },
  });
  thoughtState.appearance.theme = 'local-blue';
  const report = await runtime.preferences.capture();
  assert(report['android:thoughts'].conflicts.length > 0);
  assert.equal((await profile('android:thoughts')).values.appearance.theme, 'remote-light');
  assert.equal(thoughtState.appearance.theme, 'local-blue');
  assert.equal(commits, 0);
  assert.deepEqual(writes, []);
  await runtime.dispose();
  assert.equal(timers.size, 0);
  assert(cleared > 0);
});
