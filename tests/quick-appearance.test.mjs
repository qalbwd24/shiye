import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
import {
  normalizeQuickAppearance,
  quickAppearanceDefaults,
} from '../public/shared/quick-appearance.js';

test('quick appearance defaults inherit, validates ranges and does not retain unsafe values', () => {
  assert.deepEqual(normalizeQuickAppearance(), quickAppearanceDefaults());
  for (const value of [
    null,
    [],
    { backgroundMode: 'remote' },
    { theme: 'invalid' },
    { backgroundMode: 'custom' },
    { fontSize: 2 },
    { fontWeight: Infinity },
    { lineHeight: 5 },
    { titleSize: 80 },
    { blur: -1 },
    { fontFamily: 'url(evil)' },
    { inheritTypography: 'true' },
    { background: { id: 'x' } },
  ])
    assert.throws(() => normalizeQuickAppearance(value));
  const result = normalizeQuickAppearance({
    fontSize: 12,
    fontWeight: 800,
    lineHeight: 1.2,
    unrelated: 'ignored',
  });
  assert.equal(result.fontSize, 12);
  assert.equal(result.unrelated, undefined);
});

test('quick preferences preserve main settings, persist to library and reject missing/wrong-purpose wallpaper atomically', async (t) => {
  const { base, request } = await fixture(t);
  const post = async (endpoint) =>
    (
      await fetch(base + endpoint, {
        method: 'POST',
        headers: { 'X-Diary-Client': 'desktop', 'Content-Type': 'image/gif' },
        body: Buffer.from('GIF89a-test'),
      })
    ).json();
  const background = await post('/api/backgrounds');
  const attachment = await post('/api/media');
  const main = {
    fontSize: 24,
    fontFamily: 'serif',
    appearance: { accent: '#8066b5', backgrounds: [] },
  };
  assert.equal((await request('/api/preferences', 'PUT', main)).status, 200);
  const quickAppearance = normalizeQuickAppearance({
    theme: 'system',
    backgroundMode: 'custom',
    background: { id: background.id, opacity: 0.42, fill: 'contain', position: 'top' },
    inheritTypography: false,
    fontSize: 14,
    fontWeight: 600,
    titleSize: 32,
    titleWeight: 800,
    blur: 4,
  });
  assert.equal((await request('/api/preferences', 'PUT', { quickAppearance })).status, 200);
  const saved = (await (await request('/api/library')).json()).settings.preferences;
  assert.deepEqual(saved.quickAppearance, quickAppearance);
  assert.equal(saved.fontSize, main.fontSize);
  assert.equal(saved.fontFamily, main.fontFamily);
  assert.deepEqual(saved.appearance, main.appearance);
  for (const id of [attachment.id, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa']) {
    const invalid = { ...quickAppearance, background: { ...quickAppearance.background, id } };
    assert.equal(
      (await request('/api/preferences', 'PUT', { fontSize: 16, quickAppearance: invalid })).status,
      400,
    );
  }
  assert.deepEqual((await (await request('/api/library')).json()).settings.preferences, saved);
  const manifest = await (await request('/api/backup-manifest')).json();
  assert.deepEqual(manifest.library.settings.preferences.quickAppearance, quickAppearance);
  assert.equal(
    manifest.library.media.find((item) => item.id === background.id).purpose,
    'background',
  );
  assert.equal(
    (await request('/api/preferences', 'PUT', { quickAppearance: quickAppearanceDefaults() }))
      .status,
    200,
  );
  const reset = (await (await request('/api/library')).json()).settings.preferences;
  assert.equal(reset.quickAppearance.backgroundMode, 'inherit');
  assert.equal(reset.fontSize, main.fontSize);
});
