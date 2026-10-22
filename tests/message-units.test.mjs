import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  prepareDiaryUnits as prepareRaw,
  reassembleDiaryUnits,
  validateMessageUnit,
} from '../public/shared/message-units.js';
import { fromEditorJSON } from '../public/shared/rich-document.js';
import { validateRenderableRichDocument } from '../public/shared/rich-document-renderer.js';

function prepareDiaryUnits(...args) {
  const result = prepareRaw(...args);
  result.units.forEach((unit) => validateRenderableRichDocument(unit.body));
  return result;
}

const p = (text, attrs = {}) => ({ type: 'paragraph', attrs, content: [{ type: 'text', text }] });
function doc(...content) {
  let id = 0;
  return fromEditorJSON({ type: 'doc', content }, () => `block-${++id}`);
}
const clock = '2020-01-02T03:04:05.000Z';
const entry = (body, extra = {}) => ({
  id: 'fictional-entry',
  body,
  contentEditedAt: clock,
  revision: 3,
  ...extra,
});
const factory = () => {
  let id = 0;
  return () => `unit-${++id}`;
};
const mediaNode = (type, occurrenceId, insertedAt = null) => ({
  type,
  attrs: {
    assetId: 'asset-one',
    occurrenceId,
    insertedAt,
    widthRatio: 0.5,
    align: 'center',
    caption: '虚构图注',
    alt: '',
  },
});

test('complete hardBreak markers split rich text and losslessly restore all AST boundaries', () => {
  const body = doc({
    type: 'paragraph',
    attrs: {},
    content: [
      { type: 'text', text: '前言🙂\n2025-10-16 ', marks: [{ type: 'bold' }] },
      { type: 'text', text: '09:10', marks: [{ type: 'italic' }] },
      { type: 'hardBreak' },
      { type: 'text', text: '第一段\n2025-10-16 10:20\n第二段\n' },
    ],
  });
  const snapshot = structuredClone(body);
  const prepared = prepareDiaryUnits(entry(body), { createId: factory() });
  assert.equal(prepared.units.length, 3);
  assert.equal(prepared.units[0].eventTime.source, 'edit-fallback');
  assert.equal(prepared.units[1].eventTime.instant, '2025-10-16T01:10:00.000Z');
  assert.equal(prepared.units[2].eventTime.precision, 'minute');
  assert.deepEqual(reassembleDiaryUnits(prepared.units, prepared.layout), body);
  assert.deepEqual(body, snapshot);
  assert.ok(!JSON.stringify(prepared.layout).includes('第一段'));
});

test('nested lists, quotes, tables, empty leaves, rules and inline marks retain original structure', () => {
  const body = doc(
    {
      type: 'orderedList',
      attrs: { start: 4 },
      content: [{ type: 'listItem', content: [p('2025-10-16 09:10'), p('列表\n下一行')] }],
    },
    { type: 'blockquote', content: [p('2025-10-16 10:20')] },
    {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [{ type: 'tableCell', attrs: { colspan: 2 }, content: [p('单元格')] }],
        },
      ],
    },
    { type: 'paragraph' },
    { type: 'paragraph', content: [] },
    p(''),
    { type: 'horizontalRule' },
    {
      type: 'codeBlock',
      attrs: { language: 'text' },
      content: [{ type: 'text', text: '2025-10-16 11:30' }],
    },
  );
  const prepared = prepareDiaryUnits(entry(body));
  assert.equal(prepared.units.filter((u) => u.eventTime.source === 'manual-marker').length, 1);
  assert.deepEqual(reassembleDiaryUnits(prepared.units, prepared.layout), body);
});

test('media uses appearance insertion time and legacy edit fallback independently of surrounding markers', () => {
  const body = doc(
    mediaNode('image', 'old-appearance'),
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: '2025-10-16 09:10\n之前' },
        mediaNode('image', 'new-appearance', '2026-10-16T10:11:12.000Z'),
        { type: 'text', text: '之后' },
      ],
    },
    mediaNode('video', 'old-video'),
  );
  const prepared = prepareDiaryUnits(entry(body), { media: [] });
  const appearances = prepared.units.filter((u) => u.identityKey?.startsWith('media:'));
  assert.equal(appearances.length, 3);
  assert.deepEqual(
    appearances.map((u) => u.eventTime.instant),
    [clock, '2026-10-16T10:11:12.000Z', clock],
  );
  assert.equal(appearances[0].eventTime.sourceField, 'contentEditedAt');
  assert.equal(appearances[1].eventTime.source, 'media-inserted');
  assert.equal(prepared.issues.filter((i) => i.code === 'missing-media').length, 3);
  assert.deepEqual(reassembleDiaryUnits(prepared.units, prepared.layout), body);
});

test('unknown original times remain unknown even when updatedAt is available', () => {
  const prepared = prepareDiaryUnits(
    entry(doc(p('无日期'), mediaNode('image', 'unknown')), {
      contentEditedAt: null,
      updatedAt: clock,
    }),
  );
  assert.ok(prepared.units.every((u) => u.eventTime.instant === null));
  assert.ok(prepared.issues.some((i) => i.code === 'unknown-content-edit-time'));
});

test('same body, mutable title/category and simple content edits keep stable identity', () => {
  const body = doc(p('2025-10-16 09:10\n第一段'), p('2025-10-16 10:20\n第二段'));
  const first = prepareDiaryUnits(entry(body), { createId: factory() });
  const second = prepareDiaryUnits(entry(body, { title: '改名', category: '分类变化' }), {
    previousUnits: first.units,
  });
  assert.deepEqual(
    second.units.map((u) => u.id),
    first.units.map((u) => u.id),
  );
  assert.deepEqual(
    second.units.map((u) => u.revision),
    [1, 1],
  );
  const changed = structuredClone(body);
  changed.content[1].content[0].text += '补写';
  const third = prepareDiaryUnits(entry(changed), { previousUnits: second.units });
  assert.deepEqual(
    third.units.map((u) => u.id),
    first.units.map((u) => u.id),
  );
  assert.deepEqual(
    third.units.map((u) => u.revision),
    [1, 2],
  );
  assert.deepEqual(reassembleDiaryUnits(third.units, third.layout), changed);
  assert.ok(third.units.every((u) => !Object.hasOwn(u, 'title') && !Object.hasOwn(u, 'category')));
});

test('splits and merges allocate new identities with explicit mappings and preserve old references', () => {
  const body = doc(p('2025-10-16 09:10\n原段\n后段'));
  const first = prepareDiaryUnits(entry(body));
  first.units[0].replyTo = 'older-message';
  const changed = structuredClone(body);
  changed.content[0].content[0].text = '2025-10-16 09:10\n原段\n2025-10-16 10:20\n后段';
  const split = prepareDiaryUnits(entry(changed), { previousUnits: first.units });
  assert.equal(split.units.length, 2);
  assert.ok(split.units.every((u) => u.id !== first.units[0].id && u.replyTo === null));
  assert.deepEqual(split.mappings.find((m) => m.kind === 'split').from, [first.units[0].id]);
  assert.equal(first.units[0].replyTo, 'older-message');
  const merged = prepareDiaryUnits(entry(body), { previousUnits: split.units });
  assert.equal(merged.mappings.find((m) => m.kind === 'merge').from.length, 2);
});

test('same timestamps, repeated media assets and foreign comments never merge identities', () => {
  const body = doc(
    p('2025-10-16 09:10\n甲'),
    p('2025-10-16 09:10\n乙'),
    mediaNode('image', 'appearance-a'),
    mediaNode('image', 'appearance-b'),
  );
  const first = prepareDiaryUnits(entry(body));
  const comment = {
    ...first.units[0],
    id: 'comment-id',
    origin: { kind: 'comment', entryId: 'fictional-entry' },
  };
  const second = prepareDiaryUnits(entry(body), { previousUnits: [comment, ...first.units] });
  assert.deepEqual(
    second.units.map((u) => u.id),
    first.units.map((u) => u.id),
  );
  assert.ok(second.mappings.every((m) => !m.from.includes('comment-id')));
  assert.equal(new Set(second.units.map((u) => u.id)).size, 4);
});

test('partial timestamps, DST ambiguity and reversed time never invent current or next-day time', () => {
  const body = doc(p('2025-11-02 01:30\n未知\n2025-11-03 10:20\n明确\n2025-11-01 09:10\n倒序'));
  const prepared = prepareDiaryUnits(entry(body, { contentEditedAt: null }), {
    timeZone: 'America/New_York',
  });
  assert.equal(prepared.units[0].eventTime.instant, null);
  assert.ok(prepared.issues.some((i) => i.code === 'ambiguous-time'));
  assert.ok(prepared.issues.some((i) => i.code === 'time-order-reversed'));
  const partial = prepareDiaryUnits(entry(doc(p('2025-10-16\n09:10\n日期加时钟'))));
  assert.ok(partial.units.every((u) => u.eventTime.instant === null));
  assert.deepEqual(reassembleDiaryUnits(prepared.units, prepared.layout), body);
});

test('validator supports chat/comment and withdrawal; bad references and missing fragments fail closed', () => {
  const prepared = prepareDiaryUnits(entry(doc(p('虚构'))));
  const unit = prepared.units[0];
  assert.equal(validateMessageUnit(unit), unit);
  assert.doesNotThrow(() =>
    validateMessageUnit({
      ...unit,
      origin: {
        kind: 'chat',
        entryId: 'chat-entry',
        sourceId: 'source',
        roomId: 'room',
        messageId: 'message',
      },
      replyTo: 'reply-id',
    }),
  );
  assert.doesNotThrow(() =>
    validateMessageUnit({
      ...unit,
      origin: { kind: 'comment', entryId: 'entry' },
      commentOn: [{ unitId: unit.id }],
    }),
  );
  assert.doesNotThrow(() => validateMessageUnit({ ...unit, state: 'withdrawn', body: null }));
  assert.throws(() => validateMessageUnit({ ...unit, state: 'withdrawn' }));
  assert.throws(() =>
    validateMessageUnit({
      ...unit,
      eventTime: { ...unit.eventTime, instant: '2025-02-30T00:00:00Z' },
    }),
  );
  assert.throws(() => reassembleDiaryUnits([], prepared.layout));
  assert.throws(() => reassembleDiaryUnits([unit, unit], prepared.layout));
  assert.throws(() =>
    prepareDiaryUnits(entry(doc(p('a'), mediaNode('image', 'b'))), { createId: () => 'collision' }),
  );
});

test('same-block markers retain identity across content and marker edits; tombstones stay retired', () => {
  const body = doc(p('2025-10-16 09:10\n甲\n2025-10-16 10:20\n乙'));
  const first = prepareDiaryUnits(entry(body));
  first.units[0].createdAt = clock;
  first.units[0].futureField = { preserved: true };
  const changed = structuredClone(body);
  changed.content[0].content[0].text = '2025-10-16 09:10\n甲修改长度\n2025-10-16 10:21\n乙修改';
  const next = prepareDiaryUnits(entry(changed), { previousUnits: first.units });
  assert.deepEqual(
    next.units.map((u) => u.id),
    first.units.map((u) => u.id),
  );
  assert.deepEqual(next.units[0].futureField, { preserved: true });
  assert.equal(next.units[0].createdAt, clock);
  const tombstones = next.units.map((u) => ({ ...u, body: null, state: 'deleted' }));
  tombstones.forEach(validateMessageUnit);
  const restored = prepareDiaryUnits(entry(changed), { previousUnits: tombstones });
  assert.ok(restored.units.every((u) => !tombstones.some((old) => old.id === u.id)));
});

test('duplicate same-block timestamps retain separate IDs on an unchanged save', () => {
  const body = doc(p('2025-10-16 09:10\n相同\n2025-10-16 09:10\n相同\n'));
  const first = prepareDiaryUnits(entry(body));
  const second = prepareDiaryUnits(entry(body), { previousUnits: first.units });
  assert.equal(first.units.length, 2);
  assert.deepEqual(
    second.units.map((u) => u.id),
    first.units.map((u) => u.id),
  );
});

test('caller-resolved legacy clock retains original source-field provenance', () => {
  const result = prepareDiaryUnits(
    entry(doc(p('旧正文'), mediaNode('image', 'old')), {
      editTimeSourceField: 'legacy.original.updateTime',
    }),
  );
  assert.ok(result.units.every((u) => u.eventTime.sourceField === 'legacy.original.updateTime'));
  assert.ok(result.units.every((u) => u.eventTime.instant === clock));
});

test('appending C to one hardBreak paragraph preserves A/B identities and replies', () => {
  const body = doc({
    type: 'paragraph',
    content: [
      { type: 'text', text: '2025-10-16 09:10' },
      { type: 'hardBreak' },
      { type: 'text', text: 'A' },
      { type: 'hardBreak' },
      { type: 'text', text: '2025-10-16 10:20' },
      { type: 'hardBreak' },
      { type: 'text', text: 'B' },
    ],
  });
  const first = prepareDiaryUnits(entry(body));
  first.units[1].replyTo = 'stable-comment-target';
  const added = structuredClone(body);
  added.content[0].content.push(
    { type: 'hardBreak', attrs: { blockId: 'new-break' } },
    { type: 'text', text: '2025-10-16 11:30\nC' },
  );
  const second = prepareDiaryUnits(entry(added), { previousUnits: first.units });
  assert.deepEqual(
    second.units.slice(0, 2).map((u) => u.id),
    first.units.map((u) => u.id),
  );
  assert.equal(second.units[1].replyTo, 'stable-comment-target');
  assert.ok(second.mappings.some((m) => m.kind === 'created' && m.to.includes(second.units[2].id)));
  const edited = structuredClone(added);
  edited.content[0].content[6].text = 'B修改';
  const third = prepareDiaryUnits(entry(edited), { previousUnits: second.units });
  assert.deepEqual(
    third.units.map((u) => u.id),
    second.units.map((u) => u.id),
  );
  const prepended = structuredClone(edited);
  prepended.content[0].content.unshift({ type: 'text', text: '2025-10-16 08:00\n独立前段\n' });
  const fourth = prepareDiaryUnits(entry(prepended), { previousUnits: third.units });
  assert.deepEqual(
    fourth.units.slice(1).map((u) => u.id),
    third.units.map((u) => u.id),
  );
  assert.deepEqual(reassembleDiaryUnits(fourth.units, fourth.layout), prepended);
});

test('ambiguous edits to duplicate markers are explicitly repartitioned', () => {
  const body = doc(p('2025-10-16 09:10\n相同\n2025-10-16 09:10\n相同\n'));
  const first = prepareDiaryUnits(entry(body));
  const changed = structuredClone(body);
  changed.content[0].content[0].text = '2025-10-16 09:10\n共同修改\n2025-10-16 09:10\n共同修改\n';
  const second = prepareDiaryUnits(entry(changed), { previousUnits: first.units });
  assert.ok(second.mappings.some((m) => m.kind === 'repartition'));
  assert.ok(second.units.every((u) => !first.units.some((p) => p.id === u.id)));
});
