import { createEntryReadingDocumentReader } from '../domain/entry-reading-document.mjs';

export function createRoutes({ getDb, reply, fail }) {
  const read = createEntryReadingDocumentReader();
  return async (req, res, pathname) => {
    const match = /^\/api\/entries\/([a-f0-9-]+)\/reading-document$/.exec(pathname);
    if (!match || req.method !== 'GET') return false;
    if (req.headers.origin && req.headers.origin !== 'http://' + req.headers.host)
      throw fail(403, '请求来源不匹配');
    const db = getDb(),
      entry = db.entries.find((item) => item.id === match[1]);
    if (!entry) throw fail(404, '日记不存在');
    // Deleted entries follow the existing GET entry policy; metadata keeps them read-only.
    return reply(res, 200, read(entry, { media: db.media }));
  };
}
