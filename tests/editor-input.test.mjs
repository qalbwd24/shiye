import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createEditorInput,
  initialEditorContent,
  formatLocalDateTime,
  PARAGRAPH_INDENT,
  paragraphIndentIntent,
} from '../public/features/editor-input.js';
import { match } from '../public/shared/hotkeys.js';
import { fixture } from './helpers.mjs';

test('new blank diary defaults to exactly two ideographic spaces while template and explicit new preference win', () => {
  assert.equal(initialEditorContent(), '　　');
  assert.equal([...initialEditorContent()].length, 2);
  assert.equal(initialEditorContent('', { autoIndent: false }), PARAGRAPH_INDENT);
  assert.equal(initialEditorContent('', { autoIndentParagraph: false }), '');
  assert.equal(initialEditorContent('<p>template</p>'), '<p>template</p>');
  assert.equal(initialEditorContent(PARAGRAPH_INDENT), PARAGRAPH_INDENT);
});

test('date insertion uses local clock, brackets, padded fields and two spaces with Alt+T scope', () => {
  assert.equal(formatLocalDateTime(new Date(2026, 8, 14, 23, 15, 11)), '[2026/09/14  23:15:11]');
  assert.equal(formatLocalDateTime(new Date(2026, 0, 2, 3, 4, 5)), '[2026/01/02  03:04:05]');
  const key = { key: 't', code: 'KeyT', altKey: true };
  assert.equal(match(key, {}, true, true).id, 'datetime');
  assert.equal(match(key, {}, false, true), undefined);
  assert.equal(match(key, { datetime: null }, true, true), undefined);
  assert.equal(match({ ...key, isComposing: true }, {}, true, true), undefined);
});

test('paragraph intent excludes IME, shift line breaks, selection replacement and structural editing', () => {
  const input = { inputType: 'insertParagraph' };
  assert.equal(paragraphIndentIntent(input), true);
  for (const state of [
    { composing: true },
    { enterIntent: false },
    { semantic: true },
    { collapsed: false },
    { selectionInside: false },
    { enabled: false },
  ])
    assert.equal(paragraphIndentIntent(input, state), false);
  for (const event of [
    { ...input, isComposing: true },
    { ...input, keyCode: 229 },
    { ...input, defaultPrevented: true },
    { inputType: 'insertLineBreak' },
    { inputType: 'insertCompositionText' },
    { inputType: 'insertFromPaste' },
  ])
    assert.equal(paragraphIndentIntent(event), false);
});

class Target {
  handlers = new Map();
  addEventListener(type, fn) {
    this.handlers.set(type, [...(this.handlers.get(type) || []), fn]);
  }
  removeEventListener(type, fn) {
    this.handlers.set(
      type,
      (this.handlers.get(type) || []).filter((value) => value !== fn),
    );
  }
  emit(type, event = {}) {
    for (const fn of this.handlers.get(type) || []) fn(event);
  }
}
function editorSurface({ semantic = false, initial = '', prefix = '', suffix = '' } = {}) {
  const win = new Target(),
    doc = new Target(),
    editor = new Target();
  const block = {
    nodeType: 1,
    closest(selector) {
      return selector === 'p,div' || semantic ? this : null;
    },
  };
  const text = { nodeType: 3, parentElement: block };
  const range = { startContainer: text, endContainer: text, startOffset: 0, collapsed: true };
  const entry = { id: 'synthetic', content: initial };
  const commands = [];
  let dirty = 0;
  doc.defaultView = win;
  doc.getSelection = () => ({ rangeCount: 1, getRangeAt: () => range });
  doc.createRange = () => ({
    side: '',
    selectNodeContents() {},
    setEnd() {
      this.side = 'prefix';
    },
    setStart() {
      this.side = 'suffix';
    },
    toString() {
      return this.side === 'prefix' ? prefix : suffix;
    },
  });
  editor.ownerDocument = doc;
  editor.contains = (node) => node === text || node === block;
  editor.innerHTML = initial;
  doc.execCommand = (name, _ui, value) => {
    commands.push([name, value]);
    editor.innerHTML += value;
    return true;
  };
  const c = {
    $: () => editor,
    library: { settings: { preferences: {} } },
    current: () => entry,
    markDirty: () => dirty++,
    command: (name, value) => commands.push([name, value]),
  };
  const input = createEditorInput(c);
  return {
    win,
    doc,
    editor,
    entry,
    commands,
    c,
    input,
    get dirty() {
      return dirty;
    },
  };
}

test('date command escapes brackets only in Markdown and keeps rich text insertion literal', () => {
  const surface = editorSurface();
  surface.input.insertDateTime();
  assert.match(surface.commands[0][1], /^\[\d{4}\/\d{2}\/\d{2}  \d{2}:\d{2}:\d{2}\]$/);
  surface.c.editor = { isMarkdown: true };
  surface.input.insertDateTime();
  assert.match(surface.commands[1][1], /^\\\[\d{4}\/\d{2}\/\d{2}  \d{2}:\d{2}:\d{2}\\\]$/);
  assert.equal(surface.commands[1][0], 'insertText');
  surface.input.dispose();
});

test('normal Enter in blank body keeps native paragraph action, indents once and autosaves its resulting content', () => {
  const surface = editorSurface();
  surface.editor.emit('keydown', { key: 'Enter' });
  surface.editor.emit('beforeinput', { inputType: 'insertParagraph' });
  surface.editor.innerHTML = '<div><br></div>';
  surface.editor.emit('input', { inputType: 'insertParagraph' });
  assert.deepEqual(surface.commands, [['insertText', PARAGRAPH_INDENT]]);
  assert.equal(surface.entry.content, surface.editor.innerHTML);
  assert.equal(surface.dirty, 1);
  surface.editor.emit('input', { inputType: 'insertParagraph' });
  assert.equal(surface.commands.length, 1);
});

test('IME Enter and list/heading semantics remain native, and existing indentation is not doubled', () => {
  for (const options of [
    { semantic: true },
    { prefix: PARAGRAPH_INDENT },
    { suffix: PARAGRAPH_INDENT },
    { prefix: 'existing text' },
  ]) {
    const surface = editorSurface(options);
    surface.editor.emit('keydown', { key: 'Enter' });
    surface.editor.emit('beforeinput', { inputType: 'insertParagraph' });
    surface.editor.emit('input', { inputType: 'insertParagraph' });
    assert.equal(surface.commands.length, 0);
  }
  const surface = editorSurface();
  surface.editor.emit('compositionstart');
  surface.editor.emit('keydown', { key: 'Enter', keyCode: 229 });
  surface.editor.emit('compositionend');
  surface.editor.emit('beforeinput', { inputType: 'insertParagraph' });
  surface.editor.emit('input', { inputType: 'insertParagraph' });
  assert.equal(surface.commands.length, 0);
});

test('pending native input cannot indent a different diary and disposing removes event listeners', () => {
  const surface = editorSurface();
  surface.editor.emit('beforeinput', { inputType: 'insertParagraph' });
  surface.entry.id = 'different';
  surface.editor.emit('input', { inputType: 'insertParagraph' });
  assert.equal(surface.commands.length, 0);
  surface.input.dispose();
  surface.editor.emit('beforeinput', { inputType: 'insertParagraph' });
  surface.editor.emit('input', { inputType: 'insertParagraph' });
  assert.equal(surface.commands.length, 0);
});

test('paragraph indentation preference persists independently of the legacy setting and rejects non-booleans', async (t) => {
  const { request } = await fixture(t);
  assert.equal(
    (await request('/api/preferences', 'PUT', { autoIndent: false, autoIndentParagraph: true }))
      .status,
    200,
  );
  let preferences = (await (await request('/api/library')).json()).settings.preferences;
  assert.equal(preferences.autoIndent, false);
  assert.equal(preferences.autoIndentParagraph, true);
  assert.equal(
    (await request('/api/preferences', 'PUT', { autoIndentParagraph: false })).status,
    200,
  );
  assert.equal(
    (await request('/api/preferences', 'PUT', { autoIndentParagraph: 'false' })).status,
    400,
  );
  preferences = (await (await request('/api/library')).json()).settings.preferences;
  assert.equal(preferences.autoIndentParagraph, false);
});
