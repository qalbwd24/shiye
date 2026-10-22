import { createQuickCaptureSession } from './quick-capture-session.js';
import { createQuickWindowSettings } from './quick-window-settings.js';

/** Compact shell over the existing editor. Native messages never carry diary bodies. */
export function installQuickCapture(c) {
  const host = window.chrome?.webview;
  let history = [],
    ready = false,
    flushInFlight = null,
    syncTimer = null,
    backgrounded = false,
    activationInFlight = null;
  let lastTextField = 'body';
  const post = (type, extra = {}) => host?.postMessage({ type, ...extra });
  document.addEventListener('focusin', (event) => {
    if (event.target.id === 'entryTitle') lastTextField = 'title';
    else if (event.target.closest?.('#bodyEditor')) lastTextField = 'body';
    if (
      event.target.matches?.('#entryTitle, .category-picker__search') ||
      event.target.closest?.('#bodyEditor')
    )
      post('input-focus');
  });
  // An activation can retain the DOM focus and therefore generate no focusin.
  window.addEventListener('focus', () => {
    if (
      document.activeElement?.matches?.('#entryTitle, .category-picker__search') ||
      document.activeElement?.closest?.('#bodyEditor')
    )
      post('input-focus');
  });
  if (host) {
    document.addEventListener(
      'keydown',
      (event) => {
        if (document.querySelector('.gallery-viewer[open]')) return;
        if (
          !event.ctrlKey ||
          event.altKey ||
          event.metaKey ||
          event.isComposing ||
          event.keyCode === 229
        )
          return;
        const step = ['+', '='].includes(event.key)
          ? 1
          : event.key === '-'
            ? -1
            : event.key === '0'
              ? 0
              : null;
        if (step === null) return;
        event.preventDefault();
        event.stopPropagation();
        post('zoom-step', { step });
      },
      true,
    );
    document.addEventListener(
      'wheel',
      (event) => {
        if (document.querySelector('.gallery-viewer[open]')) return;
        if (!event.ctrlKey || !event.deltaY) return;
        event.preventDefault();
        post('zoom-step', { step: event.deltaY < 0 ? 1 : -1 });
      },
      { passive: false, capture: true },
    );
  }
  const bar = document.createElement('nav');
  bar.className = 'quick-capture-bar';
  bar.setAttribute('aria-label', '思绪');
  const session = createQuickCaptureSession({
    freeze: c.freeze,
    flush: async () => {
      // A pending category choice belongs to the new-entry workflow. Closing
      // the quick window cancels it; other dialogs still block close so a
      // conflict or conversion cannot be silently discarded.
      if (document.querySelector('dialog[open]') && !session.categoryPending)
        throw Error('请先完成或取消当前弹窗');
      c.commit?.();
      document.activeElement?.blur();
      await new Promise(requestAnimationFrame);
      c.commit?.();
      await c.flush();
      c.resumePosition?.saved();
    },
    chooseCategory: c.chooseCategory,
    cancelCategory: c.cancelCategory,
    mountNew: (category) => c.newEntry(new Date(), { _confirmedCategory: category }),
    mountEntry: async (id) => {
      await c.refreshLibrary();
      await c.selectEntry(id);
    },
    focusBody: c.focus,
    current: c.current,
    pending: c.pending,
    persistedId: () => (c.current()?._unsaved ? null : c.current()?.id),
    getHistory: () => history,
    setHistory: (ids) => {
      history = ids;
    },
    getAccessibleEntries: async () => {
      history = (await c.api('/api/quick-history')).ids;
      return (await c.api('/api/library')).entries;
    },
    openMain: (id) => {
      if (host) post('open-main', { id });
      else window.open('/?entry=' + encodeURIComponent(id), 'shiye-main');
    },
    closeWindow: () => {
      c.resumePosition?.saved();
      if (host) {
        backgrounded = true;
        post('close-ready', { resume: !!c.current() });
      } else {
        stopSync();
        window.close();
      }
    },
  });
  function saveOnBoundary() {
    if (flushInFlight || !c.pending?.()) return;
    flushInFlight = Promise.resolve()
      .then(() => c.flush())
      .catch((error) => c.toast(error.message))
      .finally(() => {
        flushInFlight = null;
      });
  }
  // Native WebView2 sends request-close, but a fast window close can first
  // deliver blur/visibility. Start the same queue early; the close handshake
  // still awaits the queue and remains the final authority.
  window.addEventListener('blur', saveOnBoundary);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) saveOnBoundary();
  });
  async function run(action) {
    try {
      if (['close', 'newEntry', 'previous', 'next', 'latest'].includes(action))
        c.resumePosition?.capture(lastTextField);
      const result = await session[action]();
      if (result.status === 'opened') c.resumePosition?.restore();
      if (result.status === 'no-previous')
        c.toast(action === 'latest' ? '暂无最近编辑的篇目' : '暂无上一篇');
      if (result.status === 'empty') c.toast('先写一点内容，再到主页打开这一篇');
      if (result.status === 'busy') c.toast('正在保存或选择分类，请稍候');
      return result;
    } catch (error) {
      c.toast(error.message);
      post('close-failed');
    }
  }
  for (const [label, action] of [
    ['新一篇', 'newEntry'],
    ['最新篇', 'latest'],
    ['上一篇', 'previous'],
    ['下一篇', 'next'],
    ['主页打开', 'openMain'],
  ]) {
    const button = document.createElement('button');
    button.className = 'secondary';
    button.textContent = label;
    button.onclick = () => run(action);
    bar.append(button);
  }
  const quickSettings = createQuickWindowSettings({
    version: c.version,
    editor: c.editor,
    readingDocument: c.readingDocument,
    modal: c.modal,
    closeModal: c.closeModal,
    settings: c.settings,
    close: () => run('close'),
    native: !!host,
    post,
  });
  const settings = document.createElement('button');
  settings.className = 'secondary';
  settings.textContent = '设置';
  settings.onclick = quickSettings.show;
  bar.append(settings);
  document.querySelector('.workspace').prepend(bar);
  document.title = '拾页 · 思绪';
  host?.addEventListener('message', (event) => {
    if (!ready) return;
    if (['window-state', 'window-settings-error'].includes(event.data?.type))
      quickSettings.update(event.data);
    if (event.data?.type === 'backgrounded') {
      backgrounded = true;
      c.resumePosition?.capture(lastTextField);
      stopSync();
    }
    if (event.data?.type === 'request-close') run('close');
    if (event.data?.type === 'new-entry') {
      backgrounded = false;
      run('newEntry');
    }
    if (event.data?.type === 'focus-editor') {
      if (activationInFlight) return;
      activationInFlight = activate().finally(() => {
        activationInFlight = null;
      });
    }
  });
  async function activate() {
    startSync();
    const picker = document.querySelector('.category-picker[open] .category-picker__search');
    if (picker) {
      backgrounded = false;
      picker.focus({ preventScroll: true });
      post('input-focus');
      return;
    }
    if (document.querySelector('dialog[open]')) {
      backgrounded = false;
      return;
    }
    const wasBackgrounded = backgrounded;
    if (wasBackgrounded) {
      backgrounded = false;
      const result = await run('resumeLatest');
      if (!result || result.status === 'busy') return;
      if (result.status === 'opened') {
        post('input-focus');
        return;
      }
    }
    if (wasBackgrounded && c.resumePosition?.restore()) {
      post('input-focus');
      return;
    }
    if (lastTextField === 'title') document.querySelector('#entryTitle').focus();
    else (c.focusBody || c.focus)();
    post('input-focus');
  }
  // The hidden main new-entry buttons and global configurable shortcut share this session.
  document.querySelector('#emptyNew').onclick = () => run('newEntry');
  function stopSync() {
    if (syncTimer) clearInterval(syncTimer);
    syncTimer = null;
  }
  function startSync() {
    if (syncTimer) return;
    syncTimer = window.setInterval(() => {
      if (ready && !session.busy) c.commit?.();
    }, 300);
  }
  return {
    session,
    async start() {
      ready = true;
      // Some WebView2/IME paths update the visible editor one task later than
      // the normal CodeMirror listener. commit() only marks dirty on changes.
      startSync();
      post('ready');
      await run('newEntry');
    },
  };
}
