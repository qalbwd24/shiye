// Shared PC/Android data adapter; no DOM, network outlet or TL storage owner.
import { sharedMessageEditUnitId } from './shared-message-edit-protocol.js';
const copy = (v) => structuredClone(v);
const value = (v) => (typeof v === 'function' ? v() : v);
const fail = (code) => {
  throw Object.assign(new Error(code), { code, uncertain: false, locked: false });
};
const decimal = (v) => typeof v === 'string' && /^\d{1,20}$/.test(v);
const canonical = (v) =>
  typeof v === 'string' &&
  /^desktop:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}:-?\d{1,20}$/.test(v);
const newId = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (!globalThis.crypto?.getRandomValues) fail('OPERATION_ID_FACTORY_REQUIRED');
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const s = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
};

/** Renderer adapter over the same JSON business server and durable client inbox.
 * No TL writes, numeric primary-key coercion, message owner migration or UI DOM.
 */
export function createSharedChatSource(callbacks = {}) {
  const client = callbacks.client;
  if (
    !client?.enqueue ||
    !client?.query ||
    !client?.list ||
    !client?.listConversationEntries ||
    !client?.read ||
    !client?.readDraft ||
    !client?.setDraft ||
    !callbacks.currentRoom
  )
    fail('SHARED_CHAT_CLIENT_REQUIRED');
  const listeners = new Set(),
    mappings = new Map(),
    cache = new Map(),
    drafts = new Map(),
    draftQueues = new Map();
  let disposed = false,
    enabled = true,
    version = 0,
    timer = null;
  let mediaById = new Map();
  function schedule() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (!disposed && enabled && listeners.size) {
      timer = setTimeout(() => {
        timer = null;
        void refresh()
          .catch((error) => callbacks.onError?.(error))
          .finally(schedule);
      }, callbacks.pollMs ?? 30000);
      timer.unref?.();
    }
  }
  const operationId = callbacks.idFactory || newId;
  function rawContext() {
    const raw = value(callbacks.currentRoom);
    if (!raw || typeof raw !== 'object') fail('ROOM_REQUIRED');
    return raw;
  }
  const localKey = (raw) => String(raw.localId ?? raw.id ?? raw.roomId ?? raw.conversationId ?? '');
  function mapped(raw) {
    const room = canonical(raw.conversationId) ? raw : mappings.get(localKey(raw));
    if (!room) return null;
    const [, sourceId, legacyRoomId] = room.conversationId.split(':');
    if (room.sourceId !== sourceId || String(room.legacyRoomId ?? room.roomId) !== legacyRoomId)
      fail('ROOM_MAPPING_MISMATCH');
    return {
      ...room,
      sourceId,
      legacyRoomId,
      roomId: room.conversationId,
      version: raw.version ?? value(callbacks.contextVersion) ?? 0,
    };
  }
  function context() {
    if (disposed) fail('DISPOSED');
    const raw = value(callbacks.currentRoom);
    return raw && typeof raw === 'object' ? mapped(raw) : null;
  }
  function matches(ctx) {
    try {
      const now = context();
      return !!now && now.conversationId === ctx.conversationId && now.version === ctx.version;
    } catch {
      return false;
    }
  }
  async function prepare() {
    const raw = rawContext();
    let ctx = mapped(raw);
    if (ctx) return ctx;
    if (typeof callbacks.prepareRoom !== 'function' || !localKey(raw))
      fail('ROOM_SERVER_MAPPING_REQUIRED');
    const prepared = await callbacks.prepareRoom(copy(raw));
    if (!prepared || !canonical(prepared.conversationId)) fail('ROOM_SERVER_MAPPING_REQUIRED');
    mappings.set(localKey(raw), copy(prepared));
    ctx = mapped(raw);
    if (!matches(ctx)) fail('ROOM_CHANGED');
    return ctx;
  }
  function notify() {
    version++;
    for (const listener of listeners)
      try {
        listener(getSnapshot());
      } catch {
        /* no observer may invalidate durable commit */
      }
  }
  function getDraft() {
    const ctx = context();
    return ctx
      ? {
          roomId: ctx.roomId,
          ...copy(drafts.get(ctx.conversationId) || { text: '', replyId: null, ready: false }),
        }
      : { roomId: null, text: '', replyId: null, ready: false };
  }
  function getSnapshot() {
    const ctx = context();
    if (!ctx)
      return {
        roomId: null,
        messages: [],
        ready: false,
        inConversation: false,
        version,
        draft: getDraft(),
      };
    const saved = cache.get(ctx.conversationId) || { messages: [], ready: false };
    return {
      ...copy(saved),
      roomId: ctx.roomId,
      sourceId: ctx.sourceId,
      legacyRoomId: ctx.legacyRoomId,
      conversationId: ctx.conversationId,
      title: saved.title || ctx.title || '随想',
      version,
      inConversation: true,
      draft: getDraft(),
      storage: 'shared-business',
      sendState: { pending: false, locked: false, uncertain: false },
      appearance: copy(value(callbacks.appearance) || {}),
    };
  }
  function project(message, ctx, pending = false) {
    const retired = message.withdrawn === true || (message.state && message.state !== 'active');
    const attachments = retired ? [] : [...(message.attachments || [])];
    const media = mediaById.get(attachments[0]),
      mime = media?.type || media?.mime || '';
    return {
      ...copy(message),
      id: String(message.id),
      roomId: ctx.roomId,
      kind: retired
        ? 'withdrawn'
        : attachments.length
          ? mime.startsWith('image/')
            ? 'image'
            : mime.startsWith('video/')
              ? 'video'
              : 'file'
          : 'text',
      text: retired ? '' : message.text || '',
      attachments,
      mediaItems: attachments.map((id) => ({ ...copy(mediaById.get(id) || {}), id })),
      mediaId: attachments[0] || null,
      ...(media ? { mime, name: media.name, size: media.size, sha256: media.sha256 } : {}),
      replyId: message.replyTo ?? null,
      outgoing: !message.actor || message.actor.kind === 'self',
      pending,
      sentAt: message.sentAt,
      date: message.sentAt,
      readOnly: false,
    };
  }
  async function localSnapshot(ctx) {
    const inbox = await client.readInbox(ctx.conversationId);
    const owner = inbox?.details?.messageOwner ?? ctx.messageOwner ?? 'legacy';
    const records = [
        ...(await client.listConversationEntries(ctx.conversationId)),
        ...(await client.list('media')),
        ...(await client.list('local-chat-message')),
        ...[await client.read('conversation', ctx.conversationId)].filter(Boolean),
      ],
      byId = new Map();
    mediaById = new Map(
      records
        .filter((r) => r.entityType === 'media' && r.local?.state === 'active')
        .map((r) => [r.entityId, r.local.data]),
    );
    let room;
    for (const record of records) {
      const row = record.local;
      if (
        record.entityType === 'conversation' &&
        record.entityId === ctx.conversationId &&
        row?.state === 'active'
      )
        room = row.data;
      if (
        owner === 'legacy' &&
        record.entityType === 'entry' &&
        row?.state === 'active' &&
        row.data?.chatJournal?.sourceId === ctx.sourceId &&
        row.data.chatJournal.roomId === ctx.legacyRoomId
      ) {
        const unavailable = row.data.deleted || row.data.hidden || row.data.draft;
        for (const message of row.data.chatJournal.messages || []) {
          if (unavailable && !message.withdrawn) continue;
          const old = byId.get(String(message.id));
          if (!old || message.withdrawn || old.kind !== 'withdrawn')
            byId.set(String(message.id), project(message, ctx, !!message._localEditPending));
        }
      }
    }
    for (const record of records) {
      const row = record.local;
      if (
        record.entityType === 'local-chat-message' &&
        row?.data?.conversationId === ctx.conversationId
      ) {
        const message = row.data;
        const old = byId.get(message.id);
        if (old?.kind === 'withdrawn') continue;
        if (!old || row.state === 'withdrawn' || message.withdrawn)
          byId.set(
            message.id,
            project(
              { ...message, withdrawn: row.state === 'withdrawn' || message.withdrawn },
              ctx,
              true,
            ),
          );
      }
    }
    const uploads = callbacks.uploadJobs
      ? await callbacks.uploadJobs.list({ conversationId: ctx.conversationId })
      : [];
    for (const job of uploads) {
      const old = byId.get(job.messageId);
      if (old?.kind === 'withdrawn') continue;
      const items = job.attachments.map((item) => ({
        id: item.asset?.id || item.uploadOperationId,
        uploadOperationId: item.uploadOperationId,
        mime: item.mime,
        name: item.name,
        size: item.size,
        transferred: item.transferred,
        uploading: !item.asset,
      }));
      const mime = items[0]?.mime || '';
      const message =
        old ||
        project(
          {
            id: job.messageId,
            text: job.text,
            sentAt: job.sentAt,
            replyTo: job.replyTo,
            attachments: job.attachments.map((item) => item.asset?.id).filter(Boolean),
          },
          ctx,
          true,
        );
      byId.set(job.messageId, {
        ...message,
        kind: mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : 'file',
        mediaItems: items,
        uploadOperationId: job.operationId,
        uploadState: job.status,
        uploadError: job.error,
        uploadProgress: {
          transferred: items.reduce((n, item) => n + item.transferred, 0),
          total: items.reduce((n, item) => n + item.size, 0),
        },
      });
    }
    const previous = cache.get(ctx.conversationId) || {};
    const revisions = {};
    for (const m of inbox?.messages || []) {
      if (owner === 'legacy' && m.kind === 'message') {
        const id = m.order?.sequence;
        if (!decimal(id)) fail('INVALID_MESSAGE_ID');
        if (Number.isSafeInteger(m.revision)) revisions[id] = m.revision;
        const old = byId.get(id);
        if (old)
          byId.set(
            id,
            project({ ...old, actor: m.actor, revision: m.revision, state: m.state }, ctx),
          );
        continue;
      }
      if (m.kind === 'message') {
        byId.set(m.id, project({ ...m, text: m.markdown || '' }, ctx));
      } else {
        const active = m.state === 'active';
        const attachments = active ? m.attachments || m.source?.attachments || [] : [];
        byId.set(m.id, {
          ...copy(m),
          roomId: ctx.roomId,
          kind: m.state === 'withdrawn' ? 'withdrawn' : m.kind,
          text: active ? m.markdown || m.source?.markdown || m.source?.text || '' : '',
          attachments,
          mediaItems: attachments.map((asset) => {
            const id = typeof asset === 'string' ? asset : asset.id || asset.assetId;
            return {
              ...copy(mediaById.get(id) || {}),
              ...(typeof asset === 'object' ? copy(asset) : {}),
              id,
            };
          }),
          outgoing: m.actor?.kind === 'self',
          readOnly: true,
          replyId: m.replyTo ?? null,
          ...(m.kind === 'history'
            ? {
                commentTarget: {
                  instanceId: m.instanceId,
                  batchId: m.batchId,
                  deliveryId: m.deliveryId,
                },
              }
            : {}),
        });
      }
    }
    if (owner !== 'legacy')
      for (const record of records) {
        if (record.entityType !== 'entry' || record.local?.state !== 'active') continue;
        const journal = record.local.data.chatJournal;
        if (journal?.sourceId !== ctx.sourceId || journal.roomId !== ctx.legacyRoomId) continue;
        for (const message of journal.messages || []) {
          if (!message._localEditPending && !message._localEditTerminal) continue;
          const id = sharedMessageEditUnitId(ctx.sourceId, ctx.legacyRoomId, message.id);
          const old = byId.get(id);
          const rootId = message.replacementRootId || message.id;
          const root = byId.get(sharedMessageEditUnitId(ctx.sourceId, ctx.legacyRoomId, rootId));
          byId.set(
            id,
            project(
              {
                ...message,
                id,
                legacyMessageId: message.id,
                order: root?.order || old?.order || { lane: 'chat', sequence: rootId },
              },
              ctx,
              !!message._localEditPending,
            ),
          );
        }
      }
    for (const [id, message] of byId)
      if (Number.isSafeInteger(revisions[id])) message.revision = revisions[id];
    const messages = [...byId.values()].sort((a, b) => {
      const time = String(a.sentAt || '').localeCompare(String(b.sentAt || ''));
      if (time) return time;
      if (a.order && b.order) {
        if (a.order.lane !== b.order.lane) return a.order.lane.localeCompare(b.order.lane);
        if (
          decimal(a.order.sequence) &&
          decimal(b.order.sequence) &&
          a.order.sequence !== b.order.sequence
        )
          return BigInt(a.order.sequence) < BigInt(b.order.sequence) ? -1 : 1;
      }
      const ar = a.replacementRootId || a.replacementOf || a.id,
        br = b.replacementRootId || b.replacementOf || b.id;
      if (decimal(ar) && decimal(br)) {
        const x = BigInt(ar),
          y = BigInt(br);
        if (x !== y) return x < y ? -1 : 1;
        if (decimal(a.id) && decimal(b.id) && a.id !== b.id)
          return BigInt(a.id) < BigInt(b.id) ? -1 : 1;
      }
      return String(a.id).localeCompare(String(b.id));
    });
    cache.set(ctx.conversationId, {
      ...previous,
      ...copy(inbox?.details || {}),
      ...copy(room || {}),
      messageRevisions: revisions,
      messages,
      uploads,
      totalMessages: messages.length,
      hasOlder: false,
      ready: true,
    });
    const draft = await client.readDraft(ctx.conversationId);
    if (!draftQueues.has(ctx.conversationId))
      drafts.set(ctx.conversationId, { ...draft, ready: true });
    if (matches(ctx)) notify();
    return getSnapshot();
  }
  async function query(ctx, action, input) {
    const result = await client.query({
      operationId: operationId(),
      action,
      input: { conversationId: ctx.conversationId, ...input },
    });
    return result.result;
  }
  async function refresh() {
    const ctx = await prepare();
    const ticket = await client.beginInbox(ctx.conversationId);
    await localSnapshot(ctx);
    try {
      await client.sync();
      const details = await query(ctx, 'conversation-read', {});
      if (details.conversationId !== ctx.conversationId) fail('ROOM_MAPPING_MISMATCH');
      let after,
        more = true,
        pages = 0;
      const messages = [],
        redactions = [];
      while (more) {
        const feed = await query(ctx, 'conversation-feed', {
          limit: 100,
          ...(after ? { after } : {}),
        });
        if (feed.conversationId !== ctx.conversationId) fail('ROOM_MAPPING_MISMATCH');
        messages.push(...(feed.messages || []));
        redactions.push(...(feed.redactions || []));
        after = feed.next;
        more = feed.hasMore;
        if (++pages > 1000) fail('HISTORY_PAGE_LIMIT');
      }
      await client.replaceInbox(ticket, { details, messages, redactions });
    } catch (error) {
      if (callbacks.onError) callbacks.onError(error);
    }
    await localSnapshot(ctx);
    return getSnapshot();
  }
  async function setDraft(text, replyId = undefined) {
    const ctx = await prepare();
    if (typeof text !== 'string') fail('INVALID_DRAFT');
    const quoted =
      replyId === undefined ? (drafts.get(ctx.conversationId)?.replyId ?? null) : replyId;
    if (quoted !== null && typeof quoted !== 'string') fail('INVALID_REPLY_ID');
    drafts.set(ctx.conversationId, { text, replyId: quoted, ready: true });
    if (matches(ctx)) notify();
    const tail = (draftQueues.get(ctx.conversationId) || Promise.resolve())
      .catch(() => {})
      .then(() => client.setDraft(ctx.conversationId, { text, replyId: quoted }));
    draftQueues.set(ctx.conversationId, tail);
    try {
      const saved = await tail;
      if (draftQueues.get(ctx.conversationId) === tail)
        drafts.set(ctx.conversationId, { ...saved, ready: true });
      return saved;
    } finally {
      if (draftQueues.get(ctx.conversationId) === tail) draftQueues.delete(ctx.conversationId);
    }
  }
  function checkOwner(ctx) {
    const owner = cache.get(ctx.conversationId)?.messageOwner ?? ctx.messageOwner ?? 'legacy';
    if (owner !== 'legacy' && owner !== 'conversation-services-v1')
      fail('MESSAGE_OWNER_UNSUPPORTED');
    return owner;
  }
  function kick() {
    if (callbacks.autoSync !== false)
      void client
        .sync()
        .then(() => refresh())
        .catch((error) => callbacks.onError?.(error));
  }
  async function sendText(text, replyId = null, options = {}) {
    const ctx = await prepare();
    if (!enabled || !matches(ctx)) fail('ROOM_CHANGED');
    if (typeof text !== 'string' || (!text.trim() && !(options.attachments || []).length))
      fail('EMPTY_MESSAGE');
    if (replyId !== null && !decimal(replyId)) {
      const history = cache
        .get(ctx.conversationId)
        ?.messages.find((m) => m.id === replyId && m.kind === 'history' && m.state === 'active');
      if (!history?.commentTarget) fail('INVALID_REPLY_ID');
      if (options.attachments?.length) fail('HISTORY_COMMENT_MEDIA_UNSUPPORTED');
      return sendComment(text, history.commentTarget, {
        replyId,
        operationId: options.operationId,
      });
    }
    await (draftQueues.get(ctx.conversationId) || Promise.resolve());
    const draft = await client.readDraft(ctx.conversationId);
    const op = options.operationId || operationId(),
      id = options.id || String(BigInt('0x' + op.replaceAll('-', '')) % 100000000000000000000n);
    if (!decimal(id)) fail('INVALID_MESSAGE_ID');
    const sentAt = options.sentAt || new Date().toISOString();
    if (!Number.isFinite(Date.parse(sentAt))) fail('INVALID_SENT_AT');
    for (const field of ['replacementOf', 'replacementRootId'])
      if (options[field] !== undefined && !decimal(options[field])) fail('INVALID_REPLACEMENT_ID');
    const message = {
      id,
      sentAt,
      text,
      attachments: [...(options.attachments || [])],
      ...(replyId ? { replyTo: replyId } : {}),
      ...(options.replacementOf ? { replacementOf: options.replacementOf } : {}),
      ...(options.replacementRootId ? { replacementRootId: options.replacementRootId } : {}),
    };
    const snapshot = cache.get(ctx.conversationId)?.messages || [];
    if (snapshot.some((m) => m.id === id && m.kind === 'withdrawn')) fail('MESSAGE_WITHDRAWN');
    const owner = checkOwner(ctx);
    if (owner !== 'legacy') fail('UNIFIED_OWNER_ADAPTER_REQUIRED');
    await client.enqueue({
      operationId: op,
      action: 'journal-send',
      input: { sourceId: ctx.sourceId, roomId: ctx.legacyRoomId, messages: [message] },
      optimistic: [
        {
          entityType: 'local-chat-message',
          entityId: JSON.stringify([ctx.conversationId, id]),
          changes: { ...message, conversationId: ctx.conversationId },
        },
      ],
      ...(draft.text === text && draft.replyId === replyId
        ? { draftClear: { scope: ctx.conversationId, expectedRevision: draft.revision } }
        : {}),
    });
    await localSnapshot(ctx);
    kick();
    return {
      committed: true,
      localAck: true,
      serverConfirmed: false,
      operationId: op,
      messageId: id,
      roomId: ctx.roomId,
      sentAt,
    };
  }
  async function withdraw(id, options = {}) {
    const ctx = await prepare();
    if (!decimal(id)) fail('INVALID_MESSAGE_ID');
    if (checkOwner(ctx) !== 'legacy') fail('UNIFIED_OWNER_ADAPTER_REQUIRED');
    const op = operationId();
    const revisions = cache.get(ctx.conversationId)?.messageRevisions || {};
    const expectedRevision = options.expectedRevision ?? revisions[id];
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
      fail('MESSAGE_REVISION_REQUIRED');
    await client.enqueue({
      operationId: op,
      action: 'journal-withdraw',
      input: {
        sourceId: ctx.sourceId,
        roomId: ctx.legacyRoomId,
        messageId: id,
        operationId: op,
        expectedRevision,
      },
      optimistic: [
        {
          entityType: 'local-chat-message',
          entityId: JSON.stringify([ctx.conversationId, id]),
          changes: {
            id,
            conversationId: ctx.conversationId,
            sentAt:
              cache.get(ctx.conversationId)?.messages.find((m) => m.id === id)?.sentAt || null,
            withdrawn: true,
          },
        },
      ],
    });
    await localSnapshot(ctx);
    kick();
    return {
      committed: true,
      localAck: true,
      serverConfirmed: false,
      operationId: op,
      messageId: id,
    };
  }
  async function edit(id, text, options = {}) {
    const ctx = await prepare();
    if (!enabled || !matches(ctx)) fail('ROOM_CHANGED');
    if (typeof client.editMessage !== 'function') fail('SHARED_MESSAGE_EDIT_UNAVAILABLE');
    const result = await client.editMessage({
      conversationId: ctx.conversationId,
      messageId: id,
      text,
      operationId: options.operationId || operationId(),
      ...(options.attachments !== undefined ? { attachments: options.attachments } : {}),
      ...(options.expectedLocalRevision !== undefined
        ? { expectedLocalRevision: options.expectedLocalRevision }
        : {}),
    });
    await localSnapshot(ctx);
    kick();
    return { committed: true, roomId: ctx.roomId, ...result };
  }
  async function withdrawRoot(id, options = {}) {
    const ctx = await prepare();
    if (!enabled || !matches(ctx)) fail('ROOM_CHANGED');
    if (typeof client.withdrawMessage !== 'function') fail('SHARED_MESSAGE_EDIT_UNAVAILABLE');
    const result = await client.withdrawMessage({
      conversationId: ctx.conversationId,
      messageId: id,
      operationId: options.operationId || operationId(),
    });
    await localSnapshot(ctx);
    kick();
    return { committed: true, roomId: ctx.roomId, ...result };
  }
  async function sendFiles(files, replyId = null, options = {}) {
    const ctx = await prepare(),
      list = Array.from(files || []);
    if (!list.length || list.length > 50) fail('MEDIA_BATCH_INVALID');
    if (callbacks.uploadJobs) {
      if (!enabled || !matches(ctx)) fail('ROOM_CHANGED');
      if (checkOwner(ctx) !== 'legacy') fail('UNIFIED_OWNER_ADAPTER_REQUIRED');
      if (replyId !== null && !decimal(replyId)) fail('HISTORY_COMMENT_MEDIA_UNSUPPORTED');
      const text = options.text ?? '';
      if (typeof text !== 'string') fail('INVALID_MESSAGE_TEXT');
      await (draftQueues.get(ctx.conversationId) || Promise.resolve());
      const draft = await client.readDraft(ctx.conversationId);
      const job = await callbacks.uploadJobs.enqueue({
        conversationId: ctx.conversationId,
        sourceId: ctx.sourceId,
        roomId: ctx.legacyRoomId,
        text,
        replyTo: replyId,
        operationId: options.operationId,
        messageId: options.messageId,
        sentAt: options.sentAt,
        attachments: list.map((file) =>
          file instanceof Blob ? { blob: file, name: file.name, mime: file.type } : file,
        ),
        ...(draft.text === text && draft.replyId === replyId
          ? { draftClear: { scope: ctx.conversationId, expectedRevision: draft.revision } }
          : {}),
      });
      await localSnapshot(ctx);
      if (callbacks.autoSync !== false)
        void callbacks.uploadJobs.start().catch((error) => callbacks.onError?.(error));
      return {
        committed: true,
        localAck: true,
        serverConfirmed: false,
        operationId: job.operationId,
        messageId: job.messageId,
        roomId: ctx.roomId,
        sentAt: job.sentAt,
        uploadState: job.status,
      };
    }
    if (typeof callbacks.uploadFiles !== 'function') fail('MEDIA_UPLOAD_UNAVAILABLE');
    const result = await callbacks.uploadFiles(list, copy(ctx));
    if (!matches(ctx) || !enabled) fail('ROOM_CHANGED');
    if (
      !Array.isArray(result) ||
      result.length !== list.length ||
      result.some((id) => typeof id !== 'string' || !id || !/^[-A-Za-z0-9_]{1,128}$/.test(id))
    )
      fail('MEDIA_UPLOAD_ACK_INVALID');
    return sendText('', replyId, { attachments: result });
  }
  async function sendComment(text, target, options = {}) {
    const ctx = await prepare(),
      op = options.operationId || operationId();
    if (
      !target ||
      typeof target !== 'object' ||
      typeof target.instanceId !== 'string' ||
      typeof target.batchId !== 'string'
    )
      fail('COMMENT_FIXED_TARGET_REQUIRED');
    await (draftQueues.get(ctx.conversationId) || Promise.resolve());
    const draft = await client.readDraft(ctx.conversationId);
    await client.enqueue({
      operationId: op,
      action: 'conversation-send',
      input: {
        conversationId: ctx.conversationId,
        operationId: op,
        kind: 'comment',
        text,
        displayedTarget: copy(target),
      },
      ...(draft.text === text && draft.replyId === (options.replyId ?? null)
        ? { draftClear: { scope: ctx.conversationId, expectedRevision: draft.revision } }
        : {}),
    });
    await localSnapshot(ctx);
    kick();
    return {
      committed: true,
      localAck: true,
      serverConfirmed: false,
      operationId: op,
      roomId: ctx.roomId,
    };
  }
  async function getMedia(input) {
    const ctx = await prepare();
    const message =
      typeof input === 'string'
        ? cache.get(ctx.conversationId)?.messages.find((m) => m.id === input)
        : input;
    if (
      !callbacks.readMedia ||
      !message ||
      message.kind === 'withdrawn' ||
      message.roomId !== ctx.roomId
    )
      fail('MEDIA_UNAVAILABLE');
    const result = await callbacks.readMedia(copy(message), copy(ctx));
    if (!matches(ctx)) fail('ROOM_CHANGED');
    return result;
  }
  return {
    getSnapshot,
    getDraft,
    getContext: context,
    refresh,
    async refreshLocal() {
      const ctx = context();
      return ctx ? localSnapshot(ctx) : getSnapshot();
    },
    setDraft,
    sendText,
    edit,
    withdrawRoot,
    sendFiles,
    async retryUpload(operationId) {
      const ctx = await prepare(),
        job = await callbacks.uploadJobs?.read(operationId);
      if (!job || job.conversationId !== ctx.conversationId) fail('SHARED_UPLOAD_JOB_NOT_FOUND');
      const result = await callbacks.uploadJobs.retry(operationId);
      await localSnapshot(ctx);
      return result;
    },
    async cancelUpload(operationId) {
      const ctx = await prepare(),
        job = await callbacks.uploadJobs?.read(operationId);
      if (!job || job.conversationId !== ctx.conversationId) fail('SHARED_UPLOAD_JOB_NOT_FOUND');
      const result = await callbacks.uploadJobs.cancel(operationId);
      await localSnapshot(ctx);
      return result;
    },
    sendSticker: (file, replyId) => sendFiles([file], replyId),
    saveSticker: (...args) => {
      if (typeof callbacks.saveSticker !== 'function') fail('STICKER_COLLECTION_UNAVAILABLE');
      return callbacks.saveSticker(...args);
    },
    settings: (...args) => {
      if (typeof callbacks.settings !== 'function') fail('SETTINGS_UNAVAILABLE');
      return callbacks.settings(...args);
    },
    openStickers: (...args) => {
      if (typeof callbacks.openStickers !== 'function') fail('STICKER_PANEL_UNAVAILABLE');
      return callbacks.openStickers(...args);
    },
    withdraw,
    subscribe(listener) {
      listeners.add(listener);
      listener(getSnapshot());
      schedule();
      return () => {
        listeners.delete(listener);
        schedule();
      };
    },
    async flush() {
      await Promise.all([...draftQueues.values()]);
      return { flushed: true, storage: 'shared-business', serverConfirmed: false };
    },
    async receipts(ids) {
      const ctx = await prepare();
      if (!Array.isArray(ids) || ids.some((id) => !decimal(id))) fail('INVALID_MESSAGE_ID');
      return query(ctx, 'journal-receipts', {
        sourceId: ctx.sourceId,
        roomId: ctx.legacyRoomId,
        ids,
      });
    },
    async conversationContext(target) {
      const ctx = await prepare();
      return query(ctx, 'conversation-context', { displayedTarget: copy(target) });
    },
    sendComment,
    getMedia,
    openMedia: getMedia,
    loadOlder: refresh,
    setActive(active) {
      enabled = !!active;
      schedule();
      if (enabled) void refresh().catch((error) => callbacks.onError?.(error));
    },
    dispose() {
      disposed = true;
      enabled = false;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      listeners.clear();
    },
  };
}
