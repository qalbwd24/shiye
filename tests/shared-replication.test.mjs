import test from 'node:test';
import assert from 'node:assert/strict';
import {
  prepareSharedCommit,
  sharedInfo,
  sharedSnapshot,
  sharedPull,
  clearSharedReadCache,
} from '../src/server/shared-sync/replication.mjs';

const sourceId = '12345678-1234-4567-8910-123456789012';
const fixture = () => ({
  entries: [
    {
      id: 'entry-one',
      title: '原稿',
      category: '日常',
      tags: ['标签'],
      history: [{ title: '旧稿', future: true }],
      unknown: { future: [null, false, '原值'] },
    },
  ],
  categories: ['日常'],
  tags: ['标签'],
  media: [
    {
      id: 'media-one',
      name: '原件.png',
      size: 3,
      sha256: 'a'.repeat(64),
      localPath: 'D:/private/original',
      originalPath: 'D:/private/source',
    },
  ],
  templates: [{ id: 'template-one', name: '模板', future: { keep: true } }],
  settings: {
    shortcuts: { key: 'Alt+T' },
    preferences: { theme: 'dark', dpi: 144 },
    api_key: 'NEVER_EXPORT_CREDENTIAL',
  },
  chatJournal: {
    version: 1,
    rooms: [{ sourceId, id: '-1', title: '会话', category: '日常', idleHours: 5 }],
  },
  futureRoot: { preserve: true },
});
function initialize(db = fixture()) {
  prepareSharedCommit({}, db, { enabled: true });
  return db;
}
function changed(db, mutate) {
  const next = structuredClone(db);
  mutate(next);
  prepareSharedCommit(db, next);
  return next;
}
const entry = (db) => sharedSnapshot(db).entities.find((item) => item.entityType === 'entry');

test('disabled commit is inert; initial baseline and JSON restart preserve stable library/epoch and raw unknown values', () => {
  const db = fixture(),
    before = structuredClone(db);
  assert.equal(prepareSharedCommit({}, db), null);
  assert.deepEqual(db, before);
  assert.deepEqual(sharedInfo(db), { enabled: false, version: 1 });
  initialize(db);
  assert.ok(sharedInfo(db).seq > 0);
  assert.match(sharedInfo(db).libraryId, /^[a-f0-9-]{36}$/);
  const restart = JSON.parse(JSON.stringify(db));
  assert.deepEqual(sharedInfo(restart), sharedInfo(db));
  assert.deepEqual(entry(restart).data, before.entries[0]);
  assert.deepEqual(restart.futureRoot, before.futureRoot);
  const indexBefore = structuredClone(restart._sharedSync);
  prepareSharedCommit(db, restart);
  assert.deepEqual(restart._sharedSync, indexBefore);
  assert.equal(JSON.stringify(restart._sharedSync).includes('原稿'), false);
  assert.equal(JSON.stringify(restart._sharedSync).includes('NEVER_EXPORT_CREDENTIAL'), false);
});

test('changing only one entry appends one event and increments only its authoritative entity revision', () => {
  const db = initialize(),
    before = sharedInfo(db).seq;
  const next = changed(db, (value) => {
    value.entries[0].title = '新稿';
  });
  const page = sharedPull(next, { after: before });
  assert.equal(page.changes.length, 1);
  assert.equal(page.changes[0].entityType, 'entry');
  assert.equal(page.changes[0].revision, entry(db).revision + 1);
  assert.equal(page.changes[0].data.title, '新稿');
  assert.equal(page.after, before + 1);
  assert.equal(page.changes[0].changeSeq, page.after);
  const oldOther = db._sharedSync.entities.filter((item) => item.entityType !== 'entry');
  assert.deepEqual(
    next._sharedSync.entities.filter((item) => item.entityType !== 'entry'),
    oldOther,
  );
});

test('snapshot paginates every stable key; pull advances by event seq even when an earlier event resolves a newer current entity', () => {
  const db = initialize(),
    rows = [];
  let afterKey;
  do {
    const page = sharedSnapshot(db, { afterKey, limit: 2 });
    rows.push(...page.entities);
    afterKey = page.hasMore ? page.afterKey : undefined;
    if (!page.hasMore) break;
  } while (afterKey !== undefined);
  assert.equal(rows.length, db._sharedSync.entities.length);
  assert.equal(
    new Set(rows.map((item) => JSON.stringify([item.entityType, item.entityId]))).size,
    rows.length,
  );
  const baseline = sharedInfo(db).seq;
  const a = changed(db, (value) => {
    value.entries[0].title = '版本A';
  });
  const b = changed(a, (value) => {
    value.settings.preferences.theme = 'light';
  });
  const c = changed(b, (value) => {
    value.entries[0].title = '版本C';
  });
  const first = sharedPull(c, { after: baseline, limit: 1 });
  assert.equal(first.changes[0].data.title, '版本C');
  assert.equal(first.changes[0].seq, baseline + 3);
  assert.equal(first.after, baseline + 1);
  assert.equal(first.hasMore, true);
  const second = sharedPull(c, { after: first.after, limit: 1 });
  assert.equal(second.changes[0].entityType, 'settings');
  assert.equal(second.changes[0].data.preferences.theme, 'light');
});

test('missing keys retain empty permanent tombstones; withdrawn content never enters snapshots, logs or later replays', () => {
  const db = initialize(),
    baseline = sharedInfo(db).seq;
  const removed = changed(db, (value) => {
    value.entries = [];
  });
  const tombstone = sharedPull(removed, { after: baseline }).changes.find(
    (item) => item.entityType === 'entry',
  );
  assert.equal(tombstone.state, 'deleted');
  assert.deepEqual(tombstone.data, {});
  const again = changed(removed, (value) => {
    value.settings.preferences.theme = 'light';
  });
  assert.deepEqual(entry(again).data, {});
  assert.equal(entry(again).revision, tombstone.revision);
  const withdrawnDb = changed(db, (value) => {
    value.entries[0].state = 'withdrawn';
    value.entries[0].content = 'WITHDRAWN_SECRET';
    value.entries[0].history.push({ body: 'WITHDRAWN_SECRET' });
  });
  assert.equal(entry(withdrawnDb).state, 'withdrawn');
  assert.deepEqual(entry(withdrawnDb).data, {});
  assert.equal(JSON.stringify(sharedSnapshot(withdrawnDb)).includes('WITHDRAWN_SECRET'), false);
  assert.equal(
    JSON.stringify(sharedPull(withdrawnDb, { after: 0 })).includes('WITHDRAWN_SECRET'),
    false,
  );
  assert.equal(JSON.stringify(withdrawnDb._sharedSync).includes('WITHDRAWN_SECRET'), false);
  assert.throws(
    () =>
      changed(withdrawnDb, (value) => {
        delete value.entries[0].state;
      }),
    { code: 'SHARED_TOMBSTONE_FINAL' },
  );
});

test('chat withdrawal sanitizes only returned projection copies; original next/history/unknown fields are never rewritten', () => {
  const db = fixture();
  db.entries[0].chatJournal = {
    sourceId,
    roomId: '-1',
    messages: [
      {
        id: '1',
        sentAt: '2026-10-19T00:00:00Z',
        text: 'WITHDRAWN_CHAT_BODY',
        withdrawn: true,
        unknownOldBody: 'WITHDRAWN_CHAT_BODY',
      },
      { id: '2', sentAt: '2026-10-19T00:00:01Z', text: 'active-message', attachments: [] },
    ],
  };
  db.entries[0].content = 'WITHDRAWN_CHAT_BODY';
  db.entries[0].history = [{ content: 'WITHDRAWN_CHAT_BODY' }];
  const before = structuredClone(db);
  initialize(db);
  const projection = entry(db).data;
  assert.equal(JSON.stringify(sharedSnapshot(db)).includes('WITHDRAWN_CHAT_BODY'), false);
  assert.equal(projection.chatJournal.messages[1].text, 'active-message');
  assert.deepEqual(projection.unknown, before.entries[0].unknown);
  const { _sharedSync: _index, ...business } = db;
  assert.deepEqual(business, before);
});

test('entry canonical stays on the envelope without inventing another writable message or comment entity', () => {
  const db = fixture();
  db.messageStore = {
    units: [
      {
        id: 'unit-one',
        origin: { kind: 'diary', entryId: 'entry-one' },
        state: 'active',
        body: { future: true },
      },
      {
        id: 'comment',
        origin: { kind: 'comment', entryId: 'entry-one' },
        body: { text: 'not-a-second-owner' },
      },
    ],
    layouts: { 'entry-one': { layout: { references: ['unit-one'] } } },
  };
  initialize(db);
  assert.deepEqual(entry(db).canonical, {
    units: [db.messageStore.units[0]],
    layout: db.messageStore.layouts['entry-one'],
  });
  assert.equal(
    sharedSnapshot(db).entities.some((item) => ['message', 'comment'].includes(item.entityType)),
    false,
  );
  assert.deepEqual(entry(db).data, db.entries[0]);
});

test('settings and programs expose public configuration while device data, credentials, receipts and runner state stay private', () => {
  const db = fixture();
  db.conversationServices = {
    version: 1,
    revision: 0,
    instances: [
      {
        id: 'program-one',
        providerId: 'external-program',
        name: 'AI',
        state: {
          config: {
            title: 'AI',
            parameters: { temperature: 0.7, client_secret: 'PRIVATE_PROGRAM' },
          },
          cursor: 'PRIVATE_CURSOR',
          lease: 'PRIVATE_LEASE',
          deliveries: ['PRIVATE_DELIVERY'],
        },
        creationKey: 'PRIVATE_RECEIPT',
      },
    ],
    bindings: [],
    settingsOperations: [],
  };
  // Keep this synthetic instance unbound so the normal directory does not need
  // provider-specific actor execution; the explicit service entity carries it.
  initialize(db);
  const output = JSON.stringify(sharedSnapshot(db));
  for (const secret of [
    'NEVER_EXPORT_CREDENTIAL',
    'PRIVATE_PROGRAM',
    'PRIVATE_CURSOR',
    'PRIVATE_LEASE',
    'PRIVATE_DELIVERY',
    'PRIVATE_RECEIPT',
    'D:/private',
  ])
    assert.equal(output.includes(secret), false);
  const settings = sharedSnapshot(db).entities.find((item) => item.entityType === 'settings');
  assert.equal(settings.data.shortcuts.key, 'Alt+T');
  assert.equal(settings.data.preferences.dpi, undefined);
  const service = sharedSnapshot(db).entities.find((item) => item.entityType === 'service');
  assert.equal(service.data.config.parameters.temperature, 0.7);
});

test('invalid index structures and identity removal are rejected rather than silently rebuilt', () => {
  const db = initialize();
  for (const mutate of [
    (value) => {
      value._sharedSync.version = 2;
    },
    (value) => {
      value._sharedSync.seq++;
    },
    (value) => {
      value._sharedSync.entities[0].revision = 0;
    },
    (value) => {
      value._sharedSync.changes[0].data = { mustNotStoreBody: true };
    },
    (value) => {
      value._sharedSync.entities.push(structuredClone(value._sharedSync.entities[0]));
    },
  ]) {
    const broken = structuredClone(db);
    mutate(broken);
    assert.throws(() => sharedInfo(broken), { code: 'SHARED_INDEX_INVALID' });
    assert.throws(() => prepareSharedCommit(broken, structuredClone(broken)), {
      code: 'SHARED_INDEX_INVALID',
    });
  }
  const missing = structuredClone(db);
  delete missing._sharedSync;
  assert.throws(() => prepareSharedCommit(db, missing), { code: 'SHARED_INDEX_REMOVED' });
  const swapped = structuredClone(db);
  swapped._sharedSync.libraryId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  assert.throws(() => prepareSharedCommit(db, swapped), {
    code: 'SHARED_INDEX_CHANGED_OUTSIDE_COMMIT',
  });
  assert.throws(() => sharedPull(db, { after: sharedInfo(db).seq + 1 }), {
    code: 'SHARED_INVALID_CURSOR',
  });
});

test('bounded pointer log compacts at 50000 and demands resnapshot for an expired cursor', () => {
  const db = initialize(),
    target = db._sharedSync.entities.find((item) => item.entityType === 'entry');
  const initialSeq = db._sharedSync.seq;
  for (let seq = initialSeq + 1; seq <= 50000; seq++)
    db._sharedSync.changes.push({ seq, entityType: target.entityType, entityId: target.entityId });
  target.revision += 50000 - initialSeq;
  target.seq = 50000;
  db._sharedSync.seq = 50000;
  const next = changed(db, (value) => {
    value.entries[0].title = 'after-compaction';
  });
  assert.equal(next._sharedSync.changes.length, 50000);
  assert.equal(next._sharedSync.earliestSeq, 1);
  assert.throws(() => sharedPull(next, { after: 0 }), { code: 'SHARED_RESNAPSHOT_REQUIRED' });
  assert.equal(sharedPull(next, { after: 1, limit: 1 }).after, 2);
  assert.equal(JSON.stringify(next._sharedSync).includes('after-compaction'), false);
});

test('a failed owner transaction discards both staged business and staged index; readers detect out-of-band writes', () => {
  const durable = initialize(),
    before = structuredClone(durable);
  assert.throws(() => {
    const staged = structuredClone(durable);
    staged.entries[0].title = 'uncommitted';
    prepareSharedCommit(durable, staged);
    throw new Error('SIMULATED_OWNER_WRITE_FAILURE');
  }, /SIMULATED_OWNER_WRITE_FAILURE/);
  assert.deepEqual(durable, before);
  const unindexed = structuredClone(durable);
  unindexed.entries[0].title = 'out-of-band';
  assert.throws(() => sharedSnapshot(unindexed), { code: 'SHARED_INDEX_OUT_OF_DATE' });
});

test('immutable copy-on-write readers reuse one flattened generation; deliberate in-place tools explicitly invalidate cache', () => {
  const db = initialize();
  const entries = db.entries;
  let reads = 0;
  Object.defineProperty(db, 'entries', {
    enumerable: true,
    configurable: true,
    get() {
      reads++;
      return entries;
    },
  });
  const first = sharedSnapshot(db, { limit: 1 });
  const afterFirstRead = reads;
  assert.ok(afterFirstRead > 0);
  sharedSnapshot(db, { afterKey: first.afterKey, limit: 1 });
  sharedPull(db, { after: 0, limit: 1 });
  sharedInfo(db);
  assert.equal(reads, afterFirstRead);
  // Returned values are isolated from the cached generation.
  const returned = sharedSnapshot(db).entities.find((item) => item.entityType === 'entry');
  returned.data.title = 'caller-cannot-change-cache';
  assert.equal(entry(db).data.title, '原稿');
  entries[0].title = 'deliberate-tool-edit';
  clearSharedReadCache(db);
  assert.throws(() => sharedSnapshot(db), { code: 'SHARED_INDEX_OUT_OF_DATE' });
});
