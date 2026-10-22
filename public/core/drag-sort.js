import { createDragAutoScroll } from './drag-scroll.js';

export const SORT_MIME = 'application/x-shiye-sort';

/** Pure operations also used by keyboard controls and regression tests. */
export function moveItem(order, id, targetIndex) {
  const next = [...order];
  const sourceIndex = next.indexOf(id);
  if (
    sourceIndex < 0 ||
    !Number.isInteger(targetIndex) ||
    targetIndex < 0 ||
    targetIndex >= next.length
  )
    return next;
  next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, id);
  return next;
}

export function isExternalFileDrag(transfer, internal = false) {
  const types = Array.from(transfer?.types || []);
  if (internal || types.includes(SORT_MIME)) return false;
  // A browser-native image/link drag can advertise Files too. Only accept a
  // genuine file payload, not the accompanying URL/HTML/text representation.
  if (types.some((type) => ['text/html', 'text/uri-list', 'text/plain'].includes(type)))
    return false;
  return types.includes('Files');
}

/** Delegated native sorting. Reinstall only when the root itself is replaced. */
export function installDragSort(
  root,
  { itemSelector, getId, getOrder, onReorder, label = '项目', onError = () => {} },
) {
  let source = null,
    busy = false;
  const listeners = [];
  const listen = (name, fn) => {
    root.addEventListener(name, fn);
    listeners.push([name, fn]);
  };
  const itemFor = (target) => {
    const item = target?.closest?.(itemSelector);
    return item && root.contains(item) ? item : null;
  };
  const highlight = (item) => {
    root.querySelectorAll('.sort-target').forEach((node) => node.classList.remove('sort-target'));
    item?.classList.add('sort-target');
  };
  const scroll = createDragAutoScroll(root, ({ x, y }) =>
    highlight(itemFor(root.ownerDocument.elementFromPoint(x, y))),
  );
  const trackDrag = (event) => {
    if (source !== null && !busy) scroll.update(event);
  };
  root.ownerDocument?.addEventListener?.('dragover', trackDrag, true);
  const clear = () => {
    scroll.stop();
    root
      .querySelectorAll('.sort-dragging, .sort-target')
      .forEach((node) => node.classList.remove('sort-dragging', 'sort-target'));
    source = null;
  };
  const finishOutside = (event) => {
    if (!root.contains(event.target)) clear();
  };
  root.ownerDocument?.addEventListener?.('dragend', clear, true);
  root.ownerDocument?.addEventListener?.('drop', finishOutside);
  const apply = async (id, index) => {
    if (busy) return;
    const previous = getOrder(),
      next = moveItem(previous, id, index);
    if (previous.every((value, i) => next[i] === value)) return;
    busy = true;
    try {
      await onReorder(next, id);
      const item = Array.from(root.querySelectorAll(itemSelector)).find(
        (node) => getId(node) === id,
      );
      item?.querySelector('[data-sort-handle]')?.focus();
    } catch (error) {
      onError(error);
    } finally {
      busy = false;
    }
  };
  listen('dragstart', (event) => {
    const item = itemFor(event.target);
    if (!item || item.draggable === false || busy) return;
    // Controls and media retain their own native interactions. A dedicated
    // handle, a still image or the row background can start a reorder.
    if (
      event.target.closest(
        'audio, video, input, select, textarea, a, button:not([data-sort-handle])',
      )
    ) {
      event.preventDefault();
      return;
    }
    source = getId(item);
    event.dataTransfer.clearData();
    event.dataTransfer.setData(SORT_MIME, source);
    event.dataTransfer.effectAllowed = 'move';
    item.classList.add('sort-dragging');
  });
  listen('dragover', (event) => {
    if (source === null || busy) return;
    const item = itemFor(event.target);
    if (!item) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    highlight(item);
  });
  listen('drop', (event) => {
    if (source === null) return;
    event.preventDefault();
    event.stopPropagation();
    const item = itemFor(event.target),
      id = source;
    clear();
    if (item) void apply(id, getOrder().indexOf(getId(item)));
  });
  listen('dragend', clear);
  listen('keydown', (event) => {
    if (event.key === 'Escape' && source !== null) {
      event.preventDefault();
      event.stopPropagation();
      clear();
    }
  });
  listen('click', (event) => {
    const control = event.target.closest('[data-sort-step]');
    if (!control || control.disabled) return;
    const item = itemFor(control);
    if (!item) return;
    event.preventDefault();
    const id = getId(item);
    void apply(id, getOrder().indexOf(id) + Number(control.dataset.sortStep));
  });
  listen('keydown', (event) => {
    if (!event.altKey || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key))
      return;
    const item = itemFor(event.target);
    if (!item || item.draggable === false) return;
    event.preventDefault();
    const id = getId(item),
      step = ['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1;
    void apply(id, getOrder().indexOf(id) + step);
  });
  root.setAttribute('aria-label', `${label}顺序，可拖动或按 Alt 加方向键调整`);
  return () => {
    clear();
    for (const [name, fn] of listeners) root.removeEventListener(name, fn);
    root.ownerDocument?.removeEventListener?.('dragover', trackDrag, true);
    root.ownerDocument?.removeEventListener?.('dragend', clear, true);
    root.ownerDocument?.removeEventListener?.('drop', finishOutside);
  };
}
