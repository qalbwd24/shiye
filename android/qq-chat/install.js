import { createLegacyChatSource } from './legacy-source.js';
import { installQQChat } from './view.js';
import { installQQPanels } from './panels.js';
import { installQQRecommendations } from './recommendations.js';

// The parent retains the existing data owner. The chat iframe owns all visible
// layout, input events and gestures; it does not inherit Telegram components.
export function installIndependentQQChat(callbacks) {
  if (window.shiyeQQRebuild) return window.shiyeQQRebuild;
  // Never hand a stale hidden editor snapshot back to the draft writer during
  // room exit or view disposal. A new page gets a new owner lifetime.
  window.__shiyeQQDraftOwnerInstalled = true;
  const source = callbacks.source || createLegacyChatSource(callbacks);
  let panels;
  const view = installQQChat({
    source,
    onBack: callbacks.onBack,
    onSettings: callbacks.onSettings,
    onStickers: () => panels.stickers(),
    onFiles: () => {
      const focus = view.captureComposerFocus();
      const sendState = view.captureMediaSendState();
      panels.files(
        () => view.restoreComposerFocus(focus),
        () => view.markPickerOpened(focus),
        sendState,
      );
    },
    onCollect: (message) =>
      callbacks.source ? source.saveSticker(message) : panels.collect(message),
    onViewMedia: (message) => panels.viewMedia(message),
    onTextSelection: callbacks.onTextSelection,
    onMessageGesture: callbacks.onMessageGesture,
    onRoomChange: () => panels?.closeAll(),
  });
  let active = false;
  panels = installQQPanels({
    source,
    getReplyId: () => view.getReplyId(),
    captureExternalSend: () => view.captureMediaSendState(),
    cancelExternalSend: (token) => view.cancelMediaSendState(token),
    onSent: (receipt, token) => token && view.afterExternalSend(receipt, token),
    onMediaState: (text, roomId) => view.setExternalSendStatus(text, roomId),
    isActive: () => active,
  });
  const recommendations = installQQRecommendations({ source, view });
  const hiding = document.createElement('style');
  hiding.textContent = `
    body[data-shiye-qq-owner-installed="true"] #MiddleColumn {
      visibility:hidden!important;pointer-events:none!important;
    }
    body[data-shiye-qq-owner-installed="true"] > .shiye-android-header {
      display:none!important;
    }
  `;
  document.head.append(hiding);
  // The retained vendor column is a data owner, never a fallback chat UI.
  // Keep it hidden during return-to-list too, not just while QQ is active.
  document.body.dataset.shiyeQqOwnerInstalled = 'true';
  const retainedView = document.querySelector('#MiddleColumn');
  const retainedInert = retainedView?.inert || false;
  if (retainedView) retainedView.inert = true;
  const api = {
    source,
    view,
    panels,
    get active() {
      return active;
    },
    setActive(next) {
      const enabled = !!next;
      if (active === enabled) return;
      active = enabled;
      document.body.dataset.shiyeQqRebuild = String(active);
      const previousView = document.querySelector('#MiddleColumn');
      if (previousView) previousView.inert = true;
      if (!active) panels.closeAll();
      source.setActive?.(active);
      view.setActive(active);
    },
    flush: () => source.flush(),
    back() {
      if (!active) return false;
      if (document.querySelector('dialog[open]')) return false;
      return panels.back() || view.back();
    },
    snapshot() {
      return { active, renderer: view.snapshot() };
    },
    destroy() {
      api.setActive(false);
      panels.destroy();
      recommendations.destroy();
      view.destroy();
      source.dispose();
      hiding.remove();
      delete document.body.dataset.shiyeQqOwnerInstalled;
      const retained = document.querySelector('#MiddleColumn');
      if (retained) retained.inert = retainedInert;
      delete window.shiyeQQRebuild;
    },
  };
  window.shiyeQQRebuild = api;
  source.setActive?.(false);
  view.setActive(false);
  return api;
}
