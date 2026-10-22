import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, writeFile, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { IDBFactory } from 'fake-indexeddb';
import { createDiaryServer } from '../src/server/app.mjs';
import { createSharedBusinessClient } from '../public/shared/shared-business-client.js';
import { createIndexedDbSyncStorage } from '../public/shared/sync-v2-client.js';
import { createMemorySyncStorage } from './helpers/sync-v2-client-memory.mjs';
import {
  prepareSharedSeed,
  validateSharedSeedManifest,
  sharedSeedLogicalSha256,
} from '../public/shared/shared-seed.js';
import {
  exportSharedSeed,
  readSharedSeed,
  openSharedSeedOriginal,
  collectSharedSeedSnapshot,
} from '../src/server/shared-sync/seed-package.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const bytesOf = async (stream) => {
  const parts = [];
  for await (const part of stream) parts.push(part);
  return Buffer.concat(parts);
};
const entry = (id, attachments = [], large = false) => ({
  id,
  title: '原完整日记',
  contentFormat: 'html',
  content: `<p>${large ? 'x'.repeat(2 * 1024 * 1024 + 100) : 'source-body'}</p>`,
  date: '2026-10-19T01:00:00Z',
  createdAt: '2026-10-19T01:00:00Z',
  updatedAt: '2026-10-19T01:00:00Z',
  revision: 1,
  category: '日常',
  tags: [],
  attachments,
  history: [],
  future: { nested: ['keep', false] },
});
async function fixture(t, { large = false, mediaMetadata = {} } = {}) {
  const root = path.resolve('tmp/shared-seed-tests');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'case-')),
    dataDir = path.join(directory, 'data'),
    work = path.join(directory, 'work');
  await mkdir(path.join(dataDir, 'media'), { recursive: true });
  await mkdir(work);
  const assetId = randomUUID(),
    entryId = randomUUID(),
    original = Buffer.from('original synthetic bytes\0');
  await writeFile(path.join(dataDir, 'media', assetId), original);
  await writeFile(
    path.join(dataDir, 'diary.json'),
    JSON.stringify({
      schema: 1,
      categories: ['日常'],
      tags: [],
      entries: [entry(entryId, [assetId], large)],
      media: [
        {
          id: assetId,
          name: '原件.dat',
          mime: 'application/octet-stream',
          ...mediaMetadata,
          size: original.length,
          sha256: sha(original),
          future: { unknown: true },
        },
      ],
    }),
  );
  let server = await createDiaryServer({ dataDir, seed: false, sharedSync: true });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  let base = `http://127.0.0.1:${server.address().port}`;
  const http = async (route, input, method = input === undefined ? 'GET' : 'POST') => {
    const response = await fetch(base + route, {
      method,
      headers: { 'X-Diary-Client': 'desktop', 'Content-Type': 'application/json' },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    });
    const value = await response.json();
    if (!response.ok)
      throw Object.assign(Error(value.error?.code || JSON.stringify(value)), {
        status: response.status,
        code: value.error?.code,
      });
    return value;
  };
  let offline = false;
  const calls = [];
  const request = (action, input) => {
    calls.push({ action, input: structuredClone(input) });
    if (offline) return Promise.reject(Error('offline'));
    return http(
      '/api/shared/v1/' + (action === 'entity-read' ? 'entity/read' : action),
      action === 'info' ? undefined : input,
    );
  };
  const info = await request('info');
  const client = (storage = createMemorySyncStorage()) =>
    createSharedBusinessClient({ request, storage, libraryId: info.libraryId, epoch: info.epoch });
  async function exportPackage({ source = 'http' } = {}) {
    const file = path.join(directory, randomUUID() + '.syseed');
    const frozen =
      source === 'owner'
        ? JSON.parse(await readFile(path.join(dataDir, 'diary.json'), 'utf8'))
        : null;
    const result = await exportSharedSeed({
      file,
      directory: work,
      ...(frozen ? { getDb: () => frozen } : { request }),
      openOriginal: (id) => createReadStream(path.join(dataDir, 'media', id), { highWaterMark: 3 }),
    });
    return {
      ...result,
      reader: () => readSharedSeed({ file, directory: work, expectedSha256: result.sha256 }),
    };
  }
  return {
    directory,
    work,
    dataDir,
    info,
    assetId,
    entryId,
    original,
    request,
    http,
    client,
    exportPackage,
    async reopen() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      server = await createDiaryServer({ dataDir, seed: false, sharedSync: true });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      base = `http://127.0.0.1:${server.address().port}`;
    },
    calls,
    offline: (v) => {
      offline = v;
    },
  };
}

test('seed original MIME preserves authoritative type, legacy mime fallback and non-image bytes', async (t) => {
  for (const [mediaMetadata, expected] of [
    [{ type: 'application/pdf', mime: 'text/plain' }, 'application/pdf'],
    [{ mime: 'text/plain' }, 'text/plain'],
    [{ mime: undefined }, 'application/octet-stream'],
  ]) {
    const f = await fixture(t, { mediaMetadata });
    const exported = await f.exportPackage();
    assert.equal(exported.manifest.assets[0].mime, expected);
    const opened = await exported.reader();
    try {
      const media = opened.prepared.entities.find(
        (row) => row.entityType === 'media' && row.entityId === f.assetId,
      );
      assert.equal(media.data.type, mediaMetadata.type);
      assert.equal(media.data.mime, mediaMetadata.mime);
      const original = opened.prepared.originals.find((row) => row.assetId === f.assetId);
      assert.deepEqual(
        await bytesOf(openSharedSeedOriginal({ directory: f.work, handle: original.handle })),
        f.original,
      );
    } finally {
      await opened.dispose();
    }
  }
});

test('same owner HTTP seed preserves >2MiB complete entry, originals, unknown fields, pending draft/Blob and remains writable', async (t) => {
  const f = await fixture(t, { large: true }),
    exported = await f.exportPackage();
  assert.ok(
    exported.manifest.members.some(
      (m) => m.path.startsWith('entities/') && m.size > 2 * 1024 * 1024,
    ),
  );
  assert.equal(exported.manifest.libraryId, f.info.libraryId);
  assert.equal(exported.manifest.epoch, f.info.epoch);
  assert.equal(JSON.stringify(exported.manifest).includes(f.directory), false);
  const prepared = await exported.reader();
  const indexedDB = new IDBFactory(),
    storage = createIndexedDbSyncStorage({
      indexedDB,
      dbName: 'shiye-sync-v2-shared-seed-' + randomUUID(),
    }),
    client = f.client(storage);
  t.after(() => storage.close());
  const op = randomUUID();
  await client.setDraft('same-room', { text: 'keep draft', replyId: '12345678901234567890' });
  await storage.transaction((tx) =>
    tx.putEntity({
      entityType: 'local-blob',
      entityId: 'unsent',
      blob: new Blob(['unsent bytes']),
      base: null,
      local: null,
    }),
  );
  await client.enqueue({
    operationId: op,
    action: 'client-preferences-save',
    input: {
      scope: 'shared:thoughts',
      expectedRevision: 0,
      set: { future: ['pending'] },
      remove: [],
    },
    optimistic: [{ entityType: 'entry', entityId: f.entryId, changes: { title: 'pending title' } }],
  });
  const imported = await client.importSeed(prepared.prepared);
  assert.equal(imported.status, 'imported');
  const row = await client.read('entry', f.entryId);
  assert.equal(row.base.data.content.length, 2 * 1024 * 1024 + 107);
  assert.deepEqual(row.base.data.future, { nested: ['keep', false] });
  assert.equal(row.local.data.title, 'pending title');
  assert.equal(row.base.data._product, undefined);
  assert.equal((await client.status()).pending, 1);
  assert.equal((await client.readOperation(op)).status, 'pending');
  assert.equal((await client.readDraft('same-room')).text, 'keep draft');
  assert.equal(await (await client.read('local-blob', 'unsent')).blob.text(), 'unsent bytes');
  const original = await client.readSeedOriginal(f.assetId);
  assert.equal(original.sha256, sha(f.original));
  await prepared.dispose(); // consumed stage must remain readable after Prepared.close
  assert.deepEqual(
    await bytesOf(openSharedSeedOriginal({ directory: f.work, handle: original.handle })),
    f.original,
  );
  await client.sync();
  assert.equal((await client.status()).pending, 0);
  const full = await f.http('/api/entries/' + f.entryId);
  await client.enqueue({
    operationId: randomUUID(),
    action: 'entry-save',
    input: {
      entryId: f.entryId,
      entry: { ...full, content: '<p>edited through the same business API</p>', title: 'seed可写' },
    },
  });
  await client.sync();
  assert.equal((await f.http('/api/entries/' + f.entryId)).title, 'seed可写');
});

test('untrusted future checkpoint and incomplete roster remain quarantined and cannot change the live cursor', async (t) => {
  const f = await fixture(t),
    exported = await f.exportPackage({ source: 'owner' }),
    reader = await exported.reader();
  const client = f.client();
  f.offline(true);
  const first = await client.importSeed(reader.prepared);
  assert.equal(first.status, 'quarantined');
  assert.equal((await client.status()).initialized, false);
  assert.equal(await client.read('entry', f.entryId), undefined);
  assert.equal(await client.readSeedOriginal(f.assetId), null);
  f.offline(false);
  assert.equal((await client.resolveSeed(exported.manifest.packageId)).status, 'imported');
  const before = (await client.status()).cursor;
  const m = structuredClone(exported.manifest);
  m.packageId = randomUUID();
  m.watermark += 100;
  m.cursor.after = m.watermark;
  const memberData = await packageMembers(exported.file, exported.manifest);
  const forged = await prepareSharedSeed({
    manifest: m,
    readMember: (name, offset, length) => memberData.get(name).subarray(offset, offset + length),
    stageOriginal: blobStage(),
  });
  assert.equal((await client.importSeed(forged)).status, 'quarantined');
  assert.deepEqual((await client.status()).cursor, before);
  const omitted = structuredClone(exported.manifest);
  omitted.packageId = randomUUID();
  const removed = omitted.entities.find((x) => x.entityType === 'settings');
  omitted.entities = omitted.entities.filter((x) => x !== removed);
  omitted.members = omitted.members.filter((x) => x.path !== removed.path);
  omitted.entityCount--;
  const size = memberData.get(removed.path).length;
  omitted.entityBytes -= size;
  omitted.bytes -= size;
  const less = await prepareSharedSeed({
    manifest: omitted,
    readMember: (name, offset, length) => memberData.get(name).subarray(offset, offset + length),
    stageOriginal: blobStage(),
  });
  const empty = f.client();
  const rejected = await empty.importSeed(less);
  assert.equal(rejected.status, 'quarantined');
  assert.match(rejected.errorCode, /ROSTER_MISMATCH/);
  assert.equal((await empty.status()).initialized, false);
  await reader.dispose();
});

test('registered historical seed catches up PC writes and withdrawal before one visible import, without full snapshot', async (t) => {
  const f = await fixture(t),
    sourceId = randomUUID(),
    roomId = '-12345678901234567890',
    messageId = '12345678901234567890';
  await f.http(
    '/api/chat-journal/rooms',
    { sourceId, id: roomId, title: '原房', category: '日常', idleHours: 5 },
    'PUT',
  );
  const sentAt = '2026-10-19T01:00:00Z';
  await f.http('/api/chat-journal/messages', {
    sourceId,
    roomId,
    messages: [{ id: messageId, sentAt, text: 'exported-secret-message', attachments: [] }],
  });
  const exported = await f.exportPackage(),
    prepared = await exported.reader();
  const receipts = await f.http('/api/chat-journal/receipts', {
    sourceId,
    roomId,
    ids: [messageId],
  });
  const revision = receipts.receipts?.[0]?.revision ?? receipts.messages?.[0]?.revision ?? 1;
  await f.http('/api/chat-journal/withdraw', {
    sourceId,
    roomId,
    messageId,
    expectedRevision: revision,
  });
  const added = await f.http('/api/entries', { ...entry(randomUUID()), title: '导出后PC新增' });
  f.calls.length = 0;
  const client = f.client(),
    imported = await client.importSeed(prepared.prepared);
  assert.equal(imported.status, 'imported');
  assert.equal(imported.snapshotFallback, false);
  assert.equal(
    f.calls.some((call) => call.action === 'snapshot'),
    false,
  );
  assert.equal(
    f.calls.find((call) => call.action === 'pull').input.after,
    exported.manifest.watermark,
  );
  assert.equal((await client.read('entry', added.id)).local.data.title, '导出后PC新增');
  const adopted = await client.adoptSeedOriginals(exported.manifest.packageId);
  assert.equal(adopted.adopted, 1);
  assert.equal(
    JSON.stringify((await client.list('entry')).map((r) => r.local)).includes(
      'exported-secret-message',
    ),
    false,
  );
  assert.equal((await client.readSeedStatus(exported.manifest.packageId)).status, 'imported');
  await prepared.dispose();
});

test('resource corruption, truncated ZIP, old Product format, changed original and unpublished transaction failure are fail closed', async (t) => {
  const f = await fixture(t),
    exported = await f.exportPackage(),
    files = await packageMembers(exported.file, exported.manifest);
  const sink = blobStage();
  const asset = exported.manifest.assets[0];
  const corrupt = new Map(files);
  corrupt.set(asset.path, Buffer.alloc(asset.size, 7));
  await assert.rejects(
    prepareSharedSeed({
      manifest: exported.manifest,
      stageOriginal: sink,
      readMember: (name, offset, length) => corrupt.get(name).subarray(offset, offset + length),
    }),
    /MEMBER_HASH_MISMATCH/,
  );
  assert.equal(sink.live.size, 0);
  const prior = await readdir(f.work),
    zip = path.join(f.directory, 'traversal.zip');
  await writeFile(zip, Buffer.from('504b03042e2e2f657363617065', 'hex'));
  await assert.rejects(readSharedSeed({ file: zip, directory: f.work }), /ZIP_/);
  assert.deepEqual(await readdir(f.work), prior);
  assert.throws(
    () => validateSharedSeedManifest({ ...exported.manifest, format: 'shiye-product-seed' }),
    /INVALID_MANIFEST/,
  );
  const changed = path.join(f.directory, 'changed.syseed');
  await writeFile(path.join(f.dataDir, 'media', f.assetId), Buffer.alloc(f.original.length, 9));
  await assert.rejects(
    exportSharedSeed({
      file: changed,
      directory: f.work,
      request: f.request,
      openOriginal: () => createReadStream(path.join(f.dataDir, 'media', f.assetId)),
    }),
    /ORIGINAL_CHANGED/,
  );
  await assert.rejects(stat(changed), { code: 'ENOENT' });
  const prepared = await exported.reader(),
    raw = createMemorySyncStorage();
  let rejectPublish = false;
  const storage = {
    transaction: (callback) =>
      raw.transaction((tx) =>
        callback({
          ...tx,
          putEntity: async (row) => {
            if (rejectPublish && row.entityType === 'entry')
              throw Error('synthetic commit failure');
            return tx.putEntity(row);
          },
        }),
      ),
  };
  const client = f.client(storage);
  await client.setDraft('keep', { text: 'draft', replyId: null });
  // Restoring original lets authority resolve; only inbox commit then fails.
  await writeFile(path.join(f.dataDir, 'media', f.assetId), f.original);
  rejectPublish = true;
  const result = await client.importSeed(prepared.prepared);
  assert.equal(result.status, 'quarantined');
  assert.match(result.errorCode, /synthetic commit failure/);
  assert.equal(await client.read('entry', f.entryId), undefined);
  assert.equal(await client.readSeedOriginal(f.assetId), null);
  assert.equal((await client.status()).initialized, false);
  assert.equal((await client.readDraft('keep')).text, 'draft');
  rejectPublish = false;
  assert.equal((await client.resolveSeed(exported.manifest.packageId)).status, 'imported');
  await prepared.dispose();
});

test('export refreshes PC writes during original copying, registers durably without advancing business seq, and replays register', async (t) => {
  const f = await fixture(t);
  let copies = 0,
    added;
  const file = path.join(f.directory, 'during-copy.syseed');
  const result = await exportSharedSeed({
    file,
    directory: f.work,
    request: f.request,
    openOriginal: async function* () {
      copies++;
      yield f.original.subarray(0, 3);
      added = await f.http('/api/entries', { ...entry(randomUUID()), title: '复制原件期间PC写入' });
      yield f.original.subarray(3);
    },
  });
  assert.equal(copies, 1);
  assert.ok(result.manifest.entities.some((row) => row.entityId === added.id));
  const after = await f.request('info', {});
  assert.equal(after.seq, result.manifest.watermark);
  const source = JSON.parse(await readFile(path.join(f.dataDir, 'diary.json'), 'utf8'));
  assert.equal(source._sharedSeedExports.length, 1);
  assert.equal(source._sharedSeedExports[0].manifestSha256, result.manifestSha256);
  assert.equal(JSON.stringify(source._sharedSeedExports).includes('source-body'), false);
  await f.reopen();
  // A manifest may be reserialized in a different object-key order across native.
  const reordered = Object.fromEntries(Object.entries(result.manifest).reverse());
  const replayed = await f.request('seed-register', {
    libraryId: result.manifest.libraryId,
    epoch: result.manifest.epoch,
    manifest: reordered,
    manifestSha256: result.manifestSha256,
  });
  assert.equal(replayed.exportId, result.registration.exportId);
  assert.equal(replayed.replayed, true);
  assert.equal((await f.request('info', {})).seq, after.seq);
});

test('registered import holds every body unpublished during delta fetch and falls back safely on compacted cursor', async (t) => {
  const f = await fixture(t),
    exported = await f.exportPackage(),
    prepared = await exported.reader();
  const full = await f.http('/api/entries/' + f.entryId);
  await f.http('/api/entries/' + f.entryId, { ...full, title: 'new authority' }, 'PUT');
  let release,
    entered,
    first = true;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const waiting = new Promise((resolve) => {
    entered = resolve;
  });
  const client = createSharedBusinessClient({
    libraryId: f.info.libraryId,
    epoch: f.info.epoch,
    storage: createMemorySyncStorage(),
    request: async (action, input) => {
      if (action === 'pull' && first) {
        first = false;
        entered();
        await gate;
        throw Object.assign(Error('SHARED_RESNAPSHOT_REQUIRED'), {
          code: 'SHARED_RESNAPSHOT_REQUIRED',
          status: 409,
        });
      }
      return f.request(action, input);
    },
  });
  const importing = client.importSeed(prepared.prepared);
  await waiting;
  assert.equal(await client.read('entry', f.entryId), undefined);
  assert.equal((await client.status()).initialized, false);
  assert.equal(await client.readSeedOriginal(f.assetId), null);
  release();
  const imported = await importing;
  assert.equal(imported.status, 'imported');
  assert.equal(imported.snapshotFallback, true);
  assert.equal((await client.read('entry', f.entryId)).local.data.title, 'new authority');
  await prepared.dispose();
});

test('snapshot export drains from first watermark across new earlier keys and modified processed keys', async () => {
  const id = randomUUID(),
    epoch = randomUUID();
  const row = (entityId, revision, seq, title) => {
    const value = {
      entityType: 'entry',
      entityId,
      revision,
      seq,
      state: 'active',
      data: { title },
    };
    return { ...value, sha256: sharedSeedLogicalSha256(value) };
  };
  let calls = 0,
    pullAfter;
  const result = await collectSharedSeedSnapshot({
    request: async (action, input) => {
      const info = { enabled: true, version: 1, libraryId: id, epoch, seq: calls ? 4 : 2 };
      if (action === 'info') return info;
      if (action === 'snapshot')
        return calls++ === 0
          ? { info, entities: [row('b', 1, 1, 'old')], next: 'b', watermark: 2, hasMore: true }
          : { info, entities: [row('z', 1, 2, 'z')], next: 'z', watermark: 4, hasMore: false };
      pullAfter = input.after;
      return {
        info,
        changes: [row('a', 1, 3, 'earlier'), row('b', 2, 4, 'updated')],
        next: 4,
        watermark: 4,
        hasMore: false,
      };
    },
  });
  assert.equal(pullAfter, 2);
  assert.equal(result.watermark, 4);
  assert.equal(result.entities.find((r) => r.entityId === 'a').data.title, 'earlier');
  assert.equal(result.entities.find((r) => r.entityId === 'b').data.title, 'updated');
});

async function packageMembers(file, manifest) {
  const all = await readFile(file),
    length = all.readUInt32BE(Buffer.byteLength('SHIYE-SEED-V1\n'));
  let offset = Buffer.byteLength('SHIYE-SEED-V1\n') + 4 + length;
  return new Map(
    manifest.members.map((member) => {
      const value = all.subarray(offset, offset + member.size);
      offset += member.size;
      return [member.path, value];
    }),
  );
}
function blobStage() {
  const live = new Map();
  return {
    live,
    async begin() {
      const id = randomUUID();
      live.set(id, []);
      return id;
    },
    async write(id, _offset, bytes) {
      live.get(id).push(bytes.slice());
    },
    async finish(id) {
      return new Blob(live.get(id));
    },
    async abort(id) {
      live.delete(id);
    },
  };
}
