import test from 'node:test';
import assert from 'node:assert/strict';
import { createExport } from '../public/features/export.js';

test('structured UI export uses live selected data, preserves source and excludes private metadata', async () => {
  const entry = {
    id: 'sample',
    revision: 1,
    title: '合成测试',
    date: '2026-09-30T00:00:00Z',
    content: '<p>格式</p>',
    category: '测试',
    tags: [],
    attachments: [],
    legacy: { secret: true },
    history: ['private'],
    comments: [{ id: 'c', body: '评论' }],
  };
  let library = { entries: [entry], media: [] };
  const controls = new Map();
  const $ = (id) => {
    if (!controls.has(id)) controls.set(id, {});
    return controls.get(id);
  };
  const downloads = [];
  let flushed = false;
  const c = {
    $,
    escape: String,
    modal: () => {},
    toast: () => {},
    textOf: String,
    sanitize: String,
    flush: async () => {
      flushed = true;
    },
    get library() {
      return library;
    },
    current: () => library.entries[0],
    filtered: () => library.entries,
    download: (...args) => downloads.push(args),
  };
  await createExport(c).exportMenu();
  assert.equal(flushed, true);
  $('#exportScope').value = 'all';
  library = {
    ...library,
    entries: [
      { ...entry, title: '最新标题' },
      { ...entry, id: 'hidden', hidden: true },
      { ...entry, id: 'draft', draft: true },
      { ...entry, id: 'deleted', deleted: true },
    ],
  };
  $('#exportJson').onclick();
  const data = JSON.parse(downloads[0][2]);
  assert.equal(data.format, 'shiye-open-data');
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.entries.length, 1);
  assert.equal(data.entries[0].title, '最新标题');
  assert.equal(data.entries[0].document.source, entry.content);
  assert.equal(data.entries[0].legacy, undefined);
  assert.equal(data.entries[0].history, undefined);
  assert.equal(data.entries[0].comments, undefined);
  assert.equal(entry.title, '合成测试');
  $('#exportScope').value = 'current';
  $('#exportComments').checked = true;
  $('#exportJson').onclick();
  assert.equal(JSON.parse(downloads[1][2]).entries[0].comments[0].body, '评论');
  assert.equal(downloads[1][3], 'json');
});
