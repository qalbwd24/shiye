import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
const root = path.dirname(fileURLToPath(import.meta.url));
const source = path.join(root, 'vendor/web-a');
const now = Math.floor(Date.now() / 1000);
const msg = (id, message, secondsAgo, out = true) => ({
  id,
  message,
  date: now - secondsAgo,
  out,
  entities: [],
});
const seed = {
  users: [
    { id: '1', self: true, firstName: '我', lastName: '' },
    { id: '10', firstName: '随手记', lastName: '' },
    { id: '20', firstName: '灵感收集', lastName: '' },
    { id: '30', firstName: '过去的我', lastName: '' },
  ],
  chats: [],
  channels: [],
  dialogs: {
    active: [
      { id: '10', topMessage: 4 },
      { id: '20', topMessage: 7 },
      { id: '30', topMessage: 10 },
    ],
    archived: [],
  },
  messages: {
    10: [
      msg(1, '有些念头，不用等到写成一篇。', 1800),
      msg(2, '一句话、一张图，先把这一刻留下来。', 1700),
      msg(3, '今天想把记录变轻一点。\n\n想到什么，就在这里发给自己。', 900),
      msg(4, '这是独立测试会话，可以放心试写。', 200),
    ],
    20: [
      msg(5, '小想法，也值得有自己的位置。', 800),
      msg(6, '把最近的几个灵感收在同一个会话里。', 700),
      msg(7, '可以试试 **加粗**、`代码`、引用，以及图片和视频。', 400),
    ],
    30: [
      msg(8, '你还记得那天，想重新开始的心情吗？', 365 * 86400, false),
      msg(9, '给一年后的自己：慢慢来，也没关系。', 365 * 86400 + 60, false),
      msg(10, '这是过去来信的呈现样例，自动回送还没有启用。', 100, false),
    ],
  },
  availableReactions: [],
  documents: [],
  dialogFilters: [],
  topPeers: [],
};
fs.writeFileSync(
  path.join(source, 'src/lib/gramjs/client/__mocks__/default.json'),
  JSON.stringify(seed, null, 2),
);
let strings = fs.readFileSync(
  path.join(source, 'src/assets/localization/fallback.strings'),
  'utf8',
);
const labels = {
  ...JSON.parse(fs.readFileSync(path.join(root, 'chinese-labels.json'), 'utf8')),
  Search: '搜索聊天记录',
  SavedMessages: '我的收藏',
  SavedMessagesShort: '收藏',
  SendMessage: '发送消息',
  WeekdayToday: '今天',
  WeekdayYesterday: '昨天',
  AttachmentMenuPhotoOrVideo: '图片或视频',
  ComposerPlaceholder: '写下此刻的想法…',
  AttachmentCaptionPlaceholder: '添加说明…',
  Next: '下一步',
  Save: '保存',
  ContextCopyText: '复制文字',
  ContextCopyImage: '复制图片',
  ContextCopySelected: '复制选中文字',
  CopyAsMarkdown: '复制 Markdown',
  CopyAsText: '复制纯文本',
  CopyAsHtml: '复制 HTML',
  FormatDateAtTime: '{date} {time}',
  LastSeenOffline: '本地记录',
  Emoji: '表情',
  Select: '选择消息',
  Pin: '置顶',
  Unpin: '取消置顶',
  AttachPhoto: '图片和视频',
  AttachDocument: '文件',
  Message: '写下此刻的想法…',
  Reply: '引用回复',
  Copy: '复制',
  Delete: '删除',
  Edit: '编辑',
  Cancel: '取消',
  Send: '发送',
  Close: '关闭',
  Online: '本地会话',
  Today: '今天',
  Yesterday: '昨天',
  Settings: '设置',
  DeleteMessage: '删除消息',
  Forward: '转发',
  AttachPhotoOrVideo: '图片和视频',
  PhotosAndVideos: '图片与视频',
  MessagePlaceholder: '写下此刻的想法…',
};
// Only the verified local UI keys are added when upstream omitted their declarations.
const requiredLocalLabels = new Set([
  "Add", "ContextMoveTextUp", "ContextMoveTextDown", "AttachmentMenuSendAsFiles", "AttachmentMenuSendAllAsFiles", "AttachmentMenuSendAsMedia", "AttachmentMenuSendAllAsMedia", "AttachmentMenuEnableSpoiler", "AttachmentMenuDisableSpoiler", "AttachmentMenuUngroupAllMedia", "AttachmentMenuGroupAllMedia", "ShiyeAttachmentMoreActions", "ShiyeCancelAttachments", "AttachmentDragAddItems",
  "Add", "ContextMoveTextUp", "ContextMoveTextDown", "AttachmentMenuSendAsFiles", "AttachmentMenuSendAllAsFiles", "AttachmentMenuSendAsMedia", "AttachmentMenuSendAllAsMedia", "AttachmentMenuEnableSpoiler", "AttachmentMenuDisableSpoiler", "AttachmentMenuUngroupAllMedia", "AttachmentMenuGroupAllMedia",
  'ShiyeOriginalImage', 'ShiyeCompressedImage', 'ShiyeClearCompressedImage',
  'ShiyeChooseOriginalImage', 'ShiyeChooseCompressedImage',
  'ShiyeRetryForward',
  'EditMessage', 'SavedMessagesInfo', 'ShareWith', 'SelectChats',
  'FwdMessagesToChats_one', 'FwdMessagesToChats_other',
  'Chat.ForwardActionHeader', 'Common.Select',
  'ShiyeCancelMessageSelection', 'ShiyeWithdrawSelectedMessages',
  'ShiyeForwardTargetsSelected', 'lng_context_copy_selected_items', 'NothingFound',
  'ShiyeSendTo', 'ForwardedMessageCount', 'ForwardAnotherChat',
  'ShowSenderNames', 'ShowSendersName', 'HideSenderNames', 'HideSendersName',
  'ShowCaption', 'HideCaption', 'Conversation.ForwardOptions.ShowCaption',
  'Conversation.ForwardOptions.HideCaption', 'ComposerTitleForwardFrom',
]);
const escapedLabelKey = (key) => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
for (const [key, value] of Object.entries(labels)) {
  const pattern = new RegExp(`"${escapedLabelKey(key)}" = "[^"\\n]*";`, 'g');
  const declaration = `${JSON.stringify(key)} = ${JSON.stringify(value)};`;
  if (requiredLocalLabels.has(key) && !pattern.test(strings))
    strings = `${strings.trimEnd()}\n${declaration}\n`;
  else strings = strings.replace(pattern, () => declaration);
}
fs.writeFileSync(path.join(source, 'src/assets/localization/fallback.strings'), strings);
const initialFile = path.join(source, 'src/assets/localization/initialStrings.ts');
let initial = fs.readFileSync(initialFile, 'utf8');
for (const [key, value] of Object.entries(labels)) {
  const pattern = new RegExp(`"${escapedLabelKey(key)}": "[^"\\n]*"`, 'g');
  const declaration = `${JSON.stringify(key)}: ${JSON.stringify(value)}`;
  if (requiredLocalLabels.has(key) && !pattern.test(initial))
    initial = initial.replace(/\n\} as Record<LangKey, LangPackStringValue>;/,
      `,\n  ${declaration}\n} as Record<LangKey, LangPackStringValue>;`);
  else initial = initial.replace(pattern, () => declaration);
}
fs.writeFileSync(initialFile, initial.replace('} as Record<LangKey, LangPackStringValue>;', '} as unknown as Record<LangKey, LangPackStringValue>;'));
const htmlFile = path.join(source, 'index.html');
let html = fs
  .readFileSync(htmlFile, 'utf8')
  .replace(/(\.\/shiye-[\w-]+\.(?:js|css))\?v=[^"']+/g, '$1');
html = html.replace(
  /<html[^>]*>/,
  '<html lang="zh-CN" translate="no" class="notranslate initial">',
);
if (!html.includes('shiye-network-guard.js')) {
  html = html.replace(
    '<head>',
    `<head><meta http-equiv="Content-Security-Policy" content="connect-src https://shiye-preview.local blob: data:; object-src 'none'; base-uri 'self'; form-action 'none'"><script src="./shiye-network-guard.js"></script>`,
  );
}
if (!html.includes('shiye-preview.css'))
  html = html.replace('</head>', '<link rel="stylesheet" href="./shiye-preview.css"></head>');
for (const name of [
  'shiye-local-assets.js',
  'shiye-stickers.js',
  'shiye-sticker-layout.js',
  'shiye-media-drop.js',
  'shiye-input.js',
  'shiye-ime.js',
  'shiye-preview.js',
  'shiye-room-workspace.js',
  'shiye-chat-ui.js',
  'shiye-sidebar-motion.js',
  'shiye-journal.js',
  'shiye-revisit.js',
]) {
  if (!html.includes(name))
    html = html.replace('</body>', `<script src="./${name}"></script></body>`);
}
// Asset helpers must be available before the UI overlay, including when upgrading an older checkout.
html = html.replace('<script src="./shiye-local-assets.js"></script>', '');
html = html.replace('<script src="./shiye-input.js"></script>', '');
html = html.replace(
  '<script src="./shiye-preview.js">',
  '<script src="./shiye-local-assets.js"></script><script src="./shiye-input.js"></script><script src="./shiye-preview.js">',
);
fs.writeFileSync(htmlFile, html);
for (const name of [
  'shiye-stickers.js',
  'shiye-sticker-layout.js',
  'shiye-media-drop.js',
  'shiye-preview.css',
  'shiye-chat-ui.js',
  'shiye-sidebar-motion.js',
  'shiye-image-viewer.html',
  'shiye-image-viewer.js',
  'shiye-preview.js',
  'shiye-room-workspace.js',
  'shiye-journal.js',
  'shiye-revisit.js',
  'shiye-revisit.css',
  'shiye-revisit-client.js',
  'shiye-revisit-view.js',
  'shiye-network-guard.js',
  'shiye-local-assets.js',
  'shiye-input.js',
  'shiye-ime.js',
])
  fs.copyFileSync(path.join(root, name), path.join(source, 'public', name));
// Version the transitive module too; a changed client must not reuse a cached old module.
buildSync({
  entryPoints: [path.join(root, 'shiye-shared-runtime.js')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  outfile: path.join(source, 'public/shiye-shared-runtime.js'),
});
const sharedRuntimeHash = createHash('sha256')
  .update(fs.readFileSync(path.join(source, 'public/shiye-shared-runtime.js')))
  .digest('hex')
  .slice(0, 12);
fs.copyFileSync(path.join(root, '../../public/shared/hotkeys.js'), path.join(source, 'public/shiye-hotkeys.js'));
const sharedJournalFile = path.join(source, 'public/shiye-journal.js');
fs.writeFileSync(
  sharedJournalFile,
  fs
    .readFileSync(sharedJournalFile, 'utf8')
    .replace(
      /shiye-shared-runtime\.js\?v=[\w-]+/g,
      `shiye-shared-runtime.js?v=${sharedRuntimeHash}`,
    ),
);
const receiverFile = path.join(source, 'public/shiye-revisit.js');
const receiverClientHash = createHash('sha256')
  .update(fs.readFileSync(path.join(source, 'public/shiye-revisit-client.js')))
  .digest('hex')
  .slice(0, 12);
fs.writeFileSync(
  receiverFile,
  fs
    .readFileSync(receiverFile, 'utf8')
    .replace(
      /shiye-revisit-client\.js\?v=[\w-]+/,
      `shiye-revisit-client.js?v=${receiverClientHash}`,
    ),
);
fs.copyFileSync(
  path.join(root, '../../public/core/media-compression.js'),
  path.join(source, 'public/shiye-media-compression.js'),
);
if (!html.includes('shiye-revisit.css'))
  html = html.replace('</head>', '<link rel="stylesheet" href="./shiye-revisit.css"></head>');
html = html.replace(/(\.\/shiye-[\w-]+\.(?:js|css))(?=["'])/g, (url) => {
  const asset = path.join(source, 'public', url.slice(2));
  if (!fs.existsSync(asset)) return url;
  const digest = createHash('sha256').update(fs.readFileSync(asset)).digest('hex').slice(0, 12);
  return url + '?v=' + digest;
});
fs.writeFileSync(htmlFile, html);
console.log('Prepared synthetic library and Shiye theme overlay.');
