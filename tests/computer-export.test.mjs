import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, writeFile, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createDiaryServer } from '../src/server/app.mjs';
import {
  captureComputerSource,
  exportComputerSeed,
  computerOwnerTransport,
} from '../src/server/shared-sync/computer-export.mjs';
import { readSharedSeed } from '../src/server/shared-sync/seed-package.mjs';
import { runComputerExport } from '../tools/computer-export.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function fixture() {
  const root = path.resolve('tmp/computer-export-tests');
  await mkdir(root, { recursive: true });
  const area = await mkdtemp(path.join(root, 'case-')),
    dataDir = path.join(area, 'data');
  await mkdir(path.join(dataDir, 'media'), { recursive: true });
  await mkdir(path.join(dataDir, 'originals'));
  const id = randomUUID(),
    archiveId = randomUUID(),
    bytes = Buffer.from('original\0bytes'),
    raw = Buffer.from('private old archive');
  const db = {
    schema: 1,
    categories: ['日常'],
    entries: [
      {
        id: randomUUID(),
        title: '合成',
        content: '<p>same owner</p>',
        date: '2026-10-19T00:00:00Z',
        revision: 1,
        attachments: [id],
        history: [],
        unknown: { nested: [1, 2] },
      },
    ],
    media: [{ id, name: 'fixture.png', type: 'image/png', size: bytes.length, sha256: sha(bytes) }],
    imports: [{ id: archiveId, sha256: sha(raw) }],
    settings: { privateToken: 'private recovery only' },
  };
  await writeFile(path.join(dataDir, 'media', id), bytes);
  await writeFile(path.join(dataDir, 'originals', archiveId), raw);
  await writeFile(path.join(dataDir, 'diary.json'), JSON.stringify(db));
  return { area, dataDir, db, id, archiveId, bytes, raw };
}

test('private capture preserves exact generation and every indexed original without inventing shared identity', async () => {
  const f = await fixture(),
    before = await readFile(path.join(f.dataDir, 'diary.json'));
  const captured = await captureComputerSource({
    dataDir: f.dataDir,
    exportsDir: path.join(f.area, 'exports'),
  });
  assert.deepEqual(await readFile(path.join(captured.directory, 'diary.json')), before);
  assert.deepEqual(await readFile(path.join(f.dataDir, 'diary.json')), before);
  assert.deepEqual(await readFile(path.join(captured.directory, 'media', f.id)), f.bytes);
  assert.equal(captured.report.sourceSha256, sha(before));
  assert.equal(captured.report.sharedEnabled, false);
  assert.equal(captured.report.directlyImportable, false);
  assert.equal(captured.report.completeComputerExport, false);
  assert.equal(captured.report.counts.files, 2);
  assert.ok(!JSON.stringify(captured.report).includes('private recovery only'));
  const second = await captureComputerSource({
    dataDir: f.dataDir,
    exportsDir: path.join(f.area, 'exports'),
  });
  assert.equal(second.report.sourceSha256, captured.report.sourceSha256);
});

test('missing, corrupt and unsafe originals never produce a successful capture marker', async () => {
  for (const alteration of ['corrupt', 'missing', 'unsafe']) {
    const f = await fixture(),
      exportsDir = path.join(f.area, 'exports');
    if (alteration === 'corrupt') await writeFile(path.join(f.dataDir, 'media', f.id), 'wrong');
    else {
      f.db.media[0].id = alteration === 'unsafe' ? '../outside' : randomUUID();
      await writeFile(path.join(f.dataDir, 'diary.json'), JSON.stringify(f.db));
    }
    await assert.rejects(() => captureComputerSource({ dataDir: f.dataDir, exportsDir }));
    for (const name of await readdir(exportsDir))
      await assert.rejects(() => readFile(path.join(exportsDir, name, 'capture-manifest.json')), {
        code: 'ENOENT',
      });
  }
});

test('real fixed HTTP export uses live owner identity, registers actual seed and verifies streamed originals', async (t) => {
  const f = await fixture();
  const server = await createDiaryServer({ dataDir: f.dataDir, sharedSync: true, seed: false });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.close();
    await once(server, 'close');
  });
  const request = computerOwnerTransport({ baseUrl: `http://127.0.0.1:${server.address().port}` });
  const info = await request('info', {}),
    file = path.join(f.area, 'fixture.syseed');
  const exported = await exportComputerSeed({
    dataDir: f.dataDir,
    file,
    directory: path.join(f.area, 'work'),
    request,
  });
  assert.equal(exported.manifest.libraryId, info.libraryId);
  assert.equal(exported.manifest.epoch, info.epoch);
  assert.equal(exported.registration.registered, true);
  assert.equal(exported.manifest.assetCount, 1);
  await assert.rejects(
    () =>
      exportComputerSeed({
        dataDir: f.dataDir,
        file: path.join(f.area, 'wrong.syseed'),
        directory: path.join(f.area, 'work'),
        request: async () => ({ ...info, libraryId: randomUUID() }),
      }),
    { code: 'COMPUTER_ORIGINAL_OWNER_IDENTITY_MISMATCH' },
  );
  const opened = await readSharedSeed({ file, directory: path.join(f.area, 'read') });
  assert.equal(opened.manifest.libraryId, info.libraryId);
  await opened.dispose();
  const latest = JSON.parse(await readFile(path.join(f.dataDir, 'diary.json'), 'utf8'));
  assert.deepEqual(latest.entries, f.db.entries);
  assert.equal(latest._sharedSeedExports.length, 1);
  await assert.rejects(() => request('arbitrary-path', {}), {
    code: 'COMPUTER_FIXED_ACTION_REQUIRED',
  });
});

test('unshared owner is refused without writing a package and CLI requires explicit absolute paths', async () => {
  const f = await fixture(),
    file = path.join(f.area, 'no.syseed');
  await assert.rejects(
    () =>
      exportComputerSeed({
        dataDir: f.dataDir,
        file,
        directory: path.join(f.area, 'work'),
        request: async () => ({ enabled: false }),
      }),
    { code: 'COMPUTER_ORIGINAL_OWNER_NOT_SHARED' },
  );
  await assert.rejects(() => readFile(file), { code: 'ENOENT' });
  await assert.rejects(
    () => runComputerExport(['capture', '--data-dir', 'relative', '--exports-dir', f.area]),
    { code: 'COMPUTER_EXPLICIT_PATH_REQUIRED' },
  );
});
