import { randomUUID } from 'node:crypto';
import { validateEntry } from '../domain/entries.mjs';
import {
  createQuickEntry,
  resolveQuickEntry,
  discardEmptyQuickEntry,
  replaceEntry,
} from '../domain/quick-entry.mjs';
import { hasQuickContent, rememberQuickEntry } from '../../../public/shared/quick-capture.js';
import { commitDiaryUnits } from '../domain/message-store.mjs';

/** Shared local-first create uses the same validation and diary-unit commit as POST. */
export function createEntryWithId(db, input, id, options = {}) {
  if (db.entries.some((entry) => entry.id === id))
    throw Object.assign(new Error('SHARED_ENTRY_ID_COLLISION'), {
      status: 409,
      code: 'SHARED_ENTRY_ID_COLLISION',
    });
  const value = validateEntry(input, db);
  const now = new Date().toISOString();
  const entry = { ...value, id, revision: 1, createdAt: now, updatedAt: now, history: [] };
  commitDiaryUnits(db, entry, null, options);
  db.entries.unshift(entry);
  if (!db.categories.includes(entry.category)) db.categories.push(entry.category);
  return entry;
}

export function createRoutes({ getDb, mutate, body, reply, fail, messageUnitsEnabled = false }) {
  const options = { messageUnitsEnabled };
  return async (req, res, p) => {
    const db = getDb();
    if (p === '/api/quick-history' && req.method === 'GET')
      return reply(res, 200, { ids: db.quickCaptureHistory || [] });
    if (p === '/api/quick-history' && req.method === 'POST') {
      const input = JSON.parse((await body(req)).toString('utf8'));
      return reply(
        res,
        200,
        await mutate((d) => {
          const entry = d.entries.find((e) => e.id === input.entryId);
          if (!entry || entry.deleted || !hasQuickContent(entry))
            throw fail(400, '只有已保存且有内容的日记可以加入快捷编辑历史');
          d.quickCaptureHistory = rememberQuickEntry(d.quickCaptureHistory, entry);
          return { ids: d.quickCaptureHistory };
        }),
      );
    }
    const byToken = p.match(/^\/api\/quick-entries\/by-token\/([a-f0-9-]+)$/i);
    if (byToken && req.method === 'GET') {
      const registration = db.quickEntryTokens?.[byToken[1].toLowerCase()];
      const entry = registration && db.entries.find((e) => e.id === registration.entryId);
      if (!entry) throw fail(404, '尚未找到这次快捷记录');
      return reply(res, 200, entry);
    }
    const resolve = p.match(/^\/api\/entries\/([a-f0-9-]+)\/resolve$/);
    const discard = p.match(/^\/api\/quick-entries\/([a-f0-9-]+)\/discard-empty$/);
    if (req.method === 'POST' && (p === '/api/quick-entries' || resolve || discard)) {
      const input = JSON.parse((await body(req)).toString('utf8'));
      try {
        const result = await mutate((d) =>
          resolve
            ? resolveQuickEntry(d, resolve[1], input, options)
            : discard
              ? { entry: discardEmptyQuickEntry(d, discard[1], input), created: false }
              : createQuickEntry(d, input, options),
        );
        return reply(res, result.created ? 201 : 200, result.entry);
      } catch (error) {
        if (error.status === 409 && error.existingEntryId)
          return reply(res, 409, { error: error.message, existingEntryId: error.existingEntryId });
        throw error;
      }
    }
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
          commitDiaryUnits(d, e, null, options);
          d.entries.unshift(e);
          if (!d.categories.includes(e.category)) d.categories.push(e.category);
          return e;
        }),
      );
    }
    const match = p.match(/^\/api\/entries\/([a-f0-9-]+)$/);
    if (match && req.method === 'GET') {
      const entry = db.entries.find((e) => e.id === match[1]);
      if (!entry) throw fail(404, '日记不存在');
      return reply(res, 200, entry);
    }
    if (match && req.method === 'PUT') {
      const input = JSON.parse((await body(req)).toString('utf8'));
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
          return replaceEntry(d, old, validateEntry(input, d, old), options);
        }),
      );
    }

    return false;
  };
}
