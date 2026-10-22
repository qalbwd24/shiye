import { Decoration, ViewPlugin, WidgetType, syntaxTree } from '../vendor/codemirror.js';

const inlineClasses = {
  StrongEmphasis: 'md-strong',
  Emphasis: 'md-emphasis',
  Strikethrough: 'md-strike',
  InlineCode: 'md-inline-code',
};
const hiddenMarks = new Set(['EmphasisMark', 'StrikethroughMark', 'HeaderMark', 'QuoteMark']);

function safePreviewColor(value) {
  const color = value.trim();
  if (/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(color)) return color;
  const rgb =
    /^rgb\(\s*(\d+(?:\.\d+)?%?)\s*,\s*(\d+(?:\.\d+)?%?)\s*,\s*(\d+(?:\.\d+)?%?)\s*\)$/i.exec(color);
  return rgb && rgb.slice(1).every((part) => parseFloat(part) <= (part.endsWith('%') ? 100 : 255))
    ? color
    : null;
}

// A deliberately narrow bridge for the existing underline and text-color toolbar.
// Never interpret HTML generally, or put untrusted markup into a DOM node.
function inlineHTMLPresentation(text, offset, tree, add) {
  const pattern =
    /<u>([^<>\r\n]*)<\/u>|<span\s+style=(["'])\s*color\s*:\s*([^"'<>\r\n;]+)\s*;?\s*\2\s*>([^<>\r\n]*)<\/span>/gi;
  for (const match of text.matchAll(pattern)) {
    const from = offset + match.index,
      to = from + match[0].length;
    let code = false;
    for (let node = tree.resolve(from + 1, 1); node; node = node.parent) {
      if (
        /^(InlineCode|FencedCode|CodeBlock|HTMLBlock|CommentBlock|ProcessingInstructionBlock)$/.test(
          node.name,
        )
      ) {
        code = true;
        break;
      }
    }
    if (code) continue;
    const color = match[3] === undefined ? null : safePreviewColor(match[3]);
    if (match[3] !== undefined && !color) continue;
    add({
      from,
      to,
      start: from + match[0].indexOf('>') + 1,
      end: from + match[0].lastIndexOf('</'),
      color,
    });
  }
}

function literalTimestamps(text, offset, tree, add) {
  // Escaping '[' prevents Link parsing, but ':34:' may still become an Emoji.
  // Cover the whole timestamp so default highlighting cannot color its middle.
  const pattern = /\\?\[\d{4}\/\d{2}\/\d{2}[ \t]+\d{2}:\d{2}:\d{2}\\?\]/g;
  for (const match of text.matchAll(pattern)) {
    const from = offset + match.index;
    let literal = true;
    for (let node = tree.resolve(from + 3, 1); node; node = node.parent) {
      if (
        /^(InlineCode|FencedCode|CodeBlock|HTMLBlock|CommentBlock|ProcessingInstructionBlock|Link|Image|Autolink|LinkReference)$/.test(
          node.name,
        )
      ) {
        // Bare Link nodes already receive md-literal; links and code retain
        // their own presentation, including timestamps used as link labels.
        literal = false;
        break;
      }
    }
    if (literal) add(from, from + match[0].length, 'md-literal');
  }
}

// Resolve only application-owned media. Markdown never causes a third-party image request.
export function previewMediaURL(value, resolveMedia) {
  if (!resolveMedia || typeof value !== 'string') return null;
  const resolved = resolveMedia(value);
  return typeof resolved === 'string' && /^\/media\/[A-Za-z0-9_.%~-]+$/.test(resolved)
    ? resolved
    : null;
}

class ImageWidget extends WidgetType {
  constructor(src, alt) {
    super();
    this.src = src;
    this.alt = alt;
  }
  eq(other) {
    return other.src === this.src && other.alt === this.alt;
  }
  toDOM(view) {
    const image = view.dom.ownerDocument.createElement('img');
    image.className = 'md-preview-image';
    image.src = this.src;
    image.alt = this.alt;
    image.loading = 'lazy';
    image.decoding = 'async';
    image.draggable = false;
    image.addEventListener('load', () => view.requestMeasure(), { once: true });
    return image;
  }
  ignoreEvent() {
    return false;
  }
}

class RuleWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM(view) {
    const rule = view.dom.ownerDocument.createElement('span');
    rule.className = 'md-rule';
    rule.setAttribute('role', 'separator');
    rule.setAttribute('aria-label', '分割线');
    rule.title = '点击编辑分割线标记';
    rule.addEventListener('click', () => {
      // Use the current DOM position: earlier edits may have shifted this widget.
      view.dispatch({ selection: { anchor: view.posAtDOM(rule) } });
      view.focus();
    });
    return rule;
  }
  ignoreEvent() {
    return false;
  }
}

class TaskWidget extends WidgetType {
  constructor(checked) {
    super();
    this.checked = checked;
  }
  eq(other) {
    return this.checked === other.checked;
  }
  toDOM(view) {
    const task = view.dom.ownerDocument.createElement('span');
    task.className = 'md-task-preview';
    task.textContent = this.checked ? '☑' : '☐';
    task.setAttribute('aria-label', this.checked ? '已完成' : '未完成');
    return task;
  }
  ignoreEvent() {
    return false;
  }
}

// The active line exposes syntax, including every line touched by a multi-selection.
// Never replace a range containing a newline from a ViewPlugin: CodeMirror disallows it.
export function buildLivePreviewDecorations(view, { resolveMedia } = {}) {
  const { state } = view;
  const { doc } = state;
  const ranges = [];
  const seen = new Set();
  const activeLines = view.hasFocus
    ? state.selection.ranges.map(({ from, to }) => [doc.lineAt(from).from, doc.lineAt(to).to])
    : [];
  const active = (from, to) => activeLines.some(([start, end]) => from <= end && to >= start);
  const mark = (from, to, className) => {
    if (from < to) ranges.push(Decoration.mark({ class: className }).range(from, to));
  };
  const line = (from, className) => {
    const start = doc.lineAt(from).from;
    const key = `${start}:${className}`;
    if (!seen.has(key)) {
      seen.add(key);
      ranges.push(Decoration.line({ class: className }).range(start));
    }
  };
  const hide = (from, to) => {
    if (from < to && !active(from, to) && !doc.sliceString(from, to).includes('\n')) {
      ranges.push(Decoration.replace({}).range(from, to));
    }
  };
  const tree = syntaxTree(state);
  for (const visible of view.visibleRanges) {
    tree.iterate({
      from: visible.from,
      to: visible.to,
      enter(node) {
        const { name, from, to } = node;
        const key = `${from}:${to}:${name}`;
        if (seen.has(key)) return;
        seen.add(key);
        const heading = /^(?:ATX|Setext)Heading([1-6])$/.exec(name);
        if (heading) line(from, `md-heading md-heading-${heading[1]}`);
        if (inlineClasses[name]) mark(from, to, inlineClasses[name]);
        if (name === 'Link') {
          // The Markdown parser also emits Link for bare brackets and unresolved
          // references. Neutralize its default link highlighting without hiding text.
          mark(from, to, node.node.getChild('URL') ? 'md-link' : 'md-literal');
        }
        if (name === 'Blockquote' || name === 'FencedCode' || name === 'CodeBlock') {
          const className = name === 'Blockquote' ? 'md-quote-line' : 'md-code-line';
          let current = doc.lineAt(Math.max(from, visible.from));
          const end = Math.min(to, visible.to);
          while (current.from <= end) {
            line(current.from, className);
            if (current.number >= doc.lines) break;
            current = doc.line(current.number + 1);
          }
        }
        if (name === 'ListMark') mark(from, to, 'md-list-mark');
        if (name === 'TaskMarker') {
          if (active(from, to)) mark(from, to, 'md-task-marker');
          else {
            const checked = /[xX]/.test(doc.sliceString(from, to));
            ranges.push(Decoration.replace({ widget: new TaskWidget(checked) }).range(from, to));
          }
          return false;
        }
        if (name === 'CodeInfo') mark(from, to, 'md-code-info');
        if (name === 'Escape') {
          // Escape nodes contain the backslash and exactly one literal character.
          // Code nodes do not contain Escape children, so code stays untouched.
          mark(from, to, 'md-literal');
          hide(from, from + 1);
          return false;
        }
        if (name === 'Image') {
          const text = doc.sliceString(from, to);
          const urlNode = node.node.getChild('URL');
          const src =
            urlNode && previewMediaURL(doc.sliceString(urlNode.from, urlNode.to), resolveMedia);
          if (src && !active(from, to) && !text.includes('\n')) {
            const alt = /^!\[([^\]]*)\]/.exec(text)?.[1] || '日记图片';
            ranges.push(Decoration.replace({ widget: new ImageWidget(src, alt) }).range(from, to));
          }
          // Unsupported or remote images retain their entire source, including their URL.
          return false;
        }
        if (name === 'HorizontalRule' && !active(from, to)) {
          ranges.push(Decoration.replace({ widget: new RuleWidget() }).range(from, to));
          return false;
        }
        if (hiddenMarks.has(name)) hide(from, to);
        if (
          name === 'LinkMark' &&
          node.node.parent?.name === 'Link' &&
          node.node.parent.getChild('URL')
        )
          hide(from, to);
        if (name === 'CodeMark' && node.node.parent?.name === 'InlineCode') hide(from, to);
        if ((name === 'URL' || name === 'LinkTitle') && node.node.parent?.name === 'Link') {
          hide(from, to);
        }
      },
    });
    let current = doc.lineAt(visible.from);
    while (current.from <= visible.to) {
      const key = `inline-html:${current.from}`;
      if (!seen.has(key)) {
        seen.add(key);
        literalTimestamps(current.text, current.from, tree, mark);
        inlineHTMLPresentation(
          current.text,
          current.from,
          tree,
          ({ from, to, start, end, color }) => {
            hide(from, start);
            hide(end, to);
            if (start < end) {
              const spec = color
                ? { class: 'md-custom-color', attributes: { style: `color:${color}` } }
                : { class: 'md-underline' };
              ranges.push(Decoration.mark(spec).range(start, end));
            }
          },
        );
      }
      if (current.number >= doc.lines) break;
      current = doc.line(current.number + 1);
    }
  }
  return Decoration.set(ranges, true);
}

export function createLivePreview(options = {}) {
  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.view = view;
        this.frame = 0;
        this.destroyed = false;
        this.decorations = buildLivePreviewDecorations(view, options);
      }
      update(update) {
        // Mapping preserves the IME's DOM ownership while keeping decoration positions valid.
        this.decorations = update.view.composing
          ? this.decorations.map(update.changes)
          : buildLivePreviewDecorations(update.view, options);
      }
      finishComposition() {
        const win = this.view.dom.ownerDocument.defaultView;
        win.cancelAnimationFrame(this.frame);
        this.frame = win.requestAnimationFrame(() => {
          if (!this.destroyed && !this.view.composing) this.view.dispatch({});
        });
      }
      destroy() {
        this.destroyed = true;
        this.view.dom.ownerDocument.defaultView.cancelAnimationFrame(this.frame);
      }
    },
    {
      decorations: (plugin) => plugin.decorations,
      eventHandlers: {
        compositionend() {
          this.finishComposition();
        },
      },
    },
  );
}
