import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { parseSyncServerArguments, startSyncServerCli } from '../tools/sync-server.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
async function directory() {
  const root = path.join(ROOT, 'tmp', 'sync-backend');
  await mkdir(root, { recursive: true });
  return mkdtemp(path.join(root, 'client-cli-'));
}
async function running(t, args = []) {
  const dataDir = await directory(),
    logs = [];
  const options = parseSyncServerArguments(['--data-dir', dataDir, '--port', '0', ...args]);
  const started = await startSyncServerCli(options, { log: (record) => logs.push(record) });
  t.after(() => started.stop());
  return { ...started, dataDir, logs };
}

test('CLI defaults remain inside workspace and validate network/configuration arguments', () => {
  const defaults = parseSyncServerArguments([]);
  assert.equal(defaults.host, '127.0.0.1');
  assert.equal(defaults.port, 18769);
  assert.equal(defaults.dataDir, path.join(ROOT, 'var', 'sync-lab'));
  const options = parseSyncServerArguments([
    '--host',
    '0.0.0.0',
    '--port',
    '18769',
    '--data-dir',
    'tmp/synthetic',
    '--base-path',
    '/reverse/sync/',
    '--public-origin',
    'https://cloud.invalid',
    '--allowed-host',
    '100.64.0.1',
    '--allowed-host',
    'cloud.invalid',
  ]);
  assert.equal(options.dataDir, path.join(ROOT, 'tmp', 'synthetic'));
  assert.equal(options.publicOrigin, 'https://cloud.invalid');
  assert.deepEqual(options.allowedHosts, ['100.64.0.1', 'cloud.invalid']);
  for (const args of [
    ['--port', '-1'],
    ['--port', '65536'],
    ['--port', 'abc'],
    ['--host', 'host/password'],
    ['--data-dir', 'diary.json'],
    ['--data-dir', '\u0000bad'],
    ['--base-path', '/prefix'],
    ['--base-path', '/../'],
    ['--public-origin', 'http://cloud.invalid'],
    ['--public-origin', 'https://user:secret@cloud.invalid'],
    ['--public-origin', 'https://cloud.invalid/?token=secret'],
    ['--allowed-host', 'cloud.invalid:443'],
    ['--allowed-host', 'cloud.invalid/path'],
    ['--port'],
    ['--port', '1', '--port', '2'],
    ['--unknown', 'secret'],
  ])
    assert.throws(() => parseSyncServerArguments(args));
});

test('CLI starts real isolated health, writes secret-free runtime, and marks graceful stop', async (t) => {
  const started = await running(t, ['--base-path', '/lab/']);
  const response = await fetch(`http://127.0.0.1:${started.runtime.port}/lab/api/sync/v1/health`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).isolated, true);
  const runtimePath = path.join(started.dataDir, 'runtime.json');
  let runtime = JSON.parse(await readFile(runtimePath, 'utf8'));
  assert.equal(runtime.service, 'shiye-sync');
  assert.equal(runtime.protocol, 1);
  assert.equal(runtime.state, 'running');
  assert.equal(runtime.pid, process.pid);
  assert.equal(runtime.basePath, '/lab/');
  assert.equal(runtime.port > 0, true);
  assert.deepEqual(runtime.addresses, [`http://127.0.0.1:${runtime.port}/lab/`]);
  const output = JSON.stringify({ runtime, logs: started.logs });
  assert.equal(/token|password|pairing|code"|pin"/iu.test(output), false);
  assert.equal(started.service.auth.listDevices().length, 0);
  await started.stop();
  await started.stop();
  runtime = JSON.parse(await readFile(runtimePath, 'utf8'));
  assert.equal(runtime.state, 'stopped');
  assert.equal(typeof runtime.stoppedAt, 'string');
  await assert.rejects(stat(path.join(started.dataDir, 'sync-server.lock')), { code: 'ENOENT' });
});

test('CLI refuses diary directories, descendants, files, project root and disk root before creating databases', async () => {
  const diary = await directory();
  await writeFile(path.join(diary, 'diary.json'), '{}');
  const file = path.join(await directory(), 'existing-file');
  await writeFile(file, 'synthetic');
  for (const dataDir of [diary, path.join(diary, 'nested'), file, ROOT, path.parse(ROOT).root]) {
    await assert.rejects(
      startSyncServerCli(parseSyncServerArguments(['--data-dir', dataDir, '--port', '0']), {
        log: () => {},
      }),
    );
  }
  await assert.rejects(stat(path.join(diary, 'sync.sqlite')), { code: 'ENOENT' });
  assert.equal(await readFile(path.join(diary, 'diary.json'), 'utf8'), '{}');
});

test('CLI refuses a second writer without stopping or altering the first service', async (t) => {
  const first = await running(t);
  await assert.rejects(
    startSyncServerCli(parseSyncServerArguments(['--data-dir', first.dataDir, '--port', '0']), {
      log: () => {},
    }),
    /SYNC_DIRECTORY_ALREADY_LOCKED/u,
  );
  const otherDir = await directory();
  await assert.rejects(
    startSyncServerCli(
      parseSyncServerArguments(['--data-dir', otherDir, '--port', String(first.runtime.port)]),
      { log: () => {} },
    ),
    { code: 'EADDRINUSE' },
  );
  assert.equal(
    (await fetch(`http://127.0.0.1:${first.runtime.port}/api/sync/v1/health`)).status,
    200,
  );
  assert.equal(
    JSON.parse(await readFile(path.join(first.dataDir, 'runtime.json'), 'utf8')).state,
    'running',
  );
  await assert.rejects(stat(path.join(otherDir, 'sync-server.lock')), { code: 'ENOENT' });
});

test('CLI public HTTPS configuration disables local pairing and keeps credentials out of metadata', async (t) => {
  const started = await running(t, [
    '--host',
    '0.0.0.0',
    '--public-origin',
    'https://cloud.invalid',
    '--allowed-host',
    'cloud.invalid',
  ]);
  const response = await fetch(
    `http://127.0.0.1:${started.runtime.port}/api/sync/v1/local-pairing`,
    { method: 'POST', headers: { 'X-Sync-Client': 'local-admin' } },
  );
  assert.equal(response.status, 403);
  assert.equal(started.runtime.addresses.includes('https://cloud.invalid/'), true);
});

test('CLI executable help does not start a service or print credentials', async () => {
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'tools', 'sync-server.mjs'), '--help'], {
      cwd: ROOT,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '',
      stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
  assert.equal(result.code, 0);
  assert.ok(result.stdout.includes('--data-dir'));
  assert.equal(/token|password|pairing|pin/iu.test(result.stdout), false);
  assert.equal(result.stderr, '');
});
