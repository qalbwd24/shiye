import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, sample } from './helpers.mjs';
import {
  setTimeZone,
  dateParts,
  zonedDay,
  zonedInput,
  parseZonedInput,
  normalizeTimeZone,
  resolveTimeZone,
} from '../public/shared/time-zone.js';
import { formatLocalDateTime } from '../public/features/editor-input.js';
import { statistics, recall } from '../public/shared/insights.js';

test('Beijing display and wall-clock editing preserve the absolute recorded instant across the date boundary', () => {
  const value = '2026-10-15T19:09:11.550Z';
  setTimeZone('Asia/Shanghai');
  try {
    assert.equal(zonedInput(value), '2026-10-16T03:09');
    assert.equal(zonedDay(value), '2026-10-16');
    assert.equal(formatLocalDateTime(new Date(value)), '[2026/10/16  03:09:11]');
    assert.equal(parseZonedInput('2026-10-16T03:09:11').toISOString(), '2026-10-15T19:09:11.000Z');
    assert.equal(parseZonedInput('2026-10-16T03:09').toISOString(), '2026-10-15T19:09:00.000Z');
    assert.throws(() => parseZonedInput('2026-02-30T03:09'));
    setTimeZone('system');
    assert.equal(resolveTimeZone(), Intl.DateTimeFormat().resolvedOptions().timeZone);
    assert.equal(dateParts(value, 'America/Los_Angeles').hour, '12');
  } finally {
    setTimeZone('system');
  }
});

test('day statistics and recollections agree with the selected zone at year and midnight boundaries', () => {
  setTimeZone('Asia/Shanghai');
  try {
    const entries = [
      { id: 'a', date: '2025-12-31T20:00:00Z', content: '甲', tags: [], attachments: [] },
    ];
    const s = statistics(entries, [], (v) => v, {
      year: 2026,
      now: new Date('2026-01-01T00:00:00Z'),
    });
    assert.equal(s.count, 1);
    assert.equal(s.months[0], 1);
    assert.deepEqual(Object.keys(s.days), ['2026-01-01']);
    assert.equal(recall(entries, { date: new Date('2026-12-31T20:00:00Z'), period: 12 }).length, 1);
    assert.throws(() => parseZonedInput('2026-03-08T02:30', 'America/Los_Angeles'), /不存在/);
    assert.equal(
      parseZonedInput('2026-11-01T01:30', 'America/Los_Angeles').toISOString(),
      '2026-11-01T08:30:00.000Z',
    );
  } finally {
    setTimeZone('system');
  }
});

test('time-zone preference survives reload without changing entry content, timestamps or revision', async (t) => {
  const { request } = await fixture(t);
  const entry = await (await request('/api/entries', 'POST', sample)).json();
  assert.equal(
    (await request('/api/preferences', 'PUT', { timeZone: 'Asia/Shanghai' })).status,
    200,
  );
  assert.deepEqual(await (await request('/api/entries/' + entry.id)).json(), entry);
  const lib = await (await request('/api/library')).json();
  assert.equal(lib.settings.preferences.timeZone, 'Asia/Shanghai');
  assert.equal((await request('/api/preferences', 'PUT', { timeZone: 'system' })).status, 200);
  assert.equal(
    (await request('/api/preferences', 'PUT', { timeZone: 'invalid/zone' })).status,
    400,
  );
  assert.throws(() => normalizeTimeZone({}), /时区/);
});
