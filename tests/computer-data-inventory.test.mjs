import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { auditComputerData } from '../src/server/sync-product/computer-data-inventory.mjs';

async function fixture(t, data) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'shiye-inventory-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'private.json');
  const bytes = typeof data === 'string' ? data : JSON.stringify(data);
  await writeFile(file, bytes);
  return { dir, file, bytes };
}

test('no defaults: an empty audit reports all four source gaps', async () => {
  const report = await auditComputerData();
  assert.equal(report.complete, false);
  assert.equal(report.missingSources.length, 4);
  assert.equal(report.sources.flatMap((source) => source.files).length, 0);
});

test('diary hash/shape are retained, private values, names and source paths are not', async (t) => {
  const data = {
    entries: [{ content: 'PRIVATE_BODY' }],
    media: [],
    settings: { password: 'PRIVATE_TOKEN' },
    PRIVATE_FIELD_NAME: 'SECRET_VALUE',
  };
  const { file, bytes } = await fixture(t, data);
  const report = await auditComputerData({ sources: { diary: file } });
  const output = JSON.stringify(report);
  for (const hidden of [
    'PRIVATE_BODY',
    'PRIVATE_TOKEN',
    'PRIVATE_FIELD_NAME',
    'SECRET_VALUE',
    file,
  ])
    assert.equal(output.includes(hidden), false);
  assert.equal(report.sources[0].files[0].sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(report.sources[0].files[0].structure.entries, 1);
  assert.equal(report.sources[0].files[0].structure.unknownTopLevelFieldCount, 1);
});

test('all four files and forged complete declarations cannot imply portable completeness', async (t) => {
  const { file } = await fixture(t, { complete: true, completeComputerExport: true });
  const sources = Object.fromEntries(
    [
      'diary',
      'desktop-chat-profile',
      'desktop-notes-workspace',
      'desktop-application-preferences',
    ].map((kind) => [kind, file]),
  );
  const report = await auditComputerData({ sources });
  assert.equal(report.allSourceFilesPresent, true);
  assert.equal(report.completeComputerExport, false);
  assert.equal(
    report.sources.every((source) => !source.portableImportVerified),
    true,
  );
  assert.equal(
    report.sources.every((source) => !source.logicalStructureRecognized),
    true,
  );
  assert.equal(report.sources[1].disposition, 'recovery-archive-only');
});

test('actual experimental notes export is recognized without claiming asset or import coverage', async (t) => {
  const { file } = await fixture(t, {
    kind: 'shiye-notes-ui-snapshot',
    experimental: true,
    workspace: {},
    assets: [{ id: 'a', dataUrl: 'PRIVATE_BINARY' }],
  });
  const report = await auditComputerData({ sources: { 'desktop-notes-workspace': file } });
  assert.equal(report.sources[2].logicalStructureRecognized, true);
  assert.equal(report.sources[2].portableImportVerified, false);
  assert.equal(JSON.stringify(report).includes('PRIVATE_BINARY'), false);
});

test('bounded JSON inspection still hashes full source without claiming its structure', async (t) => {
  const { file, bytes } = await fixture(t, { entries: [], media: [] });
  const report = await auditComputerData({ sources: { diary: file }, maxJsonBytes: 4 });
  const result = report.sources[0].files[0];
  assert.equal(result.structure.code, 'JSON_STRUCTURE_SIZE_LIMIT');
  assert.equal(result.size, Buffer.byteLength(bytes));
  assert.equal(result.sha256, createHash('sha256').update(bytes).digest('hex'));
});

test('missing, relative, directory and malformed inputs produce bounded reports', async (t) => {
  const { dir, file } = await fixture(t, '{invalid secret text');
  const report = await auditComputerData({
    sources: { diary: [file, dir, path.join(dir, 'missing.json'), 'relative.json'] },
  });
  assert.deepEqual(
    report.sources[0].files.map((item) => item.code),
    ['INVENTORIED', 'REGULAR_FILE_REQUIRED', 'ENOENT', 'EXPLICIT_ABSOLUTE_FILE_REQUIRED'],
  );
  assert.equal(report.sources[0].files[0].structure.code, 'INVALID_JSON_OR_RAW_RECOVERY_FILE');
  assert.equal(report.sources[0].present, false);
  await assert.rejects(auditComputerData({ sources: { unknown: file } }), /UNKNOWN_SOURCE_KIND/);
  await assert.rejects(auditComputerData({ maxJsonBytes: Infinity }), /INVALID_JSON_LIMIT/);
});

test('linked directories cannot expand the explicitly named source', async (t) => {
  const { dir, file } = await fixture(t, { entries: [], media: [] });
  const link = `${dir}-link`;
  await symlink(dir, link, process.platform === 'win32' ? 'junction' : 'dir');
  t.after(() => rm(link, { force: true }));
  const report = await auditComputerData({
    sources: { diary: path.join(link, path.basename(file)) },
  });
  assert.equal(report.sources[0].files[0].code, 'LINKED_SOURCE_REJECTED');
});

test('CLI without arguments reads no private sources; errors do not echo arguments', () => {
  const cli = path.resolve('tools/audit-computer-data.mjs');
  const report = JSON.parse(execFileSync(process.execPath, [cli], { encoding: 'utf8' }));
  assert.equal(report.missingSources.length, 4);
  assert.throws(
    () =>
      execFileSync(process.execPath, [cli, '--unknown', 'PRIVATE_TOKEN'], {
        encoding: 'utf8',
        stdio: 'pipe',
      }),
    (error) => !error.stderr.includes('PRIVATE_TOKEN'),
  );
});
