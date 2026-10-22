import { randomInt } from 'node:crypto';
import { calendar, fromCalendar } from '../engine/calendar.mjs';
import { isUTCInstant } from '../engine/contracts.mjs';

const DAY = 86400000;
const dateParts = (day) => {
  const value = new Date(day);
  return [value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate()];
};
const dayOf = (parts) => Date.UTC(parts[0], parts[1] - 1, parts[2]);
const dateKey = (day) => new Date(day).toISOString().slice(0, 10);
export const validDailyTime = (value) =>
  typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
export const validSourceDate = (value) =>
  typeof value === 'string' &&
  /^\d{4}-\d\d-\d\d$/.test(value) &&
  Number.isFinite(Date.parse(value + 'T00:00:00Z')) &&
  new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;

function boundary(day, minutes, zone) {
  // A nonexistent system-zone reset clock advances to the next valid civil minute.
  for (let shift = 0; shift <= 180; shift++) {
    const total = minutes + shift;
    const instant = fromCalendar(
      [
        ...dateParts(day + Math.floor(total / 1440) * DAY),
        Math.floor(total / 60) % 24,
        total % 60,
        0,
      ],
      zone,
    );
    if (instant !== null) return instant;
  }
  throw Error('daily reset clock unavailable');
}

/** Plan against owned state only. Selection is committed with the server cursor, never by UI. */
export function planDailyRandom({
  sources,
  config,
  state,
  after,
  through,
  now,
  timeZone,
  chooseIndex = randomInt,
}) {
  const [hour, minute] = (config.dailyTime || '08:00').split(':').map(Number);
  const reset = hour * 60 + minute;
  const first = calendar(after, timeZone),
    last = calendar(through, timeZone);
  let firstDay = dayOf(first);
  if (after < boundary(firstDay, reset, timeZone)) firstDay -= DAY;
  const groupedSources = new Map();
  for (const source of sources) {
    if (config.categories.length && !config.categories.includes(source.entry.category)) continue;
    const original = calendar(source.unit.eventTime.instant, timeZone),
      key = dateKey(dayOf(original));
    if (config.sourceDateFrom && key < config.sourceDateFrom) continue;
    if (config.sourceDateTo && key > config.sourceDateTo) continue;
    if (!groupedSources.has(key)) groupedSources.set(key, []);
    groupedSources.get(key).push({ source, original });
  }
  state.randomDays ||= [];
  const groups = new Map();
  for (let day = firstDay; day <= dayOf(last); day += DAY) {
    const start = boundary(day, reset, timeZone),
      end = boundary(day + DAY, reset, timeZone);
    if (start > through) break;
    let selection = state.randomDays.find(
      (item) =>
        item.ruleRevision === config.ruleRevision &&
        item.cycleStart === new Date(start).toISOString(),
    );
    if (!selection) {
      const eligible = [...groupedSources.keys()].filter((key) => key < dateKey(day)).sort();
      const index = eligible.length ? chooseIndex(eligible.length) : 0;
      if (!Number.isInteger(index) || index < 0 || (eligible.length && index >= eligible.length))
        throw Error('invalid daily selection');
      selection = {
        ruleRevision: config.ruleRevision,
        cycleStart: new Date(start).toISOString(),
        cycleEnd: new Date(end).toISOString(),
        date: eligible[index] || null,
        timeZone,
        resetTime: config.dailyTime || '08:00',
        createdAt: new Date(now).toISOString(),
      };
      state.randomDays.push(selection);
    }
    for (const { source, original } of groupedSources.get(selection.date) || []) {
      const targetDay = original[3] * 60 + original[4] < reset ? day + DAY : day;
      const due = fromCalendar([...dateParts(targetDay), ...original.slice(3)], timeZone);
      if (due === null || due < start || due >= end || due <= after || due > through) continue;
      const group = Math.floor(due / 60000);
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push({
        ref: structuredClone(source.ref),
        replayAt: new Date(due).toISOString(),
        originalAt: source.unit.eventTime.instant,
      });
    }
  }
  return {
    groups: [...groups]
      .sort(([a], [b]) => a - b)
      .map(([minute, occurrences]) => ({ minute, occurrences })),
  };
}

export function currentRandomDay(state, now, revision) {
  return (
    state?.randomDays?.find(
      (item) =>
        item.ruleRevision === revision &&
        Date.parse(item.cycleStart) <= now &&
        now < Date.parse(item.cycleEnd),
    ) || null
  );
}

export function assertDailySelections(state) {
  if (state.randomDays === undefined) return;
  if (!Array.isArray(state.randomDays)) throw Error('invalid daily selections');
  const seen = new Set();
  for (const item of state.randomDays) {
    if (
      !item ||
      !Number.isSafeInteger(item.ruleRevision) ||
      item.ruleRevision < 1 ||
      item.ruleRevision > state.config.ruleRevision ||
      !['cycleStart', 'cycleEnd', 'createdAt'].every((key) => isUTCInstant(item[key])) ||
      !validDailyTime(item.resetTime) ||
      typeof item.timeZone !== 'string' ||
      item.timeZone === 'system'
    )
      throw Error('invalid daily selection');
    const start = Date.parse(item.cycleStart),
      day = dayOf(calendar(start, item.timeZone));
    const [hour, minute] = item.resetTime.split(':').map(Number),
      key = item.ruleRevision + ':' + item.cycleStart;
    if (
      seen.has(key) ||
      start !== boundary(day, hour * 60 + minute, item.timeZone) ||
      Date.parse(item.cycleEnd) !== boundary(day + DAY, hour * 60 + minute, item.timeZone) ||
      (item.date !== null &&
        (typeof item.date !== 'string' ||
          !/^\d{4}-\d\d-\d\d$/.test(item.date) ||
          !Number.isFinite(Date.parse(item.date + 'T00:00:00Z')) ||
          new Date(item.date + 'T00:00:00Z').toISOString().slice(0, 10) !== item.date ||
          item.date >= dateKey(day)))
    )
      throw Error('invalid daily selection');
    seen.add(key);
  }
}
