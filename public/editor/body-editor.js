import {
  EditorState,
  EditorView,
  Compartment,
  StateEffect,
  Prec,
  keymap,
  history,
  historyKeymap,
  defaultKeymap,
  drawSelection,
  dropCursor,
  placeholder,
  markdown,
  markdownLanguage,
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
  syntaxTree,
  undo,
  redo,
} from '../vendor/codemirror.js';
import { getEditorDocument } from '../shared/editor-document.js';
import { createLivePreview } from './live-preview.js';
import {
  htmlToMarkdown,
  transformMarkdown,
  paragraphEnter,
  markdownStructureEnter,
} from './markdown-transforms.js';
import { renderMarkdown } from './markdown-renderer.js';

/** Owns the editable document. Other features must use commands, not CodeMirror's DOM. */
export function createBodyEditor(c) {
  const host = c.$('#bodyEditor');
  const bar = document.createElement('div');
  bar.className = 'editor-document-controls';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'secondary';
  toggle.id = 'markdownModeButton';
  const original = document.createElement('button');
  original.type = 'button';
  original.className = 'secondary';
  original.textContent = '转换前原文';
  original.id = 'editorOriginalButton';
  const media = document.createElement('button');
  media.type = 'button';
  media.className = 'secondary';
  media.textContent = '插入附件图片';
  media.id = 'insertMarkdownMedia';
  bar.append(original, media, toggle);
  c.$('#editorToolboxContent').append(bar);
  let view = null,
    entryId = null,
    sourceMode = false;
  const preview = new Compartment(),
    editable = new Compartment(),
    extensions = new Map();
  try {
    sourceMode = localStorage.getItem('shiye.editor.source-mode') === 'true';
  } catch {
    /* Optional. */
  }
  const resolveMedia = (raw) => {
    const match = /^\/media\/([^?#/]+)$/.exec(raw);
    if (!match) return null;
    let id;
    try {
      id = decodeURIComponent(match[1]);
    } catch {
      return null;
    }
    return c.library.media.some((m) => m.id === id && m.type?.startsWith('image/'))
      ? '/media/' + encodeURIComponent(id)
      : null;
  };
  const previewExtension = () => (sourceMode ? [] : createLivePreview({ resolveMedia }));
  function controls() {
    toggle.textContent = view ? (sourceMode ? '实时预览' : '显示源码') : '转为 Markdown';
    toggle.disabled = !c.current() || c.current().deleted;
    toggle.setAttribute('aria-pressed', String(!!view && sourceMode));
    original.hidden = typeof c.current()?.editorOriginalHtml !== 'string';
    media.hidden = !view;
    media.disabled = !c.current() || c.current().deleted;
  }
  function changed() {
    const entry = c.current();
    if (!view || !entry || entry.id !== entryId || entry.deleted) return;
    entry.markdownSource = view.state.doc.toString();
    entry.contentFormat = 'markdown';
    entry.content = entry.markdownHtml = renderMarkdown(entry.markdownSource);
    for (const match of entry.content.matchAll(/<img[^>]+src="\/media\/([^"]+)"/g)) {
      let id;
      try {
        id = decodeURIComponent(match[1]);
      } catch {
        continue;
      }
      if (c.library.media.some((item) => item.id === id) && !entry.attachments.includes(id))
        entry.attachments.push(id);
    }
    c.markDirty(entry);
    if (view.composing) c.pause();
  }
  function render(entry) {
    const doc = getEditorDocument(entry);
    const same =
      view &&
      entry?.id === entryId &&
      doc.format === 'markdown' &&
      view.state.doc.toString() === doc.source;
    entryId = entry?.id || null;
    if (same) {
      view.dispatch({
        effects: editable.reconfigure([
          EditorState.readOnly.of(!!entry.deleted),
          EditorView.editable.of(!entry.deleted),
        ]),
      });
      controls();
      return;
    }
    view?.destroy();
    view = null;
    host.replaceChildren();
    host.classList.toggle('markdown-editor', doc.format === 'markdown');
    if (doc.format === 'html') {
      host.contentEditable = entry?.deleted ? 'false' : 'true';
      host.setAttribute('role', 'textbox');
      host.setAttribute('aria-label', '日记正文');
      host.innerHTML = c.sanitize(doc.source);
    } else {
      host.contentEditable = 'false';
      host.removeAttribute('role');
      host.removeAttribute('aria-label');
      view = new EditorView({
        parent: host,
        state: EditorState.create({
          doc: doc.source,
          extensions: [
            markdown({ base: markdownLanguage }),
            history(),
            drawSelection(),
            dropCursor(),
            bracketMatching(),
            syntaxHighlighting(defaultHighlightStyle),
            EditorView.lineWrapping,
            placeholder('记录此刻的想法…'),
            EditorView.contentAttributes.of({
              'aria-label': '日记正文',
              spellcheck: 'false',
              autocapitalize: 'off',
            }),
            editable.of([
              EditorState.readOnly.of(!!entry.deleted),
              EditorView.editable.of(!entry.deleted),
            ]),
            preview.of(previewExtension()),
            ...[...extensions.values()].map((item) => item.compartment.of(item.extension)),
            Prec.highest(
              keymap.of([
                {
                  key: 'Enter',
                  run: (editor) => {
                    if (editor.composing || editor.state.facet(EditorState.readOnly)) return false;
                    const { from, to } = editor.state.selection.main;
                    const source = editor.state.doc.toString();
                    const indent = c.library.settings?.preferences?.autoIndentParagraph !== false;
                    const edit =
                      markdownStructureEnter(source, from, to, indent) ||
                      paragraphEnter(source, from, to, indent);
                    if (!edit) return false;
                    applyEdit(edit);
                    return true;
                  },
                },
              ]),
            ),
            keymap.of([...historyKeymap, ...defaultKeymap]),
            EditorView.updateListener.of((update) => {
              if (update.docChanged) changed();
            }),
            EditorView.domEventHandlers({
              click(event, editor) {
                if (!event.ctrlKey && !event.metaKey) return false;
                const pos = editor.posAtCoords({ x: event.clientX, y: event.clientY });
                if (pos === null) return false;
                let node = syntaxTree(editor.state).resolveInner(pos, -1);
                while (node && node.name !== 'Link') node = node.parent;
                const urlNode = node?.getChild('URL');
                if (!urlNode) return false;
                const url = editor.state.sliceDoc(urlNode.from, urlNode.to).replace(/^<|>$/g, '');
                if (!/^(https?:|mailto:)/i.test(url)) return false;
                event.preventDefault();
                window.open(url, '_blank', 'noopener,noreferrer');
                return true;
              },
              compositionstart() {
                c.pause();
                return false;
              },
              compositionend() {
                const composingView = view;
                requestAnimationFrame(() => {
                  if (view === composingView) changed();
                });
                return false;
              },
              paste(event) {
                if (!event.clipboardData?.files.length) return false;
                event.preventDefault();
                event.stopPropagation();
                c.upload([...event.clipboardData.files]).catch((error) => c.toast(error.message));
                return true;
              },
              drop(event) {
                // The existing upload queue owns file drops; never paste a local path into Markdown.
                if (event.dataTransfer?.files.length) {
                  event.preventDefault();
                  return true;
                }
                return false;
              },
            }),
          ],
        }),
      });
    }
    controls();
  }
  function applyEdit(edit) {
    view.dispatch({
      changes: { from: edit.from, to: edit.to, insert: edit.insert },
      selection: edit.selection,
      scrollIntoView: true,
      userEvent: 'input',
    });
  }
  function command(name, value) {
    if (!view) return false;
    if (!c.current() || c.current().deleted) return true;
    view.focus();
    if (name === 'undo' || name === 'redo') {
      (name === 'undo' ? undo : redo)(view);
      return true;
    }
    const { from, to } = view.state.selection.main;
    const edit = transformMarkdown(view.state.doc.toString(), from, to, name, value);
    if (edit) applyEdit(edit);
    else c.toast('此操作暂不适用于当前位置');
    return true;
  }
  async function convert() {
    await c.flush();
    const entry = c.current();
    if (!entry || entry.deleted) return;
    const id = entry.id,
      revision = entry.revision;
    const proposed = htmlToMarkdown(c.sanitize(entry.content));
    c.modal(
      '转为 Markdown',
      `<p>原格式内容会保留，转换后的段落、颜色和表格请先核对。取消不会修改日记。</p><textarea id="convertedMarkdown" class="field" rows="12" aria-label="转换后的 Markdown"></textarea><button class="secondary" id="previewConverted">查看效果</button><button class="primary" id="acceptConverted">使用 Markdown 编辑</button><div id="convertedPreview"></div>`,
    );
    c.$('#convertedMarkdown').value = proposed;
    c.$('#previewConverted').onclick = () => {
      c.$('#convertedPreview').innerHTML = renderMarkdown(c.$('#convertedMarkdown').value);
    };
    c.$('#acceptConverted').onclick = async () => {
      if (c.current()?.id !== id || c.current().revision !== revision)
        return c.toast('日记已变化，请重新打开转换');
      const source = c.$('#convertedMarkdown').value;
      entry.editorOriginalHtml ??= entry.content;
      entry.markdownSource = source;
      entry.contentFormat = 'markdown';
      entry.content = entry.markdownHtml = renderMarkdown(source);
      c.closeModal();
      render(entry);
      changed();
      focus();
    };
  }
  function toggleSource() {
    if (!view) return convert();
    sourceMode = !sourceMode;
    try {
      localStorage.setItem('shiye.editor.source-mode', String(sourceMode));
    } catch {
      /* Optional. */
    }
    view.dispatch({ effects: preview.reconfigure(previewExtension()) });
    controls();
    focus();
  }
  toggle.onclick = () => Promise.resolve(toggleSource()).catch((error) => c.toast(error.message));
  original.onclick = () => {
    c.modal(
      '转换前原文',
      '<p>这是首次转为 Markdown 时保留的原格式副本。当前编辑不会修改这份副本。</p><div id="editorOriginalPreview" class="body-editor"></div>',
    );
    c.$('#editorOriginalPreview').innerHTML = c.sanitize(c.current()?.editorOriginalHtml || '');
  };
  media.onclick = () => {
    const entry = c.current();
    const items = c.library.media.filter(
      (item) => entry?.attachments.includes(item.id) && item.type?.startsWith('image/'),
    );
    c.modal(
      '插入附件图片',
      '<p>选择本篇已有图片，在当前光标处插入。新增图片可继续使用粘贴、拖放或右侧添加。</p><div id="markdownMediaChoices"></div>',
    );
    const choices = c.$('#markdownMediaChoices');
    if (!items.length) {
      choices.textContent = '本篇还没有图片附件。';
      return;
    }
    for (const item of items) {
      const button = document.createElement('button');
      button.className = 'option-button';
      button.textContent = item.name || '图片';
      button.onclick = () => {
        if (c.current()?.id !== entry.id) return c.toast('请回到原日记后再插入');
        c.closeModal();
        const name = (item.name || '图片').replace(/[\[\]\\\r\n]/g, '');
        command('insertText', `![${name}](/media/${encodeURIComponent(item.id)})`);
      };
      choices.append(button);
    }
  };
  function focus() {
    if (view) view.focus();
    else host.focus();
  }
  return {
    render,
    command,
    focus,
    toggleSource,
    get isMarkdown() {
      return !!view;
    },
    newDocument(template = '', indent = true) {
      const source = template ? htmlToMarkdown(c.sanitize(template)) : indent ? '　　' : '';
      const content = renderMarkdown(source);
      return { contentFormat: 'markdown', markdownSource: source, content, markdownHtml: content };
    },
    /** Trusted built-in extensions only; this is not an Obsidian plugin loader. */
    registerExtension(id, extension) {
      if (extensions.has(id)) throw Error('编辑扩展已注册：' + id);
      const compartment = new Compartment();
      extensions.set(id, { compartment, extension });
      if (view) view.dispatch({ effects: StateEffect.appendConfig.of(compartment.of(extension)) });
      return () => {
        if (view) view.dispatch({ effects: compartment.reconfigure([]) });
        extensions.delete(id);
      };
    },
    dispose() {
      view?.destroy();
      bar.remove();
      extensions.clear();
    },
  };
}
