import { sha256Bytes } from './sync-v2-media.js';
import { createSharedInbox } from './shared-inbox.js';
import { createSharedSeedImporter } from './shared-seed-client.js';
import { assertSharedSeedRemoteTrust } from './shared-seed-trust.js';
import { createSharedMessageEditClient } from './shared-message-edit-client.js';

/** Dedicated storage namespace; transaction callbacks perform storage work only.
 * Reuses the sync-v2 transaction port: meta/entity/pending/conflict methods.
 * The caller supplies optimistic projections; all business rules stay on the server.
 */
const clone = (value) => structuredClone(value);
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const uuid = (value) =>
  typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const key = (value) => JSON.stringify([value.entityType, value.entityId]);
const conversationId = (value) =>
  typeof value === 'string' &&
  /^desktop:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}:-?\d{1,20}$/.test(value);
const entryConversation = (record) => {
  const local = record.local,
    journal = local?.data?.chatJournal;
  if (record.entityType !== 'entry' || local?.state !== 'active' || !journal) return null;
  if (typeof journal.sourceId !== 'string' || typeof journal.roomId !== 'string') return null;
  const id = `desktop:${journal.sourceId}:${journal.roomId}`;
  return conversationId(id) ? id : null;
};
const own = (value, name) => (Object.hasOwn(value, name) ? value[name] : undefined);
const assign = (value, name, data) =>
  Object.defineProperty(value, name, {
    value: data,
    enumerable: true,
    configurable: true,
    writable: true,
  });
function indexEntry(index, record) {
  if (record.entityType !== 'entry') return;
  const old = own(index.byEntry, record.entityId),
    current = entryConversation(record);
  if (old === current) return;
  if (old) {
    const remaining = (own(index.byConversation, old) || []).filter((id) => id !== record.entityId);
    if (remaining.length) assign(index.byConversation, old, remaining);
    else delete index.byConversation[old];
    delete index.byEntry[record.entityId];
  }
  if (current) {
    assign(index.byConversation, current, [
      ...new Set([...(own(index.byConversation, current) || []), record.entityId]),
    ]);
    assign(index.byEntry, record.entityId, current);
  }
}
const fail = (code, status) => {
  throw Object.assign(new Error(code), { code, ...(status ? { status } : {}) });
};
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
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
export const SHARED_BUSINESS_ACTIONS = Object.freeze([
  'wallpaper-read',
  'wallpaper-save',
  'conversation-list',
  'conversation-create',
  'conversation-create-local',
  'conversation-save-local',
  'conversation-state-local',
  'conversation-order-local',
  'conversation-list-state',
  'conversation-order',
  'conversation-read',
  'conversation-save',
  'service-settings-read',
  'service-settings-save',
  'service-request',
  'conversation-feed',
  'conversation-context',
  'conversation-send',
  'conversation-withdraw',
  'journal-send',
  'journal-withdraw',
  'journal-receipts',
  'message-edit-local',
  'message-withdraw-local',
  'message-describe-local',
  'entry-list',
  'entry-read',
  'entry-create',
  'entry-create-local',
  'entry-save-local',
  'entry-save',
  'entry-create-ref',
  'entry-save-ref',
  'entry-delete',
  'entry-restore',
  'taxonomy-save',
  'taxonomy-order',
  'template-create',
  'template-save',
  'comment-create',
  'comment-save',
  'preferences-save',
  'client-preferences-save',
  'sticker-catalog',
  'sticker-from-message',
  'sticker-collect',
  'sticker-update',
]);
const writes = new Set(
  SHARED_BUSINESS_ACTIONS.filter(
    (action) =>
      ![
        'wallpaper-read',
        'conversation-list',
        'conversation-read',
        'service-settings-read',
        'conversation-feed',
        'conversation-context',
        'journal-receipts',
        'message-describe-local',
        'entry-list',
        'entry-read',
        'sticker-catalog',
      ].includes(action),
  ),
);
const wireHash = (wire) => sha256Bytes(new TextEncoder().encode(JSON.stringify(canonical(wire))));
const logicalEntity = ({ changeSeq: _changeSeq, ...value }) => value;
const localPayloadIdentity = (value) =>
  value ? { operationId: value.operationId, sha256: value.sha256, size: value.size } : null;
const receiptKeys = new Set([
  'id',
  'conversationId',
  'entryId',
  'messageId',
  'localMessageId',
  'instanceId',
  'bindingId',
  'providerId',
  'state',
  'revision',
  'bindingRevision',
  'directoryRevision',
  'listStateRevision',
  'created',
  'deleted',
  'pinned',
  'archived',
  'replayed',
  'accepted',
  'operationId',
  'outcome',
  'version',
  'headMessageId',
  'base',
  'headRevision',
  'headSha256',
  'editOperationId',
  'currentHead',
  'terminal',
  'sourceId',
  'roomId',
  'rootMessageId',
]);
const receiptResult = (v) =>
  Array.isArray(v)
    ? v.map(receiptResult)
    : object(v)
      ? Object.fromEntries(
          Object.entries(v)
            .filter(([k]) => receiptKeys.has(k))
            .map(([k, value]) => [
              k,
              object(value) || Array.isArray(value) ? receiptResult(value) : value,
            ]),
        )
      : null;
const retryableRead = (error) =>
  ['SHARED_ENTITY_CHANGED', 'SHARED_CURSOR_CHANGED', 'SHARED_RESNAPSHOT_REQUIRED'].includes(
    error.code || error.message,
  );
const rejectionStatus = (error) =>
  [400, 401, 403, 404, 409, 413, 415, 422].includes(error.status || error.statusCode);
const definiteRejection = (error) =>
  rejectionStatus(error) ||
  /(?:INVALID|TOO_LARGE|ACTION_FORBIDDEN|PAYLOAD_UNSUPPORTED)/i.test(
    error.code || error.message || '',
  );
function inert(value, depth = 0, seen = new Set()) {
  if (depth > 96) fail('SHARED_INVALID_JSON');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    (!Number.isInteger(value) || Number.isSafeInteger(value))
  )
    return value;
  if (
    !value ||
    typeof value !== 'object' ||
    ![Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(value)) ||
    seen.has(value)
  )
    fail('SHARED_INVALID_JSON');
  const keys = Reflect.ownKeys(value).filter((k) => !(Array.isArray(value) && k === 'length'));
  if (
    Array.isArray(value) &&
    (keys.length !== value.length || keys.some((k, i) => k !== String(i)))
  )
    fail('SHARED_INVALID_JSON');
  seen.add(value);
  const result = Array.isArray(value) ? [] : {};
  for (const k of keys) {
    const d = Object.getOwnPropertyDescriptor(value, k);
    if (typeof k !== 'string' || !d.enumerable || !Object.hasOwn(d, 'value'))
      fail('SHARED_INVALID_JSON');
    Object.defineProperty(result, k, {
      value: inert(d.value, depth + 1, seen),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  seen.delete(value);
  return result;
}
function entity(value) {
  if (
    !object(value) ||
    typeof value.entityType !== 'string' ||
    !value.entityType ||
    typeof value.entityId !== 'string' ||
    !value.entityId ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    !Number.isSafeInteger(value.seq) ||
    value.seq < 0 ||
    !['active', 'deleted', 'withdrawn'].includes(value.state) ||
    !object(value.data)
  )
    fail('SHARED_INVALID_ENTITY');
  return value.state === 'withdrawn' ? { ...clone(value), data: {} } : clone(value);
}
function cacheValue(scope, value) {
  if (typeof scope !== 'string' || !scope || scope.length > 512) fail('SHARED_INVALID_CACHE');
  const data = inert(value);
  if (new TextEncoder().encode(JSON.stringify(data)).byteLength > 1024 * 1024)
    fail('SHARED_CACHE_TOO_LARGE');
  return data;
}
function advanceLocalRevision(record) {
  const revision = record.localRevision ?? 0;
  if (!Number.isSafeInteger(revision) || revision < 0 || revision === Number.MAX_SAFE_INTEGER)
    fail('SHARED_LOCAL_REVISION_EXHAUSTED');
  record.localRevision = revision + 1;
}

export function createSharedBusinessClient({
  request,
  storage,
  libraryId,
  epoch,
  pollMs = 30000,
  onChange = () => {},
  preparePayload,
  messageEditClock = {},
} = {}) {
  if (
    typeof request !== 'function' ||
    typeof storage?.transaction !== 'function' ||
    !uuid(libraryId) ||
    !uuid(epoch) ||
    !Number.isSafeInteger(pollMs) ||
    pollMs < 10
  )
    fail('SHARED_INVALID_OPTIONS');
  let running = false,
    timer = null,
    active = null,
    generation = 0;
  let messageEdits;
  const identity = (info) => {
    if (!info || info.libraryId !== libraryId || info.epoch !== epoch)
      fail('SHARED_IDENTITY_MISMATCH');
  };
  async function metadata(tx) {
    const meta = await tx.getMeta();
    if (meta && (meta.sharedBusiness !== 1 || meta.libraryId !== libraryId || meta.epoch !== epoch))
      fail('SHARED_IDENTITY_MISMATCH');
    return (
      meta || {
        sharedBusiness: 1,
        libraryId,
        epoch,
        initialized: false,
        cursor: null,
        paused: null,
        entryConversationIndex: { version: 1, byConversation: {}, byEntry: {} },
      }
    );
  }
  const changed = () => {
    try {
      onChange();
    } catch {
      /* observers never invalidate commit */
    }
  };
  async function conversationIndex(tx, meta) {
    if (!meta.entryConversationIndex) {
      // Upgrade an existing cache once, without changing its cursor/outbox.
      const index = { version: 1, byConversation: {}, byEntry: {} };
      for (const record of await tx.listEntities('entry')) indexEntry(index, record);
      meta.entryConversationIndex = index;
    }
    const index = meta.entryConversationIndex;
    if (index.version !== 1 || !object(index.byConversation) || !object(index.byEntry))
      fail('SHARED_CONVERSATION_INDEX_INVALID');
    return index;
  }
  async function rebuild(tx, record, meta) {
    let local = clone(record.base);
    for (const pending of await tx.listPending())
      for (const effect of pending.optimistic || []) {
        if (key(effect) !== key(record)) continue;
        if (record.base?.state === 'withdrawn') continue;
        local ||= {
          entityType: record.entityType,
          entityId: record.entityId,
          revision: 0,
          seq: 0,
          state: 'active',
          data: {},
        };
        if (['message-edit-local', 'message-withdraw-local'].includes(pending.wire.action)) {
          local = await messageEdits.project(tx, record, local, pending, meta);
          continue;
        }
        local = {
          ...local,
          data: { ...local.data, ...clone(effect.changes || {}) },
          ...(effect.state ? { state: effect.state } : {}),
        };
        if (local.state === 'withdrawn') local.data = {};
      }
    record.local = (await messageEdits?.finalize(tx, record, local)) ?? local;
    if (record.entityType === 'entry') indexEntry(await conversationIndex(tx, meta), record);
    await tx.putEntity(record);
  }
  async function accept(tx, value, meta) {
    const received = entity(value);
    const record = (await tx.getEntity(received.entityType, received.entityId)) || {
      entityType: received.entityType,
      entityId: received.entityId,
      localRevision: 0,
      base: null,
      local: null,
    };
    if (
      record.base &&
      received.revision === record.base.revision &&
      !same(logicalEntity(received), logicalEntity(record.base)) &&
      !(
        record.terminalRedacted &&
        received.sha256 === record.base.sha256 &&
        received.seq === record.base.seq &&
        received.state === record.base.state
      )
    )
      fail('SHARED_REVISION_CONFLICT');
    if (!record.base || received.revision > record.base.revision) {
      if (record.base?.state === 'withdrawn' && received.state !== 'withdrawn')
        fail('SHARED_TOMBSTONE_FINAL');
      // Editor CAS covers the whole visible generation, including authoritative
      // metadata/history/canonical changes. A fresh first baseline remains 0;
      // an existing local or base projection must invalidate every older token.
      if (record.base || record.local) advanceLocalRevision(record);
      const previousBase = record.base;
      record.base = received;
      await tx.putEntity(record);
      await messageEdits?.observe(tx, received, meta, previousBase);
    }
    await rebuild(tx, record, meta);
  }
  async function hydrate(value, gen = generation) {
    if (!value?.payload) return value;
    const p = value.payload;
    if (
      !object(p) ||
      p.version !== 1 ||
      p.kind !== 'shared-entity-json' ||
      !Number.isSafeInteger(p.byteLength) ||
      p.byteLength < 1 ||
      !/^[a-f0-9]{64}$/.test(p.sha256) ||
      !['entityType', 'entityId', 'revision', 'seq'].every((k) => p[k] === value[k]) ||
      Object.hasOwn(value, 'data')
    )
      fail('SHARED_INVALID_ENTITY_PAYLOAD');
    if (p.byteLength > 64 * 1024 * 1024) fail('SHARED_ENTITY_TOO_LARGE');
    const bytes = new Uint8Array(p.byteLength);
    let offset = 0;
    while (offset < bytes.length) {
      const response = await request('entity-read', {
        libraryId,
        epoch,
        entityType: p.entityType,
        entityId: p.entityId,
        revision: p.revision,
        offset,
        length: Math.min(256 * 1024, bytes.length - offset),
      });
      if (gen !== generation) fail('SHARED_CANCELLED');
      identity(response.info);
      if (
        !same(response.payload, p) ||
        response.offset !== offset ||
        typeof response.bytesBase64 !== 'string' ||
        response.bytesBase64.length > 350000 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
          response.bytesBase64,
        )
      )
        fail('SHARED_ENTITY_CHANGED');
      let chunk;
      try {
        chunk = Uint8Array.from(atob(response.bytesBase64), (c) => c.charCodeAt(0));
      } catch {
        fail('SHARED_INVALID_ENTITY_PAYLOAD');
      }
      if (
        !chunk.length ||
        chunk.length > 256 * 1024 ||
        offset + chunk.length > bytes.length ||
        response.next !== offset + chunk.length ||
        response.done !== (response.next === bytes.length) ||
        sha256Bytes(chunk) !== response.chunkSha256
      )
        fail('SHARED_INVALID_ENTITY_PAYLOAD');
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    if (sha256Bytes(bytes) !== p.sha256) fail('SHARED_ENTITY_HASH_MISMATCH');
    let row;
    try {
      row = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      fail('SHARED_INVALID_ENTITY_PAYLOAD');
    }
    if (
      !object(row) ||
      Object.hasOwn(row, 'payload') ||
      !['entityType', 'entityId', 'revision', 'seq', 'state', 'sha256'].every(
        (k) => row[k] === value[k],
      )
    )
      fail('SHARED_INVALID_ENTITY_PAYLOAD');
    entity(row);
    return { ...row, ...(value.changeSeq === undefined ? {} : { changeSeq: value.changeSeq }) };
  }
  async function hydrateFeedItem(value, watermark, gen) {
    if (!value?.payload) return value;
    const p = value.payload;
    if (
      !object(p) ||
      p.version !== 1 ||
      p.kind !== 'shared-feed-item-json' ||
      p.messageId !== value.id ||
      p.conversationId !== value.conversationId ||
      p.watermark !== watermark ||
      !Number.isSafeInteger(p.byteLength) ||
      p.byteLength < 1 ||
      !/^[a-f0-9]{64}$/.test(p.sha256)
    )
      fail('SHARED_INVALID_FEED_PAYLOAD');
    if (p.byteLength > 64 * 1024 * 1024) fail('SHARED_FEED_ITEM_TOO_LARGE');
    const bytes = new Uint8Array(p.byteLength);
    let offset = 0;
    while (offset < bytes.length) {
      const response = await request('feed-item-read', {
        libraryId,
        epoch,
        payload: p,
        offset,
        length: Math.min(256 * 1024, bytes.length - offset),
      });
      if (gen !== generation) fail('SHARED_CANCELLED');
      identity(response.info);
      if (
        !same(response.payload, p) ||
        response.offset !== offset ||
        typeof response.bytesBase64 !== 'string' ||
        response.bytesBase64.length > 350000 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
          response.bytesBase64,
        )
      )
        fail('SHARED_FEED_CHANGED');
      let chunk;
      try {
        chunk = Uint8Array.from(atob(response.bytesBase64), (c) => c.charCodeAt(0));
      } catch {
        fail('SHARED_INVALID_FEED_PAYLOAD');
      }
      if (
        !chunk.length ||
        chunk.length > 256 * 1024 ||
        offset + chunk.length > bytes.length ||
        response.next !== offset + chunk.length ||
        response.done !== (response.next === bytes.length) ||
        sha256Bytes(chunk) !== response.chunkSha256
      )
        fail('SHARED_INVALID_FEED_PAYLOAD');
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    if (sha256Bytes(bytes) !== p.sha256) fail('SHARED_FEED_HASH_MISMATCH');
    let row;
    try {
      row = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      fail('SHARED_INVALID_FEED_PAYLOAD');
    }
    if (
      !object(row) ||
      row.payload ||
      !['id', 'conversationId', 'kind', 'state', 'order'].every((k) => same(row[k], value[k]))
    )
      fail('SHARED_INVALID_FEED_PAYLOAD');
    return row;
  }
  async function pause(error, operationId) {
    if (retryableRead(error)) return false;
    const code = error.code || error.message || 'SHARED_REQUEST_FAILED';
    const status = error.status || error.statusCode;
    const stopped =
      definiteRejection(error) ||
      /(?:IDENTITY|REVISION|CAS|CONFLICT|AUTH|UNAUTHORIZED)/i.test(code);
    if (stopped)
      await storage.transaction(async (tx) => {
        const meta = await metadata(tx);
        if (!operationId && meta.paused?.operationId) return;
        meta.paused = { code, status: status || null, operationId: operationId || null };
        await tx.setMeta(meta);
        if (operationId) {
          const pending = (await tx.listPending()).find((p) => p.operationId === operationId);
          if (pending) {
            pending.blocked = clone(meta.paused);
            await tx.putPending(pending);
            await tx.putConflict({ operationId, ...clone(meta.paused) });
          }
        }
      });
    return stopped;
  }
  async function enqueue(
    {
      operationId,
      action,
      input,
      optimistic = [],
      draftClear,
      expectedLocalRevisions = [],
      localPayload,
      localCacheCommit,
    },
    transactionPort,
  ) {
    if (['message-edit-local', 'message-withdraw-local'].includes(action) && !transactionPort)
      fail('SHARED_MESSAGE_EDIT_ATOMIC_REQUIRED');
    if (!uuid(operationId) || !writes.has(action) || !object(input) || !Array.isArray(optimistic))
      fail('SHARED_INVALID_COMMAND');
    const wire = inert({ operationId, action, input, libraryId, epoch }),
      effects = inert(optimistic),
      guards = inert(expectedLocalRevisions);
    if (
      localPayload !== undefined &&
      (!object(localPayload) ||
        Object.keys(localPayload).some(
          (k) => !['operationId', 'blob', 'sha256', 'size'].includes(k),
        ) ||
        !uuid(localPayload.operationId) ||
        typeof Blob !== 'function' ||
        !(localPayload.blob instanceof Blob) ||
        !Number.isSafeInteger(localPayload.size) ||
        localPayload.size < 1 ||
        localPayload.size > 64 * 1024 * 1024 ||
        localPayload.blob.size !== localPayload.size ||
        !/^[a-f0-9]{64}$/.test(localPayload.sha256) ||
        !['entry-create-ref', 'entry-save-ref'].includes(action) ||
        input.payloadOperationId !== localPayload.operationId)
    )
      fail('SHARED_INVALID_LOCAL_PAYLOAD');
    const payload = localPayload === undefined ? null : clone(localPayload);
    let checkpoint = null;
    if (localCacheCommit !== undefined) {
      if (
        !object(localCacheCommit) ||
        Object.keys(localCacheCommit).some(
          (k) => !['scope', 'expectedValue', 'value'].includes(k),
        ) ||
        !Object.hasOwn(localCacheCommit, 'expectedValue') ||
        !Object.hasOwn(localCacheCommit, 'value')
      )
        fail('SHARED_INVALID_CACHE');
      checkpoint = {
        scope: localCacheCommit.scope,
        expectedValue: cacheValue(localCacheCommit.scope, localCacheCommit.expectedValue),
        value: cacheValue(localCacheCommit.scope, localCacheCommit.value),
      };
    }
    if (!Array.isArray(guards)) fail('SHARED_INVALID_LOCAL_REVISION');
    if (
      effects.some((effect) => !object(effect)) ||
      new Set(effects.map(key)).size !== effects.length
    )
      fail('SHARED_INVALID_OPTIMISTIC');
    if (
      new TextEncoder().encode(JSON.stringify(wire)).byteLength > 4 * 1024 * 1024 ||
      new TextEncoder().encode(JSON.stringify(effects)).byteLength > 64 * 1024 * 1024
    )
      fail('SHARED_COMMAND_TOO_LARGE');
    for (const effect of effects)
      if (
        !object(effect) ||
        Object.keys(effect).some(
          (k) => !['entityType', 'entityId', 'changes', 'state'].includes(k),
        ) ||
        typeof effect.entityType !== 'string' ||
        !effect.entityType ||
        effect.entityType === 'profile' ||
        typeof effect.entityId !== 'string' ||
        !effect.entityId ||
        (effect.changes !== undefined &&
          (!object(effect.changes) ||
            Object.keys(effect.changes).some((k) => ['_product', '_canonical'].includes(k)))) ||
        (effect.state !== undefined && !['active', 'deleted', 'withdrawn'].includes(effect.state))
      )
        fail('SHARED_INVALID_OPTIMISTIC');
    const work = async (tx) => {
      const meta = transactionPort?.meta || (await metadata(tx));
      if (meta.recoveredCommands?.some((r) => r.operationId === operationId))
        fail('SHARED_RECOVERED_OPERATION_REQUIRES_NEW_ID');
      const receipt = meta.commandReceipts?.find((r) => r.operationId === operationId);
      if (receipt) {
        if (
          receipt.wireSha256 !== wireHash(wire) ||
          !same(receipt.localPayload || null, localPayloadIdentity(payload))
        )
          fail('SHARED_OPERATION_REUSED');
        return {
          operationId,
          acknowledged: true,
          replayed: true,
          localCommitRevisions: clone(receipt.localCommitRevisions || []),
        };
      }
      const previous = (await tx.listPending()).find((p) => p.operationId === operationId);
      if (previous) {
        if (
          !same(previous.wire, wire) ||
          !same(previous.optimistic, effects) ||
          !same(localPayloadIdentity(previous.localPayload), localPayloadIdentity(payload))
        )
          fail('SHARED_OPERATION_REUSED');
        return previous;
      }
      if (checkpoint) {
        const priorCache = meta.localCache
          ? (own(meta.localCache, checkpoint.scope) ?? null)
          : null;
        if (!same(priorCache, checkpoint.expectedValue)) fail('SHARED_CACHE_CONFLICT');
        meta.localCache ||= {};
        assign(meta.localCache, checkpoint.scope, checkpoint.value);
      }
      for (const guard of guards) {
        if (
          !object(guard) ||
          typeof guard.entityType !== 'string' ||
          typeof guard.entityId !== 'string' ||
          !Number.isSafeInteger(guard.revision) ||
          guard.revision < 0
        )
          fail('SHARED_INVALID_LOCAL_REVISION');
        const record = await tx.getEntity(guard.entityType, guard.entityId);
        if ((record?.localRevision || 0) !== guard.revision) fail('SHARED_LOCAL_REVISION_CONFLICT');
      }
      const records = [];
      for (const effect of effects) {
        const record = (await tx.getEntity(effect.entityType, effect.entityId)) || {
          entityType: effect.entityType,
          entityId: effect.entityId,
          base: null,
          local: null,
          localRevision: 0,
        };
        if (record.base?.state === 'withdrawn' || record.local?.data?._product?.readOnlyProjection)
          fail('SHARED_READ_ONLY');
        advanceLocalRevision(record);
        records.push(record);
      }
      const pending = {
        operationId,
        wire,
        optimistic: effects,
        sent: false,
        localCommitRevisions: records.map((record) => ({
          entityType: record.entityType,
          entityId: record.entityId,
          revision: record.localRevision,
        })),
      };
      if (payload) pending.localPayload = payload;
      if (draftClear !== undefined) {
        if (
          !object(draftClear) ||
          typeof draftClear.scope !== 'string' ||
          !Number.isSafeInteger(draftClear.expectedRevision)
        )
          fail('SHARED_INVALID_DRAFT');
        const previousDraft = meta.drafts?.[draftClear.scope];
        if (previousDraft?.revision === draftClear.expectedRevision)
          meta.drafts[draftClear.scope] = {
            text: '',
            replyId: null,
            revision: previousDraft.revision + 1,
          };
      }
      await tx.putPending(pending);
      for (const record of records) await rebuild(tx, record, meta);
      await tx.setMeta(meta);
      return pending;
    };
    const result = transactionPort
      ? await work(transactionPort.tx)
      : await storage.transaction(work);
    if (!transactionPort) changed();
    return result;
  }
  async function receive(gen = generation, recovery = { resets: 0 }) {
    const info = await request('info', {});
    identity(info.info || info);
    assertSharedSeedRemoteTrust(
      (await storage.transaction(metadata)).sharedLibraryTrust,
      info.info || info,
    );
    if (gen !== generation) fail('SHARED_CANCELLED');
    let pages = 0;
    while (true) {
      const before = await storage.transaction(metadata);
      const mode = before.initialized ? 'pull' : 'snapshot';
      const position = object(before.cursor)
        ? before.cursor[mode === 'snapshot' ? 'afterKey' : 'after']
        : before.cursor;
      let page;
      try {
        page = await request(mode, {
          libraryId,
          epoch,
          ...(mode === 'snapshot'
            ? position === null || position === undefined
              ? {}
              : { afterKey: position }
            : { after: position ?? 0 }),
          limit: 100,
        });
      } catch (error) {
        if ((error.code || error.message) !== 'SHARED_RESNAPSHOT_REQUIRED' || recovery.resets >= 1)
          throw error;
        await storage.transaction(async (tx) => {
          const meta = await metadata(tx);
          if (meta.initialized !== before.initialized || !same(meta.cursor, before.cursor))
            fail('SHARED_CURSOR_CHANGED');
          meta.initialized = false;
          meta.cursor = null;
          delete meta.snapshotWatermark;
          await tx.setMeta(meta);
        });
        recovery.resets++;
        continue;
      }
      if (gen !== generation) fail('SHARED_CANCELLED');
      identity(page.info);
      const rows = page.entities || page.changes;
      if (
        !Array.isArray(rows) ||
        typeof page.hasMore !== 'boolean' ||
        page.next === undefined ||
        (page.hasMore && same(page.next, before.cursor))
      )
        fail('SHARED_INVALID_PAGE');
      const hydrated = [];
      for (const row of rows) hydrated.push(await hydrate(row, gen));
      await storage.transaction(async (tx) => {
        const meta = await metadata(tx);
        if (meta.initialized !== before.initialized || !same(meta.cursor, before.cursor))
          fail('SHARED_CURSOR_CHANGED');
        for (const row of hydrated) await accept(tx, row, meta);
        meta.cursor = clone(page.next);
        if (
          mode === 'snapshot' &&
          meta.snapshotWatermark === undefined &&
          Number.isSafeInteger(page.watermark) &&
          page.watermark >= 0
        )
          meta.snapshotWatermark = page.watermark;
        if (!page.hasMore) {
          meta.initialized = true;
          if (mode === 'snapshot' && meta.snapshotWatermark !== undefined)
            meta.cursor = { libraryId, epoch, after: meta.snapshotWatermark };
        }
        await tx.setMeta(meta);
      });
      changed();
      if (!page.hasMore && mode === 'pull') return { pages: pages + 1, info: clone(page.info) };
      if (++pages >= 10000) fail('SHARED_PAGE_LIMIT');
    }
  }
  async function flush(gen = generation, recovery = { resets: 0 }) {
    await reconcileTrustedSeeds();
    await verifyRemote();
    let sent = 0;
    while (true) {
      const pending = await storage.transaction(async (tx) => {
        const meta = await metadata(tx);
        if (meta.paused) return null;
        const head = (await tx.listPending())[0];
        if (!head || head.blocked) return null;
        head.sent = true;
        await tx.putPending(head);
        return head;
      });
      if (!pending) return { sent };
      let commandStarted = false,
        commandAcknowledged = false;
      try {
        if (
          [
            'entry-create-local',
            'entry-save-local',
            'conversation-create-local',
            'conversation-save-local',
            'conversation-state-local',
            'conversation-order-local',
          ].includes(pending.wire.action)
        ) {
          const response = await request('info', {});
          const info = response.info || response;
          identity(info);
          const kind = pending.wire.action.startsWith('entry-') ? 'entry' : 'conversation';
          if (
            info.capabilities?.localFirstCreate?.version !== 1 ||
            info.capabilities.localFirstCreate[kind] !== true
          )
            fail('SHARED_LOCAL_CREATE_UNSUPPORTED', 409);
        }
        if (pending.localPayload) {
          if (typeof preparePayload !== 'function') fail('SHARED_PAYLOAD_PREPARER_REQUIRED');
          await preparePayload(clone(pending.localPayload));
          if (gen !== generation) fail('SHARED_CANCELLED');
        }
        if (['message-edit-local', 'message-withdraw-local'].includes(pending.wire.action)) {
          const response = await request('info', {}),
            info = response.info || response;
          identity(info);
          if (
            info.capabilities?.messageEdits?.version !== 1 ||
            info.capabilities.messageEdits.writeEnabled === false
          )
            fail('SHARED_MESSAGE_EDITS_UNSUPPORTED', 409);
        }
        commandStarted = true;
        const response = await request('command', clone(pending.wire));
        if (gen !== generation) fail('SHARED_CANCELLED');
        identity(response.info);
        if (
          response.operationId !== pending.operationId ||
          response.accepted === false ||
          ['conflict', 'rejected'].includes(response.status)
        )
          fail('SHARED_COMMAND_CONFLICT', 409);
        commandAcknowledged = true;
        // ACK contains IDs/status only. Pull authoritative rows while the pending
        // projection remains visible, then remove only this immutable command.
        await receive(gen, recovery);
        const acknowledgedEntities = [];
        for (const row of response.entities || [])
          acknowledgedEntities.push(await hydrate(row, gen));
        await storage.transaction(async (tx) => {
          const meta = await metadata(tx);
          const actual = (await tx.listPending()).find(
            (p) => p.operationId === pending.operationId,
          );
          if (
            !actual &&
            meta.commandReceipts?.some(
              (r) => r.operationId === pending.operationId && r.terminalRejected,
            )
          )
            return;
          if (!actual || !same(actual.wire, pending.wire)) fail('SHARED_OPERATION_CHANGED');
          await tx.deletePending(actual.operationId);
          (meta.commandReceipts ||= []).push({
            operationId: actual.operationId,
            wireSha256: wireHash(actual.wire),
            result: receiptResult(response.result),
            localCommitRevisions: clone(actual.localCommitRevisions || []),
            ...(actual.localPayload
              ? { localPayload: localPayloadIdentity(actual.localPayload) }
              : {}),
          });
          for (const row of acknowledgedEntities) await accept(tx, row, meta);
          for (const effect of actual.optimistic || []) {
            const record = await tx.getEntity(effect.entityType, effect.entityId);
            if (record) await rebuild(tx, record, meta);
          }
          await tx.setMeta(meta);
        });
        sent++;
        changed();
      } catch (error) {
        if (commandAcknowledged || (commandStarted && !definiteRejection(error)))
          await storage.transaction(async (tx) => {
            const actual = (await tx.listPending()).find(
              (p) => p.operationId === pending.operationId,
            );
            if (actual) {
              if (commandAcknowledged) actual.serverAcknowledged = true;
              else actual.outcomeUnknown = true;
              await tx.putPending(actual);
            }
          });
        await pause(error, pending.operationId);
        throw error;
      }
    }
  }
  async function run() {
    const gen = generation;
    const meta = await storage.transaction(metadata);
    if (meta.paused) return { paused: clone(meta.paused) };
    try {
      await reconcileTrustedSeeds();
      const recovery = { resets: 0 };
      const received = await receive(gen, recovery);
      const sent = await flush(gen, recovery);
      return { received, ...sent };
    } catch (error) {
      if (error.code !== 'SHARED_CANCELLED') await pause(error);
      throw error;
    }
  }
  async function reconcileBlocked({ operationId, mode } = {}) {
    if (!uuid(operationId) || !['retry-unchanged', 'discard'].includes(mode))
      fail('SHARED_INVALID_RECONCILIATION');
    const result = await storage.transaction(async (tx) => {
      const meta = await metadata(tx),
        head = (await tx.listPending())[0];
      if (
        !head ||
        head.operationId !== operationId ||
        !head.blocked ||
        head.outcomeUnknown ||
        head.serverAcknowledged
      )
        fail('SHARED_COMMAND_NOT_RECONCILABLE');
      const blocked = head.blocked;
      if (
        !definiteRejection(blocked) ||
        (mode === 'retry-unchanged' &&
          !['SHARED_LOCAL_CREATE_UNSUPPORTED', 'SHARED_MESSAGE_EDITS_UNSUPPORTED'].includes(
            blocked.code,
          ) &&
          (blocked.status === 409 || /CAS|CONFLICT|REVISION/i.test(blocked.code)))
      )
        fail('SHARED_COMMAND_REQUIRES_NEW_OPERATION');
      if (mode === 'discard') {
        (meta.recoveredCommands ||= []).push({ ...clone(head), recoveredReason: clone(blocked) });
        await tx.deletePending(operationId);
        for (const effect of head.optimistic || []) {
          const record = await tx.getEntity(effect.entityType, effect.entityId);
          if (record) await rebuild(tx, record, meta);
        }
      } else {
        delete head.blocked;
        await tx.putPending(head);
      }
      if (meta.paused?.operationId === operationId) meta.paused = null;
      await tx.setMeta(meta);
      return { operationId, status: mode === 'discard' ? 'recovered' : 'pending' };
    });
    changed();
    return result;
  }
  function sync() {
    if (active) return active;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    active = run().finally(() => {
      active = null;
      if (running) {
        timer = setTimeout(() => {
          timer = null;
          void sync().catch(() => {});
        }, pollMs);
        timer.unref?.();
      }
    });
    return active;
  }
  async function verifyRemote() {
    const pin = (await storage.transaction(metadata)).sharedLibraryTrust;
    if (!pin) return;
    const info = await request('info', {});
    identity(info.info || info);
    assertSharedSeedRemoteTrust(pin, info.info || info);
  }
  async function reconcileTrustedSeeds() {
    const pending = (await storage.transaction(metadata)).sharedSeedPendingSync || [];
    for (const packageId of pending) await seedImporter.resolveSeed(packageId);
  }
  const seedImporter = createSharedSeedImporter({
    storage,
    metadata,
    accept,
    changed,
    request,
    identity,
    libraryId,
    epoch,
    receive,
    hydrate,
    hydrateFeed: (row, watermark) => hydrateFeedItem(row, watermark, generation),
    verifyRemote,
    sanitizeStaging: (tx, meta) => messageEdits.sanitizeStaging(tx, meta),
    filterBatch: (tx, meta, batch) => messageEdits.filterInbox(tx, meta, batch),
  });
  messageEdits = createSharedMessageEditClient({
    now: messageEditClock.now,
    newId: messageEditClock.newId,
    storage,
    metadata,
    enqueue,
    rebuild,
    changed,
    wireHash,
    advanceLocalRevision,
    entries: async (tx, meta, conversationId) => {
      const index = await conversationIndex(tx, meta),
        records = [];
      for (const id of own(index.byConversation, conversationId) || []) {
        const record = await tx.getEntity('entry', id);
        if (record) records.push(record);
      }
      return records;
    },
  });
  return {
    ...createSharedInbox({ storage, metadata, changed, filterBatch: messageEdits.filterInbox }),
    ...seedImporter,
    editMessage: messageEdits.editMessage,
    withdrawMessage: messageEdits.withdrawMessage,
    messageEditHistory: messageEdits.messageEditHistory,
    enqueue,
    receive,
    flush,
    sync,
    reconcileBlocked,
    retryBlocked: reconcileBlocked,
    listDiaryPage: (options) => {
      if (typeof storage.readDiaryPage !== 'function') fail('SHARED_DIARY_PORT_UNAVAILABLE');
      return storage.readDiaryPage({ ...options, libraryId, epoch });
    },
    readDiarySummary: (kind, options) => {
      if (typeof storage.readDiarySummary !== 'function') fail('SHARED_DIARY_PORT_UNAVAILABLE');
      return storage.readDiarySummary({ ...options, kind, libraryId, epoch });
    },
    readDiarySuggestedTitle: (options) => {
      if (typeof storage.readDiarySuggestedTitle !== 'function')
        fail('SHARED_DIARY_PORT_UNAVAILABLE');
      return storage.readDiarySuggestedTitle({ ...options, libraryId, epoch });
    },
    readDiarySidecar: (entryId, kind, includeDiscarded = false) => {
      if (typeof storage.readDiarySidecar !== 'function') fail('SHARED_DIARY_PORT_UNAVAILABLE');
      return storage.readDiarySidecar({ libraryId, epoch, entryId, kind, includeDiscarded });
    },
    writeDiarySidecar: (input) => {
      if (typeof storage.writeDiarySidecar !== 'function') fail('SHARED_DIARY_PORT_UNAVAILABLE');
      return storage.writeDiarySidecar({ ...input, libraryId, epoch });
    },
    readOperation(operationId) {
      return storage.transaction(async (tx) => {
        const meta = await metadata(tx),
          pending = (await tx.listPending()).find((p) => p.operationId === operationId);
        if (pending)
          return {
            operationId,
            status: pending.blocked ? 'blocked' : 'pending',
            sent: pending.sent,
            blocked: clone(pending.blocked),
          };
        const receipt = meta.commandReceipts?.find((r) => r.operationId === operationId);
        if (meta.recoveredCommands?.some((r) => r.operationId === operationId))
          return { operationId, status: 'recovered' };
        if (receipt?.terminalRejected)
          return {
            operationId,
            status: 'terminal',
            terminalRejected: true,
            serverConfirmed: receipt.serverConfirmed === true,
            result: clone(receipt.result),
          };
        return receipt
          ? { operationId, status: 'acknowledged', result: clone(receipt.result) }
          : null;
      });
    },
    localHeadOperation(entityType, entityId, actions) {
      return storage.transaction(async (tx) => {
        await metadata(tx);
        const pending = [...(await tx.listPending())]
          .reverse()
          .find(
            (pending) =>
              (!actions || actions.includes(pending.wire.action)) &&
              pending.optimistic?.some(
                (effect) => effect.entityType === entityType && effect.entityId === entityId,
              ),
          );
        return pending ? { operationId: pending.operationId, action: pending.wire.action } : null;
      });
    },
    localDirectoryHeadOperation() {
      return storage.transaction(async (tx) => {
        await metadata(tx);
        const pending = [...(await tx.listPending())]
          .reverse()
          .find((row) =>
            [
              'conversation-create-local',
              'conversation-list-state',
              'conversation-state-local',
              'conversation-order',
              'conversation-order-local',
            ].includes(row.wire.action),
          );
        return pending ? { operationId: pending.operationId, action: pending.wire.action } : null;
      });
    },
    reserveLocalConversationId(sourceId) {
      return storage.transaction(async (tx) => {
        const meta = await metadata(tx);
        if (sourceId !== undefined && (!uuid(sourceId) || sourceId !== sourceId.toLowerCase()))
          fail('SHARED_INVALID_SOURCE_ID');
        const identity = meta.localConversationIdentity || {
          sourceId: sourceId || crypto.randomUUID(),
          nextRoomId: '-1',
        };
        if (sourceId && identity.sourceId !== sourceId) fail('SHARED_SOURCE_ID_MISMATCH');
        const existing = new Set(
          (await tx.listEntities('conversation')).map((row) => row.entityId),
        );
        let number = BigInt(identity.nextRoomId);
        while (existing.has(`desktop:${identity.sourceId}:${number}`) || number === -900000001n)
          number--;
        if (String(-number).length > 20) fail('SHARED_ROOM_ID_EXHAUSTED');
        const conversationId = `desktop:${identity.sourceId}:${number}`;
        identity.nextRoomId = String(number - 1n);
        meta.localConversationIdentity = identity;
        await tx.setMeta(meta);
        return conversationId;
      });
    },
    readCache(scope) {
      return storage.transaction(async (tx) =>
        clone(own((await metadata(tx)).localCache || {}, scope) ?? null),
      );
    },
    writeCache(scope, value, expectedValue) {
      const data = cacheValue(scope, value);
      const expected = expectedValue === undefined ? undefined : cacheValue(scope, expectedValue);
      return storage.transaction(async (tx) => {
        const meta = await metadata(tx);
        if (expected !== undefined && !same(own(meta.localCache || {}, scope) ?? null, expected))
          fail('SHARED_CACHE_CONFLICT');
        meta.localCache ||= {};
        Object.defineProperty(meta.localCache, scope, {
          value: data,
          enumerable: true,
          writable: true,
          configurable: true,
        });
        await tx.setMeta(meta);
      });
    },
    readDraft(scope) {
      if (typeof scope !== 'string' || !scope || scope.length > 512) fail('SHARED_INVALID_DRAFT');
      return storage.transaction(async (tx) =>
        clone((await metadata(tx)).drafts?.[scope] || { text: '', replyId: null, revision: 0 }),
      );
    },
    setDraft(scope, draft, expectedRevision) {
      if (
        typeof scope !== 'string' ||
        !scope ||
        scope.length > 512 ||
        !object(draft) ||
        typeof draft.text !== 'string' ||
        draft.text.length > 500000 ||
        (draft.replyId !== null && draft.replyId !== undefined && typeof draft.replyId !== 'string')
      )
        fail('SHARED_INVALID_DRAFT');
      return storage.transaction(async (tx) => {
        const meta = await metadata(tx),
          prior = meta.drafts?.[scope] || { revision: 0 };
        if (expectedRevision !== undefined && expectedRevision !== prior.revision)
          fail('SHARED_DRAFT_CONFLICT');
        if (prior.revision === Number.MAX_SAFE_INTEGER) fail('SHARED_DRAFT_REVISION_EXHAUSTED');
        const next = {
          text: draft.text,
          replyId: draft.replyId ?? null,
          revision: prior.revision + 1,
        };
        meta.drafts ||= {};
        Object.defineProperty(meta.drafts, scope, {
          value: next,
          enumerable: true,
          writable: true,
          configurable: true,
        });
        await tx.setMeta(meta);
        return clone(next);
      });
    },
    async query({ operationId, action, input = {} }) {
      const gen = generation;
      if (
        !uuid(operationId) ||
        !SHARED_BUSINESS_ACTIONS.includes(action) ||
        writes.has(action) ||
        !object(input)
      )
        fail('SHARED_INVALID_QUERY');
      await storage.transaction(metadata);
      await verifyRemote();
      const response = await request(
        'command',
        inert({ operationId, action, input, libraryId, epoch }),
      );
      identity(response.info);
      if (response.operationId !== operationId) fail('SHARED_INVALID_ACK');
      if (action === 'conversation-feed' && Array.isArray(response.result?.messages)) {
        const messages = [];
        for (const row of response.result.messages)
          messages.push(await hydrateFeedItem(row, response.result.watermark, gen));
        response.result.messages = messages;
      }
      return clone(response);
    },
    read: (entityType, entityId) =>
      storage.transaction(async (tx) => {
        await metadata(tx);
        return tx.getEntity(entityType, entityId);
      }),
    list: (entityType) =>
      storage.transaction(async (tx) => {
        await metadata(tx);
        return tx.listEntities(entityType);
      }),
    listConversationEntries: (id) => {
      if (!conversationId(id)) fail('SHARED_INVALID_CONVERSATION');
      return storage.transaction(async (tx) => {
        const meta = await metadata(tx),
          needsUpgrade = !meta.entryConversationIndex;
        const index = await conversationIndex(tx, meta);
        const ids = own(index.byConversation, id) || [];
        if (!Array.isArray(ids) || ids.some((value) => typeof value !== 'string'))
          fail('SHARED_CONVERSATION_INDEX_INVALID');
        const records = [];
        for (const entryId of new Set(ids)) {
          const record = await tx.getEntity('entry', entryId);
          if (record && entryConversation(record) === id) records.push(record);
        }
        if (needsUpgrade) await tx.setMeta(meta);
        return records;
      });
    },
    status: () =>
      storage.transaction(async (tx) => ({
        ...(await metadata(tx)),
        pending: (await tx.listPending()).length,
        conflicts: await tx.listConflicts(),
      })),
    async resume() {
      await storage.transaction(async (tx) => {
        const meta = await metadata(tx);
        for (const pending of await tx.listPending()) {
          if (!pending.blocked) continue;
          if (
            ![401, 403].includes(pending.blocked.status) &&
            !/AUTH|UNAUTHORIZED/i.test(pending.blocked.code)
          )
            fail('SHARED_BLOCKED_COMMAND_REQUIRES_RECONCILIATION');
          delete pending.blocked;
          await tx.putPending(pending);
        }
        meta.paused = null;
        await tx.setMeta(meta);
      });
    },
    start() {
      if (running) return active || Promise.resolve();
      running = true;
      return sync();
    },
    stop() {
      running = false;
      generation++;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
