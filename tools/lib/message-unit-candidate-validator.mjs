// Independent candidate audit. Diagnostics contain codes/counts only.
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { validateLegacyConversion } from './legacy-conversion-validator.mjs';
import { validateRichDocument } from '../../public/shared/rich-document.js';
import { buildLegacyTimeSegments } from '../../public/shared/legacy-time-segments.js';
import { validateRenderableRichDocument } from '../../public/shared/rich-document-renderer.js';

export const candidateHash = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const flatten = (nodes = []) => nodes.flatMap((node) => [node, ...flatten(node.content)]);
const mediaNodes = (body) =>
  flatten(body?.content).filter((n) => ['image', 'video'].includes(n.type));
const same = (a, b) => isDeepStrictEqual(a, b);
function semanticContexts(body) {
  const contexts = new Map();
  const shell = (node) => {
    const attrs = { ...node.attrs };
    delete attrs.blockId;
    return { type: node.type, attrs };
  };
  const visit = (node, parents) => {
    if (node.attrs?.blockId) contexts.set(node.attrs.blockId, { shell: shell(node), parents });
    for (const child of node.content || []) visit(child, [...parents, shell(node)]);
  };
  for (const node of body.content) visit(node, []);
  return { contexts, shell };
}
function preserveUnitSemantics(body, units) {
  const { contexts, shell } = semanticContexts(body);
  let valid = true;
  const visit = (node, parents) => {
    if (node.attrs?.blockId) {
      const sourceId = node.attrs.blockId.split(':fragment:')[0];
      const source = contexts.get(sourceId);
      // Independent media deliberately lose their prose/container placement.
      const media = ['image', 'video'].includes(node.type);
      if (!source || !same(source.shell, shell(node)) || (!media && !same(source.parents, parents)))
        valid = false;
    }
    for (const child of node.content || []) visit(child, [...parents, shell(node)]);
  };
  for (const unit of units) for (const node of unit.body?.content || []) visit(node, []);
  return valid;
}
function auditLegacyText(original, converted, media) {
  // The frozen HTML auditor predates video. Audit leading videos independently,
  // then give that auditor the remaining original attachment/content structure.
  const videos = new Set(
    (converted.attachmentPlacements || [])
      .filter((p) => p.kind === 'video' && p.blockId)
      .map((p) => p.blockId),
  );
  if (!videos.size) return validateLegacyConversion(original, converted, { media });
  const source = structuredClone(original),
    target = structuredClone(converted);
  source.attachments = (original.attachments || []).filter(
    (_value, index) => !videos.has(converted.attachmentPlacements[index]?.blockId),
  );
  target.attachmentPlacements = target.attachmentPlacements
    .filter((p) => !videos.has(p.blockId))
    .map((p, index) => ({ ...p, order: index, sourceIndex: index }));
  target.body.content = target.body.content.filter((node) => !videos.has(node.attrs?.blockId));
  return validateLegacyConversion(source, target, { media });
}
export function validateMessageUnitCandidate({
  original,
  converted,
  preparedEntry,
  candidate,
  repeated,
  reassembled,
  media = [],
  validateMessageUnit,
  originalSha256,
  timeZone = 'Asia/Shanghai',
}) {
  const issues = [];
  const issue = (code) => {
    if (!issues.includes(code)) issues.push(code);
  };
  const checks = {};
  const check = (name, value, code = name) => {
    checks[name] = !!value;
    if (!value) issue(code);
  };
  const legacy = original.contentFormat !== 'richdoc';
  const sourceAudit = legacy ? auditLegacyText(original, converted, media) : null;
  if (sourceAudit) for (const item of sourceAudit.issues) issue(item.code);
  const units = candidate?.units || [];
  try {
    validateRichDocument(preparedEntry.body);
    for (const unit of units) {
      const result = validateMessageUnit(unit);
      if (result === false || result?.valid === false) throw Error('invalid');
    }
    check('structure', Array.isArray(candidate?.units) && !!candidate.layout);
  } catch {
    check('structure', false);
  }
  try {
    for (const unit of units) validateRenderableRichDocument(unit.body);
    check('unitRenderable', true);
  } catch {
    check('unitRenderable', false);
  }
  check('unitSemanticContext', preserveUnitSemantics(preparedEntry.body, units));
  check('text', sourceAudit ? sourceAudit.textPreserved : true);
  check('whitespace', sourceAudit ? sourceAudit.whitespacePreserved : true);
  check(
    'format',
    sourceAudit ? !sourceAudit.issues.some((i) => i.code === 'inline-format-mismatch') : true,
  );
  check('lineStructure', sourceAudit ? sourceAudit.lineStructurePreserved : true);
  check('reassembly', same(reassembled, preparedEntry.body));
  check('sourceHash', candidateHash(original) === originalSha256);
  check(
    'repeatStable',
    same(
      [candidate.units, candidate.layout, candidate.issues],
      [repeated.units, repeated.layout, repeated.issues],
    ),
  );
  const temporal = buildLegacyTimeSegments(preparedEntry.body, {
    timeZone,
    fallbackAt: preparedEntry.contentEditedAt ?? null,
  });
  const anchorTimes = [...new Set(temporal.anchors.map((a) => JSON.stringify(a.time)))];
  check(
    'manualTimeCoverage',
    anchorTimes.every((encoded) => {
      const expected = JSON.parse(encoded);
      return units.some(
        (unit) =>
          unit.eventTime.instant === expected.instant &&
          unit.eventTime.source === expected.source &&
          unit.eventTime.precision === expected.precision,
      );
    }),
  );
  const ids = units.map((u) => u.id);
  check(
    'globalIds',
    ids.every((id) => typeof id === 'string' && id.length > 8 && !/^\d+$/.test(id)) &&
      new Set(ids).size === ids.length,
  );
  const sourceMedia = mediaNodes(preparedEntry.body);
  const targetMedia = units.flatMap((u) => mediaNodes(u.body));
  check(
    'mediaOrder',
    same(
      sourceMedia.map((n) => [n.type, n.attrs.assetId, n.attrs.occurrenceId]),
      targetMedia.map((n) => [n.type, n.attrs.assetId, n.attrs.occurrenceId]),
    ),
  );
  const attachmentNodes = (converted?.attachmentPlacements || []).filter((p) => p.blockId);
  let independent = true,
    time = true;
  for (const placement of attachmentNodes) {
    const matches = units.filter((u) =>
      mediaNodes(u.body).some((n) => n.attrs.occurrenceId === placement.occurrenceId),
    );
    const unit = matches[0];
    independent &&=
      matches.length === 1 &&
      mediaNodes(unit?.body).length === 1 &&
      !flatten(unit?.body?.content).some((n) => n.type === 'text' && n.text);
    const node = mediaNodes(unit?.body)[0];
    const expected = preparedEntry.contentEditedAt ?? preparedEntry.updatedAt ?? null;
    time &&=
      node?.attrs.insertedAt === null &&
      (expected
        ? unit?.eventTime?.source === 'edit-fallback' &&
          unit.eventTime.instant === new Date(expected).toISOString() &&
          !!unit.eventTime.sourceField
        : unit?.eventTime?.instant === null);
  }
  check('oldAttachmentsIndependent', independent);
  check('oldAttachmentTime', time);
  const placements = converted?.attachmentPlacements || [];
  const originalAttachments = original.attachments || [];
  const attachmentDescriptors =
    !legacy ||
    (Array.isArray(originalAttachments) &&
      originalAttachments.length === placements.length &&
      placements.every((placement, index) => {
        const value = originalAttachments[index];
        const assetId =
          typeof value === 'string' ? value : value?.assetId || value?.id || value?.mediaId;
        return (
          placement.assetId === assetId &&
          placement.sourceIndex === index &&
          same(placement.sourceAttachment, value) &&
          same(placement.description, media.find((asset) => asset.id === assetId) || null)
        );
      }));
  check('attachmentDescriptors', attachmentDescriptors);
  check(
    'attachments',
    (sourceAudit ? sourceAudit.attachmentsPreserved : true) && attachmentDescriptors,
  );
  const codes = (candidate?.issues || []).map((i) => (typeof i === 'string' ? i : i.code));
  for (const code of codes) issue(code);
  const compatibility =
    !!converted?.issues?.length ||
    !!sourceAudit?.issues.some((i) => i.severity === 'review') ||
    !checks.text ||
    !checks.whitespace ||
    !checks.format ||
    !checks.lineStructure ||
    !checks.attachments;
  const technical = [
    'structure',
    'reassembly',
    'sourceHash',
    'repeatStable',
    'globalIds',
    'mediaOrder',
    'oldAttachmentsIndependent',
    'oldAttachmentTime',
    'manualTimeCoverage',
    'unitRenderable',
    'unitSemanticContext',
  ].every((k) => checks[k]);
  return {
    checks,
    issueCodes: issues,
    status: !technical
      ? 'failed'
      : compatibility
        ? 'compatibility-review'
        : issues.length
          ? 'review'
          : 'normal',
    unitCount: units.length,
    mediaOccurrences: sourceMedia.length,
  };
}
