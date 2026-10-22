import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { deriveNotesStructure, installNotesStructure } from '../public/editor/notes-structure.js';
import { createRichEditor } from '../public/editor/rich-document-editor.js';
import { fromEditorJSON } from '../public/shared/rich-document.js';

const paragraph = (text, id) => ({
  type: 'paragraph',
  attrs: { blockId: id },
  content: [{ type: 'text', text }],
});
const heading = (text, level, id) => ({
  ...paragraph(text, id),
  type: 'heading',
  attrs: { level, blockId: id },
});
const doc = (...content) => ({ type: 'doc', content });

test('notes outline preserves actual H5/H6 hierarchy for source and native headings', () => {
  const body = doc(
    paragraph('##### 第一项', 'first'),
    paragraph('普通正文', 'text'),
    heading('子步骤', 6, 'child'),
    paragraph('子步骤内容', 'details'),
    paragraph('##### 第二项', 'second'),
  );
  const before = structuredClone(body);
  const entries = deriveNotesStructure(body);
  assert.deepEqual(
    entries.map(({ id, level, parentId }) => ({ id, level, parentId })),
    [
      { id: 'first', level: 5, parentId: null },
      { id: 'child', level: 6, parentId: 'first' },
      { id: 'second', level: 5, parentId: null },
    ],
  );
  assert.equal(entries[0].foldTo, entries[2].pos);
  assert.equal(entries[1].foldTo, entries[2].pos);
  assert.equal(deriveNotesStructure(body), entries, 'immutable documents reuse parsed structure');
  assert.deepEqual(body, before);
  assert.equal(
    deriveNotesStructure(
      doc(
        paragraph('##### 带媒体的任务', 'media-section'),
        { type: 'image' },
        { type: 'horizontalRule' },
      ),
    ).length,
    1,
    'richdoc JSON leaf nodes are valid structure input',
  );
});

test('indent outline is optional and reads relative spaces, full width spaces and tabs', () => {
  const body = doc(
    paragraph('##### 分区', 'section'),
    paragraph('主任务', 'parent'),
    paragraph('  子步骤', 'child'),
    paragraph('\t小步骤', 'grandchild'),
    paragraph('　另一子步骤', 'sibling'),
    paragraph('后续任务', 'next'),
  );
  assert.deepEqual(
    deriveNotesStructure(body).map((entry) => entry.id),
    ['section'],
  );
  const outline = deriveNotesStructure(body, { includeIndented: true });
  assert.deepEqual(
    outline.map((entry) => [entry.id, entry.parentId, entry.level]),
    [
      ['section', null, 5],
      ['parent', 'section', 6],
      ['child', 'parent', 7],
      ['grandchild', 'child', 8],
      ['sibling', 'parent', 7],
      ['next', 'section', 6],
    ],
  );
  assert.equal(
    outline[1].foldTo,
    body.content.slice(0, 5).reduce((n, p) => n + p.content[0].text.length + 2, 0),
  );
  assert.equal(body.content[2].content[0].text, '  子步骤');
});

test('an intentional indentation group retains leaf root tasks while unindented prose stays out', () => {
  const body = doc(
    paragraph('学习', 'study'),
    paragraph('　阅读', 'reading'),
    paragraph('购物', 'shopping'),
  );
  const entries = deriveNotesStructure(body, { includeIndented: true });
  assert.deepEqual(
    entries.map(({ id, parentId }) => [id, parentId]),
    [
      ['study', null],
      ['reading', 'study'],
      ['shopping', null],
    ],
  );
  assert.equal(entries[2].foldFrom, entries[2].end);
  assert.equal(entries[2].foldTo, entries[2].end, 'a leaf root has no collapsible region');
  assert.deepEqual(
    deriveNotesStructure(doc(paragraph('普通正文', 'prose'), paragraph('接着写作', 'more')), {
      includeIndented: true,
    }),
    [],
  );
});

function setup(t, body) {
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
    body: fromEditorJSON(body),
    enableInputRules: false,
    enablePasteRules: false,
  });
  let folded = [];
  const structure = installNotesStructure(adapter.editor, {
    getFoldedIds: () => folded,
    onFoldChange: (ids) => {
      folded = ids;
    },
  });
  t.after(() => {
    structure.destroy();
    adapter.destroy();
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return { editor: adapter.editor, structure, folded: () => folded };
}

test('heading and nested task folds hide view nodes while preserving source and image metadata', async (t) => {
  const { editor, structure, folded } = setup(
    t,
    doc(
      paragraph('##### 任务分区', 'section'),
      {
        type: 'taskList',
        attrs: { blockId: 'tasks' },
        content: [
          {
            type: 'taskItem',
            attrs: { blockId: 'parent-task', checked: false },
            content: [
              paragraph('主任务', 'task-label'),
              {
                type: 'taskList',
                attrs: { blockId: 'children' },
                content: [
                  {
                    type: 'taskItem',
                    attrs: { blockId: 'child-task', checked: true },
                    content: [paragraph('子任务', 'child-label')],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        type: 'image',
        attrs: {
          blockId: 'image',
          assetId: 'synthetic-image',
          occurrenceId: 'occ-1',
          insertedAt: '2026-10-17T00:00:00Z',
          widthRatio: 0.4,
          align: 'left',
          caption: '图注',
          alt: '说明',
        },
      },
      heading('下一分区', 5, 'next-section'),
      { type: 'paragraph', attrs: { blockId: 'trailing-editable' } },
    ),
  );
  const before = editor.getJSON();
  const tasks = structure.getEntries({ includeIndented: true });
  assert.equal(tasks.find((entry) => entry.id === 'child-task').parentId, 'parent-task');
  structure.toggle('parent-task');
  assert.deepEqual(folded(), ['parent-task']);
  assert.ok(editor.view.dom.querySelector('ul.notes-fold-hidden'), editor.view.dom.innerHTML);
  assert.equal(editor.view.dom.querySelector('li p').textContent.includes('主任务'), true);
  const child = tasks.find((entry) => entry.id === 'child-task');
  editor.commands.setTextSelection(child.anchorPos);
  await Promise.resolve();
  assert.deepEqual(folded(), [], 'moving the caret into hidden content expands its parent');
  structure.toggle('section');
  assert.deepEqual(folded(), ['section']);
  assert.ok(editor.view.dom.querySelector('figure.notes-fold-hidden'));
  assert.ok(
    editor.state.selection.from < tasks[0].foldFrom,
    'collapsing moves a hidden caret to the heading',
  );
  structure.reveal(child.anchorPos);
  assert.deepEqual(folded(), []);
  assert.deepEqual(editor.getJSON(), before, 'fold/reveal never rewrites body or media attributes');
});

function mockMotion(editor, { reduced = false, broken = false } = {}) {
  const view = editor.view.dom.ownerDocument.defaultView;
  const animations = [];
  view.matchMedia = () => ({ matches: reduced });
  view.HTMLElement.prototype.getBoundingClientRect = function () {
    return { height: this.classList.contains('notes-fold-hidden') ? 0 : 36 };
  };
  view.HTMLElement.prototype.animate = function (frames, options) {
    if (broken) throw new Error('Synthetic incomplete WAAPI host');
    let finish;
    const animation = {
      element: this,
      frames,
      options,
      cancelled: false,
      finished: new Promise((resolve) => {
        finish = resolve;
      }),
      finish: () => finish(),
      cancel() {
        this.cancelled = true;
        finish();
      },
    };
    animations.push(animation);
    return animation;
  };
  return animations;
}

const motionBody = () =>
  doc(
    paragraph('##### 计划', 'section'),
    paragraph('第一步', 'step'),
    paragraph('  子步骤', 'child-step'),
    heading('下一个计划', 5, 'next-section'),
    { type: 'paragraph', attrs: { blockId: 'trailing-editable' } },
  );

test('fold widgets keep their SVG identity and refresh state and labels from the current document', (t) => {
  const { editor, structure } = setup(t, motionBody());
  const button = editor.view.dom.querySelector('[data-fold-id="section"]');
  const svg = button.querySelector('svg');
  assert.equal(button.dataset.folded, 'false');
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  assert.equal(button.getAttribute('aria-label'), '折叠 计划');
  structure.toggle('section');
  assert.equal(editor.view.dom.querySelector('[data-fold-id="section"]'), button);
  assert.equal(button.querySelector('svg'), svg);
  assert.equal(button.dataset.folded, 'true');
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.equal(button.getAttribute('aria-label'), '展开 计划');
  editor.commands.insertContentAt(structure.getEntries()[0].anchorPos + 6, '新');
  assert.equal(editor.view.dom.querySelector('[data-fold-id="section"]'), button);
  assert.equal(button.getAttribute('aria-label'), '展开 新计划');
  assert.equal(button.title, '展开 新计划');
  structure.toggle('section');
  assert.equal(editor.view.dom.querySelector('[data-fold-id="section"]'), button);
  assert.equal(button.querySelector('svg'), svg);
  assert.equal(button.dataset.folded, 'false');
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  assert.equal(button.title, '折叠 新计划');
});

test('fold buttons use a text-free SVG and closing motion completes before hiding source blocks', async (t) => {
  const { editor, structure, folded } = setup(t, motionBody());
  const animations = mockMotion(editor);
  const before = editor.getJSON();
  const button = editor.view.dom.querySelector('.notes-fold-toggle');
  assert.equal(button.textContent, '');
  assert.equal(button.querySelector('svg path').getAttribute('d'), 'M6 3.5 10.5 8 6 12.5');
  structure.toggle('section');
  assert.deepEqual(folded(), ['section'], 'the persisted target updates immediately');
  assert.equal(editor.view.dom.querySelectorAll('.notes-fold-hidden').length, 0);
  assert.equal(animations.length, 2);
  assert.equal(animations[0].options.duration, 180);
  assert.equal(animations[0].frames.at(-1).height, '0px');
  for (const animation of animations) animation.finish();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(editor.view.dom.querySelectorAll('.notes-fold-hidden').length, 2);
  assert.ok(animations.every((animation) => animation.cancelled));
  assert.deepEqual(editor.getJSON(), before);
});

test('a quick fold reversal cancels prior motion without leaving hidden content or inline styles', async (t) => {
  const { editor, structure, folded } = setup(t, motionBody());
  const animations = mockMotion(editor);
  const before = editor.getJSON();
  structure.toggle('section');
  const closing = [...animations];
  structure.toggle('section');
  assert.deepEqual(folded(), []);
  assert.ok(closing.every((animation) => animation.cancelled));
  const opening = animations.slice(closing.length);
  assert.ok(opening.length > 0);
  await Promise.resolve();
  await Promise.resolve();
  assert.ok(
    opening.every((animation) => !animation.cancelled),
    'old completion cannot cancel reversal',
  );
  for (const animation of opening) animation.finish();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(editor.view.dom.querySelectorAll('.notes-fold-hidden').length, 0);
  assert.equal(editor.view.dom.querySelector('[style*="height"]'), null);
  assert.deepEqual(editor.getJSON(), before);
});

test('revealing a selection or editing during motion safely finishes the presentation transition', async (t) => {
  const { editor, structure, folded } = setup(t, motionBody());
  const animations = mockMotion(editor);
  structure.toggle('section');
  const first = [...animations];
  structure.reveal(
    structure.getEntries({ includeIndented: true }).find((e) => e.id === 'step').pos,
  );
  assert.deepEqual(folded(), []);
  assert.ok(first.every((animation) => animation.cancelled));
  assert.equal(editor.view.dom.querySelectorAll('.notes-fold-hidden').length, 0);
  structure.toggle('section');
  const second = animations.slice(first.length);
  editor.commands.insertContentAt(structure.getEntries()[0].anchorPos + 6, '新增');
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(folded(), ['section']);
  assert.ok(second.every((animation) => animation.cancelled));
  assert.equal(editor.view.dom.querySelectorAll('.notes-fold-hidden').length, 2);
});

test('reduced motion and incomplete animation hosts fall back to an immediate usable fold', (t) => {
  const { editor, structure } = setup(t, motionBody());
  const animations = mockMotion(editor, { reduced: true });
  structure.toggle('section');
  assert.equal(animations.length, 0);
  assert.equal(editor.view.dom.querySelectorAll('.notes-fold-hidden').length, 2);
  structure.toggle('section');
  assert.equal(editor.view.dom.querySelectorAll('.notes-fold-hidden').length, 0);
  mockMotion(editor, { broken: true });
  assert.doesNotThrow(() => structure.toggle('section'));
  assert.equal(editor.view.dom.querySelectorAll('.notes-fold-hidden').length, 2);
});
