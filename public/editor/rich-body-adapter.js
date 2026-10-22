import { createRichEditor } from './rich-document-editor.js';
import { fromEditorJSON, validateRichDocument, safeRichLink } from '../shared/rich-document.js';
import { dateTimeEdit } from '../shared/date-time-edit.js';
import { Plugin } from '../vendor/rich-editor.js';
import { capturePastedFiles } from '../core/clipboard-files.js';

const INDENT = '　　';
const isRich = (entry) => entry?.contentFormat === 'richdoc' && !!entry.body;
const sameBody = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Mount only explicitly selected richdoc entries. Owns Tiptap transactions,
 * never legacy innerHTML or a save timer. c.current/library are live getters;
 * c.markDirty and c.pause remain the existing persistence/composition hooks.
 * renderProjection(body) is optional and must be the shared safe renderer.
 * capturePosition tokens are ephemeral, mapped through mounted transactions,
 * and rejected after changing document; syncIdentity rebinds draft->saved IDs.
 * onFiles(files,entry,position) owns confirmation/upload, never this adapter.
 * onConflict({reason,entryId,localBody,incomingBody}) reports IME/render races;
 * pendingConflict preserves both bodies. Explicit commit throws code
 * RICH_BODY_COMPOSITION_CONFLICT until resolveConflict('local'|'incoming') is
 * called after composition. A stale same-entry render never remounts IME.
 */
export function createRichBodyAdapter(
  c,
  { onChange, resolveAsset, onImage, onMediaEdit, renderProjection, onFiles, onConflict } = {},
) {
  const host = c.$('#bodyEditor');
  let rich = null,
    entryId = null,
    mountedEntry = null,
    loading = false,
    composing = false,
    justComposed = false,
    compositionBase = null,
    pendingConflict = null,
    cachedDoc = null,
    cachedBodyJson = null;
  const positions = new Set();
  const preferences = () => c.library.settings?.preferences || {};
  const indent = () => (preferences().autoIndentParagraph === false ? '' : INDENT);
  const current = () => {
    const entry = c.current();
    return rich && isRich(entry) && entry.id === entryId ? entry : null;
  };
  const canEdit = () =>
    current() && !current().deleted && !composing && !justComposed && !rich.editor.view.composing;
  const boundary = () => {
    // Pinned ProseMirror history's closeHistory PluginKey (bundled once in
    // rich-editor.js). Regression tests verify isolation from adjacent typing.
    rich.editor.view.dispatch(rich.editor.state.tr.setMeta('closeHistory$', true));
  };
  function resetCommitCache() {
    cachedDoc = cachedBodyJson = null;
  }
  function commit({ markDirty = true } = {}) {
    if (pendingConflict) {
      const error = new Error('组词期间正文出现外部变更，请先选择保留本地输入或传入版本。');
      error.code = 'RICH_BODY_COMPOSITION_CONFLICT';
      throw error;
    }
    const entry = current();
    if (!entry || entry.deleted || composing || loading) return false;
    const doc = rich.editor.state.doc;
    let body;
    if (cachedDoc !== doc) {
      body = rich.getBody();
      cachedBodyJson = JSON.stringify(body);
      cachedDoc = doc;
    }
    // Entry bodies remain mutable outside this adapter; compare their current
    // contents even when the immutable editor document has not changed.
    if (JSON.stringify(entry.body) === cachedBodyJson) return false;
    body ??= JSON.parse(cachedBodyJson);
    const projection = renderProjection?.(body);
    entry.body = body;
    entry.contentFormat = 'richdoc';
    if (typeof projection === 'string') entry.content = projection;
    if (markDirty) c.markDirty?.(entry);
    c.onContentChanged?.(entry);
    onChange?.(entry);
    return true;
  }
  function capturePosition() {
    if (!rich) return null;
    const { anchor, head, node } = rich.editor.state.selection;
    const position = {
      format: 'richdoc',
      entryId,
      anchor,
      head,
      ...(node
        ? { selectionType: 'node', nodeBlockId: node.attrs.blockId, atomic: node.isAtom }
        : {}),
    };
    positions.add(position);
    return position;
  }
  function restorePosition(position) {
    if (!rich || !positions.has(position) || position.entryId !== entryId) return false;
    if (position.selectionType === 'node') {
      const node = rich.editor.state.doc.nodeAt(position.anchor);
      if (!node || node.attrs.blockId !== position.nodeBlockId) return false;
      return rich.editor.commands.setNodeSelection(position.anchor);
    }
    const limit = rich.editor.state.doc.content.size;
    const clamp = (n) => Math.max(1, Math.min(limit - 1, n));
    return rich.editor.commands.setTextSelection({
      from: clamp(position.anchor),
      to: clamp(position.head),
    });
  }
  function captureResumePosition() {
    if (!rich) return null;
    const { anchor, head, node } = rich.editor.state.selection;
    return {
      format: 'richdoc',
      entryId,
      anchor,
      head,
      ...(node ? { selectionType: 'node', nodeBlockId: node.attrs.blockId } : {}),
    };
  }
  function restoreResumePosition(position) {
    if (
      !rich ||
      position?.format !== 'richdoc' ||
      position.entryId !== entryId ||
      !Number.isFinite(position.anchor) ||
      !Number.isFinite(position.head)
    )
      return false;
    const editor = rich.editor;
    if (position.selectionType === 'node' && position.nodeBlockId) {
      let target = null;
      editor.state.doc.descendants((node, at) => {
        if (node.attrs.blockId === position.nodeBlockId) target = at;
      });
      if (target !== null) return editor.commands.setNodeSelection(target);
    }
    const limit = editor.state.doc.content.size;
    const clamp = (n) => Math.max(0, Math.min(limit, Math.trunc(n)));
    const near = (n) => editor.state.selection.constructor.near(editor.state.doc.resolve(clamp(n)));
    const anchor = near(position.anchor),
      head = near(position.head);
    if (anchor.$from.parent.inlineContent && head.$from.parent.inlineContent)
      return editor.commands.setTextSelection({ from: anchor.from, to: head.from });
    editor.view.dispatch(editor.state.tr.setSelection(anchor));
    return true;
  }
  function insertDateTime(value) {
    if (!rich) return false;
    if (!canEdit()) return true;
    const editor = rich.editor;
    const { from, to, $from, $to, empty } = editor.state.selection;
    let semantic = $from.parent.type.name !== 'paragraph';
    for (let d = 1; d < $from.depth; d++) {
      if ($from.node(d).type.name !== 'doc') semantic = true;
    }
    boundary();
    if (!empty || semantic || !$from.sameParent($to)) {
      editor.commands.insertContentAt({ from, to }, { type: 'text', text: String(value) });
    } else {
      const start = $from.start();
      const source = $from.parent.textBetween(0, $from.parent.content.size, '', '\n');
      // textBetween and native positions coincide for text/hardBreak paragraphs.
      const previous =
        $from.before() > 0 ? editor.state.doc.resolve($from.before()).nodeBefore : null;
      const prefix = previous && (previous.isAtom || previous.textContent.trim()) ? '\uFFFC\n' : '';
      const cursor = prefix.length + from - start;
      const edit = dateTimeEdit(prefix + source, cursor, cursor, String(value), {
        indent: indent(),
      });
      const content = [];
      edit.insert.split('\n').forEach((line, i) => {
        if (i) content.push({ type: 'hardBreak' });
        if (line) content.push({ type: 'text', text: line });
      });
      editor.commands.insertContentAt(
        {
          from: start + Math.max(0, edit.from - prefix.length),
          to: start + Math.max(0, edit.to - prefix.length),
        },
        content,
      );
    }
    boundary();
    editor.view.focus();
    return true;
  }
  function divider() {
    const editor = rich.editor;
    boundary();
    // Collapse to the selection END; divider never replaces selected prose.
    const result = editor
      .chain()
      .setTextSelection(editor.state.selection.to)
      .setHorizontalRule()
      .run();
    boundary();
    return result;
  }
  function command(name, value) {
    if (!rich) return false;
    if (!canEdit()) return true;
    const editor = rich.editor;
    if (name === 'insertHorizontalRule') return divider();
    if (name === 'insertImage') return insertImage(value);
    if (name === 'insertMedia') {
      const { type = 'image', attrs, ...fields } = value || {};
      return insertMedia(attrs || fields, { type });
    }
    const chain = editor.chain();
    const commands = {
      undo: () => chain.undo(),
      redo: () => chain.redo(),
      bold: () => chain.toggleBold(),
      italic: () => chain.toggleItalic(),
      underline: () => chain.toggleUnderline(),
      strikeThrough: () => chain.toggleStrike(),
      hiliteColor: () => chain.toggleMark('highlight'),
      insertUnorderedList: () => chain.toggleBulletList(),
      insertOrderedList: () => chain.toggleOrderedList(),
      removeFormat: () => chain.unsetAllMarks().clearNodes(),
      insertText: () => chain.insertContent({ type: 'text', text: String(value ?? '') }),
      createLink: () => (safeRichLink(value) ? chain.setLink({ href: value }) : null),
      formatBlock: () => {
        const block = String(value).toLowerCase().replace(/[<>]/g, '');
        if (/^h[1-6]$/.test(block)) return chain.setHeading({ level: +block[1] });
        if (block === 'pre') return chain.toggleCodeBlock();
        if (block === 'blockquote') return chain.toggleBlockquote();
        if (['p', 'div'].includes(block)) return chain.setParagraph();
        return null;
      },
    };
    const action = commands[name]?.();
    if (action) action.run();
    else c.toast?.('此操作暂不适用于图文正文');
    return true;
  }
  function insertImage(attrs, options = {}) {
    return insertMedia(attrs, { ...options, type: 'image' });
  }
  function insertMedia(attrs, { position, type = 'image' } = {}) {
    if (!['image', 'video'].includes(type))
      throw new Error('正文暂支持图片和视频，其他附件保持原关联。');
    if (!rich) return false;
    if (!canEdit()) return false;
    let insertAt = null;
    if (position?.selectionType === 'node' && position.atomic) {
      if (!positions.has(position) || position.entryId !== entryId) return false;
      // The mapped end remains after prior images inserted with this token.
      // Never turn a selected image into a text range that replaces it.
      insertAt = position.head;
    } else if (position && !restorePosition(position)) return false;
    else if (rich.editor.state.selection.node?.isAtom) insertAt = rich.editor.state.selection.to;
    const node = {
      type,
      attrs: {
        blockId: crypto.randomUUID(),
        occurrenceId: crypto.randomUUID(),
        insertedAt: new Date().toISOString(),
        widthRatio: 0.75,
        align: 'center',
        caption: '',
        alt: '',
        ...attrs,
      },
    };
    validateRichDocument({ format: 'shiye-richdoc', version: 1, content: [node] });
    rich.checkBody({ format: 'shiye-richdoc', version: 1, content: [node] });
    boundary();
    const result =
      insertAt === null
        ? rich.editor.commands.insertContent(node)
        : rich.editor.commands.insertContentAt(insertAt, node);
    boundary();
    return result;
  }
  function selectedImage() {
    const node = rich?.editor.state.selection.node;
    return node?.type.name === 'image' ? structuredClone(node.attrs) : null;
  }
  function selectedMedia() {
    const node = rich?.editor.state.selection.node;
    return node && ['image', 'video'].includes(node.type.name)
      ? { ...structuredClone(node.attrs), type: node.type.name }
      : null;
  }
  function updateSelectedImage(changes, { occurrenceId = selectedImage()?.occurrenceId } = {}) {
    return updateSelectedMedia(changes, { occurrenceId, type: 'image' });
  }
  function updateSelectedMedia(
    changes,
    { occurrenceId = selectedMedia()?.occurrenceId, type } = {},
  ) {
    if (!canEdit() || pendingConflict || !occurrenceId) return false;
    if (
      !changes ||
      Object.keys(changes).some((key) => !['widthRatio', 'align', 'caption', 'alt'].includes(key))
    )
      throw new Error('图片排版只允许修改宽度、对齐、图注和替代文字。');
    let target = null;
    rich.editor.state.doc.descendants((node, pos) => {
      if (
        ['image', 'video'].includes(node.type.name) &&
        (!type || node.type.name === type) &&
        node.attrs.occurrenceId === occurrenceId
      )
        target = { node, pos };
    });
    if (!target) return false;
    const attrs = { ...target.node.attrs, ...changes };
    validateRichDocument({
      format: 'shiye-richdoc',
      version: 1,
      content: [{ type: target.node.type.name, attrs }],
    });
    boundary();
    rich.editor.view.dispatch(rich.editor.state.tr.setNodeMarkup(target.pos, undefined, attrs));
    boundary();
    return true;
  }
  function unmount() {
    resetCommitCache();
    const wasMounted = !!rich;
    rich?.destroy();
    rich = null;
    positions.clear();
    entryId = mountedEntry = null;
    composing = justComposed = false;
    compositionBase = pendingConflict = null;
    if (wasMounted) host.classList.remove('rich-document-editor');
  }
  function render(entry) {
    resetCommitCache();
    if (!isRich(entry)) return false;
    validateRichDocument(entry.body);
    if (rich && entry.id === entryId && (composing || justComposed || rich.editor.view.composing)) {
      // Persistence still holds the pre-composition body. Never reload it over
      // the live IME transaction, including the compositionend microtask gap.
      const localBody = rich.getBody();
      if (
        !sameBody(entry.body, compositionBase || mountedEntry.body) &&
        !sameBody(entry.body, localBody)
      ) {
        const notify = !pendingConflict || !sameBody(pendingConflict.incomingBody, entry.body);
        pendingConflict = {
          reason: 'composition-render-conflict',
          entryId,
          localBody,
          incomingBody: structuredClone(entry.body),
        };
        c.pause?.();
        if (notify) {
          c.toast?.('组词期间正文出现外部变更，已保留本地输入，请先处理冲突。');
          onConflict?.(structuredClone(pendingConflict));
        }
      }
      mountedEntry = entry;
      return true;
    }
    if (rich && entry.id === entryId && pendingConflict) return true;
    if (rich && entry.id === entryId && sameBody(entry.body, rich.getBody())) {
      mountedEntry = entry;
      rich.editor.setEditable(!entry.deleted);
      return true;
    }
    unmount();
    host.replaceChildren();
    host.contentEditable = 'false';
    host.classList.add('rich-document-editor');
    host.classList.remove('markdown-editor');
    entryId = entry.id;
    mountedEntry = entry;
    loading = true;
    try {
      rich = createRichEditor(host, {
        body: entry.body,
        editable: !entry.deleted,
        resolveAsset: resolveAsset || ((id) => '/media/' + encodeURIComponent(id)),
        onImage,
        onMediaEdit,
        onUpdate: () => {
          if (!pendingConflict) commit();
        },
      });
      const editor = rich.editor;
      const keydown = (view, event) => {
        if (
          event.isComposing ||
          event.keyCode === 229 ||
          composing ||
          justComposed ||
          view.composing
        )
          return false;
        if (
          canEdit() &&
          event.ctrlKey &&
          !event.altKey &&
          !event.metaKey &&
          ['Home', 'End'].includes(event.key)
        ) {
          const doc = editor.state.doc;
          const edge = event.key === 'Home' ? doc.firstChild : doc.lastChild;
          if (edge?.isTextblock) {
            const to = event.key === 'Home' ? 1 : doc.content.size - 1;
            editor
              .chain()
              .setTextSelection({
                from: event.shiftKey ? editor.state.selection.anchor : to,
                to,
              })
              .scrollIntoView()
              .run();
            editor.view.focus();
            return true;
          }
        }
        if (canEdit() && event.key === 'Tab' && !event.altKey && !event.ctrlKey && !event.metaKey) {
          const selection = editor.state.selection;
          if (selection.node) return false;
          const blocks = [];
          editor.state.doc.nodesBetween(selection.from, selection.to, (node, pos, parent) => {
            if (parent === editor.state.doc && node.type.name === 'paragraph')
              blocks.push({ node, pos });
          });
          if (!blocks.length || selection.$from.depth > 1 || selection.$to.depth > 1) return false;
          boundary();
          const tr = editor.state.tr;
          if (selection.empty && !event.shiftKey) tr.insertText(INDENT);
          else {
            for (const { node, pos } of blocks.reverse()) {
              if (!event.shiftKey) tr.insertText(INDENT, pos + 1);
              else {
                const prefix = /^(?:\u3000{1,2}| {1,4}|\t)/.exec(node.textContent)?.[0];
                if (prefix) tr.delete(pos + 1, pos + 1 + prefix.length);
              }
            }
          }
          if (tr.docChanged) editor.view.dispatch(tr.scrollIntoView());
          // Ctrl+A uses AllSelection (document boundaries). Return to a text
          // selection so native End/arrow navigation can collapse it normally.
          if (
            selection.$from.depth === 0 &&
            tr.doc.firstChild?.isTextblock &&
            tr.doc.lastChild?.isTextblock
          )
            editor.commands.setTextSelection({ from: 1, to: tr.doc.content.size - 1 });
          editor.view.focus();
          boundary();
          return true;
        }
        if (
          !canEdit() ||
          event.key !== 'Enter' ||
          event.shiftKey ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey
        )
          return false;
        const { $from, empty } = editor.state.selection;
        if (!empty || $from.parent.type.name !== 'paragraph' || $from.depth !== 1) return false;
        if (/^[\t \u3000]*---[\t \u3000]*$/.test($from.parent.textContent)) {
          const at = $from.before();
          boundary();
          const done = editor
            .chain()
            .deleteRange({ from: at, to: at + $from.parent.nodeSize })
            .insertContentAt(at, [
              { type: 'horizontalRule' },
              { type: 'paragraph', content: indent() ? [{ type: 'text', text: indent() }] : [] },
            ])
            .run();
          boundary();
          return done;
        }
        if (!indent()) return false;
        return editor
          .chain()
          .splitBlock()
          .command(({ tr }) => {
            if (!tr.selection.$from.parent.textContent.startsWith(indent()))
              tr.insertText(indent());
            return true;
          })
          .run();
      };
      editor.registerPlugin(
        new Plugin({
          props: {
            handleKeyDown: keydown,
            handlePaste(_view, event) {
              const files = capturePastedFiles(event);
              if (!files) return false;
              event.preventDefault();
              const entry = current();
              if (canEdit()) {
                const task = onFiles
                  ? onFiles(files, entry, capturePosition())
                  : c.upload?.(files, entry);
                Promise.resolve(task).catch((error) => c.toast?.(error.message));
              } else files.catch((error) => c.toast?.(error.message));
              return true;
            },
            handleDrop(_view, event) {
              // Existing upload queue handles file drop confirmation and position.
              if (!event.dataTransfer?.files?.length) return false;
              event.preventDefault();
              return true;
            },
            handleDOMEvents: {
              keydown(_view, event) {
                // A DOM handler owns default prevention. Stop editor keymaps for
                // candidate-confirming Enter while leaving native IME untouched.
                return !!(event.isComposing || event.keyCode === 229 || composing || justComposed);
              },
              compositionstart() {
                resetCommitCache();
                composing = true;
                compositionBase = structuredClone(current()?.body || rich.getBody());
                c.pause?.();
                return false;
              },
              compositionend() {
                composing = false;
                justComposed = true;
                const mounted = rich;
                queueMicrotask(() => {
                  if (rich !== mounted) return;
                  justComposed = false;
                  if (pendingConflict) pendingConflict.localBody = rich.getBody();
                  if (!pendingConflict) commit();
                  compositionBase = null;
                });
                return false;
              },
            },
          },
        }),
        (plugin, plugins) => [plugin, ...plugins],
      );
      editor.on('transaction', ({ transaction }) => {
        if (!transaction.docChanged) return;
        for (const position of positions) {
          position.anchor = transaction.mapping.map(position.anchor, 1);
          position.head = transaction.mapping.map(position.head, 1);
        }
      });
    } finally {
      loading = false;
    }
    return true;
  }
  return {
    render,
    commit,
    command,
    insertDateTime,
    insertImage,
    insertMedia,
    selectedImage,
    selectedMedia,
    updateSelectedImage,
    updateSelectedMedia,
    capturePosition,
    restorePosition,
    captureResumePosition,
    restoreResumePosition,
    releasePosition(position) {
      return positions.delete(position);
    },
    resolveConflict(choice) {
      if (!pendingConflict || !canEdit() || !['local', 'incoming'].includes(choice)) return false;
      const conflict = pendingConflict;
      pendingConflict = null;
      if (choice === 'local') {
        commit();
        return true;
      }
      const entry = current();
      entry.body = structuredClone(conflict.incomingBody);
      return render(entry);
    },
    get pendingConflict() {
      return pendingConflict
        ? structuredClone({ ...pendingConflict, localBody: rich.getBody() })
        : null;
    },
    focus(options) {
      if (!rich) return false;
      rich.editor.view.focus(options);
      return true;
    },
    atStart() {
      if (!rich || composing || justComposed || rich.editor.view.composing) return false;
      const { empty, from } = rich.editor.state.selection;
      return empty && !/[\S\r\n]/u.test(rich.editor.state.doc.textBetween(0, from, '\n', '\uFFFC'));
    },
    syncIdentity(entry = c.current(), oldId = entryId) {
      if (
        !rich ||
        !entry ||
        entryId !== oldId ||
        (entry !== mountedEntry && !sameBody(entry.body, rich.getBody()))
      )
        return false;
      entryId = entry.id;
      mountedEntry = entry;
      resetCommitCache();
      for (const position of positions) position.entryId = entryId;
      return true;
    },
    newDocument(template = '', autoIndent = true) {
      if (template) throw new Error('图文新篇暂不转换非空旧模板，请保留原编辑路径。');
      const text = autoIndent ? INDENT : '';
      return {
        contentFormat: 'richdoc',
        body: fromEditorJSON({
          type: 'doc',
          content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }],
        }),
        content: '',
      };
    },
    get isRichDocument() {
      return !!rich;
    },
    get isMarkdown() {
      return false;
    },
    get composing() {
      return composing || justComposed || !!rich?.editor.view.composing;
    },
    get editor() {
      return rich?.editor || null;
    },
    dispose: unmount,
  };
}
