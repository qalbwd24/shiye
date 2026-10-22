(() => {
  'use strict';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let pending;
  let active;
  let revision = 0;
  const temporary = new Map();
  const enabled = () => {
    try {
      return (
        localStorage.getItem('shiye-sidebar-motion') !== 'instant' &&
        !reduced.matches &&
        !document.hidden
      );
    } catch {
      return !reduced.matches && !document.hidden;
    }
  };
  function restoreStyle() {
    for (const [node, properties] of temporary) {
      for (const [name, value, priority] of properties) {
        if (value) node.style.setProperty(name, value, priority);
        else node.style.removeProperty(name);
      }
    }
    temporary.clear();
  }
  function setTemporary(node, values) {
    temporary.set(
      node,
      Object.keys(values).map((name) => [
        name,
        node.style.getPropertyValue(name),
        node.style.getPropertyPriority(name),
      ]),
    );
    for (const [name, value] of Object.entries(values))
      node.style.setProperty(name, value, 'important');
  }
  function cancel() {
    revision++;
    active?.cancel();
    active = undefined;
    restoreStyle();
  }
  window.addEventListener('shiye-sidebar-before-change', (event) => {
    const node = document.querySelector('#LeftColumn');
    pending = undefined;
    // The workspace focuses the current room in its changed listener, which
    // runs before ours. Restore interaction before that synchronous focus.
    if (node && !event.detail.collapsed) node.inert = false;
    if (!node || !enabled()) {
      cancel();
      return;
    }
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    const visible = style.display !== 'none' && rect.width > 0;
    pending = {
      node,
      visible,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      collapsed: event.detail.collapsed,
    };
    // Read the current compositor position before cancelling, so reversals do
    // not jump back to the start or end of the previous transition.
    cancel();
  });
  window.addEventListener('shiye-sidebar-changed', (event) => {
    const snapshot = pending;
    pending = undefined;
    const node = document.querySelector('#LeftColumn');
    if (!node) return;
    const collapsed = Boolean(event.detail.collapsed);
    node.inert = collapsed;
    if (!snapshot || snapshot.node !== node || snapshot.collapsed !== collapsed || !enabled())
      return;
    const token = revision;
    let from;
    let to;
    let width;
    if (collapsed) {
      if (!snapshot.visible) return;
      width = snapshot.width;
      const right = snapshot.left + width / 2 > innerWidth / 2;
      from = 0;
      to = right ? innerWidth - snapshot.left : -snapshot.left - width;
      setTemporary(node, {
        display: 'block',
        position: 'fixed',
        left: `${snapshot.left}px`,
        top: `${snapshot.top}px`,
        width: `${width}px`,
        height: `${snapshot.height}px`,
        'max-width': 'none',
        margin: '0',
        'z-index': '100',
        'pointer-events': 'none',
        'will-change': 'translate',
        transform: 'none',
        transition: 'none',
      });
    } else {
      const rect = node.getBoundingClientRect();
      width = rect.width;
      const right = rect.left + width / 2 > innerWidth / 2;
      from = snapshot.visible
        ? snapshot.left - rect.left
        : right
          ? innerWidth - rect.left
          : -rect.right;
      to = 0;
      setTemporary(node, { 'will-change': 'translate', transition: 'none' });
    }
    if (!width || Math.abs(to - from) < 0.5) {
      restoreStyle();
      return;
    }
    active = node.animate([{ translate: `${from}px 0` }, { translate: `${to}px 0` }], {
      duration: Math.max(55, Math.min(180, (180 * Math.abs(to - from)) / width)),
      easing: 'cubic-bezier(.2,.75,.25,1)',
    });
    active.onfinish = () => {
      if (token !== revision) return;
      active = undefined;
      restoreStyle();
    };
  });
  // No frame loop or permanent layout observer is needed for this transition.
  for (const name of ['shiye-sidebar-motion-changed', 'shiye-before-hide', 'pagehide'])
    window.addEventListener(name, cancel);
  reduced.addEventListener('change', cancel);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancel();
  });
  // setSidebar emits a synthetic resize before its changed event; only a real
  // viewport resize should cancel an in-flight transition.
  window.addEventListener('resize', (event) => {
    if (event.isTrusted) cancel();
  });
})();
