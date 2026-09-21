import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  transformMarkdown,
  paragraphEnter,
  blockMarkdownEdit,
} from '../public/editor/markdown-transforms.js';

const apply = (source, transaction) =>
  source.slice(0, transaction.from) + transaction.insert + source.slice(transaction.to);

test('block fragment insertion separates headings from neighboring prose without growing blank lines', () => {
  const markdown = '## 模板小节\n\n记录**重点**';
  const end = blockMarkdownEdit('[日期]', 4, 4, markdown);
  assert.equal(apply('[日期]', end), `[日期]\n\n${markdown}`);
  const middle = blockMarkdownEdit('前待替换后', 1, 4, markdown);
  assert.equal(apply('前待替换后', middle), `前\n\n${markdown}\n\n后`);
  assert.equal(middle.selection.anchor, 3 + markdown.length);
  assert.equal(middle.selection.head, middle.selection.anchor);
  for (const gap of ['\n', '\n\n', '\n\n\n']) {
    const source = `前${gap}后`;
    const point = 1 + gap.length;
    const transaction = blockMarkdownEdit(source, point, point, markdown);
    assert.equal(apply(source, transaction), `前${gap.length < 2 ? '\n\n' : gap}${markdown}\n\n后`);
  }
  assert.equal(blockMarkdownEdit('', 0, 0, markdown).insert, markdown);
  assert.equal(blockMarkdownEdit('旧内容', 0, 3, markdown).insert, markdown);
});

test('Markdown emphasis toggles selected contents and preserves Unicode positions', () => {
  const source = '今天🙂晴天';
  const bold = transformMarkdown(source, 2, 4, 'bold');
  assert.equal(apply(source, bold), '今天**🙂**晴天');
  assert.deepEqual(bold.selection, { anchor: 4, head: 6 });
  const remove = transformMarkdown(apply(source, bold), 4, 6, 'bold');
  assert.equal(apply(apply(source, bold), remove), source);
  assert.equal(transformMarkdown('**重点**', 0, 6, 'bold').insert, '重点');
  assert.deepEqual(transformMarkdown('', 0, 0, 'italic').selection, { anchor: 1, head: 1 });
  const nested = transformMarkdown('**重点**', 2, 4, 'italic');
  assert.equal(apply('**重点**', nested), '***重点***');
  assert.equal(apply('***重点***', transformMarkdown('***重点***', 3, 5, 'italic')), '**重点**');
});

test('list commands affect whole selected lines but exclude a following line at the selection boundary', () => {
  const source = '　　第一项\n第二项\n下一段';
  const transaction = transformMarkdown(source, 2, 10, 'insertOrderedList');
  assert.equal(apply(source, transaction), '1. 第一项\n2. 第二项\n下一段');
  const list = '1. 苹果\n2. 香蕉';
  assert.equal(
    transformMarkdown(list, 0, list.length, 'insertUnorderedList').insert,
    '- 苹果\n- 香蕉',
  );
  assert.equal(transformMarkdown(list, 0, list.length, 'insertOrderedList').insert, '苹果\n香蕉');
  assert.equal(transformMarkdown('', 0, 0, 'insertUnorderedList').insert, '- ');
});

test('links reject executable schemes and colors cannot escape their HTML attribute', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,x', 'https://site/\nnext'])
    assert.equal(transformMarkdown('文字', 0, 2, 'createLink', url), null);
  assert.equal(
    transformMarkdown('[文字]', 0, 4, 'createLink', 'https://example.com/(a)').insert,
    '[\\[文字\\]](<https://example.com/%28a%29>)',
  );
  assert.equal(transformMarkdown('颜色', 0, 2, 'foreColor', 'red" onclick="alert(1)'), null);
  assert.equal(
    transformMarkdown('颜色', 0, 2, 'foreColor', '#aaccee').insert,
    '<span style="color:#aaccee">颜色</span>',
  );
});

test('block commands toggle headings, replace quote syntax, and clear explicit selected formatting', () => {
  assert.equal(transformMarkdown('正文', 0, 2, 'formatBlock', 'h2').insert, '## 正文');
  assert.equal(transformMarkdown('## 正文', 3, 5, 'formatBlock', 'h2').insert, '正文');
  assert.equal(transformMarkdown('> 引用', 2, 4, 'formatBlock', '<p>').insert, '引用');
  const source = '## **重点**和<u>下划线</u>';
  assert.equal(transformMarkdown(source, 0, source.length, 'removeFormat').insert, '重点和下划线');
  assert.equal(transformMarkdown('正文', 0, 2, 'unknown'), null);
});

test('plain paragraph Enter indents once, while semantic blocks and selections use native Markdown behavior', () => {
  assert.equal(paragraphEnter('　　今天', 4, 4).insert, '\n　　');
  assert.equal(paragraphEnter('第一段　　后半段', 3, 3).insert, '\n');
  assert.equal(paragraphEnter('正文', 2, 2, false), null);
  assert.equal(paragraphEnter('正文', 0, 2), null);
  for (const line of [
    '# 标题',
    '> 引用',
    '- 列表',
    '1. 列表',
    '    代码',
    '\t代码',
    '| 表格 |',
    '---',
    '```js',
    '<table>',
  ])
    assert.equal(paragraphEnter(line, line.length, line.length), null, line);
  const fenced = '```js\nconst value = 1;';
  assert.equal(paragraphEnter(fenced, fenced.length, fenced.length), null);
  const afterFence = '~~~js\ncode\n~~~\n正文';
  assert.equal(paragraphEnter(afterFence, afterFence.length, afterFence.length).insert, '\n　　');
});
