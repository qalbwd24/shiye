import { createRichEditor } from '../editor/rich-document-editor.js';
import { richAssetFromBlob } from '../shared/rich-document-archive.js';
import { installImageViewport } from '../shared/image-viewport.js';
import { chord, notesWorkspaceCommands } from '../shared/hotkeys.js';
import { createNotesBackground } from './notes-background.js';
import { installNotesMarkdownPreview } from '../editor/notes-markdown-preview.js';
import { installNotesStructure } from '../editor/notes-structure.js';
import { installNotesSmartIndent } from '../editor/notes-smart-indent.js';
import { captureNotesAssets, createNotesAssetPersistence } from './notes-asset-persistence.js';
import {
  openNotesPreviewStore,
  readNotesPreview,
  saveNotesPreview,
} from './notes-preview-store.js';

const $ = (selector) => document.querySelector(selector);
const workspaceKey = new URL(location.href).searchParams.get('workspace') || 'main';
const editors = new Map();
const assets = new Map();
const assetPersistence = createNotesAssetPersistence();
const assetUrls = new Map();
const pendingImages = new Map();
const native = window.chrome?.webview;
let db;
let workspace;
let persistedRevision = 0;
let generation = 0;
let savedGeneration = -1;
let saveTimer;
let saveChain = Promise.resolve();
let composing = false;
let initialized = false;
let storageReadable = false;
let suppressChanges = false;
let topMost = false;
let dragging;
let layoutTarget;
let backgroundPending = false;
let outlineActiveId;
let outlineScrollFrame;

const background = createNotesBackground({
  getWorkspace: () => workspace,
  registerAsset,
  resolveAsset: (id) => assetUrls.get(id) || '',
  onChange: () => touch(true),
  onError: report,
  onPending: (pending) => {
    backgroundPending = pending;
    if (!pending && initialized) touch();
  },
});

const activeNote = () => workspace.notes.find((note) => note.id === workspace.activeId);
const activeEditor = () => editors.get(workspace.activeId)?.writer.editor;
const displayTitle = (note) => note.title.trim() || '未命名便签';
const postNative = (message) => native?.postMessage(message);

function status(message, error = false) {
  $('#save-status').textContent = message;
  $('#save-status').dataset.error = String(error);
  $('#save-status').dataset.phase = error
    ? 'error'
    : message.includes('已保存')
      ? 'saved'
      : 'saving';
  $('#save-status').title = message;
}

function report(error) {
  const message = error.message || '操作未完成，当前内容仍保留。';
  $('#error-message').textContent = message;
  $('#error-banner').hidden = false;
  status('未保存 · 输入已保留', true);
}

function blankNote() {
  return {
    id: crypto.randomUUID(),
    title: '',
    body: null,
    updatedAt: null,
    scroll: 0,
    selection: null,
  };
}

function initialWorkspace() {
  const note = blankNote();
  return {
    notes: [note],
    openIds: [note.id],
    activeId: note.id,
    closedIds: [],
    theme: 'dark',
    frameMaterial: 'wallpaper',
    fontSize: 17,
    zoom: 100,
    outlineMode: 'indentation',
    outlinePinned: true,
    outlineSide: 'right',
    outlineWidth: 220,
    smartIndent: true,
  };
}

function registerAsset(asset) {
  assets.set(asset.id, asset);
  if (!assetUrls.has(asset.id)) assetUrls.set(asset.id, URL.createObjectURL(asset.blob));
}

function rememberPosition() {
  const note = activeNote();
  const editor = activeEditor();
  if (!note || !editor) return;
  note.scroll = $('#editor-scroll').scrollTop;
  note.selection = { from: editor.state.selection.from, to: editor.state.selection.to };
}

function touch(contentChanged = false) {
  if (!initialized || suppressChanges) return;
  generation++;
  if (contentChanged) status('正在保存…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    // Composition and pending file work schedule a new save when they finish.
    if (!composing && !pendingImages.size && !backgroundPending) flush().catch(report);
  }, 350);
}

async function flush() {
  clearTimeout(saveTimer);
  if (composing) throw new Error('请先完成当前中文输入，再保存关闭。');
  if (pendingImages.size) throw new Error('图片仍在插入，请稍后保存关闭。');
  if (backgroundPending) throw new Error('背景仍在载入，请稍后保存关闭。');
  if (!initialized || savedGeneration === generation) return saveChain;
  if (!db || !storageReadable) throw new Error('本机草稿区不可用，请先导出当前草稿。');
  rememberPosition();
  const atGeneration = generation;
  const snapshot = structuredClone(workspace);
  const blobs = captureNotesAssets(snapshot, assets);
  saveChain = saveChain
    .catch(() => {})
    .then(async () => {
      persistedRevision = await assetPersistence.save(blobs, (pending) =>
        saveNotesPreview(db, workspaceKey, snapshot, pending, persistedRevision),
      );
      savedGeneration = Math.max(savedGeneration, atGeneration);
      if (generation === atGeneration) {
        status('已保存');
        $('#error-banner').hidden = true;
      }
    });
  return saveChain;
}

function updateStats() {
  const editor = activeEditor();
  if (!editor) return;
  const text = editor.getText({ blockSeparator: '\n' });
  const count = Array.from(text.replace(/\s/g, '')).length;
  const selection = editor.state.selection;
  const selected = selection.empty
    ? 0
    : Array.from(
        editor.state.doc.textBetween(selection.from, selection.to, '\n').replace(/\s/g, ''),
      ).length;
  $('#word-count').textContent = selected ? `${count} 字 · 已选 ${selected} 字` : `${count} 字`;
  let total = 0;
  let done = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'taskItem') {
      total++;
      if (node.attrs.checked) done++;
    }
  });
  $('#task-count').textContent = total ? `${done} / ${total} 项完成` : '';
  $('#task-count').hidden = !total;
  $('[data-action="undo"]').disabled = !editor.can().undo();
  $('[data-action="redo"]').disabled = !editor.can().redo();
  for (const button of document.querySelectorAll('[data-action]')) {
    if (['taskList', 'bulletList', 'orderedList', 'bold', 'italic'].includes(button.dataset.action))
      button.setAttribute('aria-pressed', String(editor.isActive(button.dataset.action)));
  }
}

function changed(noteId) {
  if (suppressChanges) return;
  const note = workspace.notes.find((item) => item.id === noteId);
  const mounted = editors.get(noteId);
  if (!note || !mounted) return;
  note.body = mounted.writer.getBody();
  updatePlaceholder(mounted);
  note.updatedAt = new Date().toISOString();
  if (noteId === workspace.activeId) updateStats();
  touch(true);
}

function updatePlaceholder(mounted) {
  const doc = mounted.writer.editor.state.doc;
  mounted.element.dataset.empty = String(
    doc.childCount === 1 &&
      doc.firstChild.type.name === 'paragraph' &&
      doc.firstChild.content.size === 0,
  );
}

function chevron() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', 'M6 3.5 10.5 8 6 12.5');
  svg.append(path);
  return svg;
}

function renderOutline(viewportPos) {
  if (!workspace || !$('#outline-items') || !workspace.outlineOpen) return;
  const mounted = editors.get(workspace.activeId);
  if (!mounted?.structure) return;
  const entries = mounted.structure.getEntries({
    includeIndented: workspace.outlineMode !== 'headings',
  });
  const container = $('#outline-items');
  const existing = new Map(
    [...container.querySelectorAll('.outline-row')].map((row) => [row.dataset.structureId, row]),
  );
  const rows = [];
  const depths = new Map();
  const selectionPos =
    typeof viewportPos === 'number' ? viewportPos : mounted.writer.editor.state.selection.from;
  const currentId = entries.findLast((entry) => entry.pos <= selectionPos)?.id;
  for (const entry of entries) {
    const depth = entry.parentId ? (depths.get(entry.parentId) || 0) + 1 : 0;
    depths.set(entry.id, depth);
    const row = existing.get(entry.id) || document.createElement('div');
    row.className = 'outline-row';
    row.style.setProperty('--outline-depth', String(depth));
    row.dataset.structureId = entry.id;
    if (entry.foldTo > entry.foldFrom) {
      row.querySelector('.outline-fold-spacer')?.remove();
      let fold = row.querySelector('.outline-fold');
      if (!fold) {
        fold = document.createElement('button');
        fold.append(chevron());
        row.prepend(fold);
      }
      fold.className = 'outline-fold';
      fold.type = 'button';
      const collapsed = activeNote().foldedIds?.includes(entry.id);
      fold.dataset.folded = String(!!collapsed);
      fold.setAttribute('aria-label', `${collapsed ? '展开' : '折叠'}：${entry.label}`);
      fold.setAttribute('aria-expanded', String(!collapsed));
      fold.onclick = () => mounted.structure.toggle(entry.id);
    } else {
      row.querySelector('.outline-fold')?.remove();
      const spacer = row.querySelector('.outline-fold-spacer') || document.createElement('span');
      spacer.className = 'outline-fold-spacer';
      spacer.setAttribute('aria-hidden', 'true');
      row.prepend(spacer);
    }
    const button = row.querySelector('.outline-item') || document.createElement('button');
    button.type = 'button';
    button.className = 'outline-item';
    const label = entry.label || '未命名段落';
    if (button.textContent !== label) button.textContent = label;
    button.title = button.textContent;
    button.dataset.level = String(entry.level);
    button.setAttribute('aria-current', String(entry.id === currentId));
    button.onclick = () => {
      mounted.structure.reveal(entry.pos);
      const current = mounted.structure
        .getEntries({ includeIndented: true })
        .find((item) => item.id === entry.id);
      if (!current) return;
      mounted.writer.editor.commands.setTextSelection(current.anchorPos);
      mounted.writer.editor.commands.focus(undefined, { scrollIntoView: false });
      const dom = mounted.writer.editor.view.nodeDOM(current.pos);
      dom?.scrollIntoView?.({
        block: 'center',
        behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      });
    };
    row.append(button);
    rows.push(row);
  }
  for (const child of [...container.children]) if (!rows.includes(child)) child.remove();
  rows.forEach((row, index) => {
    if (container.children[index] !== row)
      container.insertBefore(row, container.children[index] || null);
  });
  if (outlineActiveId !== currentId) {
    outlineActiveId = currentId;
    const activeRow = rows.find((row) => row.dataset.structureId === currentId);
    if (activeRow) {
      const box = activeRow.getBoundingClientRect();
      const bounds = container.getBoundingClientRect();
      if (box.top < bounds.top) container.scrollTop -= bounds.top - box.top;
      else if (box.bottom > bounds.bottom) container.scrollTop += box.bottom - bounds.bottom;
    }
  }
  if (!entries.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-list';
    empty.textContent =
      workspace.outlineMode === 'indentation' ? '还没有标题或缩进层级' : '还没有正文标题';
    container.append(empty);
  }
}

function applyOutline() {
  const open = !!workspace.outlineOpen;
  const side = workspace.outlineSide === 'left' ? 'left' : 'right';
  document.body.dataset.outlineSide = side;
  document.body.classList.toggle('outline-open', open);
  document.body.classList.toggle('outline-pinned', workspace.outlinePinned !== false);
  document.documentElement.style.setProperty(
    '--outline-width',
    `${Math.min(360, Math.max(180, workspace.outlineWidth || 220))}px`,
  );
  $('#notes-outline').hidden = !open;
  $('#outline-toggle').setAttribute('aria-expanded', String(open));
  $('#outline-mode').value = workspace.outlineMode || 'indentation';
  $('#outline-pin').setAttribute('aria-pressed', String(workspace.outlinePinned !== false));
  $('#outline-pin').title = workspace.outlinePinned !== false ? '取消常驻目录' : '常驻目录';
  $('#outline-pin').setAttribute('aria-label', $('#outline-pin').title);
  $('#outline-side').title = side === 'right' ? '目录移到左侧' : '目录移到右侧';
  $('#outline-side').setAttribute('aria-label', $('#outline-side').title);
  $('#outline-resizer').setAttribute('aria-valuenow', String(workspace.outlineWidth || 220));
  renderOutline();
}

function mountNote(note) {
  if (editors.has(note.id)) return editors.get(note.id);
  const element = document.createElement('section');
  element.className = 'note-editor';
  element.dataset.noteId = note.id;
  element.hidden = true;
  $('#editors').append(element);
  const writer = createRichEditor(element, {
    body: note.body || undefined,
    resolveAsset: (id) => assetUrls.get(id) || '',
    onImage: showImage,
    onMediaEdit: () => openImageLayout(note.id),
    onUpdate: () => changed(note.id),
    enableInputRules: ['orderedList', 'bulletList', 'taskItem'],
    enablePasteRules: false,
  });
  installNotesMarkdownPreview(writer.editor);
  const smartIndent = installNotesSmartIndent(writer.editor, {
    isEnabled: () => workspace.smartIndent !== false,
  });
  writer.editor.view.dom.setAttribute('aria-label', '便签内容');
  writer.editor.view.dom.setAttribute(
    'data-placeholder',
    '写下待办、想法，或任何需要留在这里的事…',
  );
  writer.editor.on('selectionUpdate', () => {
    if (workspace.activeId !== note.id) return;
    updateStats();
    touch();
  });
  const mounted = { element, writer, smartIndent };
  editors.set(note.id, mounted);
  mounted.structure = installNotesStructure(writer.editor, {
    getFoldedIds: () => note.foldedIds || [],
    onFoldChange: (ids) => {
      note.foldedIds = ids;
      renderOutline();
      touch();
    },
    onStructureChange: () => {
      if (workspace.activeId === note.id) renderOutline();
    },
  });
  updatePlaceholder(mounted);
  note.body = writer.getBody();
  return mounted;
}

function renderTabs() {
  $('#tabs').replaceChildren();
  for (const id of workspace.openIds) {
    const note = workspace.notes.find((item) => item.id === id);
    const tab = document.createElement('div');
    tab.className = 'note-tab';
    tab.dataset.noteId = id;
    tab.draggable = true;
    const select = document.createElement('button');
    select.type = 'button';
    select.className = 'tab-select';
    select.id = 'tab-' + id;
    select.setAttribute('role', 'tab');
    select.setAttribute('aria-selected', String(id === workspace.activeId));
    select.setAttribute('aria-controls', 'panel-' + id);
    select.tabIndex = id === workspace.activeId ? 0 : -1;
    select.textContent = displayTitle(note);
    select.title = displayTitle(note);
    select.onclick = () => switchNote(id);
    select.ondblclick = focusTitle;
    const close = document.createElement('button');
    close.className = 'tab-close';
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', '关闭标签：' + displayTitle(note));
    close.title = '关闭标签，便签仍保留';
    close.onclick = () => closeNote(id);
    tab.append(select, close);
    tab.ondragstart = (event) => {
      dragging = id;
      event.dataTransfer.setData('text/plain', id);
      event.dataTransfer.effectAllowed = 'move';
      tab.classList.add('dragging');
    };
    tab.ondragend = () => {
      dragging = null;
      tab.classList.remove('dragging');
    };
    tab.ondragover = (event) => {
      if (dragging) event.preventDefault();
    };
    tab.ondrop = (event) => {
      if (!dragging || dragging === id) return;
      event.preventDefault();
      const source = workspace.openIds.indexOf(dragging);
      const target = workspace.openIds.indexOf(id);
      workspace.openIds.splice(source, 1);
      workspace.openIds.splice(target, 0, dragging);
      renderTabs();
      touch();
    };
    $('#tabs').append(tab);
  }
}

function focusTitle() {
  $('#note-title').focus();
  $('#note-title').select();
}

function switchNote(id, focus = true) {
  if (composing || !workspace.notes.some((note) => note.id === id)) return;
  rememberPosition();
  workspace.activeId = id;
  const note = activeNote();
  const mounted = mountNote(note);
  $('#note-title').value = note.title;
  document.title = `${displayTitle(note)} · 拾页 · 便签`;
  for (const [otherId, item] of editors) {
    item.element.hidden = otherId !== id;
    item.element.id = 'panel-' + otherId;
    item.element.setAttribute('role', 'tabpanel');
    item.element.setAttribute('aria-labelledby', 'tab-' + otherId);
  }
  renderTabs();
  if (note.selection) {
    const max = mounted.writer.editor.state.doc.content.size;
    mounted.writer.editor.commands.setTextSelection({
      from: Math.min(note.selection.from, max),
      to: Math.min(note.selection.to, max),
    });
  }
  if (focus) mounted.writer.editor.commands.focus(undefined, { scrollIntoView: false });
  $('#editor-scroll').scrollTop = note.scroll || 0;
  $('#tabs .tab-select[aria-selected="true"]')?.scrollIntoView({
    block: 'nearest',
    inline: 'nearest',
  });
  updateStats();
  renderOutline();
  touch();
}

function addNote() {
  if (composing) return;
  const note = blankNote();
  workspace.notes.push(note);
  workspace.openIds.push(note.id);
  switchNote(note.id, false);
  focusTitle();
  touch(true);
}

function closeNote(id) {
  if (composing) return;
  if (pendingImages.has(id)) return report(new Error('这张便签仍在插入图片，请完成后再关闭标签。'));
  rememberPosition();
  const index = workspace.openIds.indexOf(id);
  workspace.openIds.splice(index, 1);
  workspace.closedIds = [...workspace.closedIds.filter((item) => item !== id), id];
  if (workspace.activeId === id) {
    workspace.activeId = null;
    if (!workspace.openIds.length) addNote();
    else switchNote(workspace.openIds[Math.min(index, workspace.openIds.length - 1)]);
  } else renderTabs();
  const mounted = editors.get(id);
  mounted?.structure.destroy();
  mounted?.smartIndent.destroy();
  mounted?.writer.destroy();
  mounted?.element.remove();
  editors.delete(id);
  touch();
}

function reopenNote(id) {
  if (!id || composing) return;
  if (!workspace.openIds.includes(id)) workspace.openIds.push(id);
  workspace.closedIds = workspace.closedIds.filter((item) => item !== id);
  switchNote(id);
  $('#notes-dialog').close();
}

function showNotes() {
  const query = $('#notes-search').value.trim().toLocaleLowerCase();
  $('#notes-items').replaceChildren();
  for (const note of workspace.notes) {
    if (!displayTitle(note).toLocaleLowerCase().includes(query)) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'saved-note';
    const name = document.createElement('strong');
    name.textContent = displayTitle(note);
    const state = document.createElement('small');
    state.textContent = workspace.openIds.includes(note.id) ? '已打开' : '重新打开';
    button.append(name, state);
    button.onclick = () => reopenNote(note.id);
    $('#notes-items').append(button);
  }
  if (!$('#notes-items').childElementCount) {
    const empty = document.createElement('p');
    empty.className = 'empty-list';
    empty.textContent = '没有找到这张便签';
    $('#notes-items').append(empty);
  }
}

function applyAppearance() {
  const dark =
    workspace.theme === 'system'
      ? matchMedia('(prefers-color-scheme: dark)').matches
      : workspace.theme !== 'light';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.body.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.style.setProperty('--editor-font-size', `${workspace.fontSize}px`);
  document.documentElement.style.setProperty('--editor-zoom', String(workspace.zoom / 100));
  $('#zoom-reset').textContent = workspace.zoom + '%';
  $('#theme').value = workspace.theme;
  const material = workspace.frameMaterial === 'gray' ? 'gray' : 'wallpaper';
  workspace.frameMaterial = material;
  $('#frame-material').value = material;
  $('#font-size').value = String(workspace.fontSize);
  $('#notes-shortcuts-enabled').checked = !!workspace.shortcutsEnabled;
  $('#notes-smart-indent').checked = workspace.smartIndent !== false;
  $('#theme-toggle').title = dark ? '切换到浅色' : '切换到深色';
  background.apply();
  postNative({ type: 'notes-window-appearance', dark, material });
}

function zoomBy(step) {
  workspace.zoom = Math.min(200, Math.max(60, step === 0 ? 100 : workspace.zoom + step * 4));
  applyAppearance();
  touch();
}

async function insertImages(files) {
  if (!files.length) return;
  const id = workspace.activeId;
  const mounted = editors.get(id);
  const editor = mounted.writer.editor;
  pendingImages.set(id, (pendingImages.get(id) || 0) + 1);
  let bookmark = editor.state.selection.getBookmark();
  const mapBookmark = ({ transaction }) => {
    bookmark = bookmark.map(transaction.mapping);
  };
  editor.on('transaction', mapBookmark);
  try {
    for (const file of files) {
      const asset = await richAssetFromBlob(file, file.name || '粘贴图片');
      registerAsset(asset);
      const chain = editor.chain().command(({ tr }) => {
        tr.setSelection(bookmark.resolve(tr.doc));
        return true;
      });
      if (workspace.activeId === id) chain.focus();
      chain
        .insertContent([
          {
            type: 'image',
            attrs: {
              assetId: asset.id,
              occurrenceId: crypto.randomUUID(),
              insertedAt: new Date().toISOString(),
              widthRatio: 0.75,
              align: 'center',
              caption: '',
              alt: file.name || '',
            },
          },
          { type: 'paragraph' },
        ])
        .run();
    }
  } finally {
    editor.off('transaction', mapBookmark);
    const left = pendingImages.get(id) - 1;
    if (left) pendingImages.set(id, left);
    else pendingImages.delete(id);
    touch(true);
  }
}

function showImage(id) {
  const url = assetUrls.get(id);
  if (!url) return report(new Error('找不到这张图片的本机原件。'));
  $('#image-preview').src = url;
  $('#image-dialog').showModal();
}

function openImageLayout(id) {
  const editor = editors.get(id)?.writer.editor;
  if (!editor?.isActive('image')) return;
  layoutTarget = {
    id,
    position: editor.state.selection.from,
    occurrenceId: editor.getAttributes('image').occurrenceId,
  };
  const image = editor.getAttributes('image');
  $('#image-width').value = Math.round(image.widthRatio * 100);
  $('#image-align').value = image.align;
  $('#image-caption').value = image.caption || '';
  $('#image-alt').value = image.alt || '';
  $('#image-layout-dialog').showModal();
}

function applyImageLayout() {
  const editor = editors.get(layoutTarget?.id)?.writer.editor;
  const node = editor?.state.doc.nodeAt(layoutTarget.position);
  if (!node || node.type.name !== 'image' || node.attrs.occurrenceId !== layoutTarget.occurrenceId)
    return report(new Error('图片位置已变化，请重新选择图片。'));
  editor
    .chain()
    .setNodeSelection(layoutTarget.position)
    .updateAttributes('image', {
      widthRatio: Math.min(100, Math.max(10, Number($('#image-width').value))) / 100,
      align: $('#image-align').value,
      caption: $('#image-caption').value,
      alt: $('#image-alt').value,
    })
    .run();
  $('#image-layout-dialog').close();
}

async function exportDrafts() {
  rememberPosition();
  const snapshot = structuredClone(workspace);
  const binary = [];
  for (const asset of assets.values()) {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(asset.blob);
    });
    binary.push({ id: asset.id, name: asset.name, type: asset.type, dataUrl });
  }
  const blob = new Blob(
    [
      JSON.stringify(
        {
          kind: 'shiye-notes-ui-snapshot',
          experimental: true,
          exportedAt: new Date().toISOString(),
          workspace: snapshot,
          assets: binary,
        },
        null,
        2,
      ),
    ],
    { type: 'application/json' },
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = '拾页便签-界面草稿.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

function toolbarAction(action) {
  if (composing) return;
  if (action === 'image') return $('#image-file').click();
  const chain = activeEditor().chain().focus();
  if (['bold', 'italic', 'taskList', 'bulletList', 'orderedList'].includes(action))
    chain[`toggle${action[0].toUpperCase()}${action.slice(1)}`]().run();
  else if (action === 'horizontalRule') chain.setHorizontalRule().run();
  else if (action === 'undo' || action === 'redo') chain[action]().run();
  updateStats();
  setFormatOpen(false);
}

function setFormatOpen(open) {
  $('.editor-toolbar').hidden = !open;
  $('#format-toggle').setAttribute('aria-expanded', String(open));
}

function indentBody(event) {
  const editor = activeEditor();
  if (!event.target.closest('.tiptap') || !editor) return false;
  if (['table', 'codeBlock'].some((type) => editor.isActive(type))) return false;
  // List ownership is structural; do not replace it with visual spaces or move focus.
  let itemType;
  for (let depth = editor.state.selection.$from.depth; depth > 0; depth--) {
    const type = editor.state.selection.$from.node(depth).type.name;
    if (type === 'taskItem' || type === 'listItem') {
      itemType = type;
      break;
    }
  }
  if (itemType) {
    const command = event.shiftKey ? 'liftListItem' : 'sinkListItem';
    editor.chain().focus()[command](itemType).run();
    return true;
  }
  if (workspace.smartIndent !== false) return false;
  const { state } = editor;
  const { from, to, empty } = state.selection;
  const tr = state.tr;
  if (empty && !event.shiftKey) tr.insertText('　　');
  else {
    const starts = [];
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.isTextblock && node.type.name !== 'codeBlock')
        starts.push({ pos: pos + 1, text: node.textContent });
    });
    if (!starts.length && empty)
      starts.push({
        pos: state.selection.$from.start(),
        text: state.selection.$from.parent.textContent,
      });
    for (const item of starts.reverse()) {
      if (!event.shiftKey) tr.insertText('　　', item.pos);
      else {
        const prefix = /^(?:　{1,2}| {1,4})/.exec(item.text)?.[0];
        if (prefix) tr.delete(item.pos, item.pos + prefix.length);
      }
    }
  }
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

function keyboard(event) {
  if (event.isComposing || event.keyCode === 229 || composing || !initialized) return;
  if (document.querySelector('dialog[open]')) return;
  if (event.key === 'Escape' && !$('.editor-toolbar').hidden) {
    setFormatOpen(false);
    event.preventDefault();
    return;
  }
  const ctrl = event.ctrlKey || event.metaKey;
  const binding = chord(event);
  let command = notesWorkspaceCommands.find((item) =>
    [item.default, ...(item.aliases || [])].includes(binding),
  )?.id;
  if (
    !workspace.shortcutsEnabled &&
    command !== 'save-notes' &&
    !command?.startsWith('notes-zoom-')
  )
    command = undefined;
  let handled = true;
  if (command === 'save-notes') flush().catch(report);
  else if (command === 'reopen-note') reopenNote(workspace.closedIds.at(-1));
  else if (command === 'new-note') addNote();
  else if (command === 'close-note') closeNote(workspace.activeId);
  else if (['next-note', 'previous-note'].includes(command)) {
    const length = workspace.openIds.length;
    const index = workspace.openIds.indexOf(workspace.activeId);
    switchNote(
      workspace.openIds[(index + (command === 'previous-note' ? length - 1 : 1)) % length],
    );
  } else if (
    workspace.shortcutsEnabled &&
    ctrl &&
    !event.altKey &&
    !event.shiftKey &&
    /^[1-9]$/.test(event.key)
  ) {
    const id =
      workspace.openIds[event.key === '9' ? workspace.openIds.length - 1 : Number(event.key) - 1];
    if (id) switchNote(id);
  } else if (command?.startsWith('notes-zoom-'))
    zoomBy(command.endsWith('reset') ? 0 : command.endsWith('out') ? -1 : 1);
  else if (command === 'rename-note') focusTitle();
  else if (!ctrl && !event.altKey && event.key === 'Tab') handled = indentBody(event);
  else if (
    !ctrl &&
    !event.altKey &&
    !event.shiftKey &&
    event.target === $('#note-title') &&
    ['Enter', 'ArrowDown'].includes(event.key)
  )
    activeEditor().commands.focus('start');
  else if (
    event.key === 'ArrowUp' &&
    !ctrl &&
    !event.altKey &&
    !event.shiftKey &&
    event.target.closest('.tiptap') &&
    activeEditor().state.selection.empty &&
    activeEditor().state.selection.from === 1
  )
    focusTitle();
  else handled = false;
  if (handled) {
    event.preventDefault();
    event.stopPropagation();
  }
}

function bindUI() {
  background.bind();
  $('#format-toggle').onmousedown = (event) => event.preventDefault();
  $('#format-toggle').onclick = () => setFormatOpen($('.editor-toolbar').hidden);
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.editor-toolbar, #format-toggle')) setFormatOpen(false);
  });
  $('#add-note').onclick = addNote;
  $('#note-title').oninput = () => {
    const note = activeNote();
    note.title = $('#note-title').value;
    note.updatedAt = new Date().toISOString();
    const tab = document.getElementById('tab-' + note.id);
    tab.textContent = tab.title = displayTitle(note);
    document.title = `${displayTitle(note)} · 拾页 · 便签`;
    updateStats();
    touch(true);
  };
  $('#notes-list').onclick = () => {
    $('#notes-search').value = '';
    showNotes();
    $('#notes-dialog').showModal();
    $('#notes-search').focus();
  };
  $('#notes-search').oninput = showNotes;
  $('#notes-close').onclick = () => $('#notes-dialog').close();
  $('#settings').onclick = () => {
    $('#settings-error').hidden = true;
    $('#settings-dialog').showModal();
  };
  const closeSettings = async () => {
    try {
      await flush();
      $('#settings-dialog').close();
    } catch (error) {
      $('#settings-error').textContent = error.message || '设置尚未保存，请重试。';
      $('#settings-error').hidden = false;
      report(error);
    }
  };
  $('#settings-close').onclick = closeSettings;
  $('#settings-dismiss').onclick = closeSettings;
  $('#settings-save').onclick = closeSettings;
  $('#settings-dialog').addEventListener('cancel', (event) => {
    event.preventDefault();
    closeSettings();
  });
  $('#notes-shortcuts-enabled').onchange = () => {
    workspace.shortcutsEnabled = $('#notes-shortcuts-enabled').checked;
    touch();
  };
  $('#notes-smart-indent').onchange = () => {
    workspace.smartIndent = $('#notes-smart-indent').checked;
    touch();
  };
  $('#outline-pin').onclick = () => {
    workspace.outlinePinned = workspace.outlinePinned === false;
    applyOutline();
    touch();
  };
  $('#outline-side').onclick = () => {
    workspace.outlineSide = workspace.outlineSide === 'left' ? 'right' : 'left';
    applyOutline();
    touch();
  };
  const resizer = $('#outline-resizer');
  resizer.onpointerdown = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    resizer.setPointerCapture(event.pointerId);
    document.body.classList.add('outline-resizing');
  };
  resizer.onpointermove = (event) => {
    if (!resizer.hasPointerCapture(event.pointerId)) return;
    const max = Math.min(360, innerWidth * (innerWidth <= 700 ? 0.8 : 0.38));
    const width = workspace.outlineSide === 'left' ? event.clientX : innerWidth - event.clientX;
    workspace.outlineWidth = Math.round(Math.min(max, Math.max(180, width)));
    document.documentElement.style.setProperty('--outline-width', `${workspace.outlineWidth}px`);
    resizer.setAttribute('aria-valuenow', String(workspace.outlineWidth));
  };
  const finishResize = () => {
    document.body.classList.remove('outline-resizing');
    touch();
  };
  resizer.onpointerup = (event) => {
    if (resizer.hasPointerCapture(event.pointerId)) resizer.releasePointerCapture(event.pointerId);
    finishResize();
  };
  resizer.onlostpointercapture = finishResize;
  resizer.onpointercancel = finishResize;
  resizer.onkeydown = (event) => {
    if (
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      !['ArrowLeft', 'ArrowRight'].includes(event.key)
    )
      return;
    event.preventDefault();
    const max = Math.min(360, innerWidth * (innerWidth <= 700 ? 0.8 : 0.38));
    workspace.outlineWidth = Math.round(
      Math.min(
        max,
        Math.max(
          180,
          $('#notes-outline').getBoundingClientRect().width +
            ((event.key === 'ArrowRight') === (workspace.outlineSide === 'left') ? 8 : -8),
        ),
      ),
    );
    applyOutline();
    touch();
  };
  $('#outline-toggle').onclick = () => {
    workspace.outlineOpen = !workspace.outlineOpen;
    applyOutline();
    touch();
  };
  $('#outline-close').onclick = () => {
    workspace.outlineOpen = false;
    applyOutline();
    touch();
  };
  $('#outline-mode').onchange = () => {
    workspace.outlineMode = $('#outline-mode').value;
    renderOutline();
    touch();
  };
  $('#theme').onchange = () => {
    workspace.theme = $('#theme').value;
    applyAppearance();
    touch();
  };
  $('#font-size').onchange = () => {
    workspace.fontSize = Number($('#font-size').value);
    applyAppearance();
    touch();
  };
  $('#frame-material').onchange = () => {
    workspace.frameMaterial = $('#frame-material').value === 'gray' ? 'gray' : 'wallpaper';
    applyAppearance();
    touch();
  };
  $('#theme-toggle').onclick = () => {
    workspace.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyAppearance();
    touch();
  };
  $('#zoom-out').onclick = () => zoomBy(-1);
  $('#zoom-reset').onclick = () => zoomBy(0);
  $('#zoom-in').onclick = () => zoomBy(1);
  $('#pin-window').onclick = () => postNative({ type: 'notes-pin', value: !topMost });
  $('#retry-save').onclick = () => flush().catch(report);
  $('#rescue-export').onclick = $('#export-drafts').onclick = () => exportDrafts().catch(report);
  $('#image-close').onclick = () => $('#image-dialog').close();
  $('#image-layout-close').onclick = () => $('#image-layout-dialog').close();
  $('#image-apply').onclick = applyImageLayout;
  installImageViewport($('#image-dialog'));
  for (const button of document.querySelectorAll('[data-action]')) {
    button.onmousedown = (event) => event.preventDefault();
    button.onclick = () => toolbarAction(button.dataset.action);
  }
  $('#image-file').onchange = (event) => {
    const files = [...event.target.files];
    event.target.value = '';
    insertImages(files).catch(report);
  };
  $('#editors').addEventListener(
    'paste',
    (event) => {
      const files = [...event.clipboardData.files].filter((file) => file.type.startsWith('image/'));
      if (files.length) {
        event.preventDefault();
        insertImages(files).catch(report);
      }
    },
    true,
  );
  $('#editors').addEventListener('dragover', (event) => {
    if ([...event.dataTransfer.types].includes('Files')) event.preventDefault();
  });
  $('#editors').addEventListener(
    'drop',
    (event) => {
      const files = [...event.dataTransfer.files];
      if (!files.length) return;
      event.preventDefault();
      const images = files.filter((file) => file.type.startsWith('image/'));
      if (images.length !== files.length)
        report(new Error('这一版仅支持插入图片；其他文件请保留原件。'));
      if (images.length) insertImages(images).catch(report);
    },
    true,
  );
  document.addEventListener('compositionstart', () => {
    composing = true;
  });
  document.addEventListener('compositionend', () => {
    composing = false;
    touch(true);
  });
  document.addEventListener('keydown', keyboard, true);
  $('#editor-scroll').addEventListener(
    'scroll',
    () => {
      touch();
      if (outlineScrollFrame || !workspace.outlineOpen) return;
      outlineScrollFrame = requestAnimationFrame(() => {
        outlineScrollFrame = null;
        const editor = activeEditor();
        const viewport = $('#editor-scroll').getBoundingClientRect();
        const writing = $('.writing-surface').getBoundingClientRect();
        const point = editor.view.posAtCoords({
          left: Math.max(writing.left + 60, viewport.left + 36),
          top: viewport.top + 40,
        });
        if (point) renderOutline(point.pos);
      });
    },
    { passive: true },
  );
  window.addEventListener(
    'wheel',
    (event) => {
      if (!event.ctrlKey || document.querySelector('dialog[open]')) return;
      event.preventDefault();
      zoomBy(event.deltaY < 0 ? 1 : -1);
    },
    { passive: false },
  );
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyAppearance);
  window.addEventListener('beforeunload', (event) => {
    if (composing || pendingImages.size || backgroundPending || savedGeneration !== generation) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !composing) flush().catch(report);
  });
  native?.addEventListener('message', async ({ data }) => {
    if (data.type === 'notes-native-state') {
      topMost = !!data.topMost;
      $('#pin-window').hidden = !!data.nativeFrame;
      $('#pin-window').setAttribute('aria-pressed', String(topMost));
      if (data.windowPreferencesError) {
        $('#save-status').title =
          '正文保存状态见下方；窗口位置偏好暂未保存，请检查本机草稿目录是否可写。';
      }
    } else if (data.type === 'notes-request-close') {
      try {
        await flush();
        postNative({ type: 'notes-close-ready' });
      } catch (error) {
        report(error);
        postNative({ type: 'notes-close-failed' });
      }
    }
  });
}

async function start() {
  workspace = initialWorkspace();
  let startupError;
  try {
    db = await openNotesPreviewStore();
    const stored = await readNotesPreview(db, workspaceKey);
    if (stored.workspace) {
      if (
        !Array.isArray(stored.workspace.notes) ||
        !stored.workspace.notes.length ||
        !Array.isArray(stored.workspace.openIds)
      )
        throw new Error('已有试用草稿结构无法读取，未覆盖它。');
      workspace = stored.workspace;
      workspace.outlineMode ||= 'indentation';
      persistedRevision = workspace.revision || 0;
      workspace.closedIds ||= [];
      workspace.openIds = workspace.openIds.filter((id) =>
        workspace.notes.some((note) => note.id === id),
      );
      if (!workspace.openIds.length) workspace.openIds.push(workspace.notes[0].id);
      if (!workspace.openIds.includes(workspace.activeId))
        workspace.activeId = workspace.openIds[0];
    }
    stored.assets.forEach(registerAsset);
    assetPersistence.markPersisted(stored.assets);
    storageReadable = true;
  } catch (error) {
    startupError = error;
  }
  suppressChanges = true;
  bindUI();
  applyAppearance();
  switchNote(workspace.activeId, false);
  applyOutline();
  suppressChanges = false;
  initialized = true;
  if (startupError) report(startupError);
  else {
    status('已保存');
    if (persistedRevision) savedGeneration = generation;
    else {
      touch();
      await flush();
    }
  }
  if (!activeNote().title && !activeEditor().getText().trim()) focusTitle();
  postNative({ type: 'notes-ready' });
}

start().catch(report);
