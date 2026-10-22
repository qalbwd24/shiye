import test from 'node:test';
import assert from 'node:assert/strict';
import { createDragAutoScroll, dragScrollStep } from '../public/core/drag-scroll.js';

function fixture() {
  let sequence = 0;
  const frames = new Map();
  const win = {
    innerWidth: 600,
    innerHeight: 500,
    requestAnimationFrame(callback) {
      frames.set(++sequence, callback);
      return sequence;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
    getComputedStyle(node) {
      return node.style;
    },
  };
  const doc = { defaultView: win };
  const node = (top, bottom, height, parentElement = null) => ({
    ownerDocument: doc,
    isConnected: true,
    parentElement,
    scrollTop: 0,
    scrollHeight: height,
    clientHeight: bottom - top,
    style: { overflowY: 'auto', overflowX: 'hidden' },
    getBoundingClientRect: () => ({ top, bottom, left: 0, right: 300 }),
  });
  const outer = node(0, 300, 1200);
  const root = node(100, 300, 900, outer);
  let measures = 0;
  const controller = createDragAutoScroll(root, () => {
    measures++;
  });
  const tick = () => {
    const [id, callback] = frames.entries().next().value;
    frames.delete(id);
    callback();
  };
  return { root, outer, frames, controller, tick, measures: () => measures };
}

test('stationary drag scrolls the nearest list continuously and stop cancels future frames', () => {
  const h = fixture();
  h.controller.update({ clientX: 150, clientY: 294 });
  h.tick();
  h.tick();
  assert.ok(h.root.scrollTop > 18);
  assert.equal(h.outer.scrollTop, 0);
  assert.equal(h.measures(), 2);
  h.controller.stop();
  assert.equal(h.frames.size, 0);
});

test('nested scrolling falls back to the outer pane at the list boundary', () => {
  const h = fixture();
  h.root.scrollTop = 700;
  h.controller.update({ clientX: 150, clientY: 297 });
  h.tick();
  assert.equal(h.root.scrollTop, 700);
  assert.ok(h.outer.scrollTop > 0);
});

test('drag outside the visible list, in its middle or after removal cannot scroll', () => {
  for (const point of [
    { clientX: 400, clientY: 297 },
    { clientX: 100, clientY: 900 },
    { clientX: 100, clientY: 200 },
  ]) {
    const h = fixture();
    h.controller.update(point);
    h.tick();
    assert.equal(h.root.scrollTop, 0);
    assert.equal(h.outer.scrollTop, 0);
    assert.equal(h.frames.size, 0);
  }
  const h = fixture();
  h.controller.update({ clientX: 100, clientY: 297 });
  h.root.isConnected = false;
  h.tick();
  assert.equal(h.root.scrollTop, 0);
  assert.equal(h.frames.size, 0);
  assert.equal(dragScrollStep(101, 100, 300) < 0, true);
  assert.equal(dragScrollStep(200, 100, 100), 0);
});
