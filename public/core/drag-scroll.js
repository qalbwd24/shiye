/** Vertical edge scrolling for the actual visible part of nested list containers. */
export function dragScrollStep(y, top, bottom) {
  if (bottom <= top || y < top || y > bottom) return 0;
  const edge = Math.min(56, (bottom - top) / 3);
  if (y < top + edge) return -Math.ceil(18 * (1 - (y - top) / edge));
  if (y > bottom - edge) return Math.ceil(18 * (1 - (bottom - y) / edge));
  return 0;
}

export function createDragAutoScroll(root, onScroll = () => {}) {
  const doc = root.ownerDocument,
    win = doc?.defaultView;
  let frame = 0,
    pointer = null;
  const stop = () => {
    if (frame) win?.cancelAnimationFrame(frame);
    frame = 0;
    pointer = null;
  };
  function tick() {
    frame = 0;
    if (!pointer || !root.isConnected) return stop();
    for (let node = root; node; node = node.parentElement) {
      if (node.scrollHeight <= node.clientHeight) continue;
      if (
        node !== doc.scrollingElement &&
        !/auto|scroll|overlay/.test(win.getComputedStyle(node).overflowY)
      )
        continue;
      const rect = node.getBoundingClientRect();
      let top = Math.max(0, rect.top),
        bottom = Math.min(win.innerHeight, rect.bottom);
      let left = Math.max(0, rect.left),
        right = Math.min(win.innerWidth, rect.right);
      for (let ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const style = win.getComputedStyle(ancestor),
          clip = ancestor.getBoundingClientRect();
        if (/auto|scroll|hidden|clip|overlay/.test(style.overflowY)) {
          top = Math.max(top, clip.top);
          bottom = Math.min(bottom, clip.bottom);
        }
        if (/auto|scroll|hidden|clip|overlay/.test(style.overflowX)) {
          left = Math.max(left, clip.left);
          right = Math.min(right, clip.right);
        }
      }
      if (pointer.x < left || pointer.x > right) continue;
      const step = dragScrollStep(pointer.y, top, bottom);
      const previous = node.scrollTop;
      node.scrollTop = Math.max(
        0,
        Math.min(node.scrollHeight - node.clientHeight, previous + step),
      );
      if (node.scrollTop !== previous) {
        onScroll(pointer);
        frame = win.requestAnimationFrame(tick);
        return;
      }
    }
  }
  return {
    update(event) {
      if (!win?.requestAnimationFrame) return;
      pointer = { x: event.clientX, y: event.clientY };
      if (!frame) frame = win.requestAnimationFrame(tick);
    },
    stop,
  };
}
