import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuickResumePosition } from '../public/features/quick-resume-position.js';

function fixture() {
  let entry = { id: 'draft' },
    position = { anchor: 45, head: 52 },
    focus = null;
  const frames = [];
  const title = {
    selectionStart: 2,
    selectionEnd: 4,
    selectionDirection: 'backward',
    focus() {
      focus = 'title';
    },
    setSelectionRange(...values) {
      [this.selectionStart, this.selectionEnd, this.selectionDirection] = values;
    },
  };
  const editor = {
    capturePosition: () => ({ ...position }),
    restorePosition: (saved) => {
      position = saved;
    },
    focus() {
      focus = 'body';
    },
  };
  const scroller = {
    scrollTop: 600,
    ownerDocument: { defaultView: { requestAnimationFrame: (fn) => frames.push(fn) } },
  };
  const state = createQuickResumePosition({ current: () => entry, title, editor, scroller });
  return {
    state,
    title,
    scroller,
    frames,
    entry: (value) => {
      entry = value;
    },
    position: (value) => (value ? (position = value) : position),
    focus: () => focus,
  };
}

test('saved draft identity resumes body selection and scroll once without rewinding later activation', () => {
  const h = fixture();
  h.state.capture('body');
  h.entry({ id: 'persisted' });
  h.state.saved();
  h.position({ anchor: 0, head: 0 });
  h.scroller.scrollTop = 0;
  assert.equal(h.state.restore(), true);
  assert.deepEqual(h.position(), { anchor: 45, head: 52 });
  assert.equal(h.focus(), 'body');
  h.frames.shift()();
  assert.equal(h.scroller.scrollTop, 600);
  h.position({ anchor: 99, head: 99 });
  h.scroller.scrollTop = 800;
  assert.equal(h.state.restore(), false);
  assert.equal(h.position().anchor, 99);
  assert.equal(h.scroller.scrollTop, 800);
});

test('title selection direction restores, but a different entry cannot receive stale position', () => {
  const h = fixture();
  h.state.capture('title');
  h.title.selectionStart = 0;
  assert.equal(h.state.restore(), true);
  assert.equal(h.focus(), 'title');
  assert.equal(h.title.selectionStart, 2);
  assert.equal(h.title.selectionEnd, 4);
  assert.equal(h.title.selectionDirection, 'backward');
  h.state.capture('body');
  h.entry({ id: 'different' });
  assert.equal(h.state.restore(), false);
  assert.equal(h.state.restore(), false);
});

test('per-entry positions survive browsing another entry and restore the edited entry rather than the last viewed one', () => {
  const h = fixture();
  h.entry({ id: 'edited' });
  h.state.capture('body');
  h.entry({ id: 'viewed' });
  h.position({ anchor: 2, head: 3 });
  h.scroller.scrollTop = 120;
  h.state.capture('title');
  h.entry({ id: 'edited' });
  h.position({ anchor: 0, head: 0 });
  h.scroller.scrollTop = 0;
  assert.equal(h.state.restore(), true);
  assert.deepEqual(h.position(), { anchor: 45, head: 52 });
  assert.equal(h.scroller.scrollTop, 600);
  h.entry({ id: 'viewed' });
  assert.equal(h.state.restore(), true);
  assert.equal(h.focus(), 'title');
  assert.equal(h.scroller.scrollTop, 120);
});

test('navigation uses editor resume snapshots independently of transient upload bookmarks and maps saved draft identity', () => {
  let current = { id: 'draft' };
  let restored = null;
  const position = { format: 'richdoc', entryId: 'draft', anchor: 42, head: 44 };
  const editor = {
    captureResumePosition: () => ({ ...position }),
    restoreResumePosition: (value) => {
      restored = value;
      return true;
    },
    capturePosition: () => assert.fail('do not allocate an upload bookmark'),
    restorePosition: () => assert.fail('do not bypass upload bookmark safety'),
    focus() {},
  };
  const state = createQuickResumePosition({
    current: () => current,
    editor,
    title: {},
    scroller: {
      scrollTop: 30,
      ownerDocument: { defaultView: { requestAnimationFrame: (callback) => callback() } },
    },
  });
  state.capture('body');
  current = { id: 'persisted' };
  state.saved();
  assert.equal(state.restore(), true);
  assert.equal(restored.entryId, 'persisted');
  assert.equal(restored.anchor, 42);
});
