import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createEntryReadingDocumentReader } from '../src/server/domain/entry-reading-document.mjs';
import { createDiaryServer } from '../src/server/app.mjs';
import { fromEditorJSON } from '../public/shared/rich-document.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ID = '12345678-1234-1234-1234-123456789abc';
const entry = (extra = {}) => ({
  id: ID,
  revision: 7,
  title: '虚构日记',
  content: '<p>　　原文<br>第二行</p>',
  date: '2026-10-16T01:00:00.000Z',
  createdAt: '2026-10-16T01:00:00.000Z',
  updatedAt: '2026-10-16T02:00:00.000Z',
  category: '日常',
  tags: ['旧标签'],
  attachments: [],
  history: [],
  comments: [],
  ...extra,
});
const media = [
  { id: 'photo', name: '图.png', type: 'image/png' },
  { id: 'video', name: '视频.mp4', type: 'video/mp4' },
  { id: 'audio', name: '声音.m4a', type: 'audio/mp4' },
];
const walk = (node) => [node, ...(node.content || []).flatMap(walk)];

test('live legacy content becomes a detached rich reading body with ordered images/video and unknown insertion times', () => {
  const read = createEntryReadingDocumentReader();
  const source = entry({ attachments: ['video', 'photo', 'video'] });
  const before = structuredClone({ source, media });
  const result = read(source, { media });
  assert.equal(result.mode, 'richdoc');
  assert.equal(result.readOnly, true);
  assert.equal(result.metadata.editableSource, true);
  assert.deepEqual(
    result.body.content.slice(0, 3).map((n) => n.type),
    ['video', 'image', 'video'],
  );
  assert.ok(result.body.content.slice(0, 3).every((n) => n.attrs.insertedAt === null));
  assert.equal(new Set(result.body.content.slice(0, 3).map((n) => n.attrs.occurrenceId)).size, 3);
  const dom = new JSDOM(result.html);
  assert.deepEqual(
    [
      ...dom.window.document
        .querySelector('[data-reading-attachment-region]')
        .querySelectorAll('video,img'),
    ].map((n) => n.localName),
    ['video', 'img', 'video'],
  );
  assert.equal(dom.window.document.querySelectorAll('video[controls]').length, 2);
  assert.equal(dom.window.document.querySelectorAll('video[autoplay]').length, 0);
  dom.window.close();
  assert.deepEqual({ source, media }, before);
  assert.equal(result.source.id, ID);
  assert.equal(result.source.revision, 7);
});

test('cache identity follows content and resource changes while taxonomy/comments/revision remain live', () => {
  const read = createEntryReadingDocumentReader({ maxEntries: 1 });
  const source = entry({ attachments: ['photo'] });
  const resources = structuredClone(media);
  const first = read(source, { media: resources });
  source.category = '新分类';
  source.tags = ['新标签'];
  source.comments = [{ id: 'comment', body: '新评论' }];
  source.revision++;
  const metadataOnly = read(source, { media: resources });
  assert.equal(metadataOnly.source.fingerprint, first.source.fingerprint);
  assert.equal(metadataOnly.source.revision, 8);
  assert.equal(metadataOnly.metadata.category, '新分类');
  assert.deepEqual(metadataOnly.metadata.tags, ['新标签']);
  assert.equal(metadataOnly.metadata.comments[0].body, '新评论');
  metadataOnly.body.content[0].attrs.alt = '不能改缓存';
  assert.notEqual(read(source, { media: resources }).body.content[0].attrs.alt, '不能改缓存');
  source.content = '<p>实时更新的正文</p>';
  const changed = read(source, { media: resources });
  assert.notEqual(changed.source.fingerprint, first.source.fingerprint);
  assert.ok(changed.html.includes('实时更新的正文'));
  resources[0].name = '新资源名.png';
  assert.notEqual(
    read(source, { media: resources }).source.fingerprint,
    changed.source.fingerprint,
  );
});

test('disclosures and unsupported formats use safe compatibility rendering with all attachments in original order', () => {
  const read = createEntryReadingDocumentReader();
  const source = entry({
    attachments: ['photo', 'audio', 'video'],
    content:
      '<details open><summary>折叠标题</summary><pre>  代码\n第二行</pre></details><img src="https://invalid.example/a" onerror="alert(1)"><script>bad()</script>',
  });
  const before = structuredClone(source);
  const result = read(source, { media });
  assert.equal(result.mode, 'compatibility');
  assert.equal(result.bodyComplete, false);
  const dom = new JSDOM(result.html),
    d = dom.window.document;
  assert.equal(d.querySelectorAll('details[open] summary').length, 1);
  assert.equal(d.querySelector('pre').textContent, '  代码\n第二行');
  assert.deepEqual(
    [
      ...d.querySelector('[data-reading-attachment-region]').querySelectorAll('img,audio,video'),
    ].map((n) => n.localName),
    ['img', 'audio', 'video'],
  );
  assert.equal(d.querySelectorAll('script,[onerror],[src^="https:"]').length, 0);
  assert.ok(result.issues.length > 0);
  assert.ok(
    result.issues.every((issue) =>
      Object.keys(issue).every((key) => ['code', 'severity', 'path'].includes(key)),
    ),
  );
  assert.deepEqual(source, before);
  dom.window.close();
});

test('native rich documents keep their real occurrence times and chat-derived entries keep canonical positions', () => {
  const read = createEntryReadingDocumentReader();
  const body = fromEditorJSON({
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: '新格式原文' }] },
      {
        type: 'image',
        attrs: {
          assetId: 'photo',
          occurrenceId: 'real-position',
          insertedAt: '2026-10-16T03:00:00.000Z',
          widthRatio: 0.75,
          align: 'center',
          caption: '',
          alt: '图',
        },
      },
    ],
  });
  const native = entry({
    contentFormat: 'richdoc',
    body,
    content: '<p>过期投影</p>',
    attachments: ['photo'],
  });
  const view = read(native, { media });
  assert.deepEqual(view.body, body);
  assert.equal(view.attachmentPlacements.length, 0);
  assert.ok(!view.html.includes('过期投影'));
  const canonical = entry({
    content: '<p>消息前<img src="/media/photo">消息后</p>',
    attachments: ['photo'],
    chatJournal: { version: 1, messages: [{ id: 'message' }] },
  });
  const before = structuredClone(canonical);
  const chat = read(canonical, { media });
  const dom = new JSDOM(chat.html);
  assert.equal(dom.window.document.querySelectorAll('img').length, 1);
  assert.equal(chat.metadata.editableSource, false);
  assert.deepEqual(canonical, before);
  assert.equal(walk(view.body.content[1])[0].attrs.insertedAt, '2026-10-16T03:00:00.000Z');
  dom.window.close();
});

async function fixture(t) {
  await fs.mkdir(path.join(ROOT, 'tmp'), { recursive: true });
  const dir = await fs.mkdtemp(path.join(ROOT, 'tmp', 'reading-api-test-'));
  await fs.writeFile(
    path.join(dir, 'diary.json'),
    JSON.stringify({
      schema: 1,
      entries: [entry()],
      media: [],
      categories: ['日常'],
      imports: [],
      settings: {},
    }),
  );
  const server = await createDiaryServer({ dataDir: dir, seed: false });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    assert.ok(path.resolve(dir).startsWith(path.join(ROOT, 'tmp') + path.sep));
    await fs.rm(dir, { recursive: true });
  });
  const request = (url, options = {}) => fetch(base + url, options);
  return { dir, base, request };
}

test('reading GET changes no database bytes, timestamps, history or MRU and reflects subsequent original-format edits', async (t) => {
  const f = await fixture(t),
    url = `/api/entries/${ID}/reading-document`;
  const before = await fs.readFile(path.join(f.dir, 'diary.json'), 'utf8');
  const first = await (await f.request(url)).json();
  const second = await (await f.request(url)).json();
  assert.equal(first.source.fingerprint, second.source.fingerprint);
  assert.equal(await fs.readFile(path.join(f.dir, 'diary.json'), 'utf8'), before);
  const current = await (await f.request('/api/entries/' + ID)).json();
  const response = await f.request('/api/entries/' + ID, {
    method: 'PUT',
    headers: { 'X-Diary-Client': 'desktop', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...current,
      content: '<p>继续编辑旧格式</p>',
      category: '实时分类',
      tags: ['实时标签'],
    }),
  });
  assert.equal(response.status, 200);
  const edited = await (await f.request(url)).json();
  assert.ok(edited.html.includes('继续编辑旧格式'));
  assert.equal(edited.source.revision, current.revision + 1);
  assert.equal(edited.metadata.category, '实时分类');
  assert.notEqual(edited.source.fingerprint, first.source.fingerprint);
  assert.equal(
    (await f.request('/api/entries/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/reading-document')).status,
    404,
  );
  assert.equal(
    (await f.request(url, { headers: { Origin: 'http://foreign.invalid' } })).status,
    403,
  );
  assert.equal(
    (await f.request(url, { method: 'POST', headers: { 'X-Diary-Client': 'desktop' } })).status,
    404,
  );
});

test('reading routes inherit the access lock and deleted-entry GET policy without arbitrary file access', async (t) => {
  const f = await fixture(t),
    url = `/api/entries/${ID}/reading-document`;
  const enabled = await f.request('/api/access', {
    method: 'PUT',
    headers: { 'X-Diary-Client': 'desktop', 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'synthetic-reading-lock' }),
  });
  assert.equal(enabled.status, 200);
  assert.equal((await f.request(url)).status, 401);
  const cookie = enabled.headers.get('set-cookie').split(';')[0];
  assert.equal((await f.request(url, { headers: { Cookie: cookie } })).status, 200);
  assert.equal(
    (
      await f.request('/api/entries/..%2F..%2Fvar%2Fmigration-lab/reading-document', {
        headers: { Cookie: cookie },
      })
    ).status,
    404,
  );
  const read = createEntryReadingDocumentReader();
  const deleted = read(entry({ deleted: true }));
  assert.equal(deleted.metadata.deleted, true);
  assert.equal(deleted.metadata.editableSource, false);
});
