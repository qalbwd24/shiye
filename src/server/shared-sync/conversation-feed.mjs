import { createHash } from 'node:crypto';
import { readConversationFeed } from '../conversation-services/conversations.mjs';
import { sharedInfo } from './replication.mjs';

const MAX_BYTES = 900 * 1024,
  INLINE_BYTES = 512 * 1024,
  MAX_ITEM = 64 * 1024 * 1024;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const size = (value) => Buffer.byteLength(JSON.stringify(value));
const fail = (code, status = 409) => {
  throw Object.assign(Error(code), { code, status });
};
const cache = new WeakMap();
const feedRevisions = new WeakMap();
export function sharedConversationFeedRevision(db) {
  let revision = feedRevisions.get(db);
  if (!revision) {
    // Program deliveries/comments are still owned by their existing domain and
    // need not advance the shared entity index. Bind their public feed state too.
    const digest = createHash('sha256');
    const add = (id, state) =>
      digest.update(JSON.stringify([id, state?.deliveries || [], state?.comments || []]));
    add('legacy', db.revisit);
    for (const instance of db.conversationServices?.instances || [])
      add(instance.id, instance.state);
    revision = digest.digest('hex');
    feedRevisions.set(db, revision);
  }
  return revision;
}
const feedRevision = sharedConversationFeedRevision;
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : object(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
const same = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
const publicRow = (row) =>
  row.state === 'active'
    ? row
    : { ...row, body: null, markdown: '', source: null, attachments: [] };
function watermark(db, expected) {
  const info = sharedInfo(db);
  if (!info.enabled) fail('SHARED_SYNC_NOT_ENABLED', 503);
  if (expected !== undefined && expected !== info.seq) fail('SHARED_FEED_CHANGED');
  return info.seq;
}
function payloadFor(db, row, cursor, mark) {
  const bytes = Buffer.from(JSON.stringify(row));
  if (bytes.length > MAX_ITEM) fail('SHARED_FEED_ITEM_TOO_LARGE', 413);
  const payload = {
    version: 1,
    kind: 'shared-feed-item-json',
    conversationId: row.conversationId,
    messageId: row.id,
    byteLength: bytes.length,
    sha256: hash(bytes),
    watermark: mark,
    feedRevision: feedRevision(db),
    cursor,
  };
  cache.set(db, { payload, bytes });
  return { payload, bytes };
}

/** Shared-only bounded transport. The existing desktop feed remains unchanged.
 * Lane-prefix selection uses exact source positions, never timestamp/id offsets. */
export function readSharedConversationFeed(db, input) {
  const mark = watermark(db, input.after?.watermark);
  const head = feedRevision(db);
  if (
    input.after &&
    Object.keys(input.after).length &&
    !Number.isSafeInteger(input.after.watermark)
  )
    fail('SHARED_INVALID_FEED_CURSOR', 400);
  if (input.after && Object.keys(input.after).length && input.after.feedRevision !== head)
    fail('SHARED_FEED_CHANGED');
  const redactionStart = input.after?.redactions ?? 0;
  const positions = new Map();
  const raw = readConversationFeed(
    db,
    {
      ...input,
      after:
        input.after && Object.keys(input.after).length
          ? { conversationId: input.after.conversationId, positions: input.after.positions }
          : undefined,
    },
    { positionById: positions },
  );
  if (
    !Number.isSafeInteger(redactionStart) ||
    redactionStart < 0 ||
    redactionStart > raw.redactions.length
  )
    fail('SHARED_INVALID_FEED_CURSOR', 400);
  const next = { ...(input.after?.positions || {}) };
  for (const lane of raw.lanes) next[lane.id] ??= 0;
  const frame = {
    ...raw,
    messages: [],
    redactions: [],
    lanes: raw.lanes.map((lane) => ({ ...lane, next: next[lane.id] })),
    next: {
      conversationId: raw.conversationId,
      positions: next,
      watermark: mark,
      redactions: redactionStart,
      feedRevision: head,
    },
    watermark: mark,
    feedRevision: head,
    hasMore: false,
  };
  if (size(frame) > MAX_BYTES / 2) fail('SHARED_FEED_METADATA_TOO_LARGE', 413);
  let used = size(frame),
    stopped = false;
  for (const lane of raw.lanes) {
    const rows = raw.messages
      .filter((row) => positions.get(row.id)?.lane === lane.id)
      .sort((a, b) => positions.get(a.id).position - positions.get(b.id).position);
    for (const original of rows) {
      const row = publicRow(original);
      const position = positions.get(row.id).position;
      const cursor = {
        conversationId: raw.conversationId,
        positions: Object.fromEntries(
          raw.lanes.map((l) => [l.id, l.id === lane.id ? position - 1 : l.total]),
        ),
      };
      let candidate = row;
      if (size(row) > INLINE_BYTES) {
        const { payload } = payloadFor(db, row, cursor, mark);
        candidate = {
          id: row.id,
          conversationId: row.conversationId,
          kind: row.kind,
          state: row.state,
          order: row.order,
          payload,
        };
      }
      const count = size(candidate) + 32;
      if (used + count > MAX_BYTES) {
        if (!frame.messages.length) fail('SHARED_FEED_ITEM_TOO_LARGE', 413);
        stopped = true;
        break;
      }
      frame.messages.push(candidate);
      next[lane.id] = position;
      used += count;
    }
    if (stopped) break;
  }
  let redactionNext = redactionStart;
  for (const row of raw.redactions.slice(redactionStart)) {
    const count = size(row) + 16;
    if (used + count > MAX_BYTES || frame.redactions.length >= 1000) break;
    frame.redactions.push(row);
    used += count;
    redactionNext++;
  }
  frame.next.redactions = redactionNext;
  const rank = new Map(raw.messages.map((row, index) => [row.id, index]));
  frame.messages.sort((a, b) => rank.get(a.id) - rank.get(b.id));
  frame.lanes = frame.lanes.map((lane) => ({ ...lane, next: next[lane.id] }));
  frame.hasMore =
    frame.lanes.some((lane) => lane.next < lane.total) || redactionNext < raw.redactions.length;
  frame.nextCursor = frame.next;
  // Alias overhead is small but still part of the transport budget.
  if (size(frame) > 1024 * 1024) fail('SHARED_FEED_METADATA_TOO_LARGE', 413);
  return frame;
}

export function readSharedFeedItem(db, input) {
  const p = input.payload;
  if (
    !object(p) ||
    p.version !== 1 ||
    p.kind !== 'shared-feed-item-json' ||
    !object(p.cursor) ||
    p.cursor.conversationId !== p.conversationId ||
    typeof p.messageId !== 'string' ||
    !Number.isSafeInteger(p.byteLength) ||
    p.byteLength < 1 ||
    p.byteLength > MAX_ITEM ||
    !/^[a-f0-9]{64}$/.test(p.sha256) ||
    !Number.isSafeInteger(p.watermark) ||
    !Number.isSafeInteger(input.offset) ||
    input.offset < 0 ||
    !Number.isSafeInteger(input.length) ||
    input.length < 1 ||
    input.length > 256 * 1024
  )
    fail('SHARED_INVALID_FEED_ITEM', 400);
  watermark(db, p.watermark);
  if (p.feedRevision !== feedRevision(db)) fail('SHARED_FEED_CHANGED');
  let wire = cache.get(db);
  if (!wire || !same(wire.payload, p)) {
    const row = readConversationFeed(db, {
      conversationId: p.conversationId,
      after: p.cursor,
      limit: 1,
    }).messages.find((row) => row.id === p.messageId);
    if (!row) fail('SHARED_FEED_CHANGED');
    wire = payloadFor(db, publicRow(row), p.cursor, p.watermark);
  }
  if (!same(wire.payload, p)) fail('SHARED_FEED_CHANGED');
  if (input.offset > wire.bytes.length) fail('SHARED_INVALID_FEED_ITEM', 416);
  const bytes = wire.bytes.subarray(
    input.offset,
    Math.min(input.offset + input.length, wire.bytes.length),
  );
  return {
    payload: p,
    offset: input.offset,
    next: input.offset + bytes.length,
    done: input.offset + bytes.length === wire.bytes.length,
    bytesBase64: bytes.toString('base64'),
    chunkSha256: hash(bytes),
  };
}

export function createSharedFeedPayload({ store, body, reply }) {
  return {
    async handle(req, res, pathname) {
      if (pathname !== '/api/shared/v1/feed-item/read') return false;
      try {
        if (req.method !== 'POST') fail('SHARED_ACTION_NOT_FOUND', 404);
        const input = JSON.parse((await body(req, 256 * 1024)).toString('utf8'));
        const db = store.getDb(),
          info = sharedInfo(db);
        if (!object(input)) fail('SHARED_INVALID_FEED_ITEM', 400);
        if (input.libraryId !== info.libraryId || input.epoch !== info.epoch)
          fail('SHARED_LIBRARY_MISMATCH');
        return reply(res, 200, { info, ...readSharedFeedItem(db, input) });
      } catch (error) {
        return reply(res, error.status || 500, {
          error: { code: /^SHARED_/.test(error.code) ? error.code : 'SHARED_FEED_READ_FAILED' },
        });
      }
    },
  };
}
