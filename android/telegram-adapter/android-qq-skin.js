import { installQQGestures } from './android-qq-gestures.js';

// Visual/interaction adapter. The existing message and preference owners stay authoritative.
let installed;
export function installAndroidQQSkin(callbacks) {
  if (installed) return installed;
  document.body.dataset.shiyeChatSkin = 'qq';
  const gestures = installQQGestures(callbacks);
  installed = Object.freeze({ skin: 'qq', snapshot: gestures.snapshot });
  window.shiyeAndroidQQSkin = installed;
  return installed;
}

export function positionQQMessageMenu(modal, messageId) {
  if (document.body.dataset.shiyeChatSkin !== 'qq') return;
  modal.classList.add('shiye-qq-message-menu');
  let attempts = 0;
  const place = () => {
    if (!modal.isConnected || !modal.open) {
      if (++attempts < 8) requestAnimationFrame(place);
      return;
    }
    const target = document.querySelector(
      `#MiddleColumn .Message[data-message-id="${Number(messageId)}"] .message-content`,
    );
    if (!target) return;
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft || 0;
    const top = viewport?.offsetTop || 0;
    const width = viewport?.width || innerWidth;
    const height = viewport?.height || innerHeight;
    const anchor = target.getBoundingClientRect();
    const rect = modal.getBoundingClientRect();
    const clamp = (value, min, max) => Math.max(min, Math.min(value, Math.max(min, max)));
    modal.style.left = `${clamp(anchor.right - rect.width, left + 8, left + width - rect.width - 8)}px`;
    modal.style.top = `${clamp(
      anchor.top - rect.height - 8 >= top + 8 ? anchor.top - rect.height - 8 : anchor.bottom + 8,
      top + 8,
      top + height - rect.height - 8,
    )}px`;
    modal.dataset.positioned = 'true';
  };
  requestAnimationFrame(place);
}
