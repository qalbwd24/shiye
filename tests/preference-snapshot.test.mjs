import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { productLibraryView, validateProductRecord } from '../public/shared/sync-product.js';
import {
  compilePreferenceSnapshot,
  PREFERENCE_SNAPSHOT_LIMITS,
} from '../src/server/sync-product/preference-snapshot.mjs';

const namespace = 'shiye.android.diary.presentation.v2';
const snapshot = (values = {}) => ({
  format: 'shiye-client-preferences',
  version: 1,
  sourceId: 'desktop:stable-source',
  revision: 1,
  namespaces: { [namespace]: values },
});

test('full namespace and future keys round-trip through existing product profile projection', () => {
  const input = snapshot({
    defaultTitle: { mode: 'time', future: ['x', null, { enabled: false }] },
    toolbar: ['save', 'future-command'],
    imageWidth: 0.4,
    entryOverrides: { stableEntry: { hiddenHint: true } },
  });
  const before = structuredClone(input);
  const plan = compilePreferenceSnapshot(input);
  assert.deepEqual(input, before);
  assert.equal(plan.schema, 1);
  assert.equal(plan.snapshotKind, 'preferences');
  assert.equal(plan.snapshotRevision, 1);
  assert.deepEqual(plan.issues, []);
  assert.equal(plan.records[0].revision, undefined);
  assert.equal(plan.records[0].data._product.readOnlyProjection, true);
  assert.equal(
    validateProductRecord(
      plan.records[0].entityType,
      plan.records[0].entityId,
      plan.records[0].data,
    ),
    true,
  );
  const wire = JSON.parse(JSON.stringify(plan.records));
  assert.deepEqual(productLibraryView(wire).profiles[0].values, input.namespaces[namespace]);
  assert.equal(plan.coverage.completeComputerExport, false);
  assert.equal(plan.coverage.automaticApplication, false);
});

test('declared desktop and unknown namespaces remain separate, complete read-only values', () => {
  const input = snapshot();
  input.namespaces = {
    'shiye.desktop.application.preferences.v1': { shortcuts: { key: 'Alt+T' }, future: 0 },
    'vendor.future.preferences.v7': { opaque: { nested: [1, true, 'preserved'] } },
  };
  const plan = compilePreferenceSnapshot(input);
  assert.equal(plan.records.length, 2);
  for (const record of plan.records) {
    assert.deepEqual(record.data.values, input.namespaces[record.data.namespace]);
    assert.equal(record.data._product.readOnlyProjection, true);
  }
  assert.equal(plan.coverage.fields[1].declaration, 'unknown-read-only');
  assert.equal(
    plan.coverage.fields.every((field) => field.automaticApplication === false),
    true,
  );
});

test('known secrets, device fields and URL credentials use the shared configuration filter', () => {
  const input = snapshot({
    api_key: 'PRIVATE_KEY',
    windowPosition: { x: 42 },
    future: { client_secret: 'PRIVATE_SECRET', retained: [null, false] },
    endpoint: 'https://owner:PRIVATE_PASS@example.invalid/?token=PRIVATE_TOKEN&mode=pull',
  });
  const plan = compilePreferenceSnapshot(input);
  assert.deepEqual(plan.records[0].data.values, {
    endpoint: 'https://example.invalid/?mode=pull',
    future: { retained: [null, false] },
  });
  assert.equal(plan.coverage.excluded.length, 5);
  assert.equal(JSON.stringify(plan).includes('PRIVATE_'), false);
  assert.equal(
    plan.coverage.credentialFiltering,
    'known-configuration-field-names-and-http-url-components-only',
  );
});

test('source hash is canonical and record identity is stable across revisions, isolated across sources/namespaces', () => {
  const first = snapshot({ z: 1, nested: { b: 2, a: 3 } });
  const reordered = {
    namespaces: { [namespace]: { nested: { a: 3, b: 2 }, z: 1 } },
    revision: 1,
    sourceId: first.sourceId,
    version: 1,
    format: first.format,
  };
  const a = compilePreferenceSnapshot(first),
    b = compilePreferenceSnapshot(reordered);
  assert.deepEqual(a, b);
  assert.equal(a.records[0].data.sourceSha256, a.sourceSha256);
  const expected = createHash('sha256')
    .update(JSON.stringify([first.sourceId, namespace]))
    .digest('hex');
  assert.equal(a.records[0].entityId, `profile:preferences:${expected}`);
  const changedRevision = compilePreferenceSnapshot({ ...first, revision: 2 });
  assert.equal(changedRevision.records[0].entityId, a.records[0].entityId);
  assert.notEqual(changedRevision.sourceSha256, a.sourceSha256);
  const changedSource = compilePreferenceSnapshot({ ...first, sourceId: 'android:other-source' });
  assert.notEqual(changedSource.records[0].entityId, a.records[0].entityId);
  const changedNamespace = compilePreferenceSnapshot({
    ...first,
    namespaces: { 'vendor.other.v1': {} },
  });
  assert.notEqual(changedNamespace.records[0].entityId, a.records[0].entityId);
});

test('source hashing binds original filtered values without transporting those values', () => {
  const a = compilePreferenceSnapshot(snapshot({ token: 'FIRST_PRIVATE', retained: 1 }));
  const b = compilePreferenceSnapshot(snapshot({ token: 'SECOND_PRIVATE', retained: 1 }));
  assert.deepEqual(a.records[0].data.values, b.records[0].data.values);
  assert.notEqual(a.sourceSha256, b.sourceSha256);
  assert.equal(JSON.stringify([a, b]).includes('_PRIVATE'), false);
});

test('invalid format, identity, revision and namespace declarations are rejected', () => {
  const cases = [
    [{ ...snapshot(), format: 'other' }, 'INVALID_PREFERENCE_SNAPSHOT_FORMAT'],
    [{ ...snapshot(), version: 2 }, 'INVALID_PREFERENCE_SNAPSHOT_FORMAT'],
    [{ ...snapshot(), complete: true }, 'UNKNOWN_PREFERENCE_SNAPSHOT_FIELD'],
    [{ ...snapshot(), sourceId: 'unsafe/source' }, 'INVALID_PREFERENCE_SOURCE_ID'],
    [{ ...snapshot(), revision: 0 }, 'INVALID_PREFERENCE_SNAPSHOT_REVISION'],
    [
      { ...snapshot(), revision: Number.MAX_SAFE_INTEGER + 1 },
      'INVALID_PREFERENCE_SNAPSHOT_REVISION',
    ],
    [{ ...snapshot(), namespaces: {} }, 'PREFERENCE_NAMESPACES_REQUIRED'],
    [{ ...snapshot(), namespaces: { '../unsafe': {} } }, 'INVALID_PREFERENCE_NAMESPACE'],
    [{ ...snapshot(), namespaces: { valid: null } }, 'PREFERENCE_NAMESPACE_OBJECT_REQUIRED'],
  ];
  for (const [input, code] of cases)
    assert.throws(() => compilePreferenceSnapshot(input), { code });
});

test('entry image width array namespace preserves exact type, stable IDs, order and unknown keys', () => {
  const value = Array.from({ length: 100 }, (_, i) => ({
    id: `entry-${i}`,
    width: 40,
    future: { retained: true },
  }));
  const input = {
    ...snapshot(),
    namespaces: {
      'shiye.android.diary.entry-image-width.v1': value,
      'vendor.future.sidecar.v1': [],
    },
  };
  const before = structuredClone(input);
  const plan = compilePreferenceSnapshot(input);
  const record = plan.records.find(
    (r) => r.data.namespace === 'shiye.android.diary.entry-image-width.v1',
  );
  assert.deepEqual(record.data.values, value);
  assert.deepEqual(
    plan.records.find((r) => r.data.namespace === 'vendor.future.sidecar.v1').data.values,
    [],
  );
  assert.equal(
    plan.coverage.fields.find((f) => f.path.endsWith('entry-image-width.v1')).sourceFieldCount,
    100,
  );
  assert.deepEqual(input, before);
});

test('JSON validator rejects silent data loss, class instances and cycles without executing getters', () => {
  let executed = false;
  const accessor = {
    get unsafe() {
      executed = true;
      return 'private';
    },
  };
  const cyclic = {};
  cyclic.self = cyclic;
  const sparse = [];
  sparse.length = 1;
  for (const value of [
    undefined,
    Infinity,
    NaN,
    BigInt(1),
    new Date(),
    new Uint8Array(1),
    accessor,
    cyclic,
    sparse,
    { [Symbol('hidden')]: true },
  ]) {
    assert.throws(() => compilePreferenceSnapshot(snapshot({ value })), {
      code: 'PREFERENCE_SNAPSHOT_NOT_JSON',
    });
  }
  assert.equal(executed, false);
  const proto = JSON.parse('{"__proto__":{"kept":true},"constructor":{"future":1}}');
  const plan = compilePreferenceSnapshot(snapshot(proto));
  assert.deepEqual(plan.records[0].data.values, proto);
  assert.equal(Object.getPrototypeOf(plan.records[0].data.values), Object.prototype);
});

test('enforced namespace, total bytes, depth and final record limits reject whole plans', () => {
  const many = Object.fromEntries(
    Array.from({ length: PREFERENCE_SNAPSHOT_LIMITS.namespaces + 1 }, (_, index) => [
      `vendor.p${index}`,
      {},
    ]),
  );
  assert.throws(() => compilePreferenceSnapshot({ ...snapshot(), namespaces: many }), {
    code: 'PREFERENCE_SNAPSHOT_TOO_LARGE',
  });
  assert.throws(
    () =>
      compilePreferenceSnapshot(snapshot({ value: 'x'.repeat(PREFERENCE_SNAPSHOT_LIMITS.bytes) })),
    { code: 'PREFERENCE_SNAPSHOT_TOO_LARGE' },
  );
  assert.throws(
    () =>
      compilePreferenceSnapshot(
        snapshot({ value: 'x'.repeat(PREFERENCE_SNAPSHOT_LIMITS.recordBytes) }),
      ),
    { code: 'PREFERENCE_RECORD_TOO_LARGE' },
  );
  let deep = {};
  for (let index = 0; index < PREFERENCE_SNAPSHOT_LIMITS.depth; index++) deep = { deep };
  assert.throws(() => compilePreferenceSnapshot(snapshot(deep)), {
    code: 'PREFERENCE_SNAPSHOT_TOO_LARGE',
  });
});
