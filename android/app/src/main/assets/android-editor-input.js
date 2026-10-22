// Normalizes to /public/vendor/... when served as a root Android asset, and also
// resolves directly to the same pinned module in source-only Node tests.
import { Plugin } from '../../../../../public/vendor/rich-editor.js';

/** Android-only input bridge. Shared richdoc commands remain the editing authority. */
export function installAndroidEditorInput(
  adapter,
  { canEdit = () => true, toast = () => {} } = {},
) {
  const editor = adapter?.editor;
  const view = editor?.view;
  const dom = view?.dom;
  if (!dom) throw new Error('Android输入适配需要已挂载的正文编辑器。');
  let disposed = false;
  let composing = false;
  let justComposed = false;
  let enter = null;
  let position = null;
  let pendingSplit = null;
  const listeners = [];
  const listen = (type, handler, capture = false) => {
    dom.addEventListener(type, handler, capture);
    listeners.push(() => dom.removeEventListener(type, handler, capture));
  };
  const available = () => !disposed && canEdit() && editor.isEditable !== false;
  const inComposition = () => composing || justComposed || adapter.composing || view.composing;
  const release = () => {
    if (position) adapter.releasePosition?.(position);
    position = null;
  };
  function capture() {
    release();
    if (!available() || inComposition()) return false;
    // Older adapters without token release must not accumulate registered positions.
    if (!adapter.capturePosition || !adapter.releasePosition) return false;
    // ProseMirror retains the body's TextSelection while a title/toolbar owns DOM
    // focus, and initializes one for a new empty entry without opening the IME.
    const selection = editor.state.selection;
    if (!selection.$from?.parent.inlineContent || !selection.$to?.parent.inlineContent)
      return false;
    position = adapter.capturePosition();
    return !!position;
  }
  const entryIdentity = () => adapter.captureResumePosition?.()?.entryId;
  const splitPlugin = new Plugin({
    appendTransaction(transactions, oldState, nextState) {
      const intent = pendingSplit;
      if (!intent) return null;
      if (!transactions.some((tr) => tr.docChanged)) {
        if (transactions.some((tr) => tr.selectionSet)) pendingSplit = null;
        return null;
      }
      // Consume exactly the first document change. No later edit may reuse this intent.
      pendingSplit = null;
      if (
        !available() ||
        inComposition() ||
        intent.entryId !== entryIdentity() ||
        oldState.doc !== intent.doc ||
        !oldState.selection.eq(intent.selection) ||
        transactions.some((tr) => tr.getMeta('composition') != null || tr.getMeta('uiEvent')) ||
        nextState.doc.childCount !== intent.doc.childCount + 1
      )
        return null;
      const left = nextState.doc.child(intent.index);
      const right = nextState.doc.child(intent.index + 1);
      const { parent, offset, before } = intent;
      if (left.type !== parent.type || right.type !== parent.type) return null;
      // StableBlocks may assign a new blockId to the second half of the split.
      const attrs = ({ blockId: _blockId, ...rest }) => rest;
      if (
        left.attrs.blockId !== parent.attrs.blockId ||
        JSON.stringify(attrs(left.attrs)) !== JSON.stringify(attrs(parent.attrs)) ||
        JSON.stringify(attrs(right.attrs)) !== JSON.stringify(attrs(parent.attrs)) ||
        !left.content.eq(parent.content.cut(0, offset)) ||
        !right.content.eq(parent.content.cut(offset))
      )
        return null;
      // Compare only the two surrounding fragments, never normalize old paragraphs.
      if (
        !nextState.doc.content.cut(0, before).eq(intent.doc.content.cut(0, before)) ||
        !nextState.doc.content
          .cut(before + left.nodeSize + right.nodeSize)
          .eq(intent.doc.content.cut(before + parent.nodeSize))
      )
        return null;
      const start = before + left.nodeSize + 1;
      if (
        !nextState.selection.empty ||
        nextState.selection.from !== start ||
        nextState.selection.$from.depth !== 1 ||
        right.textContent.startsWith('　　')
      )
        return null;
      // Appended transactions are recorded with their originating native split by
      // ProseMirror history; one undo restores both (covered by real-adapter tests).
      // editor.js owns caret clearance after input and IME resize. A second
      // ProseMirror scroll request can leave only its smaller default margin.
      return nextState.tr.insertText('　　', start);
    },
  });
  editor.registerPlugin(splitPlugin);
  listen('compositionstart', () => {
    composing = true;
    enter = null;
    pendingSplit = null;
    release();
  });
  listen('compositionend', () => {
    composing = false;
    justComposed = true;
    queueMicrotask(() => {
      justComposed = false;
    });
  });
  listen(
    'keydown',
    (event) => {
      pendingSplit = null;
      enter = event.key === 'Enter' ? event : null;
    },
    true,
  );
  listen('keyup', () => {
    enter = null;
  });
  listen('blur', () => {
    enter = null;
    pendingSplit = null;
  });
  listen(
    'beforeinput',
    (event) => {
      pendingSplit = null;
      if (
        !available() ||
        event.defaultPrevented ||
        event.inputType !== 'insertParagraph' ||
        event.isComposing ||
        inComposition()
      )
        return;
      // Some keyboards deliver both paths. A handled physical Enter already split once.
      if (enter?.defaultPrevented) {
        if (event.cancelable) event.preventDefault();
        enter = null;
        return;
      }
      if (enter && (enter.shiftKey || enter.altKey || enter.ctrlKey || enter.metaKey)) return;
      enter = null;
      const { empty, $from } = editor.state.selection;
      if (!empty || $from.depth !== 1 || $from.parent.type.name !== 'paragraph') return;
      if (!event.cancelable) {
        const identity = entryIdentity();
        if (!identity) return;
        pendingSplit = {
          entryId: identity,
          doc: editor.state.doc,
          selection: editor.state.selection,
          index: $from.index(0),
          parent: $from.parent,
          offset: $from.parentOffset,
          before: $from.before(),
        };
        return;
      }
      const commandEvent = {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        isComposing: false,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
      };
      // Call the installed command props directly; never dispatch a fake DOM key event.
      const handled = view.someProp('handleKeyDown', (handler) => handler(view, commandEvent));
      if (handled) event.preventDefault();
    },
    true,
  );
  return {
    capture,
    runAction(fn) {
      pendingSplit = null;
      if (!available()) {
        release();
        return false;
      }
      if (inComposition()) {
        release();
        toast('请先完成当前输入，再点击此操作。');
        return false;
      }
      if (!position) capture();
      if (!position) {
        toast('请先点选正文中的插入位置。');
        return false;
      }
      try {
        if (!adapter.restorePosition(position)) {
          toast('正文位置已变化，请重新点选插入位置。');
          return false;
        }
        return fn() !== false;
      } finally {
        release();
      }
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      pendingSplit = null;
      release();
      enter = null;
      for (const remove of listeners) remove();
      editor.unregisterPlugin(splitPlugin.key);
    },
  };
}
