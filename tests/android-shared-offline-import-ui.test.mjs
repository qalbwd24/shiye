import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID, createPublicKey, verify } from 'node:crypto';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { IDBFactory } from 'fake-indexeddb';
import { JSDOM } from 'jsdom';
import {
  createOfflineImportFlow,
  openOfflineSharedImport,
  IMPORT_ACTIVATION_RECOVERY,
} from '../android/qq-chat/shared-offline-import-ui.js';
import {
  createSharedRuntime,
  SHARED_RUNTIME_CONFIG,
  inspectSharedSeedNativeTicket,
} from '../android/qq-chat/shared-runtime.js';
import { sharedSeedSigner } from '../src/server/shared-sync/seed-attestation.mjs';
import {
  sharedSeedEntityBytes,
  sharedSeedLogicalSha256,
  sharedSeedFeedRosterSha256,
  SHARED_SEED_MAGIC,
} from '../public/shared/shared-seed.js';
import { sharedSeedAttestationBytes } from '../public/shared/shared-seed-trust.js';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const gate = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
function memory() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}
async function signedFixture() {
  const root = path.resolve('tmp/android-shared-import-ui/v3-data');
  await mkdir(root, { recursive: true });
  const work = await mkdtemp(path.join(root, 'case-'));
  const libraryId = randomUUID(),
    epoch = randomUUID(),
    packageId = randomUUID(),
    entryId = randomUUID(),
    roomId = `desktop:${randomUUID()}:-1`;
  const records = [
    {
      entityType: 'entry',
      entityId: entryId,
      data: {
        id: entryId,
        title: '离线真实思绪',
        content: '<p>完整原文</p>',
        contentFormat: 'html',
        revision: 1,
        history: [],
        category: '日常',
        tags: [],
        attachments: [],
        deleted: false,
      },
    },
    {
      entityType: 'conversation',
      entityId: roomId,
      data: {
        title: '离线真实会话',
        revision: 1,
        mode: 'personal',
        pinned: false,
        archived: false,
      },
    },
    {
      entityType: 'settings',
      entityId: 'library',
      data: { revision: 1, unknown: { keep: '真实设置' } },
    },
  ].map((row, index) => {
    const record = { ...row, state: 'active', revision: 1, seq: index + 1 };
    record.sha256 = sharedSeedLogicalSha256(record);
    return record;
  });
  const members = new Map(),
    entities = [];
  for (const row of records) {
    const bytes = sharedSeedEntityBytes(row),
      hash = sha(bytes),
      memberPath = `entities/${hash}.json`;
    members.set(memberPath, bytes);
    entities.push({
      entityType: row.entityType,
      entityId: row.entityId,
      revision: row.revision,
      seq: row.seq,
      sha256: row.sha256,
      path: memberPath,
    });
  }
  const feed = {
    conversationId: roomId,
    watermark: 3,
    feedRevision: 'a'.repeat(64),
    messages: [],
    redactions: [],
  };
  const part = sharedSeedEntityBytes({
    format: 'shiye-conversation-feed-part',
    version: 1,
    ...feed,
  });
  const partSha = sha(part),
    partPath = `entities/${partSha}.json`;
  members.set(partPath, part);
  const bytes = [...members.values()].reduce((n, value) => n + value.length, 0);
  const manifest = {
    format: 'shiye-shared-seed',
    version: 2,
    mode: 'shared-bootstrap',
    packageId,
    libraryId,
    epoch,
    watermark: 3,
    snapshotWatermark: 3,
    cursor: { libraryId, epoch, after: 3 },
    complete: true,
    createdAt: '2026-10-19T00:00:00.000Z',
    entities,
    assets: [],
    members: [...members].map(([path, part]) => ({ path, size: part.length, sha256: sha(part) })),
    bytes,
    entityBytes: bytes,
    entityCount: entities.length,
    assetCount: 0,
    containsCredentials: false,
    containsSourceArchives: false,
    requiredFeatures: ['conversation-feeds-v1', 'seed-attestation-ed25519-v1'],
    conversationFeeds: [
      {
        conversationId: roomId,
        watermark: 3,
        feedRevision: feed.feedRevision,
        rosterSha256: sharedSeedFeedRosterSha256(feed),
        rowCount: 0,
        redactionCount: 0,
        parts: [
          { path: partPath, sha256: partSha, size: part.length, rowCount: 0, redactionCount: 0 },
        ],
      },
    ],
  };
  const signer = await sharedSeedSigner({ dataDir: work, libraryId }),
    signed = {
      ...manifest,
      attestation: signer.attest(manifest, { exportId: randomUUID(), issuedAt: manifest.createdAt })
        .attestation,
    },
    manifestBytes = sharedSeedEntityBytes(signed);
  const header = Buffer.alloc(Buffer.byteLength(SHARED_SEED_MAGIC) + 4);
  header.write(SHARED_SEED_MAGIC);
  header.writeUInt32BE(manifestBytes.length, Buffer.byteLength(SHARED_SEED_MAGIC));
  const blob = new Blob([header, manifestBytes, ...members.values()]);
  const ticket = {
    seedToken: randomUUID(),
    libraryId,
    epoch,
    packageId,
    manifest: { byteLength: manifestBytes.length, sha256: sha(manifestBytes) },
  };
  const calls = [],
    stats = { closes: 0, verifies: 0, network: 0 };
  let closed = false,
    closeFail = false;
  const nativeRequest = async (action, input = {}) => {
    calls.push(action);
    if (action === 'choose') {
      closed = false;
      return ticket;
    }
    if (action === 'cancel') return {};
    if (action === 'sharedSeedClose') {
      if (closeFail) throw Object.assign(Error('DISK_BUSY'), { code: 'DISK_BUSY' });
      assert.equal(closed, false, 'one close request per successful protocol lane');
      closed = true;
      stats.closes++;
      return { closed: true };
    }
    if (action === 'sharedSeedVerifyAttestation') {
      stats.verifies++;
      const a = input.attestation,
        key = createPublicKey({
          key: {
            kty: 'OKP',
            crv: 'Ed25519',
            x: Buffer.from(a.publicKeyRawBase64, 'base64').toString('base64url'),
          },
          format: 'jwk',
        });
      return {
        verified: verify(
          null,
          sharedSeedAttestationBytes(input, a),
          key,
          Buffer.from(a.signatureBase64, 'base64'),
        ),
      };
    }
    if (action === 'sharedSeedManifestRead' || action === 'sharedSeedReadMember') {
      assert(!closed);
      assert.equal(input.seedToken, ticket.seedToken);
      const all = action === 'sharedSeedManifestRead' ? manifestBytes : members.get(input.path),
        part = all.subarray(input.offset, input.offset + input.length);
      return {
        offset: input.offset,
        next: input.offset + part.length,
        bytesBase64: Buffer.from(part).toString('base64'),
        chunkSha256: sha(part),
      };
    }
    stats.network++;
    throw Object.assign(Error('OFFLINE'), { code: 'OFFLINE' });
  };
  return {
    work,
    libraryId,
    epoch,
    packageId,
    entryId,
    roomId,
    ticket,
    blob,
    manifest: signed,
    members,
    nativeRequest,
    calls,
    stats,
    setCloseFail: (value) => (closeFail = value),
  };
}
function setup(f, options = {}) {
  const store = memory(),
    indexedDB = new IDBFactory(),
    states = [],
    runtimes = [];
  const createRuntime = async (args) => {
    const runtime = await createSharedRuntime({
      currentRoom: () => null,
      contextVersion: () => 0,
      ...args,
      indexedDB,
      preferenceStorage: store,
    });
    runtimes.push(runtime);
    return runtime;
  };
  const flow = createOfflineImportFlow({
    storage: store,
    nativeRequest: f.nativeRequest,
    createRuntime,
    onState: (s) => states.push(s),
    ...options,
  });
  return { flow, store, indexedDB, states, runtimes, createRuntime };
}
const intent = (summary) => ({
  explicit: true,
  libraryId: summary.libraryId,
  epoch: summary.epoch,
  keyFingerprintSha256: summary.keyFingerprintSha256,
});
test('real native inspection and offline import keep prior selection until transaction; three local clients read signed content, no network', async (t) => {
  const f = await signedFixture(),
    x = setup(f);
  t.after(async () => Promise.all(x.runtimes.map((r) => r.dispose())));
  const prior = JSON.stringify({ version: 1, enabled: false });
  x.store.setItem(SHARED_RUNTIME_CONFIG, prior);
  const inspected = await x.flow.choose();
  assert.equal(inspected.phase, 'trust-required');
  assert.equal(f.stats.closes, 0);
  assert.equal(x.store.getItem(SHARED_RUNTIME_CONFIG), prior);
  assert.equal(x.runtimes.length, 0);
  const result = await x.flow.confirm(intent(inspected.summary));
  assert.equal(result.phase, 'imported');
  assert.equal(result.pendingSync, true);
  assert.equal(result.localCommitted, true);
  assert.equal(f.stats.closes, 1);
  assert.equal(f.stats.network, 0);
  assert.equal(result.directory.rooms[0].id, f.roomId);
  assert.equal(result.diary[0].local.data.title, '离线真实思绪');
  assert.equal(result.preferences.local.data.unknown.keep, '真实设置');
  assert.equal(JSON.parse(x.store.getItem(SHARED_RUNTIME_CONFIG)).libraryId, f.libraryId);
  assert(x.flow.canSwitch);
  const runtime = x.runtimes[0],
    entry = await runtime.diary.read(f.entryId),
    saved = await runtime.diary.save(f.entryId, { title: '离线已持久修改' }, entry.localRevision, {
      sync: false,
    });
  assert.equal(saved.status, 'pending');
  assert.equal(f.stats.network, 0);
  await runtime.dispose();
  const reopened = await x.createRuntime({
    config: { enabled: true, libraryId: f.libraryId, epoch: f.epoch },
    nativeRequest: f.nativeRequest,
  });
  assert.equal((await reopened.diary.read(f.entryId)).local.data.title, '离线已持久修改');
  assert.equal((await reopened.client.readOperation(saved.operationId)).status, 'pending');
});
test('real file inspection supports full signed offline publish without native ticket', async (t) => {
  const f = await signedFixture(),
    x = setup(f);
  t.after(async () => Promise.all(x.runtimes.map((r) => r.dispose())));
  const inspected = await x.flow.inspectFile(f.blob);
  assert.equal(inspected.phase, 'trust-required');
  assert.equal((await x.flow.confirm(intent(inspected.summary))).phase, 'imported');
  assert.equal(f.stats.closes, 0);
  assert.equal(f.stats.network, 0);
});
test('successful inspect retains ticket; rejection/cancel closes once and no runtime/config created', async () => {
  const f = await signedFixture(),
    x = setup(f);
  await x.flow.choose();
  await x.flow.cancel();
  assert.equal(f.stats.closes, 1);
  assert.equal(x.runtimes.length, 0);
  assert.equal(x.store.getItem(SHARED_RUNTIME_CONFIG), null);
  const unowned = await signedFixture();
  unowned.ticket.seedToken = 'invalid';
  const y = setup(unowned);
  const invalid = await y.flow.choose();
  assert.equal(invalid.code, 'SHARED_SEED_INVALID_TICKET');
  assert.equal(unowned.stats.closes, 0);
});
test('inspection corrupt member fails and closes once; cleanup failure preserves original error then explicit retry', async () => {
  const f = await signedFixture();
  const member = f.members.values().next().value;
  member[member.length - 2] ^= 1;
  const x = setup(f);
  f.setCloseFail(true);
  const failed = await x.flow.choose();
  assert.equal(failed.code, 'SHARED_SEED_MEMBER_HASH_MISMATCH');
  assert.equal(failed.phase, 'cleanup-required');
  assert.equal(x.runtimes.length, 0);
  assert.equal(f.stats.closes, 0);
  f.setCloseFail(false);
  const cleaned = await x.flow.retryCleanup();
  assert.equal(cleaned.phase, 'cleanup-complete');
  assert.equal(cleaned.code, 'SHARED_SEED_MEMBER_HASH_MISMATCH');
  assert.equal(f.stats.closes, 1);
});
test('native verification fallback is actually invoked when WebCrypto Ed25519 is unsupported', async () => {
  const f = await signedFixture(),
    descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  try {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {
        subtle: {
          importKey: async () => {
            throw Object.assign(Error('unsupported'), { name: 'NotSupportedError' });
          },
        },
      },
    });
    const summary = await inspectSharedSeedNativeTicket(f.ticket, {
      nativeRequest: f.nativeRequest,
    });
    assert.equal(summary.verified, true);
    assert.equal(summary.ticketDisposition, 'retained');
    assert.equal(f.stats.verifies, 1);
    await mkdir('outputs/2026-10-19-android-shared-import-ui', { recursive: true });
    await writeFile(
      'outputs/2026-10-19-android-shared-import-ui/v3-java-attestation-input.json',
      JSON.stringify({
        libraryId: f.libraryId,
        epoch: f.epoch,
        packageId: f.packageId,
        watermark: f.manifest.watermark,
        attestation: f.manifest.attestation,
      }),
    );
    await f.nativeRequest('sharedSeedClose', { seedToken: f.ticket.seedToken });
  } finally {
    Object.defineProperty(globalThis, 'crypto', descriptor);
  }
});
test('configuration write failure retains committed library; reopened recovery validates pin/status and activates without reimport', async (t) => {
  const f = await signedFixture(),
    x = setup(f);
  t.after(async () => Promise.all(x.runtimes.map((r) => r.dispose())));
  const old = JSON.stringify({ version: 1, enabled: false });
  x.store.setItem(SHARED_RUNTIME_CONFIG, old);
  const set = x.store.setItem;
  let failConfig = true;
  x.store.setItem = (key, value) => {
    if (key === SHARED_RUNTIME_CONFIG && failConfig)
      throw Object.assign(Error('QUOTA'), { code: 'QUOTA' });
    set(key, value);
  };
  const inspected = await x.flow.choose();
  const first = await x.flow.confirm(intent(inspected.summary));
  assert.equal(first.phase, 'activation-recovery');
  assert.equal(first.localCommitted, true);
  assert.equal(x.store.getItem(SHARED_RUNTIME_CONFIG), old);
  assert(x.store.getItem(IMPORT_ACTIVATION_RECOVERY));
  assert(!x.flow.canSwitch);
  const before = f.calls.length;
  failConfig = false;
  const recovered = createOfflineImportFlow({
    storage: x.store,
    nativeRequest: f.nativeRequest,
    createRuntime: x.createRuntime,
  });
  assert.equal((await recovered.recover()).phase, 'imported');
  assert.equal(f.calls.length, before, 'recovery makes no native calls or import');
  assert.equal(x.store.getItem(IMPORT_ACTIVATION_RECOVERY), null);
});
test('ticket ownership transfers to importer on import failure; runtime creation failure leaves selection intact and UI closes', async (t) => {
  const f = await signedFixture(),
    x = setup(f);
  t.after(async () => Promise.all(x.runtimes.map((r) => r.dispose())));
  const inspected = await x.flow.choose();
  const member = f.members.values().next().value;
  member[member.length - 2] ^= 1;
  const failed = await x.flow.confirm(intent(inspected.summary));
  assert.equal(failed.code, 'SHARED_SEED_MEMBER_HASH_MISMATCH');
  assert.equal(f.stats.closes, 1);
  assert.equal(x.store.getItem(SHARED_RUNTIME_CONFIG), null);
  const g = await signedFixture(),
    y = setup(g, {
      createRuntime: async () => {
        throw Error('OPEN_FAILED');
      },
    });
  const ready = await y.flow.choose();
  assert.equal((await y.flow.confirm(intent(ready.summary))).code, 'OPEN_FAILED');
  assert.equal(g.stats.closes, 1);
});
test('DOM first use offers explicit verified target/fingerprint, no pairing prerequisite, no activation before confirmation', async () => {
  const f = await signedFixture(),
    x = setup(f),
    dom = new JSDOM('<body></body>', {
      url: 'https://appassets.androidplatform.net/telegram/index.html',
    });
  const old = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document });
  try {
    const flow = await openOfflineSharedImport({
      storage: x.store,
      nativeRequest: f.nativeRequest,
      createRuntime: x.createRuntime,
    });
    const click = async (text) => {
      await [...document.querySelectorAll('button')].find((b) => b.textContent === text).onclick();
    };
    await click('选择电脑资料包');
    assert.match(document.querySelector('[role=status]').textContent, /完整校验通过/);
    assert.match(document.body.textContent, new RegExp(f.libraryId));
    assert.equal(x.store.getItem(SHARED_RUNTIME_CONFIG), null);
    await click('确认指纹并导入');
    assert.equal(x.runtimes.length, 0);
    assert.match(document.querySelector('[role=status]').textContent, /EXPLICIT_TRUST/);
    document.querySelector('select').value = 'verified';
    document.querySelector('input[type=checkbox]').checked = true;
    await click('确认指纹并导入');
    assert.match(document.body.textContent, /离线真实思绪/);
    assert.match(document.body.textContent, /offline-pending-sync/);
    assert.equal(f.stats.network, 0);
    await flow.dispose();
  } finally {
    await Promise.all(x.runtimes.map((r) => r.dispose()));
    dom.window.close();
    Object.assign(globalThis, old);
  }
});
test('same verified identity reuses existing runtime; old package reimport preserves offline edits, outbox and draft', async (t) => {
  const f = await signedFixture(),
    x = setup(f);
  t.after(async () => Promise.all(x.runtimes.map((r) => r.dispose())));
  const ready = await x.flow.choose();
  await x.flow.confirm(intent(ready.summary));
  const runtime = x.runtimes[0],
    entry = await runtime.diary.read(f.entryId);
  const op = await runtime.diary.save(f.entryId, { title: '待同步本机修改' }, entry.localRevision, {
    sync: false,
  });
  await runtime.client.setDraft(f.roomId, { text: '不丢的草稿', replyId: null });
  let created = 0;
  const sameLibrary = createOfflineImportFlow({
    currentRuntime: runtime,
    storage: x.store,
    nativeRequest: f.nativeRequest,
    createRuntime: async () => {
      created++;
      throw Error('must reuse');
    },
  });
  const inspected = await sameLibrary.choose();
  assert.equal(inspected.reuseCurrent, true);
  assert.equal((await sameLibrary.confirm(intent(inspected.summary))).phase, 'imported');
  assert.equal(created, 0);
  assert.equal((await runtime.diary.read(f.entryId)).local.data.title, '待同步本机修改');
  assert.equal((await runtime.client.readOperation(op.operationId)).status, 'pending');
  assert.equal((await runtime.client.readDraft(f.roomId)).text, '不丢的草稿');
  assert.equal(f.stats.network, 0);
});
test('page disposal after durable commit leaves previous activation and recovery marker, no stale callback or duplicate close', async (t) => {
  const f = await signedFixture(),
    x = setup(f),
    committed = gate(),
    continueResult = gate();
  t.after(async () => Promise.all(x.runtimes.map((r) => r.dispose())));
  const flow = createOfflineImportFlow({
    storage: x.store,
    nativeRequest: f.nativeRequest,
    onState: (s) => x.states.push(s),
    createRuntime: async (args) => {
      const runtime = await x.createRuntime(args),
        original = runtime.seed.importNativeTicket;
      runtime.seed.importNativeTicket = async (...args) => {
        const result = await original(...args);
        committed.resolve();
        await continueResult.promise;
        return result;
      };
      return runtime;
    },
  });
  const ready = await flow.choose(),
    work = flow.confirm(intent(ready.summary));
  await committed.promise;
  await flow.dispose();
  const count = x.states.length;
  continueResult.resolve();
  await work;
  assert.equal(x.store.getItem(SHARED_RUNTIME_CONFIG), null);
  assert(x.store.getItem(IMPORT_ACTIVATION_RECOVERY));
  assert.equal(f.stats.closes, 1);
  assert.equal(x.states.length, count);
});
test('real inspect cancellation closes once; explicit sync failure keeps durable edit and stable operation', async (t) => {
  const cancelled = await signedFixture(),
    entered = gate(),
    continueRead = gate(),
    x = setup(cancelled, {
      nativeRequest: async (action, input) => {
        if (action === 'sharedSeedManifestRead') {
          entered.resolve();
          await continueRead.promise;
        }
        return cancelled.nativeRequest(action, input);
      },
    });
  const picking = x.flow.choose();
  await entered.promise;
  await x.flow.cancel();
  continueRead.resolve();
  assert.equal((await picking).phase, 'cancelled');
  assert.equal(cancelled.stats.closes, 1);
  assert.equal(x.runtimes.length, 0);
  const f = await signedFixture(),
    y = setup(f);
  t.after(async () => Promise.all(y.runtimes.map((r) => r.dispose())));
  const ready = await y.flow.choose();
  await y.flow.confirm(intent(ready.summary));
  const runtime = y.runtimes[0],
    record = await runtime.diary.read(f.entryId);
  const saved = await runtime.diary.save(f.entryId, { title: '断网仍保存' }, record.localRevision, {
    sync: false,
  });
  assert.equal(f.stats.network, 0);
  const sync = await y.flow.syncNow();
  assert.equal(sync.localCommitted, true);
  assert(f.stats.network > 0);
  assert.equal((await runtime.diary.read(f.entryId)).local.data.title, '断网仍保存');
  assert.equal((await runtime.client.readOperation(saved.operationId)).status, 'pending');
  assert.equal((await runtime.client.status()).pending, 1);
});
test('precommit failure marker reopens as neutral state check, reports not imported with original error and preserves selection', async (t) => {
  const f = await signedFixture(),
    x = setup(f);
  t.after(async () => Promise.all(x.runtimes.map((r) => r.dispose())));
  const originalSelection = JSON.stringify({ version: 1, enabled: false });
  x.store.setItem(SHARED_RUNTIME_CONFIG, originalSelection);
  const ready = await x.flow.choose();
  const member = f.members.values().next().value;
  member[member.length - 2] ^= 1;
  const failed = await x.flow.confirm(intent(ready.summary));
  assert.equal(failed.code, 'SHARED_SEED_MEMBER_HASH_MISMATCH');
  assert(x.flow.hasRecovery);
  const marker = x.store.getItem(IMPORT_ACTIVATION_RECOVERY);
  assert.equal(JSON.parse(marker).lastErrorCode, 'SHARED_SEED_MEMBER_HASH_MISMATCH');
  const dom = new JSDOM('<body></body>', {
      url: 'https://appassets.androidplatform.net/telegram/index.html',
    }),
    old = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document });
  try {
    const reopened = await openOfflineSharedImport({
      storage: x.store,
      nativeRequest: f.nativeRequest,
      createRuntime: x.createRuntime,
    });
    const button = [...document.querySelectorAll('button')].find(
      (b) => b.textContent === '检查上次导入状态',
    );
    assert(button && !button.hidden);
    assert(!document.body.textContent.includes('继续打开上次已导入资料'));
    await button.onclick();
    const text = document.querySelector('[role=status]').textContent;
    assert.match(text, /尚未完成可用资料导入/);
    assert.match(text, /SHARED_SEED_PACKAGE_NOT_FOUND/);
    assert.match(text, /SHARED_SEED_MEMBER_HASH_MISMATCH/);
    assert.equal(x.store.getItem(SHARED_RUNTIME_CONFIG), originalSelection);
    assert.equal(x.store.getItem(IMPORT_ACTIVATION_RECOVERY), marker);
    assert(!reopened.canSwitch);
    await reopened.dispose();
  } finally {
    dom.window.close();
    Object.assign(globalThis, old);
  }
});
test('same-current runtime with file importer but no native importer rejects before ticket transfer and UI closes once', async () => {
  const f = await signedFixture();
  let fileCalled = 0;
  const current = {
    config: { enabled: true, libraryId: f.libraryId, epoch: f.epoch },
    seed: {
      status: async () => ({ status: 'quarantined' }),
      trust: async () => ({}),
      importFile: async () => {
        fileCalled++;
      },
    },
  };
  const x = setup(f, { currentRuntime: current });
  const ready = await x.flow.choose();
  assert.equal(ready.reuseCurrent, true);
  const failed = await x.flow.confirm(intent(ready.summary));
  assert.equal(failed.code, 'SHARED_IMPORT_RUNTIME_UPDATE_REQUIRED');
  assert.equal(f.stats.closes, 1);
  assert.equal(fileCalled, 0);
  assert.equal(x.store.getItem(IMPORT_ACTIVATION_RECOVERY), null);
  assert.equal(x.store.getItem(SHARED_RUNTIME_CONFIG), null);
});
