// Wrapper integration using synthetic entries only; no HTTP, filesystem or native IME.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  createQuickDocumentEditor,
  richQuickEnabled,
} from '../public/editor/quick-document-editor.js';
import {
  fromEditorJSON,
  richImageReferences,
  richMediaReferences,
} from '../public/shared/rich-document.js';
import {
  renderRichDocument,
  validateRenderableRichDocument,
} from '../public/shared/rich-document-renderer.js';

function setup(t, options = {}) {
  const dom = new JSDOM(
    '<section id="editorToolboxContent"></section><div id="bodyEditor" contenteditable="true">原控件</div>',
    {
      url: 'http://127.0.0.1:18766/?richdoc=1',
      pretendToBeVisual: true,
    },
  );
  const { window } = dom;
  const originalGlobals = new Map();
  for (const key of [
    'window',
    'document',
    'navigator',
    'DOMParser',
    'HTMLElement',
    'Element',
    'Node',
    'Window',
    'MutationObserver',
    'getComputedStyle',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'localStorage',
  ]) {
    originalGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: ['getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'].includes(key)
        ? window[key].bind(window)
        : window[key],
    });
  }
  window.Range.prototype.getClientRects = () => [];
  window.Range.prototype.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 0 });
  let currentEntry = null;
  const changed = [],
    messages = [];
  const c = {
    $: (selector) => window.document.querySelector(selector),
    current: () => currentEntry,
    library: { settings: { preferences: {} }, entries: [], media: [] },
    sanitize: (html) => html,
    escape: (value) => String(value),
    markDirty: (entry) => changed.push(entry),
    pause() {},
    toast: (message) => messages.push(message),
    modal(_title, html) {
      window.document.querySelector('#testModal')?.remove();
      const modal = window.document.createElement('dialog');
      modal.id = 'testModal';
      modal.setAttribute('open', '');
      modal.innerHTML = html;
      window.document.body.append(modal);
    },
    closeModal() {
      const modal = window.document.querySelector('#testModal');
      modal?.dispatchEvent(new window.Event('close', { bubbles: false }));
      modal?.remove();
    },
  };
  const editor = createQuickDocumentEditor(c, options);
  const mount = (entry) => {
    currentEntry = entry;
    if (!c.library.entries.includes(entry)) c.library.entries.push(entry);
    return editor.render(entry);
  };
  t.after(() => {
    editor.dispose();
    dom.window.close();
    for (const [key, descriptor] of originalGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return { editor, c, mount, changed, messages, host: c.$('#bodyEditor') };
}
function richEntry(id, text) {
  let next = 0;
  const body = fromEditorJSON(
    { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
    () => `${id}-block-${++next}`,
  );
  return {
    id,
    contentFormat: 'richdoc',
    body,
    content: '<p>过期HTML投影不能充当正文</p>',
    attachments: [],
  };
}
const imageMedia = (id) => ({ id, name: `虚构-${id}.png`, type: 'image/png' });

test('queued close from settings cannot release the next attachment modal bookmark', async (t) => {
  const f = setup(t, { richNewDocuments: true });
  const entry = richEntry('queued-modal-close', '前后正文');
  const media = imageMedia('queued-modal-image');
  entry.attachments.push(media.id);
  f.c.library.media.push(media);
  const doc = f.host.ownerDocument;
  const dialog = doc.createElement('dialog');
  dialog.id = 'modal';
  doc.body.append(dialog);
  f.c.modal = (_title, html) => {
    dialog.innerHTML = html;
    dialog.open = true;
  };
  f.c.closeModal = () => {
    dialog.open = false;
    queueMicrotask(() => dialog.dispatchEvent(new doc.defaultView.Event('close')));
  };
  f.mount(entry);
  f.c.modal('设置', '');
  f.c.closeModal();
  f.editor.attachedImages();
  await Promise.resolve();
  doc.querySelector('[data-rich-attachment]').click();
  assert.equal(richImageReferences(entry.body).length, 1);
  assert.ok(!f.messages.some((message) => message.includes('插入位置暂不可用')));
});

test('new rich documents require an explicit local development flag; defaults preserve the Markdown creation path', (t) => {
  assert.equal(richQuickEnabled(new URL('http://127.0.0.1:18766/?richdoc=1')), true);
  assert.equal(richQuickEnabled(new URL('http://localhost:18766/?richdoc=1')), true);
  for (const url of [
    'http://127.0.0.1:18766/',
    'http://127.0.0.1:18766/?richdoc=0',
    'http://127.0.0.1:18765/?richdoc=1',
    'http://localhost:9999/?richdoc=1',
    'https://example.com:18766/?richdoc=1',
  ])
    assert.equal(richQuickEnabled(new URL(url)), false, url);
  const f = setup(t);
  const created = f.editor.newDocument('', true);
  assert.equal(created.contentFormat, 'markdown');
  assert.equal(created.markdownSource, '　　');
  assert.equal(created.body, undefined);
});

test('preparing candidate rich documents and nonempty templates leaves the mounted legacy diary unchanged', (t) => {
  const f = setup(t, { richNewDocuments: true });
  const old = {
    id: 'legacy',
    contentFormat: 'html',
    content: '<p>旧篇　原文<br>第二行</p>',
    attachments: [],
    future: { keep: true },
  };
  const before = structuredClone(old);
  f.mount(old);
  const oldDOM = f.host.outerHTML;
  const next = f.editor.newDocument('', true);
  assert.equal(next.contentFormat, 'richdoc');
  validateRenderableRichDocument(next.body);
  assert.equal(next.content, renderRichDocument(next.body));
  assert.equal(f.host.outerHTML, oldDOM);
  assert.deepEqual(old, before);
  assert.equal(f.editor.isRichDocument, false);
  const template = f.editor.newDocument('<p>虚构模板 <strong>加粗</strong></p>', true);
  assert.equal(template.contentFormat, 'richdoc');
  assert.ok(template.body.content[0].content[0].text.includes('虚构模板'));
  assert.ok(
    template.body.content[0].content.some((node) =>
      node.marks?.some((mark) => mark.type === 'bold'),
    ),
  );
  assert.equal(f.host.outerHTML, oldDOM);
  assert.deepEqual(old, before);
  assert.equal(f.changed.length, 0);
});

test('switching between old HTML and rich bodies preserves source data and never edits the HTML projection as rich content', (t) => {
  const f = setup(t);
  const old = { id: 'legacy-switch', content: '<p>旧HTML正文</p>', attachments: [] };
  const rich = richEntry('rich-switch', '结构正文');
  const originals = structuredClone([old, rich]);
  for (let i = 0; i < 2; i++) {
    f.mount(rich);
    assert.equal(f.editor.isRichDocument, true);
    assert.equal(f.editor.isStructured, true);
    assert.ok(f.host.textContent.includes('结构正文'));
    assert.ok(!f.host.textContent.includes('过期HTML'));
    f.editor.toggleSource();
    assert.ok(f.messages.at(-1).includes('直接编辑'));
    f.mount(old);
    assert.equal(f.editor.isRichDocument, false);
    assert.equal(f.host.innerHTML, old.content);
  }
  assert.deepEqual([old, rich], originals);
  assert.equal(f.changed.length, 0);
  const invalid = { ...rich, body: { format: 'future-document', version: 99, content: [] } };
  assert.throws(() => f.mount(invalid), /格式|版本/);
  assert.ok(!f.host.textContent.includes('过期HTML'));
  assert.deepEqual([old, rich], originals);
});

test('a batch shares a mapped position until release and retrying an occurrence never inserts a duplicate image', (t) => {
  const f = setup(t);
  const entry = richEntry('rich-media', '图片旁原文');
  const one = imageMedia('image-one'),
    two = imageMedia('image-two');
  f.c.library.media.push(one, two);
  f.mount(entry);
  const position = f.editor.captureMediaPosition(entry);
  assert.equal(position.format, 'richdoc');
  const insertedAt = '2026-10-16T08:30:00.000Z';
  assert.equal(
    f.editor.insertUploadedMedia(entry, one, position, insertedAt, 'occurrence-one'),
    true,
  );
  const firstBody = structuredClone(entry.body);
  assert.equal(
    f.editor.insertUploadedMedia(entry, one, position, insertedAt, 'occurrence-one'),
    true,
  );
  assert.deepEqual(entry.body, firstBody);
  assert.equal(
    f.editor.insertUploadedMedia(entry, two, position, insertedAt, 'occurrence-two'),
    true,
  );
  const images = richImageReferences(entry.body);
  assert.deepEqual(
    images.map((item) => item.assetId),
    ['image-one', 'image-two'],
  );
  assert.deepEqual(
    images.map((item) => item.occurrenceId),
    ['occurrence-one', 'occurrence-two'],
  );
  assert.ok(
    images.every(
      (item) =>
        item.insertedAt === insertedAt && item.widthRatio === 0.75 && item.align === 'center',
    ),
  );
  assert.equal(entry.content, renderRichDocument(entry.body));
  validateRenderableRichDocument(entry.body);
  assert.ok(f.host.textContent.includes('图片旁原文'));
  assert.equal(f.editor.usesMedia(one.id), true);
  assert.equal(f.editor.releaseMediaPosition(position), true);
  assert.equal(f.editor.releaseMediaPosition(position), false);
  assert.equal(f.editor.restorePosition(position), false);
  assert.equal(
    f.editor.insertUploadedMedia(
      entry,
      { id: 'file', type: 'application/pdf' },
      null,
      insertedAt,
      'pdf',
    ),
    false,
  );
});

test('a slow upload finishing after navigation writes only its original rich target and preserves the current legacy diary', (t) => {
  const f = setup(t);
  const target = richEntry('original-target', '目标正文');
  const media = imageMedia('slow-image');
  f.c.library.media.push(media);
  f.mount(target);
  const position = f.editor.captureMediaPosition(target);
  const current = { id: 'now-legacy', content: '<p>切换后旧篇不动</p>', attachments: [] };
  f.mount(current);
  const currentBefore = structuredClone(current),
    currentDOM = f.host.outerHTML;
  const insertedAt = '2026-10-16T09:00:00.000Z';
  assert.equal(
    f.editor.insertUploadedMedia(target, media, position, insertedAt, 'slow-occurrence'),
    true,
  );
  assert.equal(richImageReferences(target.body).length, 1);
  assert.equal(richImageReferences(target.body)[0].insertedAt, insertedAt);
  assert.equal(target.content, renderRichDocument(target.body));
  assert.equal(f.changed.at(-1), target);
  assert.deepEqual(current, currentBefore);
  assert.equal(f.host.outerHTML, currentDOM);
  assert.equal(f.editor.usesMedia(media.id), false);
  assert.equal(
    f.editor.insertUploadedMedia(current, media, null, insertedAt, 'must-not-convert'),
    false,
  );
  assert.equal(current.body, undefined);
  assert.equal(f.editor.releaseMediaPosition(position), false);
});

test('toolbox image settings target a single selected occurrence and retain safe text after reopen', (t) => {
  const f = setup(t);
  const entry = richEntry('layout-target', '保留正文');
  const media = imageMedia('layout-image');
  f.c.library.media.push(media);
  f.mount(entry);
  assert.equal(f.c.$('#editorToolboxContent').querySelectorAll('.rich-image-controls').length, 1);
  assert.equal(
    f.c.$('#richImageLayout').closest('#editorToolboxContent')?.id,
    'editorToolboxContent',
  );
  f.editor.insertUploadedMedia(entry, media, null, '2026-10-16T00:00:00.000Z', 'layout-occurrence');
  const writer = f.host.querySelector('.tiptap').editor;
  let at;
  writer.state.doc.descendants((node, pos) => {
    if (node.type.name === 'image') at = pos;
  });
  writer.commands.setNodeSelection(at);
  const editInfo = f.host.querySelector('[aria-label="编辑图片信息"]');
  assert.ok(editInfo);
  editInfo.click();
  assert.equal(f.c.$('#richImageWidth').value, '75');
  f.c.$('#richImageWidth').value = '101';
  f.c.$('#applyRichImageLayout').click();
  assert.equal(richImageReferences(entry.body)[0].widthRatio, 0.75);
  f.c.$('#richImageWidth').value = '40';
  f.c.$('#richImageAlign').value = 'left';
  f.c.$('#richImageCaption').value = '<img src=x onerror=alert(1)>图注';
  f.c.$('#richImageAlt').value = '替代文字';
  f.c.$('#applyRichImageLayout').click();
  const image = richImageReferences(entry.body)[0];
  assert.equal(image.widthRatio, 0.4);
  assert.equal(image.align, 'left');
  assert.equal(image.occurrenceId, 'layout-occurrence');
  assert.equal(image.assetId, media.id);
  assert.equal(image.insertedAt, '2026-10-16T00:00:00.000Z');
  assert.equal(image.alt, '替代文字');
  assert.ok(entry.content.includes('&lt;img'));
  assert.ok(!entry.content.includes('rich-media-edit'));
  assert.equal(f.host.querySelector('figcaption img'), null);
  const snapshot = structuredClone(entry.body);
  f.mount({ id: 'old-for-reopen', content: '<p>旧篇</p>', attachments: [] });
  assert.equal(f.c.$('#richImageLayout'), null);
  f.mount(entry);
  assert.deepEqual(entry.body, snapshot);
  assert.equal(f.host.querySelector('figure').style.width, '40%');
  assert.equal(f.host.querySelector('figure').dataset.align, 'left');
});

test('existing image attachment insertion uses captured cursor, preserves attachment list, and refuses other diaries', (t) => {
  const f = setup(t);
  const entry = richEntry('existing-attachment', '甲乙');
  const media = imageMedia('old-existing-image');
  const unrelated = imageMedia('unrelated-image');
  const pdf = { id: 'pdf-existing', name: '虚构.pdf', type: 'application/pdf' };
  entry.attachments = [media.id, pdf.id];
  f.c.library.media.push(media, unrelated, pdf);
  f.mount(entry);
  const writer = f.host.querySelector('.tiptap').editor;
  writer.commands.setTextSelection(2);
  f.c.$('#insertRichAttachment').click();
  assert.equal(f.c.$('#richAttachmentChoices').children.length, 1);
  const button = f.c.$(`[data-rich-attachment="${media.id}"]`);
  assert.ok(button);
  button.click();
  const image = richImageReferences(entry.body)[0];
  assert.equal(image.assetId, media.id);
  assert.equal(image.widthRatio, 0.75);
  assert.equal(image.align, 'center');
  assert.ok(image.occurrenceId);
  assert.match(image.insertedAt, /^\d{4}-\d\d-\d\dT.*Z$/);
  assert.equal(entry.body.content[0].content[0].text, '甲');
  assert.equal(entry.body.content.at(-1).content[0].text, '乙');
  assert.deepEqual(entry.attachments, [media.id, pdf.id]);
  assert.equal(f.editor.insertAttachedImage(unrelated.id), false);
  assert.equal(f.editor.insertAttachedImage(pdf.id), false);
  f.c.$('#insertRichAttachment').click();
  const staleButton = f.c.$(`[data-rich-attachment="${media.id}"]`);
  const other = richEntry('other-existing-attachment', '另一篇');
  f.mount(other);
  staleButton.click();
  assert.equal(richImageReferences(other.body).length, 0);
  assert.equal(richImageReferences(entry.body).length, 1);
  const old = { id: 'must-stay-old', content: '<p>旧篇不转换</p>', attachments: [media.id] };
  f.mount(old);
  assert.equal(f.editor.insertAttachedImage(media.id), false);
  assert.equal(old.body, undefined);
});

test('new-document capability can be resolved live after health readiness', (t) => {
  let ready = false;
  const f = setup(t, { richNewDocuments: () => ready });
  assert.equal(f.editor.newDocument('', true).contentFormat, 'markdown');
  ready = true;
  assert.equal(f.editor.newDocument('', true).contentFormat, 'richdoc');
  const entry = richEntry('active-rich-during-template', '尚在编辑');
  f.mount(entry);
  const writer = f.host.querySelector('.tiptap').editor;
  const activeDOM = f.host.outerHTML;
  assert.equal(f.editor.newDocument('<p>旧模板</p>', true).contentFormat, 'richdoc');
  assert.equal(f.editor.isRichDocument, true);
  assert.equal(f.host.querySelector('.tiptap').editor, writer);
  assert.equal(f.host.outerHTML, activeDOM);
  ready = false;
  assert.equal(f.editor.newDocument('', false).contentFormat, 'markdown');
  assert.equal(f.host.querySelector('.tiptap').editor, writer);
});

test('nonempty category template creates richdoc and uploaded images join its body instead of a legacy attachment layout', (t) => {
  const f = setup(t, { richNewDocuments: true });
  const source =
    '<div>　　虚构分类模板<br>第二行</div><p><strong>格式</strong> 尾部</p><p><br></p>';
  const old = {
    id: 'saved-old-category-entry',
    content: source,
    attachments: [],
    future: { preserved: true },
  };
  const original = structuredClone(old);
  f.mount(old);
  const originalDOM = f.host.outerHTML;
  const next = f.editor.newDocument(source, true);
  assert.equal(next.contentFormat, 'richdoc');
  validateRenderableRichDocument(next.body);
  assert.equal(next.body.content[0].content[0].text, '　　虚构分类模板');
  assert.equal(next.body.content[0].content[1].type, 'hardBreak');
  assert.equal(next.body.content[0].content[2].text, '第二行');
  assert.equal(next.body.content[2].content[0].type, 'hardBreak');
  assert.equal(f.host.outerHTML, originalDOM);
  assert.deepEqual(old, original);
  const entry = { id: 'new-category-rich-draft', ...next, attachments: [] };
  f.mount(entry);
  assert.equal(f.editor.isRichDocument, true);
  const media = imageMedia('category-image');
  f.c.library.media.push(media);
  const position = f.editor.captureMediaPosition(entry);
  assert.equal(
    f.editor.insertUploadedMedia(
      entry,
      media,
      position,
      '2026-10-16T00:00:00.000Z',
      'category-image-occurrence',
    ),
    true,
  );
  assert.equal(f.host.querySelectorAll('figure[data-rich-image]').length, 1);
  assert.equal(richImageReferences(entry.body)[0].assetId, media.id);
  assert.ok(f.host.textContent.includes('虚构分类模板'));
  assert.deepEqual(old, original);
});

test('template parser keeps text/LF/blank paragraphs and supported structure through checked editor mounting', (t) => {
  const f = setup(t, { richNewDocuments: true });
  const plain = f.editor.newDocument('　　第一行\n第二行🙂', false);
  assert.equal(plain.body.content[0].content[0].text, '　　第一行\n第二行🙂');
  const source =
    '<h2>标题</h2><p style="white-space:pre-wrap">　　正文<br><em>斜体</em><u>下划线</u></p><p></p><ul><li>项目一</li><li><p>项目二</p></li></ul><blockquote><p>引用</p></blockquote><pre><code class="language-js">a\n  b</code></pre><hr><table><tr><th>甲</th><td>乙</td></tr></table>';
  const next = f.editor.newDocument(source, true);
  validateRenderableRichDocument(next.body);
  assert.deepEqual(
    next.body.content.map((node) => node.type),
    [
      'heading',
      'paragraph',
      'paragraph',
      'bulletList',
      'blockquote',
      'codeBlock',
      'horizontalRule',
      'table',
    ],
  );
  assert.equal(next.body.content[5].content[0].text, 'a\n  b');
  f.mount({ id: 'checked-template', ...next, attachments: [] });
  assert.equal(f.host.querySelector('h2').textContent, '标题');
  assert.equal(f.host.querySelector('pre').textContent, 'a\n  b');
  assert.equal(f.host.querySelectorAll('li').length, 2);
});

test('local template images require registration; external/unsupported templates fail explicitly without changing active diary', (t) => {
  const f = setup(t, { richNewDocuments: true });
  const media = imageMedia('template-local-image');
  f.c.library.media.push(media);
  const active = richEntry('active-before-template-error', '本地未变');
  f.mount(active);
  const original = structuredClone(active),
    originalDOM = f.host.outerHTML;
  for (const source of [
    '<img src="https://example.invalid/external.png">',
    '<img src="/media/not-registered">',
    '<p style="color:red">有颜色</p>',
    '<p onclick="alert(1)">事件</p>',
    '<video src="/media/clip">视频原文</video>',
    '<script>alert(1)</script>',
  ]) {
    assert.throws(() => f.editor.newDocument(source, true), /模板.*未改变/);
    assert.equal(f.host.outerHTML, originalDOM);
    assert.deepEqual(active, original);
  }
  const next = f.editor.newDocument(
    '<p>图片之前</p><figure data-align="right" style="width:40%"><img src="/media/template-local-image" alt="原替代文字"><figcaption>原图注</figcaption></figure><p>图片之后</p>',
    true,
  );
  const image = richImageReferences(next.body)[0];
  assert.equal(image.assetId, media.id);
  assert.equal(image.widthRatio, 0.4);
  assert.equal(image.align, 'right');
  assert.equal(image.caption, '原图注');
  assert.equal(image.alt, '原替代文字');
  assert.ok(image.occurrenceId);
  assert.match(image.insertedAt, /^\d{4}-\d\d-\d\dT.*Z$/);
  assert.equal(f.host.outerHTML, originalDOM);
  assert.deepEqual(active, original);
});

test('dedicated resume API restores rich and image selections across entry/mode navigation without admitting stale upload tokens', (t) => {
  const f = setup(t);
  const entry = richEntry('resume-rich', '跨篇富文本选区');
  f.mount(entry);
  let writer = f.host.querySelector('.tiptap').editor;
  writer.commands.setTextSelection({ from: 2, to: 6 });
  const resume = JSON.parse(JSON.stringify(f.editor.captureResumePosition()));
  const upload = f.editor.captureMediaPosition(entry);
  const other = { id: 'resume-other-html', content: '<p>旧篇</p>', attachments: [] };
  f.mount(other);
  assert.equal(f.editor.restoreResumePosition(resume), false);
  f.mount(entry);
  assert.equal(f.editor.restoreResumePosition(resume), true);
  writer = f.host.querySelector('.tiptap').editor;
  assert.equal(writer.state.selection.anchor, 2);
  assert.equal(writer.state.selection.head, 6);
  assert.equal(f.editor.restorePosition(upload), false);
  const media = imageMedia('resume-image');
  f.c.library.media.push(media);
  f.editor.insertUploadedMedia(
    entry,
    media,
    null,
    '2026-10-16T00:00:00.000Z',
    'resume-image-occurrence',
  );
  let imageAt;
  writer.state.doc.descendants((node, at) => {
    if (node.type.name === 'image') imageAt = at;
  });
  writer.commands.setNodeSelection(imageAt);
  const imageResume = JSON.parse(JSON.stringify(f.editor.captureResumePosition()));
  f.mount(other);
  f.mount(entry);
  assert.equal(f.editor.restoreResumePosition(imageResume), true);
  assert.equal(f.editor.selectedImage().occurrenceId, 'resume-image-occurrence');
});

test('legacy HTML resume uses serializable DOM paths and text offsets after its original Range is detached', (t) => {
  const f = setup(t);
  const entry = {
    id: 'resume-legacy',
    content: '<p>前<span>中文🙂选区</span><br>尾</p>',
    attachments: [],
  };
  f.mount(entry);
  const doc = f.host.ownerDocument;
  const text = f.host.querySelector('span').firstChild;
  const selection = doc.getSelection();
  selection.setBaseAndExtent(text, 1, text, 5);
  const resume = JSON.parse(JSON.stringify(f.editor.captureResumePosition()));
  assert.equal(resume.format, 'html');
  assert.equal(resume.range, undefined);
  f.mount(richEntry('between-html-resume', '中间篇'));
  assert.equal(text.isConnected, false);
  f.mount(entry);
  assert.equal(f.editor.restoreResumePosition(resume), true);
  assert.equal(selection.anchorNode, f.host.querySelector('span').firstChild);
  assert.equal(selection.anchorOffset, 1);
  assert.equal(selection.focusOffset, 5);
  assert.equal(selection.toString(), '文🙂选');
  // Same text, changed wrapper structure: offsets provide a safe fallback.
  entry.content = '<p>前中文🙂选区<br>尾</p>';
  f.mount(entry);
  assert.equal(f.editor.restoreResumePosition(resume), true);
  assert.equal(selection.toString(), '文🙂选');
  assert.equal(f.editor.restoreResumePosition({ ...resume, entryId: 'wrong-entry' }), false);
});

test('Markdown resume keeps numeric selection after editor recreation and clamps to the current source', (t) => {
  const f = setup(t);
  const source = '虚构 Markdown 正文';
  const entry = {
    id: 'resume-markdown',
    contentFormat: 'markdown',
    markdownSource: source,
    content: '<p>虚构 Markdown 正文</p>',
    markdownHtml: '<p>虚构 Markdown 正文</p>',
    attachments: [],
  };
  f.mount(entry);
  assert.equal(
    f.editor.restoreResumePosition({ format: 'markdown', entryId: entry.id, anchor: 2, head: 7 }),
    true,
  );
  const resume = f.editor.captureResumePosition();
  assert.equal(resume.anchor, 2);
  assert.equal(resume.head, 7);
  f.mount(richEntry('between-markdown-resume', '中间篇'));
  f.mount(entry);
  assert.equal(f.editor.restoreResumePosition(JSON.parse(JSON.stringify(resume))), true);
  assert.equal(f.editor.captureResumePosition().anchor, 2);
  assert.equal(f.editor.captureResumePosition().head, 7);
  assert.equal(f.editor.restoreResumePosition({ ...resume, anchor: -10, head: 10000 }), true);
  assert.equal(f.editor.captureResumePosition().anchor, 0);
  assert.equal(f.editor.captureResumePosition().head, source.length);
});

test('video upload and existing attachment insertion use body media controls and keep occurrence identity on reopen', (t) => {
  const f = setup(t);
  const entry = richEntry('video-wrapper', '甲乙');
  const media = { id: 'fictional-local-video', name: '虚构视频.mp4', type: 'video/mp4' };
  entry.attachments = [media.id];
  f.c.library.media.push(media);
  f.mount(entry);
  const writer = f.host.querySelector('.tiptap').editor;
  writer.commands.setTextSelection(2);
  const position = f.editor.captureMediaPosition(entry);
  assert.equal(
    f.editor.insertUploadedMedia(
      entry,
      media,
      position,
      '2026-10-16T00:00:00.000Z',
      'video-upload-once',
    ),
    true,
  );
  assert.equal(
    f.editor.insertUploadedMedia(
      entry,
      media,
      position,
      '2026-10-16T00:00:00.000Z',
      'video-upload-once',
    ),
    true,
  );
  assert.equal(richMediaReferences(entry.body).length, 1);
  assert.equal(richImageReferences(entry.body).length, 0);
  assert.equal(f.editor.usesMedia(media.id), true);
  const video = f.host.querySelector('video');
  assert.ok(video);
  assert.equal(video.getAttribute('src'), '/media/' + media.id);
  assert.equal(video.controls, true);
  assert.equal(video.preload, 'metadata');
  assert.equal(video.autoplay, false);
  assert.equal(entry.body.content[0].content[0].text, '甲');
  assert.equal(entry.body.content.at(-1).content[0].text, '乙');
  let at;
  writer.state.doc.descendants((node, pos) => {
    if (node.type.name === 'video') at = pos;
  });
  writer.commands.setNodeSelection(at);
  f.c.$('#richImageLayout').click();
  f.c.$('#richImageWidth').value = '60';
  f.c.$('#richImageAlign').value = 'right';
  f.c.$('#richImageCaption').value = '视频图注';
  f.c.$('#applyRichImageLayout').click();
  const saved = structuredClone(richMediaReferences(entry.body)[0]);
  assert.equal(saved.type, 'video');
  assert.equal(saved.widthRatio, 0.6);
  assert.equal(saved.align, 'right');
  f.c.$('#insertRichAttachment').click();
  f.c.$(`[data-rich-attachment="${media.id}"]`).click();
  assert.equal(richMediaReferences(entry.body).length, 2);
  assert.deepEqual(richMediaReferences(entry.body)[0], saved);
  f.mount({ id: 'video-between-old', content: '<p>旧篇不改</p>', attachments: [] });
  f.mount(entry);
  assert.equal(f.host.querySelectorAll('video').length, 2);
  assert.deepEqual(richMediaReferences(entry.body)[0], saved);
});

test('slow video upload cannot insert into the newly selected diary', (t) => {
  const f = setup(t);
  const target = richEntry('slow-video-target', '原目标');
  const media = { id: 'slow-video', name: '虚构慢视频.mp4', type: 'video/mp4' };
  f.c.library.media.push(media);
  f.mount(target);
  const position = f.editor.captureMediaPosition(target);
  const other = richEntry('slow-video-other', '新篇正文');
  f.mount(other);
  const originalOther = structuredClone(other);
  assert.equal(
    f.editor.insertUploadedMedia(
      target,
      media,
      position,
      '2026-10-16T00:00:00.000Z',
      'slow-video-occurrence',
    ),
    true,
  );
  assert.deepEqual(other, originalOther);
  assert.equal(richMediaReferences(target.body)[0].type, 'video');
  assert.match(target.content, /<video/);
  assert.equal(f.host.querySelector('video'), null);
});

test('new video template keeps registered local body media while rejecting unregistered or autoplay HTML', (t) => {
  const f = setup(t, { richNewDocuments: true });
  f.c.library.media.push({ id: 'video-template', type: 'video/mp4', name: '虚构模板视频.mp4' });
  const next = f.editor.newDocument(
    '<p>之前</p><figure data-rich-video="old-template-occurrence" data-align="left" style="width:60%"><video src="/media/video-template" controls preload="metadata" playsinline aria-label="模板视频">模板视频</video><figcaption>视频图注</figcaption></figure><p>之后</p>',
  );
  const refs = richMediaReferences(next.body);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].type, 'video');
  assert.equal(refs[0].widthRatio, 0.6);
  assert.notEqual(refs[0].occurrenceId, 'old-template-occurrence');
  assert.equal(refs[0].alt, '模板视频');
  assert.throws(
    () =>
      f.editor.newDocument('<video src="https://example.invalid/external.mp4" controls></video>'),
    /模板.*未改变/,
  );
  assert.throws(
    () => f.editor.newDocument('<video src="/media/video-template" autoplay></video>'),
    /模板.*未改变/,
  );
});

test('reading projection is detached, sanitized and can return to original editable format without data writes', (t) => {
  const f = setup(t, { richNewDocuments: true });
  const entry = {
    id: 'legacy-reading-original',
    contentFormat: 'html',
    content: '<p>原文</p>',
    attachments: ['video'],
    revision: 1,
  };
  const before = structuredClone(entry);
  f.mount(entry);
  f.editor.renderReadingDocument(entry, {
    source: { id: entry.id, revision: 1 },
    html: '<p>图文阅读</p><video src="/media/video" autoplay controls></video><img src="https://invalid.test/remote.png" onerror="window.bad=true"><script>window.bad=true</script>',
  });
  assert.equal(f.editor.isReadingDocument, true);
  assert.equal(f.host.getAttribute('contenteditable'), 'false');
  assert.equal(f.host.querySelector('video').getAttribute('src'), '/media/video');
  assert.equal(f.host.querySelector('video').hasAttribute('autoplay'), false);
  assert.equal(f.host.querySelector('script'), null);
  assert.equal(f.host.querySelector('img'), null);
  assert.equal(f.editor.commit(), false);
  assert.equal(f.editor.command('bold'), true);
  f.editor.render(entry);
  assert.equal(f.editor.isReadingDocument, true);
  assert.deepEqual(entry, before);
  assert.equal(f.changed.length, 0);
  f.editor.exitReadingDocument(entry);
  assert.equal(f.editor.isReadingDocument, false);
  assert.equal(f.host.textContent, '原文');
  assert.equal(f.host.getAttribute('contenteditable'), 'true');
  assert.deepEqual(entry, before);
  f.editor.renderReadingDocument(entry, { source: { id: entry.id }, html: '<p>阅读</p>' });
  f.mount(richEntry('new-after-reading', '新文'));
  assert.equal(f.editor.isReadingDocument, false);
  assert.ok(f.host.querySelector('.tiptap'));
});
