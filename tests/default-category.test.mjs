import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, sample } from './helpers.mjs';
import { sortedTaxonomy } from '../public/shared/taxonomy.js';

async function setup(t) {
  const { request } = await fixture(t);
  const library = async () => (await request('/api/library')).json();
  const preference = (data) => request('/api/preferences', 'PUT', data);
  const taxonomy = (action, from, to = '', kind = 'category') =>
    request('/api/taxonomy', 'POST', { kind, action, from, to });
  return { request, library, preference, taxonomy };
}

test('default category accepts only a current category and rejects changes atomically', async (t) => {
  const { library, preference } = await setup(t);
  assert.equal((await preference({ defaultCategory: '学习' })).status, 200);
  const before = await library();
  assert.equal(before.settings.preferences.defaultCategory, '学习');
  for (const value of [null, '', 1, [], {}])
    assert.equal((await preference({ defaultCategory: value })).status, 400);
  assert.equal((await preference({ defaultCategory: '不存在', theme: 'dark' })).status, 409);
  const after = await library();
  assert.deepEqual(after.settings.preferences, before.settings.preferences);
  assert.deepEqual(after.categories, before.categories);
  assert.equal(after.entries.length, 0);
});

test('default markers never reorder the saved category order or shared sorted views', async (t) => {
  const { request, library, preference } = await setup(t);
  const order = (await library()).categories.slice().reverse();
  assert.equal(
    (await request('/api/taxonomy/order', 'PUT', { kind: 'category', order })).status,
    200,
  );
  await preference({ defaultCategory: order.at(-1) });
  let db = await library();
  assert.deepEqual(db.categories, order);
  assert.deepEqual(
    sortedTaxonomy(db, 'category').map((item) => item.name),
    order,
  );
  await preference({ categorySort: 'name' });
  db = await library();
  assert.deepEqual(db.categories, order);
  assert.deepEqual(
    sortedTaxonomy(db, 'category').map((item) => item.name),
    order.slice().sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true })),
  );
});

test('rename keeps its slot and updates default, templates and recall without losing entry history', async (t) => {
  const { request, library, preference, taxonomy } = await setup(t);
  const entry = await (await request('/api/entries', 'POST', sample)).json();
  await request('/api/templates', 'POST', {
    name: '测试模板',
    category: '学习',
    content: '<p>模板</p>',
  });
  await preference({ defaultCategory: '学习', memoryCategories: ['旅行', '学习'] });
  const before = await library();
  assert.equal((await taxonomy('rename', '学习', '研究')).status, 200);
  const db = await library();
  assert.deepEqual(
    db.categories,
    before.categories.map((name) => (name === '学习' ? '研究' : name)),
  );
  assert.equal(db.settings.preferences.defaultCategory, '研究');
  assert.deepEqual(db.settings.preferences.memoryCategories, ['旅行', '研究']);
  assert.equal(db.templates[0].category, '研究');
  const saved = db.entries.find((item) => item.id === entry.id);
  assert.equal(saved.revision, entry.revision + 1);
  assert.equal(saved.category, '研究');
  assert.equal(saved.history[0].category, '学习');
  for (const key of ['title', 'content', 'date', 'createdAt', 'attachments'])
    assert.deepEqual(saved[key], entry[key]);
});

test('merge keeps destination position, transfers default and deduplicates linked categories', async (t) => {
  const { library, preference, taxonomy } = await setup(t);
  await preference({ defaultCategory: '学习', memoryCategories: ['学习', '旅行'] });
  const before = await library();
  assert.equal((await taxonomy('merge', '学习', '旅行')).status, 200);
  const db = await library();
  assert.deepEqual(
    db.categories,
    before.categories.filter((name) => name !== '学习'),
  );
  assert.equal(db.settings.preferences.defaultCategory, '旅行');
  assert.deepEqual(db.settings.preferences.memoryCategories, ['旅行']);
  assert.equal((await taxonomy('rename', '日常', '旅行')).status, 200);
  assert.deepEqual(
    (await library()).categories,
    before.categories.filter((name) => !['日常', '学习'].includes(name)),
  );
});

test('removing default follows the unclassified destination; existing destination is not moved', async (t) => {
  const { request, library, preference, taxonomy } = await setup(t);
  await request('/api/entries', 'POST', sample);
  await request('/api/templates', 'POST', {
    name: '测试模板',
    category: '学习',
    content: '<p>模板</p>',
  });
  await preference({ defaultCategory: '学习', memoryCategories: ['学习', '旅行'] });
  const before = await library();
  assert.equal((await taxonomy('remove', '学习', '不应作为目标')).status, 200);
  let db = await library();
  assert.deepEqual(
    db.categories,
    before.categories.map((name) => (name === '学习' ? '未分类' : name)),
  );
  assert.equal(db.settings.preferences.defaultCategory, '未分类');
  assert.equal(db.entries[0].category, '未分类');
  assert.equal(db.templates[0].category, '');
  assert.deepEqual(db.settings.preferences.memoryCategories, ['旅行']);
  await preference({ defaultCategory: '旅行' });
  await taxonomy('remove', '旅行');
  db = await library();
  assert.deepEqual(db.categories, ['日常', '未分类', '灵感']);
  assert.equal(db.settings.preferences.defaultCategory, '未分类');
  assert.equal((await preference({ defaultCategory: '学习' })).status, 409);
});

test('stale source/merge target is rejected and same-name rename does not add revisions', async (t) => {
  const { request, library, taxonomy } = await setup(t);
  await request('/api/entries', 'POST', sample);
  const before = await library();
  assert.equal((await taxonomy('rename', '学习', '学习')).status, 200);
  assert.equal((await taxonomy('rename', '不存在', '新名称')).status, 409);
  assert.equal((await taxonomy('merge', '学习', '不存在')).status, 409);
  const after = await library();
  assert.deepEqual(after.categories, before.categories);
  assert.deepEqual(after.entries, before.entries);
});

test('tag rename also preserves its slot and does not modify the category default', async (t) => {
  const { request, library, preference, taxonomy } = await setup(t);
  await request('/api/entries', 'POST', { ...sample, tags: ['甲', '乙', '丙'] });
  await preference({ defaultCategory: '学习' });
  await taxonomy('rename', '乙', '丁', 'tag');
  const db = await library();
  assert.deepEqual(db.tags, ['甲', '丁', '丙']);
  assert.deepEqual(db.entries[0].tags, ['甲', '丁', '丙']);
  assert.equal(db.settings.preferences.defaultCategory, '学习');
});
