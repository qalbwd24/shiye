import { renderQQContent } from './content.js';
import { createReadingPositions, readingScope } from './reading-position.js';

const SVG = {
  back: '<path d="m14 5-7 7 7 7"/>',
  settings: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  file: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="9" r="1.5"/><path d="m4 18 5-5 4 3 3-4 5 6"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8 14c1 4 7 4 8 0M8 9h.01M16 9h.01"/>',
};
const icon = (name) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${SVG[name]}</svg>`;
const clamp = (value, fallback, min, max) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
const epoch = (date) => {
  if (typeof date === 'number') return date < 1e12 ? date * 1000 : date;
  if (/^\d+$/.test(String(date || ''))) return epoch(Number(date));
  return Date.parse(date || '');
};
const roomKey = (value) => String(value ?? '');

/** Independent QQ DOM. The source owns identity, local ACKs, media URLs and persistence. */
export function installQQChat(options = {}) {
  const parentDocument = globalThis.document;
  const nativeImeVisible = () =>
    globalThis.window.getComputedStyle(parentDocument.documentElement)
      .getPropertyValue('--shiye-native-ime-visible')
      .trim() === '1';
  const outer = parentDocument.createElement('section');
  outer.id = 'shiye-qq-chat';
  outer.hidden = true;
  outer.style.cssText =
    'position:fixed;inset:0;z-index:20000;margin:0;padding:0;border:0;background:#fff;';
  const frame = parentDocument.createElement('iframe');
  frame.title = '随想聊天';
  frame.src = new URL('./shell.html', import.meta.url).href;
  frame.style.cssText =
    'display:block;width:100%;height:100%;border:0;margin:0;padding:0;background:#fff;';
  outer.append(frame);
  let mounted,
    disposed = false,
    active = true,
    resolveReady,
    failure = null,
    isReady = false,
    initializationTimer;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  const showFailure = () => {
    if (disposed || failure || isReady) return;
    clearTimeout(initializationTimer);
    failure = 'QQ_RENDERER_INIT_FAILED';
    frame.hidden = true;
    const notice = parentDocument.createElement('div');
    notice.setAttribute('role', 'alert');
    notice.style.cssText =
      'margin:0;padding:24px 16px;background:#fff;color:#193647;font:14px/1.6 system-ui,sans-serif;';
    notice.textContent = '聊天界面暂未加载成功，请返回后重新进入。输入和消息由本机资料源保留。';
    const back = parentDocument.createElement('button');
    back.type = 'button';
    back.textContent = '返回会话列表';
    back.style.cssText =
      'display:block;margin-top:16px;padding:10px 14px;border:0;border-radius:8px;background:#edf5fc;color:inherit;';
    back.onclick = () => options.onBack?.();
    notice.append(back);
    outer.append(notice);
    outer.hidden = !active;
    resolveReady(null);
  };
  frame.addEventListener(
    'load',
    () => {
      if (disposed) {
        resolveReady(null);
        return;
      }
      try {
        mounted = mountQQChat(
          {
            ...options,
            onVisibility: (visible) => {
              outer.hidden = !(visible && isReady);
            },
          },
          frame.contentWindow,
        );
        mounted.setActive(false);
        viewportChanged();
        mounted.styleReady
          .then(() => {
            if (disposed) return;
            clearTimeout(initializationTimer);
            isReady = true;
            mounted.setActive(active);
            resolveReady(mounted);
          })
          .catch(() => {
            mounted?.destroy();
            mounted = null;
            showFailure();
          });
      } catch {
        showFailure();
      }
    },
    { once: true },
  );
  frame.addEventListener('error', showFailure, { once: true });
  initializationTimer = setTimeout(showFailure, 10000);
  const themeChanged = () => mounted?.refresh();
  globalThis.window.addEventListener('shiye-app-theme', themeChanged);
  let wallpaperWidth = 0,
    wallpaperHeight = 0;
  const viewportChanged = () => {
    mounted?.beforeViewportResize();
    const viewport = globalThis.window.visualViewport;
    const width = globalThis.window.innerWidth;
    const height = viewport?.height || globalThis.window.innerHeight;
    if (Math.abs(width - wallpaperWidth) > 1) {
      wallpaperWidth = width;
      wallpaperHeight = height;
    } else wallpaperHeight = Math.max(wallpaperHeight, height);
    mounted?.setWallpaperViewport(wallpaperWidth, wallpaperHeight, viewport?.offsetTop || 0);
    outer.style.top = `${viewport?.offsetTop || 0}px`;
    outer.style.height = `${viewport?.height || globalThis.window.innerHeight}px`;
  };
  globalThis.window.addEventListener('resize', viewportChanged);
  globalThis.window.visualViewport?.addEventListener('resize', viewportChanged);
  viewportChanged();
  parentDocument.body.append(outer);
  return {
    ready,
    readyPromise: ready,
    snapshot: () =>
      mounted
        ? { ...mounted.snapshot(), ready: isReady, error: null }
        : { ready: false, error: failure, visible: Boolean(failure && active), messageIds: [] },
    flushReadingPosition: () => mounted?.flushReadingPosition(),
    getReplyId: () => mounted?.getReplyId() ?? null,
    locateMessage: async (id) => (await ready)?.locateMessage(id) ?? false,
    captureComposerState: () => mounted?.captureComposerState() ?? null,
    captureComposerFocus: () =>
      nativeImeVisible()
        ? mounted?.captureComposerFocus() ?? null
        : null,
    markPickerOpened: (token) => mounted?.markPickerOpened(token) ?? false,
    restoreComposerFocus: (token) => {
      // Native insets are the authority: a focused textarea and a short viewport
      // can both outlive an IME the user has explicitly dismissed.
      if (!nativeImeVisible()) {
        if (token) token.invalid = true;
        mounted?.restoreComposerFocus(token);
        return false;
      }
      return mounted?.restoreComposerFocus(token) ?? false;
    },
    captureMediaSendState: () => mounted?.captureMediaSendState() ?? null,
    cancelMediaSendState: (token) => mounted?.cancelMediaSendState(token) ?? false,
    setExternalSendStatus: (text, roomId) => mounted?.setExternalSendStatus(text, roomId) ?? false,
    afterExternalSend: (result, token) => mounted?.afterExternalSend(result, token),
    back: () => mounted?.back() || false,
    refresh: (next) => mounted?.refresh(next),
    setActive(value) {
      active = Boolean(value);
      mounted?.setActive(isReady && active);
      if (!active) outer.hidden = true;
      else if (failure) outer.hidden = false;
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      clearTimeout(initializationTimer);
      mounted?.destroy();
      resolveReady(null);
      globalThis.window.removeEventListener('shiye-app-theme', themeChanged);
      globalThis.window.removeEventListener('resize', viewportChanged);
      globalThis.window.visualViewport?.removeEventListener('resize', viewportChanged);
      outer.remove();
    },
  };
}

function mountQQChat(options, window) {
  const document = window.document,
    navigator = window.navigator,
    location = window.location;
  const requestAnimationFrame = window.requestAnimationFrame.bind(window);
  const cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
  const ResizeObserver = window.ResizeObserver;
  const { source, onBack, onSettings, onStickers, onFiles, onCollect, onViewMedia } = options;
  if (!source?.getSnapshot || !source?.subscribe || !source?.sendText)
    throw new TypeError('QQ_SOURCE_REQUIRED');
  const host = document.createElement('section');
  host.id = 'qq-frame-root';
  host.hidden = true;
  const shadow = host.attachShadow({ mode: 'open' });
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = new URL('./view.css', import.meta.url).href;
  const styleReady = new Promise((resolve, reject) => {
    stylesheet.addEventListener('load', resolve, { once: true });
    stylesheet.addEventListener('error', reject, { once: true });
  });
  shadow.append(stylesheet);
  const shell = document.createElement('div');
  shell.className = 'qq-shell';
  shell.innerHTML = `<div class="qq-wallpaper" aria-hidden="true"></div><header class="qq-header"><button type="button" class="qq-icon qq-back" aria-label="返回会话列表">${icon('back')}</button><h1 class="qq-title"></h1><button type="button" class="qq-icon qq-settings" aria-label="会话设置">${icon('settings')}</button></header>
    <div class="qq-list" role="log" aria-label="聊天消息" tabindex="-1"><button type="button" class="qq-history" hidden>更早消息</button><div class="qq-items"></div></div>
    <footer class="qq-footer"><div class="qq-reply" hidden><span></span><button type="button" aria-label="取消引用">×</button></div>
    <div class="qq-status" role="status" aria-live="polite" hidden></div>
    <div class="qq-composer"><button type="button" class="qq-icon qq-files" aria-label="图片和视频">${icon('file')}</button><textarea class="qq-input" rows="1" aria-label="消息" placeholder="输入消息" enterkeyhint="enter" autocomplete="off"></textarea><button type="button" class="qq-icon qq-stickers" aria-label="表情收藏">${icon('smile')}</button><button type="button" class="qq-send">发送</button></div></footer>`;
  shadow.append(shell);
  document.body.append(host);
  const find = (selector) => shadow.querySelector(selector);
  const title = find('.qq-title'),
    list = find('.qq-list'),
    items = find('.qq-items');
  const history = find('.qq-history');
  const input = find('.qq-input'),
    send = find('.qq-send'),
    status = find('.qq-status');
  const reply = find('.qq-reply'),
    replyLabel = reply.querySelector('span');
  let state = {},
    room = '',
    destroyed = false,
    enabled = false,
    visible = false;
  let renderedContext = null,
    draftScope = '';
  let roomGeneration = 0,
    draftRevision = 0,
    sending = false,
    locked = false,
    composing = false;
  let compositionEndedAt = -Infinity;
  let uncertainDraft = null;
  let deferredDraft = null;
  let loadingOlder = false;
  let tailIntent = null;
  let readingIntentRevision = 0;
  let pickerFocusToken = null;
  let focusIntentRevision = 0;
  let replyId = null,
    dirty = false,
    following = true,
    bookmark = null,
    menu = null,
    viewer = null;
  let scheduled = 0,
    resizeFrame = 0,
    gesture = null,
    suppressClickUntil = 0,
    unsubscribe;
  let draftQueue = Promise.resolve(),
    draftTimer = 0,
    draftNeedsSave = false;
  let selecting = false,
    selectingText = null,
    locating = 0,
    activeLocate = 0;
  const selected = new Set();
  const selectionBar = document.createElement('div');
  selectionBar.className = 'qq-selection-bar';
  selectionBar.hidden = true;
  shell.append(selectionBar);
  const roomDrafts = new Map();
  const roomReading = new Map();
  let positionStore;
  try {
    positionStore = createReadingPositions(window.localStorage);
  } catch {
    positionStore = createReadingPositions(null);
  }
  let positionScope = null,
    positionTimer = 0,
    pendingReading = null;
  let layoutScroll = false;
  let userScrollIntent = 0;
  let lastListHeight = list.clientHeight;
  function markLayoutScroll() {
    layoutScroll = true;
    requestAnimationFrame(() => {
      layoutScroll = false;
    });
  }
  const rows = new Map(),
    separators = new Map(),
    pointers = new Set();
  const cleanups = [];
  const listen = (element, type, callback, settings) => {
    element.addEventListener(type, callback, settings);
    cleanups.push(() => element.removeEventListener(type, callback, settings));
  };
  const wallpaperLayer = find('.qq-wallpaper');
  const presentationStatus = document.createElement('div');
  presentationStatus.className = 'qq-presentation-status';
  presentationStatus.setAttribute('role', 'status');
  presentationStatus.innerHTML =
    '<span></span><button type="button" class="qq-presentation-retry">重试壁纸</button><button type="button" class="qq-presentation-back">返回会话列表</button>';
  shell.append(presentationStatus);
  const presentationLabel = presentationStatus.querySelector('span');
  const presentationRetry = presentationStatus.querySelector('.qq-presentation-retry');
  let presentation = null,
    presentationGeneration = 0,
    preparingWallpaper = null;
  let activeWallpaper = null,
    blockedUnknownGeneration = -1,
    blockedUnknownVersion = null;
  const presentationSettled = () => presentation && presentation.status !== 'loading';
  function syncPresentation() {
    const waiting = visible && !presentationSettled();
    const opening =
      visible && (presentation?.sourcePending || (waiting && !presentation?.preserveContent));
    host.hidden = !visible;
    options.onVisibility?.(visible);
    shell.dataset.presentation = opening
      ? 'loading'
      : waiting
        ? 'loading-existing'
        : presentation?.status || 'none';
    for (const node of [find('.qq-header'), list, find('.qq-footer'), selectionBar]) {
      node.inert = Boolean(opening);
      if (opening) node.setAttribute('aria-hidden', 'true');
      else node.removeAttribute('aria-hidden');
    }
    presentationStatus.hidden =
      !visible || (!opening && !waiting && presentation?.status !== 'failed');
    presentationLabel.textContent =
      presentation?.sourcePending && presentation.status === 'failed'
        ? '会话暂未读取，请重试或返回。'
        : opening
          ? '正在打开会话…'
          : waiting
            ? '正在读取新壁纸，当前背景保留。'
            : presentation?.retainedPrevious
              ? '壁纸暂未加载，已保留原背景。'
              : '壁纸暂未加载，已使用纯色背景。';
    presentationRetry.hidden = waiting;
  }
  function cancelPreparingWallpaper() {
    const pending = preparingWallpaper;
    preparingWallpaper = null;
    if (!pending) return;
    window.clearTimeout(pending.timer);
    if (pending.image && pending.image !== activeWallpaper?.image) {
      pending.image.onload = pending.image.onerror = null;
      pending.image.removeAttribute('src');
    }
  }
  function invalidatePresentation() {
    presentationGeneration++;
    cancelPreparingWallpaper();
    presentation = null;
    blockedUnknownGeneration = -1;
    blockedUnknownVersion = null;
  }
  function wallpaperResource(value) {
    if (!value || value.appearanceReady === false) return { kind: 'unknown', url: '' };
    if (value.background === null || value.background === undefined)
      return { kind: 'none', url: '' };
    try {
      const url = new URL(value.background.url, location.href);
      if (
        url.origin === location.origin &&
        /^\/telegram\/local-background\/[a-f0-9-]{36}\.image$/.test(url.pathname) &&
        !url.search &&
        !url.hash
      ) {
        return {
          kind: 'image',
          url: url.href,
          version: String(value.background.version ?? value.background.assetId ?? ''),
        };
      }
    } catch {
      /* Invalid input uses a visible, recoverable safe background. */
    }
    return { kind: 'invalid', url: '' };
  }
  function updateWallpaper(value, retry = false) {
    if (destroyed || !visible) return;
    const resource = wallpaperResource(value);
    const key = JSON.stringify([
      roomGeneration,
      room,
      resource.kind,
      resource.url,
      resource.version || '',
    ]);
    if (
      !retry &&
      (presentation?.key === key ||
        (blockedUnknownGeneration === roomGeneration &&
          blockedUnknownVersion === (value?.appearanceVersion ?? null)))
    ) {
      syncPresentation();
      return;
    }
    blockedUnknownGeneration = -1;
    cancelPreparingWallpaper();
    const preserveContent =
      presentation?.roomGeneration === roomGeneration &&
      (presentation.status !== 'loading' || presentation.preserveContent === true);
    const current = {
      generation: ++presentationGeneration,
      roomGeneration,
      room,
      key,
      preserveContent,
      status: 'loading',
      kind: resource.kind,
      resourceURL: resource.url,
      appearanceVersion: value?.appearanceVersion ?? null,
      requestedAt: window.performance.now(),
      settledAt: null,
      committedAt: null,
      reason: null,
    };
    presentation = current;
    syncPresentation();
    const owns = () =>
      !destroyed &&
      visible &&
      presentation === current &&
      roomGeneration === current.roomGeneration &&
      room === current.room;
    const settle = (status, image = null, reason = null) => {
      if (!owns() || current.status !== 'loading') return;
      current.status = status;
      current.reason = reason;
      current.settledAt = window.performance.now();
      cancelPreparingWallpaper();
      if (status === 'ready') {
        if (wallpaperLayer.firstElementChild !== image) wallpaperLayer.replaceChildren(image);
        activeWallpaper = { url: resource.url, version: resource.version || '', image };
      } else {
        current.retainedPrevious = status === 'failed' && preserveContent;
        if (!current.retainedPrevious) {
          wallpaperLayer.replaceChildren();
          activeWallpaper = null;
        }
        if (resource.kind === 'unknown') {
          blockedUnknownGeneration = roomGeneration;
          blockedUnknownVersion = value?.appearanceVersion ?? null;
        }
      }
      // Insert the decoded element and reveal this target DOM within one JS commit.
      current.committedAt = window.performance.now();
      syncPresentation();
      scheduleResize();
    };
    if (resource.kind === 'none') {
      settle('none');
      return;
    }
    if (resource.kind === 'invalid') {
      settle('failed', null, 'invalid-resource');
      return;
    }
    if (
      resource.kind === 'image' &&
      activeWallpaper?.url === resource.url &&
      activeWallpaper.version === resource.version
    ) {
      settle('ready', activeWallpaper.image);
      return;
    }
    const pending = {
      image: null,
      timer: window.setTimeout(
        () =>
          settle(
            'failed',
            null,
            resource.kind === 'unknown' ? 'appearance-timeout' : 'decode-timeout',
          ),
        2000,
      ),
    };
    preparingWallpaper = pending;
    if (resource.kind === 'unknown') return;
    const image = new window.Image();
    pending.image = image;
    image.alt = '';
    image.draggable = false;
    image.decoding = 'async';
    image.className = 'qq-wallpaper-image';
    image.onerror = () => settle('failed', null, 'image-error');
    image.src = resource.url;
    if (typeof image.decode === 'function') {
      image.decode().then(
        () => {
          if (preparingWallpaper === pending && owns()) {
            // Keep this exact decoded image; cancellation must not strip its src.
            preparingWallpaper = null;
            window.clearTimeout(pending.timer);
            image.onload = image.onerror = null;
            settle('ready', image);
          }
        },
        () => settle('failed', null, 'decode-error'),
      );
    } else
      image.onload = () => {
        if (preparingWallpaper !== pending || !owns()) return;
        preparingWallpaper = null;
        window.clearTimeout(pending.timer);
        image.onload = image.onerror = null;
        settle('ready', image);
      };
  }
  function readActivationSnapshot() {
    cancelPreparingWallpaper();
    const pending = {
      generation: ++presentationGeneration,
      roomGeneration,
      room,
      key: 'activation-snapshot',
      kind: 'snapshot',
      sourcePending: true,
      status: 'loading',
      preserveContent: false,
      requestedAt: window.performance.now(),
    };
    presentation = pending;
    const fail = () => {
      if (destroyed || !visible || presentation !== pending || pending.status !== 'loading') return;
      cancelPreparingWallpaper();
      pending.status = 'failed';
      pending.reason = 'snapshot-unavailable';
      pending.settledAt = window.performance.now();
      syncPresentation();
    };
    preparingWallpaper = { image: null, timer: window.setTimeout(fail, 2000) };
    syncPresentation();
    try {
      const latest = source.getSnapshot();
      if (!latest?.then) {
        setSnapshot(latest);
        return;
      }
      latest.then((next) => {
        if (!destroyed && visible && presentation === pending && pending.status === 'loading')
          setSnapshot(next);
      }, fail);
    } catch {
      fail();
    }
  }
  listen(presentationRetry, 'click', () => {
    if (!visible || presentation?.status !== 'failed') return;
    if (presentation.sourcePending) {
      readActivationSnapshot();
      return;
    }
    updateWallpaper(state.appearance, true);
    if (state.appearance?.appearanceReady === false || !state.appearance) {
      window.parent.dispatchEvent(
        new window.parent.CustomEvent('shiye-chat-appearance-retry', { detail: { roomId: room } }),
      );
      source.refresh?.();
    }
  });
  listen(presentationStatus.querySelector('.qq-presentation-back'), 'click', () => {
    saveDraftNow();
    onBack?.();
  });

  function message(text = '') {
    status.textContent = text;
    status.hidden = !text;
  }
  function currentContext() {
    return source.getContext?.() || null;
  }
  function scopeKey(id, context) {
    return `${id}\u0000${context?.version ?? ''}`;
  }
  function contextMatches() {
    try {
      const current = currentContext();
      return current
        ? roomKey(current.roomId) === room && current.version === renderedContext?.version
        : roomKey(source.getSnapshot()?.roomId) === room;
    } catch {
      return false;
    }
  }
  function updateSend() {
    send.disabled = sending || locked || composing || !input.value.trim();
    send.textContent = '发送';
    input.setAttribute('aria-busy', sending ? 'true' : 'false');
  }
  let measuredInput = '';
  function grow() {
    const style = window.getComputedStyle(input);
    const key = `${input.value}\u0000${input.getBoundingClientRect().width}\u0000${style.fontSize}\u0000${style.lineHeight}`;
    if (key === measuredInput) return;
    measuredInput = key;
    // Synchronous measurement and restore happen before paint; preserve the reading anchor.
    input.style.height = '0px';
    input.style.height = `${Math.min(128, Math.max(32, input.scrollHeight + 2))}px`;
  }
  function showReply(id) {
    replyId = id == null ? null : String(id);
    const target = state.messages?.find((m) => String(m.id) === replyId);
    replyLabel.textContent = target ? preview(target) : replyId ? '引用消息' : '';
    reply.hidden = !replyId;
  }
  function preview(m) {
    if (m.kind === 'withdrawn') return '消息已撤回';
    return (m.text || { image: '[图片]', video: '[视频]', file: '[文件]' }[m.kind] || '消息').slice(
      0,
      100,
    );
  }
  function loadDraft() {
    let draft;
    try {
      draft = source.getDraft?.();
    } catch {
      draft = '';
    }
    if (draft && typeof draft.then === 'function') return;
    if (draft?.roomId != null && roomKey(draft.roomId) !== room) draft = '';
    if (roomDrafts.has(draftScope)) draft = roomDrafts.get(draftScope);
    const text = typeof draft === 'string' ? draft : draft?.text || '';
    input.value = text;
    showReply(typeof draft === 'object' ? draft?.replyId : null);
    deferredDraft =
      draft?.ready === false
        ? { scope: draftScope, revision: draftRevision, text: input.value }
        : null;
    dirty = false;
    draftNeedsSave = false;
    grow();
    updateSend();
  }
  function saveDraftNow(override = null) {
    clearTimeout(draftTimer);
    if ((!draftNeedsSave && !override?.force) || destroyed || !room) return draftQueue;
    if (!contextMatches()) {
      message('会话已改变，当前输入已保留');
      return draftQueue;
    }
    draftNeedsSave = false;
    const currentRoom = room,
      currentScope = draftScope,
      generation = roomGeneration,
      revision = draftRevision,
      text = override ? override.text : input.value,
      quoted = override ? override.replyId : replyId;
    let operation;
    // Invoke immediately: the source captures the current room before any asynchronous queue.
    try {
      if (typeof source.setDraft !== 'function') throw Error('DRAFT_SOURCE_UNAVAILABLE');
      operation = Promise.resolve(source.setDraft(text, quoted));
    } catch (error) {
      operation = Promise.reject(error);
    }
    draftQueue = operation
      .then((receipt) => {
        if (receipt?.superseded) {
          if (generation === roomGeneration && revision === draftRevision && currentRoom === room)
            draftNeedsSave = true;
          return { saved: false, superseded: true };
        }
        if (
          generation === roomGeneration &&
          revision === draftRevision &&
          currentRoom === room &&
          input.value === text &&
          replyId === quoted
        )
          dirty = false;
        const cached = roomDrafts.get(currentScope);
        if (cached?.text === text && cached?.replyId === quoted && cached?.revision === revision)
          roomDrafts.delete(currentScope);
        return { saved: true };
      })
      .catch((error) => {
        if (
          !destroyed &&
          generation === roomGeneration &&
          revision === draftRevision &&
          currentRoom === room
        ) {
          draftNeedsSave = true;
          message('草稿暂未保存，请保留当前输入后重试');
        }
        return { saved: false, error };
      });
    return draftQueue;
  }
  function changedDraft() {
    dirty = true;
    draftNeedsSave = true;
    draftRevision++;
    roomDrafts.set(draftScope, { text: input.value, replyId, revision: draftRevision });
    saveDraftNow();
    updateSend();
    grow();
    input.dispatchEvent(new window.Event('qq-draft-change'));
  }
  function remember() {
    following = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
    const viewport = list.getBoundingClientRect();
    const first = [...items.children].find(
      (node) => node.getBoundingClientRect().bottom > viewport.top,
    );
    bookmark = first
      ? { key: first.dataset.qqKey, offset: first.getBoundingClientRect().top - viewport.top }
      : null;
  }
  function persistedAnchor() {
    if (following) return null;
    const viewport = list.getBoundingClientRect();
    const row = [...items.children].find(
      (node) => node.dataset.qqMessageId && node.getBoundingClientRect().bottom > viewport.top,
    );
    return row
      ? { id: row.dataset.qqMessageId, offset: row.getBoundingClientRect().top - viewport.top }
      : null;
  }
  function saveReading() {
    clearTimeout(positionTimer);
    positionTimer = 0;
    if (
      !positionScope ||
      pendingReading ||
      activeLocate ||
      state.appearance?.rememberReadingPosition !== true
    )
      return;
    const anchor = persistedAnchor();
    if (anchor) positionStore.put(positionScope, anchor);
    else if (following) positionStore.remove(positionScope);
  }
  function queueReading() {
    if (!positionScope || pendingReading || positionTimer) return;
    positionTimer = setTimeout(saveReading, 350);
  }
  function flushReadingOnHide() {
    clearTimeout(positionTimer);
    positionTimer = 0;
    if (
      destroyed ||
      !visible ||
      !room ||
      !positionScope ||
      pendingReading ||
      activeLocate ||
      state.appearance?.rememberReadingPosition !== true ||
      !contextMatches()
    )
      return;
    remember();
    saveReading();
  }
  function cancelReading() {
    if (!pendingReading) return;
    pendingReading = null;
    locating++;
  }
  async function restoreReading(task) {
    task.started = true;
    const generation = roomGeneration;
    let previousCount = -1;
    for (let page = 0; page < 100; page++) {
      if (
        destroyed ||
        pendingReading !== task ||
        generation !== roomGeneration ||
        !contextMatches()
      )
        return;
      const row = rows.get(task.id);
      if (row) {
        markLayoutScroll();
        list.scrollTop +=
          row.node.getBoundingClientRect().top - list.getBoundingClientRect().top - task.offset;
        following = false;
        bookmark = { key: row.node.dataset.qqKey, offset: task.offset };
        pendingReading = null;
        return;
      }
      if (!state.hasOlder || !source.loadOlder || previousCount === rows.size) break;
      previousCount = rows.size;
      try {
        await source.loadOlder();
      } catch {
        break;
      }
      if (pendingReading !== task || generation !== roomGeneration) return;
      try {
        setSnapshot(await source.getSnapshot());
      } catch {
        break;
      }
    }
    if (pendingReading !== task) return;
    pendingReading = null;
    following = true;
    bookmark = null;
    positionStore.remove(positionScope);
    restore(true);
  }
  function restore(force = false) {
    if (!visible || pendingReading) return;
    markLayoutScroll();
    if (force || following) list.scrollTop = list.scrollHeight;
    else if (bookmark) {
      const node = [...items.children].find((row) => row.dataset.qqKey === bookmark.key);
      if (node)
        list.scrollTop +=
          node.getBoundingClientRect().top - list.getBoundingClientRect().top - bookmark.offset;
    }
  }
  function scheduleResize() {
    if (resizeFrame || destroyed) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      grow();
      restore();
    });
  }
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(scheduleResize) : null;
  observer?.observe(items);
  observer?.observe(find('.qq-footer'));
  observer?.observe(list);
  function safeMediaUrl(url) {
    if (typeof url !== 'string') return '';
    try {
      const value = new URL(url, location.href);
      if (value.protocol === 'blob:' || /^data:(image|video|audio)\//i.test(url)) return value.href;
      if (
        (value.protocol === 'http:' || value.protocol === 'https:') &&
        value.origin === location.origin
      )
        return value.href;
    } catch {
      /* Source owns media URL creation; unknown protocols never reach elements. */
    }
    return '';
  }
  async function getMedia(row) {
    const generation = roomGeneration,
      signature = row.signature;
    row.media = null;
    try {
      const result = await source.getMedia?.(row.message);
      if (
        destroyed ||
        generation !== roomGeneration ||
        row.signature !== signature ||
        !row.node.isConnected
      )
        return;
      const media = typeof result === 'string' ? { url: result } : result;
      const url = safeMediaUrl(media?.url);
      if (!url) throw new Error('MEDIA_UNAVAILABLE');
      row.media = { ...media, url };
      const element = row.content.querySelector('img,video');
      if (element) {
        element.src = url;
        element.addEventListener('load', scheduleResize, { once: true });
        element.addEventListener('loadedmetadata', scheduleResize, { once: true });
        if (row.message.kind === 'video') {
          element.addEventListener(
            'loadedmetadata',
            () => {
              if (Number.isFinite(element.duration) && element.duration > 0)
                element.currentTime = Math.min(0.04, element.duration / 2);
            },
            { once: true },
          );
        }
      }
      row.content.classList.remove('qq-loading');
      row.content.querySelector('.qq-media-note')?.remove();
      scheduleResize();
    } catch {
      if (generation === roomGeneration && row.signature === signature && row.node.isConnected) {
        const note = row.content.querySelector('.qq-media-note');
        if (note) note.textContent = '原件暂不可用';
        row.content.classList.remove('qq-loading');
      }
    }
  }
  function patch(row, m, messageById) {
    const quoted = m.replyId == null ? null : messageById.get(String(m.replyId));
    const signature = JSON.stringify([
      m.kind,
      m.text,
      m.replyId,
      quoted && preview(quoted),
      m.mediaId,
      m.name,
      m.mime,
      m.size,
      m.outgoing,

      m.contentFormat,
      m.body,
      m.content,
      m.entities,
    ]);
    row.message = m;
    if (signature === row.signature) return;
    row.signature = signature;
    row.node.className = `qq-row${m.outgoing ? ' qq-outgoing' : ''}${m.kind === 'withdrawn' ? ' qq-withdrawn' : ''}`;
    row.content.replaceChildren();
    row.content.className = 'qq-bubble';
    row.media = null;
    if (m.kind === 'withdrawn') {
      row.content.textContent = '消息已撤回';
      return;
    }
    if (m.replyId != null) {
      const quoted = messageById.get(String(m.replyId));
      const quote = document.createElement('div');
      quote.className = 'qq-quote';
      quote.textContent = quoted ? preview(quoted) : '引用消息';
      row.content.append(quote);
    }
    if (['image', 'video', 'file'].includes(m.kind)) {
      row.content.classList.add('qq-media', 'qq-loading');
      if (m.kind === 'image' || m.kind === 'video') {
        const element = document.createElement(m.kind === 'image' ? 'img' : 'video');
        element.setAttribute('aria-label', m.kind === 'image' ? '查看图片' : '查看视频');
        if (m.kind === 'image') {
          element.alt = m.name || '图片';
          element.loading = 'lazy';
          element.decoding = 'async';
        } else {
          element.preload = 'metadata';
          element.muted = true;
          element.playsInline = true;
        }
        row.content.append(element);
        if (m.kind === 'video') {
          const play = document.createElement('span');
          play.className = 'qq-video-play';
          play.textContent = '▶';
          row.content.append(play);
        }
      } else {
        const name = document.createElement('span');
        name.className = 'qq-file-name';
        name.textContent = m.name || '文件';
        row.content.append(name);
      }
      const note = document.createElement('span');
      note.className = 'qq-media-note';
      note.textContent = '正在读取原件…';
      row.content.append(note);
      getMedia(row);
    } else row.content.classList.remove('qq-media', 'qq-loading');
    if (m.text || m.body || m.contentFormat) {
      const text = document.createElement('div');
      text.className = 'qq-text';
      renderQQContent(text, m);
      row.content.append(text);
    }
  }
  function createRow(m) {
    const node = document.createElement('article'),
      content = document.createElement('div');
    node.dataset.qqMessageId = String(m.id);
    node.dataset.qqKey = `m:${m.id}`;
    content.className = 'qq-bubble';
    node.append(content);
    return { node, content, message: m, signature: '', media: null };
  }
  function setStyle(key, value) {
    if (host.style.getPropertyValue(key) !== value) host.style.setProperty(key, value);
  }
  let timeFormatterKey = '',
    timeFormatter = null;
  function formatSeparator(date, timeZone) {
    const locale = 'zh-CN';
    const options = {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone,
    };
    const key = JSON.stringify([locale, options]);
    if (key !== timeFormatterKey) {
      timeFormatter = new Intl.DateTimeFormat(locale, options);
      timeFormatterKey = key;
    }
    return timeFormatter.format(date);
  }
  function appearance(value = {}) {
    const dark = (globalThis.window.shiyeAppTheme || value.theme) === 'dark';
    const inline = clamp(value.bubblePadding, 8, 2, 24);
    const block = Object.hasOwn(value, 'bubblePaddingBlock')
      ? clamp(value.bubblePaddingBlock, 6, 2, 20)
      : Object.hasOwn(value, 'bubblePadding')
        ? inline
        : 6;
    const vars = {
      '--qq-message-font': `${clamp(value.messageFontSize, 16, 6, 28)}px`,
      '--qq-input-font': `${clamp(value.inputFontSize, 14, 6, 28)}px`,
      '--qq-padding-inline': `${inline}px`,
      '--qq-padding-block': `${block}px`,
      '--qq-gap': `${clamp(value.messageGap, 3, 0, 20)}px`,
      '--qq-width': `${clamp(value.bubbleWidth, 90, 55, 100)}%`,
      '--qq-radius': `${clamp(value.bubbleRadius, 9, 4, 24)}px`,
      '--qq-opacity': `${clamp(value.bubbleOpacity, 100, 0, 100) / 100}`,
      '--qq-separator-font': `${clamp(value.messageTimeSize, 8, 5, 16)}px`,
      '--qq-chrome': dark
        ? value.qqChromeTone === 'blue'
          ? '#243e50'
          : '#252f39'
        : value.qqChromeTone === 'blue'
          ? '#d8eeff'
          : '#fff',
      '--qq-chrome-border': dark
        ? '#36434d'
        : value.qqChromeTone === 'blue'
          ? '#bddff6'
          : '#edf0f3',
      '--qq-page-bg': dark ? '#1d252d' : '#f0f0f2',
      '--qq-text-color': dark ? '#e6f0f7' : '#17191b',
      '--qq-input-bg': dark ? '#18232c' : '#fff',
      '--qq-tray': dark ? '#252f39' : value.qqChromeTone === 'blue' ? '#d8eeff' : '#f8f8f9',
      '--qq-incoming': dark ? '47 69 84' : '255 255 255',
      '--qq-outgoing': dark ? '30 89 127' : '64 153 239',
    };
    for (const [key, val] of Object.entries(vars)) setStyle(key, val);
    setStyle(
      '--qq-wallpaper-position',
      ['center', 'top', 'bottom', 'left', 'right'].includes(value.background?.position)
        ? value.background.position
        : 'center',
    );
    const hint = value.enterToSend === true ? 'send' : 'enter';
    if (input.getAttribute('enterkeyhint') !== hint) input.setAttribute('enterkeyhint', hint);
    updateWallpaper(value);
  }
  function setSnapshot(next) {
    if (destroyed || !next || typeof next !== 'object') return;
    const nextRoom = roomKey(next.roomId);
    let nextContext;
    try {
      nextContext = currentContext();
    } catch {
      return;
    }
    if (nextContext && roomKey(nextContext.roomId) !== nextRoom) return;
    // Keep the last room's DOM while its owner returns to the list. A later
    // entrance into this same room can reuse the painted rows and scroll anchor.
    if (!nextRoom && room) {
      if (visible && !pendingReading) {
        remember();
        saveReading();
      }
      state = { ...state, inConversation: false };
      visible = false;
      syncPresentation();
      return;
    }
    if (presentation?.sourcePending) {
      if (presentation.status === 'failed') return;
      cancelPreparingWallpaper();
      presentation = null;
    }
    const nextScope = scopeKey(nextRoom, nextContext),
      nextPositionScope = readingScope(next),
      switched = nextScope !== draftScope;
    const retainRows = switched && nextRoom === room && !visible &&
      state.storage === next.storage &&
      state.sourceId === next.sourceId;
    const resumeLatest = !visible && enabled && nextRoom === room &&
      next.inConversation !== false && next.appearance?.rememberReadingPosition !== true;
    const retainedReading = retainRows && next.appearance?.rememberReadingPosition === true
      ? { following, bookmark: bookmark && { ...bookmark } }
      : null;
    let restoredReading = false;
    if (switched) {
      if (room) {
        if (visible) remember();
        saveReading();
        if (positionScope)
          roomReading.set(positionScope, { following, bookmark: bookmark && { ...bookmark } });
        if (roomReading.size > 50) roomReading.delete(roomReading.keys().next().value);
      }
      if (room && (dirty || sending || locked))
        roomDrafts.set(draftScope, { text: input.value, replyId, revision: draftRevision });
      clearTimeout(draftTimer);
      draftNeedsSave = false;
      roomGeneration++;
      tailIntent = null;
      pickerFocusToken = null;
      focusIntentRevision++;
      readingIntentRevision++;
      userScrollIntent = 0;
      room = nextRoom;
      draftRevision++;
      sending = false;
      locked = false;
      composing = false;
      renderedContext = nextContext;
      draftScope = nextScope;
      uncertainDraft = null;
      loadingOlder = false;
      closeMenu();
      closeViewer();
      cancelGesture();
      if (!retainRows) {
        rows.clear();
        separators.clear();
        items.replaceChildren();
      }
      exitSelection();
      exitTextSelection();
      locating++;
      pendingReading = null;
      positionScope = nextPositionScope;
      const reading = retainedReading ||
        (next.appearance?.rememberReadingPosition === true ? roomReading.get(positionScope) : null);
      following = reading?.following ?? true;
      bookmark = reading?.bookmark ? { ...reading.bookmark } : null;
      restoredReading = Boolean(reading);
      if (!retainRows && next.appearance?.rememberReadingPosition === true && positionScope) {
        const saved =
          positionStore.get(positionScope) ||
          (!following && /^m:.+/.test(bookmark?.key || '')
            ? { id: bookmark.key.slice(2), offset: bookmark.offset }
            : null);
        if (saved) {
          pendingReading = saved;
          following = false;
          restoredReading = true;
        }
      }
      message();
      options.onRoomChange?.(nextRoom);
    } else {
      if (resumeLatest) {
        following = true;
        bookmark = null;
      }
      if (positionScope !== nextPositionScope) {
        positionScope = nextPositionScope;
        pendingReading = null;
        following = true;
        bookmark = null;
        if (next.appearance?.rememberReadingPosition === true && positionScope) {
          const saved = positionStore.get(positionScope);
          if (saved) {
            pendingReading = saved;
            following = false;
          }
        }
      }
      if (!resumeLatest && !pendingReading && !(tailIntent?.generation === roomGeneration &&
          performance.now() < tailIntent.until)) remember();
      if (loadingOlder || next.loadingOlder) following = false;
    }
    const becomingVisible = !visible && enabled && Boolean(nextRoom) &&
      next.inConversation !== false;
    state = next;
    visible = enabled && Boolean(room) && next.inConversation !== false;
    if (becomingVisible && next.appearance?.rememberReadingPosition !== true) {
      following = true;
      bookmark = null;
    }
    title.textContent = next.title || '随想';
    history.hidden = !next.hasOlder || typeof source.loadOlder !== 'function';
    history.disabled = loadingOlder || Boolean(next.loadingOlder);
    history.textContent = history.disabled ? '正在读取更早消息…' : '更早消息';
    appearance(next.appearance);
    shell.classList.toggle('qq-self-left', next.appearance?.selfMessageSide === 'left');
    if (switched) loadDraft();
    if (next.sendState && !sending) {
      const wasLocked = locked;
      locked = Boolean(next.sendState.locked);
      if (uncertainDraft && wasLocked && !locked) {
        if (
          uncertainDraft.generation === roomGeneration &&
          input.value === uncertainDraft.text &&
          draftRevision === uncertainDraft.revision
        ) {
          input.value = '';
          showReply(null);
          changedDraft();
          message('已确认保存');
        }
        uncertainDraft = null;
      }
      updateSend();
    }
    if (!switched && !dirty && !composing && !sending && !locked && contextMatches()) {
      try {
        const saved = source.getDraft?.();
        if (
          saved &&
          typeof saved === 'object' &&
          !saved.then &&
          (saved.roomId == null || roomKey(saved.roomId) === room)
        ) {
          if (
            deferredDraft &&
            saved.ready !== false &&
            deferredDraft.scope === draftScope &&
            deferredDraft.revision === draftRevision &&
            input.value === deferredDraft.text
          ) {
            const start = input.selectionStart,
              end = input.selectionEnd;
            input.value = saved.text || '';
            input.setSelectionRange(
              Math.min(start, input.value.length),
              Math.min(end, input.value.length),
            );
            deferredDraft = null;
            grow();
            updateSend();
          }
          const savedReply = saved.replyId == null ? null : String(saved.replyId);
          if (savedReply !== replyId) showReply(savedReply);
        }
      } catch {
        /* A failed background read never replaces the active input or quote. */
      }
    }
    const previousTail = [...rows.keys()].at(-1);
    const previousTailIndex = (next.messages || []).findIndex(
      (m) => String(m.id) === previousTail || String(m.previousLocalId) === previousTail,
    );
    const wanted = new Set(),
      ordered = [],
      arrivals = [];
    let lastTime = NaN;
    const messages = Array.isArray(next.messages) ? next.messages : [];
    // Match Array.find's first occurrence, including its String(id) coercion.
    const messageById = new Map();
    for (const m of messages) if (!messageById.has(String(m.id))) messageById.set(String(m.id), m);
    for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
      const m = messages[messageIndex];
      if (m.id == null || (m.roomId != null && roomKey(m.roomId) !== room)) continue;
      const id = String(m.id);
      const previous = m.previousLocalId == null ? '' : String(m.previousLocalId);
      if (previous && previous !== id) {
        if (!rows.has(id) && rows.has(previous)) {
          const row = rows.get(previous);
          rows.delete(previous);
          rows.set(id, row);
          if (selected.delete(previous)) selected.add(id);
          row.node.dataset.qqMessageId = id;
          row.node.dataset.qqKey = `m:${id}`;
          if (bookmark?.key === `m:${previous}`) bookmark.key = `m:${id}`;
        }
        if (!separators.has(id) && separators.has(previous)) {
          const separator = separators.get(previous);
          separators.delete(previous);
          separators.set(id, separator);
          separator.dataset.qqKey = `t:${id}`;
          if (bookmark?.key === `t:${previous}`) bookmark.key = `t:${id}`;
        }
      }
      wanted.add(id);
      const time = epoch(m.date);
      if (
        next.appearance?.showTimeSeparators !== false &&
        Number.isFinite(time) &&
        (!Number.isFinite(lastTime) || time - lastTime >= 300000)
      ) {
        let separator = separators.get(id);
        if (!separator) {
          separator = document.createElement('div');
          separator.className = 'qq-time-separator';
          separator.dataset.qqKey = `t:${id}`;
          separators.set(id, separator);
        }
        const date = new Date(time);
        try {
          const label = formatSeparator(date, next.appearance?.timeZone || 'Asia/Shanghai');
          if (separator.textContent !== label) separator.textContent = label;
        } catch {
          separator.textContent = date.toLocaleString('zh-CN');
        }
        ordered.push(separator);
        lastTime = time;
      }
      let row = rows.get(id);
      if (!row) {
        row = createRow(m);
        rows.set(id, row);
        if (
          !switched &&
          visible &&
          following &&
          !loadingOlder &&
          !next.loadingOlder &&
          (previousTail == null || previousTailIndex >= 0) &&
          messageIndex > previousTailIndex &&
          !m.replacementOf &&
          !m.replacementRootId
        )
          arrivals.push(row.content);
      }
      patch(row, m, messageById);
      ordered.push(row.node);
    }
    const keep = new Set(ordered);
    for (const child of [...items.children]) if (!keep.has(child)) child.remove();
    for (const [id] of rows)
      if (!wanted.has(id)) {
        rows.delete(id);
        selected.delete(id);
      }
    for (const [id, node] of separators) if (!keep.has(node)) separators.delete(id);
    let cursor = items.firstChild;
    for (const node of ordered) {
      if (node === cursor) cursor = cursor.nextSibling;
      else items.insertBefore(node, cursor);
    }
    if (retainRows) {
      // The legacy source releases object URLs while inactive. Keep decoded
      // pixels in place until the retained media rows acquire fresh URLs.
      for (const row of rows.values())
        if (['image', 'video', 'file'].includes(row.message.kind) && row.media)
          getMedia(row);
    }
    if (replyId) showReply(replyId);
    if (
      switched &&
      !following &&
      bookmark &&
      !pendingReading &&
      !ordered.some((n) => n.dataset.qqKey === bookmark.key)
    ) {
      following = true;
      bookmark = null;
    }
    updateSelection();
    restore(switched && !restoredReading);
    scheduleResize();
    if (pendingReading && !pendingReading.started && visible && next.ready !== false) {
      const task = pendingReading;
      task.started = true;
      Promise.resolve().then(() => {
        if (pendingReading === task) restoreReading(task);
      });
    }
    if (
      next.appearance?.messageMotion === 'smooth' &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      const inputTop = arrivals.length ? input.getBoundingClientRect().top : 0;
      const motions = arrivals.map((node) => ({
        node,
        dy: Math.min(72, Math.max(16, inputTop - node.getBoundingClientRect().bottom)),
      }));
      for (const { node, dy } of motions) {
        node.animate(
          [
            { transform: `translateY(${dy}px)`, opacity: 0.82 },
            { transform: 'translateY(0)', opacity: 1 },
          ],
          { duration: 200, easing: 'cubic-bezier(0.16,1,0.3,1)' },
        );
      }
    }
    if (switched) enterConversation();
    syncPresentation();
    if (becomingVisible && next.appearance?.rememberReadingPosition !== true) restore(true);
    updateSend();
  }
  function enterConversation() {
    if (!visible || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // Moving the whole message list shifts the reading anchor during first paint.
    title.getAnimations().forEach((animation) => animation.cancel());
    title.animate([{ transform: 'translateY(8px)' }, { transform: 'translateY(0)' }], {
      duration: 180,
      easing: 'cubic-bezier(0.16,1,0.3,1)',
    });
  }
  function refresh(next) {
    if (next && typeof next === 'object' && !('then' in next)) {
      setSnapshot(next);
      return;
    }
    if (scheduled || destroyed) return;
    scheduled = requestAnimationFrame(() => {
      scheduled = 0;
      try {
        const value = source.getSnapshot();
        if (value?.then) value.then(setSnapshot).catch(() => message('消息暂未读取成功'));
        else setSnapshot(value);
      } catch {
        message('消息暂未读取成功');
      }
    });
  }
  async function sendText() {
    if (sending || locked || composing || !input.value.trim() || !visible) return;
    cancelReading();
    if (!contextMatches()) {
      message('会话已改变，当前输入已保留');
      return;
    }
    const text = input.value,
      quoted = replyId,
      generation = roomGeneration,
      revision = draftRevision;
    following = true;
    bookmark = null;
    tailIntent = { generation, until: Infinity };
    restore(true);
    sending = true;
    message();
    updateSend();
    saveDraftNow();
    try {
      await source.sendText(text, quoted);
      if (destroyed || generation !== roomGeneration) return;
      if (tailIntent?.generation === generation)
        tailIntent.until = performance.now() + 1000;
      sending = false;
      locked = false;
      if (input.value === text && draftRevision === revision) {
        input.value = '';
        showReply(null);
        changedDraft();
        await saveDraftNow();
      } else {
        draftNeedsSave = true;
        saveDraftNow();
      }
      message();
      refresh();
      updateSend();
      grow();
    } catch (error) {
      if (destroyed || generation !== roomGeneration) return;
      if (tailIntent?.generation === generation) tailIntent = null;
      sending = false;
      locked = Boolean(error?.uncertain || error?.locked);
      if (locked) uncertainDraft = { text, revision, generation };
      message(
        locked
          ? '保存结果仍在确认，已保留输入，请勿重复发送'
          : '发送未完成，输入已保留，可稍后重试',
      );
      updateSend();
      refresh();
    }
  }
  async function loadOlder() {
    if (
      loadingOlder ||
      state.loadingOlder ||
      !state.hasOlder ||
      !contextMatches() ||
      !source.loadOlder
    )
      return;
    const generation = roomGeneration;
    readingIntentRevision++;
    if (tailIntent?.generation === generation) tailIntent = null;
    remember();
    following = false;
    loadingOlder = true;
    history.disabled = true;
    history.textContent = '正在读取更早消息…';
    try {
      await source.loadOlder();
      if (!destroyed && generation === roomGeneration && contextMatches()) refresh();
    } catch {
      if (!destroyed && generation === roomGeneration) message('更早消息暂未读取，可稍后重试');
    } finally {
      if (!destroyed && generation === roomGeneration) {
        loadingOlder = false;
        history.disabled = Boolean(state.loadingOlder);
        history.textContent = history.disabled ? '正在读取更早消息…' : '更早消息';
      }
    }
  }
  function quote(m) {
    if (m.pending || m.sendingState === 'messageSendingStatePending') {
      message('消息正在保存，请稍后引用');
      return;
    }
    if (m.kind === 'withdrawn' || !contextMatches()) return;
    showReply(m.id);
    changedDraft();
    closeMenu();
    input.focus({ preventScroll: true });
  }
  function exitTextSelection() {
    selectingText?.node.classList.remove('qq-select-text');
    selectingText = null;
    find('.qq-text-actions')?.remove();
    options.onTextSelection?.(false);
    (shadow.getSelection?.() || window.getSelection())?.removeAllRanges();
    message();
  }
  function exitSelection() {
    selecting = false;
    selected.clear();
    updateSelection();
  }
  function updateSelection() {
    selectionBar.hidden = !selecting;
    shell.classList.toggle('qq-selecting', selecting);
    for (const [id, row] of rows) {
      row.node.classList.toggle('qq-selected', selected.has(id));
      if (selecting) row.node.setAttribute('aria-selected', String(selected.has(id)));
      else row.node.removeAttribute('aria-selected');
    }
    selectionBar.replaceChildren();
    if (!selecting) return;
    const label = document.createElement('span');
    label.textContent = `已选 ${selected.size} 条`;
    selectionBar.append(label);
    const add = (text, task, disabled = false) => {
      const button = document.createElement('button');
      button.textContent = text;
      button.type = 'button';
      button.disabled = disabled;
      button.onclick = async () => {
        try {
          await task();
        } catch {
          message('操作未完成，选择已保留');
        }
      };
      selectionBar.append(button);
    };
    add(
      '复制',
      async () => {
        const text = (state.messages || [])
          .filter((m) => selected.has(String(m.id)))
          .map((m) => m.text || preview(m))
          .join('\n');
        await navigator.clipboard.writeText(text);
        message('已复制');
      },
      !selected.size,
    );
    if (source.forwardMessages)
      add('转发', () => source.forwardMessages([...selected]), !selected.size);
    if (source.deleteMessages)
      add(
        '删除',
        async () => {
          if ([...selected].some((id) => rows.get(id)?.message.readOnly)) return;
          await source.deleteMessages([...selected]);
          exitSelection();
        },
        !selected.size || [...selected].some((id) => rows.get(id)?.message.readOnly),
      );
    add('取消', exitSelection);
  }
  async function locateMessage(id) {
    readingIntentRevision++;
    if (tailIntent?.generation === roomGeneration) tailIntent = null;
    cancelReading();
    clearTimeout(positionTimer);
    positionTimer = 0;
    const target = String(id),
      generation = roomGeneration,
      token = ++locating;
    activeLocate = token;
    following = false;
    let previousCount = -1;
    try {
      for (let page = 0; page < 100; page++) {
        if (destroyed || generation !== roomGeneration || token !== locating) return false;
        const row = rows.get(target);
        if (row) {
          list.scrollTop +=
            row.node.getBoundingClientRect().top -
            list.getBoundingClientRect().top -
            list.clientHeight * 0.35;
          remember();
          following = false;
          row.node.classList.add('qq-located');
          setTimeout(() => row.node.classList.remove('qq-located'), 1800);
          return true;
        }
        if (!state.hasOlder || !source.loadOlder || previousCount === rows.size) break;
        previousCount = rows.size;
        await source.loadOlder();
        const next = await source.getSnapshot();
        if (generation !== roomGeneration || token !== locating) return false;
        setSnapshot(next);
      }
      message('暂未找到这条消息');
      return false;
    } finally {
      if (activeLocate === token) activeLocate = 0;
    }
  }
  function goBack() {
    if (menu) {
      closeMenu();
      return true;
    }
    if (viewer) {
      closeViewer();
      return true;
    }
    if (selectingText) {
      exitTextSelection();
      return true;
    }
    if (selecting) {
      exitSelection();
      return true;
    }
    if (!visible) return false;
    saveDraftNow();
    onBack?.();
    return true;
  }
  listen(find('.qq-back'), 'click', goBack);
  function closeMenu() {
    menu?.remove();
    menu = null;
  }
  let viewerComposer = null;
  function restoreViewerComposer() {
    const saved = viewerComposer;
    viewerComposer = null;
    if (
      !saved ||
      destroyed ||
      !visible ||
      saved.generation !== roomGeneration ||
      saved.revision !== draftRevision ||
      !contextMatches()
    )
      return;
    following = saved.following;
    bookmark = saved.bookmark;
    if (saved.focused) {
      input.focus({ preventScroll: true });
      input.setSelectionRange(saved.start, saved.end, saved.direction);
    }
    scheduleResize();
  }
  function closeViewer() {
    viewer?.querySelector('video')?.pause();
    viewer?.remove();
    viewer = null;
    restoreViewerComposer();
  }
  async function viewMedia(row) {
    if (!contextMatches()) return;
    const savedComposer = {
      generation: roomGeneration,
      revision: draftRevision,
      focused: shadow.activeElement === input,
      start: input.selectionStart,
      end: input.selectionEnd,
      direction: input.selectionDirection,
      following,
      bookmark: bookmark && { ...bookmark },
    };
    if (onViewMedia) {
      viewerComposer = savedComposer;
      input.blur();
      try {
        await onViewMedia(row.message);
      } finally {
        restoreViewerComposer();
      }
      return;
    }
    const generation = roomGeneration;
    if (!row.media) await getMedia(row);
    if (!row.media || generation !== roomGeneration || destroyed) return;
    closeViewer();
    viewerComposer = savedComposer;
    input.blur();
    viewer = document.createElement('div');
    viewer.className = 'qq-viewer';
    viewer.setAttribute('role', 'dialog');
    viewer.setAttribute('aria-label', '查看原件');
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'qq-viewer-close';
    close.textContent = '关闭';
    close.onclick = closeViewer;
    viewer.append(close);
    if (row.message.kind === 'image' || row.message.kind === 'video') {
      const media = document.createElement(row.message.kind === 'image' ? 'img' : 'video');
      media.src = row.media.url;
      if (media.tagName === 'IMG') media.alt = row.message.name || '图片';
      else {
        media.controls = true;
        media.playsInline = true;
      }
      viewer.append(media);
    } else {
      const link = document.createElement('a');
      link.href = row.media.url;
      link.download = row.media.name || row.message.name || '文件';
      link.textContent = row.media.name || row.message.name || '保存文件';
      viewer.append(link);
    }
    shadow.append(viewer);
  }
  function openMenu(row, x, y) {
    closeMenu();
    if (row.message.kind === 'withdrawn') return;
    const generation = roomGeneration,
      id = String(row.message.id);
    menu = document.createElement('div');
    menu.className = 'qq-menu';
    menu.setAttribute('role', 'menu');
    const action = (label, task) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.setAttribute('role', 'menuitem');
      button.onclick = async () => {
        suppressClickUntil = 0;
        closeMenu();
        if (generation !== roomGeneration || !rows.has(id) || !contextMatches()) return;
        try {
          await task();
        } catch {
          if (generation === roomGeneration) message('操作未完成，请稍后重试');
        }
      };
      menu.append(button);
    };
    if (row.message.text)
      action('选择文字', () => {
        exitTextSelection();
        selectingText = row;
        row.node.classList.add('qq-select-text');
        options.onTextSelection?.(true);
        const bar = document.createElement('div');
        bar.className = 'qq-text-actions qq-menu';
        const selectedText = () => {
          // Window selection retargets shadow anchors to BODY on Android WebView.
          const localSelection = shadow.getSelection?.();
          const selection = localSelection?.rangeCount ? localSelection : window.getSelection();
          const body = row.content.querySelector('.qq-text');
          return selection?.rangeCount &&
            body?.contains(selection.anchorNode) &&
            body.contains(selection.focusNode)
            ? selection.toString()
            : '';
        };
        for (const [label, task] of [
          [
            '复制所选',
            async () => {
              const text = selectedText();
              if (text) await navigator.clipboard.writeText(text);
            },
          ],
          ['引用本条', () => quote(row.message)],
          ['结束选择', exitTextSelection],
        ]) {
          const button = document.createElement('button');
          button.textContent = label;
          button.onclick = () => Promise.resolve(task()).catch(() => message('复制未完成，请重试'));
          button.onpointerdown = (event) => event.preventDefault();
          bar.append(button);
        }
        shadow.append(bar);
        message('长按正文拖动选字，再点击复制所选');
      });
    action('多选', () => {
      selecting = true;
      selected.add(id);
      updateSelection();
    });
    if (source.forwardMessages) action('转发', () => source.forwardMessages([id]));
    if (source.deleteMessages && !row.message.readOnly)
      action('删除', () => source.deleteMessages([id]));
    if (row.message.text)
      action('复制', async () => {
        if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(row.message.text);
        else {
          const field = document.createElement('textarea');
          field.value = row.message.text;
          shadow.append(field);
          field.select();
          const copied = document.execCommand('copy');
          field.remove();
          if (!copied) throw new Error('COPY_FAILED');
        }
      });
    action('引用', () => quote(row.message));
    if (
      row.message.outgoing &&
      !row.message.readOnly &&
      !row.message.pending &&
      row.message.sendingState !== 'messageSendingStatePending' &&
      source.withdraw
    )
      action('撤回', () => source.withdraw(id));
    if (row.message.kind === 'image' && onCollect) action('收藏图片', () => onCollect(row.message));
    shadow.append(menu);
    menu.style.left = `${Math.max(6, Math.min(window.innerWidth - menu.offsetWidth - 6, x))}px`;
    menu.style.top = `${Math.max(6, Math.min(window.innerHeight - menu.offsetHeight - 6, y))}px`;
  }
  function cancelGesture() {
    if (gesture) {
      releaseGestureLease(gesture);
      clearTimeout(gesture.timer);
      gesture.row.node.style.removeProperty('--qq-swipe');
      try {
        if (gesture.row.node.hasPointerCapture(gesture.id))
          gesture.row.node.releasePointerCapture(gesture.id);
      } catch {
        /* Synthetic pointer cancellation has no active capture. */
      }
    }
    gesture = null;
  }
  function releaseGestureLease(current) {
    if (!current.leaseActive) return;
    current.leaseActive = false;
    options.onMessageGesture?.({
      active: false,
      roomId: current.roomId,
      generation: current.generation,
    });
  }
  listen(
    window,
    'pointerdown',
    (event) => {
      pointers.add(event.pointerId);
      if (pointers.size > 1) cancelGesture();
    },
    { capture: true },
  );
  listen(items, 'pointerdown', (event) => {
    pointers.add(event.pointerId);
    if (pointers.size > 1) {
      cancelGesture();
      return;
    }
    if (event.button !== 0 || !visible || selecting || selectingText) return;
    const node = event.target.closest('[data-qq-message-id]'),
      row = node && rows.get(node.dataset.qqMessageId);
    if (!row || row.message.kind === 'withdrawn') return;
    if (shadow.activeElement === input) event.preventDefault();
    closeMenu();
    cancelGesture();
    const current = {
      row,
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      dx: 0,
      dy: 0,
      axis: null,
      roomId: room,
      generation: roomGeneration,
      held: false,
      leaseActive: true,
    };
    current.timer = setTimeout(() => {
      if (
        gesture !== current ||
        current.generation !== roomGeneration ||
        Math.abs(current.dx) > 8 ||
        Math.abs(current.dy) > 8
      )
        return;
      current.held = true;
      suppressClickUntil = performance.now() + 600;
      openMenu(row, current.x, current.y);
    }, 450);
    gesture = current;
    options.onMessageGesture?.({
      active: true,
      roomId: current.roomId,
      generation: current.generation,
    });
    try {
      node.setPointerCapture(event.pointerId);
    } catch {
      /* Tests or cancelled native pointers need no capture. */
    }
  });
  listen(
    items,
    'pointermove',
    (event) => {
      const current = gesture;
      if (!current || current.id !== event.pointerId) return;
      current.dx = event.clientX - current.x;
      current.dy = event.clientY - current.y;
      if (Math.abs(current.dx) > 8 || Math.abs(current.dy) > 8) {
        clearTimeout(current.timer);
        releaseGestureLease(current);
      }
      if (!current.axis && Math.max(Math.abs(current.dx), Math.abs(current.dy)) > 10)
        current.axis =
          Math.abs(current.dx) > Math.abs(current.dy) * 1.5 ? 'horizontal' : 'vertical';
      if (current.axis === 'horizontal' && current.dx < 0 && !current.held) {
        event.preventDefault();
        current.row.node.style.setProperty('--qq-swipe', `${Math.max(-42, current.dx * 0.5)}px`);
      }
    },
    { passive: false },
  );
  listen(window, 'pointerup', (event) => {
    pointers.delete(event.pointerId);
    const current = gesture;
    if (!current || current.id !== event.pointerId) return;
    const swipe =
      !current.held &&
      current.axis === 'horizontal' &&
      current.dx <= -54 &&
      Math.abs(current.dy) < 28 &&
      current.generation === roomGeneration;
    cancelGesture();
    if (swipe) {
      suppressClickUntil = performance.now() + 400;
      quote(current.row.message);
    }
  });
  listen(window, 'pointercancel', (event) => {
    pointers.delete(event.pointerId);
    cancelGesture();
  });
  listen(window, 'blur', () => {
    pointers.clear();
    cancelGesture();
  });
  listen(window, 'keydown', (event) => {
    if (pickerFocusToken && (event.key === 'Escape' || event.key === 'BrowserBack'))
      invalidatePickerFocus();
  });
  listen(items, 'mousedown', (event) => {
    if (!selectingText && shadow.activeElement === input) event.preventDefault();
  });
  listen(items, 'contextmenu', (event) => {
    event.preventDefault();
  });
  listen(items, 'click', (event) => {
    event.stopPropagation();
    if (performance.now() < suppressClickUntil) {
      event.preventDefault();
      return;
    }
    const node = event.target.closest('[data-qq-message-id]'),
      row = node && rows.get(node.dataset.qqMessageId);
    if (row && selecting) {
      const id = String(row.message.id);
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      updateSelection();
      return;
    }
    if (selectingText) return;
    if (row && ['image', 'video', 'file'].includes(row.message.kind)) viewMedia(row);
    // Ordinary text click intentionally has no action.
  });
  listen(shadow, 'pointerdown', (event) => {
    if (pickerFocusToken && !event.target.closest('.qq-files')) invalidatePickerFocus();
    if (
      shadow.activeElement === input &&
      event.target.closest('button') &&
      !event.target.closest('.qq-back,.qq-settings,.qq-viewer')
    )
      event.preventDefault();
    if (menu && !event.composedPath().includes(menu)) closeMenu();
  });
  // Android WebView may still dispatch compatibility mouse focus after touch.
  listen(shadow, 'mousedown', (event) => {
    if (
      event.button === 0 &&
      shadow.activeElement === input &&
      event.target.closest('button') &&
      !event.target.closest('.qq-back,.qq-settings,.qq-viewer')
    )
      event.preventDefault();
  });
  listen(shadow, 'click', (event) => event.stopPropagation());
  listen(
    list,
    'scroll',
    () => {
      if (userScrollIntent > performance.now()) {
        userScrollIntent = 0;
        tailIntent = null;
        readingIntentRevision++;
        remember();
        queueReading();
      }
      if (Math.abs(list.clientHeight - lastListHeight) > 1) {
        lastListHeight = list.clientHeight;
        markLayoutScroll();
        scheduleResize();
        return;
      }
      if (layoutScroll || pendingReading) return;
      tailIntent = null;
      readingIntentRevision++;
      remember();
      queueReading();
      if (gesture && gesture.axis !== 'horizontal') cancelGesture();
    },
    { passive: true },
  );
  const userReadsList = () => {
    tailIntent = null;
    readingIntentRevision++;
    userScrollIntent = performance.now() + 600;
    cancelReading();
  };
  listen(list, 'pointerdown', userReadsList, { passive: true });
  listen(list, 'touchstart', userReadsList, { passive: true });
  listen(list, 'wheel', userReadsList, { passive: true });
  listen(input, 'input', changedDraft);
  const invalidatePickerFocus = () => {
    focusIntentRevision++;
    if (pickerFocusToken) pickerFocusToken.invalid = true;
  };
  listen(input, 'blur', () => {
    if (pickerFocusToken?.pickerOpen && pickerFocusToken.allowPickerBlur) {
      pickerFocusToken.allowPickerBlur = false;
      return;
    }
    invalidatePickerFocus();
  });
  listen(input, 'compositionstart', () => {
    if (pickerFocusToken) invalidatePickerFocus();
    composing = true;
    updateSend();
  });
  listen(input, 'compositionend', () => {
    composing = false;
    compositionEndedAt = performance.now();
    changedDraft();
  });
  listen(input, 'keydown', (event) => {
    event.stopPropagation();
    if (
      event.key !== 'Enter' ||
      state.appearance?.enterToSend !== true ||
      event.shiftKey ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    )
      return;
    if (composing || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    if (event.repeat || performance.now() - compositionEndedAt < 100) return;
    sendText();
  });
  // A touch on Send must not transfer focus out of the writing surface. Keep
  // this synchronous: refocusing after an ACK could reopen an IME the user hid.
  listen(send, 'pointerdown', (event) => {
    if (event.isPrimary && event.button === 0 && shadow.activeElement === input)
      event.preventDefault();
  });
  listen(send, 'mousedown', (event) => {
    if (event.button === 0 && shadow.activeElement === input) event.preventDefault();
  });
  listen(send, 'click', sendText);
  listen(history, 'click', loadOlder);
  listen(reply.querySelector('button'), 'click', () => {
    showReply(null);
    changedDraft();
  });
  listen(find('.qq-settings'), 'click', () => {
    closeMenu();
    saveDraftNow();
    onSettings?.();
  });
  listen(find('.qq-files'), 'click', () => {
    closeMenu();
    saveDraftNow();
    onFiles?.();
  });
  listen(find('.qq-stickers'), 'click', () => {
    closeMenu();
    saveDraftNow();
    onStickers?.();
  });
  listen(document, 'visibilitychange', () => {
    if (document.hidden) {
      flushReadingOnHide();
      saveDraftNow();
      cancelGesture();
    }
  });
  listen(window, 'pagehide', flushReadingOnHide);
  unsubscribe = source.subscribe((next) => refresh(next));
  try {
    const initial = source.getSnapshot();
    if (initial?.then) initial.then(setSnapshot).catch(() => message('消息暂未读取成功'));
    else setSnapshot(initial);
  } catch {
    message('消息暂未读取成功');
  }
  return {
    styleReady,
    flushReadingPosition: flushReadingOnHide,
    beforeViewportResize() {
      if (!visible || pendingReading) return;
      markLayoutScroll();
      scheduleResize();
    },
    setWallpaperViewport(width, height, offsetTop) {
      // Paint against the largest viewport at this width, independent of IME/list layout.
      setStyle('--qq-wallpaper-width', `${width}px`);
      setStyle('--qq-wallpaper-height', `${height}px`);
      setStyle('--qq-wallpaper-top', `${-offsetTop}px`);
    },
    snapshot: () => ({
      roomId: room,
      visible,
      presentation: presentation
        ? {
            ...presentation,
            contentVisible:
              visible &&
              !presentation.sourcePending &&
              (Boolean(presentationSettled()) || presentation.preserveContent === true),
          }
        : null,
      wallpaperImages: {
        active: activeWallpaper ? 1 : 0,
        preparing: preparingWallpaper?.image ? 1 : 0,
      },
      draft: input.value,
      replyId,
      sending,
      locked,
      composing,
      messageIds: [...rows.keys()],
      nodeCount: rows.size,
      menuOpen: Boolean(menu),
      selectedIds: [...selected],
      selecting,
      selectingText: Boolean(selectingText),
      viewerOpen: Boolean(viewer),
      hasOlder: Boolean(state.hasOlder),
      loadingOlder: loadingOlder || Boolean(state.loadingOlder),
      totalMessages: state.totalMessages ?? rows.size,
    }),
    getReplyId: () => (contextMatches() ? replyId : null),
    setExternalSendStatus(text, roomId) {
      if (!visible || !contextMatches() || String(roomId) !== room) return false;
      message(text);
      return true;
    },
    captureComposerFocus() {
      if (!visible || !contextMatches() || composing || shadow.activeElement !== input) return null;
      if (pickerFocusToken) pickerFocusToken.invalid = true;
      const token = {
        room, generation: roomGeneration, revision: draftRevision,
        intent: focusIntentRevision, consumed: false, invalid: false,
        pickerOpen: false, allowPickerBlur: false,
        start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection,
      };
      pickerFocusToken = token;
      return token;
    },
    markPickerOpened(token) {
      if (!token || token.consumed || token.invalid || pickerFocusToken !== token) return false;
      token.pickerOpen = true;
      token.allowPickerBlur = true;
      return true;
    },
    restoreComposerFocus(token) {
      if (!token || token.consumed) return false;
      token.consumed = true;
      if (pickerFocusToken === token) pickerFocusToken = null;
      if (token.invalid || !token.pickerOpen || destroyed || !visible || !contextMatches() ||
          composing || token.intent !== focusIntentRevision ||
          token.room !== room || token.generation !== roomGeneration ||
          token.revision !== draftRevision) return false;
      if (shadow.activeElement === input) return true;
      input.focus({ preventScroll: true });
      input.setSelectionRange(token.start, token.end, token.direction);
      scheduleResize();
      return true;
    },
    captureMediaSendState() {
      if (!visible || !contextMatches()) return null;
      const atTail = following || list.scrollHeight - list.scrollTop - list.clientHeight < 48;
      const token = {
        kind: 'media', room, generation: roomGeneration,
        contextVersion: renderedContext?.version ?? null,
        draftRevision, replyId, readingRevision: readingIntentRevision,
        following: atTail,
      };
      if (atTail) tailIntent = { generation: roomGeneration, until: Infinity, owner: token };
      return token;
    },
    cancelMediaSendState(token) {
      if (!token || tailIntent?.owner !== token) return false;
      tailIntent = null;
      return true;
    },
    locateMessage,
    captureComposerState() {
      return contextMatches()
        ? {
            room,
            contextVersion: renderedContext?.version ?? null,
            draftRevision,
            text: input.value,
          }
        : null;
    },
    afterExternalSend(result, token) {
      if (!contextMatches()) return false;
      if (token?.kind === 'media') {
        if (destroyed || !visible || token.room !== room ||
            token.generation !== roomGeneration ||
            token.contextVersion !== (renderedContext?.version ?? null) ||
            (result?.roomId != null && roomKey(result.roomId) !== room)) {
          if (tailIntent?.owner === token) tailIntent = null;
          return false;
        }
        const follow = token.following && token.readingRevision === readingIntentRevision &&
          !pendingReading;
        if (tailIntent?.owner === token) tailIntent = null;
        if (follow) {
          cancelReading();
          following = true;
          bookmark = null;
          tailIntent = { generation: roomGeneration, until: performance.now() + 1000 };
        }
        if (token.replyId != null && token.draftRevision === draftRevision &&
            token.replyId === replyId && !composing) {
          showReply(null);
          changedDraft();
          saveDraftNow();
        }
        refresh();
        if (follow) restore(true);
        return true;
      }
      if (
        token &&
        (token.room !== room ||
          token.contextVersion !== (renderedContext?.version ?? null) ||
          token.draftRevision !== draftRevision ||
          token.text !== input.value ||
          composing)
      )
        return false;
      cancelReading();
      if (result?.roomId != null && roomKey(result.roomId) !== room) return;
      following = true;
      bookmark = null;
      tailIntent = { generation: roomGeneration, until: performance.now() + 2500 };
      if (!token) {
        showReply(null);
        changedDraft();
        saveDraftNow();
        refresh();
        restore(true);
        return true;
      }
      // Do not show an empty composer until its source-owned clear has a durable ACK.
      // A navigation/process stop before that ACK may leave the old recoverable draft.
      dirty = true;
      const clearScope = draftScope;
      const clearAck = saveDraftNow({ force: true, text: '', replyId: null });
      refresh();
      restore(true);
      return clearAck.then(({ saved }) => {
        const cached = roomDrafts.get(clearScope);
        const staleCache = cached?.revision === token.draftRevision && cached.text === token.text;
        if (saved === true && staleCache) roomDrafts.delete(clearScope);
        const stillCurrent =
          !destroyed &&
          room === token.room &&
          (renderedContext?.version ?? null) === token.contextVersion &&
          draftRevision === token.draftRevision &&
          input.value === token.text;
        const returnedToOldDraft =
          saved === true &&
          staleCache &&
          draftScope === clearScope &&
          room === token.room &&
          input.value === token.text &&
          !dirty &&
          !composing &&
          !sending;
        if (!stillCurrent && !returnedToOldDraft) return false;
        if (saved !== true) {
          message('表情已发送，但草稿清空未保存；原输入已保留，请勿重复发送表情');
          return false;
        }
        input.value = '';
        showReply(null);
        draftRevision++;
        draftNeedsSave = false;
        dirty = false;
        roomDrafts.delete(clearScope);
        updateSend();
        grow();
        input.dispatchEvent(new window.Event('qq-draft-change'));
        return true;
      });
    },
    back: goBack,
    refresh,
    setActive(value) {
      const activating = !enabled && Boolean(value);
      if (enabled && !value && visible && !pendingReading) {
        remember();
        saveReading();
      }
      enabled = Boolean(value);
      if (activating && state.appearance?.rememberReadingPosition !== true) {
        following = true;
        bookmark = null;
      }
      visible = enabled && Boolean(room) && state.inConversation !== false;
      if (!visible) {
        userScrollIntent = 0;
        if (presentation?.status === 'loading') invalidatePresentation();
        else cancelPreparingWallpaper();
        syncPresentation();
        saveDraftNow();
        closeMenu();
        closeViewer();
        cancelGesture();
        options.onRoomChange?.(null);
      } else {
        if (activating && !(rows.size && presentationSettled() && contextMatches()))
          readActivationSnapshot();
        if (!presentation?.sourcePending) updateWallpaper(state.appearance);
        syncPresentation();
        if (activating && state.appearance?.rememberReadingPosition !== true) restore(true);
        if (!presentation?.sourcePending) refresh();
        scheduleResize();
        if (activating) enterConversation();
        if (pendingReading && !pendingReading.started && state.ready !== false) {
          const task = pendingReading;
          task.started = true;
          Promise.resolve().then(() => {
            if (pendingReading === task) restoreReading(task);
          });
        }
      }
    },
    destroy() {
      if (destroyed) return;
      if (visible && !pendingReading) {
        remember();
        saveReading();
      }
      clearTimeout(positionTimer);
      saveDraftNow();
      destroyed = true;
      invalidatePresentation();
      activeWallpaper = null;
      wallpaperLayer.replaceChildren();
      roomGeneration++;
      clearTimeout(draftTimer);
      cancelAnimationFrame(scheduled);
      cancelAnimationFrame(resizeFrame);
      observer?.disconnect();
      cancelGesture();
      closeMenu();
      closeViewer();
      unsubscribe?.();
      cleanups.forEach((remove) => remove());
      host.remove();
      rows.clear();
      separators.clear();
      options.onDestroy?.();
    },
  };
}
