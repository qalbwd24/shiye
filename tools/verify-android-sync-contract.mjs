import path from 'node:path';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fromEditorJSON } from '../public/shared/rich-document.js';
import {
  productRecord,
  prepareProductEntry,
  productValue,
  productLibraryView,
  validateProductRecord,
  productMessageId,
  productConversationId,
} from '../public/shared/sync-product.js';
import { validateSyncOperation } from '../src/server/sync-v2/store.mjs';

const root = path.resolve(import.meta.dirname, '..');
const fixtureFile = path.join(root, 'docs/contracts/android-product-sync-v1.fixture.json');
const sha = (v) => createHash('sha256').update(v).digest('hex');

function buildFixture() {
  const sourceId = '2f04968b-f91d-42f8-93bb-6ca20db2b647',
    roomId = '6604109365671001';
  const category = 'taxonomy:fixture-category',
    tag = 'taxonomy:fixture-tag';
  const assetId = 'fixture-image',
    original = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');
  let block = 0,
    unit = 0;
  const body = fromEditorJSON(
    {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '[2025/10/17 08:30:00]' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '  合成中文，保留空格和换行。', marks: [{ type: 'bold' }] },
            { type: 'hardBreak' },
            { type: 'text', text: '第二行', marks: [{ type: 'italic' }] },
          ],
        },
        {
          type: 'image',
          attrs: {
            assetId,
            occurrenceId: 'fixture-occurrence',
            insertedAt: '2025-10-17T00:31:00.000Z',
            alt: '合成原图',
            caption: '图注',
            align: 'center',
            widthRatio: 0.5,
          },
        },
      ],
    },
    () => `fixture-block-${++block}`,
  );
  const entry = {
    id: 'b53bd1b6-4439-4506-8659-fe9c5b1fbe79',
    title: '合成图文日记',
    date: '2025-10-17T00:00:00.000Z',
    createdAt: '2025-10-17T00:00:00.000Z',
    updatedAt: '2025-10-17T01:00:00.000Z',
    contentEditedAt: '2025-10-17T01:00:00.000Z',
    revision: 3,
    category: '日常',
    tags: ['合成'],
    attachments: [assetId],
    contentFormat: 'richdoc',
    body,
    history: [],
    futureExtension: { keepUnknown: true, idLikeNumber: '9007199254740993' },
  };
  const media = {
    id: assetId,
    name: '合成.gif',
    type: 'image/gif',
    size: original.length,
    sha256: sha(original),
    importedAt: '2025-10-17T00:32:00.000Z',
    lastModified: 1760661120000,
  };
  const origin = { sourceId, roomId },
    conversationId = productConversationId(sourceId, roomId);
  const messages = [
    {
      id: '18446744073709551614',
      sentAt: '2025-10-17T00:33:00.000Z',
      text: '**合成加粗**\n第二行',
      attachments: [],
    },
    {
      id: '18446744073709551615',
      sentAt: '2025-10-17T00:34:00.000Z',
      text: '合成图文回复',
      attachments: [assetId],
      replyTo: '18446744073709551614',
    },
  ];
  const entryRecord = prepareProductEntry(entry, {
    refs: { category, tags: [tag], assets: [assetId] },
    media: [media],
    createId: () => `fixture-unit-${++unit}`,
  });
  const records = [
    productRecord('taxonomy', category, { id: category, kind: 'category', name: '日常' }),
    productRecord('taxonomy', tag, { id: tag, kind: 'tag', name: '合成' }),
    productRecord('order', 'order:fixture:category', { kind: 'category', ids: [category] }),
    productRecord('media', assetId, media, { asset: assetId }),
    productRecord(
      'conversation',
      conversationId,
      {
        sourceId,
        id: roomId,
        title: '合成随想',
        category: '日常',
        idleHours: 5,
        configuration: {
          wallpaperAssetId: assetId,
          avatarAssetId: assetId,
          messageAlign: 'right',
          bubbleOpacity: 0.8,
        },
      },
      { category, assets: [assetId], origin },
    ),
    productRecord(
      'sticker',
      'fixture-sticker',
      {
        id: 'fixture-sticker',
        mediaId: assetId,
        name: '合成收藏',
        note: '保留备注',
        futureExtension: { keepUnknown: true },
      },
      { assets: [assetId] },
    ),
    entryRecord,
    ...messages.map((m) =>
      productRecord('message', productMessageId(sourceId, roomId, m.id), m, {
        conversation: conversationId,
        origin,
        assets: m.attachments,
      }),
    ),
  ];
  return {
    contract: 'shiye.android-product-sync.v1',
    synthetic: true,
    protocol: 1,
    note: '独立DTO示例，不是可直接导入的完整数据库；不使用任何私人资料或真实凭据。',
    identityExample: { libraryId: sourceId, epoch: 'fixture-epoch-1' },
    records,
    transportExample: {
      ...entryRecord,
      revision: 1,
      state: 'active',
      updatedAt: '2025-10-17T01:01:00.000Z',
    },
    original: {
      assetId,
      base64: original.toString('base64'),
      sha256: sha(original),
      size: original.length,
    },
    wireExamples: {
      pushCreate: {
        operations: records
          .filter((r) =>
            ['taxonomy', 'order', 'media', 'entry', 'sticker'].includes(r.data._product.kind),
          )
          .map((r, i) => ({
            ...r,
            operationId: `fixture-create-${i}`,
            command: 'create',
            baseRevision: 0,
          })),
      },
      pushTitleOnly: {
        operations: [
          {
            operationId: 'fixture-title-only',
            entityType: entryRecord.entityType,
            entityId: entryRecord.entityId,
            command: 'updateFields',
            baseRevision: 1,
            changes: { title: '只改标题的合成示例' },
          },
        ],
      },
      initialSnapshot: { cursor: null, limit: 50 },
    },
    requests: {
      saveRoom: {
        sourceId,
        id: roomId,
        title: '合成随想',
        category: '日常',
        idleHours: 5,
        configuration: { wallpaperAssetId: assetId, messageAlign: 'right' },
      },
      sendMessages: { sourceId, roomId, messages },
      withdrawMessage: { sourceId, roomId, messageId: messages[0].id, sentAt: messages[0].sentAt },
      defaultSingleComment: {
        operationId: 'fixture-default-comment',
        batchId: 'batch:fixture',
        deliveryId: 'revisit:fixture',
        text: '合成默认单条回复',
      },
      explicitGroupComment: {
        operationId: 'fixture-group-comment',
        batchId: 'batch:fixture',
        text: '合成组评论',
      },
      mediaComment: {
        operationId: 'fixture-media-comment',
        batchId: 'batch:fixture',
        deliveryId: 'revisit:fixture',
        occurrenceId: 'fixture-occurrence',
        text: '合成图片评论',
      },
    },
    expected: {
      conversationId: 'room:' + sha(JSON.stringify([sourceId, roomId])),
      messageIds: messages.map((m) => 'chat:' + sha(JSON.stringify([sourceId, roomId, m.id]))),
      manualTime: '2025-10-17T00:30:00.000Z',
      mediaTime: '2025-10-17T00:31:00.000Z',
      businessRevision: 3,
      transportRevision: 1,
    },
  };
}

if (process.argv.includes('--write-fixture')) {
  await mkdir(path.dirname(fixtureFile), { recursive: true });
  await writeFile(fixtureFile, JSON.stringify(buildFixture(), null, 2) + '\n');
}
const fixture = JSON.parse(await readFile(fixtureFile, 'utf8'));
assert.equal(fixture.contract, 'shiye.android-product-sync.v1');
assert.equal(fixture.synthetic, true);
for (const record of fixture.records) {
  validateProductRecord(record.entityType, record.entityId, record.data);
  validateSyncOperation(
    { ...record, operationId: `fixture:${record.entityId}`, command: 'create', baseRevision: 0 },
    { serverWrite: true },
  );
}
for (const request of [fixture.wireExamples.pushCreate, fixture.wireExamples.pushTitleOnly])
  for (const op of request.operations) validateSyncOperation(op);
const send = fixture.requests.sendMessages;
assert.ok(
  send.messages.every((m) => typeof m.id === 'string' && BigInt(m.id) > 9223372036854775807n),
);
assert.equal(productConversationId(send.sourceId, send.roomId), fixture.expected.conversationId);
assert.deepEqual(
  send.messages.map((m) => productMessageId(send.sourceId, send.roomId, m.id)),
  fixture.expected.messageIds,
);
const view = productLibraryView(fixture.records),
  record = fixture.records.find((r) => r.data._product.kind === 'entry');
assert.equal(fixture.transportExample.revision, fixture.expected.transportRevision);
assert.equal(fixture.transportExample.data.revision, fixture.expected.businessRevision);
assert.equal(productValue(record).futureExtension.idLikeNumber, '9007199254740993');
assert.ok(view.messageStore.units.some((u) => u.eventTime.instant === fixture.expected.manualTime));
assert.ok(view.messageStore.units.some((u) => u.eventTime.instant === fixture.expected.mediaTime));
assert.equal(
  view.entries[0].body.content.find((n) => n.type === 'image').attrs.occurrenceId,
  'fixture-occurrence',
);
assert.equal(view.conversations[0].configuration.wallpaperAssetId, fixture.original.assetId);
assert.equal(view.stickers[0].futureExtension.keepUnknown, true);
const bytes = Buffer.from(fixture.original.base64, 'base64');
assert.equal(sha(bytes), fixture.original.sha256);
assert.equal(bytes.length, fixture.original.size);
assert.ok(fixture.requests.defaultSingleComment.deliveryId);
assert.equal(fixture.requests.explicitGroupComment.deliveryId, undefined);
assert.ok(fixture.requests.mediaComment.deliveryId && fixture.requests.mediaComment.occurrenceId);
const report = {
  contract: fixture.contract,
  passed: true,
  synthetic: true,
  records: fixture.records.length,
  fixtureSha256: sha(await readFile(fixtureFile)),
  checkedAt: new Date().toISOString(),
  scope: [
    'business-wire-validation',
    'stable-ids',
    'canonical-and-time',
    'unknown-fields',
    'media-bytes',
    'comment-targets',
  ],
  androidRuntimeTested: false,
  serverOrDiaryChanged: false,
};
await mkdir(path.join(root, 'outputs/product-sync-contract'), { recursive: true });
await writeFile(
  path.join(root, 'outputs/product-sync-contract/verification.json'),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify(report));
