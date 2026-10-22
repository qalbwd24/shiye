/** Local-only projections of the Android Product diary catalog. */
import { textOf, plainCache } from '../editor/content.js';
export const DIARY_INDEX_VERSION = 2;
export const DIARY_PAGE_MAX_BYTES = 256 * 1024;
const encoder = new TextEncoder();
const fail = (code) => {
  throw Object.assign(new Error(code), { code });
};
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const short = (value, limit) => {
  if (typeof value !== 'string') return { value: '', truncated: false };
  const points = Array.from(value.slice(0, limit * 2));
  return {
    value: points.slice(0, limit).join(''),
    truncated: points.length > limit || value.length > limit * 2,
  };
};

function portableHtmlText(value) {
  // Node's synthetic IDB has no DOMParser. Production uses the existing editor
  // formatter; this bounded fallback lets the same derived-index contract run in tests.
  return value
    .replace(/<(script|style|iframe|object|svg|math)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<\s*br\b[^>]*>/gi, '\n')
    .replace(/<\s*\/(?:p|div|li|h[1-6]|blockquote|tr|pre)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp|#(\d+)|#x([\da-f]+));/gi, (all, decimal, hex) => {
      if (decimal || hex) {
        const point = Number.parseInt(decimal || hex, hex ? 16 : 10);
        return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : all;
      }
      return (
        { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' }[
          all.toLowerCase()
        ] || all
      );
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function richBodyText(body) {
  // A read-only text projection of the already canonical richdoc. Keep the
  // editor schema and renderer out of the storage/query dependency graph.
  if (!plain(body) || !Array.isArray(body.content)) fail('SHARED_DIARY_SEARCH_INVALID_RICHDOC');
  const parts = [];
  const block = new Set([
    'paragraph',
    'heading',
    'codeBlock',
    'listItem',
    'taskItem',
    'tableRow',
    'blockquote',
  ]);
  let nodes = 0;
  let length = 0;
  const add = (value) => {
    if (typeof value !== 'string') return;
    length += value.length;
    if (length > 1024 * 1024) fail('SHARED_DIARY_SEARCH_PROJECTION_TOO_LARGE');
    parts.push(value);
  };
  const visit = (node, depth) => {
    if (++nodes > 100000 || depth > 48 || !plain(node) || typeof node.type !== 'string')
      fail('SHARED_DIARY_SEARCH_INVALID_RICHDOC');
    if (node.type === 'text') {
      add(node.text);
      return;
    }
    if (node.type === 'hardBreak') {
      add('\n');
      return;
    }
    if (node.type === 'image') add(node.attrs?.caption);
    if (node.type === 'video') {
      add(node.attrs?.alt || '当前浏览器无法播放此视频。');
      add(node.attrs?.caption);
    }
    if (node.type === 'taskItem') add(node.attrs?.checked ? '☑ ' : '☐ ');
    if (Array.isArray(node.content)) node.content.forEach((child) => visit(child, depth + 1));
    if (block.has(node.type)) add('\n');
  };
  body.content.forEach((node) => visit(node, 0));
  return parts
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function diaryBodyText(data) {
  let html = typeof data.content === 'string' ? data.content : '';
  if (data.contentFormat === 'richdoc' && data.body) {
    return richBodyText(data.body);
  } else if (!html && typeof data.markdownSource === 'string') {
    // A source-only draft has no canonical HTML projection yet. Its Markdown
    // is source text, so angle-bracket code must not be parsed as an HTML tag.
    return data.markdownSource;
  }
  const value = typeof DOMParser === 'function' ? textOf(html) : portableHtmlText(html);
  if (typeof DOMParser === 'function') plainCache.delete(html);
  return value;
}

export function diaryHeaderFromEntity(record) {
  if (!plain(record) || record.entityType !== 'entry' || typeof record.entityId !== 'string')
    return null;
  if (!record.entityId || !Number.isSafeInteger(record.localRevision ?? 0))
    fail('SHARED_DIARY_INDEX_INVALID_ENTITY');
  const local = record.local;
  if (!local || local.state === 'withdrawn') return null;
  if (!plain(local.data)) fail('SHARED_DIARY_INDEX_INVALID_ENTITY');
  const data = local.data;
  const title = short(data.title, 160);
  const rawSummary =
    typeof data.preview === 'string'
      ? data.preview
      : typeof data.summary === 'string'
        ? data.summary
        : diaryBodyText(data);
  const summary = short(rawSummary, 240);
  const date = typeof data.date === 'string' ? data.date : '';
  const category = typeof data.category === 'string' ? short(data.category, 120).value : '';
  const rawCreatedAt = typeof data.createdAt === 'string' ? data.createdAt : '';
  const rawUpdatedAt = typeof data.updatedAt === 'string' ? data.updatedAt : '';
  const readOnly = Boolean(data.chatJournal || data._product?.readOnlyProjection);
  const attachments = Array.isArray(data.attachments) ? data.attachments : [];
  const firstMedia = attachments.find(
    (item) => plain(item) && (typeof item.mediaId === 'string' || typeof item.sha256 === 'string'),
  );
  return {
    id: record.entityId,
    title: title.value,
    titleTruncated: title.truncated,
    summary: summary.value,
    summaryTruncated: summary.truncated,
    preview: summary.value,
    date,
    category,
    categoryId: typeof data.categoryId === 'string' ? data.categoryId : '',
    createdAt: rawCreatedAt,
    updatedAt: rawUpdatedAt,
    displayKey: [data.pinned === true ? 0 : 1, invertDiarySort(rawCreatedAt), record.entityId],
    bootstrapKey: [
      invertDiarySort(typeof data.date === 'string' ? data.date : ''),
      invertDiarySort(rawUpdatedAt),
      record.entityId,
    ],
    pinned: data.pinned === true,
    deleted: local.state === 'deleted' || data.deleted === true,
    chat: Boolean(data.chatJournal),
    format: typeof data.contentFormat === 'string' ? short(data.contentFormat, 32).value : '',
    contentFormat:
      typeof data.contentFormat === 'string' ? short(data.contentFormat, 32).value : '',
    mediaCount: attachments.length,
    media: {
      count: attachments.length,
      firstRef: firstMedia
        ? {
            mediaId:
              typeof firstMedia.mediaId === 'string' ? short(firstMedia.mediaId, 128).value : null,
            sha256:
              typeof firstMedia.sha256 === 'string' ? short(firstMedia.sha256, 64).value : null,
          }
        : null,
    },
    readOnly,
    readOnlyReason: readOnly ? (data.chatJournal ? 'chat-journal' : 'projection') : null,
    localRevision: record.localRevision ?? 0,
    serverRevision: record.base?.revision ?? null,
    indexVersion: DIARY_INDEX_VERSION,
    titleOrigin: data._product?.kind === 'entry' ? 'product-entry' : 'unknown',
    titleRefs: plain(data._product?.refs)
      ? {
          category:
            typeof data._product.refs.category === 'string' ? data._product.refs.category : '',
          messages: Object.hasOwn(data._product.refs, 'messages'),
          conversation: Object.hasOwn(data._product.refs, 'conversation'),
          present: true,
        }
      : { present: false },
    draftOnly: data.draftOnly === true,
    chatJournalPresent: Object.hasOwn(data, 'chatJournal'),
    readOnlyProjection: data._product?.readOnlyProjection === true,
    localState: local.state,
  };
}

function invertDiarySort(value) {
  if (value.length > 512) fail('SHARED_DIARY_SORT_VALUE_TOO_LARGE');
  let out = '';
  for (let i = 0; i < value.length; i++) out += String.fromCharCode(65535 - value.charCodeAt(i));
  return `${out}\uffff`;
}

export function diarySearchFromEntity(record) {
  if (
    !plain(record) ||
    record.entityType !== 'entry' ||
    !record.local ||
    record.local.state === 'withdrawn'
  )
    return null;
  const data = record.local.data;
  if (!plain(data)) fail('SHARED_DIARY_INDEX_INVALID_ENTITY');
  const bodyText = diaryBodyText(data);
  const text = [typeof data.searchText === 'string' ? data.searchText : '', bodyText]
    .filter(Boolean)
    .join(' ');
  const result = {
    id: record.entityId,
    title: typeof data.title === 'string' ? data.title : '',
    preview:
      typeof data.preview === 'string'
        ? data.preview
        : typeof data.summary === 'string'
          ? data.summary
          : '',
    searchText: text,
    tags: Array.isArray(data.tags) ? JSON.stringify(data.tags) : 'null',
  };
  if (encoder.encode(JSON.stringify(result)).length > 1024 * 1024)
    fail('SHARED_DIARY_SEARCH_PROJECTION_TOO_LARGE');
  return result;
}

export function diaryTitleFromEntity(record) {
  if (!plain(record) || record.entityType !== 'entry' || !record.local) return null;
  const data = record.local?.data;
  return {
    id: record.entityId,
    state: record.local?.state || '',
    hasData: plain(data),
    date: typeof data?.date === 'string' ? data.date : '',
    deleted: data?.deleted === true,
    draftOnly: data?.draftOnly === true,
    origin: data?._product?.kind || '',
    hasRefs: plain(data?._product?.refs),
    stableCategory:
      typeof data?._product?.refs?.category === 'string' ? data._product.refs.category : '',
    categoryId: typeof data?.categoryId === 'string' ? data.categoryId : '',
    readOnlyProjection: data?._product?.readOnlyProjection === true,
    chatJournalPresent: plain(data) && Object.hasOwn(data, 'chatJournal'),
    messageRefsPresent:
      plain(data?._product?.refs) &&
      (Object.hasOwn(data._product.refs, 'messages') ||
        Object.hasOwn(data._product.refs, 'conversation')),
  };
}

export function diarySuggestedTitle({
  entryId,
  date,
  categoryId = null,
  draft,
  legacyEntries,
  products,
  categoryName,
  stableCategoryIdentity = false,
  timeZone,
}) {
  if (typeof entryId !== 'string' || !entryId) fail('SHARED_DIARY_TITLE_INVALID');
  if (diaryDayKey(date, timeZone) !== date || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    fail('SHARED_DIARY_TITLE_INVALID_DATE');
  if (categoryId === '') categoryId = null;
  if (categoryId !== null && (typeof categoryId !== 'string' || categoryId.length > 128))
    fail('SHARED_DIARY_TITLE_INVALID_CATEGORY');
  if (!Array.isArray(legacyEntries) || !Array.isArray(products))
    fail('SHARED_DIARY_TITLE_SOURCE_COVERAGE_REQUIRED');
  if (legacyEntries.some((row) => row.id === entryId) || products.some((row) => row.id === entryId))
    fail('SHARED_DIARY_TITLE_EXISTING_ENTRY');
  if (!draft || draft.id !== entryId || draft.draftOnly !== true)
    fail('SHARED_DIARY_TITLE_DRAFT_REQUIRED');
  const label = categoryId === null ? '未分类' : categoryName;
  if (typeof label !== 'string' || !label.trim()) fail('SHARED_DIARY_TITLE_CATEGORY_UNVERIFIED');
  const productIds = new Set(products.map((row) => row.id));
  let sequence = 0;
  for (const row of products) {
    if (row.state === 'withdrawn' || row.state === 'deleted') continue;
    if (row.state !== 'active') fail('SHARED_DIARY_TITLE_STATE_UNVERIFIED');
    if (!row.hasData) fail('SHARED_DIARY_TITLE_DATA_MISSING');
    if (row.deleted || row.draftOnly) continue;
    if (row.origin !== 'entry') fail('SHARED_DIARY_TITLE_ORIGIN_UNVERIFIED');
    if (row.readOnlyProjection || row.chatJournalPresent || row.messageRefsPresent) continue;
    const day = diaryDayKey(row.date, timeZone);
    if (!day) fail('SHARED_DIARY_TITLE_DATE_UNVERIFIED');
    if (day !== date) continue;
    if (!row.hasRefs) fail('SHARED_DIARY_TITLE_REFS_MISSING');
    if (categoryId === null) {
      if (!row.stableCategory && !row.categoryId) sequence++;
    } else if (
      categoryId === row.stableCategory ||
      (!stableCategoryIdentity && categoryId === row.categoryId)
    )
      sequence++;
  }
  for (const row of legacyEntries) {
    if (row.id === entryId || productIds.has(row.id) || row.deleted || row.date !== date) continue;
    if (
      categoryId === null
        ? row.categoryId === null || row.categoryId === undefined
        : categoryId === row.categoryId
    )
      sequence++;
  }
  const title = `${date.slice(2, 4)}${date.slice(5, 7)}${date.slice(8, 10)}${label}${sequence}`;
  if (title.length > 500) fail('SHARED_DIARY_TITLE_TOO_LONG');
  return { title, date, categoryId, sequence };
}

export function diaryPublicHeader(row) {
  const {
    displayKey: _displayKey,
    bootstrapKey: _bootstrapKey,
    titleOrigin: _titleOrigin,
    titleRefs: _titleRefs,
    draftOnly: _draftOnly,
    chatJournalPresent: _chatJournalPresent,
    readOnlyProjection: _readOnlyProjection,
    localState: _localState,
    ...publicRow
  } = row;
  return publicRow;
}

export function diaryDayKey(raw, timeZone) {
  if (typeof raw !== 'string' || raw.length < 10) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const date = new Date(`${raw}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === raw ? raw : '';
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(raw)) return '';
  if (!diaryDayKey(raw.slice(0, 10), timeZone)) return '';
  if (
    Number(raw.slice(11, 13)) > 23 ||
    Number(raw.slice(14, 16)) > 59 ||
    Number(raw.slice(17, 19)) > 59
  )
    return '';
  const offset = raw.match(/[+-](\d{2}):(\d{2})$/);
  if (offset && (Number(offset[1]) > 23 || Number(offset[2]) > 59)) return '';
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const part = (name) => parts.find((p) => p.type === name)?.value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  } catch {
    fail('SHARED_DIARY_TIME_ZONE_INVALID');
  }
}

const DATE_TOKEN = /(?<![0-9])\d{4}-\d{2}-\d{2}(?![0-9])/g;
export function diaryTerms(input = {}) {
  const query = (input.query || '').trim().toLocaleLowerCase('und');
  const dates = [...query.matchAll(DATE_TOKEN)];
  const exactDay = dates[0]?.[0] || '';
  const words = (
    input.calendar ? query.replace(DATE_TOKEN, '') : exactDay ? query.replace(exactDay, '') : query
  )
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return { exactDay, words };
}

export function diaryMatches(header, search, input, calendar = false) {
  if (input.categoryId && input.categoryId !== header.categoryId) return false;
  const { exactDay, words } = diaryTerms({ ...input, calendar });
  const day = diaryDayKey(header.date, input.timeZone);
  if (!calendar && exactDay && exactDay !== day) return false;
  const haystack =
    `${search?.title || ''} ${search?.searchText || ''} ${search?.preview || ''} ${search?.tags || 'null'} ${day}`.toLocaleLowerCase(
      'und',
    );
  return words.every((word) => haystack.includes(word));
}

export function diaryStreak(dates, today) {
  const set = new Set(dates);
  let day = set.has(today)
    ? today
    : new Date(Date.parse(`${today}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  let count = 0;
  while (set.has(day)) {
    count++;
    day = new Date(Date.parse(`${day}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  }
  return count;
}

export function diaryPageOptions(input = {}) {
  if (!plain(input)) fail('SHARED_DIARY_QUERY_INVALID');
  if (
    Object.keys(input).some(
      (key) =>
        ![
          'limit',
          'deleted',
          'includeChat',
          'categoryId',
          'timeZone',
          'cursor',
          'query',
          'sort',
        ].includes(key),
    ) ||
    (input.deleted !== undefined && typeof input.deleted !== 'boolean') ||
    (input.includeChat !== undefined && typeof input.includeChat !== 'boolean') ||
    (input.query !== undefined && (typeof input.query !== 'string' || input.query.length > 256)) ||
    (input.categoryId !== undefined &&
      (typeof input.categoryId !== 'string' || input.categoryId.length > 128)) ||
    (input.timeZone !== undefined &&
      (typeof input.timeZone !== 'string' || input.timeZone.length > 100))
  )
    fail('SHARED_DIARY_QUERY_INVALID');
  const limit = input.limit ?? 40;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail('SHARED_DIARY_QUERY_INVALID');
  if (input.sort !== undefined && input.sort !== 'product-created-v1')
    fail('SHARED_DIARY_QUERY_INVALID');
  const timeZone = input.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
  } catch {
    fail('SHARED_DIARY_TIME_ZONE_INVALID');
  }
  if (input.cursor !== undefined && typeof input.cursor !== 'string')
    fail('SHARED_DIARY_QUERY_INVALID');
  return {
    limit,
    deleted: input.deleted,
    includeChat: input.includeChat !== false,
    cursor: input.cursor ?? null,
    query: input.query || '',
    categoryId: input.categoryId || '',
    timeZone,
  };
}

export function diaryQueryKey(options) {
  return JSON.stringify([
    options.deleted,
    options.includeChat,
    options.query,
    options.categoryId,
    options.timeZone,
    'product-created-v1',
  ]);
}

export function encodeDiaryCursor(value) {
  const bytes = encoder.encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function decodeDiaryCursor(value) {
  if (typeof value !== 'string' || value.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(value))
    fail('SHARED_DIARY_CURSOR_INVALID');
  try {
    const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/'));
    const decoded = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(
        Uint8Array.from(binary, (c) => c.charCodeAt(0)),
      ),
    );
    if (!plain(decoded) || decoded.version !== DIARY_INDEX_VERSION || !Array.isArray(decoded.after))
      fail('SHARED_DIARY_CURSOR_INVALID');
    return decoded;
  } catch {
    fail('SHARED_DIARY_CURSOR_INVALID');
  }
}

export function diaryHeaderFitsPage(row) {
  return encoder.encode(JSON.stringify(row)).length <= 4096;
}

export function validateDiarySidecar(value, kind) {
  if (!plain(value)) fail('SHARED_DIARY_SIDECAR_INVALID');
  const allowed =
    kind === 'draft'
      ? ['format', 'body', 'mediaRefs', 'selectionAnchor']
      : kind === 'reading'
        ? ['selectionAnchor', 'scrollAnchor']
        : null;
  if (!allowed || Object.keys(value).some((key) => !allowed.includes(key)))
    fail('SHARED_DIARY_SIDECAR_INVALID');
  if (kind === 'draft') {
    if (
      !['html', 'markdown', 'richdoc'].includes(value.format) ||
      !(typeof value.body === 'string' || plain(value.body)) ||
      !Array.isArray(value.mediaRefs) ||
      value.mediaRefs.length !== 0 ||
      (value.selectionAnchor !== null &&
        value.selectionAnchor !== undefined &&
        !plain(value.selectionAnchor))
    )
      fail(
        value.mediaRefs?.length
          ? 'SHARED_DIARY_NEW_MEDIA_UNSUPPORTED'
          : 'SHARED_DIARY_SIDECAR_INVALID',
      );
  } else if (kind === 'reading') {
    if (
      (value.selectionAnchor !== null &&
        value.selectionAnchor !== undefined &&
        !plain(value.selectionAnchor)) ||
      (value.scrollAnchor !== null &&
        value.scrollAnchor !== undefined &&
        !plain(value.scrollAnchor))
    )
      fail('SHARED_DIARY_SIDECAR_INVALID');
  } else fail('SHARED_DIARY_SIDECAR_INVALID');
  let nodes = 0;
  const checkJson = (item, depth) => {
    if (++nodes > 100000 || depth > 32) fail('SHARED_DIARY_SIDECAR_INVALID');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return;
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (Array.isArray(item)) {
      for (const child of item) checkJson(child, depth + 1);
      return;
    }
    if (!plain(item) || ![null, Object.prototype].includes(Object.getPrototypeOf(item)))
      fail('SHARED_DIARY_SIDECAR_INVALID');
    for (const [key, child] of Object.entries(item)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key))
        fail('SHARED_DIARY_SIDECAR_INVALID');
      checkJson(child, depth + 1);
    }
  };
  checkJson(value, 0);
  let json;
  try {
    json = JSON.stringify(value);
  } catch {
    fail('SHARED_DIARY_SIDECAR_INVALID');
  }
  if (!json || encoder.encode(json).length > 3 * 1024 * 1024)
    fail('SHARED_DIARY_SIDECAR_TOO_LARGE');
  return JSON.parse(json);
}

export function diaryPageBytes(value) {
  return encoder.encode(JSON.stringify(value)).length;
}
