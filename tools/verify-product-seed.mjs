import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { createSyncServer } from '../src/server/sync-v2/server.mjs';
import { productSyncExtension } from '../src/server/sync-product/service.mjs';
import { seedProductLibrary } from '../src/server/sync-product/import.mjs';
import { readSeedPackage } from '../src/server/sync-product/seed-package.mjs';

const cwd = path.resolve(import.meta.dirname, '..');
const area = path.join(cwd, 'var/product-seed-cli-lab', randomUUID());
const outputs = path.join(cwd, 'outputs/product-seed');
await fs.mkdir(path.join(area, 'source/media'), { recursive: true });
await fs.mkdir(outputs, { recursive: true });
const bytes = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');
const library = {
  schema: 1,
  categories: ['测试'],
  tags: [],
  entries: [
    {
      id: 'seed-fixture-entry',
      title: '合成数据',
      content: '<p>[2025/10/18 12:00:00] 合成文字</p>',
      category: '测试',
      tags: [],
      attachments: ['seed-fixture-image'],
      date: '2025-10-18T04:00:00Z',
      createdAt: '2025-10-18T04:00:00Z',
      updatedAt: '2025-10-18T04:01:00Z',
      revision: 1,
      history: [],
    },
  ],
  media: [{ id: 'seed-fixture-image', type: 'image/gif', name: '合成.gif', size: bytes.length }],
  stickers: [
    {
      id: 'seed-fixture-sticker',
      mediaId: 'seed-fixture-image',
      name: '开心',
      note: '合成备注',
      group: '常用',
      tags: ['开心', '日常'],
    },
  ],
  chatJournal: { version: 1, rooms: [] },
};
await fs.writeFile(path.join(area, 'source/diary.json'), JSON.stringify(library));
await fs.writeFile(path.join(area, 'source/media/seed-fixture-image'), bytes);
const services = [];
async function server(name) {
  const service = await createSyncServer({
    dataDir: path.join(area, name),
    basePath: '/sample/',
    extensionFactory: productSyncExtension({ autoTickMs: 0 }),
  });
  services.push(service);
  service.server.listen(0, '127.0.0.1');
  await once(service.server, 'listening');
  const base = `http://127.0.0.1:${service.server.address().port}/sample/`;
  const auth = service.auth.pair({
    code: service.auth.pairingCode().code,
    deviceName: '纯合成CLI验证',
  });
  const tokenFile = path.join(area, name + '-token.json');
  await fs.writeFile(tokenFile, JSON.stringify({ token: auth.token }));
  return { service, base, tokenFile };
}
async function cli(args) {
  return promisify(execFile)(
    process.execPath,
    [path.join(cwd, 'tools/product-seed.mjs'), ...args],
    { cwd, timeout: 30000, maxBuffer: 1024 * 1024 },
  );
}
try {
  const source = await server('server-source'),
    target = await server('server-target');
  await seedProductLibrary(source.service, {
    libraryFile: path.join(area, 'source/diary.json'),
    mediaDir: path.join(area, 'source/media'),
  });
  const file = path.join(area, 'first.syseed');
  await cli([
    'export',
    '--server',
    source.base,
    '--token-file',
    source.tokenFile,
    '--file',
    file,
    '--operation-id',
    'fixture-cli-v1',
  ]);
  await cli(['inspect', '--file', file, '--work-dir', path.join(area, 'inspect')]);
  const imported = await cli([
    'initialize-empty',
    '--server',
    target.base,
    '--token-file',
    target.tokenFile,
    '--file',
    file,
  ]);
  assert.equal(JSON.parse(imported.stdout.trim()).status, 'committed');
  assert.deepEqual(await target.service.media.readContent('seed-fixture-image'), bytes);
  assert.deepEqual(target.service.store.getEntity('sticker', 'seed-fixture-sticker').data.tags, [
    '开心',
    '日常',
  ]);
  const parsed = await readSeedPackage({ file, directory: path.join(area, 'golden-verify') });
  const fixture = {
    format: 'shiye-product-seed-golden',
    version: 1,
    synthetic: true,
    sha256: parsed.sha256,
    size: parsed.size,
    manifest: parsed.manifest,
    packageBase64: (await fs.readFile(file)).toString('base64'),
    expected: {
      entryId: 'seed-fixture-entry',
      stickerId: 'seed-fixture-sticker',
      stickerTags: ['开心', '日常'],
      clientWallpaper: 'device-local',
    },
  };
  await fs.mkdir(path.join(cwd, 'docs/contracts'), { recursive: true });
  const fixtureFile = path.join(cwd, 'docs/contracts/product-seed-v1.fixture.json');
  if (process.argv.includes('--write-fixture'))
    await fs.writeFile(fixtureFile, JSON.stringify(fixture, null, 2) + '\n');
  const golden = JSON.parse(await fs.readFile(fixtureFile, 'utf8'));
  const goldenFile = path.join(area, 'golden.syseed');
  await fs.writeFile(goldenFile, Buffer.from(golden.packageBase64, 'base64'));
  const checked = await readSeedPackage({
    file: goldenFile,
    directory: path.join(area, 'golden-existing'),
    expectedSha256: golden.sha256,
  });
  assert.equal(checked.size, golden.size);
  assert.deepEqual(
    checked.records.find((r) => r.entityId === golden.expected.stickerId).data.tags,
    golden.expected.stickerTags,
  );
  const report = {
    ok: true,
    syntheticOnly: true,
    cliExport: true,
    cliInspect: true,
    cliInitializeEmpty: true,
    proxyPrefix: true,
    byteExactMedia: true,
    stickerTags: true,
    entities: parsed.manifest.entityCount,
    assets: parsed.manifest.assetCount,
    goldenSha256: golden.sha256,
    privateArea: area,
    noFormalWrites: true,
  };
  await fs.writeFile(path.join(outputs, 'cli-verification.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await Promise.allSettled(services.map((s) => s.close()));
}
