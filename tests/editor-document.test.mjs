import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getEditorDocument } from '../public/shared/editor-document.js';

test('editor document keeps legacy HTML byte-for-byte and refuses stale Markdown', () => {
  const content = '<p style="text-indent:2em">　旧正文 &amp; 字符</p>\r\n<img src="/media/test">';
  assert.deepEqual(getEditorDocument({ content }), { format: 'html', source: content });
  assert.deepEqual(
    getEditorDocument({ content, markdownSource: '# 旧源码', markdownHtml: '<h1>旧源码</h1>' }),
    { format: 'html', source: content },
  );
});

test('editor document infers older matching Markdown snapshots and accepts empty source', () => {
  const entry = {
    content: '<h1>标题</h1>',
    markdownHtml: '<h1>标题</h1>',
    markdownSource: '# 标题\n',
  };
  assert.deepEqual(getEditorDocument(entry), { format: 'markdown', source: '# 标题\n' });
  assert.deepEqual(getEditorDocument({ ...entry, contentFormat: 'html' }), {
    format: 'html',
    source: entry.content,
  });
  assert.deepEqual(getEditorDocument({ content: '', markdownHtml: '', markdownSource: '' }), {
    format: 'markdown',
    source: '',
  });
});
