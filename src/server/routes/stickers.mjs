import { randomUUID } from 'node:crypto';
import { stickerMedia } from '../domain/stickers.mjs';

/** Reusable image references; deleting a collection item never deletes its media file. */
export function createRoutes({ getDb, mutate, body, reply, fail }) {
  const label = (value, fallback, max, what) => {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
      throw fail(400, `${what}须为 1–${max} 个字符`);
    return value.trim();
  };
  return async (req, res, p) => {
    if (p === '/api/stickers' && req.method === 'GET')
      return reply(res, 200, getDb().stickers || []);
    const match = p.match(/^\/api\/stickers\/([a-f0-9-]+)$/);
    if (!(p === '/api/stickers' && req.method === 'POST') && !(match && req.method === 'PUT'))
      return false;
    const input = JSON.parse((await body(req)).toString('utf8'));
    const result = await mutate((db) => {
      db.stickers ||= [];
      const now = new Date().toISOString();
      if (match) {
        const sticker = db.stickers.find((item) => item.id === match[1]);
        if (!sticker) throw fail(404, '表情包收藏不存在');
        if (input.name === undefined && input.group === undefined && input.deleted === undefined)
          throw fail(400, '没有可保存的表情包修改');
        if (input.deleted !== undefined && typeof input.deleted !== 'boolean')
          throw fail(400, '移除状态不正确');
        sticker.name = label(input.name, sticker.name, 250, '表情名称');
        sticker.group = label(input.group, sticker.group, 80, '分组名称');
        if (input.deleted !== undefined) sticker.deleted = input.deleted;
        sticker.updatedAt = now;
        return sticker;
      }
      const media = stickerMedia(db, input.mediaId, fail);
      const name = label(input.name, media.name || '表情', 250, '表情名称');
      const group = label(input.group, '默认', 80, '分组名称');
      const existing = db.stickers.find((item) => item.mediaId === media.id);
      if (existing) {
        if (existing.deleted) {
          existing.deleted = false;
          existing.updatedAt = now;
        }
        return existing;
      }
      const sticker = {
        id: randomUUID(),
        name,
        group,
        mediaId: media.id,
        createdAt: now,
        updatedAt: now,
        deleted: false,
      };
      db.stickers.push(sticker);
      return sticker;
    });
    return reply(res, match ? 200 : 201, result);
  };
}
