import { fromEditorJSON } from '../../public/shared/rich-document.js';
import { prepareDiaryUnits } from '../../public/shared/message-units.js';
import { commitChatUnit } from '../../src/server/domain/message-store.mjs';
import { parseChatMarkdown } from '../../src/server/domain/chat-journal.mjs';

export const paragraph = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
export function richBody(...content) {
  let index = 0;
  return fromEditorJSON({ type: 'doc', content }, () => `synthetic-block-${++index}`);
}

/** Entirely invented data; never derived from a personal library. */
export function sourceLibrary(variant = 0) {
  const edited = '2025-10-17T02:00:00.000Z';
  const base = (id) => ({
    id,
    title: `合成条目 ${id}`,
    category: '合成分类',
    tags: ['合成标签'],
    date: '2025-10-17T00:00:00.000Z',
    contentEditedAt: edited,
    updatedAt: edited,
    revision: 1,
    attachments: [],
    legacy: { retainedUnknown: { untouched: true } },
  });
  const image = {
    type: 'image',
    attrs: {
      assetId: 'synthetic-image',
      occurrenceId: 'synthetic-occurrence',
      insertedAt: '2025-10-17T01:23:45.000Z',
      caption: '合成图注',
      alt: '',
      align: 'center',
      widthRatio: 0.5,
    },
  };
  const db = {
    entries: [
      {
        ...base('old-html'),
        contentFormat: 'html',
        content: `<p>[2025/10/17 08:30:00]</p><p>合成文本 ${variant}<br>换行</p><hr><p>[2025/10/17 09:00:00]</p><p>第二段</p>`,
        attachments: ['synthetic-image'],
      },
      {
        ...base('old-markdown'),
        contentFormat: 'markdown',
        content: `**合成加粗**\n\n[2025/10/17 10:00:00]\n\n合成 Markdown ${variant}`,
      },
      {
        ...base('rich-candidate'),
        contentFormat: 'richdoc',
        body: richBody(paragraph('[2025/10/17 08:30:00]'), paragraph(`图文 ${variant}`), image, {
          ...image,
          type: 'video',
          attrs: {
            ...image.attrs,
            assetId: 'synthetic-video',
            occurrenceId: 'synthetic-video-occurrence',
          },
        }),
        attachments: ['synthetic-orphan'],
      },
      {
        ...base('canonical'),
        contentFormat: 'richdoc',
        body: richBody(paragraph('[2025/10/17 08:30:00]'), paragraph(`规范正文 ${variant}`), image),
      },
    ],
    categories: ['合成分类'],
    media: [
      { id: 'synthetic-image', type: 'image/png', name: '合成图片.png' },
      { id: 'synthetic-orphan', type: 'image/png', name: '旧附件.png' },
      { id: 'synthetic-video', type: 'video/mp4', name: '合成视频.mp4' },
    ],
    messageStore: { version: 1, units: [], layouts: {} },
    chatJournal: {
      rooms: [{ sourceId: 'synthetic-source', id: 'synthetic-room', title: '合成话题' }],
      withdrawals: [],
    },
    migrations: { legacyMetadataV06: true },
  };
  const canonical = db.entries[3];
  let index = 0;
  const prepared = prepareDiaryUnits(canonical, {
    media: db.media,
    createId: () => `synthetic-unit-${index++}`,
  });
  canonical.messageUnits = {
    version: 1,
    authority: 'messageStore',
    ids: prepared.units.map((unit) => unit.id),
  };
  db.messageStore.units.push(...prepared.units);
  db.messageStore.layouts[canonical.id] = { layout: prepared.layout };
  const chat = {
    ...base('partial-chat'),
    content: '<p>聊天兼容投影</p>',
    chatJournal: {
      sourceId: 'synthetic-source',
      roomId: 'synthetic-room',
      messages: [1, 2, 3].map((id) => ({
        id: String(id),
        sentAt: `2025-10-17T00:3${id}:00.000Z`,
        text: `合成消息 ${id} ${variant}`,
        attachments: id === 2 ? ['synthetic-image'] : [],
        ...(id === 2 ? { replyTo: '1' } : {}),
        ...(id === 3 ? { withdrawn: true } : {}),
      })),
    },
  };
  db.entries.push(chat);
  commitChatUnit(
    db,
    chat,
    chat.chatJournal.messages[0],
    parseChatMarkdown(chat.chatJournal.messages[0].text),
    { messageUnitsEnabled: true },
  );
  for (const [id, flags] of [
    ['hidden', { legacy: { isHidden: true } }],
    ['deleted', { deleted: true }],
    ['draft', { draft: true }],
  ])
    db.entries.push({ ...base(id), content: '<p>不应展示</p>', ...flags });
  return db;
}
