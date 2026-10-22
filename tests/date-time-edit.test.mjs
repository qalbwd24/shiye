import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateTimeEdit } from '../public/shared/date-time-edit.js';

const time = '[2026/09/30  03:04:05]';
function apply(source, from = source.length, to = from, options) {
  const e = dateTimeEdit(source, from, to, time, options);
  const result = source.slice(0, e.from) + e.insert + source.slice(e.to);
  return { result, caret: e.selection.anchor };
}
test('paragraph end inserts one empty separator, indented date and indented next line', () => {
  const result = '　　上一段\n\n　　' + time + '\n　　';
  assert.deepEqual(apply('　　上一段'), { result, caret: result.length });
});
test('blank lines and initial indent are reused without doubled indentation', () => {
  for (const source of ['', '　　', '  '])
    assert.equal(apply(source).result, '　　' + time + '\n　　');
  for (const source of ['上一段\n', '上一段\n　　', '上一段\n\n　　'])
    assert.equal(apply(source).result, '上一段\n\n　　' + time + '\n　　');
});
test('sentence middle, start and selected text insert only the date at the actual selection', () => {
  assert.deepEqual(apply('前半后半', 2), {
    result: '前半' + time + '后半',
    caret: 2 + time.length,
  });
  assert.equal(apply('原文', 0).result, time + '原文');
  assert.equal(apply('甲乙丙丁', 1, 3).result, '甲' + time + '丁');
});
test('following paragraphs stay intact and caret remains on the new indented line', () => {
  const { result, caret } = apply('上一段\n下一段', 3);
  assert.equal(result, '上一段\n\n　　' + time + '\n　　\n下一段');
  assert.equal(result.slice(caret), '\n下一段');
  assert.equal(apply('\n后文', 0).result, '　　' + time + '\n　　\n后文');
});
test('semantic contexts remain inline and disabled indentation is respected', () => {
  assert.equal(apply('code', 4, 4, { inline: true }).result, 'code' + time);
  assert.equal(apply('段落', 2, 2, { indent: '' }).result, '段落\n\n' + time + '\n');
});
