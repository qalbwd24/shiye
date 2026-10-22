import test from 'node:test';
import assert from 'node:assert/strict';
import { installTitleNavigation } from '../public/features/title-navigation.js';

function surface() {
  const title = new EventTarget();
  title.value = '合成标题';
  const document = { source: '原正文', cursor: 2 };
  let time = 1000;
  let focused = 0;
  let allowed = true;
  const dispose = installTitleNavigation(title, {
    focusBody: () => focused++,
    canFocus: () => allowed,
    now: () => time,
  });
  function emit(type, properties = {}) {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, properties);
    title.dispatchEvent(event);
    return event;
  }
  return {
    title,
    document,
    emit,
    dispose,
    get focused() {
      return focused;
    },
    allow(value) {
      allowed = value;
    },
    advance(value) {
      time += value;
    },
  };
}

test('plain title Enter focuses the existing body without inserting time or changing its cursor', () => {
  const h = surface();
  const original = structuredClone(h.document);
  assert.equal(h.emit('keydown', { key: 'Enter' }).defaultPrevented, true);
  assert.equal(h.focused, 1);
  assert.equal(h.title.value, '合成标题');
  assert.deepEqual(h.document, original);
});

test('title navigation ignores modified, repeated, composing and unrelated keys', () => {
  const h = surface();
  for (const properties of [
    { key: 'a' },
    ...['ctrlKey', 'shiftKey', 'altKey', 'metaKey', 'repeat', 'isComposing'].map((name) => ({
      key: 'Enter',
      [name]: true,
    })),
    { key: 'Enter', keyCode: 229 },
  ])
    assert.equal(h.emit('keydown', properties).defaultPrevented, false);
  assert.equal(h.focused, 0);
});

test('IME confirmation stays in title even when compositionend precedes Enter keydown', () => {
  const h = surface();
  h.emit('compositionstart');
  assert.equal(h.emit('keydown', { key: 'Enter' }).defaultPrevented, false);
  h.emit('compositionend');
  assert.equal(h.emit('keydown', { key: 'Enter' }).defaultPrevented, false);
  h.emit('keyup', { key: 'Enter' });
  assert.equal(h.emit('keydown', { key: 'Enter' }).defaultPrevented, true);
  assert.equal(h.focused, 1);
  h.emit('compositionend');
  h.advance(50);
  assert.equal(h.emit('keydown', { key: 'Enter' }).defaultPrevented, true);
});

test('read-only or unavailable editors stay untouched and handlers can be removed', () => {
  const h = surface();
  for (const property of ['disabled', 'readOnly']) {
    h.title[property] = true;
    assert.equal(h.emit('keydown', { key: 'Enter' }).defaultPrevented, false);
    h.title[property] = false;
  }
  h.allow(false);
  assert.equal(h.emit('keydown', { key: 'Enter' }).defaultPrevented, false);
  h.allow(true);
  h.dispose();
  assert.equal(h.emit('keydown', { key: 'Enter' }).defaultPrevented, false);
  assert.equal(h.focused, 0);
});
