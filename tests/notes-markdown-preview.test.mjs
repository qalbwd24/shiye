import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  describeNotesTextBlock,
  installNotesMarkdownPreview,
} from '../public/editor/notes-markdown-preview.js';
import { createRichEditor, richExtensions } from '../public/editor/rich-document-editor.js';
import { fromEditorJSON } from '../public/shared/rich-document.js';
import { getSchema } from '../public/vendor/rich-editor.js';

const paragraph = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

test('notes recognizes whole-block Markdown dividers without matching code or escaped text', () => {
  for (const source of ['---', '***', '___', '-----', '* * *', '  - - -  '])
    assert.equal(describeNotesTextBlock(paragraph(source)).kind, 'rule', source);
  for (const source of [
    '--',
    '- * -',
    '\\---',
    '`---`',
    '    ---',
    '\t---',
    '文字\n---',
    '---\n文字',
    '```\n---\n```',
  ])
    assert.equal(describeNotesTextBlock(paragraph(source)).kind, 'paragraph', source);
  assert.equal(describeNotesTextBlock({ type: 'horizontalRule' }).kind, 'rule');
});

test('notes heading descriptions agree for all six raw and native richdoc heading levels', () => {
  const schema = getSchema(richExtensions());
  for (let level = 1; level <= 6; level++) {
    const source = `${'#'.repeat(level)} 小任务 ${level} ###`;
    const raw = describeNotesTextBlock(paragraph(source));
    assert.equal(raw.level, level);
    assert.equal(raw.title, `小任务 ${level}`);
    const native = {
      type: 'heading',
      attrs: { level, blockId: `heading-${level}` },
      content: [{ type: 'text', text: `小任务 ${level}`, marks: [{ type: 'bold' }] }],
    };
    assert.deepEqual(describeNotesTextBlock(native), {
      kind: 'heading',
      level,
      title: `小任务 ${level}`,
      source: null,
    });
    assert.deepEqual(
      describeNotesTextBlock(schema.nodeFromJSON(native)),
      describeNotesTextBlock(native),
    );
  }
  assert.equal(describeNotesTextBlock(paragraph('#####没有空格')).kind, 'paragraph');
  assert.equal(describeNotesTextBlock(paragraph('####### 超过六级')).kind, 'paragraph');
  assert.equal(describeNotesTextBlock(paragraph('普通文字\n---')).kind, 'paragraph');
  assert.equal(
    describeNotesTextBlock({ type: 'codeBlock', content: paragraph('---').content }).kind,
    'other',
  );
});

function setup(t, content) {
  const dom = new JSDOM('<div class="note-editor"><div id="editor"></div></div>', {
    pretendToBeVisual: true,
  });
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
      value:
        typeof dom.window[key] === 'function' &&
        ['getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'].includes(key)
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
    enableInputRules: ['orderedList', 'bulletList', 'taskItem'],
    enablePasteRules: false,
  });
  const preview = installNotesMarkdownPreview(adapter.editor);
  t.after(() => {
    preview.destroy();
    adapter.destroy();
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return { adapter, editor: adapter.editor, dom };
}

test('notes divider preview keeps editable source, rich rules, media and block IDs intact', (t) => {
  const { editor, dom } = setup(t, [
    { ...paragraph('---'), attrs: { blockId: 'source-divider' } },
    { type: 'horizontalRule', attrs: { blockId: 'native-divider' } },
    { type: 'codeBlock', attrs: { blockId: 'code' }, content: paragraph('---').content },
    {
      type: 'paragraph',
      attrs: { blockId: 'hard-break' },
      content: [
        { type: 'text', text: '前文' },
        { type: 'hardBreak' },
        { type: 'text', text: '---' },
      ],
    },
    {
      type: 'image',
      attrs: {
        blockId: 'picture',
        assetId: 'synthetic-image',
        occurrenceId: 'occurrence-1',
        insertedAt: '2026-10-17T00:00:00Z',
        widthRatio: 0.6,
        align: 'left',
        caption: '图注',
        alt: '说明',
      },
    },
    { type: 'paragraph', attrs: { blockId: 'trailing-editable' } },
  ]);
  const before = editor.getJSON();
  const first = editor.view.dom.querySelector('p');
  assert.ok(first.classList.contains('notes-md-rule'));
  assert.equal(first.querySelector('.notes-md-marker').textContent, '---');
  assert.equal(editor.view.dom.querySelectorAll('hr').length, 1);
  assert.equal(editor.view.dom.querySelectorAll('.notes-md-rule').length, 1);
  assert.equal(editor.view.dom.querySelector('pre code').textContent, '---');
  const lastParagraph = editor.view.dom.querySelectorAll('p')[1];
  assert.equal(
    lastParagraph.querySelector('.notes-md-marker'),
    null,
    'Setext-shaped hard breaks must not hide the source marker',
  );
  editor.commands.setTextSelection(2);
  editor.view.dom.dispatchEvent(new dom.window.FocusEvent('focus'));
  assert.ok(first.classList.contains('notes-md-source'));
  assert.equal(first.querySelector('.notes-md-marker'), null);
  editor.view.dom.dispatchEvent(new dom.window.FocusEvent('blur'));
  assert.ok(first.classList.contains('notes-md-rule'));
  assert.deepEqual(editor.getJSON(), before, 'decorations must not rewrite the rich document');
});

test('notes renders native H5/H6 and reveals legacy heading source without dropping block IDs', async (t) => {
  const { editor, dom } = setup(t, [
    {
      type: 'heading',
      attrs: { level: 5, blockId: 'small-task' },
      content: paragraph('小任务').content,
    },
    {
      type: 'heading',
      attrs: { level: 6, blockId: 'small-section' },
      content: paragraph('小分区').content,
    },
    paragraph('##### 源码任务'),
  ]);
  assert.ok(editor.view.dom.querySelector('h5.notes-md-h5'));
  assert.ok(editor.view.dom.querySelector('h6.notes-md-h6'));
  assert.equal(editor.view.dom.querySelectorAll('.notes-md-h5').length, 2);
  editor.commands.setTextSelection(2);
  editor.view.dom.dispatchEvent(new dom.window.FocusEvent('focus'));
  await Promise.resolve();
  assert.equal(editor.getJSON().content[0].type, 'paragraph');
  assert.equal(editor.getJSON().content[0].attrs.blockId, 'small-task');
  assert.equal(editor.getJSON().content[0].content[0].text, '##### 小任务');
  editor.view.dom.dispatchEvent(new dom.window.FocusEvent('blur'));
  assert.ok(editor.view.dom.querySelector('p.notes-md-h5'));
});
