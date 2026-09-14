import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fixture, sample, zip } from './helpers.mjs';
import { createPersistence } from '../public/editor/persistence.js';
import { legacyContent, markdownFor } from '../public/shared/legacy-content.js';
import {
  repairLegacyMetadata,
  preserveLegacyMetadata,
} from '../src/server/storage/legacy-metadata.mjs';
import { createLibraryStore } from '../src/server/storage/library-store.mjs';
import { sortedTaxonomy } from '../public/shared/taxonomy.js';

test('editor save queue preserves typing during an in-flight save and retains failed drafts', async () => {
  let release,
    calls = 0,
    fail = false;
  const entry = { ...sample, id: 'one', revision: 1, history: [] };
  const payloads = [];
  const editor = createPersistence({
    current: () => entry,
    sanitize: (s) => s,
    status: () => {},
    toast: () => {},
    onDirty: () => {},
    onSaved: () => {},
    api: async (_, { data }) => {
      payloads.push(structuredClone(data));
      calls++;
      if (calls === 1)
        await new Promise((r) => {
          release = r;
        });
      if (fail) throw Error('offline');
      return { ...data, revision: data.revision + 1, history: [], updatedAt: '2026-09-14' };
    },
  });
  editor.markDirty();
  const task = editor.flush();
  await Promise.resolve();
  entry.content = '<p>继续输入</p>';
  editor.markDirty();
  release();
  await task;
  assert.equal(payloads.length, 2);
  assert.equal(payloads[1].content, entry.content);
  assert.equal(payloads[1].revision, 2);
  assert.equal(editor.pending, false);
  fail = true;
  editor.markDirty();
  await assert.rejects(editor.flush(), /offline/);
  assert.equal(editor.pending, true);
  fail = false;
  await editor.flush();
  assert.equal(editor.pending, false);
});
test('legacy metadata repair is bounded, idempotent, snapshots first and leaves original text untouched', async (t) => {
  const { dir } = await fixture(t);
  const store = await createLibraryStore({ dataDir: dir, seed: false });
  const original = {
    content: '# 标题\n\n**内容**',
    contentType: 1,
    isHidden: true,
    m: 16,
    uuid: 'old-uuid',
  };
  const entry = {
    ...sample,
    id: 'old',
    revision: 1,
    content: legacyContent(original),
    mood: '',
    legacy: { original, isHidden: true },
    history: [],
  };
  await store.mutate((db) => {
    db.entries = [entry];
  });
  const before = await readFile(path.join(dir, 'diary.json'), 'utf8');
  await preserveLegacyMetadata({ dataDir: dir, ...store });
  const after = store.getDb().entries[0];
  assert.equal(after.content, entry.content);
  assert.deepEqual(after.legacy.original, original);
  assert.equal(after.hidden, true);
  assert.equal(after.mood, '郁闷');
  assert.equal(after.markdownSource, original.content);
  assert.deepEqual(repairLegacyMetadata(structuredClone(store.getDb())), {
    hidden: 0,
    markdown: 0,
    mood: 0,
    deletedTemplates: 0,
  });
  const snapshot = (await readdir(dir)).find((name) => name.startsWith('before-legacy-metadata'));
  assert.equal(await readFile(path.join(dir, snapshot), 'utf8'), before);
  assert.equal(
    markdownFor(
      after,
      (s) => s,
      () => 'fallback',
    ),
    original.content,
  );
  assert.equal(
    markdownFor(
      { ...after, content: 'changed' },
      (s) => s,
      () => 'fallback',
    ),
    'fallback',
  );
});
test('taxonomy orders persist, stale/partial orders are rejected and unknown preferences stay intact', async (t) => {
  const { request } = await fixture(t);
  await request('/api/taxonomy', 'POST', {
    kind: 'tag',
    action: 'create',
    from: '',
    to: '独立标签',
  });
  const entry = await (await request('/api/entries', 'POST', sample)).json();
  const db = await (await request('/api/library')).json();
  const items = sortedTaxonomy(db, 'tag');
  assert.equal(items.length, 2);
  const order = items.map((i) => i.name).reverse();
  assert.equal((await request('/api/taxonomy/order', 'PUT', { kind: 'tag', order })).status, 200);
  assert.equal(
    (await request('/api/taxonomy/order', 'PUT', { kind: 'tag', order: order.slice(1) })).status,
    409,
  );
  const after = await (await request('/api/library')).json();
  assert.deepEqual(after.tags, order);
  assert.equal(after.entries[0].revision, entry.revision);
  assert.equal(
    (await request('/api/preferences', 'PUT', { categorySort: 'count', tagSort: 'name' })).status,
    200,
  );
});
test('overlapping legacy imports deduplicate media and identical entries, preserve changed versions for resolution', async (t) => {
  const { base, request, dir } = await fixture(t);
  const old = {
    uuid: 'shared-uuid',
    title: '合成日记',
    content: '内容一',
    createTime: 1726000000000,
    images: 'image.png',
  };
  const upload = async (entries, marker) => {
    const raw = zip({
      'source.json': Buffer.from(JSON.stringify(entries)),
      version: Buffer.from('3'),
      'image.png': Buffer.from('image-bytes'),
      'tag.json': Buffer.from(JSON.stringify([{ name: marker }])),
    });
    const u = await (
      await fetch(base + '/api/import-upload', {
        method: 'POST',
        headers: { 'X-Diary-Client': 'desktop' },
        body: raw,
      })
    ).json();
    const r = await request('/api/import-upload/' + u.id + '/commit', 'POST', {});
    assert.equal(r.status, 200);
    return r.json();
  };
  await upload([old], '首次');
  const second = await upload(
    [old, { ...old, uuid: 'other', title: '另一天', createTime: 1726086400000 }],
    '第二次',
  );
  assert.equal(second.mergedEntries, 1);
  assert.equal(second.mergedMedia, 1);
  assert.equal(second.entries, 1);
  const third = await upload([{ ...old, content: '内容二' }], '第三次');
  assert.equal(third.conflicts, 1);
  let db = await (await request('/api/library')).json();
  assert.equal(db.entries.length, 3);
  assert.equal(db.media.length, 1);
  assert.equal((await readdir(path.join(dir, 'media'))).length, 1);
  const conflict = db.conflicts[0],
    left = db.entries.find((e) => e.id === conflict.left),
    right = db.entries.find((e) => e.id === conflict.right);
  assert.equal(
    (
      await request('/api/conflicts/' + conflict.id, 'PUT', {
        choice: 'right',
        leftRevision: 0,
        rightRevision: right.revision,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request('/api/conflicts/' + conflict.id, 'PUT', {
        choice: 'right',
        leftRevision: left.revision,
        rightRevision: right.revision,
      })
    ).status,
    200,
  );
  db = await (await request('/api/library')).json();
  assert.equal(db.entries.find((e) => e.id === left.id).deleted, true);
  assert.equal(db.entries.find((e) => e.id === right.id).content, '<p>内容二</p>');
  assert.equal(db.conflicts[0].status, 'resolved');
  assert.equal(db.imports.length, 3);
});
test('file uploads reuse identical bytes and same-name different bytes remain separate attachments', async (t) => {
  const { base, request, dir } = await fixture(t);
  const upload = async (bytes) =>
    (
      await fetch(base + '/api/media', {
        method: 'POST',
        headers: {
          'X-Diary-Client': 'desktop',
          'Content-Type': 'image/png',
          'X-File-Name': 'image.png',
        },
        body: bytes,
      })
    ).json();
  const one = await upload('version-one'),
    same = await upload('version-one'),
    two = await upload('version-two');
  assert.equal(one.id, same.id);
  assert.notEqual(one.id, two.id);
  const entry = await (
    await request('/api/entries', 'POST', { ...sample, attachments: [two.id] })
  ).json();
  const db = await (await request('/api/library')).json();
  assert.equal((db.conflicts || []).length, 0);
  const result = db.entries.find((e) => e.id === entry.id);
  assert.deepEqual(result.attachments, [two.id]);
  assert.equal((await readdir(path.join(dir, 'media'))).length, 2);
});
