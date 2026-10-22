import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createSyncServer } from '../src/server/sync-v2/server.mjs';
import { productSyncExtension } from '../src/server/sync-product/service.mjs';
import { compilePreferenceSnapshot } from '../src/server/sync-product/preference-snapshot.mjs';
import { compileNotesSnapshot } from '../src/server/sync-product/notes-snapshot.mjs';
import { compileChatSnapshot } from '../src/server/sync-product/chat-snapshot.mjs';
import {
  productMessageId,
  productConversationId,
  productRecord,
} from '../public/shared/sync-product.js';
import { createProductSeedClient } from '../public/shared/product-seed-client.js';
import { readSeedPackage } from '../src/server/sync-product/seed-package.mjs';

const root = path.resolve('tmp/backend-source-snapshots/source-snapshot-ingestion-tests');
const route = 'api/product/v1/migration/snapshots';
const sourceId = '12345678-1234-4567-8910-123456789012';
const preferenceNamespace = 'shiye.android.diary.presentation.v2';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const preferences = (revision = 3) => ({
  format: 'shiye-client-preferences',
  version: 1,
  sourceId: 'desktop:shared-source',
  revision,
  namespaces: {
    [preferenceNamespace]: {
      defaultTitle: { mode: 'timestamp', future: [null, { retained: true }] },
      toolbar: ['save', 'future-command'],
      key: 'Alt+T',
    },
  },
});
const notes = () => {
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const assetId = `sha256:${hash(bytes)}`;
  return {
    bytes,
    snapshot: {
      kind: 'shiye-notes-ui-snapshot',
      experimental: true,
      exportedAt: '2026-10-19T00:00:00Z',
      workspace: {
        revision: 2,
        notes: [
          {
            id: 'note-one',
            title: '合成便签',
            body: {
              type: 'doc',
              content: [
                {
                  type: 'image',
                  attrs: {
                    assetId,
                    occurrenceId: 'occurrence-one',
                  },
                },
              ],
            },
            unknownFuture: { taskOrder: ['first'] },
          },
        ],
        openIds: ['note-one'],
        closedIds: [],
        activeId: 'note-one',
        futurePreference: { retained: true },
      },
      assets: [
        {
          id: assetId,
          name: 'original.png',
          type: 'image/png',
          dataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
        },
      ],
    },
  };
};
const chat = (revision = 1) => ({
  format: 'shiye-chat-snapshot',
  version: 1,
  sourceId,
  revision,
  rooms: [{ id: '-100', sourceId, title: '合成原房', configuration: { future: true } }],
  messages: [
    {
      roomId: '-100',
      id: '9007199254740993001',
      state: 'active',
      data: {
        id: '9007199254740993001',
        sentAt: '2026-10-19T00:00:00Z',
        text: 'SOURCE_SNAPSHOT_BODY_TO_WITHDRAW',
        attachments: [],
        unknownFuture: { kept: true },
      },
    },
  ],
  media: [],
});

async function fixture(t, { sourceFault = false } = {}) {
  await mkdir(root, { recursive: true });
  const dataDir = await mkdtemp(path.join(root, 'case-'));
  const fault = { enabled: sourceFault, calls: 0 };
  let service, baseUrl;
  const start = async () => {
    service = await createSyncServer({
      dataDir,
      extensionFactory: async (context) => {
        if (sourceFault) {
          const push = context.store.push.bind(context.store);
          context.store.push = (deviceId, operations, options = {}) => {
            if (deviceId !== 'product-source-import' || !fault.enabled)
              return push(deviceId, operations, options);
            let index = 0;
            return push(deviceId, operations, {
              ...options,
              beforeApply(op, previous) {
                const policy = options.beforeApply?.(op, previous);
                fault.calls++;
                if (++index === 2)
                  throw Object.assign(new Error('TEST_SECOND_SOURCE_OPERATION'), {
                    code: 'TEST_SECOND_SOURCE_OPERATION',
                    status: 409,
                  });
                return policy;
              },
            });
          };
        }
        return productSyncExtension({ autoTickMs: 0 })(context);
      },
    });
    service.server.listen(0, '127.0.0.1');
    await once(service.server, 'listening');
    baseUrl = `http://127.0.0.1:${service.server.address().port}/`;
  };
  await start();
  t.after(async () => {
    await service.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  const local = await fetch(`${baseUrl}api/sync/v1/local-pairing`, {
    method: 'POST',
    headers: { 'X-Sync-Client': 'local-admin' },
  });
  assert.equal(local.status, 200);
  const paired = await fetch(`${baseUrl}api/sync/v1/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: (await local.json()).code,
      deviceName: 'source-snapshot-http-test',
    }),
  });
  assert.equal(paired.status, 201);
  const { token } = await paired.json();
  const raw = (suffix, body, authenticated = true) =>
    fetch(baseUrl + suffix, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(authenticated ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const request = async (suffix, body, authenticated) => {
    const response = await raw(suffix, body, authenticated);
    return { status: response.status, value: await response.json() };
  };
  return {
    get service() {
      return service;
    },
    raw,
    request,
    dataDir,
    fault,
    seed: () => createProductSeedClient({ baseUrl, token }),
    ingest: (kind, snapshot, extra = {}) => request(`${route}/${kind}`, { snapshot, ...extra }),
    async restart() {
      await service.close();
      await start();
    },
  };
}

const accepted = (response) => {
  assert.equal(response.status, 200, JSON.stringify(response.value));
  assert.equal(response.value.completeComputerExport, false);
  return response.value;
};
const conflict = (response, code) => {
  assert.equal(response.status, 409, JSON.stringify(response.value));
  assert.equal(response.value.error.code, code);
};
const receipts = (directory) => {
  const db = new DatabaseSync(path.join(directory, 'sync.sqlite'), { readOnly: true });
  try {
    return db.prepare('SELECT COUNT(*) AS count FROM receipts').get().count;
  } finally {
    db.close();
  }
};

test('HTTP preference snapshots preserve complete namespaces and enforce source revision/hash replay, conflict and stale protection', async (t) => {
  const f = await fixture(t);
  const snapshot = preferences();
  const plan = compilePreferenceSnapshot(snapshot);
  const receipt = accepted(await f.ingest('preferences', snapshot));
  assert.equal(receipt.kind, 'preferences');
  assert.equal(receipt.sourceId, snapshot.sourceId);
  assert.equal(receipt.snapshotRevision, snapshot.revision);
  assert.equal(receipt.sourceSha256, plan.sourceSha256);
  assert.equal(receipt.recordCount, 1);
  assert.equal(receipt.changedRecords, 1);
  assert.equal(receipt.assetCount, 0);
  assert.equal(receipt.replayed, false);
  const record = plan.records[0];
  const entity = () => f.service.store.getEntity(record.entityType, record.entityId);
  assert.deepEqual(entity().data.values, snapshot.namespaces[preferenceNamespace]);
  assert.equal(entity().data._product.readOnlyProjection, true);
  const before = f.service.store.info().seq;
  assert.deepEqual(accepted(await f.ingest('preferences', snapshot)), {
    ...receipt,
    replayed: true,
  });
  assert.equal(f.service.store.info().seq, before);
  const conflicting = structuredClone(snapshot);
  conflicting.namespaces[preferenceNamespace].key = 'Alt+X';
  conflict(await f.ingest('preferences', conflicting), 'SOURCE_REVISION_CONFLICT');
  conflict(await f.ingest('preferences', preferences(2)), 'SOURCE_REVISION_OLD');
  assert.equal(f.service.store.info().seq, before);
  assert.deepEqual(entity().data.values, snapshot.namespaces[preferenceNamespace]);
  const next = preferences(4);
  next.namespaces[preferenceNamespace].futureNewKey = { preserved: true };
  accepted(await f.ingest('preferences', next));
  assert.equal(entity().revision, 2);
  assert.deepEqual(entity().data.values, next.namespaces[preferenceNamespace]);
  const listed = await f.request(route);
  assert.equal(listed.status, 200);
  assert.equal(listed.value.version, 1);
  assert.equal(listed.value.completeComputerExport, false);
  assert.deepEqual(listed.value.kinds, ['preferences', 'notes', 'chat']);
  assert.equal(listed.value.sources.length, 1);
  assert.equal(listed.value.sources[0].sourceSha256, compilePreferenceSnapshot(next).sourceSha256);
  assert.equal(listed.value.sources[0].snapshotRevision, 4);
  assert.equal(listed.value.sources[0].coverage.completeComputerExport, false);
  assert.equal(listed.value.sources[0].receipt.replayed, false);
});

test('HTTP notes snapshot persists original bytes and read-only workspace; source metadata survives restart with pairing', async (t) => {
  const f = await fixture(t);
  const input = notes();
  const source = 'desktop:shared-source';
  const plan = compileNotesSnapshot(input.snapshot, { sourceId: source });
  accepted(await f.ingest('notes', input.snapshot, { sourceId: source }));
  const entity = f.service.store.getEntity(plan.records[0].entityType, plan.records[0].entityId);
  assert.deepEqual(entity.data.workspace, input.snapshot.workspace);
  assert.equal(entity.data._product.readOnlyProjection, true);
  assert.equal(JSON.stringify(entity.data).includes('base64,'), false);
  const asset = plan.assets[0];
  const original = await f.raw(`api/sync/v1/media/assets/${asset.assetId}/content`);
  assert.equal(original.status, 200);
  assert.deepEqual(Buffer.from(await original.arrayBuffer()), input.bytes);
  const beforeList = await f.request(route);
  assert.equal(beforeList.status, 200);
  const beforeSeq = f.service.store.info().seq;
  await f.restart();
  const afterList = await f.request(route);
  assert.equal(afterList.status, 200);
  assert.deepEqual(afterList.value, beforeList.value);
  accepted(await f.ingest('notes', input.snapshot, { sourceId: source }));
  assert.equal(f.service.store.info().seq, beforeSeq);
  const afterOriginal = await f.raw(`api/sync/v1/media/assets/${asset.assetId}/content`);
  assert.equal(afterOriginal.status, 200);
  assert.deepEqual(Buffer.from(await afterOriginal.arrayBuffer()), input.bytes);
});

test('HTTP chat source refresh writes body-free tombstones and prevents later source resurrection', async (t) => {
  const f = await fixture(t);
  const initial = chat();
  const plan = compileChatSnapshot(initial);
  accepted(await f.ingest('chat', initial));
  const message = plan.records.find((record) => record.entityType === 'chatMessage');
  assert.equal(
    f.service.store.getEntity('chatMessage', message.entityId).data.text,
    initial.messages[0].data.text,
  );
  const withdrawn = chat(2);
  withdrawn.messages[0].state = 'withdrawn';
  delete withdrawn.messages[0].data;
  accepted(await f.ingest('chat', withdrawn));
  const tombstone = f.service.store.getEntity('chatMessage', message.entityId);
  assert.equal(tombstone.state, 'withdrawn');
  assert.deepEqual(tombstone.data, {});
  const before = f.service.store.info().seq;
  accepted(await f.ingest('chat', withdrawn));
  assert.equal(f.service.store.info().seq, before);
  const resurrection = await f.ingest('chat', chat(3));
  conflict(resurrection, 'SOURCE_TOMBSTONE_FINAL');
  assert.equal(f.service.store.info().seq, before);
  const visible = await f.request('api/product/v1/library');
  assert.equal(visible.status, 200);
  assert.equal(JSON.stringify(visible.value).includes('SOURCE_SNAPSHOT_BODY_TO_WITHDRAW'), false);
  assert.equal(message.entityId, productMessageId(sourceId, '-100', '9007199254740993001'));
});

test('source chat stays read-only across business and generic writes while normal neighbor edits leave its JSON unchanged', async (t) => {
  const f = await fixture(t);
  const category = productRecord('taxonomy', 'taxonomy:source-snapshot-test-category', {
    id: 'taxonomy:source-snapshot-test-category',
    kind: 'category',
    name: '合成分类',
  });
  const seeded = await f.request('api/sync/v1/push', {
    operations: [
      {
        operationId: randomUUID(),
        entityType: category.entityType,
        entityId: category.entityId,
        command: 'create',
        baseRevision: 0,
        data: category.data,
      },
    ],
  });
  assert.equal(seeded.status, 200, JSON.stringify(seeded.value));
  const snapshot = chat();
  snapshot.rooms[0].category = category.data.name;
  snapshot.rooms[0].idleHours = 5;
  accepted(await f.ingest('chat', snapshot));
  const sourceRoomId = productConversationId(sourceId, '-100');
  const sourceMessageId = productMessageId(sourceId, '-100', snapshot.messages[0].id);
  const currentRoom = () => f.service.store.getEntity('conversation', sourceRoomId);
  const beforeRoom = JSON.stringify(currentRoom()),
    beforeHash = hash(beforeRoom);
  const beforeSeq = f.service.store.info().seq;
  const sourceRoomUpdate = {
    sourceId,
    id: '-100',
    title: 'forbidden-business-title',
    category: category.data.name,
    idleHours: 6,
    configuration: { forbidden: true },
  };
  const sourceSend = {
    sourceId,
    roomId: '-100',
    messages: [
      {
        id: '9007199254740993002',
        sentAt: '2026-10-19T00:00:01Z',
        text: 'forbidden-send',
        attachments: [],
      },
    ],
  };
  for (const [action, input] of [
    ['chat/room', sourceRoomUpdate],
    ['chat/send', sourceSend],
    ['chat/withdraw', { sourceId, roomId: '-100', messageId: snapshot.messages[0].id }],
  ])
    conflict(await f.request(`api/product/v1/${action}`, input), 'PRODUCT_SOURCE_READ_ONLY');
  for (const [entityType, entityId] of [
    ['conversation', sourceRoomId],
    ['chatMessage', sourceMessageId],
  ]) {
    const entity = f.service.store.getEntity(entityType, entityId);
    const response = await f.request('api/sync/v1/push', {
      operations: [
        {
          operationId: randomUUID(),
          entityType,
          entityId,
          baseRevision: entity.revision,
          command: 'updateFields',
          changes: { title: 'forbidden-generic-title' },
        },
      ],
    });
    assert.equal(response.status, 403);
    assert.equal(response.value.error.code, 'PRODUCT_USE_BUSINESS_COMMAND');
  }
  assert.equal(f.service.store.info().seq, beforeSeq);
  assert.equal(JSON.stringify(currentRoom()), beforeRoom);
  const neighbor = {
    sourceId,
    id: '-101',
    title: 'normal-neighbor',
    category: category.data.name,
    idleHours: 5,
    configuration: { future: 'preserved' },
  };
  const created = await f.request('api/product/v1/chat/room', neighbor);
  assert.equal(created.status, 200, JSON.stringify(created.value));
  const updated = await f.request('api/product/v1/chat/room', {
    ...neighbor,
    title: 'normal-neighbor-edited',
    configuration: { future: 'updated' },
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.value));
  const neighborRecord = f.service.store.getEntity(
    'conversation',
    productConversationId(sourceId, '-101'),
  );
  assert.equal(neighborRecord.data.title, 'normal-neighbor-edited');
  assert.equal(neighborRecord.data.configuration.future, 'updated');
  assert.equal(neighborRecord.data._product.readOnlyProjection, undefined);
  assert.equal(JSON.stringify(currentRoom()), beforeRoom);
  assert.equal(hash(JSON.stringify(currentRoom())), beforeHash);
  const next = structuredClone(snapshot);
  next.revision = 2;
  next.rooms[0].title = 'source-owned-title-update';
  next.rooms[0].configuration.future = 'source-owned-config-update';
  accepted(await f.ingest('chat', next));
  assert.equal(currentRoom().data.title, 'source-owned-title-update');
  assert.equal(currentRoom().data.configuration.future, 'source-owned-config-update');
  assert.equal(currentRoom().data._product.readOnlyProjection, true);
  assert.equal(
    f.service.store.getEntity('conversation', neighborRecord.entityId).data.title,
    'normal-neighbor-edited',
  );
});

test('target changed by another internal writer prevents a newer source snapshot overwriting it', async (t) => {
  const f = await fixture(t);
  const initial = preferences();
  const record = compilePreferenceSnapshot(initial).records[0];
  accepted(await f.ingest('preferences', initial));
  const old = f.service.store.getEntity(record.entityType, record.entityId);
  // Read-only projections reject ordinary clients. This trusted isolated writer
  // models a separate internal import/maintenance owner changing the same target.
  const changes = { values: { separateOwner: { retained: true } } };
  f.service.store.push(
    'synthetic-other-owner',
    [
      {
        operationId: randomUUID(),
        entityType: record.entityType,
        entityId: record.entityId,
        baseRevision: old.revision,
        command: 'updateFields',
        changes,
      },
    ],
    { atomic: true, serverWrite: true },
  );
  const before = f.service.store.info().seq;
  const rejected = await f.ingest('preferences', preferences(4));
  conflict(rejected, 'SOURCE_TARGET_CHANGED');
  assert.equal(f.service.store.info().seq, before);
  assert.deepEqual(
    f.service.store.getEntity(record.entityType, record.entityId).data.values,
    changes.values,
  );
});

test('HTTP ingested preferences and notes originals are present in a checked real syseed export', async (t) => {
  const f = await fixture(t);
  const prefs = preferences();
  const input = notes(),
    source = prefs.sourceId;
  const notesPlan = compileNotesSnapshot(input.snapshot, { sourceId: source });
  accepted(await f.ingest('preferences', prefs));
  accepted(await f.ingest('notes', input.snapshot, { sourceId: source }));
  const listed = await f.request(route);
  assert.equal(listed.value.sources.length, 2, 'same sourceId has independent kind ledgers');
  const api = f.seed();
  let job = await api.createExport(randomUUID());
  for (let index = 0; index < 250 && job.status === 'building'; index++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    job = await api.exportStatus(job.id);
  }
  assert.equal(job.status, 'ready', JSON.stringify(job));
  const file = path.join(f.dataDir, 'ingested.syseed');
  await writeFile(file, Buffer.from(await (await api.download(job.id)).arrayBuffer()));
  const pack = await readSeedPackage({
    file,
    directory: path.join(f.dataDir, 'checked-export'),
    expectedSha256: job.sha256,
  });
  const preferenceRecord = pack.records.find(
    (record) => record.data?.scope === 'client-preferences',
  );
  assert.deepEqual(preferenceRecord.data.values, prefs.namespaces[preferenceNamespace]);
  assert.equal(preferenceRecord.data._product.readOnlyProjection, true);
  const noteRecord = pack.records.find(
    (record) => record.data?.scope === 'notes-workspace-snapshot',
  );
  assert.deepEqual(noteRecord.data.workspace, input.snapshot.workspace);
  const asset = pack.records.find(
    (record) => record.entityType === 'asset' && record.entityId === notesPlan.assets[0].assetId,
  );
  assert.equal(asset.data.sha256, hash(input.bytes));
  assert.deepEqual(
    await readFile(path.join(pack.directory, 'media', asset.data.sha256)),
    input.bytes,
  );
  assert.equal(pack.manifest.containsCredentials, false);
  assert.equal(pack.manifest.policy.clientWallpaper, 'device-local');
});

test('notes rename with identical original bytes updates snapshot metadata and reuses the same asset identity', async (t) => {
  const f = await fixture(t);
  const input = notes(),
    source = 'desktop:rename-source';
  const initialPlan = compileNotesSnapshot(input.snapshot, { sourceId: source });
  accepted(await f.ingest('notes', input.snapshot, { sourceId: source }));
  const renamed = structuredClone(input.snapshot);
  renamed.workspace.revision++;
  renamed.assets[0].name = 'renamed-original.png';
  const renamedPlan = compileNotesSnapshot(renamed, { sourceId: source });
  assert.equal(renamedPlan.assets[0].assetId, initialPlan.assets[0].assetId);
  assert.equal(renamedPlan.assets[0].sha256, initialPlan.assets[0].sha256);
  const receipt = accepted(await f.ingest('notes', renamed, { sourceId: source }));
  assert.equal(receipt.replayed, false);
  assert.equal(receipt.changedRecords, 1);
  const profile = f.service.store.getEntity('profile', initialPlan.records[0].entityId);
  assert.equal(profile.data.assetMapping[0].sourceMetadata.name, 'renamed-original.png');
  const original = await f.raw(`api/sync/v1/media/assets/${initialPlan.assets[0].assetId}/content`);
  assert.equal(original.status, 200);
  assert.deepEqual(Buffer.from(await original.arrayBuffer()), input.bytes);
  const before = f.service.store.info().seq;
  assert.equal(accepted(await f.ingest('notes', renamed, { sourceId: source })).replayed, true);
  assert.equal(f.service.store.info().seq, before);
});

test('a conflicting second namespace rejects the entire source refresh without changing rows, receipts or ledger', async (t) => {
  const f = await fixture(t);
  const initial = preferences();
  const originalRecord = compilePreferenceSnapshot(initial).records[0];
  accepted(await f.ingest('preferences', initial));
  const next = preferences(4);
  next.namespaces[preferenceNamespace].newSourceField = 'must-not-partially-commit';
  next.namespaces['vendor.conflicting.v1'] = { ownedBySource: true };
  const collision = compilePreferenceSnapshot(next).records.find(
    (record) => record.data.namespace === 'vendor.conflicting.v1',
  );
  const preexisting = structuredClone(collision.data);
  preexisting.values = { ownedByOtherWriter: true };
  f.service.store.push(
    'synthetic-other-owner',
    [
      {
        operationId: randomUUID(),
        entityType: collision.entityType,
        entityId: collision.entityId,
        baseRevision: 0,
        command: 'create',
        data: preexisting,
      },
    ],
    { atomic: true, serverWrite: true },
  );
  const beforeSeq = f.service.store.info().seq,
    beforeReceipts = receipts(f.dataDir);
  const beforeLedger = (await f.request(route)).value;
  const beforeOriginal = f.service.store.getEntity(
    originalRecord.entityType,
    originalRecord.entityId,
  );
  conflict(await f.ingest('preferences', next), 'SOURCE_TARGET_EXISTS');
  assert.equal(f.service.store.info().seq, beforeSeq);
  assert.equal(receipts(f.dataDir), beforeReceipts);
  assert.deepEqual((await f.request(route)).value, beforeLedger);
  assert.deepEqual(
    f.service.store.getEntity(originalRecord.entityType, originalRecord.entityId),
    beforeOriginal,
  );
  assert.deepEqual(
    f.service.store.getEntity(collision.entityType, collision.entityId).data,
    preexisting,
  );
});

test('second source operation fault in the real store transaction rolls back rows, receipts and source ledger, then same revision retries', async (t) => {
  const f = await fixture(t, { sourceFault: true });
  const snapshot = preferences();
  snapshot.namespaces['vendor.second.v1'] = { future: { retained: true } };
  const plan = compilePreferenceSnapshot(snapshot);
  assert.equal(plan.records.length, 2);
  const beforeSeq = f.service.store.info().seq,
    beforeReceipts = receipts(f.dataDir);
  const beforeLedger = (await f.request(route)).value;
  conflict(await f.ingest('preferences', snapshot), 'TEST_SECOND_SOURCE_OPERATION');
  assert.equal(f.fault.calls, 2, 'first op applied before second pre-apply hook faults');
  assert.equal(f.service.store.info().seq, beforeSeq);
  assert.equal(receipts(f.dataDir), beforeReceipts);
  assert.deepEqual((await f.request(route)).value, beforeLedger);
  for (const record of plan.records)
    assert.equal(f.service.store.getEntity(record.entityType, record.entityId), null);
  f.fault.enabled = false;
  const receipt = accepted(await f.ingest('preferences', snapshot));
  assert.equal(receipt.snapshotRevision, snapshot.revision);
  assert.equal(receipt.changedRecords, 2);
  assert.equal(receipt.replayed, false);
  assert.equal(receipts(f.dataDir), beforeReceipts + 2);
  for (const record of plan.records)
    assert.deepEqual(
      f.service.store.getEntity(record.entityType, record.entityId).data,
      record.data,
    );
  const committedSeq = f.service.store.info().seq;
  assert.equal(accepted(await f.ingest('preferences', snapshot)).replayed, true);
  assert.equal(f.service.store.info().seq, committedSeq);
});

test('large notes profile crosses payload threshold and a later inline snapshot fully replaces pointer and stale fields', async (t) => {
  const f = await fixture(t);
  const source = 'desktop:large-note-source',
    input = notes();
  input.snapshot.workspace.notes[0].unknownFuture.largeOnlyField = 'x'.repeat(800000);
  const largePlan = compileNotesSnapshot(input.snapshot, { sourceId: source });
  assert.ok(Buffer.byteLength(JSON.stringify(largePlan.records[0].data)) > 786432);
  const first = accepted(await f.ingest('notes', input.snapshot, { sourceId: source }));
  const id = largePlan.records[0].entityId;
  const wire = f.service.store.getEntity('profile', id);
  assert.deepEqual(Object.keys(wire.data), ['_product']);
  assert.ok(wire.data._product.payload);
  const payloadAsset = await f.service.media.getAsset(wire.data._product.payload.assetId);
  assert.equal(payloadAsset.sha256, wire.data._product.payload.sha256);
  const visibleLarge = (await f.request('api/product/v1/library')).value.profiles.find(
    (profile) => profile.sourceId === source,
  );
  assert.equal(visibleLarge.workspace.notes[0].unknownFuture.largeOnlyField.length, 800000);
  const small = structuredClone(input.snapshot);
  small.workspace.revision++;
  delete small.workspace.notes[0].unknownFuture.largeOnlyField;
  small.workspace.notes[0].title = 'inline-new-title';
  const smallPlan = compileNotesSnapshot(small, { sourceId: source });
  assert.ok(Buffer.byteLength(JSON.stringify(smallPlan.records[0].data)) < 786432);
  const second = accepted(await f.ingest('notes', small, { sourceId: source }));
  assert.equal(second.changedRecords, 1);
  assert.notEqual(second.sourceSha256, first.sourceSha256);
  const inline = f.service.store.getEntity('profile', id);
  assert.equal(inline.revision, wire.revision + 1);
  assert.deepEqual(inline.data, smallPlan.records[0].data);
  assert.equal(inline.data._product.payload, undefined);
  assert.equal(inline.data.workspace.notes[0].unknownFuture.largeOnlyField, undefined);
  const visibleSmall = (await f.request('api/product/v1/library')).value.profiles.find(
    (profile) => profile.sourceId === source,
  );
  assert.deepEqual(visibleSmall.workspace, small.workspace);
  const beforeReplay = f.service.store.info().seq;
  assert.equal(accepted(await f.ingest('notes', small, { sourceId: source })).replayed, true);
  assert.equal(f.service.store.info().seq, beforeReplay);
  await f.restart();
  assert.deepEqual(f.service.store.getEntity('profile', id).data, smallPlan.records[0].data);
  assert.equal(accepted(await f.ingest('notes', small, { sourceId: source })).replayed, true);
  assert.equal(f.service.store.info().seq, beforeReplay);
});

test('HTTP preserves the UI022 entry width array namespace without changing its JSON type', async (t) => {
  const f = await fixture(t);
  const namespace = 'shiye.android.diary.entry-image-width.v1';
  const values = Array.from({ length: 100 }, (_, n) => ({
    id: `entry-${n}`,
    width: 40,
    unknown: { retained: true },
  }));
  const snapshot = { ...preferences(), namespaces: { [namespace]: values } };
  const plan = compilePreferenceSnapshot(snapshot);
  accepted(await f.ingest('preferences', snapshot));
  assert.deepEqual(
    f.service.store.getEntity('profile', plan.records[0].entityId).data.values,
    values,
  );
  await f.restart();
  assert.deepEqual(
    f.service.store.getEntity('profile', plan.records[0].entityId).data.values,
    values,
  );
  assert.equal(accepted(await f.ingest('preferences', snapshot)).replayed, true);
});

test('snapshot routes require authentication and malformed sources leave no product entities', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request(route, undefined, false)).status, 401);
  assert.equal(
    (await f.request(`${route}/preferences`, { snapshot: preferences() }, false)).status,
    401,
  );
  const before = f.service.store.info().seq;
  const invalid = preferences();
  invalid.namespaces[preferenceNamespace] = null;
  assert.equal((await f.ingest('preferences', invalid)).status, 400);
  assert.equal(f.service.store.info().seq, before);
  assert.equal(
    f.service.store.getEntity(
      'profile',
      compilePreferenceSnapshot(preferences()).records[0].entityId,
    ),
    null,
  );
});
