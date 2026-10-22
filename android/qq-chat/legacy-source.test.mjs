import test from 'node:test';
import assert from 'node:assert/strict';
import { createLegacyChatSource } from './legacy-source.js';

function fixture(options = {}) {
  let active = '-10',
    epoch = 1,
    nextId = 10,
    reads = 0,
    flushes = 0;
  let persisted = !options.fresh,
    readError = null;
  const sent = [],
    drafts = [],
    deferred = [];
  const library = {
    messages: { '-10': [], '-20': [] },
    documents: [],
    shiyeWithdrawnMessages: [],
    dialogs: { active: [{ id: '-10' }, { id: '-20' }], archived: [] },
  };
  const state = {
    chats: { byId: { '-10': { title: '合成甲' }, '-20': { title: '合成乙' } } },
    byTabId: { 1: { messageLists: [{ chatId: active, threadId: -1, type: 'thread' }] } },
    messages: { byChatId: {} },
  };
  for (const id of ['-10', '-20'])
    state.messages.byChatId[id] = { byId: {}, threadsById: { '-1': { localState: {} } } };
  const thread = (id) => state.messages.byChatId[id].threadsById['-1'].localState;
  const api = {
    saveDraft({ chatId, threadId, text }) {
      assert.equal(threadId, -1);
      assert.equal(typeof text.text, 'string');
      drafts.push({ chatId, text: text.text });
      persisted = true;
      thread(chatId).draft = { ...thread(chatId).draft, text };
      library.dialogs.active.find((item) => item.id === chatId).draft = {
        message: text.text,
        replyTo: thread(chatId).draft.replyInfo
          ? { replyToMsgId: thread(chatId).draft.replyInfo.replyToMsgId }
          : undefined,
      };
    },
    clearDraft({ chatId, shouldKeepReply }) {
      assert.equal(shouldKeepReply, true);
      drafts.push({ chatId, text: '' });
      persisted = true;
      thread(chatId).draft = { ...thread(chatId).draft, text: undefined };
      library.dialogs.active.find((item) => item.id === chatId).draft = thread(chatId).draft
        .replyInfo
        ? { message: '', replyTo: { replyToMsgId: thread(chatId).draft.replyInfo.replyToMsgId } }
        : undefined;
    },
    updateDraftReplyInfo({ tabId, replyToMsgId }) {
      assert.equal(tabId, '1');
      assert.ok(Number.isSafeInteger(replyToMsgId));
      thread(active).draft = { ...thread(active).draft, replyInfo: { replyToMsgId } };
    },
    resetDraftReplyInfo({ tabId }) {
      assert.equal(tabId, '1');
      if (thread(active).draft) thread(active).draft.replyInfo = undefined;
    },
    sendMessage(payload) {
      sent.push(payload);
      const chatId = payload.messageList.chatId;
      const replyToMsgId = thread(chatId).draft?.replyInfo?.replyToMsgId;
      const attachments = payload.attachments || [null];
      const commit = () => {
        persisted = true;
        for (const attachment of attachments) {
          const id = ++nextId;
          const message = {
            id,
            out: true,
            message: payload.text,
            date: 1760774400 + id,
            replyToMsgId,
          };
          if (attachment) {
            const mediaId = 100 + id;
            message.media = { id: mediaId, type: 'document' };
            library.documents.push({
              id: mediaId,
              bytes: attachment.bytes,
              mimeType: attachment.mimeType,
              attributes: [
                { shiyeType: 'DocumentAttributeFilename', fileName: attachment.filename },
              ],
            });
          }
          library.messages[chatId].push(message);
          state.messages.byChatId[chatId].byId[id] = {
            id,
            chatId,
            isOutgoing: true,
            date: message.date,
            content: {
              text: { text: payload.text },
              ...(attachment
                ? { document: { id: String(message.media.id), mimeType: attachment.mimeType } }
                : {}),
            },
            replyInfo: replyToMsgId ? { replyToMsgId } : undefined,
          };
        }
        library.dialogs.active.find((dialog) => dialog.id === chatId).draft = undefined;
      };
      if (options.deferSend) deferred.push(commit);
      else commit();
    },
    deleteMessages({ messageIds, messageList, shouldDeleteForAll }) {
      assert.equal(shouldDeleteForAll, true);
      for (const id of messageIds) {
        library.messages[messageList.chatId] = library.messages[messageList.chatId].filter(
          (m) => m.id !== id,
        );
        library.shiyeWithdrawnMessages.push({
          roomId: messageList.chatId,
          messageId: String(id),
          sentAt: '2025-10-18T00:00:00Z',
        });
        // Intentionally leave stale global body: tombstone must override it.
      }
    },
  };
  const host = { getGlobal: () => state, getActions: () => api };
  const attachmentTools = {
    async qt(name, file, setting) {
      assert.equal(setting.shouldSendAsFile, true);
      if (options.preparing) await options.preparing();
      return {
        filename: name,
        mimeType: file.type,
        bytes: new Uint8Array(await file.arrayBuffer()),
        blobUrl: URL.createObjectURL(file),
      };
    },
    async shiyePrepareAttachment(value) {
      return value;
    },
    shiyePrepareAttachmentsToSend(values, compress) {
      assert.equal(compress, false);
      return values;
    },
  };
  const source = createLegacyChatSource({
    host,
    currentId: () => active,
    contextVersion: () => epoch,
    readLibrary: async () => {
      reads++;
      if (readError) throw readError;
      return persisted ? structuredClone(library) : undefined;
    },
    flush: async () => {
      flushes++;
      return { flushed: true };
    },
    attachmentTools,
    timeoutMs: options.timeoutMs || 250,
    appearance: () => ({ bubbleOpacity: 0.9 }),
  });
  return {
    source,
    sent,
    library,
    state,
    drafts,
    deferred,
    setPresent(value) {
      persisted = value;
    },
    setReadError(value) {
      readError = value;
    },
    stats: () => ({ reads, flushes }),
    switchRoom(id) {
      active = id;
      epoch++;
      state.byTabId['1'].messageLists = [{ chatId: id, threadId: -1, type: 'thread' }];
    },
    add(id, text, chatId = active) {
      nextId = Math.max(nextId, id);
      library.messages[chatId].push({ id, out: true, message: text, date: 1760774400 });
      state.messages.byChatId[chatId].byId[id] = {
        id,
        chatId,
        isOutgoing: true,
        date: 1760774400,
        content: { text: { text } },
      };
    },
  };
}

test('text uses real action signature, fixed reply and committed worker ACK', async () => {
  const f = fixture();
  f.add(3, '合成来源');
  try {
    const ack = await f.source.sendText('合成\n双段', '3');
    assert.equal(ack.committed, true);
    assert.deepEqual(ack.messageIds, ['11']);
    assert.equal(f.sent.length, 1);
    assert.equal(f.sent[0].messageList.chatId, '-10');
    assert.equal(f.library.messages['-10'].at(-1).replyToMsgId, 3);
    assert.ok(f.stats().flushes > 0);
    assert.equal(f.source.getSnapshot().messages.at(-1).text, '合成\n双段');
  } finally {
    f.source.dispose();
  }
});

test('fresh absent persisted library uses global seed baseline, only owner initializes on send', async () => {
  const f = fixture({ fresh: true });
  f.add(4, '相同合成文字');
  try {
    await f.source.refresh();
    const ack = await f.source.sendText('相同合成文字');
    assert.equal(ack.messageId, '11');
    assert.equal(f.sent.length, 1);
    assert.equal(f.library.messages['-10'].length, 2);
    assert.equal(f.library.messages['-10'][0].id, 4);
  } finally {
    f.source.dispose();
  }
});

test('existing library disappearing is an error and cannot reset baseline or send', async () => {
  const f = fixture();
  f.add(4, '原合成库保留');
  try {
    await f.source.refresh();
    f.setPresent(false);
    await assert.rejects(
      f.source.sendText('不应提交'),
      (e) => e.code === 'LOCAL_LIBRARY_DISAPPEARED',
    );
    assert.equal(f.sent.length, 0);
    assert.equal(f.library.messages['-10'][0].id, 4);
  } finally {
    f.source.dispose();
  }
});

test('failed read on fresh library is never treated as absent key', async () => {
  const f = fixture({ fresh: true });
  try {
    f.setReadError(new Error('fixture-read-failed'));
    await assert.rejects(f.source.sendText('不应提交'), /fixture-read-failed/);
    assert.equal(f.sent.length, 0);
  } finally {
    f.source.dispose();
  }
});

test('reply draft and empty-text reply persist through actual SaveDraft shape', async () => {
  const f = fixture();
  f.add(4, '引用合成来源');
  try {
    await f.source.setDraft('带引用草稿', '4');
    assert.equal(f.library.dialogs.active[0].draft.replyTo.replyToMsgId, 4);
    await f.source.setDraft('', '4');
    assert.equal(f.library.dialogs.active[0].draft.replyTo.replyToMsgId, 4);
    await f.source.setDraft('保留引用');
    assert.equal(f.source.getDraft().replyId, '4');
    await f.source.setDraft('清掉引用', null);
    assert.equal(f.source.getDraft().replyId, null);
    assert.equal(f.library.dialogs.active[0].draft.replyTo, undefined);
  } finally {
    f.source.dispose();
  }
});

test('room return restores committed text/reply before delayed global draft projection', async () => {
  const f = fixture();
  f.add(4, '引用来源');
  try {
    await f.source.setDraft('甲房\n已提交草稿', '4');
    f.state.messages.byChatId['-10'].threadsById['-1'].localState.draft = undefined;
    f.switchRoom('-20');
    assert.equal(f.source.getDraft().text, '');
    f.switchRoom('-10');
    const restored = f.source.getDraft();
    assert.equal(restored.text, '甲房\n已提交草稿');
    assert.equal(restored.replyId, '4');
    assert.equal(restored.ready, true);
    await f.source.setDraft('不传reply参数继续写');
    assert.equal(f.library.dialogs.active[0].draft.replyTo.replyToMsgId, 4);
  } finally {
    f.source.dispose();
  }
});

test('first committed draft read exposes readiness without trusting an empty UI projection', async () => {
  const f = fixture();
  f.library.dialogs.active[0].draft = { message: '冷启动合成草稿', replyTo: { replyToMsgId: 4 } };
  try {
    assert.equal(f.source.getDraft().ready, false);
    await f.source.refresh();
    assert.deepEqual(f.source.getDraft(), {
      roomId: '-10',
      text: '冷启动合成草稿',
      replyId: '4',
      ready: true,
      hasRichContent: false,
    });
    const pending = f.source.setDraft('新输入不能被旧缓存覆盖', null);
    assert.equal(f.source.getDraft().text, '新输入不能被旧缓存覆盖');
    assert.equal(f.source.getDraft().replyId, null);
    await pending;
  } finally {
    f.source.dispose();
  }
});

test('draft preserves blank lines/spaces and queued saves cannot target newly selected room', async () => {
  const f = fixture();
  try {
    const pending = f.source.setDraft('  合成\n\n两段  ');
    assert.equal(f.source.getDraft().text, '  合成\n\n两段  ');
    f.switchRoom('-20');
    await pending;
    assert.equal(f.library.dialogs.active[0].draft.message, '  合成\n\n两段  ');
    assert.equal(f.library.dialogs.active[1].draft, undefined);
    await f.source.setDraft('');
    assert.equal(f.source.getDraft().text, '');
  } finally {
    f.source.dispose();
  }
});

test('same-room unstarted drafts coalesce without losing latest text', async () => {
  const f = fixture();
  try {
    await Promise.all([f.source.setDraft('旧'), f.source.setDraft('新\n草稿')]);
    assert.deepEqual(f.drafts, [{ chatId: '-10', text: '新\n草稿' }]);
    await f.source.flush();
  } finally {
    f.source.dispose();
  }
});

test('outgoing file/GIF/video bytes stay original and unsent text survives external file send', async () => {
  const f = fixture();
  try {
    await f.source.setDraft('未发送的文字');
    for (const mime of ['image/gif', 'video/mp4', 'application/pdf']) {
      const original = new File(
        [new Uint8Array([71, 73, 70, 56, 57, 97])],
        `合成.${mime.split('/')[1]}`,
        { type: mime },
      );
      original.shiyeOriginalSticker = true;
      const ack = await f.source.sendFiles([original]);
      const media = await f.source.getMedia(ack.messageId);
      assert.equal(media.mime, mime);
      assert.equal(media.blob.size, 6);
      assert.deepEqual(
        new Uint8Array(await media.blob.arrayBuffer()),
        new Uint8Array(await original.arrayBuffer()),
      );
      assert.equal(f.library.dialogs.active[0].draft.message, '未发送的文字');
      assert.equal(
        f.source.getSnapshot().messages.at(-1).kind,
        mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : 'file',
      );
    }
  } finally {
    f.source.dispose();
  }
});

test('media preparation cannot send into a room selected during an await', async () => {
  let gate;
  const paused = new Promise((resolve) => {
    gate = resolve;
  });
  const f = fixture({ preparing: () => paused });
  try {
    const send = f.source.sendFiles([new File(['合成'], 'x.png', { type: 'image/png' })]);
    await new Promise((resolve) => setTimeout(resolve, 5));
    f.switchRoom('-20');
    gate();
    await assert.rejects(
      send,
      (error) => error.code === 'CHAT_CONTEXT_CHANGED' && !error.uncertain,
    );
    assert.equal(f.sent.length, 0);
  } finally {
    f.source.dispose();
  }
});

test('submitted send continues confirming original room after navigation', async () => {
  const f = fixture({ deferSend: true });
  try {
    const sending = f.source.sendText('提交后切房');
    await new Promise((resolve) => setTimeout(resolve, 5));
    f.switchRoom('-20');
    f.deferred[0]();
    const ack = await sending;
    assert.equal(ack.roomId, '-10');
    assert.equal(f.library.messages['-20'].length, 0);
  } finally {
    f.source.dispose();
  }
});

test('text typed during pending send survives send API draft clearing', async () => {
  const f = fixture({ deferSend: true });
  try {
    await f.source.setDraft('第一条');
    const pending = f.source.sendText('第一条');
    await new Promise((resolve) => setTimeout(resolve, 5));
    await f.source.setDraft('后来输入\n不能清掉');
    f.deferred[0]();
    await pending;
    await f.source.flush();
    assert.equal(f.library.dialogs.active[0].draft.message, '后来输入\n不能清掉');
    assert.equal(f.source.getDraft().text, '后来输入\n不能清掉');
  } finally {
    f.source.dispose();
  }
});

test('uncertain file reconciliation preserves unrelated text and deduplicates explicit retry', async () => {
  const f = fixture({ deferSend: true, timeoutMs: 20 });
  const file = new File(['GIF89a'], '合成.gif', { type: 'image/gif' });
  try {
    await f.source.setDraft('附件之外的草稿');
    await assert.rejects(f.source.sendFiles([file]), (e) => e.uncertain && e.locked);
    f.deferred[0]();
    await f.source.flush();
    assert.equal(f.library.dialogs.active[0].draft.message, '附件之外的草稿');
    const ack = await f.source.sendFiles([file]);
    assert.equal(ack.messageId, '11');
    assert.equal(f.sent.length, 1);
  } finally {
    f.source.dispose();
  }
});

test('uncertain commit locks retries, later worker commit reconciles without double send', async () => {
  const f = fixture({ deferSend: true, timeoutMs: 20 });
  try {
    await assert.rejects(f.source.sendText('合成不重复'), (e) => e.uncertain && e.locked);
    assert.equal(f.source.getSnapshot().sendState.uncertain, true);
    await assert.rejects(f.source.sendText('合成不重复'), (e) => e.locked);
    assert.equal(f.sent.length, 1);
    f.deferred[0]();
    await f.source.flush();
    assert.equal(f.source.getSnapshot().sendState.locked, false);
    const recovered = await f.source.sendText('合成不重复');
    assert.equal(recovered.messageId, '11');
    assert.equal(f.sent.length, 1);
  } finally {
    f.source.dispose();
  }
});

test('withdraw waits durable tombstone and suppresses stale global body/media', async () => {
  const f = fixture();
  f.add(4, '应清除的合成内容');
  try {
    const ack = await f.source.withdraw('4');
    assert.equal(ack.state, 'withdrawn');
    const message = f.source.getSnapshot().messages.find((item) => item.id === '4');
    assert.equal(message.kind, 'withdrawn');
    assert.equal(message.text, '');
    await assert.rejects(f.source.getMedia('4'), (e) => e.code === 'MEDIA_WITHDRAWN');
  } finally {
    f.source.dispose();
  }
});

test('idle subscription does not rescan the complete library; disposal stops observation', async () => {
  const f = fixture();
  let updates = 0;
  const stop = f.source.subscribe(() => updates++);
  await new Promise((resolve) => setTimeout(resolve, 550));
  assert.equal(f.stats().reads, 1);
  assert.ok(updates >= 1);
  stop();
  f.source.dispose();
});

test('unsafe future numeric ID is rejected without truncation, rich draft protected', async () => {
  const f = fixture();
  try {
    assert.throws(
      () => f.source.sendText('合成', '18446744073709551615'),
      (e) => e.code === 'LEGACY_ID_MAPPING_REQUIRED',
    );
    f.state.messages.byChatId['-10'].threadsById['-1'].localState.draft = {
      richMessage: { blocks: [] },
    };
    assert.throws(
      () => f.source.setDraft('不应降级'),
      (e) => e.code === 'RICH_DRAFT_UNSUPPORTED',
    );
    assert.equal(f.sent.length, 0);
    assert.equal(f.drafts.length, 0);
  } finally {
    f.source.dispose();
  }
});

test('240-message history starts at 80, pages by 80 with all stable identities reachable', async () => {
  const f = fixture();
  for (let id = 1; id <= 240; id++) f.add(id, `合成历史${id}`);
  try {
    const initial = f.source.getSnapshot();
    assert.equal(initial.totalMessages, 240);
    assert.equal(initial.messages.length, 80);
    assert.equal(initial.messages[0].id, '161');
    assert.equal(initial.hasOlder, true);
    assert.equal((await f.source.loadOlder()).loaded, 80);
    const second = f.source.getSnapshot();
    assert.equal(second.messages.length, 160);
    assert.equal(second.messages[0].id, '81');
    await f.source.loadOlder();
    const all = f.source.getSnapshot();
    assert.equal(all.messages.length, 240);
    assert.equal(all.hasOlder, false);
    assert.deepEqual(
      all.messages.map((m) => m.id),
      Array.from({ length: 240 }, (_, n) => String(n + 1)),
    );
    assert.equal((await f.source.loadOlder()).loaded, 0);
    assert.equal(f.stats().reads, 0);
    assert.equal(f.sent.length, 0);
    assert.equal(f.drafts.length, 0);
  } finally {
    f.source.dispose();
  }
});

test('new messages keep the existing visible history anchor, room/context switches reset window', async () => {
  const f = fixture();
  for (let id = 1; id <= 240; id++) f.add(id, `合成甲${id}`);
  for (let id = 301; id <= 540; id++) f.add(id, `合成乙${id}`, '-20');
  try {
    f.source.getSnapshot();
    await f.source.loadOlder();
    f.add(541, '刚到甲房');
    const appended = f.source.getSnapshot();
    assert.equal(appended.messages[0].id, '81');
    assert.equal(appended.messages.at(-1).id, '541');
    assert.equal(appended.messages.length, 161);
    f.switchRoom('-20');
    const other = f.source.getSnapshot();
    assert.equal(other.messages.length, 80);
    assert.equal(other.messages[0].id, '461');
    f.switchRoom('-10');
    const reset = f.source.getSnapshot();
    assert.equal(reset.messages.length, 80);
    assert.equal(reset.messages.at(-1).id, '541');
    const pending = f.source.loadOlder();
    f.switchRoom('-20');
    await assert.rejects(pending, (e) => e.code === 'CHAT_CONTEXT_CHANGED');
    assert.equal(f.source.getSnapshot().messages.length, 80);
  } finally {
    f.source.dispose();
  }
});
