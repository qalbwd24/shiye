import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import { spawn } from 'node:child_process';

const manifest = process.env.SHIYE_SOURCE_COLLECTION_TEST_MANIFEST;
test(
  'stable launcher forwards explicit source collection configuration to verified runtime',
  { skip: !manifest },
  async (t) => {
    const root = path.resolve('tmp/source-collection-launcher-tests');
    await mkdir(root, { recursive: true });
    const area = await mkdtemp(path.join(root, 'case-')),
      dataDir = path.join(area, 'data'),
      exportsDir = path.join(area, 'exports');
    await mkdir(dataDir);
    await mkdir(exportsDir);
    await writeFile(
      path.join(dataDir, 'diary.json'),
      JSON.stringify({ schema: 1, entries: [], media: [], imports: [] }),
    );
    const config = path.join(area, 'shared.json');
    await writeFile(config, JSON.stringify({ enabled: true, sourceCollection: { exportsDir } }));
    const listener = net.createServer();
    listener.listen(0, '127.0.0.1');
    await once(listener, 'listening');
    const port = listener.address().port;
    await new Promise((resolve) => listener.close(resolve));
    const child = spawn(process.execPath, ['server.mjs'], {
      cwd: path.resolve('.'),
      windowsHide: true,
      env: {
        ...process.env,
        DIARY_PORT: String(port),
        DIARY_DATA_DIR: dataDir,
        DIARY_SHARED_CONFIG: config,
        DIARY_BACKEND_MANIFEST: path.resolve(manifest),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (bytes) => {
      stderr = (stderr + bytes).slice(-4000);
    });
    t.after(async () => {
      if (child.exitCode === null) {
        const exited = once(child, 'exit');
        child.kill('SIGTERM');
        await exited;
      }
    });
    await Promise.race([
      new Promise((resolve, reject) => {
        child.stdout.on('data', (bytes) => {
          if (String(bytes).includes('Diary desktop:')) resolve();
        });
        child.once('exit', () => reject(Error('synthetic launcher exited: ' + stderr)));
      }),
      new Promise((_, reject) => {
        const timer = setTimeout(() => reject(Error('synthetic launcher startup deadline')), 15000);
        timer.unref();
      }),
    ]);
    const response = await fetch(`http://127.0.0.1:${port}/api/source-collection/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Diary-Client': 'desktop',
        Connection: 'close',
      },
      body: '{}',
    });
    assert.equal(response.status, 400);
    const value = await response.json();
    assert.equal(value.code || value.error, 'SOURCE_COLLECTION_INVALID');
  },
);
