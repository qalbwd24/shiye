import assert from 'node:assert/strict';
import test from 'node:test';
import { createLayout } from '../public/features/layout.js';

class Element extends EventTarget {
  classes = new Set();
  attributes = {};
  dataset = {};
  capture = null;
  classList = {
    add: (...names) => names.forEach((name) => this.classes.add(name)),
    remove: (...names) => names.forEach((name) => this.classes.delete(name)),
    contains: (name) => this.classes.has(name),
    toggle: (name, on) => (on ? this.classes.add(name) : this.classes.delete(name)),
  };
  setAttribute(key, value) {
    this.attributes[key] = value;
  }
  querySelector() {
    return new Element();
  }
  getBoundingClientRect() {
    return { width: 360 };
  }
  setPointerCapture(id) {
    this.capture = id;
  }
  hasPointerCapture(id) {
    return this.capture === id;
  }
  releasePointerCapture() {
    this.capture = null;
  }
}

function setup(t, overrides = {}) {
  const nodes = new Map();
  const $ = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, new Element());
    return nodes.get(selector);
  };
  const document = Object.assign(new EventTarget(), {
    body: new Element(),
    documentElement: { style: { setProperty() {} } },
  });
  const globals = {
    document,
    window: new EventTarget(),
    localStorage: { getItem: () => null },
    matchMedia: () => ({ matches: false }),
  };
  const originals = Object.keys(globals).map((name) => [
    name,
    Object.getOwnPropertyDescriptor(globalThis, name),
  ]);
  for (const [name, value] of Object.entries(globals))
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  t.after(() => {
    globals.window.dispatchEvent(new Event('blur'));
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  const requests = [];
  // Saved width exceeds the rendered width: dragging must start at the visible edge.
  const library = { settings: { preferences: { layout: { mediaWidth: 500 } } } };
  const layout = createLayout({
    $,
    $$: () => [],
    library,
    toast: () => {},
    api: async (_path, { data }) => {
      requests.push(data);
      return { ...library.settings.preferences, layout: data.layout };
    },
    ...overrides,
  });
  layout.apply();
  const handle = $('#mediaResize');
  function pointer(type, x) {
    return Object.assign(new Event(type), { pointerId: 1, clientX: x, button: 0, isPrimary: true });
  }
  return {
    $,
    layout,
    requests,
    handle,
    document,
    window: globals.window,
    drag() {
      handle.onpointerdown(pointer('pointerdown', 500));
      handle.dispatchEvent(pointer('pointermove', 400));
      assert.equal(layout.read().mediaWidth, 460);
    },
    release: () => handle.dispatchEvent(pointer('pointerup', 400)),
  };
}

for (const cancellation of ['pointercancel', 'lostpointercapture', 'blur']) {
  test(`${cancellation} rolls back the drag without saving preferences`, async (t) => {
    const h = setup(t);
    h.drag();
    (cancellation === 'blur' ? h.window : h.handle).dispatchEvent(new Event(cancellation));
    h.release();
    await new Promise(setImmediate);
    assert.equal(h.layout.read().mediaWidth, 500);
    assert.equal(h.requests.length, 0);
    assert.equal(h.document.body.classList.contains('resizing-pane'), false);
    assert.equal(h.handle.capture, null);
  });
}

test('pointer release saves the visible drag width once and releases capture', async (t) => {
  const h = setup(t);
  h.drag();
  h.release();
  h.release();
  await new Promise(setImmediate);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].layout.mediaWidth, 460);
  assert.equal(h.layout.read().mediaWidth, 460);
  assert.equal(h.document.body.classList.contains('resizing-pane'), false);
  assert.equal(h.handle.capture, null);
});

test('the list binder waits for saving and opens a visible list from another view', async (t) => {
  let finishSaving;
  const views = [];
  const h = setup(t, {
    flush: () =>
      new Promise((resolve) => {
        finishSaving = resolve;
      }),
    changeView: async (view) => {
      views.push(view);
      h.$('#journalView').classList.remove('hidden');
    },
  });
  h.$('#journalView').classList.add('hidden', 'has-selected');
  const opening = h.$('#listToggle').onclick();
  assert.deepEqual(views, []);
  assert.equal(h.requests.length, 0);
  finishSaving();
  await opening;
  assert.deepEqual(views, ['all']);
  assert.equal(h.$('#journalView').classList.contains('hidden'), false);
  assert.equal(h.$('#journalView').classList.contains('has-selected'), false);
  assert.equal(h.layout.read().list, false);
  assert.equal(h.requests.length, 1);
});

test('the list binder preserves the current view when saving fails', async (t) => {
  const errors = [];
  const h = setup(t, {
    flush: async () => {
      throw Error('Save failed');
    },
    changeView: async () => assert.fail('must preserve the current view'),
    toast: (message) => errors.push(message),
  });
  h.$('#journalView').classList.add('hidden');
  await h.$('#listToggle').onclick();
  assert.equal(h.$('#journalView').classList.contains('hidden'), true);
  assert.equal(h.requests.length, 0);
  assert.deepEqual(errors, ['Save failed']);
});
