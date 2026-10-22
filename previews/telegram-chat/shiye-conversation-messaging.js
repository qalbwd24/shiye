/* DOM-free unified transport. The injected store owns atomic durable transactions.
 * No scheduler, ownership migration, arbitrary URL, or legacy journal write lives here. */
const copy = (value) => structuredClone(value);
const WRITER = 'conversation-services-v1';
const fail = (message, status = 409) => Object.assign(new Error(message), { status });
const canonical = (value) =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
const blank = () => ({
  messages: {},
  redactions: {},
  outbox: [],
  receipts: {},
  drafts: {},
  cursor: {},
});
function redact(message, state) {
  return {
    ...message,
    state,
    body: null,
    markdown: '',
    attachments: [],
    source: undefined,
    media: undefined,
    replyPreview: undefined,
  };
}
function receiptValue(result) {
  const {
    kind,
    conversationId,
    messageId,
    localMessageId,
    entryId,
    state,
    revision,
    instanceId,
    operationId,
  } = result;
  return {
    kind,
    conversationId,
    messageId,
    localMessageId,
    entryId,
    state,
    revision,
    instanceId,
    operationId,
    ...(result.message
      ? {
          message: {
            id: result.message.id,
            operationId: result.message.operationId,
            state: result.message.state,
          },
        }
      : {}),
  };
}
function removeReceiptBodies(data, id) {
  for (const receipt of Object.values(data.receipts)) {
    const value = receipt.value;
    const messageId =
      value.messageId ||
      (value.kind === 'comment'
        ? `service:${value.instanceId}:comment:${value.message?.operationId}`
        : undefined);
    if (messageId !== id) continue;
    delete receipt.intent;
    receipt.retired = true;
  }
}
export function compareConversationMessages(a, b) {
  const time = String(a.sentAt || '').localeCompare(String(b.sentAt || ''));
  if (time) return time;
  const lane = a.order.lane.localeCompare(b.order.lane);
  if (lane) return lane;
  const left = BigInt(a.order.sequence),
    right = BigInt(b.order.sequence);
  return left < right ? -1 : left > right ? 1 : a.id.localeCompare(b.id);
}

/** store.read(id), store.transact(id, synchronousMutator) must clone/commit atomically.
 * withLock must serialize across windows (Web Locks or the shared worker).
 * isWriteOwner proves the old journal/outbox for this room was explicitly drained
 * and disabled. A server owner alone is insufficient to enable a second sender. */
export function createConversationMessagingClient({
  conversationId,
  request: transport,
  store,
  withLock,
  capabilities,
  isWriteOwner,
  now = () => new Date().toISOString(),
  uuid = () => crypto.randomUUID(),
}) {
  if (
    !/^desktop:[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}:-?\d+$/.test(conversationId) ||
    !transport ||
    !store?.read ||
    !store?.transact ||
    !withLock ||
    !capabilities ||
    !isWriteOwner
  )
    throw TypeError('稳定会话身份、固定传输、原子存储和跨窗口锁必填');
  const key = `shiye-conversation-messaging:${conversationId}`;
  const read = async () => ({ ...blank(), ...(await store.read(conversationId)) });
  const mutate = (run) =>
    store.transact(conversationId, (data) => {
      for (const [key, value] of Object.entries(blank())) data[key] ??= value;
      return run(data);
    });
  async function request(action, payload) {
    try {
      return await transport(action, payload);
    } catch (error) {
      if ([401, 403].includes(error.status))
        await mutate((data) => {
          for (const [id, message] of Object.entries(data.messages)) {
            data.messages[id] = redact(message, 'unavailable');
            removeReceiptBodies(data, id);
          }
          data.locked = true;
          data.needsRevalidation = true;
        });
      throw error;
    }
  }
  async function supported() {
    if ((await capabilities())?.conversationServices?.conversationMessaging !== 1)
      throw fail('当前后台尚未提供统一会话消息能力', 503);
  }
  async function writeAllowed(kind, verifyRemote = false) {
    await supported();
    if (!(await isWriteOwner(conversationId)))
      throw fail('旧归篇尚未完成明确交接，禁止启用第二写口');
    if (kind === 'message' && verifyRemote) {
      const state = await request('conversation-state', { conversationId });
      if (state.conversationId !== conversationId || state.messageOwner !== WRITER)
        throw fail('后台仍由旧归篇维护此会话');
    }
  }
  function scope(value) {
    if (value?.conversationId !== conversationId) throw fail('响应属于其他会话');
  }
  async function freezeTarget(draftId, target, { quoted = true } = {}) {
    await supported();
    if (!draftId || !target?.instanceId || !target.batchId) throw fail('评论对象不完整', 400);
    const frozen = {
      instanceId: target.instanceId,
      batchId: target.batchId,
      ...(quoted && target.deliveryId ? { deliveryId: target.deliveryId } : {}),
      ...(quoted && target.occurrenceId ? { occurrenceId: target.occurrenceId } : {}),
    };
    if (quoted && !frozen.deliveryId) throw fail('单条引用必须包含投递编号', 400);
    const field = quoted ? 'reply' : 'displayedTarget';
    const revision = uuid();
    await mutate((data) => {
      data.drafts[draftId] = { revision, pending: true };
    });
    const result = await request('conversation-context', { conversationId, [field]: frozen });
    scope(result);
    if (result.instanceId !== frozen.instanceId) throw fail('评论对象实例不一致');
    await mutate((data) => {
      if (data.drafts[draftId]?.revision !== revision) throw fail('评论对象已被更新');
      data.drafts[draftId] = { revision, [field]: frozen };
    });
    return copy({ [field]: frozen });
  }
  async function enqueue({
    kind = 'message',
    actorId = 'self',
    text = '',
    attachments = [],
    replyToMessageId,
    draftId,
    operationId = uuid(),
    sentAt = now(),
  }) {
    await writeAllowed(kind);
    if (!['message', 'comment'].includes(kind) || !Number.isFinite(Date.parse(sentAt)))
      throw fail('消息类型或时间无效', 400);
    sentAt = new Date(sentAt).toISOString();
    if (kind === 'comment' && attachments.length) throw fail('评论不接受附件', 400);
    const payload = {
      conversationId,
      operationId,
      actorId,
      kind,
      text,
      sentAt,
      ...(kind === 'message'
        ? { attachments: copy(attachments), ...(replyToMessageId ? { replyToMessageId } : {}) }
        : {}),
    };
    await mutate((data) => {
      if (kind === 'comment') {
        const draft = data.drafts[draftId];
        if (!draft || draft.pending || (!draft.reply && !draft.displayedTarget))
          throw fail('请先核验并冻结评论对象');
        Object.assign(
          payload,
          copy(draft.reply ? { reply: draft.reply } : { displayedTarget: draft.displayedTarget }),
        );
      }
      const old = data.outbox.find((item) => item.id === operationId);
      const receipt = data.receipts[operationId];
      if (receipt?.retired) throw fail('此操作已经撤回或不可查看，请使用新的操作编号');
      if (old || receipt) {
        if ((old?.intent || receipt.intent) !== canonical(payload))
          throw fail('重试不能更换消息内容、发送者或对象');
        return;
      }
      data.outbox.push({
        id: operationId,
        action: 'conversation-send',
        payload: copy(payload),
        intent: canonical(payload),
        sentAt,
        sequence: (data.sequence = (data.sequence || 0) + 1),
      });
    });
    return { operationId, sentAt };
  }
  async function enqueueWithdrawal({
    kind,
    actorId = 'self',
    messageId,
    expectedRevision,
    instanceId,
    operationId,
    sendOperationId,
  }) {
    await writeAllowed(kind);
    if (!['message', 'comment'].includes(kind)) throw fail('撤回对象类型无效', 400);
    const id = uuid();
    const cachedId =
      kind === 'comment' ? `service:${instanceId}:comment:${operationId}` : messageId;
    const payload = {
      conversationId,
      actorId,
      kind,
      ...(kind === 'comment'
        ? { instanceId, operationId }
        : { messageId, expectedRevision, operationId: id }),
    };
    if (kind === 'comment' && (!instanceId || !operationId))
      throw fail('评论撤回必须保留实例和原发送操作编号', 400);
    if (kind === 'message' && !messageId && !sendOperationId) throw fail('缺少撤回消息编号', 400);
    await mutate((data) => {
      const pendingSend = data.outbox.find((item) => item.id === (sendOperationId || operationId));
      const sentAt = new Date(
        Math.max(Date.parse(now()), Date.parse(pendingSend?.sentAt || now())),
      ).toISOString();
      data.outbox.push({
        id,
        action: 'conversation-withdraw',
        payload,
        sendOperationId,
        sentAt,
        sequence: (data.sequence = (data.sequence || 0) + 1),
      });
      if (cachedId && data.messages[cachedId]) {
        data.redactions[cachedId] = 'withdrawn';
        data.messages[cachedId] = redact(data.messages[cachedId], 'withdrawn');
      }
      if (cachedId) removeReceiptBodies(data, cachedId);
    });
    return id;
  }
  async function flush() {
    return withLock(key, async () => {
      await supported();
      const ids = (await read()).outbox
        .slice()
        .sort((a, b) => a.sentAt.localeCompare(b.sentAt) || a.sequence - b.sequence)
        .map((item) => item.id);
      for (const id of ids) {
        const snapshot = await read();
        const operation = snapshot.outbox.find((item) => item.id === id);
        if (!operation) continue;
        await writeAllowed(operation.payload.kind, true);
        const payload = copy(operation.payload);
        if (operation.sendOperationId) {
          const receipt = snapshot.receipts[operation.sendOperationId]?.value;
          if (!receipt?.messageId) throw fail('原消息尚未确认，撤回保留待发');
          payload.messageId = receipt.messageId;
          payload.expectedRevision = receipt.revision;
        }
        try {
          const result = await request(operation.action, payload);
          if (operation.action === 'conversation-send') scope(result);
          await mutate((data) => {
            const current = data.outbox.find((item) => item.id === id);
            if (!current || canonical(current.payload) !== canonical(operation.payload))
              throw fail('待发操作在确认期间变化');
            const retired = result.state === 'withdrawn' || result.message?.state === 'withdrawn';
            data.receipts[id] = {
              value: receiptValue(result),
              ...(retired ? { retired: true } : { intent: operation.intent }),
            };
            data.outbox = data.outbox.filter((item) => item.id !== id);
            const messageId = payload.messageId;
            if (operation.action === 'conversation-withdraw' && messageId) {
              removeReceiptBodies(data, messageId);
              data.redactions[messageId] = 'withdrawn';
              if (data.messages[messageId])
                data.messages[messageId] = redact(data.messages[messageId], 'withdrawn');
            }
          });
        } catch (error) {
          await mutate((data) => {
            const current = data.outbox.find((item) => item.id === id);
            if (current) current.error = { status: error.status, message: error.message };
          });
          throw error; // Preserve ordering; never send later entries past an unresolved failure.
        }
      }
    });
  }
  async function sync({ revalidate = false, limit = 50 } = {}) {
    return withLock(key, async () => {
      await supported();
      const saved = await read();
      revalidate ||= Boolean(saved.needsRevalidation);
      let after = revalidate ? {} : saved.cursor;
      for (;;) {
        const page = await request('conversation-feed', {
          conversationId,
          after: copy(after),
          limit,
        });
        scope(page);
        scope(page.next);
        if (
          !Array.isArray(page.messages) ||
          page.messages.length > limit ||
          !Array.isArray(page.redactions) ||
          !page.next.positions ||
          Array.isArray(page.next.positions) ||
          typeof page.hasMore !== 'boolean'
        )
          throw fail('会话分页格式不正确');
        for (const [lane, position] of Object.entries(page.next.positions)) {
          if (!Number.isSafeInteger(position) || position < (after.positions?.[lane] || 0))
            throw fail('会话收件游标回退');
        }
        for (const message of page.messages) {
          scope(message);
          if (!message.id || !message.order?.lane || !/^\d+$/.test(String(message.order.sequence)))
            throw fail('消息身份或序号无效');
        }
        if (page.hasMore && canonical(after) === canonical(page.next))
          throw fail('会话收件游标没有前进');
        await mutate((data) => {
          for (const item of page.redactions) {
            if (!item.id || !['unavailable', 'withdrawn'].includes(item.state))
              throw fail('失效消息格式不正确');
            if (data.redactions[item.id] !== 'withdrawn') data.redactions[item.id] = item.state;
            removeReceiptBodies(data, item.id);
            if (data.messages[item.id])
              data.messages[item.id] = redact(data.messages[item.id], data.redactions[item.id]);
          }
          for (const message of page.messages) {
            if (
              ['withdrawn', 'unavailable'].includes(message.state) &&
              data.redactions[message.id] !== 'withdrawn'
            ) {
              data.redactions[message.id] = message.state;
              removeReceiptBodies(data, message.id);
            }
            const tombstone = data.redactions[message.id];
            // A new full authoritative source pass may restore temporarily hidden
            // content; permanent withdrawals never regain their body.
            if (
              revalidate &&
              message.state === 'active' &&
              tombstone === 'unavailable' &&
              !page.redactions.some((item) => item.id === message.id)
            )
              delete data.redactions[message.id];
            data.messages[message.id] = data.redactions[message.id]
              ? redact(copy(message), data.redactions[message.id])
              : copy(message);
          }
          data.cursor = copy(page.next);
          data.participants = copy(page.participants);
          data.sourceRevalidation = page.sourceRevalidation;
          if (!page.hasMore) {
            data.locked = false;
            data.needsRevalidation = false;
          }
        });
        after = page.next;
        if (!page.hasMore) return;
      }
    });
  }
  return { freezeTarget, enqueue, enqueueWithdrawal, flush, sync, read };
}
