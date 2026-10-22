import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { reviewMessageCandidate, reviewContentClock } from '../tools/lib/message-unit-review.mjs';
import { runMessageUnitReview } from '../tools/message-unit-review.mjs';
import {
  runMessageUnitCandidates,
  resolveCandidateClock,
} from '../tools/message-unit-candidates.mjs';
import { candidateHash } from '../tools/lib/message-unit-candidate-validator.mjs';
import { convertLegacyReadingEntry } from '../src/server/domain/legacy-reading-converter.mjs';
import { prepareDiaryUnits } from '../public/shared/message-units.js';

const at = '2025-01-02T03:04:05.000Z';
const source = (content, extra = {}) => ({
  id: randomUUID(),
  revision: 1,
  title: '合成复核',
  contentFormat: 'html',
  content,
  date: '2020-01-01T00:00:00.000Z',
  createdAt: at,
  updatedAt: at,
  attachments: [],
  ...extra,
});
function frozen(original, issueCodes, media = []) {
  const converted = convertLegacyReadingEntry(original, { media });
  const clock = resolveCandidateClock(original);
  let next = 0;
  const candidate = prepareDiaryUnits(
    {
      ...original,
      body: converted.body,
      contentEditedAt: clock.at,
      editTimeSource: clock.sourceField,
    },
    { media, createId: () => 'unit:synthetic:' + next++ },
  );
  return {
    original,
    converted,
    candidate,
    clock,
    source: { sha256: candidateHash(original), id: original.id, index: 0 },
    row: { issueCodes },
    packageSha256: 'synthetic-parent',
  };
}

test('review recovers compact Chinese and incomplete closing bracket without rewriting a character', () => {
  for (const [marker, code, expected] of [
    ['[2025年1月2日12:23:46]', 'compact-chinese-date', '2025-01-02T04:23:46.000Z'],
    ['[2025-01-02 12:23', 'missing-closing-bracket', '2025-01-02T04:23:00.000Z'],
  ]) {
    const payload = frozen(source(`<p>${marker}</p><p>合成正文</p>`), ['unclassified-time']);
    const before = structuredClone(payload);
    const reviewed = reviewMessageCandidate(payload);
    assert.deepEqual(payload, before);
    assert.deepEqual(reviewed.converted.body, payload.converted.body);
    assert.equal(reviewed.candidate.units[0].id, payload.candidate.units[0].id);
    assert.equal(reviewed.candidate.units[0].eventTime.instant, expected);
    assert.equal(reviewed.candidate.units[0].eventTime.recoveredSyntax, true);
    assert.equal(reviewed.decisions[0].rule, code);
    assert.equal(reviewed.original.content, before.original.content);
  }
});

test('time-only fragments use labeled edit fallback and never infer dates from entry date', () => {
  const payload = frozen(source('<p>[01:21]</p><p>午夜合成正文</p>'), ['unresolved-time-only']);
  const reviewed = reviewMessageCandidate(payload);
  assert.equal(reviewed.status, 'resolved-with-edit-fallback');
  assert.equal(reviewed.candidate.units[0].eventTime.instant, at);
  assert.equal(reviewed.candidate.units[0].eventTime.inferred, true);
  assert.equal(reviewed.candidate.units[0].eventTime.source, 'edit-fallback');
  assert.equal(reviewed.decisions[0].dateInferred, false);
  assert.deepEqual(reviewMessageCandidate(payload), reviewed);
});

test('reviewed clock distinguishes content edits from category-only changes using exact history evidence', () => {
  const priorClock = {
    at,
    sourceField: 'legacy.original.updateTime',
    issueCodes: ['conflicting-content-edit-clock'],
  };
  const old = source('<p>旧正文</p>');
  const category = {
    ...old,
    category: '改名',
    updatedAt: '2026-01-01T00:00:00.000Z',
    history: [old],
  };
  assert.equal(reviewContentClock(category, priorClock).at, at);
  assert.equal(
    reviewContentClock(category, priorClock).evidence,
    'same-content-before-metadata-change',
  );
  const edited = { ...category, content: '<p>新正文</p>' };
  assert.equal(reviewContentClock(edited, priorClock).at, edited.updatedAt);
  assert.equal(reviewContentClock(edited, priorClock).evidence, 'latest-history-content-changed');
  assert.throws(() => reviewContentClock({ ...old, history: [] }, priorClock), /history evidence/);
});

test('reversed timestamps preserve original layout and both stable identities', () => {
  const payload = frozen(
    source('<p>[2025-01-02 12:00]</p><p>后</p><p>[2025-01-02 11:00]</p><p>前</p>'),
    ['time-order-reversed'],
  );
  const reviewed = reviewMessageCandidate(payload);
  assert.deepEqual(reviewed.candidate.units, payload.candidate.units);
  assert.deepEqual(reviewed.candidate.layout, payload.candidate.layout);
  assert.equal(reviewed.decisions[0].correctedDates, 0);
});

test('disclosure keeps exact folding source plus audited expanded code and paragraphs', () => {
  const payload = frozen(
    source(
      '<p>前文</p><details open><summary><strong>摘要</strong></summary><pre><code>one\n  two</code></pre><p>后文</p></details>',
    ),
    ['unsupported-element'],
  );
  const reviewed = reviewMessageCandidate(payload);
  assert.equal(reviewed.compatibility.originalHTML, payload.original.content);
  assert.equal(reviewed.compatibility.sections[0].open, true);
  assert.ok(reviewed.converted.body.content.some((node) => node.type === 'codeBlock'));
  assert.equal(reviewed.compatibility.expandedAudit.lineStructurePreserved, true);
  assert.equal(reviewed.status, 'resolved-with-compatibility');
});

test('audio gets independent resource identity and edit clock while original body remains intact', () => {
  const id = randomUUID(),
    media = [{ id, type: 'audio/mpeg', name: '合成音频.mp3' }];
  const payload = frozen(
    source('<p>[2025-01-02 10:00]</p><p>合成正文</p>', { attachments: [id] }),
    ['non-image-attachment-body-unsupported'],
    media,
  );
  const reviewed = reviewMessageCandidate(payload, { media });
  const unit = reviewed.candidate.units.find((item) => item.attachments?.includes(id));
  assert.equal(unit.eventTime.instant, at);
  assert.equal(unit.eventTime.source, 'edit-fallback');
  assert.equal(unit.mediaReferences[0].insertedAt, null);
  assert.ok(unit.mediaReferences[0].occurrenceId);
  assert.deepEqual(reviewed.converted.body.content.slice(1), payload.converted.body.content);
  assert.deepEqual(reviewed.original, payload.original);
  assert.deepEqual(reviewed, reviewMessageCandidate(payload, { media }));
});

test('unknown unsupported elements and corrupted source fail instead of clearing review flags', () => {
  assert.throws(
    () =>
      reviewMessageCandidate(
        frozen(source('<p>合成</p><custom>未知</custom>'), ['unsupported-element']),
      ),
    /dedicated rule/,
  );
  const payload = frozen(source('<p>原文</p>'), ['time-order-reversed']);
  payload.original.content = '被改过';
  assert.throws(() => reviewMessageCandidate(payload), /hash mismatch/);
});

test('review batches are immutable, repeatable, media-complete and cannot overwrite the first pass', async () => {
  const workspaceRoot = path.resolve('tmp/message-unification/review-tests', randomUUID());
  const first = path.join(workspaceRoot, 'var/message-unit-candidates/first');
  const next = path.join(workspaceRoot, 'var/message-unit-candidates/review');
  const mediaDir = path.join(workspaceRoot, 'original-media');
  await fs.mkdir(mediaDir, { recursive: true });
  const id = randomUUID(),
    bytes = Buffer.from('synthetic-audio-bytes');
  await fs.writeFile(path.join(mediaDir, id), bytes);
  const media = [
    {
      id,
      type: 'audio/mpeg',
      name: '合成音频',
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
  ];
  const library = {
    media,
    entries: [source('<p>[2025-01-02 12:00]</p><p>正文</p>', { attachments: [id] })],
  };
  await runMessageUnitCandidates({ workspaceRoot, runDir: first, library });
  const firstManifest = await fs.readFile(path.join(first, 'manifest.json'));
  const result = await runMessageUnitReview({
    workspaceRoot,
    sourceBatch: first,
    runDir: next,
    mediaDir,
    expectedCount: 1,
  });
  assert.equal(result.report.total, 1);
  assert.equal(result.report.mediaCopied, 1);
  assert.equal(result.report.sourceBatchUnchanged, true);
  assert.ok(result.report.algorithmSha256);
  assert.deepEqual(await fs.readFile(path.join(first, 'manifest.json')), firstManifest);
  assert.deepEqual(await fs.readFile(path.join(next, 'media', id + '.mp3')), bytes);
  await assert.rejects(
    runMessageUnitReview({ workspaceRoot, sourceBatch: first, runDir: first, expectedCount: 1 }),
    /distinct/,
  );
  await assert.rejects(
    runMessageUnitReview({ workspaceRoot, sourceBatch: first, runDir: next, expectedCount: 1 }),
    { code: 'EEXIST' },
  );
});
