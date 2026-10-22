import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRichEditor } from '../public/editor/rich-document-editor.js';
import { fromEditorJSON } from '../public/shared/rich-document.js';
import { installNotesSmartIndent } from '../public/editor/notes-smart-indent.js';

const paragraph = (text = '') => ({
  type: 'paragraph',
  ...(text ? { content: [{ type: 'text', text }] } : {}),
});

function setup(t, content) {
  const dom = new JSDOM('<div id="editor"></div>', { pretendToBeVisual: true });
  const previous = new Map();
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
  ]) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: ['getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'].includes(key)
        ? dom.window[key].bind(dom.window)
        : dom.window[key],
    });
  }
  dom.window.Range.prototype.getClientRects = () => [];
  dom.window.Range.prototype.getBoundingClientRect = () => ({
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  });
  const adapter = createRichEditor(dom.window.document.querySelector('#editor'), {
    body: fromEditorJSON({ type: 'doc', content }),
    enableInputRules: false,
    enablePasteRules: false,
  });
  let enabled = true;
  const smart = installNotesSmartIndent(adapter.editor, { isEnabled: () => enabled });
  t.after(() => {
    smart.destroy();
    adapter.destroy();
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const key = (name, options = {}, onlySmart = false) => {
    const event = new dom.window.KeyboardEvent('keydown', {
      key: name,
      bubbles: true,
      cancelable: true,
      ...options,
    });
    if (onlySmart)
      return adapter.editor.state.plugins[0].props.handleKeyDown(adapter.editor.view, event);
    return adapter.editor.view.someProp('handleKeyDown', (handler) =>
      handler(adapter.editor.view, event),
    );
  };
  return {
    editor: adapter.editor,
    key,
    texts: () => adapter.editor.getJSON().content.map((node) => node.content?.[0]?.text || ''),
    enabled: (value) => (enabled = value),
  };
}

test('natural Chinese task indentation follows explicit colon and retains its prefix on Enter', (t) => {
  const { editor, key, texts } = setup(t, [paragraph('准备出行：')]);
  editor.commands.setTextSelection(6);
  assert.equal(key('Enter'), true);
  assert.deepEqual(texts(), ['准备出行：', '　　']);
  editor.commands.insertContent('收拾行李');
  assert.equal(key('Enter'), true);
  assert.deepEqual(texts(), ['准备出行：', '　　收拾行李', '　　']);
  assert.equal(key('Enter'), true);
  assert.deepEqual(texts(), ['准备出行：', '　　收拾行李', '']);
});

test('Enter splits text with exact mixed indentation and handles ASCII colons', (t) => {
  const { editor, key, texts } = setup(t, [paragraph('\t　 子任务后半'), paragraph('任务:')]);
  editor.commands.setTextSelection(7);
  assert.equal(key('Enter'), true);
  assert.deepEqual(texts().slice(0, 2), ['\t　 子任务', '\t　 后半']);
  const end = editor.state.doc.content.size - 1;
  editor.commands.setTextSelection(end);
  assert.equal(key('Enter'), true);
  assert.deepEqual(texts().slice(-2), ['任务:', '　　']);
});

test('Tab indents whole paragraphs from the middle and ShiftTab restores source and selection', (t) => {
  const { editor, key, texts } = setup(t, [paragraph('中文任务')]);
  editor.commands.setTextSelection(3);
  assert.equal(key('Tab'), true);
  assert.deepEqual(texts(), ['　　中文任务']);
  assert.equal(editor.state.selection.from, 5);
  assert.equal(key('Tab', { shiftKey: true }), true);
  assert.deepEqual(texts(), ['中文任务']);
  assert.equal(editor.state.selection.from, 3);
  assert.equal(key('Tab', { shiftKey: true }), true);
  assert.deepEqual(texts(), ['中文任务']);
});

test('multiple paragraph indentation is one reversible edit and keeps existing whitespace', (t) => {
  const { editor, key, texts } = setup(t, [paragraph('甲任务'), paragraph('  乙步骤')]);
  const before = editor.getJSON();
  editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 });
  assert.equal(key('Tab'), true);
  assert.deepEqual(texts(), ['　　甲任务', '　　  乙步骤']);
  assert.equal(editor.commands.undo(), true);
  assert.deepEqual(editor.getJSON(), before);
});

test('indent-only Enter dedents one level without adding empty paragraphs', (t) => {
  const { editor, key, texts } = setup(t, [paragraph('\t　　')]);
  editor.commands.setTextSelection(4);
  assert.equal(key('Enter'), true);
  assert.deepEqual(texts(), ['\t']);
  assert.equal(key('Enter'), true);
  assert.deepEqual(texts(), ['']);
});

test('empty paragraph Tab undoes as one source change', (t) => {
  const { editor, key, texts } = setup(t, [paragraph()]);
  editor.commands.setTextSelection(1);
  assert.equal(key('Tab'), true);
  assert.deepEqual(texts(), ['　　']);
  assert.equal(editor.commands.undo(), true);
  assert.deepEqual(texts(), ['']);
});

test('colon Enter undoes as one source change', (t) => {
  const { editor, key, texts } = setup(t, [paragraph('任务：')]);
  editor.commands.setTextSelection(4);
  const before = editor.getJSON();
  assert.equal(key('Enter'), true);
  assert.deepEqual(texts(), ['任务：', '　　']);
  assert.equal(editor.commands.undo(), true);
  assert.deepEqual(editor.getJSON(), before);
});

test('composition, modified keys, ShiftEnter and disabled mode leave base editor in charge', (t) => {
  const { editor, key, enabled } = setup(t, [paragraph('任务：')]);
  editor.commands.setTextSelection(4);
  const before = editor.getJSON();
  for (const options of [
    { isComposing: true },
    { keyCode: 229 },
    { ctrlKey: true },
    { altKey: true },
    { metaKey: true },
    { shiftKey: true },
  ])
    assert.equal(key('Enter', options, true), false);
  enabled(false);
  assert.equal(key('Tab', {}, true), false);
  assert.equal(key('Enter', {}, true), false);
  assert.deepEqual(editor.getJSON(), before);
});

test('headings, Markdown source headings, code, task lists and images retain existing handlers', (t) => {
  const image = {
    type: 'image',
    attrs: {
      assetId: 'synthetic',
      occurrenceId: 'occ-1',
      insertedAt: '2026-10-17T00:00:00Z',
      widthRatio: 0.4,
      align: 'left',
      caption: '图注',
      alt: '说明',
    },
  };
  const { editor, key } = setup(t, [
    { ...paragraph('原生标题'), type: 'heading', attrs: { level: 5 } },
    paragraph('##### 源码标题'),
    { ...paragraph('code:'), type: 'codeBlock' },
    {
      type: 'taskList',
      content: [{ type: 'taskItem', attrs: { checked: false }, content: [paragraph('任务：')] }],
    },
    image,
    paragraph('正文'),
  ]);
  const before = editor.getJSON();
  const positions = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.isTextblock && node.textContent !== '正文') positions.push(pos + 1);
  });
  for (const pos of positions) {
    editor.commands.setTextSelection(pos);
    assert.equal(key('Tab', {}, true), false);
    assert.equal(key('Enter', {}, true), false);
  }
  editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 });
  assert.equal(key('Tab', {}, true), false);
  assert.deepEqual(editor.getJSON(), before);
});
