import { LIMITS } from '../../../public/shared/limits.js';

import { randomUUID } from 'node:crypto';

import { validateEntry } from '../domain/entries.mjs';

export function createRoutes({ getDb, mutate, body, reply, fail }) {
  return async (req, res, p) => {
    const db = getDb();
    if (p === '/api/categories' && req.method === 'POST') {
      const value = JSON.parse((await body(req)).toString('utf8'));
      const name = String(value.name || '')
        .trim()
        .slice(0, 60);
      if (!name) throw fail(400, '请输入分类名称');
      return reply(
        res,
        200,
        await mutate((d) => {
          if (!d.categories.includes(name)) d.categories.push(name);
          return d.categories;
        }),
      );
    }
    if (p === '/api/entries' && req.method === 'POST') {
      const v = validateEntry(JSON.parse((await body(req)).toString('utf8')), db),
        now = new Date().toISOString();
      return reply(
        res,
        201,
        await mutate((d) => {
          const e = {
            ...v,
            id: randomUUID(),
            revision: 1,
            createdAt: now,
            updatedAt: now,
            history: [],
          };
          d.entries.unshift(e);
          if (!d.categories.includes(e.category)) d.categories.push(e.category);
          return e;
        }),
      );
    }
    const match = p.match(/^\/api\/entries\/([a-f0-9-]+)$/);
    if (match && req.method === 'PUT') {
      const input = JSON.parse((await body(req)).toString('utf8')),
        v = validateEntry(input, db);
      return reply(
        res,
        200,
        await mutate((d) => {
          const i = d.entries.findIndex((e) => e.id === match[1]);
          if (i < 0) throw fail(404, '日记不存在');
          const old = d.entries[i];
          if (old.revision !== input.revision)
            throw fail(
              409,
              '另一窗口已修改这篇日记。当前内容仍保留在编辑器中，请先复制，再重新打开日记。',
            );
          const previous = { ...old };
          delete previous.history;
          const e = {
            ...old,
            ...v,
            revision: old.revision + 1,
            updatedAt: new Date().toISOString(),
            history: [previous, ...old.history].slice(0, LIMITS.historyEntries),
          };
          d.entries[i] = e;
          if (!d.categories.includes(e.category)) d.categories.push(e.category);
          return e;
        }),
      );
    }

    return false;
  };
}
