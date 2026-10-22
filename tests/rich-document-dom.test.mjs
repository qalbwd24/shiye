// Node DOM/IndexedDB integration only. No desktop/browser window or native input is used.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { indexedDB } from 'fake-indexeddb';

test('isolated lab mounts real editors, persists transactions/media and reopens the same document', async () => {
  const html = await readFile(new URL('../public/rich-text-lab.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, {
    url: 'http://127.0.0.1:18766/rich-text-lab.html',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  for (const key of [
    'window',
    'document',
    'navigator',
    'localStorage',
    'DOMParser',
    'HTMLElement',
    'Element',
    'Node',
    'MutationObserver',
    'AbortController',
    'getComputedStyle',
    'requestAnimationFrame',
    'cancelAnimationFrame',
  ]) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value:
        typeof window[key] === 'function' &&
        ['getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'].includes(key)
          ? window[key].bind(window)
          : window[key],
    });
  }
  globalThis.innerHeight = 900;
  globalThis.innerWidth = 1200;
  globalThis.indexedDB = indexedDB;
  window.Range.prototype.getClientRects = () => [];
  window.Range.prototype.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 0 });
  let modalOpens = 0;
  window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
    modalOpens++;
  };
  window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new window.Event('close'));
  };
  const errors = [];
  window.addEventListener('error', (event) => errors.push(event.message));
  const downloads = [];
  const blobs = new Map();
  const createObjectURL = URL.createObjectURL;
  URL.createObjectURL = (blob) => {
    const url = createObjectURL(blob);
    blobs.set(url, blob);
    return url;
  };
  window.HTMLAnchorElement.prototype.click = function () {
    downloads.push(blobs.get(this.href));
  };
  const { createRichEditor } = await import('../public/editor/rich-document-editor.js');
  const { fromEditorJSON } = await import('../public/shared/rich-document.js');
  const { readLabDraft, openLabStore, saveLabDraft } =
    await import('../public/features/rich-text-lab-store.js');
  await import('../public/features/rich-text-lab.js');
  const until = async (fn) => {
    for (let i = 0; i < 100; i++) {
      if (fn()) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(
      'Lab did not reach expected state: ' + window.document.querySelector('#status').textContent,
    );
  };
  await until(() => window.document.querySelector('#editor .tiptap'));
  const writer = window.document.querySelector('#editor .tiptap').editor;
  const reader = window.document.querySelector('#message-preview .tiptap').editor;
  assert.ok(writer.isEditable);
  assert.equal(reader.isEditable, false);
  writer.commands.insertContent('中文输入 空格与标点，🙂');
  assert.match(reader.getText(), /中文输入 空格与标点，🙂/);
  window.document.querySelector('#markdown').click();
  window.document.querySelector('#markdown-source').value =
    '**我的加粗** *我的斜体* ==我的高亮==\n\n---\n\n```js\nconst x = 1;\n```\n\n|甲|乙|\n|---|---|\n|1|2|';
  window.document.querySelector('#markdown-apply').click();
  assert.match(writer.getHTML(), /<strong>我的加粗<\/strong>/);
  assert.match(writer.getHTML(), /<em>我的斜体<\/em>/);
  assert.match(writer.getHTML(), /<mark>我的高亮<\/mark>/);
  assert.match(writer.getHTML(), /<hr>/);
  assert.match(writer.getHTML(), /<table/);
  assert.equal(modalOpens, 1);
  // Use the public image file input pathway, without a Windows file dialog.
  const imageBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',
    'base64',
  );
  const image = new File([imageBytes], 'synthetic.png', { type: 'image/png' });
  const fileInput = window.document.querySelector('#image-file');
  Object.defineProperty(fileInput, 'files', { configurable: true, value: [image] });
  fileInput.dispatchEvent(new window.Event('change'));
  await until(() => window.document.querySelector('#editor figure img'));
  const imagePosition = (() => {
    let pos;
    writer.state.doc.descendants((node, at) => {
      if (node.type.name === 'image') pos = at;
    });
    return pos;
  })();
  writer.commands.setNodeSelection(imagePosition);
  const imageId = writer.getAttributes('image').assetId;
  const occurrenceId = writer.getAttributes('image').occurrenceId;
  const width = window.document.querySelector('#image-width');
  width.value = '40';
  width.dispatchEvent(new window.Event('input'));
  const caption = window.document.querySelector('#image-caption');
  caption.value = '测试图注';
  caption.dispatchEvent(new window.Event('input'));
  assert.equal(writer.getAttributes('image').widthRatio, 0.4);
  assert.equal(writer.getAttributes('image').occurrenceId, occurrenceId);
  window.document.querySelector('#save').click();
  await until(() => window.document.querySelector('#status').textContent === '已保存到独立试验库');
  const db = await openLabStore();
  const saved = await readLabDraft(db);
  assert.ok(saved.draft.body.content.length);
  assert.equal(saved.assets.length, 1);
  assert.deepEqual(Buffer.from(await saved.assets[0].blob.arrayBuffer()), imageBytes);
  assert.equal(saved.assets[0].id, imageId);
  const target = window.document.createElement('div');
  window.document.body.append(target);
  const restored = createRichEditor(target, {
    body: saved.draft.body,
    editable: false,
    resolveAsset: () => 'blob:synthetic',
  });
  assert.deepEqual(restored.getBody(), saved.draft.body);
  assert.match(restored.editor.getHTML(), /width:\s*40%/);
  assert.match(restored.editor.getHTML(), /测试图注/);
  assert.match(restored.editor.getText(), /我的斜体/);
  // An aborted atomic transaction must not replace the prior draft.
  await assert.rejects(saveLabDraft(db, { invalid: true }, [{ notAnId: true }]));
  assert.deepEqual((await readLabDraft(db)).draft, saved.draft);
  // Zoom affects text only; the 4% preference is persisted independently.
  window.dispatchEvent(
    new window.KeyboardEvent('keydown', { key: '+', ctrlKey: true, cancelable: true }),
  );
  assert.equal(window.localStorage.getItem('shiye.rich-lab.text-scale'), '104');
  assert.equal(window.document.documentElement.style.getPropertyValue('--text-size'), '17.68px');
  const composing = new window.KeyboardEvent('keydown', {
    key: '-',
    ctrlKey: true,
    isComposing: true,
    cancelable: true,
  });
  window.dispatchEvent(composing);
  assert.equal(window.localStorage.getItem('shiye.rich-lab.text-scale'), '104');
  assert.deepEqual(errors, []);
  const currentBody = () => fromEditorJSON(writer.getJSON());
  const completeBody = currentBody();
  assert.equal(writer.commands.undo(), true);
  assert.equal(writer.commands.redo(), true);
  assert.deepEqual(
    currentBody(),
    completeBody,
    'undo/redo preserves block IDs and image occurrences',
  );
  window.document.querySelector('#export').click();
  await until(() => downloads.length === 1);
  const portable = JSON.parse(await downloads[0].text());
  assert.deepEqual(portable.body, completeBody);
  assert.equal(portable.assets.length, 1);
  const originalInput = window.document.querySelector('#import');
  const importFile = (file) => {
    Object.defineProperty(originalInput, 'files', { configurable: true, value: [file] });
    originalInput.dispatchEvent(new window.Event('change'));
  };
  writer.commands.focus('end');
  writer.commands.insertContent('导入前还没自动保存的内容');
  const extraImage = new File([imageBytes, new Uint8Array([0])], 'another.png', {
    type: 'image/png',
  });
  Object.defineProperty(fileInput, 'files', { configurable: true, value: [extraImage] });
  fileInput.dispatchEvent(new window.Event('change'));
  await until(() => window.document.querySelectorAll('#editor figure img').length === 2);
  const beforeImport = currentBody();
  importFile(new File([JSON.stringify(portable)], 'portable.json', { type: 'application/json' }));
  await until(() =>
    window.document.querySelector('#status').textContent.startsWith('已导入并保存'),
  );
  assert.deepEqual(currentBody(), completeBody);
  const imported = await readLabDraft(db);
  assert.deepEqual(imported.recovery.body, beforeImport);
  assert.equal(
    imported.assets.length,
    2,
    'recovery retains an image that was not previously saved',
  );
  window.document.querySelector('#restore-before-import').click();
  await until(() => writer.getText().includes('导入前还没自动保存的内容') && writer.isEditable);
  assert.deepEqual(currentBody(), beforeImport);
  let finishRead;
  importFile({
    text: () =>
      new Promise((resolve) => {
        finishRead = resolve;
      }),
  });
  writer.commands.insertContent('校验时继续输入');
  const duringImport = currentBody();
  finishRead(JSON.stringify(portable));
  await until(() =>
    window.document.querySelector('#status').textContent.includes('校验期间正文已变化'),
  );
  assert.deepEqual(currentBody(), duringImport);
  // A concurrent tab save wins; failed import restores this window's undo/selection/body.
  const live = (await readLabDraft(db)).draft;
  await saveLabDraft(db, live, [], { expectedRevision: live.revision });
  const beforeFailedImport = writer.state;
  importFile(new File([JSON.stringify(portable)], 'portable.json', { type: 'application/json' }));
  await until(() => window.document.querySelector('#status').textContent.includes('另一试验页'));
  assert.equal(writer.state.doc, beforeFailedImport.doc);
  assert.deepEqual(writer.state.selection.toJSON(), beforeFailedImport.selection.toJSON());
  assert.equal(writer.isEditable, true);
  window.document.querySelector('#export').click();
  await until(() => downloads.length === 2);
  assert.deepEqual(
    JSON.parse(await downloads[1].text()).body,
    duringImport,
    'unsaved content remains exportable when saving conflicts',
  );
  assert.deepEqual(errors, []);
  restored.destroy();
  writer.destroy();
  reader.destroy();
  db.close();
  dom.window.close();
  URL.createObjectURL = createObjectURL;
});
