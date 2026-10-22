import { test } from 'node:test';
import assert from 'node:assert/strict';
import { revisitMarkdown } from '../src/server/domain/revisit-markdown.mjs';
import { presentRevisitSource } from '../src/server/domain/revisit/sources/presentation.mjs';
import { presentHistoryMessage } from '../previews/telegram-chat/shiye-revisit-view.js';
import { richBody, paragraph } from './helpers/revisit-source-fixtures.mjs';
const render = (body) => revisitMarkdown(body, { normalizeDiaryParagraphIndent: true });
test('diary bubbles remove Unicode/ASCII indentation after a leading timestamp without changing the source', () => {
  const body = richBody(
    paragraph('[2024/10/18 07:33:05]'),
    paragraph('　　第一段'),
    paragraph('\t\u00a0  第二段'),
  );
  const before = JSON.stringify(body);
  const source = presentRevisitSource({
    ref: {},
    entry: {},
    unit: { body, revision: 1, origin: { kind: 'diary' } },
  });
  const result = presentHistoryMessage({ source, originalAt: '2024-10-17T23:33:05.000Z' });
  assert.equal(result.message, '第一段\n\n第二段');
  assert.equal(JSON.stringify(body), before);
  assert.ok(source.html.includes('　　第一段'));
  assert.strictEqual(source.body, body);
});
test('indent split across marked text atoms is removed before emitting Markdown, interior spacing remains', () => {
  const body = richBody({
    type: 'paragraph',
    content: [
      { type: 'text', text: '　', marks: [{ type: 'bold' }] },
      { type: 'text', text: '\u2003\u00a0正文  内空格', marks: [{ type: 'italic' }] },
      { type: 'hardBreak' },
      { type: 'text', text: '\t续行' },
    ],
  });
  assert.equal(render(body), '*正文  内空格*\n续行');
});
test('embedded newlines normalize indentation; fenced and inline code retain their own spaces', () => {
  const body = richBody(
    paragraph('  第一行\n　　第二行'),
    { type: 'codeBlock', content: [{ type: 'text', text: '    code\n\tstill code' }] },
    {
      type: 'paragraph',
      content: [{ type: 'text', text: '  literal', marks: [{ type: 'code' }] }],
    },
  );
  assert.equal(render(body), '第一行\n第二行\n\n```\n    code\n\tstill code\n```\n\n`  literal`');
});
test('nested list, quote and table layouts are unchanged', () => {
  const body = richBody(
    { type: 'blockquote', content: [paragraph('　　引用原缩进')] },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [
            paragraph('列表'),
            { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('子项')] }] },
          ],
        },
      ],
    },
  );
  assert.equal(render(body), revisitMarkdown(body));
});
test('chat messages and the compatibility renderer retain intentional indentation', () => {
  const body = richBody(paragraph('开头'), paragraph('　　聊天缩进'));
  const source = presentRevisitSource({
    ref: {},
    entry: {},
    unit: { body, revision: 1, origin: { kind: 'chat' } },
  });
  assert.equal(source.markdown, '开头\n\n　　聊天缩进');
  assert.equal(render(body), '开头\n\n聊天缩进');
});
