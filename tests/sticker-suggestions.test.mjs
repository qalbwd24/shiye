import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createStickerSuggestionIndex,
  hasLocalStickerOriginal,
  normalizeStickerText,
} from '../public/shared/sticker-suggestions.js';
const original = new Blob(['synthetic-original'], { type: 'image/gif' });
const asset = (id, name, note = '') => ({ id: 'sticker:' + id, name, note, blob: original });

test('Chinese sentence matches metadata short words and alias, returns stable IDs only once', () => {
  const index = createStickerSuggestionIndex(
    [asset('night', '小猫.gif', '晚安 睡觉'), asset('ok', '好的.png', '同意')],
    [{ id: 'mapping:猫猫', name: '猫猫', kind: 'sticker', assetId: 'sticker:night' }],
  );
  assert.equal(index.search('我要睡觉啦')[0].id, 'sticker:night');
  assert.equal(index.search('/猫猫')[0].id, 'sticker:night');
  assert.equal(index.search('猫')[0].id, 'sticker:night');
  assert.equal(index.search('晚安睡觉猫猫').length, 1);
  assert.deepEqual(index.search('完全不相关的天气'), []);
});
test('normalization handles fullwidth/case/Unicode without changing originals', () => {
  const entry = asset('unicode', 'ＨＡＰＰＹ.png', 'ＣＡＦÉ 𠀀好');
  const index = createStickerSuggestionIndex([entry]);
  assert.equal(normalizeStickerText('  ＨＡＰＰＹ\u200b '), 'happy');
  for (const text of ['happy', 'HAPPY', 'cafe\u0301', '𠀀好'])
    assert.equal(index.search(text)[0].id, entry.id);
  assert.equal(entry.name, 'ＨＡＰＰＹ.png');
});
test('removed, missing, empty, nonimage and oversize originals cannot be suggested', () => {
  const valid = asset('valid', '开心');
  const bad = [
    { ...asset('removed', '开心'), removed: true },
    {
      id: 'sticker:remote',
      name: '开心',
      serverMediaId: 'remote',
      media: { size: 12, type: 'image/png' },
    },
    { ...asset('empty', '开心'), blob: new Blob([], { type: 'image/png' }) },
    { ...asset('file', '开心'), blob: new Blob(['x'], { type: 'application/octet-stream' }) },
    { ...asset('large', '开心'), blob: { size: 64 * 1024 * 1024 + 1, type: 'image/gif' } },
  ];
  assert.ok(hasLocalStickerOriginal(valid));
  assert.ok(bad.every((a) => !hasLocalStickerOriginal(a)));
  assert.deepEqual(
    createStickerSuggestionIndex([valid, ...bad])
      .search('开心')
      .map((x) => x.id),
    [valid.id],
  );
});
test('alias/name rank above note, capped deterministic candidates; no source reads per query', () => {
  const entries = Array.from({ length: 12 }, (_, i) =>
    asset(String(i).padStart(2, '0'), '收藏' + i, '开心'),
  );
  entries.push(asset('name', '开心'), asset('alias', '其他'));
  const index = createStickerSuggestionIndex(entries, [
    { name: '开心', kind: 'sticker', assetId: 'sticker:alias' },
  ]);
  for (const entry of entries)
    Object.defineProperty(entry, 'note', {
      get() {
        throw Error('query scanned original records');
      },
    });
  const first = index.search('开心');
  assert.equal(first.length, 5);
  assert.equal(first[0].id, 'sticker:alias');
  assert.equal(first[1].id, 'sticker:name');
  assert.deepEqual(index.search('开心'), first);
  assert.equal(index.search('开心', 3).length, 3);
});
test('new index reflects edit/removal while an existing index stays a metadata snapshot', () => {
  const entry = asset('edit', '早安');
  const before = createStickerSuggestionIndex([entry]);
  entry.name = '晚安';
  assert.equal(before.search('早安')[0].id, entry.id);
  const after = createStickerSuggestionIndex([entry]);
  assert.deepEqual(after.search('早安'), []);
  assert.equal(after.search('晚安')[0].id, entry.id);
  entry.removed = true;
  assert.equal(createStickerSuggestionIndex([entry]).size, 0);
});
