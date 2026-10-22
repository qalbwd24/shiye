import { createHash } from 'node:crypto';
import { compareEditStamps } from '../../../public/shared/shared-edit-clock.js';
import { sharedMessageEditHeadSha256 } from '../../../public/shared/shared-message-edit-protocol.js';
import { fail } from '../http.mjs';
import {
  appendChatMessages,
  chatMessageReceipt,
  validateChatMessages,
  withdrawChatMessage,
} from './chat-journal.mjs';
import { chatUnitId } from './message-store.mjs';

const uuid = (v) =>
  typeof v === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v);
const decimal = (v) => typeof v === 'string' && /^\d{1,20}$/.test(v);
const canonical = (v) =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical(v[k])]),
        )
      : v;
const sha = (v) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(v)))
    .digest('hex');
const conflict = (code) => Object.assign(fail(409, code), { code });
const bad = () => fail(400, 'LOCAL_MESSAGE_EDIT_INVALID');
const keys = (value, allowed) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).every((key) => allowed.includes(key));
const self = (actor) => !actor || (actor.kind === 'self' && actor.id === 'self');
const identity = (input) => ({
  sourceId: input.sourceId,
  roomId: input.roomId,
  rootMessageId: input.rootMessageId,
});
const rootKey = (input) => sha(identity(input));
const sameBase = (a, b) =>
  a &&
  b &&
  ['headMessageId', 'headRevision', 'headSha256', 'editOperationId'].every(
    (key) => a[key] === b[key],
  );
const baseOf = (head) => ({
  headMessageId: head.headMessageId,
  headRevision: head.headRevision,
  headSha256: head.headSha256,
  editOperationId: head.editOperationId,
});

function authorize(input, context, write = false) {
  if (
    !input ||
    !uuid(input.sourceId) ||
    typeof input.roomId !== 'string' ||
    !/^-?\d{1,20}$/.test(input.roomId) ||
    !decimal(input.rootMessageId)
  )
    throw bad();
  // This is an owner seam, never an authorization mechanism based on a wire device label.
  if (
    context?.sourceId !== input.sourceId ||
    context?.roomId !== input.roomId ||
    context?.actor?.kind !== 'self' ||
    context?.actor?.id !== 'self'
  )
    throw Object.assign(fail(403, 'LOCAL_MESSAGE_EDIT_SCOPE'), {
      code: 'LOCAL_MESSAGE_EDIT_SCOPE',
    });
  if (
    write &&
    (!uuid(input.operationId) ||
      context.operationId !== input.operationId ||
      typeof context.deviceId !== 'string' ||
      !context.deviceId ||
      context.deviceId.length > 256)
  )
    throw bad();
}

function readChain(db, input, context) {
  const room = db.chatJournal?.rooms?.find(
    (r) => r.sourceId === input.sourceId && r.id === input.roomId,
  );
  if (!room) throw conflict('LOCAL_MESSAGE_EDIT_ROOM_UNKNOWN');
  if (room.messageOwner === 'conversation-services-v1' && context.conversationWriter !== true)
    throw conflict('LOCAL_MESSAGE_EDIT_OWNER');
  const all = (db.entries || [])
    .filter(
      (entry) =>
        entry.chatJournal?.sourceId === input.sourceId && entry.chatJournal.roomId === input.roomId,
    )
    .flatMap((entry) => entry.chatJournal.messages.map((message) => ({ entry, message })));
  if (new Set(all.map(({ message }) => message.id)).size !== all.length)
    throw conflict('LOCAL_MESSAGE_EDIT_CHAIN_UNKNOWN');
  const roots = all.filter(({ message }) => message.id === input.rootMessageId);
  if (roots.length !== 1 || roots[0].message.replacementOf)
    throw conflict('LOCAL_MESSAGE_EDIT_ROOT_UNKNOWN');
  const root = roots[0],
    seen = new Set();
  let head = root;
  while (true) {
    const { entry, message } = head;
    const unit = db.messageStore?.units?.find(
      (item) => item.id === chatUnitId(input.sourceId, input.roomId, message.id),
    );
    if (
      seen.has(message.id) ||
      entry !== root.entry ||
      !self(message.actor) ||
      (unit &&
        (!self(unit.actor) ||
          unit.origin?.kind !== 'chat' ||
          unit.origin.entryId !== entry.id ||
          unit.origin.sourceId !== input.sourceId ||
          unit.origin.roomId !== input.roomId ||
          unit.origin.messageId !== message.id ||
          unit.compatibilityHash !==
            createHash('sha256').update(JSON.stringify(message)).digest('hex'))) ||
      message.sentAt !== root.message.sentAt ||
      (message.replacementRootId && message.replacementRootId !== input.rootMessageId)
    )
      throw conflict('LOCAL_MESSAGE_EDIT_CHAIN_UNKNOWN');
    seen.add(message.id);
    const children = all.filter((item) => item.message.replacementOf === message.id);
    if (children.length > 1) throw conflict('LOCAL_MESSAGE_EDIT_CHAIN_UNKNOWN');
    if (!children.length) break;
    if (
      !message.withdrawn ||
      chatMessageReceipt(db, input.sourceId, input.roomId, message.id)?.state !== 'withdrawn'
    )
      throw conflict('LOCAL_MESSAGE_EDIT_CHAIN_UNKNOWN');
    head = children[0];
  }
  if (
    root.entry.deleted ||
    root.entry.hidden ||
    root.entry.draft ||
    root.entry.withdrawn ||
    root.entry.state === 'withdrawn' ||
    createHash('sha256')
      .update(
        JSON.stringify([
          root.entry.title,
          root.entry.content,
          root.entry.category,
          root.entry.attachments,
        ]),
      )
      .digest('hex') !== root.entry.chatJournal.projectionHash
  )
    throw conflict('LOCAL_MESSAGE_EDIT_SOURCE_CHANGED');
  const receipt = chatMessageReceipt(db, input.sourceId, input.roomId, head.message.id);
  if (head.message.withdrawn || receipt?.state !== 'active')
    throw conflict('LOCAL_MESSAGE_EDIT_HEAD_WITHDRAWN');
  return { ...head, root, receipt };
}

function snapshot(db, input, chain, editOperationId = null) {
  const unit = db.messageStore?.units?.find(
    (u) => u.id === chatUnitId(input.sourceId, input.roomId, chain.message.id),
  );
  return {
    headMessageId: chain.message.id,
    headRevision: unit?.revision ?? null,
    headSha256: sharedMessageEditHeadSha256(chain.message, unit?.revision ?? null),
    editOperationId,
  };
}

/** Read-only, body-free base. The caller must supply its already authorized self scope. */
export function describeLocalMessageEdit(db, input, context) {
  authorize(input, context);
  const record = db._messageEdits?.roots?.find((r) => r.rootKey === rootKey(input));
  if (record?.state === 'withdrawn')
    return {
      ...identity(input),
      state: 'withdrawn',
      version: record.version,
      headMessageId: record.head.headMessageId,
      base: null,
    };
  const chain = readChain(db, input, context),
    actual = snapshot(db, input, chain, record?.head.editOperationId ?? null);
  if (record && (record.state === 'unknown-stale' || !sameBase(actual, record.head)))
    throw conflict('LOCAL_MESSAGE_EDIT_UNKNOWN_STALE');
  return {
    ...identity(input),
    state: 'active',
    version: record?.version ?? 0,
    base: baseOf(actual),
    editedAt: record?.head.editedAt ?? null,
    stamp: record?.head.stamp ? structuredClone(record.head.stamp) : null,
  };
}

function validateIntent(input, context, action, now) {
  authorize(input, context, true);
  if (
    !keys(input, [
      'sourceId',
      'roomId',
      'rootMessageId',
      'operationId',
      'base',
      ...(action === 'edit' ? ['editedAt', 'stamp', 'message'] : []),
    ]) ||
    !keys(input.base, ['headMessageId', 'headRevision', 'headSha256', 'editOperationId']) ||
    !decimal(input.base.headMessageId) ||
    !(
      input.base.headRevision === null ||
      (Number.isSafeInteger(input.base.headRevision) && input.base.headRevision > 0)
    ) ||
    !/^[0-9a-f]{64}$/.test(input.base.headSha256) ||
    !(input.base.editOperationId === null || uuid(input.base.editOperationId))
  )
    throw bad();
  if (action === 'edit') {
    if (
      !keys(input.stamp, ['physicalMs', 'logical', 'deviceId', 'operationId']) ||
      input.stamp?.deviceId !== context.deviceId ||
      input.stamp?.operationId !== input.operationId ||
      typeof input.editedAt !== 'string' ||
      !Number.isFinite(Date.parse(input.editedAt)) ||
      new Date(input.editedAt).toISOString() !== input.editedAt ||
      Date.parse(input.editedAt) > now + 300000 ||
      !keys(input.message, ['text', 'attachments', 'replyTo'])
    )
      throw bad();
    if (
      typeof input.message.text !== 'string' ||
      input.message.text.length > 500000 ||
      !Array.isArray(input.message.attachments) ||
      input.message.attachments.length > 100 ||
      !input.message.attachments.every(uuid) ||
      (!input.message.text.trim() && !input.message.attachments.length) ||
      (input.message.replyTo !== undefined && !decimal(input.message.replyTo))
    )
      throw bad();
    try {
      compareEditStamps(input.stamp, input.stamp);
    } catch {
      throw bad();
    }
    if (input.stamp.physicalMs > now + 300000) throw bad();
  }
  return sha({ action, input, deviceId: context.deviceId });
}

function currentHead(record) {
  return {
    state: record.state,
    version: record.version,
    headMessageId: record.head.headMessageId,
    base: record.state === 'active' ? baseOf(record.head) : null,
  };
}

function receipt(record, operationId, outcome, replayed = false, committed = null) {
  const terminal = record.state === 'withdrawn';
  if (!terminal && committed && !Object.hasOwn(committed, 'base'))
    throw conflict('LOCAL_MESSAGE_EDIT_RECEIPT_UNAVAILABLE');
  return {
    ...identity(record),
    operationId,
    accepted: true,
    outcome: terminal ? 'withdrawn' : outcome,
    ...(terminal || !committed
      ? currentHead(record)
      : {
          state: committed.state,
          version: committed.version,
          headMessageId: committed.headMessageId,
          base: structuredClone(committed.base),
        }),
    currentHead: currentHead(record),
    terminal,
    replayed,
  };
}

function stale(record, input) {
  record.state = 'unknown-stale';
  return {
    ...identity(input),
    operationId: input.operationId,
    accepted: false,
    outcome: 'conflict',
    state: 'unknown-stale',
    code: 'LOCAL_MESSAGE_EDIT_UNKNOWN_STALE',
  };
}

function prepare(db, input, context, action, now) {
  const digest = validateIntent(input, context, action, now),
    key = rootKey(input);
  const ledger = db._messageEdits;
  if (ledger && ledger.version !== 1) throw conflict('LOCAL_MESSAGE_EDIT_LEDGER_VERSION');
  const previous = ledger?.operations.find((op) => op.operationId === input.operationId);
  if (previous && (previous.rootKey !== key || previous.intentSha256 !== digest))
    throw conflict('LOCAL_MESSAGE_EDIT_OPERATION_COLLISION');
  if (
    !previous &&
    (db.chatJournal?.withdrawals?.some((w) => w.operationId === input.operationId) ||
      db.entries.some((e) =>
        e.chatJournal?.messages.some((m) => m.operationId === input.operationId),
      ))
  )
    throw conflict('LOCAL_MESSAGE_EDIT_OPERATION_COLLISION');
  let record = ledger?.roots.find((r) => r.rootKey === key);
  if (record?.state === 'withdrawn') {
    if (!record.heads.some((head) => sameBase(head, input.base)))
      throw conflict('LOCAL_MESSAGE_EDIT_BASE_UNKNOWN');
    return {
      result: previous
        ? receipt(record, input.operationId, 'withdrawn', true)
        : save(
            db,
            { record, digest, isNew: false, contextPrincipal: context.authenticatedDeviceId },
            input,
            'withdrawn',
          ),
    };
  }
  let chain;
  try {
    chain = readChain(db, input, context);
  } catch (error) {
    if (record && error.status === 409) return { result: stale(record, input) };
    throw error;
  }
  const actual = snapshot(db, input, chain, record?.head.editOperationId ?? null);
  if (record && (record.state !== 'active' || !sameBase(actual, record.head)))
    return { result: stale(record, input) };
  if (previous)
    return { result: receipt(record, input.operationId, previous.outcome, true, previous) };
  if (!record) {
    if (!sameBase(actual, input.base)) throw conflict('LOCAL_MESSAGE_EDIT_BASE_UNKNOWN');
    record = {
      ...identity(input),
      rootKey: key,
      state: 'active',
      version: 0,
      head: actual,
      heads: [actual],
    };
  }
  const base = record.heads.find((head) => sameBase(head, input.base));
  if (!base) throw conflict('LOCAL_MESSAGE_EDIT_BASE_UNKNOWN');
  return {
    record,
    chain,
    base,
    digest,
    isNew: !ledger?.roots.includes(record),
    contextPrincipal: context.authenticatedDeviceId,
  };
}

function save(db, prepared, input, outcome) {
  db._messageEdits ||= { version: 1, roots: [], operations: [] };
  if (prepared.isNew) db._messageEdits.roots.push(prepared.record);
  db._messageEdits.operations.push({
    operationId: input.operationId,
    rootKey: prepared.record.rootKey,
    intentSha256: prepared.digest,
    outcome,
    state: prepared.record.state,
    version: prepared.record.version,
    headMessageId: prepared.record.head.headMessageId,
    base: prepared.record.state === 'active' ? baseOf(prepared.record.head) : null,
    ...(prepared.contextPrincipal ? { authenticatedDeviceId: prepared.contextPrincipal } : {}),
  });
  return receipt(prepared.record, input.operationId, outcome);
}

const replacementId = (operationId) =>
  (BigInt(`0x${operationId.replaceAll('-', '')}`) % 10n ** 20n).toString();
const withdrawalId = (operationId) => {
  const h = createHash('sha256')
    .update(`shiye-local-message-edit-withdraw-v1:${operationId}`)
    .digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};

/** Must run inside the original library store's copy-on-write mutate; never mutate getDb(). */
export function applyLocalMessageEdit(db, input, context) {
  const now = context?.now ?? Date.now(),
    prepared = prepare(db, input, context, 'edit', now);
  if (prepared.result) return prepared.result;
  const { record, chain, base } = prepared;
  if (base.stamp && compareEditStamps(input.stamp, base.stamp) <= 0)
    throw conflict('LOCAL_MESSAGE_EDIT_CLOCK_REGRESSION');
  const id = replacementId(input.operationId);
  if (
    db.chatJournal?.withdrawals?.some(
      (w) => w.sourceId === input.sourceId && w.roomId === input.roomId && w.messageId === id,
    ) ||
    db.entries.some(
      (entry) =>
        entry.chatJournal?.sourceId === input.sourceId &&
        entry.chatJournal.roomId === input.roomId &&
        entry.chatJournal.messages.some((m) => m.id === id),
    )
  )
    throw conflict('LOCAL_MESSAGE_EDIT_ID_COLLISION');
  if (input.message.replyTo !== undefined && input.message.replyTo !== chain.message.replyTo)
    throw conflict('LOCAL_MESSAGE_EDIT_QUOTE_CHANGED');
  const message = {
    ...input.message,
    id,
    sentAt: chain.root.message.sentAt,
    ...(chain.message.replyTo ? { replyTo: chain.message.replyTo } : {}),
    replacementOf: chain.message.id,
    replacementRootId: input.rootMessageId,
  };
  validateChatMessages({ sourceId: input.sourceId, roomId: input.roomId, messages: [message] }, db);
  if (record.head.stamp && compareEditStamps(input.stamp, record.head.stamp) < 0)
    return save(db, prepared, input, 'superseded');
  const options = {
    conversationWriter: context.conversationWriter === true,
    messageUnitsEnabled: true,
  };
  withdrawChatMessage(
    db,
    {
      sourceId: input.sourceId,
      roomId: input.roomId,
      messageId: chain.message.id,
      expectedRevision: chain.receipt.revision,
      operationId: withdrawalId(input.operationId),
    },
    now,
    options,
  );
  appendChatMessages(
    db,
    { sourceId: input.sourceId, roomId: input.roomId, messages: [message] },
    now,
    {
      ...options,
      actor: { kind: 'self', id: 'self' },
      messageMetadata: { operationId: input.operationId },
    },
  );
  const next = readChain(db, input, context);
  record.version++;
  record.head = {
    ...snapshot(db, input, next, input.operationId),
    editedAt: input.editedAt,
    stamp: structuredClone(input.stamp),
    version: record.version,
  };
  record.heads.push(record.head);
  return save(db, prepared, input, 'applied');
}

/** Explicit root-terminal action. Legacy single-message withdrawal remains untouched. */
export function applyLocalMessageWithdrawal(db, input, context) {
  const now = context?.now ?? Date.now(),
    prepared = prepare(db, input, context, 'withdraw', now);
  if (prepared.result) return prepared.result;
  const { record, chain } = prepared;
  withdrawChatMessage(
    db,
    {
      sourceId: input.sourceId,
      roomId: input.roomId,
      messageId: chain.message.id,
      expectedRevision: chain.receipt.revision,
      operationId: input.operationId,
    },
    now,
    { conversationWriter: context.conversationWriter === true },
  );
  record.state = 'withdrawn';
  record.version++;
  record.head = { ...record.head, ...snapshot(db, input, chain, record.head.editOperationId) };
  return save(db, prepared, input, 'withdrawn');
}

export const commitLocalMessageEdit = (store, input, context) =>
  store.mutate((db) => applyLocalMessageEdit(db, input, context));
export const commitLocalMessageWithdrawal = (store, input, context) =>
  store.mutate((db) => applyLocalMessageWithdrawal(db, input, context));
