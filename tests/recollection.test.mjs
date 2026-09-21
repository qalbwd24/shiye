import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  recollectionEntries,
  shuffledRecollection,
  normalizeRecollectionSession,
  reconcileRecollection,
  advanceRecollection,
  restartRecollection,
} from '../public/shared/memories.js';
import {
  createRecollection,
  fadeRecollectionOut,
  normalizeRecollectionPreferences,
} from '../public/features/recollection.js';

const entry = (id, extra = {}) => ({
  id,
  date: '2025-05-03T12:00:00',
  category: '学习',
  content: 'synthetic',
  attachments: [],
  ...extra,
});

test('recollection scope uses local calendar days and excludes hidden/deleted/draft live entries', () => {
  const entries = [
    entry('a'),
    entry('b', { category: '日常' }),
    entry('c', { hidden: true }),
    entry('d', { legacy: { isHidden: true } }),
    entry('e', { draft: true }),
    entry('f', { deleted: true }),
    entry('g', { date: 'invalid' }),
    entry('h', { date: '2025-05-04T00:00:00' }),
    entry('a'),
  ];
  assert.deepEqual(
    recollectionEntries(entries, { category: '学习', start: '2025-05-03', end: '2025-05-03' }).map(
      (e) => e.id,
    ),
    ['a'],
  );
  assert.deepEqual(
    recollectionEntries(entries, { excludeRecent: true }, new Date('2025-05-10T12:00:00')).map(
      (e) => e.id,
    ),
    ['a', 'b'],
  );
  assert.equal(recollectionEntries(entries, { category: '不存在' }).length, 0);
});

test('Fisher–Yates visits every entry once per round and avoids the previous round ending', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const session = normalizeRecollectionSession();
  const first = ids.map(() => advanceRecollection(session, ids, 'round', () => 0.75));
  assert.equal(new Set(first).size, 4);
  assert.deepEqual(new Set(first), new Set(ids));
  const second = ids.map(() => advanceRecollection(session, ids, 'round', () => 0.75));
  assert.equal(session.round, 2);
  assert.notEqual(second[0], first.at(-1));
  assert.deepEqual(new Set(second), new Set(ids));
  assert.notEqual(shuffledRecollection(ids, 'a', () => 0.999)[0], 'a');
});

test('independent picks avoid only adjacent repetition; history replay does not consume a new draw', () => {
  const ids = ['a', 'b', 'c'];
  const session = normalizeRecollectionSession();
  const picks = Array.from({ length: 5 }, () =>
    advanceRecollection(session, ids, 'random', () => 0),
  );
  assert.deepEqual(picks, ['a', 'b', 'a', 'b', 'a']);
  session.cursor -= 2;
  assert.equal(
    advanceRecollection(session, ids, 'random', () => 0.9),
    'b',
  );
  assert.equal(session.history.length, 5);
  const single = normalizeRecollectionSession();
  assert.equal(advanceRecollection(single, ['a']), 'a');
  assert.equal(advanceRecollection(single, ['a']), 'a');
  assert.equal(advanceRecollection(single, []), '');
});

test('live changes remove disqualified history and add newly eligible entries without restarting a round', () => {
  const session = normalizeRecollectionSession();
  const first = advanceRecollection(session, ['a', 'b', 'c'], 'round', () => 0);
  reconcileRecollection(session, ['a', 'b', 'c', 'new'], () => 0);
  const rest = Array.from({ length: 3 }, () =>
    advanceRecollection(session, ['a', 'b', 'c', 'new'], 'round', () => 0),
  );
  assert.equal(new Set([first, ...rest]).size, 4);
  const removed = session.history[session.cursor];
  reconcileRecollection(
    session,
    ['a', 'b', 'c', 'new'].filter((id) => id !== removed),
  );
  assert.equal(session.history.includes(removed), false);
  assert.equal(session.deck.includes(removed), false);
  restartRecollection(session, ['a', 'b'], () => 0);
  assert.equal(session.index, -1);
  assert.equal(session.history.length, 0);
});

test('browser persistence is bounded and stores identifiers instead of entry snapshots', () => {
  const raw = {
    deck: ['a', 'a', { id: 'secret', content: 'not persisted' }],
    index: 100,
    history: Array.from({ length: 400 }, () => 'a'),
    cursor: 999,
    round: -1,
    content: 'not persisted',
  };
  const result = normalizeRecollectionSession(raw);
  assert.deepEqual(result.deck, ['a']);
  assert.equal(result.history.length, 200);
  assert.equal(result.cursor, 199);
  assert.equal(JSON.stringify(result).includes('not persisted'), false);
  assert.equal(normalizeRecollectionSession(null).deck.length, 0);
  assert.equal(normalizeRecollectionPreferences(null).mode, 'single');
  assert.equal(normalizeRecollectionPreferences({ mode: 'injected', period: 2 }).period, 12);
});

// Minimal event surface for asynchronous reader ownership tests; no real data/server.
function surface() {
  let frame;
  return {
    set innerHTML(html) {
      if (frame) frame.isConnected = false;
      const actions = [...html.matchAll(/data-recollection-action="([^"<>]+)"/g)].map((m) => ({
        dataset: { recollectionAction: m[1] },
      }));
      const modes = [...html.matchAll(/data-recollection-mode="([^"<>]+)"/g)].map((m) => ({
        dataset: { recollectionMode: m[1] },
      }));
      const host = html.includes('data-recollection-host') ? {} : null;
      const list = html.includes('class="recollection-list"')
        ? {
            innerHTML: html.split('<div class="recollection-list">')[1].split('</div><footer')[0],
            scrollTop: 0,
            insertAdjacentHTML(_position, value) {
              this.innerHTML += value;
            },
          }
        : null;
      const more = html.includes('data-recollection-more') ? {} : null;
      const count = { textContent: '' };
      frame = {
        isConnected: true,
        host,
        list,
        more,
        count,
        actions,
        modes,
        setAttribute() {},
        removeAttribute() {},
        querySelector: (selector) =>
          selector === '[data-recollection-host]'
            ? host
            : selector === '[data-recollection-more]'
              ? more
              : selector === '[data-recollection-count]'
                ? count
                : selector === '.recollection-list'
                  ? list
                  : host || list,
        querySelectorAll: (selector) =>
          selector.includes('-action') ? actions : selector.includes('-mode') ? modes : [],
      };
    },
    querySelector: () => frame,
    contains: (value) => value === frame,
    get frame() {
      return frame;
    },
  };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('single reader actions await successful flush and never mount into a replaced view', async () => {
  let library = { entries: [entry('a'), entry('b')], categories: ['学习'], media: [] };
  let finish;
  const events = [];
  const root = surface();
  const feature = createRecollection({
    get library() {
      return library;
    },
    escape: String,
    textOf: String,
    toast: (message) => events.push(message),
    releaseEntryReader: () => events.push('release'),
    mountEntryReader: async (_host, id) => events.push('mount:' + id),
    flush: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  assert.equal(feature.render('calendar', root), false);
  assert.equal(feature.render('memories', root), true);
  await tick();
  assert.equal(events.filter((value) => value.startsWith('mount:')).length, 1);
  const next = root.frame.actions.find((button) => button.dataset.recollectionAction === 'next');
  const waiting = next.onclick();
  assert.equal(events.filter((value) => value === 'release').length, 1);
  library = { ...library, entries: [] };
  finish();
  await waiting;
  await tick();
  assert.equal(events.filter((value) => value.startsWith('mount:')).length, 1);
  library = { ...library, entries: [entry('a')] };
  feature.render('memories', root);
  root.innerHTML = 'another view';
  await tick();
  assert.equal(events.filter((value) => value.startsWith('mount:')).length, 1);
});

test('flush rejection preserves the existing mounted reader and reports save failure', async () => {
  const root = surface(),
    errors = [];
  let mounts = 0,
    releases = 0;
  const feature = createRecollection({
    library: { entries: [entry('a'), entry('b')], categories: [], media: [] },
    escape: String,
    textOf: String,
    releaseEntryReader: () => releases++,
    mountEntryReader: async () => mounts++,
    flush: async () => {
      throw new Error('save conflict');
    },
    toast: (error) => errors.push(error),
  });
  feature.render('memories', root);
  await tick();
  await root.frame.actions.find((button) => button.dataset.recollectionAction === 'next').onclick();
  assert.deepEqual(errors, ['save conflict']);
  assert.equal(mounts, 1);
  assert.equal(releases, 1);
});

test('explicit mount cancellation rechecks a live entry removed while saving instead of leaving an empty host', async () => {
  let library = { entries: [entry('a')], categories: [], media: [] };
  let mounts = 0,
    releases = 0;
  const root = surface();
  const feature = createRecollection({
    get library() {
      return library;
    },
    escape: String,
    textOf: String,
    toast: () => {},
    flush: async () => {},
    releaseEntryReader: () => releases++,
    mountEntryReader: async () => {
      mounts++;
      library = { ...library, entries: [entry('a', { hidden: true })] };
      return false;
    },
  });
  feature.render('memories', root);
  await tick();
  assert.equal(mounts, 1);
  assert.equal(releases, 2);
  assert.equal(root.frame.host, null);
});

test('outgoing fade is 100ms and gracefully skips reduced motion or missing animation support', async () => {
  let calls = 0,
    cancellations = 0;
  const element = {
    animate(frames, options) {
      calls++;
      assert.equal(options.duration, 100);
      assert.equal(frames[0].opacity, 1);
      assert.equal(frames.at(-1).opacity, 0);
      return {
        finished: Promise.resolve(),
        cancel() {
          cancellations++;
        },
      };
    },
  };
  await fadeRecollectionOut(element, true);
  await fadeRecollectionOut({}, false);
  assert.equal(calls, 0);
  await fadeRecollectionOut(element, false);
  assert.equal(calls, 1);
  assert.equal(cancellations, 1);
});

test('navigation waits for the old reader fade, rejects duplicate clicks and cancels when the view leaves', async () => {
  const root = surface();
  let releases = 0,
    mounts = 0,
    animations = 0,
    cancel;
  const feature = createRecollection({
    library: { entries: [entry('a'), entry('b')], categories: [], media: [] },
    escape: String,
    textOf: String,
    toast: () => {},
    flush: async () => {},
    releaseEntryReader: () => releases++,
    mountEntryReader: async () => mounts++,
  });
  feature.render('memories', root);
  await tick();
  root.frame.host.animate = () => {
    animations++;
    return {
      finished: new Promise((_resolve, reject) => {
        cancel = reject;
      }),
      cancel() {},
    };
  };
  const next = root.frame.actions.find((button) => button.dataset.recollectionAction === 'next');
  const pending = next.onclick();
  await tick();
  assert.equal(root.frame.inert, true);
  assert.equal(releases, 1);
  await next.onclick();
  assert.equal(animations, 1);
  root.innerHTML = 'another view';
  cancel(new Error('animation canceled'));
  await pending;
  assert.equal(releases, 1);
  assert.equal(mounts, 1);
});

test('recollection list exposes every eligible diary through batches of 80 and preserves list scroll', async () => {
  const root = surface();
  const feature = createRecollection({
    library: {
      entries: Array.from({ length: 161 }, (_, i) => entry('id-' + i)),
      categories: [],
      media: [],
    },
    escape: String,
    textOf: String,
    toast: () => {},
    flush: async () => {},
    releaseEntryReader: () => {},
    mountEntryReader: async () => {},
  });
  feature.render('memories', root);
  await tick();
  await root.frame.modes.find((button) => button.dataset.recollectionMode === 'list').onclick();
  const countCards = () =>
    [...root.frame.list.innerHTML.matchAll(/class="recollection-card"/g)].length;
  assert.equal(countCards(), 80);
  root.frame.list.scrollTop = 420;
  root.frame.more.onclick();
  assert.equal(countCards(), 160);
  assert.equal(root.frame.list.scrollTop, 420);
  assert.equal(root.frame.count.textContent, '已显示 160 / 161 篇');
  assert.equal(root.frame.more.hidden, false);
  root.frame.more.onclick();
  assert.equal(countCards(), 161);
  assert.equal(root.frame.more.hidden, true);
  assert.match(root.frame.list.innerHTML, /data-open-entry="id-160"/);
});

test('return restores recollection filters, session and loaded pages while rechecking live eligibility', async () => {
  let library = {
    entries: Array.from({ length: 161 }, (_, i) => entry('id-' + i)),
    categories: ['学习'],
    media: [],
  };
  const root = surface();
  const feature = createRecollection({
    get library() {
      return library;
    },
    escape: String,
    textOf: String,
    toast: () => {},
    flush: async () => {},
    releaseEntryReader: () => {},
    mountEntryReader: async () => {},
  });
  feature.restoreNavigation({ version: 1, preferences: { category: '学习', mode: 'list' } });
  feature.render('memories', root);
  root.frame.more.onclick();
  const saved = feature.captureNavigation();
  assert.equal(saved.limit, 160);
  await root.frame.modes.find((button) => button.dataset.recollectionMode === 'single').onclick();
  await root.frame.actions.find((button) => button.dataset.recollectionAction === 'next').onclick();
  library = {
    ...library,
    entries: library.entries.map((item) =>
      item.id === 'id-160' ? { ...item, hidden: true } : item,
    ),
  };
  assert.equal(feature.restoreNavigation(saved), true);
  saved.preferences.category = 'unrelated';
  saved.session.history.push('not-shared');
  feature.render('memories', root);
  assert.equal([...root.frame.list.innerHTML.matchAll(/class="recollection-card"/g)].length, 160);
  assert.doesNotMatch(root.frame.list.innerHTML, /data-open-entry="id-160"/);
  const restored = feature.captureNavigation();
  assert.equal(restored.preferences.category, '学习');
  assert.equal(restored.session.history.includes('not-shared'), false);
  assert.equal(restored.session.history.length, 1, 'return does not consume a new random draw');
  restored.session.deck.length = 0;
  assert.equal(feature.captureNavigation().session.deck.length, 160);
  assert.equal(feature.restoreNavigation(null), false);
});

test('in-memory recollection return preserves large rounds, recall IDs and rejects body snapshots', () => {
  const feature = createRecollection({ escape: String });
  const deck = Array.from({ length: 6001 }, (_, i) => `entry-${i}`);
  assert.equal(
    feature.restoreNavigation({
      version: 1,
      preferences: { mode: 'single', recallDate: '2026-09-22', period: 12 },
      session: {
        deck,
        index: 5500,
        history: ['entry-5500'],
        cursor: 0,
        round: 3,
        content: 'excluded',
      },
      recallId: 'entry-17',
      limit: 240,
      content: 'excluded',
    }),
    true,
  );
  const saved = feature.captureNavigation();
  assert.equal(saved.session.deck.length, 6001);
  assert.equal(saved.session.index, 5500);
  assert.equal(saved.recallId, 'entry-17');
  assert.equal(saved.limit, 240);
  assert.equal(JSON.stringify(saved).includes('excluded'), false);
  deck.length = 0;
  assert.equal(feature.captureNavigation().session.deck.length, 6001);
  feature.restoreNavigation({
    version: 1,
    session: { deck: [null, 'ok', { content: 'excluded' }], index: 100 },
    recallId: {},
    limit: NaN,
  });
  assert.deepEqual(feature.captureNavigation().session.deck, ['ok']);
  assert.equal(feature.captureNavigation().session.index, 0);
  assert.equal(feature.captureNavigation().recallId, '');
  assert.equal(feature.captureNavigation().limit, 80);
});
