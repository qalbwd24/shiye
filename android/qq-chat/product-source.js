const CHUNK = 131072;
const MEDIA_LIMIT = 64 * 1024 * 1024;
const clone = (value) => JSON.parse(JSON.stringify(value));
const value = (input, ...args) => typeof input === 'function' ? input(...args) : input;
const id = () => globalThis.crypto?.randomUUID?.() || `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const failure = (code, extras = {}) => Object.assign(new Error(code), { code, uncertain: false, locked: false, ...extras });
const knownFailure = (error) => /^(INVALID_|EMPTY_|MESSAGE_|MEDIA_|DRAFT_|LOCAL_OPERATION_|SYNC_IDENTITY_|IMPORT_)/.test(error?.code || '');
const bytesToBase64 = (bytes) => {
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
};
function fromBase64(text) {
  if (typeof text !== 'string' || text.length > Math.ceil(CHUNK / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw failure('MEDIA_INVALID_CHUNK');
  let raw; try { raw = atob(text); } catch { throw failure('MEDIA_INVALID_CHUNK'); }
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}
async function digest(blob) {
  if (!globalThis.crypto?.subtle) throw failure('MEDIA_HASH_UNAVAILABLE');
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Single native ProductRepository authority. No TL editor/worker calls or cloud calls live here. */
export function createProductChatSource(callbacks = {}) {
  const request = callbacks.request || ((action, payload) => {
    if (!globalThis.window?.shiyeProductChat?.request) throw failure('NATIVE_PRODUCT_CHAT_UNAVAILABLE');
    return window.shiyeProductChat.request(action, payload);
  });
  let enabled = false, disposed = false, timer, version = 0, draftSerial = 0, attempt = null, refreshing = null, importing = null;
  let draftTail = Promise.resolve();
  const listeners = new Set(), cache = new Map(), origins = new Map(), drafts = new Map(), draftJobs = new Map(), draftErrors = new Map(), windows = new Map(), urls = new Map(), prepared = new Map();
  const key = (ctx) => `${ctx.sourceId || origins.get(ctx.roomId) || 'auto'}\u0000${ctx.roomId}`;
  function context() {
    if (disposed) throw failure('DISPOSED');
    const raw = value(callbacks.currentRoom) ?? value(callbacks.currentId) ?? value(callbacks.roomId) ?? '';
    const roomId = String(raw && typeof raw === 'object' ? raw.roomId ?? raw.id ?? '' : raw);
    const sourceId = (raw && typeof raw === 'object' ? raw.sourceId : undefined) || value(callbacks.sourceId, roomId) || origins.get(roomId) || '';
    return { roomId, sourceId, title: raw && typeof raw === 'object' ? raw.title : value(callbacks.title, roomId), version: value(callbacks.contextVersion) ?? 0 };
  }
  function matches(ctx) {
    if (disposed) return false;
    const current = context();
    return current.roomId === ctx.roomId && current.version === ctx.version && (!current.sourceId || !ctx.sourceId || current.sourceId === ctx.sourceId);
  }
  const payload = (ctx, extra = {}) => ({ roomId: ctx.roomId, ...(ctx.sourceId ? { sourceId: ctx.sourceId } : {}), ...extra });
  const invoke = async (action, input, capturedDraft = false) => {
    if (disposed && !capturedDraft) throw failure('DISPOSED');
    return request(action, clone(input));
  };
  function getDraft() {
    const ctx = context(), own = drafts.get(key(ctx));
    if (own) return { roomId: ctx.roomId, sourceId: ctx.sourceId, text: own.text, replyId: own.replyId, ready: true };
    const saved = cache.get(key(ctx))?.draft;
    return saved ? { ...clone(saved), ready: saved.ready !== false } : { roomId: ctx.roomId, sourceId: ctx.sourceId, text: '', replyId: null, ready: false };
  }
  function getSnapshot() {
    const ctx = context(), saved = cache.get(key(ctx));
    const result = saved ? clone(saved) : { roomId: ctx.roomId, sourceId: ctx.sourceId, title: ctx.title || '随想', messages: [], hasOlder: false, totalMessages: 0, ready: false };
    const pending = attempt || importing;
    const activeAttempt = pending && pending.ctx.roomId === ctx.roomId && pending.ctx.version === ctx.version ? pending : null;
    return { ...result, inConversation: Boolean(ctx.roomId), version, draft: getDraft(),
      appearance: { ...(result.appearance || {}), ...(value(callbacks.appearance, ctx.roomId) || {}) },
      sendState: { pending: Boolean(activeAttempt && !activeAttempt.uncertain), locked: Boolean(activeAttempt), uncertain: Boolean(activeAttempt?.uncertain) },
      storage: 'product-sqlite', productAuthorityMigrated: Boolean(saved?.ready) };
  }
  function notify() {
    if (disposed) return;
    version++;
    const snapshot = getSnapshot();
    for (const listener of listeners) { try { listener(snapshot); } catch { /* Observers cannot change a durable ACK. */ } }
  }
  function releaseUrls() { for (const entry of urls.values()) URL.revokeObjectURL(entry.url); urls.clear(); }
  async function prepare(ctx) {
    if (!callbacks.prepareProductRoom) return;
    const scope = `${ctx.sourceId || origins.get(ctx.roomId) || 'auto'}\u0000${ctx.roomId}`;
    let pending = prepared.get(scope);
    if (!pending) {
      pending = Promise.resolve().then(() => callbacks.prepareProductRoom(ctx.roomId, { sourceId: ctx.sourceId, contextVersion: ctx.version }));
      prepared.set(scope, pending);
      pending.catch(() => { if (prepared.get(scope) === pending) prepared.delete(scope); });
    }
    let answer;
    try { answer = await pending; } catch { throw failure('IMPORT_PREPARATION_FAILED'); }
    if (answer?.sourceId) {
      if (ctx.sourceId && ctx.sourceId !== answer.sourceId) throw failure('ROOM_IDENTITY_MISMATCH');
      const previous = key(ctx);
      origins.set(ctx.roomId, answer.sourceId); ctx.sourceId = answer.sourceId;
      if (previous !== key(ctx)) {
        for (const map of [drafts, windows, draftErrors]) if (map.has(previous)) { map.set(key(ctx), map.get(previous)); map.delete(previous); }
      }
      prepared.set(key(ctx), pending);
    }
  }
  async function refresh() {
    const ctx = context();
    if (!ctx.roomId) { notify(); return getSnapshot(); }
    if (refreshing?.ctx && matches(refreshing.ctx)) return refreshing.promise;
    const marker = { ctx };
    marker.promise = (async () => {
      await prepare(ctx);
      if (!matches(ctx)) return getSnapshot();
      const result = await invoke('chatSnapshot', payload(ctx, { title: ctx.title || '随想', limit: windows.get(key(ctx)) || 80 }));
      if (String(result.roomId) !== ctx.roomId || result.sourceId && ctx.sourceId && result.sourceId !== ctx.sourceId) throw failure('ROOM_IDENTITY_MISMATCH');
      if (!matches(ctx)) return getSnapshot();
      const priorKey = key(ctx);
      if (result.sourceId) { origins.set(ctx.roomId, result.sourceId); ctx.sourceId = result.sourceId; }
      if (priorKey !== key(ctx)) {
        if (drafts.has(priorKey)) { drafts.set(key(ctx), drafts.get(priorKey)); drafts.delete(priorKey); }
        if (windows.has(priorKey)) { windows.set(key(ctx), windows.get(priorKey)); windows.delete(priorKey); }
      }
      const previous = cache.get(key(ctx));
      if (previous?.draft && result.draft && previous.draft.revision > result.draft.revision) result.draft = previous.draft;
      cache.set(key(ctx), { ...result, ready: true }); notify(); return getSnapshot();
    })().finally(() => { if (refreshing === marker) refreshing = null; });
    refreshing = marker;
    return marker.promise;
  }
  function schedule() {
    clearTimeout(timer);
    if (!disposed && enabled && listeners.size && !globalThis.document?.hidden)
      timer = setTimeout(async () => { try { await reconcile(); await refresh(); } catch { /* Last local snapshot remains usable offline. */ } schedule(); }, callbacks.pollMs ?? 1500);
  }
  function setDraft(text, replyId = undefined) {
    const ctx = context(); if (!ctx.roomId) return Promise.reject(failure('ROOM_REQUIRED'));
    if (typeof text !== 'string') return Promise.reject(failure('INVALID_DRAFT'));
    const quoted = replyId === undefined ? getDraft().replyId : replyId == null ? null : String(replyId);
    const serial = ++draftSerial, scope = key(ctx), input = payload(ctx, { text, replyId: quoted });
    drafts.set(scope, { text, replyId: quoted, serial }); notify();
    return new Promise((resolve, reject) => {
      let job = draftJobs.get(scope);
      if (job && !job.started) { job.input = input; job.serial = serial; job.waiters.push({ resolve, reject }); return; }
      job = { ctx, input, serial, waiters: [{ resolve, reject }], started: false }; draftJobs.set(scope, job);
      draftTail = draftTail.catch(() => {}).then(async () => {
        job.started = true;
        try {
          await prepare(job.ctx);
          if (job.ctx.sourceId) job.input.sourceId = job.ctx.sourceId;
          const answer = await invoke('chatSetDraft', job.input, true);
          const actualScope = key(job.ctx), current = cache.get(actualScope) || { roomId: ctx.roomId, sourceId: ctx.sourceId, messages: [] };
          current.draft = clone(answer); cache.set(actualScope, current);
          if (drafts.get(actualScope)?.serial === job.serial) drafts.delete(actualScope);
          draftErrors.delete(actualScope);
          for (const waiter of job.waiters) waiter.resolve(answer);
        } catch (error) { draftErrors.set(key(job.ctx),error);for (const waiter of job.waiters) waiter.reject(error); }
        finally { if (draftJobs.get(scope) === job) draftJobs.delete(scope); notify(); }
      });
    });
  }
  async function reconcile() {
    const current = attempt;
    if (!current?.uncertain) return null;
    const result = await invoke('chatOperation', { clientId: current.clientId });
    if (result.committed) { if (attempt === current) attempt = null; notify(); if (matches(current.ctx)) await refresh(); return result; }
    return null;
  }
  async function send(text, replyId, attachments = [], originalSticker = false, allowedImport = null) {
    const ctx = context(); if (!ctx.roomId) throw failure('ROOM_REQUIRED');
    if (!enabled) throw failure('ROOM_CHANGED');
    if (attempt || importing && importing !== allowedImport) throw failure('SEND_LOCKED', { locked: true, uncertain: Boolean(attempt?.uncertain) });
    if (typeof text !== 'string' || !text.trim() && !attachments.length) throw failure('EMPTY_MESSAGE');
    const current = { ctx, clientId: id(), uncertain: false }; attempt = current; notify();
    try {
      await prepare(ctx);
      if (!enabled || !matches(ctx)) throw failure('INVALID_ROOM_CONTEXT');
      const input = payload(ctx, { text, replyId: replyId == null ? null : String(replyId), attachments: [...attachments], originalSticker, clientId: current.clientId });
      const result = await invoke('chatSendText', input);
      if (!result.committed || result.roomId !== ctx.roomId) throw failure('LOCAL_ACK_INVALID', { uncertain: true, locked: true });
      if (attempt === current) attempt = null;
      if (matches(ctx)) await refresh().catch(() => {});
      notify(); return result;
    } catch (error) {
      if (!knownFailure(error)) {
        current.uncertain = true;
        const confirmed = await reconcile().catch(() => null);
        if (confirmed) return confirmed;
        notify(); throw failure('LOCAL_ACK_UNCERTAIN', { uncertain: true, locked: true });
      }
      if (attempt === current) attempt = null; notify(); throw error;
    }
  }
  async function importFile(file, ctx) {
    if (!file || typeof file.slice !== 'function' || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > MEDIA_LIMIT) throw failure('MEDIA_SIZE_LIMIT');
    let token, completed = false;
    try {
      const start = await invoke('mediaImportStart', { name: file.name || '原件', mime: file.type || 'application/octet-stream', size: file.size }); token = start.token;
      if (typeof token !== 'string' || !token) throw failure('MEDIA_INVALID_SESSION');
      for (let offset = 0; offset < file.size; offset += CHUNK) {
        if (!enabled || !matches(ctx)) throw failure('ROOM_CHANGED');
        const bytes = new Uint8Array(await file.slice(offset, Math.min(file.size, offset + CHUNK)).arrayBuffer());
        const answer = await invoke('mediaImportChunk', { token, offset, base64: bytesToBase64(bytes) });
        if ((answer.offset ?? answer.written) !== offset + bytes.length) throw failure('MEDIA_CHUNK_ACK_INVALID');
      }
      if (!enabled || !matches(ctx)) throw failure('ROOM_CHANGED');
      const result = await invoke('mediaImportComplete', { token }), asset = result.asset || result;
      if (!(asset.assetId || asset.id) || asset.size !== file.size || !/^[a-f0-9]{64}$/.test(asset.sha256 || '') || await digest(file) !== asset.sha256) throw failure('MEDIA_HASH_MISMATCH');
      completed = true; return { ...asset, assetId: asset.assetId || asset.id };
    } finally { if (token && !completed) await invoke('mediaImportCancel', { token }).catch(() => {}); }
  }
  async function sendFiles(files, replyId, originalSticker = false) {
    const ctx = context(), list = Array.from(files || []);
    if (!list.length || list.length > 50) throw failure('MEDIA_BATCH_INVALID');
    if (attempt || importing) throw failure('SEND_LOCKED', { locked: true });
    const assets = [], task = {ctx};importing = task;notify();
    try {
      // Files become independently durable first. A later message failure never deletes their bytes.
      for (const file of list) assets.push(await importFile(file, ctx));
      if (!enabled || !matches(ctx)) throw failure('ROOM_CHANGED');
      return await send('', replyId, assets.map((asset) => asset.assetId), originalSticker, task);
    } finally { if(importing===task)importing=null;notify(); }
  }
  async function getMedia(messageOrId) {
    const ctx = context(), snapshot = getSnapshot();
    const message = typeof messageOrId === 'object' ? messageOrId : snapshot.messages.find((m) => String(m.id) === String(messageOrId));
    if (!message || message.kind === 'withdrawn' || message.roomId != null && String(message.roomId) !== ctx.roomId) throw failure('MEDIA_NOT_FOUND');
    const assetId = message.mediaId || message.attachments?.[0]; if (!assetId) throw failure('MEDIA_NOT_FOUND');
    const scope = `${key(ctx)}:${assetId}`, cached = urls.get(scope); if (cached) return { ...cached };
    const chunks = []; let offset = 0, size, hash = message.sha256, mime = message.mime, name = message.name;
    do {
      if (!matches(ctx)) throw failure('ROOM_CHANGED');
      const answer = await invoke('chatMedia', { assetId, offset, length: CHUNK });
      if (answer.offset !== offset || !Number.isSafeInteger(answer.size) || answer.size < 1 || answer.size > MEDIA_LIMIT || size != null && answer.size !== size) throw failure('MEDIA_RANGE_INVALID');
      size = answer.size; hash ||= answer.sha256; mime ||= answer.mime; name ||= answer.name;
      const bytes = fromBase64(answer.base64); if (bytes.length !== Math.min(CHUNK, size - offset)) throw failure('MEDIA_RANGE_INVALID');
      chunks.push(bytes); offset += bytes.length;
      if (Boolean(answer.complete) !== (offset === size)) throw failure('MEDIA_RANGE_INVALID');
    } while (offset < size);
    const blob = new Blob(chunks, { type: mime || 'application/octet-stream' });
    if (!/^[a-f0-9]{64}$/.test(hash || '') || await digest(blob) !== hash || !matches(ctx)) throw failure('MEDIA_HASH_MISMATCH');
    const result = { url: URL.createObjectURL(blob), mime: blob.type, name: name || '原件', size, sha256: hash, assetId };
    urls.set(scope, result); return { ...result };
  }
  async function withdraw(messageId) {
    const ctx = context(), clientId = id();
    if (!enabled) throw failure('ROOM_CHANGED');
    await prepare(ctx);
    if (!enabled || !matches(ctx)) throw failure('ROOM_CHANGED');
    const result = await invoke('chatWithdraw', payload(ctx, { messageId: String(messageId), clientId }));
    if (!result.committed) throw failure('LOCAL_ACK_UNCERTAIN', { uncertain: true });
    releaseUrls(); if (matches(ctx)) await refresh(); return result;
  }
  async function loadOlder() {
    const ctx = context(), scope = key(ctx);windows.set(scope, Math.min(500, (windows.get(scope) || 80) + 80));
    await refresh(); return { roomId: ctx.roomId, hasOlder: getSnapshot().hasOlder };
  }
  const onChanged = () => { if (enabled) refresh().catch(() => {}); };
  globalThis.window?.addEventListener('shiye-product-chat-changed', onChanged);
  return {
    getSnapshot, getDraft, setDraft, sendText: (text, replyId) => send(text, replyId), sendFiles,
    sendSticker: (file, replyId) => sendFiles([file], replyId, true), getMedia, openMedia: getMedia, withdraw, loadOlder,
    getContext: context,
    subscribe(listener) { if (disposed) throw failure('DISPOSED');listeners.add(listener);listener(getSnapshot());if (enabled) refresh().catch(() => {});schedule();return () => { listeners.delete(listener);schedule(); }; },
    refresh,
    async flush() { await draftTail;if(draftErrors.size)throw failure('DRAFT_SAVE_FAILED');const confirmed = await reconcile();return { flushed: true, storage: 'product-sqlite', confirmed: Boolean(confirmed) }; },
    setActive(active) { enabled = Boolean(active);if (!enabled) { clearTimeout(timer);releaseUrls(); } else { refresh().catch(() => {});schedule(); } },
    dispose() { if (disposed) return;disposed = true;enabled = false;clearTimeout(timer);releaseUrls();listeners.clear();globalThis.window?.removeEventListener('shiye-product-chat-changed', onChanged); },
  };
}
