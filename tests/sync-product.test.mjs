import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { createSyncServer } from '../src/server/sync-v2/server.mjs';
import { openSyncStore } from '../src/server/sync-v2/store.mjs';
import { productSyncExtension } from '../src/server/sync-product/service.mjs';
import {
  planLegacyProductImport,
  renameLegacyTaxonomyIdentity,
} from '../src/server/sync-product/legacy-adapter.mjs';
import { seedProductLibrary } from '../src/server/sync-product/import.mjs';
import {
  productRecord,
  productMessageId,
  productLibraryView,
  productValue,
  prepareProductPayload,
  hydrateProductPayload,
} from '../public/shared/sync-product.js';
import { chatUnitId } from '../src/server/domain/message-store.mjs';
import { createSyncClient } from '../public/shared/sync-v2-client.js';
import { createMemorySyncStorage } from './helpers/sync-v2-client-memory.mjs';
import { commentLibrary, commentNow } from './helpers/revisit-comment-fixtures.mjs';
import { prepareProductEntry } from '../public/shared/sync-product.js';
import {
  createProductCommandQueue,
  createProductServiceClient,
} from '../public/shared/sync-product-client.js';

const root = path.resolve(import.meta.dirname, '../tmp/product-sync/tests');
const now = Date.parse('2026-10-18T08:00:00Z');
const sourceId = 'c5c40f9f-8ebc-4464-b8f6-204b68240df5';
function library() {
  return {
    schema: 1,
    categories: ['日常', '思绪'],
    tags: ['记录'],
    entries: [
      {
        id: 'entry-one',
        title: '合成测试',
        category: '日常',
        tags: ['记录'],
        date: '2025-10-18T08:00:01Z',
        updatedAt: '2025-10-18T08:00:02Z',
        revision: 1,
        createdAt: '2025-10-18T08:00:01Z',
        content: '<p>[2025/10/18 16:00:01] 一段</p><p>下一行</p>',
        attachments: ['image-one'],
        history: [],
        unknownFuture: { keep: true },
      },
    ],
    media: [
      {
        id: 'image-one',
        name: '合成.gif',
        type: 'image/gif',
        size: 6,
        importedAt: '2025-10-18T08:00:02Z',
      },
    ],
    stickers: [
      { id: 'sticker-one', mediaId: 'image-one', name: '开心', note: '测试', future: { a: 1 } },
    ],
    settings: { preferences: { theme: 'dark', windowPosition: { x: 2 }, authToken: 'never-copy' } },
    chatJournal: { version: 1, rooms: [] },
  };
}
async function fixture(t, extra = {}) {
  const dataDir = path.join(root, randomUUID());
  const service = await createSyncServer({
    dataDir,
    clock: () => now,
    extensionFactory: productSyncExtension({ autoTickMs: 0 }),
    ...extra,
  });
  t.after(() => service.close());
  service.server.listen(0, '127.0.0.1');
  await once(service.server, 'listening');
  const base = `http://127.0.0.1:${service.server.address().port}/`;
  const device = service.auth.pair({
    code: service.auth.pairingCode({ uses: 1 }).code,
    deviceName: '合成设备',
  });
  const request = async (route, body, method = body === undefined ? 'GET' : 'POST') => {
    const response = await fetch(base + route, {
      method,
      headers: { Authorization: `Bearer ${device.token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, value: await response.json() };
  };
  return { service, dataDir, base, device, request };
}
test('product IDs match existing canonical chat IDs without truncating long decimal IDs', () => {
  assert.equal(
    productMessageId(sourceId, '-123', '6604109365671539'),
    chatUnitId(sourceId, '-123', '6604109365671539'),
  );
});
test('legacy adaptation preserves originals, unknown fields, markup and independent media clocks', () => {
  const db = library(),
    before = structuredClone(db);
  const plan = planLegacyProductImport(db, { sourceId });
  assert.deepEqual(db, before);
  assert.deepEqual(plan.issues, []);
  const view = productLibraryView(plan.records);
  assert.deepEqual(view.entries[0], before.entries[0]);
  assert.deepEqual(view.media, before.media);
  assert.deepEqual(view.stickers, before.stickers);
  assert.equal(view.appearances[0].preferences.theme, 'dark');
  assert.equal(view.appearances[0].preferences.authToken, undefined);
  const old = plan.records.find(
    (r) => r.data._product.kind === 'taxonomy' && r.data.name === '日常',
  );
  old.data.name = '生活';
  assert.equal(productLibraryView(plan.records).entries[0].category, '生活');
  assert.equal(productLibraryView(plan.records).entries[0].date, before.entries[0].date);
  const identity = renameLegacyTaxonomyIdentity(plan.taxonomyIdentity, 'category', '日常', '生活');
  assert.equal(identity[JSON.stringify(['category', '生活'])], old.entityId);
});
test('bad legacy entry rolls back its partial message children', () => {
  const db = library();
  db.entries[0].chatJournal = {
    sourceId,
    roomId: '1',
    messages: [
      { id: '10', sentAt: '2025-10-18T08:00:01Z', text: '不会留下孤儿', attachments: [] },
      { id: '11', sentAt: 'bad-time' },
    ],
  };
  const plan = planLegacyProductImport(db, { sourceId });
  assert.equal(plan.issues.length, 1);
  assert.equal(
    plan.records.filter((r) => ['entry', 'message'].includes(r.data._product.kind)).length,
    0,
  );
});
test('large rich document is lossless and tampering is rejected', () => {
  const record = productRecord('entry', 'large', { id: 'large', content: '中文'.repeat(180000) });
  const prepared = prepareProductPayload(record);
  assert.ok(prepared.payload);
  assert.match(prepared.payload.assetId, /^payload-/);
  assert.deepEqual(hydrateProductPayload(prepared.record, prepared.payload.bytes), record);
  const broken = prepared.payload.bytes.slice();
  broken[12] ^= 1;
  assert.throws(() => hydrateProductPayload(prepared.record, broken), /HASH_MISMATCH/);
});
test('atomic push rolls back entities, receipts, cursors and private product state together', async (t) => {
  const dir = path.join(root, randomUUID());
  await mkdir(dir, { recursive: true });
  const store = await openSyncStore({ dataDir: dir });
  t.after(() => store.close());
  const seq = store.info().seq;
  assert.throws(
    () =>
      store.push(
        'test',
        [
          {
            operationId: 'atomic-1',
            entityType: 'taxonomy',
            entityId: 'one',
            command: 'create',
            baseRevision: 0,
            data: {},
          },
          {
            operationId: 'atomic-2',
            entityType: 'taxonomy',
            entityId: 'missing',
            command: 'delete',
            baseRevision: 1,
          },
        ],
        { atomic: true, productState: { key: 'test', value: { cursor: 1 } } },
      ),
    /committed/,
  );
  assert.equal(store.info().seq, seq);
  assert.equal(store.getEntity('taxonomy', 'one'), null);
  assert.equal(store.readProductState('test'), null);
  store.push(
    'test',
    [
      {
        operationId: 'atomic-1',
        entityType: 'taxonomy',
        entityId: 'one',
        command: 'create',
        baseRevision: 0,
        data: {},
      },
    ],
    { atomic: true, productState: { key: 'test', value: { cursor: 2 } } },
  );
  assert.equal(store.readProductState('test').cursor, 2);
});
test('two offline repositories exchange only changes, mutable taxonomy and full configuration', async (t) => {
  const f = await fixture(t);
  await f.service.extension.importPlan(planLegacyProductImport(library(), { sourceId }));
  const a = createSyncClient({ baseUrl: f.base, ...f.device, storage: createMemorySyncStorage() });
  const b = createSyncClient({ baseUrl: f.base, ...f.device, storage: createMemorySyncStorage() });
  t.after(() => {
    a.stop();
    b.stop();
  });
  await a.sync();
  await b.sync();
  const entry = await a.read('journalAggregate', 'entry-one');
  await a.edit({
    entityType: entry.entityType,
    entityId: entry.entityId,
    command: 'updateFields',
    changes: { title: '离线修改' },
  });
  assert.equal((await a.read(entry.entityType, entry.entityId)).data.title, '离线修改');
  assert.equal((await b.read(entry.entityType, entry.entityId)).data.title, '合成测试');
  await a.sync();
  await b.sync();
  assert.equal((await b.read(entry.entityType, entry.entityId)).data.title, '离线修改');
  const category = (await b.list('taxonomy')).find((r) => r.data.name === '日常');
  await b.edit({
    entityType: 'taxonomy',
    entityId: category.entityId,
    command: 'updateFields',
    changes: { name: '生活' },
  });
  await b.sync();
  await a.sync();
  const result = await f.request('api/product/v1/library');
  assert.equal(result.value.entries[0].category, '生活');
  assert.equal(result.value.entries[0].unknownFuture.keep, true);
  assert.equal(result.value.entries[0].date, entry.data.date);
});
test('chat commands group, quote, retry and withdraw without projection copies or resurrection', async (t) => {
  const f = await fixture(t);
  await f.service.extension.importPlan(planLegacyProductImport(library(), { sourceId }));
  assert.equal(
    (
      await f.request('api/product/v1/chat/room', {
        sourceId,
        id: '1',
        title: '随想',
        category: '日常',
        idleHours: 5,
      })
    ).status,
    200,
  );
  const message = {
    id: '6604109365671539',
    sentAt: '2026-10-18T07:00:00Z',
    text: '**独有撤回原文**',
    attachments: ['image-one'],
  };
  const input = { sourceId, roomId: '1', messages: [message] };
  const first = await f.request('api/product/v1/chat/send', input);
  assert.equal(first.status, 200, JSON.stringify(first.value));
  assert.deepEqual((await f.request('api/product/v1/chat/send', input)).value, first.value);
  const second = await f.request('api/product/v1/chat/send', {
    ...input,
    messages: [
      {
        id: '6604109365671540',
        sentAt: '2026-10-18T07:10:00Z',
        text: '引用',
        attachments: [],
        replyTo: message.id,
      },
    ],
  });
  assert.equal(second.value.accepted[0].entryId, first.value.accepted[0].entryId);
  let view = (await f.request('api/product/v1/library')).value;
  assert.match(view.entries.find((e) => e.chatJournal).content, /<strong>独有撤回原文<\/strong>/);
  assert.match(view.entries.find((e) => e.chatJournal).content, /<img/);
  const withdrawn = await f.request('api/product/v1/chat/withdraw', {
    sourceId,
    roomId: '1',
    messageId: message.id,
  });
  assert.equal(withdrawn.status, 200, JSON.stringify(withdrawn.value));
  assert.equal((await f.request('api/product/v1/chat/send', input)).status, 200);
  view = (await f.request('api/product/v1/library')).value;
  assert.equal(view.messages.length, 1);
  assert.doesNotMatch(JSON.stringify(view), /独有撤回原文/);
  // All historical transport copies and receipts must have been scrubbed, not just the latest UI.
  const db = new DatabaseSync(path.join(f.dataDir, 'sync.sqlite'));
  try {
    for (const table of ['entities', 'versions', 'changes', 'receipts', 'conflicts'])
      assert.doesNotMatch(
        JSON.stringify(db.prepare(`SELECT * FROM ${table}`).all()),
        /独有撤回原文/,
      );
  } finally {
    db.close();
  }
});
test('large product payload and original GIF seed round-trip without source writes', async (t) => {
  const f = await fixture(t),
    source = path.join(root, randomUUID());
  await mkdir(path.join(source, 'media'), { recursive: true });
  const db = library();
  db.entries[0].content = '中文'.repeat(180000);
  const file = path.join(source, 'diary.json');
  await writeFile(file, JSON.stringify(db));
  const gif = Buffer.from('GIF89a');
  await writeFile(path.join(source, 'media/image-one'), gif);
  const before = createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
  const report = await seedProductLibrary(f.service, {
    libraryFile: file,
    mediaDir: path.join(source, 'media'),
  });
  assert.deepEqual(report.failures, []);
  assert.equal(report.originals, 1);
  assert.equal(
    (await f.request('api/product/v1/library')).value.entries[0].content,
    db.entries[0].content,
  );
  assert.deepEqual(await f.service.media.readContent('image-one'), gif);
  assert.equal(
    createHash('sha256')
      .update(await readFile(file))
      .digest('hex'),
    before,
  );
  await seedProductLibrary(f.service, { libraryFile: file, mediaDir: path.join(source, 'media') });
  assert.equal((await f.request('api/product/v1/library')).value.entries.length, 1);
});
test('product service authentication and server-owned config policy', async (t) => {
  const f = await fixture(t);
  assert.equal((await fetch(f.base + 'api/product/v1/catalog')).status, 401);
  assert.equal((await f.request('api/product/v1/catalog')).status, 200);
  const status = await f.request('api/product/v1/revisit');
  assert.equal(status.status, 200);
  const config = productRecord('serviceConfig', 'forbidden', { config: {} });
  const response = await f.request('api/sync/v1/push', {
    operations: [{ ...config, command: 'create', operationId: 'forbidden-op' }],
  });
  assert.equal(response.status, 403);
});
test('canonical rich diary identities survive adaptation and later body edits', () => {
  const f = commentLibrary();
  const plan = planLegacyProductImport(f.db, { sourceId });
  assert.deepEqual(plan.issues, []);
  const view = productLibraryView(plan.records);
  assert.deepEqual(
    view.messageStore.units,
    f.db.messageStore.units.filter((u) => u.origin.kind === 'diary'),
  );
  assert.deepEqual(view.messageStore.layouts, f.db.messageStore.layouts);
  const record = plan.records.find(
    (r) => r.entityId === 'canonical' && r.entityType === 'journalAggregate',
  );
  const entry = productValue(record);
  const next = prepareProductEntry(entry, {
    previousRecord: record,
    refs: record.data._product.refs,
    media: f.db.media,
  });
  assert.deepEqual(next.data.messageUnits.ids, entry.messageUnits.ids);
  assert.deepEqual(
    next.data._canonical.units.map((u) => u.eventTime),
    record.data._canonical.units.map((u) => u.eventTime),
  );
});
test('revisit backend exposes stable group/single comments, sources and no repeated deliveries', async (t) => {
  const f = await fixture(t, { clock: () => commentNow }),
    old = commentLibrary();
  await f.service.extension.importPlan(planLegacyProductImport(old.db, { sourceId }));
  await f.service.extension.importRuntime(old.db.revisit);
  const feed = await f.request('api/product/v1/revisit/feed', { after: 0, limit: 50 });
  assert.equal(feed.status, 200);
  assert.ok(feed.value.deliveries.length);
  const item = feed.value.deliveries.find((r) => r.id === old.quote.id);
  assert.equal(item.source.available, true);
  const config = await f.request(
    'api/product/v1/revisit/config',
    { expectedRevision: 2, enabled: true },
    'PUT',
  );
  assert.equal(config.status, 200, JSON.stringify(config.value));
  const command = { manual: true, from: '2026-10-17T00:00:00Z', to: '2026-10-17T03:00:00Z' };
  const tick = await f.request('api/product/v1/revisit/tick', command);
  assert.equal(tick.status, 200);
  assert.equal(tick.value.created, 0);
  const group = await f.request('api/product/v1/revisit/comments', {
    operationId: 'group-comment',
    batchId: old.group.id,
    text: '一组的感想',
  });
  assert.equal(group.status, 201, JSON.stringify(group.value));
  assert.deepEqual(group.value.targets, old.group.targets);
  const quote = await f.request('api/product/v1/revisit/comments', {
    operationId: 'quote-comment',
    batchId: old.group.id,
    deliveryId: old.quote.id,
    text: '一条的回应',
  });
  assert.equal(quote.status, 201);
  assert.deepEqual(quote.value.targets, [old.quote.ref]);
  assert.deepEqual(
    (
      await f.request('api/product/v1/revisit/comments', {
        operationId: 'quote-comment',
        batchId: old.group.id,
        deliveryId: old.quote.id,
        text: '一条的回应',
      })
    ).value,
    quote.value,
  );
  const source = await f.request('api/product/v1/revisit/source', { deliveryId: old.quote.id });
  assert.equal(source.status, 200);
  assert.equal(source.value.comments.length, 2);
  const count = feed.value.deliveries.length;
  assert.equal((await f.request('api/product/v1/revisit/tick', command)).value.created, 0);
  assert.equal(
    (await f.request('api/product/v1/revisit/feed', { after: 0, limit: 50 })).value.deliveries
      .length,
    count,
  );
  assert.equal(
    (await f.request('api/product/v1/revisit/comments/withdraw', { operationId: 'quote-comment' }))
      .status,
    200,
  );
  const listing = await f.request(
    'api/product/v1/revisit/comments?entryId=' + old.quote.ref.entryId,
  );
  assert.equal(listing.status, 200);
  assert.doesNotMatch(JSON.stringify(listing.value), /一条的回应/);
});

test('business outbox and local message commit atomically; lost ACK retries retain identity', async (t) => {
  const f = await fixture(t);
  await f.service.extension.importPlan(planLegacyProductImport(library(), { sourceId }));
  const client = createProductServiceClient({ baseUrl: f.base, token: f.device.token });
  const room = await client.saveRoom({
    sourceId,
    id: '123',
    title: '离线随想',
    category: '日常',
    idleHours: 5,
    configuration: { wallpaperAssetId: 'image-one', messageAlign: 'left', bubbleOpacity: 0.7 },
  });
  assert.equal(room.configuration.wallpaperAssetId, 'image-one');
  const storage = createMemorySyncStorage();
  const queue = createProductCommandQueue({ ...f.service.store.info(), storage, client });
  const input = {
    sourceId,
    roomId: '123',
    messages: [{ id: '1', text: '掉线后重发', sentAt: '2026-10-18T07:00:00Z', attachments: [] }],
  };
  await assert.rejects(
    queue.enqueue('sendMessages', input, async (tx) => {
      await tx.putEntity({ entityType: 'local', entityId: '1', local: input });
      throw new Error('disk-full');
    }),
    /disk-full/,
  );
  assert.equal((await queue.pending()).length, 0);
  assert.equal(storage.persisted.entities.size, 0);
  const job = await queue.enqueue('sendMessages', input, async (tx) => {
    await tx.putEntity({ entityType: 'local', entityId: '1', local: input });
  });
  assert.equal((await queue.pending())[0].id, job.id);
  await assert.rejects(
    queue.flush(async () => {
      throw new Error('lost-ack');
    }),
    /lost-ack/,
  );
  assert.equal((await queue.pending())[0].id, job.id);
  const reopened = createProductCommandQueue({
    ...f.service.store.info(),
    storage: createMemorySyncStorage(storage.persisted),
    client,
  });
  assert.equal((await reopened.flush()).accepted, 1);
  const view = await client.library();
  assert.equal(view.messages.length, 1);
  assert.equal(view.conversations[0].configuration.bubbleOpacity, 0.7);
  assert.equal((await reopened.pending()).length, 0);
});

test('configuration and comment targets survive service restart and withdrawn originals stay scrubbed', async (t) => {
  const f = await fixture(t, { clock: () => commentNow }),
    old = commentLibrary();
  await f.service.extension.importPlan(planLegacyProductImport(old.db, { sourceId }));
  await f.service.extension.importRuntime(old.db.revisit);
  const comment = await f.request('api/product/v1/revisit/comments', {
    operationId: 'restart-comment',
    batchId: old.group.id,
    text: '重启后保留关联',
  });
  assert.equal(comment.status, 201);
  await f.service.close();
  const reopened = await fixture(t, { dataDir: f.dataDir, clock: () => commentNow });
  const listing = await reopened.request(
    'api/product/v1/revisit/comments?entryId=' + old.quote.ref.entryId,
  );
  assert.equal(listing.status, 200);
  assert.match(JSON.stringify(listing.value), /重启后保留关联/);
  const feed = await reopened.request('api/product/v1/revisit/feed', { after: 0, limit: 50 });
  assert.deepEqual(
    feed.value.deliveries.map((d) => d.id),
    old.db.revisit.deliveries.map((d) => d.id),
  );
});

test('a large replay catch-up publishes over 100 deliveries with its private cursor atomically', async (t) => {
  const f = await fixture(t),
    db = library();
  await f.service.extension.importPlan(planLegacyProductImport(db, { sourceId }));
  const prior = commentLibrary().db.revisit;
  prior.deliveries = Array.from({ length: 130 }, (_, i) => ({
    ...prior.deliveries[0],
    id: `revisit:synthetic-${i}`,
    sequence: i + 1,
  }));
  assert.equal(await f.service.extension.importRuntime(prior), true);
  const state = f.service.store.readProductState('product:revisit-state');
  assert.equal(state.deliveries.length, 130);
  assert.equal(
    f.service.store
      .snapshot({ limit: 200 })
      .entities.filter((r) => r.data?._product?.kind === 'delivery').length,
    130,
  );
});
