import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { publishAbsentSharedConfig } from '../tools/lib/publish-shared-config.mjs';
import { fileSha256 } from '../src/server/shared-sync/rollout-guard.mjs';

test('canonical shared config first publication is atomic and never overwrites an existing/racing writer', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'shiye-publish-shared-config-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourceFile = path.join(root, 'future.json'),
    targetFile = path.join(root, 'canonical.json');
  const bytes = JSON.stringify({
    enabled: true,
    remote: false,
    listenHost: '127.0.0.1',
    sourceCollection: { exportsDir: root },
  });
  await fs.writeFile(sourceFile, bytes);
  const sourceSha256 = await fileSha256(sourceFile),
    args = { sourceFile, targetFile, sourceSha256 };
  const results = await Promise.allSettled([
    publishAbsentSharedConfig(args),
    publishAbsentSharedConfig(args),
  ]);
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(results.find((item) => item.status === 'rejected').reason.code, 'EEXIST');
  assert.equal(await fs.readFile(targetFile, 'utf8'), bytes);
  await assert.rejects(publishAbsentSharedConfig(args), { code: 'EEXIST' });
  assert.equal(await fs.readFile(targetFile, 'utf8'), bytes);
});

test('unchanged runtimeConfig loads the canonical shared file with no environment override', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'shiye-default-config-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const directory of ['src/server/shared-sync', 'config', 'data', 'exports'])
    await fs.mkdir(path.join(root, directory), { recursive: true });
  for (const file of [
    'src/server/config.mjs',
    'src/server/shared-sync/config.mjs',
    'config/app.json',
    'package.json',
  ])
    await fs.copyFile(path.resolve(file), path.join(root, file));
  await fs.writeFile(path.join(root, 'data/diary.json'), '{}');
  await fs.writeFile(
    path.join(root, 'config/deployment.local.json'),
    JSON.stringify({ mode: 'production', dataDir: path.join(root, 'data'), stateDirectory: root }),
  );
  await fs.writeFile(
    path.join(root, 'config/shared-backend.local.json'),
    JSON.stringify({
      enabled: true,
      remote: false,
      listenHost: '127.0.0.1',
      sourceCollection: { exportsDir: path.join(root, 'exports') },
    }),
  );
  const { runtimeConfig } = await import(
    pathToFileURL(path.join(root, 'src/server/config.mjs')).href
  );
  const result = runtimeConfig({});
  assert.equal(result.sharedSync, true);
  assert.equal(result.sharedRemote, false);
  assert.equal(result.host, '127.0.0.1');
  assert.equal(result.dataDir, path.join(root, 'data'));
  assert.equal(result.sourceCollection.exportsDir, path.join(root, 'exports'));
});
