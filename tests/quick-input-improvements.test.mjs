import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
import { installTitleNavigation } from '../public/features/title-navigation.js';

test('a stale category-order preview cannot overwrite another window reorder', async (t) => {
  const { request } = await fixture(t);
  for (const to of ['甲', '乙', '丙'])
    await request('/api/taxonomy', 'POST', { kind: 'category', action: 'create', from: '', to });
  const library = await (await request('/api/library')).json();
  const expectedOrder = library.categories;
  const first = [...expectedOrder].reverse();
  assert.equal(
    (await request('/api/taxonomy/order', 'PUT', { kind: 'category', order: first, expectedOrder }))
      .status,
    200,
  );
  assert.equal(
    (
      await request('/api/taxonomy/order', 'PUT', {
        kind: 'category',
        order: expectedOrder,
        expectedOrder,
      })
    ).status,
    409,
  );
  assert.deepEqual((await (await request('/api/library')).json()).categories, first);
  assert.equal(
    (await request('/api/preferences', 'PUT', { quickInitialFocus: 'title' })).status,
    200,
  );
  assert.equal(
    (await request('/api/preferences', 'PUT', { quickInitialFocus: 'invalid' })).status,
    400,
  );
});

test('body boundary navigation preserves text, selection and IME candidate navigation', () => {
  const title = new EventTarget(),
    body = new EventTarget();
  title.value = '标题';
  let focus = 0,
    atStart = true,
    clock = 100;
  title.focus = () => focus++;
  title.setSelectionRange = (from, to) => {
    title.selectionStart = from;
    title.selectionEnd = to;
  };
  const dispose = installTitleNavigation(title, {
    body,
    atBodyStart: () => atStart,
    focusBody: () => {},
    now: () => clock,
  });
  const emit = (type, props = {}) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, props);
    body.dispatchEvent(event);
    return event;
  };
  emit('compositionstart');
  assert.equal(emit('keydown', { key: 'ArrowUp' }).defaultPrevented, false);
  emit('compositionend');
  assert.equal(emit('keydown', { key: 'ArrowUp' }).defaultPrevented, false);
  clock += 50;
  assert.equal(emit('keydown', { key: 'ArrowUp', shiftKey: true }).defaultPrevented, false);
  atStart = false;
  assert.equal(emit('keydown', { key: 'ArrowUp' }).defaultPrevented, false);
  atStart = true;
  assert.equal(emit('keydown', { key: 'ArrowUp' }).defaultPrevented, true);
  assert.equal(focus, 1);
  assert.equal(title.selectionStart, title.value.length);
  assert.equal(emit('keydown', { key: 'Backspace' }).defaultPrevented, false);
  dispose();
  assert.equal(emit('keydown', { key: 'ArrowUp' }).defaultPrevented, false);
});
