/** One browsing origin per opened detail. Save failures keep both the page and return target. */
export function createReturnNavigation(c) {
  let origin = null;
  let busy = false;
  let generation = 0;
  const update = () => c.update(origin, busy);
  async function run(action) {
    if (busy) return false;
    busy = true;
    const ticket = generation;
    update();
    try {
      await c.prepare();
      if (ticket !== generation) return false;
      return await action();
    } finally {
      busy = false;
      update();
    }
  }
  return {
    open(action) {
      return run(async () => {
        const source = origin || c.capture();
        if ((await action()) === false) return false;
        origin = source;
        return true;
      });
    },
    back() {
      if (!origin) return Promise.resolve(false);
      return run(async () => {
        await c.restore(origin);
        origin = null;
        return true;
      });
    },
    clear() {
      generation++;
      origin = null;
      update();
    },
  };
}

/** Images and masonry rows can gain height after the first frame; stop if the user takes over. */
export function restoreBrowsePosition(root, source, active) {
  const win = root.ownerDocument.defaultView;
  const list = root.querySelector('.recollection-list');
  const started = win.performance.now();
  let frame = 0,
    stopped = false,
    previous = '',
    stableAt = started;
  const events = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
  function stop() {
    stopped = true;
    win.cancelAnimationFrame(frame);
    for (const name of events) root.removeEventListener(name, stop, true);
  }
  function restore(now) {
    if (stopped || !active()) return stop();
    root.scrollTop = source.scrollTop;
    if (list) list.scrollTop = source.listScrollTop;
    const dimensions = [
      root.scrollHeight,
      root.clientHeight,
      list?.scrollHeight,
      list?.clientHeight,
    ].join(':');
    if (dimensions !== previous) {
      previous = dimensions;
      stableAt = now;
    }
    if (now - stableAt >= 350 || now - started >= 2500) return stop();
    frame = win.requestAnimationFrame(restore);
  }
  for (const name of events) root.addEventListener(name, stop, { capture: true, passive: true });
  frame = win.requestAnimationFrame(restore);
  return stop;
}
