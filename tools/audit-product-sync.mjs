import path from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { planLegacyProductImport } from '../src/server/sync-product/legacy-adapter.mjs';
import { prepareProductPayload } from '../public/shared/sync-product.js';
import { validateSyncOperation } from '../src/server/sync-v2/store.mjs';

export async function auditProductSync({ sourceFile, outputFile, sourceId = 'readonly-audit' }) {
  if (![sourceFile, outputFile].every((v) => typeof v === 'string' && path.isAbsolute(v)))
    throw new Error('EXPLICIT_PATHS_REQUIRED');
  if (path.resolve(sourceFile).toLowerCase() === path.resolve(outputFile).toLowerCase())
    throw new Error('SOURCE_OVERWRITE_REFUSED');
  const bytes = await readFile(sourceFile),
    hash = (v) => createHash('sha256').update(v).digest('hex');
  const sourceSha256 = hash(bytes),
    library = JSON.parse(bytes.toString('utf8'));
  const plan = planLegacyProductImport(library, { sourceId });
  const issues = [...plan.issues];
  let payloads = 0;
  for (const record of plan.records) {
    try {
      const prepared = prepareProductPayload(record);
      if (prepared.payload) payloads++;
      validateSyncOperation(
        {
          operationId: 'audit-record',
          entityType: prepared.record.entityType,
          entityId: prepared.record.entityId,
          command: 'create',
          baseRevision: 0,
          data: prepared.record.data,
        },
        { serverWrite: true },
      );
    } catch (error) {
      issues.push({ id: record.entityId, code: error.code || 'PAYLOAD_REJECTED' });
    }
  }
  const report = {
    readOnly: true,
    sourceSha256,
    sourceHashStillMatches: hash(await readFile(sourceFile)) === sourceSha256,
    originalEntries: library.entries.length,
    originalMedia: library.media.length,
    counts: plan.counts,
    records: plan.records.length,
    payloads,
    issues,
  };
  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, JSON.stringify(report, null, 2));
  return report;
}
