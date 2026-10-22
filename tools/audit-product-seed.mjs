// Read-only formal-source audit. Source bodies/diagnostics stay in private var paths.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { planLegacyProductImport } from '../src/server/sync-product/legacy-adapter.mjs';
import { canonicalSeedRecord } from '../src/server/sync-product/portable.mjs';
const target = path.resolve('outputs/product-seed');
await fs.mkdir(target, { recursive: true });
const deployment = JSON.parse(await fs.readFile('config/deployment.local.json', 'utf8'));
const file = path.join(deployment.dataDir, 'diary.json'),
  before = await fs.readFile(file);
const library = JSON.parse(before.toString('utf8'));
const plan = planLegacyProductImport(library, { sourceId: '48d05506-b069-467e-b9fc-8b949aa42051' });
const issues = [],
  counts = { entries: 0, canonical: 0, chatProjections: 0, units: 0 };
for (const record of plan.records.filter((r) => r.data?._product?.kind === 'entry')) {
  counts.entries++;
  try {
    const value = canonicalSeedRecord(
      { ...record, state: 'active', revision: 1 },
      { media: library.media },
    );
    if (value.data._product.readOnlyProjection) counts.chatProjections++;
    else {
      counts.canonical++;
      counts.units += value.data._canonical.units.length;
    }
  } catch (error) {
    issues.push({ id: record.entityId, code: error.code || 'INVALID_CANONICAL_SOURCE' });
  }
  if (counts.entries % 50 === 0) {
    await new Promise((resolve) => setImmediate(resolve));
    globalThis.gc?.();
    console.log(JSON.stringify({ processed: counts.entries, issues: issues.length }));
  }
}
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const after = await fs.readFile(file);
const archive = library.imports.find(
  (i) => i.sha256 === '3b12f85b5e2e101afa1d4a62608dfb4dbea23512518c6c94d2775e6d310fd1d0',
);
const report = {
  readOnly: true,
  sourceEntries: library.entries.length,
  sourceMedia: library.media.length,
  counts,
  adapterIssues: plan.issues,
  conversionIssues: issues,
  sourceHashAtRead: sha(before),
  sourceUnchangedDuringAudit: sha(before) === sha(after),
  androidBackupPresent: !!archive,
};
await fs.writeFile(path.join(target, 'source-audit.json'), JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({
    readOnly: true,
    ...counts,
    issues: issues.length,
    issueCodes: [...new Set(issues.map((i) => i.code))],
    adapterIssues: plan.issues.length,
    androidBackupPresent: !!archive,
    sourceUnchangedDuringAudit: report.sourceUnchangedDuringAudit,
  }),
);
