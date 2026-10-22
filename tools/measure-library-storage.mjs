import path from 'node:path';
import { readFile, readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { planLegacyProductImport } from '../src/server/sync-product/legacy-adapter.mjs';
import { prepareProductPayload } from '../public/shared/sync-product.js';

const root = path.resolve(import.meta.dirname, '..');
const describe = (bytes) => ({
  bytes,
  MiB: +(bytes / 1048576).toFixed(2),
  GiB: +(bytes / 1073741824).toFixed(3),
});
async function inventory(directory) {
  const totals = { bytes: 0, files: 0, skippedLinks: 0, errors: 0 },
    flat = new Map();
  async function visit(dir, relative = '') {
    let items;
    try {
      items = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (error.code !== 'ENOENT') totals.errors++;
      return;
    }
    for (const item of items) {
      if (item.isSymbolicLink()) {
        totals.skippedLinks++;
        continue;
      }
      const relativePath = path.join(relative, item.name),
        full = path.join(dir, item.name);
      if (item.isDirectory()) await visit(full, relativePath);
      else if (item.isFile()) {
        try {
          const info = await stat(full);
          totals.bytes += info.size;
          totals.files++;
          flat.set(relativePath, info.size);
        } catch {
          totals.errors++;
        }
      }
    }
  }
  await visit(directory);
  return { ...totals, ...describe(totals.bytes), flat };
}

export async function measureLibraryStorage() {
  const config = JSON.parse(
    await readFile(path.join(root, 'config/deployment.local.json'), 'utf8'),
  );
  if (!path.isAbsolute(config.dataDir)) throw new Error('EXPLICIT_DATA_DIRECTORY_REQUIRED');
  const diaryFile = path.join(config.dataDir, 'diary.json'),
    source = await readFile(diaryFile);
  const db = JSON.parse(source.toString('utf8'));
  const physical = await inventory(config.dataDir);
  const groups = {};
  for (const [relative, size] of physical.flat) {
    const first = relative.split(path.sep)[0];
    const label = ['media', 'originals', 'backups'].includes(first)
      ? first
      : first === 'diary.json'
        ? 'diary.json'
        : 'other';
    groups[label] ||= { bytes: 0, files: 0 };
    groups[label].bytes += size;
    groups[label].files++;
  }
  const mediaTypes = {},
    missing = [],
    ids = new Set();
  let referencedBytes = 0,
    oversize = 0,
    largest = 0;
  for (const item of db.media || []) {
    if (ids.has(item.id)) continue;
    ids.add(item.id);
    const type = String(item.type || '').split('/')[0];
    const label = ['image', 'video', 'audio'].includes(type) ? type : 'other';
    mediaTypes[label] ||= { files: 0, bytes: 0 };
    // Match only inventoried paths; never resolve an untrusted media ID as a source path.
    const size = physical.flat.get(path.join('media', String(item.id)));
    if (size === undefined) {
      missing.push(item.id);
      continue;
    }
    mediaTypes[label].files++;
    mediaTypes[label].bytes += size;
    referencedBytes += size;
    largest = Math.max(largest, size);
    if (size > 536870912) oversize++;
  }
  const plan = planLegacyProductImport(db, { sourceId: 'storage-estimate' });
  let structuredBytes = 0,
    payloadBytes = 0;
  for (const record of plan.records) {
    const prepared = prepareProductPayload(record);
    structuredBytes += Buffer.byteLength(JSON.stringify(prepared.record));
    payloadBytes += prepared.payload?.size || 0;
  }
  const testLibraries = {};
  for (const name of ['sync-lab', 'sync-device-lab', 'product-sync-lab']) {
    const scan = await inventory(path.join(root, 'var', name));
    testLibraries[name] = { ...describe(scan.bytes), files: scan.files, errors: scan.errors };
  }
  const initialBytes = structuredBytes + payloadBytes + referencedBytes;
  const report = {
    measuredAt: new Date().toISOString(),
    readOnlySource: true,
    scope:
      'configured production data and three named isolated sync libraries; excludes project builds and backups outside dataDir',
    production: {
      entries: db.entries.length,
      messages: db.entries.reduce((n, e) => n + (e.chatJournal?.messages?.length || 0), 0),
      mediaRecords: db.media.length,
      ...describe(physical.bytes),
      files: physical.files,
      skippedLinks: physical.skippedLinks,
      errors: physical.errors,
      groups: Object.fromEntries(
        Object.entries(groups).map(([k, v]) => [k, { ...v, ...describe(v.bytes) }]),
      ),
      mediaTypes: Object.fromEntries(
        Object.entries(mediaTypes).map(([k, v]) => [k, { ...v, ...describe(v.bytes) }]),
      ),
    },
    estimatedInitialSync: {
      ...describe(initialBytes),
      structured: describe(structuredBytes + payloadBytes),
      originalMedia: describe(referencedBytes),
      mediaFilesMissing: missing.length,
      mediaOver512MiB: oversize,
      largestMedia: describe(largest),
      adaptationIssues: plan.issues.length,
      note: 'Uncompressed entity JSON plus existing media bytes; no hash dedup discount, transport overhead or measured network rate included',
      atEffectiveMBps: Object.fromEntries(
        [1, 2, 5, 10, 20].map((speed) => [
          speed,
          { minutes: +(initialBytes / (speed * 1e6) / 60).toFixed(2) },
        ]),
      ),
    },
    testLibraries,
    sourceHashStillMatches:
      createHash('sha256').update(source).digest('hex') ===
      createHash('sha256')
        .update(await readFile(diaryFile))
        .digest('hex'),
  };
  const outputDir = path.join(root, 'outputs/storage-sync-assessment');
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, 'inventory.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(JSON.stringify(await measureLibraryStorage()));
