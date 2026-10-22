import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSharedSeedReferences } from '../public/shared/shared-seed.js';

test('known desktop global wallpaper and sticker mediaId retain strict packaged original checks', () => {
  const id = '2b2822cf-9822-4a0e-ace6-f4c2c9f440d3';
  const rows = [
    {
      entityType: 'client-preferences',
      entityId: 'desktop:thoughts',
      state: 'active',
      data: { values: { 'shiye-preview-appearance-v1': { wallpaperAssetId: id } } },
    },
    { entityType: 'sticker', entityId: 'sticker-one', state: 'active', data: { mediaId: id } },
  ];
  assert.throws(() => validateSharedSeedReferences(rows, []), {
    code: 'SHARED_SEED_MEDIA_REFERENCE_MISSING',
  });
  assert.doesNotThrow(() => validateSharedSeedReferences(rows, [{ assetId: id }]));
  assert.throws(() => validateSharedSeedReferences([rows[1]], []), {
    code: 'SHARED_SEED_MEDIA_REFERENCE_MISSING',
  });
  assert.doesNotThrow(() =>
    validateSharedSeedReferences(
      rows.map((r) => ({ ...r, state: 'withdrawn', data: {} })),
      [],
    ),
  );
});
test('unknown configuration strings and same wallpaper spelling in another scope never grant asset access', () => {
  const pref = {
    entityType: 'client-preferences',
    entityId: 'android:thoughts',
    state: 'active',
    data: {
      values: {
        'shiye-preview-appearance-v1': { wallpaperAssetId: 'unknown' },
        custom: { assetId: 'unknown' },
      },
    },
  };
  assert.doesNotThrow(() => validateSharedSeedReferences([pref], []));
  assert.doesNotThrow(() =>
    validateSharedSeedReferences(
      [
        {
          ...pref,
          entityId: 'desktop:thoughts',
          data: { values: { custom: { assetId: 'unknown' } } },
        },
      ],
      [],
    ),
  );
});
