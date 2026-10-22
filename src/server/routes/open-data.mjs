import { createHash, randomBytes } from 'node:crypto';
import {
  OPEN_DATA_SCHEMA,
  OPEN_DATA_TIME_ZONE,
  openRecordedDate,
  projectOpenEntry,
} from '../../../public/shared/open-data.js';
import { getEditorDocument } from '../../../public/shared/editor-document.js';
import { isHidden } from '../../../public/shared/entry-state.js';

const PREFIX = '/api/open/v1';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const COMMON = [
  'from',
  'to',
  'timeZone',
  'category',
  'tag',
  'q',
  'ids',
  'includeHidden',
  'includeDrafts',
  'includeDeleted',
  'includeComments',
  'sort',
  'limit',
  'offset',
  'snapshot',
];
const hash = (text) => createHash('sha256').update(text).digest('hex');
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function validDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parseQuery(params, endpoint, fail) {
  const allowed =
    endpoint === 'schema'
      ? []
      : endpoint === 'entry'
        ? [
            'timeZone',
            'includeHidden',
            'includeDrafts',
            'includeDeleted',
            'includeComments',
            'snapshot',
          ]
        : [
            ...COMMON,
            ...(endpoint === 'random' ? ['exclude', 'seed'] : []),
            ...(endpoint === 'anniversary' ? ['date'] : []),
          ];
  for (const key of params.keys()) {
    if (!allowed.includes(key) || params.getAll(key).length !== 1)
      throw fail(400, '未知或重复的查询参数：' + key);
  }
  const options = Object.fromEntries(params);
  for (const key of ['category', 'tag', 'q'])
    if (params.has(key) && (!options[key].trim() || options[key].length > 1000))
      throw fail(400, key + ' 必须为非空且不超过 1000 字符的文本');
  if (params.has('seed') && !/^[A-Za-z0-9_-]{1,128}$/.test(options.seed))
    throw fail(400, 'seed 必须为 1 到 128 个字母、数字、下划线或连字符');
  if (endpoint === 'random') options.seed ??= randomBytes(16).toString('hex');
  for (const key of ['includeHidden', 'includeDrafts', 'includeDeleted', 'includeComments']) {
    if (params.has(key) && !['true', 'false'].includes(options[key]))
      throw fail(400, key + ' 必须为 true 或 false');
    options[key] = options[key] === 'true';
  }
  for (const key of ['from', 'to'])
    if (params.has(key) && !validDay(options[key]))
      throw fail(400, key + ' 必须为有效的 YYYY-MM-DD 日期');
  if (options.from && options.to && options.from > options.to) throw fail(400, 'from 不能晚于 to');
  options.timeZone = options.timeZone ?? OPEN_DATA_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: options.timeZone });
  } catch {
    throw fail(400, 'timeZone 无效');
  }
  options.sort ??= 'date-desc';
  if (!['date-desc', 'date-asc', 'updated-desc'].includes(options.sort))
    throw fail(400, 'sort 无效');
  for (const [key, fallback, minimum, maximum] of [
    ['limit', endpoint === 'random' ? 1 : 50, 1, 200],
    ['offset', 0, 0, Number.MAX_SAFE_INTEGER],
  ]) {
    if (params.has(key) && !/^(0|[1-9]\d*)$/.test(options[key]))
      throw fail(400, key + ' 必须为整数');
    options[key] = params.has(key) ? Number(options[key]) : fallback;
    if (!Number.isSafeInteger(options[key]) || options[key] < minimum || options[key] > maximum)
      throw fail(400, key + ' 超出范围');
  }
  for (const key of ['ids', 'exclude']) {
    if (!params.has(key)) continue;
    const ids = options[key].split(',');
    if (ids.length > 200 || ids.some((id) => !UUID.test(id)))
      throw fail(400, key + ' 必须为最多 200 个逗号分隔的 UUID');
    options[key] = new Set(ids.map((id) => id.toLowerCase()));
  }
  if (params.has('snapshot') && !/^[a-f0-9]{64}$/.test(options.snapshot))
    throw fail(400, 'snapshot 必须为响应中的 SHA-256');
  if (endpoint === 'anniversary') {
    const value = options.date ?? openRecordedDate(new Date().toISOString(), options.timeZone);
    if (!validDay(value)) throw fail(400, 'date 必须为有效的 YYYY-MM-DD 日期');
    options.date = value;
  }
  return options;
}

export function createRoutes({ getDb, reply, fail }) {
  const snapshots = new WeakMap();
  return async (req, res, path) => {
    if (path !== PREFIX && !path.startsWith(PREFIX + '/')) return false;
    if (req.method !== 'GET') throw fail(405, '开放数据接口仅支持 GET');
    if (req.headers.origin && req.headers.origin !== 'http://' + req.headers.host)
      throw fail(403, '请求来源不匹配');
    const suffix = path.slice(PREFIX.length + 1);
    const single = suffix.match(/^entries\/([^/]+)$/);
    const endpoint = single ? 'entry' : suffix;
    if (!['schema', 'entries', 'entry', 'random', 'anniversary', 'export'].includes(endpoint))
      throw fail(404, '开放数据接口不存在');
    if (single && !UUID.test(single[1])) throw fail(400, '日记 ID 必须为 UUID');
    const options = parseQuery(new URL(req.url, 'http://localhost').searchParams, endpoint, fail);
    if (endpoint === 'schema') return reply(res, 200, OPEN_DATA_SCHEMA);
    const db = getDb();
    let snapshot = snapshots.get(db);
    if (!snapshot) {
      snapshot = hash(JSON.stringify({ entries: db.entries || [], media: db.media || [] }));
      snapshots.set(db, snapshot);
    }
    if (options.snapshot && options.snapshot !== snapshot)
      throw fail(409, '日记库已变化，请从第一页重新读取');
    const query = options.q?.toLowerCase();
    let entries = (db.entries || []).filter((entry) => {
      if (
        (!options.includeHidden && isHidden(entry)) ||
        (!options.includeDrafts && entry.draft) ||
        (!options.includeDeleted && entry.deleted)
      )
        return false;
      const id = String(entry.id).toLowerCase();
      if ((options.ids && !options.ids.has(id)) || options.exclude?.has(id)) return false;
      if (options.category !== undefined && entry.category !== options.category) return false;
      if (options.tag !== undefined && !entry.tags?.includes(options.tag)) return false;
      if (
        query &&
        ![
          entry.title,
          getEditorDocument(entry).source,
          entry.category,
          ...(entry.tags || []),
          entry.mood,
          entry.weather,
          entry.location,
        ].some((value) => typeof value === 'string' && value.toLowerCase().includes(query))
      )
        return false;
      if (options.from || options.to || options.date) {
        const day = openRecordedDate(entry.date, options.timeZone);
        if (!day || (options.from && day < options.from) || (options.to && day > options.to))
          return false;
        if (
          options.date &&
          (day.slice(5) !== options.date.slice(5) || day.slice(0, 4) >= options.date.slice(0, 4))
        )
          return false;
      }
      return true;
    });
    const mediaMap = new Map((db.media || []).map((media) => [media.id, media]));
    const envelope = { apiVersion: 1, schemaVersion: 1, snapshot, timeZone: options.timeZone };
    if (single) {
      const entry = entries.find((entry) => entry.id.toLowerCase() === single[1].toLowerCase());
      if (!entry) throw fail(404, '日记不存在或不在可读取范围内');
      return reply(res, 200, { ...envelope, entry: projectOpenEntry(entry, mediaMap, options) });
    }
    const scores =
      endpoint === 'random'
        ? new Map(
            entries.map((entry) => [
              entry.id,
              hash(options.seed + ':' + snapshot + ':' + entry.id),
            ]),
          )
        : null;
    entries.sort((a, b) => {
      if (scores) return compare(scores.get(a.id), scores.get(b.id)) || compare(a.id, b.id);
      const field = options.sort === 'updated-desc' ? 'updatedAt' : 'date';
      const first = Date.parse(a[field]) || 0,
        second = Date.parse(b[field]) || 0;
      return (options.sort === 'date-asc' ? first - second : second - first) || compare(a.id, b.id);
    });
    const total = entries.length;
    entries = entries
      .slice(options.offset, options.offset + options.limit)
      .map((entry) => projectOpenEntry(entry, mediaMap, options));
    const result = {
      ...envelope,
      ...(endpoint === 'random' ? { seed: options.seed } : {}),
      entries,
      total,
      limit: options.limit,
      offset: options.offset,
      nextOffset: options.offset + entries.length < total ? options.offset + entries.length : null,
    };
    if (endpoint === 'export') {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Disposition': 'attachment; filename="shiye-open-data.json"',
      });
      res.end(
        JSON.stringify(
          { format: 'shiye-open-data', exportedAt: new Date().toISOString(), ...result },
          null,
          2,
        ),
      );
      return true;
    }
    return reply(res, 200, result);
  };
}
