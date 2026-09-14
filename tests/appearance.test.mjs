import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fixture, sample } from './helpers.mjs';
import { normalizeAppearance } from '../public/shared/appearance.js';
import { createLibraryStore } from '../src/server/storage/library-store.mjs';
import { preserveOldBackgrounds } from '../src/server/storage/appearance-compat.mjs';
import { createEntryActions } from '../public/features/entry-actions.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=',
  'base64',
);
test('background validates signature, preserves MIME and participates in backup manifest', async (t) => {
  const { base, request } = await fixture(t);
  const post = (bytes) =>
    fetch(base + '/api/backgrounds', {
      method: 'POST',
      headers: { 'X-Diary-Client': 'desktop', 'Content-Type': 'image/png' },
      body: bytes,
    });
  assert.equal((await post(Buffer.from('<svg></svg>'))).status, 415);
  for (const [bytes, type] of [
    [png, 'image/png'],
    [Buffer.from('ffd8ffe000', 'hex'), 'image/jpeg'],
    [Buffer.from('GIF89ahello'), 'image/gif'],
    [Buffer.from('RIFF0000WEBP'), 'image/webp'],
  ]) {
    const r = await post(bytes);
    assert.equal(r.status, 201);
    const item = await r.json();
    assert.equal(item.type, type);
    const read = await request('/media/' + item.id);
    assert.equal(read.headers.get('content-type'), type);
    assert.deepEqual(Buffer.from(await read.arrayBuffer()), bytes);
  }
  const manifest = await (await request('/api/backup-manifest')).json();
  assert.equal(manifest.files.length, 4);
  assert.ok(manifest.library.media.every((m) => m.purpose === 'background'));
});
test('appearance, layout and bad references validate without partial preference writes', async (t) => {
  const { base, request } = await fixture(t);
  const item = await (
    await fetch(base + '/api/backgrounds', {
      method: 'POST',
      headers: { 'X-Diary-Client': 'desktop' },
      body: png,
    })
  ).json();
  const appearance = {
    accent: '#8066b5',
    backgrounds: [{ id: item.id, region: 'editor', opacity: 0, fill: 'contain' }],
  };
  assert.equal(
    (await request('/api/preferences', 'PUT', { appearance, layout: { list: true } })).status,
    200,
  );
  const saved = (await (await request('/api/library')).json()).settings.preferences;
  assert.equal(saved.appearance.backgrounds[0].position, 'center');
  for (const invalid of [
    { appearance: { ...appearance, accent: '" onload="oops' } },
    {
      appearance: {
        ...appearance,
        backgrounds: [...appearance.backgrounds, ...appearance.backgrounds],
      },
    },
    { appearance: { ...appearance, backgrounds: [{ ...appearance.backgrounds[0], opacity: -1 }] } },
    {
      appearance: {
        ...appearance,
        backgrounds: [{ ...appearance.backgrounds[0], id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }],
      },
    },
    { layout: { list: 'true' } },
  ])
    assert.equal((await request('/api/preferences', 'PUT', invalid)).status, 400);
  assert.deepEqual((await (await request('/api/library')).json()).settings.preferences, saved);
  assert.throws(() => normalizeAppearance(null));
});
test('v0.4 background migration keeps originals, maps references and is idempotent', async (t) => {
  const { dir } = await fixture(t);
  const store = await createLibraryStore({ dataDir: dir, seed: false });
  const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  await fs.mkdir(path.join(dir, 'backgrounds'));
  await fs.writeFile(path.join(dir, 'backgrounds', id), png);
  await store.mutate((d) => {
    d.settings.preferences ||= {};
    d.settings.preferences.appearance = {
      accent: '#05a6b2',
      backgrounds: [{ id, region: 'app', opacity: 0.3, fill: 'cover' }],
    };
  });
  await preserveOldBackgrounds({ dataDir: dir, ...store });
  const db = store.getDb();
  const mapped = db.settings.preferences.appearance.backgrounds[0].id;
  assert.notEqual(mapped, id);
  assert.equal(db.media[0].purpose, 'background');
  assert.deepEqual(await fs.readFile(path.join(dir, 'media', mapped)), png);
  assert.deepEqual(await fs.readFile(path.join(dir, 'backgrounds', id)), png);
  await preserveOldBackgrounds({ dataDir: dir, ...store });
  assert.equal(store.getDb().media.length, 1);
});
test('context action updates the right entry, trash/restore persist and failed writes leave local state intact', async (t) => {
  const { request } = await fixture(t);
  const api = async (url, { method = 'GET', data } = {}) => {
    const r = await request(url, method, data);
    const v = await r.json();
    if (!r.ok) throw Error(v.error);
    return v;
  };
  const first = await api('/api/entries', { method: 'POST', data: sample });
  const second = await api('/api/entries', {
    method: 'POST',
    data: { ...sample, title: '另一个目标' },
  });
  let library = await api('/api/library');
  const c = {
    api,
    get library() {
      return library;
    },
    withLibraryMutation: (fn) => fn(),
    refreshLibrary: async () => {
      library = await api('/api/library');
    },
    renderView: () => {},
  };
  const actions = createEntryActions(c);
  await actions.update(second.id, () => ({ pinned: true, deleted: true }));
  assert.equal(library.entries.find((e) => e.id === first.id).pinned, false);
  assert.equal(library.entries.find((e) => e.id === second.id).deleted, true);
  await actions.update(second.id, () => ({ deleted: false }));
  assert.equal(library.entries.find((e) => e.id === second.id).deleted, false);
  const before = structuredClone(library);
  c.api = async () => {
    throw Error('写入失败');
  };
  await assert.rejects(() => actions.update(second.id, () => ({ title: '不可提交' })), /写入失败/);
  assert.deepEqual(library, before);
});
test('independent tags and category template/filter links follow taxonomy changes', async (t) => {
  const { request } = await fixture(t);
  const taxonomy = (kind, action, from, to) =>
    request('/api/taxonomy', 'POST', { kind, action, from, to });
  await taxonomy('tag', 'create', '', '空标签');
  await taxonomy('tag', 'rename', '空标签', '新标签');
  let db = await (await request('/api/library')).json();
  assert.deepEqual(db.tags, ['新标签']);
  await request('/api/templates', 'POST', {
    name: '绑定模板',
    content: '<p>模板</p>',
    category: '学习',
  });
  await request('/api/preferences', 'PUT', { memoryCategories: ['学习'] });
  await taxonomy('category', 'rename', '学习', '读书');
  db = await (await request('/api/library')).json();
  assert.equal(db.templates[0].category, '读书');
  assert.deepEqual(db.settings.preferences.memoryCategories, ['读书']);
  await taxonomy('tag', 'remove', '新标签', '');
  assert.deepEqual((await (await request('/api/library')).json()).tags, []);
});
