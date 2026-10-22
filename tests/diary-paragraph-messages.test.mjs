import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectDiaryParagraphMessages } from '../public/shared/diary-paragraph-messages.js';
import { readDiaryCandidate } from '../src/server/domain/message-store.mjs';
import { openRevisitSources } from '../src/server/domain/revisit-sources.mjs';
import {
  tickRevisit,
  configureRevisit,
  revisitFeed,
  addRevisitComment,
} from '../src/server/domain/revisit.mjs';
import { validateRevisitState } from '../src/server/domain/revisit/delivery/archive.mjs';
import { resolveCommentContext } from '../src/server/domain/revisit/comments/context.mjs';
import { digest } from '../src/server/domain/revisit/sources/identity.mjs';

const p = (id, text) => ({
  type: 'paragraph',
  attrs: { blockId: id },
  content: [{ type: 'text', text }],
});
const unit = (content) => ({
  id: 'original-unit',
  origin: { kind: 'diary', entryId: 'entry' },
  body: { format: 'shiye-richdoc', version: 1, content },
  eventTime: {
    instant: '2025-10-18T03:00:00.000Z',
    timeZone: 'Asia/Shanghai',
    precision: 'second',
    source: 'manual-marker',
    sourceField: 'body',
  },
  state: 'active',
  revision: 1,
  replyTo: null,
  sourceSpans: [],
});
const getText = (n) => (n.type === 'text' ? n.text : (n.content || []).map(getText).join(''));

test('paragraphs split once with deterministic IDs and explicit estimates; originals remain intact', () => {
  const input = unit([
    p('stamp', '[2025/10/18 11:00:00]'),
    p('first', '　　第一段'),
    p('second', '　　第二段'),
    p('third', '第三段'),
  ]);
  const before = JSON.stringify(input),
    result = projectDiaryParagraphMessages([input]);
  assert.equal(result.length, 3);
  assert.deepEqual(
    result.map((u) => u.eventTime.offsetMilliseconds),
    [0, 2000, 4000],
  );
  assert.deepEqual(
    result.map((u) => getText(u.body)),
    ['　　第一段', '　　第二段', '第三段'],
  );
  assert.ok(
    result.every(
      (u) =>
        u.eventTime.baseInstant === input.eventTime.instant &&
        u.paragraphProjection.parentUnitId === input.id,
    ),
  );
  assert.equal(new Set(result.map((u) => u.id)).size, 3);
  assert.deepEqual(projectDiaryParagraphMessages(result), result);
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(projectDiaryParagraphMessages([input]), result);
  const revised = projectDiaryParagraphMessages([{ ...input, revision: 2 }]);
  assert.ok(revised.every((u) => !result.some((old) => old.id === u.id)));
});

test('only explicit line boundaries and indentation split paragraphs; ordinary wrapping and marks survive', () => {
  const input = unit([
    {
      ...p('body', 'normal continuation\ncontinues'),
      content: [
        { type: 'text', text: 'normal\ncontinuation', marks: [{ type: 'bold' }] },
        { type: 'hardBreak', attrs: { blockId: 'b' } },
        { type: 'text', text: '　　下一段' },
        { type: 'hardBreak', attrs: { blockId: 'c' } },
        { type: 'hardBreak', attrs: { blockId: 'd' } },
        { type: 'text', text: '最后一段' },
      ],
    },
  ]);
  const result = projectDiaryParagraphMessages([input]);
  assert.equal(result.length, 3);
  assert.equal(result[0].body.content[0].content[0].marks[0].type, 'bold');
  assert.ok(getText(result[0].body).includes('normalcontinuation'));
});

test('large groups prefer one second; estimates never cross the next real manual marker', () => {
  const input = unit(Array.from({ length: 12 }, (_, i) => p('p' + i, '段' + i)));
  assert.deepEqual(
    projectDiaryParagraphMessages([input]).map((u) => u.eventTime.offsetMilliseconds),
    Array.from({ length: 12 }, (_, i) => i * 1000),
  );
  const next = unit([p('next', '下一组')]);
  next.id = 'next';
  next.eventTime.instant = '2025-10-18T03:00:02.000Z';
  const result = projectDiaryParagraphMessages([input, next]);
  assert.ok(result.slice(0, -1).every((u) => u.eventTime.instant < next.eventTime.instant));
  assert.ok(result.some((u) => u.paragraphProjection?.clamped));
});

test('code/list/quotes retain their internal structure; independent media and chat timestamps are unchanged', () => {
  const code = {
    type: 'codeBlock',
    attrs: { blockId: 'code', language: 'text' },
    content: [{ type: 'text', text: 'a\n　　code\nb' }],
  };
  const input = unit([code, p('after', '文字')]);
  const result = projectDiaryParagraphMessages([input]);
  assert.equal(result.length, 2);
  assert.deepEqual(result[0].body.content[0], code);
  const media = unit([
    {
      type: 'image',
      attrs: {
        blockId: 'image',
        assetId: 'asset',
        occurrenceId: 'occ',
        insertedAt: '2025-10-18T03:03:00.000Z',
        widthRatio: 0.75,
        align: 'center',
        caption: '',
        alt: '',
      },
    },
  ]);
  assert.deepEqual(projectDiaryParagraphMessages([media]), [media]);
  const chat = { ...input, origin: { kind: 'chat', entryId: 'entry' } };
  assert.deepEqual(projectDiaryParagraphMessages([chat]), [chat]);
});

test('legacy reading exposes paragraph messages without rewriting units or layout; old replay refs remain resolvable', () => {
  const entry = {
    id: 'entry',
    revision: 1,
    category: '日常',
    date: '2025-10-18T03:00:00.000Z',
    updatedAt: '2025-10-18T03:00:00.000Z',
    contentFormat: 'html',
    content: '<p>[2025/10/18 11:00:00]</p><p>　　第一段</p><p>　　第二段</p><p>　　第三段</p>',
    attachments: [],
  };
  const db = { categories: ['日常'], media: [], entries: [entry] };
  const candidate = readDiaryCandidate(db, entry),
    session = openRevisitSources(db);
  assert.equal(candidate.units.length, 1);
  assert.equal(candidate.paragraphMessages.length, 3);
  assert.equal(session.catalog.sources.length, 3);
  const ref = { ...session.catalog.sources[0].ref, unitId: candidate.units[0].id };
  assert.equal(session.resolve(ref).unit.id, candidate.units[0].id);
  const original = JSON.stringify(db.entries);
  configureRevisit(db, {
    expectedRevision: 1,
    enabled: true,
    mode: 'interval',
    interval: { unit: 'month', count: 6 },
  });
  const oldSource = session.resolve(ref),
    due = Date.parse('2026-10-18T03:00:00Z');
  const id = 'revisit:' + digest([db.revisit.config.ruleRevision, ref, due]);
  const batch = {
    id: 'batch:' + digest([db.revisit.config.ruleRevision, due / 60000, [id]]),
    ruleRevision: db.revisit.config.ruleRevision,
    replayAt: new Date(due).toISOString(),
    createdAt: new Date(due).toISOString(),
    timeZone: 'Asia/Shanghai',
    targets: [ref],
  };
  db.revisit.cursor = '2026-10-18T03:00:00.000Z';
  db.revisit.batches.push(batch);
  db.revisit.deliveries.push({
    id,
    batchId: batch.id,
    sequence: 1,
    ref,
    originalAt: oldSource.unit.eventTime.instant,
    replayAt: new Date(due).toISOString(),
    sender: db.revisit.config.sender,
  });
  const oldComment = addRevisitComment(
    db,
    { operationId: 'before-split', batchId: batch.id, deliveryId: id, text: '原长消息的评论' },
    due + 1000,
  );
  const frozenComment = JSON.stringify(oldComment);
  const result = tickRevisit(db, {}, due + 60000);
  assert.equal(result.reprojected, 3);
  assert.equal(db.revisit.deliveries.length, 4);
  const feed = revisitFeed(db, { after: 0, limit: 50 });
  assert.equal(feed.deliveries.filter((d) => !d.superseded).length, 3);
  assert.equal(
    feed.deliveries.find((d) => d.replacesDeliveryId === id).ref.unitId,
    candidate.paragraphMessages[0].id,
  );
  assert.deepEqual(resolveCommentContext(db, { batchId: batch.id, deliveryId: id }).targets, [ref]);
  const child = db.revisit.deliveries[1];
  assert.deepEqual(
    resolveCommentContext(db, { batchId: child.batchId, deliveryId: child.id }).targets,
    [child.ref],
  );
  addRevisitComment(
    db,
    {
      operationId: 'after-split',
      batchId: child.batchId,
      deliveryId: child.id,
      text: '新段落评论',
    },
    due + 61000,
  );
  assert.equal(
    JSON.stringify(db.revisit.comments.find((c) => c.operationId === 'before-split')),
    frozenComment,
  );
  assert.equal(
    db.revisit.comments.find((c) => c.operationId === 'after-split').replyTo.unitId,
    child.ref.unitId,
  );
  validateRevisitState(db.revisit, db);
  // A previously acknowledged child can precede repair of display-only metadata.
  delete db.revisit.deliveries[0].paragraphReplacements;
  delete child.replacesDeliveryId;
  tickRevisit(db, {}, due + 120000);
  assert.equal(db.revisit.deliveries.length, 4);
  assert.equal(child.replacesDeliveryId, undefined); // tick commits owned copies
  assert.equal(db.revisit.deliveries[1].replacesDeliveryId, id);
  assert.equal(db.revisit.deliveries[0].paragraphReplacements.length, 3);
  assert.equal(JSON.stringify(db.entries), original);
});
