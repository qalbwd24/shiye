import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sample, fixture } from './helpers.mjs';
import { validateEntry } from '../src/server/domain/entries.mjs';
import { entryFingerprint, remapEntryMedia } from '../src/server/domain/import-reconciliation.mjs';
import { encryptVault, decryptVault } from '../public/shared/vault.js';

test('Markdown edits retain exact legacy HTML, metadata and history through encrypted backup', async (t) => {
  const { request } = await fixture(t);
  const original = await (await request('/api/entries', 'POST', sample)).json();
  assert.equal(original.contentFormat, 'html');
  const converted = await (
    await request('/api/entries/' + original.id, 'PUT', {
      ...original,
      contentFormat: 'markdown',
      content: '<h1>新的标题</h1>',
      markdownHtml: '<h1>新的标题</h1>',
      markdownSource: '# 新的标题\n',
      editorOriginalHtml: '客户端不能覆盖原文',
    })
  ).json();
  assert.equal(converted.editorOriginalHtml, sample.content);
  assert.equal(converted.history[0].content, sample.content);
  assert.deepEqual(converted.tags, sample.tags);
  assert.equal(converted.date, sample.date);
  const { markdownSource, markdownHtml, contentFormat, editorOriginalHtml, ...olderClient } =
    converted;
  assert.equal(markdownSource, '# 新的标题\n');
  assert.equal(markdownHtml, converted.content);
  assert.equal(contentFormat, 'markdown');
  assert.equal(editorOriginalHtml, sample.content);
  const titled = await (
    await request('/api/entries/' + original.id, 'PUT', {
      ...olderClient,
      title: '只修改标题',
    })
  ).json();
  assert.equal(titled.markdownSource, '# 新的标题\n');
  assert.equal(titled.contentFormat, 'markdown');
  assert.equal(titled.editorOriginalHtml, sample.content);
  const edited = await (
    await request('/api/entries/' + original.id, 'PUT', {
      ...titled,
      content: '<p>新段落</p>',
      markdownHtml: '<p>新段落</p>',
      markdownSource: '新段落',
      editorOriginalHtml: '不应替换第一次转换时的原文',
    })
  ).json();
  assert.equal(edited.editorOriginalHtml, sample.content);
  assert.equal(edited.history[0].markdownSource, '# 新的标题\n');
  const bundle = await (await request('/api/bundle')).json();
  const restoredBundle = await decryptVault(
    await encryptVault(bundle, 'editor-synthetic-backup-password'),
    'editor-synthetic-backup-password',
  );
  const target = await fixture(t);
  assert.equal((await target.request('/api/restore', 'POST', restoredBundle)).status, 200);
  const library = await (await target.request('/api/library')).json();
  assert.equal(library.entries[0].markdownSource, '新段落');
  assert.equal(library.entries[0].editorOriginalHtml, sample.content);
  assert.equal(library.entries[0].history.at(-1).content, sample.content);
});

test('editor metadata rejects oversized snapshots and keeps legacy changes compatible', () => {
  assert.throws(() =>
    validateEntry({ ...sample, markdownSource: 'x'.repeat(2000001) }, { media: [] }),
  );
  assert.throws(() =>
    validateEntry({ ...sample, editorOriginalHtml: 'x'.repeat(2000001) }, { media: [] }),
  );
  assert.throws(() => validateEntry({ ...sample, contentFormat: 'unknown' }, { media: [] }));
  const previous = {
    ...sample,
    markdownSource: '旧源码',
    markdownHtml: sample.content,
    contentFormat: 'markdown',
  };
  const changed = validateEntry(
    { ...previous, content: '<p>富文本改动</p>' },
    { media: [] },
    previous,
  );
  assert.equal(changed.contentFormat, 'html');
  assert.equal(changed.markdownSource, null);
});

test('backup reconciliation normalizes missing format and remaps Markdown and original HTML media', () => {
  assert.equal(entryFingerprint(sample), entryFingerprint({ ...sample, contentFormat: 'html' }));
  const markdown = { ...sample, markdownSource: '**文本**', markdownHtml: sample.content };
  assert.equal(
    entryFingerprint(markdown),
    entryFingerprint({ ...markdown, contentFormat: 'markdown' }),
  );
  const entry = {
    content: '<img src="/media/old-id">',
    markdownHtml: '<img src="/media/old-id">',
    markdownSource: '![照片](/media/old-id)\n[照片]: /media/old-id',
    editorOriginalHtml: '<p><img src="/media/old-id"></p>',
    attachments: ['old-id'],
    history: [{ editorOriginalHtml: '<img src="/media/old-id">', attachments: ['old-id'] }],
  };
  const mapped = remapEntryMedia(entry, new Map([['old-id', 'new-id']]));
  assert.equal(mapped.markdownSource, '![照片](/media/new-id)\n[照片]: /media/new-id');
  assert.equal(mapped.editorOriginalHtml, '<p><img src="/media/new-id"></p>');
  assert.equal(mapped.history[0].editorOriginalHtml, '<img src="/media/new-id">');
  assert.equal(entry.attachments[0], 'old-id');
});
