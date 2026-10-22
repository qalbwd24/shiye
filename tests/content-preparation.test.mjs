import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareContent, readManualTime } from '../public/shared/content-preparation.js';
import { fromEditorJSON } from '../public/shared/rich-document.js';
import { richExtensions } from '../public/editor/rich-document-editor.js';
import { MarkdownManager } from '../public/vendor/rich-editor.js';

const savedAt = '2026-10-16T08:09:10.000Z';
const paragraph = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const picture = (occurrenceId, insertedAt = null) => ({
  type: 'image',
  attrs: {
    assetId: 'asset-shared',
    occurrenceId,
    insertedAt,
    widthRatio: 0.75,
    align: 'center',
    caption: '原图图注',
    alt: '图片',
  },
});
function document(...content) {
  let i = 0;
  return fromEditorJSON({ type: 'doc', content }, () => 'block-' + ++i);
}
const prepare = (body, extra = {}) =>
  prepareContent({ body, recordId: 'record-diary', revision: 1, updatedAt: savedAt, ...extra });

test('manual anchors override editing time; preamble uses a marked fallback; original text is untouched', async () => {
  const body = document(
    paragraph('前言'),
    paragraph('[2025/10/16  09:10:11]'),
    paragraph(' 空 格 中文🙂'),
    paragraph('(2025-10-16 10:20)'),
    paragraph('另一段'),
  );
  const copy = structuredClone(body);
  const result = await prepare(body);
  assert.deepEqual(body, copy);
  assert.deepEqual(result.body, copy);
  assert.equal(result.derived.blocks[0].time.source, 'edit-fallback');
  assert.equal(result.derived.blocks[0].time.instant, savedAt);
  assert.equal(result.derived.blocks[2].time.instant, '2025-10-16T01:10:11.000Z');
  assert.equal(result.derived.blocks[2].anchorBlockId, body.content[1].attrs.blockId);
  assert.equal(result.derived.blocks[4].time.precision, 'minute');
  assert.equal(result.derived.blocks[4].time.instant, '2025-10-16T02:20:00.000Z');
  result.body.content[0].content[0].text = '修改返回副本';
  assert.deepEqual(body, copy);
});

test('no timestamp uses explicit editing provenance; missing editing time never becomes now', async () => {
  const body = document(paragraph('无时间的文字'));
  const legacy = await prepare(body, { editTimeSource: 'legacy-updateTime' });
  assert.equal(legacy.derived.blocks[0].time.sourceField, 'legacy-updateTime');
  const missing = await prepare(body, { updatedAt: null });
  assert.equal(missing.derived.blocks[0].time.instant, null);
  assert.ok(missing.warnings.some((w) => w.code === 'unknown-content-time'));
  const invalid = await prepare(body, { updatedAt: '2026-02-30T00:00:00Z' });
  assert.equal(invalid.derived.blocks[0].time.instant, null);
});

test('pictures preserve independent insertion time and occurrence identity across repeated preparation', async () => {
  const body = document(
    paragraph('[2025/10/16 09:10]'),
    picture('occurrence-a', savedAt),
    picture('occurrence-b'),
  );
  const a = await prepare(body, { availableAssetIds: ['asset-shared'] });
  const b = await prepare(a.body, {
    revision: 2,
    updatedAt: '2026-10-17T08:09:10Z',
    availableAssetIds: ['asset-shared'],
  });
  assert.equal(a.derived.media.length, 2);
  assert.deepEqual(a.derived.assetIds, ['asset-shared']);
  assert.equal(a.derived.media[0].insertedAt, savedAt);
  assert.equal(a.derived.media[0].contentTime.instant, '2025-10-16T01:10:00.000Z');
  assert.equal(a.derived.media[1].insertedAt, null);
  assert.deepEqual(b.derived.media, a.derived.media);
  assert.deepEqual(b.body, a.body);
});

test('quoted/code timestamps stay literal and never alter following prose time', async () => {
  const body = document(
    paragraph('[2025/10/16 09:10]'),
    { type: 'blockquote', content: [paragraph('[2020/01/01 01:00]')] },
    { type: 'codeBlock', content: [{ type: 'text', text: '[2021/01/01 01:00]' }] },
    {
      type: 'paragraph',
      content: [{ type: 'text', text: '[2022/01/01 01:00]', marks: [{ type: 'code' }] }],
    },
    paragraph('仍属于第一个时间'),
  );
  const result = await prepare(body);
  assert.ok(result.derived.blocks.every((b) => b.time.instant === '2025-10-16T01:10:00.000Z'));
  assert.equal(result.derived.blocks.filter((b) => b.role === 'time-anchor').length, 1);
});

test('time-only and invalid markers are reported and stop unsafe inheritance', async () => {
  const result = await prepare(
    document(
      paragraph('[2025/10/16 09:10]'),
      paragraph('[10:20]'),
      paragraph('不猜日期'),
      paragraph('[2025/02/30 12:00]'),
      paragraph('也不沿用之前锚点'),
    ),
  );
  assert.ok(result.warnings.some((w) => w.code === 'unclassified-time'));
  assert.ok(result.warnings.some((w) => w.code === 'invalid-time'));
  assert.equal(result.derived.blocks[2].time.instant, null);
  assert.equal(result.derived.blocks[4].anchorBlockId, null);
});

test('messages and comments use native times rather than timestamps embedded in their body', async () => {
  const body = document(paragraph('[2000/01/01 01:00]'));
  const msg = await prepare(body, { kind: 'message', sentAt: savedAt });
  const comment = await prepare(body, { kind: 'comment', createdAt: savedAt });
  assert.equal(msg.derived.blocks[0].time.source, 'message-send');
  assert.equal(msg.derived.blocks[0].time.instant, savedAt);
  assert.equal(msg.derived.recallEligible, true);
  assert.equal(comment.derived.recallEligible, false);
  assert.equal(comment.derived.blocks[0].time.source, 'comment-created');
  await assert.rejects(prepare(body, { kind: 'message', sentAt: null }), /UTC/);
  await assert.rejects(
    prepare(body, { kind: 'comment', createdAt: '2025-02-30T00:00:00Z' }),
    /UTC/,
  );
});

test('withdrawn messages reject surviving bodies; valid tombstones have no derived original text', async () => {
  const body = document(paragraph('不可在索引中保留的撤回原文'));
  await assert.rejects(
    prepare(body, { kind: 'message', state: 'withdrawn', sentAt: savedAt }),
    /撤回/,
  );
  const result = await prepare(null, { kind: 'message', state: 'withdrawn', sentAt: savedAt });
  assert.equal(result.body, null);
  assert.equal(result.derived.plainText, '');
  assert.deepEqual(result.derived.blocks, []);
  assert.deepEqual(result.derived.assetIds, []);
  assert.equal(result.derived.recallEligible, false);
});

test('content hash is deterministic, key-order independent and invalidates on revision/time/zone changes', async () => {
  const body = document(paragraph('正文'));
  const a = await prepare(body);
  const b = await prepare({ content: body.content, version: 1, format: 'shiye-richdoc' });
  assert.equal(a.inputFingerprint, b.inputFingerprint);
  assert.match(a.inputFingerprint, /^[a-f0-9]{64}$/);
  assert.notEqual(a.inputFingerprint, (await prepare(body, { revision: 2 })).inputFingerprint);
  assert.notEqual(
    a.inputFingerprint,
    (await prepare(body, { updatedAt: '2026-10-17T08:09:10Z' })).inputFingerprint,
  );
  assert.notEqual(a.inputFingerprint, (await prepare(body, { timeZone: 'UTC' })).inputFingerprint);
});

test('unsupported content fails without stripping fields or changing the source', async () => {
  const body = document(paragraph('正文'));
  body.content.push({ type: 'futurePlugin', attrs: { blockId: 'new' } });
  const copy = structuredClone(body);
  await assert.rejects(prepare(body), /暂不支持/);
  assert.deepEqual(body, copy);
});

test('media availability must be reported explicitly and never silently drops image nodes', async () => {
  const body = document(picture('one'));
  const unchecked = await prepare(body);
  assert.equal(unchecked.derived.assetsChecked, false);
  const missing = await prepare(body, { availableAssetIds: [] });
  assert.deepEqual(missing.derived.missingAssetIds, ['asset-shared']);
  assert.equal(missing.derived.media.length, 1);
  assert.deepEqual(missing.body, body);
  assert.ok(missing.warnings.some((w) => w.code === 'missing-asset'));
});

test('explicit timezone offsets, invalid dates and DST gaps/folds do not produce false precision', () => {
  assert.equal(readManualTime('【2025年10月16日 9:10】').time.instant, '2025-10-16T01:10:00.000Z');
  assert.equal(
    readManualTime('2025-10-16T09:10:11+02:00').time.instant,
    '2025-10-16T07:10:11.000Z',
  );
  assert.equal(readManualTime('[2025/10/16 09:10:60]').issue, 'invalid-time');
  assert.equal(readManualTime('2025-10-16T09:10+14:30').issue, 'invalid-time');
  assert.equal(readManualTime('[2025/10/16 09:10)').issue, 'unclassified-time');
  assert.equal(readManualTime('2025-03-09 02:30', 'America/New_York').issue, 'invalid-time');
  assert.equal(readManualTime('2025-11-02 01:30', 'America/New_York').issue, 'ambiguous-time');
  assert.equal(readManualTime('想到2025-10-16 09:10').issue, null);
});

test('real parsed Markdown retains formatting and prose order through preparation and JSON storage', async () => {
  const manager = new MarkdownManager({ extensions: richExtensions() });
  let i = 0;
  const body = fromEditorJSON(
    manager.parse('**中文** *斜体* ==高亮==\n\n- 项目\n\n> 引用\n\n```js\nconst x = 1;\n```'),
    () => 'md-' + ++i,
  );
  const prepared = await prepare(body);
  const stored = JSON.parse(JSON.stringify(prepared));
  assert.deepEqual(stored.body, body);
  assert.deepEqual((await prepare(stored.body)).body, body);
  assert.ok(stored.derived.plainText.includes('中文 斜体 高亮'));
  assert.ok(stored.derived.plainText.indexOf('项目') < stored.derived.plainText.indexOf('const x'));
});

test('hidden, draft and deleted records are not admitted into derived public search or recall', async () => {
  const body = document(paragraph('私人内容'));
  for (const extra of [
    { visibility: { hidden: true, draft: false } },
    { visibility: { hidden: false, draft: true } },
    { state: 'deleted' },
  ]) {
    const result = await prepare(body, extra);
    assert.equal(result.derived.searchEligible, false);
    assert.equal(result.derived.recallEligible, false);
    assert.deepEqual(result.body, body);
  }
});

test('multiline paragraphs with timestamp-like prefixes remain unresolved instead of leaking a prior anchor', async () => {
  const body = document(
    paragraph('[2025/10/16 09:10]'),
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: '[2025/10/16 10:20]' },
        { type: 'hardBreak' },
        { type: 'text', text: '同段续写' },
      ],
    },
    paragraph('之后的段落'),
  );
  const result = await prepare(body);
  assert.ok(result.warnings.some((w) => w.code === 'embedded-marker-not-segmented'));
  assert.equal(result.derived.blocks[2].time.instant, null);
});

test('video appearances join derived media with provenance and remain meaningful without text or attachments', async () => {
  const { hasQuickContent } = await import('../public/shared/quick-capture.js');
  const body = document({
    type: 'video',
    attrs: {
      assetId: 'fictional-video',
      occurrenceId: 'video-content',
      insertedAt: null,
      widthRatio: 0.75,
      align: 'center',
      caption: '',
      alt: '',
    },
  });
  const before = structuredClone(body);
  const result = await prepare(body, { availableAssetIds: ['fictional-video'] });
  assert.equal(result.derived.media.length, 1);
  assert.equal(result.derived.media[0].type, 'video');
  assert.equal(result.derived.media[0].assetId, 'fictional-video');
  assert.equal(result.derived.media[0].insertedAt, null);
  assert.equal(result.derived.media[0].contentTime.instant, savedAt);
  assert.deepEqual(result.derived.assetIds, ['fictional-video']);
  assert.equal(
    hasQuickContent({ contentFormat: 'richdoc', body, content: '', attachments: [] }),
    true,
  );
  assert.deepEqual(body, before);
});
