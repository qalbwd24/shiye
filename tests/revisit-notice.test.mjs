import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHistoryNoticePublisher } from '../previews/telegram-chat/shiye-revisit-view.js';
import { createRevisitClient } from '../previews/telegram-chat/shiye-revisit-client.js';
test('enable and explicit refresh publish a fixed historic date, ordinary polls do not spam', () => {
  const events = [],
    publish = createHistoryNoticePublisher((notice) => events.push(notice));
  const state = {
    config: { enabled: true },
    randomDay: {
      ruleRevision: 1,
      date: '2024-10-17',
      cycleStart: '2026-10-17T00:00:00Z',
      timeZone: 'Asia/Shanghai',
    },
  };
  const original = structuredClone(state);
  assert.equal(publish(state).reason, 'enable');
  assert.equal(publish(state), null);
  assert.equal(publish(state, 'refresh').reason, 'refresh');
  assert.equal(events[0].displayDate, '24-10-17');
  assert.deepEqual(state, original);
  assert.ok(
    events.every((item) => !Object.hasOwn(item, 'entryId') && !Object.hasOwn(item, 'deliveryId')),
  );
  state.randomDay = { ...state.randomDay, date: '2025-05-01', cycleStart: '2026-10-18T00:00:00Z' };
  assert.equal(publish(state).reason, 'day-change');
  assert.equal(publish(state), null);
});
test('locked and disabled states do not reveal a historic date; re-enable announces again', () => {
  const events = [],
    publish = createHistoryNoticePublisher((notice) => events.push(notice));
  const state = {
    config: { enabled: true },
    randomDay: {
      ruleRevision: 1,
      date: null,
      cycleStart: '2026-10-17T00:00:00Z',
      timeZone: 'Asia/Shanghai',
    },
  };
  assert.equal(publish({ ...state, locked: true }, 'refresh'), null);
  assert.equal(publish({ ...state, config: { enabled: false } }), null);
  assert.equal(events.length, 0);
  assert.equal(publish(state).sourceDate, null);
  publish({ ...state, config: { enabled: false } });
  assert.equal(publish(state).reason, 'enable');
});

test('receiver exposes the selected day and emits lifecycle notices without generating messages or writes', async () => {
  const events = [],
    commands = [];
  let locked = false;
  const config = { enabled: true, timeZone: 'Asia/Shanghai' };
  const randomDay = {
    ruleRevision: 1,
    date: '2024-10-17',
    cycleStart: '2026-10-17T00:00:00Z',
    timeZone: 'Asia/Shanghai',
  };
  const client = createRevisitClient({
    api: async (action) => {
      if (locked) throw Object.assign(Error('locked'), { status: 401 });
      return action === 'status'
        ? { config, randomDay }
        : { deliveries: [], batches: [], next: 0, total: 0 };
    },
    readLibrary: async () => ({ shiyeRevisit: { roomId: '-900000001' } }),
    command: async (action) => {
      commands.push(action);
    },
    onNotice: (notice) => events.push(notice),
  });
  await client.sync();
  assert.deepEqual(client.status().randomDay, randomDay);
  await client.sync();
  assert.equal(events.length, 1);
  await client.sync({ reason: 'refresh' });
  assert.equal(events.length, 2);
  assert.equal(events[1].reason, 'refresh');
  locked = true;
  await assert.rejects(client.sync(), /locked/);
  assert.equal(client.status().randomDay, null);
  assert.equal(client.status().config, null);
  locked = false;
  await client.sync();
  assert.equal(events.at(-1).reason, 'enable');
  assert.ok(commands.every((action) => ['program-feed', 'program-clear'].includes(action)));
});

test('random-to-interval replaces the historic day notice and clears it while selection initializes', () => {
  const events = [],
    publish = createHistoryNoticePublisher((x) => events.push(x));
  const state = {
    config: { enabled: true, mode: 'daily-random' },
    randomDay: {
      ruleRevision: 1,
      date: '2025-10-23',
      cycleStart: '2026-10-18T00:00:00Z',
      timeZone: 'Asia/Shanghai',
    },
  };
  publish(state);
  const interval = {
    ...state,
    config: {
      enabled: true,
      mode: 'interval',
      ruleRevision: 2,
      interval: { unit: 'month', count: 6 },
      timeZone: 'Asia/Shanghai',
    },
  };
  const notice = publish(interval, 'settings');
  assert.equal(notice.kind, 'history-interval');
  assert.equal(notice.interval.count, 6);
  assert.equal(notice.displayDate, undefined);
  assert.equal(publish(interval), null);
  assert.equal(events.length, 2);
  publish({ ...state, randomDay: null }, 'settings');
  assert.equal(events.at(-1), null);
  assert.equal(publish(state).kind, 'history-day');
});

test('explicit settings refresh waits for a stale poll then actually fetches the new mode', async () => {
  let release,
    signal,
    calls = 0;
  const held = new Promise((r) => {
      release = r;
    }),
    started = new Promise((r) => {
      signal = r;
    });
  let status = {
    config: { enabled: true, mode: 'daily-random' },
    randomDay: {
      ruleRevision: 1,
      date: '2025-10-23',
      cycleStart: '2026-10-18T00:00:00Z',
      timeZone: 'Asia/Shanghai',
    },
  };
  const events = [];
  const client = createRevisitClient({
    readLibrary: async () => ({}),
    command: async () => {},
    onNotice: (x) => events.push(x),
    api: async (action) => {
      if (action === 'status') {
        calls++;
        const value = structuredClone(status);
        if (calls === 1) {
          signal();
          await held;
        }
        return value;
      }
      return { deliveries: [], batches: [], next: 0, total: 0 };
    },
  });
  const poll = client.sync();
  await started;
  status = {
    config: {
      enabled: true,
      mode: 'interval',
      interval: { unit: 'month', count: 6 },
      ruleRevision: 2,
      timeZone: 'Asia/Shanghai',
    },
  };
  const refresh = client.sync({ reason: 'settings' });
  release();
  await Promise.all([poll, refresh]);
  assert.equal(calls, 2);
  assert.equal(client.status().config.mode, 'interval');
  assert.equal(client.status().randomDay, null);
  assert.equal(events.at(-1).kind, 'history-interval');
  assert.equal(events.at(-1).reason, 'settings');
});
