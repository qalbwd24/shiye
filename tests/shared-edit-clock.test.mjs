import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEditClock,
  compareEditStamps,
  planEditMerge,
} from '../public/shared/shared-edit-clock.js';

const clock = (deviceId, time, state) =>
  createEditClock({
    deviceId,
    state,
    now: () => time.value,
    newId: (() => {
      let index = 0;
      return () => `${deviceId}-${++index}`;
    })(),
  });
const edit = (source, entityType, entityId, fieldPath, value, options = {}) =>
  source.issue({ entityType, entityId, fieldPath, value, baseRevision: '7', ...options });

test('clock survives offline reopen and an ACK retry preserves the original edit time', () => {
  const time = { value: Date.parse('2026-10-19T00:00:01.000Z') };
  const first = clock('desktop', time);
  const sentAt = '2020-01-01T02:03:04.000Z';
  const op = edit(first, 'message', '20-digit-id', 'content', { text: 'new' }, { sentAt });
  const durable = JSON.parse(JSON.stringify({ clock: first.snapshot(), outbox: op }));
  time.value -= 1000;
  const reopened = clock('desktop', time, durable.clock);
  const originalIntent = {
    entityType: 'message',
    entityId: '20-digit-id',
    fieldPath: 'content',
    value: { text: 'new' },
    baseRevision: '7',
    sentAt,
    operationId: op.operationId,
  };
  assert.deepEqual(reopened.issue({ ...originalIntent, retryOp: durable.outbox }), op);
  assert.throws(
    () =>
      reopened.issue({ ...originalIntent, value: { text: 'changed' }, retryOp: durable.outbox }),
    /retry intent/,
  );
  assert.throws(
    () => reopened.issue({ ...originalIntent, entityId: 'other', retryOp: durable.outbox }),
    /retry intent/,
  );
  assert.equal(op.sentAt, sentAt);
  assert.equal(op.editedAt, '2026-10-19T00:00:01.000Z');
  assert.ok(
    compareEditStamps(
      reopened.issue({
        entityType: 'message',
        entityId: '20-digit-id',
        fieldPath: 'content',
        value: { text: 'later' },
      }).stamp,
      op.stamp,
    ) > 0,
  );
  assert.throws(() => clock('android', time, durable.clock), /another device/);
});

test('async ACK inversion and clock rollback do not change later edit ordering', () => {
  const aTime = { value: 1000 },
    bTime = { value: 1000 };
  const a = clock('desktop', aTime),
    b = clock('android', bTime);
  const old = edit(a, 'message', 'm', 'content', { text: 'old' });
  b.observe(old.stamp);
  bTime.value = 999;
  const later = edit(
    b,
    'message',
    'm',
    'content',
    { text: 'later' },
    { parentOpId: old.operationId },
  );
  const ackArrival = [later, old];
  const plan = planEditMerge({ left: ackArrival[0], right: ackArrival[1] });
  assert.equal(plan.winner.operationId, later.operationId);
  assert.equal(plan.reason, 'causal-successor');
  assert.equal(plan.recoverableRevisions.length, 2);
  assert.ok(compareEditStamps(later.stamp, old.stamp) > 0);
});

test('concurrent message edits take the later HLC edit and keep the older revision', () => {
  const a = clock('desktop', { value: 5000 });
  const b = clock('android', { value: 5001 });
  const left = edit(a, 'message', 'm', 'content', { text: 'one' });
  const right = edit(b, 'message', 'm', 'content', { text: 'two' });
  const plan = planEditMerge({ left, right });
  assert.equal(plan.decision, 'apply-right');
  assert.deepEqual(plan.recoverableRevisions, [left, right]);
  assert.equal(plan.reason, 'concurrent-later-edit');
});

test('same millisecond edits have deterministic logical/device/operation tie ordering', () => {
  const a = clock('a', { value: 8000 }),
    b = clock('b', { value: 8000 });
  const a1 = edit(a, 'message', 'm', 'content', 'a1');
  const a2 = edit(a, 'message', 'm', 'content', 'a2');
  const b1 = edit(b, 'message', 'm', 'content', 'b1');
  assert.ok(compareEditStamps(a2.stamp, a1.stamp) > 0);
  assert.ok(compareEditStamps(b1.stamp, a1.stamp) > 0);
  assert.equal(planEditMerge({ left: b1, right: a1 }).winner.operationId, b1.operationId);
});

test('withdrawal remains terminal against delayed edits regardless of receive order', () => {
  const a = clock('desktop', { value: 9000 }),
    b = clock('android', { value: 9500 });
  const withdrawal = a.issue({
    entityType: 'message',
    entityId: 'm',
    fieldPath: 'content',
    action: 'withdraw',
    baseRevision: '7',
  });
  const lateEdit = edit(b, 'message', 'm', 'content', 'late');
  for (const [left, right] of [
    [lateEdit, withdrawal],
    [withdrawal, lateEdit],
  ]) {
    const plan = planEditMerge({ left, right });
    assert.equal(plan.decision, 'withdrawn');
    assert.equal(plan.winner.operationId, withdrawal.operationId);
  }
});

test('only concurrent edits to the same diary body scope become two variants', () => {
  const a = clock('desktop', { value: 10000 }),
    b = clock('android', { value: 11000 });
  const bodyA = edit(a, 'diary', 'entry', 'body', { text: 'left' });
  const bodyB = edit(b, 'diary', 'entry', 'body', { text: 'right' });
  assert.equal(planEditMerge({ left: bodyA, right: bodyB }).decision, 'variants');
  const title = edit(b, 'diary', 'entry', 'title', 'new title');
  assert.equal(planEditMerge({ left: bodyA, right: title }).decision, 'apply-both');
  const unitA = edit(a, 'diary', 'entry', 'body/unit:p1', 'paragraph one');
  const unitB = edit(b, 'diary', 'entry', 'body/unit:p2', 'paragraph two');
  assert.equal(planEditMerge({ left: unitA, right: unitB }).decision, 'apply-both');
  assert.equal(planEditMerge({ left: bodyA, right: unitA }).decision, 'unresolved');
  const afterBody = edit(
    b,
    'diary',
    'entry',
    'body',
    { text: 'acknowledged successor' },
    { parentOpId: bodyA.operationId },
  );
  assert.equal(
    planEditMerge({ left: bodyA, right: afterBody }).winner.operationId,
    afterBody.operationId,
  );
});

test('unstamped old edits never borrow sentAt as editedAt or guess a winner', () => {
  const old1 = {
    entityType: 'message',
    entityId: 'm',
    fieldPath: 'content',
    operationId: 'old-1',
    action: 'edit',
    sentAt: '2020-01-01T00:00:00Z',
    value: 'a',
  };
  const old2 = { ...old1, operationId: 'old-2', sentAt: '2022-01-01T00:00:00Z', value: 'b' };
  assert.equal(planEditMerge({ left: old1, right: old2 }).decision, 'unresolved');
  assert.equal(
    planEditMerge({
      left: { ...old1, entityType: 'diary', fieldPath: 'body' },
      right: { ...old2, entityType: 'diary', fieldPath: 'body' },
    }).decision,
    'unresolved',
  );
});

test('revision proof, parent history, duplicate retries, and operation collision', () => {
  const a = clock('desktop', { value: 12000 });
  const first = edit(a, 'diary', 'entry', 'body', 'one', { resultRevision: '8' });
  const after = edit(a, 'diary', 'entry', 'body', 'two', { baseRevision: '8' });
  assert.equal(planEditMerge({ left: first, right: after }).decision, 'unresolved');
  assert.equal(
    planEditMerge({
      left: first,
      right: after,
      verifiedRevisionEdges: [
        { ancestorOpId: first.operationId, descendantOpId: after.operationId },
      ],
    }).decision,
    'apply-right',
  );
  assert.equal(
    planEditMerge({ left: first, right: JSON.parse(JSON.stringify(first)) }).decision,
    'same',
  );
  assert.throws(
    () => planEditMerge({ left: first, right: { ...first, value: 'corrupt' } }),
    /collision/,
  );
  assert.throws(
    () => a.issue({ entityType: 'message', entityId: 'm', fieldPath: 'content', value: 3n }),
    /JSON/,
  );
});

test('foreign history and duplicate operation identities cannot forge diary ancestry', () => {
  const a = clock('a', { value: 1000 });
  const b = clock('b', { value: 2000 });
  const left = edit(a, 'diary', 'entry-one', 'body', 'left', { operationId: 'left' });
  const right = edit(b, 'diary', 'entry-one', 'body', 'right', {
    operationId: 'right',
    parentOpId: 'bridge',
  });
  const foreign = edit(a, 'diary', 'entry-two', 'body', 'foreign', {
    operationId: 'bridge',
    parentOpId: 'left',
  });
  assert.throws(() => planEditMerge({ left, right, history: [foreign] }), /history.*scope|entity/);
  const wrongField = { ...foreign, entityId: 'entry-one', fieldPath: 'title' };
  assert.throws(
    () => planEditMerge({ left, right, history: [wrongField] }),
    /history.*scope|field/,
  );
  const sameScope = { ...foreign, entityId: 'entry-one' };
  assert.equal(planEditMerge({ left, right, history: [sameScope] }).decision, 'apply-right');
  assert.throws(
    () => planEditMerge({ left, right, history: [sameScope, { ...sameScope, value: 'changed' }] }),
    /collision/,
  );
  assert.throws(
    () => planEditMerge({ left, right, history: [{ ...sameScope, parentOpId: 'bridge' }] }),
    /cyclic history/,
  );
});

test('withdrawal planner returns only a body-free tombstone and no persistent revisions', () => {
  const a = clock('a', { value: 1000 });
  const b = clock('b', { value: 2000 });
  const oldBody = edit(a, 'message', 'm', 'content', { secret: 'private-text' });
  const withdraw = b.issue({
    entityType: 'message',
    entityId: 'm',
    fieldPath: 'content',
    action: 'withdraw',
    operationId: 'withdraw',
    baseRevision: '7',
  });
  const plan = planEditMerge({ left: oldBody, right: withdraw });
  assert.equal(plan.decision, 'withdrawn');
  assert.equal(plan.winner.operationId, 'withdraw');
  assert.deepEqual(plan.variants, []);
  assert.deepEqual(plan.recoverableRevisions, []);
  assert.ok(!JSON.stringify(plan).includes('private-text'));
  assert.ok(!Object.hasOwn(plan.winner, 'value'));
  const contaminated = {
    ...withdraw,
    value: { secret: 'private-text' },
    unknown: { nestedBody: 'private-text' },
  };
  const replay = planEditMerge({ left: contaminated, right: structuredClone(contaminated) });
  assert.equal(replay.decision, 'same');
  assert.deepEqual(replay.variants, []);
  assert.deepEqual(replay.recoverableRevisions, []);
  assert.ok(!JSON.stringify(replay).includes('private-text'));
  assert.throws(
    () => planEditMerge({ left: contaminated, right: { ...contaminated, value: { secret: 'different' } } }),
    /collision/,
  );
});
