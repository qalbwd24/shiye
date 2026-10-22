import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { createIndexedDbSyncStorage } from '../public/shared/sync-v2-client.js';
import {
  diaryDayKey,
  diaryStreak,
  diarySuggestedTitle,
  diaryTitleFromEntity,
} from '../public/shared/shared-diary-index.js';

const root = new URL(
  '../outputs/2026-10-19-android-shared-import-ui/diary-adapter-audit/reference-fixtures/',
  import.meta.url,
);
const inputs = JSON.parse(readFileSync(new URL('inputs.json', root)));
const golden = new Map(
  JSON.parse(readFileSync(new URL('golden.json', root))).map((row) => [row.name, row.result]),
);
const record = (data) => ({
  entityType: 'entry',
  entityId: data.id,
  localRevision: 1,
  local: { state: 'active', data },
  base: { revision: 1 },
});
const makeStore = async (entries) => {
  const indexedDB = new IDBFactory();
  const owner = { libraryId: randomUUID(), epoch: randomUUID() };
  const dbName = `shiye-sync-v2-shared-golden-${randomUUID()}`;
  const storage = createIndexedDbSyncStorage({ indexedDB, dbName, diaryIndex: true });
  await storage.transaction(async (tx) => {
    await tx.setMeta({ sharedBusiness: 1, ...owner });
    for (const row of entries) await tx.putEntity(record(row));
  });
  return { storage, owner };
};

test('actual Java golden day, query order/search/calendar, streak and neighbor', async () => {
  const priorGetAll = IDBObjectStore.prototype.getAll;
  IDBObjectStore.prototype.getAll = function (...args) {
    if (this.name === 'entities') throw new Error('entities.getAll-forbidden');
    return priorGetAll.apply(this, args);
  };
  try {
    for (const item of inputs) {
      const expected = golden.get(item.name);
      if (item.kind === 'day') {
        assert.equal(diaryDayKey(item.raw, item.zone), expected.day, item.name);
      } else if (item.kind === 'streak') {
        assert.equal(diaryStreak(item.dates, item.today), expected.streak, item.name);
      } else if (item.kind === 'query') {
        const { storage, owner } = await makeStore(item.catalog.entries);
        const options = {
          ...owner,
          query: item.query,
          categoryId: item.category,
          timeZone: item.zone,
        };
        try {
          const page = await storage.readDiaryPage(options);
          assert.deepEqual(
            page.items.map((row) => row.id),
            expected.ids,
            item.name,
          );
          assert.equal(page.sort, 'product-created-v1');
          const calendar = await storage.readDiarySummary({ ...options, kind: 'calendar' });
          assert.deepEqual(calendar.value, expected.calendar, `${item.name}:calendar`);
          const count = await storage.readDiarySummary({ ...options, kind: 'count' });
          assert.equal(count.value, expected.ids.length, `${item.name}:count`);
        } finally {
          await storage.close();
        }
      } else if (item.kind === 'neighbor') {
        const { storage, owner } = await makeStore(item.entries);
        try {
          const result = await storage.readDiarySummary({
            ...owner,
            kind: 'neighbor',
            currentId: item.current,
          });
          assert.deepEqual(result.value, expected, item.name);
        } finally {
          await storage.close();
        }
      }
    }
  } finally {
    IDBObjectStore.prototype.getAll = priorGetAll;
  }
});

test('actual Java golden title eligibility, shadowing, category refs and zero-based sequence', () => {
  for (const item of inputs.filter((row) => row.kind === 'title')) {
    const expected = golden.get(item.name);
    const products = item.products
      .filter((row) => row.entityType === 'journalAggregate')
      .map((row) => diaryTitleFromEntity({ ...row, entityType: 'entry' }));
    const taxonomy = item.products.find(
      (row) => row.entityType === 'taxonomy' && row.entityId === item.request.categoryId,
    );
    const category = item.categories.find((row) => row.id === item.request.categoryId);
    const args = {
      ...item.request,
      draft: item.drafts[item.request.entryId],
      legacyEntries: item.legacy,
      products,
      categoryName: taxonomy?.local?.data?.name ?? category?.name,
      stableCategoryIdentity: !!taxonomy,
      timeZone: item.zone,
    };
    if (expected.error) assert.throws(() => diarySuggestedTitle(args), undefined, item.name);
    else assert.deepEqual(diarySuggestedTitle(args), expected, item.name);
  }
});

test('shared indexed title port requires complete old-source coverage and honours product taxonomy', async () => {
  const { storage, owner } = await makeStore([
    { id: 'already', date: '2026-10-19', _product: { kind: 'entry', refs: { category: 'cat-a' } } },
    {
      id: 'shadowed',
      date: '2026-10-19',
      deleted: true,
      _product: { kind: 'entry', refs: { category: 'cat-a' } },
    },
  ]);
  try {
    await storage.transaction((tx) =>
      tx.putEntity({
        entityType: 'taxonomy',
        entityId: 'cat-a',
        localRevision: 1,
        local: { state: 'active', data: { kind: 'category', name: '日常' } },
      }),
    );
    const input = {
      ...owner,
      entryId: 'new',
      date: '2026-10-19',
      categoryId: 'cat-a',
      timeZone: 'UTC',
    };
    await assert.rejects(() => storage.readDiarySuggestedTitle(input), /SOURCE_COVERAGE_REQUIRED/);
    const sourceCoverage = {
      complete: true,
      productComplete: true,
      draft: { id: 'new', draftOnly: true },
      categoryName: '日常',
      legacyEntries: [{ id: 'shadowed', date: '2026-10-19', categoryId: 'cat-a' }],
    };
    const answer = await storage.readDiarySuggestedTitle({ ...input, sourceCoverage });
    assert.equal(answer.sequence, 1);
    assert.equal(answer.title, '261019日常1');
    await assert.rejects(
      () =>
        storage.readDiarySuggestedTitle({
          ...input,
          sourceCoverage: { ...sourceCoverage, categoryName: '冲突' },
        }),
      /CATEGORY_CONFLICT/,
    );
  } finally {
    await storage.close();
  }
});

test('createdAt raw prefix sorts descending and cursor fences changed search projection', async () => {
  const { storage, owner } = await makeStore([
    { id: 'short', createdAt: '2026', date: '2026-10-19', searchText: 'first' },
    { id: 'long', createdAt: '2026-01', date: '2026-10-19', searchText: 'first' },
  ]);
  try {
    const first = await storage.readDiaryPage({ ...owner, query: 'first', limit: 1 });
    assert.deepEqual(
      first.items.map((row) => row.id),
      ['long'],
    );
    const second = await storage.readDiaryPage({
      ...owner,
      query: 'first',
      limit: 1,
      cursor: first.nextCursor,
    });
    assert.deepEqual(
      second.items.map((row) => row.id),
      ['short'],
    );
    const row = await storage.transaction((tx) => tx.getEntity('entry', 'short'));
    row.local.data.searchText = 'second';
    await storage.transaction((tx) => tx.putEntity(row));
    await assert.rejects(
      () => storage.readDiaryPage({ ...owner, query: 'first', cursor: first.nextCursor }),
      /CURSOR_STALE/,
    );
    assert.deepEqual(
      (await storage.readDiaryPage({ ...owner, query: 'second' })).items.map((item) => item.id),
      ['short'],
    );
  } finally {
    await storage.close();
  }
});

test('existing v2 headers upgrade to v3 derived search and title without dropping sidecar', async () => {
  const indexedDB = new IDBFactory(),
    dbName = `shiye-sync-v2-shared-upgrade-${randomUUID()}`;
  const owner = { libraryId: randomUUID(), epoch: randomUUID() };
  const raw = indexedDB.open(dbName, 2);
  const db = await new Promise((resolve, reject) => {
    raw.onupgradeneeded = () => {
      const db = raw.result;
      db.createObjectStore('meta');
      const entities = db.createObjectStore('entities', { keyPath: 'key' });
      entities.createIndex('entityType', 'entityType');
      db.createObjectStore('pending', { keyPath: 'operationId' });
      db.createObjectStore('conflicts', { keyPath: 'operationId' });
      db.createObjectStore('diaryHeaders', { keyPath: 'id' });
      db.createObjectStore('diaryIndexState');
      db.createObjectStore('diarySidecars', { keyPath: 'key' });
    };
    raw.onsuccess = () => resolve(raw.result);
    raw.onerror = () => reject(raw.error);
  });
  await new Promise((resolve, reject) => {
    const tx = db.transaction(
      ['meta', 'entities', 'diaryHeaders', 'diaryIndexState', 'diarySidecars'],
      'readwrite',
    );
    tx.objectStore('meta').put({ sharedBusiness: 1, ...owner }, 'state');
    tx.objectStore('entities').put({
      ...record({ id: 'legacy', title: 'old', searchText: 'needle', date: '2026-10-19' }),
      key: JSON.stringify(['entry', 'legacy']),
    });
    tx.objectStore('diaryHeaders').put({ id: 'stale', title: 'wrong' });
    tx.objectStore('diaryIndexState').put({ version: 1, revision: 9 }, 'state');
    tx.objectStore('diarySidecars').put({
      key: JSON.stringify([owner.libraryId, owner.epoch, 'legacy', 'draft']),
      revision: 1,
      value: { body: 'keep' },
    });
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error);
  });
  db.close();
  const storage = createIndexedDbSyncStorage({ indexedDB, dbName, diaryIndex: true });
  try {
    const page = await storage.readDiaryPage({ ...owner, query: 'needle' });
    assert.deepEqual(
      page.items.map((row) => row.id),
      ['legacy'],
    );
    assert.equal(page.queryRevision, 1);
    assert.equal(
      (await storage.readDiarySidecar({ ...owner, entryId: 'legacy', kind: 'draft' })).value.body,
      'keep',
    );
  } finally {
    await storage.close();
  }
});

test('sparse search advances bounded empty pages without reading entities or duplicating rows', async () => {
  const indexedDB = new IDBFactory(),
    owner = { libraryId: randomUUID(), epoch: randomUUID() };
  const storage = createIndexedDbSyncStorage({
    indexedDB,
    dbName: `shiye-sync-v2-shared-sparse-${randomUUID()}`,
    diaryIndex: true,
  });
  const priorGetAll = IDBObjectStore.prototype.getAll;
  IDBObjectStore.prototype.getAll = function (...args) {
    if (this.name === 'entities') throw new Error('entities.getAll-forbidden');
    return priorGetAll.apply(this, args);
  };
  try {
    await storage.transaction(async (tx) => {
      await tx.setMeta({ sharedBusiness: 1, ...owner });
      for (let index = 0; index < 450; index++)
        await tx.putEntity(
          record({
            id: `id-${String(index).padStart(4, '0')}`,
            searchText: index >= 410 ? 'needle' : '',
            date: '2026-10-19',
            createdAt: '',
          }),
        );
    });
    const input = { ...owner, query: 'needle', limit: 20 };
    const first = await storage.readDiaryPage(input);
    assert.equal(first.items.length, 0);
    assert.equal(first.hasMore, true);
    const second = await storage.readDiaryPage({ ...input, cursor: first.nextCursor });
    const third = await storage.readDiaryPage({ ...input, cursor: second.nextCursor });
    assert.equal(second.items.length, 20);
    assert.equal(third.items.length, 20);
    assert.equal(third.hasMore, false);
    assert.equal(new Set([...second.items, ...third.items].map((row) => row.id)).size, 40);
  } finally {
    IDBObjectStore.prototype.getAll = priorGetAll;
    await storage.close();
  }
});
