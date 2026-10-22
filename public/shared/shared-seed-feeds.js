import { prepareSharedInbox, reserveSharedInbox } from './shared-inbox.js';
const fail = (code) => {
  throw Object.assign(Error(code), { code });
};
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** Refresh every current room at one shared watermark AND legacy feed revision.
 * Offline projection rows never become an active inbox without this proof. */
export async function refreshSharedSeedFeeds({
  seed,
  entities,
  after,
  storage,
  metadata,
  request,
  identity,
  hydrateFeed,
  libraryId,
  epoch,
}) {
  if (seed.manifest.version !== 2) return [];
  const active = new Set(
    entities
      .filter((row) => row.entityType === 'conversation' && row.state === 'active')
      .map((row) => row.entityId),
  );
  const scopes = new Set([
    ...seed.manifest.conversationFeeds.map((feed) => feed.conversationId),
    ...active,
  ]);
  const tickets = await storage.transaction(async (tx) => {
    const meta = await metadata(tx),
      result = [];
    for (const scope of scopes) result.push(reserveSharedInbox(meta, scope));
    await tx.setMeta(meta);
    return result;
  });
  const batches = [];
  let head,
    pageCount = 0,
    total = 0,
    rowCount = 0;
  async function query(action, input) {
    const operationId = crypto.randomUUID();
    const response = await request('command', { libraryId, epoch, operationId, action, input });
    identity(response.info);
    if (response.operationId !== operationId || !response.result) fail('SHARED_INVALID_ACK');
    return response.result;
  }
  function revision(feed, id) {
    if (
      feed.conversationId !== id ||
      feed.watermark !== after ||
      !/^[a-f0-9]{64}$/.test(feed.feedRevision || '')
    )
      fail('SHARED_FEED_CHANGED');
    if (head === undefined) head = feed.feedRevision;
    if (head !== feed.feedRevision) fail('SHARED_FEED_CHANGED');
  }
  for (const ticket of tickets) {
    const id = ticket.conversationId;
    if (!active.has(id)) {
      batches.push({
        ticket,
        batch: prepareSharedInbox(id, {
          details: { conversationId: id, state: 'unavailable', readOnly: true },
          messages: [],
        }),
      });
      continue;
    }
    const details = await query('conversation-read', { conversationId: id });
    if (details.conversationId !== id) fail('SHARED_INVALID_INBOX');
    const messages = [],
      redactions = [],
      seen = new Set();
    let cursor;
    for (;;) {
      if (++pageCount > 10000) fail('SHARED_SEED_FEED_LIMIT');
      const feed = await query('conversation-feed', {
        conversationId: id,
        limit: 100,
        ...(cursor === undefined ? {} : { after: cursor }),
      });
      revision(feed, id);
      if (
        !Array.isArray(feed.messages) ||
        !Array.isArray(feed.redactions) ||
        typeof feed.hasMore !== 'boolean' ||
        (feed.hasMore && (!feed.next || equal(feed.next, cursor)))
      )
        fail('SHARED_INVALID_INBOX');
      for (const value of feed.messages) {
        const row = await hydrateFeed(value, feed.watermark);
        if (seen.has(row.id)) fail('SHARED_SEED_DUPLICATE_FEED_ROW');
        seen.add(row.id);
        messages.push(row);
        total += new TextEncoder().encode(JSON.stringify(row)).length;
        if (++rowCount > 100000 || total > 512 * 1024 * 1024) fail('SHARED_SEED_FEED_LIMIT');
      }
      for (const row of feed.redactions) {
        redactions.push(row);
        total += new TextEncoder().encode(JSON.stringify(row)).length;
        if (++rowCount > 200000 || total > 512 * 1024 * 1024) fail('SHARED_SEED_FEED_LIMIT');
      }
      if (!feed.hasMore) break;
      cursor = feed.next;
    }
    batches.push({ ticket, batch: prepareSharedInbox(id, { details, messages, redactions }) });
  }
  // feedRevision covers all legacy program deliveries/comments, even changes
  // that do not advance the shared entity sequence. A final head read fences
  // mutations during earlier room fetches. This is a read snapshot, not a lock.
  const first = active.values().next().value;
  if (first !== undefined)
    revision(await query('conversation-feed', { conversationId: first, limit: 1 }), first);
  const info = await request('info', {});
  identity(info.info || info);
  if ((info.info || info).seq !== after) fail('SHARED_FEED_CHANGED');
  return batches;
}
