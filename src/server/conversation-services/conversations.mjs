import { randomUUID } from 'node:crypto';
import { fail } from '../http.mjs';
import { conversationId, isLegacyConversation, LEGACY_SERVICE_ID } from './settings.mjs';
import { emptyRevisitState } from '../domain/revisit/delivery/state.mjs';
import { registry, scope, isServiceId } from './registry.mjs';
import { digest } from '../domain/revisit/sources/identity.mjs';
import { saveChatRoom, appendChatMessages, withdrawChatMessage } from '../domain/chat-journal.mjs';
import { chatUnitId } from '../domain/message-store.mjs';
import { portableConfiguration } from '../sync-product/migration-metadata.mjs';
import { revisitFeed } from '../domain/revisit/delivery/query.mjs';
import { resolveCommentContext } from '../domain/revisit/comments/context.mjs';
import {
  planRevisitComment,
  planRevisitWithdrawal,
  commitCommentPlan,
} from '../domain/revisit/comments/persistence.mjs';

const WRITER = 'conversation-services-v1';
function identity(input) {
  const id = conversationId(input);
  const [, sourceId, roomId] = id.split(':');
  return { id, sourceId, roomId };
}
function ownedInstances(db, id) {
  const r = registry(db);
  const services = r.instances.filter(
    (s) =>
      s.conversationId === id ||
      r.bindings.some((b) => b.instanceId === s.id && b.conversationId === id),
  );
  if (isLegacyConversation(id))
    services.unshift({
      id: LEGACY_SERVICE_ID,
      providerId: 'revisit',
      name: '朝花夕拾',
      state: db.revisit || emptyRevisitState(),
      legacy: true,
    });
  return services;
}
const serviceView = (db, service) =>
  service.id === LEGACY_SERVICE_ID ? db : scope(db, service.id);
function ownedInstance(db, id, instanceId) {
  const service = ownedInstances(db, id).find((s) => s.id === instanceId);
  if (!service) throw fail(404, '程序实例不属于此会话');
  return service;
}
function roomMessages(db, { sourceId, roomId }) {
  return db.entries
    .filter((e) => e.chatJournal?.sourceId === sourceId && e.chatJournal.roomId === roomId)
    .flatMap((entry) => entry.chatJournal.messages.map((message) => ({ entry, message })));
}
function programActor(service) {
  return {
    id: `program:${service.id}`,
    kind: service.providerId === 'external-program' ? service.state.config.kind : 'program',
    providerId: service.providerId,
    instanceId: service.id,
    name: service.state.config.sender.name,
    avatarAssetId: service.state.config.sender.avatarAssetId || null,
    sourceKind: 'backend-service',
  };
}
export function describeConversation(db, input) {
  const { id, sourceId, roomId } = identity(input);
  const r = registry(db),
    saved = r.conversations?.find((c) => c.id === id);
  const room = db.chatJournal?.rooms.find((c) => c.sourceId === sourceId && c.id === roomId);
  const bindings = r.bindings.filter((b) => b.conversationId === id);
  const services = ownedInstances(db, id);
  return {
    version: 1,
    conversationId: id,
    revision: saved?.revision || 0,
    mode:
      saved?.mode ||
      (services.some((s) => s.legacy) || bindings.some((b) => b.active) ? 'group' : 'session'),
    title: saved?.title || room?.title || '会话',
    category: room?.category || null,
    idleHours: room?.idleHours ?? 5,
    description: room?.description || '',
    clientMetadata: structuredClone(saved?.clientMetadata || {}),
    messageOwner: room?.messageOwner || 'legacy',
    participants: [
      {
        id: 'self',
        kind: 'self',
        name: saved?.selfName || '我',
        active: true,
        canRead: true,
        canWrite: true,
      },
      ...services.map((s) => {
        const b = bindings.find((b) => b.instanceId === s.id && b.active);
        return {
          ...programActor(s),
          bindingId: b?.id || null,
          active: (s.legacy || !!b) && (s.providerId === 'revisit' || s.state.config.enabled),
          canRead: (s.legacy || !!b) && (s.providerId === 'revisit' || s.state.config.enabled),
          canWrite: (s.legacy || !!b) && (s.providerId === 'revisit' || s.state.config.enabled),
        };
      }),
    ],
    bindings: structuredClone(bindings),
    programs: services.map((s) => ({
      instanceId: s.id,
      providerId: s.providerId,
      config: structuredClone(s.state.config),
    })),
  };
}
export function saveConversation(db, input) {
  const state = describeConversation(db, input),
    { id, sourceId, roomId } = identity(input);
  if (input.expectedRevision !== state.revision) throw fail(409, '会话资料已被其他窗口修改');
  if (
    !['session', 'group'].includes(input.mode) ||
    typeof input.title !== 'string' ||
    !input.title.trim() ||
    input.title.length > 80 ||
    typeof input.selfName !== 'string' ||
    !input.selfName.trim() ||
    input.selfName.length > 80 ||
    (input.messageOwner !== undefined && input.messageOwner !== WRITER) ||
    (input.description !== undefined &&
      (typeof input.description !== 'string' || input.description.length > 2000)) ||
    (input.clientMetadata !== undefined &&
      (!input.clientMetadata ||
        typeof input.clientMetadata !== 'object' ||
        Array.isArray(input.clientMetadata) ||
        JSON.stringify(input.clientMetadata).length > 65536 ||
        digest(portableConfiguration(input.clientMetadata)) !== digest(input.clientMetadata)))
  )
    throw fail(400, '会话资料参数不正确');
  if (
    input.mode === 'session' &&
    (isLegacyConversation(id) || state.bindings.some((b) => b.active))
  )
    throw fail(409, '请先解除程序接入，再改为个人记录');
  const room = saveChatRoom(
    db,
    {
      sourceId,
      id: roomId,
      title: input.title,
      category: input.category,
      idleHours: input.idleHours,
    },
    { allowUncategorized: true },
  );
  if (input.description !== undefined) {
    const actual = db.chatJournal.rooms.find((r) => r.sourceId === sourceId && r.id === roomId);
    actual.description = input.description;
  }
  if (input.messageOwner) {
    const actual = db.chatJournal.rooms.find((r) => r.sourceId === sourceId && r.id === roomId);
    actual.messageOwner = WRITER;
  }
  db.conversationServices ||= structuredClone(registry(db));
  const records = (db.conversationServices.conversations ||= []),
    old = records.findIndex((c) => c.id === id);
  const value = {
    ...(old < 0 ? {} : records[old]),
    id,
    mode: input.mode,
    title: room.title,
    selfName: input.selfName.trim(),
    revision: state.revision + 1,
    ...(input.clientMetadata === undefined
      ? {}
      : { clientMetadata: structuredClone(input.clientMetadata) }),
  };
  if (old < 0) records.push(value);
  else records[old] = value;
  db.conversationServices.revision++;
  return describeConversation(db, input);
}
function sender(db, input, { allowInactive = false } = {}) {
  const state = describeConversation(db, input);
  const actor = state.participants.find((p) => p.id === (input.actorId || 'self'));
  if (!actor || (!allowInactive && !actor.active)) throw fail(409, '发送者未接入此会话');
  const {
    active: _active,
    canRead: _read,
    canWrite: _write,
    bindingId: _binding,
    ...value
  } = actor;
  return value;
}
function canonical(value) {
  return Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
}
function commentView(db, input) {
  const { id } = identity(input);
  const target = input.reply || input.displayedTarget;
  if (!target || !(isServiceId(target.instanceId) || target.instanceId === LEGACY_SERVICE_ID))
    throw fail(400, '请传入引用对象或输入框显示的固定回看组');
  const service = ownedInstance(db, id, target.instanceId);
  if (service.providerId !== 'revisit') throw fail(400, '评论目标须为朝花夕拾的原记录或记录组');
  return { service, target, view: serviceView(db, service) };
}
export function conversationContext(db, input) {
  const { service, target, view } = commentView(db, input);
  return {
    ...resolveCommentContext(view, target),
    instanceId: service.id,
    conversationId: input.conversationId,
  };
}
export function sendConversationMessage(
  db,
  input,
  now = Date.now(),
  { allowLegacyService = false } = {},
) {
  const origin = identity(input),
    actor = sender(db, input, { allowInactive: true });
  if (!isServiceId(input.operationId)) throw fail(400, '消息操作编号须为UUID');
  if (input.kind === 'comment') {
    if (input.attachments?.length) throw fail(400, '回看评论暂支持文字；原图可作为精确评论目标');
    const { service, target, view } = commentView(db, input);
    if (!view.revisit.comments.some((c) => c.operationId === input.operationId)) sender(db, input);
    const result = commitCommentPlan(
      view,
      planRevisitComment(
        view,
        {
          ...target,
          operationId: input.operationId,
          text: input.text,
          ...(input.sentAt ? { sentAt: input.sentAt } : {}),
        },
        now,
        { actor },
      ),
    );
    return { kind: 'comment', conversationId: origin.id, instanceId: service.id, message: result };
  }
  if (input.kind !== 'message') throw fail(400, '消息类型不正确');
  const state = describeConversation(db, input);
  if (
    state.messageOwner !== WRITER &&
    !(allowLegacyService && state.messageOwner === 'legacy' && actor.id.startsWith('program:'))
  )
    throw fail(409, '前端须先切换到统一会话写口，避免与旧归档重复写入');
  const records = roomMessages(db, origin);
  const key = digest(canonical(input));
  const old = records.find(({ message }) => message.operationId === input.operationId);
  if (old) {
    if (old.message.operationHash !== key)
      throw fail(409, '同一消息操作不能更换内容、发送者或引用');
    return {
      kind: 'message',
      order: { lane: 'messages', sequence: old.message.id },
      conversationId: origin.id,
      messageId: chatUnitId(origin.sourceId, origin.roomId, old.message.id),
      localMessageId: old.message.id,
      entryId: old.entry.id,
      state: old.message.withdrawn ? 'withdrawn' : 'active',
      revision:
        db.messageStore?.units.find(
          (u) => u.id === chatUnitId(origin.sourceId, origin.roomId, old.message.id),
        )?.revision || 1,
    };
  }
  sender(db, input);
  let maximum = 0n;
  for (const { message } of records) if (BigInt(message.id) > maximum) maximum = BigInt(message.id);
  const messageId = String(maximum + 1n);
  if (messageId.length > 20) throw fail(409, '会话消息编号超出范围');
  const replyTo = input.replyToMessageId;
  if (
    replyTo &&
    !records.some(
      ({ message }) => chatUnitId(origin.sourceId, origin.roomId, message.id) === replyTo,
    )
  )
    throw fail(409, '引用消息不属于此会话');
  const target = replyTo
    ? records.find(
        ({ message }) => chatUnitId(origin.sourceId, origin.roomId, message.id) === replyTo,
      ).message.id
    : undefined;
  const result = appendChatMessages(
    db,
    {
      sourceId: origin.sourceId,
      roomId: origin.roomId,
      messages: [
        {
          id: messageId,
          text: input.text,
          sentAt: input.sentAt || new Date(now).toISOString(),
          attachments: input.attachments || [],
          ...(target ? { replyTo: target } : {}),
        },
      ],
    },
    now,
    {
      messageUnitsEnabled: true,
      conversationWriter: true,
      serviceParticipant: allowLegacyService,
      actor,
      messageMetadata: { operationId: input.operationId, operationHash: key },
    },
  );
  return {
    kind: 'message',
    conversationId: origin.id,
    messageId: chatUnitId(origin.sourceId, origin.roomId, messageId),
    localMessageId: messageId,
    entryId: result.accepted[0].entryId,
    state: 'active',
    revision: 1,
  };
}
export function withdrawConversationMessage(
  db,
  input,
  now = Date.now(),
  { serviceParticipant = false } = {},
) {
  const origin = identity(input),
    actor = sender(db, input, { allowInactive: true });
  if (input.kind === 'comment') {
    const service = ownedInstance(db, origin.id, input.instanceId);
    const view = serviceView(db, service);
    const comment = view.revisit.comments.find((c) => c.operationId === input.operationId);
    if (serviceParticipant && !comment)
      throw Object.assign(fail(404, '程序只能撤回已经存在的本人评论'), {
        code: 'PROGRAM_COMMENT_NOT_FOUND',
      });
    if (comment && (comment.author?.id || 'self') !== actor.id)
      throw fail(409, '只能撤回此发送者的评论');
    return commitCommentPlan(view, planRevisitWithdrawal(view, input));
  }
  if (input.kind !== 'message') throw fail(400, '消息类型不正确');
  const record = roomMessages(db, origin).find(
    ({ message }) => chatUnitId(origin.sourceId, origin.roomId, message.id) === input.messageId,
  );
  if (!record) throw fail(404, '消息不属于此会话');
  if ((record.message.actor?.id || 'self') !== actor.id) throw fail(409, '只能撤回此发送者的消息');
  return withdrawChatMessage(
    db,
    {
      sourceId: origin.sourceId,
      roomId: origin.roomId,
      messageId: record.message.id,
      operationId: input.operationId || randomUUID(),
      expectedRevision: input.expectedRevision,
    },
    now,
    { conversationWriter: true },
  );
}
export function readConversationFeed(db, input, { positionById } = {}) {
  const origin = identity(input),
    state = describeConversation(db, input),
    limit = input.limit ?? 50;
  if (input.actorId) sender(db, input);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw fail(400, '会话读取数量须为1–100');
  if (
    input.after !== undefined &&
    (!input.after || typeof input.after !== 'object' || Array.isArray(input.after))
  )
    throw fail(400, '收件游标格式不正确');
  if (
    input.after &&
    Object.keys(input.after).length &&
    (input.after.conversationId !== origin.id ||
      !input.after.positions ||
      typeof input.after.positions !== 'object' ||
      Array.isArray(input.after.positions))
  )
    throw fail(400, '收件游标不属于此会话');
  const after = input.after?.positions || {},
    next = { ...after },
    messages = [],
    lanes = [],
    redactions = [];
  const getAfter = (key, total) => {
    const value = after[key] ?? 0;
    if (!Number.isSafeInteger(value) || value < 0 || value > total)
      throw fail(400, '收件游标超出此会话范围');
    return value;
  };
  const units = new Map((db.messageStore?.units || []).map((u) => [u.id, u]));
  const records = roomMessages(db, origin).sort((a, b) =>
    BigInt(a.message.id) < BigInt(b.message.id) ? -1 : 1,
  );
  const start = getAfter('messages', records.length),
    page = records.slice(start, start + limit);
  for (const [index, { entry, message }] of page.entries()) {
    const id = chatUnitId(origin.sourceId, origin.roomId, message.id),
      unit = units.get(id);
    const unavailable = message.withdrawn || entry.deleted || entry.hidden || entry.draft;
    messages.push({
      id,
      conversationId: origin.id,
      kind: 'message',
      order: { lane: 'messages', sequence: message.id },
      actor: message.actor || state.participants[0],
      sentAt: message.sentAt,
      state: message.withdrawn ? 'withdrawn' : unavailable ? 'unavailable' : 'active',
      entryId: entry.id,
      revision: unit?.revision || 1,
      body: unavailable ? null : unit?.body || null,
      markdown: unavailable ? '' : message.text,
      attachments: unavailable ? [] : [...message.attachments],
      replyTo: message.replyTo ? chatUnitId(origin.sourceId, origin.roomId, message.replyTo) : null,
    });
    positionById?.set(id, { lane: 'messages', position: start + index + 1 });
  }
  next.messages = start + page.length;
  lanes.push({ id: 'messages', next: next.messages, total: records.length });
  for (const { entry, message } of records)
    if (message.withdrawn || entry.deleted || entry.hidden || entry.draft)
      redactions.push({
        id: chatUnitId(origin.sourceId, origin.roomId, message.id),
        state: message.withdrawn ? 'withdrawn' : 'unavailable',
      });
  const entries = new Map(db.entries.map((entry) => [entry.id, entry]));
  const services = ownedInstances(db, origin.id);
  const validKeys = new Set([
    'messages',
    ...services.flatMap((s) => [`service:${s.id}`, `service:${s.id}:comments`]),
  ]);
  if (Object.keys(after).some((key) => !validKeys.has(key)))
    throw fail(400, '收件游标包含其他会话的程序');
  for (const service of services) {
    const view = serviceView(db, service),
      actor = programActor(service),
      key = `service:${service.id}`;
    const deliveries = service.state.deliveries || [],
      cursor = getAfter(key, deliveries.length);
    const remaining = limit - messages.length;
    const feed =
      remaining > 0
        ? revisitFeed(view, { after: cursor, limit: remaining })
        : { deliveries: [], batches: [], next: cursor };
    for (const delivery of feed.deliveries) {
      messages.push({
        id: `${key}:delivery:${delivery.id}`,
        conversationId: origin.id,
        kind: 'history',
        order: { lane: key, sequence: String(delivery.sequence) },
        actor,
        instanceId: service.id,
        deliveryId: delivery.id,
        batchId: delivery.batchId,
        sentAt: delivery.replayAt,
        originalAt: delivery.originalAt,
        state: delivery.source.available ? 'active' : 'unavailable',
        source: delivery.source,
        sourceRef: delivery.ref,
        readOnly: true,
      });
      positionById?.set(`${key}:delivery:${delivery.id}`, {
        lane: key,
        position: delivery.sequence,
      });
    }
    next[key] = feed.next;
    lanes.push({ id: key, next: feed.next, total: deliveries.length, batches: feed.batches });
    for (const d of deliveries) {
      const entry = entries.get(d.ref.entryId);
      if (d.paragraphReplacements?.length || !entry || entry.deleted || entry.hidden || entry.draft)
        redactions.push({ id: `${key}:delivery:${d.id}`, state: 'unavailable' });
    }
    const comments = service.state.comments || [],
      ck = `${key}:comments`,
      cs = getAfter(ck, comments.length);
    const cp = comments.slice(cs, cs + Math.max(0, limit - messages.length));
    for (const [index, c] of cp.entries()) {
      messages.push({
        id: `${key}:comment:${c.operationId}`,
        conversationId: origin.id,
        kind: 'comment',
        order: { lane: ck, sequence: String(cs + index + 1) },
        actor: c.author || state.participants[0],
        instanceId: service.id,
        operationId: c.operationId,
        sentAt: c.createdAt || null,
        state: c.state,
        body: c.body || null,
        markdown: c.text || '',
        replyTo: c.replyTo || null,
        commentOn: c.commentOn || [],
        batchId: c.batchId,
        deliveryId: c.deliveryId,
      });
      positionById?.set(`${key}:comment:${c.operationId}`, { lane: ck, position: cs + index + 1 });
    }
    next[ck] = cs + cp.length;
    lanes.push({ id: ck, next: next[ck], total: comments.length });
    for (const c of comments)
      if (c.state === 'withdrawn')
        redactions.push({ id: `${key}:comment:${c.operationId}`, state: 'withdrawn' });
  }
  messages.sort((a, b) => {
    const time = String(a.sentAt || '').localeCompare(String(b.sentAt || ''));
    if (time) return time;
    if (a.order.lane === b.order.lane)
      return BigInt(a.order.sequence) < BigInt(b.order.sequence) ? -1 : 1;
    return a.order.lane.localeCompare(b.order.lane) || a.id.localeCompare(b.id);
  });
  return {
    version: 1,
    conversationId: origin.id,
    participants: state.participants,
    messages,
    lanes,
    next: { conversationId: origin.id, positions: next },
    hasMore: lanes.some((l) => l.next < l.total),
    redactions,
    sourceRevalidation:
      'Use scoped source/media when opening history; start a new after={} pass to revalidate cached history.',
  };
}
