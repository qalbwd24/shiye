import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  collectSticker,
  updateSticker,
  stickerCatalog,
} from '../src/server/domain/sticker-collection.mjs';
import { LIMITS } from '../public/shared/limits.js';
const fail = (status, message) => Object.assign(Error(message), { status });
test('sticker name and optional note are independent of message content and can be cleared', () => {
  const db = {
    media: [{ id: 'gif', name: 'a.gif', type: 'image/gif', size: 20 }],
    entries: [{ id: 'old', body: 'unchanged' }],
  };
  const before = structuredClone(db.entries);
  const { sticker } = collectSticker(
    db,
    { mediaId: 'gif', name: '名称', note: '收藏备注' },
    { fail },
  );
  assert.equal(sticker.note, '收藏备注');
  assert.equal(stickerCatalog(db).items[0].note, '收藏备注');
  assert.equal(stickerCatalog(db).limits.maxBytes, LIMITS.stickerBytes);
  updateSticker(db, sticker.id, { note: '新的备注' }, { fail });
  assert.equal(sticker.note, '新的备注');
  updateSticker(db, sticker.id, { note: '' }, { fail });
  assert.equal(sticker.note, '');
  assert.deepEqual(db.entries, before);
  assert.throws(() => updateSticker(db, sticker.id, { note: 'a'.repeat(2001) }, { fail }), /2000/);
});
test('size guard limits new favorites but preserves already-existing oversized collection records', () => {
  const db = {
    media: [{ id: 'huge', type: 'image/gif', size: LIMITS.stickerBytes + 1 }],
    stickers: [],
  };
  assert.throws(() => collectSticker(db, { mediaId: 'huge' }, { fail }), /64 MiB/);
  assert.equal(db.stickers.length, 0);
  db.stickers.push({ id: 'old', mediaId: 'huge', name: 'old', group: 'g', note: 'keep' });
  assert.equal(collectSticker(db, { mediaId: 'huge' }, { fail }).sticker.id, 'old');
  assert.equal(db.stickers[0].note, 'keep');
});
