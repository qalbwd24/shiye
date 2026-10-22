import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash, generateKeyPairSync, sign } from 'node:crypto';
import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import readline from 'node:readline';
import { IDBFactory } from 'fake-indexeddb';
import { createDiaryServer } from '../src/server/app.mjs';
import { exportSharedSeed } from '../src/server/shared-sync/seed-package.mjs';
import { createSharedBusinessClient } from '../public/shared/shared-business-client.js';
import { createIndexedDbSyncStorage } from '../public/shared/sync-v2-client.js';
import { createSharedDiaryClient } from '../public/shared/shared-diary-client.js';
import {
  createSharedSeedImportController,
  inspectSharedSeedFile,
  inspectSharedSeedNativeTicket,
} from '../public/shared/shared-seed-import.js';
import {
  verifySharedSeedAttestation,
  sharedSeedAttestationBytes,
  sharedSeedManifestPayloadSha256,
  assertSharedSeedTrust,
} from '../public/shared/shared-seed-trust.js';
import { sharedSeedEntityBytes } from '../public/shared/shared-seed.js';
import { bootstrapDesktopSharedRuntime } from '../previews/telegram-chat/shiye-shared-runtime.js';
import { createSharedRuntime } from '../android/qq-chat/shared-runtime.js';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
test('both runtime media data callbacks read imported IDB originals offline and revoke their URL on dispose', async (t) => {
  const f = await fixture(t);
  await f.controller.importFile(f.blob);
  await f.reopen();
  f.state.offline = true;
  let calls = 0;
  const forbidden = () => {
    calls++;
    throw Error('offline runtime must use imported original');
  };
  for (const kind of ['desktop', 'android']) {
    const blobs = [],
      revoked = [],
      urlFactory = {
        createObjectURL(blob) {
          blobs.push(blob);
          return `blob:synthetic-${kind}`;
        },
        revokeObjectURL(url) {
          revoked.push(url);
        },
      };
    const common = {
      storage: f.storage,
      config: { enabled: true, libraryId: f.info.libraryId, epoch: f.info.epoch },
      currentRoom: () => null,
      pollMs: 30000,
      urlFactory,
    };
    const runtime =
      kind === 'desktop'
        ? await bootstrapDesktopSharedRuntime({
            ...common,
            request: forbidden,
            journal: { sourceId: async () => randomUUID() },
            events: null,
            BroadcastChannel: null,
          })
        : await createSharedRuntime({ ...common, nativeRequest: forbidden });
    assert.equal(typeof runtime.seed.importFile, 'function');
    const result = await runtime.readMedia({ mediaId: f.assetId });
    assert.equal(result.url, `blob:synthetic-${kind}`);
    assert.deepEqual(Buffer.from(await blobs[0].arrayBuffer()), f.original);
    await runtime.dispose();
    assert.deepEqual(revoked, [`blob:synthetic-${kind}`]);
  }
  assert.equal(calls, 0);
});
async function fixture(t, { diaryIndex = false } = {}) {
  const work = path.resolve('tmp/shared-seed-import', randomUUID()),
    dataDir = path.join(work, 'data'),
    entryId = randomUUID(),
    assetId = randomUUID(),
    original = Buffer.alloc(300007, 103);
  await fs.mkdir(path.join(dataDir, 'media'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'media', assetId), original);
  await fs.writeFile(
    path.join(dataDir, 'diary.json'),
    JSON.stringify({
      schema: 1,
      categories: ['日常'],
      tags: [],
      entries: [
        {
          id: entryId,
          title: 'shared seed fixture',
          content: '<p>editable full source</p>',
          contentFormat: 'html',
          date: '2026-10-19T01:00:00Z',
          createdAt: '2026-10-19T01:00:00Z',
          updatedAt: '2026-10-19T01:00:00Z',
          revision: 1,
          category: '日常',
          tags: [],
          attachments: [assetId],
          history: [],
          future: { keep: ['unknown'] },
        },
      ],
      media: [
        {
          id: assetId,
          name: 'original.dat',
          mime: 'application/octet-stream',
          size: original.length,
          sha256: sha(original),
        },
      ],
    }),
  );
  let server = await createDiaryServer({ dataDir, seed: false, sharedSync: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  let base = `http://127.0.0.1:${server.address().port}`;
  const state = { offline: false, calls: [], infoKeyOverride: null };
  async function http(route, input, method = input === undefined ? 'GET' : 'POST') {
    const response = await fetch(base + route, {
      method,
      headers: { 'X-Diary-Client': 'desktop', 'Content-Type': 'application/json' },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    });
    const value = await response.json();
    if (!response.ok)
      throw Object.assign(Error(value.error?.code || 'HTTP'), {
        code: value.error?.code,
        status: response.status,
      });
    return value;
  }
  const request = async (action, input) => {
    state.calls.push(action);
    if (state.offline) throw Object.assign(Error('offline'), { code: 'SHARED_OFFLINE' });
    const result = await http(
      '/api/shared/v1/' + (action === 'entity-read' ? 'entity/read' : action),
      action === 'info' ? undefined : input,
    );
    return action === 'info' && state.infoKeyOverride
      ? { ...result, seedSigningKey: state.infoKeyOverride }
      : result;
  };
  const info = await request('info');
  const file = path.join(work, 'real-source.syseed');
  const exported = await exportSharedSeed({
    file,
    directory: work,
    request,
    openOriginal: (id) =>
      createReadStream(path.join(dataDir, 'media', id), { highWaterMark: 131072 }),
  });
  const fileBytes = await fs.readFile(file),
    blob = new Blob([fileBytes]),
    indexedDB = new IDBFactory(),
    dbName = `shiye-sync-v2-${diaryIndex ? 'shared-import' : 'import'}-` + randomUUID();
  let storage, client, controller;
  function open() {
    storage = createIndexedDbSyncStorage({ indexedDB, dbName, diaryIndex });
    client = createSharedBusinessClient({
      storage,
      request,
      libraryId: info.libraryId,
      epoch: info.epoch,
    });
    controller = createSharedSeedImportController({
      storage,
      client,
      libraryId: info.libraryId,
      epoch: info.epoch,
    });
  }
  open();
  t.after(() => storage.close());
  return {
    work,
    entryId,
    assetId,
    original,
    exported,
    blob,
    fileBytes,
    file,
    info,
    http,
    request,
    state,
    get storage() {
      return storage;
    },
    get client() {
      return client;
    },
    get controller() {
      return controller;
    },
    async reopen() {
      await storage.close();
      open();
    },
    async migrate() {
      const old = base;
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      server = await createDiaryServer({ dataDir, seed: false, sharedSync: true });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      base = `http://127.0.0.1:${server.address().port}`;
      assert.notEqual(base, old);
    },
  };
}
test('signed offline seed publication writes the content-derived diary search index', async (t) => {
  const f = await fixture(t, { diaryIndex: true });
  const summary = await inspectSharedSeedFile(f.blob);
  f.state.offline = true;
  const result = await f.controller.importFile(f.blob, {
    offlineTrust: { explicit: true, keyFingerprintSha256: summary.keyFingerprintSha256 },
  });
  assert.equal(result.status, 'imported');
  const diary = createSharedDiaryClient({ client: f.client });
  assert.deepEqual(
    (await diary.listPage({ query: 'editable full source' })).items.map((row) => row.id),
    [f.entryId],
  );
  await f.reopen();
  assert.deepEqual(
    (
      await createSharedDiaryClient({ client: f.client }).listPage({
        query: 'editable full source',
      })
    ).items.map((row) => row.id),
    [f.entryId],
  );
});

test('signed first File import is fully offline, explicit TOFU/pin and originals/draft/edit outbox survive reopen then sync through old Entry API', async (t) => {
  const f = await fixture(t),
    summary = await inspectSharedSeedFile(f.blob);
  assert.equal(summary.bytesVerified, true);
  assert.equal(summary.libraryId, f.info.libraryId);
  f.state.offline = true;
  const before = f.state.calls.length;
  const result = await f.controller.importFile(f.blob, {
    offlineTrust: { explicit: true, keyFingerprintSha256: summary.keyFingerprintSha256 },
  });
  assert.equal(result.status, 'imported');
  assert.equal(result.pendingSync, true);
  assert.equal(f.state.calls.length, before);
  const original = (await f.client.readSeedOriginal(f.assetId)).handle;
  await f.client.setDraft('offline-draft', { text: 'keep offline draft', replyId: null });
  const row = await f.client.read('entry', f.entryId);
  await createSharedDiaryClient({ client: f.client }).save(
    f.entryId,
    { title: 'offline local edit' },
    row.localRevision,
    { sync: false },
  );
  await f.reopen();
  assert.equal((await f.client.read('entry', f.entryId)).local.data.title, 'offline local edit');
  assert.equal((await f.client.readDraft('offline-draft')).text, 'keep offline draft');
  assert.equal((await f.storage.transaction((tx) => tx.listPending())).length, 1);
  assert.equal((await f.client.readSeedOriginal(f.assetId)).handle, original);
  assert.deepEqual(
    Buffer.from(await (await f.controller.openOriginal(f.assetId)).read(0, 131072)),
    f.original.subarray(0, 131072),
  );
  await assert.rejects(f.client.sync());
  assert.equal((await f.client.read('entry', f.entryId)).local.data.title, 'offline local edit');
  f.state.offline = false;
  await f.client.sync();
  assert.equal((await f.http('/api/entries/' + f.entryId)).title, 'offline local edit');
  const meta = await f.storage.transaction((tx) => tx.getMeta());
  assert.equal(meta.sharedLibraryTrust.keyFingerprintSha256, summary.keyFingerprintSha256);
  assert.equal(meta.sharedLibraryTrust.syncStatus, 'synced');
  assert.deepEqual(meta.sharedSeedPendingSync, []);
});
test('offline runtime startup and reconstruction use local identity without info and preserve body/original/outbox on both clients', async (t) => {
  for (const kind of ['desktop', 'android'])
    await t.test(kind, async (sub) => {
      const f = await fixture(sub),
        summary = await inspectSharedSeedFile(f.blob);
      f.state.offline = true;
      await f.controller.importFile(f.blob, {
        offlineTrust: { explicit: true, keyFingerprintSha256: summary.keyFingerprintSha256 },
      });
      const build = () => {
        const common = {
          storage: f.storage,
          config: { enabled: true, libraryId: f.info.libraryId, epoch: f.info.epoch },
          currentRoom: () => null,
          pollMs: 30000,
        };
        return kind === 'desktop'
          ? bootstrapDesktopSharedRuntime({
              ...common,
              request: f.request,
              journal: { sourceId: async () => randomUUID() },
              events: null,
              BroadcastChannel: null,
            })
          : createSharedRuntime({
              ...common,
              nativeRequest: (action) => {
                assert.equal(action, 'sharedInfo');
                return f.request('info');
              },
            });
      };
      const before = f.state.calls.length;
      let runtime = await build();
      assert.equal(f.state.calls.length, before, 'construction/status has no service dependency');
      assert.equal((await runtime.start()).offline, true);
      const row = await runtime.diary.read(f.entryId);
      await runtime.diary.save(f.entryId, { title: 'runtime offline write' }, row.localRevision, {
        sync: false,
      });
      await runtime.dispose();
      runtime = await build();
      assert.equal((await runtime.diary.read(f.entryId)).local.data.title, 'runtime offline write');
      assert.equal((await f.storage.transaction((tx) => tx.listPending())).length, 1);
      assert.equal((await runtime.seed.openOriginal(f.assetId)).size, f.original.length);
      await runtime.dispose();
    });
});
test('pinned key change blocks only sync; same owner at a new URL keeps pin, cursor, draft and pending edit', async (t) => {
  const f = await fixture(t),
    summary = await inspectSharedSeedFile(f.blob);
  f.state.offline = true;
  await f.controller.importFile(f.blob, {
    offlineTrust: { explicit: true, keyFingerprintSha256: summary.keyFingerprintSha256 },
  });
  await f.client.setDraft('keep', { text: 'local draft', replyId: null });
  const row = await f.client.read('entry', f.entryId);
  await createSharedDiaryClient({ client: f.client }).save(
    f.entryId,
    { title: 'pending migration edit' },
    row.localRevision,
    { sync: false },
  );
  f.state.offline = false;
  f.state.infoKeyOverride = {
    algorithm: 'Ed25519',
    keyFingerprintSha256: '0'.repeat(64),
    publicKeyRawBase64: Buffer.alloc(32).toString('base64'),
  };
  const before = f.state.calls.length;
  await assert.rejects(f.client.sync(), { code: 'SHARED_SEED_KEY_IDENTITY_MISMATCH' });
  assert.ok(!f.state.calls.slice(before).includes('command'));
  assert.equal(
    (await f.client.read('entry', f.entryId)).local.data.title,
    'pending migration edit',
  );
  f.state.infoKeyOverride = null;
  await f.migrate();
  await f.client.resume();
  await f.client.sync();
  assert.equal((await f.http('/api/entries/' + f.entryId)).title, 'pending migration edit');
  assert.equal((await f.client.readDraft('keep')).text, 'local draft');
  const meta = await f.storage.transaction((tx) => tx.getMeta());
  assert.equal(meta.sharedLibraryTrust.keyFingerprintSha256, summary.keyFingerprintSha256);
  assert.ok(
    (typeof meta.cursor === 'object' ? meta.cursor.after : meta.cursor) >= summary.watermark,
  );
});
test('a newly self-signed package with the same identity cannot replace an existing pinned key or forge the private verification brand', async (t) => {
  const f = await fixture(t),
    summary = await inspectSharedSeedFile(f.blob);
  f.state.offline = true;
  await f.controller.importFile(f.blob, {
    offlineTrust: { explicit: true, keyFingerprintSha256: summary.keyFingerprintSha256 },
  });
  const length = f.fileBytes.readUInt32BE(14),
    manifest = JSON.parse(f.fileBytes.subarray(18, 18 + length)),
    { publicKey, privateKey } = generateKeyPairSync('ed25519'),
    raw = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
  manifest.packageId = randomUUID();
  const a = {
    ...manifest.attestation,
    exportId: randomUUID(),
    publicKeyRawBase64: raw.toString('base64'),
    keyFingerprintSha256: sha(raw),
  };
  manifest.attestation = a;
  a.manifestPayloadSha256 = sharedSeedManifestPayloadSha256(manifest);
  a.signatureBase64 = sign(null, sharedSeedAttestationBytes(manifest, a), privateKey).toString(
    'base64',
  );
  const m = sharedSeedEntityBytes(manifest),
    prefix = Buffer.alloc(18);
  f.fileBytes.copy(prefix, 0, 0, 14);
  prefix.writeUInt32BE(m.length, 14);
  const file = new Blob([prefix, m, f.fileBytes.subarray(18 + length)]),
    changed = await inspectSharedSeedFile(file);
  assert.notEqual(changed.keyFingerprintSha256, summary.keyFingerprintSha256);
  assert.throws(() => assertSharedSeedTrust({ ...changed }, manifest), {
    code: 'SHARED_SEED_VERIFIED_PROOF_REQUIRED',
  });
  await assert.rejects(
    f.controller.importFile(file, {
      offlineTrust: { explicit: true, keyFingerprintSha256: changed.keyFingerprintSha256 },
    }),
    { code: 'SHARED_SEED_KEY_IDENTITY_MISMATCH' },
  );
  assert.equal(
    (await f.storage.transaction((tx) => tx.getMeta())).sharedLibraryTrust.keyFingerprintSha256,
    summary.keyFingerprintSha256,
  );
  assert.ok(await f.client.read('entry', f.entryId));
});
test('offline TOFU intent cannot substitute for signature/proof or silently pin without explicit matching fingerprint', async (t) => {
  const f = await fixture(t);
  f.state.offline = true;
  await assert.rejects(f.controller.importFile(f.blob, { offline: true }), {
    code: 'SHARED_SEED_EXPLICIT_TRUST_REQUIRED',
  });
  await assert.rejects(
    f.controller.importFile(f.blob, {
      offlineTrust: { explicit: true, keyFingerprintSha256: '0'.repeat(64) },
    }),
    { code: 'SHARED_SEED_EXPLICIT_TRUST_REQUIRED' },
  );
  assert.equal((await f.storage.transaction((tx) => tx.getMeta())).sharedLibraryTrust, undefined);
  assert.equal(await f.client.read('entry', f.entryId), undefined);
  const damaged = Buffer.from(f.fileBytes);
  damaged[damaged.length - 1] ^= 1;
  await assert.rejects(inspectSharedSeedFile(new Blob([damaged])), {
    code: 'SHARED_SEED_MEMBER_HASH_MISMATCH',
  });
});
test('actual IDB publication abort rolls back signed trust pin, active baseline and cursor together while preserving old draft', async (t) => {
  const f = await fixture(t),
    summary = await inspectSharedSeedFile(f.blob);
  await f.client.setDraft('existing', { text: 'keep', replyId: null });
  let armed = true;
  const storage = {
    transaction: (fn) =>
      f.storage.transaction(async (tx) => {
        const result = await fn(tx);
        if (armed && (await tx.getMeta())?.sharedLibraryTrust) {
          armed = false;
          throw Object.assign(Error('pin commit abort'), { code: 'SYNTHETIC_PIN_ABORT' });
        }
        return result;
      }),
  };
  const client = createSharedBusinessClient({
      storage,
      request: f.request,
      libraryId: f.info.libraryId,
      epoch: f.info.epoch,
    }),
    controller = createSharedSeedImportController({
      storage,
      client,
      libraryId: f.info.libraryId,
      epoch: f.info.epoch,
    });
  f.state.offline = true;
  await assert.rejects(
    controller.importFile(f.blob, {
      offlineTrust: { explicit: true, keyFingerprintSha256: summary.keyFingerprintSha256 },
    }),
    { code: 'SYNTHETIC_PIN_ABORT' },
  );
  const meta = await f.storage.transaction((tx) => tx.getMeta());
  assert.equal(meta.sharedLibraryTrust, undefined);
  assert.equal(meta.initialized, false);
  assert.equal(meta.cursor, null);
  assert.equal(await f.client.read('entry', f.entryId), undefined);
  assert.equal((await f.client.readDraft('existing')).text, 'keep');
});
test('File import uses shared quarantine/catchup owner, disk-like IDB chunks reopen, full Entry is writable through the old HTTP API', async (t) => {
  const f = await fixture(t);
  await f.client.setDraft('phone-existing-test', { text: 'keep test draft', replyId: null });
  await f.storage.transaction((tx) =>
    tx.putEntity({
      entityType: 'local-existing-test',
      entityId: 'keep',
      base: null,
      local: null,
      blob: new Blob(['keep original phone test']),
    }),
  );
  const result = await f.controller.importFile(f.blob, { expectedSha256: f.exported.sha256 });
  assert.equal(result.status, 'imported');
  const indexed = await f.client.readSeedOriginal(f.assetId);
  assert.match(indexed.handle, /^shared-seed-idb:/);
  assert.ok(
    !JSON.stringify(await f.storage.transaction((tx) => tx.getMeta())).includes('bytesBase64'),
  );
  const pieces = [];
  await f.controller.copyOriginal(f.assetId, {
    sink: {
      async write(offset, bytes) {
        assert.ok(bytes.length <= 131072);
        pieces.push(bytes);
      },
      async finish() {
        return true;
      },
    },
  });
  assert.deepEqual(Buffer.concat(pieces), f.original);
  await f.reopen();
  f.state.offline = true;
  const offline = await f.controller.openOriginal(f.assetId);
  assert.deepEqual(Buffer.from(await offline.read(0, 131072)), f.original.subarray(0, 131072));
  f.state.offline = false;
  assert.equal((await f.client.readDraft('phone-existing-test')).text, 'keep test draft');
  assert.equal(
    (await f.storage.transaction((tx) => tx.getEntity('local-existing-test', 'keep'))).blob.size,
    24,
  );
  const row = await f.client.read('entry', f.entryId);
  assert.deepEqual(row.local.data.future, { keep: ['unknown'] });
  await createSharedDiaryClient({ client: f.client }).save(
    f.entryId,
    { title: 'edited after real file import' },
    row.localRevision,
  );
  await f.client.sync();
  const pc = await f.http('/api/entries/' + f.entryId);
  assert.equal(pc.title, 'edited after real file import');
  assert.deepEqual(pc.future, { keep: ['unknown'] });
});
test('offline File remains quarantined and invisible, reconnect publishes trusted current delta once without replacing existing drafts/outbox', async (t) => {
  const f = await fixture(t);
  await f.client.setDraft('existing', { text: 'phone test survives', replyId: null });
  const pending = {
    operationId: randomUUID(),
    wire: { operationId: randomUUID(), action: 'synthetic-existing' },
    optimistic: [],
    sent: false,
  };
  await f.storage.transaction((tx) => tx.putPending(pending));
  f.state.offline = true;
  const imported = await f.controller.importFile(f.blob, { resolve: false });
  assert.equal(imported.status, 'quarantined');
  assert.equal(await f.client.read('entry', f.entryId), undefined);
  assert.equal(await f.controller.openOriginal(f.assetId), null);
  f.state.offline = false;
  const original = await f.http('/api/entries/' + f.entryId);
  await f.http(
    '/api/entries/' + f.entryId,
    { ...original, title: 'new PC data after package' },
    'PUT',
  );
  await f.reopen();
  const result = await f.controller.resume(imported.packageId);
  assert.equal(result.status, 'imported');
  assert.equal(
    (await f.client.read('entry', f.entryId)).local.data.title,
    'new PC data after package',
  );
  assert.equal((await f.client.readDraft('existing')).text, 'phone test survives');
  assert.deepEqual(await f.storage.transaction((tx) => tx.listPending()), [
    { ...pending, order: 1 },
  ]);
});
test('wrong identity, cancellation, damaged package/member and import transaction failure cannot publish or erase older local data', async (t) => {
  const f = await fixture(t);
  await f.client.setDraft('existing', { text: 'keep', replyId: null });
  const wrong = createSharedSeedImportController({
    client: f.client,
    storage: f.storage,
    libraryId: randomUUID(),
    epoch: f.info.epoch,
  });
  await assert.rejects(wrong.importFile(f.blob), { code: 'SHARED_IDENTITY_MISMATCH' });
  const stop = new AbortController();
  stop.abort();
  await assert.rejects(f.controller.importFile(f.blob, { signal: stop.signal }), {
    code: 'SHARED_SEED_CANCELLED',
  });
  const damaged = Buffer.from(f.fileBytes);
  damaged[damaged.length - 1] ^= 1;
  await assert.rejects(f.controller.importFile(new Blob([damaged])), {
    code: 'SHARED_SEED_MEMBER_HASH_MISMATCH',
  });
  await assert.rejects(f.controller.importFile(f.blob, { expectedSha256: '0'.repeat(64) }), {
    code: 'SHARED_SEED_PACKAGE_HASH_MISMATCH',
  });
  assert.equal(await f.client.read('entry', f.entryId), undefined);
  assert.equal((await f.client.readDraft('existing')).text, 'keep');
  let armed = true;
  const failingStorage = {
    transaction: (fn) =>
      f.storage.transaction(async (tx) => {
        const result = await fn(tx);
        if (armed && (await tx.listEntities('local-seed-package')).length) {
          armed = false;
          // Abort the actual IDB transaction after package/entities/meta writes,
          // before its commit ACK. Completed media stages came from prior txs.
          throw Object.assign(Error('synthetic commit failure'), {
            code: 'SYNTHETIC_IMPORT_ABORT',
          });
        }
        return result;
      }),
  };
  const failedClient = createSharedBusinessClient({
    storage: failingStorage,
    request: f.request,
    libraryId: f.info.libraryId,
    epoch: f.info.epoch,
  });
  const failed = createSharedSeedImportController({
    client: failedClient,
    storage: failingStorage,
    libraryId: f.info.libraryId,
    epoch: f.info.epoch,
  });
  await assert.rejects(failed.importFile(f.blob), { code: 'SYNTHETIC_IMPORT_ABORT' });
  const stages = await f.storage.transaction((tx) => tx.listEntities('local-seed-original'));
  assert.ok(stages.every((row) => row.seedOriginal.status === 'aborted'));
  assert.equal(
    (await f.storage.transaction((tx) => tx.listEntities('local-seed-package'))).length,
    0,
  );
  assert.equal(
    (await f.storage.transaction((tx) => tx.listEntities('local-seed-entity'))).length,
    0,
  );
  assert.equal((await f.client.readDraft('existing')).text, 'keep');
  assert.equal(await f.controller.openOriginal(f.assetId), null);
});
test('reimport of an existing package discards only the new unowned stage and preserves the already published original handle', async (t) => {
  const f = await fixture(t);
  const first = await f.controller.importFile(f.blob);
  assert.equal(first.status, 'imported');
  const original = await f.client.readSeedOriginal(f.assetId);
  const replay = await f.controller.importFile(f.blob, { resolve: false });
  assert.equal(replay.status, 'imported');
  assert.equal(replay.replayed, true);
  assert.equal((await f.client.readSeedOriginal(f.assetId)).handle, original.handle);
  const stages = await f.storage.transaction((tx) => tx.listEntities('local-seed-original'));
  assert.equal(stages.filter((row) => row.seedOriginal.status === 'complete').length, 1);
  assert.equal(stages.filter((row) => row.seedOriginal.status === 'aborted').length, 1);
  assert.deepEqual(
    Buffer.from(await (await f.controller.openOriginal(f.assetId)).read(0, 131072)),
    f.original.subarray(0, 131072),
  );
  const estimate = await f.controller.estimateFile(f.blob);
  assert.equal(estimate.originalBytes, f.original.length);
  assert.ok(estimate.estimatedAdditionalBytes > f.original.length);
  assert.equal(estimate.estimateOnly, true);
});

test('actual Java selected native file ticket passes paged manifest/member/stage ports into the same JS inbox and original survives native close/reopen', async (t) => {
  const f = await fixture(t),
    classes = path.join(f.work, 'native-classes'),
    privateRoot = path.join(f.work, 'native-private'),
    jar = path.resolve('tmp/shared-business-native-host/deps/json-20240303.jar');
  assert.equal(
    sha(await fs.readFile(jar)),
    '3cf6cd6892e32e2b4c1c39e0f52f5248a2f5b37646fdfbb79a66b46b618414ed',
  );
  await fs.mkdir(classes);
  const javaHome = process.env.JAVA_HOME || 'D:/codex-tools/android-studio/jbr';
  await promisify(execFile)(path.join(javaHome, 'bin/javac.exe'), [
    '-encoding',
    'UTF-8',
    '-cp',
    jar,
    '-d',
    classes,
    'android/app/src/main/java/dev/shiye/app/SharedSeedFile.java',
    'android/app/src/main/java/dev/shiye/app/SharedSeedBridge.java',
    'android/sync-tests/SharedSeedPortProbe.java',
  ]);
  let child,
    calls = 0,
    maxFrame = 0;
  const nativeActions = [];
  function open() {
    const pending = [];
    child = spawn(
      path.join(javaHome, 'bin/java.exe'),
      [
        '-cp',
        classes + path.delimiter + jar,
        'dev.shiye.app.SharedSeedPortProbe',
        f.file,
        privateRoot,
      ],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      maxFrame = Math.max(maxFrame, Buffer.byteLength(line));
      const waiter = pending.shift(),
        reply = JSON.parse(line);
      if (reply.ok) waiter.resolve(reply.result);
      else waiter.reject(Object.assign(Error(reply.code), { code: reply.code }));
    });
    return (action, input = {}) =>
      new Promise((resolve, reject) => {
        calls++;
        nativeActions.push({ action, input });
        const text = JSON.stringify({ action, input });
        maxFrame = Math.max(maxFrame, Buffer.byteLength(text));
        pending.push({ resolve, reject });
        child.stdin.write(text + '\n');
      });
  }
  let port = open();
  async function close() {
    child.stdin.end();
    await new Promise((resolve) => child.once('exit', resolve));
  }
  t.after(close);
  let controller = createSharedSeedImportController({
    client: f.client,
    storage: f.storage,
    libraryId: f.info.libraryId,
    epoch: f.info.epoch,
    nativeRequest: (...args) => port(...args),
  });
  for (const guard of ['manifest', 'identity', 'cancel']) {
    const rejectedTicket = await port('native-selected-prepare');
    const changed = structuredClone(rejectedTicket),
      stop = new AbortController();
    if (guard === 'manifest') changed.manifest.byteLength = 0;
    if (guard === 'identity') changed.libraryId = randomUUID();
    if (guard === 'cancel') stop.abort();
    const before = nativeActions.length;
    await assert.rejects(controller.importNativeTicket(changed, { signal: stop.signal }));
    assert.equal(
      nativeActions
        .slice(before)
        .filter(
          (call) =>
            call.action === 'sharedSeedClose' && call.input.seedToken === rejectedTicket.seedToken,
        ).length,
      1,
      guard + ' guard must close owned ticket once',
    );
    await assert.rejects(
      port('sharedSeedManifestRead', { seedToken: rejectedTicket.seedToken, offset: 0, length: 1 }),
      { code: 'SHARED_SEED_NOT_FOUND' },
    );
  }
  const untouched = await port('native-selected-prepare'),
    beforeInvalid = nativeActions.length;
  await assert.rejects(
    controller.importNativeTicket({ ...untouched, seedToken: '../../other-owner' }),
    { code: 'SHARED_SEED_INVALID_TICKET' },
  );
  assert.equal(
    nativeActions.length,
    beforeInvalid,
    'malformed token must not be routed to close another task',
  );
  assert.equal(
    (await port('sharedSeedManifestRead', { seedToken: untouched.seedToken, offset: 0, length: 1 }))
      .next,
    1,
  );
  await port('sharedSeedClose', { seedToken: untouched.seedToken });
  const ticket = await port('native-selected-prepare');
  assert.ok(JSON.stringify(ticket).length < 2048);
  const preview = await inspectSharedSeedNativeTicket(ticket, {
    nativeRequest: (...args) => port(...args),
  });
  assert.equal(preview.bytesVerified, true);
  assert.equal(preview.ticketDisposition, 'retained');
  const rejectedInspection = await port('native-selected-prepare'),
    beforeInspectionFailure = nativeActions.length;
  await assert.rejects(
    inspectSharedSeedNativeTicket(
      { ...rejectedInspection, manifest: { byteLength: 0, sha256: '0'.repeat(64) } },
      { nativeRequest: (...args) => port(...args) },
    ),
    (error) => error.code === 'SHARED_SEED_INVALID_TICKET' && error.ticketDisposition === 'closed',
  );
  assert.equal(
    nativeActions
      .slice(beforeInspectionFailure)
      .filter(
        (call) =>
          call.action === 'sharedSeedClose' &&
          call.input.seedToken === rejectedInspection.seedToken,
      ).length,
    1,
  );
  assert.equal(
    (await port('sharedSeedManifestRead', { seedToken: ticket.seedToken, offset: 0, length: 1 }))
      .next,
    1,
    'inspection failure leaves the other UI-owned token alive',
  );
  const closeFailureTicket = await port('native-selected-prepare');
  await assert.rejects(
    inspectSharedSeedNativeTicket(
      { ...closeFailureTicket, manifest: { byteLength: 0, sha256: '0'.repeat(64) } },
      {
        nativeRequest: (action, input) =>
          action === 'sharedSeedClose'
            ? Promise.reject(Error('synthetic close transport failure'))
            : port(action, input),
      },
    ),
    (error) =>
      error.code === 'SHARED_SEED_INVALID_TICKET' &&
      error.closeFailed === true &&
      error.cleanupRequired === true &&
      error.ticketDisposition === undefined,
  );
  assert.equal(
    (
      await port('sharedSeedManifestRead', {
        seedToken: closeFailureTicket.seedToken,
        offset: 0,
        length: 1,
      })
    ).next,
    1,
  );
  await port('sharedSeedClose', { seedToken: closeFailureTicket.seedToken });
  const beforeUnowned = nativeActions.length;
  await assert.rejects(
    inspectSharedSeedNativeTicket(
      { seedToken: '../other-owner' },
      { nativeRequest: (...args) => port(...args) },
    ),
    (error) => error.ticketDisposition === 'unowned',
  );
  assert.equal(nativeActions.length, beforeUnowned);
  const manifestLength = f.fileBytes.readUInt32BE(14),
    manifest = JSON.parse(f.fileBytes.subarray(18, 18 + manifestLength).toString('utf8'));
  const nativeContext = {
    libraryId: manifest.libraryId,
    epoch: manifest.epoch,
    packageId: manifest.packageId,
    watermark: manifest.watermark,
    attestation: manifest.attestation,
  };
  assert.equal((await port('sharedSeedVerifyAttestation', nativeContext)).verified, true);
  assert.equal(
    (
      await port('sharedSeedVerifyAttestation', {
        ...nativeContext,
        attestation: {
          ...manifest.attestation,
          signatureBase64: Buffer.alloc(64).toString('base64'),
        },
      })
    ).verified,
    false,
  );
  await assert.rejects(
    verifySharedSeedAttestation(
      {
        ...manifest,
        attestation: {
          ...manifest.attestation,
          signatureBase64: Buffer.alloc(64).toString('base64'),
        },
      },
      {
        // An injected verifier cannot force fallback or forge a WebCrypto proof.
        crypto: { subtle: { verify: async () => true } },
        nativeVerify: async () => true,
      },
    ),
    { code: 'SHARED_SEED_INVALID_SIGNATURE' },
  );
  const beforeSuccess = nativeActions.length,
    result = await controller.importNativeTicket(ticket);
  assert.equal(result.status, 'imported');
  assert.equal(
    nativeActions
      .slice(beforeSuccess)
      .filter(
        (call) => call.action === 'sharedSeedClose' && call.input.seedToken === ticket.seedToken,
      ).length,
    1,
  );
  assert.ok(calls > 10);
  assert.ok(maxFrame < 256 * 1024);
  await assert.rejects(
    port('sharedSeedManifestRead', { seedToken: ticket.seedToken, offset: 0, length: 1 }),
    { code: 'SHARED_SEED_NOT_FOUND' },
  );
  await close();
  port = open();
  await f.reopen();
  controller = createSharedSeedImportController({
    client: f.client,
    storage: f.storage,
    libraryId: f.info.libraryId,
    epoch: f.info.epoch,
    nativeRequest: (...args) => port(...args),
  });
  f.state.offline = true;
  const source = await controller.openOriginal(f.assetId);
  assert.deepEqual(Buffer.from(await source.read(0, 131072)), f.original.subarray(0, 131072));
  const pieces = [];
  await controller.copyOriginal(f.assetId, {
    sink: {
      async write(offset, bytes) {
        pieces.push(bytes);
      },
      async finish() {
        return true;
      },
    },
  });
  assert.deepEqual(Buffer.concat(pieces), f.original);
});
