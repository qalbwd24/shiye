import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  planDailyRandom,
  currentRandomDay,
  assertDailySelections,
} from '../src/server/domain/revisit/delivery/daily-random.mjs';
import { configureRevisit, tickRevisit } from '../src/server/domain/revisit.mjs';
import {
  exportRevisitArchive,
  restoreRevisitArchive,
  validateRevisitState,
  stateToken,
} from '../src/server/domain/revisit/delivery/archive.mjs';
import { sourceLibrary } from './helpers/revisit-source-fixtures.mjs';
import { revisitSources } from '../src/server/domain/revisit-sources.mjs';
import { createDiaryServer } from '../src/server/app.mjs';

const config = { mode: 'daily-random', dailyTime: '08:00', ruleRevision: 1, categories: [] };
const at = (value) => Date.parse(value);
const source = (id, instant, category = '日常') => ({
  ref: { entryId: id, unitId: 'unit-' + id },
  unit: { eventTime: { instant } },
  entry: { category },
});
const initial = () => ({ config, randomDays: [] });
function plan(state, sources, after, through, extra = {}) {
  return planDailyRandom({
    state,
    sources,
    config: state.config,
    after: at(after),
    through: at(through),
    now: at(through),
    timeZone: 'Asia/Shanghai',
    chooseIndex: () => 0,
    ...extra,
  });
}

test('random day chooses among dates, not message counts; selection survives serialization and source changes', () => {
  const state = initial(),
    sources = [
      source('a', '2024-04-01T01:00:00Z'),
      source('b', '2024-04-01T02:00:00Z'),
      source('c', '2025-05-02T01:00:00Z'),
    ];
  let choices = 0;
  const result = plan(state, sources, '2026-10-17T00:00:00Z', '2026-10-17T03:00:00Z', {
    chooseIndex: (size) => {
      choices++;
      assert.equal(size, 2);
      return 1;
    },
  });
  assert.equal(state.randomDays[0].date, '2025-05-02');
  assert.equal(result.groups.flatMap((g) => g.occurrences).length, 1);
  const restored = JSON.parse(JSON.stringify(state));
  plan(restored, [sources[0]], '2026-10-17T03:00:00Z', '2026-10-17T04:00:00Z', {
    chooseIndex: () => {
      throw Error('must not redraw');
    },
  });
  assert.equal(restored.randomDays[0].date, '2025-05-02');
  assert.equal(choices, 1);
  assertDailySelections(restored);
});

test('08:00 reset maps morning/evening and next-day midnight into the same fixed cycle with original seconds', () => {
  const state = initial();
  const sources = [
    source('morning', '2025-05-02T01:15:31Z'),
    source('night', '2025-05-01T18:20:45Z'),
  ];
  const result = plan(state, sources, '2026-10-17T00:00:00Z', '2026-10-17T23:59:59Z');
  assert.deepEqual(
    result.groups.flatMap((g) => g.occurrences).map((x) => [x.ref.entryId, x.replayAt]),
    [
      ['morning', '2026-10-17T01:15:31.000Z'],
      ['night', '2026-10-17T18:20:45.000Z'],
    ],
  );
  assert.equal(state.randomDays[0].cycleStart, '2026-10-17T00:00:00.000Z');
  assert.equal(state.randomDays[0].cycleEnd, '2026-10-18T00:00:00.000Z');
  assert.equal(state.randomDays[0].date, '2025-05-02');
});

test('reset rotates once and window boundaries never double-send an exact timestamp', () => {
  const state = initial(),
    sources = [source('a', '2025-05-02T00:00:00Z')];
  const first = plan(state, sources, '2026-10-17T00:00:00Z', '2026-10-18T00:00:00Z');
  assert.equal(first.groups.flatMap((g) => g.occurrences).length, 1);
  const next = plan(state, sources, '2026-10-18T00:00:00Z', '2026-10-18T00:01:00Z');
  assert.equal(next.groups.length, 0);
  assert.equal(state.randomDays.length, 2);
  assert.equal(
    currentRandomDay(state, at('2026-10-18T00:00:00Z'), 1).cycleStart,
    '2026-10-18T00:00:00.000Z',
  );
});

test('only configured categories and strictly historical dates can enter the daily draw', () => {
  const state = initial();
  state.config = { ...config, categories: ['日常'] };
  plan(
    state,
    [
      source('future', '2026-10-17T01:00:00Z'),
      source('hidden-by-category', '2025-05-02T01:00:00Z', '工作'),
    ],
    '2026-10-17T00:00:00Z',
    '2026-10-17T04:00:00Z',
  );
  assert.equal(state.randomDays[0].date, null);
  plan(
    state,
    [source('later-import', '2025-05-02T01:00:00Z')],
    '2026-10-17T04:00:00Z',
    '2026-10-17T05:00:00Z',
  );
  assert.equal(state.randomDays[0].date, null);
});

test('source date floor uses source local date inclusively, not UTC or entry date; empty pools stay empty', () => {
  const state = initial();
  state.config = { ...config, sourceDateFrom: '2025-10-01' };
  const sources = [
    source('older', '2025-09-30T15:59:59Z'),
    source('boundary', '2025-09-30T16:00:00Z'),
    source('later', '2025-10-02T01:00:00Z'),
  ];
  let choices;
  plan(state, sources, '2026-10-17T00:00:00Z', '2026-10-17T23:59:59Z', {
    chooseIndex: (size) => {
      choices = size;
      return 0;
    },
  });
  assert.equal(choices, 2);
  assert.equal(state.randomDays[0].date, '2025-10-01');
  const empty = initial();
  empty.config = { ...config, sourceDateFrom: '2026-10-01' };
  assert.equal(
    plan(empty, sources, '2026-10-17T00:00:00Z', '2026-10-17T01:00:00Z').groups.length,
    0,
  );
  assert.equal(empty.randomDays[0].date, null);
});

test('custom source range includes both civil date edges and allows either open edge', () => {
  const sources = [
    source('before', '2025-09-30T15:59:59Z'),
    source('start', '2025-09-30T16:00:00Z'),
    source('end', '2025-10-02T15:59:59Z'),
    source('after', '2025-10-02T16:00:00Z'),
  ];
  for (const [fields, expected] of [
    [{ sourceDateFrom: '2025-10-01', sourceDateTo: '2025-10-02' }, 2],
    [{ sourceDateTo: '2025-10-02' }, 3],
    [{ sourceDateFrom: null, sourceDateTo: null }, 4],
  ]) {
    const state = initial();
    state.config = { ...config, ...fields };
    plan(state, sources, '2026-10-17T00:00:00Z', '2026-10-17T23:59:59Z', {
      chooseIndex: (size) => {
        assert.equal(size, expected);
        return size - 1;
      },
    });
    if (fields.sourceDateTo) assert.equal(state.randomDays[0].date, '2025-10-02');
  }
  const db = sourceLibrary();
  for (const patch of [
    { sourceDateTo: '2025-02-30' },
    { sourceDateFrom: '2025-10-02', sourceDateTo: '2025-10-01' },
  ])
    assert.throws(() => configureRevisit(db, { expectedRevision: 1, ...patch }), { status: 400 });
  configureRevisit(db, {
    expectedRevision: 1,
    sourceDateFrom: '2025-10-01',
    sourceDateTo: '2025-10-02',
  });
  const rule = db.revisit.config.ruleRevision;
  configureRevisit(db, { expectedRevision: 2, sourceDateTo: null });
  assert.equal(db.revisit.config.sourceDateFrom, '2025-10-01');
  assert.equal(db.revisit.config.ruleRevision, rule + 1);
  const state = structuredClone(db.revisit);
  state.config.sourceDateTo = '2025-09-30';
  assert.throws(() => validateRevisitState(state, db), { status: 400 });
});

test('changing source floor redraws only the new rule, retains prior records and survives old UI saves/archive', () => {
  const db = sourceLibrary();
  configureRevisit(db, { expectedRevision: 1, enabled: true, mode: 'daily-random' });
  tickRevisit(db, {}, at('2026-10-17T00:00:00Z'));
  tickRevisit(db, {}, at('2026-10-18T00:00:00Z'));
  const previous = structuredClone(db.revisit),
    originals = JSON.stringify([db.entries, db.media, db.messageStore]);
  configureRevisit(db, { expectedRevision: 2, sourceDateFrom: '2025-10-18' });
  assert.equal(db.revisit.cursor, null);
  assert.equal(db.revisit.config.ruleRevision, previous.config.ruleRevision + 1);
  for (const key of ['randomDays', 'deliveries', 'batches', 'comments'])
    assert.deepEqual(db.revisit[key], previous[key]);
  tickRevisit(db, {}, at('2026-10-18T01:00:00Z'));
  assert.equal(
    currentRandomDay(db.revisit, at('2026-10-18T01:00:00Z'), db.revisit.config.ruleRevision).date,
    null,
  );
  configureRevisit(db, { expectedRevision: 3, title: '旧前端保存其他设置' });
  assert.equal(db.revisit.config.sourceDateFrom, '2025-10-18');
  const target = sourceLibrary(),
    archive = exportRevisitArchive(db);
  restoreRevisitArchive(target, { archive, expectedToken: stateToken(target) });
  assert.deepEqual(target.revisit, db.revisit);
  assert.equal(JSON.stringify([db.entries, db.media, db.messageStore]), originals);
  for (const value of ['', '2025-02-30', '2025-13-01', '25-10-01', 0, false])
    assert.throws(() => configureRevisit(db, { expectedRevision: 4, sourceDateFrom: value }), {
      status: 400,
    });
  const bad = structuredClone(db.revisit);
  bad.config.sourceDateFrom = '2025-02-30';
  assert.throws(() => validateRevisitState(bad, db), { status: 400 });
  configureRevisit(db, { expectedRevision: 4, sourceDateFrom: null });
  assert.equal(db.revisit.config.sourceDateFrom, null);
});

test('system-zone spring gap reset advances to valid time, missing historical civil clocks are skipped', () => {
  const state = initial();
  state.config = { ...config, dailyTime: '02:30' };
  plan(
    state,
    [source('gap', '2025-02-01T07:45:00Z')],
    '2026-03-08T07:00:00Z',
    '2026-03-08T09:00:00Z',
    { timeZone: 'America/New_York' },
  );
  assert.equal(state.randomDays[0].cycleStart, '2026-03-08T07:00:00.000Z');
  assertDailySelections(state);
});

test('configured random replay initializes at startup, catches up, is idempotent and never edits source data', () => {
  const db = sourceLibrary(),
    original = JSON.stringify([db.entries, db.media, db.messageStore]);
  configureRevisit(db, {
    expectedRevision: 1,
    enabled: true,
    mode: 'daily-random',
    dailyTime: '08:00',
  });
  tickRevisit(db, {}, at('2026-10-17T00:00:00Z'));
  assert.equal(db.revisit.deliveries.length, 0);
  assert.equal(db.revisit.randomDays.length, 1);
  assert.equal(db.revisit.randomDays[0].date, '2025-10-17');
  tickRevisit(db, {}, at('2026-10-18T00:00:00Z'));
  const ids = db.revisit.deliveries.map((d) => d.id);
  assert.equal(ids.length, revisitSources(db).sources.length);
  tickRevisit(db, {}, at('2026-10-18T00:00:00Z'));
  assert.deepEqual(
    db.revisit.deliveries.map((d) => d.id),
    ids,
  );
  assert.equal(JSON.stringify([db.entries, db.media, db.messageStore]), original);
  validateRevisitState(db.revisit, db);
  const cursor = db.revisit.cursor;
  tickRevisit(
    db,
    { manual: true, from: '2026-10-17T00:00:00Z', to: '2026-10-18T00:00:00Z' },
    at('2026-10-18T00:00:00Z'),
  );
  assert.equal(db.revisit.cursor, cursor);
  assert.deepEqual(
    db.revisit.deliveries.map((d) => d.id),
    ids,
  );
});

test('caught-up cursor does not report the current unfinished minute as backlog or trigger a fast retry loop', () => {
  const db = sourceLibrary();
  configureRevisit(db, {
    expectedRevision: 1,
    enabled: true,
    mode: 'daily-random',
    dailyTime: '08:00',
  });
  tickRevisit(db, {}, at('2026-10-17T00:00:15Z'));
  assert.equal(tickRevisit(db, {}, at('2026-10-17T00:01:15Z')).remaining, false);
  const snapshot = JSON.stringify(db.revisit);
  assert.equal(tickRevisit(db, {}, at('2026-10-17T00:01:16Z')).waitingForMinute, true);
  assert.equal(JSON.stringify(db.revisit), snapshot);
});

test('selection state restores with the same source and malformed daily archive fields are rejected', () => {
  const db = sourceLibrary();
  configureRevisit(db, {
    expectedRevision: 1,
    enabled: true,
    mode: 'daily-random',
    dailyTime: '08:00',
  });
  tickRevisit(db, {}, at('2026-10-17T00:00:00Z'));
  const archive = exportRevisitArchive(db),
    target = sourceLibrary();
  restoreRevisitArchive(target, { archive, expectedToken: stateToken(target) });
  assert.deepEqual(target.revisit, db.revisit);
  for (const patch of [
    { date: '2025-02-30' },
    { resetTime: '25:00' },
    { cycleEnd: '2026-10-19T00:00:00.000Z' },
    { date: '2026-10-18' },
  ]) {
    const state = structuredClone(db.revisit);
    Object.assign(state.randomDays[0], patch);
    assert.throws(() => validateRevisitState(state, db), { status: 400 });
  }
});

test('mode, timezone and reset changes reset only progress; sender/name edits preserve selection', () => {
  const db = sourceLibrary();
  configureRevisit(db, {
    expectedRevision: 1,
    enabled: true,
    mode: 'daily-random',
    dailyTime: '08:00',
  });
  tickRevisit(db, {}, at('2026-10-17T00:00:00Z'));
  const selected = JSON.stringify(db.revisit.randomDays),
    cursor = db.revisit.cursor;
  configureRevisit(db, { expectedRevision: 2, sender: { name: '换个名字' } });
  assert.equal(db.revisit.cursor, cursor);
  assert.equal(JSON.stringify(db.revisit.randomDays), selected);
  configureRevisit(db, { expectedRevision: 3, dailyTime: '09:00' });
  assert.equal(db.revisit.cursor, null);
  for (const dailyTime of ['8:00', '24:00', '', null])
    assert.throws(() => configureRevisit(db, { expectedRevision: 4, dailyTime }), { status: 400 });
});

test('real HTTP configuration, concurrent initialization and server restart retain one daily selection', async (t) => {
  const dir = path.resolve('tmp/revisit-end-to-end-ui21/daily-tests', randomUUID());
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'diary.json'), JSON.stringify(sourceLibrary()));
  let server, base;
  const open = async () => {
    server = await createDiaryServer({ dataDir: dir, seed: false });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = 'http://127.0.0.1:' + server.address().port;
  };
  const close = async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  };
  await open();
  t.after(close);
  async function request(route, method = 'GET', input = {}) {
    const r = await fetch(base + route, {
      method,
      headers: { 'X-Diary-Client': 'desktop' },
      ...(method === 'GET' ? {} : { body: JSON.stringify(input) }),
    });
    assert.equal(r.status, 200);
    return r.json();
  }
  await request('/api/revisit/config', 'PUT', {
    expectedRevision: 1,
    enabled: true,
    mode: 'daily-random',
    dailyTime: '08:00',
  });
  await Promise.all(Array.from({ length: 8 }, () => request('/api/revisit/tick', 'POST')));
  const selection = (await request('/api/revisit')).randomDay;
  assert.ok(selection?.cycleStart);
  await close();
  await open();
  assert.deepEqual((await request('/api/revisit')).randomDay, selection);
  const stored = JSON.parse(await fs.readFile(path.join(dir, 'diary.json'), 'utf8'));
  assert.equal(stored.revisit.randomDays.length, 1);
});
