import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createSyncServer } from '../src/server/sync-v2/server.mjs';
import { productSyncExtension } from '../src/server/sync-product/service.mjs';
import { seedProductLibrary } from '../src/server/sync-product/import.mjs';
import { readSeedPackage } from '../src/server/sync-product/seed-package.mjs';
import {
  validateSeedManifest,
  productConversationPresentation,
  productSeedEntryPresentation,
} from '../public/shared/product-seed.js';
import { canonicalSeedRecord } from '../src/server/sync-product/portable.mjs';
import { planLegacyProductImport } from '../src/server/sync-product/legacy-adapter.mjs';
import { validateProductRecord } from '../public/shared/sync-product.js';
import { createProductSeedClient } from '../public/shared/product-seed-client.js';
import { createSyncClient } from '../public/shared/sync-v2-client.js';
import { createMemorySyncStorage } from './helpers/sync-v2-client-memory.mjs';
import { createProductServiceClient } from '../public/shared/sync-product-client.js';
import { productMessageId, productRecord } from '../public/shared/sync-product.js';
import { productLibraryView } from '../public/shared/sync-product.js';
import { revisitSources, resolveRevisitSource } from '../src/server/domain/revisit-sources.mjs';

const root = path.resolve('tmp/product-seed/tests');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function fixture(t, { seed = true, bytes = Buffer.from('GIF89a-seed-original') } = {}) {
  const area = path.join(root, randomUUID());
  await fs.mkdir(path.join(area, 'source', 'media'), { recursive: true });
  const dataDir = path.join(area, 'server');
  let service = await createSyncServer({
    dataDir,
    extensionFactory: productSyncExtension({ autoTickMs: 0 }),
  });
  const original = {
    schema: 1,
    categories: ['日常'],
    tags: ['测试'],
    entries: [
      {
        id: 'entry-1',
        title: '合成',
        content: '<p>[2025/10/18 12:00:00] 内容</p><p>原换行</p>',
        date: '2025-10-18T04:00:00Z',
        createdAt: '2025-10-18T04:00:00Z',
        updatedAt: '2025-10-18T05:00:00Z',
        revision: 1,
        category: '日常',
        tags: ['测试'],
        attachments: ['asset-1'],
        history: [],
        future: { keep: true },
      },
    ],
    media: [{ id: 'asset-1', type: 'image/gif', name: '合成.gif', size: bytes.length }],
    stickers: [
      {
        id: 'sticker-1',
        name: '开心',
        note: '备注',
        group: '常用',
        tags: ['愉快', '日常'],
        mediaId: 'asset-1',
        future: { keep: true },
      },
    ],
    settings: { preferences: { theme: 'dark', appearance: { backgrounds: [{ id: 'asset-1' }] } } },
    chatJournal: { version: 1, rooms: [] },
  };
  const source = path.join(area, 'source', 'diary.json');
  await fs.writeFile(source, JSON.stringify(original));
  await fs.writeFile(path.join(area, 'source', 'media', 'asset-1'), bytes);
  if (seed)
    await seedProductLibrary(service, {
      libraryFile: source,
      mediaDir: path.join(area, 'source', 'media'),
    });
  const serve = async () => {
    service.server.listen(0, '127.0.0.1');
    await once(service.server, 'listening');
    return `http://127.0.0.1:${service.server.address().port}/`;
  };
  let base = await serve();
  const device = service.auth.pair({
    code: service.auth.pairingCode().code,
    deviceName: '合成设备',
  });
  t.after(() => service.close());
  const api = () => createProductSeedClient({ baseUrl: base, token: device.token });
  return {
    area,
    dataDir,
    source,
    original,
    bytes,
    device,
    get service() {
      return service;
    },
    get base() {
      return base;
    },
    api,
    async restart() {
      await service.close();
      service = await createSyncServer({
        dataDir,
        extensionFactory: productSyncExtension({ autoTickMs: 0 }),
      });
      base = await serve();
    },
  };
}
async function waitExport(api, job) {
  for (let i = 0; i < 500; i++) {
    job = await api.exportStatus(job.id);
    if (job.status === 'failed') throw Error(job.error);
    if (job.status === 'ready') return job;
    await delay(10);
  }
  throw Error('Export timeout');
}
async function waitImport(api, job) {
  for (let i = 0; i < 500; i++) {
    job = await api.importStatus(job.id);
    if (job.status === 'failed' || job.status === 'committed') return job;
    await delay(10);
  }
  throw Error('Import timeout');
}
async function exported(f) {
  const api = f.api();
  let job = await waitExport(api, await api.createExport(randomUUID()));
  const bytes = Buffer.from(await (await api.download(job.id)).arrayBuffer());
  assert.equal(sha(bytes), job.sha256);
  const file = path.join(f.area, randomUUID() + '.syseed');
  await fs.writeFile(file, bytes);
  const parsed = await readSeedPackage({
    file,
    directory: path.join(f.area, 'parsed-' + randomUUID()),
    expectedSha256: job.sha256,
  });
  return { job, bytes, file, parsed };
}
async function uploaded(f, bytes, hash = sha(bytes)) {
  const api = f.api(),
    job = await api.createImport({ mode: 'initialize-empty', size: bytes.length, sha256: hash });
  for (let index = 0; index < Math.ceil(bytes.length / job.chunkSize); index++)
    await api.uploadChunk(
      job.id,
      index,
      bytes.subarray(index * job.chunkSize, (index + 1) * job.chunkSize),
    );
  return job;
}

test('canonical package export preserves source, media bytes, stable metadata and exact checkpoint', async (t) => {
  const f = await fixture(t);
  const source = await fs.readFile(f.source);
  const result = await exported(f);
  assert.deepEqual(await fs.readFile(f.source), source);
  const entry = result.parsed.records.find((r) => r.entityId === 'entry-1');
  assert.equal(entry.data.contentFormat, 'richdoc');
  assert(entry.data._canonical.units.length >= 2);
  assert.equal(entry.data._canonical.units[0].eventTime.instant, '2025-10-18T05:00:00.000Z');
  assert.equal(entry.data.future.keep, true);
  const sticker = result.parsed.records.find((r) => r.entityId === 'sticker-1');
  assert.deepEqual(sticker.data.tags, ['愉快', '日常']);
  assert.equal(sticker.data.name, '开心');
  const asset = result.parsed.records.find((r) => r.entityType === 'asset');
  assert.deepEqual(
    await fs.readFile(path.join(result.parsed.directory, 'media', asset.data.sha256)),
    f.bytes,
  );
  const proof = await f.api().resolve({
    packageId: result.job.id,
    sha256: result.job.sha256,
    libraryId: result.parsed.manifest.libraryId,
    epoch: result.parsed.manifest.epoch,
    checkpoint: result.parsed.manifest.checkpoint,
  });
  assert.equal(proof.verified, true);
  assert.equal(proof.watermark, result.parsed.manifest.watermark);
  const range = await f.api().download(result.job.id, { range: 'bytes=10-29' });
  assert.equal(range.status, 206);
  assert.deepEqual(Buffer.from(await range.arrayBuffer()), result.bytes.subarray(10, 30));
  const again = await f.api().createExport(result.job.operationId);
  assert.equal(again.id, result.job.id);
  await f.restart();
  assert.equal((await f.api().exportStatus(result.job.id)).sha256, result.job.sha256);
  assert.equal(
    (
      await f.api().resolve({
        packageId: result.job.id,
        sha256: result.job.sha256,
        libraryId: proof.libraryId,
        epoch: proof.epoch,
        checkpoint: proof.checkpoint,
      })
    ).verified,
    true,
  );
});

test('bootstrap installs atomically, retains offline intent and local wallpaper, then pulls before pushing without a snapshot', async (t) => {
  const f = await fixture(t);
  const { parsed } = await exported(f);
  const storage = createMemorySyncStorage();
  await storage.transaction((tx) =>
    tx.setMeta({ localWallpaper: 'android-local-only', unknown: { keep: true } }),
  );
  const requests = [];
  const client = createSyncClient({
    baseUrl: f.base,
    deviceId: f.device.deviceId,
    token: f.device.token,
    storage,
    fetchImpl: (url, options) => {
      requests.push(new URL(url).pathname);
      return fetch(url, options);
    },
  });
  await client.enqueue({
    entityType: 'sticker',
    entityId: 'sticker-1',
    command: 'updateFields',
    changes: { name: '安卓修改', tags: ['共用标签'] },
  });
  const old = f.service.store.getEntity('sticker', 'sticker-1');
  const changed = await f.service.extension.push(f.device, [
    {
      operationId: randomUUID(),
      entityType: 'sticker',
      entityId: 'sticker-1',
      command: 'updateFields',
      baseRevision: old.revision,
      changes: { note: '包生成后的修改' },
    },
  ]);
  assert.equal(changed.results[0].status, 'accepted');
  assert.equal((await client.importSeed(parsed)).imported, true);
  assert.equal((await storage.transaction((tx) => tx.listPending())).length, 1);
  assert.equal((await client.read('sticker', 'sticker-1')).data.name, '安卓修改');
  assert.equal(storage.persisted.meta.localWallpaper, 'android-local-only');
  assert.equal(storage.persisted.meta.seedCatchUpRequired, true);
  requests.length = 0;
  const synced = await client.sync();
  assert.equal(synced.error, null);
  assert(!requests.some((r) => r.endsWith('/snapshot')));
  assert(
    requests.findIndex((r) => r.endsWith('/pull')) < requests.findIndex((r) => r.endsWith('/push')),
  );
  const current = await client.read('sticker', 'sticker-1');
  assert.equal(current.data.name, '安卓修改');
  assert.equal(current.data.note, '包生成后的修改');
  assert.deepEqual(current.data.tags, ['共用标签']);
  assert.equal(storage.persisted.meta.seedCatchUpRequired, undefined);
  const before = structuredClone(storage.persisted);
  assert.equal((await client.importSeed(parsed)).replayed, true);
  assert.deepEqual(storage.persisted, before);
  const reopen = createSyncClient({
    baseUrl: f.base,
    deviceId: f.device.deviceId,
    token: f.device.token,
    storage: createMemorySyncStorage(storage.persisted),
  });
  assert.equal((await reopen.sync()).error, null);
  assert.equal((await reopen.read('sticker', 'sticker-1')).data.name, '安卓修改');
});

test('seed bootstrap rejects a foreign library and rolls back all rows on a repository fault', async (t) => {
  const a = await fixture(t),
    b = await fixture(t, { seed: false });
  const { parsed } = await exported(a);
  const storage = createMemorySyncStorage();
  const foreign = createSyncClient({
    baseUrl: b.base,
    deviceId: b.device.deviceId,
    token: b.device.token,
    storage,
  });
  await assert.rejects(foreign.importSeed(parsed));
  assert.equal(storage.persisted.entities.size, 0);
  assert.equal(storage.persisted.meta.initialized, undefined);
  const inner = createMemorySyncStorage();
  let puts = 0;
  const faulty = {
    transaction: (fn) =>
      inner.transaction((tx) =>
        fn({
          ...tx,
          putEntity: async (row) => {
            if (++puts === 3) throw Error('synthetic disk failure');
            return tx.putEntity(row);
          },
        }),
      ),
  };
  const client = createSyncClient({
    baseUrl: a.base,
    deviceId: a.device.deviceId,
    token: a.device.token,
    storage: faulty,
  });
  await assert.rejects(client.importSeed(parsed), /synthetic disk/);
  assert.equal(inner.persisted.entities.size, 0);
  assert.equal(inner.persisted.meta.initialized, undefined);
});

test('server initialize-empty import is resumable, atomic and idempotent with a new server identity', async (t) => {
  const source = await fixture(t, { bytes: Buffer.alloc(4 * 1024 ** 2 + 23, 77) }),
    target = await fixture(t, { seed: false });
  const { bytes, parsed } = await exported(source);
  let api = target.api();
  let job = await api.createImport({
    mode: 'initialize-empty',
    size: bytes.length,
    sha256: sha(bytes),
  });
  await api.uploadChunk(job.id, 0, bytes.subarray(0, job.chunkSize));
  await target.restart();
  api = target.api();
  job = await api.importStatus(job.id);
  assert.deepEqual(job.received, [0]);
  await api.uploadChunk(job.id, 0, bytes.subarray(0, job.chunkSize));
  await assert.rejects(
    api.uploadChunk(job.id, 0, Buffer.alloc(job.chunkSize, 9)),
    /SEED_CHUNK_CONFLICT/,
  );
  await assert.rejects(api.commit(job.id), /SEED_CHUNKS_MISSING/);
  for (let index = 1; index < Math.ceil(bytes.length / job.chunkSize); index++)
    await api.uploadChunk(
      job.id,
      index,
      bytes.subarray(index * job.chunkSize, (index + 1) * job.chunkSize),
    );
  job = await waitImport(api, await api.commit(job.id));
  assert.equal(job.status, 'committed', job.error);
  assert.notEqual(job.receipt.targetLibraryId, parsed.manifest.libraryId);
  assert.equal(job.receipt.sourceCursorReusable, false);
  assert.deepEqual(target.service.store.getEntity('sticker', 'sticker-1').data.tags, [
    '愉快',
    '日常',
  ]);
  assert.deepEqual(await target.service.media.readContent('asset-1'), source.bytes);
  const seq = target.service.store.info().seq;
  await target.restart();
  const repeated = await target.api().commit(job.id);
  assert.equal(repeated.status, 'committed');
  assert.equal(target.service.store.info().seq, seq);
  const found = await target
    .api()
    .createImport({ mode: 'initialize-empty', size: bytes.length, sha256: sha(bytes) });
  assert.equal(found.id, job.id);
});

test('corrupt package never commits metadata and an existing target is never overwritten', async (t) => {
  const source = await fixture(t),
    target = await fixture(t, { seed: false });
  const { bytes } = await exported(source);
  const broken = Buffer.from(bytes);
  broken[broken.length - 1] ^= 1;
  const job = await uploaded(target, broken, sha(bytes));
  const failed = await waitImport(target.api(), await target.api().commit(job.id));
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error, 'SEED_PACKAGE_HASH_MISMATCH');
  assert.equal(target.service.store.info().seq, 0);
  const populated = await uploaded(source, bytes);
  const before = source.service.store.info().seq;
  const rejected = await waitImport(source.api(), await source.api().commit(populated.id));
  assert.equal(rejected.error, 'SEED_TARGET_NOT_EMPTY');
  assert.equal(source.service.store.info().seq, before);
});

test('manifest rejects traversal and duplicates; sticker metadata stays shared while wallpaper is local', async (t) => {
  const f = await fixture(t),
    { parsed, file } = await exported(f);
  const malformed = structuredClone(parsed.manifest);
  malformed.members[1].path = '../outside';
  assert.throws(() => validateSeedManifest(malformed));
  const duplicate = structuredClone(parsed.manifest);
  duplicate.members.push(duplicate.members[1]);
  assert.throws(() => validateSeedManifest(duplicate));
  const bytes = await fs.readFile(file);
  bytes[bytes.length - 1] ^= 1;
  const broken = path.join(f.area, 'broken.syseed');
  await fs.writeFile(broken, bytes);
  await assert.rejects(
    readSeedPackage({ file: broken, directory: path.join(f.area, 'bad-member') }),
    /SEED_MEMBER_HASH_MISMATCH/,
  );
  assert.deepEqual(
    productConversationPresentation(
      { configuration: { wallpaperAssetId: 'pc-picture', bubbleOpacity: 0.2 } },
      { wallpaperAssetId: 'android-picture', wallpaperOpacity: 0.7 },
    ),
    { avatarAssetId: 'pc-picture', wallpaperAssetId: 'android-picture', wallpaperOpacity: 0.7 },
  );
  const sticker = parsed.records.find((r) => r.entityId === 'sticker-1');
  assert.throws(
    () =>
      validateProductRecord(sticker.entityType, sticker.entityId, {
        ...sticker.data,
        tags: ['重复', '重复'],
      }),
    /INVALID_STICKER_TAGS/,
  );
  const noToken = await fetch(f.base + 'api/product/v1/seed/exports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operationId: randomUUID() }),
  });
  assert.equal(noToken.status, 401);
});

test('post-package withdrawal wins over a queued offline edit before the first push', async (t) => {
  const f = await fixture(t);
  const business = createProductServiceClient({ baseUrl: f.base, token: f.device.token });
  const sourceId = 'c5c40f9f-8ebc-4464-b8f6-204b68240df5';
  await business.saveRoom({ sourceId, id: '7', title: '合成撤回', category: '日常', idleHours: 5 });
  await business.sendMessages({
    sourceId,
    roomId: '7',
    messages: [{ id: '99', sentAt: '2025-10-18T04:00:01Z', text: '合成消息', attachments: [] }],
  });
  const { parsed, job } = await exported(f);
  await business.withdrawMessage({
    sourceId,
    roomId: '7',
    messageId: '99',
    operationId: randomUUID(),
  });
  const messageId = productMessageId(sourceId, '7', '99');
  const storage = createMemorySyncStorage(),
    requests = [];
  const client = createSyncClient({
    baseUrl: f.base,
    deviceId: f.device.deviceId,
    token: f.device.token,
    storage,
    fetchImpl: (url, opts) => {
      requests.push(new URL(url).pathname);
      return fetch(url, opts);
    },
  });
  await client.enqueue({
    entityType: 'chatMessage',
    entityId: messageId,
    command: 'updateFields',
    changes: { text: '不能复活' },
  });
  await client.importSeed(parsed);
  requests.length = 0;
  assert.equal((await client.sync()).error, null);
  assert(!requests.some((r) => r.endsWith('/push')));
  assert.equal((await client.read('chatMessage', messageId)).state, 'withdrawn');
  assert.equal((await storage.transaction((tx) => tx.listPending())).length, 0);
  await assert.rejects(f.api().download(job.id), /SEED_EXPORT_NOT_READY/);
  await assert.rejects(
    fs.access(path.join(f.dataDir, 'product-seeds', 'export-' + job.id, 'package.syseed')),
  );
});

test('trashed diaries retain canonical bodies; legacy details retain an invalidatable exact read-only display', () => {
  const base = {
    id: 'old-entry',
    date: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T01:00:00Z',
    revision: 1,
    attachments: [],
    tags: [],
    category: '日常',
  };
  const convert = (entry) => {
    const plan = planLegacyProductImport(
      { entries: [entry], media: [], categories: ['日常'] },
      { sourceId: 'seed-test' },
    );
    const record = plan.records.find((r) => r.data?._product.kind === 'entry');
    return canonicalSeedRecord({ ...record, state: 'active', revision: 1 });
  };
  const trash = convert({ ...base, deleted: true, content: '<p></p>' });
  assert.equal(trash.data.deleted, true);
  assert(trash.data._canonical.units.length);
  assert(trash.data._canonical.units.every((u) => u.state === 'deleted' && u.body !== null));
  const seconds = convert({
    ...base,
    content: '<p>旧秒时间</p>',
    legacy: { original: { updateTime: 1735693200 } },
  });
  assert.equal(seconds.data.contentEditedAt, '2025-01-01T01:00:00.000Z');
  assert.equal(
    seconds.data._canonical.units[0].eventTime.sourceField,
    'legacy.original.updateTime',
  );
  const original = '<details><summary>标题</summary><p>保留折叠内容</p></details>';
  const details = convert({ ...base, content: original });
  assert.equal(details.data.editorOriginalHtml, original);
  const presentation = productSeedEntryPresentation(details);
  assert.equal(presentation.mode, 'compatibility');
  assert.equal(presentation.requiresSanitization, true);
  details.data.body.content.push({
    type: 'paragraph',
    attrs: { blockId: 'new-block' },
    content: [{ type: 'text', text: '后来编辑' }],
  });
  assert.equal(productSeedEntryPresentation(details).mode, 'richdoc');
});

test('interrupted multi-page post-seed catch-up retains its fence and resumes before any push', async (t) => {
  const f = await fixture(t),
    { parsed } = await exported(f);
  const operations = [1, 2, 3].map((n) => ({
    operationId: randomUUID(),
    entityType: 'taxonomy',
    entityId: 'extra-tag-' + n,
    command: 'create',
    baseRevision: 0,
    data: productRecord('taxonomy', 'extra-tag-' + n, {
      id: 'extra-tag-' + n,
      kind: 'tag',
      name: '补充' + n,
    }).data,
  }));
  await f.service.extension.push(f.device, operations);
  const storage = createMemorySyncStorage();
  let pulls = 0;
  const client = createSyncClient({
    baseUrl: f.base,
    deviceId: f.device.deviceId,
    token: f.device.token,
    storage,
    pageLimit: 1,
    fetchImpl: (url, options) => {
      if (new URL(url).pathname.endsWith('/pull') && ++pulls === 2)
        throw Error('synthetic interrupted catch-up');
      return fetch(url, options);
    },
  });
  await client.enqueue({
    entityType: 'sticker',
    entityId: 'sticker-1',
    command: 'updateFields',
    changes: { name: '离线编辑' },
  });
  await client.importSeed(parsed);
  assert.equal((await client.sync()).phase, 'retrying');
  assert.equal(storage.persisted.meta.seedCatchUpRequired, true);
  assert.equal(storage.persisted.pending.size, 1);
  const routes = [],
    reopened = createSyncClient({
      baseUrl: f.base,
      deviceId: f.device.deviceId,
      token: f.device.token,
      storage: createMemorySyncStorage(storage.persisted),
      pageLimit: 1,
      fetchImpl: (url, options) => {
        routes.push(new URL(url).pathname);
        return fetch(url, options);
      },
    });
  assert.equal((await reopened.sync()).error, null);
  assert(
    routes.findIndex((r) => r.endsWith('/pull')) < routes.findIndex((r) => r.endsWith('/push')),
  );
  assert.equal(storage.persisted.meta.seedCatchUpRequired, undefined);
  assert.equal((await reopened.read('sticker', 'sticker-1')).data.name, '离线编辑');
});

test('canonical seed upgrade preserves legacy revisit SourceRefs and invalidates them on a real body edit', async (t) => {
  const f = await fixture(t);
  const refs = revisitSources(f.original).sources.map((source) => source.ref);
  assert(refs.length > 0);
  const { parsed } = await exported(f);
  const view = productLibraryView(parsed.records);
  const current = revisitSources(view);
  assert.deepEqual(
    current.sources.map((source) => source.ref),
    refs,
  );
  for (const ref of refs) assert(resolveRevisitSource(view, ref));
  view.entries[0].category = '改分类';
  view.entries[0].tags = ['改标签'];
  for (const ref of refs) assert(resolveRevisitSource(view, ref));
  view.entries[0].body.content[0].attrs.caption = '真实修改';
  for (const ref of refs) assert.equal(resolveRevisitSource(view, ref), null);
});
