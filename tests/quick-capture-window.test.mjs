import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { installQuickCapture } from '../public/features/quick-capture-window.js';
import { createQuickResumePosition } from '../public/features/quick-resume-position.js';

async function fixture(t, { currentId = 'edited' } = {}) {
  const dom = new JSDOM(
    '<main class="workspace"><input id="entryTitle"><div id="bodyEditor" tabindex="0"></div><button id="emptyNew"></button><div id="scroller"></div></main>',
  );
  const old = {
    window: globalThis.window,
    document: globalThis.document,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    clearInterval: globalThis.clearInterval,
  };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.requestAnimationFrame = (callback) => {
    callback(0);
    return 0;
  };
  globalThis.clearInterval = dom.window.clearInterval.bind(dom.window);
  dom.window.requestAnimationFrame = (callback) => {
    callback(0);
    return 0;
  };
  const listeners = [];
  const messages = [];
  dom.window.chrome = {
    webview: {
      postMessage: (message) => messages.push(message),
      addEventListener: (_type, callback) => listeners.push(callback),
    },
  };
  t.after(() => {
    dom.window.close();
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  });
  const records = ['edited', 'viewed'].map((id) => ({
    id,
    title: '',
    content: '<p>虚构内容</p>',
    attachments: [],
  }));
  let current = records.find((record) => record.id === currentId) || null;
  let history = ['edited', 'viewed'];
  let position = { anchor: 45, head: 52 };
  let pending = false;
  let failFlush = false;
  let mounts = 0;
  let categoryChoices = 0;
  const scroller = dom.window.document.querySelector('#scroller');
  scroller.scrollTop = 600;
  const editor = {
    capturePosition: () => ({ ...position }),
    restorePosition: (saved) => {
      position = saved;
    },
    focus: () => dom.window.document.querySelector('#bodyEditor').focus(),
  };
  const c = {
    current: () => current,
    editor,
    resumePosition: createQuickResumePosition({
      current: () => current,
      editor,
      title: dom.window.document.querySelector('#entryTitle'),
      scroller,
    }),
    freeze: () => () => {},
    flush: async () => {
      if (failFlush) throw Error('虚构保存失败');
    },
    pending: () => pending,
    chooseCategory: async () => {
      categoryChoices++;
      return null;
    },
    refreshLibrary: async () => {},
    selectEntry: async (id) => {
      mounts++;
      current = records.find((record) => record.id === id);
      position = { anchor: 0, head: 0 };
      scroller.scrollTop = 0;
    },
    api: async (url) =>
      url === '/api/quick-history' ? { ids: [...history] } : { entries: records },
    focus: editor.focus,
    focusBody: editor.focus,
    toast: () => {},
  };
  const app = installQuickCapture(c);
  await app.start();
  const settle = async () => {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
  };
  return {
    app,
    messages,
    records,
    scroller,
    current: () => current,
    mounts: () => mounts,
    categoryChoices: () => categoryChoices,
    position: (value) => (value ? (position = value) : position),
    history: (value) => (value ? (history = value) : history),
    pending: (value) => {
      pending = value;
    },
    failFlush: () => {
      failFlush = true;
    },
    draft: () => {
      current = {
        id: 'draft',
        _unsaved: true,
        title: '',
        content: '<p>未保存输入</p>',
        attachments: [],
      };
    },
    button: (label) =>
      [...dom.window.document.querySelectorAll('nav button')].find(
        (button) => button.textContent === label,
      ),
    emit: async (type) => {
      listeners.forEach((listener) => listener({ data: { type } }));
      await settle();
    },
    settle,
  };
}

test('a fresh or expired window still chooses a new category rather than automatically opening old MRU', async (t) => {
  const h = await fixture(t, { currentId: null });
  assert.equal(h.categoryChoices(), 1);
  assert.equal(h.current(), null);
  assert.equal(h.mounts(), 0);
  assert.deepEqual(h.history(), ['edited', 'viewed']);
});

test('latest toolbar order and background reactivation return to edited MRU with its own caret and scroll', async (t) => {
  const h = await fixture(t);
  assert.deepEqual(
    [...document.querySelectorAll('nav button')].slice(0, 4).map((button) => button.textContent),
    ['新一篇', '最新篇', '上一篇', '下一篇'],
  );
  h.button('上一篇').click();
  await h.settle();
  assert.equal(h.current().id, 'viewed');
  h.position({ anchor: 2, head: 3 });
  h.scroller.scrollTop = 120;
  await h.emit('focus-editor');
  assert.equal(h.current().id, 'viewed');
  assert.deepEqual(h.history(), ['edited', 'viewed']);
  await h.emit('request-close');
  assert.equal(h.current().id, 'viewed');
  assert.ok(h.messages.some((message) => message.type === 'close-ready'));
  await h.emit('backgrounded');
  await h.emit('focus-editor');
  assert.equal(h.current().id, 'edited');
  assert.deepEqual(h.position(), { anchor: 45, head: 52 });
  assert.equal(h.scroller.scrollTop, 600);
  assert.deepEqual(h.history(), ['edited', 'viewed']);
  const before = h.mounts();
  await h.emit('focus-editor');
  assert.equal(h.mounts(), before);
});

test('latest button refreshes MRU after a real save, while failed saves cannot navigate', async (t) => {
  const h = await fixture(t);
  h.button('上一篇').click();
  await h.settle();
  h.history(['viewed', 'edited']);
  h.button('最新篇').click();
  await h.settle();
  assert.equal(h.current().id, 'viewed');
  h.history(['edited', 'viewed']);
  h.failFlush();
  h.button('最新篇').click();
  await h.settle();
  assert.equal(h.current().id, 'viewed');
});

test('background focus preserves pending new-draft input', async (t) => {
  const h = await fixture(t);
  h.draft();
  h.pending(true);
  await h.emit('backgrounded');
  await h.emit('focus-editor');
  assert.equal(h.current().id, 'draft');
  assert.equal(h.current().content, '<p>未保存输入</p>');
  assert.equal(h.mounts(), 0);
});
