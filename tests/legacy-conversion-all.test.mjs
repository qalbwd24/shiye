import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runLegacyConversionAll, validateSourceUrl } from '../tools/legacy-conversion-all.mjs';
import { convertLegacyEntry } from '../tools/lib/legacy-content-converter.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function fixture(t) {
  await fs.mkdir(path.join(ROOT, 'tmp'), { recursive: true });
  const workspaceRoot = await fs.mkdtemp(path.join(ROOT, 'tmp', 'legacy-all-test-'));
  // All fixture state stays under project tmp; no real library is read.
  t.after(async () => {
    const resolved = path.resolve(workspaceRoot);
    assert.ok(resolved.startsWith(path.join(ROOT, 'tmp') + path.sep));
    await fs.rm(resolved, { recursive: true });
  });
  return { workspaceRoot, runDir: path.join(workspaceRoot, 'var', 'migration-lab', 'run-a') };
}
const entry = (id, extra = {}) => ({
  id,
  date: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-02T00:00:00.000Z',
  revision: 1,
  content: '<p>2026-10-01 10:00</p><p>虚构正文</p>',
  unknown: { preserved: true },
  ...extra,
});
const library = (entries) => ({
  entries,
  media: [{ id: 'photo', type: 'image/png', name: '虚构.png' }],
  unknownRoot: { keep: true },
});

test('all entries and states are retained; chat canonical metadata is never reparsed; October coverage is explicit', async (t) => {
  const options = await fixture(t);
  const source = library([
    entry('normal', { attachments: ['photo'] }),
    entry('hidden', { hidden: true }),
    entry('deleted', { deleted: true }),
    entry('draft', { draft: true }),
    entry('canonical', {
      chatJournal: {
        version: 1,
        messages: [{ id: 'm', sentAt: '2026-10-01T10:00:00.000Z', text: '消息' }],
      },
      content: '<unsupported>派生投影</unsupported>',
    }),
    entry('utc-edge', {
      date: '2026-09-30T20:00:00.000Z',
      content: '<p>' + '长文'.repeat(2600) + '</p>',
    }),
  ]);
  const before = structuredClone(source);
  const { report, runDir } = await runLegacyConversionAll({ ...options, library: source });
  assert.deepEqual(source, before);
  assert.equal(report.total, 6);
  assert.equal(report.legacyEntries, 5);
  assert.equal(report.canonicalChatEntries, 1);
  assert.deepEqual(report.states, { hidden: 1, deleted: 1, draft: 1, demo: 0 });
  assert.equal(report.focus.total, 6);
  assert.equal(report.focus.longForm, 1);
  assert.equal(report.focus.withAttachments, 1);
  assert.equal(report.sourceFullAnchors, 4);
  assert.equal(report.targetFullAnchors, 4);
  assert.equal(report.sourceReadOnly, true);
  assert.equal(report.candidateOnly, true);
  assert.equal(report.noProductionWrites, true);
  assert.equal(report.media.bytesCopied, false);
  const snapshot = JSON.parse(await fs.readFile(path.join(runDir, 'source-snapshot.json'), 'utf8'));
  assert.deepEqual(snapshot.library, source);
  for (const row of report.rows) {
    const pack = JSON.parse(
      await fs.readFile(path.join(runDir, 'entries', row.key + '.json'), 'utf8'),
    );
    assert.deepEqual(pack.original, source.entries[row.sourceIndex]);
    if (row.mode === 'chat-canonical-preserved') {
      assert.deepEqual(pack.canonical, pack.original);
      assert.equal(pack.candidate, undefined);
    }
  }
  const serialized = JSON.stringify(report);
  assert.ok(!serialized.includes('虚构正文'));
  assert.ok(!serialized.includes('虚构.png'));
});

test('rerun reuses immutable packages and rejects changed source or algorithms and tampered packages', async (t) => {
  const options = await fixture(t);
  const source = library([entry('repeat')]);
  const first = await runLegacyConversionAll({ ...options, library: source });
  const packFile = path.join(first.runDir, 'entries', first.report.rows[0].key + '.json');
  const originalBytes = await fs.readFile(packFile, 'utf8');
  const snapshotFile = path.join(first.runDir, 'source-snapshot.json');
  const snapshotBytes = await fs.readFile(snapshotFile, 'utf8');
  const firstStat = await fs.stat(packFile);
  const second = await runLegacyConversionAll({ ...options, library: source });
  assert.equal(second.resumed, 1);
  assert.equal(await fs.readFile(packFile, 'utf8'), originalBytes);
  assert.equal((await fs.stat(packFile)).mtimeMs, firstStat.mtimeMs);
  await assert.rejects(
    runLegacyConversionAll({ ...options, library: library([entry('changed')]) }),
    /snapshot differs/,
  );
  assert.equal(await fs.readFile(snapshotFile, 'utf8'), snapshotBytes);
  assert.equal(await fs.readFile(packFile, 'utf8'), originalBytes);
  await assert.rejects(
    runLegacyConversionAll({
      ...options,
      library: source,
      convertEntry: (item, settings) => convertLegacyEntry(item, settings),
    }),
    /algorithm/,
  );
  const tampered = JSON.parse(originalBytes);
  tampered.original.content = '改动';
  await fs.writeFile(packFile, JSON.stringify(tampered));
  await assert.rejects(runLegacyConversionAll({ ...options, library: source }), /integrity/);
});

test('adapter failures retain complete original format and unknown metadata in the failed candidate queue', async (t) => {
  const options = await fixture(t);
  const source = library([entry('failure', { legacy: { original: { custom: ['保留'] } } })]);
  const result = await runLegacyConversionAll({
    ...options,
    library: source,
    convertEntry: () => {
      throw Error('private content never logged');
    },
  });
  assert.equal(result.report.statuses.failed, 1);
  const pack = JSON.parse(
    await fs.readFile(
      path.join(result.runDir, 'entries', result.report.rows[0].key + '.json'),
      'utf8',
    ),
  );
  assert.deepEqual(pack.original, source.entries[0]);
  assert.equal(pack.candidate, undefined);
  assert.deepEqual(pack.row.issueCodes, ['conversion-or-validation-exception']);
  assert.ok(!JSON.stringify(result.report).includes('private content'));
});

test('run path must be separate from source data and all fetch origins are explicit loopback GET', async (t) => {
  const options = await fixture(t);
  const source = library([]);
  await assert.rejects(
    runLegacyConversionAll({
      ...options,
      library: source,
      runDir: path.join(options.workspaceRoot, 'data'),
    }),
    /migration-lab/,
  );
  await assert.rejects(
    runLegacyConversionAll({ ...options, library: source, sourceDataDirs: [options.runDir] }),
    /separate/,
  );
  await assert.rejects(
    runLegacyConversionAll({
      ...options,
      library: source,
      runDir: path.join(options.workspaceRoot, 'var', 'migration-lab', '..', 'bad'),
    }),
    /migration-lab/,
  );
  for (const url of [
    'https://127.0.0.1',
    'http://example.com',
    'http://localhost',
    'http://127.0.0.1/api/library',
    'http://user:secret@127.0.0.1',
  ])
    assert.throws(() => validateSourceUrl(url), /loopback/);
  assert.equal(validateSourceUrl('http://127.0.0.1:18765'), 'http://127.0.0.1:18765');
});

test('an active run lock is not bypassed and interrupted dead-process runs archive their lock before resuming', async (t) => {
  const options = await fixture(t);
  const source = library([entry('resume')]);
  await runLegacyConversionAll({ ...options, library: source });
  const lock = path.join(options.runDir, 'conversion.lock');
  await fs.writeFile(lock, JSON.stringify({ pid: process.pid, token: 'active' }));
  await assert.rejects(runLegacyConversionAll({ ...options, library: source }), /still running/);
  await fs.writeFile(lock, JSON.stringify({ pid: 2147483646, token: 'interrupted' }));
  const resumed = await runLegacyConversionAll({ ...options, library: source });
  assert.equal(resumed.resumed, 1);
  assert.ok((await fs.readdir(options.runDir)).some((name) => name.startsWith('abandoned-lock-')));
});
