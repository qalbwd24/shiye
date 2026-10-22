// A separate, private candidate library. This program has no production write API.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { JSDOM } from 'jsdom';
import { convertLegacyEntry } from './lib/legacy-content-converter.mjs';
import { validateLegacyConversion } from './lib/legacy-conversion-validator.mjs';
import { prepareContent, readManualTime } from '../public/shared/content-preparation.js';
import { buildLegacyTimeSegments } from '../public/shared/legacy-time-segments.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = (value) =>
  createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(value))
    .digest('hex');
const inside = (parent, child) => {
  const relative = path.relative(parent, child);
  return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
};
const exists = async (file) =>
  fs.access(file).then(
    () => true,
    () => false,
  );
const writeJSON = (file, value, flag = 'wx') =>
  fs.writeFile(file, JSON.stringify(value, null, 2) + '\n', { flag });
const frequencies = (values) => {
  const result = {};
  for (const value of values) result[value] = (result[value] || 0) + 1;
  return result;
};
async function noSymlinks(root, target) {
  if (!inside(root, target))
    throw Error('Candidate path is outside the private workspace boundary');
  let current = root;
  for (const segment of path.relative(root, target).split(path.sep)) {
    current = path.join(current, segment);
    try {
      if ((await fs.lstat(current)).isSymbolicLink())
        throw Error('Symbolic links are not allowed in candidate paths');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}
export function validateSourceUrl(value) {
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
    throw Error('Source URL must be an explicit HTTP loopback origin');
  return url.origin;
}
export async function readLegacySource(url) {
  const origin = validateSourceUrl(url);
  const response = await fetch(new URL('/api/library', origin), {
    method: 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw Error(`Read-only source GET failed: ${response.status}`);
  const library = await response.json();
  if (!Array.isArray(library.entries) || !Array.isArray(library.media))
    throw Error('Invalid library shape');
  return library;
}
const algorithmFiles = [
  'tools/legacy-conversion-all.mjs',
  'tools/lib/legacy-content-converter.mjs',
  'tools/lib/legacy-conversion-validator.mjs',
  'public/shared/legacy-time-segments.js',
  'public/shared/content-preparation.js',
  'public/shared/rich-document.js',
  'public/editor/rich-document-editor.js',
  'public/shared/time-zone.js',
];
async function algorithmIdentity(convertEntry) {
  const files = {};
  for (const relative of algorithmFiles)
    files[relative] = sha(await fs.readFile(path.join(ROOT, relative), 'utf8'));
  if (convertEntry !== convertLegacyEntry) files.customConverter = sha(String(convertEntry));
  return { hash: sha(files), files };
}
function monthOf(value, timeZone) {
  const date = new Date(value);
  if (value === undefined || value === null || !Number.isFinite(date.valueOf())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);
  return `${parts.find((p) => p.type === 'year').value}-${parts.find((p) => p.type === 'month').value}`;
}
function contentClock(entry) {
  if (entry.contentEditedAt !== undefined)
    return { at: entry.contentEditedAt, source: 'content-editedAt', review: false };
  const old = entry.legacy?.original?.updateTime;
  if (old) {
    const date = new Date(
      typeof old === 'number' && old > 0 && old < 100000000000 ? old * 1000 : old,
    );
    if (Number.isFinite(date.valueOf()) && date.toISOString() !== entry.updatedAt)
      return { at: null, source: 'ambiguous-edit-clock', review: true };
  }
  return { at: entry.updatedAt || null, source: 'entry-updatedAt', review: false };
}
function sourceAnchors(document, html, timeZone) {
  const element = document.createElement('div');
  element.innerHTML = typeof html === 'string' ? html : '';
  element
    .querySelectorAll('script,style,template,pre,code,blockquote')
    .forEach((n) => n.replaceWith('\n'));
  element.querySelectorAll('br').forEach((n) => n.replaceWith('\n'));
  element.querySelectorAll('p,div,li,h1,h2,h3,h4,h5,h6,tr').forEach((n) => {
    n.prepend('\n');
    n.append('\n');
  });
  return element.textContent
    .split(/\r?\n/)
    .map((line) => readManualTime(line, timeZone))
    .filter((parsed) => parsed.time)
    .map((parsed) => parsed.time.instant + '|' + parsed.time.precision)
    .sort();
}

/** Convert every entry from one immutable source snapshot, preserving even failed originals. */
export async function runLegacyConversionAll({
  library,
  runDir,
  workspaceRoot = ROOT,
  sourceDataDirs = [],
  sourceUrl = null,
  timeZone = 'Asia/Shanghai',
  focusMonth = '2026-10',
  convertEntry = convertLegacyEntry,
  onProgress = () => {},
}) {
  if (!Array.isArray(library?.entries) || !Array.isArray(library?.media))
    throw Error('Invalid library shape');
  if (!runDir) throw Error('An explicit private run directory is required');
  const workspace = path.resolve(workspaceRoot);
  const target = path.resolve(runDir);
  const base = path.join(workspace, 'var', 'migration-lab');
  if (!inside(base, target))
    throw Error('Run directory must be inside workspace var/migration-lab');
  for (const source of [
    path.join(workspace, 'data'),
    path.join(workspace, 'var', 'dev-data'),
    ...sourceDataDirs,
  ]) {
    const absolute = path.resolve(source);
    if (target === absolute || inside(absolute, target) || inside(target, absolute))
      throw Error('Candidate and source data directories must be separate');
  }
  await noSymlinks(workspace, target);
  const reportDir = path.join(workspace, 'outputs', 'legacy-conversion-all', path.basename(target));
  await noSymlinks(workspace, reportDir);
  await fs.mkdir(target, { recursive: true });
  await fs.mkdir(reportDir, { recursive: true });
  const lockFile = path.join(target, 'conversion.lock');
  await noSymlinks(workspace, lockFile);
  if (await exists(lockFile)) {
    const stale = JSON.parse(await fs.readFile(lockFile, 'utf8'));
    if (!Number.isInteger(stale.pid) || stale.pid < 1)
      throw Error('Unknown conversion lock must be reviewed');
    let alive = true;
    try {
      process.kill(stale.pid, 0);
    } catch (error) {
      if (error.code === 'ESRCH') alive = false;
    }
    if (alive) throw Error('A conversion process is still running');
    const archived = path.join(target, `abandoned-lock-${sha(stale)}.json`);
    if (await exists(archived)) throw Error('Previous abandoned lock already exists');
    await fs.rename(lockFile, archived);
  }
  const lockToken = randomUUID();
  await writeJSON(lockFile, { token: lockToken, pid: process.pid });
  const dom = new JSDOM('');
  try {
    const originalLibraryHash = sha(library);
    const algorithm = await algorithmIdentity(convertEntry);
    const identity = {
      sourceSha256: originalLibraryHash,
      algorithmSha256: algorithm.hash,
      timeZone,
      focusMonth,
    };
    const snapshotFile = path.join(target, 'source-snapshot.json');
    const identityFile = path.join(target, 'run-identity.json');
    for (const file of [
      snapshotFile,
      identityFile,
      path.join(target, 'manifest.json'),
      path.join(reportDir, 'report.json'),
    ])
      await noSymlinks(workspace, file);
    if (await exists(snapshotFile)) {
      const snapshot = JSON.parse(await fs.readFile(snapshotFile, 'utf8'));
      if (
        snapshot.sourceSha256 !== originalLibraryHash ||
        sha(snapshot.library) !== originalLibraryHash
      )
        throw Error('Existing source snapshot differs; use a new run directory');
    } else
      await writeJSON(snapshotFile, {
        format: 'shiye-legacy-complete-source-snapshot',
        version: 1,
        sourceReadOnly: true,
        sourceMethods: sourceUrl ? ['GET'] : [],
        sourceUrl,
        sourceSha256: originalLibraryHash,
        library,
      });
    if (await exists(identityFile)) {
      const prior = JSON.parse(await fs.readFile(identityFile, 'utf8'));
      if (sha(prior.identity) !== sha(identity))
        throw Error('Source, algorithm or conversion options changed; use a new run directory');
    } else await writeJSON(identityFile, { identity, algorithmSources: algorithm.files });
    const packagesDir = path.join(target, 'entries');
    await noSymlinks(workspace, packagesDir);
    await fs.mkdir(packagesDir, { recursive: true });
    const rows = [];
    let resumed = 0;
    for (const [sourceIndex, entry] of library.entries.entries()) {
      const sourceHash = sha(entry);
      const key = sha([entry?.id ?? null, sourceIndex]);
      const file = path.join(packagesDir, `${key}.json`);
      await noSymlinks(workspace, file);
      let payload;
      if (await exists(file)) {
        payload = JSON.parse(await fs.readFile(file, 'utf8'));
        const { packageSha256, ...unsigned } = payload;
        if (
          packageSha256 !== sha(unsigned) ||
          payload.source?.sha256 !== sourceHash ||
          payload.algorithmSha256 !== algorithm.hash ||
          sha(payload.original) !== sourceHash
        )
          throw Error('Existing candidate package failed identity/integrity checks');
        resumed++;
      } else {
        const canonical = !!entry?.chatJournal;
        const row = {
          key,
          sourceIndex,
          mode: canonical ? 'chat-canonical-preserved' : 'legacy-converted',
          sourceMonth: monthOf(entry?.date, timeZone),
          sourceCharacters: typeof entry?.content === 'string' ? entry.content.length : 0,
          sourceAttachments: Array.isArray(entry?.attachments) ? entry.attachments.length : 0,
          states: {
            hidden: !!entry?.hidden,
            deleted: !!entry?.deleted,
            draft: !!entry?.draft,
            demo: !!entry?.demo,
          },
          issueCodes: [],
          status: 'normal',
        };
        row.longForm = !canonical && row.sourceCharacters > 5000;
        payload = {
          format: 'shiye-legacy-complete-candidate',
          version: 1,
          source: {
            id: entry?.id ?? null,
            index: sourceIndex,
            revision: entry?.revision ?? null,
            sha256: sourceHash,
          },
          algorithmSha256: algorithm.hash,
          original: entry,
          sourceReadOnly: true,
          candidateOnly: true,
          noProductionWrites: true,
          mediaStorage: 'source-read-only-references',
          row,
        };
        if (canonical) {
          payload.canonical = structuredClone(entry);
          row.canonicalMetadataPreserved = sha(payload.canonical) === sourceHash;
          row.originalPreserved = true;
        } else {
          try {
            // Work only on a detached entry, so even a failing adapter cannot damage the captured original.
            const converted = await convertEntry(structuredClone(entry), {
              media: structuredClone(library.media),
              timeZone,
            });
            const validation = validateLegacyConversion(entry, converted, { media: library.media });
            const clock = contentClock(entry);
            const temporal = buildLegacyTimeSegments(converted.body, {
              timeZone,
              fallbackAt: clock.at,
              fallbackSource: clock.source,
            });
            const prepared = await prepareContent({
              body: converted.body,
              recordId: entry.id,
              revision: entry.revision || 1,
              contentEditedAt: clock.at,
              updatedAt: entry.updatedAt,
              availableAssetIds: library.media.map((asset) => asset.id),
            });
            const repeated = await convertEntry(structuredClone(entry), {
              media: structuredClone(library.media),
              timeZone,
            });
            const expected = sourceAnchors(dom.window.document, entry.content, timeZone);
            const actual = temporal.anchors
              .filter((anchor) => anchor.time.source === 'manual-marker')
              .map((anchor) => anchor.time.instant + '|' + anchor.time.precision)
              .sort();
            Object.assign(row, {
              structureValid: validation.structureValid,
              textPreserved: validation.textPreserved,
              whitespacePreserved: validation.whitespacePreserved,
              lineStructurePreserved: validation.lineStructurePreserved,
              attachmentsPreserved: validation.attachmentsPreserved,
              sourceFullAnchors: expected.length,
              targetFullAnchors: actual.length,
              timeCoverageEqual: sha(expected) === sha(actual),
              repeatStable: sha(converted) === sha(repeated),
              bodyUnchanged: sha(converted.body) === sha(prepared.body),
              originalPreserved: sha(entry) === sourceHash,
              clockReview: clock.review,
            });
            row.issueCodes = [
              ...new Set([
                ...converted.issues.map((issue) =>
                  typeof issue === 'string' ? issue : issue.code,
                ),
                ...validation.issues.map((issue) => issue.code),
                ...temporal.issues.map((issue) => issue.code),
                ...(clock.review ? ['ambiguous-edit-clock'] : []),
                ...(!row.timeCoverageEqual ? ['manual-time-coverage-mismatch'] : []),
                ...(!row.repeatStable ? ['conversion-not-repeatable'] : []),
                ...(!row.bodyUnchanged ? ['prepared-body-changed'] : []),
              ]),
            ];
            row.safeForPreview =
              validation.safeForPreview &&
              row.timeCoverageEqual &&
              row.repeatStable &&
              row.bodyUnchanged &&
              row.originalPreserved;
            row.status = !row.structureValid
              ? 'failed'
              : row.safeForPreview && !row.issueCodes.length
                ? 'normal'
                : 'review';
            payload.candidate = {
              body: converted.body,
              attachmentPlacements: converted.attachmentPlacements,
              provenance: converted.provenance,
            };
            payload.prepared = prepared;
            payload.temporal = temporal;
            payload.validation = validation;
            const refs = new Set([...prepared.derived.assetIds, ...(entry.attachments || [])]);
            payload.media = library.media.filter((asset) => refs.has(asset.id));
          } catch {
            row.status = 'failed';
            row.issueCodes.push('conversion-or-validation-exception');
            row.originalPreserved = sha(entry) === sourceHash;
          }
        }
        payload.packageSha256 = sha(payload);
        await writeJSON(file, payload);
      }
      rows.push(payload.row);
      if ((sourceIndex + 1) % 100 === 0)
        onProgress({ processed: sourceIndex + 1, total: library.entries.length });
    }
    if (sha(library) !== originalLibraryHash)
      throw Error('In-memory source changed during conversion');
    const legacy = rows.filter((row) => row.mode === 'legacy-converted');
    const focusRows = rows.filter((row) => row.sourceMonth === focusMonth);
    const report = {
      format: 'shiye-legacy-complete-report',
      version: 1,
      ...identity,
      sourceReadOnly: true,
      candidateOnly: true,
      noProductionWrites: true,
      sourceMethods: sourceUrl ? ['GET'] : [],
      autoDeploy: false,
      originalLibraryPreserved: true,
      total: rows.length,
      legacyEntries: legacy.length,
      canonicalChatEntries: rows.length - legacy.length,
      statuses: frequencies(rows.map((row) => row.status)),
      legacyStatuses: frequencies(legacy.map((row) => row.status)),
      states: Object.fromEntries(
        ['hidden', 'deleted', 'draft', 'demo'].map((state) => [
          state,
          rows.filter((row) => row.states[state]).length,
        ]),
      ),
      counts: Object.fromEntries(
        [
          'structureValid',
          'textPreserved',
          'whitespacePreserved',
          'lineStructurePreserved',
          'attachmentsPreserved',
          'timeCoverageEqual',
          'repeatStable',
          'bodyUnchanged',
          'originalPreserved',
          'clockReview',
        ].map((name) => [name, legacy.filter((row) => row[name]).length]),
      ),
      sourceFullAnchors: legacy.reduce((sum, row) => sum + (row.sourceFullAnchors || 0), 0),
      targetFullAnchors: legacy.reduce((sum, row) => sum + (row.targetFullAnchors || 0), 0),
      issueCodes: frequencies(rows.flatMap((row) => row.issueCodes)),
      focus: {
        month: focusMonth,
        timeZone,
        total: focusRows.length,
        legacyEntries: focusRows.filter((row) => row.mode === 'legacy-converted').length,
        longForm: focusRows.filter((row) => row.longForm).length,
        withAttachments: focusRows.filter((row) => row.sourceAttachments > 0).length,
        statuses: frequencies(focusRows.map((row) => row.status)),
        rows: focusRows,
      },
      media: {
        metadataCount: library.media.length,
        storage: 'source-read-only-references',
        bytesCopied: false,
        portableBackupVerified: false,
      },
      rows,
    };
    const manifest = {
      ...report,
      algorithmSources: algorithm.files,
      snapshot: 'source-snapshot.json',
      packages: rows.map((row) => ({
        key: row.key,
        status: row.status,
        file: `entries/${row.key}.json`,
      })),
    };
    await writeJSON(path.join(target, 'manifest.json'), manifest, 'w');
    await writeJSON(path.join(reportDir, 'report.json'), report, 'w');
    return { report, runDir: target, reportDir, resumed };
  } finally {
    dom.window.close();
    const lock = JSON.parse(await fs.readFile(lockFile, 'utf8'));
    if (lock.token === lockToken) await fs.unlink(lockFile);
  }
}

async function main() {
  const options = {};
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 2) {
    if (!['--run-dir', '--url'].includes(args[i]) || !args[i + 1])
      throw Error('Use --run-dir and optional --url');
    options[args[i].slice(2)] = args[i + 1];
  }
  if (!options['run-dir']) throw Error('--run-dir is required');
  const sourceUrl = validateSourceUrl(options.url || 'http://127.0.0.1:18765');
  const library = await readLegacySource(sourceUrl);
  const result = await runLegacyConversionAll({
    library,
    runDir: options['run-dir'],
    sourceUrl,
    onProgress: (progress) => console.log(JSON.stringify(progress)),
  });
  const { rows: _rows, focus, ...summary } = result.report;
  console.log(
    JSON.stringify(
      {
        ...summary,
        focus: { ...focus, rows: undefined },
        runDir: result.runDir,
        reportDir: result.reportDir,
        resumed: result.resumed,
      },
      null,
      2,
    ),
  );
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error(
      'Full conversion stopped; source unchanged. Check candidate run identity, paths and source availability.',
    );
    process.exitCode = 1;
  });
}
