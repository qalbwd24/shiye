import { sha256Bytes } from './sync-v2-media.js';
import { prepareDiaryUnits, reassembleDiaryUnits, validateMessageUnit } from './message-units.js';
import { renderRichDocument } from './rich-document-renderer.js';

export const PRODUCT_SYNC_SCHEMA = 1;
export const PRODUCT_ENTITY_TYPES = Object.freeze({
  entry: 'journalAggregate',
  message: 'chatMessage',
  conversation: 'conversation',
  taxonomy: 'taxonomy',
  order: 'order',
  appearance: 'appearance',
  profile: 'profile',
  sticker: 'sticker',
  commandMapping: 'commandMapping',
  media: 'relation',
  serviceConfig: 'serviceConfig',
  binding: 'binding',
  comment: 'comment',
  serverState: 'relation',
  delivery: 'relation',
});
const object = (v) => v && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => structuredClone(v);
const validId = (v) => typeof v === 'string' && /^[A-Za-z0-9_:@.-]{1,160}$/.test(v);
const reject = (code) => {
  const status = code.includes('TOO_LARGE')
    ? 413
    : code.includes('HASH_MISMATCH')
      ? 422
      : code.includes('CANONICAL_')
        ? 409
        : 400;
  throw Object.assign(new Error(code), { code, status });
};
const hash = (v) => sha256Bytes(new TextEncoder().encode(JSON.stringify(v)));
const canonical = (v) =>
  Array.isArray(v)
    ? v.map(canonical)
    : object(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical(v[k])]),
        )
      : v;
export const productMessageId = (sourceId, roomId, messageId) => {
  if (!validId(sourceId) || typeof roomId !== 'string' || typeof messageId !== 'string')
    reject('MESSAGE_ID_MUST_BE_STRING');
  return `chat:${hash([sourceId, roomId, messageId])}`;
};
export const productConversationId = (sourceId, roomId) => {
  if (!validId(sourceId) || typeof roomId !== 'string') reject('CONVERSATION_ID_MUST_BE_STRING');
  return `room:${hash([sourceId, roomId])}`;
};
export const legacyTaxonomyId = (sourceId, kind, originalName) =>
  `taxonomy:${hash([sourceId, kind, originalName])}`;

/** Preserve the complete business value. _product is a reserved transport annotation. */
export function productRecord(kind, entityId, value, refs = {}) {
  if (!PRODUCT_ENTITY_TYPES[kind] || !validId(entityId) || !object(value))
    reject('INVALID_PRODUCT_RECORD');
  if (Object.hasOwn(value, '_product') || Object.hasOwn(value, '_canonical'))
    reject('RESERVED_PRODUCT_ANNOTATION');
  const data = { ...clone(value), _product: { schema: 1, kind, refs: clone(refs) } };
  validateProductRecord(PRODUCT_ENTITY_TYPES[kind], entityId, data);
  return { entityType: PRODUCT_ENTITY_TYPES[kind], entityId, data };
}

export function validateProductRecord(entityType, entityId, data) {
  const meta = data?._product;
  if (
    !validId(entityId) ||
    !object(data) ||
    !object(meta) ||
    meta.schema !== 1 ||
    PRODUCT_ENTITY_TYPES[meta.kind] !== entityType ||
    !object(meta.refs)
  )
    reject('INVALID_PRODUCT_RECORD');
  if (meta.payload) {
    if (
      !validId(meta.payload.assetId) ||
      !/^[a-f0-9]{64}$/.test(meta.payload.sha256 || '') ||
      !Number.isSafeInteger(meta.payload.size) ||
      meta.payload.size < 1
    )
      reject('INVALID_PRODUCT_PAYLOAD');
    return true;
  }
  if (meta.kind === 'entry' && (!validId(data.id) || data.id !== entityId))
    reject('ENTRY_ID_MISMATCH');
  if (meta.kind === 'entry' && data._canonical && data.messageUnits?.authority !== 'messageStore')
    reject('CANONICAL_UNITS_REQUIRED');
  if (meta.kind === 'entry' && data.messageUnits?.authority === 'messageStore') {
    const canonical = data._canonical;
    if (!canonical || !Array.isArray(canonical.units) || !canonical.layout)
      reject('CANONICAL_UNITS_REQUIRED');
    for (const unit of canonical.units) {
      validateMessageUnit(unit);
      if (unit.origin?.entryId !== entityId || unit.origin.kind !== 'diary')
        reject('CANONICAL_ORIGIN_MISMATCH');
    }
    // A trashed Entry still retains recoverable message bodies. Only body-free
    // retired/withdrawn identities are excluded from its compatibility projection.
    const active = canonical.units.filter((u) => u.body !== null);
    if (
      JSON.stringify(canonicalJSON(reassembleDiaryUnits(active, canonical.layout.layout))) !==
      JSON.stringify(canonicalJSON(data.body))
    )
      reject('CANONICAL_BODY_MISMATCH');
    if (typeof data.content === 'string' && renderRichDocument(data.body) !== data.content)
      reject('CANONICAL_HTML_MISMATCH');
  }
  if (meta.kind === 'message') {
    const o = meta.refs.origin;
    if (
      !object(o) ||
      typeof data.id !== 'string' ||
      !Number.isFinite(Date.parse(data.sentAt || data.eventTime)) ||
      productMessageId(o.sourceId, o.roomId, data.id) !== entityId
    )
      reject('MESSAGE_IDENTITY_MISMATCH');
    if (data.replyTo !== undefined && typeof data.replyTo !== 'string')
      reject('REPLY_ID_MUST_BE_STRING');
  }
  if (meta.kind === 'conversation') {
    const o = meta.refs.origin;
    if (!object(o) || productConversationId(o.sourceId, o.roomId) !== entityId)
      reject('CONVERSATION_IDENTITY_MISMATCH');
  }
  if (
    meta.kind === 'taxonomy' &&
    (!['category', 'tag'].includes(data.kind) ||
      typeof data.name !== 'string' ||
      !data.name.trim() ||
      data.id !== entityId)
  )
    reject('INVALID_TAXONOMY_RECORD');
  if (
    meta.kind === 'order' &&
    (!Array.isArray(data.ids) ||
      data.ids.some((id) => !validId(id)) ||
      new Set(data.ids).size !== data.ids.length)
  )
    reject('INVALID_PRODUCT_ORDER');
  const refs = meta.refs;
  if (
    meta.kind === 'sticker' &&
    data.tags !== undefined &&
    (!Array.isArray(data.tags) ||
      data.tags.length > 50 ||
      data.tags.some((v) => typeof v !== 'string' || !v.trim() || v.length > 100) ||
      new Set(data.tags).size !== data.tags.length)
  )
    reject('INVALID_STICKER_TAGS');
  for (const key of ['assets', 'tags'])
    if (
      refs[key] !== undefined &&
      (!Array.isArray(refs[key]) || refs[key].some((id) => !validId(id)))
    )
      reject('INVALID_PRODUCT_REFERENCES');
  return true;
}
const canonicalJSON = canonical;

export function productValue(record, { taxonomy } = {}) {
  if (!record || record.state === 'withdrawn' || record.state === 'deleted') return null;
  const data = clone(record.data);
  validateProductRecord(record.entityType, record.entityId, data);
  if (data._product.payload) reject('PRODUCT_PAYLOAD_NOT_HYDRATED');
  const refs = data._product.refs;
  delete data._product;
  delete data._canonical;
  if (taxonomy) {
    if (refs.category && taxonomy.get(refs.category))
      data.category = taxonomy.get(refs.category).name;
    if (refs.tags) data.tags = refs.tags.map((id) => taxonomy.get(id)?.name).filter(Boolean);
  }
  return data;
}

/** Large values use the existing original-byte transfer, never truncation or new IDs. */
export function prepareProductPayload(record, { inlineBytes = 786432 } = {}) {
  validateProductRecord(record.entityType, record.entityId, record.data);
  const bytes = new TextEncoder().encode(JSON.stringify(record.data));
  if (['message', 'comment'].includes(record.data._product.kind)) {
    if (bytes.length > 950000) reject('PRODUCT_MESSAGE_TOO_LARGE');
    return { record: clone(record), payload: null };
  }
  if (bytes.byteLength <= inlineBytes) return { record: clone(record), payload: null };
  const sha256 = sha256Bytes(bytes),
    assetId = `payload-${sha256}`;
  const data = {
    _product: {
      ...clone(record.data._product),
      payload: { assetId, sha256, size: bytes.byteLength },
    },
  };
  return {
    record: { ...clone(record), data },
    payload: {
      assetId,
      sha256,
      size: bytes.byteLength,
      mime: 'application/vnd.shiye.product+json',
      name: 'product-record.json',
      bytes,
    },
  };
}
export function hydrateProductPayload(record, bytes, { maxBytes = 67108864 } = {}) {
  const ref = record.data?._product?.payload;
  if (!ref) return clone(record);
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.length > maxBytes ||
    bytes.length !== ref.size ||
    sha256Bytes(bytes) !== ref.sha256
  )
    reject('PRODUCT_PAYLOAD_HASH_MISMATCH');
  let data;
  try {
    data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    reject('PRODUCT_PAYLOAD_INVALID_JSON');
  }
  validateProductRecord(record.entityType, record.entityId, data);
  if (
    data._product.payload ||
    data._product.kind !== record.data._product.kind ||
    JSON.stringify(data._product.refs) !== JSON.stringify(record.data._product.refs)
  )
    reject('PRODUCT_PAYLOAD_IDENTITY_MISMATCH');
  return { ...clone(record), data };
}

/** Render from the local committed repository. No remote request or write is performed. */
export function productLibraryView(records) {
  const active = records.filter((r) => (!r.state || r.state === 'active') && r.data?._product);
  const taxonomy = new Map(
    active
      .filter((r) => r.data._product.kind === 'taxonomy')
      .map((r) => [r.entityId, productValue(r)]),
  );
  const ordered = (kind) => {
    const order =
      active.find((r) => r.data._product.kind === 'order' && r.data.kind === kind)?.data.ids || [];
    return [...new Set([...order, ...taxonomy.keys()])]
      .map((id) => taxonomy.get(id))
      .filter((v) => v?.kind === kind);
  };
  const byKind = (kind) =>
    active.filter((r) => r.data._product.kind === kind).map((r) => productValue(r, { taxonomy }));
  const entries = byKind('entry');
  const messages = active
    .filter((r) => r.data._product.kind === 'message')
    .map((r) => ({
      ...productValue(r, { taxonomy }),
      entityId: r.entityId,
      origin: clone(r.data._product.refs.origin),
      entryId: r.data._product.refs.entry || null,
      conversationId: r.data._product.refs.conversation || null,
    }));
  const messageStore = { version: 1, units: [], layouts: {} };
  for (const record of active)
    if (record.data._product.kind === 'entry' && record.data._canonical) {
      messageStore.units.push(...clone(record.data._canonical.units));
      messageStore.layouts[record.entityId] = clone(record.data._canonical.layout);
    }
  return {
    schema: 1,
    categories: ordered('category').map((v) => v.name),
    tags: ordered('tag').map((v) => v.name),
    messageStore,
    entries,
    messages,
    conversations: byKind('conversation'),
    media: byKind('media'),
    stickers: byKind('sticker'),
    appearances: byKind('appearance'),
    profiles: byKind('profile'),
    commandMappings: byKind('commandMapping'),
    serviceConfigs: byKind('serviceConfig'),
    bindings: byKind('binding'),
    comments: byKind('comment'),
  };
}

/** Run before the local transaction; persist this envelope and its intent together. */
export function prepareProductEntry(
  entry,
  { refs = {}, previousRecord, media = [], timeZone = 'Asia/Shanghai', createId } = {},
) {
  const value = clone(entry);
  if (value.chatJournal) reject('CHAT_PROJECTION_READ_ONLY');
  if (value.contentFormat !== 'richdoc') return productRecord('entry', value.id, value, refs);
  value.content = renderRichDocument(value.body);
  const previousUnits = previousRecord?.data?._canonical?.units || [];
  const prepared = prepareDiaryUnits(value, {
    previousUnits,
    media,
    timeZone,
    ...(createId ? { createId } : {}),
  });
  value.messageUnits = {
    version: 1,
    ids: prepared.units.map((u) => u.id),
    authority: 'messageStore',
  };
  const currentIds = new Set(value.messageUnits.ids);
  const retired = previousUnits
    .filter((u) => !currentIds.has(u.id))
    .map((u) =>
      u.body === null
        ? clone(u)
        : { ...clone(u), body: null, state: 'deleted', revision: (u.revision || 0) + 1 },
    );
  const data = {
    ...value,
    _product: { schema: 1, kind: 'entry', refs: clone(refs) },
    _canonical: {
      units: [...prepared.units, ...retired],
      layout: {
        layout: prepared.layout,
        mappings: prepared.mappings || [],
        issues: prepared.issues,
        revision: value.revision || 1,
      },
    },
  };
  validateProductRecord('journalAggregate', value.id, data);
  return { entityType: 'journalAggregate', entityId: value.id, data };
}
