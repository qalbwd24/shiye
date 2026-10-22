import { Plugin, Decoration, DecorationSet } from '../vendor/rich-editor.js';
import { describeNotesTextBlock } from './notes-markdown-preview.js';

const structureCache = new WeakMap();

const typeOf = (node) => (typeof node.type === 'string' ? node.type : node.type.name);
const childrenOf = (node) => {
  if (Array.isArray(node.content)) return node.content;
  const children = [];
  node.forEach?.((child) => children.push(child));
  return children;
};
const sizeOf = (node) =>
  node.nodeSize ??
  (typeOf(node) === 'text'
    ? node.text.length
    : ['hardBreak', 'horizontalRule', 'image', 'video'].includes(typeOf(node))
      ? 1
      : childrenOf(node).reduce((total, child) => total + sizeOf(child), 2));
const textOf = (node) => node.textContent ?? node.text ?? childrenOf(node).map(textOf).join('');
const labelOf = (text) => String(text).replace(/\s+/g, ' ').trim() || '未命名段落';
const indentOf = (text) => {
  let columns = 0;
  for (const char of /^[ \t\u3000]*/.exec(text)[0]) {
    columns += char === '\t' ? 4 - (columns % 4) : char === '\u3000' ? 2 : 1;
  }
  return columns;
};

/** Derive view structure without serializing or changing the rich document. */
export function deriveNotesStructure(doc, { includeIndented = false } = {}) {
  const cached = structureCache.get(doc)?.get(includeIndented);
  if (cached) return cached;
  const records = [];
  const byParent = new Map();
  const walk = (parent, contentStart, parentEnd, parentKey, listDepth, listParent) => {
    let offset = contentStart;
    for (const node of childrenOf(parent)) {
      const type = typeOf(node);
      const end = offset + sizeOf(node);
      const record = {
        node,
        type,
        pos: offset,
        end,
        parentEnd,
        parentKey,
        listDepth,
        listParent,
      };
      records.push(record);
      if (!byParent.has(parentKey)) byParent.set(parentKey, []);
      byParent.get(parentKey).push(record);
      const item = type === 'listItem' || type === 'taskItem';
      if (type !== 'text')
        walk(
          node,
          offset + 1,
          end - 1,
          `parent:${offset}`,
          listDepth + (item ? 1 : 0),
          item ? record : listParent,
        );
      offset = end;
    }
  };
  const contentEnd = doc.content?.size ?? childrenOf(doc).reduce((n, node) => n + sizeOf(node), 0);
  walk(doc, 0, contentEnd, 'doc', 0, null);
  const entries = [];
  const headings = [];
  const idOf = (record) => record.node.attrs?.blockId || `notes-position:${record.pos}`;
  const entryFor = (record, values) => ({
    id: idOf(record),
    blockId: record.node.attrs?.blockId || null,
    pos: record.pos,
    end: record.end,
    anchorPos: record.pos + 1,
    foldFrom: record.end,
    foldTo: record.end,
    ...values,
  });
  for (const record of records) {
    const description = describeNotesTextBlock(record.node);
    if (description.kind !== 'heading') continue;
    const siblings = byParent.get(record.parentKey);
    const next = siblings.find(
      (sibling) =>
        sibling.pos > record.pos &&
        describeNotesTextBlock(sibling.node).kind === 'heading' &&
        describeNotesTextBlock(sibling.node).level <= description.level,
    );
    const entry = entryFor(record, {
      kind: 'heading',
      level: description.level,
      label: labelOf(description.title),
      foldTo: next?.pos ?? record.parentEnd,
    });
    headings.push(entry);
    entries.push(entry);
  }
  const headingLevelAt = (pos) =>
    headings.findLast((entry) => entry.pos < pos && entry.foldTo > pos)?.level ?? 0;
  for (const record of records) {
    if (record.type !== 'listItem' && record.type !== 'taskItem') continue;
    const children = byParent.get(`parent:${record.pos}`) || [];
    const first = children[0];
    if (!first) continue;
    entries.push(
      entryFor(record, {
        kind: record.type === 'taskItem' ? 'task' : 'list',
        label: labelOf(textOf(first.node)),
        level: headingLevelAt(record.pos) + record.listDepth + 1,
        anchorPos: first.pos + 1,
        foldFrom: first.end,
        foldTo: record.end - 1,
        listParentId: record.listParent ? idOf(record.listParent) : null,
      }),
    );
  }
  // A plain paragraph enters the indentation outline only when its consecutive
  // sibling run actually contains an indented child. Ordinary prose stays out.
  for (const siblings of byParent.values()) {
    let run = [];
    const finish = () => {
      if (!run.some((record) => record.indent > 0)) {
        run = [];
        return;
      }
      const stack = [];
      for (let index = 0; index < run.length; index++) {
        const record = run[index];
        while (stack.length && stack.at(-1).indent >= record.indent) stack.pop();
        const next = run.slice(index + 1).find((other) => other.indent <= record.indent);
        const foldTo = next?.pos ?? run.at(-1).end;
        const entry = entryFor(record, {
          kind: 'indent',
          level: headingLevelAt(record.pos) + stack.length + 1,
          label: labelOf(textOf(record.node)),
          indentLength: /^[ \t\u3000]*/.exec(textOf(record.node))[0].length,
          foldTo,
        });
        entries.push(entry);
        stack.push(record);
      }
      run = [];
    };
    for (const record of siblings) {
      const description = describeNotesTextBlock(record.node);
      if (
        !record.listParent &&
        description.kind === 'paragraph' &&
        typeof description.source === 'string' &&
        description.source.trim()
      )
        run.push({ ...record, indent: indentOf(description.source) });
      else finish();
    }
    finish();
  }
  const visible = entries
    .filter((entry) => includeIndented || entry.kind === 'heading')
    .sort((a, b) => a.pos - b.pos);
  const hierarchy = [];
  for (const entry of visible) {
    while (
      hierarchy.length &&
      (hierarchy.at(-1).level >= entry.level ||
        (hierarchy.at(-1).kind === 'heading' && hierarchy.at(-1).foldTo <= entry.pos))
    )
      hierarchy.pop();
    entry.parentId = entry.listParentId || hierarchy.at(-1)?.id || null;
    hierarchy.push(entry);
  }
  if (!structureCache.has(doc)) structureCache.set(doc, new Map());
  structureCache.get(doc).set(includeIndented, visible);
  return visible;
}

/** Collapse sections as decorations; the source body and undo history stay intact. */
export function installNotesStructure(
  editor,
  { getFoldedIds = () => [], onFoldChange = () => {}, onStructureChange = () => {} } = {},
) {
  let disposed = false;
  let notified = false;
  let transition = null;
  let gutterFrame = null;
  let gutterObserver = null;
  const observedParagraphs = new Set();
  const viewWindow = editor.view.dom.ownerDocument.defaultView;
  const heldVisibleIds = new Set();
  const getAll = () => deriveNotesStructure(editor.state.doc, { includeIndented: true });
  const revealSelection = () => {
    const { selection } = editor.state;
    const ids = new Set(getFoldedIds());
    let changed = false;
    for (const entry of getAll())
      if (ids.has(entry.id) && selection.to >= entry.foldFrom && selection.from < entry.foldTo) {
        ids.delete(entry.id);
        changed = true;
      }
    if (changed) updateFolded(ids);
  };
  const notify = () => {
    if (notified || disposed) return;
    notified = true;
    queueMicrotask(() => {
      notified = false;
      if (!disposed && !editor.isDestroyed) {
        // Arrow keys and restored selections can enter a collapsed section.
        // Expand its ancestors before the next keystroke can edit invisible text.
        revealSelection();
        onStructureChange(getAll());
      }
    });
  };
  const refresh = () => {
    if (!disposed && !editor.isDestroyed)
      editor.view.dispatch(editor.state.tr.setMeta(plugin, true).setMeta('addToHistory', false));
  };
  const updateFolded = (ids, preserveAnimation = false) => {
    if (!preserveAnimation) stopAnimation();
    onFoldChange([...ids]);
    refresh();
  };
  const stopAnimation = () => {
    const current = transition;
    transition = null;
    const frames = new Map();
    if (current) {
      const view = editor.view.dom.ownerDocument.defaultView;
      for (const element of current.nodes) {
        const style = view.getComputedStyle(element);
        frames.set(element, {
          height: `${element.getBoundingClientRect().height}px`,
          opacity: style.opacity,
          marginTop: style.marginTop,
          marginBottom: style.marginBottom,
          paddingTop: style.paddingTop,
          paddingBottom: style.paddingBottom,
        });
      }
      for (const animation of current.animations) animation.cancel();
    }
    heldVisibleIds.clear();
    return frames;
  };
  const animateFold = (entry, ids, isFolded) => {
    const interrupted = stopAnimation();
    const view = editor.view.dom.ownerDocument.defaultView;
    const animate =
      typeof editor.view.dom.animate === 'function' &&
      !view.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    // Keep only the presentation open until its closing motion has finished.
    // The folded IDs and button state can be saved immediately.
    if (animate && isFolded) heldVisibleIds.add(entry.id);
    updateFolded(ids, true);
    if (!animate) return;
    const nodes = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.isInline) return false;
      if (pos >= entry.foldFrom && pos + node.nodeSize <= entry.foldTo) {
        const element = editor.view.nodeDOM(pos);
        if (
          element?.nodeType === 1 &&
          !element.classList.contains('notes-fold-hidden') &&
          element.getBoundingClientRect().height > 0
        )
          nodes.push(element);
        return false;
      }
      return true;
    });
    // Very long sections should remain responsive rather than start hundreds
    // of concurrent layout animations.
    if (!nodes.length || nodes.length > 80) {
      heldVisibleIds.clear();
      refresh();
      return;
    }
    const current = { nodes, animations: [], doc: editor.state.doc };
    transition = current;
    const closed = {
      height: '0px',
      opacity: 0,
      marginTop: '0px',
      marginBottom: '0px',
      paddingTop: '0px',
      paddingBottom: '0px',
    };
    try {
      for (const element of nodes) {
        const style = view.getComputedStyle(element);
        const open = {
          height: `${element.getBoundingClientRect().height}px`,
          opacity: style.opacity || '1',
          marginTop: style.marginTop,
          marginBottom: style.marginBottom,
          paddingTop: style.paddingTop,
          paddingBottom: style.paddingBottom,
        };
        const from = interrupted.get(element) || (isFolded ? open : closed);
        const to = isFolded ? closed : open;
        const constraints = { overflow: 'hidden', minHeight: '0px', boxSizing: 'border-box' };
        current.animations.push(
          element.animate(
            [
              { ...from, ...constraints },
              { ...to, ...constraints },
            ],
            { duration: 180, easing: 'cubic-bezier(.2, 0, 0, 1)', fill: 'both' },
          ),
        );
      }
      Promise.allSettled(current.animations.map((animation) => animation.finished)).then(() => {
        if (transition !== current) return;
        transition = null;
        heldVisibleIds.clear();
        if (!disposed && !editor.isDestroyed) refresh();
        for (const animation of current.animations) animation.cancel();
      });
    } catch {
      // A host without complete WAAPI support still gets a usable instant fold.
      stopAnimation();
      refresh();
    }
  };
  const toggle = (id) => {
    const entry = getAll().find((item) => item.id === id);
    if (!entry || entry.foldTo <= entry.foldFrom) return;
    const ids = new Set(getFoldedIds());
    const isFolded = !ids.has(id);
    if (!isFolded) ids.delete(id);
    else {
      ids.add(id);
      const { state } = editor;
      if (state.selection.to > entry.foldFrom && state.selection.from < entry.foldTo) {
        const selection = state.selection.constructor.near(state.doc.resolve(entry.anchorPos));
        editor.view.dispatch(state.tr.setSelection(selection).setMeta('addToHistory', false));
      }
    }
    animateFold(entry, ids, isFolded);
  };
  const syncFoldButton = (button, entry, isFolded) => {
    const attributes = {
      'data-kind': entry.kind,
      'data-folded': String(isFolded),
      'aria-expanded': String(!isFolded),
      'aria-label': `${isFolded ? '展开' : '折叠'} ${entry.label}`,
      title: `${isFolded ? '展开' : '折叠'} ${entry.label}`,
    };
    for (const [name, value] of Object.entries(attributes))
      if (button.getAttribute(name) !== value) button.setAttribute(name, value);
  };
  const syncFoldButtons = () => {
    const entries = new Map(getAll().map((entry) => [entry.id, entry]));
    const folded = new Set(getFoldedIds());
    for (const button of editor.view.dom.querySelectorAll('.notes-fold-toggle[data-fold-id]')) {
      const entry = entries.get(button.dataset.foldId);
      if (entry) syncFoldButton(button, entry, folded.has(entry.id));
    }
    syncGutterObservation();
    scheduleGutters();
  };
  const positionGutters = () => {
    gutterFrame = null;
    if (disposed || editor.isDestroyed) return;
    const entries = new Map(getAll().map((entry) => [entry.id, entry]));
    const positions = [];
    for (const button of editor.view.dom.querySelectorAll(
      '.notes-fold-toggle[data-kind="indent"]',
    )) {
      const entry = entries.get(button.dataset.foldId);
      const paragraph = button.parentElement;
      if (!entry || !paragraph?.getClientRects().length) continue;
      // Measure the actual prefix glyphs rather than multiplying an assumed
      // space width. Full-width spaces, tabs, font changes and wrapping then
      // share exactly the same alignment as the user's untouched source.
      const caret = editor.view.coordsAtPos(entry.anchorPos + entry.indentLength, 1);
      const bounds = paragraph.getBoundingClientRect();
      positions.push({
        button,
        left: `${Math.round((caret.left - bounds.left) * 1000) / 1000}px`,
        top: `${Math.round((caret.top - bounds.top + (caret.bottom - caret.top) / 2) * 1000) / 1000}px`,
      });
    }
    for (const { button, left, top } of positions) {
      if (button.style.getPropertyValue('--notes-fold-text-left') !== left)
        button.style.setProperty('--notes-fold-text-left', left);
      if (button.style.getPropertyValue('--notes-fold-line-center') !== top)
        button.style.setProperty('--notes-fold-line-center', top);
    }
  };
  const scheduleGutters = () => {
    if (!disposed && gutterFrame === null)
      gutterFrame = viewWindow.requestAnimationFrame(positionGutters);
  };
  const syncGutterObservation = () => {
    if (!gutterObserver && typeof viewWindow.ResizeObserver === 'function')
      gutterObserver = new viewWindow.ResizeObserver(scheduleGutters);
    if (!gutterObserver) return;
    const current = new Set(
      [...editor.view.dom.querySelectorAll('.notes-fold-toggle[data-kind="indent"]')].map(
        (button) => button.parentElement,
      ),
    );
    for (const paragraph of observedParagraphs)
      if (!current.has(paragraph)) {
        gutterObserver.unobserve(paragraph);
        observedParagraphs.delete(paragraph);
      }
    for (const paragraph of current)
      if (!observedParagraphs.has(paragraph)) {
        gutterObserver.observe(paragraph);
        observedParagraphs.add(paragraph);
      }
  };
  const build = (state) => {
    const entries = deriveNotesStructure(state.doc, { includeIndented: true });
    const folded = new Set(getFoldedIds());
    const collapsed = entries.filter(
      (entry) =>
        folded.has(entry.id) && !heldVisibleIds.has(entry.id) && entry.foldTo > entry.foldFrom,
    );
    const decorations = [];
    state.doc.descendants((node, pos) => {
      if (node.isInline) return false;
      if (collapsed.some((entry) => pos >= entry.foldFrom && pos + node.nodeSize <= entry.foldTo)) {
        decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'notes-fold-hidden' }));
        return false;
      }
      return true;
    });
    for (const entry of entries) {
      if (entry.foldTo <= entry.foldFrom) continue;
      decorations.push(
        Decoration.widget(
          entry.anchorPos,
          () => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'notes-fold-toggle';
            button.contentEditable = 'false';
            button.tabIndex = -1;
            button.dataset.foldId = entry.id;
            syncFoldButton(button, entry, new Set(getFoldedIds()).has(entry.id));
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('viewBox', '0 0 16 16');
            svg.setAttribute('aria-hidden', 'true');
            svg.setAttribute('focusable', 'false');
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', 'M6 3.5 10.5 8 6 12.5');
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', 'currentColor');
            path.setAttribute('stroke-width', '1.6');
            path.setAttribute('stroke-linecap', 'round');
            path.setAttribute('stroke-linejoin', 'round');
            svg.append(path);
            button.append(svg);
            button.addEventListener('mousedown', (event) => event.preventDefault());
            button.addEventListener('click', (event) => {
              event.preventDefault();
              event.stopPropagation();
              toggle(entry.id);
            });
            return button;
          },
          { side: -1, key: `notes-fold:${entry.id}`, stopEvent: () => true },
        ),
      );
    }
    return DecorationSet.create(state.doc, decorations);
  };
  const plugin = new Plugin({
    state: {
      init: (_config, state) => build(state),
      apply: (tr, previous, _old, state) =>
        tr.docChanged || tr.getMeta(plugin) ? build(state) : previous,
    },
    props: { decorations: (state) => plugin.getState(state) },
    view() {
      syncFoldButtons();
      notify();
      return {
        update: () => {
          // Retain the widget/SVG across folding so its CSS rotation can
          // interpolate, while labels follow the current document and state.
          syncFoldButtons();
          if (transition && transition.doc !== editor.state.doc) {
            stopAnimation();
            queueMicrotask(refresh);
          }
          notify();
        },
      };
    },
  });
  editor.registerPlugin(plugin);
  return {
    refresh,
    toggle,
    getEntries: (options) => deriveNotesStructure(editor.state.doc, options),
    reveal(pos) {
      const entries = getAll();
      const ids = new Set(getFoldedIds());
      let changed = false;
      for (const entry of entries)
        if (ids.has(entry.id) && pos >= entry.foldFrom && pos < entry.foldTo) {
          ids.delete(entry.id);
          changed = true;
        }
      if (changed) updateFolded(ids);
    },
    destroy() {
      disposed = true;
      if (gutterFrame !== null) viewWindow.cancelAnimationFrame(gutterFrame);
      gutterObserver?.disconnect();
      observedParagraphs.clear();
      stopAnimation();
      if (!editor.isDestroyed) editor.unregisterPlugin(plugin.key);
    },
  };
}
