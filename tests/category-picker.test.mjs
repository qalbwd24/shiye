import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCategoryPickerModel,
  categoryPickerKeyAction,
} from '../public/shared/category-picker.js';

function fixture() {
  return {
    categories: ['随想', '日常', '旅行', 'IDE Ideas'],
    entries: [],
    settings: { preferences: { defaultCategory: '日常', categorySort: 'manual' } },
  };
}

test('default is highlighted without changing shared category order', () => {
  const library = fixture();
  const model = createCategoryPickerModel(() => library);
  assert.equal(model.snapshot().active, '日常');
  assert.deepEqual(
    model.snapshot().items.map((item) => item.name),
    library.categories,
  );
  assert.equal(model.move(1).active, '旅行');
  assert.equal(model.move(-1).active, '日常');
  model.select('随想');
  assert.equal(model.move(-1).active, 'IDE Ideas');
  assert.equal(model.move(1).active, '随想');
});

test('filter handles Unicode width/case, no match, and stale selections', () => {
  const model = createCategoryPickerModel(fixture);
  assert.equal(model.setQuery(' ｉｄｅ ').active, 'IDE Ideas');
  assert.equal(model.select('日常'), null);
  assert.equal(model.setQuery('不存在').active, null);
  assert.equal(model.move(1).active, null);
  assert.equal(model.setQuery('').active, '日常');
  assert.equal(model.setQuery('旅').active, '旅行');
});

test('live library replacement/order changes are used, removed choices cannot be selected', () => {
  let library = fixture();
  const model = createCategoryPickerModel(() => library);
  model.snapshot();
  library = {
    categories: ['旅行', '随想'],
    entries: [],
    settings: { preferences: { defaultCategory: '已删除', categorySort: 'manual' } },
  };
  assert.equal(model.select('日常'), null);
  assert.equal(model.snapshot().active, '旅行');
  assert.deepEqual(
    model.snapshot().items.map((item) => item.name),
    ['旅行', '随想'],
  );
  library.categories.reverse();
  assert.deepEqual(
    model.snapshot().items.map((item) => item.name),
    ['随想', '旅行'],
  );
  assert.equal(model.snapshot().active, '旅行');
});

test('honors existing count sort and includes categories discovered from entries', () => {
  const library = fixture();
  library.settings.preferences.categorySort = 'count';
  library.entries = [{ category: '旅行' }, { category: '旅行' }, { category: '新分类' }];
  const model = createCategoryPickerModel(() => library);
  assert.deepEqual(
    model
      .snapshot()
      .items.slice(0, 2)
      .map((item) => item.name),
    ['旅行', '新分类'],
  );
  assert.equal(model.snapshot().active, '日常');
});

test('empty libraries neither invent a category nor confirm a selection', () => {
  const model = createCategoryPickerModel(() => ({}));
  assert.deepEqual(model.snapshot().items, []);
  assert.equal(model.snapshot().active, null);
  assert.equal(model.move(-1).active, null);
  assert.equal(model.select('日常'), null);
});

test('keyboard intents are scoped to unmodified navigation and respect IME', () => {
  for (const [key, action] of Object.entries({
    ArrowUp: 'previous',
    ArrowDown: 'next',
    Enter: 'confirm',
    Escape: 'cancel',
  })) {
    assert.equal(categoryPickerKeyAction({ key }), action);
    assert.equal(categoryPickerKeyAction({ key, isComposing: true }), null);
    assert.equal(categoryPickerKeyAction({ key, keyCode: 229 }), null);
    assert.equal(categoryPickerKeyAction({ key }, true), null);
    for (const modifier of ['ctrlKey', 'altKey', 'metaKey', 'shiftKey'])
      assert.equal(categoryPickerKeyAction({ key, [modifier]: true }), null);
  }
  for (const key of ['Tab', 'ArrowLeft', 'ArrowRight', 'a', ' '])
    assert.equal(categoryPickerKeyAction({ key }), null);
});
