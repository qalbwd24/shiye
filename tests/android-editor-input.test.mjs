import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRichBodyAdapter } from '../public/editor/rich-body-adapter.js';
import { fromEditorJSON } from '../public/shared/rich-document.js';
import { installAndroidEditorInput } from '../android/app/src/main/assets/android-editor-input.js';

const p = (text) => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] });
function fixture(content = [p('正文')]) {
  const dom = new JSDOM('<div id="bodyEditor"></div><button>时间戳</button>', {
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
  let id = 0;
  const entry = {
    id: 'synthetic-entry',
    contentFormat: 'richdoc',
    body: fromEditorJSON({ type: 'doc', content }, () => `block-${++id}`),
  };
  const adapter = createRichBodyAdapter({
    $: (selector) => window.document.querySelector(selector),
    current: () => entry,
    library: { settings: { preferences: { autoIndentParagraph: true } } },
    markDirty() {},
  });
  adapter.render(entry);
  const messages = [];
  const helper = installAndroidEditorInput(adapter, { toast: (value) => messages.push(value) });
  const editor = adapter.editor;
  const input = (options = {}) => {
    const event = new window.InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertParagraph',
      ...options,
    });
    editor.view.dom.dispatchEvent(event);
    return event;
  };
  return {
    window,
    adapter,
    editor,
    helper,
    input,
    messages,
    close() {
      helper.destroy();
      adapter.dispose();
      dom.window.close();
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    },
  };
}

test('cancelable soft Enter reuses shared command, real indentation and one undo', () => {
  const f = fixture();
  try {
    f.editor.commands.setTextSelection(3);
    assert.equal(f.input().defaultPrevented, true);
    assert.equal(f.editor.state.doc.childCount, 2);
    assert.equal(f.editor.state.doc.child(1).textContent, '　　');
    f.editor.commands.undo();
    assert.equal(f.editor.getText(), '正文');
    assert.equal(f.editor.state.doc.childCount, 1);
  } finally {
    f.close();
  }
});

test('noncancelable Enter records intent without prematurely changing the document', () => {
  const f = fixture();
  try {
    f.editor.commands.setTextSelection(3);
    const before = f.editor.getJSON();
    assert.equal(f.input({ cancelable: false }).defaultPrevented, false);
    assert.deepEqual(f.editor.getJSON(), before);
  } finally {
    f.close();
  }
});

test('noncancelable native split adds indent in the same undo event, including sentence middle', () => {
  for (const at of [2, 3]) {
    const f = fixture([p('前段'), p('正文'), p('后段')]);
    try {
      const paragraphStart = f.editor.state.doc.child(0).nodeSize;
      f.editor.commands.setTextSelection(paragraphStart + at);
      const before = f.editor.getJSON();
      assert.equal(f.input({ cancelable: false }).defaultPrevented, false);
      // The actual shared editor's split command models the native split transaction.
      assert.equal(f.editor.commands.splitBlock(), true);
      assert.equal(f.editor.state.doc.childCount, 4);
      assert.equal(f.editor.state.doc.child(2).textContent, at === 2 ? '　　文' : '　　');
      assert.equal(f.editor.state.doc.child(0).textContent, '前段');
      assert.equal(f.editor.state.doc.child(3).textContent, '后段');
      f.editor.commands.undo();
      assert.deepEqual(
        f.editor.getJSON(),
        before,
        'one undo restores native split and helper indent',
      );
      f.editor.commands.redo();
      assert.equal(f.editor.state.doc.child(2).textContent, at === 2 ? '　　文' : '　　');
    } finally {
      f.close();
    }
  }
});

test('noncancelable split never repeats an existing indent', () => {
  const f = fixture([p('正　　文')]);
  try {
    f.editor.commands.setTextSelection(2);
    f.input({ cancelable: false });
    f.editor.commands.splitBlock();
    assert.equal(f.editor.state.doc.child(1).textContent, '　　文');
  } finally {
    f.close();
  }
});

test('noncancelable intent is consumed by unrelated changes and cannot indent a later split', () => {
  const f = fixture();
  try {
    f.editor.commands.setTextSelection(3);
    f.input({ cancelable: false });
    f.editor.commands.insertContent('别');
    f.editor.commands.splitBlock();
    assert.equal(f.editor.state.doc.child(0).textContent, '正文别');
    assert.equal(f.editor.state.doc.child(1).textContent, '');
  } finally {
    f.close();
  }
});

test('composition after noncancelable intent cancels the pending indent', () => {
  const f = fixture();
  try {
    f.editor.commands.setTextSelection(3);
    f.input({ cancelable: false });
    f.editor.view.dom.dispatchEvent(
      new f.window.CompositionEvent('compositionstart', { bubbles: true }),
    );
    f.editor.commands.splitBlock();
    assert.equal(f.editor.state.doc.child(1).textContent, '');
  } finally {
    f.close();
  }
});

test('noncancelable intent rejects a later caret move and an unrelated simultaneous edit', () => {
  const f = fixture([p('正文'), p('后段')]);
  try {
    f.editor.commands.setTextSelection(3);
    f.input({ cancelable: false });
    f.editor.commands.setTextSelection(2);
    f.editor.commands.splitBlock();
    assert.equal(f.editor.state.doc.child(1).textContent, '文');
    f.editor.commands.undo();
    f.editor.commands.setTextSelection(3);
    f.input({ cancelable: false });
    const tr = f.editor.state.tr.split(3);
    tr.insertText('别', tr.doc.content.size - 1);
    f.editor.view.dispatch(tr);
    assert.equal(f.editor.state.doc.child(1).textContent, '');
    assert.equal(f.editor.state.doc.child(2).textContent, '后段别');
  } finally {
    f.close();
  }
});

test('empty entry without focus and title focus use valid retained body TextSelection', () => {
  const f = fixture([p('')]);
  try {
    f.window.document.getSelection().removeAllRanges();
    assert.equal(
      f.helper.runAction(() => f.adapter.insertDateTime('[初始]')),
      true,
    );
    assert.match(f.editor.getText(), /初始/);
    f.editor.commands.setTextSelection(2);
    const title = f.window.document.createElement('input');
    title.value = '标题保持';
    f.window.document.body.append(title);
    title.focus();
    f.window.document.getSelection().removeAllRanges();
    const before = f.editor.getText();
    assert.equal(
      f.helper.runAction(() => f.adapter.command('insertText', '甲')),
      true,
    );
    assert.equal(f.editor.getText().length, before.length + 1);
    assert.equal(title.value, '标题保持');
  } finally {
    f.close();
  }
});

test('composition and the compositionend microtask never split or silently run actions', async () => {
  const f = fixture();
  try {
    const before = f.editor.getJSON();
    f.editor.view.dom.dispatchEvent(
      new f.window.CompositionEvent('compositionstart', { bubbles: true }),
    );
    assert.equal(f.input().defaultPrevented, false);
    let calls = 0;
    assert.equal(
      f.helper.runAction(() => calls++),
      false,
    );
    assert.match(f.messages.at(-1), /完成当前输入/);
    f.editor.view.dom.dispatchEvent(
      new f.window.CompositionEvent('compositionend', { bubbles: true }),
    );
    assert.equal(f.input().defaultPrevented, false);
    assert.equal(calls, 0);
    assert.deepEqual(f.editor.getJSON(), before);
    await Promise.resolve();
  } finally {
    f.close();
  }
});

test('lists, code and selected prose stay native', () => {
  for (const [content, position] of [
    [[{ type: 'bulletList', content: [{ type: 'listItem', content: [p('项目')] }] }], 3],
    [[{ type: 'codeBlock', content: [{ type: 'text', text: 'code' }] }], 2],
  ]) {
    const f = fixture(content);
    try {
      f.editor.commands.setTextSelection(position);
      const before = f.editor.getJSON();
      assert.equal(f.input().defaultPrevented, false);
      assert.deepEqual(f.editor.getJSON(), before);
    } finally {
      f.close();
    }
  }
  const f = fixture();
  try {
    f.editor.commands.setTextSelection({ from: 1, to: 3 });
    assert.equal(f.input().defaultPrevented, false);
    assert.equal(f.editor.getText(), '正文');
  } finally {
    f.close();
  }
});

test('physical Enter followed by beforeinput splits exactly once', () => {
  const f = fixture();
  try {
    f.editor.commands.setTextSelection(3);
    const key = new f.window.KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    f.editor.view.dom.dispatchEvent(key);
    assert.equal(key.defaultPrevented, true);
    assert.equal(f.input().defaultPrevented, true);
    assert.equal(f.editor.state.doc.childCount, 2);
    assert.equal(f.editor.state.doc.child(1).textContent, '　　');
  } finally {
    f.close();
  }
});

test('timestamp restores mapped toolbar position and releases tokens on success/destroy', () => {
  const f = fixture();
  try {
    let registered = 0;
    const capture = f.adapter.capturePosition.bind(f.adapter);
    const release = f.adapter.releasePosition.bind(f.adapter);
    f.adapter.capturePosition = () => {
      registered++;
      return capture();
    };
    f.adapter.releasePosition = (token) => {
      registered--;
      return release(token);
    };
    f.editor.commands.setTextSelection(2);
    f.adapter.focus();
    assert.equal(f.helper.capture(), true);
    assert.equal(registered, 1);
    // A document transaction while the toolbar owns the saved caret must map the token.
    f.editor.commands.insertContentAt(1, '甲');
    f.editor.commands.setTextSelection(1);
    f.window.document.querySelector('button').focus();
    assert.equal(
      f.helper.runAction(() => f.adapter.insertDateTime('[时间]')),
      true,
    );
    assert.equal(f.editor.getText(), '甲正[时间]文');
    assert.equal(registered, 0);
    f.adapter.focus();
    f.helper.capture();
    f.helper.capture();
    assert.equal(registered, 1);
    f.helper.destroy();
    assert.equal(registered, 0);
    assert.equal(
      f.helper.runAction(() => assert.fail('destroyed')),
      false,
    );
  } finally {
    f.close();
  }
});

test('Shift+Enter, read-only mode and missing token release never mutate through the helper', () => {
  const f = fixture();
  try {
    f.editor.commands.setTextSelection(2);
    const key = new f.window.KeyboardEvent('keydown', {
      key: 'Enter',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    f.editor.view.dom.dispatchEvent(key);
    const before = f.editor.getJSON();
    // Shared Shift+Enter may already insert a hard break; the helper adds nothing.
    assert.equal(f.input().defaultPrevented, key.defaultPrevented);
    assert.deepEqual(f.editor.getJSON(), before);
    f.editor.setEditable(false);
    assert.equal(
      f.helper.runAction(() => assert.fail('read-only action')),
      false,
    );
    f.editor.setEditable(true);
    f.adapter.focus();
    f.adapter.releasePosition = undefined;
    assert.equal(f.helper.capture(), false);
    assert.equal(
      f.helper.runAction(() => assert.fail('unreleasable token')),
      false,
    );
    assert.match(f.messages.at(-1), /点选正文/);
  } finally {
    f.close();
  }
});
