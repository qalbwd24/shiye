import { createHash } from 'node:crypto';
import { prepareProductEntry } from '../../../public/shared/sync-product.js';
import { validateSeedEntity } from '../../../public/shared/product-seed.js';
import { convertLegacyReadingEntry } from '../domain/legacy-reading-converter.mjs';
import { entryFingerprint, convertedSourceBinding } from '../domain/revisit/sources/identity.mjs';

/** Upgrade the independent sync authority only, never the legacy source library. */
export function canonicalSeedRecord(record, { media = [] } = {}) {
  if (
    record.state !== 'active' ||
    record.data?._product?.kind !== 'entry' ||
    record.data._product.readOnlyProjection ||
    record.data._canonical
  ) {
    validateSeedEntity(record);
    return record;
  }
  const entry = structuredClone(record.data);
  const refs = entry._product.refs;
  delete entry._product;
  const originalSnapshot = entryFingerprint(entry);
  const sourceField = entry.contentEditedAt
    ? 'contentEditedAt'
    : entry.legacy?.original?.updateTime
      ? 'legacy.original.updateTime'
      : 'updatedAt';
  let clock = entry.contentEditedAt || entry.legacy?.original?.updateTime || entry.updatedAt;
  if (typeof clock === 'string' && /^\d{10,13}$/.test(clock)) clock = Number(clock);
  if (typeof clock === 'number' && clock > 0 && clock < 100000000000) clock *= 1000;
  if (typeof clock === 'string' && !/(?:Z|[+-]\d\d:\d\d)$/.test(clock)) clock = NaN;
  if (!Number.isFinite(new Date(clock).valueOf()))
    throw Object.assign(new Error('SEED_CONTENT_CLOCK_REQUIRED'), {
      status: 409,
      code: 'SEED_CONTENT_CLOCK_REQUIRED',
    });
  entry.contentEditedAt = new Date(clock).toISOString();
  entry.editTimeSourceField ||= entry.editTimeSource || sourceField;
  if (entry.contentFormat !== 'richdoc') {
    const converted = convertLegacyReadingEntry(entry, { media });
    // Original source fields remain available for provenance; no silent lossy upgrade.
    const issues = converted.issues.filter(
      (i) => i.code !== 'non-image-attachment-body-unsupported',
    );
    const detailsOnly =
      issues.length > 0 &&
      issues.every(
        (i) => i.code === 'unsupported-element' && ['details', 'summary'].includes(i.tag),
      );
    if (issues.length && !detailsOnly)
      throw Object.assign(new Error('SEED_CONVERSION_REVIEW_REQUIRED'), {
        status: 409,
        code: 'SEED_CONVERSION_REVIEW_REQUIRED',
      });
    entry.body = converted.body;
    entry.contentFormat = 'richdoc';
    if (detailsOnly) {
      entry.editorOriginalHtml ||= entry.content;
      entry.compatibilityView = {
        version: 1,
        reason: 'legacy-details',
        source: 'editorOriginalHtml',
        bodySha256: createHash('sha256').update(JSON.stringify(entry.body)).digest('hex'),
      };
    }
    delete entry.markdownSource;
    delete entry.markdownHtml;
  }
  let n = 0;
  const prepared = prepareProductEntry(entry, {
    refs,
    media,
    timeZone: 'Asia/Shanghai',
    // Match the existing read-only diary adapter's IDs so historic SourceRefs,
    // paragraph IDs and comment targets survive promotion to canonical storage.
    createId: () => `candidate:${entry.id}:${n++}`,
  });
  prepared.data.revisitSourceIdentity = {
    version: 1,
    snapshot: originalSnapshot,
    binding: convertedSourceBinding(prepared.data),
  };
  validateSeedEntity({ ...record, data: prepared.data });
  return { ...record, data: prepared.data };
}
