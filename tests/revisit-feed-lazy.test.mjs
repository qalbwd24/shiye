import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deliveryLibrary } from './helpers/revisit-delivery-fixtures.mjs';
import { revisitFeed } from '../src/server/domain/revisit/delivery/query.mjs';
import { emptyRevisitState } from '../src/server/domain/revisit/delivery/state.mjs';

function fixture() {
  const db = deliveryLibrary(1);
  db.revisit = emptyRevisitState();
  db.revisit.deliveries = db.messageStore.units.map((unit, index) => ({
    id: `delivery-${index}`,
    sequence: index + 1,
    batchId: 'batch-one',
    ref: { entryId: db.entries[0].id, unitId: unit.id },
  }));
  db.revisit.batches = [{ id: 'batch-one' }, { id: 'unrelated-batch' }];
  return db;
}

function observeCapture(db, forbid = false) {
  let captures = 0;
  const media = db.media;
  Object.defineProperty(db, 'media', {
    get() {
      captures++;
      assert.equal(forbid, false, 'empty feed must not capture the source library');
      return media;
    },
  });
  return () => captures;
}

for (const kind of ['no-state', 'no-deliveries', 'caught-up', 'empty-page', 'superseded']) {
  test(`feed avoids source capture: ${kind}`, () => {
    const db = fixture();
    const input = {};
    if (kind === 'no-state') delete db.revisit;
    if (kind === 'no-deliveries') db.revisit.deliveries = [];
    if (kind === 'caught-up') input.after = 2;
    // The domain helper accepts zero; the HTTP route still validates its public limit.
    if (kind === 'empty-page') input.limit = 0;
    if (kind === 'superseded')
      for (const item of db.revisit.deliveries) item.paragraphReplacements = ['replacement'];
    const captures = observeCapture(db, true);
    const result = revisitFeed(db, input);
    assert.equal(captures(), 0);
    assert.equal(result.total, db.revisit?.deliveries.length || 0);
    assert.equal(result.next, kind === 'superseded' || kind === 'caught-up' ? 2 : 0);
    assert.deepEqual(result.batches, kind === 'superseded' ? [{ id: 'batch-one' }] : []);
    assert.equal(result.config.version, 1);
    if (kind === 'superseded')
      for (const item of result.deliveries) {
        assert.equal(item.superseded, true);
        assert.deepEqual(item.source, { available: false, media: [] });
      }
    else assert.deepEqual(result.deliveries, []);
  });
}

test('ordinary and mixed pages capture once and keep source resolution and pagination', () => {
  for (const mixed of [false, true]) {
    const db = fixture();
    if (mixed) db.revisit.deliveries[0].paragraphReplacements = ['replacement'];
    const captures = observeCapture(db);
    const result = revisitFeed(db, { limit: 2 });
    assert.equal(captures(), 1);
    assert.equal(result.deliveries.length, 2);
    assert.equal(result.deliveries[1].source.available, true);
    assert.match(result.deliveries[1].source.markdown, /合成第0天第55秒/);
    assert.equal(result.deliveries[0].source.available, !mixed);
    assert.equal(result.next, 2);
    assert.equal(result.total, 2);
    assert.deepEqual(result.batches, [{ id: 'batch-one' }]);
    result.config.title = 'detached';
    assert.notEqual(db.revisit.config.title, 'detached');
  }
});

test('source-bearing deliveries beyond the requested page do not trigger capture', () => {
  const db = fixture();
  db.revisit.deliveries[0].paragraphReplacements = ['replacement'];
  const captures = observeCapture(db, true);
  const result = revisitFeed(db, { limit: 1 });
  assert.equal(captures(), 0);
  assert.equal(result.deliveries.length, 1);
  assert.equal(result.deliveries[0].superseded, true);
  assert.equal(result.next, 1);
  assert.equal(result.total, 2);
});

test('missing, hidden, deleted and stale source references stay unavailable', () => {
  for (const kind of ['missing', 'hidden', 'deleted', 'stale']) {
    const db = fixture();
    if (kind === 'missing') db.entries = [];
    if (kind === 'hidden') db.entries[0].hidden = true;
    if (kind === 'deleted') db.entries[0].deleted = true;
    if (kind === 'stale') db.revisit.deliveries[0].ref.snapshot = 'stale-source-snapshot';
    const captures = observeCapture(db);
    const result = revisitFeed(db, { limit: 1 });
    assert.equal(captures(), 1);
    assert.equal(result.deliveries[0].source.available, false, kind);
    assert.equal(result.next, 1);
    assert.equal(result.total, 2);
  }
});
