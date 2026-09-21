import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReturnNavigation } from '../public/features/return-navigation.js';

function setup() {
  const state = { page: 'memories', mode: 'list', limit: 160, order: ['b', 'a'], scroll: 420 };
  let failure = false,
    controls;
  const nav = createReturnNavigation({
    prepare: async () => {
      if (failure) throw Error('save failed');
    },
    capture: () => structuredClone(state),
    restore: (snapshot) => Object.assign(state, snapshot),
    update: (origin, busy) => {
      controls = { origin, busy };
    },
  });
  return {
    nav,
    state,
    fail: (value) => {
      failure = value;
    },
    controls: () => controls,
  };
}
test('detail back restores original range, order, pagination and offset, not intervening detail', async () => {
  const t = setup();
  await t.nav.open(() => {
    t.state.page = 'entry-a';
  });
  await t.nav.open(() => {
    t.state.page = 'entry-b';
    t.state.scroll = 0;
  });
  assert.equal(t.controls().origin.page, 'memories');
  await t.nav.back();
  assert.deepEqual(t.state, {
    page: 'memories',
    mode: 'list',
    limit: 160,
    order: ['b', 'a'],
    scroll: 420,
  });
  assert.equal(t.controls().origin, null);
});
test('failed save blocks opening or returning and preserves retry target', async () => {
  const t = setup();
  t.fail(true);
  await assert.rejects(
    t.nav.open(() => {
      t.state.page = 'entry';
    }),
    /save failed/,
  );
  assert.equal(t.state.page, 'memories');
  t.fail(false);
  await t.nav.open(() => {
    t.state.page = 'entry';
  });
  t.fail(true);
  await assert.rejects(t.nav.back(), /save failed/);
  assert.equal(t.state.page, 'entry');
  assert.equal(t.controls().origin.page, 'memories');
  assert.equal(t.controls().busy, false);
  t.fail(false);
  assert.equal(await t.nav.back(), true);
});
test('explicit navigation cancels a pending open and clears obsolete origin', async () => {
  let finish,
    opened = false,
    origin;
  const nav = createReturnNavigation({
    prepare: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    capture: () => ({ page: 'gallery' }),
    restore() {},
    update: (value) => {
      origin = value;
    },
  });
  const pending = nav.open(() => {
    opened = true;
  });
  assert.equal(await nav.open(() => {}), false);
  nav.clear();
  finish();
  assert.equal(await pending, false);
  assert.equal(opened, false);
  assert.equal(origin, null);
});
test('deleted/unavailable diary does not create an empty return destination', async () => {
  const t = setup();
  assert.equal(await t.nav.open(() => false), false);
  assert.equal(t.controls().origin, null);
  assert.equal(await t.nav.back(), false);
});
