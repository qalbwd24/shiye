import test from 'node:test';
import assert from 'node:assert/strict';
import {
  prepareSharedCommit,
  sharedSnapshot,
  sharedPull,
} from '../src/server/shared-sync/replication.mjs';

function baseline() {
  const db = {
    entries: [
      {
        id: 'diary',
        title: '正文',
        content: '原稿',
        history: [{ content: '历史' }],
        unknown: { a: 1, b: ['future'] },
      },
    ],
    messageStore: {
      units: [
        {
          id: 'unit',
          origin: { kind: 'diary', entryId: 'diary' },
          body: { text: '单元' },
          state: 'active',
        },
      ],
      layouts: { diary: { unitIds: ['unit'], future: { keep: true } } },
    },
  };
  prepareSharedCommit({}, db, { enabled: true });
  return db;
}
function commit(db, change = () => {}) {
  const next = structuredClone(db);
  change(next);
  prepareSharedCommit(db, next);
  return next;
}
const diary = (db) => sharedSnapshot(db).entities.find((e) => e.entityType === 'entry');

test('exact no-op and reordered unknown keys preserve authoritative hash/revision across restart', () => {
  const db = baseline();
  const noop = commit(db);
  assert.deepEqual(noop._sharedSync, db._sharedSync);
  const reordered = commit(noop, (next) => {
    next.entries[0].unknown = { b: ['future'], a: 1 };
  });
  assert.deepEqual(reordered._sharedSync, db._sharedSync);
  const restarted = JSON.parse(JSON.stringify(reordered));
  assert.deepEqual(commit(restarted)._sharedSync, db._sharedSync);
  assert.deepEqual(diary(restarted).data.unknown, { b: ['future'], a: 1 });
});

test('fast comparison includes complete unknown/history/unit/layout projection, not only entry identity', () => {
  const db = baseline();
  for (const change of [
    (next) => {
      next.entries[0].unknown.b.push('new');
    },
    (next) => {
      next.entries[0].history[0].content = '历史修订';
    },
    (next) => {
      next.messageStore.units[0].body.text = '新单元';
    },
    (next) => {
      next.messageStore.layouts.diary.future.keep = false;
    },
  ]) {
    const next = commit(db, change);
    assert.equal(next._sharedSync.seq, db._sharedSync.seq + 1);
    assert.equal(diary(next).revision, diary(db).revision + 1);
    assert.notEqual(diary(next).sha256, diary(db).sha256);
    assert.equal(sharedPull(next, { after: db._sharedSync.seq }).changes.length, 1);
  }
});

test('withdrawal still scrubs old body/history and canonical unit body while preserving unchanged tombstones', () => {
  const db = baseline();
  const unitWithdrawn = commit(db, (next) => {
    next.messageStore.units[0].state = 'withdrawn';
    next.messageStore.units[0].body.text = 'WITHDRAWN_UNIT_SECRET';
  });
  assert.equal(diary(unitWithdrawn).canonical.units[0].body, null);
  assert.equal(
    JSON.stringify(sharedSnapshot(unitWithdrawn)).includes('WITHDRAWN_UNIT_SECRET'),
    false,
  );
  const removed = commit(unitWithdrawn, (next) => {
    next.entries[0].state = 'withdrawn';
    next.entries[0].content = 'WITHDRAWN_ENTRY_SECRET';
    next.entries[0].history.push({ content: 'WITHDRAWN_ENTRY_SECRET' });
  });
  assert.deepEqual(diary(removed).data, {});
  assert.equal(
    JSON.stringify(sharedPull(removed, { after: 0 })).includes('WITHDRAWN_ENTRY_SECRET'),
    false,
  );
  assert.deepEqual(commit(removed)._sharedSync, removed._sharedSync);
  assert.throws(
    () =>
      commit(removed, (next) => {
        delete next.entries[0].state;
      }),
    { code: 'SHARED_TOMBSTONE_FINAL' },
  );
});

test('unpublished next is never cached: later unknown fields are observed and invalid supplied index is rejected', () => {
  const db = baseline(),
    next = commit(db);
  next.entries[0].unknown.future = true;
  prepareSharedCommit(db, next);
  assert.equal(diary(next).data.unknown.future, true);
  const invalid = structuredClone(db);
  invalid._sharedSync.entities[0].sha256 = 'invalid';
  assert.throws(() => prepareSharedCommit(db, invalid), { code: 'SHARED_INDEX_INVALID' });
});

test('client preferences have distinct writable-scope identities with safe unknown values and strict persisted schema', () => {
  const db = baseline();
  const next = commit(db, (value) => {
    value.sharedClientPreferences = {
      version: 1,
      profiles: [
        {
          scope: 'shared:thoughts',
          revision: 1,
          values: { unknownFuture: { keep: true }, api_key: 'PRIVATE_SECRET' },
        },
        { scope: 'android:diary', revision: 2, values: { appearance: 'dark' } },
      ],
    };
  });
  const profiles = sharedPull(next, { after: db._sharedSync.seq }).changes;
  assert.equal(profiles.length, 2);
  assert.equal(
    profiles.every((row) => row.entityType === 'client-preferences'),
    true,
  );
  assert.deepEqual(profiles.find((row) => row.entityId === 'shared:thoughts').data.values, {
    unknownFuture: { keep: true },
  });
  assert.equal(JSON.stringify(sharedSnapshot(next)).includes('PRIVATE_SECRET'), false);
  for (const mutate of [
    (value) => {
      value.sharedClientPreferences.version = 2;
    },
    (value) => {
      value.sharedClientPreferences.profiles[0].scope = 'unknown:scope';
    },
    (value) => {
      value.sharedClientPreferences.profiles[0].revision = 0;
    },
    (value) => {
      value.sharedClientPreferences.profiles[0].values = [];
    },
    (value) => {
      value.sharedClientPreferences.profiles.push(
        structuredClone(value.sharedClientPreferences.profiles[0]),
      );
    },
  ])
    assert.throws(() => commit(next, mutate), { code: 'SHARED_PREFERENCES_SCHEMA' });
});

test('sticker collection shares original media reference, deletion tombstone and restoration without private fields', () => {
  const db = baseline();
  const collected = commit(db, (value) => {
    value.stickers = [
      {
        id: 'sticker-one',
        mediaId: 'original-media',
        deleted: false,
        name: '收藏',
        future: { keep: true },
        localPath: 'PRIVATE_PATH',
      },
    ];
  });
  const sticker = sharedSnapshot(collected).entities.find((row) => row.entityType === 'sticker');
  assert.equal(sticker.data.mediaId, 'original-media');
  assert.deepEqual(sticker.data.future, { keep: true });
  assert.equal(sticker.data.localPath, undefined);
  const deleted = commit(collected, (value) => {
    value.stickers[0].deleted = true;
  });
  const tombstone = sharedPull(deleted, { after: collected._sharedSync.seq }).changes[0];
  assert.equal(tombstone.state, 'deleted');
  assert.deepEqual(tombstone.data, {});
  const restored = commit(deleted, (value) => {
    value.stickers[0].deleted = false;
  });
  assert.equal(
    sharedSnapshot(restored).entities.find((row) => row.entityType === 'sticker').data.mediaId,
    'original-media',
  );
});
