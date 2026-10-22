// Detached second-pass decisions. Never used by live save routes.
import { createHash } from 'node:crypto';
import { isDeepStrictEqual as same } from 'node:util';
import { JSDOM } from 'jsdom';
import { readManualTime } from '../../public/shared/content-preparation.js';
import { buildLegacyTimeSegments } from '../../public/shared/legacy-time-segments.js';
import {
  prepareDiaryUnits,
  reassembleDiaryUnits,
  validateMessageUnit,
} from '../../public/shared/message-units.js';
import { validateRenderableRichDocument } from '../../public/shared/rich-document-renderer.js';
import { convertLegacyReadingEntry } from '../../src/server/domain/legacy-reading-converter.mjs';
import { validateLegacyConversion } from './legacy-conversion-validator.mjs';
import { candidateHash } from './message-unit-candidate-validator.mjs';

const clone = (value) => structuredClone(value);
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = (node) =>
  node.type === 'text'
    ? node.text
    : node.type === 'hardBreak'
      ? '\n'
      : (node.content || []).map(text).join('');
const flatten = (nodes) => nodes.flatMap((node) => [node, ...flatten(node.content || [])]);
const contentKey = (entry) =>
  digest([entry.contentFormat, entry.content, entry.body, entry.markdownSource, entry.attachments]);
const validClock = (value) =>
  typeof value === 'string' && /Z$/.test(value) && Number.isFinite(Date.parse(value));

export function reviewContentClock(original, priorClock) {
  if (validClock(original.contentEditedAt))
    return {
      at: original.contentEditedAt,
      sourceField: 'contentEditedAt',
      evidence: 'explicit-content-clock',
    };
  if (!(priorClock.issueCodes || []).includes('conflicting-content-edit-clock'))
    return { ...clone(priorClock), evidence: 'unchanged-original-clock' };
  const history = original.history || [];
  if (!history.length || !validClock(original.updatedAt))
    throw Error('Conflicting content clock requires history evidence');
  let at = original.updatedAt,
    field = 'updatedAt',
    matched = 0;
  for (const [index, previous] of history.entries()) {
    if (contentKey(previous) !== contentKey(original)) break;
    if (!validClock(previous.updatedAt)) break;
    at = previous.updatedAt;
    field = `history[${index}].updatedAt`;
    matched++;
  }
  return {
    at,
    sourceField: field,
    evidence: matched ? 'same-content-before-metadata-change' : 'latest-history-content-changed',
    matchingSnapshots: matched,
  };
}

function expandedDisclosure(original) {
  const dom = new JSDOM('<!doctype html><body></body>');
  const template = dom.window.document.createElement('template');
  template.innerHTML = original.content;
  const before = template.content.textContent;
  const sections = [...template.content.querySelectorAll('details')].map((node, index) => ({
    index,
    open: node.hasAttribute('open'),
    originalHTML: node.outerHTML,
  }));
  for (const node of [...template.content.querySelectorAll('details,summary')]) {
    const replacement = dom.window.document.createElement(node.tagName === 'SUMMARY' ? 'p' : 'div');
    replacement.append(...node.childNodes);
    node.replaceWith(replacement);
  }
  if (template.content.textContent !== before) throw Error('Disclosure expansion lost text');
  return { html: template.innerHTML, sections };
}

function recoveredTime(raw, timeZone) {
  const line = raw.trim();
  const compact = line.replace(/(\d{4}年\d{1,2}月\d{1,2}日)(?=\d{1,2}:)/, '$1 ');
  if (compact !== line) {
    const parsed = readManualTime(compact, timeZone);
    if (parsed.time) return { time: parsed.time, rule: 'compact-chinese-date' };
  }
  const pairs = { '[': ']', '【': '】', '(': ')', '（': '）' };
  if (
    pairs[line[0]] &&
    !line.endsWith(pairs[line[0]]) &&
    /^[\[【(（]\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?[T\s]+\d{1,2}:\d{2}(?::\d{2})?$/.test(line)
  ) {
    const parsed = readManualTime(line + pairs[line[0]], timeZone);
    if (parsed.time) return { time: parsed.time, rule: 'missing-closing-bracket' };
  }
  return null;
}

export function reviewMessageCandidate(payload, { media = [], timeZone = 'Asia/Shanghai' } = {}) {
  const original = clone(payload.original),
    originalHash = candidateHash(original);
  if (originalHash !== payload.source.sha256) throw Error('Original source hash mismatch');
  const decisions = [],
    codes = new Set(payload.row.issueCodes);
  const clock = reviewContentClock(original, payload.clock);
  if (codes.has('conflicting-content-edit-clock'))
    decisions.push({
      code: 'content-clock-reviewed',
      evidence: clock.evidence,
      sourceField: clock.sourceField,
    });
  let converted = clone(payload.converted),
    compatibility = null;
  if (codes.has('unsupported-element')) {
    const expanded = expandedDisclosure(original);
    if (
      !expanded.sections.length ||
      converted.issues.some(
        (issue) =>
          !(
            (issue.code === 'unsupported-element' && ['details', 'summary'].includes(issue.tag)) ||
            (issue.code === 'unsupported-attribute' &&
              issue.tag === 'details' &&
              issue.attribute === 'open')
          ),
      )
    )
      throw Error('Unsupported source requires a dedicated rule');
    const normalized = { ...original, content: expanded.html };
    converted = convertLegacyReadingEntry(normalized, { media, timeZone });
    const audit = validateLegacyConversion(normalized, converted, { media });
    if (
      !audit.textPreserved ||
      !audit.whitespacePreserved ||
      !audit.lineStructurePreserved ||
      converted.issues.length
    )
      throw Error('Disclosure expanded structure did not pass audit');
    compatibility = {
      kind: 'disclosure',
      originalHTML: original.content,
      expandedHTML: expanded.html,
      sections: expanded.sections,
      expandedAudit: audit,
    };
    decisions.push({
      code: 'disclosure-preserved',
      count: expanded.sections.length,
      mode: 'expanded-richdoc-with-original-folding-companion',
    });
  }
  const extras = [];
  for (const placement of converted.attachmentPlacements || []) {
    if (placement.blockId || !['audio', 'file'].includes(placement.kind)) continue;
    const asset = media.find((item) => item.id === placement.assetId);
    if (!asset) throw Error('Original attachment missing');
    const blockId =
      'review-attachment:' + digest([original.id, placement.sourceIndex]).slice(0, 32);
    const occurrenceId =
      'review-occurrence:' + digest([original.id, placement.sourceIndex]).slice(0, 32);
    const paragraph = {
      type: 'paragraph',
      attrs: { blockId },
      content: [{ type: 'text', text: `附件：${asset.name || placement.kind}` }],
    };
    extras.push({
      blockId,
      occurrenceId,
      assetId: asset.id,
      kind: placement.kind,
      insertedAt: null,
      sourceIndex: placement.sourceIndex,
      generatedLabel: paragraph.content[0].text,
    });
    converted.body.content.unshift(paragraph);
    decisions.push({
      code: 'attachment-reference-added',
      kind: placement.kind,
      sourceIndex: placement.sourceIndex,
      mode: 'richdoc-label-and-resource-reference',
    });
  }
  const preparedEntry = {
    ...original,
    body: converted.body,
    contentFormat: 'richdoc',
    contentEditedAt: clock.at,
    editTimeSource: clock.sourceField,
  };
  let next = 0;
  const prepare = () =>
    prepareDiaryUnits(preparedEntry, {
      media,
      timeZone,
      previousUnits: payload.candidate.units,
      createId: () => 'unit:review:' + digest([original.id, next++]).slice(0, 40),
    });
  const candidate = prepare();
  const segments = buildLegacyTimeSegments(converted.body, {
    timeZone,
    fallbackAt: clock.at,
    fallbackSource: clock.sourceField,
  }).segments;
  const blocks = new Map(
    flatten(converted.body.content)
      .filter((node) => node.attrs?.blockId)
      .map((node) => [node.attrs.blockId, node]),
  );
  for (const unit of candidate.units) {
    const unresolved = segments.find(
      (segment) =>
        segment.role === 'unresolved-time' &&
        unit.sourceSpans.some(
          (span) =>
            span.blockId === segment.blockId &&
            span.range.from <= segment.range.from &&
            span.range.to >= segment.range.to,
        ),
    );
    const raw = unresolved
      ? text(blocks.get(unresolved.blockId))
          .slice(unresolved.range.from, unresolved.range.to)
          .replace(/\n$/, '')
      : '';
    const recovered = unresolved && recoveredTime(raw, timeZone);
    if (recovered) {
      unit.eventTime = { ...recovered.time, sourceField: 'body', recoveredSyntax: true };
      unit.review = { rule: recovered.rule, blockId: unresolved.blockId, range: unresolved.range };
      decisions.push({ code: 'manual-marker-recovered', rule: recovered.rule, unitId: unit.id });
    } else if (!unit.eventTime.instant) {
      if (!validClock(clock.at)) throw Error('Incomplete clock has no edit-time fallback');
      unit.eventTime = {
        instant: clock.at,
        timeZone: 'UTC',
        precision: 'millisecond',
        source: 'edit-fallback',
        sourceField: clock.sourceField,
        inferred: true,
        fallbackReason: 'incomplete-manual-date-or-time',
      };
      unit.review = { rule: 'incomplete-time-kept-with-edit-fallback' };
      decisions.push({ code: 'edit-fallback-retained', unitId: unit.id, dateInferred: false });
    }
    const attachments = extras.filter((item) =>
      unit.sourceSpans.some((span) => span.blockId === item.blockId),
    );
    if (attachments.length) {
      unit.attachments = attachments.map((item) => item.assetId);
      unit.mediaReferences = clone(attachments);
    }
    const previous = payload.candidate.units.find((item) => item.id === unit.id);
    if (previous && !same({ ...previous, revision: 0 }, { ...unit, revision: 0 }))
      unit.revision = previous.revision + 1;
    validateMessageUnit(unit);
    validateRenderableRichDocument(unit.body);
  }
  if (codes.has('time-order-reversed'))
    decisions.push({
      code: 'nonlinear-order-preserved',
      mode: 'original-layout-plus-independent-time-order',
      correctedDates: 0,
    });
  const reassembled = reassembleDiaryUnits(candidate.units, candidate.layout);
  if (!same(reassembled, converted.body)) throw Error('Reviewed body roundtrip mismatch');
  if (candidateHash(payload.original) !== originalHash) throw Error('Source mutated');
  const preserved = converted.body.content.filter(
    (node) => !extras.some((extra) => extra.blockId === node.attrs?.blockId),
  );
  const checks = {
    sourceHash: true,
    unitRenderable: true,
    reassembly: true,
    originalBodyPreserved: compatibility
      ? compatibility.expandedAudit.textPreserved && compatibility.expandedAudit.whitespacePreserved
      : same(preserved, payload.converted.body.content),
    allTimesKnown: candidate.units.every((unit) => !!unit.eventTime.instant),
    attachmentDescriptorsPreserved: same(
      converted.attachmentPlacements,
      payload.converted.attachmentPlacements,
    ),
    supplementalReferences: extras.every((extra) =>
      candidate.units.some((unit) =>
        unit.mediaReferences?.some(
          (ref) => ref.assetId === extra.assetId && ref.occurrenceId === extra.occurrenceId,
        ),
      ),
    ),
  };
  if (Object.values(checks).some((ok) => !ok)) throw Error('Reviewed invariant failed');
  return {
    format: 'shiye-message-unit-reviewed-candidate',
    version: 1,
    candidateOnly: true,
    noProductionWrites: true,
    source: clone(payload.source),
    original,
    parentPackageSha256: payload.packageSha256,
    originalIssueCodes: [...codes],
    originalIssuesRetained: clone(payload.candidate.issues),
    clock,
    converted,
    candidate,
    compatibility,
    generatedAttachments: extras,
    decisions,
    checks,
    status:
      compatibility || extras.length
        ? 'resolved-with-compatibility'
        : decisions.some((decision) => decision.code === 'edit-fallback-retained')
          ? 'resolved-with-edit-fallback'
          : 'resolved',
  };
}
