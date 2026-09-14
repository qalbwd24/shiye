import { test } from 'node:test';
import assert from 'node:assert/strict';

import { encryptVault, decryptVault } from '../public/shared/vault.js';

import { vaultWriter, vaultReader } from '../public/shared/vault2.js';

import { sample, fixture } from './helpers.mjs';
test('stream archive compression, sequence and authenticated header', async () => {
  const writer = await vaultWriter('test-compressed-backup-password'),
    r = await writer.record({ text: '重复内容'.repeat(10000) });
  assert.ok(r.data.length < 1000);
  const reader = await vaultReader(writer.header, 'test-compressed-backup-password');
  assert.equal((await reader(r)).text.length, 40000);
  await assert.rejects(() => reader(r));
  const wrong = await vaultReader(
    { ...writer.header, compression: 'other' },
    'test-compressed-backup-password',
  );
  await assert.rejects(() => wrong(r));
});
test('media bytes, range playback and full encrypted bundle restore', async (t) => {
  const { base, request } = await fixture(t);
  const bytes = Buffer.from('binary-test-media-0123456789');
  const m = await (
    await fetch(base + '/api/media', {
      method: 'POST',
      headers: {
        'X-Diary-Client': 'desktop',
        'Content-Type': 'video/mp4',
        'X-File-Name': encodeURIComponent('视频.mp4'),
      },
      body: bytes,
    })
  ).json();
  await request('/api/entries', 'POST', { ...sample, attachments: [m.id] });
  const range = await fetch(base + '/media/' + m.id, { headers: { Range: 'bytes=4-8' } });
  assert.equal(range.status, 206);
  assert.equal(Buffer.from(await range.arrayBuffer()).toString(), bytes.subarray(4, 9).toString());
  const bundle = await (await request('/api/bundle')).json();
  const encrypted = await encryptVault(bundle, 'testing-password-not-real-123');
  assert.equal(JSON.stringify(encrypted).includes(sample.title), false);
  const decrypted = await decryptVault(encrypted, 'testing-password-not-real-123');
  assert.deepEqual(decrypted, bundle);
  const restored = await (await request('/api/restore', 'POST', decrypted)).json();
  assert.equal(restored.entries, 0);
  assert.equal(restored.mergedEntries, 1);
  const lib = await (await request('/api/library')).json();
  assert.equal(lib.entries.length, 1);
  const newMedia = lib.entries[0].attachments[0];
  assert.deepEqual(
    Buffer.from(await (await fetch(base + '/media/' + newMedia)).arrayBuffer()),
    bytes,
  );
});
test('vault rejects wrong password and altered header/ciphertext, random salt and IV', async () => {
  const payload = { private: '仅供本地合成测试' },
    p = 'test-passphrase-12345',
    a = await encryptVault(payload, p),
    b = await encryptVault(payload, p);
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.iv, b.iv);
  await assert.rejects(() => decryptVault(a, 'wrong-password-0000'));
  await assert.rejects(() => decryptVault({ ...a, iv: b.iv }, p));
  await assert.rejects(() =>
    decryptVault({ ...a, data: (a.data[0] === 'A' ? 'B' : 'A') + a.data.slice(1) }, p),
  );
  await assert.rejects(() => encryptVault(payload, 'short'));
});
