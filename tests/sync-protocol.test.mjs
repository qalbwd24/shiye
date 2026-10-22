import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toDiarySource,
  putDiarySource,
  fetchDiarySource,
} from '../src/server/sync/legacy-webdav.mjs';

const entry = (id, extra = {}) => ({
  id,
  date: '2026-09-22T00:00:00Z',
  content: '<p>正文</p>',
  attachments: [],
  ...extra,
});

test('Android projection preserves metadata, boolean flags and unresolved media', () => {
  const payload = toDiarySource({
    entries: [
      entry('local', {
        category: '日常',
        tags: ['标签'],
        legacy: {
          original: { uuid: 'android', contentType: 1, extra: 42 },
          mediaReferences: [{ field: 'images', reference: 'missing.jpg', status: 'unresolved' }],
        },
        markdownSource: '**正文**',
      }),
    ],
    imports: [
      {
        tables: {
          _original: { custom: 9, dataVersion: 3 },
          'category.json': [
            { uuid: 'category-android', name: '日常', isDeleted: false, custom: 7 },
          ],
          'tag.json': [{ uuid: 'tag-android', name: '标签', deleted: false }],
        },
      },
    ],
  });
  const row = JSON.parse(payload.source.json)[0];
  assert.equal(row.uuid, 'android');
  assert.equal(row.content, '**正文**');
  assert.equal(row.images, 'missing.jpg');
  assert.equal(row.type, '日常');
  assert.equal(row.tag, '标签');
  assert.equal(row.deleted, false);
  assert.equal(row.isHidden, false);
  assert.equal(row.extra, 42);
  assert.equal(payload.source.custom, 9);
  assert.equal(payload.source.dataVersion, 3);
  assert.equal(JSON.parse(payload.source.catagory)[0].uuid, 'category-android');
  assert.equal(JSON.parse(payload.source.tag)[0].uuid, 'tag-android');
});

test('only referenced media uploads, with collision-free immutable names and resolved identities', () => {
  const db = {
    entries: [
      entry('left', { attachments: ['a'], legacy: { original: { uuid: 'same' } } }),
      entry('right', { attachments: ['b'], legacy: { original: { uuid: 'same' } } }),
      entry('draft', { draft: true }),
      entry('demo', { demo: true }),
    ],
    media: [
      { id: 'a', name: 'photo.jpg', sha256: 'aaa' },
      { id: 'b', name: 'photo.jpg', sha256: 'bbb' },
      { id: 'private', name: 'avatar.jpg' },
    ],
    conflicts: [
      { kind: 'entry', status: 'resolved', left: 'left', right: 'right', choice: 'both' },
    ],
  };
  const payload = toDiarySource(db);
  assert.deepEqual(
    JSON.parse(payload.source.json).map((e) => e.uuid),
    ['same', 'right'],
  );
  assert.equal(payload.mediaFiles.length, 2);
  assert.notEqual(payload.mediaFiles[0].remoteName, payload.mediaFiles[1].remoteName);
  db.conflicts[0].choice = 'right';
  assert.deepEqual(
    JSON.parse(toDiarySource(db).source.json).map((e) => e.uuid),
    ['same'],
  );
});

test('unsafe writes reject before any network request', async () => {
  const config = { url: 'http://127.0.0.1:1/', username: 'u', password: 'p' };
  await assert.rejects(putDiarySource(config, {}), /上传前必须/);
  await assert.rejects(
    putDiarySource(config, {}, { remote: { base: config.url, empty: false, etag: 'W/"v1"' } }),
    /强 ETag/,
  );
});

test('404 from a non-WebDAV endpoint is never considered an empty library', async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('not found', { status: 404 });
  t.after(() => {
    globalThis.fetch = original;
  });
  await assert.rejects(
    fetchDiarySource({ url: 'http://localhost/', username: 'u', password: 'p' }),
    /拒绝将 404/,
  );
});
