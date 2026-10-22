import { randomUUID } from 'node:crypto';
import { stickerMedia } from './stickers.mjs';
import { LIMITS } from '../../../public/shared/limits.js';

export const STICKER_COLLECTION_VERSION = 1;
function note(value, fallback, fail) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.length > LIMITS.stickerNoteCharacters)
    throw fail(400, '表情包备注最多2000个字符');
  return value.trim();
}
const label = (value, fallback, max, what, fail) => {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
    throw fail(400, `${what}须为 1–${max} 个字符`);
  return value.trim();
};

/** Call inside the library's serial mutate. Existing collection identity wins. */
export function collectSticker(db, input, { fail, now = Date.now(), createId = randomUUID }) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw fail(400, '表情包收藏参数不正确');
  const media = stickerMedia(db, input.mediaId, fail);
  const name = label(input.name, media.name || '表情', 250, '表情名称', fail);
  const group = label(input.group, '默认', 80, '分组名称', fail);
  const description = note(input.note, undefined, fail);
  db.stickers ||= [];
  const existing = db.stickers.find((item) => item.mediaId === media.id);
  if (existing) {
    const restored = !!existing.deleted;
    if (restored) {
      existing.deleted = false;
      existing.updatedAt = new Date(now).toISOString();
    }
    return { sticker: existing, status: restored ? 'restored' : 'existing' };
  }
  const stamp = new Date(now).toISOString();
  if (media.size > LIMITS.stickerBytes)
    throw fail(400, '新收藏表情包不能超过64 MiB，原图片不受影响');
  const sticker = {
    id: createId(),
    name,
    group,
    mediaId: media.id,
    createdAt: stamp,
    updatedAt: stamp,
    deleted: false,
    ...(description !== undefined ? { note: description } : {}),
  };
  db.stickers.push(sticker);
  return { sticker, status: 'created' };
}

export function updateSticker(db, id, input, { fail, now = Date.now() }) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw fail(400, '表情包收藏参数不正确');
  const sticker = db.stickers?.find((item) => item.id === id);
  if (!sticker) throw fail(404, '表情包收藏不存在');
  if (
    input.name === undefined &&
    input.group === undefined &&
    input.deleted === undefined &&
    input.note === undefined
  )
    throw fail(400, '没有可保存的表情包修改');
  if (input.deleted !== undefined && typeof input.deleted !== 'boolean')
    throw fail(400, '移除状态不正确');
  sticker.name = label(input.name, sticker.name, 250, '表情名称', fail);
  sticker.group = label(input.group, sticker.group, 80, '分组名称', fail);
  if (input.note !== undefined) sticker.note = note(input.note, sticker.note, fail);
  if (input.deleted !== undefined) sticker.deleted = input.deleted;
  sticker.updatedAt = new Date(now).toISOString();
  return sticker;
}

/** Public metadata only; original bytes remain under the ordinary protected media route. */
export function stickerAsset(media) {
  return media
    ? {
        id: media.id,
        name: media.name || '',
        type: media.type,
        size: media.size ?? null,
        sha256: media.sha256 || null,
        url: '/media/' + encodeURIComponent(media.id),
        thumbnailUrl: null,
      }
    : null;
}

export function stickerCatalog(db, { includeDeleted = false } = {}) {
  const media = new Map((db.media || []).map((item) => [item.id, item]));
  return {
    version: STICKER_COLLECTION_VERSION,
    limits: { maxBytes: LIMITS.stickerBytes, noteCharacters: LIMITS.stickerNoteCharacters },
    items: (db.stickers || [])
      .filter((item) => includeDeleted || !item.deleted)
      .map((item) => ({
        id: item.id,
        name: item.name,
        group: item.group,
        ...(item.note !== undefined ? { note: item.note } : {}),
        mediaId: item.mediaId,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        deleted: !!item.deleted,
        media: stickerAsset(media.get(item.mediaId)),
      })),
  };
}
