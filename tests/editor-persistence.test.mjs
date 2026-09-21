import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPersistence } from '../public/editor/persistence.js';

test('metadata save preserves original HTML and omits historical/original copies from request', async () => {
  const entry = {
    id: 'old',
    title: 'new title',
    content: '<p style="text-align:center">旧格式</p>',
    history: [{ content: 'prior' }],
    editorOriginalHtml: 'original',
    revision: 1,
  };
  let payload;
  const persistence = createPersistence({
    current: () => entry,
    sanitize: () => 'lossy HTML',
    status() {},
    toast() {},
    onDirty() {},
    onSaved() {},
    api: async (_url, { data }) => {
      payload = data;
      return { revision: 2, history: [], updatedAt: 'now' };
    },
  });
  persistence.markDirty();
  await persistence.flush();
  assert.equal(payload.content, '<p style="text-align:center">旧格式</p>');
  assert.equal(payload.title, 'new title');
  assert.equal('history' in payload, false);
  assert.equal('editorOriginalHtml' in payload, false);
  assert.equal(entry.editorOriginalHtml, 'original');
});

test('Markdown save cleans the projection consistently while retaining the source', async () => {
  const entry = {
    id: 'markdown',
    contentFormat: 'markdown',
    markdownSource: '# 标题',
    content: '<h1>标题</h1>',
    markdownHtml: '<h1>标题</h1>',
  };
  let payload;
  const persistence = createPersistence({
    current: () => entry,
    sanitize: (html) => html + '\n',
    status() {},
    toast() {},
    onDirty() {},
    onSaved() {},
    api: async (_url, { data }) => {
      payload = data;
      return { revision: 2, history: [] };
    },
  });
  persistence.markDirty();
  await persistence.flush();
  assert.equal(payload.markdownSource, '# 标题');
  assert.equal(payload.content, payload.markdownHtml);
  assert.equal(payload.content, '<h1>标题</h1>\n');
});
