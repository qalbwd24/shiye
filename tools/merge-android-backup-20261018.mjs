// Explicit, one-batch migration. Private artifacts stay in var; production writes use the live API only.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { createDiaryServer } from '../src/server/app.mjs';
import { renderRichDocument } from '../public/shared/rich-document-renderer.js';
import { reassembleDiaryUnits, validateMessageUnit } from '../public/shared/message-units.js';
import { richMediaReferences } from '../public/shared/rich-document.js';

const root = path.resolve('var/android-import-20261018');
const candidates = path.resolve('var/message-unit-candidates/android-20261018');
const archivePath = process.env.SHIYE_BACKUP_ARCHIVE;
if (!archivePath) throw Error('SHIYE_BACKUP_ARCHIVE must point at the source backup zip');
const sha = (value) => createHash('sha256').update(value).digest('hex');
const json = (file) => fs.readFile(file, 'utf8').then(JSON.parse);
const write = (file, value) => fs.writeFile(file, JSON.stringify(value, null, 2), { flag: 'wx' });
async function api(base, pathname, value) {
  const response = await fetch(base + pathname, {
    method: value === undefined ? 'GET' : 'POST',
    headers: { 'X-Diary-Client': 'desktop', 'Content-Type': 'application/json' },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
    signal: AbortSignal.timeout(120000),
  });
  const result = await response.json();
  if (!response.ok) throw Error(`API ${response.status}: ${result.error}`);
  return result;
}
function validateImported(library, bundle) {
  const units = new Map((library.messageStore?.units || []).map((u) => [u.id, u]));
  const mapped = [];
  for (const source of bundle.library.entries) {
    const owned = source.messageUnits.ids.map((id) => units.get(id));
    assert(owned.every(Boolean), 'Missing canonical messages');
    const ids = new Set(owned.map((u) => u.origin.entryId));
    assert.equal(ids.size, 1);
    const entry = library.entries.find((e) => e.id === [...ids][0]);
    assert(entry && entry.contentFormat === 'richdoc');
    const restored = reassembleDiaryUnits(owned, library.messageStore.layouts[entry.id].layout);
    assert.deepEqual(restored, entry.body);
    assert.equal(renderRichDocument(restored), entry.content);
    for (const u of owned) {
      validateMessageUnit(u);
      assert(u.eventTime.instant, 'New messages require a known time');
    }
    assert(owned.every((u) => u.state === 'active'));
    assert.equal(entry.legacy.original.uuid, source.legacy.original.uuid);
    assert.deepEqual(entry.legacy.original, source.legacy.original);
    for (const ref of richMediaReferences(entry.body))
      assert(library.media.some((m) => m.id === ref.assetId));
    mapped.push(entry.id);
  }
  return mapped;
}
function preserved(before, after) {
  for (const entry of before.entries) {
    if (entry.chatJournal) continue; // User chat remains live and may receive messages independently.
    assert.deepEqual(
      after.entries.find((e) => e.id === entry.id),
      entry,
      'Existing diary was changed',
    );
  }
  for (const media of before.media)
    assert.deepEqual(
      after.media.find((m) => m.id === media.id),
      media,
    );
  for (const key of ['settings', 'revisit', 'conversationServices'])
    assert.deepEqual(after[key], before[key]);
}
async function prepare() {
  const imported = await json(path.join(root, 'decoded.json'));
  const comparison = await json(path.join(root, 'comparison.json'));
  const manifest = await json(path.join(candidates, 'manifest.json'));
  const selected = new Set(
    comparison.filter((row) => row.status !== 'duplicate').map((row) => row.id),
  );
  const library = {
    schema: 1,
    entries: [],
    media: [],
    imports: [imported.archive],
    categories: imported.categories,
    tags: imported.tags,
    templates: [],
    messageStore: { version: 1, units: [], layouts: {} },
  };
  const reviews = [];
  for (const row of manifest.rows) {
    const payload = await json(path.join(candidates, 'entries', row.key + '.json'));
    if (!selected.has(payload.original.id)) continue;
    assert(Object.values(row.checks).every(Boolean), 'Conversion integrity check failed');
    assert(!payload.converted.issues.length, 'Lossy conversion is not eligible');
    assert(
      row.issueCodes.every((code) => code === 'time-order-reversed'),
      'Unresolved conversion warning',
    );
    const entry = {
      ...structuredClone(payload.original),
      contentFormat: 'richdoc',
      body: payload.converted.body,
      content: renderRichDocument(payload.converted.body),
      contentEditedAt: payload.clock.at,
      editTimeSource: payload.clock.sourceField,
      editorOriginalHtml: payload.original.content,
    };
    delete entry.markdownSource;
    delete entry.markdownHtml;
    entry.messageUnits = {
      version: 1,
      authority: 'messageStore',
      ids: payload.candidate.units.map((u) => u.id),
    };
    library.messageStore.units.push(...payload.candidate.units);
    library.messageStore.layouts[entry.id] = {
      layout: payload.candidate.layout,
      mappings: payload.candidate.mappings || [],
      issues: payload.candidate.issues,
      revision: entry.revision,
    };
    library.entries.push(entry);
    if (row.issueCodes.length)
      reviews.push({
        entryId: entry.id,
        codes: row.issueCodes,
        resolution:
          'Keep original paragraph order and literal manual timestamps; do not sort/rewrite prose',
      });
  }
  const needed = new Set(library.entries.flatMap((e) => e.attachments));
  library.media = imported.media
    .filter((m) => needed.has(m.id))
    .map(({ data, sourcePath, ...m }) => m);
  const bytes = await fs.readFile(archivePath);
  assert.equal(sha(bytes), imported.archive.sha256);
  const files = [
    {
      folder: 'originals',
      id: imported.archive.id,
      sha256: sha(bytes),
      data: bytes.toString('base64'),
    },
  ];
  for (const media of library.media) {
    const source = imported.media.find((m) => m.id === media.id);
    const bytes = await fs.readFile(source.sourcePath);
    assert.equal(sha(bytes), media.sha256);
    assert.equal(bytes.length, media.size);
    files.push({
      folder: 'media',
      id: media.id,
      sha256: sha(bytes),
      data: bytes.toString('base64'),
    });
  }
  const bundle = { format: 'shiye-bundle', version: 1, library, files };
  validateImported(library, bundle);
  await write(path.join(root, 'canonical-bundle.json'), bundle);
  const report = {
    entries: library.entries.length,
    units: library.messageStore.units.length,
    media: library.media.length,
    sourceSha256: imported.archive.sha256,
    bundleSha256: sha(JSON.stringify(bundle)),
    reviews,
    originalArchiveRetained: true,
    duplicatesSkipped: comparison.filter((e) => e.status === 'duplicate').length,
    changedVersionsKept: comparison.filter((e) => e.status === 'changed').length,
  };
  await write(path.join(root, 'prepared.json'), report);
  console.log(JSON.stringify(report));
}
async function verify() {
  const bundle = await json(path.join(root, 'canonical-bundle.json'));
  const before = await json(path.join(root, 'before-library.json'));
  const dataDir = path.join(root, 'isolated-restore');
  await fs.mkdir(dataDir);
  await write(path.join(dataDir, 'diary.json'), before);
  const server = await createDiaryServer({ dataDir, seed: false });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const first = await api(base, '/api/restore', bundle);
    const after = await api(base, '/api/library');
    preserved(before, after);
    const ids = validateImported(after, bundle);
    assert.equal(first.entries, bundle.library.entries.length);
    assert.equal(first.messages, bundle.library.messageStore.units.length);
    const second = await api(base, '/api/restore', bundle);
    const repeated = await api(base, '/api/library');
    assert.equal(second.entries, 0);
    assert.equal(second.messages, 0);
    assert.equal(second.media, 0);
    assert.deepEqual(after, repeated, 'Repeated restore must be an exact no-op');
    for (const id of ids) {
      const response = await api(base, `/api/entries/${id}/reading-document`);
      assert(response);
    }
    const saved = await json(path.join(dataDir, 'diary.json'));
    assert.deepEqual(saved, repeated);
    const report = {
      ok: true,
      first,
      second,
      canonicalRoundTrips: ids.length,
      readingRoutes: ids.length,
      originalDiariesPreserved: before.entries.filter((e) => !e.chatJournal).length,
      repeatedRestoreNoOp: true,
      privateDataDir: dataDir,
    };
    await write(path.join(root, 'isolated-verification.json'), report);
    console.log(JSON.stringify(report));
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
async function apply() {
  const verification = await json(path.join(root, 'isolated-verification.json'));
  assert.equal(verification.ok, true);
  const prepared = await json(path.join(root, 'prepared.json'));
  const bundle = await json(path.join(root, 'canonical-bundle.json'));
  assert.equal(sha(JSON.stringify(bundle)), prepared.bundleSha256);
  assert.equal(sha(await fs.readFile(archivePath)), prepared.sourceSha256);
  const base = 'http://127.0.0.1:18765';
  const before = await api(base, '/api/library');
  if (before.imports.some((a) => a.sha256 === prepared.sourceSha256))
    throw Error('Archive already imported; do not replay a production migration');
  const baseline = await json(path.join(root, 'before-library.json'));
  // The managed revisit runner and other clients stay active. Only source diaries
  // need to match the inspection snapshot; fresh service state is captured below.
  for (const entry of baseline.entries.filter((e) => !e.chatJournal))
    assert.deepEqual(
      before.entries.find((e) => e.id === entry.id),
      entry,
    );
  // Independently persist a full latest metadata snapshot before any formal write.
  await write(path.join(root, 'formal-before-apply.json'), before);
  const healthBefore = await api(base, '/api/health');
  const receipt = await api(base, '/api/restore', bundle);
  await write(path.join(root, 'formal-commit-receipt.json'), receipt);
  const after = await api(base, '/api/library');
  await write(path.join(root, 'formal-after-apply.json'), after);
  preserved(before, after);
  const ids = validateImported(after, bundle);
  assert.equal(receipt.entries, bundle.library.entries.length);
  assert.equal(receipt.messages, bundle.library.messageStore.units.length);
  const deployment = await json(path.resolve('config/deployment.local.json'));
  for (const id of ids) {
    const entry = after.entries.find((e) => e.id === id);
    for (const assetId of entry.attachments) {
      const media = after.media.find((m) => m.id === assetId);
      assert.equal(
        sha(await fs.readFile(path.join(deployment.dataDir, 'media', assetId))),
        media.sha256,
      );
    }
    await api(base, `/api/entries/${id}/reading-document`);
  }
  const archived = after.imports.find((a) => a.sha256 === prepared.sourceSha256);
  assert(archived);
  assert.equal(
    sha(await fs.readFile(path.join(deployment.dataDir, 'originals', archived.id))),
    prepared.sourceSha256,
  );
  const healthAfter = await api(base, '/api/health');
  const report = {
    ok: true,
    receipt,
    entriesBefore: before.entries.length,
    entriesAfter: after.entries.length,
    canonicalEntries: ids.length,
    canonicalMessages: bundle.library.messageStore.units.length,
    originalDiariesPreserved: before.entries.filter((e) => !e.chatJournal).length,
    archiveSha256: prepared.sourceSha256,
    duplicateEntriesSkipped: prepared.duplicatesSkipped,
    changedVersionsKept: prepared.changedVersionsKept,
    settingsAndRevisitPreserved: true,
    liveVersionBefore: healthBefore.version,
    liveVersionAfter: healthAfter.version,
    noRestart: true,
  };
  await write(path.join(root, 'formal-verification.json'), report);
  await fs.mkdir(path.resolve('outputs/android-import-20261018'), { recursive: true });
  await write(path.resolve('outputs/android-import-20261018/report.json'), report);
  console.log(JSON.stringify(report));
}
try {
  const command = process.argv[2];
  if (command === 'prepare') await prepare();
  else if (command === 'verify') await verify();
  else if (command === 'apply') await apply();
  else throw Error('Usage: prepare | verify | apply');
} catch (error) {
  // No source text, archive tables, or credentials in terminal output.
  console.error(
    error instanceof assert.AssertionError
      ? `Migration assertion failed: ${error.message.split('\n')[0]}`
      : error.message,
  );
  process.exitCode = 1;
}
