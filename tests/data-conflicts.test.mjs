import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileImport, remapEntryMedia } from '../src/server/domain/import-reconciliation.mjs';
import { createRoutes } from '../src/server/routes/conflicts.mjs';
import { fixture, sample } from './helpers.mjs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const diary = (id, attachments = []) => ({ ...sample, id, revision: 1, history: [], attachments });
const media = (id, sha256 = id) => ({ id, name: 'image.png', type: 'image/png', size: 3, sha256 });

test('same filenames and titles preserve unrelated content without inventing version conflicts', () => {
  const db = { entries: [diary('a')], media: [media('old')], conflicts: [] };
  const next = { ...diary('b', ['new']), content: '<p>different</p>' };
  const { report } = reconcileImport(db, { entries: [next], media: [media('new')] });
  assert.equal(report.conflicts, 0);
  assert.equal(db.entries.length, 2);
  assert.equal(db.media.length, 2);
  const changed = { ...diary('c'), restoredFrom: { id: 'a' }, content: '<p>changed version</p>' };
  reconcileImport(db, { entries: [changed] });
  assert.equal(db.conflicts.length, 1);
  assert.equal(db.conflicts[0].reason, 'same-identifier');
});

test('dedup remaps inline and historical references but never schedules a prior registered file for deletion', () => {
  const old = media('old', 'same');
  const db = { entries: [], media: [old], conflicts: [] };
  let result = reconcileImport(db, { media: [old] });
  assert.deepEqual(result.report.redundantMedia, []);
  const entry = {
    ...diary('entry', ['new']),
    content: '<img src="/media/new">',
    markdownHtml: '<img src="/media/new">',
    history: [
      {
        ...diary('entry', ['new']),
        content: '<img src="/media/new?original=1">',
        legacy: { mediaReferences: [{ mediaId: 'new' }] },
      },
    ],
  };
  result = reconcileImport(db, { media: [media('new', 'same')], entries: [entry] });
  assert.deepEqual(result.report.redundantMedia, ['new']);
  assert.equal(db.entries[0].content, '<img src="/media/old">');
  assert.deepEqual(db.entries[0].history[0].attachments, ['old']);
  assert.equal(db.entries[0].history[0].content, '<img src="/media/old?original=1">');
  assert.equal(db.entries[0].history[0].legacy.mediaReferences[0].mediaId, 'old');
  assert.equal(remapEntryMedia(entry, new Map([['ne', 'other']])).content, entry.content);
});

function conflictFixture() {
  let db = {
    entries: [diary('one', ['right']), diary('two', ['right']), diary('both', ['left', 'right'])],
    media: [media('left'), media('right')],
    conflicts: [
      {
        id: 'abc',
        kind: 'media',
        left: 'left',
        right: 'right',
        reason: 'same-name',
        status: 'open',
      },
    ],
  };
  db.entries[0].content = '<img src="/media/right">';
  const route = createRoutes({
    mutate: async (fn) => {
      const copy = structuredClone(db);
      const result = await fn(copy);
      db = copy;
      return result;
    },
    body: async (req) => JSON.stringify(req.data),
    reply: () => true,
    fail: (status, message) => Object.assign(Error(message), { status }),
  });
  return {
    get db() {
      return db;
    },
    call: (data) => route({ method: 'PUT', data }, {}, '/api/conflicts/abc'),
  };
}

test('media conflict choices require explicit fresh scope and cannot collapse distinct attachments', async () => {
  const f = conflictFixture(),
    before = structuredClone(f.db);
  await assert.rejects(f.call({ choice: 'left' }), { status: 400 });
  await assert.rejects(f.call({ choice: 'left', targets: [{ id: 'one', revision: 0 }] }), {
    status: 409,
  });
  await assert.rejects(
    f.call({
      choice: 'left',
      targets: [
        { id: 'one', revision: 1 },
        { id: 'both', revision: 1 },
      ],
    }),
    { status: 409 },
  );
  assert.deepEqual(f.db, before);
  await f.call({ choice: 'left', targets: [{ id: 'one', revision: 1 }] });
  assert.deepEqual(f.db.entries[0].attachments, ['left']);
  assert.equal(f.db.entries[0].content, '<img src="/media/left">');
  assert.equal(f.db.entries[0].history[0].content, '<img src="/media/right">');
  assert.deepEqual(f.db.entries.slice(1), before.entries.slice(1));
  assert.deepEqual(f.db.media, before.media);
  assert.equal(f.db.conflicts[0].actions[0].targets.length, 1);
  await f.call({ choice: 'undo', targets: [{ id: 'one', revision: 2 }] });
  assert.deepEqual(f.db.entries[0].attachments, ['right']);
  assert.equal(f.db.entries[0].content, before.entries[0].content);
  assert.equal(f.db.entries[0].revision, 3);
  assert.equal(f.db.conflicts[0].status, 'open');
});

test('undo refuses to overwrite later diary edits', async () => {
  const f = conflictFixture();
  await f.call({ choice: 'left', targets: [{ id: 'one', revision: 1 }] });
  f.db.entries[0].revision = 3;
  f.db.entries[0].content = 'later edit';
  await assert.rejects(f.call({ choice: 'undo', targets: [{ id: 'one', revision: 3 }] }), {
    status: 409,
  });
  assert.equal(f.db.entries[0].content, 'later edit');
});

test('uploads retain exact bytes and file times, while duplicate uploads preserve the original record', async (t) => {
  const { base, request, dir } = await fixture(t);
  const bytes = Buffer.from([0, 255, 3, 128, 0, 10]);
  const upload = async (data, modified) =>
    (
      await fetch(base + '/api/media', {
        method: 'POST',
        headers: {
          'X-Diary-Client': 'desktop',
          'Content-Type': 'image/png',
          'X-File-Name': 'image.png',
          'X-File-Last-Modified': modified,
        },
        body: data,
      })
    ).json();
  const one = await upload(bytes, '1700000000123');
  assert.equal(one.lastModified, 1700000000123);
  assert.ok(Number.isFinite(Date.parse(one.importedAt)));
  await request('/api/entries', 'POST', { ...sample, attachments: [one.id] });
  const same = await upload(bytes, '1800000000000');
  assert.deepEqual(same, one);
  assert.deepEqual(await readFile(path.join(dir, 'media', one.id)), bytes);
  const different = await upload(Buffer.from('different'), 'invalid');
  assert.equal(different.lastModified, undefined);
  const db = await (await request('/api/library')).json();
  assert.equal((db.conflicts || []).length, 0);
  assert.equal((await readdir(path.join(dir, 'media'))).length, 2);
});

test('both backup restore routes remap inline pictures and history while retaining media timestamps', async (t) => {
  const source = await fixture(t);
  const bytes = Buffer.from('roundtrip-original-image-bytes');
  const original = await (
    await fetch(source.base + '/api/media', {
      method: 'POST',
      headers: {
        'X-Diary-Client': 'desktop',
        'Content-Type': 'image/png',
        'X-File-Last-Modified': '1700000000123',
      },
      body: bytes,
    })
  ).json();
  const entry = await (
    await source.request('/api/entries', 'POST', {
      ...sample,
      content: `<img src="/media/${original.id}">`,
      attachments: [original.id],
    })
  ).json();
  await source.request('/api/entries/' + entry.id, 'PUT', { ...entry, title: 'changed title' });
  for (const version of [1, 2]) {
    const target = await fixture(t);
    if (version === 1) {
      const bundle = await (await source.request('/api/bundle')).json();
      assert.equal((await target.request('/api/restore', 'POST', bundle)).status, 200);
    } else {
      const manifest = await (await source.request('/api/backup-manifest')).json();
      const job = await (await target.request('/api/restore-jobs', 'POST', manifest)).json();
      for (const f of manifest.files) {
        const raw = await (await fetch(source.base + f.url)).arrayBuffer();
        const response = await fetch(
          target.base + `/api/restore-jobs/${job.id}/file/${f.folder}/${f.id}`,
          { method: 'POST', headers: { 'X-Diary-Client': 'desktop', 'X-Offset': '0' }, body: raw },
        );
        assert.equal(response.status, 200);
      }
      assert.equal(
        (await target.request('/api/restore-jobs/' + job.id + '/commit', 'POST', {})).status,
        200,
      );
    }
    const db = await (await target.request('/api/library')).json(),
      restored = db.entries[0],
      m = db.media[0];
    assert.notEqual(m.id, original.id);
    assert.deepEqual(restored.attachments, [m.id]);
    assert.equal(restored.content, `<img src="/media/${m.id}">`);
    assert.equal(restored.history[0].content, restored.content);
    assert.deepEqual(restored.history[0].attachments, [m.id]);
    assert.equal(m.lastModified, original.lastModified);
    assert.equal(m.importedAt, original.importedAt);
    assert.deepEqual(
      Buffer.from(await (await fetch(target.base + '/media/' + m.id)).arrayBuffer()),
      bytes,
    );
  }
});

test('same diary identity with different self-comments remains a manual conflict', () => {
  const first = {
    ...diary('one'),
    comments: [{ id: 'note', body: 'first synthetic remark', future: 1 }],
  };
  const second = {
    ...diary('two'),
    restoredFrom: { id: 'one' },
    comments: [{ id: 'note', body: 'second synthetic remark', future: 2 }],
  };
  const db = { entries: [first], media: [], conflicts: [] };
  const result = reconcileImport(db, { entries: [second] });
  assert.equal(result.report.mergedEntries, 0);
  assert.equal(result.report.conflicts, 1);
  assert.deepEqual(db.entries[0].comments, first.comments);
  assert.deepEqual(db.entries[1].comments, second.comments);
});

test('malformed upload metadata is rejected before file creation and dedup preserves existing metadata', async (t) => {
  const { base, dir, request } = await fixture(t);
  const upload = (extra) =>
    fetch(base + '/api/media', {
      method: 'POST',
      headers: { 'X-Diary-Client': 'desktop', 'Content-Type': 'image/jpeg', ...extra },
      body: 'encoded-image-synthetic-bytes',
    });
  for (const header of [
    'X-File-Name',
    'X-Source-Captured-At',
    'X-Source-Captured-Offset',
    'X-Media-Compression',
    'X-Original-Size',
    'X-File-Last-Modified',
  ]) {
    assert.equal((await upload({ [header]: '%' })).status, 400);
    assert.deepEqual(await readdir(path.join(dir, 'media')), []);
    assert.equal((await (await request('/api/library')).json()).media.length, 0);
  }
  const metadata = {
    'X-File-Name': encodeURIComponent('合成原名.jpg'),
    'X-File-Last-Modified': '1700000000123',
    'X-Original-Size': '1024',
    'X-Media-Compression': 'image-canvas',
    'X-Source-Captured-At': encodeURIComponent('2020:02:29 12:34:56'),
    'X-Source-Captured-Offset': encodeURIComponent('+08:00'),
  };
  const first = await (await upload(metadata)).json();
  assert.equal(first.name, '合成原名.jpg');
  assert.equal(first.sourceCapturedAtRaw, '2020:02:29 12:34:56');
  assert.equal(first.sourceCapturedOffset, '+08:00');
  assert.equal(first.lastModified, 1700000000123);
  assert.deepEqual(first.compression, { method: 'image-canvas', originalSize: 1024 });
  const again = await (
    await upload({
      ...metadata,
      'X-File-Name': 'new.jpg',
      'X-File-Last-Modified': '1800000000000',
      'X-Source-Captured-At': encodeURIComponent('2025:01:01 01:01:01'),
    })
  ).json();
  assert.deepEqual(again, first);
  assert.deepEqual(await readdir(path.join(dir, 'media')), [first.id]);
});
