import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { deliveryLibrary } from './helpers/revisit-delivery-fixtures.mjs';
import { sourceLibrary } from './helpers/revisit-source-fixtures.mjs';
import { freezeTree } from '../src/server/domain/revisit/sources/identity.mjs';
import {
  planDeliveryTick,
  commitDeliveryPlan,
} from '../src/server/domain/revisit/delivery/planning.mjs';
import { createLibraryDeliveryPort } from '../src/server/domain/revisit/delivery/storage-port.mjs';
import { createRevisitDeliveryService } from '../src/server/domain/revisit/delivery/service.mjs';
import {
  exportRevisitArchive,
  restoreRevisitArchive,
  stateToken,
} from '../src/server/domain/revisit/delivery/archive.mjs';
import { configureRevisit, tickRevisit, addRevisitComment } from '../src/server/domain/revisit.mjs';
import { createLibraryStore } from '../src/server/storage/library-store.mjs';
import { createDiaryServer } from '../src/server/app.mjs';

const enable = (db) => configureRevisit(db, { expectedRevision: 1, enabled: true });
const start = Date.parse('2026-01-01T00:00:00Z');
const from = '2026-01-01T00:00:00Z',
  to = '2026-01-02T00:00:00Z';
const manual = { manual: true, from, to };
const hash = (value) => createHash('sha256').update(value).digest('hex');

async function isolatedStore(db) {
  const dir = path.resolve('tmp/revisit-decoupling/stage3/stores', randomUUID());
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'diary.json'), JSON.stringify(db));
  const store = await createLibraryStore({ dataDir: dir, seed: false });
  return {
    dir,
    store,
    service: createRevisitDeliveryService(createLibraryDeliveryPort(store), {
      clock: () => start + 86400000,
    }),
  };
}

test('planning accepts frozen input, owns its output, and only commit changes revisit state', () => {
  const db = deliveryLibrary(2);
  enable(db);
  const before = structuredClone(db);
  const plan = planDeliveryTick(freezeTree(structuredClone(db)), manual, start + 86400000);
  assert.equal(plan.result.created, 2);
  assert.deepEqual(db, before);
  assert.throws(() => {
    plan.nextState.cursor = '污染';
  }, TypeError);
  const result = commitDeliveryPlan(db, plan);
  assert.equal(result.created, 2);
  result.issues.push({ code: '污染' });
  assert.deepEqual(db.entries, before.entries);
  assert.deepEqual(db.messageStore, before.messageStore);
  assert.ok(!JSON.stringify(db.revisit).includes('合成第'));
});

test('source/engine errors and invalid windows never partially create state or advance a cursor', () => {
  for (const stage of ['readSources', 'planWindow']) {
    const db = deliveryLibrary(1);
    enable(db);
    tickRevisit(db, {}, start);
    const before = structuredClone(db);
    assert.throws(
      () =>
        planDeliveryTick(db, {}, start + 86400000, {
          [stage]: () => {
            throw Error('synthetic-stage-failure');
          },
        }),
      /synthetic-stage-failure/,
    );
    assert.deepEqual(db, before);
  }
  const db = deliveryLibrary(1),
    before = structuredClone(db);
  assert.throws(() => tickRevisit(db, { manual: true, from, to: 'invalid' }, start), /时间/);
  assert.deepEqual(db, before);
  assert.throws(() => tickRevisit(db, { manual: 'true' }, start), /补看/);
  assert.deepEqual(db, before);
});

test('stale plans reject source, taxonomy, config, comment and cursor changes without overwriting them', () => {
  for (const change of [
    (db) => {
      db.entries[0].hidden = true;
    },
    (db) => {
      db.entries[0].category = '另一个分类';
    },
    (db) => {
      db.messageStore.units[0].revision++;
    },
    (db) => {
      db.revisit.cursor = '2026-01-01T01:00:00.000Z';
    },
    (db) => {
      db.revisit.comments.push({ operationId: 'synthetic-comment' });
    },
    (db) => configureRevisit(db, { expectedRevision: 2, sender: { name: '新名字' } }),
  ]) {
    const db = deliveryLibrary(1);
    enable(db);
    const plan = planDeliveryTick(db, manual, start + 86400000);
    change(db);
    const changed = structuredClone(db);
    assert.throws(() => commitDeliveryPlan(db, plan), { status: 409 });
    assert.deepEqual(db, changed);
  }
});

test('more than 31 days of downtime resumes in complete-minute chunks with no missing or duplicate occurrence', () => {
  const db = deliveryLibrary(75);
  enable(db);
  const originals = structuredClone(db.entries);
  tickRevisit(db, {}, start);
  const end = start + 74 * 86400000 + 13 * 3600000;
  let calls = 0;
  while (Date.parse(db.revisit.cursor) < Math.floor(end / 60000) * 60000 - 1) {
    const previous = Date.parse(db.revisit.cursor);
    tickRevisit(db, {}, end);
    calls++;
    assert.ok(Date.parse(db.revisit.cursor) > previous);
    assert.ok(Date.parse(db.revisit.cursor) - previous <= 86400000);
    assert.equal(Date.parse(db.revisit.cursor) % 60000, 59999);
    assert.ok(calls < 80);
  }
  assert.equal(db.revisit.deliveries.length, 150);
  assert.equal(new Set(db.revisit.deliveries.map((item) => item.id)).size, 150);
  assert.equal(db.revisit.batches.length, 75);
  assert.ok(db.revisit.batches.every((batch) => batch.targets.length === 2));
  assert.deepEqual(
    db.revisit.deliveries.map((item) => item.sequence),
    Array.from({ length: 150 }, (_, index) => index + 1),
  );
  assert.equal(tickRevisit(db, {}, end).created, 0);
  assert.deepEqual(db.entries, originals);
});

test('a mid-minute start never splits a future daily-boundary minute into two automatic groups', () => {
  const db = deliveryLibrary(3);
  enable(db);
  const initial = Date.parse('2026-01-01T12:00:30.123Z');
  const end = Date.parse('2026-01-04T00:00:00Z');
  tickRevisit(db, {}, initial);
  for (let i = 0; i < 4; i++) tickRevisit(db, {}, end);
  assert.equal(db.revisit.deliveries.length, 5); // First day's :05 is before startup, :55 is eligible.
  const dayTwo = db.revisit.batches.filter((item) => item.replayAt === '2026-01-02T12:00:00.000Z');
  assert.equal(dayTwo.length, 1);
  assert.equal(dayTwo[0].targets.length, 2);
});

test('open minutes and a backwards clock preserve the cursor until safe processing is possible', () => {
  const db = deliveryLibrary(1);
  enable(db);
  tickRevisit(db, {}, start + 123);
  const cursor = db.revisit.cursor;
  assert.equal(tickRevisit(db, {}, start + 500).waitingForMinute, true);
  assert.equal(tickRevisit(db, {}, start - 1000).waitingForClock, true);
  assert.equal(db.revisit.cursor, cursor);
  assert.equal(tickRevisit(db, {}, start + 86400000).created, 2);
});

test('manual overlap/retry does not move the automatic cursor and retains its 31-day limit', () => {
  const db = deliveryLibrary(5);
  enable(db);
  tickRevisit(db, {}, start);
  const cursor = db.revisit.cursor;
  assert.equal(tickRevisit(db, manual, start + 5 * 86400000).created, 2);
  assert.equal(
    tickRevisit(db, { ...manual, to: '2026-01-03T00:00:00Z' }, start + 5 * 86400000).created,
    2,
  );
  assert.equal(tickRevisit(db, manual, start + 5 * 86400000).created, 0);
  assert.equal(db.revisit.cursor, cursor);
  const before = structuredClone(db);
  assert.throws(
    () =>
      tickRevisit(
        db,
        { manual: true, from, to: '2026-03-01T00:00:00Z' },
        Date.parse('2026-03-02T00:00:00Z'),
      ),
    { status: 400 },
  );
  assert.deepEqual(db, before);
});

test('concurrent service instances share the library transaction queue; pagination and restart remain exact', async () => {
  const db = deliveryLibrary(1);
  enable(db);
  tickRevisit(db, {}, start);
  const { dir, store, service } = await isolatedStore(db);
  const other = createRevisitDeliveryService(createLibraryDeliveryPort(store), {
    clock: () => start + 86400000,
  });
  const results = await Promise.all(
    Array.from({ length: 24 }, (_, index) =>
      (index % 2 ? service : other).tick(index % 3 ? manual : {}),
    ),
  );
  assert.equal(
    results.reduce((sum, item) => sum + item.created, 0),
    2,
  );
  const page1 = service.feed({ after: 0, limit: 1 });
  const page2 = other.feed({ after: page1.next, limit: 1 });
  assert.notEqual(page1.deliveries[0].id, page2.deliveries[0].id);
  assert.equal(page2.next, 2);
  page1.deliveries[0].ref.unitId = '污染';
  page1.deliveries[0].sender.name = '污染';
  page1.batches[0].targets.length = 0;
  assert.ok(!JSON.stringify(store.getDb().revisit).includes('污染'));
  assert.equal(service.feed().batches[0].targets.length, 2);
  const reopened = await createLibraryStore({ dataDir: dir, seed: false });
  const resumed = createRevisitDeliveryService(createLibraryDeliveryPort(reopened), {
    clock: () => start + 86400000,
  });
  assert.equal((await resumed.tick(manual)).created, 0);
  assert.deepEqual(reopened.getDb().entries, db.entries);
});

test('real disk write failure rolls back deliveries, batch and cursor together, then retry succeeds once', async () => {
  const db = deliveryLibrary(1);
  enable(db);
  tickRevisit(db, {}, start);
  const { dir, store, service } = await isolatedStore(db);
  const saved = await fs.readFile(path.join(dir, 'diary.json'));
  const memory = structuredClone(store.getDb());
  const blocker = path.resolve(dir, 'diary.json.tmp');
  assert.equal(path.dirname(blocker), path.resolve(dir));
  await fs.mkdir(blocker); // An empty directory forces the real store's writeFile to fail.
  await assert.rejects(service.tick());
  assert.deepEqual(store.getDb(), memory);
  assert.equal(hash(await fs.readFile(path.join(dir, 'diary.json'))), hash(saved));
  await fs.rmdir(blocker); // Only this known empty test directory; no recursive cleanup.
  assert.equal((await service.tick()).created, 2);
  assert.equal((await service.tick()).created, 0);
  assert.deepEqual(store.getDb().entries, db.entries);
});

test('committed push followed by process exit before acknowledgement survives reopening without duplicates', async () => {
  const db = deliveryLibrary(1);
  enable(db);
  const { dir } = await isolatedStore(db);
  const root = new URL('../', import.meta.url);
  const code = `import {createLibraryStore} from ${JSON.stringify(new URL('src/server/storage/library-store.mjs', root).href)};
import {createLibraryDeliveryPort} from ${JSON.stringify(new URL('src/server/domain/revisit/delivery/storage-port.mjs', root).href)};
import {createRevisitDeliveryService} from ${JSON.stringify(new URL('src/server/domain/revisit/delivery/service.mjs', root).href)};
const store=await createLibraryStore({dataDir:${JSON.stringify(dir)},seed:false});
await createRevisitDeliveryService(createLibraryDeliveryPort(store),{clock:()=>${start + 86400000}}).tick(${JSON.stringify(manual)});
process.exit(23);`;
  await assert.rejects(
    promisify(execFile)(process.execPath, ['--input-type=module', '-e', code], {
      cwd: path.resolve('.'),
    }),
    (error) => error.code === 23,
  );
  const reopened = await createLibraryStore({ dataDir: dir, seed: false });
  const service = createRevisitDeliveryService(createLibraryDeliveryPort(reopened), {
    clock: () => start + 86400000,
  });
  assert.equal((await service.tick(manual)).created, 0);
  assert.equal(service.feed().total, 2);
});

test('sender edits keep delivery identity; rule changes leave fixed groups and comments bound', () => {
  const db = deliveryLibrary(1);
  enable(db);
  tickRevisit(db, manual, start + 86400000);
  const batch = db.revisit.batches[0];
  addRevisitComment(
    db,
    { batchId: batch.id, operationId: 'fixed-comment', text: '合成评论' },
    start + 86400000,
  );
  const old = structuredClone(db.revisit);
  configureRevisit(db, { expectedRevision: 2, sender: { name: '另一个我' } });
  assert.equal(tickRevisit(db, manual, start + 86400000).created, 0);
  assert.deepEqual(db.revisit.batches, old.batches);
  assert.deepEqual(db.revisit.comments, old.comments);
  configureRevisit(db, { expectedRevision: 3, interval: { unit: 'month', count: 3 } });
  assert.equal(db.revisit.cursor, null);
  assert.deepEqual(db.revisit.comments[0].targets, old.comments[0].targets);
});

test('state archive roundtrip retains cursor, delivery IDs, comments and dedupe without editing sources', () => {
  const db = deliveryLibrary(1);
  enable(db);
  tickRevisit(db, {}, start);
  tickRevisit(db, {}, start + 86400000);
  addRevisitComment(
    db,
    { batchId: db.revisit.batches[0].id, operationId: 'archive-comment', text: '归档评论' },
    start + 86400000,
  );
  db.revisit.comments.push({
    id: 'withdraw-before-send',
    operationId: 'withdraw-before-send',
    state: 'withdrawn',
    text: '',
    targets: [],
    origin: 'revisit-comment',
  });
  const archive = exportRevisitArchive(db);
  const target = structuredClone(db);
  delete target.revisit;
  const originals = structuredClone(target.entries);
  assert.equal(
    restoreRevisitArchive(target, { archive, expectedToken: stateToken(target) }).restored,
    true,
  );
  assert.deepEqual(target.revisit, db.revisit);
  assert.deepEqual(target.entries, originals);
  assert.equal(tickRevisit(target, {}, start + 86400000).created, 0);
  assert.equal(
    restoreRevisitArchive(target, {
      archive: exportRevisitArchive(target),
      expectedToken: stateToken(target),
    }).identical,
    true,
  );
});

test('archive rejects corruption, invalid associations, stale source/token and rollback over existing progress', () => {
  const db = deliveryLibrary(1);
  enable(db);
  tickRevisit(db, manual, start + 86400000);
  const archive = exportRevisitArchive(db);
  const checksum = (value) => hash(JSON.stringify([value.sourceFingerprint, value.state]));
  for (const change of [
    (value) => {
      value.state.deliveries[0].sequence = 3;
    },
    (value) => {
      value.state.batches[0].targets = [];
    },
    (value) => {
      value.state.deliveries[0].id = 'fake-id';
    },
    (value) => {
      value.state.cursor = 'invalid';
    },
  ]) {
    const bad = structuredClone(archive);
    change(bad);
    bad.checksum = checksum(bad);
    const target = structuredClone(db);
    delete target.revisit;
    const before = structuredClone(target);
    assert.throws(
      () => restoreRevisitArchive(target, { archive: bad, expectedToken: stateToken(target) }),
      { status: 400 },
    );
    assert.deepEqual(target, before);
  }
  const target = structuredClone(db);
  delete target.revisit;
  target.entries[0].title = '不同来源版本';
  assert.throws(
    () => restoreRevisitArchive(target, { archive, expectedToken: stateToken(target) }),
    { status: 409 },
  );
  assert.throws(() => restoreRevisitArchive(db, { archive, expectedToken: 'wrong' }), {
    status: 409,
  });
  const earlier = structuredClone(archive);
  earlier.state.deliveries = [];
  earlier.state.batches = [];
  earlier.checksum = checksum(earlier);
  assert.throws(
    () => restoreRevisitArchive(db, { archive: earlier, expectedToken: stateToken(db) }),
    { status: 409 },
  );
});

test('delivery modules do not depend on UI, routing or direct filesystem writes', async () => {
  for (const name of await fs.readdir(
    new URL('../src/server/domain/revisit/delivery/', import.meta.url),
  )) {
    const code = await fs.readFile(
      new URL(`../src/server/domain/revisit/delivery/${name}`, import.meta.url),
      'utf8',
    );
    assert.ok(!/from ['"][^'"]*(?:node:fs|routes\/|previews\/|desktop\/)/.test(code), name);
  }
});

test('isolated HTTP concurrency, archive export/restore and restart preserve original diary bytes', async (t) => {
  const dir = path.resolve('tmp/revisit-decoupling/stage3/http', randomUUID());
  await fs.mkdir(dir, { recursive: true });
  const db = sourceLibrary();
  enable(db);
  await fs.writeFile(path.join(dir, 'diary.json'), JSON.stringify(db));
  let server, base;
  const startServer = async () => {
    server = await createDiaryServer({ dataDir: dir, seed: false });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  };
  const close = async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  };
  await startServer();
  t.after(close);
  const request = async (suffix, method = 'POST', data) => {
    const response = await fetch(base + '/api/revisit' + suffix, {
      method,
      headers: { 'X-Diary-Client': 'desktop' },
      ...(method !== 'GET' ? { body: JSON.stringify(data || {}) } : {}),
    });
    return { status: response.status, data: await response.json() };
  };
  const input = { manual: true, from: '2026-10-17T00:00:00Z', to: '2026-10-17T03:00:00Z' };
  const results = await Promise.all(
    Array.from({ length: 16 }, () => request('/tick', 'POST', input)),
  );
  assert.ok(results.every((item) => item.status === 200));
  assert.equal(
    results.reduce((sum, item) => sum + item.data.created, 0),
    13,
  );
  const firstFeed = (await request('/feed', 'POST', { after: 0, limit: 100 })).data;
  assert.equal(
    (
      await request('/comments', 'POST', {
        batchId: firstFeed.batches[0].id,
        operationId: 'http-archive-comment',
        text: 'HTTP归档评论',
      })
    ).status,
    201,
  );
  await request('/comments/withdraw', 'POST', { operationId: 'http-withdraw-before-send' });
  const archived = await request('/archive', 'GET');
  assert.equal(archived.status, 200);
  assert.equal(
    (
      await request('/archive', 'PUT', {
        archive: archived.data,
        expectedToken: archived.data.targetToken,
      })
    ).data.identical,
    true,
  );
  const before = (await request('/feed', 'POST', { after: 0, limit: 100 })).data;
  const targetDir = path.resolve('tmp/revisit-decoupling/stage3/http-restore', randomUUID());
  await fs.mkdir(targetDir, { recursive: true });
  await fs.writeFile(path.join(targetDir, 'diary.json'), JSON.stringify(db));
  const targetServer = await createDiaryServer({ dataDir: targetDir, seed: false });
  await new Promise((resolve) => targetServer.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    targetServer.closeAllConnections();
    await new Promise((resolve) => targetServer.close(resolve));
  });
  const targetURL = `http://127.0.0.1:${targetServer.address().port}/api/revisit/archive`;
  const targetToken = (
    await (await fetch(targetURL, { headers: { 'X-Diary-Client': 'desktop' } })).json()
  ).targetToken;
  const restored = await fetch(targetURL, {
    method: 'PUT',
    headers: { 'X-Diary-Client': 'desktop' },
    body: JSON.stringify({ archive: archived.data, expectedToken: targetToken }),
  });
  assert.equal(restored.status, 200);
  assert.equal((await restored.json()).restored, true);
  const targetSaved = JSON.parse(await fs.readFile(path.join(targetDir, 'diary.json'), 'utf8'));
  assert.deepEqual(targetSaved.revisit, archived.data.state);
  assert.deepEqual(targetSaved.entries, db.entries);
  await close();
  await startServer();
  assert.equal((await request('/tick', 'POST', input)).data.created, 0);
  assert.deepEqual((await request('/feed', 'POST', { after: 0, limit: 100 })).data, before);
  const saved = JSON.parse(await fs.readFile(path.join(dir, 'diary.json'), 'utf8'));
  assert.deepEqual(saved.entries, db.entries);
  await fs.mkdir('outputs/revisit-decoupling/stage3', { recursive: true });
  await fs.writeFile(
    'outputs/revisit-decoupling/stage3/http-isolation.json',
    JSON.stringify(
      {
        isolationDir: dir,
        concurrentRequests: 16,
        deliveries: before.total,
        originalEntriesSHA256: hash(JSON.stringify(db.entries)),
        savedEntriesSHA256: hash(JSON.stringify(saved.entries)),
        originalEntriesUnchanged: true,
        restartRetryCreated: 0,
        archiveRestoredTo: targetDir,
        archiveStateExact: true,
      },
      null,
      2,
    ),
  );
});
