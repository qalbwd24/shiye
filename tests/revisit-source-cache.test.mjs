import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceLibrary } from './helpers/revisit-source-fixtures.mjs';
import { createSourceSessionCache } from '../src/server/domain/revisit/sources/session-cache.mjs';
import { createSourceReader } from '../src/server/domain/revisit/sources/catalog.mjs';
import { createLibrarySourcePort } from '../src/server/domain/revisit/sources/library-port.mjs';

const fresh = (db) => createSourceReader(createLibrarySourcePort(() => db)).capture();

test('unchanged source content survives whole-db cloning and per-instance state changes', () => {
  const cache = createSourceSessionCache({ read: fresh });
  const db = sourceLibrary(),
    first = cache.capture(db);
  const next = {
    ...structuredClone(db),
    revisitInstanceId: 'other-instance',
    revisit: { cursor: 'new', config: { ruleRevision: 9 }, comments: [] },
  };
  assert.equal(cache.capture(next), first);
  assert.deepEqual(cache.statistics().hits, 1);
  assert.equal(cache.statistics().builds, 1);
  assert.throws(() => {
    first.catalog.sources[0].entry.title = 'poison';
  }, TypeError);
});

for (const [name, change] of [
  [
    'body with unchanged timestamps',
    (db) => {
      db.entries[0].content += '<p>new</p>';
    },
  ],
  [
    'soft deletion with unchanged entry count',
    (db) => {
      db.entries[0].deleted = true;
    },
  ],
  [
    'hidden state',
    (db) => {
      db.entries[0].hidden = true;
    },
  ],
  [
    'draft state',
    (db) => {
      db.entries[0].draft = true;
    },
  ],
  [
    'taxonomy metadata',
    (db) => {
      db.entries[0].category = 'changed';
      db.entries[0].tags = ['changed'];
    },
  ],
  [
    'same-count media replacement',
    (db) => {
      db.media[0] = { ...db.media[0], name: 'replacement.png' };
    },
  ],
  [
    'canonical message state',
    (db) => {
      db.messageStore.units[0].state = 'withdrawn';
    },
  ],
  [
    'canonical layout metadata',
    (db) => {
      db.messageStore.layouts.changed = { revision: 2 };
    },
  ],
  [
    'room metadata',
    (db) => {
      db.chatJournal.rooms[0].title = 'changed';
    },
  ],
  [
    'global withdrawal receipt',
    (db) => {
      db.chatJournal.withdrawals.push({
        sourceId: 'synthetic-source',
        roomId: 'synthetic-room',
        messageId: '1',
      });
    },
  ],
  [
    'same-count entry replacement',
    (db) => {
      db.entries[0] = { ...db.entries[0], id: 'replacement' };
    },
  ],
]) {
  test(`source cache invalidates on ${name}`, () => {
    const cache = createSourceSessionCache({ read: fresh }),
      db = sourceLibrary();
    const before = cache.capture(db),
      retained = JSON.stringify(before.catalog);
    change(db);
    const current = cache.capture(db);
    assert.notEqual(current, before);
    assert.deepEqual(current.catalog, fresh(db).catalog);
    assert.equal(JSON.stringify(before.catalog), retained);
    assert.equal(cache.statistics().builds, 2);
  });
}

test('different libraries with equal counts and timestamps cannot share stale content', () => {
  const cache = createSourceSessionCache({ read: fresh });
  const a = sourceLibrary('library-a'),
    b = sourceLibrary('library-b');
  const first = cache.capture(a),
    second = cache.capture(b);
  assert.notEqual(second, first);
  assert.deepEqual(second.catalog, fresh(b).catalog);
  assert.notEqual(cache.capture(a), first); // One entry, previous snapshot evicted.
});

test('disabled/oversize caches retain nothing and preserve full reader behavior', () => {
  for (const maxBytes of [0, 128]) {
    const cache = createSourceSessionCache({ read: fresh, maxBytes }),
      db = sourceLibrary();
    const first = cache.capture(db),
      second = cache.capture(db);
    assert.notEqual(first, second);
    assert.deepEqual(first.catalog, second.catalog);
    assert.equal(cache.statistics().retainedBytes, 0);
    assert.equal(cache.statistics().builds, 2);
  }
});

test('a failed rebuild releases cached data and never returns the old snapshot', () => {
  let fail = false;
  const cache = createSourceSessionCache({
    read: (db) => {
      if (fail) throw Error('synthetic build failure');
      return fresh(db);
    },
  });
  const db = sourceLibrary();
  cache.capture(db);
  db.entries[0].content += '<p>changed</p>';
  fail = true;
  assert.throws(() => cache.capture(db), /build failure/);
  assert.equal(cache.statistics().retainedBytes, 0);
  fail = false;
  assert.deepEqual(cache.capture(db).catalog, fresh(db).catalog);
});
