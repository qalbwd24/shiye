/** Device-local reading offsets only; no diary text is stored here. */
export function createReadingPosition(c) {
  const key = 'shiye.reading-position.v1';
  const panes = ['.writing-scroll', '.media-pane-scroll', '#entryColumns'].map(c.$);
  let records = [],
    active = null,
    restoration = null,
    ignoreScroll = false,
    frame = 0,
    timer = 0;
  try {
    const saved = JSON.parse(localStorage.getItem(key) || '[]');
    if (Array.isArray(saved))
      records = saved
        .filter(
          (r) =>
            typeof r?.id === 'string' &&
            Array.isArray(r.offsets) &&
            r.offsets.length === panes.length &&
            r.offsets.every((n) => Number.isFinite(n) && n >= 0 && n <= 10000000),
        )
        .slice(-200);
  } catch {
    /* Browser storage is optional. */
  }
  const ownsScroll = (pane) => {
    const style = getComputedStyle(pane);
    return (
      pane.clientHeight > 0 &&
      pane.clientWidth > 0 &&
      style.visibility !== 'hidden' &&
      ['auto', 'scroll'].includes(style.overflowY)
    );
  };
  function persist() {
    try {
      localStorage.setItem(key, JSON.stringify(records));
    } catch {
      /* Keep current-session state. */
    }
  }
  function save() {
    clearTimeout(timer);
    if (!active || restoration || ignoreScroll) return;
    const previous = records.find((r) => r.id === active)?.offsets || [0, 0, 0];
    const offsets = panes.map((pane, index) =>
      ownsScroll(pane) ? Math.round(pane.scrollTop) : previous[index],
    );
    records = records.filter((r) => r.id !== active);
    records.push({ id: active, offsets });
    records = records.slice(-200);
    persist();
  }
  function takeControl() {
    cancelAnimationFrame(frame);
    restoration = null;
    ignoreScroll = false;
  }
  function restore(timestamp) {
    const state = restoration;
    if (!state || state.id !== active) return;
    state.started ??= timestamp;
    const geometry = panes
      .map(
        (pane) =>
          `${pane.clientWidth},${pane.clientHeight},${pane.scrollHeight},${getComputedStyle(pane).overflowY}`,
      )
      .join(';');
    if (geometry !== state.geometry) {
      state.geometry = geometry;
      state.changedAt = timestamp;
    }
    let reached = true;
    panes.forEach((pane, index) => {
      if (!ownsScroll(pane)) return;
      pane.scrollTop = state.offsets[index];
      if (Math.abs(pane.scrollTop - state.offsets[index]) > 1) reached = false;
    });
    const imagesReady = [...panes[2].querySelectorAll('img')].every(
      (img) => img.complete || img.loading === 'lazy',
    );
    const fontsReady = !document.fonts || document.fonts.status === 'loaded';
    // Two frames are shorter than the 220 ms panel transition. A clamped first write
    // must not replace the saved offset before the final pane width/images settle.
    if (
      timestamp - state.started < 5000 &&
      (!reached || !imagesReady || !fontsReady || timestamp - state.changedAt < 300)
    ) {
      frame = requestAnimationFrame(restore);
    } else {
      restoration = null;
      // Browser scroll/anchoring events from restoring or resizing are not reading input.
      // Retain the requested offset until the reader actually takes control.
      ignoreScroll = true;
    }
  }
  for (const pane of panes) {
    pane.addEventListener(
      'scroll',
      () => {
        if (restoration || ignoreScroll) return;
        clearTimeout(timer);
        timer = setTimeout(save, 250);
      },
      { passive: true },
    );
    for (const event of ['wheel', 'touchstart', 'pointerdown'])
      pane.addEventListener(event, takeControl, { passive: true });
    pane.addEventListener('keydown', (event) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key))
        takeControl();
    });
  }
  window.addEventListener('pagehide', save);
  return {
    select(id) {
      if (id === active) return;
      save();
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      active = id;
      ignoreScroll = true;
      if (!id) {
        restoration = null;
        return;
      }
      const offsets = records.find((r) => r.id === id)?.offsets || [0, 0, 0];
      restoration = { id, offsets: [...offsets], started: null, changedAt: 0, geometry: '' };
      frame = requestAnimationFrame(restore);
    },
  };
}
