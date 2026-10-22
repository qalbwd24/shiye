// Interaction adapter only: callbacks own all message semantics and persistence.
let installed;
export function installQQGestures({
  resolveContext,
  openMenu,
  reply,
  isBlocked,
  direction = 'left',
}) {
  if (installed) return installed;
  const doc = document;
  const active = () => doc.body.dataset.shiyeChatSkin === 'qq';
  const excluded =
    'a,button,input,textarea,select,video,audio,[contenteditable="true"],[role="button"],.embedded-message,.ComposerEmbeddedMessage,.message-select-control';
  const settings = '.shiye-android-dialog[open]';
  const removers = [];
  const returnAnimations = new Map();
  let press, range, control, suppress, frame, nativeRangeGuard;
  const on = (name, callback, options = {}) => {
    doc.addEventListener(name, callback, { capture: true, ...options });
    removers.push(() => doc.removeEventListener(name, callback, { capture: true, ...options }));
  };
  const sameContext = (a, b) =>
    a && b && a.roomId === b.roomId && a.messageId === b.messageId && a.version === b.version;
  function valid(p) {
    return (
      active() &&
      p.target.isConnected &&
      sameContext(p.context, resolveContext(p.target)) &&
      (p.phase === 'long' || !isBlocked?.(p.context))
    );
  }
  function swallow(event) {
    if (event.cancelable) event.preventDefault();
    event.stopImmediatePropagation();
  }
  function guard(target) {
    suppress = { target, until: performance.now() + 800 };
  }
  function resetMessage() {
    if (!press) return;
    clearTimeout(press.timer);
    if (press.surface) {
      const surface = press.surface;
      const from = surface.style.getPropertyValue('translate');
      surface.classList.remove('shiye-qq-swiping');
      if (press.translate)
        press.surface.style.setProperty('translate', press.translate, press.priority);
      else press.surface.style.removeProperty('translate');
      if (
        press.phase === 'horizontal' &&
        from &&
        surface.isConnected &&
        !window.matchMedia('(prefers-reduced-motion: reduce)').matches &&
        surface.animate
      ) {
        returnAnimations.get(surface)?.cancel();
        const animation = surface.animate(
          [{ translate: from }, { translate: getComputedStyle(surface).translate }],
          { duration: 120, easing: 'ease-out' },
        );
        returnAnimations.set(surface, animation);
        const done = () => {
          if (returnAnimations.get(surface) === animation) returnAnimations.delete(surface);
        };
        animation.finished.then(done, done);
      }
    }
    press = undefined;
    cancelAnimationFrame(frame);
  }
  function cancel() {
    if (press) guard(press.target.closest('.Message') || press.target);
    resetMessage();
    if (range) {
      const p = range;
      range = undefined;
      nativeRangeGuard = { element: p.element, value: p.initial, until: performance.now() + 350 };
      if (p.element.isConnected && (p.element.value !== p.initial || p.expected !== p.initial)) {
        p.element.value = p.initial;
        p.element.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (p.element.hasPointerCapture?.(p.id)) p.element.releasePointerCapture(p.id);
    }
    if (control?.moved) guard(control.target);
    control = undefined;
  }
  function watch() {
    if (!press) return;
    if (!valid(press)) {
      cancel();
      return;
    }
    frame = requestAnimationFrame(watch);
  }
  on(
    'touchstart',
    (event) => {
      if (!active()) return;
      suppress = undefined; // A fresh deliberate tap is not the prior compatibility click.
      if (event.touches.length !== 1) {
        cancel();
        return;
      }
      const target = event.target;
      if (!(target instanceof Element)) return;
      const touch = event.touches[0];
      const button = target.closest('button,input[type="checkbox"],label');
      if (button?.closest(settings))
        control = { target: button, x: touch.clientX, y: touch.clientY, moved: false };
      if (
        target.closest(excluded) ||
        target.closest('dialog[open],.Modal.open') ||
        touch.clientX < 18 ||
        touch.clientX > innerWidth - 18
      )
        return;
      const context = resolveContext(target);
      const surface = target.closest('.message-content');
      if (!context || !surface || isBlocked?.(context)) return;
      resetMessage();
      returnAnimations.get(surface)?.cancel();
      const p = (press = {
        target,
        context,
        surface,
        id: touch.identifier,
        x: touch.clientX,
        y: touch.clientY,
        phase: 'pending',
        dx: 0,
        translate: surface.style.getPropertyValue('translate'),
        priority: surface.style.getPropertyPriority('translate'),
      });
      p.timer = setTimeout(() => {
        if (press !== p || p.phase !== 'pending' || !valid(p)) return;
        p.phase = 'long';
        guard(p.target.closest('.Message'));
        openMenu(p.context);
      }, 450);
      frame = requestAnimationFrame(watch);
      // Stop upstream touch recognizers, retaining browser pan/ordinary click defaults.
      event.stopImmediatePropagation();
    },
    { passive: true },
  );
  on(
    'touchmove',
    (event) => {
      if (!active()) return;
      if (control) {
        const t = event.touches[0];
        if (
          event.touches.length !== 1 ||
          !t ||
          Math.hypot(t.clientX - control.x, t.clientY - control.y) > 10
        )
          control.moved = true;
      }
      if (!press) return;
      const p = press;
      if (event.touches.length !== 1 || !valid(p)) {
        cancel();
        return;
      }
      const t = [...event.touches].find((touch) => touch.identifier === p.id);
      if (!t) {
        cancel();
        return;
      }
      const dx = t.clientX - p.x,
        dy = t.clientY - p.y;
      if (Math.hypot(dx, dy) > 8) clearTimeout(p.timer);
      if (p.phase === 'pending') {
        if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) p.phase = 'vertical';
        else if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.35) p.phase = 'horizontal';
      }
      if (p.phase === 'horizontal') {
        if (!p.surface.classList.contains('shiye-qq-swiping'))
          p.surface.classList.add('shiye-qq-swiping');
        const allowed = direction === 'both' || (direction === 'left' ? dx < 0 : dx > 0);
        p.dx = allowed ? dx : 0;
        p.surface.style.setProperty('translate', `${Math.max(-76, Math.min(76, p.dx))}px 0`);
        swallow(event);
      } else if (p.phase === 'long') swallow(event);
      else event.stopImmediatePropagation(); // Vertical pan remains native and never becomes reply.
    },
    { passive: false },
  );
  on(
    'touchend',
    (event) => {
      if (control) {
        if (control.moved) guard(control.target);
        control = undefined;
      }
      if (!press) return;
      const p = press;
      const commit = p.phase === 'horizontal' && Math.abs(p.dx) >= 56 && valid(p);
      const consumed = p.phase === 'horizontal' || p.phase === 'long';
      resetMessage();
      if (consumed) {
        guard(p.target.closest('.Message'));
        swallow(event);
      } else event.stopImmediatePropagation();
      if (commit) reply(p.context);
    },
    { passive: false },
  );
  on(
    'touchcancel',
    () => {
      if (press || range || control) cancel();
    },
    { passive: true },
  );
  for (const name of ['click', 'mousedown', 'mouseup', 'contextmenu'])
    on(name, (event) => {
      if (name === 'contextmenu' && press && press.phase !== 'vertical') {
        swallow(event);
        return;
      }
      if (
        suppress &&
        performance.now() < suppress.until &&
        (suppress.target === event.target || suppress.target?.contains(event.target))
      )
        swallow(event);
    });
  on('selectstart', (event) => {
    if (press?.phase === 'long') swallow(event);
  });

  // touch-action is present before DOWN: vertical settings pan is native while
  // horizontal pointer movement remains available to our range intent lock.
  const style = doc.createElement('style');
  style.textContent =
    'body[data-shiye-chat-skin="qq"] .shiye-android-dialog[open] input[type="range"]{touch-action:pan-y}';
  doc.head.append(style);
  // Chromium's range touch default can run after pointerdown.preventDefault.
  // Reject only its trusted native value events during this owned touch, before
  // application input handlers see them. Our deliberate input events still pass.
  for (const name of ['input', 'change'])
    on(name, (event) => {
      const guard = range
        ? { element: range.element, value: range.expected }
        : nativeRangeGuard && performance.now() < nativeRangeGuard.until
          ? nativeRangeGuard
          : null;
      if (event.isTrusted && guard?.element === event.target) {
        guard.element.value = guard.value;
        event.stopImmediatePropagation();
      }
    });
  on('keydown', () => {
    nativeRangeGuard = undefined;
  });
  on('pointerdown', (event) => {
    nativeRangeGuard = undefined;
    if (!active() || event.pointerType !== 'touch') return;
    if (range && event.pointerId !== range.id) {
      cancel();
      return;
    }
    const element = event.target.closest?.('input[type="range"]');
    if (!element?.closest(settings) || element.matches(':disabled')) return;
    range = {
      element,
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      initial: element.value,
      expected: element.value,
      phase: 'pending',
    };
    element.setPointerCapture?.(event.pointerId);
    swallow(event); // Prevent the native track jumping at DOWN, even for a plain tap.
  });
  on('pointermove', (event) => {
    if (!range || event.pointerId !== range.id) return;
    const p = range;
    if (!active() || !p.element.isConnected) {
      cancel();
      return;
    }
    const dx = event.clientX - p.x,
      dy = event.clientY - p.y;
    if (p.phase === 'pending') {
      if (Math.abs(dy) > 8 && Math.abs(dy) >= Math.abs(dx)) p.phase = 'vertical';
      else if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.35) p.phase = 'horizontal';
    }
    if (p.phase !== 'horizontal') return;
    const min = p.element.min === '' ? 0 : Number(p.element.min),
      max = p.element.max === '' ? 100 : Number(p.element.max);
    const rtl = getComputedStyle(p.element).direction === 'rtl' ? -1 : 1;
    const proposed =
      Number(p.initial) +
      ((rtl * dx) / Math.max(1, p.element.getBoundingClientRect().width)) * (max - min);
    const step = p.element.step === 'any' ? 0 : Number(p.element.step || 1);
    const value = Math.min(
      max,
      Math.max(min, step > 0 ? min + Math.round((proposed - min) / step) * step : proposed),
    );
    const before = p.element.value;
    p.element.value = String(Number(value.toFixed(10)));
    p.expected = p.element.value;
    if (p.element.value !== before) p.element.dispatchEvent(new Event('input', { bubbles: true }));
    swallow(event);
  });
  on('pointerup', (event) => {
    if (!range || range.id !== event.pointerId) return;
    if (!active() || !range.element.isConnected || !range.element.closest(settings)) {
      cancel();
      return;
    }
    const p = range;
    range = undefined;
    p.element.value = p.expected;
    nativeRangeGuard = { element: p.element, value: p.expected, until: performance.now() + 350 };
    if (p.element.hasPointerCapture?.(p.id)) p.element.releasePointerCapture(p.id);
    if (p.phase === 'horizontal' && p.element.value !== p.initial)
      p.element.dispatchEvent(new Event('change', { bubbles: true }));
    guard(p.element);
    swallow(event);
  });
  on('pointercancel', (event) => {
    if (range?.id === event.pointerId) cancel();
  });
  const skinObserver = new MutationObserver(() => {
    if (!active()) cancel();
  });
  skinObserver.observe(doc.body, { attributes: true, attributeFilter: ['data-shiye-chat-skin'] });
  const blur = () => cancel();
  window.addEventListener('blur', blur);
  window.addEventListener('pagehide', blur);
  installed = {
    cancel,
    snapshot: () => ({ message: press?.phase || null, range: range?.phase || null, direction }),
    dispose() {
      cancel();
      for (const animation of returnAnimations.values()) animation.cancel();
      returnAnimations.clear();
      removers.forEach((remove) => remove());
      style.remove();
      skinObserver.disconnect();
      window.removeEventListener('blur', blur);
      window.removeEventListener('pagehide', blur);
      installed = undefined;
    },
  };
  return installed;
}
