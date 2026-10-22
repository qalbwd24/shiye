// Read-only server inbox in the shared client's existing transaction store.
// One row per canonical message; the meta roster contains IDs, never bodies.
const type = 'shared-inbox-message';
const copy = (v) => structuredClone(v);
const object = (v) => v && typeof v === 'object' && !Array.isArray(v);
const key = (scope, id) => JSON.stringify([scope, id]);
const fail = (code) => {
  throw Object.assign(Error(code), { code });
};
const put = (o, k, v) =>
  Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
const scopeValid = (v) =>
  typeof v === 'string' &&
  /^desktop:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}:-?\d{1,20}$/.test(v);
const safeKeys = [
  'id',
  'conversationId',
  'kind',
  'state',
  'order',
  'actor',
  'sentAt',
  'originalAt',
  'entryId',
  'revision',
  'instanceId',
  'operationId',
  'batchId',
  'deliveryId',
  'replyTo',
  'commentOn',
  'readOnly',
];
export function scrubInboxMessage(message, state = message.state) {
  if (state === 'active') return copy(message);
  return {
    ...Object.fromEntries(
      safeKeys.filter((k) => Object.hasOwn(message, k)).map((k) => [k, copy(message[k])]),
    ),
    state,
    markdown: '',
    attachments: [],
    body: null,
    source: null,
  };
}
export function reserveSharedInbox(meta, conversationId) {
  if (!scopeValid(conversationId)) fail('SHARED_INVALID_CONVERSATION');
  meta.inboxes ||= {};
  const prior = Object.hasOwn(meta.inboxes, conversationId) ? meta.inboxes[conversationId] : {};
  const generation = (prior.generation || 0) + 1;
  if (!Number.isSafeInteger(generation)) fail('SHARED_INBOX_GENERATION_EXHAUSTED');
  put(meta.inboxes, conversationId, { ...prior, generation });
  return { conversationId, generation };
}
/** Pure validation/scrub shared by ordinary refresh and atomic seed publish. */
export function prepareSharedInbox(conversationId, { details, messages, redactions = [] }) {
  if (
    !scopeValid(conversationId) ||
    !object(details) ||
    details.conversationId !== conversationId ||
    !Array.isArray(messages) ||
    !Array.isArray(redactions)
  )
    fail('SHARED_INVALID_INBOX');
  const rows = new Map();
  for (const message of messages) {
    if (
      !object(message) ||
      typeof message.id !== 'string' ||
      !message.id ||
      message.conversationId !== conversationId ||
      !['message', 'history', 'comment'].includes(message.kind) ||
      !['active', 'withdrawn', 'unavailable'].includes(message.state)
    )
      fail('SHARED_INVALID_INBOX');
    const row = scrubInboxMessage(message);
    if (new TextEncoder().encode(JSON.stringify(row)).byteLength > 64 * 1024 * 1024)
      fail('SHARED_INBOX_MESSAGE_TOO_LARGE');
    rows.set(message.id, row);
  }
  for (const redaction of redactions) {
    if (
      !object(redaction) ||
      typeof redaction.id !== 'string' ||
      !['withdrawn', 'unavailable'].includes(redaction.state)
    )
      fail('SHARED_INVALID_INBOX');
    if (rows.has(redaction.id))
      rows.set(redaction.id, scrubInboxMessage(rows.get(redaction.id), redaction.state));
  }
  return { conversationId, details: copy(details), rows };
}
/** No nested transaction or meta write: caller owns the enclosing commit. */
export async function applySharedInbox(tx, meta, ticket, batch) {
  const id = ticket?.conversationId,
    prior = meta.inboxes?.[id];
  if (
    !scopeValid(id) ||
    batch.conversationId !== id ||
    !prior ||
    ticket.generation !== prior.generation
  )
    fail('SHARED_INBOX_SUPERSEDED');
  for (const old of prior.ids || [])
    if (!batch.rows.has(old))
      await tx.putEntity({ entityType: type, entityId: key(id, old), message: null });
  for (const [messageId, message] of batch.rows)
    await tx.putEntity({ entityType: type, entityId: key(id, messageId), message });
  put(meta.inboxes, id, {
    generation: ticket.generation,
    publishedGeneration: ticket.generation,
    details: copy(batch.details),
    ids: [...batch.rows.keys()],
  });
  return { conversationId: id, generation: ticket.generation, count: batch.rows.size };
}
export function createSharedInbox({ storage, metadata, changed, filterBatch }) {
  const scope = (id) => {
    if (!scopeValid(id)) fail('SHARED_INVALID_CONVERSATION');
    return id;
  };
  return {
    async beginInbox(conversationId) {
      scope(conversationId);
      return storage.transaction(async (tx) => {
        const meta = await metadata(tx);
        const ticket = reserveSharedInbox(meta, conversationId);
        await tx.setMeta(meta);
        return ticket;
      });
    },
    async replaceInbox(ticket, { details, messages, redactions = [] }) {
      const id = scope(ticket?.conversationId);
      const batch = prepareSharedInbox(id, { details, messages, redactions });
      const result = await storage.transaction(async (tx) => {
        const meta = await metadata(tx);
        await filterBatch?.(tx, meta, batch);
        const result = await applySharedInbox(tx, meta, ticket, batch);
        await tx.setMeta(meta);
        return result;
      });
      changed();
      return result;
    },
    async readInbox(conversationId) {
      scope(conversationId);
      return storage.transaction(async (tx) => {
        const meta = await metadata(tx),
          inbox = meta.inboxes?.[conversationId];
        if (!inbox?.publishedGeneration) return null;
        const messages = [];
        for (const id of inbox.ids) {
          const row = await tx.getEntity(type, key(conversationId, id));
          if (
            !row?.message ||
            row.message.id !== id ||
            row.message.conversationId !== conversationId
          )
            fail('SHARED_INBOX_CORRUPT');
          messages.push(copy(row.message));
        }
        return {
          conversationId,
          generation: inbox.publishedGeneration,
          details: copy(inbox.details),
          messages,
        };
      });
    },
  };
}
