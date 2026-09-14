import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  albumItems,
  albumPage,
  ALBUM_PAGE_SIZE,
  normalizeAlbumPreferences,
  readAlbumPreferences,
  saveAlbumPreferences,
} from '../public/features/album.js';
const entry = (id, attachments, extra = {}) => ({
  id,
  title: id,
  date: '2026-01-01',
  attachments,
  ...extra,
});
const media = (id, type = 'image/png', name = id) => ({ id, type, name });

test('album deduplicates media IDs and never exposes hidden, legacy-hidden, draft or deleted sources', () => {
  const library = {
    media: ['shared', 'public', 'hidden', 'draft', 'deleted', 'legacy', 'orphan'].map((id) =>
      media(id),
    ),
    entries: [
      entry('visible-one', ['shared', 'shared', 'public', 'missing']),
      entry('visible-two', ['shared'], { date: '2026-02-01' }),
      entry('secret', ['shared', 'hidden'], { hidden: true }),
      entry('draft-entry', ['draft'], { draft: true }),
      entry('deleted-entry', ['deleted'], { deleted: true }),
      entry('legacy-secret', ['legacy'], { legacy: { isHidden: true } }),
    ],
  };
  const before = structuredClone(library),
    cards = albumItems(library);
  assert.deepEqual(
    cards.map((card) => card.id),
    ['shared', 'public'],
  );
  assert.deepEqual(
    cards[0].sources.map((source) => source.id),
    ['visible-two', 'visible-one'],
  );
  assert.equal(cards[0].sources.length, 2);
  assert.deepEqual(library, before);
});

test('type and date/name sorting use visible diary dates, keep invalid dates last and compare numeric filenames', () => {
  const library = {
    media: [
      media('a', 'image/png', 'photo10.png'),
      media('b', 'image/jpeg', 'photo2.jpg'),
      media('v', 'video/mp4', 'clip'),
      media('s', 'audio/wav', 'sound'),
      media('x', 'application/pdf', 'document'),
    ],
    entries: [
      entry('new', ['a'], { date: '2026-03-01' }),
      entry('old', ['b', 'a'], { date: '2025-01-01' }),
      entry('video', ['v'], { date: '2026-02-01' }),
      entry('audio', ['s'], { date: '2026-01-01' }),
      entry('invalid', ['x'], { date: 'not-a-date' }),
    ],
  };
  assert.deepEqual(
    albumItems(library).map((card) => card.id),
    ['a', 'v', 's', 'b', 'x'],
  );
  const ascending = albumItems(library, { sort: 'date-asc' });
  assert.deepEqual(
    ascending.map((card) => card.id),
    ['b', 'a', 's', 'v', 'x'],
  );
  assert.equal(ascending.find((card) => card.id === 'a').sources[0].id, 'old');
  assert.deepEqual(
    albumItems(library, { type: 'image', sort: 'name' }).map((card) => card.id),
    ['b', 'a'],
  );
  assert.deepEqual(
    albumItems(library, { type: 'video' }).map((card) => card.id),
    ['v'],
  );
  assert.deepEqual(
    albumItems(library, { type: 'audio' }).map((card) => card.id),
    ['s'],
  );
});

test('a 3025-media album is paged without omissions or duplicates and offsets stay bounded', () => {
  const cards = Array.from({ length: 3025 }, (_, id) => ({ id }));
  const first = albumPage(cards);
  assert.equal(first.items.length, ALBUM_PAGE_SIZE);
  assert.equal(first.hasMore, true);
  const collected = [];
  let offset = 0;
  do {
    const page = albumPage(cards, offset);
    assert.ok(page.items.length <= 80);
    collected.push(...page.items.map((card) => card.id));
    offset = page.nextOffset;
    if (!page.hasMore) break;
  } while (offset < cards.length);
  assert.deepEqual(
    collected,
    cards.map((card) => card.id),
  );
  assert.equal(albumPage(cards, 2960).items.length, 65);
  assert.deepEqual(albumPage(cards, 3025), {
    items: [],
    nextOffset: 3025,
    hasMore: false,
    total: 3025,
  });
  assert.equal(albumPage(cards, -100).items[0].id, 0);
  assert.equal(albumPage(cards, Number.NaN).items[0].id, 0);
  assert.equal(albumPage(cards, 99999).nextOffset, cards.length);
  assert.equal(albumPage([]).hasMore, false);
});

test('device album preferences persist only allowed options and tolerate malformed or denied storage', () => {
  const baseline = normalizeAlbumPreferences(null);
  assert.deepEqual(readAlbumPreferences({ getItem: () => '{broken' }), baseline);
  assert.deepEqual(
    readAlbumPreferences({ getItem: () => '{"version":99,"layout":"list"}' }),
    baseline,
  );
  let stored;
  const storage = {
    getItem: () => stored,
    setItem(_key, value) {
      stored = value;
    },
  };
  saveAlbumPreferences(storage, {
    layout: 'list',
    density: 'compact',
    sort: 'date-asc',
    type: 'audio',
    content: 'must not persist',
    title: 'must not persist',
  });
  assert.deepEqual(readAlbumPreferences(storage), {
    layout: 'list',
    density: 'compact',
    sort: 'date-asc',
    type: 'audio',
  });
  assert.deepEqual(Object.keys(JSON.parse(stored)).sort(), [
    'density',
    'layout',
    'sort',
    'type',
    'version',
  ]);
  assert.deepEqual(
    normalizeAlbumPreferences({ layout: '<script>', density: 1, sort: 'unknown', type: null }),
    baseline,
  );
  const denied = {
    getItem() {
      throw Error('Denied');
    },
    setItem() {
      throw Error('Quota');
    },
  };
  assert.deepEqual(readAlbumPreferences(denied), baseline);
  assert.doesNotThrow(() => saveAlbumPreferences(denied, { layout: 'grid' }));
});
