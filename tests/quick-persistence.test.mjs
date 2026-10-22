import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersistence } from '../public/editor/persistence.js';
import { createEntrySave } from '../public/features/entry-save.js';

function deferred() {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
}

function document(overrides = {}) {
  return {
    id: 'local-draft',
    title: '',
    content: '<p>　　</p>',
    contentFormat: 'html',
    category: '日常',
    date: '2026-09-22T00:00:00.000Z',
    tags: [],
    attachments: [],
    history: [],
    _unsaved: true,
    _captureToken: 'fixture-capture-token',
    ...overrides,
  };
}

function harness(t, entry, options = {}) {
  const statuses = [],
    notifications = [],
    identities = [];
  const persistence = createPersistence({
    current: () => entry,
    sanitize: (value) => value,
    status: (...value) => statuses.push(value),
    toast: (value) => notifications.push(value),
    onDirty: () => {},
    onSaved: () => {},
    onIdentity: (saved, oldId) => identities.push([oldId, saved.id]),
    ...options,
  });
  persistence.observe(entry);
  t.after(() => persistence.pause());
  return { persistence, statuses, notifications, identities };
}

test('blank/autofilled template documents do not POST or leave pending work', async (t) => {
  for (const entry of [
    document(),
    document({ content: '<p>模板自动填充的引导</p>', title: '模板标题' }),
  ]) {
    let calls = 0;
    const { persistence } = harness(t, entry, {
      saveEntry: () => {
        calls++;
        throw Error('unexpected write');
      },
    });
    persistence.markDirty(entry);
    await persistence.flush();
    assert.equal(calls, 0);
    assert.equal(entry._unsaved, true);
    assert.equal(persistence.pending, false);
  }
});

test('creating while typing preserves the latest text and serializes the follow-up PUT', async (t) => {
  const entry = document();
  const started = deferred(),
    release = deferred();
  const calls = [];
  let editorId = entry.id;
  const saveEntry = createEntrySave({
    api: async (path, options) => {
      calls.push({ path, ...structuredClone(options) });
      if (path === '/api/quick-entries') {
        started.resolve();
        await release.promise;
        return { ...options.data.entry, id: 'saved-id', revision: 1, history: [] };
      }
      return { ...options.data, revision: options.data.revision + 1, history: [] };
    },
  });
  const { persistence, identities } = harness(t, entry, {
    saveEntry,
    onIdentity: (saved, oldId) => {
      assert.equal(editorId, oldId);
      editorId = saved.id;
      identities.push([oldId, saved.id]);
    },
    syncEditor: (current) => {
      // This models the mounted CodeMirror editor's identity bridge. The
      // follow-up PUT must only be allowed after onIdentity has rebound it.
      assert.equal(editorId, current.id);
      return false;
    },
  });
  entry.content = '<p>第一段</p>';
  persistence.markDirty(entry);
  const first = persistence.flush();
  await started.promise;
  entry.content = '<p>第一段，继续输入不丢字</p>';
  persistence.markDirty(entry);
  const second = persistence.flush();
  release.resolve();
  await Promise.all([first, second]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].path, '/api/quick-entries');
  assert.equal(calls[0].data.entry.content, '<p>第一段</p>');
  assert.equal(calls[0].data.entry._unsaved, undefined);
  assert.equal(calls[1].path, '/api/entries/saved-id');
  assert.equal(calls[1].method, 'PUT');
  assert.equal(calls[1].data.revision, 1);
  assert.equal(calls[1].data.content, '<p>第一段，继续输入不丢字</p>');
  assert.equal(entry.content, '<p>第一段，继续输入不丢字</p>');
  assert.equal(entry.revision, 2);
  assert.equal(entry._unsaved, false);
  assert.deepEqual(identities, [['local-draft', 'saved-id']]);
  assert.equal(persistence.pending, false);
});

test('network and unresolved conflict failures retain dirty input and allow a later retry', async (t) => {
  for (const status of [undefined, 409]) {
    const entry = document({
      id: 'saved-id',
      _unsaved: false,
      revision: 1,
      content: '<p>已存</p>',
    });
    let fail = true;
    const { persistence, notifications, statuses } = harness(t, entry, {
      saveEntry: async (snapshot) => {
        if (fail) throw Object.assign(Error(status ? '尚未处理冲突' : '网络失败'), { status });
        return { saved: { ...snapshot, revision: 2 }, acknowledged: snapshot };
      },
    });
    entry.content = '<p>必须保留的新输入</p>';
    persistence.markDirty(entry);
    await assert.rejects(persistence.flush(), /失败|冲突/);
    assert.equal(persistence.pending, true);
    assert.equal(entry.content, '<p>必须保留的新输入</p>');
    assert.equal(entry.revision, 1);
    assert.equal(notifications.length, 1);
    assert.equal(statuses.at(-1)[1], true);
    fail = false;
    await persistence.flush();
    assert.equal(entry.revision, 2);
    assert.equal(persistence.pending, false);
  }
});

test('lost create response retries the same token and original payload before saving new text', async (t) => {
  const entry = document();
  const calls = [];
  const saveEntry = createEntrySave({
    api: async (path, options) => {
      calls.push({ path, ...structuredClone(options) });
      if (calls.length === 1) throw Error('response lost');
      if (path === '/api/quick-entries')
        return { ...options.data.entry, id: 'saved-once', revision: 1 };
      return { ...options.data, revision: 2 };
    },
  });
  const { persistence, identities } = harness(t, entry, { saveEntry });
  entry.content = '<p>第一次输入</p>';
  persistence.markDirty(entry);
  await assert.rejects(persistence.flush(), /response lost/);
  entry.content = '<p>重试前继续输入</p>';
  persistence.markDirty(entry);
  await persistence.flush();
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[1].data, calls[0].data);
  assert.equal(calls[2].path, '/api/entries/saved-once');
  assert.equal(calls[2].data.content, '<p>重试前继续输入</p>');
  assert.deepEqual(identities, [['local-draft', 'saved-once']]);
  assert.equal(persistence.pending, false);
});

test('a proven saved descendant is adopted without overwriting it or keeping a dirty flag', async (t) => {
  const entry = document({
    id: 'existing',
    revision: 1,
    _unsaved: false,
    content: '<p>旧内容</p>',
  });
  const base = structuredClone(entry);
  const remote = { ...base, content: '<p>另一窗口的新内容</p>', revision: 2, history: [base] };
  const calls = [];
  let frozen = 0;
  const saveEntry = createEntrySave({
    api: async (path, options) => {
      calls.push({ path, method: options?.method || 'GET' });
      if (options?.method === 'PUT') throw Object.assign(Error('conflict'), { status: 409 });
      return structuredClone(remote);
    },
    freeze: () => {
      frozen++;
      return () => frozen--;
    },
    chooseConflict: () => {
      throw Error('history requires no conflict dialog');
    },
  });
  const { persistence } = harness(t, entry, { saveEntry });
  persistence.markDirty(entry);
  await persistence.flush();
  assert.equal(entry.content, remote.content);
  assert.equal(entry.revision, 2);
  assert.deepEqual(
    calls.map((call) => call.method),
    ['PUT', 'GET'],
  );
  assert.equal(frozen, 0);
  assert.equal(persistence.pending, false);
});

test('choosing saved content after divergent edits adopts it, and cancelling preserves local text', async (t) => {
  for (const choice of [null, { action: 'saved' }]) {
    const entry = document({
      id: 'existing',
      revision: 1,
      _unsaved: false,
      content: '<p>共同版本</p>',
    });
    const base = structuredClone(entry);
    const remote = { ...base, content: '<p>已保存的分支</p>', revision: 2, history: [base] };
    let frozen = 0;
    const saveEntry = createEntrySave({
      api: async (_, options) => {
        if (options?.method === 'PUT') throw Object.assign(Error('conflict'), { status: 409 });
        return structuredClone(remote);
      },
      freeze: () => {
        frozen++;
        return () => frozen--;
      },
      chooseConflict: async () => choice,
    });
    const { persistence } = harness(t, entry, { saveEntry });
    entry.content = '<p>本地分支</p>';
    persistence.markDirty(entry);
    if (choice) {
      await persistence.flush();
      assert.equal(entry.content, remote.content);
      assert.equal(persistence.pending, false);
    } else {
      await assert.rejects(persistence.flush(), /尚未处理/);
      assert.equal(entry.content, '<p>本地分支</p>');
      assert.equal(persistence.pending, true);
    }
    assert.equal(frozen, 0);
  }
});

test('the actual debounce autosave settles with no pending work without an explicit flush', async (t) => {
  const entry = document();
  const done = deferred();
  let calls = 0;
  const { persistence } = harness(t, entry, {
    saveEntry: async (snapshot) => {
      calls++;
      return { saved: { ...snapshot, id: 'autosaved', revision: 1 }, acknowledged: snapshot };
    },
    onSaved: () => done.resolve(),
  });
  const timeout = setTimeout(() => done.resolve('timed out'), 2500);
  t.after(() => clearTimeout(timeout));
  entry.title = '只写标题也保存';
  persistence.markDirty(entry);
  assert.equal(await done.promise, undefined);
  assert.equal(calls, 1);
  assert.equal(entry.id, 'autosaved');
  assert.equal(persistence.pending, false);
});
