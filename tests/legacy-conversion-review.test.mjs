import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import {
  buildLegacyReviewCandidate,
  renderLegacyReviewView,
  sanitizeLegacyReviewHTML,
  runLegacyConversionReview,
} from '../tools/legacy-conversion-review.mjs';
import { convertLegacyEntry } from '../tools/lib/legacy-content-converter.mjs';
import { buildLegacyTimeSegments } from '../public/shared/legacy-time-segments.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = (v) =>
  createHash('sha256')
    .update(typeof v === 'string' ? v : JSON.stringify(v))
    .digest('hex');
function first(entry, issues, media = [], index = 0) {
  const converted = convertLegacyEntry(entry, { media });
  const temporal = buildLegacyTimeSegments(converted.body, { fallbackAt: null });
  const result = {
    original: structuredClone(entry),
    candidate: { body: converted.body, attachmentPlacements: converted.attachmentPlacements },
    temporal,
    validation: { fixture: true },
    source: { sha256: sha(entry) },
    row: { key: sha(entry.id), sourceIndex: index, issueCodes: issues, status: 'review' },
  };
  result.packageSha256 = sha(result);
  return result;
}
const entry = (id, content, extra = {}) => ({
  id,
  content,
  date: '2026-10-16T01:00:00.000Z',
  updatedAt: '2026-10-17T02:00:00.000Z',
  revision: 2,
  attachments: [],
  ...extra,
});

test('thirteen complete anchors keep author order including a reversed marker without changing text or dates', () => {
  const html = Array.from(
    { length: 13 },
    (_, i) =>
      `<p>[2026-10-${i === 12 ? '15' : '16'} 10:${String(i).padStart(2, '0')}]</p><p>虚构段${i}</p>`,
  ).join('');
  const input = first(entry('reversed', html), ['time-order-reversed']);
  const before = structuredClone(input);
  const result = buildLegacyReviewCandidate(input);
  assert.equal(result.review.status, 'resolved-preserved');
  assert.equal(result.temporal.anchors.length, 13);
  assert.deepEqual(result.temporal.anchors, before.temporal.anchors);
  assert.deepEqual(result.original, before.original);
  assert.deepEqual(result.candidate.body, before.candidate.body);
  assert.ok(
    result.review.decisions.some((d) => d.code === 'time-order-reversed' && d.authorOrderPreserved),
  );
  assert.deepEqual(input, before);
});

test('time-only markers inherit explicit anchor dates across prose, otherwise labelled entry dates; index normalization never edits source', () => {
  const input = first(
    entry(
      'time-context',
      '<p>[2026-10-15 23:30]</p><p>隔开的正文</p><p>[00:10]</p><p>[2026-10-16 12:30</p><p>[2026年10月16日13:20:30]</p>',
    ),
    ['unresolved-time-only', 'unclassified-time'],
  );
  const result = buildLegacyReviewCandidate(input);
  assert.deepEqual(result.candidate.body, input.candidate.body);
  assert.equal(result.temporal.anchors.length, 4);
  assert.equal(result.temporal.anchors[1].time.source, 'manual-anchor-date-context');
  assert.ok(result.temporal.anchors[1].time.local.startsWith('2026-10-15T00:10'));
  assert.equal(result.temporal.anchors[2].time.source, 'manual-marker-normalized-index');
  assert.equal(result.temporal.anchors[3].time.source, 'manual-marker-normalized-index');
  const entryContext = buildLegacyReviewCandidate(
    first(entry('entry-context', '<p>[08:30]</p>'), ['unresolved-time-only']),
  );
  assert.equal(entryContext.temporal.anchors[0].time.source, 'entry-date-context');
  assert.equal(entryContext.temporal.anchors[0].time.assumedDate, true);
  assert.deepEqual(result.review.remainingWarnings, []);
});

test('clock choices require history evidence, retain provenance and never invent image insertion times', () => {
  const updatedAt = '2026-02-26T11:25:45.589Z';
  const original = entry('clock', '<p>正文未改</p>', {
    attachments: ['photo'],
    legacy: { original: { updateTime: Date.parse(updatedAt) } },
    history: [{ revision: 1, content: '<p>正文未改</p>', updatedAt }],
  });
  const input = first(
    original,
    ['ambiguous-edit-clock'],
    [{ id: 'photo', type: 'image/png', name: '虚构.png' }],
  );
  assert.equal(buildLegacyReviewCandidate(input).review.status, 'review');
  const resolved = buildLegacyReviewCandidate(input, {
    clockChoice: 'history-matched-content-clock',
  });
  assert.deepEqual(resolved.review.remainingWarnings, []);
  const decision = resolved.review.decisions.find((d) => d.code === 'edit-clock-selected');
  assert.equal(decision.evidence.historyRevision, 1);
  assert.equal(decision.evidence.historyContentSha256, sha(original.content));
  assert.equal(
    resolved.temporal.segments.find((s) => s.time.source === 'edit-fallback').time.instant,
    updatedAt,
  );
  assert.equal(resolved.candidate.body.content[0].attrs.insertedAt, null);
  assert.equal(resolved.review.decisions[0].sourceField, 'history-matched-content-clock');
  const current = buildLegacyReviewCandidate(input, { clockChoice: 'current-updatedAt' });
  assert.equal(
    current.temporal.segments.find((s) => s.time.source === 'edit-fallback').time.instant,
    original.updatedAt,
  );
});

test('verified video/audio render beside images in original attachment order and details stay safe read-only disclosures', () => {
  const media = [
    { id: 'image', type: 'image/png', name: '图.png' },
    { id: 'video', type: 'video/mp4', name: '<视频>.mp4' },
    { id: 'audio', type: 'audio/mp4', name: '音频.m4a' },
  ];
  const input = first(
    entry('media', '<p>正文</p>', { attachments: ['image', 'video', 'audio'] }),
    [
      'non-image-attachment-body-unsupported',
      'non-image-attachment-preview-gap',
      'converter-reported-issue',
    ],
    media,
  );
  const result = buildLegacyReviewCandidate(input, {
    mediaVerifications: {
      video: { ok: true, contentType: 'video/mp4' },
      audio: { ok: true, contentType: 'audio/mp4' },
    },
  });
  assert.equal(result.review.status, 'compatible-fallback');
  const dom = new JSDOM(result.compatibilityView.html);
  const rendered = [
    ...dom.window.document.querySelectorAll(
      '[data-attachment-region] img,[data-attachment-region] video,[data-attachment-region] audio',
    ),
  ];
  assert.deepEqual(
    rendered.map((n) => n.localName),
    ['img', 'video', 'audio'],
  );
  assert.ok(rendered.every((n) => n.src.startsWith('http://127.0.0.1:18765/media/')));
  assert.ok(rendered.slice(1).every((n) => n.hasAttribute('controls')));
  assert.equal(dom.window.document.querySelectorAll('img').length, 1);
  assert.ok(result.compatibilityView.html.includes('&lt;视频&gt;'));
  dom.window.close();
  const details = first(
    entry('details', '<details><summary>标题</summary><pre>  原样\n  代码</pre></details>'),
    [
      'unsupported-element',
      'source-element-review',
      'line-or-block-structure-mismatch',
      'converter-reported-issue',
    ],
  );
  const disclosure = buildLegacyReviewCandidate(details);
  assert.equal(disclosure.review.status, 'compatible-fallback');
  assert.equal(disclosure.compatibilityView.mode, 'legacy-html-readonly');
  assert.ok(renderLegacyReviewView(disclosure).includes('<details>'));
  assert.deepEqual(disclosure.candidate.body, details.candidate.body);
  const sanitized = sanitizeLegacyReviewHTML(
    '<details onclick="bad()"><summary>保留</summary><pre>正文</pre><script>bad()</script></details>',
  );
  assert.ok(!sanitized.html.includes('onclick'));
  assert.ok(!sanitized.html.includes('<script'));
  assert.ok(sanitized.html.includes('<details>'));
  assert.ok(sanitized.removals.length > 0);
  assert.equal(buildLegacyReviewCandidate(input).review.status, 'review');
});

test('second pass writes a separate immutable directory and proves all first-pass bytes unchanged', async (t) => {
  await fs.mkdir(path.join(ROOT, 'tmp'), { recursive: true });
  const workspaceRoot = await fs.mkdtemp(path.join(ROOT, 'tmp', 'legacy-review-test-'));
  t.after(async () => {
    assert.ok(path.resolve(workspaceRoot).startsWith(path.join(ROOT, 'tmp') + path.sep));
    await fs.rm(workspaceRoot, { recursive: true });
  });
  const firstRunDir = path.join(workspaceRoot, 'var', 'migration-lab', 'first');
  const runDir = path.join(workspaceRoot, 'var', 'migration-lab', 'second');
  await fs.mkdir(path.join(firstRunDir, 'entries'), { recursive: true });
  const original = entry('runner', '<p>[08:30]</p>');
  const input = first(original, ['unresolved-time-only']);
  const library = { entries: [original], media: [] };
  const snapshot = { library, sourceSha256: sha(library) };
  const manifest = { sourceSha256: sha(library), rows: [input.row] };
  await fs.writeFile(path.join(firstRunDir, 'source-snapshot.json'), JSON.stringify(snapshot));
  await fs.writeFile(path.join(firstRunDir, 'manifest.json'), JSON.stringify(manifest));
  const firstFile = path.join(firstRunDir, 'entries', input.row.key + '.json');
  await fs.writeFile(firstFile, JSON.stringify(input));
  const firstBytes = await fs.readFile(firstFile, 'utf8');
  const result = await runLegacyConversionReview({
    workspaceRoot,
    firstRunDir,
    runDir,
    verifySource: false,
  });
  assert.equal(result.report.total, 1);
  assert.equal(result.report.firstPassUnchanged, true);
  assert.equal(await fs.readFile(firstFile, 'utf8'), firstBytes);
  assert.equal(result.report.rows[0].status, 'resolved-preserved');
  await assert.rejects(
    runLegacyConversionReview({ workspaceRoot, firstRunDir, runDir, verifySource: false }),
    /EEXIST/,
  );
  await assert.rejects(
    runLegacyConversionReview({
      workspaceRoot,
      firstRunDir,
      runDir: firstRunDir,
      verifySource: false,
    }),
    /separate/,
  );
  assert.ok(!JSON.stringify(result.report).includes('正文未改'));
});
