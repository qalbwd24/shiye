import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createLibraryStore } from '../src/server/storage/library-store.mjs';
import { createLibraryDeliveryPort } from '../src/server/domain/revisit/delivery/storage-port.mjs';
import { createRevisitDeliveryService } from '../src/server/domain/revisit/delivery/service.mjs';
import { preflightDeliveryTick } from '../src/server/domain/revisit/delivery/window.mjs';
import {
  planDeliveryTick,
  commitDeliveryPlan,
} from '../src/server/domain/revisit/delivery/planning.mjs';
import { configureRevisit } from '../src/server/domain/revisit/delivery/configuration.mjs';
import { scopedContext, createInstance } from '../src/server/conversation-services/registry.mjs';
import { deliveryLibrary } from './helpers/revisit-delivery-fixtures.mjs';
import { createDiaryServer } from '../src/server/app.mjs';

const start = Date.parse('2026-01-01T00:00:00Z');
async function fixture() {
  const dir = path.resolve('tmp/revisit-algorithm-review/stores', randomUUID());
  await fs.mkdir(dir, { recursive: true });
  const db = deliveryLibrary(1);
  configureRevisit(db, { expectedRevision: 1, enabled: true });
  commitDeliveryPlan(db, planDeliveryTick(db, {}, start));
  const file = path.join(dir, 'diary.json');
  await fs.writeFile(file, JSON.stringify(db));
  const store = await createLibraryStore({ dataDir: dir, seed: false });
  let now = start;
  return {
    dir,
    file,
    store,
    setNow: (value) => {
      now = value;
    },
    service: createRevisitDeliveryService(createLibraryDeliveryPort(store), { clock: () => now }),
  };
}

test('waiting ticks skip clone, token, sources and disk while returning detached results', async () => {
  const { file, store, service } = await fixture();
  const db = store.getDb(),
    before = await fs.readFile(file);
  Object.defineProperty(db, 'entries', {
    configurable: true,
    get() {
      throw Error('whole-library-read');
    },
  });
  for (let i = 0; i < 10; i++) {
    const result = await service.tick();
    assert.equal(result.waitingForMinute, true);
    result.cursor = 'do-not-alias';
  }
  assert.equal(store.getDb(), db);
  assert.equal(db.revisit.cursor, new Date(start).toISOString());
  assert.deepEqual(await fs.readFile(file), before);
  await assert.rejects(fs.stat(file + '.tmp'), { code: 'ENOENT' });
});

test('preflight and planner use identical validation and waiting boundaries', () => {
  const db = deliveryLibrary(0);
  configureRevisit(db, { expectedRevision: 1, enabled: true });
  db.revisit.cursor = new Date(start).toISOString();
  for (const delta of [-1, 0, 1, 59999, 60000]) {
    const decision = preflightDeliveryTick(db, {}, start + delta);
    const plan = planDeliveryTick(db, {}, start + delta);
    if (decision) assert.deepEqual(decision.result, plan.result);
    else assert.equal(delta, 60000);
  }
  assert.throws(() => preflightDeliveryTick(db, { manual: 'yes' }, start), { status: 400 });
  assert.throws(() => preflightDeliveryTick(db, { to: start + 1 }, start), { status: 400 });
  assert.equal(
    preflightDeliveryTick({ ...db, revisit: undefined }, {}, start).result.disabled,
    true,
  );
  assert.equal(
    preflightDeliveryTick({ ...db, revisit: { ...db.revisit, version: 2 } }, {}, start),
    undefined,
  );
});

test('queued configuration and cursor writes are seen before no-op decisions', async () => {
  const { store, service, setNow } = await fixture();
  setNow(start + 60000);
  const configure = store.mutate((db) =>
    configureRevisit(db, { expectedRevision: 2, enabled: false }),
  );
  const disabledTick = service.tick();
  await configure;
  const configured = store.getDb();
  assert.equal((await disabledTick).disabled, true);
  assert.equal(store.getDb(), configured);
  const advance = store.mutate((db) => {
    db.revisit.config.enabled = true;
    db.revisit.cursor = new Date(start + 59999).toISOString();
  });
  const waitingTick = service.tick();
  await advance;
  const advanced = store.getDb();
  assert.equal((await waitingTick).waitingForMinute, true);
  assert.equal(store.getDb(), advanced);
});

test('initialization, random-day selection and empty progress remain durable across reopen', async () => {
  const { dir, store, service, setNow } = await fixture();
  await store.mutate((db) => {
    db.entries = [];
    db.messageStore.units = [];
    configureRevisit(db, { expectedRevision: 2, mode: 'daily-random', dailyTime: '08:00' });
    db.revisit.cursor = null;
  });
  assert.equal((await service.tick()).initialized, true);
  assert.equal(store.getDb().revisit.randomDays.length, 1);
  const initialized = store.getDb();
  setNow(start + 60000);
  assert.equal((await service.tick()).created, 0);
  assert.notEqual(store.getDb(), initialized);
  const reopened = await createLibraryStore({ dataDir: dir, seed: false });
  assert.equal(reopened.getDb().revisit.cursor, new Date(start + 59999).toISOString());
  assert.equal(reopened.getDb().revisit.randomDays.length, 1);
});

test('manual catchup persists and deduplicates; failed writes keep state and the queue usable', async () => {
  const { file, store, service, setNow } = await fixture();
  const input = {
    manual: true,
    from: new Date(start).toISOString(),
    to: new Date(start + 86400000).toISOString(),
  };
  setNow(start + 86400000);
  const original = structuredClone(store.getDb());
  await fs.mkdir(file + '.tmp');
  await assert.rejects(service.tick(input));
  assert.deepEqual(store.getDb(), original);
  await fs.rmdir(file + '.tmp');
  assert.equal((await service.tick(input)).created, 2);
  assert.equal((await service.tick(input)).created, 0);
  assert.equal(store.getDb().revisit.cursor, original.revisit.cursor);
  assert.deepEqual(store.getDb().entries, original.entries);
});

test('scoped instances forward preflight into the same writer queue without mixing state', async () => {
  const { store, service } = await fixture();
  const id = randomUUID();
  await store.mutate((db) => {
    createInstance(db, { id, providerId: 'revisit', name: '合成实例', config: { enabled: true } });
    db.conversationServices.instances[0].state.cursor = new Date(start).toISOString();
  });
  const scoped = createRevisitDeliveryService(createLibraryDeliveryPort(scopedContext(store, id)), {
    clock: () => start,
  });
  const before = store.getDb();
  const results = await Promise.all([scoped.tick(), service.tick(), scoped.tick()]);
  assert.ok(results.every((r) => r.waitingForMinute));
  assert.equal(store.getDb(), before);
});

test('preflight reads the clock when dequeued, and async checks fail without poisoning later work', async () => {
  const { store } = await fixture();
  let now = start;
  const service = createRevisitDeliveryService(createLibraryDeliveryPort(store), {
    clock: () => now,
  });
  const update = store.mutate(() => {
    now = start + 60000;
  });
  const tick = service.tick();
  await update;
  await tick;
  assert.equal(store.getDb().revisit.cursor, new Date(start + 59999).toISOString());
  await assert.rejects(
    store.mutate(() => {}, { preflight: async () => undefined }),
    /同步/,
  );
  await store.mutate((db) => {
    db.syntheticQueueRecovered = true;
  });
  assert.equal(store.getDb().syntheticQueueRecovered, true);
});

test('isolated HTTP waiting and disabled requests preserve exact file bytes and modification time', async (t) => {
  for (const state of ['waiting', 'disabled-no-state']) {
    const { dir, file } = await fixture();
    const db = JSON.parse(await fs.readFile(file, 'utf8'));
    if (state === 'waiting') db.revisit.cursor = new Date(Date.now() + 3600000).toISOString();
    else delete db.revisit;
    await fs.writeFile(file, JSON.stringify(db));
    const server = await createDiaryServer({ dataDir: dir, seed: false, revisitAutoStart: false });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const before = await fs.readFile(file),
      stamp = (await fs.stat(file)).mtimeMs;
    for (let i = 0; i < 3; i++) {
      const response = await fetch(base + '/api/revisit/tick', {
        method: 'POST',
        headers: { 'X-Diary-Client': 'desktop' },
        body: '{}',
      });
      assert.equal(response.status, 200);
      assert.equal(
        (await response.json())[state === 'waiting' ? 'waitingForClock' : 'disabled'],
        true,
      );
    }
    assert.deepEqual(await fs.readFile(file), before);
    assert.equal((await fs.stat(file)).mtimeMs, stamp);
  }
});
