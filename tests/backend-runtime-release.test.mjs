import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { selectedBackend } from '../src/server/runtime-release.mjs';

async function fixture() {
  const root = path.resolve('tmp/revisit-backend-index/runtime-tests', randomUUID());
  const release = path.join(root, 'outputs/backend-runtimes/synthetic');
  await fs.mkdir(path.join(root, 'config'), { recursive: true });
  await fs.mkdir(release, { recursive: true });
  const source = 'export const createDiaryServer = () => "synthetic-only";';
  await fs.writeFile(path.join(release, 'entry.mjs'), source);
  const manifest = path.join(release, 'manifest.json');
  await fs.writeFile(
    manifest,
    JSON.stringify({
      protocol: 1,
      projectRoot: root,
      entry: 'entry.mjs',
      files: [{ file: 'entry.mjs', sha256: createHash('sha256').update(source).digest('hex') }],
    }),
  );
  await fs.writeFile(
    path.join(root, 'config/backend-runtime.local.json'),
    JSON.stringify({ manifest }),
  );
  return { root, release, manifest };
}

test('no backend pointer preserves the workspace entrypoint', async () => {
  const root = path.resolve('tmp/revisit-backend-index/runtime-tests', randomUUID());
  assert.equal(await selectedBackend(root, {}), undefined);
});
test('verified backend selection loads an immutable release and rejects later tampering', async () => {
  const f = await fixture();
  assert.equal((await selectedBackend(f.root, {})).createDiaryServer(), 'synthetic-only');
  await fs.appendFile(path.join(f.release, 'entry.mjs'), '// tampered');
  await assert.rejects(selectedBackend(f.root, {}), /校验失败/);
});
test('backend pointers outside managed releases fail before importing', async () => {
  const f = await fixture();
  await assert.rejects(
    selectedBackend(f.root, { DIARY_BACKEND_MANIFEST: path.join(f.root, 'external.json') }),
    /目录不正确/,
  );
});
test('unlisted entry and cross-project release are rejected', async () => {
  for (const field of ['entry', 'projectRoot']) {
    const f = await fixture();
    const manifest = JSON.parse(await fs.readFile(f.manifest, 'utf8'));
    manifest[field] = field === 'entry' ? '../outside.mjs' : 'another-project';
    await fs.writeFile(f.manifest, JSON.stringify(manifest));
    await assert.rejects(selectedBackend(f.root, {}));
  }
});
