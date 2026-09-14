import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fixture, sample } from './helpers.mjs';
import { encryptVault, decryptVault } from '../public/shared/vault.js';
import { createBackup, restoreBackup } from '../public/shared/vault2.js';
import { prepareStickers, reconcileStickers } from '../src/server/domain/stickers.mjs';

// Two synthetic 1x1 GIF frames; never derived from user media.
const animatedGif = Buffer.from(
  '47494638396101000100800000000000ffffff21ff0b4e45545343415045322e30030100000021f904000a0000002c000000000100010000020244010021f904000a0000002c00000000010001000002024c01003b',
  'hex',
);
async function upload(origin, bytes = animatedGif, type = 'image/gif') {
  const response = await fetch(origin.base + '/api/media', {
    method: 'POST',
    headers: {
      'X-Diary-Client': 'desktop',
      'Content-Type': type,
      'X-File-Name': encodeURIComponent('动画表情.gif'),
    },
    body: bytes,
  });
  assert.equal(response.status, 201);
  return response.json();
}

test('sticker collection validates image media, deduplicates, edits groups and restores without deleting GIF bytes', async (t) => {
  const origin = await fixture(t),
    media = await upload(origin);
  let response = await origin.request('/api/stickers', 'POST', {
    mediaId: media.id,
    name: '动起来',
    group: '开心',
  });
  assert.equal(response.status, 201);
  const first = await response.json();
  assert.equal(first.name, '动起来');
  assert.equal(first.group, '开心');
  const duplicate = await (
    await origin.request('/api/stickers', 'POST', {
      mediaId: media.id,
      name: '不能覆盖原收藏',
      group: '另一组',
    })
  ).json();
  assert.deepEqual(duplicate, first);
  assert.equal((await (await origin.request('/api/stickers')).json()).length, 1);
  let changed = await (
    await origin.request('/api/stickers/' + first.id, 'PUT', {
      name: '轻轻摇',
      group: '日常',
      deleted: true,
    })
  ).json();
  assert.equal(changed.deleted, true);
  assert.equal(changed.createdAt, first.createdAt);
  assert.equal(changed.mediaId, first.mediaId);
  changed = await (await origin.request('/api/stickers', 'POST', { mediaId: media.id })).json();
  assert.equal(changed.id, first.id);
  assert.equal(changed.deleted, false);
  assert.equal(changed.name, '轻轻摇');
  assert.equal(changed.group, '日常');
  const video = await upload(origin, Buffer.from('video-only'), 'video/mp4');
  for (const data of [
    { mediaId: video.id },
    { mediaId: 'missing' },
    { mediaId: media.id, name: '' },
    { mediaId: media.id, group: ' '.repeat(3) },
  ])
    assert.equal((await origin.request('/api/stickers', 'POST', data)).status, 400);
  assert.equal(
    (await origin.request('/api/stickers/' + first.id, 'PUT', { deleted: 'yes' })).status,
    400,
  );
  assert.deepEqual(await fs.readFile(path.join(origin.dir, 'media', media.id)), animatedGif);
  const db = await (await origin.request('/api/library')).json();
  assert.equal(db.stickers.length, 1);
  assert.equal(db.media.length, 2);
});

test('restored sticker identity follows deduplicated media while conflicting unknown metadata remains recoverable', () => {
  const media = [{ id: 'source', type: 'image/gif' }],
    fail = (status, text) => Object.assign(Error(text), { status });
  const incoming = prepareStickers(
    [
      {
        id: 'sticker-source',
        name: 'incoming',
        group: 'group',
        mediaId: 'source',
        future: { newValue: 2 },
        additional: 'preserved',
        deleted: true,
      },
    ],
    media,
    new Map([['source', 'temporary']]),
    fail,
  );
  const db = {
    stickers: [
      {
        id: 'existing',
        name: 'existing',
        group: 'group',
        mediaId: 'final',
        future: { oldValue: 1 },
        deleted: false,
      },
    ],
  };
  reconcileStickers(db, incoming, new Map([['temporary', 'final']]));
  assert.equal(db.stickers.length, 1);
  assert.equal(db.stickers[0].id, 'existing');
  assert.equal(db.stickers[0].name, 'existing');
  assert.equal(db.stickers[0].deleted, false);
  assert.equal(db.stickers[0].additional, 'preserved');
  assert.deepEqual(db.stickers[0].future, { oldValue: 1 });
  assert.deepEqual(db.stickers[0].importedVersions[0].future, { newValue: 2 });
  assert.equal(db.stickers[0].importedVersions[0].mediaId, 'final');
  reconcileStickers(db, incoming, new Map([['temporary', 'final']]));
  assert.equal(db.stickers[0].importedVersions.length, 1);
  assert.throws(
    () =>
      prepareStickers(
        [{ id: 'bad', name: 'bad', group: 'x', mediaId: 'missing' }],
        media,
        new Map(),
        fail,
      ),
    { status: 400 },
  );
});

test('v1/v2 encrypted backups preserve sticker GIFs, soft deletion and optional profile avatar mapping without duplicate collections', async (t) => {
  const origin = await fixture(t),
    m = await upload(origin);
  const sticker = await (
    await origin.request('/api/stickers', 'POST', {
      mediaId: m.id,
      name: '动画收藏',
      group: '合成组',
    })
  ).json();
  await origin.request('/api/stickers/' + sticker.id, 'PUT', { deleted: true });
  const native = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = native;
  });
  let base = origin.base;
  globalThis.fetch = (url, options) => native(new URL(url, base), options);
  const api = async (p, { method = 'GET', data, raw, headers = {} } = {}) => {
    const response = await fetch(p, {
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
  const profile = {
    authorName: '备份身份',
    authorAvatarId: m.id,
    authorAvatarCrop: { x: 20, y: 80, zoom: 2 },
    futureProfile: 'kept',
  };
  // Add future fields to an isolated backup, not to any running or real diary file.
  const diary = await api('/api/entries', { method: 'POST', data: sample });
  await api('/api/entries/' + diary.id + '/comments', {
    method: 'POST',
    data: {
      body: '动态头像裁剪快照',
      entryRevision: diary.revision,
      authorAvatarId: m.id,
      authorAvatarCrop: profile.authorAvatarCrop,
    },
  });
  const bundle = await api('/api/bundle');
  bundle.library.settings.preferences ||= {};
  bundle.library.settings.preferences.profile = profile;
  bundle.library.stickers[0].futureCollection = { marker: 'retained' };
  const encrypted = await encryptVault(bundle, 'synthetic-sticker-backup-password');
  const restoredBundle = await decryptVault(encrypted, 'synthetic-sticker-backup-password');
  for (const version of [1, 2]) {
    const destination = await fixture(t);
    assert.equal(
      (
        await destination.request('/api/preferences', 'PUT', {
          profile: { authorName: '当前身份', motto: '本机' },
        })
      ).status,
      200,
    );
    base = destination.base;
    if (version === 1) await api('/api/restore', { method: 'POST', data: restoredBundle });
    else {
      // Produce a genuine encrypted v2 file from a temporary source restored from the v1 bundle.
      const intermediate = await fixture(t);
      base = intermediate.base;
      await api('/api/restore', {
        method: 'POST',
        data: { ...restoredBundle, restoreProfile: true },
      });
      const backup = await createBackup(api, 'synthetic-sticker-backup-password', () => {});
      const raw = await fs.readFile(backup.path);
      base = destination.base;
      await restoreBackup(api, new Blob([raw]), 'synthetic-sticker-backup-password', () => {});
      let db = await api('/api/library');
      assert.equal(db.settings.preferences.profile.authorName, '当前身份');
      assert.equal(db.settings.preferences.profile.motto, '本机');
      await restoreBackup(api, new Blob([raw]), 'synthetic-sticker-backup-password', () => {}, {
        restoreAppearance: true,
      });
    }
    let db = await api('/api/library');
    if (version === 1) {
      assert.equal(db.settings.preferences.profile.authorName, '当前身份');
      assert.equal(db.settings.preferences.profile.motto, '本机');
      await api('/api/restore', {
        method: 'POST',
        data: { ...restoredBundle, restoreAppearance: true },
      });
      db = await api('/api/library');
    }
    assert.equal(db.stickers.length, 1);
    const item = db.stickers[0];
    assert.notEqual(item.id, sticker.id);
    assert.notEqual(item.mediaId, m.id);
    assert.equal(item.deleted, true);
    assert.deepEqual(item.futureCollection, { marker: 'retained' });
    assert.equal(db.media.length, 1);
    assert.equal(db.settings.preferences.profile.authorAvatarId, item.mediaId);
    assert.deepEqual(db.settings.preferences.profile.authorAvatarCrop, profile.authorAvatarCrop);
    assert.equal(db.settings.preferences.profile.futureProfile, 'kept');
    assert.deepEqual(db.entries[0].comments[0].authorAvatarCrop, profile.authorAvatarCrop);
    assert.equal(db.entries[0].comments[0].authorAvatarId, item.mediaId);
    assert.deepEqual(
      Buffer.from(await (await fetch('/media/' + item.mediaId)).arrayBuffer()),
      animatedGif,
    );
  }
});

test('comment avatar display crop is validated and snapshotted without changing animation bytes on later edits', async (t) => {
  const origin = await fixture(t),
    media = await upload(origin);
  let entry = await (await origin.request('/api/entries', 'POST', sample)).json();
  const route = '/api/entries/' + entry.id + '/comments';
  const crop = { x: 10, y: 85, zoom: 2.5 };
  let response = await origin.request(route, 'POST', {
    body: '裁剪头像快照',
    authorAvatarId: media.id,
    authorAvatarCrop: crop,
    entryRevision: entry.revision,
  });
  assert.equal(response.status, 201);
  entry = await response.json();
  const comment = entry.comments[0];
  assert.deepEqual(comment.authorAvatarCrop, crop);
  entry = await (
    await origin.request(route + '/' + comment.id, 'PUT', {
      body: '改文字',
      entryRevision: entry.revision,
      revision: comment.revision,
      authorAvatarCrop: { x: 50, y: 50, zoom: 1 },
    })
  ).json();
  assert.deepEqual(entry.comments[0].authorAvatarCrop, crop);
  for (const invalid of [
    { x: -1, y: 50, zoom: 1 },
    { x: 50, y: 101, zoom: 1 },
    { x: 50, y: 50, zoom: 4 },
    { x: '50', y: 50, zoom: 1 },
  ])
    assert.equal(
      (
        await origin.request(route, 'POST', {
          body: 'bad',
          authorAvatarCrop: invalid,
          entryRevision: entry.revision,
        })
      ).status,
      400,
    );
  assert.deepEqual(await fs.readFile(path.join(origin.dir, 'media', media.id)), animatedGif);
});
