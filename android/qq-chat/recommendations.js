import {
  createStickerSuggestionIndex,
  hasLocalStickerOriginal,
} from '../shared/sticker-suggestions.js';
import { ORDER_KEY, rankStickerSuggestions, recordStickerUse } from './sticker-ranking.js';

/** Metadata suggestions for the independent input; the existing source owns writes. */
export function installQQRecommendations({ source, view }) {
  const host = window;
  let destroyed = false,
    input,
    frameRoot,
    outer,
    strip,
    style,
    timer,
    observer,
    unsubscribe,
    composing = false,
    sending = false,
    generation = 0,
    dirty = true,
    rebuilding,
    scope = '',
    dismissedText;
  let index = createStickerSuggestionIndex();
  let assetsById = new Map();
  const urls = new Set(),
    shown = new Map(),
    removers = [];
  const context = () => source.getContext?.() || { roomId: source.getSnapshot().roomId };
  const key = () => {
    const value = context();
    return JSON.stringify([value.roomId, value.version]);
  };
  const visible = () =>
    !destroyed &&
    input &&
    !outer.hidden &&
    !frameRoot.host.hidden &&
    !host.document.hidden &&
    source.getSnapshot().inConversation !== false &&
    source.getSnapshot().appearance?.stickerSuggestionsEnabled !== false;
  function hide() {
    strip?.replaceChildren();
    if (strip) strip.hidden = true;
    for (const url of urls) host.URL.revokeObjectURL(url);
    urls.clear();
    shown.clear();
  }
  function cancel() {
    generation++;
    host.clearTimeout(timer);
    hide();
  }
  function listen(target, name, fn, options) {
    target.addEventListener(name, fn, options);
    removers.push(() => target.removeEventListener(name, fn, options));
  }
  async function rebuild() {
    if (rebuilding) return rebuilding;
    if (!dirty) return;
    const store = host.shiyeLocalAssets;
    if (!store?.list) throw Error('本地表情尚未准备好');
    dirty = false;
    rebuilding = Promise.all([store.list('sticker:'), store.list('mapping:')])
      .then(([assets, mappings]) => {
        if (!destroyed) {
          index = createStickerSuggestionIndex(assets, mappings);
          assetsById = new Map(assets.map((asset) => [asset.id, asset]));
        }
      })
      .catch((error) => {
        dirty = true;
        throw error;
      })
      .finally(() => {
        rebuilding = null;
      });
    return rebuilding;
  }
  function busy() {
    const state = source.getSnapshot().sendState;
    return sending || state?.pending || state?.locked || view.snapshot?.().sending;
  }
  async function choose(id, expectedScope) {
    if (!visible() || composing || busy() || key() !== expectedScope) return;
    const token = view.captureComposerState?.();
    if (!token || token.text !== input.value) return;
    sending = true;
    for (const button of strip.children) button.disabled = true;
    const replyId = view.getReplyId();
    try {
      const asset = await host.shiyeLocalAssets.get(id);
      if (!hasLocalStickerOriginal(asset)) throw Error('表情原件不可用');
      const owned = await host.shiyeStickers.materialize(asset);
      if (!visible() || composing || key() !== expectedScope) return;
      const file = new host.File([owned.blob], owned.name || asset.name || '表情包', {
        type: owned.blob.type,
      });
      file.shiyeOriginalSticker = true;
      const receipt = await source.sendSticker(file, replyId);
      void recordStickerUse(host.shiyeLocalAssets, id).catch(() => {});
      if (!visible() || key() !== expectedScope) return;
      // The source ACK confirms the sticker; the separate draft ACK confirms clearing.
      // A clear failure must never retry the already-sent sticker.
      const cleared = await view.afterExternalSend(receipt, token);
      const current = view.captureComposerState?.();
      const sameUnclearedDraft =
        current?.room === token.room &&
        current?.contextVersion === token.contextVersion &&
        current?.draftRevision === token.draftRevision &&
        current?.text === token.text;
      if (cleared === true || sameUnclearedDraft) {
        dismissedText = token.text;
        cancel();
      } else schedule();
      input.focus({ preventScroll: true });
    } catch (error) {
      // Leave the draft and candidates intact. An uncertain source remains locked.
      if (visible() && key() === expectedScope) strip.title = error.message || '发送未完成';
    } finally {
      sending = false;
      for (const button of strip?.children || []) button.disabled = !!busy();
    }
  }
  async function render() {
    const expectedGeneration = ++generation,
      expectedScope = key(),
      text = input.value;
    if (
      !visible() ||
      composing ||
      busy() ||
      frameRoot.activeElement !== input ||
      !text.trim() ||
      text === dismissedText ||
      /^\s*\//u.test(text)
    )
      return hide();
    await rebuild();
    const preference = (await host.shiyeLocalAssets.get(ORDER_KEY)) || {};
    if (
      destroyed ||
      expectedGeneration !== generation ||
      !visible() ||
      composing ||
      expectedScope !== key() ||
      text !== input.value
    )
      return;
    const candidates = rankStickerSuggestions(index.search(text, 50), assetsById, preference).slice(
      0,
      5,
    );
    strip.hidden = !candidates.length;
    strip.title = '';
    const nextIds = new Set(candidates.map((candidate) => candidate.id));
    for (const [id, entry] of shown) {
      if (nextIds.has(id)) continue;
      entry.button.remove();
      if (entry.url) {
        host.URL.revokeObjectURL(entry.url);
        urls.delete(entry.url);
      }
      shown.delete(id);
    }
    for (const candidate of candidates) {
      if (shown.has(candidate.id)) continue;
      const button = input.ownerDocument.createElement('button'),
        image = input.ownerDocument.createElement('img');
      button.type = 'button';
      button.dataset.assetId = candidate.id;
      button.setAttribute('aria-label', '发送表情：' + candidate.name);
      image.alt = '';
      image.draggable = false;
      button.append(image);
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        void choose(candidate.id, expectedScope);
      });
      const entry = { button, image, url: null };
      shown.set(candidate.id, entry);
      strip.append(button);
      host.shiyeLocalAssets
        .get(candidate.id)
        .then((asset) => host.shiyeStickers.preview(asset))
        .then((blob) => {
          if (destroyed || shown.get(candidate.id) !== entry || !button.isConnected) return;
          const url = host.URL.createObjectURL(blob);
          urls.add(url);
          entry.url = url;
          image.src = url;
        })
        .catch(() => {
          button.disabled = true;
        });
    }
    // Move existing nodes only when the order changes; no preview URL churn.
    candidates.forEach((candidate, index) => {
      const button = shown.get(candidate.id)?.button;
      if (button && strip.children[index] !== button)
        strip.insertBefore(button, strip.children[index] || null);
    });
  }
  function schedule() {
    generation++;
    host.clearTimeout(timer);
    if (composing || !visible() || sending || !input?.value.trim()) return hide();
    timer = host.setTimeout(() => {
      void render().catch(() => hide());
    }, 150);
  }
  function changedContext() {
    const next = key();
    if (scope !== next || !visible() || !input?.value.trim()) {
      scope = next;
      dismissedText = undefined;
      cancel();
    } else if (!busy() && !composing && frameRoot?.activeElement === input) schedule();
    for (const button of strip?.children || []) button.disabled = !!busy();
  }
  const readyPromise = Promise.resolve(view.readyPromise).then(() => {
    if (destroyed) return;
    outer = host.document.querySelector('#shiye-qq-chat');
    const doc = outer?.querySelector('iframe')?.contentDocument;
    frameRoot = doc?.querySelector('#qq-frame-root')?.shadowRoot;
    input = frameRoot?.querySelector('textarea.qq-input');
    const footer = frameRoot?.querySelector('.qq-footer');
    if (!input || !footer) return;
    strip = doc.createElement('div');
    strip.className = 'qq-recommendations';
    strip.setAttribute('aria-label', '表情候选');
    strip.hidden = true;
    footer.prepend(strip);
    style = doc.createElement('link');
    style.rel = 'stylesheet';
    style.href = new URL('./recommendations.css', import.meta.url).href;
    frameRoot.append(style);
    listen(input, 'input', () => {
      dismissedText = undefined;
      schedule();
    });
    listen(input, 'qq-draft-change', () => {
      if (!input.value.trim()) cancel();
    });
    listen(input, 'focus', schedule);
    listen(input, 'blur', cancel);
    listen(input, 'compositionstart', () => {
      composing = true;
      cancel();
    });
    listen(input, 'compositionend', () => {
      composing = false;
      dismissedText = undefined;
      schedule();
    });
    listen(host, 'shiye-stickers-updated', () => {
      dirty = true;
      // Metadata/original may have changed under the same ID; refresh that preview once.
      cancel();
      schedule();
    });
    // Preference writes affect ranking only; keep the current index, nodes and URLs.
    listen(host, 'shiye-sticker-priority-updated', schedule);
    listen(host.document, 'visibilitychange', changedContext);
    observer = new host.MutationObserver(changedContext);
    observer.observe(outer, { attributes: true, attributeFilter: ['hidden'] });
    observer.observe(frameRoot.host, { attributes: true, attributeFilter: ['hidden'] });
    unsubscribe = source.subscribe(changedContext);
    scope = key();
    schedule();
  });
  // Renderer init failure leaves the existing draft untouched and shows no strip.
  readyPromise.catch(() => {});
  return {
    readyPromise,
    destroy() {
      destroyed = true;
      cancel();
      observer?.disconnect();
      unsubscribe?.();
      for (const remove of removers) remove();
      strip?.remove();
      style?.remove();
    },
  };
}
