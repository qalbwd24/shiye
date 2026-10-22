import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFile, writeFile } from 'node:fs/promises';
import {
  createSharedImportFlow,
  openLegacySharedImport as openSharedImport,
} from '../android/qq-chat/shared-import-ui.js';
import { createSharedSeedImportController } from '../public/shared/shared-seed-import.js';
import { sha256Bytes } from '../public/shared/sync-v2-media.js';
const libraryId = '11111111-1111-4111-8111-111111111111',
  epoch = '22222222-2222-4222-8222-222222222222',
  packageId = '33333333-3333-4333-8333-333333333333';
const gate = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
const memory = () => {
  const map = new Map();
  return {
    getItem: (k) => map.get(k) || null,
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
};
function fixture(overrides = {}) {
  const states = [],
    calls = [],
    storage = memory();
  const runtime = {
    config: { libraryId, epoch },
    seed: {
      importNativeTicket: async () => ({ status: 'imported', packageId }),
      resume: async () => ({ status: 'imported', packageId }),
    },
    refreshLocal: async () => calls.push('refresh'),
    directory: { list: async () => ({ rooms: [{ id: 'room-1', title: '会话一' }] }) },
    diary: {
      list: async () => [{ entityId: 'entry-1', local: { data: { title: '思绪一' } } }],
      preferences: async () => ({ local: { data: {} } }),
    },
    ...overrides,
  };
  const nativeRequest = async (action) => {
    calls.push(action);
    return { seedToken: 'opaque-ticket' };
  };
  const flow = createSharedImportFlow({
    runtime,
    nativeRequest,
    storage,
    onState: (s) => states.push(s),
  });
  return { runtime, nativeRequest, storage, flow, states, calls };
}
test('unconfigured import has visible configuration state and makes no picker call', async () => {
  const f = fixture({ config: null });
  assert.equal((await f.flow.run()).phase, 'configuration-required');
  assert.deepEqual(f.calls, []);
});
test('imported is only success state, actual three client readbacks populate result', async () => {
  const f = fixture();
  const result = await f.flow.run();
  assert.equal(result.phase, 'imported');
  assert.equal(result.diary[0].local.data.title, '思绪一');
  assert.equal(result.directory.rooms[0].title, '会话一');
  assert(result.preferences.local);
  assert.deepEqual(f.calls, ['choose', 'refresh', 'sharedSeedClose']);
  assert.deepEqual(
    f.states.map((s) => s.phase),
    ['choosing', 'validating', 'committed', 'imported'],
  );
});
test('quarantine never reports success; persisted identity-scoped retry resolves without new file', async () => {
  const f = fixture({
    seed: {
      importNativeTicket: async () => ({ status: 'quarantined', packageId, errorCode: 'OFFLINE' }),
      resume: async () => ({ status: 'imported', packageId }),
    },
  });
  assert.equal((await f.flow.run()).phase, 'quarantined');
  assert(!f.calls.includes('refresh'));
  assert(f.flow.hasPending);
  const reopened = createSharedImportFlow({
    runtime: f.runtime,
    nativeRequest: f.nativeRequest,
    storage: f.storage,
  });
  assert(reopened.hasPending);
  assert.equal((await reopened.resume()).phase, 'imported');
  assert.equal(f.calls.filter((c) => c === 'choose').length, 1);
});
test('cancel while picker resolves closes late ticket and never enters importer', async () => {
  const pending = gate(),
    f = fixture();
  let imported = 0;
  f.runtime.seed.importNativeTicket = async () => {
    imported++;
  };
  const actions = [];
  const flow = createSharedImportFlow({
    runtime: f.runtime,
    nativeRequest: async (action) => {
      actions.push(action);
      if (action === 'choose') return pending.promise;
    },
  });
  const work = flow.run();
  assert.equal((await flow.run()).phase, 'busy');
  flow.cancel();
  pending.resolve({ seedToken: 'late' });
  assert.equal((await work).phase, 'cancelled');
  assert.equal(imported, 0);
  assert.deepEqual(actions, ['choose', 'cancel', 'sharedSeedClose']);
});
test('wrong library, malformed success and readback failure never display imported', async () => {
  const f = fixture();
  f.runtime.seed.importNativeTicket = async () => {
    throw Object.assign(Error('wrong'), { code: 'SHARED_IDENTITY_MISMATCH' });
  };
  assert.equal((await f.flow.run()).phase, 'failed');
  assert(!f.calls.includes('refresh'));
  f.runtime.seed.importNativeTicket = async () => ({ imported: true });
  assert.equal((await f.flow.run()).code, 'SHARED_IMPORT_UNKNOWN_RESULT');
  f.runtime.seed.importNativeTicket = async () => ({ status: 'imported', packageId });
  f.runtime.diary.list = async () => {
    throw Error('READ_FAILED');
  };
  assert.equal((await f.flow.run()).phase, 'committed-readback-failed');
});
test('late cancel after atomic commit reports committed import; page disposal emits no stale states', async () => {
  const pending = gate(),
    f = fixture();
  f.runtime.seed.importNativeTicket = () => pending.promise;
  const work = f.flow.run();
  await Promise.resolve();
  f.flow.cancel();
  pending.resolve({ status: 'imported', packageId });
  assert.equal((await work).phase, 'imported');
  const next = gate(),
    g = fixture();
  g.runtime.seed.importNativeTicket = () => next.promise;
  const active = g.flow.run();
  await Promise.resolve();
  g.flow.dispose();
  const count = g.states.length;
  next.resolve({ status: 'imported', packageId });
  await active;
  assert.equal(g.states.length, count);
});
test('visible DOM exposes pairing, identity confirmation and import states with escaped titles', async () => {
  const dom = new JSDOM('<body></body>', {
    url: 'https://appassets.androidplatform.net/telegram/index.html',
  });
  const old = { window: globalThis.window, document: globalThis.document };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  try {
    const f = fixture();
    f.runtime.directory.list = async () => ({
      rooms: [{ id: 'r', title: '<script>unsafe</script>' }],
    });
    await openSharedImport({ nativeRequest: f.nativeRequest, runtime: f.runtime });
    const buttons = [...document.querySelectorAll('button')];
    assert(buttons.some((b) => b.textContent === '服务地址设置'));
    assert(buttons.some((b) => b.textContent === '配对此设备'));
    assert(buttons.some((b) => b.textContent === '读取资料库身份'));
    assert(buttons.some((b) => b.textContent === '确认使用此资料库并重开' && b.hidden));
    buttons.find((b) => b.textContent === '选择电脑资料包').click();
    await new Promise((r) => setTimeout(r, 20));
    assert.match(document.querySelector('[role=status]').textContent, /导入成功/);
    assert.match(document.body.textContent, /思绪一/);
    assert.match(document.body.textContent, /<script>unsafe<\/script>/);
    assert.equal(document.querySelectorAll('script').length, 0);
    buttons.find((b) => b.textContent === '返回').click();
    await Promise.resolve();
    assert.equal(document.getElementById('shiye-shared-import'), null);
  } finally {
    dom.window.close();
    globalThis.window = old.window;
    globalThis.document = old.document;
  }
});
test('first-use visible pairing clears code and explicit activation rejects changed server identity', async () => {
  const dom = new JSDOM('<body></body>', {
    url: 'https://appassets.androidplatform.net/telegram/index.html',
  });
  const old = {
    window: globalThis.window,
    document: globalThis.document,
    localStorage: globalThis.localStorage,
  };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  const calls = [];
  let changed = false;
  try {
    await openSharedImport({
      runtime: null,
      nativeRequest: async (action, input) => {
        calls.push({ action, input });
        if (action === 'sharedInfo') return { libraryId: changed ? epoch : libraryId, epoch };
        return { paired: true };
      },
    });
    const click = async (label) => {
      [...document.querySelectorAll('button')].find((b) => b.textContent === label).click();
      await new Promise((r) => setTimeout(r, 10));
    };
    await click('选择电脑资料包');
    assert.match(document.querySelector('[role=status]').textContent, /先配对/);
    assert.equal(calls.length, 0);
    document.querySelector('[aria-label="服务器配对码"]').value = 'private-pair-code';
    await click('配对此设备');
    assert.equal(calls[0].action, 'sharedPair');
    assert.equal(document.querySelector('[aria-label="服务器配对码"]').value, '');
    assert(!document.body.textContent.includes('private-pair-code'));
    await click('读取资料库身份');
    assert.match(document.querySelector('[role=status]').textContent, new RegExp(libraryId));
    assert.equal(localStorage.getItem('shiye-shared-runtime-v1'), null);
    changed = true;
    await click('确认使用此资料库并重开');
    assert.match(document.querySelector('[role=status]').textContent, /SHARED_IDENTITY_CHANGED/);
    assert.equal(localStorage.getItem('shiye-shared-runtime-v1'), null);
    await click('返回');
  } finally {
    dom.window.close();
    Object.assign(globalThis, old);
  }
});
function realImporter(mode = 'success', factory = createSharedSeedImportController) {
  const manifest = {
    format: 'shiye-shared-seed',
    version: 1,
    mode: 'shared-bootstrap',
    packageId,
    libraryId,
    epoch,
    watermark: 0,
    snapshotWatermark: 0,
    cursor: { libraryId, epoch, after: 0 },
    complete: true,
    createdAt: '2026-10-19T00:00:00Z',
    entities: [],
    assets: [],
    members: [],
    bytes: 0,
    entityBytes: 0,
    entityCount: 0,
    assetCount: 0,
    containsCredentials: false,
    containsSourceArchives: false,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(manifest));
  const ticket = {
    seedToken: '44444444-4444-4444-8444-444444444444',
    manifest: { byteLength: bytes.length, sha256: sha256Bytes(bytes) },
    libraryId,
    epoch,
    packageId,
  };
  if (mode === 'invalid-ticket') delete ticket.manifest;
  if (mode === 'identity') ticket.libraryId = epoch;
  if (mode === 'hash') ticket.manifest.sha256 = '0'.repeat(64);
  const stats = { closeRequests: 0, physicalCloses: 0, imports: 0 };
  let closed = false;
  const commitGate = gate();
  const nativeRequest = async (action, input) => {
    if (action === 'choose') return ticket;
    if (action === 'cancel') return {};
    if (action === 'sharedSeedClose') {
      stats.closeRequests++;
      if (!closed) {
        closed = true;
        stats.physicalCloses++;
      }
      return { closed: true };
    }
    assert.equal(action, 'sharedSeedManifestRead');
    const part = bytes.subarray(input.offset, input.offset + input.length);
    return {
      offset: input.offset,
      next: input.offset + part.length,
      bytesBase64: Buffer.from(part).toString('base64'),
      chunkSha256: sha256Bytes(part),
    };
  };
  const seed = factory({
    libraryId,
    epoch,
    nativeRequest,
    storage: { transaction: async (fn) => fn({}) },
    client: {
      readSeedOriginal: async () => null,
      importSeed: async () => {
        stats.imports++;
        if (mode === 'commit-gate') await commitGate.promise;
        return { status: 'imported', packageId };
      },
    },
  });
  const f = fixture({ seed });
  return {
    ...f,
    ticket,
    stats,
    nativeRequest,
    commitGate,
    flow: createSharedImportFlow({
      runtime: f.runtime,
      nativeRequest,
      storage: f.storage,
      onState: (s) => f.states.push(s),
    }),
  };
}
test('v1 preserved reproducer: real runtime ticket rejection before finally leaked its token', async () => {
  const source = await readFile(
    new URL(
      '../outputs/2026-10-19-android-shared-import-ui/candidate-v1/ui/shared-import-ui.js',
      import.meta.url,
    ),
    'utf8',
  );
  const runtimeUrl = new URL('../android/qq-chat/shared-runtime.js', import.meta.url).href;
  const old = await import(
    'data:text/javascript;base64,' +
      Buffer.from(source.replace("'./shared-runtime.js'", JSON.stringify(runtimeUrl))).toString(
        'base64',
      )
  );
  const frozenBundle = await readFile(
    new URL(
      '../outputs/2026-10-19-android-shared-import-ui/candidate-v1/assets/shared-runtime.js',
      import.meta.url,
    ),
    'utf8',
  );
  const frozen = await import(
    'data:text/javascript;base64,' +
      Buffer.from(frozenBundle + '\nexport {createSharedSeedImportController};').toString('base64')
  );
  const f = realImporter('invalid-ticket', frozen.createSharedSeedImportController);
  const flow = old.createSharedImportFlow({
    runtime: f.runtime,
    nativeRequest: f.nativeRequest,
    storage: f.storage,
  });
  assert.equal((await flow.run()).code, 'SHARED_SEED_INVALID_TICKET');
  assert.equal(f.stats.closeRequests, 0);
  await writeFile(
    new URL(
      '../outputs/2026-10-19-android-shared-import-ui/v1-invalid-ticket-reproducer.json',
      import.meta.url,
    ),
    JSON.stringify({ expectedLeakReproduced: true, ...f.stats }, null, 2),
  );
});
test('real importer closes malformed ticket rejected before finally, shape-valid identity rejection and in-finally hash failure', async () => {
  const frozenBundle = await readFile(
    new URL(
      '../outputs/2026-10-19-android-shared-import-ui/candidate-v1/assets/shared-runtime.js',
      import.meta.url,
    ),
    'utf8',
  );
  const frozen = await import(
    'data:text/javascript;base64,' +
      Buffer.from(frozenBundle + '\nexport {createSharedSeedImportController};').toString('base64')
  );
  for (const [mode, code, requests] of [
    ['invalid-ticket', 'SHARED_SEED_INVALID_TICKET', 1],
    ['identity', 'SHARED_IDENTITY_MISMATCH', 2],
    ['hash', 'SHARED_SEED_MANIFEST_HASH_MISMATCH', 2],
  ]) {
    const f = realImporter(
      mode,
      mode === 'invalid-ticket'
        ? frozen.createSharedSeedImportController
        : createSharedSeedImportController,
    );
    assert.equal((await f.flow.run()).code, code);
    assert.equal(f.stats.closeRequests, requests);
    assert.equal(f.stats.physicalCloses, 1);
    assert.equal(f.stats.imports, 0);
  }
});
test('real importer success and cancelled picker each request cleanup; late committed disposal preserves result without stale state', async () => {
  const f = realImporter();
  assert.equal((await f.flow.run()).phase, 'imported');
  assert.equal(f.stats.imports, 1);
  assert.equal(f.stats.physicalCloses, 1);
  const cancelled = realImporter(),
    pick = gate();
  const flow = createSharedImportFlow({
    runtime: cancelled.runtime,
    nativeRequest: async (action, input) =>
      action === 'choose' ? pick.promise : cancelled.nativeRequest(action, input),
  });
  const work = flow.run();
  flow.cancel();
  pick.resolve(cancelled.ticket);
  assert.equal((await work).phase, 'cancelled');
  assert.equal(cancelled.stats.physicalCloses, 1);
  assert.equal(cancelled.stats.imports, 0);
  const held = realImporter('commit-gate'),
    active = held.flow.run();
  for (let i = 0; i < 20 && !held.stats.imports; i++) await new Promise((r) => setTimeout(r, 1));
  assert.equal(held.stats.imports, 1);
  held.flow.dispose();
  const count = held.states.length;
  held.commitGate.resolve();
  await active;
  assert.equal(held.states.length, count);
  assert.equal(held.stats.physicalCloses, 1);
});
