import { promises as fs } from 'node:fs';
import path from 'node:path';
import { revisitConfig } from '../domain/revisit.mjs';
import { createLibraryDeliveryPort } from '../domain/revisit/delivery/storage-port.mjs';
import { createRevisitDeliveryService } from '../domain/revisit/delivery/service.mjs';
import { createRevisitCommentService } from '../domain/revisit/comments/service.mjs';
import {
  openRevisitSources,
  presentRevisitSource,
  readSourceEntryHtml,
  sourceMediaIds,
} from '../domain/revisit-sources.mjs';
import { LIMITS } from '../../../public/shared/limits.js';

export function createRoutes({ getDb, mutate, body, reply, fail, dataDir, clock }) {
  const port = createLibraryDeliveryPort({ getDb, mutate });
  const deliveryService = createRevisitDeliveryService(port, { clock });
  const commentService = createRevisitCommentService(port, { clock });
  const inputBody = async (req, max) => {
    const value = JSON.parse(await body(req, max));
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw fail(400, '请求须为对象');
    return value;
  };
  return async (req, res, p) => {
    if (!p.startsWith('/api/revisit')) return false;
    if (p === '/api/revisit' && req.method === 'GET')
      return reply(res, 200, deliveryService.status());
    if (p === '/api/revisit/archive' && req.method === 'GET')
      return reply(res, 200, deliveryService.archive());
    if (p === '/api/revisit/archive' && req.method === 'PUT')
      return reply(
        res,
        200,
        await deliveryService.restore(await inputBody(req, LIMITS.vaultRecordBytes)),
      );
    if (p === '/api/revisit/config' && req.method === 'PUT') {
      const input = await inputBody(req);
      return reply(res, 200, await deliveryService.configure(input));
    }
    if (p === '/api/revisit/tick' && req.method === 'POST') {
      const input = await inputBody(req);
      if (input.manual !== undefined && typeof input.manual !== 'boolean')
        throw fail(400, '补看开关不正确');
      if (!input.manual && (input.from !== undefined || input.to !== undefined))
        throw fail(400, '自动推送使用服务器时钟；指定范围请用手动补看');
      return reply(res, 200, await deliveryService.tick(input));
    }
    if (p === '/api/revisit/feed' && req.method === 'POST') {
      const input = await inputBody(req);
      if (!Number.isSafeInteger(input.after) || input.after < 0) throw fail(400, '推送游标不正确');
      const limit = input.limit ?? 50;
      if (!Number.isInteger(limit) || limit < 1 || limit > LIMITS.revisitPageEntries)
        throw fail(400, '读取数量不正确');
      return reply(res, 200, deliveryService.feed({ after: input.after, limit }));
    }
    if (p === '/api/revisit/comments' && req.method === 'POST') {
      const input = await inputBody(req);
      return reply(res, 201, await commentService.add(input));
    }
    if (p === '/api/revisit/comments' && req.method === 'GET') {
      const entryId = new URL(req.url, 'http://localhost').searchParams.get('entryId');
      if (!entryId || entryId.length > 200) throw fail(400, '请指定日记编号');
      return reply(res, 200, commentService.describeForEntry(entryId));
    }
    if (p === '/api/revisit/comments/context' && req.method === 'POST')
      return reply(res, 200, commentService.context(await inputBody(req)));
    if (p === '/api/revisit/comments/withdraw' && req.method === 'POST') {
      const input = await inputBody(req);
      return reply(res, 200, await commentService.withdraw(input));
    }
    if (['/api/revisit/source', '/api/revisit/media'].includes(p) && req.method === 'POST') {
      const input = await inputBody(req),
        db = getDb();
      const delivery = db.revisit?.deliveries.find((item) => item.id === input.deliveryId);
      if (!delivery) throw fail(404, '回看来源不存在');
      const session = openRevisitSources(db);
      const source = session.resolve(delivery.ref),
        presentation = presentRevisitSource(source);
      if (p === '/api/revisit/source') {
        return reply(res, 200, {
          ...presentation,
          timeZone: revisitConfig(db).timeZone,
          entryHtml: readSourceEntryHtml(source, session),
          comments: source ? commentService.forEntry(source.entry.id) : [],
        });
      }
      if (!sourceMediaIds(source).has(input.assetId)) throw fail(404, '媒体来源不可查看');
      const asset = session.asset(input.assetId);
      if (!asset) throw fail(404, '媒体不存在');
      const offset = input.offset ?? 0;
      if (!Number.isSafeInteger(offset) || offset < 0) throw fail(400, '媒体偏移不正确');
      const root = path.resolve(dataDir, 'media');
      const file = path.resolve(root, asset.id);
      if (!file.startsWith(root + path.sep)) throw fail(400, '媒体路径不正确');
      const handle = await fs.open(file, 'r');
      try {
        const size = (await handle.stat()).size;
        const buffer = Buffer.alloc(
          Math.min(LIMITS.revisitMediaChunkBytes, Math.max(0, size - offset)),
        );
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
        return reply(res, 200, {
          bytes: buffer.subarray(0, bytesRead).toString('base64'),
          offset,
          size,
          type: asset.type,
          name: asset.name,
          done: offset + bytesRead >= size,
        });
      } finally {
        await handle.close();
      }
    }
    return false;
  };
}
