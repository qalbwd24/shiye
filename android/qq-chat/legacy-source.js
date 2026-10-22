/** Legacy worker/IDB owner adapter. No Telegram DOM, new database or second writer.
 * All writes use real Web A actions; acknowledgements require readLibrary's committed
 * records AND the injected worker writeQueue flush. ProductRepository may later
 * implement this same renderer-facing contract after its authority migration.
 */
export function createLegacyChatSource(callbacks = {}) {
  for (const key of ['currentId', 'readLibrary', 'flush'])
    if (typeof callbacks[key] !== 'function') throw new Error(`QQ_SOURCE_${key}_REQUIRED`);
  const host = callbacks.host || globalThis.window || globalThis;
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const timeoutMs = callbacks.timeoutMs ?? 12000;
  const listeners = new Set();
  const draftIntents = new Map();
  const urls = new Map();
  let disposed = false,
    enabled = true,
    timer,
    version = 0,
    signature;
  let library,
    sawLibrary = false,
    absentLibrary = false,
    readPromise,
    dirty = true,
    dirtyStamp = 0;
  let draftQueue = Promise.resolve(),
    sendTask = null,
    attempt,
    recovered,
    toolsPromise;
  let lastRoom = null;
  const historyPageSize = 80;
  let history = {
    scope: null,
    firstId: null,
    firstDate: null,
    start: 0,
    order: [],
    loading: false,
  };
  const global = () => host.getGlobal?.() || {};
  const actions = () => host.getActions?.() || {};
  const room = () => {
    const id = callbacks.currentId();
    return id == null || id === '' ? null : String(id);
  };
  const contextVersion = () => callbacks.contextVersion?.() ?? 0;
  function failure(code, message, extras) {
    return Object.assign(new Error(message), { code, uncertain: false, locked: false, ...extras });
  }
  function context() {
    if (disposed) throw failure('DISPOSED', '聊天页面已经关闭');
    const id = room(),
      state = global();
    const candidates = Object.entries(state.byTabId || {}).filter(
      ([, tab]) => String(tab.messageLists?.at(-1)?.chatId) === id,
    );
    if (!id || candidates.length !== 1) throw failure('CHAT_CONTEXT_REQUIRED', '请先打开一个会话');
    const [tabId, tab] = candidates[0],
      list = tab.messageLists.at(-1);
    const local = state.messages?.byChatId?.[id]?.threadsById?.[list.threadId]?.localState;
    if (
      list.type === 'scheduled' ||
      local?.editingId ||
      local?.editingScheduledId ||
      tab.forwardMessages?.messageIds?.length
    )
      throw failure('UNFINISHED_OPERATION', '请先完成当前消息编辑或转发');
    return { roomId: id, tabId, messageList: { ...list }, version: contextVersion() };
  }
  function stillCurrent(ctx) {
    try {
      const current = context();
      return (
        current.roomId === ctx.roomId &&
        current.tabId === ctx.tabId &&
        current.version === ctx.version &&
        current.messageList.threadId === ctx.messageList.threadId
      );
    } catch {
      return false;
    }
  }
  function requireCurrent(ctx) {
    if (!stillCurrent(ctx)) throw failure('CHAT_CONTEXT_CHANGED', '会话已经改变，请重新确认后发送');
  }
  function legacyId(id) {
    if (id == null || id === '') return undefined;
    const value = Number(id);
    if (!Number.isSafeInteger(value) || value < 1 || String(value) !== String(id))
      throw failure('LEGACY_ID_MAPPING_REQUIRED', '当前消息编号无法安全映射，请保留原消息');
    return value;
  }
  function localState(ctx) {
    return (
      global().messages?.byChatId?.[ctx.roomId]?.threadsById?.[ctx.messageList.threadId]
        ?.localState || {}
    );
  }
  function rawDraft(ctx) {
    return localState(ctx).draft;
  }
  function draftText(draft) {
    return typeof draft?.text === 'string' ? draft.text : draft?.text?.text || '';
  }
  function draftKey(ctx) {
    return JSON.stringify([ctx.roomId, ctx.messageList.threadId]);
  }
  function getDraft() {
    let ctx;
    try {
      ctx = context();
    } catch {
      return { roomId: room(), text: '', replyId: null };
    }
    const value = rawDraft(ctx),
      optimistic = draftIntents.get(draftKey(ctx)),
      dialog = [...(library?.dialogs?.active || []), ...(library?.dialogs?.archived || [])].find(
        (item) => String(item.id) === ctx.roomId,
      ),
      saved = dialog?.draft,
      localPending = optimistic && !optimistic.committed,
      savedReply = saved?.replyTo?.replyToMsgId,
      projectedReply = value?.replyInfo?.replyToMsgId;
    return {
      roomId: ctx.roomId,
      text: localPending ? optimistic.text : dialog ? saved?.message || '' : draftText(value),
      replyId: localPending
        ? optimistic.replyId
        : dialog
          ? savedReply == null
            ? null
            : String(savedReply)
          : projectedReply == null
            ? null
            : String(projectedReply),
      ready: !!localPending || !!dialog || absentLibrary,
      hasRichContent: !!value?.richMessage,
    };
  }
  function applyReply(ctx, replyId) {
    requireCurrent(ctx);
    const id = legacyId(replyId),
      api = actions();
    if (id !== undefined) {
      if (!global().messages?.byChatId?.[ctx.roomId]?.byId?.[id])
        throw failure('REPLY_NOT_FOUND', '引用的消息已经不存在');
      if (typeof api.updateDraftReplyInfo !== 'function')
        throw failure('ACTIONS_NOT_READY', '引用接口尚未准备好');
      api.updateDraftReplyInfo({ tabId: ctx.tabId, replyToMsgId: id });
    } else {
      if (typeof api.resetDraftReplyInfo !== 'function')
        throw failure('ACTIONS_NOT_READY', '引用接口尚未准备好');
      api.resetDraftReplyInfo({ tabId: ctx.tabId });
    }
  }
  async function committedLibrary(force = false, allowAbsent = false) {
    if (!force && !dirty && (library || absentLibrary)) {
      if (!library && !allowAbsent)
        throw failure('LOCAL_LIBRARY_UNAVAILABLE', '本地消息尚未准备好');
      return library || null;
    }
    if (!readPromise) {
      const stamp = dirtyStamp;
      readPromise = Promise.resolve(callbacks.readLibrary())
        .then((value) => {
          // A successful read of an absent key is a known fresh-worker state:
          // loadLocalPreview returns its in-memory seed without persisting it.
          // Never convert a failed read, malformed value or disappeared old key
          // into an empty library. Only the existing owner can initialize it.
          if (value === undefined) {
            if (sawLibrary)
              throw failure('LOCAL_LIBRARY_DISAPPEARED', '原本地消息存储已改变，请保留资料并核对');
            absentLibrary = true;
            if (stamp === dirtyStamp) dirty = false;
            return null;
          }
          if (
            !value ||
            typeof value !== 'object' ||
            Array.isArray(value) ||
            !value.messages ||
            typeof value.messages !== 'object' ||
            !Array.isArray(value.documents)
          )
            throw failure('LOCAL_LIBRARY_UNAVAILABLE', '本地消息尚未准备好');
          library = value;
          sawLibrary = true;
          absentLibrary = false;
          if (stamp === dirtyStamp) dirty = false;
          return value;
        })
        .finally(() => {
          readPromise = null;
        });
    }
    const value = await readPromise;
    if (!value && !allowAbsent) throw failure('LOCAL_LIBRARY_UNAVAILABLE', '本地消息尚未准备好');
    return value;
  }
  async function ownerFlush() {
    const receipt = await callbacks.flush();
    if (receipt?.flushed !== true)
      throw failure('LOCAL_COMMIT_UNCONFIRMED', '本地事务尚未确认，请保留当前输入');
    return receipt;
  }
  function invalidate() {
    dirty = true;
    dirtyStamp++;
  }
  async function waitCommitted(check) {
    const started = Date.now();
    for (;;) {
      const saved = await committedLibrary(true, true),
        result = saved ? check(saved) : null;
      if (result) {
        await ownerFlush();
        return result;
      }
      if (Date.now() - started >= timeoutMs)
        throw failure('LOCAL_COMMIT_TIMEOUT', '本地保存尚未确认，请保留输入并核对消息');
      await delay(100);
    }
  }
  function storedDraft(saved, ctx) {
    return [...(saved.dialogs?.active || []), ...(saved.dialogs?.archived || [])].find(
      (dialog) => String(dialog.id) === ctx.roomId,
    )?.draft;
  }
  function setDraft(text, replyId) {
    const ctx = context();
    if (typeof text !== 'string') throw failure('INVALID_DRAFT', '草稿内容无效');
    if (rawDraft(ctx)?.richMessage)
      throw failure('RICH_DRAFT_UNSUPPORTED', '此草稿含富文本结构，请先保留原草稿');
    if (replyId !== undefined) applyReply(ctx, replyId);
    else {
      const authority = getDraft(),
        projected = rawDraft(ctx)?.replyInfo?.replyToMsgId;
      if (authority.ready && authority.replyId !== (projected == null ? null : String(projected)))
        applyReply(ctx, authority.replyId);
    }
    return enqueueDraft(ctx, text);
  }
  function enqueueDraft(ctx, text) {
    const key = draftKey(ctx),
      prior = draftIntents.get(key);
    const reply = rawDraft(ctx)?.replyInfo?.replyToMsgId;
    const intent = {
      ctx,
      text,
      replyId: reply == null ? null : String(reply),
      serial: (prior?.serial || 0) + 1,
      committed: false,
    };
    draftIntents.set(key, intent);
    if (recovered?.ctx.roomId === ctx.roomId && text !== recovered.text) recovered = null;
    changed();
    const task = draftQueue
      .catch(() => {})
      .then(async () => {
        if (draftIntents.get(key) !== intent) return { superseded: true, roomId: ctx.roomId };
        const api = actions();
        if (text) {
          if (typeof api.saveDraft !== 'function')
            throw failure('ACTIONS_NOT_READY', '草稿接口尚未准备好');
          // Explicit chat/thread: a queued save can never pick up a newly opened room.
          api.saveDraft({
            chatId: ctx.roomId,
            threadId: ctx.messageList.threadId,
            text: { text, entities: [] },
          });
        } else {
          if (typeof api.clearDraft !== 'function')
            throw failure('ACTIONS_NOT_READY', '草稿接口尚未准备好');
          api.clearDraft({
            chatId: ctx.roomId,
            threadId: ctx.messageList.threadId,
            shouldKeepReply: true,
            shouldKeepSuggestedPost: true,
          });
        }
        invalidate();
        await waitCommitted((saved) => {
          const stored = storedDraft(saved, ctx);
          const storedReply = stored?.replyTo?.replyToMsgId;
          return (
            (stored?.message || '') === text &&
            (draftIntents.get(key) !== intent ||
              (storedReply == null ? null : String(storedReply)) === intent.replyId)
          );
        });
        intent.committed = true;
        changed();
        return { committed: true, roomId: ctx.roomId, text, storage: 'legacy-idb' };
      });
    draftQueue = task;
    return task;
  }
  function releaseUrls() {
    for (const value of urls.values()) URL.revokeObjectURL(value.url);
    urls.clear();
  }
  function mediaInfo(message, lookup) {
    const content = message?.content || {};
    const asset =
      content.photo ||
      content.video ||
      content.document ||
      content.audio ||
      content.voice ||
      content.sticker;
    const raw = lookup.raw(message.id);
    const mediaId = asset?.id ?? raw?.media?.id;
    const document = lookup.document(mediaId);
    const mime =
      document?.mimeType ||
      asset?.mimeType ||
      (content.photo ? 'image/jpeg' : 'application/octet-stream');
    const name =
      document?.attributes?.find(
        (item) =>
          item.shiyeType === 'DocumentAttributeFilename' ||
          item.className === 'DocumentAttributeFilename',
      )?.fileName ||
      asset?.fileName ||
      document?.name ||
      (mediaId != null ? `附件-${mediaId}` : '附件');
    return {
      mediaId: mediaId == null ? null : String(mediaId),
      mime,
      name,
      size: Number(document?.bytes?.byteLength ?? document?.size ?? asset?.size ?? 0),
      asset,
      document,
    };
  }
  function normalize(message, id, lookup) {
    const data = { ...message, chatId: id },
      info = mediaInfo(data, lookup),
      action = message.content?.action;
    const withdrawn = action?.type === 'customAction' && /撤回/.test(action.message || '');
    return {
      id: String(message.id),
      roomId: id,
      text: withdrawn
        ? ''
        : typeof message.content?.text === 'string'
          ? message.content.text
          : message.content?.text?.text || '',
      entities: message.content?.text?.entities || [],
      outgoing: !!message.isOutgoing,
      date: message.date,
      replyId:
        message.replyInfo?.replyToMsgId == null ? null : String(message.replyInfo.replyToMsgId),
      kind: withdrawn
        ? 'withdrawn'
        : !info.mediaId
          ? 'text'
          : info.mime.startsWith('image/')
            ? 'image'
            : info.mime.startsWith('video/')
              ? 'video'
              : 'file',
      name: info.name,
      mime: info.mime,
      size: info.size,
      mediaId: info.mediaId,
      sendingState: message.sendingState || null,
      previousLocalId: message.previousLocalId == null ? null : String(message.previousLocalId),
      readOnly: !!message.shiyeProgram || !!message.content?.action,
    };
  }
  function getSnapshot() {
    const id = room(),
      state = global(),
      byId = state.messages?.byChatId?.[id]?.byId || {};
    if (lastRoom !== id) {
      releaseUrls();
      lastRoom = id;
    }
    const entries = new Map(
      Object.values(byId).map((message) => [
        String(message.id),
        {
          id: String(message.id),
          date: message.date,
          message,
        },
      ]),
    );
    // Committed tombstones override stale global bodies and preserve durable identities.
    for (const item of library?.shiyeWithdrawnMessages || []) {
      if (String(item.roomId) !== id) continue;
      const tombstone = {
        id: String(item.messageId),
        roomId: id,
        kind: 'withdrawn',
        text: '',
        outgoing: true,
        date: Date.parse(item.sentAt || item.requestedAt) / 1000,
        replyId: null,
        mediaId: null,
      };
      entries.set(tombstone.id, { id: tombstone.id, date: tombstone.date, tombstone });
      if (
        recovered?.ctx.roomId === id &&
        recovered.receipt?.messageIds?.includes(String(item.messageId))
      )
        recovered = null;
      const key = `${id}:${item.messageId}`;
      if (urls.has(key)) {
        URL.revokeObjectURL(urls.get(key).url);
        urls.delete(key);
      }
    }
    // The worker may publish its committed ID before retiring the local send.
    // Its explicit previousLocalId is the identity link; message text is never
    // an identity key, since two real sends may have identical content.
    for (const entry of entries.values()) {
      const previous = entry.message?.previousLocalId;
      if (previous == null || !entry.message.isOutgoing || String(entry.message.chatId) !== id)
        continue;
      const localId = Number(previous);
      if (!Number.isFinite(localId) || Number.isInteger(localId)) continue;
      const predecessor = entries.get(String(previous));
      if (
        predecessor?.message?.isOutgoing &&
        String(predecessor.message.chatId) === id &&
        predecessor.id !== entry.id
      )
        entries.delete(predecessor.id);
    }
    const ordered = [...entries.values()].sort((a, b) => a.date - b.date || compareIds(a.id, b.id));
    const scope = JSON.stringify([id, contextVersion()]);
    if (history.scope !== scope)
      history = { scope, firstId: null, firstDate: null, start: 0, order: [], loading: false };
    let start =
      history.firstId == null
        ? -1
        : ordered.findIndex(
            (entry) =>
              entry.id === history.firstId ||
              String(entry.message?.previousLocalId) === history.firstId,
          );
    if (start < 0) {
      // A retired optimistic identity or deleted anchor may disappear. Choose
      // its nearest successor without changing any persisted order/identity.
      if (history.firstDate != null)
        start = ordered.findIndex((entry) => entry.date >= history.firstDate);
      if (start < 0) start = Math.max(0, ordered.length - historyPageSize);
    }
    history.start = start;
    history.firstId = ordered[start]?.id ?? null;
    history.firstDate = ordered[start]?.date ?? null;
    history.order = ordered;
    // Index only within this projection. No cross-read retention or assumptions about
    // mutable owner objects: the next snapshot always sees fresh messages/media.
    const index = (values) => {
      const result = new Map();
      for (const item of values || []) {
        const key = String(item.id);
        if (!result.has(key)) result.set(key, item); // Preserve Array.find's first match.
      }
      return result;
    };
    let rawIndex, documentIndex;
    const lookup = {
      raw: (key) => (rawIndex ||= index(library?.messages?.[id])).get(String(key)),
      document: (key) => (documentIndex ||= index(library?.documents)).get(String(key)),
    };
    const messages = ordered
      .slice(start)
      .map((entry) => entry.tombstone || normalize(entry.message, id, lookup));
    return {
      roomId: id,
      inConversation: !!id,
      title: state.chats?.byId?.[id]?.title || library?.shiyeRooms?.[id]?.title || '随想',
      version,
      messages,
      hasOlder: start > 0,
      loadingOlder: history.loading,
      totalMessages: ordered.length,
      historySource: 'legacy-global-full-history',
      appearance: callbacks.appearance?.(id) || {},
      draft: getDraft(),
      sendState: {
        pending: !!sendTask && !attempt?.uncertain,
        locked: !!attempt || !!sendTask,
        uncertain: !!attempt?.uncertain,
      },
      storage: 'legacy-idb',
      productAuthorityMigrated: false,
    };
  }
  function changed() {
    version++;
    if (!enabled || disposed) return;
    const snapshot = getSnapshot();
    for (const listener of listeners) {
      try {
        listener(snapshot);
      } catch {
        /* observer cannot change committed writes */
      }
    }
  }
  function compareIds(a, b) {
    if (/^-?\d+$/.test(a) && /^-?\d+$/.test(b))
      return BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0;
    return a.localeCompare(b);
  }
  async function loadOlder() {
    const ctx = context();
    getSnapshot();
    const target = history;
    if (target.loading) return { roomId: ctx.roomId, loading: true };
    if (!target.start) return { roomId: ctx.roomId, loaded: 0, hasOlder: false };
    target.loading = true;
    changed();
    try {
      await Promise.resolve();
      requireCurrent(ctx);
      if (history !== target)
        throw failure('CHAT_CONTEXT_CHANGED', '会话已经改变，请重新查看更早消息');
      const start = Math.max(0, target.start - historyPageSize);
      const loaded = target.start - start;
      target.firstId = target.order[start]?.id ?? null;
      target.firstDate = target.order[start]?.date ?? null;
      target.start = start;
      return { roomId: ctx.roomId, loaded, hasOlder: start > 0 };
    } finally {
      target.loading = false;
      if (history === target) changed();
    }
  }
  function failedGlobal(ctx) {
    return Object.values(global().messages?.byChatId?.[ctx.roomId]?.byId || {}).some(
      (message) =>
        !attempt?.beforeGlobal?.has(String(message.id)) &&
        message.sendingState === 'messageSendingStateFailed',
    );
  }
  function matchAttempt(saved, current) {
    const candidates = (saved.messages?.[current.ctx.roomId] || []).filter(
      (message) =>
        !current.beforeIds.has(String(message.id)) &&
        !!message.out &&
        !saved.shiyeWithdrawnMessages?.some(
          (item) =>
            item.roomId === current.ctx.roomId && String(item.messageId) === String(message.id),
        ),
    );
    if (!current.files) {
      const found = candidates.find(
        (message) =>
          (message.message || '') === current.text &&
          !message.media &&
          (message.replyToMsgId == null ? null : String(message.replyToMsgId)) === current.replyId,
      );
      return found ? [found] : null;
    }
    const matched = [],
      used = new Set();
    for (const expected of current.files) {
      const found = candidates.find((message) => {
        if (used.has(String(message.id)) || !message.media) return false;
        const asset = saved.documents?.find(
          (value) => String(value.id) === String(message.media.id),
        );
        const bytes = bytesOf(asset?.bytes);
        return (
          bytes &&
          bytes.length === expected.bytes.length &&
          (asset.mimeType || 'application/octet-stream') === expected.mime &&
          bytes.every((value, index) => value === expected.bytes[index])
        );
      });
      if (!found) return null;
      matched.push(found);
      used.add(String(found.id));
    }
    return matched;
  }
  async function confirmAttempt(current) {
    const found = await waitCommitted((saved) => {
      const matched = matchAttempt(saved, current);
      if (!matched && failedGlobal(current.ctx))
        throw failure('SEND_FAILED', '消息发送未完成，请保留原内容并检查发送状态');
      return matched;
    });
    const receipt = {
      committed: true,
      flushed: true,
      roomId: current.ctx.roomId,
      messageIds: found.map((message) => String(message.id)),
      messageId: String(found[0].id),
      storage: 'legacy-idb',
    };
    current.receipt = receipt;
    // Applies to late reconciliation too: the mock send clears the persisted
    // dialog draft even when an independent file panel sends without its text.
    const latest = draftIntents.get(draftKey(current.ctx));
    if (current.files || (latest && latest.serial > current.initialDraftSerial)) {
      try {
        await enqueueDraft(current.ctx, latest?.text ?? current.preservedDraft);
      } catch (error) {
        receipt.draftPending = true;
        receipt.draftError = error.code || 'DRAFT_SAVE_FAILED';
      }
    }
    if (current.uncertain) recovered = { ...current, receipt };
    if (attempt === current) attempt = null;
    changed();
    return receipt;
  }
  async function runSend(ctx, text, replyId, files) {
    if (attempt || sendTask)
      throw failure('SEND_LOCKED', '上一条消息的保存状态尚未确认，请先核对聊天记录', {
        uncertain: !!attempt?.uncertain,
        locked: true,
      });
    if (
      recovered &&
      !files &&
      recovered.ctx.roomId === ctx.roomId &&
      recovered.text === text &&
      recovered.replyId === replyId
    ) {
      const receipt = recovered.receipt;
      recovered = null;
      return receipt;
    }
    if (rawDraft(ctx)?.richMessage)
      throw failure('RICH_DRAFT_UNSUPPORTED', '此草稿含富文本结构，请先保留原草稿');
    const current = {
      ctx,
      text,
      replyId,
      files: null,
      submitted: false,
      uncertain: false,
      initialDraftSerial: draftIntents.get(draftKey(ctx))?.serial || 0,
      preservedDraft: draftText(rawDraft(ctx)),
    };
    attempt = current;
    changed();
    let built = [];
    try {
      await draftQueue;
      requireCurrent(ctx);
      const before = await committedLibrary(true, true);
      requireCurrent(ctx);
      current.beforeIds = new Set(
        (before?.messages?.[ctx.roomId] || []).map((message) => String(message.id)),
      );
      current.beforeGlobal = new Set(
        Object.keys(global().messages?.byChatId?.[ctx.roomId]?.byId || {}),
      );
      for (const id of current.beforeGlobal) current.beforeIds.add(id);
      let attachments;
      if (files) {
        const tools = await attachmentTools();
        current.files = [];
        for (const original of files) {
          const bytes = new Uint8Array(await original.arrayBuffer());
          if (!bytes.length) throw failure('EMPTY_FILE', '所选文件没有可读取的原件');
          const mime = original.type || 'application/octet-stream';
          const file = new File([bytes], original.name || '附件', {
            type: mime,
            lastModified: original.lastModified,
          });
          if (original.shiyeOriginalSticker === true) file.shiyeOriginalSticker = true;
          const attachment = await tools.shiyePrepareAttachment(
            await tools.qt(file.name, file, { shouldSendAsFile: true }),
          );
          built.push(attachment);
          current.files.push({ bytes, mime });
          requireCurrent(ctx);
        }
        attachments = tools.shiyePrepareAttachmentsToSend(built, false);
        if (
          recovered?.ctx.roomId === ctx.roomId &&
          recovered.replyId === replyId &&
          sameFiles(current.files, recovered.files)
        ) {
          const receipt = recovered.receipt;
          recovered = null;
          attempt = null;
          revokeAttachments(built);
          changed();
          return receipt;
        }
      }
      requireCurrent(ctx);
      applyReply(ctx, replyId);
      if (typeof actions().sendMessage !== 'function')
        throw failure('ACTIONS_NOT_READY', '本地发送连接尚未准备好');
      // Context is fixed before any async preparation; reply action and dispatch are one JS turn.
      current.submitted = true;
      actions().sendMessage({
        messageList: ctx.messageList,
        tabId: ctx.tabId,
        text,
        attachments,
        shouldGroupMessages: false,
      });
      invalidate();
      changed();
      return await confirmAttempt(current);
    } catch (error) {
      if (current.submitted) {
        current.uncertain = true;
        changed();
        throw Object.assign(error, { uncertain: true, locked: true });
      }
      if (attempt === current) attempt = null;
      revokeAttachments(built);
      changed();
      throw error;
    }
  }
  async function attachmentTools() {
    if (!toolsPromise)
      toolsPromise = callbacks.attachmentTools
        ? Promise.resolve(callbacks.attachmentTools)
        : import('../assets/useConnectionStatus-Dy1kHT8L.js');
    return toolsPromise;
  }
  function sendText(text, replyId = null) {
    const ctx = context();
    if (typeof text !== 'string' || !text.trim())
      return Promise.reject(failure('EMPTY_TEXT', '请先写一点内容'));
    legacyId(replyId);
    return trackSend(ctx, text, replyId == null ? null : String(replyId), null);
  }
  function sendFiles(files, replyId = null) {
    const ctx = context(),
      selected = Array.from(files || []);
    if (!selected.length || selected.some((file) => typeof file?.arrayBuffer !== 'function'))
      return Promise.reject(failure('INVALID_FILES', '请先选择文件'));
    legacyId(replyId);
    return trackSend(ctx, '', replyId == null ? null : String(replyId), selected);
  }
  function trackSend(ctx, text, replyId, files) {
    if (sendTask || attempt)
      return Promise.reject(
        failure('SEND_LOCKED', '上一条消息的保存状态尚未确认，请先核对聊天记录', {
          uncertain: !!attempt?.uncertain,
          locked: true,
        }),
      );
    const task = runSend(ctx, text, replyId, files);
    sendTask = task;
    const done = () => {
      if (sendTask === task) sendTask = null;
      changed();
    };
    void task.then(done, done);
    return task;
  }
  async function withdraw(id) {
    const ctx = context(),
      messageId = legacyId(id);
    if (messageId === undefined) throw failure('MESSAGE_REQUIRED', '请选择一条消息');
    if (typeof actions().deleteMessages !== 'function')
      throw failure('ACTIONS_NOT_READY', '撤回接口尚未准备好');
    requireCurrent(ctx);
    actions().deleteMessages({
      messageIds: [messageId],
      shouldDeleteForAll: true,
      messageList: ctx.messageList,
      tabId: ctx.tabId,
    });
    invalidate();
    try {
      await waitCommitted(
        (saved) =>
          saved.shiyeWithdrawnMessages?.some(
            (item) => String(item.roomId) === ctx.roomId && String(item.messageId) === String(id),
          ) &&
          !(saved.messages?.[ctx.roomId] || []).some(
            (message) => String(message.id) === String(id),
          ),
      );
      changed();
      return {
        committed: true,
        flushed: true,
        roomId: ctx.roomId,
        messageId: String(id),
        state: 'withdrawn',
      };
    } catch (error) {
      throw Object.assign(error, { uncertain: true, locked: true });
    }
  }
  async function getMedia(messageOrId) {
    if (disposed) throw failure('DISPOSED', '聊天页面已经关闭');
    const object = messageOrId && typeof messageOrId === 'object';
    const targetRoom = object ? String(messageOrId.roomId ?? room()) : room();
    const id = String(object ? messageOrId.id : messageOrId);
    await committedLibrary();
    if (disposed) throw failure('DISPOSED', '聊天页面已经关闭');
    if (targetRoom !== room())
      throw failure('CHAT_CONTEXT_CHANGED', '会话已经改变，请重新打开附件');
    if (
      library.shiyeWithdrawnMessages?.some(
        (item) => String(item.roomId) === targetRoom && String(item.messageId) === id,
      )
    )
      throw failure('MEDIA_WITHDRAWN', '消息已经撤回');
    const raw = library.messages?.[targetRoom]?.find((item) => String(item.id) === id);
    const mediaId = raw?.media?.id ?? messageOrId?.mediaId;
    const asset =
      library.documents?.find((item) => String(item.id) === String(mediaId)) ||
      library.photos?.find?.((item) => String(item.id) === String(mediaId));
    const bytes = bytesOf(asset?.bytes);
    const originalBlob = asset?.blob instanceof Blob ? asset.blob : null;
    if (!bytes?.byteLength && !originalBlob)
      throw failure('MEDIA_ORIGINAL_MISSING', '附件原件尚未找到，请保留原消息');
    const mime = asset.mimeType || originalBlob?.type || messageOrId?.mime || detectMime(bytes);
    const name =
      asset.attributes?.find(
        (item) =>
          item.shiyeType === 'DocumentAttributeFilename' ||
          item.className === 'DocumentAttributeFilename',
      )?.fileName ||
      asset.name ||
      messageOrId?.name ||
      `附件-${mediaId}`;
    const key = `${targetRoom}:${id}`;
    const cached = urls.get(key);
    if (cached && cached.mediaId === String(mediaId)) return cached;
    if (cached) URL.revokeObjectURL(cached.url);
    const blob = originalBlob || new Blob([bytes], { type: mime });
    const value = {
      url: URL.createObjectURL(blob),
      mime,
      name,
      size: blob.size,
      blob,
      mediaId: String(mediaId),
    };
    urls.set(key, value);
    return value;
  }
  async function flush() {
    await draftQueue;
    if (sendTask) {
      try {
        await sendTask;
      } catch (error) {
        if (!error.uncertain) throw error;
      }
    }
    if (attempt) {
      if (attempt.uncertain) await confirmAttempt(attempt);
      else {
        const started = Date.now();
        while (attempt && !attempt.uncertain) {
          if (Date.now() - started > timeoutMs)
            throw failure('SEND_LOCKED', '消息尚未得到本地保存确认', {
              uncertain: true,
              locked: true,
            });
          await delay(80);
        }
        if (attempt?.uncertain) await confirmAttempt(attempt);
      }
    }
    await draftQueue;
    await ownerFlush();
    return { flushed: true, storage: 'legacy-idb' };
  }
  function poll() {
    clearTimeout(timer);
    timer = undefined;
    if (disposed || !enabled || !listeners.size || host.document?.visibilityState === 'hidden')
      return;
    const id = room(),
      state = global(),
      branch = state.messages?.byChatId?.[id];
    if (signature && signature[0] !== id) invalidate();
    const next = [
      id,
      contextVersion(),
      branch,
      state.chats?.byId?.[id],
      JSON.stringify(callbacks.appearance?.(id) || {}),
      dirtyStamp,
    ];
    if (!signature || next.some((value, index) => value !== signature[index])) {
      signature = next;
      changed();
    }
    if (dirty && id)
      void committedLibrary(false, true)
        .then(() => {
          if (library && attempt?.uncertain && matchAttempt(library, attempt))
            return confirmAttempt(attempt);
          changed();
          return null;
        })
        .catch((error) => callbacks.onError?.(error));
    if (id) timer = setTimeout(poll, 250);
  }
  function onCommitted() {
    invalidate();
    if (enabled && listeners.size) poll();
  }
  const channel =
    typeof host.BroadcastChannel === 'function'
      ? new host.BroadcastChannel('shiye-journal-changes')
      : null;
  if (channel) channel.onmessage = onCommitted;
  host.addEventListener?.('shiye-local-media-committed', onCommitted);
  const visibility = () => poll();
  host.document?.addEventListener?.('visibilitychange', visibility);
  return {
    getSnapshot,
    getDraft,
    setDraft,
    sendText,
    sendFiles,
    withdraw,
    getMedia,
    loadOlder,
    flush,
    getContext: () => ({ roomId: room(), version: contextVersion() }),
    openMedia: (message) => getMedia(message),
    settings: (...args) => callbacks.settings?.(...args),
    openStickers: (...args) => callbacks.openStickers?.(...args),
    saveSticker: (...args) => callbacks.saveSticker?.(...args),
    sendSticker: (file, replyId) =>
      callbacks.sendSticker ? callbacks.sendSticker(file, replyId) : sendFiles([file], replyId),
    subscribe(listener) {
      if (disposed) throw failure('DISPOSED', '聊天页面已经关闭');
      listeners.add(listener);
      listener(getSnapshot());
      poll();
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          clearTimeout(timer);
          timer = undefined;
        }
      };
    },
    refresh: async () => {
      invalidate();
      await committedLibrary(true, true);
      poll();
      return getSnapshot();
    },
    setActive(active) {
      enabled = !!active;
      if (enabled) poll();
      else {
        clearTimeout(timer);
        timer = undefined;
        releaseUrls();
      }
    },
    dispose() {
      disposed = true;
      enabled = false;
      clearTimeout(timer);
      listeners.clear();
      releaseUrls();
      channel?.close();
      host.removeEventListener?.('shiye-local-media-committed', onCommitted);
      host.document?.removeEventListener?.('visibilitychange', visibility);
    },
  };
}

function bytesOf(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value))
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value)) return new Uint8Array(value);
  return null;
}
function revokeAttachments(attachments) {
  for (const attachment of attachments)
    for (const url of new Set([
      attachment.blobUrl,
      attachment.compressedBlobUrl,
      attachment.previewBlobUrl,
    ]))
      if (url) URL.revokeObjectURL(url);
}
function sameFiles(a, b) {
  return (
    Array.isArray(a) &&
    Array.isArray(b) &&
    a.length === b.length &&
    a.every(
      (file, index) =>
        file.mime === b[index].mime &&
        file.bytes.length === b[index].bytes.length &&
        file.bytes.every((byte, offset) => byte === b[index].bytes[offset]),
    )
  );
}
function detectMime(bytes) {
  if (bytes?.[0] === 71 && bytes[1] === 73 && bytes[2] === 70) return 'image/gif';
  if (bytes?.[0] === 137 && bytes[1] === 80 && bytes[2] === 78) return 'image/png';
  if (bytes?.[0] === 255 && bytes[1] === 216) return 'image/jpeg';
  return 'application/octet-stream';
}
