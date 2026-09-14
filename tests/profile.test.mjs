import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { fixture, sample } from './helpers.mjs';
import { normalizeAvatarCrop, avatarStyle } from '../public/shared/profile.js';
import { createBackup, restoreBackup } from '../public/shared/vault2.js';

const animatedGif = Buffer.from(
  '47494638396101000100800000000000ffffff21ff0b4e45545343415045322e30030100000021f90400050000002c000000000100010000020244010021f90400050000002c00000000010001000002024c01003b',
  'hex',
);
async function upload(base, bytes = animatedGif, type = 'image/gif') {
  const response = await fetch(base + '/api/media', {
    method: 'POST',
    headers: {
      'X-Diary-Client': 'desktop',
      'Content-Type': type,
      'X-File-Name': encodeURIComponent('合成头像.gif'),
    },
    body: bytes,
  });
  assert.equal(response.status, 201);
  return response.json();
}
test('avatar crop is validated and CSS always contains finite safe numeric values', () => {
  assert.deepEqual(normalizeAvatarCrop(), { x: 50, y: 50, zoom: 1 });
  assert.match(
    avatarStyle({ x: 0, y: 100, zoom: 3 }),
    /object-position:0% 100%;transform:scale\(3\)/,
  );
  for (const value of [
    null,
    [],
    { x: -1 },
    { y: 101 },
    { zoom: 0.9 },
    { zoom: 3.1 },
    { x: '50' },
    { zoom: Infinity },
    { extra: true },
  ])
    assert.throws(() => normalizeAvatarCrop(value));
  assert.equal(avatarStyle({ x: '0;display:none' }), avatarStyle());
});
test('profile saves independently, supports display crop without changing GIF bytes and preserves comment snapshots', async (t) => {
  const { base, request } = await fixture(t);
  const avatar = await upload(base);
  const profile = {
    authorName: '最初的名字',
    motto: '保留每一天 🌱',
    authorAvatarId: avatar.id,
    authorAvatarCrop: { x: 25, y: 70, zoom: 1.5 },
  };
  let response = await request('/api/preferences', 'PUT', { theme: 'dark', profile });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).profile, profile);
  const entry = await (await request('/api/entries', 'POST', sample)).json();
  response = await request('/api/entries/' + entry.id + '/comments', 'POST', {
    entryRevision: entry.revision,
    body: '个人资料快照测试',
  });
  assert.equal(response.status, 201);
  const updated = await response.json(),
    comment = updated.comments[0];
  assert.equal(comment.authorName, profile.authorName);
  assert.equal(comment.authorAvatarId, avatar.id);
  assert.deepEqual(comment.authorAvatarCrop, profile.authorAvatarCrop);
  response = await request('/api/preferences', 'PUT', {
    profile: {
      authorName: '后来的名字',
      authorAvatarId: null,
      authorAvatarCrop: { x: 50, y: 50, zoom: 1 },
    },
  });
  assert.equal(response.status, 200);
  const settings = await response.json();
  assert.equal(settings.theme, 'dark');
  assert.equal(settings.profile.motto, profile.motto);
  assert.equal(settings.profile.authorAvatarId, null);
  const library = await (await request('/api/library')).json();
  assert.deepEqual(library.entries.find((e) => e.id === entry.id).comments, [comment]);
  assert.equal(library.entries.find((e) => e.id === entry.id).revision, updated.revision);
  assert.deepEqual(
    Buffer.from(await (await request('/media/' + avatar.id)).arrayBuffer()),
    animatedGif,
  );
});
test('invalid profile updates are atomic and avatar must reference an existing image', async (t) => {
  const { base, request } = await fixture(t);
  const audio = await upload(base, Buffer.from('synthetic-audio'), 'audio/wav');
  assert.equal(
    (await request('/api/preferences', 'PUT', { fontSize: 20, profile: {} })).status,
    200,
  );
  const original = (await (await request('/api/library')).json()).settings.preferences;
  assert.equal(original.profile.authorName, '我');
  assert.equal(original.profile.motto, '把日子，收藏起来');
  for (const profile of [
    [],
    { authorName: '' },
    { authorName: 'a'.repeat(81) },
    { motto: 'x'.repeat(201) },
    { motto: 123 },
    { authorAvatarId: audio.id },
    { authorAvatarId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
    { authorAvatarId: '../secret' },
    { authorAvatarCrop: { zoom: 10 } },
    { unknown: true },
  ]) {
    assert.equal((await request('/api/preferences', 'PUT', { fontSize: 14, profile })).status, 400);
    assert.deepEqual((await (await request('/api/library')).json()).settings.preferences, original);
  }
});
test('default encrypted restore retains destination personal profile', async (t) => {
  const source = await fixture(t),
    destination = await fixture(t);
  const avatar = await upload(source.base);
  await source.request('/api/preferences', 'PUT', {
    profile: { authorName: '来源用户', authorAvatarId: avatar.id },
  });
  await source.request('/api/entries', 'POST', sample);
  const destinationProfile = {
    authorName: '当前用户',
    motto: '此处资料保持',
    authorAvatarId: null,
    authorAvatarCrop: { x: 50, y: 50, zoom: 1 },
  };
  await destination.request('/api/preferences', 'PUT', { profile: destinationProfile });
  let base = source.base;
  const nativeFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (input, options) =>
    nativeFetch(typeof input === 'string' ? new URL(input, base) : input, options),
  );
  const api = async (url, { method = 'GET', data, raw, headers = {} } = {}) => {
    const response = await fetch(base + url, {
      method,
      headers: {
        'X-Diary-Client': 'desktop',
        ...(data ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: raw ?? (data ? JSON.stringify(data) : undefined),
    });
    const result = await response.json();
    assert.ok(response.ok, result.error);
    return result;
  };
  const backup = await createBackup(api, 'synthetic-profile-backup', () => {});
  const bytes = await fs.readFile(backup.path);
  base = destination.base;
  await restoreBackup(api, new Blob([bytes]), 'synthetic-profile-backup', () => {});
  assert.deepEqual((await api('/api/library')).settings.preferences.profile, destinationProfile);
});
