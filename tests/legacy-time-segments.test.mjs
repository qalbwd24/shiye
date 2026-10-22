import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLegacyTimeSegments } from '../public/shared/legacy-time-segments.js';
import { fromEditorJSON } from '../public/shared/rich-document.js';

const p = (text, type = 'paragraph') => ({ type, content: [{ type: 'text', text }] });
function doc(...content) {
  let id = 0;
  return fromEditorJSON({ type: 'doc', content }, () => `test-block-${++id}`);
}
const fallbackAt = '2026-10-16T08:09:10.123Z';

test('all eleven markers in one paragraph are indexed without changing source or line breaks', () => {
  const raw = Array.from(
    { length: 11 },
    (_, i) => `　　【2025年10月16日 ${String(i).padStart(2, '0')}:10】\n虚构正文🙂${i}`,
  ).join('\n');
  const body = doc(p(raw));
  const before = structuredClone(body);
  const result = buildLegacyTimeSegments(body);
  assert.equal(result.anchors.length, 11);
  assert.equal(result.segments.length, 22);
  for (let i = 0; i < 11; i++) {
    const anchor = result.anchors[i];
    assert.equal(anchor.blockId, body.content[0].attrs.blockId);
    assert.match(raw.slice(anchor.range.from, anchor.range.to), /^　　【2025年10月16日/);
    assert.equal(result.segments[i * 2 + 1].time.instant, anchor.time.instant);
    assert.equal(anchor.time.precision, 'minute');
    assert.equal(anchor.time.source, 'manual-marker');
  }
  assert.equal(result.segments.at(-1).range.to, raw.length);
  assert.deepEqual(body, before);
  assert.deepEqual(buildLegacyTimeSegments(body), result);
  result.anchors[0].range.from = 999;
  assert.equal(result.segments[0].anchor.range.from, 0);
});

test('hardBreak and text LF share a UTF-16 projection; headings and split text marks work', () => {
  const body = doc({
    type: 'heading',
    attrs: { level: 2 },
    content: [
      { type: 'text', text: '🙂前言\n　[2025/10/16 ' },
      { type: 'text', text: '09:10]', marks: [{ type: 'bold' }] },
      { type: 'hardBreak' },
      { type: 'text', text: '续写\n(2025-10-16 11:12:13)\n末行\n' },
    ],
  });
  const result = buildLegacyTimeSegments(body, { fallbackAt });
  assert.equal(result.anchors.length, 2);
  assert.equal(result.anchors[0].range.from, 5);
  assert.equal(result.segments[0].range.to, 5);
  assert.equal(result.segments[0].time.sourceField, 'entry-updatedAt');
  assert.equal(result.segments[2].time.instant, '2025-10-16T01:10:00.000Z');
  assert.equal(result.segments.at(-1).time.instant, '2025-10-16T03:12:13.000Z');
});

test('only adjacent explicit dates combine with time-only markers with visible provenance', () => {
  const body = doc(
    p('2025年10月16日'),
    p('[09:10]'),
    p('09:20:30'),
    p('虚构正文'),
    p('[10:30]'),
    p('之后不再继承旧锚点'),
  );
  const result = buildLegacyTimeSegments(body, { fallbackAt });
  assert.equal(result.anchors.length, 2);
  assert.equal(result.segments[0].role, 'date-context');
  assert.equal(result.segments[0].time.instant, null);
  assert.equal(result.anchors[0].time.instant, '2025-10-16T01:10:00.000Z');
  assert.equal(result.anchors[0].time.source, 'manual-date-context');
  assert.equal(result.anchors[0].time.dateContext.blockId, body.content[0].attrs.blockId);
  assert.equal(result.anchors[1].time.precision, 'second');
  assert.equal(result.anchors[1].time.dateContext.blockId, body.content[0].attrs.blockId);
  assert.equal(result.segments[3].time.instant, '2025-10-16T01:20:30.000Z');
  assert.equal(result.segments[5].time.instant, null);
  assert.ok(result.issues.some((issue) => issue.code === 'unresolved-time-only'));
});

test('complete marker provides adjacent date and explicit offset, never rollover on reversal', () => {
  const result = buildLegacyTimeSegments(
    doc(p('2025-10-16T23:50+02:00\n00:10\n2025-10-15T21:00Z\n20:00')),
  );
  assert.equal(result.anchors.length, 4);
  assert.equal(result.anchors[1].time.instant, '2025-10-15T22:10:00.000Z');
  assert.equal(result.anchors[1].time.timeZone, '+02:00');
  assert.equal(result.anchors[3].time.instant, '2025-10-15T20:00:00.000Z');
  assert.equal(result.issues.filter((issue) => issue.code === 'time-order-reversed').length, 3);
});

test('DST gaps/folds, invalid calendar values and broken brackets remain unresolved', () => {
  const result = buildLegacyTimeSegments(
    doc(
      p('2025-03-09 02:30\n2025-11-02 01:30\n[2025/02/30 12:00]\n[2025/10/16 09:10)'),
      p('2025-02-30'),
      p('[2025/10/]'),
    ),
    { timeZone: 'America/New_York', fallbackAt },
  );
  assert.equal(result.anchors.length, 0);
  assert.ok(result.issues.some((issue) => issue.code === 'ambiguous-time'));
  assert.equal(result.issues.filter((issue) => issue.code === 'invalid-time').length, 3);
  assert.equal(result.issues.filter((issue) => issue.code === 'unclassified-time').length, 2);
  assert.ok(result.segments.every((segment) => segment.time.instant === null));
});

test('prose mentions, blockquotes, code blocks and inline code do not create anchors or spam issues', () => {
  const body = doc(
    p('2025-10-16 08:00'),
    p('2025-10-15 09:10 的事情仍然记得。'),
    p('想到2025-10-15 10:20的往事'),
    { type: 'blockquote', content: [p('2024-01-01 01:00\n01:10')] },
    p('2023-01-01 01:00', 'codeBlock'),
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: '2022-01-01 01:00', marks: [{ type: 'code' }] },
        { type: 'hardBreak' },
        { type: 'text', text: '2025-10-16 09:00' },
      ],
    },
    p('后文'),
  );
  const result = buildLegacyTimeSegments(body);
  assert.equal(result.anchors.length, 2);
  assert.equal(result.issues.length, 0);
  assert.equal(result.segments.at(-1).time.instant, '2025-10-16T01:00:00.000Z');
  assert.equal(result.segments[3].time.instant, '2025-10-16T00:00:00.000Z');
});

test('missing clocks never use today or fallback date; date context breaks on blank/resource/quote', () => {
  const result = buildLegacyTimeSegments(
    doc(
      p('[12:30]'),
      p('2025-10-16\n\n13:30'),
      p('之后'),
      p('2025-10-16'),
      {
        type: 'blockquote',
        content: [p('引用')],
      },
      p('14:30'),
    ),
    { fallbackAt },
  );
  assert.equal(result.anchors.length, 0);
  assert.equal(result.issues.filter((issue) => issue.code === 'unresolved-time-only').length, 3);
  assert.ok(result.segments.every((segment) => segment.time.instant === null));
});

test('pure images retain marked edit fallback and never invent insertion/content timestamps', () => {
  const body = doc({
    type: 'image',
    attrs: {
      assetId: 'fictional-asset',
      occurrenceId: 'fictional-occurrence',
      insertedAt: null,
      widthRatio: 1,
      align: 'center',
      caption: '2025-10-16 12:30',
      alt: '',
    },
  });
  const before = structuredClone(body);
  const result = buildLegacyTimeSegments(body, { fallbackAt, fallbackSource: 'legacy-updateTime' });
  assert.equal(result.anchors.length, 0);
  assert.equal(result.segments[0].time.instant, fallbackAt);
  assert.equal(result.segments[0].time.source, 'edit-fallback');
  assert.equal(result.segments[0].time.sourceField, 'legacy-updateTime');
  assert.deepEqual(result.segments[0].range, { from: 0, to: 0 });
  assert.equal(buildLegacyTimeSegments(body).segments[0].time.instant, null);
  assert.deepEqual(body, before);
});

test('invalid fallback dates and unsupported schema fail visibly without source mutation', () => {
  const body = doc(p('虚构正文'));
  const result = buildLegacyTimeSegments(body, { fallbackAt: '2025-02-30T10:10:00Z' });
  assert.equal(result.segments[0].time.instant, null);
  assert.equal(result.issues[0].code, 'invalid-fallback-time');
  assert.deepEqual(buildLegacyTimeSegments(doc()), { segments: [], anchors: [], issues: [] });
  const invalid = { ...body, version: 2 };
  assert.throws(() => buildLegacyTimeSegments(invalid), /格式或版本/);
  assert.equal(invalid.version, 2);
});

test('date-context clocks still validate calendar/DST and never resolve invalid clock values', () => {
  const result = buildLegacyTimeSegments(
    doc(p('2025-03-09\n02:30\n2025-11-02\n01:30\n99:10\n12:99\n12:00:60')),
    { timeZone: 'America/New_York' },
  );
  assert.equal(result.anchors.length, 0);
  assert.equal(result.issues.filter((issue) => issue.code === 'ambiguous-time').length, 1);
  assert.equal(result.issues.filter((issue) => issue.code === 'invalid-time').length, 4);
});

test('lists/tables keep leaf block identity, and CRLF offsets cover all original code units', () => {
  const raw = '前言🙂\r\n2025-10-16 10:20\r\n正文';
  const body = doc(
    { type: 'bulletList', content: [{ type: 'listItem', content: [p(raw)] }] },
    {
      type: 'table',
      content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [p('后文')] }] }],
    },
  );
  const result = buildLegacyTimeSegments(body);
  assert.equal(result.anchors.length, 1);
  assert.equal(result.anchors[0].blockId, body.content[0].content[0].content[0].attrs.blockId);
  assert.equal(result.anchors[0].range.from, 6);
  assert.equal(result.segments[2].range.to, raw.length);
  assert.equal(result.segments.at(-1).time.instant, '2025-10-16T02:20:00.000Z');
  assert.equal(
    result.segments.at(-1).blockId,
    body.content[1].content[0].content[0].content[0].attrs.blockId,
  );
});
