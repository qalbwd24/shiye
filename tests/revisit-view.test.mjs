import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  historyDate,
  presentHistoryMessage,
} from '../previews/telegram-chat/shiye-revisit-view.js';
const delivery = (markdown, media = []) => ({
  originalAt: '2024-10-17T23:33:05.000Z',
  source: { available: true, markdown, media },
});
test('history presentation removes only a matching standalone leading marker and preserves original data', () => {
  for (const marker of [
    '\\[2024/10/18 07:33:05\\]',
    '[2024-10-18 07:33:05]',
    '【2024年10月18日 07:33:05】',
    '[2024/10/18 07:33]',
  ]) {
    const source = delivery(marker + '\n\n**正文**，*斜体*\n\n第二段');
    const original = structuredClone(source);
    assert.equal(presentHistoryMessage(source).message, '**正文**，*斜体*\n\n第二段');
    assert.deepEqual(source, original);
    assert.equal(presentHistoryMessage(source).dateLabel, '24-10-18');
  }
});
test('dates in prose, mismatched times, quotes and code remain literal source content', () => {
  for (const markdown of [
    '[2024/10/18 07:34:05]\n正文',
    '时间是[2024/10/18 07:33:05]\n正文',
    '> [2024/10/18 07:33:05]\n正文',
    '`[2024/10/18 07:33:05]`',
    '```\n[2024/10/18 07:33:05]\n```',
  ])
    assert.equal(presentHistoryMessage(delivery(markdown)).message, markdown);
});
test('inline media retains its caption without synthetic media labels or duplicated description', () => {
  assert.equal(presentHistoryMessage(delivery('\\[图片\\]', ['image'])).message, '');
  assert.equal(
    presentHistoryMessage(delivery('\\[图片：这是图注\\]', ['image'])).message,
    '这是图注',
  );
  assert.equal(
    presentHistoryMessage(delivery('\\[视频：视频说明\\]', ['video'])).message,
    '视频说明',
  );
  assert.equal(presentHistoryMessage(delivery('[图片]')).message, '[图片]');
  assert.equal(historyDate('2024-10-17T23:33:05Z', 'UTC'), '24-10-17');
});
