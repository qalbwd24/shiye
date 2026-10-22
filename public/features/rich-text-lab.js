import { createRichEditor } from '../editor/rich-document-editor.js';
import { richMediaReferences } from '../shared/rich-document.js';
import {
  richAssetFromBlob,
  encodeRichArchive,
  decodeRichArchive,
} from '../shared/rich-document-archive.js';
import { openLabStore, readLabDraft, saveLabDraft } from './rich-text-lab-store.js';
import { sanitize } from '../editor/content.js';
import { installImageViewport } from '../shared/image-viewport.js';

const $ = (selector) => document.querySelector(selector);
const assets = new Map();
const urls = new Map();
let writer,
  reader,
  db,
  timer,
  chain = Promise.resolve(),
  dirty = false,
  revision = 0,
  persistedRevision = 0,
  importing = false,
  pendingImages = 0,
  recoveryDraft = null;
let zoom = Number(localStorage.getItem('shiye.rich-lab.text-scale')) || 100;
const status = (text, error = false) => {
  $('#status').textContent = text;
  $('#status').dataset.error = String(error);
};
const resolveAsset = (id) => urls.get(id) || '';
function registerAsset(asset) {
  assets.set(asset.id, asset);
  if (!urls.has(asset.id)) urls.set(asset.id, URL.createObjectURL(asset.blob));
}
const setZoom = (value) => {
  zoom = Math.min(200, Math.max(60, value));
  document.documentElement.style.setProperty('--text-size', `${(17 * zoom) / 100}px`);
  localStorage.setItem('shiye.rich-lab.text-scale', String(zoom));
};
function showImage(id) {
  const url = resolveAsset(id);
  if (!url) return status('图片原件缺失。', true);
  $('#image-dialog img').src = url;
  $('#image-dialog').showModal();
}
installImageViewport($('#image-dialog'));
$('#image-close').onclick = () => $('#image-dialog').close();
function updateSelection() {
  const editor = writer.editor;
  const image = editor.isActive('image');
  $('#image-settings').hidden = !image;
  if (image) {
    const a = editor.getAttributes('image');
    $('#image-width').value = Math.round(a.widthRatio * 100);
    $('#image-align').value = a.align;
    $('#image-caption').value = a.caption || '';
  }
  document.querySelectorAll('[data-action]').forEach((button) => {
    button.setAttribute('aria-pressed', String(editor.isActive(button.dataset.action)));
  });
}
function changed() {
  if (!writer || !reader || importing) return;
  dirty = true;
  revision++;
  status('草稿待保存…');
  reader.setBody(writer.getBody());
  clearTimeout(timer);
  timer = setTimeout(() => save().catch(report), 450);
}
function report(error) {
  status(error.message || '操作失败，当前内容已保留。', true);
}
async function save() {
  if (!writer || !db || importing) return;
  clearTimeout(timer);
  const body = writer.getBody();
  const atRevision = revision;
  const snapshot = { body, savedAt: new Date().toISOString() };
  const imageAssets = richMediaReferences(body).map((image) => {
    const asset = assets.get(image.assetId);
    if (!asset) throw new Error('图片原件缺失，未覆盖上次保存的草稿。');
    return asset;
  });
  chain = chain
    .catch(() => {})
    .then(async () => {
      persistedRevision = await saveLabDraft(db, snapshot, imageAssets, {
        expectedRevision: persistedRevision,
      });
    });
  await chain;
  if (atRevision === revision) {
    dirty = false;
    status('已保存到独立试验库');
  }
}
async function insertImages(files) {
  if (importing) throw new Error('正在导入原件，请稍后插图。');
  pendingImages++;
  try {
    for (const file of files) {
      const asset = await richAssetFromBlob(file, file.name || '粘贴图片');
      registerAsset(asset);
      writer.editor
        .chain()
        .focus()
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
              alt: file.name,
            },
          },
          { type: 'paragraph' },
        ])
        .run();
    }
    updateSelection();
  } finally {
    pendingImages--;
  }
}
async function exportOriginal() {
  if (pendingImages) throw new Error('图片仍在处理中，请稍后导出。');
  // Export remains available when persistence is blocked, so unsaved text can be rescued.
  const original = await encodeRichArchive(writer.getBody(), assets);
  const blob = new Blob([JSON.stringify(original, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = '拾页-图文试写.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function importOriginal(file) {
  const atRevision = revision;
  if (importing || pendingImages) throw new Error('图片或导入仍在处理中，请稍后重试。');
  const original = await decodeRichArchive(await file.text());
  await applyImported(original, atRevision);
}
async function applyImported(original, atRevision) {
  writer.checkBody(original.body);
  await chain;
  if (atRevision !== revision || importing || pendingImages)
    throw new Error('校验期间正文已变化，未替换草稿；请重试导入。');
  const before = {
    state: writer.editor.state,
    body: writer.getBody(),
    dirty,
    recovery: recoveryDraft,
  };
  const controls = [
    ...document.querySelectorAll(
      'header button, nav button, nav input, #image-settings input, #image-settings select, #image-settings button',
    ),
  ];
  const disabled = controls.map((control) => control.disabled);
  importing = true;
  clearTimeout(timer);
  controls.forEach((control) => {
    control.disabled = true;
  });
  writer.editor.setEditable(false, false);
  status('正在保存导入原件…');
  try {
    original.assets.forEach(registerAsset);
    writer.setBody(original.body);
    const body = writer.getBody();
    reader.setBody(body);
    // Include unsaved prior images too: recovery must be self-contained after reopening.
    const mediaIds = new Set(
      [...richMediaReferences(body), ...richMediaReferences(before.body)].map(
        (image) => image.assetId,
      ),
    );
    const media = [...mediaIds].map((id) => {
      const asset = assets.get(id);
      if (!asset) throw new Error('图片原件缺失，未替换草稿。');
      return asset;
    });
    const recovery = { body: before.body, savedAt: new Date().toISOString() };
    persistedRevision = await saveLabDraft(db, { body, savedAt: new Date().toISOString() }, media, {
      expectedRevision: persistedRevision,
      recovery,
    });
    revision++;
    dirty = false;
    recoveryDraft = recovery;
    status('已导入并保存，导入前的草稿也已保留');
  } catch (error) {
    // Restore the original undo/selection state as well as the visible body.
    writer.editor.view.updateState(before.state);
    reader.setBody(before.body);
    dirty = before.dirty;
    recoveryDraft = before.recovery;
    throw error;
  } finally {
    importing = false;
    writer.editor.setEditable(true, false);
    controls.forEach((control, i) => {
      control.disabled = disabled[i];
    });
    $('#restore-before-import').disabled = !recoveryDraft;
    updateSelection();
  }
}
async function start() {
  db = await openLabStore();
  const stored = await readLabDraft(db);
  stored.assets.forEach(registerAsset);
  persistedRevision = stored.draft?.revision || 0;
  recoveryDraft = stored.recovery;
  writer = createRichEditor($('#editor'), {
    body: stored.draft?.body,
    resolveAsset,
    onImage: showImage,
    onUpdate: changed,
  });
  reader = createRichEditor($('#message-preview'), {
    body: writer.getBody(),
    resolveAsset,
    onImage: showImage,
    editable: false,
  });
  writer.editor.on('selectionUpdate', updateSelection);
  writer.editor.on('transaction', updateSelection);
  setZoom(zoom);
  document.querySelectorAll('[data-action]').forEach((button) => {
    button.onmousedown = (event) => event.preventDefault();
    button.onclick = () => {
      const action = button.dataset.action;
      const chain = writer.editor.chain().focus();
      if (
        ['bold', 'italic', 'strike', 'bulletList', 'taskList', 'blockquote', 'codeBlock'].includes(
          action,
        )
      )
        chain[`toggle${action[0].toUpperCase()}${action.slice(1)}`]().run();
      else if (action === 'highlight') chain.toggleMark('highlight').run();
      else if (action === 'heading') chain.toggleHeading({ level: 2 }).run();
      else if (action === 'horizontalRule') chain.setHorizontalRule().run();
      else if (action === 'table')
        chain.insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run();
      else chain[action]().run();
    };
  });
  $('#save').disabled = $('#export').disabled = false;
  $('#save').onclick = () => save().catch(report);
  $('#export').onclick = () => exportOriginal().catch(report);
  $('#restore-before-import').disabled = !recoveryDraft;
  $('#restore-before-import').onclick = () => {
    if (recoveryDraft)
      applyImported({ body: recoveryDraft.body, assets: new Map() }, revision).catch(report);
  };
  $('#insert-image').onclick = () => $('#image-file').click();
  $('#image-file').onchange = async (event) => {
    try {
      await insertImages(event.target.files);
    } catch (e) {
      report(e);
    } finally {
      event.target.value = '';
    }
  };
  $('#editor').addEventListener(
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
  $('#editor').addEventListener(
    'drop',
    (event) => {
      const files = [...event.dataTransfer.files];
      if (files.length) {
        event.preventDefault();
        insertImages(files).catch(report);
      }
    },
    true,
  );
  for (const [id, key, transform] of [
    ['#image-width', 'widthRatio', (v) => Number(v) / 100],
    ['#image-align', 'align', (v) => v],
    ['#image-caption', 'caption', (v) => v],
  ]) {
    $(id).oninput = () =>
      writer.editor.commands.updateAttributes('image', { [key]: transform($(id).value) });
  }
  $('#view-image').onclick = () => showImage(writer.editor.getAttributes('image').assetId);
  $('#markdown').onclick = () => {
    $('#markdown-title').textContent = '插入 Markdown';
    $('#markdown-source').value = '';
    $('#markdown-source').readOnly = false;
    $('#markdown-apply').hidden = false;
    $('#markdown-dialog').showModal();
    $('#markdown-source').focus();
  };
  $('#markdown-export').onclick = () => {
    $('#markdown-title').textContent = 'Markdown 文本导出';
    $('#markdown-source').value = writer.getMarkdown();
    $('#markdown-source').readOnly = true;
    $('#markdown-apply').hidden = true;
    $('#markdown-dialog').showModal();
  };
  $('#markdown-cancel').onclick = () => $('#markdown-dialog').close();
  $('#markdown-apply').onclick = () => {
    try {
      writer.insertMarkdown($('#markdown-source').value);
      $('#markdown-dialog').close();
    } catch (e) {
      report(e);
    }
  };
  $('#import').onchange = (event) => {
    if (event.target.files[0]) importOriginal(event.target.files[0]).catch(report);
    event.target.value = '';
  };
  $('#legacy').onchange = async (event) => {
    try {
      const file = event.target.files[0];
      if (!file) return;
      const text = await file.text();
      const preview = $('#legacy-preview');
      preview.replaceChildren();
      if (/\.html?$/i.test(file.name)) preview.innerHTML = sanitize(text);
      else {
        const instance = createRichEditor(preview, {
          body: writer.parseMarkdown(text),
          editable: false,
        });
        $('#legacy-dialog').addEventListener('close', () => instance.destroy(), { once: true });
      }
      $('#legacy-dialog').showModal();
    } catch (e) {
      report(e);
    } finally {
      event.target.value = '';
    }
  };
  $('#legacy-close').onclick = () => $('#legacy-dialog').close();
  status(stored.draft ? '已恢复独立试验草稿' : '可开始试写，草稿自动保存');
  writer.editor.commands.focus('end');
}
window.addEventListener('keydown', (event) => {
  if (!writer || event.isComposing || !(event.ctrlKey || event.metaKey) || $('dialog[open]'))
    return;
  if (event.key.toLowerCase() === 's') {
    event.preventDefault();
    save().catch(report);
    return;
  }
  if (['+', '=', '-', '_', '0'].includes(event.key)) {
    event.preventDefault();
    setZoom(event.key === '0' ? 100 : zoom + (['+', '='].includes(event.key) ? 4 : -4));
  }
});
window.addEventListener(
  'wheel',
  (event) => {
    if (!(event.ctrlKey || event.metaKey) || $('dialog[open]')) return;
    event.preventDefault();
    setZoom(zoom + (event.deltaY < 0 ? 4 : -4));
  },
  { passive: false },
);
window.addEventListener('beforeunload', (event) => {
  if (dirty || importing || pendingImages) {
    event.preventDefault();
    event.returnValue = '';
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && dirty) save().catch(report);
});
start().catch((error) => {
  report(error);
  $('#editor').textContent = '试验原件读取失败，未覆盖数据。请保留此页并反馈错误。';
});
