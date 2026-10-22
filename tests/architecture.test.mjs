import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fixture } from './helpers.mjs';
import { inspectModules } from '../tools/check-files.mjs';
import {
  PUBLIC_ROOT,
  DEFAULT_DATA_DIR,
  runtimeConfig,
  parseDeploymentConfig,
  VERSION,
} from '../src/server/config.mjs';
import { createLibraryStore } from '../src/server/storage/library-store.mjs';

test('module dependencies resolve and browser modules stay inside public', () => {
  const result = inspectModules();
  assert.ok(result.modules > 40);
  assert.deepEqual(result.errors, []);
});

test('all split browser modules and stylesheet layers are served; private paths stay inaccessible', async (t) => {
  const { base, request, dir } = await fixture(t);
  assert.notEqual(path.resolve(dir), path.resolve(DEFAULT_DATA_DIR));
  const assets = [];
  async function collect(folder) {
    for (const item of await fs.readdir(folder, { withFileTypes: true })) {
      const full = path.join(folder, item.name);
      if (item.isDirectory()) await collect(full);
      else if (/\.(js|css|html)$/.test(item.name)) assets.push(full);
    }
  }
  await collect(PUBLIC_ROOT);
  for (const file of assets) {
    const url = '/' + path.relative(PUBLIC_ROOT, file).replaceAll('\\', '/'),
      response = await fetch(base + url);
    assert.equal(response.status, 200, url);
    assert.equal(await response.text(), await fs.readFile(file, 'utf8'), url);
  }
  for (const url of [
    '/data/diary.json',
    '/resources/legacy/backup_reader.py',
    '/src/server/config.mjs',
    '/%2e%2e%2fresources/legacy/backup_reader.py',
  ])
    assert.equal((await fetch(base + url)).status, 404, url);
  assert.equal((await (await request('/api/health')).json()).version, VERSION);
});

test('storage serializes concurrent changes, preserves unknown fields, and rolls back failed mutations', async (t) => {
  const { dir } = await fixture(t),
    store = await createLibraryStore({ dataDir: dir, seed: false });
  await store.mutate((db) => {
    db.futureField = { keep: true };
    db.counter = 0;
  });
  await Promise.all(Array.from({ length: 12 }, () => store.mutate((db) => ++db.counter)));
  await assert.rejects(
    store.mutate((db) => {
      db.counter = 999;
      throw Error('synthetic failure');
    }),
  );
  const reopened = await createLibraryStore({ dataDir: dir, seed: false });
  assert.equal(reopened.getDb().counter, 12);
  assert.deepEqual(reopened.getDb().futureField, { keep: true });
});

test('runtime configuration rejects invalid ports and supports explicit isolated data location', () => {
  assert.throws(() => runtimeConfig({ DIARY_PORT: 'not-a-port' }));
  const value = runtimeConfig({ DIARY_PORT: '18768', DIARY_DATA_DIR: 'var/test-only' });
  assert.equal(value.port, 18768);
  assert.equal(value.host, '127.0.0.1');
  assert.equal(value.dataDir, path.resolve('var/test-only'));
});

test('deployment retains an explicit existing library and environment overrides remain isolated', () => {
  const deployment = parseDeploymentConfig({
    mode: 'production',
    dataDir: path.resolve('tmp/production-library'),
    stateDirectory: path.resolve('tmp/production-state'),
  });
  assert.equal(runtimeConfig({}, deployment).dataDir, deployment.dataDir);
  assert.equal(
    runtimeConfig({ DIARY_DATA_DIR: 'tmp/isolated-library' }, deployment).dataDir,
    path.resolve('tmp/isolated-library'),
  );
});

test('deployment rejects ambiguous or relative locations instead of creating a blank library', () => {
  for (const value of [
    undefined,
    {},
    { mode: 'development' },
    { mode: 'production', dataDir: 'relative', stateDirectory: path.resolve('tmp/state') },
  ])
    assert.throws(() => parseDeploymentConfig(value));
});
