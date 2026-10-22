import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEntry } from '../src/server/domain/entries.mjs';
import { replaceEntry } from '../src/server/domain/quick-entry.mjs';
import { getEditorDocument } from '../public/shared/editor-document.js';
import { prepareContent } from '../public/shared/content-preparation.js';
import { appendChatMessages, saveChatRoom } from '../src/server/domain/chat-journal.mjs';

const originalTime = '2025-10-16T01:10:00.000Z';
const now = '2026-10-16T01:10:00.000Z';
const sourceId = '12345678-1234-1234-1234-123456789abc';
function legacyEntry(markdown = false) {
  const content = '<p>旧日记 <strong>加粗</strong> 原空格</p><hr><p><img src="/media/photo"></p>';
  return {
    id: 'old-entry',
    title: '虚构旧日记',
    content,
    date: originalTime,
    createdAt: originalTime,
    updatedAt: originalTime,
    category: '日常',
    tags: ['旧标签'],
    attachments: ['photo'],
    revision: 1,
    ...(markdown
      ? {
          contentFormat: 'markdown',
          markdownSource: '**加粗**\n\n---\n\n![图](/media/photo)',
          markdownHtml: content,
        }
      : {}),
    legacy: {
      original: { updateTime: 1760577000000, custom: '须保留的旧字段' },
      mediaReferences: [{ mediaId: 'photo', field: 'images' }],
    },
    comments: [{ id: 'comment-1', content: '虚构评论' }],
    customFutureMetadata: { keep: true },
  };
}
function database(entry) {
  return {
    entries: [entry],
    categories: ['日常', '工作'],
    tags: ['旧标签', '新标签'],
    media: [{ id: 'photo', name: '虚构图.png', type: 'image/png' }],
  };
}
const richBody = {
  format: 'shiye-richdoc',
  version: 1,
  content: [
    {
      type: 'paragraph',
      attrs: { blockId: 'p1' },
      content: [{ type: 'text', text: '没有手打时间的中文正文' }],
    },
  ],
};

for (const markdown of [false, true]) {
  test(`${markdown ? 'Markdown' : 'legacy HTML'} taxonomy edits retain exact body, inline photos, original metadata and comments`, () => {
    const original = legacyEntry(markdown);
    const db = database(original);
    const before = structuredClone(original);
    const input = { ...original, category: '工作', tags: ['新标签', '旧标签'] };
    // This is the current entry route's real validation and replacement path.
    const saved = replaceEntry(db, original, validateEntry(input, db, original));
    assert.equal(saved.category, '工作');
    assert.deepEqual(saved.tags, ['新标签', '旧标签']);
    assert.equal(saved.content, before.content);
    assert.deepEqual(getEditorDocument(saved), getEditorDocument(before));
    assert.deepEqual(saved.attachments, before.attachments);
    assert.deepEqual(saved.legacy, before.legacy);
    assert.deepEqual(saved.comments, before.comments);
    assert.deepEqual(saved.customFutureMetadata, before.customFutureMetadata);
    assert.equal(saved.id, before.id);
    assert.equal(saved.revision, 2);
    assert.deepEqual(original, before);
  });
}

test('metadata-only revision changes keep fallback content time when the adapter supplies the content clock', async () => {
  const options = {
    body: richBody,
    recordId: 'record-1',
    revision: 1,
    updatedAt: originalTime,
    contentEditedAt: originalTime,
  };
  const first = await prepareContent(options);
  const second = await prepareContent({ ...options, revision: 2, updatedAt: now });
  assert.deepEqual(second.body, first.body);
  assert.deepEqual(second.derived.blocks, first.derived.blocks);
  assert.equal(second.derived.blocks[0].time.sourceField, 'content-editedAt');
  assert.equal(second.derived.blocks[0].time.instant, originalTime);
  assert.notEqual(second.inputFingerprint, first.inputFingerprint);
  const edited = await prepareContent({
    ...options,
    revision: 3,
    updatedAt: now,
    contentEditedAt: now,
  });
  assert.equal(edited.derived.blocks[0].time.instant, now);
});

test('explicitly unknown content clock never falls back to a metadata-only update time', async () => {
  const result = await prepareContent({
    body: richBody,
    recordId: 'record-1',
    revision: 1,
    updatedAt: now,
    contentEditedAt: null,
  });
  assert.equal(result.derived.blocks[0].time.instant, null);
});

test('incoming chat archival and retry preserve old diary data while metadata tags remain editable', () => {
  const old = legacyEntry();
  const snapshot = structuredClone(old);
  const db = database(old);
  saveChatRoom(db, { sourceId, id: '-10', title: '虚构会话', category: '日常', idleHours: 5 });
  const input = {
    sourceId,
    roomId: '-10',
    messages: [
      { id: '100', sentAt: originalTime, text: '**聊天正文** 中文', attachments: ['photo'] },
    ],
  };
  const first = appendChatMessages(db, input, Date.parse(now));
  const page = db.entries.find((e) => e.id === first.accepted[0].entryId);
  const messages = structuredClone(page.chatJournal.messages);
  const html = page.content;
  const saved = replaceEntry(db, page, validateEntry({ ...page, tags: ['新标签'] }, db, page));
  const retried = appendChatMessages(db, input, Date.parse(now));
  assert.deepEqual(retried, first);
  assert.equal(db.entries.length, 2);
  assert.deepEqual(saved.tags, ['新标签']);
  assert.deepEqual(saved.chatJournal.messages, messages);
  assert.equal(saved.content, html);
  assert.deepEqual(
    db.entries.find((e) => e.id === old.id),
    snapshot,
  );
  assert.match(saved.content, /<strong>聊天正文<\/strong>/);
  assert.match(saved.content, /\/media\/photo/);
});
