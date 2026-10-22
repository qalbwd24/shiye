import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { JSDOM } from 'jsdom';
import { IDBFactory } from 'fake-indexeddb';
import { createDiaryServer } from '../src/server/app.mjs';
import {
  createSharedRuntime,
  createNativeSharedRequest,
  saveSharedRuntimeConfig,
  loadConfiguredRuntime,
  createBoundedBlobSink,
  BLOB_LIMIT,
} from '../android/qq-chat/shared-runtime.js';
import { installSharedDirectoryView } from '../android/qq-chat/shared-directory-view.js';

const memory = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };
};
function cappedNativeAdapter(base) {
  const stats = { requestMax: 0, responseMax: 0, calls: [] };
  const paths = {
    sharedInfo: ['GET', 'info'],
    sharedSnapshot: ['POST', 'snapshot'],
    sharedPull: ['POST', 'pull'],
    sharedCommand: ['POST', 'command'],
    sharedMediaRead: ['POST', 'media/read'],
    sharedMediaBegin: ['POST', 'media/begin'],
    sharedMediaChunk: ['POST', 'media/chunk'],
    sharedMediaComplete: ['POST', 'media/complete'],
    sharedEntityRead: ['POST', 'entity/read'],
  };
  return {
    stats,
    async request(action, input) {
      stats.calls.push(action);
      const [method, suffix] = paths[action] || [];
      assert(method, action);
      const wire = JSON.stringify(input);
      const size = Buffer.byteLength(wire);
      stats.requestMax = Math.max(stats.requestMax, size);
      assert(size <= 4 * 1024 * 1024, 'native request cap');
      const response = await fetch(`${base}/api/shared/v1/${suffix}`, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-Diary-Client': 'desktop' },
        ...(method === 'GET' ? {} : { body: wire }),
      });
      const text = await response.text();
      stats.responseMax = Math.max(stats.responseMax, Buffer.byteLength(text));
      assert(Buffer.byteLength(text) <= 8 * 1024 * 1024, 'native response cap');
      const body = JSON.parse(text);
      if (!response.ok)
        throw Object.assign(new Error(body.error?.code), {
          code: body.error?.code,
          status: response.status,
        });
      return body;
    },
  };
}
test('shared runtime activation requires explicit persistent identity and default makes no native call', async () => {
  const store = memory();
  let calls = 0;
  assert.equal(
    await loadConfiguredRuntime({
      configurationStore: store,
      nativeRequest: () => {
        calls++;
      },
    }),
    null,
  );
  assert.throws(
    () => saveSharedRuntimeConfig({ enabled: true }, store),
    /SHARED_EXPLICIT_IDENTITY_REQUIRED/,
  );
  assert.equal(calls, 0);
  saveSharedRuntimeConfig({ enabled: false }, store);
  assert.equal(await loadConfiguredRuntime({ configurationStore: store }), null);
});
test('native adapter maps sixteen fixed actions, clones envelopes and preserves machine classification', async () => {
  const seen = [];
  const request = createNativeSharedRequest(async (action, input) => {
    seen.push({ action, input });
    return { future: { retained: true } };
  });
  const methods = [
    'info',
    'snapshot',
    'pull',
    'command',
    'unlock',
    'pair',
    'auth-status',
    'forget-device',
    'media-read',
    'media-begin',
    'media-chunk',
    'media-complete',
    'entity-read',
    'feed-item-read',
    'seed-resolve',
    'seed-register',
  ];
  const input = { libraryId: randomUUID(), epoch: randomUUID(), future: { x: 1 } };
  for (const method of methods) assert.equal((await request(method, input)).future.retained, true);
  assert.equal(new Set(seen.map((row) => row.action)).size, 16);
  input.future.x = 2;
  assert.equal(seen[0].input.future.x, 1);
  await assert.rejects(request('/api/access'), /SHARED_NATIVE_ACTION_FORBIDDEN/);
  const rejected = createNativeSharedRequest(() => {
    throw Object.assign(new Error('expired'), { code: 'DEVICE_UNAUTHORIZED' });
  });
  await assert.rejects(rejected('info'), (error) => error.status === 401);
});
test('bounded original sink refuses oversized assets before allocation', async () => {
  assert.throws(
    () => createBoundedBlobSink({ size: BLOB_LIMIT + 1 }),
    /SHARED_NATIVE_MEDIA_SINK_REQUIRED/,
  );
  const sink = createBoundedBlobSink(
    { size: 3, type: 'application/octet-stream' },
    { urlFactory: {} },
  );
  await sink.write(0, new Uint8Array([1, 2, 3]));
  assert.deepEqual(
    new Uint8Array(await (await sink.finish()).blob.arrayBuffer()),
    new Uint8Array([1, 2, 3]),
  );
});
test('explicit shared list renders canonical rows and restores untouched vendor DOM when disposed', async () => {
  const dom = new JSDOM('<div id="LeftColumn"><div id="vendor">local history</div></div>');
  const previous = { document: globalThis.document, MutationObserver: globalThis.MutationObserver };
  Object.assign(globalThis, {
    document: dom.window.document,
    MutationObserver: dom.window.MutationObserver,
  });
  try {
    const id = `desktop:${randomUUID()}:-1`,
      opened = [],
      settings = [];
    let created = 0;
    const runtime = {
      directory: {
        list: async () => ({
          rooms: [{ id, title: 'shared <room>', pinned: true, archived: false }],
        }),
      },
      subscribe: () => () => {},
    };
    const view = installSharedDirectoryView({
      runtime,
      mount: document.querySelector('#LeftColumn'),
      onOpen: (value) => opened.push(value),
      onSettings: (value) => settings.push(value),
      onCreate: () => created++,
    });
    await new Promise((resolve) => setImmediate(resolve));
    const row = document.querySelector('[data-conversation-id]');
    assert.equal(row.dataset.conversationId, id);
    assert.match(row.textContent, /shared <room> · 置顶/);
    assert.equal(document.querySelector('#vendor').style.visibility, 'hidden');
    row.querySelector('button').click();
    row.querySelectorAll('button')[1].click();
    [...document.querySelectorAll('button')].find((node) => node.textContent === '新建').click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(opened, [id]);
    assert.deepEqual(settings, [id]);
    assert.equal(created, 1);
    view.destroy();
    assert.equal(document.querySelector('#vendor').style.visibility, '');
    assert.equal(document.querySelector('#vendor').textContent, 'local history');
  } finally {
    Object.assign(globalThis, previous);
    dom.window.close();
  }
});
test('isolated stage bundles all public runtime dependencies with no APK-relative public imports', async () => {
  const stage = path.resolve('tmp/shared-business-runtime/stage-' + randomUUID());
  await promisify(execFile)(process.execPath, ['android/qq-chat/build-shared-runtime.mjs', stage]);
  const bundle = await fs.readFile(
    path.join(stage, 'assets/telegram/qq-chat/shared-runtime.js'),
    'utf8',
  );
  assert(!/from\s+['"]\.\.\/\.\.\/public/.test(bundle));
  const manifest = JSON.parse(await fs.readFile(path.join(stage, 'shared-runtime-bundle.json')));
  for (const name of [
    'shared-business-client.js',
    'shared-directory-client.js',
    'shared-diary-client.js',
    'shared-media-client.js',
    'shared-preference-capture.js',
    'shared-source.js',
  ])
    assert(
      manifest.inputs.some((file) => file.endsWith(name)),
      name,
    );
  await fs.access(path.join(stage, 'assets/telegram/qq-chat/shared-directory-view.js'));
  assert.match(
    await fs.readFile(path.join(stage, 'assets/telegram/android-chat.js'), 'utf8'),
    /loadConfiguredRuntime/,
  );
  assert.match(
    await fs.readFile(path.join(stage, 'assets/telegram/qq-chat/install.js'), 'utf8'),
    /callbacks.source/,
  );
});
test('real HTTP native adapter plus IndexedDB creates canonical rooms, sends through source and recovers draft after reopen', async (t) => {
  const dataDir = path.resolve('tmp/shared-business-runtime', randomUUID());
  await fs.mkdir(dataDir, { recursive: true });
  const server = await createDiaryServer({ dataDir, seed: false, sharedSync: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`,
    calls = [];
  const paths = {
    sharedInfo: ['GET', 'info'],
    sharedSnapshot: ['POST', 'snapshot'],
    sharedPull: ['POST', 'pull'],
    sharedCommand: ['POST', 'command'],
    sharedMediaRead: ['POST', 'media/read'],
    sharedMediaBegin: ['POST', 'media/begin'],
    sharedMediaChunk: ['POST', 'media/chunk'],
    sharedMediaComplete: ['POST', 'media/complete'],
    sharedEntityRead: ['POST', 'entity/read'],
  };
  async function nativeRequest(action, input) {
    calls.push(action);
    const [method, suffix] = paths[action] || [];
    assert(method, action);
    const response = await fetch(`${base}/api/shared/v1/${suffix}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Diary-Client': 'desktop' },
      ...(method === 'GET' ? {} : { body: JSON.stringify(input) }),
    });
    const body = await response.json();
    if (!response.ok)
      throw Object.assign(new Error(body.error?.code), {
        code: body.error?.code,
        status: response.status,
      });
    return body;
  }
  const info = await nativeRequest('sharedInfo', {}),
    config = { version: 1, enabled: true, libraryId: info.libraryId, epoch: info.epoch },
    store = memory();
  saveSharedRuntimeConfig(config, store);
  const indexedDB = new IDBFactory();
  let room = null,
    changes = 0;
  const options = {
    configurationStore: store,
    nativeRequest,
    indexedDB,
    currentRoom: () => room,
    onChange: () => {
      changes++;
    },
    pollMs: 60000,
  };
  let runtime = await loadConfiguredRuntime(options);
  t.after(() => runtime.dispose());
  await runtime.start();
  const operationId = randomUUID();
  const created = await runtime.directoryCommand('create', {
    title: 'runtime canonical room',
    operationId,
    idleHours: 5,
  });
  assert.match(created.id, /^desktop:[a-f0-9-]{36}:-\d+$/);
  assert.equal(
    (
      await runtime.directoryCommand('create', {
        title: 'runtime canonical room',
        operationId,
        idleHours: 5,
      })
    ).id,
    created.id,
  );
  await assert.rejects(
    runtime.directoryCommand('create', {
      title: 'changed retry intent',
      operationId,
      idleHours: 5,
    }),
    (error) => error.code === 'SHARED_OPERATION_INPUT_CHANGED',
  );
  room = await runtime.room(created.id);
  await runtime.source.refresh();
  await runtime.source.setDraft('durable runtime draft');
  await runtime.source.flush();
  const sent = await runtime.source.sendText('native mapped message');
  assert.equal(sent.localAck, true);
  await runtime.client.sync();
  await runtime.source.refreshLocal();
  assert(
    runtime.source
      .getSnapshot()
      .messages.some((message) => message.text === 'native mapped message'),
  );
  assert(calls.includes('sharedCommand'));
  assert(changes > 0 && changes < 100, 'onChange must not recursively sync');
  await runtime.directory.setState(created.id, { pinned: true });
  assert.equal((await runtime.directory.row(created.id)).pinned, true);
  const bytes = new Uint8Array([0, 1, 254, 255, 17]);
  const file = new File([bytes], 'runtime-original.bin', { type: 'application/octet-stream' });
  const mediaReceipt = await runtime.source.sendFiles([file]);
  assert.equal(mediaReceipt.localAck, true);
  assert.equal(
    runtime.source.getSnapshot().messages.filter((message) => message.id === mediaReceipt.messageId)
      .length,
    1,
  );
  await runtime.uploadJobs.waitIdle();
  await runtime.client.sync();
  await runtime.source.refreshLocal();
  const attachment = runtime.source
    .getSnapshot()
    .messages.find((message) => message.attachments?.length);
  assert(attachment);
  const original = await runtime.readMedia(attachment);
  assert.deepEqual(new Uint8Array(await original.blob.arrayBuffer()), bytes);
  const png = Uint8Array.from(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC8sAAAAASUVORK5CYII=',
      'base64',
    ),
  );
  await runtime.source.sendFiles([
    new File([png], 'one.png', { type: 'image/png' }),
    new File([png, new Uint8Array([0])], 'two.png', { type: 'image/png' }),
  ]);
  await runtime.uploadJobs.waitIdle();
  await runtime.client.sync();
  await runtime.source.refreshLocal();
  const multiple = runtime.source
    .getSnapshot()
    .messages.find((message) => message.attachments?.length === 2);
  assert(multiple);
  await assert.rejects(
    runtime.source.saveSticker(multiple),
    (error) => error.code === 'STICKER_IMAGE_SELECTION_REQUIRED',
  );
  await runtime.stickers.fromMessage(multiple, { mediaId: multiple.attachments[1] });
  assert.equal((await runtime.stickers.catalog()).items.length, 1);
  await runtime.dispose();
  runtime = await loadConfiguredRuntime(options);
  await runtime.source.refreshLocal();
  assert.equal(runtime.source.getDraft().text, 'durable runtime draft');
  const before = calls.length;
  await runtime.refreshLocal();
  assert.equal(calls.length, before, 'local projection must not trigger network');
  const wrong = { ...options, config: { ...config, libraryId: randomUUID() } };
  const other = await createSharedRuntime(wrong);
  await assert.rejects(other.client.sync(), /SHARED_IDENTITY_MISMATCH|SHARED_LIBRARY_MISMATCH/);
  await other.dispose();
});

test('runtime >8MiB imported Entry saves offline across reopen and creates through immutable small refs with capped native reads', async (t) => {
  const dataDir = path.resolve('tmp/shared-business-runtime/large', randomUUID());
  await fs.mkdir(dataDir, { recursive: true });
  const content = '<p>' + '原'.repeat(1500000) + '</p>',
    original = '<p>' + '件'.repeat(1500000) + '</p>',
    entryId = randomUUID(),
    date = '2026-10-19T01:00:00.000Z';
  const entry = {
    id: entryId,
    revision: 1,
    title: 'imported large entry',
    content,
    contentFormat: 'html',
    editorOriginalHtml: original,
    date,
    category: '日常',
    tags: [],
    attachments: [],
    location: '',
    mood: '',
    weather: '',
    createdAt: date,
    updatedAt: date,
    history: [],
    futureImport: { nested: { untouched: ['original', 7] } },
  };
  assert(Buffer.byteLength(JSON.stringify(entry)) > 8 * 1024 * 1024);
  await fs.writeFile(
    path.join(dataDir, 'diary.json'),
    JSON.stringify({
      schema: 1,
      categories: ['日常'],
      tags: [],
      entries: [entry],
      media: [],
      settings: { preferences: {} },
    }),
  );
  const server = await createDiaryServer({ dataDir, seed: false, sharedSync: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`,
    native = cappedNativeAdapter(base),
    info = await native.request('sharedInfo', {}),
    indexedDB = new IDBFactory();
  const options = {
    config: { enabled: true, libraryId: info.libraryId, epoch: info.epoch },
    nativeRequest: native.request,
    indexedDB,
    currentRoom: () => null,
    pollMs: 60000,
  };
  let runtime = await createSharedRuntime(options);
  t.after(() => runtime.dispose());
  await runtime.client.sync();
  assert(native.stats.calls.includes('sharedEntityRead'));
  const initial = await runtime.diary.read(entryId),
    before = native.stats.calls.length;
  const saved = await runtime.diary.save(
    entryId,
    { title: 'offline large title' },
    initial.localRevision,
    { sync: false },
  );
  assert.equal(native.stats.calls.length, before, 'offline save must not preupload');
  assert.equal(saved.status, 'pending');
  await runtime.dispose();
  runtime = await createSharedRuntime(options);
  assert.equal((await runtime.client.readOperation(saved.operationId)).status, 'pending');
  await runtime.client.sync();
  assert.equal((await runtime.client.readOperation(saved.operationId)).status, 'acknowledged');
  const pc = await (await fetch(base + '/api/entries/' + entryId)).json();
  assert.equal(pc.title, 'offline large title');
  assert.deepEqual(pc.futureImport, entry.futureImport);
  assert.equal(pc.content, content);
  assert.equal(pc.editorOriginalHtml, original);
  assert.equal(pc.history.length, 1);
  assert.equal(pc.history[0].content, content);
  const created = await runtime.diary.create(
    { ...entry, id: undefined, revision: undefined, history: undefined, title: 'large new entry' },
    { sync: false },
  );
  await runtime.dispose();
  runtime = await createSharedRuntime(options);
  await runtime.client.sync();
  const receipt = await runtime.client.readOperation(created.operationId);
  assert.equal(receipt.status, 'acknowledged');
  assert.notEqual(receipt.result.id, entryId);
  const received = await runtime.diary.read(receipt.result.id);
  assert.equal(received.local.data.content, content);
  assert.equal(received.local.data.editorOriginalHtml, original);
  assert(native.stats.requestMax < 1024 * 1024);
  assert(native.stats.responseMax < 1024 * 1024);
});
