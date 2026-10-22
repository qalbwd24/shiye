import { readMessageUnits, readDiaryCandidate } from '../domain/message-store.mjs';

export function createRoutes({ getDb, reply, fail, messageUnitsEnabled }) {
  return async (req, res, p) => {
    if (req.method !== 'GET') return false;
    const match = p.match(/^\/api\/message-units\/([^/]+)$/);
    if (!match && p !== '/api/message-units') return false;
    const db = getDb();
    const query = new URL(req.url, 'http://localhost').searchParams;
    const allowed = [
      'entryId',
      'roomId',
      'sourceId',
      'from',
      'to',
      'order',
      'limit',
      'offset',
      'includeDeleted',
      'includeHidden',
      'includeDraft',
      'includeWithdrawn',
      'includeComments',
    ];
    for (const key of query.keys()) {
      if (!allowed.includes(key) || query.getAll(key).length !== 1)
        throw fail(400, '未知或重复的消息查询参数');
      if (key.startsWith('include') && !['0', '1'].includes(query.get(key)))
        throw fail(400, '消息可见性开关须为0或1');
    }
    if (query.has('order') && !['asc', 'desc'].includes(query.get('order')))
      throw fail(400, '消息排序须为asc或desc');
    const filters = Object.fromEntries(
      ['entryId', 'roomId', 'sourceId'].map((key) => [key, query.get(key)]),
    );
    const visible = (unit) =>
      !!unit.attributes.entryId &&
      (query.get('includeComments') === '1' || unit.origin.kind !== 'comment') &&
      (query.get('includeDeleted') === '1' ||
        (!unit.attributes.deleted && unit.state !== 'deleted')) &&
      (query.get('includeHidden') === '1' || !unit.attributes.hidden) &&
      (query.get('includeDraft') === '1' || !unit.attributes.draft) &&
      (query.get('includeWithdrawn') === '1' || unit.state !== 'withdrawn');
    const from = query.get('from'),
      to = query.get('to');
    if ((from && !Number.isFinite(Date.parse(from))) || (to && !Number.isFinite(Date.parse(to))))
      throw fail(400, '消息时间范围无效');
    if (from && to && Date.parse(from) > Date.parse(to))
      throw fail(400, '消息开始时间不能晚于结束时间');
    const limit = Number(query.get('limit') || 100),
      offset = Number(query.get('offset') || 0);
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 1000 ||
      !Number.isSafeInteger(offset) ||
      offset < 0
    )
      throw fail(400, '消息分页参数无效');
    const matches = readMessageUnits(db, filters)
      .filter(visible)
      .filter(
        (unit) =>
          (!from || Date.parse(unit.eventTime.instant) >= Date.parse(from)) &&
          (!to || Date.parse(unit.eventTime.instant) <= Date.parse(to)),
      )
      .sort(
        (a, b) =>
          (Date.parse(a.eventTime.instant) || 0) - (Date.parse(b.eventTime.instant) || 0) ||
          (a.origin.entryId === b.origin.entryId
            ? a.attributes.position - b.attributes.position
            : 0) ||
          a.id.localeCompare(b.id),
      );
    if (query.get('order') === 'desc') matches.reverse();
    const units = matches.slice(offset, offset + limit);
    if (match) {
      let id;
      try {
        id = decodeURIComponent(match[1]);
      } catch {
        throw fail(400, '消息编号编码无效');
      }
      const unit = readMessageUnits(db).find((item) => item.id === id);
      if (!unit || !visible(unit)) throw fail(404, '消息不存在或当前筛选不可见');
      return reply(res, 200, unit);
    }
    const entry = filters.entryId && db.entries.find((item) => item.id === filters.entryId);
    if (filters.entryId && !entry) throw fail(404, '日记不存在');
    const saved = entry && db.messageStore?.layouts?.[entry.id];
    const entryVisible =
      entry &&
      (query.get('includeDeleted') === '1' || !entry.deleted) &&
      (query.get('includeHidden') === '1' || !entry.hidden) &&
      (query.get('includeDraft') === '1' || !entry.draft);
    const candidate =
      entryVisible && !saved && !units.some((unit) => unit.origin.kind !== 'comment')
        ? readDiaryCandidate(db, entry)
        : null;
    return reply(res, 200, {
      version: 1,
      enabled: !!messageUnitsEnabled,
      persisted: !!saved || matches.length > 0,
      units,
      total: matches.length,
      offset,
      limit,
      nextOffset: offset + units.length < matches.length ? offset + units.length : null,
      ...(saved && entryVisible
        ? { layout: saved.layout, mappings: saved.mappings, issues: saved.issues }
        : {}),
      ...(candidate ? { candidate } : {}),
    });
  };
}
