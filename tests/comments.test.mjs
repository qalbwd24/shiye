import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fixture, sample } from './helpers.mjs';
import { createBackup, restoreBackup } from '../public/shared/vault2.js';

test('self comments preserve diary body, protect revisions and survive encrypted backup', async (t) => {
  const origin = await fixture(t),
    destination = await fixture(t);
  const entry = await (await origin.request('/api/entries', 'POST', sample)).json();
  const route = '/api/entries/' + entry.id + '/comments';
  let r = await origin.request(route, 'POST', {
    body: '后来想到的事情 <script>plain</script>',
    entryRevision: entry.revision,
  });
  assert.equal(r.status, 201);
  let updated = await r.json();
  const id = updated.comments[0].id;
  assert.equal(updated.content, entry.content);
  assert.equal(updated.date, entry.date);
  assert.equal(
    (await origin.request(route, 'POST', { body: '旧窗口', entryRevision: entry.revision })).status,
    409,
  );
  assert.equal(
    (await origin.request('/api/entries/' + entry.id, 'PUT', { ...entry, title: 'stale' })).status,
    409,
  );
  updated = await (
    await origin.request('/api/entries/' + entry.id, 'PUT', {
      ...updated,
      title: '正文修改后评论仍在',
    })
  ).json();
  assert.equal(updated.comments[0].body, '后来想到的事情 <script>plain</script>');
  for (const data of [{ body: '改过的评论' }, { deleted: true }, { deleted: false }]) {
    const response = await origin.request(route + '/' + id, 'PUT', {
      ...data,
      entryRevision: updated.revision,
      revision: updated.comments[0].revision,
    });
    assert.equal(response.status, 200);
    updated = await response.json();
  }
  assert.equal(updated.comments[0].body, '改过的评论');
  assert.equal(updated.comments[0].deleted, false);
  assert.equal(updated.comments[0].revision, 4);
  assert.equal(
    updated.comments[0].createdAt,
    updated.history.at(-1)?.comments?.[0]?.createdAt ?? updated.comments[0].createdAt,
  );
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
  const backup = await createBackup(api, 'synthetic-comment-backup', () => {});
  const bytes = await fs.readFile(backup.path);
  base = destination.base;
  await restoreBackup(api, new Blob([bytes]), 'synthetic-comment-backup', () => {});
  const restored = (await api('/api/library')).entries[0];
  assert.deepEqual(restored.comments, updated.comments);
  assert.equal(restored.content, sample.content);
  assert.equal(restored.date, sample.date);
});

async function uploadImage(origin, type, bytes) {
  const response = await fetch(origin.base + '/api/media', {
    method: 'POST',
    headers: { 'X-Diary-Client': 'desktop', 'Content-Type': type },
    body: bytes,
  });
  assert.equal(response.status, 201);
  return response.json();
}

test('picture comments, authors and reply quotations preserve creation snapshots with revision checks', async (t) => {
  const origin = await fixture(t);
  const avatar = await uploadImage(origin, 'image/png', 'avatar-synthetic');
  const gif = await uploadImage(origin, 'image/gif', 'GIF89a-synthetic');
  const entry = await (await origin.request('/api/entries', 'POST', sample)).json();
  const route = '/api/entries/' + entry.id + '/comments';
  let response = await origin.request(route, 'POST', {
    entryRevision: entry.revision,
    body: '原评论'.repeat(80),
    authorName: '最初的名字',
    authorAvatarId: avatar.id,
    attachments: [gif.id, gif.id],
  });
  assert.equal(response.status, 201);
  let updated = await response.json();
  const original = structuredClone(updated.comments[0]);
  assert.deepEqual(original.attachments, [gif.id]);
  response = await origin.request(route, 'POST', {
    entryRevision: updated.revision,
    body: '',
    attachments: [gif.id],
    authorName: '现在的名字',
    replyTo: original.id,
    replyPreview: { body: '伪造摘要' },
  });
  assert.equal(response.status, 201);
  updated = await response.json();
  const replyComment = structuredClone(updated.comments[1]);
  assert.equal(replyComment.replyTo, original.id);
  assert.equal(replyComment.replyPreview.body, original.body.slice(0, 120));
  assert.equal(replyComment.replyPreview.authorName, original.authorName);
  assert.equal(replyComment.replyPreview.id, original.id);
  assert.equal(replyComment.body, '');
  assert.equal(replyComment.authorAvatarId, null);
  assert.equal(
    (
      await origin.request(route + '/' + original.id, 'PUT', {
        entryRevision: updated.revision,
        revision: 0,
        body: 'stale',
      })
    ).status,
    409,
  );
  updated = await (
    await origin.request(route + '/' + original.id, 'PUT', {
      entryRevision: updated.revision,
      revision: original.revision,
      body: '改了原评论',
      attachments: [],
      authorName: '不得覆盖',
      authorAvatarId: gif.id,
      createdAt: '1900-01-01',
      replyTo: replyComment.id,
    })
  ).json();
  const changed = updated.comments[0];
  assert.equal(changed.authorName, original.authorName);
  assert.equal(changed.authorAvatarId, original.authorAvatarId);
  assert.equal(changed.createdAt, original.createdAt);
  assert.equal(changed.replyTo, undefined);
  assert.deepEqual(updated.comments[1], replyComment);
  assert.equal(
    (
      await origin.request(route + '/' + replyComment.id, 'PUT', {
        entryRevision: updated.revision,
        revision: replyComment.revision,
        attachments: [],
      })
    ).status,
    400,
  );
  for (const deleted of [true, false]) {
    const response = await origin.request(route + '/' + original.id, 'PUT', {
      entryRevision: updated.revision,
      revision: updated.comments[0].revision,
      deleted,
    });
    assert.equal(response.status, 200);
    updated = await response.json();
    assert.equal(updated.comments[0].authorName, original.authorName);
    assert.equal(updated.comments[0].createdAt, original.createdAt);
    assert.deepEqual(updated.comments[1].replyPreview, replyComment.replyPreview);
  }
  assert.equal(updated.content, sample.content);
  assert.deepEqual(updated.attachments, []);
});

test('comment media validation rejects foreign replies, non-image files and nonexistent attachments atomically', async (t) => {
  const origin = await fixture(t);
  const video = await uploadImage(origin, 'video/mp4', 'synthetic-video');
  const one = await (await origin.request('/api/entries', 'POST', sample)).json();
  const other = await (await origin.request('/api/entries', 'POST', sample)).json();
  const foreign = await (
    await origin.request('/api/entries/' + other.id + '/comments', 'POST', {
      body: '另一篇的评论',
      entryRevision: other.revision,
    })
  ).json();
  const route = '/api/entries/' + one.id + '/comments';
  for (const fields of [
    { attachments: [video.id] },
    { authorAvatarId: video.id },
    { attachments: ['missing'] },
    { attachments: 'invalid' },
    { replyTo: foreign.comments[0].id },
    { authorName: ' ' },
  ]) {
    assert.equal(
      (
        await origin.request(route, 'POST', {
          body: 'validation',
          entryRevision: one.revision,
          ...fields,
        })
      ).status,
      400,
    );
  }
  const saved = await (
    await origin.request(route, 'POST', { body: 'parent', entryRevision: one.revision })
  ).json();
  const deleted = await (
    await origin.request(route + '/' + saved.comments[0].id, 'PUT', {
      deleted: true,
      entryRevision: saved.revision,
      revision: saved.comments[0].revision,
    })
  ).json();
  assert.equal(
    (
      await origin.request(route, 'POST', {
        body: 'reply to deleted',
        replyTo: saved.comments[0].id,
        entryRevision: deleted.revision,
      })
    ).status,
    400,
  );
  const current = (await (await origin.request('/api/library')).json()).entries.find(
    (e) => e.id === one.id,
  );
  assert.equal(current.revision, deleted.revision);
  assert.equal(current.comments.length, 1);
});

test('encrypted v1 and v2 backups retain picture replies, author snapshots and remapped historical comment media', async (t) => {
  const { encryptVault, decryptVault } = await import('../public/shared/vault.js');
  const origin = await fixture(t);
  const avatar = await uploadImage(origin, 'image/png', 'original-avatar');
  const gif = await uploadImage(origin, 'image/gif', 'GIF89a-original-comment');
  let entry = await (await origin.request('/api/entries', 'POST', sample)).json();
  const route = '/api/entries/' + entry.id + '/comments';
  entry = await (
    await origin.request(route, 'POST', {
      body: 'original comment',
      authorName: '名字快照',
      authorAvatarId: avatar.id,
      attachments: [gif.id],
      entryRevision: entry.revision,
    })
  ).json();
  entry = await (
    await origin.request(route, 'POST', {
      body: 'reply',
      authorName: '回复名字',
      attachments: [gif.id],
      replyTo: entry.comments[0].id,
      entryRevision: entry.revision,
    })
  ).json();
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
  const bundle = await api('/api/bundle');
  const encrypted = await encryptVault(bundle, 'synthetic-picture-comment-password');
  const decrypted = await decryptVault(encrypted, 'synthetic-picture-comment-password');
  const backup = await createBackup(api, 'synthetic-picture-comment-password', () => {});
  const bytes = await fs.readFile(backup.path);
  // Import into the original library must reuse already mapped comment media in its fingerprint.
  const merged = await restoreBackup(
    api,
    new Blob([bytes]),
    'synthetic-picture-comment-password',
    () => {},
  );
  assert.equal(merged.mergedEntries, 1);
  assert.equal(merged.entries, 0);
  for (const version of [1, 2]) {
    const destination = await fixture(t);
    base = destination.base;
    if (version === 1) await api('/api/restore', { method: 'POST', data: decrypted });
    else
      await restoreBackup(api, new Blob([bytes]), 'synthetic-picture-comment-password', () => {});
    const restored = (await api('/api/library')).entries[0];
    const first = restored.comments[0],
      second = restored.comments[1];
    assert.equal(first.id, entry.comments[0].id);
    assert.equal(second.replyTo, first.id);
    assert.deepEqual(second.replyPreview, entry.comments[1].replyPreview);
    assert.equal(first.authorName, entry.comments[0].authorName);
    assert.equal(first.createdAt, entry.comments[0].createdAt);
    assert.notEqual(first.authorAvatarId, avatar.id);
    assert.notEqual(first.attachments[0], gif.id);
    assert.equal(await (await fetch('/media/' + first.authorAvatarId)).text(), 'original-avatar');
    assert.equal(
      await (await fetch('/media/' + first.attachments[0])).text(),
      'GIF89a-original-comment',
    );
    assert.equal(restored.history[0].comments[0].authorAvatarId, first.authorAvatarId);
    assert.deepEqual(restored.history[0].comments[0].attachments, first.attachments);
    assert.equal(restored.content, sample.content);
  }
});
