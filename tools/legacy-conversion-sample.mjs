// Explicit, read-only source capture. Candidate packages stay in private var/.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { JSDOM } from 'jsdom';
import { getEditorDocument } from '../public/shared/editor-document.js';
import { prepareContent, readManualTime } from '../public/shared/content-preparation.js';
import { buildLegacyTimeSegments } from '../public/shared/legacy-time-segments.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce(
      (items, value, index, list) =>
        value.startsWith('--') ? [...items, [value.slice(2), list[index + 1]]] : items,
      [],
    ),
);
const sha = (value) =>
  createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(value))
    .digest('hex');
const base = path.join(root, 'var', 'migration-lab');
const runDir = args['run-dir']
  ? path.resolve(args['run-dir'])
  : path.join(base, 'expanded-' + new Date().toISOString().replace(/[:.]/g, '-'));
if (!runDir.startsWith(base + path.sep))
  throw Error('Run directory must be within this workspace var/migration-lab');
const output = path.join(root, 'outputs', 'legacy-conversion-expanded', path.basename(runDir));
await fs.mkdir(output, { recursive: true });
const rank = (seed, list) =>
  [...list].sort((a, b) => sha(seed + a.id).localeCompare(sha(seed + b.id)));
const sourceUrl = args.url || 'http://127.0.0.1:18765';
const url = new URL(sourceUrl);
if (
  url.origin !== sourceUrl ||
  !['127.0.0.1', '[::1]'].includes(url.hostname) ||
  url.protocol !== 'http:'
)
  throw Error('Explicit loopback source only');
async function readSource() {
  const response = await fetch(new URL('/api/library', sourceUrl), {
    method: 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw Error('Read-only source unavailable or locked: ' + response.status);
  const raw = await response.text();
  const db = JSON.parse(raw);
  if (!Array.isArray(db.entries) || !Array.isArray(db.media))
    throw Error('Invalid source library shape');
  return { raw, db };
}
let snapshot;
if (args.capture === 'yes') {
  await fs.mkdir(base, { recursive: true });
  await fs.mkdir(runDir, { recursive: false });
  const { raw, db } = await readSource();
  const pool = db.entries.filter(
    (e) => !e.chatJournal && !e.hidden && !e.deleted && !e.draft && !e.demo,
  );
  const seed = randomBytes(16).toString('hex');
  const byId = new Map(pool.map((e) => [e.id, e]));
  const selection = new Map();
  const old = JSON.parse(
    await fs.readFile(path.join(root, 'outputs/diary-sample-processing/report.json'), 'utf8'),
  );
  const fixedKeys = new Set(old.cases.map((c) => c.sourceKey));
  for (const e of pool)
    if (fixedKeys.has(sha(old.seed + e.id)))
      selection.set(e.id, { id: e.id, cohort: 'development', reason: 'previous-35' });
  const groups = new Map();
  for (const e of pool) {
    const keys = [
      'year:' + String(e.date || '').slice(0, 4),
      'format:' + getEditorDocument(e).format,
      'length:' +
        ((e.content || '').length > 5000
          ? 'long'
          : (e.content || '').length > 500
            ? 'medium'
            : 'short'),
    ];
    if (e.attachments?.length) keys.push('attachments');
    if (/<(?:table|pre|blockquote|ul|ol|img)\b/i.test(e.content || '')) keys.push('complex-html');
    if (/\d{1,2}:\d{2}/.test(e.content || '')) keys.push('time-text');
    for (const key of keys) {
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    }
  }
  for (const [key, list] of groups)
    for (const e of rank(seed + key, list).slice(0, 5))
      if (!selection.has(e.id) && selection.size < 160)
        selection.set(e.id, { id: e.id, cohort: 'development', reason: key });
  for (const e of rank(seed, pool))
    if (!selection.has(e.id) && selection.size < 200)
      selection.set(e.id, { id: e.id, cohort: 'development', reason: 'random' });
  for (const e of rank(seed + '-blind', pool))
    if (!selection.has(e.id) && selection.size < 700)
      selection.set(e.id, { id: e.id, cohort: 'holdout', reason: 'unseen-random' });
  snapshot = {
    format: 'shiye-legacy-source-snapshot',
    version: 1,
    capturedAt: new Date().toISOString(),
    sourceUrl,
    sourceSha256: sha(raw),
    seed,
    selection: [...selection.values()],
    entries: [...selection.keys()].map((id) => byId.get(id)),
    media: db.media,
    eligibleEntries: pool.length,
    sourceMethods: ['GET'],
  };
  await fs.writeFile(path.join(runDir, 'source-snapshot.json'), JSON.stringify(snapshot));
} else snapshot = JSON.parse(await fs.readFile(path.join(runDir, 'source-snapshot.json'), 'utf8'));

const phase = args.phase || 'development';
if (!['development', 'holdout', 'all'].includes(phase)) throw Error('Unknown phase');
const { convertLegacyEntry } = await import('./lib/legacy-content-converter.mjs');
const { validateLegacyConversion } = await import('./lib/legacy-conversion-validator.mjs');
const sourceHash = sha(snapshot);
const indexed = new Map(snapshot.entries.map((e) => [e.id, e]));
const selected = snapshot.selection.filter((s) => phase === 'all' || s.cohort === phase);
const mediaById = new Map(snapshot.media.map((m) => [m.id, m]));
await fs.mkdir(path.join(runDir, 'entries'), { recursive: true });
const dom = new JSDOM('');
function sourceTimes(html) {
  const el = dom.window.document.createElement('div');
  el.innerHTML = String(html || '');
  el.querySelectorAll('script,style,template,pre,code,blockquote').forEach((n) =>
    n.replaceWith('\n'),
  );
  el.querySelectorAll('br').forEach((n) => n.replaceWith('\n'));
  el.querySelectorAll('p,div,li,h1,h2,h3,h4,h5,h6,tr').forEach((n) => {
    n.prepend('\n');
    n.append('\n');
  });
  return el.textContent
    .split(/\r?\n/)
    .map((s) => readManualTime(s))
    .filter((t) => t.time)
    .map((t) => t.time.instant + '|' + t.time.precision)
    .sort();
}
const rows = [];
for (const [i, s] of selected.entries()) {
  const entry = indexed.get(s.id),
    before = sha(entry),
    began = performance.now();
  const row = {
    key: sha(entry.id),
    cohort: s.cohort,
    reason: s.reason,
    format: getEditorDocument(entry).format,
    sourceYear: String(entry.date || '').slice(0, 4),
    sourceCharacters: (entry.content || '').length,
    sourceAttachments: entry.attachments?.length || 0,
  };
  try {
    const converted = await convertLegacyEntry(entry, {
      media: snapshot.media,
      timeZone: 'Asia/Shanghai',
    });
    const validation = validateLegacyConversion(entry, converted, { media: snapshot.media });
    let fallback = entry.contentEditedAt === undefined ? entry.updatedAt : entry.contentEditedAt;
    const old = entry.legacy?.original?.updateTime;
    if (old) {
      const oldDate = new Date(
        typeof old === 'number' && old > 0 && old < 100000000000 ? old * 1000 : old,
      );
      if (
        Number.isFinite(oldDate.valueOf()) &&
        oldDate.toISOString() !== entry.updatedAt &&
        entry.contentEditedAt === undefined
      ) {
        fallback = null;
        row.clockReview = true;
      }
    }
    const temporal = buildLegacyTimeSegments(converted.body, {
      timeZone: 'Asia/Shanghai',
      fallbackAt: fallback || null,
      fallbackSource: entry.contentEditedAt === undefined ? 'entry-updatedAt' : 'content-editedAt',
    });
    const prepared = await prepareContent({
      body: converted.body,
      recordId: entry.id,
      revision: entry.revision || 1,
      contentEditedAt: fallback || null,
      updatedAt: entry.updatedAt,
      availableAssetIds: [...mediaById.keys()],
    });
    const second = await convertLegacyEntry(entry, {
      media: snapshot.media,
      timeZone: 'Asia/Shanghai',
    });
    const independentSource = sourceTimes(entry.content);
    const known = temporal.anchors
      .filter((a) => a.time.source === 'manual-marker')
      .map((a) => a.time.instant + '|' + a.time.precision)
      .sort();
    row.timeCoverageEqual = JSON.stringify(independentSource) === JSON.stringify(known);
    row.sourceFullAnchors = independentSource.length;
    row.targetFullAnchors = known.length;
    row.structureValid = validation.structureValid;
    row.textPreserved = validation.textPreserved;
    row.whitespacePreserved = validation.whitespacePreserved;
    row.lineStructurePreserved = validation.lineStructurePreserved;
    row.attachmentsPreserved = validation.attachmentsPreserved;
    row.repeatStable = sha(converted) === sha(second);
    row.bodyUnchanged = sha(converted.body) === sha(prepared.body);
    row.originalPreserved = sha(entry) === before;
    row.validationIssues = validation.issues.map((x) => ({ code: x.code, severity: x.severity }));
    row.timeIssues = temporal.issues.map((x) => x.code);
    row.converterIssues = converted.issues.map((x) => (typeof x === 'string' ? x : x.code));
    row.safeForPreview =
      validation.safeForPreview &&
      row.timeCoverageEqual &&
      row.repeatStable &&
      row.bodyUnchanged &&
      row.originalPreserved;
    row.requiresReview = !row.safeForPreview || !!row.clockReview || temporal.issues.length > 0;
    const payload = {
      format: 'shiye-legacy-conversion-preview',
      version: 1,
      source: { id: entry.id, revision: entry.revision || 1, sha256: before },
      original: entry,
      candidate: {
        body: converted.body,
        attachmentPlacements: converted.attachmentPlacements,
        provenance: converted.provenance,
      },
      prepared,
      temporal,
      validation,
      media: snapshot.media.filter(
        (m) => (entry.attachments || []).includes(m.id) || prepared.derived.assetIds.includes(m.id),
      ),
    };
    await fs.writeFile(path.join(runDir, 'entries', row.key + '.json'), JSON.stringify(payload));
  } catch {
    row.error = 'conversion-or-validation-exception';
    row.originalPreserved = sha(entry) === before;
  }
  row.milliseconds = Math.round((performance.now() - began) * 10) / 10;
  rows.push(row);
  if ((i + 1) % 50 === 0)
    console.log(JSON.stringify({ phase, processed: i + 1, total: selected.length }));
}
dom.window.close();
const count = (key) => rows.filter((r) => r[key]).length;
const frequencies = (list) =>
  Object.fromEntries([...new Set(list)].sort().map((k) => [k, list.filter((x) => x === k).length]));
const report = {
  at: new Date().toISOString(),
  phase,
  sourceSha256: snapshot.sourceSha256,
  sourceSnapshotPreserved: sourceHash === sha(snapshot),
  sourceMethods: ['GET'],
  candidateOnly: true,
  autoDeploy: false,
  total: rows.length,
  counts: Object.fromEntries(
    [
      'structureValid',
      'textPreserved',
      'whitespacePreserved',
      'lineStructurePreserved',
      'attachmentsPreserved',
      'repeatStable',
      'bodyUnchanged',
      'originalPreserved',
      'timeCoverageEqual',
      'safeForPreview',
      'clockReview',
      'requiresReview',
      'error',
    ].map((k) => [k, count(k)]),
  ),
  sourceFullAnchors: rows.reduce((n, r) => n + (r.sourceFullAnchors || 0), 0),
  targetFullAnchors: rows.reduce((n, r) => n + (r.targetFullAnchors || 0), 0),
  validationIssues: frequencies(rows.flatMap((r) => (r.validationIssues || []).map((x) => x.code))),
  timeIssues: frequencies(rows.flatMap((r) => r.timeIssues || [])),
  converterIssues: frequencies(rows.flatMap((r) => r.converterIssues || [])),
  formats: frequencies(rows.map((r) => r.format)),
  years: frequencies(rows.map((r) => r.sourceYear)),
  rows,
};
report.algorithmSources = {};
for (const relative of [
  'tools/lib/legacy-content-converter.mjs',
  'tools/lib/legacy-conversion-validator.mjs',
  'public/shared/legacy-time-segments.js',
  'public/shared/content-preparation.js',
])
  report.algorithmSources[relative] = sha(await fs.readFile(path.join(root, relative), 'utf8'));
await fs.writeFile(path.join(output, phase + '.json'), JSON.stringify(report, null, 2) + '\n');
await fs.writeFile(path.join(runDir, phase + '-report.json'), JSON.stringify(report));
console.log(
  JSON.stringify(
    {
      runDir,
      reportDir: output,
      total: report.total,
      counts: report.counts,
      sourceFullAnchors: report.sourceFullAnchors,
      targetFullAnchors: report.targetFullAnchors,
      validationIssues: report.validationIssues,
      timeIssues: report.timeIssues,
    },
    null,
    2,
  ),
);
