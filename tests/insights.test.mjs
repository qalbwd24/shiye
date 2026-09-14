import { test } from 'node:test';
import assert from 'node:assert/strict';

import { memoryDeck } from '../public/shared/memories.js';
import { statistics, recall } from '../public/shared/insights.js';

test('statistics count Unicode, unique dates, streaks and exclude drafts/hidden/demos', () => {
  const e = (id, date, extra = {}) => ({
    id,
    date: date + 'T12:00:00',
    content: '文🌿 ',
    category: '学习',
    tags: ['a'],
    attachments: ['m'],
    ...extra,
  });
  const values = [
    e('a', '2024-02-28'),
    e('b', '2024-02-29'),
    e('c', '2024-03-01'),
    e('d', '2024-03-01'),
    e('x', '2024-03-02', { hidden: true }),
    e('y', '2024-03-02', { draft: true }),
    e('z', '2024-03-02', { demo: true }),
  ];
  const s = statistics(values, [{ id: 'm', type: 'image/png', size: 100 }], (v) => v, {
    year: 2024,
    now: new Date('2024-03-02T12:00:00'),
  });
  assert.equal(s.count, 4);
  assert.equal(s.chars, 8);
  assert.equal(s.dayCount, 3);
  assert.equal(s.longestStreak, 3);
  assert.equal(s.currentStreak, 3);
  assert.equal(s.images, 1);
  assert.equal(recall(values, { date: new Date('2028-02-29T12:00:00'), period: 12 }).length, 1);
  assert.equal(recall(values, { date: new Date('2025-02-28T12:00:00'), period: 12 }).length, 1);
});
test('memory rounds filter hidden/trash/categories and visit every eligible entry exactly once', () => {
  const entries = [
    { id: 'a', category: '日常' },
    { id: 'b', category: '学习' },
    { id: 'c', legacy: { isHidden: true } },
    { id: 'd', deleted: true },
    { id: 'e', category: '日常' },
  ];
  const deck = memoryDeck(entries, [], () => 0);
  assert.deepEqual(new Set(deck), new Set(['a', 'b', 'e']));
  assert.equal(deck.length, 3);
  assert.deepEqual(new Set(memoryDeck(entries, ['日常'])), new Set(['a', 'e']));
  assert.deepEqual(memoryDeck(entries, ['不存在']), []);
});
