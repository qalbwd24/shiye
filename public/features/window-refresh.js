/** Coalesce window notifications without applying a stale snapshot over local edits. */
export function createWindowRefresh(c) {
  let requested = false,
    running = false,
    epoch = 0,
    timer = null,
    disposed = false;

  function resume() {
    if (disposed || timer !== null || running || !requested) return;
    timer = setTimeout(() => {
      timer = null;
      void refresh();
    }, 0);
  }

  async function refresh() {
    if (disposed || running || !requested || !c.canRefresh()) return;
    requested = false;
    running = true;
    const started = epoch;
    const context = c.capture();
    let failed = false;
    try {
      const snapshot = await c.fetch();
      if (disposed) return;
      // No await between this guard and apply: user input cannot interleave.
      if (started !== epoch || !c.canRefresh() || !c.isCurrent(context)) {
        requested = true;
        return;
      }
      c.apply(snapshot);
    } catch (error) {
      requested = true;
      failed = true;
      c.onError?.(error);
    } finally {
      running = false;
      // A failed request waits for the next focus/save/notification, not a hot retry loop.
      if (!failed) resume();
    }
  }

  return {
    request() {
      requested = true;
      resume();
    },
    invalidate() {
      epoch++;
      resume();
    },
    resume,
    dispose() {
      disposed = true;
      clearTimeout(timer);
      timer = null;
    },
  };
}
