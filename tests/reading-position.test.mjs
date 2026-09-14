import assert from 'node:assert/strict';
import test from 'node:test';
import { createReadingPosition } from '../public/features/reading-position.js';

class Pane extends EventTarget {
  clientWidth = 600;
  clientHeight = 500;
  scrollHeight = 2191;
  style = { overflowY: 'auto', visibility: 'visible' };
  position = 0;
  images = [];
  get scrollTop() {
    return this.position;
  }
  set scrollTop(value) {
    this.position = Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight));
    this.dispatchEvent(new Event('scroll'));
  }
  querySelectorAll() {
    return this.images;
  }
}

function setup(t) {
  const selectors = ['.writing-scroll', '.media-pane-scroll', '#entryColumns'];
  const panes = selectors.map(() => new Pane());
  panes[1].style.overflowY = panes[2].style.overflowY = 'hidden';
  const key = 'shiye.reading-position.v1';
  const storage = new Map([[key, JSON.stringify([{ id: 'a', offsets: [2000, 350, 100] }])]]);
  const frames = new Map();
  let frameId = 0;
  let time = 0;
  const globals = {
    localStorage: {
      getItem: (key) => storage.get(key),
      setItem: (key, value) => storage.set(key, value),
    },
    getComputedStyle: (pane) => pane.style,
    document: { fonts: { status: 'loaded' } },
    window: new EventTarget(),
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
  const reader = createReadingPosition({ $: (selector) => panes[selectors.indexOf(selector)] });
  t.after(() => {
    reader.select(null);
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  return {
    panes,
    reader,
    pagehide: () => globals.window.dispatchEvent(new Event('pagehide')),
    records: () => JSON.parse(storage.get(key)),
    advance(count) {
      for (let i = 0; i < count; i++) {
        time += 16;
        const batch = [...frames.values()];
        frames.clear();
        for (const callback of batch) callback(time);
      }
    },
  };
}

test('restoration retries a clamped offset after the panel transition settles', (t) => {
  const h = setup(t);
  h.reader.select('a');
  h.advance(8);
  assert.equal(h.panes[0].scrollTop, 1691);
  h.panes[0].scrollHeight = 3500;
  h.advance(30);
  assert.equal(h.panes[0].scrollTop, 2000);
  h.pagehide();
  assert.deepEqual(h.records()[0].offsets, [2000, 350, 100]);
});

test('eager image loading keeps restoration alive beyond the width transition', (t) => {
  const h = setup(t);
  h.panes[0].scrollHeight = 3500;
  h.panes[2].images = [{ complete: false, loading: 'eager' }];
  h.reader.select('a');
  h.advance(50);
  // Simulate late media layout anchoring, even after the target was first reachable.
  h.panes[0].scrollTop = 1691;
  h.panes[2].images[0].complete = true;
  h.advance(30);
  assert.equal(h.panes[0].scrollTop, 2000);
  h.pagehide();
  assert.equal(h.records()[0].offsets[0], 2000);
});

test('reader input cancels restoration and saves the new reading offset', (t) => {
  const h = setup(t);
  h.reader.select('a');
  h.advance(1);
  h.panes[0].dispatchEvent(new Event('wheel'));
  h.panes[0].scrollTop = 120;
  h.advance(40);
  assert.equal(h.panes[0].scrollTop, 120);
  h.pagehide();
  assert.equal(h.records()[0].offsets[0], 120);
});

test('bottom layout saves its active scroller without erasing inactive pane offsets', (t) => {
  const h = setup(t);
  h.reader.select('a');
  h.advance(1);
  h.panes[0].dispatchEvent(new Event('wheel'));
  h.panes[0].style.overflowY = 'visible';
  h.panes[0].scrollTop = 0;
  h.panes[2].style.overflowY = 'auto';
  h.panes[2].scrollTop = 160;
  h.pagehide();
  assert.deepEqual(h.records()[0].offsets, [2000, 350, 160]);
});
