import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { desktopCollectionRecipe } from '../src/server/shared-sync/desktop-collection-recipe.mjs';
import { validateSharedSeedReferences } from '../public/shared/shared-seed.js';
const sha = '1'.repeat(64),
  sourceId = randomUUID(),
  mediaId = randomUUID(),
  stickerId = randomUUID();
function fixture() {
  const room = Object.assign(Object.create(null), {
    id: '-103',
    title: 'synthetic',
    idleHours: 5,
    wallpaperAssetId: 'wallpaper:room:fixture',
    unknown: { retained: true },
  });
  const blob = {
    captureBinary: { type: 'Blob', path: 'media/' + sha, sha256: sha, size: 3, mime: 'image/png' },
  };
  const capture = {
    sourceId,
    manifestSha256: '2'.repeat(64),
    sourceSha256: '3'.repeat(64),
    link: { rooms: { '-103': { category: '日常' } } },
    library: {
      shiyeRooms: { '-103': room },
      messages: {},
      dialogs: { active: [{ id: '-103', pinned: true }], archived: [] },
      users: [],
    },
    members: new Map(),
    assets: {
      values: [
        { id: 'wallpaper:room:fixture', blob },
        {
          id: 'sticker:fixture',
          blob,
          name: 'same',
          note: 'same note',
          serverStickerId: stickerId,
          serverMediaId: mediaId,
        },
        { id: 'wallpaper:room:orphan', blob },
      ],
    },
    preferences: {
      version: 1,
      values: {
        'shiye-preview-appearance-v1': JSON.stringify({
          fontSize: 18,
          wallpaper: 'data:image/png;base64,' + 'a'.repeat(300000),
          unknown: { preserved: 7 },
        }),
        'shiye-room-order-v1': '["-103"]',
        'shiye-room-switch-sidebar-v1':
          '{"previousMode":"manual","effectivePreviousMode":"manual"}',
        'shiye-switch-timing-v2': '1',
      },
      dataUrlMedia: [
        {
          sourceKey: 'shiye-preview-appearance-v1',
          field: 'wallpaper',
          path: 'media/' + sha,
          sha256: sha,
          size: 3,
          mime: 'image/png',
        },
      ],
      uncollectedKeys: ['tt-last-activity'],
    },
  };
  const db = {
    entries: [],
    media: [{ id: mediaId, type: 'image/png', sha256: sha, size: 3 }],
    stickers: [
      { id: stickerId, mediaId, name: 'same', note: 'same note', group: '默认', deleted: false },
    ],
    categories: ['日常'],
    chatJournal: {
      rooms: [{ sourceId, id: '-103', title: 'synthetic', category: '日常', idleHours: 5 }],
    },
  };
  return { db, capture };
}
test('recipe reuses pure PC projection, preserves unknown preferences and optional absent sticker fields; no write or identity is fabricated', () => {
  const { db, capture } = fixture(),
    before = structuredClone(db);
  const recipe = desktopCollectionRecipe(db, capture);
  assert.deepEqual(db, before);
  assert.equal(recipe.summary.completeComputerExport, false);
  assert.equal(recipe.summary.writesPerformed, false);
  assert.equal(db._sharedSync, undefined);
  assert.equal(recipe.preferences.input.set['shiye-preview-appearance-v1'].unknown.preserved, 7);
  assert.equal(recipe.preferences.input.set['shiye-preview-appearance-v1'].wallpaper, undefined);
  assert.equal(recipe.preferences.input.set['shiye-room-switch-sidebar-v1'], undefined);
  assert.equal(recipe.preferences.input.set.restoreReceipts.values['shiye-switch-timing-v2'], '1');
  assert.equal(
    recipe.preferences.input.set.restoreReceipts.values['shiye-room-switch-sidebar-v1'],
    capture.preferences.values['shiye-room-switch-sidebar-v1'],
  );
  assert.equal(recipe.summary.counts.unclassifiedStorageKeys, 0);
  assert.equal(recipe.stickers[0].disposition, 'reuse');
  assert.equal(db.stickers[0].group, '默认');
  assert.equal(recipe.summary.counts.privateResources, 1);
  assert.equal(recipe.summary.counts.wallpaperBindings, 1);
  assert.equal(recipe.wallpapers[0].input.sharedAssetId, mediaId);
  assert.equal(
    recipe.preferences.input.set['shiye-preview-appearance-v1'].wallpaperAssetId,
    mediaId,
  );
  assert.equal(
    recipe.preferenceResourceBindings[0].rendererStatus,
    'pending-explicit-frontend-resolver',
  );
  assert.ok(recipe.excluded.some((row) => row.path.endsWith('.wallpaper')));
});

test('only known wallpaper preference pointer and original sticker mediaId require packaged originals', () => {
  const pref = {
    entityType: 'client-preferences',
    entityId: 'desktop:thoughts',
    state: 'active',
    data: {
      values: {
        'shiye-preview-appearance-v1': { wallpaperAssetId: mediaId },
        ordinaryUnknown: 'not-an-asset',
      },
    },
  };
  assert.throws(() => validateSharedSeedReferences([pref], []), {
    code: 'SHARED_SEED_MEDIA_REFERENCE_MISSING',
  });
  assert.doesNotThrow(() => validateSharedSeedReferences([pref], [{ assetId: mediaId }]));
  assert.throws(
    () =>
      validateSharedSeedReferences(
        [{ entityType: 'sticker', state: 'active', data: { mediaId } }],
        [],
      ),
    { code: 'SHARED_SEED_MEDIA_REFERENCE_MISSING' },
  );
  assert.doesNotThrow(() =>
    validateSharedSeedReferences(
      [{ ...pref, data: { values: { ordinaryUnknown: 'not-an-asset' } } }],
      [],
    ),
  );
});
test('unmapped current original and unknown storage prevent coverage; server metadata is never overwritten by planning', () => {
  const { db, capture } = fixture();
  db.media = [];
  capture.preferences.uncollectedKeys.push('new-unclassified-ui-key');
  const recipe = desktopCollectionRecipe(db, capture);
  assert.equal(recipe.summary.counts.requiredOriginalsToUpload, 1);
  assert.ok(recipe.summary.blockers.includes('unclassified-storage-key'));
  assert.ok(recipe.summary.blockers.includes('required-original-upload-needed'));
  assert.equal(recipe.wallpapers[0].disposition, 'await-original');
  assert.equal(db.conversationServices, undefined);
});
