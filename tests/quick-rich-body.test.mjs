// Synthetic JSDOM editor transactions only; no diary API/native window/IME.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRichBodyAdapter } from '../public/editor/rich-body-adapter.js';
import { fromEditorJSON } from '../public/shared/rich-document.js';

function setup(preferences = {}, options = {}) {
  const dom = new JSDOM('<div id="bodyEditor" contenteditable="true">旧路径占位</div>', {
    url: 'http://127.0.0.1:18766/',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const originals = new Map();
  for (const key of [
    'window',
    'document',
    'navigator',
    'DOMParser',
    'HTMLElement',
    'Element',
    'Node',
    'MutationObserver',
    'getComputedStyle',
    'requestAnimationFrame',
    'cancelAnimationFrame',
  ]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: ['getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'].includes(key)
        ? window[key].bind(window)
        : window[key],
    });
  }
  window.Range.prototype.getClientRects = () => [];
  window.Range.prototype.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 0 });
  let entry,
    changes = 0,
    pauses = 0;
  const c = {
    $: (selector) => window.document.querySelector(selector),
    library: { settings: { preferences }, media: [] },
    current: () => entry,
    markDirty: () => changes++,
    pause: () => pauses++,
  };
  const adapter = createRichBodyAdapter(c, options);
  const set = (...content) => {
    let i = 0;
    entry = {
      id: 'fictional-' + ++set.count,
      contentFormat: 'richdoc',
      body: fromEditorJSON({ type: 'doc', content }, () => 'block-' + ++i),
      content: '',
    };
    adapter.render(entry);
    return entry;
  };
  set.count = 0;
  const key = (options = {}) => {
    const event = new window.KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
      ...options,
    });
    adapter.editor.view.dom.dispatchEvent(event);
    return event;
  };
  return {
    adapter,
    c,
    window,
    set,
    key,
    get entry() {
      return entry;
    },
    get changes() {
      return changes;
    },
    get pauses() {
      return pauses;
    },
    close() {
      adapter.dispose();
      dom.window.close();
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    },
  };
}
const p = (text = '', marks) => ({
  type: 'paragraph',
  content: text ? [{ type: 'text', text, ...(marks ? { marks } : {}) }] : [],
});
const stamp = '[2026/10/16  12:34:56]';

test('unchanged rich commits reuse immutable document conversion but detect in-place body edits', () => {
  const f = setup();
  try {
    f.set(p('合成正文'));
    // Mounting adds schema defaults; finish that existing normalization before
    // measuring commits whose serialized body is already unchanged.
    f.adapter.commit({ markDirty: false });
    f.adapter.render(f.entry);
    const e = f.adapter.editor;
    const getJson = e.getJSON.bind(e);
    let conversions = 0;
    e.getJSON = () => {
      conversions++;
      return getJson();
    };
    const canonical = structuredClone(f.entry.body);
    for (let i = 0; i < 10; i++) assert.equal(f.adapter.commit(), false);
    assert.equal(conversions, 0, 'the mount/update path already established the signature');
    const doc = e.state.doc;
    e.commands.setTextSelection(2);
    assert.equal(e.state.doc, doc);
    assert.equal(f.adapter.commit(), false);
    assert.equal(conversions, 0, 'selection changes do not reconvert an unchanged document');
    const changedBody = f.entry.body;
    changedBody.content[0].content[0].text = '原地外部修改';
    assert.equal(f.adapter.commit({ markDirty: false }), true);
    assert.deepEqual(f.entry.body, canonical);
    assert.notEqual(f.entry.body, changedBody);
    assert.equal(conversions, 0, 'restore uses a fresh object parsed from a private signature');
    assert.equal(f.changes, 0);
    assert.equal(f.adapter.commit(), false);
    e.commands.insertContent('编辑');
    assert.equal(conversions, 1, 'a changed editor document reconverts on update');
    assert.equal(f.entry.body.content[0].content[0].text, '合编辑成正文');
    assert.equal(f.adapter.commit(), false);
    assert.equal(conversions, 1);
    assert.equal(f.changes, 1);
  } finally {
    f.close();
  }
});

test('rich commit signatures cannot be mutated through callback entry bodies', () => {
  let callbacks = 0;
  const f = setup(
    {},
    {
      onChange(entry) {
        if (++callbacks === 1) entry.body.content[0].content[0].text = '回调外部修改';
      },
    },
  );
  try {
    f.set(p('原文'));
    f.adapter.editor.commands.setTextSelection(3);
    f.adapter.command('insertText', '编辑');
    assert.equal(f.entry.body.content[0].content[0].text, '回调外部修改');
    const callbackBody = f.entry.body;
    assert.equal(f.adapter.commit(), true);
    assert.equal(f.entry.body.content[0].content[0].text, '原文编辑');
    assert.notEqual(f.entry.body, callbackBody);
    callbackBody.content[0].content[0].text = '旧对象再次修改';
    assert.equal(f.adapter.commit(), false);
    assert.equal(f.entry.body.content[0].content[0].text, '原文编辑');
    assert.equal(callbacks, 2);
  } finally {
    f.close();
  }
});

test('rich commit cache resets on render, identity rebind and document remount', () => {
  const f = setup();
  try {
    f.set(p('第一篇'));
    f.adapter.commit({ markDirty: false });
    f.adapter.render(f.entry);
    const e = f.adapter.editor;
    const getJson = e.getJSON.bind(e);
    let conversions = 0;
    e.getJSON = () => {
      conversions++;
      return getJson();
    };
    assert.equal(f.adapter.commit(), false);
    const oldId = f.entry.id;
    f.entry.id = 'saved-fictional';
    assert.equal(f.adapter.syncIdentity(f.entry, oldId), true);
    const afterBind = conversions;
    assert.equal(f.adapter.commit(), false);
    assert.equal(conversions, afterBind + 1);
    f.adapter.render(f.entry);
    assert.equal(f.adapter.editor, e);
    const afterRender = conversions;
    assert.equal(f.adapter.commit(), false);
    assert.equal(conversions, afterRender, 'render updates can safely establish the new signature');
    f.set(p('第二篇'));
    assert.notEqual(f.adapter.editor, e);
    f.adapter.commit({ markDirty: false });
    assert.equal(f.adapter.commit(), false);
    assert.equal(f.entry.body.content[0].content[0].text, '第二篇');
  } finally {
    f.close();
  }
});

test('composition start invalidates rich commit cache even without a document change', async () => {
  const f = setup();
  try {
    f.set(p('未变化正文'));
    f.adapter.commit({ markDirty: false });
    f.adapter.render(f.entry);
    const e = f.adapter.editor;
    const getJson = e.getJSON.bind(e);
    let conversions = 0;
    e.getJSON = () => {
      conversions++;
      return getJson();
    };
    assert.equal(f.adapter.commit(), false);
    const doc = e.state.doc;
    e.view.dom.dispatchEvent(new f.window.CompositionEvent('compositionstart', { bubbles: true }));
    assert.equal(f.adapter.commit(), false);
    assert.equal(conversions, 0, 'composition guard still pauses explicit commits');
    e.view.dom.dispatchEvent(new f.window.CompositionEvent('compositionend', { bubbles: true }));
    await Promise.resolve();
    assert.equal(e.state.doc, doc);
    assert.equal(conversions, 1, 'composition end rebuilds the invalidated signature');
    assert.equal(f.adapter.commit(), false);
    assert.equal(conversions, 1);
    assert.equal(f.changes, 0);
  } finally {
    f.close();
  }
});

test('Tab inserts two Chinese spaces without the extended-hotkey switch and has its own undo step', () => {
  const f = setup({ autoIndentParagraph: false });
  try {
    f.set(p('正文'));
    const e = f.adapter.editor;
    e.commands.setTextSelection(1);
    assert.equal(f.key({ key: 'Tab' }).defaultPrevented, true);
    assert.equal(e.getText(), '　　正文');
    f.adapter.command('undo');
    assert.equal(e.getText(), '正文');
    f.adapter.command('redo');
    assert.equal(e.getText(), '　　正文');
    f.key({ key: 'Tab', shiftKey: true });
    assert.equal(e.getText(), '正文');
    assert.equal(f.key({ key: 'Tab', shiftKey: true }).defaultPrevented, true);
    assert.equal(e.getText(), '正文');
  } finally {
    f.close();
  }
});

test('selected paragraphs indent without replacing text, restore with Shift+Tab and preserve marks', () => {
  const f = setup();
  try {
    f.set(p('第一段', [{ type: 'bold' }]), p('第二段'));
    const e = f.adapter.editor;
    e.commands.setTextSelection({ from: 1, to: e.state.doc.content.size - 1 });
    f.key({ key: 'Tab' });
    assert.equal(e.getText(), '　　第一段\n\n　　第二段');
    assert.ok(f.entry.body.content[0].content.some((n) => n.marks?.some((m) => m.type === 'bold')));
    f.key({ key: 'Tab', shiftKey: true });
    assert.equal(e.getText(), '第一段\n\n第二段');
    e.commands.selectAll();
    f.key({ key: 'Tab' });
    assert.equal(e.getText(), '　　第一段\n\n　　第二段');
    f.key({ key: 'Tab', shiftKey: true });
    assert.equal(e.getText(), '第一段\n\n第二段');
    f.key({ key: 'End', ctrlKey: true });
    assert.equal(e.state.selection.empty, true);
    assert.equal(e.state.selection.from, e.state.doc.content.size - 1);
    f.key({ key: 'Home', ctrlKey: true, shiftKey: true });
    assert.equal(e.state.selection.from, 1);
    assert.equal(e.state.selection.to, e.state.doc.content.size - 1);
    f.set(p('    空格缩进'));
    f.adapter.editor.commands.setTextSelection(5);
    f.key({ key: 'Tab', shiftKey: true });
    assert.equal(f.adapter.editor.getText(), '空格缩进');
  } finally {
    f.close();
  }
});

test('Tab leaves IME, Ctrl+Tab, readonly content and media node selections untouched', () => {
  const f = setup();
  try {
    f.set(p('中文'));
    const e = f.adapter.editor;
    const before = e.state.doc;
    f.key({ key: 'Tab', isComposing: true });
    f.key({ key: 'Tab', keyCode: 229 });
    f.key({ key: 'Tab', ctrlKey: true });
    assert.equal(e.state.doc, before);
    f.entry.deleted = true;
    f.adapter.render(f.entry);
    f.key({ key: 'Tab' });
    assert.equal(e.state.doc, before);
  } finally {
    f.close();
  }
});

test('constructor/newDocument/dispose leave legacy DOM untouched; old entries never convert', () => {
  const f = setup();
  try {
    const host = f.c.$('#bodyEditor');
    const original = host.outerHTML;
    const next = f.adapter.newDocument('', true);
    assert.equal(next.contentFormat, 'richdoc');
    assert.equal(next.body.content[0].content[0].text, '　　');
    assert.throws(() => f.adapter.newDocument('<p>旧模板</p>'), /模板/);
    assert.equal(f.adapter.render({ id: 'old', content: '<p>旧文</p>' }), false);
    f.adapter.dispose();
    assert.equal(host.outerHTML, original);
  } finally {
    f.close();
  }
});

test('tail timestamp reuses logical lines, retains marks, and one undo isolates adjacent typing', () => {
  const f = setup();
  try {
    f.set(p('虚构前文', [{ type: 'bold' }]));
    const e = f.adapter.editor;
    e.commands.setTextSelection(e.state.doc.content.size - 1);
    f.adapter.command('insertText', '补充');
    const before = structuredClone(f.entry.body);
    f.adapter.insertDateTime(stamp);
    assert.equal(e.getText(), '虚构前文补充\n\n　　' + stamp + '\n　　');
    assert.ok(f.entry.body.content[0].content[0].marks.some((mark) => mark.type === 'bold'));
    assert.equal(f.changes, 2);
    f.adapter.command('undo');
    assert.deepEqual(f.entry.body, before);
    f.adapter.command('redo');
    assert.match(e.getText(), /12:34:56/);
    f.adapter.command('insertText', '后续');
    f.adapter.command('undo');
    assert.ok(e.getText().includes(stamp));
    assert.ok(!e.getText().includes('后续'));
  } finally {
    f.close();
  }
});

test('timestamp replaces selection or inserts in sentence, lists and code without splitting structure', () => {
  const f = setup();
  try {
    f.set(p('中文前后文', [{ type: 'italic' }]));
    const e = f.adapter.editor;
    e.commands.setTextSelection({ from: 3, to: 4 });
    f.adapter.insertDateTime(stamp);
    assert.equal(e.getText(), '中文' + stamp + '后文');
    assert.equal(f.entry.body.content.length, 1);
    f.set({ type: 'bulletList', content: [{ type: 'listItem', content: [p('项目')] }] });
    f.adapter.editor.commands.setTextSelection(5);
    f.adapter.insertDateTime(stamp);
    assert.equal(f.entry.body.content[0].type, 'bulletList');
    assert.equal(f.adapter.editor.state.doc.textContent, '项目' + stamp);
    f.set({ type: 'codeBlock', content: [{ type: 'text', text: 'example' }] });
    f.adapter.editor.commands.setTextSelection(4);
    f.adapter.insertDateTime(stamp);
    assert.equal(f.entry.body.content[0].type, 'codeBlock');
  } finally {
    f.close();
  }
});

test('empty/indented line and indent-off reuse spacing; Enter uses native structures and IME guards', async () => {
  const f = setup();
  try {
    f.set(p('前文'), p('　　'));
    let e = f.adapter.editor;
    e.commands.setTextSelection(e.state.doc.content.size - 1);
    f.adapter.insertDateTime(stamp);
    assert.equal(e.getText(), '前文\n\n\n　　' + stamp + '\n　　');
    f.set(p('　　虚构正文'));
    e = f.adapter.editor;
    e.commands.setTextSelection(e.state.doc.content.size - 1);
    assert.equal(f.key().defaultPrevented, true);
    assert.equal(e.state.doc.lastChild.textContent, '　　');
    assert.equal(f.adapter.atStart(), false);
    e.commands.setTextSelection(3);
    assert.equal(f.adapter.atStart(), true);
    const before = e.state.doc;
    assert.equal(f.key({ isComposing: true }).defaultPrevented, false);
    assert.equal(e.state.doc, before);
    e.view.dom.dispatchEvent(new f.window.CompositionEvent('compositionstart', { bubbles: true }));
    assert.equal(f.pauses, 1);
    assert.equal(f.adapter.composing, true);
    f.adapter.insertDateTime(stamp);
    assert.equal(e.state.doc, before);
    e.view.dom.dispatchEvent(new f.window.CompositionEvent('compositionend', { bubbles: true }));
    await Promise.resolve();
    f.c.library.settings.preferences.autoIndentParagraph = false;
    f.set(p('尾'));
    e = f.adapter.editor;
    e.commands.setTextSelection(2);
    f.adapter.insertDateTime(stamp);
    assert.equal(e.getText(), '尾\n\n' + stamp + '\n');
  } finally {
    f.close();
  }
});

test('divider preserves selected preceding prose; indented --- becomes rule without setext heading', () => {
  const f = setup();
  try {
    f.set(p('前文后文'));
    f.adapter.editor.commands.setTextSelection({ from: 1, to: 3 });
    f.adapter.command('insertHorizontalRule');
    assert.equal(f.adapter.editor.getText().replaceAll('\n', ''), '前文后文');
    assert.ok(f.entry.body.content.some((node) => node.type === 'horizontalRule'));
    f.set(p('保持普通段落'), p('　　---'));
    f.adapter.editor.commands.setTextSelection(f.adapter.editor.state.doc.content.size - 1);
    f.key();
    assert.equal(f.entry.body.content[0].type, 'paragraph');
    assert.equal(f.entry.body.content[0].content[0].text, '保持普通段落');
    assert.equal(f.entry.body.content[1].type, 'horizontalRule');
    assert.equal(f.entry.body.content[2].content[0].text, '　　');
    f.adapter.command('undo');
    assert.equal(f.entry.body.content[1].content[0].text, '　　---');
    f.set(p('普通前文不会变大'), p('--'));
    const e = f.adapter.editor;
    e.commands.setTextSelection(e.state.doc.content.size - 1);
    const at = e.state.selection.from;
    assert.equal(
      e.view.someProp('handleTextInput', (handler) => handler(e.view, at, at, '-')),
      true,
    );
    assert.equal(f.entry.body.content[0].type, 'paragraph');
    assert.equal(f.entry.body.content[1].type, 'horizontalRule');
  } finally {
    f.close();
  }
});

test('draft identity rebound preserves history/positions; uploaded image maps position and rejects stale document', () => {
  const f = setup();
  try {
    f.set(p('甲乙'));
    const e = f.adapter.editor;
    e.commands.setTextSelection(2);
    const position = f.adapter.capturePosition();
    e.commands.setTextSelection(1);
    f.adapter.command('insertText', '前');
    assert.equal(position.anchor, 3);
    const oldId = f.entry.id;
    f.entry.id = 'fictional-server-id';
    assert.equal(f.adapter.syncIdentity(f.entry, oldId), true);
    assert.equal(f.adapter.editor, e);
    assert.equal(position.entryId, 'fictional-server-id');
    assert.equal(
      f.adapter.insertImage(
        { assetId: 'fictional-image', insertedAt: '2026-10-16T00:00:00.000Z' },
        { position },
      ),
      true,
    );
    const image = f.entry.body.content.find((node) => node.type === 'image');
    assert.ok(image.attrs.occurrenceId);
    assert.equal(image.attrs.insertedAt, '2026-10-16T00:00:00.000Z');
    assert.equal(f.entry.body.content[0].content[0].text, '前甲');
    assert.equal(f.entry.body.content.at(-1).content[0].text, '乙');
    assert.equal(
      f.adapter.insertImage(
        { assetId: 'fictional-image-second', insertedAt: '2026-10-16T00:00:01.000Z' },
        { position },
      ),
      true,
    );
    assert.deepEqual(
      f.entry.body.content
        .filter((node) => node.type === 'image')
        .map((node) => node.attrs.assetId),
      ['fictional-image', 'fictional-image-second'],
    );
    assert.equal(f.adapter.releasePosition(position), true);
    assert.equal(f.adapter.restorePosition(position), false);
    const stale = f.adapter.capturePosition();
    f.set(p('另一篇'));
    assert.equal(f.adapter.insertImage({ assetId: 'fictional-image' }, { position: stale }), false);
    assert.equal(f.entry.body.content.length, 1);
  } finally {
    f.close();
  }
});

test('paste files use existing upload ownership; external HTML image sources are never loaded', async () => {
  const received = [];
  const f = setup(
    {},
    { onFiles: (files, entry, position) => received.push({ files, entry, position }) },
  );
  try {
    f.set(p('虚构正文'));
    const file = new File(['fictional'], 'fictional.png', { type: 'image/png' });
    const event = new f.window.Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { files: [file], getData: () => '' } });
    f.adapter.editor.view.dom.dispatchEvent(event);
    await Promise.resolve();
    assert.equal(event.defaultPrevented, true);
    assert.equal(received.length, 1);
    assert.ok(received[0].files instanceof Promise);
    const snapshotted = await received[0].files;
    assert.equal(snapshotted[0].name, file.name);
    assert.equal(await snapshotted[0].text(), 'fictional');
    assert.equal(received[0].entry, f.entry);
    assert.equal(received[0].position.entryId, f.entry.id);
    assert.equal(f.entry.body.content.length, 1, 'no upload/confirmation is bypassed');
    f.adapter.editor.commands.insertContent(
      '<p>文本<img src="https://example.invalid/tracker.png"></p>',
    );
    assert.equal(f.window.document.querySelectorAll('img').length, 0);
    assert.equal(
      f.entry.body.content.some((node) => node.type === 'image'),
      false,
    );
  } finally {
    f.close();
  }
});

test('projection/onChange use authoritative body and existing dirty queue; deleted entries stay read-only', () => {
  let projections = 0,
    notifications = 0;
  const f = setup(
    {},
    {
      renderProjection: (body) => {
        projections++;
        return '<p>' + body.content[0].content[0].text + '</p>';
      },
      onChange: () => notifications++,
    },
  );
  try {
    f.set(p('甲'));
    f.adapter.editor.commands.setTextSelection(2);
    f.adapter.command('insertText', '乙');
    assert.equal(f.entry.content, '<p>甲乙</p>');
    assert.equal(f.entry.body.content[0].content[0].text, '甲乙');
    assert.equal(f.changes, 1);
    assert.equal(projections, 1);
    assert.equal(notifications, 1);
    assert.equal(f.adapter.commit(), false);
    f.entry.deleted = true;
    f.adapter.render(f.entry);
    const before = structuredClone(f.entry.body);
    f.adapter.command('insertText', '不能插入');
    f.adapter.insertDateTime(stamp);
    assert.equal(f.adapter.insertImage({ assetId: 'fictional-image' }), false);
    assert.deepEqual(f.entry.body, before);
    assert.equal(f.adapter.editor.isEditable, false);
  } finally {
    f.close();
  }
});

test('list Enter and Shift+Enter remain native and never receive ordinary-paragraph indentation', () => {
  const f = setup();
  try {
    f.set({ type: 'bulletList', content: [{ type: 'listItem', content: [p('项目')] }] });
    f.adapter.editor.commands.setTextSelection(5);
    f.key();
    const list = f.entry.body.content[0];
    assert.equal(list.type, 'bulletList');
    assert.equal(list.content.length, 2);
    assert.equal(list.content[1].content[0].content?.length || 0, 0);
    f.set(p('普通正文'));
    f.adapter.editor.commands.setTextSelection(5);
    f.key({ shiftKey: true });
    assert.equal(f.entry.body.content.length, 1);
    assert.ok(f.entry.body.content[0].content.some((node) => node.type === 'hardBreak'));
    assert.equal(f.adapter.editor.state.doc.textContent.includes('　　'), false);
  } finally {
    f.close();
  }
});

test('same-entry rerender during composition and compositionend gap preserves live text and editor identity', async () => {
  const f = setup();
  try {
    f.set(p('虚构基线'));
    const e = f.adapter.editor;
    e.commands.setTextSelection(e.state.doc.content.size - 1);
    const savedBody = structuredClone(f.entry.body);
    e.view.dom.dispatchEvent(new f.window.CompositionEvent('compositionstart', { bubbles: true }));
    e.commands.insertContent('中文候选');
    assert.deepEqual(f.entry.body, savedBody, 'persistence is paused during composition');
    assert.equal(f.adapter.render(f.entry), true);
    assert.equal(f.adapter.editor, e);
    assert.equal(e.state.doc.textContent, '虚构基线中文候选');
    assert.equal(f.adapter.pendingConflict, null);
    e.view.dom.dispatchEvent(new f.window.CompositionEvent('compositionend', { bubbles: true }));
    f.adapter.render(f.entry);
    assert.equal(f.adapter.editor, e);
    await Promise.resolve();
    assert.equal(f.entry.body.content[0].content[0].text, '虚构基线中文候选');
    assert.equal(f.changes, 1);
    f.adapter.render(f.entry);
    assert.equal(f.adapter.editor, e);
    f.adapter.command('undo');
    assert.equal(e.state.doc.textContent, '虚构基线');
  } finally {
    f.close();
  }
});

test('external body change during IME remains an explicit conflict, never replayed on compositionend', async () => {
  const conflicts = [];
  const f = setup({}, { onConflict: (conflict) => conflicts.push(conflict) });
  try {
    f.set(p('基线'));
    const e = f.adapter.editor;
    e.commands.setTextSelection(3);
    e.view.dom.dispatchEvent(new f.window.CompositionEvent('compositionstart', { bubbles: true }));
    e.commands.insertContent('本地候选');
    const incoming = fromEditorJSON({ type: 'doc', content: [p('外部更新')] });
    f.entry.body = incoming;
    f.adapter.render(f.entry);
    assert.equal(f.adapter.editor, e);
    assert.equal(conflicts.length, 1);
    assert.equal(f.adapter.pendingConflict.reason, 'composition-render-conflict');
    assert.deepEqual(f.adapter.pendingConflict.incomingBody, incoming);
    assert.equal(
      f.adapter.resolveConflict('local'),
      false,
      'cannot resolve before composition completes',
    );
    e.commands.insertContent('完成');
    e.view.dom.dispatchEvent(new f.window.CompositionEvent('compositionend', { bubbles: true }));
    await Promise.resolve();
    assert.equal(e.state.doc.textContent, '基线本地候选完成');
    assert.deepEqual(f.entry.body, incoming, 'external snapshot also survives pending resolution');
    assert.throws(() => f.adapter.commit(), { code: 'RICH_BODY_COMPOSITION_CONFLICT' });
    assert.equal(f.changes, 0);
    f.adapter.render(f.entry);
    assert.equal(f.adapter.editor, e);
    assert.equal(
      f.adapter.pendingConflict.localBody.content[0].content[0].text,
      '基线本地候选完成',
    );
    assert.equal(f.adapter.resolveConflict('local'), true);
    assert.equal(f.adapter.pendingConflict, null);
    assert.equal(f.entry.body.content[0].content[0].text, '基线本地候选完成');
    assert.equal(f.changes, 1);
    assert.equal(f.adapter.editor, e);
  } finally {
    f.close();
  }
});

test('replacement entry object with same ID keeps composition selection until incoming is explicitly chosen', async () => {
  const f = setup();
  try {
    f.set(p('原文'));
    const e = f.adapter.editor;
    e.commands.setTextSelection(2);
    e.view.dom.dispatchEvent(new f.window.CompositionEvent('compositionstart', { bubbles: true }));
    e.commands.insertContent('候选');
    const selection = e.state.selection.toJSON();
    const incoming = {
      ...f.entry,
      body: fromEditorJSON({ type: 'doc', content: [p('传入版本')] }),
    };
    f.c.current = () => incoming;
    f.adapter.render(incoming);
    assert.equal(f.adapter.editor, e);
    assert.deepEqual(e.state.selection.toJSON(), selection);
    assert.equal(e.state.doc.textContent, '原候选文');
    e.view.dom.dispatchEvent(new f.window.CompositionEvent('compositionend', { bubbles: true }));
    await Promise.resolve();
    assert.throws(() => f.adapter.commit(), { code: 'RICH_BODY_COMPOSITION_CONFLICT' });
    assert.equal(f.adapter.resolveConflict('incoming'), true);
    assert.equal(f.adapter.pendingConflict, null);
    assert.equal(f.adapter.editor.state.doc.textContent, '传入版本');
    assert.deepEqual(incoming.body.content[0].content[0].text, '传入版本');
    assert.equal(f.changes, 0);
  } finally {
    f.close();
  }
});

test('selected image layout changes only that occurrence and survives reopen without rewriting media identity', () => {
  const f = setup();
  try {
    f.set(p('图文'));
    const insertedAt = '2026-10-16T00:00:00.000Z';
    f.adapter.insertImage({ assetId: 'fictional-shared', insertedAt });
    f.adapter.insertImage({ assetId: 'fictional-shared', insertedAt });
    const images = [];
    f.adapter.editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'image') images.push({ attrs: structuredClone(node.attrs), pos });
    });
    f.adapter.editor.commands.setNodeSelection(images[0].pos);
    assert.equal(f.adapter.selectedImage().occurrenceId, images[0].attrs.occurrenceId);
    assert.equal(
      f.adapter.updateSelectedImage({
        widthRatio: 0.1,
        align: 'right',
        caption: '<图注>🙂',
        alt: '独立替代文字',
      }),
      true,
    );
    const updated = f.entry.body.content.filter((node) => node.type === 'image');
    assert.equal(updated[0].attrs.widthRatio, 0.1);
    assert.equal(updated[0].attrs.align, 'right');
    assert.equal(updated[0].attrs.caption, '<图注>🙂');
    assert.equal(updated[0].attrs.alt, '独立替代文字');
    for (const key of ['assetId', 'blockId', 'occurrenceId', 'insertedAt'])
      assert.equal(updated[0].attrs[key], images[0].attrs[key]);
    assert.deepEqual(updated[1].attrs, images[1].attrs);
    const beforeInvalid = structuredClone(f.entry.body);
    assert.throws(() => f.adapter.updateSelectedImage({ assetId: 'not-allowed' }), /只允许/);
    assert.throws(() => f.adapter.updateSelectedImage({ widthRatio: 1.01 }), /排版/);
    assert.deepEqual(f.entry.body, beforeInvalid);
    f.adapter.dispose();
    f.adapter.render(f.entry);
    assert.deepEqual(f.entry.body, beforeInvalid);
    const figure = f.window.document.querySelector('figure[data-rich-image]');
    assert.equal(figure.style.width, '10%');
    assert.equal(figure.dataset.align, 'right');
    assert.equal(figure.querySelector('figcaption').textContent, '<图注>🙂');
    assert.equal(
      f.adapter.updateSelectedImage(
        { widthRatio: 1 },
        { occurrenceId: images[0].attrs.occurrenceId },
      ),
      true,
    );
    assert.equal(f.entry.body.content.find((node) => node.type === 'image').attrs.widthRatio, 1);
  } finally {
    f.close();
  }
});

test('inserting an attachment after a selected image preserves existing occurrences and maps batch order', () => {
  const f = setup();
  try {
    f.set(p('原文字'));
    f.adapter.insertImage({
      assetId: 'fictional-shared',
      occurrenceId: 'original-one',
      insertedAt: '2026-10-16T00:00:00.000Z',
    });
    f.adapter.insertImage({
      assetId: 'fictional-shared',
      occurrenceId: 'original-two',
      insertedAt: '2026-10-16T00:00:01.000Z',
    });
    const originals = f.entry.body.content
      .filter((node) => node.type === 'image')
      .map((node) => structuredClone(node.attrs));
    let firstAt;
    f.adapter.editor.state.doc.descendants((node, at) => {
      if (node.attrs.occurrenceId === 'original-one') firstAt = at;
    });
    f.adapter.editor.commands.setNodeSelection(firstAt);
    const position = f.adapter.capturePosition();
    assert.equal(position.selectionType, 'node');
    assert.equal(f.adapter.restorePosition(position), true);
    assert.equal(f.adapter.selectedImage().occurrenceId, 'original-one');
    assert.equal(
      f.adapter.insertImage(
        { assetId: 'fictional-shared', occurrenceId: 'new-three' },
        { position },
      ),
      true,
    );
    let images = f.entry.body.content
      .filter((node) => node.type === 'image')
      .map((node) => node.attrs);
    assert.equal(images.length, 3);
    assert.deepEqual(
      images.find((image) => image.occurrenceId === 'original-one'),
      originals[0],
    );
    assert.deepEqual(
      images.find((image) => image.occurrenceId === 'original-two'),
      originals[1],
    );
    assert.deepEqual(
      images.map((image) => image.occurrenceId),
      ['original-one', 'new-three', 'original-two'],
    );
    assert.equal(
      f.adapter.insertImage(
        { assetId: 'fictional-shared', occurrenceId: 'new-four' },
        { position },
      ),
      true,
    );
    images = f.entry.body.content.filter((node) => node.type === 'image').map((node) => node.attrs);
    assert.deepEqual(
      images.map((image) => image.occurrenceId),
      ['original-one', 'new-three', 'new-four', 'original-two'],
    );
    f.adapter.releasePosition(position);
    f.adapter.editor.commands.setNodeSelection(firstAt);
    assert.equal(
      f.adapter.insertImage({ assetId: 'fictional-shared', occurrenceId: 'direct-five' }),
      true,
    );
    images = f.entry.body.content.filter((node) => node.type === 'image').map((node) => node.attrs);
    assert.equal(images.length, 5);
    assert.equal(images[1].occurrenceId, 'direct-five');
    assert.deepEqual(
      images.find((image) => image.occurrenceId === 'original-one'),
      originals[0],
    );
    assert.deepEqual(
      images.find((image) => image.occurrenceId === 'original-two'),
      originals[1],
    );
  } finally {
    f.close();
  }
});

test('resume snapshots survive remount independently of upload bookmark identity and clamp safely', () => {
  const f = setup();
  try {
    const original = f.set(p('跨篇恢复选区'));
    f.adapter.editor.commands.setTextSelection({ from: 2, to: 5 });
    const resume = JSON.parse(JSON.stringify(f.adapter.captureResumePosition()));
    const upload = f.adapter.capturePosition();
    f.set(p('另一篇'));
    assert.equal(f.adapter.restoreResumePosition(resume), false);
    f.c.current = () => original;
    f.adapter.render(original);
    assert.equal(f.adapter.restorePosition(upload), false);
    assert.equal(f.adapter.restoreResumePosition(resume), true);
    assert.equal(f.adapter.editor.state.selection.anchor, 2);
    assert.equal(f.adapter.editor.state.selection.head, 5);
    assert.equal(f.adapter.restoreResumePosition({ ...resume, anchor: -100, head: 100000 }), true);
    assert.equal(f.adapter.editor.state.selection.from, 1);
    assert.equal(
      f.adapter.editor.state.selection.to,
      original.body.content[0].content[0].text.length + 1,
    );
    assert.equal(f.adapter.restoreResumePosition({ ...resume, anchor: NaN }), false);
    assert.equal(
      f.adapter.insertImage({ assetId: 'fictional-image' }, { position: resume }),
      false,
    );
  } finally {
    f.close();
  }
});

test('body video insertion preserves surrounding text, safe playback controls, layout and resume identity', async () => {
  const f = setup();
  try {
    const { renderRichDocument } = await import('../public/shared/rich-document-renderer.js');
    const entry = f.set(p('甲乙'));
    f.adapter.editor.commands.setTextSelection(2);
    const position = f.adapter.capturePosition();
    assert.equal(
      f.adapter.insertMedia(
        {
          assetId: 'fictional-video',
          occurrenceId: 'video-at-cursor',
          insertedAt: '2026-10-16T00:00:00.000Z',
          caption: '<视频图注>',
          alt: '虚构视频',
        },
        { type: 'video', position },
      ),
      true,
    );
    const body = entry.body;
    assert.equal(body.content[0].content[0].text, '甲');
    assert.equal(body.content.at(-1).content[0].text, '乙');
    const videoNode = body.content.find((node) => node.type === 'video');
    let videoAt;
    f.adapter.editor.state.doc.descendants((node, at) => {
      if (node.type.name === 'video') videoAt = at;
    });
    f.adapter.editor.commands.setNodeSelection(videoAt);
    assert.equal(f.adapter.selectedImage(), null);
    assert.equal(f.adapter.selectedMedia().type, 'video');
    assert.equal(
      f.adapter.updateSelectedMedia({
        widthRatio: 0.4,
        align: 'left',
        caption: '新图注',
        alt: '新说明',
      }),
      true,
    );
    assert.equal(f.adapter.updateSelectedImage({ widthRatio: 0.2 }), false);
    const resume = f.adapter.captureResumePosition();
    const video = f.window.document.querySelector('video');
    assert.equal(video.getAttribute('src'), '/media/fictional-video');
    assert.equal(video.controls, true);
    assert.equal(video.preload, 'metadata');
    assert.equal(video.autoplay, false);
    assert.equal(video.hasAttribute('autoplay'), false);
    assert.equal(video.parentElement.style.width, '40%');
    assert.equal(video.parentElement.dataset.align, 'left');
    f.adapter.editor.commands.setTextSelection(1);
    video.dispatchEvent(new f.window.MouseEvent('click', { bubbles: true }));
    assert.equal(f.adapter.selectedMedia().type, 'video');
    assert.equal(
      f.window.document.querySelector('video'),
      video,
      'selection never recreates active playback element',
    );
    const html = renderRichDocument(entry.body);
    assert.match(html, /<video[^>]* controls preload="metadata"/);
    assert.ok(!html.includes('autoplay'));
    f.set(p('切到别篇'));
    f.c.current = () => entry;
    f.adapter.render(entry);
    assert.equal(f.adapter.restoreResumePosition(resume), true);
    assert.equal(f.adapter.selectedMedia().occurrenceId, videoNode.attrs.occurrenceId);
    assert.equal(f.adapter.selectedMedia().insertedAt, '2026-10-16T00:00:00.000Z');
    assert.equal(f.window.document.querySelectorAll('video').length, 1);
  } finally {
    f.close();
  }
});

test('video resolver and clipboard HTML cannot fetch arbitrary external media', () => {
  const f = setup({}, { resolveAsset: () => 'https://example.invalid/remote.mp4' });
  try {
    f.set(p('本地正文'));
    f.adapter.insertMedia({ assetId: 'fictional-video' }, { type: 'video' });
    assert.equal(f.window.document.querySelector('video'), null);
    assert.ok(f.c.$('#bodyEditor').textContent.includes('视频原件缺失'));
    f.adapter.editor.commands.insertContent(
      '<video src="https://example.invalid/injected.mp4" autoplay controls></video>',
    );
    assert.equal(f.window.document.querySelector('video'), null);
    assert.equal(f.entry.body.content.filter((node) => node.type === 'video').length, 1);
  } finally {
    f.close();
  }
});
