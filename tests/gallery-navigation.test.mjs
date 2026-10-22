import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  galleryDots,
  readGalleryPositions,
  rememberGalleryPosition,
  createGallery,
  galleryAttachmentOrder,
  mergeGalleryOrder,
} from '../public/features/gallery.js';

test('inline pictures stay in the body and retain original attachment associations', () => {
  const body = {
    format: 'shiye-richdoc',
    version: 1,
    content: [
      {
        type: 'image',
        attrs: {
          assetId: 'picture',
          blockId: 'b1',
          occurrenceId: 'o1',
          widthRatio: 0.75,
          align: 'center',
          caption: '',
          alt: '',
          insertedAt: null,
        },
      },
      {
        type: 'image',
        attrs: {
          assetId: 'picture',
          blockId: 'b2',
          occurrenceId: 'o2',
          widthRatio: 0.75,
          align: 'center',
          caption: '',
          alt: '',
          insertedAt: null,
        },
      },
    ],
  };
  const entry = { contentFormat: 'richdoc', body, attachments: ['file', 'picture', 'audio'] };
  const original = structuredClone(entry);
  assert.deepEqual(galleryAttachmentOrder(entry), ['file', 'audio']);
  assert.deepEqual(mergeGalleryOrder(entry, ['audio', 'file']), ['audio', 'picture', 'file']);
  assert.throws(() => mergeGalleryOrder(entry, ['audio', 'audio']));
  assert.deepEqual(entry, original);
  entry.body = { ...body, content: [] };
  assert.deepEqual(galleryAttachmentOrder(entry), entry.attachments);
  entry.contentFormat = 'html';
  entry.body = body;
  assert.deepEqual(galleryAttachmentOrder(entry), entry.attachments);
  entry.contentFormat = 'richdoc';
  entry.body = null;
  assert.deepEqual(galleryAttachmentOrder(entry), entry.attachments);
});

test('large galleries keep at most seven unique dots with first, current and last reachable', () => {
  for (const count of [1, 2, 7, 8, 9, 200, 1000, 100_000]) {
    const positions = new Set([
      0,
      Math.min(1, count - 1),
      Math.floor(count / 2),
      Math.max(0, count - 2),
      count - 1,
    ]);
    for (const active of positions) {
      const dots = galleryDots(count, active);
      assert.ok(dots.length <= 7);
      assert.equal(new Set(dots).size, dots.length);
      assert.ok(dots.every((value) => Number.isInteger(value) && value >= 0 && value < count));
      assert.ok(dots.includes(0));
      assert.ok(dots.includes(active));
      assert.ok(dots.includes(count - 1));
    }
  }
});

test('malformed or unavailable position storage cannot prevent reading and navigation', () => {
  for (const raw of [
    '{broken',
    'null',
    '[]',
    '{"version":2,"entries":[["entry","media"]]}',
    '{"version":1,"entries":{}}',
  ]) {
    assert.equal(readGalleryPositions({ getItem: () => raw }).size, 0);
  }
  const raw = JSON.stringify({
    version: 1,
    entries: [
      [{}, 'media'],
      ['entry', null],
      ['entry', ''],
      ['x'.repeat(513), 'media'],
      ['good', 'older'],
      ['good', 'newer'],
    ],
  });
  assert.deepEqual([...readGalleryPositions({ getItem: () => raw })], [['good', 'newer']]);
  const blocked = {
    getItem() {
      throw Error('Storage denied');
    },
    setItem() {
      throw Error('Quota exceeded');
    },
  };
  const positions = readGalleryPositions(blocked);
  assert.doesNotThrow(() => rememberGalleryPosition(positions, 'entry', 'media', blocked));
  assert.equal(positions.get('entry'), 'media');
});

test('position memory retains 200 most recently visited IDs and stale media falls back without writing on render', () => {
  let stored = null,
    writes = 0;
  const storage = {
    getItem: () => stored,
    setItem(_key, value) {
      stored = value;
      writes++;
    },
  };
  const positions = readGalleryPositions(storage);
  for (let i = 0; i < 200; i++)
    rememberGalleryPosition(positions, `entry-${i}`, `media-${i}`, storage);
  const entry = {
    id: 'entry-0',
    title: 'Synthetic private title',
    content: 'Synthetic private body',
    attachments: ['media-a', 'media-b'],
  };
  rememberGalleryPosition(positions, entry.id, 'media-b', storage);
  rememberGalleryPosition(positions, 'entry-200', 'media-200', storage);
  const saved = JSON.parse(stored);
  assert.deepEqual(Object.keys(saved).sort(), ['entries', 'version']);
  assert.equal(saved.entries.length, 200);
  assert.ok(
    saved.entries.every(
      (pair) => pair.length === 2 && pair.every((value) => typeof value === 'string'),
    ),
  );
  assert.equal(stored.includes(entry.title), false);
  assert.equal(stored.includes(entry.content), false);
  const loaded = readGalleryPositions(storage);
  assert.equal(loaded.has('entry-1'), false);
  assert.equal(loaded.get(entry.id), 'media-b');
  assert.equal(loaded.get('entry-200'), 'media-200');

  // The lightweight host only receives markup; rendering must not invoke any
  // save or upload path, nor overwrite a remembered ID when an attachment is gone.
  const host = {
    ownerDocument: {
      body: { classList: { contains: () => false } },
      defaultView: { localStorage: storage },
    },
    classList: { add() {}, toggle() {} },
    addEventListener() {},
    setAttribute() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    innerHTML: '',
  };
  const library = {
    entries: [entry],
    media: [
      { id: 'media-a', name: 'A', type: 'image/png' },
      { id: 'media-b', name: 'B', type: 'image/png' },
    ],
  };
  const gallery = createGallery({
    $: () => host,
    escape: (value) => value,
    toast() {},
    get library() {
      return library;
    },
    markDirty() {
      assert.fail('Rendering must not save a diary');
    },
    flush() {
      assert.fail('Rendering must not flush a diary');
    },
  });
  const writesBeforeRender = writes;
  gallery.render(entry);
  assert.match(host.innerHTML, /data-media-id="media-b"/);
  entry.attachments = ['media-a'];
  gallery.render(entry);
  assert.match(host.innerHTML, /data-media-id="media-a"/);
  assert.doesNotMatch(host.innerHTML, /data-media-id="media-b"/);
  assert.equal(writes, writesBeforeRender);
  assert.equal(readGalleryPositions(storage).get(entry.id), 'media-b');
});
