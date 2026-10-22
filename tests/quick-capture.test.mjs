import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasQuickContent,
  rememberQuickEntry,
  previousQuickEntry,
  nextQuickEntry,
  compareQuickVersions,
} from '../public/shared/quick-capture.js';
import { createQuickCaptureSession } from '../public/features/quick-capture-session.js';

const entry = (overrides = {}) => ({
  id: 'synthetic-a',
  revision: 1,
  title: '',
  content: '<p>合成测试内容</p>',
  date: '2026-09-22T00:00:00Z',
  category: '测试',
  tags: [],
  attachments: [],
  history: [],
  ...overrides,
});
const blank = entry({ content: '<p>　　<br></p>' });
const compare = (base, local, saved) => compareQuickVersions({ base, local, saved });
const descendant = (base, updates = {}) =>
  entry({ ...base, ...updates, revision: base.revision + 1, history: [base] });

test('blank HTML indentation and whitespace entities do not create records; title or media counts', () => {
  for (const content of [
    '',
    '<p><br></p>',
    '<p>&nbsp;&#x3000;&#32;&#8203;</p>',
    '<!-- x --><div>\n</div>',
  ]) {
    assert.equal(hasQuickContent(entry({ content })), false);
  }
  assert.equal(hasQuickContent(blank), false);
  assert.equal(hasQuickContent({ ...blank, title: '标题草稿' }), true);
  assert.equal(hasQuickContent({ ...blank, attachments: ['media-a'] }), true);
  assert.equal(hasQuickContent({ ...blank, content: '<img src="/media/a">' }), true);
  assert.equal(hasQuickContent({ ...blank, content: '<p>&amp;</p>' }), true);
});

test('Markdown source is authoritative, and stale Markdown does not hide legacy content', () => {
  const md = entry({
    contentFormat: 'markdown',
    content: '<p>　</p>',
    markdownHtml: '<p>　</p>',
    markdownSource: '　　\n',
  });
  assert.equal(hasQuickContent(md), false);
  assert.equal(hasQuickContent({ ...md, markdownSource: '![图](/media/a)' }), true);
  assert.equal(hasQuickContent({ ...md, content: '<p>旧端刚刚修改</p>' }), true);
});

test('repeated previous walks farther back rather than alternating between two records', () => {
  const entries = [entry({ id: 'new' }), { ...blank, id: 'empty' }, entry({ id: 'old' })];
  const history = ['new', 'empty', 'old'];
  assert.equal(previousQuickEntry(history, entries, 'new').id, 'old');
  assert.equal(previousQuickEntry(history, entries, 'old'), null);
  assert.equal(previousQuickEntry(history, entries, 'unsaved').id, 'new');
});

test('quick history records actual edit order, skips blank/deleted/missing and never scans unrelated entries', () => {
  const entries = [
    entry(),
    entry({ id: 'old', date: '2030-01-01', title: '只写标题', content: '' }),
    { ...blank, id: 'empty' },
    entry({ id: 'deleted', deleted: true }),
    entry({ id: 'unrelated' }),
  ];
  const history = ['synthetic-a', 'empty', 'deleted', 'missing', 'old'];
  assert.equal(previousQuickEntry(history, entries, 'synthetic-a').id, 'old');
  assert.equal(previousQuickEntry(['empty', 'missing'], entries), null);
  assert.deepEqual(rememberQuickEntry(history, blank), history);
  assert.deepEqual(rememberQuickEntry(['old', 'synthetic-a', 'old'], entry()), [
    'synthetic-a',
    'old',
  ]);
  assert.deepEqual(entries[2], { ...blank, id: 'empty' });
});

test('next walks toward newer edits, skipping unavailable records without wrapping', () => {
  const entries = [
    entry({ id: 'new' }),
    entry({ id: 'middle' }),
    entry({ id: 'old' }),
    { ...blank, id: 'empty' },
    entry({ id: 'deleted', deleted: true }),
    entry({ id: 'unrelated' }),
  ];
  const history = ['new', 'empty', 'missing', 'middle', 'deleted', 'old'];
  assert.equal(nextQuickEntry(history, entries, 'old').id, 'middle');
  assert.equal(nextQuickEntry(history, entries, 'middle').id, 'new');
  assert.equal(nextQuickEntry(history, entries, 'new'), null);
  assert.equal(nextQuickEntry(history, entries, 'unsaved'), null);
  assert.equal(nextQuickEntry([], entries, 'old'), null);
});

test('next saves first, refreshes history and opens the newer record without altering history', async () => {
  let history = [],
    flushed = false;
  const h = harness({
    current: () => entry({ id: 'old' }),
    getHistory: () => history,
    flush: async () => {
      flushed = true;
    },
    getAccessibleEntries: async () => {
      assert.equal(flushed, true);
      history = ['new', 'old'];
      return [entry({ id: 'new' }), entry({ id: 'old' })];
    },
    chooseCategory: () => {
      throw Error('must not ask for a category while history has a successor');
    },
  });
  assert.deepEqual(await h.session.next(), { status: 'opened', id: 'new' });
  assert.deepEqual(history, ['new', 'old']);
  assert.deepEqual(h.calls, ['freeze', ['entry', 'new'], 'release', 'focus']);
});

test('next at latest uses the normal picker; cancel preserves current, previous resumes latest', async () => {
  let choice = null;
  const h = harness({
    getHistory: () => ['synthetic-a'],
    chooseCategory: async ({ getPrevious }) => {
      assert.equal(await getPrevious(), true);
      return choice;
    },
  });
  assert.deepEqual(await h.session.next(), { status: 'cancelled' });
  assert.deepEqual(h.calls, ['freeze', 'flush', 'release']);
  choice = { action: 'previous' };
  assert.deepEqual(await h.session.next(), { status: 'opened', id: 'synthetic-a' });
  choice = '新分类';
  assert.deepEqual(await h.session.next(), { status: 'opened-new' });
  assert.ok(h.calls.some((call) => Array.isArray(call) && call[0] === 'new' && call[1] === choice));
});

test('native close cancels next picker even after a repeated navigation click', async () => {
  let finish;
  const h = harness({
    chooseCategory: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    cancelCategory: () => finish(null),
  });
  const next = h.session.next();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.session.categoryPending, true);
  assert.deepEqual(await h.session.newEntry(), { status: 'busy' });
  assert.deepEqual(await h.session.close(), { status: 'closed' });
  assert.deepEqual(await next, { status: 'cancelled' });
});

test('same content aligns state even when derived Markdown HTML or tag order differs', () => {
  const local = entry({
    contentFormat: 'markdown',
    markdownSource: 'hello',
    content: '<p>hello</p>',
    markdownHtml: '<p>hello</p>',
    tags: ['b', 'a'],
  });
  const saved = entry({
    ...local,
    revision: 2,
    content: '<p class="new">hello</p>',
    markdownHtml: '<p class="new">hello</p>',
    tags: ['a', 'b'],
    comments: [{ body: '单独保存的评论' }],
  });
  assert.equal(compare(null, local, saved).reason, 'identical');
});

test('confirmed ancestor with no local edits adopts saved; local-only edits can save with latest revision', () => {
  const base = entry();
  assert.equal(
    compare(base, base, descendant(base, { title: '另一窗口的新标题' })).action,
    'adopt-saved',
  );
  assert.equal(compare(base, { ...base, title: '本窗口新标题' }, base).action, 'save-local');
  assert.equal(
    compare(base, { ...base, title: '本窗口新标题' }, descendant(base)).action,
    'save-local',
  );
});

test('independent edits require a choice, including attachment order and metadata-only branches', () => {
  const base = entry({ attachments: ['a', 'b'] });
  for (const local of [
    { ...base, title: '本地' },
    { ...base, attachments: ['b', 'a'] },
    { ...base, category: '另一个分类' },
  ]) {
    assert.deepEqual(compare(base, local, descendant(base, { content: '<p>另外一端</p>' })), {
      action: 'conflict',
      reason: 'both-changed',
    });
  }
});

test('timestamps, larger revision, containing old text and forged historical content are not ancestry proof', () => {
  const base = entry();
  for (const saved of [
    entry({ revision: 99, content: base.content + '<p>更多文字</p>', updatedAt: '2099-01-01' }),
    entry({ revision: 2, title: '变化', history: [{ ...base, content: '<p>不同的基线</p>' }] }),
    entry({ revision: 2, title: '变化', history: [{ ...base, id: 'unrelated' }] }),
  ])
    assert.deepEqual(compare(base, base, saved), {
      action: 'conflict',
      reason: 'unproven-history',
    });
  assert.equal(compare(null, base, descendant(base, { title: '变化' })).action, 'conflict');
  assert.equal(compare(base, base, { ...base, id: 'other' }).action, 'conflict');
});

function harness(overrides = {}) {
  const calls = [];
  let history = [];
  const c = {
    freeze: () => {
      calls.push('freeze');
      return () => calls.push('release');
    },
    flush: async () => calls.push('flush'),
    chooseCategory: async () => '测试',
    mountNew: async (category) => calls.push(['new', category]),
    mountEntry: async (id) => calls.push(['entry', id]),
    focusBody: () => calls.push('focus'),
    current: () => entry(),
    persistedId: () => 'synthetic-a',
    getHistory: () => history,
    setHistory: async (ids) => {
      history = ids;
    },
    getAccessibleEntries: async () => [entry()],
    openMain: async (id) => calls.push(['main', id]),
    closeWindow: async () => calls.push('close'),
    ...overrides,
  };
  return { calls, c, session: createQuickCaptureSession(c) };
}

test('new prepares category and focuses body after thaw; cancelled chooser preserves current document', async () => {
  const h = harness();
  assert.equal((await h.session.newEntry()).status, 'opened-new');
  assert.deepEqual(h.calls, ['freeze', 'flush', ['new', '测试'], 'release', 'focus']);
  const cancel = harness({ chooseCategory: async () => null });
  assert.equal((await cancel.session.newEntry()).status, 'cancelled');
  assert.deepEqual(cancel.calls, ['freeze', 'flush', 'release']);
});

test('failed or conflicting save blocks every navigation and close, keeps current editor available', async () => {
  const error = new Error('需要处理冲突');
  for (const action of ['newEntry', 'latest', 'previous', 'next', 'openMain', 'close']) {
    const h = harness({
      flush: async () => {
        throw error;
      },
    });
    await assert.rejects(h.session[action](), (e) => e === error);
    assert.deepEqual(h.calls, ['freeze', 'release']);
    assert.equal(h.session.busy, false);
    assert.equal(h.session.lastError, error);
  }
});

test('latest flushes and refreshes actual edit MRU without opening a category picker or recording a browse', async () => {
  let history = ['old'];
  let flushed = false;
  const h = harness({
    current: () => entry({ id: 'viewed' }),
    flush: async () => {
      flushed = true;
    },
    getHistory: () => history,
    getAccessibleEntries: async () => {
      assert.equal(flushed, true);
      history = ['missing', 'deleted', 'edited', 'viewed'];
      return [
        entry({ id: 'deleted', deleted: true }),
        entry({ id: 'edited' }),
        entry({ id: 'viewed' }),
      ];
    },
    chooseCategory: () => assert.fail('latest must not choose category'),
    setHistory: () => assert.fail('browsing cannot become an edit'),
  });
  assert.deepEqual(await h.session.latest(), { status: 'opened', id: 'edited' });
  assert.ok(h.calls.some((call) => Array.isArray(call) && call[1] === 'edited'));
  assert.deepEqual(history, ['missing', 'deleted', 'edited', 'viewed']);
});

test('latest keeps a draft saved by flush as newest, and avoids remounting an already latest document', async () => {
  let current = entry({ id: 'draft', _unsaved: true });
  let history = ['old'];
  const h = harness({
    current: () => current,
    getHistory: () => history,
    flush: async () => {
      current = entry({ id: 'persisted' });
      history = ['persisted', 'old'];
    },
    getAccessibleEntries: async () => [current, entry({ id: 'old' })],
    mountEntry: () => assert.fail('do not remount current saved draft'),
  });
  assert.deepEqual(await h.session.latest(), { status: 'opened', id: 'persisted' });
});

test('background resume retains unsaved or pending input and never flushes it into navigation', async () => {
  for (const overrides of [{ current: () => entry({ _unsaved: true }) }, { pending: () => true }]) {
    const h = harness({
      ...overrides,
      flush: () => assert.fail('resume cannot discard pending input'),
      getAccessibleEntries: () => assert.fail('retain current input'),
    });
    assert.equal((await h.session.resumeLatest()).status, 'retained-draft');
  }
  const h = harness({
    getHistory: () => ['new', 'synthetic-a'],
    getAccessibleEntries: async () => [entry({ id: 'new' }), entry()],
    flush: () => assert.fail('saved resume does not write viewed entry'),
  });
  assert.deepEqual(await h.session.resumeLatest(), { status: 'opened', id: 'new' });
});

test('repeat launch during a pending save is ignored; failed attempt may be retried', async () => {
  let finish;
  const h = harness({
    flush: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const first = h.session.newEntry();
  assert.equal((await h.session.newEntry()).status, 'busy');
  assert.equal((await h.session.close()).status, 'busy');
  finish();
  await first;
  assert.equal(h.calls.filter((call) => Array.isArray(call) && call[0] === 'new').length, 1);
});

test('main handoff uses the post-flush persisted ID and never creates a blank to obtain an ID', async () => {
  let id = null;
  const h = harness({
    persistedId: () => id,
    flush: async () => {
      id = 'saved-by-flush';
    },
  });
  assert.deepEqual(await h.session.openMain(), { status: 'opened-main', id: 'saved-by-flush' });
  assert.deepEqual(h.calls, ['freeze', ['main', 'saved-by-flush'], 'release']);
  const empty = harness({ persistedId: () => null });
  assert.equal((await empty.session.openMain()).status, 'empty');
  assert.deepEqual(empty.calls, ['freeze', 'flush', 'release']);
});

test('previous resolves live accessible records; opening it alone never changes edit history', async () => {
  const h = harness({
    getHistory: () => ['empty', 'missing', 'old'],
    getAccessibleEntries: async () => [{ ...blank, id: 'empty' }, entry({ id: 'old' })],
  });
  assert.deepEqual(await h.session.previous(), { status: 'opened', id: 'old' });
  assert.deepEqual(h.calls, ['freeze', 'flush', ['entry', 'old'], 'release', 'focus']);
  assert.deepEqual(h.c.getHistory(), ['empty', 'missing', 'old']);
});

test('quick history writes serialize to preserve consecutive saved edits and contain IDs only', async () => {
  const h = harness();
  await Promise.all([
    h.session.editedAndSaved(entry()),
    h.session.editedAndSaved(entry({ id: 'b' })),
    h.session.editedAndSaved(blank),
  ]);
  assert.deepEqual(h.c.getHistory(), ['b', 'synthetic-a']);
  const reconstructed = harness({
    getHistory: () => JSON.parse(JSON.stringify(h.c.getHistory())),
    current: () => ({ id: 'b' }),
  });
  assert.equal((await reconstructed.session.previous()).id, 'synthetic-a');
});

test('first previous click uses history refreshed by the asynchronous library read', async () => {
  let history = [];
  let currentId = 'blank-draft';
  const h = harness({
    getHistory: () => history,
    current: () => entry({ id: currentId }),
    getAccessibleEntries: async () => {
      await new Promise((resolve) => setImmediate(resolve));
      history = ['latest', 'empty', 'deleted', 'missing', 'older'];
      return [
        entry({ id: 'latest' }),
        { ...blank, id: 'empty' },
        entry({ id: 'deleted', deleted: true }),
        entry({ id: 'older' }),
      ];
    },
    mountEntry: async (id) => {
      currentId = id;
    },
  });
  assert.deepEqual(await h.session.previous(), { status: 'opened', id: 'latest' });
  assert.deepEqual(await h.session.previous(), { status: 'opened', id: 'older' });
  assert.deepEqual(await h.session.previous(), { status: 'no-previous' });
});

test('previous waits for a newly saved draft identity and history before navigating', async () => {
  let currentId = 'draft-new';
  let history = ['old'];
  const h = harness({
    current: () => entry({ id: currentId }),
    getHistory: () => history,
    flush: async () => {
      currentId = 'new';
    },
    getAccessibleEntries: async () => {
      history = ['new', 'old'];
      return [entry({ id: 'new' }), entry({ id: 'old' })];
    },
  });
  assert.deepEqual(await h.session.previous(), { status: 'opened', id: 'old' });
});

test('normal close waits for save success before requesting window closure', async () => {
  const h = harness();
  assert.equal((await h.session.close()).status, 'closed');
  assert.deepEqual(h.calls, ['freeze', 'flush', 'close', 'release']);
});

test('close cancels the startup category picker before saving and closing', async () => {
  let resolveCategory;
  let cancelled = 0;
  const h = harness({
    chooseCategory: () =>
      new Promise((resolve) => {
        resolveCategory = resolve;
      }),
    cancelCategory: () => {
      cancelled++;
      resolveCategory(null);
    },
  });
  const opening = h.session.newEntry();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.session.categoryPending, true);
  assert.equal((await h.session.close()).status, 'closed');
  assert.equal(cancelled, 1);
  assert.deepEqual(h.calls, ['freeze', 'flush', 'release', 'freeze', 'flush', 'close', 'release']);
  assert.equal(await opening.then((result) => result.status), 'cancelled');
});

test('startup chooser previous opens live history on its first click without creating or recategorizing', async () => {
  let history = [];
  const previous = entry({ id: 'valid-old', category: '原分类' });
  const entries = [{ ...blank, id: 'empty' }, entry({ id: 'deleted', deleted: true }), previous];
  const original = structuredClone(entries);
  const h = harness({
    current: () => null,
    getHistory: () => history,
    getAccessibleEntries: async () => {
      await new Promise((resolve) => setImmediate(resolve));
      history = ['missing', 'empty', 'deleted', 'valid-old'];
      return entries;
    },
    chooseCategory: async ({ getPrevious }) => {
      assert.equal(h.session.categoryPending, true);
      assert.equal(await getPrevious(), true);
      return { action: 'previous' };
    },
  });
  assert.deepEqual(await h.session.newEntry(), { status: 'opened', id: 'valid-old' });
  assert.deepEqual(h.calls, ['freeze', 'flush', ['entry', 'valid-old'], 'release', 'focus']);
  assert.deepEqual(entries, original);
  assert.equal(h.session.busy, false);
  assert.equal(h.session.categoryPending, false);
});

test('chooser exposes unavailable history and rechecks records removed after availability lookup', async () => {
  const noPrevious = harness({
    current: () => null,
    chooseCategory: async ({ getPrevious }) => {
      assert.equal(await getPrevious(), false);
      return null;
    },
  });
  assert.deepEqual(await noPrevious.session.newEntry(), { status: 'cancelled' });
  let deleted = false;
  const h = harness({
    current: () => null,
    getHistory: () => ['old'],
    getAccessibleEntries: async () => [entry({ id: 'old', deleted })],
    chooseCategory: async ({ getPrevious }) => {
      assert.equal(await getPrevious(), true);
      deleted = true;
      return { action: 'previous' };
    },
  });
  assert.deepEqual(await h.session.newEntry(), { status: 'no-previous' });
  assert.deepEqual(h.calls, ['freeze', 'flush', 'release']);
});

test('new-entry chooser resumes the latest quick edit even when it is the current record', async () => {
  const h = harness({
    getHistory: () => ['synthetic-a', 'old'],
    getAccessibleEntries: async () => [entry(), entry({ id: 'old' })],
    chooseCategory: async ({ getPrevious }) => {
      assert.equal(await getPrevious(), true);
      return { action: 'previous' };
    },
  });
  assert.deepEqual(await h.session.newEntry(), { status: 'opened', id: 'synthetic-a' });
  assert.deepEqual(await h.session.previous(), { status: 'opened', id: 'old' });
  assert.ok(!h.calls.some((call) => Array.isArray(call) && call[0] === 'new'));
});

test('native close cancels chooser without waiting for its history availability request', async () => {
  let resolveCategory, resolveHistory;
  let availability;
  const h = harness({
    chooseCategory: ({ getPrevious }) => {
      availability = getPrevious();
      return new Promise((resolve) => (resolveCategory = resolve));
    },
    getAccessibleEntries: () => new Promise((resolve) => (resolveHistory = resolve)),
    cancelCategory: () => resolveCategory(null),
  });
  const opening = h.session.newEntry();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(await h.session.close(), { status: 'closed' });
  assert.deepEqual(await opening, { status: 'cancelled' });
  resolveHistory([]);
  assert.equal(await availability, false);
  assert.deepEqual(h.calls, ['freeze', 'flush', 'release', 'freeze', 'flush', 'close', 'release']);
});
