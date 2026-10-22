// New private candidates only. No production writer, migration-package import or GUI.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import { convertLegacyReadingEntry } from '../src/server/domain/legacy-reading-converter.mjs';
import {
  candidateHash,
  validateMessageUnitCandidate,
} from './lib/message-unit-candidate-validator.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const inside = (base, target) => {
  const relative = path.relative(base, target);
  return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
};
const writeJSON = (file, value) =>
  fs.writeFile(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
async function safePath(root, target) {
  if (!inside(root, target)) throw Error('Output path must remain inside workspace');
  let current = root;
  for (const part of path.relative(root, target).split(path.sep)) {
    current = path.join(current, part);
    try {
      if ((await fs.lstat(current)).isSymbolicLink()) throw Error('Output symlinks are prohibited');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}
export function validateMessageSourceUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !['', '/'].includes(url.pathname)
  )
    throw Error('Source must be an explicit HTTP loopback origin');
  return url.origin;
}
export async function readMessageSource(value) {
  const origin = validateMessageSourceUrl(value);
  const response = await fetch(new URL('/api/library', origin), {
    method: 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw Error(`Read-only GET failed (${response.status})`);
  const library = await response.json();
  if (!Array.isArray(library?.entries) || !Array.isArray(library?.media))
    throw Error('Invalid source shape');
  return library;
}
const instant = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = new Date(
    typeof value === 'number' && value > 0 && value < 100000000000 ? value * 1000 : value,
  );
  return Number.isFinite(parsed.valueOf()) ? parsed.toISOString() : null;
};
export function resolveCandidateClock(entry) {
  const choices = [
    ['contentEditedAt', entry.contentEditedAt],
    ['legacy.original.updateTime', entry.legacy?.original?.updateTime],
    ['updatedAt', entry.updatedAt],
  ].filter(([, value]) => value !== undefined && value !== null && value !== '');
  const issueCodes = [];
  const values = choices.map(([field, value]) => {
    const ambiguous = typeof value === 'string' && !/(?:Z|[+-]\d\d:\d\d)$/.test(value);
    if (ambiguous) issueCodes.push('ambiguous-content-edit-clock-zone');
    return { field, at: ambiguous ? null : instant(value) };
  });
  if (values.some((value) => !value.at)) issueCodes.push('invalid-content-edit-clock');
  if (new Set(values.filter((value) => value.at).map((value) => value.at)).size > 1)
    issueCodes.push('conflicting-content-edit-clock');
  const selected = values.find((value) => value.at);
  if (!selected) issueCodes.push('missing-content-edit-clock');
  return { at: selected?.at ?? null, sourceField: selected?.field ?? null, issueCodes };
}
const frequencies = (values) => {
  const result = {};
  for (const value of values) result[value] = (result[value] || 0) + 1;
  return result;
};
function monthOf(value, timeZone) {
  const date = instant(value);
  if (!date) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date(date));
  return `${parts.find((p) => p.type === 'year').value}-${parts.find((p) => p.type === 'month').value}`;
}
async function algorithmIdentity() {
  const files = {};
  for (const relative of [
    'tools/message-unit-candidates.mjs',
    'tools/lib/message-unit-candidate-validator.mjs',
    'public/shared/message-units.js',
    'public/shared/legacy-time-segments.js',
    'public/shared/content-preparation.js',
    'public/shared/rich-document.js',
    'public/shared/rich-document-renderer.js',
    'public/shared/time-zone.js',
    'public/shared/editor-document.js',
    'public/editor/rich-document-editor.js',
    'src/server/domain/legacy-reading-converter.mjs',
    'tools/lib/legacy-conversion-validator.mjs',
  ])
    files[relative] = candidateHash(await fs.readFile(path.join(ROOT, relative), 'utf8'));
  return { sha256: candidateHash(files), files };
}

export async function runMessageUnitCandidates({
  library,
  runDir,
  workspaceRoot = ROOT,
  sourceUrl = null,
  timeZone = 'Asia/Shanghai',
  focusMonth = '2026-10',
  onProgress = () => {},
  model,
}) {
  if (!Array.isArray(library?.entries) || !Array.isArray(library?.media))
    throw Error('Invalid source shape');
  const workspace = path.resolve(workspaceRoot),
    target = path.resolve(runDir || '');
  if (!runDir || !inside(path.join(workspace, 'var', 'message-unit-candidates'), target))
    throw Error('An explicit new private message-unit-candidates batch is required');
  await safePath(workspace, target);
  const reportDir = path.join(
    workspace,
    'outputs',
    'message-unification',
    'legacy',
    path.basename(target),
  );
  await safePath(workspace, reportDir);
  // Non-recursive final mkdir rejects every existing batch, including incomplete batches.
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.mkdir(target);
  await fs.mkdir(path.dirname(reportDir), { recursive: true });
  await fs.mkdir(reportDir);
  const api = model || (await import('../public/shared/message-units.js'));
  const algorithm = await algorithmIdentity();
  const sourceSha256 = candidateHash(library);
  await writeJSON(path.join(target, 'source-snapshot.json'), {
    sourceReadOnly: true,
    sourceSha256,
    library,
  });
  await writeJSON(path.join(target, 'algorithm.json'), algorithm);
  await fs.mkdir(path.join(target, 'entries'));
  const rows = [],
    globalIds = new Set();
  for (const [sourceIndex, original] of library.entries.entries()) {
    const key = candidateHash([original.id ?? null, sourceIndex]);
    const sourceHash = candidateHash(original);
    const row = {
      key,
      sourceIndex,
      sourceMonth: monthOf(original.date, timeZone),
      sourceCharacters: typeof original.content === 'string' ? original.content.length : 0,
      sourceAttachments: Array.isArray(original.attachments) ? original.attachments.length : 0,
      status: 'failed',
      checks: {},
      issueCodes: [],
    };
    const payload = {
      format: 'shiye-message-unit-candidate',
      version: 1,
      candidateOnly: true,
      noProductionWrites: true,
      source: { sha256: sourceHash, id: original.id ?? null, index: sourceIndex },
      original: structuredClone(original),
      algorithmSha256: algorithm.sha256,
    };
    if (original.chatJournal) {
      row.status = 'canonical-chat-preserved';
      payload.canonical = structuredClone(original);
    } else {
      try {
        const clock = resolveCandidateClock(original);
        const converted =
          original.contentFormat === 'richdoc'
            ? { body: structuredClone(original.body), attachmentPlacements: [], issues: [] }
            : convertLegacyReadingEntry(structuredClone(original), {
                media: library.media,
                timeZone,
              });
        const preparedEntry = {
          ...structuredClone(original),
          contentFormat: 'richdoc',
          body: converted.body,
          contentEditedAt: clock.at,
          editTimeSource: clock.sourceField,
          attachmentPlacements: converted.attachmentPlacements,
        };
        let next = 0;
        const createId = () =>
          `unit:legacy:${candidateHash([original.id ?? key, next++]).slice(0, 40)}`;
        const candidate = await api.prepareDiaryUnits(preparedEntry, {
          media: library.media,
          timeZone,
          createId,
        });
        const repeated = await api.prepareDiaryUnits(preparedEntry, {
          previousUnits: candidate.units,
          media: library.media,
          timeZone,
          createId,
        });
        const reassembled = api.reassembleDiaryUnits(candidate.units, candidate.layout);
        const validation = validateMessageUnitCandidate({
          original,
          converted,
          preparedEntry,
          candidate,
          repeated,
          reassembled,
          media: library.media,
          validateMessageUnit: api.validateMessageUnit,
          originalSha256: sourceHash,
        });
        Object.assign(row, validation);
        row.issueCodes = [
          ...new Set([
            ...row.issueCodes,
            ...clock.issueCodes,
            ...converted.issues.map((i) => i.code),
          ]),
        ];
        if (row.status === 'normal' && row.issueCodes.length) row.status = 'review';
        for (const unit of candidate.units) {
          if (globalIds.has(unit.id)) {
            row.status = 'failed';
            row.issueCodes.push('global-unit-id-collision');
          }
          globalIds.add(unit.id);
        }
        Object.assign(payload, { clock, converted, candidate, validation });
      } catch {
        row.issueCodes.push('candidate-or-validation-exception');
      }
    }
    if (candidateHash(original) !== sourceHash) throw Error('Detached conversion mutated source');
    payload.row = row;
    payload.packageSha256 = candidateHash(payload);
    await writeJSON(path.join(target, 'entries', `${key}.json`), payload);
    rows.push(row);
    if ((sourceIndex + 1) % 100 === 0)
      onProgress({ processed: sourceIndex + 1, total: library.entries.length });
  }
  if (candidateHash(library) !== sourceSha256) throw Error('Source snapshot changed');
  if ((await algorithmIdentity()).sha256 !== algorithm.sha256)
    throw Error('Algorithm source changed during this batch; retained batch requires a new run');
  const focus = rows.filter((row) => row.sourceMonth === focusMonth);
  const report = {
    format: 'shiye-message-unit-candidate-statistics',
    version: 1,
    sourceSha256,
    algorithmSha256: algorithm.sha256,
    sourceReadOnly: true,
    candidateOnly: true,
    noProductionWrites: true,
    sourceMethods: sourceUrl ? ['GET'] : [],
    mediaBytesCopied: false,
    total: rows.length,
    statuses: frequencies(rows.map((r) => r.status)),
    checks: Object.fromEntries(
      [...new Set(rows.flatMap((r) => Object.keys(r.checks)))].map((name) => [
        name,
        rows.filter((r) => r.checks[name]).length,
      ]),
    ),
    issueCodes: frequencies(rows.flatMap((r) => r.issueCodes)),
    unitCount: rows.reduce((sum, r) => sum + (r.unitCount || 0), 0),
    focus: {
      month: focusMonth,
      total: focus.length,
      statuses: frequencies(focus.map((r) => r.status)),
      sourceCharacters: focus.reduce((sum, r) => sum + r.sourceCharacters, 0),
      withAttachments: focus.filter((r) => r.sourceAttachments).length,
    },
  };
  await writeJSON(path.join(target, 'manifest.json'), { ...report, rows });
  await writeJSON(path.join(reportDir, 'report.json'), report);
  return { report, runDir: target, reportDir };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = {};
    for (let i = 2; i < process.argv.length; i += 2) {
      if (
        !['--source-url', '--run-dir', '--focus-month', '--time-zone'].includes(process.argv[i]) ||
        !process.argv[i + 1]
      )
        throw Error('Invalid CLI arguments');
      options[process.argv[i]] = process.argv[i + 1];
    }
    const sourceUrl = validateMessageSourceUrl(options['--source-url']);
    const library = await readMessageSource(sourceUrl);
    const result = await runMessageUnitCandidates({
      library,
      runDir: options['--run-dir'],
      sourceUrl,
      focusMonth: options['--focus-month'],
      timeZone: options['--time-zone'],
    });
    console.log(JSON.stringify(result.report));
  } catch {
    console.error(
      'Message-unit candidate run failed; inspect the private batch without printing source content.',
    );
    process.exitCode = 1;
  }
}
