import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLayout } from '../public/shared/appearance.js';
import { fixture } from './helpers.mjs';

test('workbench accepts legacy folds and validates optional placement and widths', () => {
  assert.deepEqual(normalizeLayout({ list: true }), { categories: false, tags: false, list: true });
  const value = {
    sidebar: true,
    media: false,
    mediaPosition: 'left',
    mediaWidth: 680,
    listWidth: 220,
  };
  assert.deepEqual(normalizeLayout(value), {
    categories: false,
    tags: false,
    list: false,
    ...value,
  });
  for (const invalid of [
    { mediaPosition: 'floating' },
    { mediaWidth: 239 },
    { mediaWidth: 681 },
    { mediaWidth: 340.5 },
    { listWidth: 441 },
    { sidebar: 'true' },
    { unknown: true },
  ]) {
    assert.throws(() => normalizeLayout(invalid));
  }
});

test('workbench layout persists independently of other preferences and rejects bad widths atomically', async (t) => {
  const { request } = await fixture(t);
  assert.equal(
    (
      await request('/api/preferences', 'PUT', {
        fontSize: 20,
        layout: { sidebar: true, mediaPosition: 'bottom', mediaWidth: 400, listWidth: 300 },
      })
    ).status,
    200,
  );
  const saved = (await (await request('/api/library')).json()).settings.preferences;
  assert.equal(saved.fontSize, 20);
  assert.equal(saved.layout.mediaPosition, 'bottom');
  assert.equal(saved.layout.sidebar, true);
  assert.equal(
    (await request('/api/preferences', 'PUT', { fontSize: 14, layout: { mediaWidth: 700 } }))
      .status,
    400,
  );
  assert.deepEqual((await (await request('/api/library')).json()).settings.preferences, saved);
});
