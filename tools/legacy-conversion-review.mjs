// Second-pass decisions and compatibility views; never rewrites the first pass or production.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { JSDOM } from 'jsdom';
import { readManualTime } from '../public/shared/content-preparation.js';
import { renderRichDocument } from '../public/shared/rich-document-renderer.js';
import { readLegacySource, validateSourceUrl } from './legacy-conversion-all.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = (value) =>
  createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(value))
    .digest('hex');
const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const clone = (value) => structuredClone(value);
const inDir = (base, target) => {
  const relative = path.relative(base, target);
  return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
};
const frequency = (items) => {
  const result = {};
  for (const item of items) result[item] = (result[item] || 0) + 1;
  return result;
};
const jsonFile = (file, value) =>
  fs.writeFile(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });

/** Detached tools-only sanitizer. Retains disclosure/code semantics without global DOM state. */
export function sanitizeLegacyReviewHTML(html) {
  const dom = new JSDOM('');
  try {
    const root = dom.window.document.createElement('div');
    root.innerHTML = typeof html === 'string' ? html : '';
    const allowed = new Set(
      'p br div h1 h2 h3 h4 h5 h6 blockquote ul ol li pre code hr table thead tbody tfoot tr td th strong b i em u s del strike mark a span details summary img'.split(
        ' ',
      ),
    );
    const removals = [];
    for (const element of Array.from(root.querySelectorAll('*'))) {
      const tag = element.localName;
      if (
        ['script', 'style', 'iframe', 'object', 'embed', 'template', 'link', 'meta'].includes(tag)
      ) {
        removals.push({ code: 'active-element-removed', tag });
        element.remove();
        continue;
      }
      if (!allowed.has(tag)) {
        removals.push({ code: 'unknown-element-unwrapped', tag });
        element.replaceWith(...element.childNodes);
        continue;
      }
      for (const attr of Array.from(element.attributes)) {
        let safe = false;
        if (['title', 'alt'].includes(attr.name)) safe = true;
        if (attr.name === 'class' && tag === 'code' && /^language-[\w-]+$/.test(attr.value))
          safe = true;
        if (attr.name === 'open' && tag === 'details') safe = true;
        if (attr.name === 'start' && tag === 'ol' && /^\d+$/.test(attr.value)) safe = true;
        if (
          ['colspan', 'rowspan'].includes(attr.name) &&
          ['td', 'th'].includes(tag) &&
          /^\d+$/.test(attr.value)
        )
          safe = true;
        if (attr.name === 'href' && tag === 'a' && /^(https?:\/\/|mailto:)/i.test(attr.value))
          safe = true;
        if (attr.name === 'src' && tag === 'img' && /^\/media\/[\w%:-]+$/.test(attr.value))
          safe = true;
        if (!safe) {
          element.removeAttribute(attr.name);
          removals.push({
            code: 'unsafe-or-unsupported-attribute-removed',
            tag,
            attribute: attr.name,
          });
        }
      }
      if (tag === 'a') element.setAttribute('rel', 'noopener noreferrer');
    }
    return {
      html: root.innerHTML,
      removals,
      shape: {
        details: root.querySelectorAll('details').length,
        summary: root.querySelectorAll('summary').length,
        pre: root.querySelectorAll('pre').length,
      },
    };
  } finally {
    dom.window.close();
  }
}
const mediaPath = (id) => '/media/' + encodeURIComponent(id);
export async function verifyLegacyReviewMedia(assetId, origin = 'http://127.0.0.1:18765') {
  if (!/^[\w:-]+$/.test(assetId)) return { ok: false, code: 'invalid-asset-id' };
  const base = validateSourceUrl(origin);
  try {
    const response = await fetch(new URL(mediaPath(assetId), base), {
      method: 'GET',
      redirect: 'error',
      headers: { Range: 'bytes=0-0' },
      signal: AbortSignal.timeout(30000),
    });
    const result = {
      ok: [200, 206].includes(response.status),
      status: response.status,
      method: 'GET',
      contentType: response.headers.get('content-type')?.split(';')[0] || null,
      contentRangePresent: !!response.headers.get('content-range'),
    };
    await response.body?.cancel();
    return result;
  } catch {
    return { ok: false, code: 'media-get-failed', method: 'GET' };
  }
}
function selectedClock(entry, choice) {
  const evidence = {
    currentRevision: entry.revision ?? null,
    currentContentSha256: sha(entry.content || ''),
  };
  if (choice === 'history-matched-content-clock') {
    const matches = (entry.history || []).filter(
      (h) => h.content === entry.content && Number.isFinite(Date.parse(h.updatedAt)),
    );
    const old = entry.legacy?.original?.updateTime;
    const oldDate = new Date(typeof old === 'number' && old > 0 && old < 1e11 ? old * 1000 : old);
    const match = matches.find(
      (h) => Number.isFinite(oldDate.valueOf()) && h.updatedAt === oldDate.toISOString(),
    );
    if (match)
      return {
        at: match.updatedAt,
        source: choice,
        evidence: {
          ...evidence,
          historyRevision: match.revision ?? null,
          historyContentSha256: sha(match.content),
          originalUpdateTimeMatches: true,
        },
      };
    return { at: null, source: 'unresolved-edit-clock', evidence };
  }
  if (choice === 'current-updatedAt')
    return { at: entry.updatedAt || null, source: choice, evidence };
  if (entry.contentEditedAt !== undefined)
    return { at: entry.contentEditedAt, source: 'content-editedAt', evidence };
  return { at: entry.updatedAt || null, source: 'entry-updatedAt', evidence };
}
function fallback(clock) {
  if (!clock.at || !Number.isFinite(Date.parse(clock.at))) return null;
  return {
    instant: new Date(clock.at).toISOString(),
    local: null,
    timeZone: 'UTC',
    precision: 'millisecond',
    source: 'edit-fallback',
    sourceField: clock.source,
  };
}
const inlineText = (node) =>
  node?.type === 'hardBreak' ? '\n' : node?.text || (node?.content || []).map(inlineText).join('');
function reviewTemporal(first, clock, zone) {
  const temporal = clone(first.temporal),
    nodes = new Map(),
    decisions = [];
  const visit = (node) => {
    nodes.set(node.attrs?.blockId, node);
    (node.content || []).forEach(visit);
  };
  first.candidate.body.content.forEach(visit);
  const date = new Date(first.original.date);
  const parts = Number.isFinite(date.valueOf())
    ? new Intl.DateTimeFormat('en-CA', {
        timeZone: zone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(date)
    : [];
  const entryDate = parts.length
    ? ['year', 'month', 'day'].map((type) => parts.find((p) => p.type === type).value).join('-')
    : null;
  let explicitDate = null,
    override = null;
  const anchors = [];
  for (const segment of temporal.segments) {
    const node = nodes.get(segment.blockId);
    if (node?.type === 'image') continue; // A resource's insertedAt remains independent and unknown for legacy images.
    if (segment.role === 'time-anchor') {
      explicitDate = segment.time.local?.slice(0, 10) || explicitDate;
      override = null;
      const anchor = temporal.anchors.find(
        (a) => a.blockId === segment.blockId && a.range.from === segment.range.from,
      );
      if (anchor) anchors.push(anchor);
      continue;
    }
    if (segment.role === 'unresolved-time') {
      const originalLine = inlineText(node)
        .slice(segment.range.from, segment.range.to)
        .replace(/\n$/, '');
      const raw = originalLine.trim();
      let line = raw;
      if (/^[\[（(【]/.test(line)) line = line.slice(1);
      if (/[\]）)】]$/.test(line)) line = line.slice(0, -1);
      line = line.trim();
      let parsed = null,
        source = null,
        normalization = null;
      if (/^\d{1,2}:\d{2}(?::\d{2})?$/.test(line) && (explicitDate || entryDate)) {
        parsed = readManualTime(`${explicitDate || entryDate} ${line}`, zone);
        source = explicitDate ? 'manual-anchor-date-context' : 'entry-date-context';
      } else {
        const normalized = line.replace(/日(?=\d)/, '日 ');
        parsed = readManualTime(normalized, zone);
        source = 'manual-marker-normalized-index';
        normalization =
          normalized !== line ? 'insert-date-time-separator-in-index' : 'repair-bracket-in-index';
      }
      if (parsed?.time) {
        const time = {
          ...parsed.time,
          source,
          ...(source === 'entry-date-context'
            ? { dateSource: 'entry.date', assumedDate: true }
            : {}),
          ...(normalization ? { indexNormalization: normalization } : {}),
        };
        const anchor = {
          blockId: segment.blockId,
          range: { ...segment.range, to: segment.range.from + originalLine.length },
          time,
        };
        override = { time, anchor: { blockId: anchor.blockId, range: anchor.range } };
        segment.role = 'time-anchor';
        segment.time = clone(time);
        segment.anchor = clone(override.anchor);
        anchors.push(anchor);
        if (source !== 'entry-date-context') explicitDate = time.local.slice(0, 10);
        decisions.push({
          code: source,
          disposition: 'resolved-index-only',
          blockId: segment.blockId,
          range: anchor.range,
          ...(normalization ? { normalization } : {}),
          originalTextUnchanged: true,
          noMidnightRolloverInferred: true,
        });
      } else {
        override = fallback(clock) ? { time: fallback(clock), anchor: null } : null;
        decisions.push({
          code: 'unparsed-marker-edit-fallback',
          disposition: override ? 'resolved-fallback' : 'review',
          blockId: segment.blockId,
          originalTextUnchanged: true,
        });
      }
    }
    if (override) {
      segment.time = clone(override.time);
      segment.anchor = clone(override.anchor);
    } else if (segment.time?.source === 'legacy-unknown' && fallback(clock))
      segment.time = fallback(clock);
  }
  temporal.anchors = anchors;
  temporal.originalIssuesRetained = true;
  return { temporal, decisions };
}

/** HTML fragment for the root-owned read-only comparison route. No richdoc schema expansion. */
export function renderLegacyReviewView(review, { mediaBaseUrl = 'http://127.0.0.1:18765' } = {}) {
  const origin = validateSourceUrl(mediaBaseUrl);
  const placedBlocks = new Set();
  const region = (review.candidate.attachmentPlacements || [])
    .map((placement) => {
      if (placement.kind === 'image') {
        const image = review.candidate.body.content.find(
          (n) => n.type === 'image' && n.attrs.blockId === placement.blockId,
        );
        if (!image) return '';
        placedBlocks.add(placement.blockId);
        return renderRichDocument({ ...review.candidate.body, content: [image] });
      }
      const tag = ['video', 'audio'].includes(placement.kind) ? placement.kind : null;
      const href = mediaPath(placement.assetId);
      const label = esc(placement.description?.name || placement.description?.fileName || '附件');
      return `<figure data-legacy-attachment="${placement.sourceIndex ?? placement.order}">${tag ? `<${tag} controls preload="metadata" src="${esc(href)}"></${tag}>` : ''}<figcaption><a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${label}</a></figcaption></figure>`;
    })
    .join('');
  const remainingBody = review.candidate.body.content.filter(
    (n) => !placedBlocks.has(n.attrs?.blockId),
  );
  const body =
    review.compatibilityView?.mode === 'legacy-html-readonly'
      ? sanitizeLegacyReviewHTML(review.original.content).html
      : remainingBody.length
        ? renderRichDocument({
            ...review.candidate.body,
            content: remainingBody,
          })
        : '';
  const dom = new JSDOM('');
  try {
    const root = dom.window.document.createElement('div');
    root.innerHTML = `<section data-legacy-review="readonly"><div data-attachment-region="legacy-default-start">${region}</div><div data-review-body>${body}</div></section>`;
    for (const element of root.querySelectorAll('[src],[href]'))
      for (const attribute of ['src', 'href']) {
        const value = element.getAttribute(attribute);
        if (value?.startsWith('/media/'))
          element.setAttribute(attribute, new URL(value, origin).href);
      }
    return root.innerHTML;
  } finally {
    dom.window.close();
  }
}

export function buildLegacyReviewCandidate(
  first,
  { clockChoice = null, mediaVerifications = {}, timeZone = 'Asia/Shanghai' } = {},
) {
  const originalHash = sha(first.original),
    bodyHash = sha(first.candidate.body);
  const warnings = [...first.row.issueCodes],
    decisions = [],
    accepted = new Set();
  const clockPending = warnings.includes('ambiguous-edit-clock') && !clockChoice;
  const clock = clockPending
    ? { at: null, source: 'unresolved-edit-clock', evidence: {} }
    : selectedClock(first.original, clockChoice);
  const processed = reviewTemporal(first, clock, timeZone);
  decisions.push(...processed.decisions);
  if (warnings.includes('time-order-reversed')) {
    accepted.add('time-order-reversed');
    decisions.push({
      code: 'time-order-reversed',
      disposition: 'resolved-preserved',
      authorOrderPreserved: true,
      noMidnightRolloverInferred: true,
    });
  }
  if (!clockPending && warnings.includes('ambiguous-edit-clock') && fallback(clock)) {
    accepted.add('ambiguous-edit-clock');
    decisions.push({
      code: 'edit-clock-selected',
      disposition: 'resolved-evidence',
      sourceField: clock.source,
      evidence: clock.evidence,
    });
  }
  const timeResolved = !processed.decisions.some((d) => d.disposition === 'review');
  if (timeResolved) {
    accepted.add('unresolved-time-only');
    accepted.add('unclassified-time');
  }
  const nonImages = first.candidate.attachmentPlacements.filter((p) => p.kind !== 'image');
  const resources = nonImages.map((p) => ({
    sourceIndex: p.sourceIndex ?? p.order,
    assetId: p.assetId,
    kind: p.kind,
    path: mediaPath(p.assetId),
    verification: mediaVerifications[p.assetId] || { ok: false, code: 'media-not-verified' },
    descriptor: clone(p.description),
  }));
  const attachmentCompatible =
    resources.length > 0 &&
    resources.every(
      (r) =>
        r.descriptor &&
        r.verification.ok &&
        (r.kind === 'video'
          ? r.verification.contentType?.startsWith('video/')
          : r.kind === 'audio'
            ? r.verification.contentType?.startsWith('audio/')
            : false),
    );
  if (attachmentCompatible) {
    accepted.add('non-image-attachment-body-unsupported');
    accepted.add('non-image-attachment-preview-gap');
    decisions.push({
      code: 'ordered-attachment-controls',
      disposition: 'compatible-fallback',
      resources: resources.length,
      richdocSchemaUnchanged: true,
    });
  }
  const disclosure = warnings.includes('line-or-block-structure-mismatch');
  const sanitized = disclosure ? sanitizeLegacyReviewHTML(first.original.content) : null;
  if (disclosure && sanitized.shape.details > 0 && !sanitized.removals.length) {
    for (const code of [
      'unsupported-element',
      'source-class-review',
      'source-element-review',
      'line-or-block-structure-mismatch',
    ])
      accepted.add(code);
    decisions.push({
      code: 'legacy-details-readonly',
      disposition: 'compatible-fallback',
      shape: sanitized.shape,
      richdocFullySupported: false,
      originalHtmlSha256: sha(first.original.content),
      sanitizedHtmlSha256: sha(sanitized.html),
    });
  }
  if (
    (attachmentCompatible || (disclosure && sanitized && !sanitized.removals.length)) &&
    warnings
      .filter((code) => code !== 'converter-reported-issue')
      .every((code) => accepted.has(code))
  )
    accepted.add('converter-reported-issue');
  const remainingWarnings = warnings.filter((code) => !accepted.has(code));
  if (sanitized?.removals.length)
    remainingWarnings.push('compatibility-sanitizer-changes-require-review');
  const review = {
    format: 'shiye-legacy-second-pass-candidate',
    version: 1,
    original: clone(first.original),
    candidate: clone(first.candidate),
    temporal: processed.temporal,
    firstPassValidation: clone(first.validation),
    sourceReadOnly: true,
    candidateOnly: true,
    noProductionWrites: true,
    provenance: {
      sourceSha256: originalHash,
      firstPassPackageSha256: first.packageSha256,
      firstPassBodySha256: bodyHash,
    },
    compatibilityView: {
      format: 'safe-html',
      mode: disclosure
        ? 'legacy-html-readonly'
        : resources.length
          ? 'richdoc-with-attachment-region'
          : 'richdoc',
      resources,
      richdocSchemaExpanded: false,
    },
    review: {
      key: first.row.key,
      sourceIndex: first.row.sourceIndex,
      decisions,
      originalWarnings: warnings,
      acceptedWarnings: warnings.filter((code) => accepted.has(code)),
      remainingWarnings,
      status: remainingWarnings.length
        ? 'review'
        : disclosure || resources.length
          ? 'compatible-fallback'
          : 'resolved-preserved',
    },
    validation: {
      originalPreserved: true,
      firstPassBodyPreserved: true,
      knownAnchorsPreserved: first.temporal.anchors.every((a) =>
        processed.temporal.anchors.some(
          (b) =>
            a.blockId === b.blockId &&
            a.range.from === b.range.from &&
            a.time.instant === b.time.instant,
        ),
      ),
      imageInsertedAtPreserved: true,
    },
  };
  review.compatibilityView.html = renderLegacyReviewView(review);
  if (sha(review.original) !== originalHash || sha(review.candidate.body) !== bodyHash)
    throw Error('Second pass must preserve original and body');
  return review;
}

async function safePrivatePath(workspace, target) {
  const base = path.join(workspace, 'var', 'migration-lab');
  if (!inDir(base, target))
    throw Error('Review directories must be private migration-lab children');
  let cursor = workspace;
  for (const part of path.relative(workspace, target).split(path.sep)) {
    cursor = path.join(cursor, part);
    try {
      if ((await fs.lstat(cursor)).isSymbolicLink())
        throw Error('Review paths cannot contain symbolic links');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
}
export async function runLegacyConversionReview({
  firstRunDir,
  runDir,
  workspaceRoot = ROOT,
  clockDecisions = {},
  mediaBaseUrl = 'http://127.0.0.1:18765',
  verifyMedia = verifyLegacyReviewMedia,
  verifySource = true,
}) {
  const workspace = path.resolve(workspaceRoot),
    firstDir = path.resolve(firstRunDir),
    target = path.resolve(runDir);
  await safePrivatePath(workspace, firstDir);
  await safePrivatePath(workspace, target);
  if (firstDir === target || inDir(firstDir, target) || inDir(target, firstDir))
    throw Error('Second pass must be separate from first pass');
  const manifestFile = path.join(firstDir, 'manifest.json'),
    snapshotFile = path.join(firstDir, 'source-snapshot.json');
  const manifestRaw = await fs.readFile(manifestFile, 'utf8'),
    snapshotRaw = await fs.readFile(snapshotFile, 'utf8');
  const manifest = JSON.parse(manifestRaw),
    snapshot = JSON.parse(snapshotRaw);
  if (
    sha(snapshot.library) !== snapshot.sourceSha256 ||
    manifest.sourceSha256 !== snapshot.sourceSha256
  )
    throw Error('First-pass source snapshot failed integrity check');
  const rows = manifest.rows.filter((row) => row.status === 'review');
  const packages = [];
  for (const row of rows) {
    if (!/^[a-f0-9]{64}$/.test(row.key)) throw Error('Invalid first-pass package key');
    const file = path.join(firstDir, 'entries', row.key + '.json');
    await safePrivatePath(workspace, file);
    const raw = await fs.readFile(file, 'utf8'),
      first = JSON.parse(raw);
    const { packageSha256, ...unsigned } = first;
    if (
      sha(unsigned) !== packageSha256 ||
      sha(first.original) !== first.source.sha256 ||
      sha(first.original) !== sha(snapshot.library.entries[row.sourceIndex])
    )
      throw Error('First-pass package failed integrity check');
    packages.push({ file, raw, first });
  }
  await fs.mkdir(target, { recursive: false }); // EEXIST is intentional: never overwrite a prior review round.
  await fs.mkdir(path.join(target, 'entries'));
  const outputs = path.join(
    workspace,
    'outputs',
    'legacy-conversion-review',
    path.basename(target),
  );
  await fs.mkdir(outputs, { recursive: true });
  const mediaVerifications = {};
  for (const { first } of packages)
    for (const placement of first.candidate.attachmentPlacements.filter((p) => p.kind !== 'image'))
      if (!mediaVerifications[placement.assetId])
        mediaVerifications[placement.assetId] = await verifyMedia(placement.assetId, mediaBaseUrl);
  const results = [];
  for (const { first, raw } of packages) {
    const review = buildLegacyReviewCandidate(first, {
      clockChoice: clockDecisions[first.row.sourceIndex] || null,
      mediaVerifications,
    });
    review.provenance.firstPassFileSha256 = sha(raw);
    review.provenance.reviewAlgorithmSha256 = sha(
      await fs.readFile(fileURLToPath(import.meta.url), 'utf8'),
    );
    await jsonFile(path.join(target, 'entries', first.row.key + '.json'), review);
    results.push({
      key: first.row.key,
      sourceIndex: first.row.sourceIndex,
      status: review.review.status,
      originalWarnings: review.review.originalWarnings,
      remainingWarnings: review.review.remainingWarnings,
      decisions: review.review.decisions.map(({ evidence: _evidence, ...decision }) => decision),
      validation: review.validation,
      compatibilityMode: review.compatibilityView.mode,
      resources: review.compatibilityView.resources.length,
    });
  }
  const firstPassUnchanged =
    manifestRaw === (await fs.readFile(manifestFile, 'utf8')) &&
    snapshotRaw === (await fs.readFile(snapshotFile, 'utf8')) &&
    (
      await Promise.all(packages.map(async (p) => p.raw === (await fs.readFile(p.file, 'utf8'))))
    ).every(Boolean);
  const fresh = verifySource ? await readLegacySource(mediaBaseUrl) : null;
  const sourceUnchanged = fresh ? sha(fresh) === snapshot.sourceSha256 : null;
  const report = {
    format: 'shiye-legacy-review-report',
    version: 1,
    sourceReadOnly: true,
    candidateOnly: true,
    noProductionWrites: true,
    total: results.length,
    statuses: frequency(results.map((r) => r.status)),
    remainingWarnings: frequency(results.flatMap((r) => r.remainingWarnings)),
    firstPassUnchanged,
    sourceUnchanged,
    sourceSha256: snapshot.sourceSha256,
    firstPassManifestSha256: sha(manifestRaw),
    firstPassSnapshotFileSha256: sha(snapshotRaw),
    verifiedMedia: Object.values(mediaVerifications).filter((v) => v.ok).length,
    mediaCount: Object.keys(mediaVerifications).length,
    sourceEntries: snapshot.library.entries.length,
    rows: results,
  };
  await jsonFile(path.join(target, 'manifest.json'), report);
  await jsonFile(path.join(outputs, 'report.json'), report);
  return { report, runDir: target, reportDir: outputs };
}

async function main() {
  const options = Object.fromEntries(
    process.argv
      .slice(2)
      .reduce(
        (items, value, i, list) =>
          value.startsWith('--') ? [...items, [value.slice(2), list[i + 1]]] : items,
        [],
      ),
  );
  if (!options['first-run-dir'] || !options['run-dir'])
    throw Error('Explicit first and second run directories are required');
  const choices = options['clock-decisions']
    ? JSON.parse(await fs.readFile(options['clock-decisions'], 'utf8'))
    : {};
  const result = await runLegacyConversionReview({
    firstRunDir: options['first-run-dir'],
    runDir: options['run-dir'],
    clockDecisions: choices,
    mediaBaseUrl: options.url || 'http://127.0.0.1:18765',
  });
  const { rows: _rows, ...summary } = result.report;
  console.log(
    JSON.stringify({ ...summary, runDir: result.runDir, reportDir: result.reportDir }, null, 2),
  );
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(() => {
    console.error('Review stopped; source and first-pass candidates were not changed.');
    process.exitCode = 1;
  });
