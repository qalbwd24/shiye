import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDiaryServer } from '../server.mjs';
import { createBackup, restoreBackup } from '../public/shared/vault2.js';
test('compressed encrypted archive restores multiple chunks; truncated archive commits nothing', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'diary-vault2-test-')),
    server = await createDiaryServer({ dataDir: dir, seed: false });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port,
    native = globalThis.fetch;
  t.after(async () => {
    globalThis.fetch = native;
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    const target = path.resolve(dir);
    assert.ok(
      target.startsWith(path.resolve(os.tmpdir()) + path.sep) &&
        path.basename(target).startsWith('diary-vault2-test-'),
    );
    await fs.rm(target, { recursive: true, force: true });
  });
  globalThis.fetch = (url, opt) => native(new URL(url, base), opt);
  const api = async (p, { method = 'GET', data, raw, headers = {} } = {}) => {
    const r = await fetch(p, {
      method,
      headers: {
        'X-Diary-Client': 'desktop',
        ...(data ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: raw ?? (data ? JSON.stringify(data) : undefined),
    });
    const v = await r.json();
    if (!r.ok) throw Error(v.error);
    return v;
  };
  const bytes = Buffer.alloc(5 * 1024 * 1024, 123),
    media = await api('/api/media', {
      method: 'POST',
      raw: bytes,
      headers: { 'Content-Type': 'video/mp4' },
    }),
    entry = await api('/api/entries', {
      method: 'POST',
      data: {
        title: '分块测试',
        content: '<p>完整内容</p>',
        date: '2020-02-29T12:00:00Z',
        tags: ['旧标签'],
        category: '归档',
        attachments: [media.id],
      },
    });
  await api('/api/entries/' + entry.id, { method: 'PUT', data: { ...entry, title: '新标题' } });
  const saved = await createBackup(api, 'synthetic-test-backup-123', () => {}),
    raw = await fs.readFile(saved.path),
    result = await restoreBackup(api, new Blob([raw]), 'synthetic-test-backup-123', () => {});
  assert.equal(result.entries, 1);
  const db = await api('/api/library'),
    restored = db.entries.find((e) => e.id !== entry.id);
  assert.equal(restored.title, '新标题');
  assert.equal(restored.history[0].title, '分块测试');
  assert.equal(restored.history[0].attachments[0], restored.attachments[0]);
  assert.deepEqual(
    Buffer.from(await (await fetch('/media/' + restored.attachments[0])).arrayBuffer()),
    bytes,
  );
  const records = raw.toString().trim().split('\n');
  await assert.rejects(
    () =>
      restoreBackup(
        api,
        new Blob([records.slice(0, -1).join('\n') + '\n']),
        'synthetic-test-backup-123',
        () => {},
      ),
    /截断/,
  );
  assert.equal((await api('/api/library')).entries.length, 2);
  assert.equal((await fs.readdir(path.join(dir, 'restore-staging'))).length, 0);
  await assert.rejects(() =>
    restoreBackup(api, new Blob([raw]), 'incorrect-password-123', () => {}),
  );
  assert.equal((await api('/api/library')).entries.length, 2);
});
