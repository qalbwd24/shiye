import test from 'node:test';
import assert from 'node:assert/strict';
import { renameLibraryFile } from '../src/server/storage/library-commit.mjs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createLibraryStore } from '../src/server/storage/library-store.mjs';
test('transient Windows sharing failure retries the same atomic rename with a strict bound', async () => {
  const calls = [],
    waits = [];
  await renameLibraryFile('library.json.tmp', 'library.json', {
    platform: 'win32',
    rename: async (...args) => {
      calls.push(args);
      if (calls.length < 3) throw Object.assign(new Error('scanner busy'), { code: 'EPERM' });
    },
    wait: async (value) => waits.push(value),
  });
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0], calls[1]);
  assert.deepEqual(waits, [20, 60]);
  let rejected = 0;
  await assert.rejects(
    renameLibraryFile('a.tmp', 'a', {
      platform: 'win32',
      rename: async () => {
        rejected++;
        throw Object.assign(new Error('locked'), { code: 'EACCES' });
      },
      wait: async () => {},
    }),
    { code: 'EACCES' },
  );
  assert.equal(rejected, 4);
});
test('disk-full, missing-file and non-Windows failures are returned without retry or fallback', async () => {
  for (const [platform, code] of [
    ['win32', 'ENOSPC'],
    ['win32', 'ENOENT'],
    ['linux', 'EPERM'],
  ]) {
    let calls = 0;
    await assert.rejects(
      renameLibraryFile('a.tmp', 'a', {
        platform,
        rename: async () => {
          calls++;
          throw Object.assign(new Error(code), { code });
        },
        wait: async () => assert.fail('unexpected wait'),
      }),
      { code },
    );
    assert.equal(calls, 1);
  }
});
test('a failed atomic commit acknowledges nothing and keeps business plus shared index at the old generation', async () => {
  const dataDir = path.resolve('tmp/library-commit-tests', randomUUID());
  const store = await createLibraryStore({ dataDir, seed: false, sharedSync: true }),
    before = await fs.readFile(path.join(dataDir, 'diary.json'), 'utf8'),
    memory = JSON.stringify(store.getDb());
  const realRename = fs.rename;
  let mutations = 0;
  fs.rename = async () => {
    throw Object.assign(new Error('destination locked'), { code: 'EPERM' });
  };
  try {
    await assert.rejects(
      store.mutate((db) => {
        mutations++;
        db.entries.push({ id: 'failed-entry', title: 'not-committed' });
      }),
      { code: 'EPERM' },
    );
  } finally {
    fs.rename = realRename;
  }
  assert.equal(mutations, 1);
  assert.equal(JSON.stringify(store.getDb()), memory);
  assert.equal(await fs.readFile(path.join(dataDir, 'diary.json'), 'utf8'), before);
  await store.mutate((db) => {
    db.entries.push({ id: 'success-entry', title: 'committed' });
  });
  assert.equal(store.getDb().entries.length, 1);
  assert.equal(store.getDb().entries[0].id, 'success-entry');
});
