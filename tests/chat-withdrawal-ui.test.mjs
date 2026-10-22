import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from '../previews/telegram-chat/vendor/web-a/node_modules/esbuild/lib/main.js';
import { loadWorker } from './helpers/local-program-worker.mjs';
import { IDBFactory } from 'fake-indexeddb';

const root = fileURLToPath(new URL('../previews/telegram-chat/vendor/web-a/src/', import.meta.url));
async function loadRecovery() {
  const env = {
    state: { current: { chatId: '-1', threadId: 1, type: 'thread' }, tab: {} },
    drafts: [],
    mediaReads: 0,
    timers: [],
  };
  globalThis.__withdrawal = env;
  globalThis.indexedDB = new IDBFactory();
  globalThis.BroadcastChannel = class {
    postMessage() {}
  };
  globalThis.window = new EventTarget();
  globalThis.document = { querySelectorAll: () => [] };
  const realTimer = globalThis.setTimeout;
  globalThis.setTimeout = (callback) => {
    env.timers.push(callback);
    return 0;
  };
  const built = await build({
    entryPoints: [root + 'util/shiyeWithdrawalUi.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    plugins: [
      {
        name: 'ports',
        setup(b) {
          b.onResolve(
            {
              filter:
                /(?:api\/types|global$|global\/selectors(?:\/threads)?$|helpers\/messageMedia$|global\/helpers$|\.\/files$|\.\/mediaLoader$)/,
            },
            (args) => ({ path: args.path, namespace: 'port' }),
          );
          b.onLoad({ filter: /.*/, namespace: 'port' }, ({ path }) => ({
            loader: 'js',
            contents: path.endsWith('api/types')
              ? 'export const ApiMediaFormat={BlobUrl:1};'
              : path.endsWith('/global')
                ? 'export const getGlobal=()=>globalThis.__withdrawal.state; export const getActions=()=>({setEditingId:x=>globalThis.__withdrawal.editing=x,setEditingDraft:x=>globalThis.__withdrawal.editingDraft=x,openChatWithDraft:x=>globalThis.__withdrawal.drafts.push(x),showNotification:x=>globalThis.__withdrawal.notice=x,updateDraftReplyInfo:x=>globalThis.__withdrawal.reply=x});'
                : path.endsWith('/selectors') || path.endsWith('/threads')
                  ? 'export const selectCurrentMessageList=s=>s.current,selectDraft=s=>s.draft,selectEditingId=s=>s.editing,selectTabState=s=>s.tab;'
                  : path.endsWith('/helpers')
                    ? "export const getMessageDocument=m=>m.content.document,getMessagePhoto=m=>m.content.photo,getMessageVideo=m=>m.content.video,getMessageSticker=m=>m.content.sticker,getMediaHash=m=>m.mediaType==='photo'?`photo${m.id}`:`document${m.id}`,getMediaFilename=m=>m.fileName||m.id;"
                    : path.endsWith('/files')
                      ? "export const fetchBlob=async()=>new Blob([new Uint8Array([1,2,3])],{type:'image/png'});"
                      : path.endsWith('/mediaLoader')
                        ? "export const fetch=async()=>{globalThis.__withdrawal.mediaReads++; if(globalThis.__withdrawal.mediaRead)return globalThis.__withdrawal.mediaRead();return 'blob:synthetic';};"
                        : '',
          }));
        },
      },
    ],
  });
  const module = await import(
    'data:text/javascript;base64,' +
      Buffer.from(built.outputFiles[0].text).toString('base64') +
      '#' +
      crypto.randomUUID()
  );
  return {
    env,
    module,
    cleanup: () => {
      globalThis.setTimeout = realTimer;
    },
  };
}
const message = (content = { text: { text: 'synthetic text', entities: [] } }, chatId = '-1') => ({
  id: 41,
  chatId,
  isOutgoing: true,
  date: 100,
  content,
});

test('withdrawal recovery requires durable commit and protects drafts without a time limit', async () => {
  const { env, module: m, cleanup } = await loadRecovery();
  try {
    const original = message();
    original.replyInfo = {
      type: 'message',
      replyToMsgId: 9,
      quoteText: { text: 'synthetic old quote' },
    };
    const commit = await m.prepareWithdrawalRecovery([original]);
    assert.equal(m.hasWithdrawalRecovery('-1', 41), false);
    await commit();
    assert.equal(m.hasWithdrawalRecovery('-1', 41), true);
    env.state.draft = { replyInfo: { type: 'message', replyToMsgId: 7 } };
    assert.equal(await m.restoreWithdrawal('-1', 41), false);
    assert.equal(env.drafts.length, 0);
    env.state.draft = undefined;
    // The attachment wrapper has no box while its actual dialog remains visible
    document.querySelectorAll = (selector) =>
      selector.includes('.shiye-attachment-modal .modal-dialog')
        ? [{ getClientRects: () => [{}] }]
        : selector.includes('.shiye-attachment-modal')
          ? [{ getClientRects: () => [] }]
          : [];
    assert.equal(await m.restoreWithdrawal('-1', 41), false);
    assert.equal(env.drafts.length, 0);
    assert.equal(m.hasWithdrawalRecovery('-1', 41), true);
    document.querySelectorAll = () => [];
    env.state.current.chatId = '-2';
    assert.equal(await m.restoreWithdrawal('-1', 41), false);
    env.state.current.chatId = '-1';
    assert.equal(await m.restoreWithdrawal('-1', 41), true);
    assert.equal(env.editingDraft.draft.text, 'synthetic text');
    assert.equal(env.editing.messageId, 41);
    assert.deepEqual((await m.readWithdrawalRecovery('-1', 41)).reply, {
      type: 'message',
      replyToMsgId: 9,
      replyToPeerId: undefined,
      replyToTopId: undefined,
    });
    assert.equal(m.hasWithdrawalRecovery('-1', 41), true);
    assert.equal(env.timers.length, 0, 'no expiry timer is installed');
  } finally {
    cleanup();
  }
});

test('photo/video/document/sticker recovery reads bytes only on request and rechecks drafts after media await', async () => {
  const { env, module: m, cleanup } = await loadRecovery();
  try {
    for (const type of ['photo', 'video', 'document', 'sticker']) {
      await (
        await m.prepareWithdrawalRecovery([
          message({
            [type]: {
              mediaType: type,
              id: '44',
              fileName: 'synthetic.bin',
              thumbnail: { dataUri: 'not-cached' },
            },
          }),
        ])
      )();
      assert.equal(await m.restoreWithdrawal('-1', 41), true);
      assert.equal(env.drafts.at(-1).files[0].size, 3);
    }
    assert.equal(env.mediaReads, 4);
    let release;
    env.mediaRead = () =>
      new Promise((r) => {
        release = r;
      });
    await (
      await m.prepareWithdrawalRecovery([message({ photo: { mediaType: 'photo', id: '44' } })])
    )();
    const pending = m.restoreWithdrawal('-1', 41);
    await Promise.resolve();
    await Promise.resolve();
    env.state.draft = { text: { text: 'new draft' } };
    release('blob:synthetic');
    assert.equal(await pending, false);
    assert.equal(m.hasWithdrawalRecovery('-1', 41), true);
    assert.equal(env.drafts.length, 4);
  } finally {
    cleanup();
  }
});

test('pending changed text survives renewed prepare and clears only for its matching durable ACK', async () => {
  const { module: m, cleanup } = await loadRecovery();
  try {
    await (
      await m.prepareWithdrawalRecovery([message()])
    )();
    const first = await m.saveWithdrawalEditDraft('-1', 41, { text: 'first changed text' });
    await (
      await m.prepareWithdrawalRecovery([message()])
    )();
    assert.equal(
      (await m.readWithdrawalRecovery('-1', 41)).pendingEdit.draft.text,
      'first changed text',
    );
    const second = await m.saveWithdrawalEditDraft('-1', 41, { text: 'second changed text' });
    await m.completeWithdrawalEdit('-1', 41, first);
    assert.equal(
      (await m.readWithdrawalRecovery('-1', 41)).pendingEdit.draft.text,
      'second changed text',
    );
    await m.completeWithdrawalEdit('-1', 41, second);
    assert.equal((await m.readWithdrawalRecovery('-1', 41)).pendingEdit, undefined);
    assert.equal((await m.readWithdrawalRecovery('-1', 41)).text.text, 'synthetic text');
  } finally {
    cleanup();
  }
});

test('revisit recovery retains its original fixed target without changing the current comment draft', async () => {
  const { env, module: m, cleanup } = await loadRecovery();
  try {
    const fixed = { batchId: 'old-batch', deliveryId: 'old-delivery', sourceMessageId: 31 };
    window.shiyeRevisit = {
      readCommentTarget: async () => fixed,
      selectCommentTarget: async () => {
        throw Error('must not change a comment draft while entering edit mode');
      },
    };
    env.state.current.chatId = '-900000001';
    await (
      await m.prepareWithdrawalRecovery([message(undefined, '-900000001')])
    )();
    assert.equal(m.hasWithdrawalRecovery('-900000001', 41), true);
    assert.equal(await m.restoreWithdrawal('-900000001', 41), true);
    assert.deepEqual((await m.readWithdrawalRecovery('-900000001', 41)).target, fixed);
    assert.equal(env.reply, undefined);
  } finally {
    cleanup();
  }
});

test('service comment recovery quotes its original source after switching service, and never guesses a missing source', async () => {
  const { env, module: m, cleanup } = await loadRecovery();
  try {
    let sourceMessageId = 17;
    let requestedRoom;
    window.shiyeRevisit = {
      readCommentTarget: async (_id, roomId) => {
        requestedRoom = roomId;
        return {
          batchId: 'old-batch',
          deliveryId: 'old-source',
          instanceId: 'old-instance',
          roomId,
          sourceMessageId,
        };
      },
      selectCommentTarget: async () => true,
    };
    await (
      await m.prepareWithdrawalRecovery([message()])
    )();
    assert.equal(requestedRoom, '-1');
    assert.equal(await m.restoreWithdrawal('-1', 41), true);
    assert.equal((await m.readWithdrawalRecovery('-1', 41)).target.sourceMessageId, 17);
    sourceMessageId = undefined;
    await (
      await m.prepareWithdrawalRecovery([{ ...message(), id: 42 }])
    )();
    await assert.rejects(m.restoreWithdrawal('-1', 42), /原评论对象/);
    assert.equal(m.hasWithdrawalRecovery('-1', 41), true);
  } finally {
    cleanup();
  }
});

test('failed durable withdrawal leaves original authority and no tombstone in memory', async () => {
  const w = await loadWorker();
  const original = {
    users: [],
    chats: [],
    channels: [],
    dialogs: { active: [{ id: '-1', topMessage: 41 }], archived: [] },
    messages: { '-1': [{ id: 41, date: 100, message: 'synthetic retained' }] },
  };
  const client = { mockData: original };
  const open = indexedDB.open;
  indexedDB.open = () => {
    throw Error('synthetic storage failure');
  };
  try {
    await assert.rejects(
      w.invokeLocalPreview(client, new w.Api.messages.DeleteMessages({ id: [41] })),
      /synthetic storage failure/,
    );
    assert.equal(client.mockData, original);
    assert.equal(original.messages['-1'][0].message, 'synthetic retained');
    assert.equal(original.shiyeWithdrawnMessages, undefined);
  } finally {
    indexedDB.open = open;
  }
});
