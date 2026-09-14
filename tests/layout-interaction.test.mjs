import assert from 'node:assert/strict';
import test from 'node:test';
import { createLayout } from '../public/features/layout.js';

class Element extends EventTarget {
  classes = new Set();
  attributes = {};
  dataset = {};
  style = {};
  rect = { width: 360, height: 600, left: 0, right: 360, top: 0 };
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
    return this.rect;
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
  const frames = new Map();
  const widthWrites = [];
  let frameId = 0;
  const nodes = new Map();
  const $ = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, new Element());
    return nodes.get(selector);
  };
  const document = Object.assign(new EventTarget(), {
    body: new Element(),
    documentElement: {
      clientWidth: 1600,
      style: { setProperty: (name, value) => widthWrites.push([name, value]) },
    },
  });
  const globals = {
    document,
    window: new EventTarget(),
    localStorage: { getItem: () => null },
    matchMedia: () => ({ matches: false }),
    getComputedStyle: (node) => ({ display: node.style.display || 'flex' }),
    requestAnimationFrame: (callback) => {
      frames.set(++frameId, callback);
      return frameId;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
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
    widthWrites,
    frame() {
      const batch = [...frames.values()];
      frames.clear();
      for (const callback of batch) callback();
    },
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

test('binder tabs follow panel boundaries and use the current list name', (t) => {
  const h = setup(t);
  h.$('#mainSidebar').rect = { left: 12, right: 220, top: 0, width: 208, height: 900 };
  h.$('.workspace').rect = { left: 250, right: 1588, top: 0, width: 1338, height: 900 };
  h.$('#entryPanel').rect = { left: 250, right: 530, top: 64, width: 280, height: 836 };
  h.$('#editorPanel').rect = { left: 560, right: 1588, top: 64, width: 1028, height: 836 };
  h.$('#entryMediaPane').rect = { left: 1248, right: 1588, top: 64, width: 340, height: 836 };
  h.$('#listToggleLabel').textContent = '旅行';
  h.layout.apply();
  h.frame();
  assert.equal(h.$('#sidebarFold').style.transform, 'translate3d(220px, 22px, 0)');
  assert.equal(h.$('#listToggle').style.transform, 'translate3d(530px, 112px, 0)');
  assert.equal(h.$('#mediaToggle').style.transform, 'translate3d(1218px, 182px, 0)');
  assert.equal(h.$('#listToggle').attributes['aria-label'], '折叠旅行');
  h.$('#mainSidebar').rect.right = 12;
  h.$('#entryColumns').dataset.mediaPosition = 'left';
  h.$('#entryMediaPane').rect.right = 900;
  h.window.dispatchEvent(new Event('resize'));
  h.frame();
  assert.equal(h.$('#sidebarFold').style.transform, 'translate3d(12px, 22px, 0)');
  assert.equal(h.$('#mediaToggle').style.transform, 'translate3d(900px, 182px, 0)');
  assert.equal(h.$('#mediaToggle').dataset.edge, 'right');
});

test('drag moves are coalesced into one width write per frame without rebuilding folds', (t) => {
  const h = setup(t);
  h.frame();
  h.widthWrites.length = 0;
  h.drag();
  h.handle.dispatchEvent(Object.assign(new Event('pointermove'), { pointerId: 1, clientX: 390 }));
  h.handle.dispatchEvent(Object.assign(new Event('pointermove'), { pointerId: 1, clientX: 380 }));
  assert.equal(h.widthWrites.length, 0);
  h.frame();
  assert.deepEqual(h.widthWrites, [['--media-width', '480px']]);
  assert.equal(h.requests.length, 0);
});
