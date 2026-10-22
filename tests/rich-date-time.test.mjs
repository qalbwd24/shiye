import test from 'node:test';
import assert from 'node:assert/strict';
import { mapRichBlock, richDateTimeInsertion } from '../public/editor/rich-date-time.js';

const stamp = '[2026/09/30  03:04:05]';
function element(name, ...children) {
  const node = {
    nodeType: 1,
    nodeName: name.toUpperCase(),
    childNodes: children,
    getAttribute: () => null,
  };
  for (const child of children) {
    child.parentNode = node;
    Object.defineProperty(child, 'previousSibling', {
      get: () => node.childNodes[node.childNodes.indexOf(child) - 1] || null,
      configurable: true,
    });
  }
  return node;
}
const text = (data) => ({ nodeType: 3, nodeName: '#text', data });
function range(node, offset, endNode = node, endOffset = offset) {
  return {
    startContainer: node,
    startOffset: offset,
    endContainer: endNode,
    endOffset,
    get collapsed() {
      return this.startContainer === this.endContainer && this.startOffset === this.endOffset;
    },
    cloneRange() {
      return range(this.startContainer, this.startOffset, this.endContainer, this.endOffset);
    },
    setStart(container, position) {
      this.startContainer = container;
      this.startOffset = position;
    },
    setEnd(container, position) {
      this.endContainer = container;
      this.endOffset = position;
    },
  };
}
function result(block, selection, options) {
  const map = mapRichBlock(block);
  const edit = richDateTimeInsertion(selection, block, stamp, options);
  const from = map.offsetAt(edit.range.startContainer, edit.range.startOffset);
  const to = map.offsetAt(edit.range.endContainer, edit.range.endOffset);
  return { edit, source: map.source.slice(0, from) + edit.insert + map.source.slice(to) };
}

test('BR mapping preserves real blank lines and ignores only the terminal placeholder', () => {
  const strongText = text('前文');
  const tail = text('　　');
  const block = element(
    'div',
    element('strong', strongText),
    element('br'),
    element('br'),
    tail,
    element('br'),
  );
  const map = mapRichBlock(block);
  assert.equal(map.source, '前文\n\n　　');
  assert.equal(map.offsetAt(tail, 2), map.source.length);
  const start = map.pointAt(4);
  assert.equal(map.offsetAt(start.node, start.offset), 4);
  assert.equal(mapRichBlock(element('p', element('br'))).source, '');
  assert.equal(
    mapRichBlock(element('div', text('前文'), element('br'), element('br'))).source,
    '前文\n',
  );
});

test('existing blank BR lines are reused without doubled separators or indentation', () => {
  for (const count of [1, 2]) {
    const tail = text('　　');
    const block = element(
      'div',
      element('strong', text('前文')),
      ...Array.from({ length: count }, () => element('br')),
      tail,
    );
    const { source } = result(block, range(tail, 2));
    assert.equal(source, '前文\n\n　　' + stamp + '\n　　');
    assert.equal(block.childNodes[0].nodeName, 'STRONG');
    assert.equal(tail.data, '　　', 'Planning does not mutate DOM or rich formatting');
  }
});

test('sentence middle uses the actual live range and paragraph end creates one separator', () => {
  const content = text('前文后文');
  const block = element('p', element('em', content));
  const selection = range(content, 2);
  const middle = result(block, selection);
  assert.equal(middle.source, '前文' + stamp + '后文');
  assert.equal(middle.edit.range.startContainer, content);
  assert.equal(middle.edit.range.startOffset, 2);
  assert.equal(selection.startOffset, 2);
  assert.equal(result(block, range(content, 4)).source, '前文后文\n\n　　' + stamp + '\n　　');
});

test('a blank native paragraph adds a separator after prose but not after another empty paragraph', () => {
  for (const previous of [element('p', text('前段')), text('前段'), element('img')]) {
    const indent = text('　　');
    const block = element('p', indent, element('br'));
    element('div', previous, text('\n  '), block);
    assert.equal(result(block, range(indent, 2)).source, '\n　　' + stamp + '\n　　');
  }
  const indent = text('　　');
  const block = element('p', indent, element('br'));
  element('div', element('p', text('前段')), element('p', element('br')), block);
  assert.equal(result(block, range(indent, 2)).source, '　　' + stamp + '\n　　');
});

test('media and nested blocks remain occupied barriers and are never selected for replacement', () => {
  const content = text('前文');
  const image = element('img');
  const block = element('div', content, image);
  const { edit, source } = result(block, range(content, 2));
  assert.equal(source, '前文' + stamp + '\uFFFC');
  assert.equal(edit.range.startContainer, content);
  assert.equal(edit.range.endContainer, content);
  assert.equal(block.childNodes[1], image);
  assert.equal(
    mapRichBlock(element('div', text('前文'), element('p', text('后段')))).source,
    '前文\uFFFC',
  );
});

test('selected text and semantic blocks remain one native inline replacement', () => {
  const content = text('甲乙丙丁');
  const block = element('p', content);
  assert.equal(result(block, range(content, 1, content, 3)).source, '甲' + stamp + '丁');
  assert.equal(result(block, range(content, 4), { inline: true }).source, '甲乙丙丁' + stamp);
  assert.equal(
    result(block, range(content, 4), { indent: '' }).source,
    '甲乙丙丁\n\n' + stamp + '\n',
  );
});

test('empty native paragraph can insert before a placeholder without clearing any DOM', () => {
  const placeholder = element('br');
  const block = element('p', placeholder);
  const { edit, source } = result(block, range(block, 0));
  assert.equal(source, '　　' + stamp + '\n　　');
  assert.equal(edit.range.startContainer, block);
  assert.equal(edit.range.startOffset, 0);
  assert.equal(edit.range.endOffset, 0);
  assert.equal(block.childNodes[0], placeholder);
});

test('the editor root never treats its toolbar sibling as preceding diary content', () => {
  const content = text('　　');
  const editor = element('div', content);
  element('section', element('nav', text('编辑工具')), editor);
  assert.equal(
    result(editor, range(content, 2), { includePreviousBlock: false }).source,
    '　　' + stamp + '\n　　',
  );
});

test('equal text offsets across formatting wrappers retain the actual caret node', () => {
  const normal = text('后文');
  const block = element('p', element('strong', text('加粗')), normal);
  const { edit, source } = result(block, range(normal, 0));
  assert.equal(source, '加粗' + stamp + '后文');
  assert.equal(edit.range.startContainer, normal);
  assert.equal(edit.range.endContainer, normal);
  assert.equal(edit.range.startOffset, 0);
});
