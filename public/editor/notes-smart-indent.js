import { Plugin } from '../vendor/rich-editor.js';

const indentUnit = '　　';
const prefixPattern = /^[ \t　]*/;
const protectedParents = new Set([
  'codeBlock',
  'table',
  'tableCell',
  'tableHeader',
  'listItem',
  'taskItem',
  'orderedList',
  'bulletList',
  'taskList',
]);

function isParagraph($pos) {
  if ($pos.parent.type.name !== 'paragraph') return false;
  for (let depth = 1; depth < $pos.depth; depth++)
    if (protectedParents.has($pos.node(depth).type.name)) return false;
  // Markdown headings retain their own source editing and Enter behavior.
  return !/^ {0,3}#{1,6}(?:[ \t]|$)/.test($pos.parent.textContent);
}

function removeLevel(prefix) {
  let remaining = prefix.length;
  let columns = 0;
  while (remaining > 0 && columns < 4) {
    const char = prefix[remaining - 1];
    const width = char === '\t' ? 4 : char === '　' ? 2 : 1;
    if (columns && columns + width > 4) break;
    remaining--;
    columns += width;
  }
  return prefix.slice(0, remaining);
}

function indentParagraphs(view, backwards) {
  const { state } = view;
  const { $from, $to, from, to } = state.selection;
  if (!isParagraph($from) || !isParagraph($to)) return false;
  const paragraphs = [];
  let compatible = true;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.isBlock && node.isLeaf && !node.isTextblock) {
      compatible = false;
      return false;
    }
    if (!node.isTextblock) return true;
    // A selection ending at the next paragraph's start does not indent it.
    if (pos + 1 === to && to > from) return false;
    if (node.type.name !== 'paragraph' || !isParagraph(state.doc.resolve(pos + 1))) {
      compatible = false;
      return false;
    }
    paragraphs.push({ pos, prefix: prefixPattern.exec(node.textContent)[0] });
    return false;
  });
  if (!compatible || !paragraphs.length) return false;
  const tr = state.tr;
  for (const { pos, prefix } of paragraphs.reverse()) {
    if (backwards) {
      const retained = removeLevel(prefix);
      if (retained.length < prefix.length)
        tr.delete(pos + 1 + retained.length, pos + 1 + prefix.length);
    } else tr.insertText(indentUnit, pos + 1);
  }
  // Shift+Tab on a root task stays in the editor without changing its text.
  if (tr.docChanged) view.dispatch(tr.scrollIntoView());
  return true;
}

function enterParagraph(view) {
  const { state } = view;
  const { $from, empty, from } = state.selection;
  if (!empty || !isParagraph($from)) return false;
  const paragraph = $from.parent;
  const source = paragraph.textContent;
  const prefix = prefixPattern.exec(source)[0];
  if (source === prefix && prefix.length) {
    const retained = removeLevel(prefix);
    view.dispatch(
      state.tr
        .delete($from.start() + retained.length, $from.start() + prefix.length)
        .scrollIntoView(),
    );
    return true;
  }
  // Splitting inside the indentation itself follows the base editor's behavior.
  if ($from.parentOffset < prefix.length) return false;
  let nextPrefix = prefix;
  if ($from.parentOffset === paragraph.content.size && /[:：]\s*$/.test(source))
    nextPrefix += indentUnit;
  if (!nextPrefix) return false;
  const tr = state.tr.split(from);
  if (nextPrefix) tr.insertText(nextPrefix, from + 2);
  tr.setSelection(state.selection.constructor.create(tr.doc, from + 2 + nextPrefix.length));
  view.dispatch(tr.scrollIntoView());
  return true;
}

/** Preserve indentation in the rich document's ordinary paragraphs only. */
export function installNotesSmartIndent(editor, { isEnabled = () => true } = {}) {
  const plugin = new Plugin({
    props: {
      handleKeyDown(view, event) {
        if (
          !isEnabled() ||
          !editor.isEditable ||
          view.composing ||
          event.isComposing ||
          event.keyCode === 229 ||
          event.ctrlKey ||
          event.altKey ||
          event.metaKey
        )
          return false;
        if (event.key === 'Tab') return indentParagraphs(view, event.shiftKey);
        if (event.key === 'Enter' && !event.shiftKey) return enterParagraph(view);
        return false;
      },
    },
  });
  editor.registerPlugin(plugin, (newPlugin, plugins) => [newPlugin, ...plugins]);
  return {
    destroy() {
      if (!editor.isDestroyed) editor.unregisterPlugin(plugin.key);
    },
  };
}
