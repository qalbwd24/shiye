import {
  collectSticker,
  updateSticker,
  stickerCatalog,
  stickerAsset,
} from '../domain/sticker-collection.mjs';
import { resolveStickerMessage } from '../domain/sticker-message-source.mjs';

/** Reusable image references; deleting a collection item never deletes its media file. */
export function createRoutes({ getDb, mutate, body, reply, fail }) {
  return async (req, res, p) => {
    if (p === '/api/stickers/catalog' && req.method === 'GET') {
      const query = new URL(req.url, 'http://localhost').searchParams;
      if (
        [...query.keys()].some((key) => key !== 'includeDeleted') ||
        query.getAll('includeDeleted').length > 1 ||
        (query.has('includeDeleted') && !['0', '1'].includes(query.get('includeDeleted')))
      )
        throw fail(400, '表情库查询参数不正确');
      return reply(
        res,
        200,
        stickerCatalog(getDb(), { includeDeleted: query.get('includeDeleted') === '1' }),
      );
    }
    if (p === '/api/stickers/from-message' && req.method === 'POST') {
      const input = JSON.parse((await body(req, 64 * 1024)).toString('utf8'));
      const result = await mutate((db) => {
        const resolved = resolveStickerMessage(db, input, fail);
        const collected = collectSticker(db, { ...input, mediaId: resolved.media.id }, { fail });
        return {
          version: 1,
          ...collected,
          source: resolved.source,
          ...(resolved.occurrenceId ? { occurrenceId: resolved.occurrenceId } : {}),
          media: stickerAsset(resolved.media),
        };
      });
      return reply(res, result.status === 'created' ? 201 : 200, result);
    }
    if (p === '/api/stickers' && req.method === 'GET')
      return reply(res, 200, getDb().stickers || []);
    const match = p.match(/^\/api\/stickers\/([a-f0-9-]+)$/);
    if (!(p === '/api/stickers' && req.method === 'POST') && !(match && req.method === 'PUT'))
      return false;
    const input = JSON.parse((await body(req)).toString('utf8'));
    const result = await mutate((db) =>
      match
        ? updateSticker(db, match[1], input, { fail })
        : collectSticker(db, input, { fail }).sticker,
    );
    return reply(res, match ? 200 : 201, result);
  };
}
