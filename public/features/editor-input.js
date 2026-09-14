export const PARAGRAPH_INDENT = '　　';
const SEMANTIC_CONTEXT =
  'li,ul,ol,pre,code,blockquote,table,td,th,h1,h2,h3,h4,h5,h6,[contenteditable="false"]';
export const paragraphIndentEnabled = (preferences = {}) =>
  preferences.autoIndentParagraph !== false;
export function initialEditorContent(template = '', preferences = {}) {
  return template || (paragraphIndentEnabled(preferences) ? PARAGRAPH_INDENT : '');
}
export function formatLocalDateTime(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return (
    '[' +
    date.getFullYear() +
    '/' +
    pad(date.getMonth() + 1) +
    '/' +
    pad(date.getDate()) +
    '  ' +
    pad(date.getHours()) +
    ':' +
    pad(date.getMinutes()) +
    ':' +
    pad(date.getSeconds()) +
    ']'
  );
}
export function paragraphIndentIntent(
  event,
  {
    enabled = true,
    composing = false,
    enterIntent = null,
    semantic = false,
    selectionInside = true,
    collapsed = true,
  } = {},
) {
  return (
    enabled &&
    event.inputType === 'insertParagraph' &&
    !event.isComposing &&
    event.keyCode !== 229 &&
    !composing &&
    enterIntent !== false &&
    !semantic &&
    selectionInside &&
    collapsed &&
    !event.defaultPrevented
  );
}

/** Native paragraph splitting remains browser-owned, so lists/IME/undo keep their semantics. */
export function createEditorInput(c) {
  const editor = c.$('#bodyEditor');
  const doc = editor.ownerDocument;
  const win = doc.defaultView;
  const listeners = [];
  let composing = false,
    justComposed = false,
    enterIntent = null,
    pending = null,
    inserting = false;
  const listen = (target, event, handler, capture = false) => {
    target.addEventListener(event, handler, capture);
    listeners.push(() => target.removeEventListener(event, handler, capture));
  };
  const preferences = () => c.library.settings?.preferences || {};
  const elementOf = (node) => (node?.nodeType === 1 ? node : node?.parentElement);
  const selectionRange = () => {
    const selection = doc.getSelection();
    if (!selection?.rangeCount) return null;
    const range = selection.getRangeAt(0);
    return editor.contains(range.startContainer) && editor.contains(range.endContainer)
      ? range
      : null;
  };
  const semantic = (range) =>
    [range?.startContainer, range?.endContainer].some((node) => {
      const found = elementOf(node)?.closest(SEMANTIC_CONTEXT);
      return found && found !== editor && editor.contains(found);
    });
  const reset = () => {
    composing = justComposed = false;
    enterIntent = pending = null;
  };
  listen(win, 'blur', reset);
  listen(doc, 'visibilitychange', () => {
    if (doc.hidden) reset();
  });
  listen(editor, 'blur', () => {
    enterIntent = pending = null;
  });
  listen(editor, 'keydown', (event) => {
    if (event.key === 'Enter' || event.code === 'Enter' || event.code === 'NumpadEnter') {
      enterIntent =
        !event.isComposing &&
        !composing &&
        !justComposed &&
        event.keyCode !== 229 &&
        !event.shiftKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey &&
        !event.defaultPrevented;
    } else enterIntent = null;
  });
  listen(editor, 'keyup', (event) => {
    if (event.key === 'Enter') enterIntent = null;
  });
  listen(editor, 'compositionstart', () => {
    composing = true;
    pending = null;
    enterIntent = false;
  });
  listen(editor, 'compositionend', () => {
    composing = false;
    justComposed = true;
    // Some IMEs emit the final paragraph event before the key-up in the same task.
    queueMicrotask(() => {
      justComposed = false;
    });
  });
  listen(editor, 'beforeinput', (event) => {
    if (inserting) return;
    pending = null;
    const entry = c.current(),
      range = selectionRange();
    if (
      !entry ||
      entry.deleted ||
      !range ||
      !paragraphIndentIntent(event, {
        enabled: paragraphIndentEnabled(preferences()),
        composing: composing || justComposed,
        enterIntent,
        semantic: semantic(range),
        collapsed: range.collapsed,
      })
    )
      return;
    pending = { id: entry.id };
  });
  listen(
    editor,
    'input',
    (event) => {
      if (inserting) return;
      const intent = pending;
      pending = null;
      if (
        !intent ||
        event.inputType !== 'insertParagraph' ||
        event.isComposing ||
        composing ||
        c.current()?.id !== intent.id ||
        c.current()?.deleted
      )
        return;
      const range = selectionRange();
      if (!range?.collapsed || semantic(range)) return;
      const block = elementOf(range.startContainer)?.closest('p,div') || editor;
      if (block !== editor && !editor.contains(block)) return;
      const prefix = doc.createRange();
      prefix.selectNodeContents(block);
      prefix.setEnd(range.startContainer, range.startOffset);
      const before = prefix.toString();
      if (before.includes(PARAGRAPH_INDENT) || before.trim()) return;
      const suffix = doc.createRange();
      suffix.selectNodeContents(block);
      suffix.setStart(range.startContainer, range.startOffset);
      if (suffix.toString().startsWith(PARAGRAPH_INDENT)) return;
      inserting = true;
      try {
        // Use the native edit command for the browser's undo history; no saved stale selection.
        const inserted = doc.execCommand('insertText', false, PARAGRAPH_INDENT);
        if (inserted === false) return;
        const entry = c.current();
        if (entry?.id === intent.id) {
          entry.content = editor.innerHTML;
          c.markDirty();
        }
      } finally {
        inserting = false;
      }
    },
    true,
  );
  return {
    initialContent(template = '', prefs = preferences()) {
      return initialEditorContent(template, prefs);
    },
    insertDateTime() {
      c.command('insertText', formatLocalDateTime());
    },
    dispose() {
      reset();
      listeners.forEach((remove) => remove());
    },
  };
}
