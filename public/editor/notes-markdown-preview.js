import { Plugin, Decoration, DecorationSet } from '../vendor/rich-editor.js';
import { markdownLanguage } from '../vendor/codemirror.js';

const inlineStyles = {
  StrongEmphasis: 'strong',
  Emphasis: 'emphasis',
  Strikethrough: 'strike',
  InlineCode: 'code',
};
const delimiters = new Set(['EmphasisMark', 'StrikethroughMark', 'CodeMark']);
const opaqueNodes = new Set([
  'FencedCode',
  'CodeBlock',
  'HTMLBlock',
  'CommentBlock',
  'ProcessingInstructionBlock',
  'Image',
]);
// ProseMirror nodes are immutable. Selection changes can reuse a block's parsed
// presentation, while an edited block automatically gets a different key.
const blockPresentations = new WeakMap();

// Positions stay in the rich document. Preview decorations never become a
// second document, and never request images or interpret arbitrary HTML.
function sourceFor(node) {
  let source = '';
  let compatible = true;
  const visit = (child) => {
    if (child.marks?.length) compatible = false;
    const type = typeof child.type === 'string' ? child.type : child.type.name;
    if (child.isText || type === 'text') source += child.text;
    else if (type === 'hardBreak') source += '\n';
    else compatible = false;
  };
  if (typeof node.forEach === 'function') node.forEach(visit);
  else (node.content || []).forEach(visit);
  return compatible ? source : null;
}

function blockSyntax(source) {
  // Only a whole rich-document block is a heading or divider. A hard break
  // before --- must never reinterpret the preceding text as a Setext heading.
  if (/^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(source))
    return { kind: 'rule' };
  const heading = /^ {0,3}(#{1,6})(?:[ \t]+(.*)|[ \t]*)$/.exec(source);
  if (heading)
    return {
      kind: 'heading',
      level: heading[1].length,
      title: (heading[2] || '').replace(/[ \t]+#+[ \t]*$/, '').trim(),
    };
  return { kind: 'paragraph' };
}

/** Read-only block description for the notes outline; accepts PM nodes or richdoc JSON. */
export function describeNotesTextBlock(node) {
  const type = typeof node?.type === 'string' ? node.type : node?.type?.name;
  if (type === 'horizontalRule') return { kind: 'rule' };
  if (!['paragraph', 'heading'].includes(type)) return { kind: 'other' };
  const source = sourceFor(node);
  if (type === 'heading') {
    const level = Number(node.attrs?.level);
    const plainText = (children) =>
      (children || [])
        .map(
          (child) => child.text ?? (child.type === 'hardBreak' ? '\n' : plainText(child.content)),
        )
        .join('');
    return {
      kind: 'heading',
      level: Number.isInteger(level) && level >= 1 && level <= 6 ? level : 1,
      title: node.textContent ?? plainText(node.content),
      source,
    };
  }
  return { ...(source === null ? { kind: 'paragraph' } : blockSyntax(source)), source };
}

function presentation(source) {
  const tree = markdownLanguage.parser.parse(source);
  const hidden = [];
  const styled = [];
  const protectedRanges = [];
  let blockClass = '';
  const syntax = blockSyntax(source);
  const first = tree.topNode.firstChild;
  if (syntax.kind === 'rule') {
    blockClass = 'notes-md-rule';
    hidden.push([0, source.length]);
  } else if (first?.from === 0 && first.to === source.length) {
    const heading = /^ATXHeading([1-6])$/.exec(first.name);
    if (heading) blockClass = `notes-md-heading notes-md-h${heading[1]}`;
    else if (first.name === 'Blockquote') blockClass = 'notes-md-quote';
  }
  tree.iterate({
    enter(ref) {
      const { name, from, to } = ref;
      if (opaqueNodes.has(name)) {
        protectedRanges.push([from, to]);
        return false;
      }
      if (name === 'InlineCode' || name === 'Escape' || name === 'Link')
        protectedRanges.push([from, to]);
      if (inlineStyles[name]) styled.push([from, to, inlineStyles[name]]);
      if (delimiters.has(name)) hidden.push([from, to]);
      if (
        (name === 'HeaderMark' && /^ATXHeading[1-6]$/.test(ref.node.parent?.name || '')) ||
        name === 'QuoteMark'
      ) {
        let end = to;
        while (source[end] === ' ' || source[end] === '\t') end++;
        hidden.push([from, end]);
      }
      if (name === 'Escape') hidden.push([from, from + 1]);
      if (name === 'Link') {
        // Only hide a parsed inline link's destination; its label stays text.
        // No href is installed, so preview cannot initiate navigation.
        const marks = ref.node.getChildren('LinkMark');
        const opening = marks.find((mark) => source.slice(mark.from, mark.to) === '[');
        const closing = marks.find((mark) => source.slice(mark.from, mark.to) === ']');
        if (opening && closing) {
          hidden.push([opening.from, opening.to], [closing.from, to]);
          styled.push([opening.to, closing.from, 'link']);
        }
      }
      return undefined;
    },
  });
  // Highlight is not part of CommonMark. Its small extension respects parser
  // ranges, so code, escaped delimiters, links and images remain literal.
  for (const match of source.matchAll(/==([^=\r\n]+)==/g)) {
    const from = match.index;
    const to = from + match[0].length;
    if (protectedRanges.some(([start, end]) => from < end && to > start)) continue;
    hidden.push([from, from + 2], [to - 2, to]);
    styled.push([from + 2, to - 2, 'highlight']);
  }
  return { hidden, styled, blockClass };
}

function selectedBlock(selection, pos, node) {
  if (selection.empty)
    return selection.from >= pos + 1 && selection.from <= pos + node.nodeSize - 1;
  return selection.from < pos + node.nodeSize && selection.to > pos;
}

function presentationFor(node) {
  if (blockPresentations.has(node)) return blockPresentations.get(node);
  const source = sourceFor(node);
  const parsed = source ? presentation(source) : null;
  blockPresentations.set(node, parsed);
  return parsed;
}

function previewDecorations(state, focused) {
  const decorations = [];
  state.doc.descendants((node, pos) => {
    if (!node.isTextblock || !['paragraph', 'heading'].includes(node.type.name)) return;
    const active = focused && selectedBlock(state.selection, pos, node);
    if (active) {
      decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'notes-md-source' }));
      return false;
    }
    const parsed = presentationFor(node);
    const legacyHeading =
      node.type.name === 'heading'
        ? `notes-md-heading notes-md-h${Math.min(6, Math.max(1, Number(node.attrs.level) || 1))}`
        : '';
    if (legacyHeading)
      decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: legacyHeading }));
    if (!parsed) return false;
    const { hidden, styled, blockClass } = parsed;
    if (blockClass)
      decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: blockClass }));
    for (const [from, to] of hidden) {
      if (to > from)
        decorations.push(
          Decoration.inline(pos + 1 + from, pos + 1 + to, { class: 'notes-md-marker' }),
        );
    }
    for (const [from, to, kind] of styled) {
      if (to > from)
        decorations.push(
          Decoration.inline(pos + 1 + from, pos + 1 + to, { class: `notes-md-${kind}` }),
        );
    }
    return false;
  });
  return DecorationSet.create(state.doc, decorations);
}

const reversibleMarks = new Set(['bold', 'italic', 'strike', 'code', 'highlight']);
function canRevealLegacy(node) {
  if (!['paragraph', 'heading'].includes(node.type.name)) return false;
  if (Object.keys(node.attrs).some((key) => key !== 'blockId' && key !== 'level')) return false;
  let safe = true;
  let formatted = node.type.name === 'heading';
  node.forEach((child) => {
    if (!child.isText && child.type.name !== 'hardBreak') safe = false;
    if (Object.keys(child.attrs).length) safe = false;
    for (const mark of child.marks) {
      formatted = true;
      if (!reversibleMarks.has(mark.type.name) || Object.keys(mark.attrs).length) safe = false;
    }
  });
  return safe && formatted;
}

function sourceOffset(source, visibleOffset) {
  const { hidden } = presentation(source);
  let visible = 0;
  for (let offset = 0; offset < source.length; offset++) {
    if (hidden.some(([from, to]) => offset >= from && offset < to)) continue;
    if (visible++ >= visibleOffset) return offset;
  }
  return source.length;
}

/** Install source-on-edit presentation for the notes window only. */
export function installNotesMarkdownPreview(editor) {
  let focused = editor.view.hasFocus();
  let composing = false;
  let destroyed = false;
  let conversionQueued = false;
  let compositionTimer = null;
  let currentView = editor.view;
  const refresh = () => {
    if (!destroyed && !editor.isDestroyed)
      currentView.dispatch(
        currentView.state.tr.setMeta(plugin, true).setMeta('addToHistory', false),
      );
  };
  const revealLegacy = () => {
    if (conversionQueued || destroyed || composing || !focused || currentView.composing) return;
    conversionQueued = true;
    queueMicrotask(() => {
      conversionQueued = false;
      if (destroyed || editor.isDestroyed || composing || !focused || currentView.composing) return;
      const { state } = currentView;
      const { selection } = state;
      if (!selection.empty || !selection.$head.parent.isTextblock) return;
      const node = selection.$head.parent;
      if (!canRevealLegacy(node)) return;
      const source = editor.markdown
        .serialize({ type: 'doc', content: [node.toJSON()] })
        .replace(/\n+$/, '');
      const pos = selection.$head.before();
      const paragraph = state.schema.nodes.paragraph.create(
        { blockId: node.attrs.blockId },
        source ? state.schema.text(source) : null,
      );
      const tr = state.tr.replaceWith(pos, pos + node.nodeSize, paragraph);
      const offset = sourceOffset(source, selection.$head.parentOffset);
      tr.setSelection(selection.constructor.create(tr.doc, pos + 1 + offset));
      currentView.dispatch(tr.setMeta('addToHistory', false));
    });
  };
  const plugin = new Plugin({
    state: {
      init: (_config, state) => previewDecorations(state, focused),
      apply(tr, previous, _oldState, state) {
        if (composing || currentView?.composing) return previous.map(tr.mapping, tr.doc);
        if (tr.docChanged || tr.selectionSet || tr.getMeta(plugin))
          return previewDecorations(state, focused);
        return previous;
      },
    },
    props: {
      decorations: (state) => plugin.getState(state),
      handleDOMEvents: {
        focus() {
          focused = true;
          refresh();
          revealLegacy();
          return false;
        },
        blur() {
          focused = false;
          refresh();
          return false;
        },
        compositionstart() {
          composing = true;
          clearTimeout(compositionTimer);
          return false;
        },
        compositionend() {
          clearTimeout(compositionTimer);
          compositionTimer = setTimeout(() => {
            composing = false;
            refresh();
            revealLegacy();
          }, 30);
          return false;
        },
      },
    },
    view(view) {
      // ProseMirror recreates plugin views when another plugin is registered.
      destroyed = false;
      currentView = view;
      revealLegacy();
      return {
        update(next) {
          currentView = next;
          revealLegacy();
        },
        destroy() {
          destroyed = true;
          clearTimeout(compositionTimer);
        },
      };
    },
  });
  editor.registerPlugin(plugin);
  return {
    destroy() {
      if (!destroyed && !editor.isDestroyed) editor.unregisterPlugin(plugin.key);
      destroyed = true;
      clearTimeout(compositionTimer);
    },
  };
}
