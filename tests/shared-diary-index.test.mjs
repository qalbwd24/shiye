import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { JSDOM } from 'jsdom';
import { createIndexedDbSyncStorage } from '../public/shared/sync-v2-client.js';
import { createSharedBusinessClient } from '../public/shared/shared-business-client.js';
import { createSharedDiaryClient } from '../public/shared/shared-diary-client.js';
import {
  DIARY_PAGE_MAX_BYTES,
  diarySearchFromEntity,
  diaryHeaderFromEntity,
} from '../public/shared/shared-diary-index.js';

const identity = () => ({ libraryId: randomUUID(), epoch: randomUUID() });
const entry = (id, title, localRevision = 1, content = '<p>synthetic</p>') => ({
  entityType: 'entry',
  entityId: id,
  localRevision,
  base: { revision: 1 },
  local: {
    state: 'active',
    data: {
      id,
      title,
      date: '2026-10-19T01:00:00Z',
      category: '日常',
      content,
      contentFormat: 'html',
      attachments: [],
    },
  },
});
const opened = (indexedDB, dbName, diaryIndex = false) =>
  createIndexedDbSyncStorage({ indexedDB, dbName, diaryIndex });

test('diary schema opt-in rejects non-shared database names', () => {
  assert.throws(
    () => opened(new IDBFactory(), `shiye-sync-v2-lab-${randomUUID()}`, true),
    /SHARED_DIARY_INDEX_SHARED_DB_REQUIRED/,
  );
});

test('v1 shared DB upgrades atomically and pages headers without reading full entities', async () => {
  const indexedDB = new IDBFactory(),
    dbName = `shiye-sync-v2-shared-diary-${randomUUID()}`,
    owner = identity();
  const old = opened(indexedDB, dbName);
  await old.transaction(async (tx) => {
    await tx.setMeta({ sharedBusiness: 1, ...owner, drafts: { chat: { text: 'keep' } } });
    for (let i = 0; i < 105; i++)
      await tx.putEntity(entry(randomUUID(), `item ${i}`, 1, 'synthetic '.repeat(10000)));
  });
  await old.close();
  const storage = opened(indexedDB, dbName, true);
  const priorGetAll = IDBObjectStore.prototype.getAll;
  IDBObjectStore.prototype.getAll = function (...args) {
    if (this.name === 'entities') throw new Error('entities.getAll-forbidden');
    return priorGetAll.apply(this, args);
  };
  try {
    const first = await storage.readDiaryPage({ ...owner });
    assert.equal(first.items.length, 40);
    assert.equal(first.sort, 'product-created-v1');
    assert.equal(first.hasMore, true);
    assert.ok(first.items.every((row) => !Object.hasOwn(row, 'content')));
    assert.ok(Buffer.byteLength(JSON.stringify(first)) <= DIARY_PAGE_MAX_BYTES);
    const hundred = await storage.readDiaryPage({ ...owner, limit: 100 });
    assert.equal(hundred.items.length, 100);
    assert.ok(Buffer.byteLength(JSON.stringify(hundred)) <= DIARY_PAGE_MAX_BYTES);
    const second = await storage.readDiaryPage({ ...owner, cursor: first.nextCursor });
    assert.equal(second.items.length, 40);
    assert.equal(new Set([...first.items, ...second.items].map((row) => row.id)).size, 80);
    assert.deepEqual((await storage.transaction((tx) => tx.getMeta())).drafts.chat, {
      text: 'keep',
    });
    await assert.rejects(
      () => storage.readDiaryPage({ ...identity() }),
      /SHARED_IDENTITY_MISMATCH/,
    );
    await assert.rejects(
      () => storage.readDiaryPage({ ...owner, deleted: true, cursor: first.nextCursor }),
      /SHARED_DIARY_CURSOR_STALE/,
    );
    await assert.rejects(
      () => storage.readDiaryPage({ ...owner, exactDay: '2026-10-19' }),
      /SHARED_DIARY_QUERY_INVALID/,
    );
    await assert.rejects(
      () => storage.readDiaryPage({ ...owner, limit: 101 }),
      /SHARED_DIARY_QUERY_INVALID/,
    );
    assert.equal((await storage.readDiaryPage({ ...owner, query: 'synthetic' })).items.length, 40);
    const target = first.items[0].id;
    const record = await storage.transaction((tx) => tx.getEntity('entry', target));
    record.localRevision++;
    record.local.data.title = 'changed';
    await storage.transaction((tx) => tx.putEntity(record));
    await assert.rejects(
      () => storage.readDiaryPage({ ...owner, cursor: first.nextCursor }),
      /SHARED_DIARY_CURSOR_STALE/,
    );
    const current = await storage.readDiaryPage({ ...owner });
    assert.ok(current.queryRevision > first.queryRevision);
    await assert.rejects(
      () =>
        storage.transaction(async (tx) => {
          record.local.data.title = 'rolled back';
          await tx.putEntity(record);
          throw new Error('cancel');
        }),
      /cancel/,
    );
    assert.equal((await storage.readDiaryPage({ ...owner })).queryRevision, current.queryRevision);
    assert.equal(
      (await storage.readDiaryPage({ ...owner })).items.find((row) => row.id === target).title,
      'changed',
    );
    record.localRevision++;
    record.local.state = 'withdrawn';
    record.local.data = {};
    await storage.transaction((tx) => tx.putEntity(record));
    const withdrawn = await storage.readDiaryPage({ ...owner });
    assert.ok(withdrawn.queryRevision > current.queryRevision);
    assert.equal(
      withdrawn.items.some((row) => row.id === target),
      false,
    );
  } finally {
    IDBObjectStore.prototype.getAll = priorGetAll;
    await storage.close();
  }
});

test('failed v1 rebuild rolls back schema and preserves prior entities', async () => {
  const indexedDB = new IDBFactory(),
    dbName = `shiye-sync-v2-shared-diary-${randomUUID()}`,
    old = opened(indexedDB, dbName);
  await old.transaction((tx) =>
    tx.putEntity({
      entityType: 'entry',
      entityId: randomUUID(),
      localRevision: 1,
      local: { data: null },
    }),
  );
  await old.close();
  const upgraded = opened(indexedDB, dbName, true);
  await assert.rejects(
    () => upgraded.readDiaryPage(identity()),
    /SHARED_DIARY_INDEX_INVALID_ENTITY/,
  );
  const preserved = opened(indexedDB, dbName);
  assert.equal((await preserved.transaction((tx) => tx.listEntities('entry'))).length, 1);
  await preserved.close();
});

test('old connection reloads after v2 upgrade and default v2 writer maintains revision', async () => {
  const indexedDB = new IDBFactory(),
    dbName = `shiye-sync-v2-shared-diary-${randomUUID()}`,
    owner = identity(),
    old = opened(indexedDB, dbName);
  await old.transaction((tx) => tx.setMeta({ sharedBusiness: 1, ...owner }));
  const indexed = opened(indexedDB, dbName, true);
  const before = await indexed.readDiaryPage(owner);
  await assert.rejects(
    () => old.transaction((tx) => tx.getMeta()),
    /SHARED_DB_VERSION_CHANGED_RELOAD/,
  );
  const defaultWriter = opened(indexedDB, dbName);
  await Promise.all([
    defaultWriter.transaction((tx) => tx.putEntity(entry(randomUUID(), 'other runtime'))),
    indexed.transaction((tx) => tx.putEntity(entry(randomUUID(), 'indexed runtime'))),
  ]);
  const after = await indexed.readDiaryPage(owner);
  assert.equal(after.items.length, 2);
  assert.equal(after.queryRevision, before.queryRevision + 2);
  await indexed.close();
  await defaultWriter.close();
});

test('draft and reading sidecars use independent CAS and never clear chat draft or unsupported media', async () => {
  const indexedDB = new IDBFactory(),
    dbName = `shiye-sync-v2-shared-diary-${randomUUID()}`,
    owner = identity(),
    storage = opened(indexedDB, dbName, true),
    id = randomUUID();
  await storage.transaction(async (tx) => {
    await tx.setMeta({
      sharedBusiness: 1,
      ...owner,
      drafts: { chat: { text: 'keep', revision: 2 } },
    });
    await tx.putEntity(entry(id, 'draft target'));
  });
  const draft = {
    format: 'html',
    body: '<p>unsaved</p>',
    mediaRefs: [],
    selectionAnchor: { path: [0], offset: 3 },
  };
  const first = await storage.writeDiarySidecar({
    ...owner,
    entryId: id,
    kind: 'draft',
    expectedRevision: 0,
    baseLocalRevision: 1,
    value: draft,
  });
  assert.equal(first.revision, 1);
  await assert.rejects(
    () =>
      storage.writeDiarySidecar({
        ...owner,
        entryId: id,
        kind: 'draft',
        expectedRevision: 0,
        baseLocalRevision: 1,
        value: draft,
      }),
    /SHARED_DIARY_DRAFT_REVISION_CONFLICT/,
  );
  await assert.rejects(
    () =>
      storage.writeDiarySidecar({
        ...owner,
        entryId: id,
        kind: 'draft',
        expectedRevision: 1,
        baseLocalRevision: 0,
        value: draft,
      }),
    /SHARED_DIARY_BASE_LOCAL_REVISION_CONFLICT/,
  );
  await assert.rejects(
    () =>
      storage.writeDiarySidecar({
        ...owner,
        entryId: id,
        kind: 'draft',
        expectedRevision: 1,
        baseLocalRevision: 1,
        value: { ...draft, mediaRefs: [{ opaque: 'new-stage' }] },
      }),
    /SHARED_DIARY_NEW_MEDIA_UNSUPPORTED/,
  );
  assert.deepEqual(
    (await storage.readDiarySidecar({ ...owner, entryId: id, kind: 'draft' })).value,
    draft,
  );
  const reading = await storage.writeDiarySidecar({
    ...owner,
    entryId: id,
    kind: 'reading',
    expectedRevision: 0,
    baseLocalRevision: 1,
    value: { selectionAnchor: { paragraph: 2, offset: 4 } },
  });
  assert.equal(reading.revision, 1);
  await storage.writeDiarySidecar({
    ...owner,
    entryId: id,
    kind: 'draft',
    expectedRevision: 1,
    baseLocalRevision: 1,
    value: null,
  });
  assert.equal(await storage.readDiarySidecar({ ...owner, entryId: id, kind: 'draft' }), null);
  const discarded = await storage.readDiarySidecar({
    ...owner,
    entryId: id,
    kind: 'draft',
    includeDiscarded: true,
  });
  assert.equal(discarded.value, null);
  assert.equal(discarded.revision, 2);
  assert.equal(discarded.discarded, true);
  await assert.rejects(
    () =>
      storage.writeDiarySidecar({
        ...owner,
        entryId: id,
        kind: 'draft',
        expectedRevision: 0,
        baseLocalRevision: 1,
        value: draft,
      }),
    /SHARED_DIARY_DRAFT_REVISION_CONFLICT/,
  );
  assert.equal(
    (await storage.readDiarySidecar({ ...owner, entryId: id, kind: 'reading' })).revision,
    1,
  );
  assert.equal((await storage.transaction((tx) => tx.getMeta())).drafts.chat.text, 'keep');
  await storage.close();
});

test('local optimistic Entry, outbox, header, and structured draft survive cold reopen', async () => {
  const indexedDB = new IDBFactory(),
    dbName = `shiye-sync-v2-shared-diary-${randomUUID()}`,
    owner = identity();
  let storage = opened(indexedDB, dbName, true);
  const client = () =>
    createSharedBusinessClient({
      storage,
      ...owner,
      request: async () => {
        throw Object.assign(new Error('offline'), { code: 'OFFLINE' });
      },
    });
  let business = client(),
    diary = createSharedDiaryClient({ client: business });
  const id = randomUUID();
  const created = await diary.create(
    {
      id,
      title: 'new offline',
      content: '<p>first</p>',
      contentFormat: 'html',
      date: '2026-10-19T01:00:00Z',
      category: '日常',
      attachments: [],
      tags: [],
    },
    { sync: false },
  );
  assert.equal(created.localAck, true);
  assert.equal((await diary.listPage()).items[0].id, id);
  assert.equal((await diary.listPage({ limit: 1 })).hasMore, false);
  const draft = {
    format: 'html',
    body: '<p>new unsaved</p>',
    mediaRefs: [],
    selectionAnchor: { paragraph: 0, offset: 5 },
  };
  await diary.saveDraft(id, draft, {
    expectedDraftRevision: 0,
    baseLocalRevision: created.committedLocalRevision,
  });
  await storage.close();
  storage = opened(indexedDB, dbName, true);
  business = client();
  diary = createSharedDiaryClient({ client: business });
  assert.equal((await diary.listPage()).items[0].title, 'new offline');
  assert.equal((await diary.readDraft(id)).value.body, '<p>new unsaved</p>');
  assert.equal((await business.status()).pending, 1);
  const edited = await diary.save(id, { title: 'edited' }, created.committedLocalRevision, {
    sync: false,
  });
  assert.equal((await diary.listPage()).items[0].title, 'edited');
  await assert.rejects(
    () =>
      diary.discardDraft(id, {
        expectedDraftRevision: 1,
        baseLocalRevision: created.committedLocalRevision,
      }),
    /SHARED_DIARY_BASE_LOCAL_REVISION_CONFLICT/,
  );
  assert.equal((await diary.readDraft(id)).value.body, '<p>new unsaved</p>');
  assert.equal(edited.committedLocalRevision, 2);
  await storage.close();
});

test('real offline create and save derive search and preview from Entry content', async () => {
  const indexedDB = new IDBFactory();
  const storage = opened(indexedDB, `shiye-sync-v2-shared-diary-${randomUUID()}`, true);
  const owner = identity();
  const business = createSharedBusinessClient({
    storage,
    ...owner,
    request: async () => {
      throw new Error('offline');
    },
  });
  const diary = createSharedDiaryClient({ client: business });
  try {
    const id = randomUUID();
    const created = await diary.create(
      {
        id,
        title: 'fixture',
        date: '2026-10-19',
        category: '日常',
        content: '<p>uniquebodyneedle</p>',
        contentFormat: 'html',
        tags: [],
        attachments: [],
      },
      { sync: false },
    );
    const first = await diary.listPage({ query: 'uniquebodyneedle' });
    assert.deepEqual(
      first.items.map((row) => row.id),
      [id],
    );
    assert.match(first.items[0].preview, /uniquebodyneedle/);
    const saved = await diary.save(
      id,
      { content: '<p>laterbodyneedle</p>' },
      created.committedLocalRevision,
      { sync: false },
    );
    assert.equal(saved.committedLocalRevision, created.committedLocalRevision + 1);
    assert.deepEqual((await diary.listPage({ query: 'uniquebodyneedle' })).items, []);
    assert.deepEqual(
      (await diary.listPage({ query: 'laterbodyneedle' })).items.map((row) => row.id),
      [id],
    );
  } finally {
    await storage.close();
  }
});

test('remote snapshot and pull replace content-derived search in committed index', async () => {
  const indexedDB = new IDBFactory();
  const storage = opened(indexedDB, `shiye-sync-v2-shared-diary-${randomUUID()}`, true);
  const owner = identity();
  const id = randomUUID();
  let version = 1;
  const row = () => ({
    entityType: 'entry',
    entityId: id,
    revision: version,
    seq: version,
    state: 'active',
    data: {
      id,
      title: 'remote',
      date: '2026-10-19',
      category: '日常',
      content: version === 1 ? '<p>seedbodyneedle</p>' : '<p>pullbodyneedle</p>',
      contentFormat: 'html',
      tags: [],
      attachments: [],
    },
  });
  const business = createSharedBusinessClient({
    storage,
    ...owner,
    request: async (action) => {
      const info = { ...owner, seq: version };
      if (action === 'info') return info;
      if (action === 'snapshot' || action === 'pull')
        return {
          info,
          [action === 'snapshot' ? 'entities' : 'changes']: [row()],
          next: { ...owner, after: version },
          hasMore: false,
        };
      throw new Error('unexpected-request');
    },
  });
  const diary = createSharedDiaryClient({ client: business });
  try {
    await business.receive();
    assert.deepEqual(
      (await diary.listPage({ query: 'seedbodyneedle' })).items.map((r) => r.id),
      [id],
    );
    version = 2;
    await business.receive();
    assert.deepEqual((await diary.listPage({ query: 'seedbodyneedle' })).items, []);
    assert.deepEqual(
      (await diary.listPage({ query: 'pullbodyneedle' })).items.map((r) => r.id),
      [id],
    );
  } finally {
    await storage.close();
  }
});

test('Java date-token boundary and spaced tags/day haystack match product query', async () => {
  const storage = opened(new IDBFactory(), `shiye-sync-v2-shared-diary-${randomUUID()}`, true);
  const owner = identity();
  const id = 'x';
  try {
    await storage.transaction(async (tx) => {
      await tx.setMeta({ sharedBusiness: 1, ...owner });
      await tx.putEntity(entry(id, 'x', 1, '<p>other</p>'));
    });
    assert.deepEqual(
      (await storage.readDiaryPage({ ...owner, query: 'x2026-10-19', timeZone: 'UTC' })).items.map(
        (r) => r.id,
      ),
      [id],
    );
    assert.deepEqual(
      (await storage.readDiaryPage({ ...owner, query: 'null2026', timeZone: 'UTC' })).items,
      [],
    );
  } finally {
    await storage.close();
  }
});

test('HTML text index matches real DOMParser for Chinese, entities and hidden script; richdoc needs no editor runtime', () => {
  const original = globalThis.DOMParser;
  const record = entry(
    'fixture',
    'test',
    1,
    '<p>中文 &amp; text</p><script>secretneedle</script><p>尾段</p>',
  );
  const fallback = diarySearchFromEntity(record).searchText;
  try {
    globalThis.DOMParser = new JSDOM('').window.DOMParser;
    const production = diarySearchFromEntity(structuredClone(record)).searchText;
    assert.equal(production, fallback);
    assert.match(production, /中文 & text/);
    assert.doesNotMatch(production, /secretneedle/);
  } finally {
    if (original === undefined) delete globalThis.DOMParser;
    else globalThis.DOMParser = original;
  }
  const rich = entry('rich', 'test');
  rich.local.data.contentFormat = 'richdoc';
  rich.local.data.body = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'richneedle' }] },
      { type: 'image', attrs: { alt: 'hidden-alt', caption: 'captionneedle' } },
    ],
  };
  assert.match(diarySearchFromEntity(rich).searchText, /richneedle/);
  assert.match(diaryHeaderFromEntity(rich).preview, /captionneedle/);
  assert.doesNotMatch(diarySearchFromEntity(rich).searchText, /hidden-alt/);
});

test('large HTML markup with small visible body can be indexed without raw-byte cap', () => {
  const record = entry(
    'large',
    'test',
    1,
    `<p data-noise="${'x'.repeat(1100000)}">briefneedle</p>`,
  );
  assert.match(diarySearchFromEntity(record).searchText, /briefneedle/);
});

test('source-only Markdown angle-bracket code remains searchable with a browser DOMParser', async () => {
  const original = globalThis.DOMParser;
  globalThis.DOMParser = new JSDOM('').window.DOMParser;
  const storage = opened(new IDBFactory(), `shiye-sync-v2-shared-diary-${randomUUID()}`, true);
  const owner = identity();
  const diary = createSharedDiaryClient({
    client: createSharedBusinessClient({
      storage,
      ...owner,
      request: async () => {
        throw new Error('offline');
      },
    }),
  });
  try {
    const id = randomUUID();
    await diary.create(
      {
        id,
        title: 'different',
        date: '2026-10-19',
        content: '',
        contentFormat: 'markdown',
        markdownSource: '`<sourcecodeneedle>`',
        attachments: [],
      },
      { sync: false },
    );
    assert.deepEqual(
      (await diary.listPage({ query: 'sourcecodeneedle' })).items.map((row) => row.id),
      [id],
    );
  } finally {
    await storage.close();
    if (original === undefined) delete globalThis.DOMParser;
    else globalThis.DOMParser = original;
  }
});

test('reusing and mutating a data object cannot keep its prior search projection', async () => {
  const storage = opened(new IDBFactory(), `shiye-sync-v2-shared-diary-${randomUUID()}`, true);
  const owner = identity();
  const id = randomUUID();
  const record = entry(id, 'different', 1, '<p>firstcacheword</p>');
  try {
    await storage.transaction(async (tx) => {
      await tx.setMeta({ sharedBusiness: 1, ...owner });
      await tx.putEntity(record);
    });
    record.local.data.content = '<p>secondcacheword</p>';
    record.localRevision = 2;
    await storage.transaction((tx) => tx.putEntity(record));
    assert.deepEqual(
      (await storage.readDiaryPage({ ...owner, query: 'secondcacheword' })).items.map(
        (row) => row.id,
      ),
      [id],
    );
    assert.deepEqual(
      (await storage.readDiaryPage({ ...owner, query: 'firstcacheword' })).items,
      [],
    );
  } finally {
    await storage.close();
  }
});
