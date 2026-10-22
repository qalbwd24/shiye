import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  planRevisitWindow,
  REVISIT_ENGINE_VERSION,
} from '../src/server/domain/revisit/engine/index.mjs';

const source = (id, instant, category = '日常') => ({
  ref: { entryId: 'entry-' + id, unitId: id },
  eventTime: { instant },
  category,
});
const request = (sources, overrides = {}) => ({
  version: REVISIT_ENGINE_VERSION,
  sources,
  rule: { interval: { unit: 'year', count: 1 }, categories: [] },
  window: {
    after: Date.parse('2026-10-17T00:00:00Z'),
    through: Date.parse('2026-10-17T01:00:00Z'),
  },
  timeZone: 'Asia/Shanghai',
  ...overrides,
});
const freeze = (value) => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

test('pure engine groups annual multiples using only source references, clock and category', () => {
  const a = source('a', '2024-10-17T00:30:00.000Z'),
    b = source('b', '2025-10-17T00:30:40.000Z');
  Object.defineProperty(a, 'body', {
    get() {
      throw Error('Engine must never read body');
    },
  });
  const input = freeze(request([a, b]));
  const before = structuredClone(input);
  const plan = planRevisitWindow(input);
  assert.deepEqual(input, before);
  assert.equal(plan.groups.length, 1);
  assert.deepEqual(plan.groups[0].occurrences, [
    { ref: a.ref, replayAt: '2026-10-17T00:30:00.000Z', originalAt: a.eventTime.instant },
    { ref: b.ref, replayAt: '2026-10-17T00:30:40.000Z', originalAt: b.eventTime.instant },
  ]);
  plan.groups[0].occurrences[0].ref.unitId = 'changed-output-only';
  assert.equal(a.ref.unitId, 'a');
  assert.deepEqual(planRevisitWindow(input), planRevisitWindow(before));
});

test('window is left-open right-closed and category selection stays outside content', () => {
  const input = request([
    source('start', '2025-10-17T00:00:00.000Z'),
    source('end', '2025-10-17T01:00:00.000Z'),
    source('other', '2025-10-17T00:20:00.000Z', '学习'),
  ]);
  input.rule.categories = ['日常'];
  assert.deepEqual(
    planRevisitWindow(input).groups.flatMap((group) =>
      group.occurrences.map((item) => item.ref.unitId),
    ),
    ['end'],
  );
});

test('multi-day planning deduplicates annual occurrences and supports repeated daily occurrences', () => {
  const item = source('a', '2025-10-17T00:30:00.000Z');
  const input = request([item, structuredClone(item)], {
    window: {
      after: Date.parse('2026-10-16T00:00:00Z'),
      through: Date.parse('2026-10-18T01:00:00Z'),
    },
  });
  assert.equal(planRevisitWindow(input).groups.flatMap((group) => group.occurrences).length, 1);
  input.sources = [source('daily', '2026-10-15T00:30:00.000Z')];
  input.rule.interval.unit = 'day';
  assert.equal(planRevisitWindow(input).groups.flatMap((group) => group.occurrences).length, 3);
});

test('leap dates, month ends and DST gaps skip impossible times in an explicit timezone', () => {
  const plan = (instant, day, unit, timeZone = 'Asia/Shanghai') =>
    planRevisitWindow(
      request([source('a', instant)], {
        rule: { interval: { unit, count: 1 }, categories: [] },
        window: { after: Date.parse(day + 'T00:00:00Z'), through: Date.parse(day + 'T23:59:59Z') },
        timeZone,
      }),
    );
  assert.equal(plan('2024-02-29T01:00:00.000Z', '2025-02-28', 'year').groups.length, 0);
  assert.equal(plan('2025-01-31T01:00:00.000Z', '2025-02-28', 'month').groups.length, 0);
  assert.equal(
    plan('2024-03-09T10:30:00.000Z', '2025-03-09', 'year', 'America/Los_Angeles').groups.length,
    0,
  );
});

test('contracts reject bad versions, unresolved system timezone, invalid sources and intervals', () => {
  assert.throws(() => planRevisitWindow(request([], { version: 2 })), /契约版本/);
  assert.throws(() => planRevisitWindow(request([], { timeZone: 'system' })), /先解析/);
  const bad = request([source('a', 'not-a-time')]);
  assert.throws(() => planRevisitWindow(bad), /来源契约/);
  assert.throws(
    () => planRevisitWindow(request([source('local-clock', '2025-10-17T00:30:00')])),
    /来源契约/,
  );
  assert.throws(
    () =>
      planRevisitWindow(
        request([], { rule: { interval: { unit: 'year', count: 0 }, categories: [] } }),
      ),
    /间隔/,
  );
});

test('engine modules have no server, persistence, UI, network, timer or wall-clock dependencies', async () => {
  const root = path.resolve('src/server/domain/revisit/engine');
  for (const name of ['index.mjs', 'calendar.mjs', 'contracts.mjs']) {
    const code = await fs.readFile(path.join(root, name), 'utf8');
    assert.ok(
      !/node:|\bprocess\.|Date\.now\s*\(|setInterval\s*\(|fetch\s*\(|\bdocument\.|revisit-sources|message-store|http\.mjs/.test(
        code,
      ),
      name,
    );
    for (const match of code.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g))
      assert.ok(match[1].startsWith('./'), name);
  }
});
