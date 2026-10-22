import {
  createStickerSuggestionIndex,
  hasLocalStickerOriginal,
} from './shared/sticker-suggestions.js';

/** Input metadata suggestions only; never submits text or modifies the composer. */
export function installStickerSuggestions(host = window) {
  if (host.shiyeStickerSuggestions) return host.shiyeStickerSuggestions;
  const doc = host.document;
  let index = createStickerSuggestionIndex(),
    dirty = true,
    rebuilding;
  let queryTimer,
    rebuildTimer,
    panel,
    status,
    composing = false,
    sending = false;
  let epoch = 0,
    closed = false,
    dismissedText,
    observedAssets;
  const restores = [];
  const metadata = new Map();
  const signature = (asset) =>
    JSON.stringify([
      asset?.name,
      asset?.note,
      asset?.removed,
      asset?.blob?.size,
      asset?.blob?.type,
    ]);
  const currentInput = () => doc.querySelector('#editable-message-text');
  const roomKey = () => host.location.hash;
  function editor() {
    let result;
    host.dispatchEvent(
      new host.CustomEvent('shiye-editor-request', {
        detail: {
          receive: (value) => {
            result = value;
          },
        },
      }),
    );
    return result;
  }
  function textOf(input) {
    return input?.editor?.getText?.() ?? input?.innerText ?? input?.textContent ?? '';
  }
  function hide() {
    panel?.remove();
    panel = status = undefined;
  }
  function invalidate() {
    if (closed) return;
    dirty = true;
    host.clearTimeout(rebuildTimer);
    rebuildTimer = host.setTimeout(() => {
      rebuildTimer = undefined;
      rebuild()
        .then(schedule)
        .catch(() => hide());
    }, 150);
  }
  function observeStore() {
    const store = host.shiyeLocalAssets;
    if (!store || store === observedAssets) return;
    observedAssets = store;
    for (const name of ['put', 'saveMapping', 'remove']) {
      const original = store[name];
      if (typeof original !== 'function') continue;
      const wrapped = function (...args) {
        const result = original.apply(this, args);
        Promise.resolve(result).then(
          () => {
            const id = typeof args[0] === 'string' ? args[0] : args[0]?.id;
            if (
              name === 'put' &&
              id?.startsWith('sticker:') &&
              metadata.get(id) === signature(args[0])
            )
              return;
            if (name === 'saveMapping' || /^(sticker:|mapping:)/u.test(id || '')) invalidate();
          },
          () => {},
        );
        return result;
      };
      store[name] = wrapped;
      restores.push(() => {
        if (store[name] === wrapped) store[name] = original;
      });
    }
  }
  async function rebuild() {
    observeStore();
    if (rebuilding) return rebuilding;
    if (!dirty || !host.shiyeLocalAssets?.list) return;
    dirty = false;
    rebuilding = (async () => {
      try {
        const [assets, mappings] = await Promise.all([
          host.shiyeLocalAssets.list('sticker:'),
          host.shiyeLocalAssets.list('mapping:'),
        ]);
        if (!closed) {
          index = createStickerSuggestionIndex(assets, mappings);
          metadata.clear();
          for (const asset of assets) metadata.set(asset.id, signature(asset));
        }
      } catch (error) {
        dirty = true;
        throw error;
      }
    })().finally(() => {
      rebuilding = undefined;
    });
    return rebuilding;
  }
  function position() {
    const composer = doc.querySelector('.Composer.is-chat-composer');
    if (!panel || !composer) return hide();
    panel.style.bottom =
      Math.max(6, host.innerHeight - composer.getBoundingClientRect().top + 6) + 'px';
  }
  async function choose(id, expectedInput, expectedRoom) {
    if (composing || sending) return;
    sending = true;
    const owner = panel;
    for (const button of owner?.querySelectorAll('button') || []) button.disabled = true;
    if (status) status.textContent = '正在发送…';
    try {
      const asset = await host.shiyeLocalAssets.get(id);
      if (!hasLocalStickerOriginal(asset)) throw Error('原表情包已移除或不可用');
      const owned = await host.shiyeStickers.materialize(asset);
      const target = editor();
      if (
        composing ||
        target?.input !== expectedInput ||
        currentInput() !== expectedInput ||
        roomKey() !== expectedRoom ||
        !target?.sendSticker
      )
        throw Error('会话或输入状态已改变，请重新选择');
      const file = new host.File([owned.blob], owned.name || '表情包', { type: owned.blob.type });
      file.shiyeOriginalSticker = true;
      await target.sendSticker(file); // Actual platform persistence ACK; keeps draft/reply.
      dismissedText = textOf(expectedInput);
      if (panel === owner) hide();
      expectedInput.focus({ preventScroll: true });
    } catch (error) {
      if (panel === owner && status)
        status.textContent = error.message || '发送未完成，点击表情可重试';
    } finally {
      sending = false;
      for (const button of owner?.querySelectorAll('button') || []) button.disabled = false;
    }
  }
  async function render() {
    const generation = ++epoch,
      input = currentInput();
    if (sending) return;
    if (
      closed ||
      composing ||
      !input ||
      doc.activeElement !== input ||
      doc.querySelector('dialog[open]') ||
      doc.querySelector('.shiye-command-panel')
    )
      return hide();
    const text = textOf(input),
      room = roomKey();
    if (!text.trim() || text === dismissedText || /^\s*\//u.test(text)) return hide();
    await rebuild();
    if (
      closed ||
      generation !== epoch ||
      composing ||
      text !== textOf(input) ||
      room !== roomKey() ||
      input !== currentInput()
    )
      return;
    const candidates = index.search(text, 5);
    hide();
    if (!candidates.length) return;
    panel = doc.createElement('section');
    panel.className = 'shiye-sticker-suggestions';
    panel.setAttribute('aria-label', '本地表情候选');
    const strip = doc.createElement('div');
    strip.className = 'shiye-sticker-suggestion-items';
    status = doc.createElement('span');
    status.className = 'shiye-sticker-suggestion-status';
    status.setAttribute('role', 'status');
    panel.append(strip, status);
    for (const candidate of candidates) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'shiye-sticker-suggestion';
      button.setAttribute('aria-label', '发送候选表情：' + candidate.name);
      const image = doc.createElement('img');
      image.alt = '';
      const label = doc.createElement('span');
      label.textContent = candidate.name;
      button.append(image, label);
      strip.append(button);
      button.addEventListener('pointerdown', (event) => event.preventDefault());
      button.addEventListener('click', () => {
        void choose(candidate.id, input, room);
      });
      const owner = panel;
      host.shiyeLocalAssets
        .get(candidate.id)
        .then((asset) => host.shiyeStickers.preview(asset))
        .then((blob) => {
          if (closed || panel !== owner) return;
          const url = host.URL.createObjectURL(blob);
          image.src = url;
          image.onload = image.onerror = () => host.URL.revokeObjectURL(url);
        })
        .catch(() => {
          image.alt = '预览不可用';
        });
    }
    doc.body.append(panel);
    position();
  }
  function schedule() {
    if (closed) return;
    ++epoch;
    host.clearTimeout(queryTimer);
    queryTimer = host.setTimeout(() => {
      queryTimer = undefined;
      render().catch(() => hide());
    }, 150);
  }
  const isInputEvent = (event) =>
    event.target === currentInput() || event.target?.closest?.('#editable-message-text');
  function changed(event) {
    if (isInputEvent(event)) {
      dismissedText = undefined;
      schedule();
    }
  }
  function compositionStart(event) {
    if (isInputEvent(event)) {
      composing = true;
      ++epoch;
      hide();
    }
  }
  function compositionEnd(event) {
    if (isInputEvent(event)) {
      composing = false;
      dismissedText = undefined;
      schedule();
    }
  }
  function outside(event) {
    if (panel && !panel.contains(event.target) && !isInputEvent(event)) {
      ++epoch;
      hide();
    }
  }
  function navigation() {
    ++epoch;
    hide();
  }
  const listeners = [
    [doc, 'input', changed],
    [doc, 'compositionstart', compositionStart],
    [doc, 'compositionend', compositionEnd],
    [doc, 'pointerdown', outside],
    [doc, 'focusin', changed],
    [host, 'shiye-stickers-updated', invalidate],
    [host, 'shiye-mappings-updated', invalidate],
    [host, 'hashchange', navigation],
    [host, 'resize', position],
  ];
  for (const [target, type, fn] of listeners) target.addEventListener(type, fn, true);
  observeStore();
  rebuild().catch(() => {});
  const api = {
    refresh: invalidate,
    snapshot: () => ({ indexed: index.size, visible: Boolean(panel), composing, sending }),
    destroy() {
      closed = true;
      ++epoch;
      hide();
      host.clearTimeout(queryTimer);
      host.clearTimeout(rebuildTimer);
      for (const [target, type, fn] of listeners) target.removeEventListener(type, fn, true);
      for (const restore of restores) restore();
      delete host.shiyeStickerSuggestions;
    },
  };
  host.shiyeStickerSuggestions = api;
  return api;
}
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  let attempts = 0;
  const start = () => {
    if (
      window.shiyeLocalAssets?.list &&
      window.shiyeStickers?.preview &&
      window.shiyeStickers?.materialize
    )
      installStickerSuggestions(window);
    else if (++attempts < 150) window.setTimeout(start, 200);
  };
  start();
}
