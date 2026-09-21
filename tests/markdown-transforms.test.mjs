import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marked } from '../public/vendor/marked.js';
import {
  transformMarkdown,
  paragraphEnter,
  blockMarkdownEdit,
  markdownStructureEnter,
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

test('structure Enter turns auto-indented thematic markers into separate blocks', () => {
  for (const marker of ['---', '***', '___', '- - -', '* * *', '_ _ _']) {
    const source = `　　前一段\n　　${marker}`;
    const transaction = markdownStructureEnter(source, source.length, source.length);
    const result = apply(source, transaction);
    assert.equal(result, `　　前一段\n\n${marker}\n\n　　`, marker);
    assert.deepEqual(transaction.selection, { anchor: result.length, head: result.length });
    assert.equal(transaction.from, source.indexOf('\n') + 1);
    assert.match(marked.parse(result), /<hr>/);
    assert.doesNotMatch(marked.parse(result), /<h2>/);
  }
  for (const marker of ['---', '***', '___']) {
    assert.equal(
      apply(marker, markdownStructureEnter(marker, marker.length, marker.length)),
      `${marker}\n\n　　`,
    );
    const source = `前段\n\n　　${marker}\n后段`;
    const cursor = source.lastIndexOf('\n');
    const transaction = markdownStructureEnter(source, cursor, cursor, false);
    assert.equal(apply(source, transaction), `前段\n\n${marker}\n\n\n后段`);
    assert.equal(transaction.selection.anchor, `前段\n\n${marker}\n\n`.length);
  }
  const setext = '已有标题\n---';
  assert.equal(markdownStructureEnter(setext, setext.length, setext.length), null);
  assert.match(marked.parse(setext), /<h2>已有标题<\/h2>/);
});

test('recovered noninitial ordered list parses as a list after prose', () => {
  const source = '　　正文\n　　9. 项目';
  const transaction = markdownStructureEnter(source, source.length, source.length);
  const result = apply(source, transaction);
  assert.equal(result, '　　正文\n\n9. 项目\n10. ');
  assert.match(marked.parse(result), /<ol start="9">/);
});

test('structure Enter removes exactly the active automatic prefix and continues Markdown blocks', () => {
  const samples = [
    ['　　## 标题', '## 标题\n　　'],
    ['　　- 项目', '- 项目\n- '],
    ['　　9. 项目', '9. 项目\n10. '],
    ['　　2) 项目', '2) 项目\n3) '],
    ['　　- [x] 完成', '- [x] 完成\n- [ ] '],
    ['　　> 引用', '> 引用\n> '],
    ['　　>> 引用', '>> 引用\n>> '],
    ['　　```js', '```js\n'],
    ['　　~~~text', '~~~text\n'],
    ['　　- ', '　　'],
    ['　　> ', '　　'],
  ];
  for (const [line, expected] of samples) {
    const source = `　　保持前文\n\n${line}\n原有后文`;
    const cursor = source.lastIndexOf('\n');
    const transaction = markdownStructureEnter(source, cursor, cursor);
    assert.equal(apply(source, transaction), `　　保持前文\n\n${expected}\n原有后文`, line);
    assert.equal(transaction.selection.anchor, `　　保持前文\n\n${expected}`.length);
  }
  const heading = '　　# 标题';
  assert.equal(
    apply(heading, markdownStructureEnter(heading, heading.length, heading.length, false)),
    '# 标题\n',
  );
});

test('structure Enter leaves prose, existing Markdown, selections, and mid-line Enter unchanged', () => {
  for (const line of [
    '　　中文正文',
    '　　---正文',
    '　　#标签',
    '　　___text',
    '　　**强调**',
    '　　　---',
    '# 标题',
    '- 项目',
    '> 引用',
    '```js',
  ])
    assert.equal(markdownStructureEnter(line, line.length, line.length), null, line);
  const source = '　　---\n　　# 标题';
  assert.equal(markdownStructureEnter(source, 0, source.length), null);
  assert.equal(markdownStructureEnter('　　# 标题后半', 5, 5), null);
  assert.equal(paragraphEnter('　　中文正文', 6, 6).insert, '\n　　');
});

test('structure Enter does not rewrite fenced or indented code examples', () => {
  for (const prefix of ['```md', '~~~md', '> ```md', '- ```md', '````md\n```']) {
    const source = `${prefix}\n　　---`;
    assert.equal(markdownStructureEnter(source, source.length, source.length), null, prefix);
    assert.equal(paragraphEnter(source, source.length, source.length), null, prefix);
  }
  for (const line of ['   　　---', '   　　# 标题', '   　　- 项目', '\t　　---', '　　    ---'])
    assert.equal(markdownStructureEnter(line, line.length, line.length), null, line);
  const invalidClose = '```md\n```still code\n　　---';
  assert.equal(
    markdownStructureEnter(invalidClose, invalidClose.length, invalidClose.length),
    null,
  );
  assert.equal(paragraphEnter(invalidClose, invalidClose.length, invalidClose.length), null);
  for (const example of ['- ```', '> ```']) {
    const source = `\`\`\`md\n${example}\n　　---`;
    assert.equal(markdownStructureEnter(source, source.length, source.length), null);
  }
  const closed = '```md\nexample\n```\n\n　　---';
  assert.equal(
    apply(closed, markdownStructureEnter(closed, closed.length, closed.length)),
    '```md\nexample\n```\n\n---\n\n　　',
  );
  const closing = '```md\nexample\n```';
  assert.equal(markdownStructureEnter(closing, closing.length, closing.length), null);
});

test('explicit horizontal-rule command separates adjacent prose and replaces only the selection', () => {
  assert.equal(
    apply('前后', transformMarkdown('前后', 1, 1, 'insertHorizontalRule')),
    '前\n\n---\n\n后',
  );
  assert.equal(apply('待替换', transformMarkdown('待替换', 0, 3, 'insertHorizontalRule')), '---');
});
