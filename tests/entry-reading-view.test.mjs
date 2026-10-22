import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createEntryReadingDocument } from '../public/features/entry-reading-document.js';
function fixture(t) {
  const dom = new JSDOM('<div id="bodyEditor"></div>');
  t.after(() => dom.window.close());
  let current = { id: 'old', revision: 1, content: '<p>原文</p>', category: '分类', tags: [] };
  const pending = [],
    displays = [];
  let isReading = false,
    exits = 0;
  const editor = {
    get isReadingDocument() {
      return isReading;
    },
    renderReadingDocument(entry, p) {
      displays.push(p);
      isReading = true;
    },
    exitReadingDocument() {
      isReading = false;
      exits++;
    },
    focus() {},
  };
  const c = {
    $: (s) => dom.window.document.querySelector(s),
    current: () => current,
    editor,
    flush: async () => {},
    toast: () => {},
    renderAttachments() {},
    api: () => new Promise((resolve) => pending.push(resolve)),
  };
  const feature = createEntryReadingDocument(c);
  return {
    feature,
    pending,
    displays,
    c,
    set: (e) => (current = e),
    get: () => current,
    exits: () => exits,
    dom,
  };
}
const settle = () => new Promise(setImmediate);
test('reading is default for saved legacy entries and explicit original editing remains available without mutating data', async (t) => {
  const f = fixture(t),
    before = structuredClone(f.get());
  f.feature.render(f.get());
  assert.equal(f.c.editor.isReadingDocument, true);
  assert.equal(f.pending.length, 1);
  f.pending.shift()({ source: { id: 'old', revision: 1 }, mode: 'richdoc', html: '<p>新显示</p>' });
  await settle();
  assert.match(f.displays.at(-1).html, /新显示/);
  assert.deepEqual(f.get(), before);
  await f.feature.editOriginal();
  assert.equal(f.c.editor.isReadingDocument, false);
  assert.equal(f.exits(), 1);
  f.feature.render(f.get());
  assert.equal(f.pending.length, 0);
  assert.deepEqual(f.get(), before);
  await f.feature.show();
  assert.equal(f.pending.length, 1);
});
test('late reading responses cannot replace a different diary and revisions are checked before display', async (t) => {
  const f = fixture(t);
  f.feature.render(f.get());
  const resolve = f.pending.shift();
  f.set({ id: 'new', revision: 1, contentFormat: 'richdoc', body: {} });
  f.feature.render(f.get());
  const count = f.displays.length;
  resolve({ source: { id: 'old', revision: 1 }, mode: 'richdoc', html: '<p>不能覆盖</p>' });
  await settle();
  assert.equal(f.displays.length, count);
  assert.equal(f.feature.projection(), null);
  f.set({ id: 'old', revision: 2, content: '修订' });
  f.feature.render(f.get());
  f.pending.shift()({ source: { id: 'old', revision: 1 }, html: '过期' });
  await settle();
  assert.doesNotMatch(f.displays.at(-1).html, /过期/);
});

test('empty startup has no reading projection', (t) => {
  const f = fixture(t);
  f.set(null);
  f.feature.render(null);
  assert.equal(f.feature.projection(), null);
});
