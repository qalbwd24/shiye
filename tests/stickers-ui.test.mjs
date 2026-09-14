import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterStickers } from '../public/features/stickers.js';

test('sticker filters keep deleted records recoverable and preserve stable media references', () => {
  const records = [
    { id: 'one', name: '开心 GIF', group: '心情', mediaId: 'gif-original', deleted: false },
    { id: 'two', name: '上课', group: '学习', mediaId: 'picture-two', deleted: false },
    { id: 'three', name: '旧收藏', group: '心情', mediaId: 'picture-three', deleted: true },
  ];
  const before = structuredClone(records);
  assert.deepEqual(
    filterStickers(records).map((item) => item.id),
    ['one', 'two'],
  );
  assert.deepEqual(
    filterStickers(records, { query: 'gif', group: '心情' }).map((item) => item.mediaId),
    ['gif-original'],
  );
  assert.deepEqual(
    filterStickers(records, { query: '学习' }).map((item) => item.id),
    ['two'],
  );
  assert.deepEqual(
    filterStickers(records, { deleted: true }).map((item) => item.id),
    ['three'],
  );
  assert.deepEqual(records, before);
});
