import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  albumItems,
  albumPage,
  ALBUM_PAGE_SIZE,
  normalizeAlbumPreferences,
  readAlbumPreferences,
  saveAlbumPreferences,
  readAlbumRandomSeed,
  saveAlbumRandomSeed,
  nextAlbumRandomSeed,
  createAlbum,
} from '../public/features/album.js';
const entry = (id, attachments, extra = {}) => ({
  id,
  title: id,
  date: '2026-01-01',
  attachments,
  ...extra,
});

function albumSurface() {
  const grid = {
    innerHTML: '',
    classList: { toggle() {} },
    addEventListener() {},
    removeEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    insertAdjacentHTML(_position, html) {
      this.innerHTML += html;
    },
  };
  const nodes = new Map([
    ['.album-workspace', { dataset: {} }],
    ['[data-album-cards]', grid],
    ...['summary', 'count', 'more', 'shuffle', 'new'].map((name) => [`[data-album-${name}]`, {}]),
  ]);
  const controls = ['layout', 'density', 'sort', 'type'].map((albumPref) => ({
    dataset: { albumPref },
  }));
  return {
    ownerDocument: { defaultView: {} },
    querySelector: (selector) => nodes.get(selector),
    querySelectorAll: () => controls,
    grid,
  };
}

test('album navigation restores loaded pages and random order against fresh media references', () => {
  let library = {
    media: Array.from({ length: 241 }, (_, index) => media(`media-${index}`)),
    entries: [
      entry(
        'visible',
        Array.from({ length: 241 }, (_, index) => `media-${index}`),
      ),
    ],
  };
  const feature = createAlbum({
    get library() {
      return library;
    },
    escape: String,
    textOf: String,
  });
  feature.restoreNavigation({
    version: 1,
    preferences: { sort: 'random' },
    randomSeed: 197,
    limit: 80,
  });
  const root = albumSurface();
  feature.render('gallery', root);
  root.querySelector('[data-album-more]').onclick();
  const saved = feature.captureNavigation();
  assert.equal(saved.limit, 160);
  const detached = feature.captureNavigation();
  detached.preferences.sort = 'name';
  assert.equal(feature.captureNavigation().preferences.sort, 'random');
  root.querySelector('[data-album-shuffle]').onclick();
  library = { ...library, entries: [entry('visible', library.entries[0].attachments.slice(1))] };
  assert.equal(feature.restoreNavigation(saved), true);
  saved.preferences.sort = 'name';
  feature.render('gallery', root);
  const actual = [...root.grid.innerHTML.matchAll(/data-album-media="([^"]+)"/g)].map((m) => m[1]);
  const expected = albumItems(library, { sort: 'random', randomSeed: 197 })
    .slice(0, 160)
    .map((card) => card.id);
  assert.deepEqual(actual, expected);
  assert.equal(feature.captureNavigation().randomSeed, 197);
  assert.equal(feature.restoreNavigation(null), false);
  feature.restoreNavigation({
    version: 1,
    preferences: { content: 'excluded' },
    limit: Infinity,
    randomSeed: -1,
  });
  assert.equal(feature.captureNavigation().limit, 80);
  assert.equal(JSON.stringify(feature.captureNavigation()).includes('excluded'), false);
});

test('random order stays stable across redraw, filtering, source changes and pagination', () => {
  const library = {
    media: Array.from({ length: 241 }, (_, index) =>
      media(`m-${index}`, index % 3 ? 'image/png' : 'video/mp4'),
    ),
    entries: [
      entry(
        'visible',
        Array.from({ length: 241 }, (_, index) => `m-${index}`),
      ),
    ],
  };
  const options = { sort: 'random', randomSeed: 123456789 };
  const ids = (cards) => cards.map((card) => card.id);
  const initial = albumItems(library, options);
  assert.deepEqual(ids(albumItems(library, options)), ids(initial));
  assert.deepEqual(
    ids(albumItems(library, { ...options, type: 'image' })),
    ids(initial.filter((card) => card.type === 'image')),
  );
  const next = [...albumPage(initial).items, ...albumPage(albumItems(library, options), 80).items];
  assert.deepEqual(ids(next), ids(initial.slice(0, 160)));
  const modified = structuredClone(library);
  modified.media.reverse().forEach((item) => {
    item.name = `renamed-${item.id}`;
  });
  modified.entries[0].attachments.reverse();
  modified.entries[0].date = '2027-02-01';
  modified.media.push(media('new-media'));
  modified.entries[0].attachments.push('new-media');
  assert.deepEqual(
    ids(albumItems(modified, options).filter((card) => card.id !== 'new-media')),
    ids(initial),
  );
});

test('a new random seed reshuffles without changing membership or leaking invisible media', () => {
  const library = {
    media: Array.from({ length: 120 }, (_, index) => media(`m-${index}`)),
    entries: [
      entry(
        'visible',
        Array.from({ length: 119 }, (_, index) => `m-${index}`),
      ),
      entry('secret', ['m-119'], { hidden: true }),
    ],
  };
  const before = structuredClone(library);
  const previous = 0xffffffff;
  const seed = nextAlbumRandomSeed(previous, () => previous / 0x100000000);
  assert.equal(seed, 0, 'a repeated random sample still changes seed, including uint32 wrap');
  const original = albumItems(library, { sort: 'random', randomSeed: previous }).map(
    (card) => card.id,
  );
  const shuffled = albumItems(library, { sort: 'random', randomSeed: seed }).map((card) => card.id);
  assert.notDeepEqual(shuffled, original);
  assert.deepEqual([...shuffled].sort(), [...original].sort());
  assert.equal(shuffled.includes('m-119'), false);
  assert.deepEqual(library, before);
});

test('random seed and selected sort survive refresh independently and tolerate blocked storage', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key),
    setItem: (key, value) => values.set(key, value),
  };
  saveAlbumPreferences(storage, { sort: 'name' });
  saveAlbumRandomSeed(storage, 0);
  assert.equal(readAlbumRandomSeed(storage), 0);
  assert.equal(readAlbumPreferences(storage).sort, 'name');
  saveAlbumPreferences(storage, { sort: 'random' });
  assert.equal(readAlbumPreferences(storage).sort, 'random');
  assert.equal(readAlbumRandomSeed(storage), 0);
  assert.deepEqual(JSON.parse(values.get('shiye.album-random.v1')), { version: 1, seed: 0 });
  for (const invalid of [
    '{broken',
    '{"version":2,"seed":1}',
    '{"version":1,"seed":-1}',
    '{"version":1,"seed":"1"}',
    '{"version":1,"seed":4294967296}',
  ]) {
    assert.equal(readAlbumRandomSeed({ getItem: () => invalid }), null);
  }
  const denied = {
    getItem() {
      throw Error('Denied');
    },
    setItem() {
      throw Error('Quota');
    },
  };
  assert.equal(readAlbumRandomSeed(denied), null);
  assert.doesNotThrow(() => saveAlbumRandomSeed(denied, 42));
  saveAlbumRandomSeed(storage, -1);
  assert.equal(readAlbumRandomSeed(storage), 0);
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
