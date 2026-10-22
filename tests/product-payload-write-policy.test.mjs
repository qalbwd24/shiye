import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createSyncServer } from '../src/server/sync-v2/server.mjs';
import { openSyncStore } from '../src/server/sync-v2/store.mjs';
import { productSyncExtension } from '../src/server/sync-product/service.mjs';
import { readSeedPackage } from '../src/server/sync-product/seed-package.mjs';
import { prepareProductPayload, hydrateProductPayload } from '../public/shared/sync-product.js';
import { uploadAsset } from '../public/shared/sync-v2-media.js';

const root = path.resolve('tmp/backend-source-snapshots/payload-write-policy-tests');
const operation = (record, baseRevision = 0) => ({
  operationId: randomUUID(),
  entityType: record.entityType,
  entityId: record.entityId,
  command: baseRevision ? 'updateFields' : 'create',
  baseRevision,
  [baseRevision ? 'changes' : 'data']: structuredClone(record.data),
});
const receiptCount = (directory, id) => {
  const db = new DatabaseSync(path.join(directory, 'sync.sqlite'), { readOnly: true });
  try {
    return db.prepare('SELECT COUNT(*) AS count FROM receipts WHERE operationId=?').get(id).count;
  } finally {
    db.close();
  }
};

async function fixture(t) {
  await mkdir(root, { recursive: true });
  const dir = await mkdtemp(path.join(root, 'case-'));
  const golden = JSON.parse(
    await readFile(path.resolve('docs/contracts/product-seed-v1.fixture.json'), 'utf8'),
  );
  const file = path.join(dir, 'golden.syseed');
  await writeFile(file, Buffer.from(golden.packageBase64, 'base64'));
  const pack = await readSeedPackage({
    file,
    directory: path.join(dir, 'golden'),
    expectedSha256: golden.sha256,
  });
  const dataDir = path.join(dir, 'server');
  const service = await createSyncServer({
    dataDir,
    extensionFactory: productSyncExtension({ autoTickMs: 0 }),
  });
  t.after(async () => {
    await service.close();
    await rm(dir, { recursive: true, force: true });
  });
  service.server.listen(0, '127.0.0.1');
  await once(service.server, 'listening');
  const baseUrl = `http://127.0.0.1:${service.server.address().port}/`;
  const local = await fetch(`${baseUrl}api/sync/v1/local-pairing`, {
    method: 'POST',
    headers: { 'X-Sync-Client': 'local-admin' },
  });
  assert.equal(local.status, 200);
  const pair = await fetch(`${baseUrl}api/sync/v1/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: (await local.json()).code,
      deviceName: 'synthetic-payload-policy-test',
    }),
  });
  assert.equal(pair.status, 201);
  const { token } = await pair.json();
  const request = async (route, body) => {
    const response = await fetch(baseUrl + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, value: await response.json() };
  };
  const push = (operations) => request('api/sync/v1/push', { operations });
  const taxonomy = pack.records.filter((record) => record.data?._product?.kind === 'taxonomy');
  const seeded = await push(taxonomy.map((record) => operation(record)));
  assert.equal(seeded.status, 200, JSON.stringify(seeded.value));
  const entry = structuredClone(
    pack.records.find((record) => record.entityType === 'journalAggregate'),
  );
  assert.ok(
    entry.data._canonical?.units.length,
    'use the checked golden canonical body, not fabricated units',
  );
  const packed = async (title) => {
    const full = structuredClone(entry);
    full.data.title = title;
    // A deliberately small threshold exercises the exact real payload container
    // and HTTP asset pipeline without manufacturing a different canonical body.
    const prepared = prepareProductPayload(full, { inlineBytes: 0 });
    assert.ok(prepared.payload);
    await uploadAsset({ baseUrl, token, ...prepared.payload, retries: 0 });
    assert.deepEqual(
      hydrateProductPayload(prepared.record, prepared.payload.bytes).data,
      full.data,
    );
    return prepared;
  };
  return { service, dataDir, entry, request, push, packed };
}

test('paired HTTP packed create/edit uses real assets; stale CAS rolls back seq/receipt and replay stays idempotent', async (t) => {
  const f = await fixture(t);
  const first = await f.packed('packed-v1'),
    second = await f.packed('packed-v2');
  const create = operation(first.record);
  const created = await f.push([create]);
  assert.equal(created.status, 200, JSON.stringify(created.value));
  assert.equal(created.value.results[0].entity.revision, 1);
  const update = operation(second.record, 1);
  const updated = await f.push([update]);
  assert.equal(updated.status, 200, JSON.stringify(updated.value));
  assert.equal(updated.value.results[0].entity.revision, 2);
  assert.equal((await f.request('api/product/v1/library')).value.entries[0].title, 'packed-v2');
  const before = f.service.store.info().seq;
  const stale = operation(first.record, 1);
  const conflict = await f.push([stale]);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.value.error.code, 'PRODUCT_PAYLOAD_REBASE_REQUIRED');
  assert.equal(f.service.store.info().seq, before);
  assert.equal(receiptCount(f.dataDir, stale.operationId), 0);
  assert.equal(f.service.store.getEntity(f.entry.entityType, f.entry.entityId).revision, 2);
  // Old create's baseRevision=0 must replay before the policy examines revision=2.
  const replay = await f.push([create]);
  assert.equal(replay.status, 200, JSON.stringify(replay.value));
  assert.deepEqual(replay.value.results, created.value.results);
  assert.equal(f.service.store.info().seq, before);
  assert.equal(receiptCount(f.dataDir, create.operationId), 1);
  const reused = { ...update, changes: structuredClone(first.record.data) };
  const refused = await f.push([reused]);
  assert.equal(refused.status, 409);
  assert.equal(refused.value.error.code, 'OPERATION_ID_REUSED');
  assert.equal(f.service.store.info().seq, before);
  assert.equal((await f.request('api/product/v1/library')).value.entries[0].title, 'packed-v2');
  const catalog = await f.request('api/product/v1/catalog');
  assert.equal(catalog.value.payloadWrites.conflict, 'strict-base-revision');
  assert.equal(f.service.extension.features.payloadWrites.version, 1);
});

test('a second stale packed update in one HTTP batch rolls back the first value and its receipt', async (t) => {
  const f = await fixture(t);
  const a = await f.packed('before'),
    b = await f.packed('candidate'),
    c = await f.packed('stale-second');
  assert.equal((await f.push([operation(a.record)])).status, 200);
  const first = operation(b.record, 1),
    second = operation(c.record, 1);
  const before = f.service.store.info().seq;
  const rejected = await f.push([first, second]);
  assert.equal(rejected.status, 409);
  assert.equal(rejected.value.error.code, 'PRODUCT_PAYLOAD_REBASE_REQUIRED');
  assert.equal(f.service.store.info().seq, before);
  assert.equal(receiptCount(f.dataDir, first.operationId), 0);
  assert.equal(receiptCount(f.dataDir, second.operationId), 0);
  assert.equal((await f.request('api/product/v1/library')).value.entries[0].title, 'before');
  // The first operation can still commit with the same ID: rollback left no receipt.
  const retried = await f.push([first]);
  assert.equal(retried.status, 200, JSON.stringify(retried.value));
  assert.equal(retried.value.results[0].entity.revision, 2);
  assert.equal((await f.request('api/product/v1/library')).value.entries[0].title, 'candidate');
});

test('packed wire envelopes reject mixed inline fields and pointer-only title patches without leaving receipts', async (t) => {
  const f = await fixture(t);
  const prepared = await f.packed('packed');
  const mixedCreate = operation(prepared.record);
  mixedCreate.data.title = 'must-not-leak-inline';
  const beforeCreate = f.service.store.info().seq;
  const invalidCreate = await f.push([mixedCreate]);
  assert.equal(invalidCreate.status, 409);
  assert.equal(invalidCreate.value.error.code, 'PRODUCT_PAYLOAD_ENVELOPE_REQUIRED');
  assert.equal(f.service.store.info().seq, beforeCreate);
  assert.equal(receiptCount(f.dataDir, mixedCreate.operationId), 0);
  assert.equal((await f.push([operation(prepared.record)])).status, 200);
  const before = f.service.store.info().seq;
  const patch = operation(prepared.record, 1);
  patch.changes = { title: 'patch-cannot-replace-payload-title' };
  const invalidPatch = await f.push([patch]);
  assert.equal(invalidPatch.status, 409);
  assert.equal(invalidPatch.value.error.code, 'PRODUCT_PAYLOAD_ENVELOPE_REQUIRED');
  const mixedUpdate = operation(prepared.record, 1);
  mixedUpdate.changes.title = 'also-forbidden';
  const invalidUpdate = await f.push([mixedUpdate]);
  assert.equal(invalidUpdate.status, 409);
  assert.equal(invalidUpdate.value.error.code, 'PRODUCT_PAYLOAD_ENVELOPE_REQUIRED');
  assert.equal(f.service.store.info().seq, before);
  assert.equal(receiptCount(f.dataDir, patch.operationId), 0);
  assert.equal(receiptCount(f.dataDir, mixedUpdate.operationId), 0);
  assert.equal((await f.request('api/product/v1/library')).value.entries[0].title, 'packed');
});

test('inline canonical entries keep existing stale disjoint-field merge behavior', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.push([operation(f.entry)])).status, 200);
  const title = operation(f.entry, 1);
  title.changes = { title: 'desktop-title' };
  assert.equal((await f.push([title])).status, 200);
  const location = operation(f.entry, 1);
  location.changes = { location: 'phone-location' };
  const merged = await f.push([location]);
  assert.equal(merged.status, 200, JSON.stringify(merged.value));
  const entity = f.service.store.getEntity(f.entry.entityType, f.entry.entityId);
  assert.equal(entity.revision, 3);
  assert.equal(entity.data.title, 'desktop-title');
  assert.equal(entity.data.location, 'phone-location');
  assert.deepEqual(entity.data._canonical, f.entry.data._canonical);
  assert.deepEqual(entity.data.body, f.entry.data.body);
});

test('inline-to-packed transition replaces complete wire data while retaining hydrated canonical content and strict CAS', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.push([operation(f.entry)])).status, 200);
  const interim = operation(f.entry, 1);
  interim.changes = { title: 'stale-inline-title-must-disappear' };
  assert.equal((await f.push([interim])).status, 200);
  const packed = await f.packed('complete-packed-title');
  const before = f.service.store.info().seq;
  const stale = operation(packed.record, 1);
  const rejected = await f.push([stale]);
  assert.equal(rejected.status, 409);
  assert.equal(rejected.value.error.code, 'PRODUCT_PAYLOAD_REBASE_REQUIRED');
  assert.equal(f.service.store.info().seq, before);
  assert.equal(receiptCount(f.dataDir, stale.operationId), 0);
  const accepted = await f.push([operation(packed.record, 2)]);
  assert.equal(accepted.status, 200, JSON.stringify(accepted.value));
  const wireEntity = accepted.value.results[0].entity;
  assert.equal(wireEntity.revision, 3);
  assert.deepEqual(Object.keys(wireEntity.data), ['_product']);
  assert.deepEqual(wireEntity.data, packed.record.data);
  assert.deepEqual(
    f.service.store.getEntity(f.entry.entityType, f.entry.entityId).data,
    packed.record.data,
  );
  const library = (await f.request('api/product/v1/library')).value;
  assert.equal(library.entries[0].title, 'complete-packed-title');
  assert.deepEqual(library.entries[0].body, f.entry.data.body);
  assert.deepEqual(library.messageStore.units, f.entry.data._canonical.units);
  assert.equal(JSON.stringify(wireEntity).includes('stale-inline-title-must-disappear'), false);
});

test('payload reference size limit precedes asset lookup; metadata size/hash mismatch reject without seq or receipts', async (t) => {
  const f = await fixture(t);
  const packed = await f.packed('trusted-real-asset');
  const before = f.service.store.info().seq;
  const cases = [
    {
      size: 64 * 1024 * 1024 + 1,
      assetId: 'missing-asset-not-to-be-looked-up',
      status: 413,
      code: 'PRODUCT_PAYLOAD_TOO_LARGE',
    },
    { size: packed.payload.size + 1, status: 422, code: 'PRODUCT_PAYLOAD_HASH_MISMATCH' },
    { sha256: '0'.repeat(64), status: 422, code: 'PRODUCT_PAYLOAD_HASH_MISMATCH' },
  ];
  for (const { status, code, ...patch } of cases) {
    const forged = operation(packed.record);
    Object.assign(forged.data._product.payload, patch);
    const result = await f.push([forged]);
    assert.equal(result.status, status, JSON.stringify(result.value));
    assert.equal(result.value.error.code, code);
    assert.equal(f.service.store.info().seq, before);
    assert.equal(receiptCount(f.dataDir, forged.operationId), 0);
    assert.equal(f.service.store.getEntity(f.entry.entityType, f.entry.entityId), null);
  }
  const valid = await f.push([operation(packed.record)]);
  assert.equal(valid.status, 200, JSON.stringify(valid.value));
  assert.equal(
    (await f.request('api/product/v1/library')).value.entries[0].title,
    'trusted-real-asset',
  );
});

test('store transaction hook rejects async work and rolls back the full batch before receipt persistence', async (t) => {
  await mkdir(root, { recursive: true });
  const dataDir = await mkdtemp(path.join(root, 'hook-'));
  const store = await openSyncStore({ dataDir });
  t.after(async () => {
    store.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  const first = {
    operationId: randomUUID(),
    entityType: 'conversation',
    entityId: 'hook-first',
    baseRevision: 0,
    command: 'create',
    data: { title: 'first' },
  };
  const second = { ...first, operationId: randomUUID(), entityId: 'hook-second' };
  const before = store.info().seq;
  assert.throws(
    () =>
      store.push('synthetic-hook-device', [first, second], {
        atomic: true,
        beforeApply(op) {
          if (op.entityId === second.entityId) return Promise.resolve();
        },
      }),
    { code: 'ASYNC_TRANSACTION_POLICY' },
  );
  assert.equal(store.info().seq, before);
  assert.equal(store.getEntity(first.entityType, first.entityId), null);
  assert.equal(store.getEntity(second.entityType, second.entityId), null);
  assert.equal(receiptCount(dataDir, first.operationId), 0);
  assert.equal(receiptCount(dataDir, second.operationId), 0);
  const accepted = store.push('synthetic-hook-device', [first], {
    atomic: true,
    beforeApply(op) {
      op.data.title = 'cannot-change-digest-bound-operation';
    },
  });
  assert.equal(accepted.results[0].entity.data.title, 'first');
  const replay = store.push('synthetic-hook-device', [first], {
    atomic: true,
    beforeApply() {
      throw new Error('REPLAY_MUST_NOT_RUN_POLICY');
    },
  });
  assert.deepEqual(replay.results, accepted.results);
});
