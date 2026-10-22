import { randomUUID, createHash } from 'node:crypto';
import {
  sharedSeedEntityBytes,
  sharedSeedFeedRosterSha256,
  validateSharedSeedFeedPart,
  SHARED_SEED_LIMITS,
} from '../../../public/shared/shared-seed.js';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = (code) => {
  throw Object.assign(Error(code), { code, status: 409 });
};
const matchInfo = (value, expected) => {
  if (
    !value?.enabled ||
    value.libraryId !== expected.libraryId ||
    value.epoch !== expected.epoch ||
    value.seq !== expected.seq
  )
    fail('SHARED_SEED_CATCHUP_REQUIRED');
};

/** Export-only full public projections. No raw service state enters the package,
 * and this is never called by ordinary index maintenance. */
export async function collectSharedSeedFeeds({ request, conversations, info, signal } = {}) {
  const feeds = [];
  let pages = 0,
    total = 0,
    head;
  const active = () => {
    if (signal?.aborted) fail('SHARED_SEED_CANCELLED');
    if (++pages > 100000) fail('SHARED_SEED_FEED_PAGE_LIMIT');
  };
  for (const conversationId of conversations) {
    const feed = {
      conversationId,
      watermark: info.seq,
      feedRevision: null,
      messages: [],
      redactions: [],
    };
    const rowIds = new Set(),
      redactionIds = new Set();
    let after;
    do {
      active();
      const response = await request('command', {
        libraryId: info.libraryId,
        epoch: info.epoch,
        operationId: randomUUID(),
        action: 'conversation-feed',
        input: { conversationId, limit: 100, ...(after ? { after } : {}) },
      });
      matchInfo(response.info, info);
      const page = response.result;
      if (
        !page ||
        page.conversationId !== conversationId ||
        page.watermark !== info.seq ||
        !/^[a-f0-9]{64}$/.test(page.feedRevision || '') ||
        !Array.isArray(page.messages) ||
        !Array.isArray(page.redactions) ||
        typeof page.hasMore !== 'boolean'
      )
        fail('SHARED_SEED_INVALID_FEED_PAGE');
      feed.feedRevision ??= page.feedRevision;
      head ??= page.feedRevision;
      if (feed.feedRevision !== page.feedRevision || head !== page.feedRevision)
        fail('SHARED_SEED_CATCHUP_REQUIRED');
      for (let row of page.messages) {
        if (row.payload) {
          const p = row.payload;
          if (
            p.kind !== 'shared-feed-item-json' ||
            p.version !== 1 ||
            p.conversationId !== conversationId ||
            p.messageId !== row.id ||
            p.watermark !== info.seq ||
            p.feedRevision !== feed.feedRevision ||
            !Number.isSafeInteger(p.byteLength) ||
            p.byteLength < 1 ||
            p.byteLength > SHARED_SEED_LIMITS.entity ||
            !/^[a-f0-9]{64}$/.test(p.sha256 || '')
          )
            fail('SHARED_SEED_INVALID_FEED_PAYLOAD');
          const bytes = Buffer.alloc(p.byteLength);
          for (let offset = 0; offset < bytes.length;) {
            active();
            const chunk = await request('feed-item-read', {
              libraryId: info.libraryId,
              epoch: info.epoch,
              payload: p,
              offset,
              length: Math.min(SHARED_SEED_LIMITS.chunk, bytes.length - offset),
            });
            matchInfo(chunk.info, info);
            const part = Buffer.from(chunk.bytesBase64 || '', 'base64');
            if (
              !Buffer.from(sharedSeedEntityBytes(chunk.payload)).equals(
                Buffer.from(sharedSeedEntityBytes(p)),
              ) ||
              chunk.offset !== offset ||
              !part.length ||
              part.length > SHARED_SEED_LIMITS.chunk ||
              offset + part.length > bytes.length ||
              chunk.next !== offset + part.length ||
              chunk.done !== (chunk.next === bytes.length) ||
              digest(part) !== chunk.chunkSha256
            )
              fail('SHARED_SEED_FEED_CHANGED');
            bytes.set(part, offset);
            offset = chunk.next;
          }
          if (digest(bytes) !== p.sha256) fail('SHARED_SEED_FEED_CHANGED');
          try {
            row = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
          } catch {
            fail('SHARED_SEED_INVALID_FEED_JSON');
          }
          if (row.id !== p.messageId || row.conversationId !== conversationId)
            fail('SHARED_SEED_FEED_CHANGED');
        }
        if (rowIds.has(row.id)) fail('SHARED_SEED_DUPLICATE_FEED_ROW');
        rowIds.add(row.id);
        feed.messages.push(row);
      }
      for (const row of page.redactions) {
        if (redactionIds.has(row.id)) fail('SHARED_SEED_DUPLICATE_FEED_REDACTION');
        redactionIds.add(row.id);
        feed.redactions.push(row);
      }
      if (feed.messages.length > 100000 || feed.redactions.length > 100000)
        fail('SHARED_SEED_FEED_LIMIT');
      if (!page.hasMore) break;
      if (!page.next || JSON.stringify(page.next) === JSON.stringify(after))
        fail('SHARED_SEED_INVALID_FEED_PAGE');
      after = page.next;
    } while (pages <= 100000);
    const parts = [];
    const fresh = () => ({
      format: 'shiye-conversation-feed-part',
      version: 1,
      conversationId,
      watermark: feed.watermark,
      feedRevision: feed.feedRevision,
      messages: [],
      redactions: [],
    });
    let part = fresh();
    const flush = () => {
      const value = validateSharedSeedFeedPart(part),
        bytes = Buffer.from(sharedSeedEntityBytes(value)),
        sha256 = digest(bytes);
      total += bytes.length;
      if (total > SHARED_SEED_LIMITS.entityTotal) fail('SHARED_SEED_LIMIT_EXCEEDED');
      parts.push({
        path: `entities/${sha256}.json`,
        size: bytes.length,
        sha256,
        rowCount: part.messages.length,
        redactionCount: part.redactions.length,
        bytes,
      });
      part = fresh();
    };
    for (const [field, rows] of [
      ['messages', feed.messages],
      ['redactions', feed.redactions],
    ])
      for (const row of rows) {
        part[field].push(row);
        if (
          sharedSeedEntityBytes(part).length > 900 * 1024 &&
          part.messages.length + part.redactions.length > 1
        ) {
          part[field].pop();
          flush();
          part[field].push(row);
        }
        if (sharedSeedEntityBytes(part).length > SHARED_SEED_LIMITS.entity)
          fail('SHARED_SEED_FEED_PART_TOO_LARGE');
      }
    if (part.messages.length || part.redactions.length || !parts.length) flush();
    feeds.push({
      feed,
      descriptor: {
        conversationId,
        watermark: feed.watermark,
        feedRevision: feed.feedRevision,
        rosterSha256: sharedSeedFeedRosterSha256(feed),
        rowCount: feed.messages.length,
        redactionCount: feed.redactions.length,
        parts: parts.map(({ bytes: _bytes, ...descriptor }) => descriptor),
      },
      parts,
    });
  }
  return feeds;
}
