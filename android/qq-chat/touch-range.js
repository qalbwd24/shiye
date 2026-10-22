// Install once for a settings surface. CSS must set touch-action: pan-y on its ranges.
// The returned function removes every listener and abandons any active gesture.
export function installTouchRangeGuard(root, { selector = 'input[type="range"]' } = {}) {
  const doc = root?.nodeType === 9 ? root : root?.ownerDocument;
  if (!doc) throw new TypeError('A document or connected settings root is required');
  let gesture = null;
  let trailing = null;
  let disposed = false;
  const tapSlop = 8;
  const listeners = [];
  const on = (name, handler) => {
    doc.addEventListener(name, handler, { capture: true, passive: false });
    listeners.push([name, handler]);
  };
  const pathOf = (event) => event.composedPath?.() || [event.target];
  const inRoot = (path) => root === doc || path.includes(root);
  const rangeOf = (path) => path.find((node) => node?.matches?.(selector)) || null;
  const emit = (element, type) => {
    element.dispatchEvent(new Event(type, { bubbles: true, composed: true }));
  };
  const setValue = (element, value) => {
    const before = element.value;
    element.value = value;
    if (element.value !== before) emit(element, 'input');
    return element.value !== before;
  };
  const valueAt = (gesture, x, relative) => {
    const element = gesture.element;
    const min = element.min === '' ? 0 : Number(element.min);
    const max = element.max === '' ? 100 : Number(element.max);
    const step = element.step === 'any' ? 0 : Number(element.step || 1);
    const bounds = element.getBoundingClientRect();
    const rtl = getComputedStyle(element).direction === 'rtl';
    const ratio = relative
      ? (Number(gesture.initial) - min) / Math.max(1, max - min) +
        ((rtl ? -1 : 1) * (x - gesture.x)) / Math.max(1, bounds.width)
      : (rtl ? bounds.right - x : x - bounds.left) / Math.max(1, bounds.width);
    const raw = min + Math.min(1, Math.max(0, ratio)) * (max - min);
    const stepped = step > 0 ? min + Math.round((raw - min) / step) * step : raw;
    return String(Number(Math.min(max, Math.max(min, stepped)).toFixed(10)));
  };
  const stop = (revert = false) => {
    if (!gesture) return;
    const old = gesture;
    gesture = null;
    if (revert) setValue(old.element, old.initial);
    // Suppress the compatibility click after cancelled touch without masking
    // an accessibility/keyboard click (detail 0) or the next pointer gesture.
    trailing = { element: old.element, value: old.element.value, until: performance.now() + 1200 };
  };
  const observer = new doc.defaultView.MutationObserver(() => {
    if (gesture && !gesture.element.isConnected) stop(true);
  });
  observer.observe(doc, { childList: true, subtree: true });

  on('pointerdown', (event) => {
    if (event.pointerType !== 'touch') {
      trailing = null;
      return;
    }
    const path = pathOf(event);
    if (event.isPrimary === false) {
      if (gesture) stop(true);
      if (inRoot(path) && rangeOf(path)) event.preventDefault();
      return;
    }
    if (gesture) {
      stop(true); // A second finger invalidates the first gesture.
      event.preventDefault();
      return;
    }
    if (!inRoot(path)) return;
    const element = rangeOf(path);
    if (!element || element.disabled) return;
    gesture = {
      element,
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      initial: element.value,
      expected: element.value,
      phase: 'pending',
      movedBeyondTap: false,
    };
    trailing = null;
    // Chromium can jump the native thumb on DOWN before a drag is established.
    event.preventDefault();
  });
  for (const type of ['input', 'change'])
    on(type, (event) => {
      const guarded = gesture || (trailing?.until > performance.now() ? trailing : null);
      if (!event.isTrusted || !guarded || rangeOf(pathOf(event)) !== guarded.element) return;
      guarded.element.value = gesture ? gesture.expected : guarded.value;
      event.stopImmediatePropagation();
    });
  on('pointermove', (event) => {
    if (!gesture || event.pointerId !== gesture.id) return;
    if (!gesture.element.isConnected) { stop(true); return; }
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (Math.hypot(dx, dy) > tapSlop) gesture.movedBeyondTap = true;
    if (gesture.phase === 'pending') {
      if (Math.abs(dy) > 8 && Math.abs(dy) >= Math.abs(dx)) gesture.phase = 'vertical';
      else if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.35)
        gesture.phase = 'horizontal';
    }
    if (gesture.phase !== 'horizontal') return;
    gesture.expected = valueAt(gesture, event.clientX, true);
    setValue(gesture.element, gesture.expected);
    event.preventDefault();
  });
  on('pointerup', (event) => {
    if (!gesture || event.pointerId !== gesture.id) return;
    const old = gesture;
    if (!old.element.isConnected) { stop(true); event.preventDefault(); return; }
    const distance = Math.hypot(event.clientX - old.x, event.clientY - old.y);
    if (old.phase === 'pending')
      old.expected = !old.movedBeyondTap && distance <= tapSlop
        ? valueAt(old, event.clientX, false) : old.initial;
    else if (old.phase === 'horizontal') old.expected = valueAt(old, event.clientX, true);
    else old.expected = old.initial;
    setValue(old.element, old.expected);
    if (old.element.value !== old.initial) emit(old.element, 'change');
    stop();
    event.preventDefault();
  });
  on('pointercancel', (event) => {
    if (gesture?.id === event.pointerId) stop(true);
  });
  on('click', (event) => {
    if (event.detail === 0 || trailing?.until <= performance.now() || rangeOf(pathOf(event)) !== trailing?.element)
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
  });
  on('keydown', () => {
    trailing = null; // Keyboard adjustment keeps the browser's normal range behavior.
  });
  return () => {
    if (disposed) return;
    disposed = true;
    stop(true);
    observer.disconnect();
    for (const [name, handler] of listeners) doc.removeEventListener(name, handler, true);
    trailing = null;
  };
}
