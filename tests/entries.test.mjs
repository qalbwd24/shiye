import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { sample, fixture } from './helpers.mjs';
test('preferences, taxonomy and templates persist with history', async (t) => {
  const { request } = await fixture(t);
  const e = await (await request('/api/entries', 'POST', sample)).json();
  assert.equal(
    (await request('/api/preferences', 'PUT', { fontSize: 20, theme: 'dark', memoryPeriod: 6 }))
      .status,
    200,
  );
  await request('/api/taxonomy', 'POST', {
    kind: 'category',
    from: '学习',
    to: '研究',
    action: 'rename',
  });
  await request('/api/templates', 'POST', {
    name: '模板',
    content: '<p>开始</p>',
    category: '研究',
  });
  const lib = await (await request('/api/library')).json();
  assert.equal(lib.entries[0].category, '研究');
  assert.equal(lib.entries[0].history[0].category, '学习');
  assert.equal(lib.templates[0].name, '模板');
  assert.equal(lib.settings.preferences.fontSize, 20);
  assert.equal((await request('/api/entries/' + e.id, 'PUT', e)).status, 409);
});
test('Markdown source survives save and history; rich-text edits invalidate stale source', async (t) => {
  const { request } = await fixture(t);
  const e = await (
    await request('/api/entries', 'POST', {
      ...sample,
      content: '<h1>标题</h1>',
      markdownSource: '# 标题',
      markdownHtml: '<h1>标题</h1>',
    })
  ).json();
  assert.equal(e.markdownSource, '# 标题');
  const updated = await (
    await request('/api/entries/' + e.id, 'PUT', { ...e, content: '<p>新的正文</p>' })
  ).json();
  assert.equal(updated.markdownSource, null);
  assert.equal(updated.history[0].markdownSource, '# 标题');
});
test('save, revision conflict, recoverable trash, history and on-disk persistence', async (t) => {
  const { request, dir } = await fixture(t);
  const e = await (await request('/api/entries', 'POST', sample)).json();
  assert.equal(e.revision, 1);
  const saved = await (
    await request('/api/entries/' + e.id, 'PUT', { ...e, title: '修改后' })
  ).json();
  assert.equal(saved.revision, 2);
  assert.equal(saved.history[0].title, sample.title);
  assert.equal((await request('/api/entries/' + e.id, 'PUT', e)).status, 409);
  const trashed = await (
    await request('/api/entries/' + e.id, 'PUT', { ...saved, deleted: true })
  ).json();
  assert.equal(trashed.deleted, true);
  const restored = await (
    await request('/api/entries/' + e.id, 'PUT', { ...trashed, deleted: false })
  ).json();
  assert.equal(restored.deleted, false);
  const disk = JSON.parse(await fs.readFile(path.join(dir, 'diary.json'), 'utf8'));
  assert.equal(disk.entries[0].title, '修改后');
});
