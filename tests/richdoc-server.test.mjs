import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createDiaryServer } from '../server.mjs';
import { sample } from './helpers.mjs';
import { getEditorDocument } from '../public/shared/editor-document.js';
import { hasQuickContent, quickEditableState } from '../public/shared/quick-capture.js';
import {
  renderRichDocument,
  validateRenderableRichDocument,
} from '../public/shared/rich-document-renderer.js';
import { validateEntry } from '../src/server/domain/entries.mjs';
import { remapEntryMedia, reconcileImport } from '../src/server/domain/import-reconciliation.mjs';
import { encryptVault, decryptVault } from '../public/shared/vault.js';
import { toDiarySource } from '../src/server/sync/legacy-webdav.mjs';

let serial = 0;
const block = (type, content = [], attrs = {}) => ({
  type,
  attrs: { blockId: `synthetic-${++serial}`, ...attrs },
  ...(content.length ? { content } : {}),
});
const text = (value, marks) => ({ type: 'text', text: value, ...(marks ? { marks } : {}) });
const paragraph = (...content) => block('paragraph', content);
const doc = (...content) => ({ format: 'shiye-richdoc', version: 1, content });
const image = (assetId) =>
  block('image', [], {
    assetId,
    occurrenceId: `occ-${++serial}`,
    insertedAt: null,
    widthRatio: 0.75,
    align: 'center',
    caption: '虚构图注',
    alt: '虚构图片',
  });
const video = (assetId, attrs = {}) => {
  const node = image(assetId);
  return { ...node, type: 'video', attrs: { ...node.attrs, ...attrs } };
};
const entryFor = (body) => ({
  ...sample,
  content: '<script>untrusted projection</script>',
  contentFormat: 'richdoc',
  body,
});
const testRoot = path.resolve(fileURLToPath(new URL('../tmp/richdoc-server/', import.meta.url)));
async function isolated(t) {
  await fs.mkdir(testRoot, { recursive: true });
  const dataDir = await fs.mkdtemp(path.join(testRoot, 'case-'));
  const server = await createDiaryServer({ dataDir, seed: false });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    assert.ok(path.resolve(dataDir).startsWith(testRoot + path.sep));
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  const request = (url, method = 'GET', data) =>
    fetch(base + url, {
      method,
      headers: {
        'X-Diary-Client': 'desktop',
        ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
    });
  return { request, base };
}

test('richdoc selection is explicit, validates schema, and leaves old sources unchanged', () => {
  const body = doc(paragraph(text('　甲\n乙')));
  assert.deepEqual(getEditorDocument({ ...sample, body }), {
    format: 'html',
    source: sample.content,
  });
  assert.deepEqual(getEditorDocument(entryFor(body)), { format: 'richdoc', body });
  assert.deepEqual(quickEditableState(entryFor(body)).document, { format: 'richdoc', body });
  assert.equal(
    hasQuickContent({ ...entryFor(doc(paragraph(text('　 ')))), title: '', attachments: [] }),
    false,
  );
  assert.equal(
    hasQuickContent({ ...entryFor(doc(image('image-id'))), title: '', attachments: [] }),
    true,
  );
  const invalid = doc(block('paragraph', [paragraph(text('invalid nesting'))]));
  assert.equal(getEditorDocument(entryFor(invalid)).format, 'html');
});

test('safe projection escapes text, link attributes, captions and code without loading a DOM at runtime', () => {
  const body = doc(
    paragraph(
      text('<script>alert(1)</script>　&', [
        { type: 'bold' },
        {
          type: 'link',
          attrs: { href: 'https://example.com/?q="quoted"', title: '"><img src=x onerror=1>' },
        },
      ]),
    ),
    block('codeBlock', [text('<b>literal</b>')], { language: 'js" onclick="bad' }),
    image('image-id'),
  );
  const html = renderRichDocument(body);
  const dom = new JSDOM(html);
  assert.equal(dom.window.document.querySelector('script'), null);
  assert.equal(dom.window.document.querySelector('[onclick], [onerror]'), null);
  assert.equal(dom.window.document.querySelector('a').textContent, '<script>alert(1)</script>　&');
  assert.equal(
    dom.window.document.querySelector('a').getAttribute('title'),
    '"><img src=x onerror=1>',
  );
  assert.equal(dom.window.document.querySelector('code').textContent, '<b>literal</b>');
  assert.equal(dom.window.document.querySelector('img').getAttribute('src'), '/media/image-id');
  dom.window.close();
});

test('schema and explicit attribute checks reject executable or lossy candidates', () => {
  const bad = [
    doc(block('paragraph', [paragraph(text('nested'))])),
    doc(block('heading', [text('bad heading')], { level: '1 onclick=bad' })),
    doc(block('paragraph', [text('bad attrs')], { style: 'color:red' })),
    doc(paragraph(text('unsafe', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }]))),
    doc(
      paragraph(
        text('unsafe', [{ type: 'link', attrs: { href: 'https://example.com', onclick: 'bad' } }]),
      ),
    ),
  ];
  for (const body of bad) assert.throws(() => validateRenderableRichDocument(body));
});

test('isolated richdoc API saves authoritative body, retains metadata edits and advances only content clock', async (t) => {
  const { request } = await isolated(t);
  const body = doc(paragraph(text('甲'), block('hardBreak'), text('乙')));
  const createdResponse = await request('/api/entries', 'POST', entryFor(body));
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.deepEqual(created.body, body);
  assert.equal(created.content, renderRichDocument(body));
  assert.equal(created.content.includes('<script>'), false);
  assert.ok(Number.isFinite(Date.parse(created.contentEditedAt)));
  const { body: _body, contentFormat: _format, ...oldClient } = created;
  const metadataResponse = await request(`/api/entries/${created.id}`, 'PUT', {
    ...oldClient,
    category: '虚构分类',
    tags: ['新标签'],
    markdownSource: null,
    markdownHtml: null,
    contentEditedAt: '2099-01-01T00:00:00Z',
  });
  assert.equal(metadataResponse.status, 200);
  const metadata = await metadataResponse.json();
  assert.deepEqual(metadata.body, body);
  assert.equal(metadata.contentFormat, 'richdoc');
  assert.equal(metadata.contentEditedAt, created.contentEditedAt);
  const changedBody = doc(paragraph(text('真实新正文')));
  const changedResponse = await request(`/api/entries/${created.id}`, 'PUT', {
    ...metadata,
    body: changedBody,
    contentEditedAt: '2099-01-01T00:00:00Z',
  });
  assert.equal(changedResponse.status, 200);
  const changed = await changedResponse.json();
  assert.deepEqual(changed.body, changedBody);
  assert.equal(changed.content, renderRichDocument(changedBody));
  assert.notEqual(changed.contentEditedAt, '2099-01-01T00:00:00Z');
  assert.ok(Date.parse(changed.contentEditedAt) >= Date.parse(created.contentEditedAt));
  assert.deepEqual(changed.history[0].body, body);
  assert.deepEqual((await (await request(`/api/entries/${created.id}`)).json()).body, changedBody);
});

test('old-client body downgrade, missing image registry and omitted attachments are rejected without overwriting', async (t) => {
  const { request } = await isolated(t);
  const saved = await (
    await request('/api/entries', 'POST', entryFor(doc(paragraph(text('原正文')))))
  ).json();
  const { body: _body, ...legacy } = saved;
  const denied = await request(`/api/entries/${saved.id}`, 'PUT', {
    ...legacy,
    contentFormat: 'html',
    content: '<p>错误降级</p>',
  });
  assert.equal(denied.status, 409);
  assert.deepEqual((await (await request(`/api/entries/${saved.id}`)).json()).body, saved.body);
  assert.equal(
    (await request('/api/entries', 'POST', entryFor(doc(image('missing'))))).status,
    400,
  );
  assert.throws(
    () =>
      validateEntry(entryFor(doc(image('registered'))), {
        media: [{ id: 'registered', type: 'image/png' }],
      }),
    /富文档/,
  );
});

test('richdoc quick creation remains idempotent and rejects truly blank bodies', async (t) => {
  const { request } = await isolated(t);
  const token = randomUUID();
  const entry = entryFor(doc(paragraph(text('稳定内容'))));
  const first = await request('/api/quick-entries', 'POST', { clientToken: token, entry });
  const second = await request('/api/quick-entries', 'POST', { clientToken: token, entry });
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal((await first.json()).id, (await second.json()).id);
  const blank = { ...entryFor(doc(paragraph(text('　 ')))), title: '' };
  assert.equal(
    (await request('/api/quick-entries', 'POST', { clientToken: randomUUID(), entry: blank }))
      .status,
    400,
  );
});

test('backup remapping updates authoritative image IDs and nested history while preserving occurrence identities', () => {
  const body = doc(image('old-id'));
  const entry = {
    ...entryFor(body),
    attachments: ['old-id'],
    content: renderRichDocument(body),
    history: [
      {
        ...entryFor(body),
        attachments: ['old-id'],
        content: renderRichDocument(body),
        history: [{ ...entryFor(body), attachments: ['old-id'] }],
      },
    ],
  };
  const before = structuredClone(entry);
  const mapped = remapEntryMedia(entry, new Map([['old-id', 'new-id']]));
  assert.equal(mapped.body.content[0].attrs.assetId, 'new-id');
  assert.equal(mapped.history[0].body.content[0].attrs.assetId, 'new-id');
  assert.equal(mapped.history[0].history[0].body.content[0].attrs.assetId, 'new-id');
  assert.equal(mapped.body.content[0].attrs.occurrenceId, body.content[0].attrs.occurrenceId);
  assert.equal(mapped.body.content[0].attrs.insertedAt, null);
  assert.equal(mapped.content.includes('/media/new-id'), true);
  assert.deepEqual(entry, before);
});

test('encrypted full backup restores registered image bytes and richdoc current/history references in another isolated library', async (t) => {
  const source = await isolated(t);
  const upload = await fetch(source.base + '/api/media', {
    method: 'POST',
    headers: {
      'X-Diary-Client': 'desktop',
      'Content-Type': 'image/png',
      'X-File-Name': 'fictional.png',
    },
    body: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jEakAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  assert.equal(upload.status, 201);
  const media = await upload.json();
  const initial = {
    ...entryFor(doc(image(media.id), paragraph(text('甲')))),
    attachments: [media.id],
  };
  const saved = await (await source.request('/api/entries', 'POST', initial)).json();
  const changed = await (
    await source.request(`/api/entries/${saved.id}`, 'PUT', {
      ...saved,
      body: doc(image(media.id), paragraph(text('乙'))),
    })
  ).json();
  const bundle = await (await source.request('/api/bundle')).json();
  const restoredBundle = await decryptVault(
    await encryptVault(bundle, 'fictional-richdoc-backup'),
    'fictional-richdoc-backup',
  );
  for (const version of [1, 2]) {
    const target = await isolated(t);
    if (version === 1)
      assert.equal((await target.request('/api/restore', 'POST', restoredBundle)).status, 200);
    else {
      const manifest = await (await source.request('/api/backup-manifest')).json();
      const jobResponse = await target.request('/api/restore-jobs', 'POST', manifest);
      assert.equal(jobResponse.status, 201);
      const job = await jobResponse.json();
      for (const file of manifest.files) {
        const bytes = await (await fetch(source.base + file.url)).arrayBuffer();
        const response = await fetch(
          target.base + `/api/restore-jobs/${job.id}/file/${file.folder}/${file.id}`,
          {
            method: 'POST',
            headers: { 'X-Diary-Client': 'desktop', 'X-Offset': '0' },
            body: bytes,
          },
        );
        assert.equal(response.status, 200);
      }
      assert.equal(
        (await target.request(`/api/restore-jobs/${job.id}/commit`, 'POST', {})).status,
        200,
      );
    }
    const library = await (await target.request('/api/library')).json();
    const restored = library.entries[0];
    assert.equal(restored.contentFormat, 'richdoc');
    assert.notEqual(restored.attachments[0], media.id);
    assert.equal(restored.body.content[0].attrs.assetId, restored.attachments[0]);
    assert.equal(restored.history[0].body.content[0].attrs.assetId, restored.attachments[0]);
    assert.equal(
      restored.body.content[0].attrs.occurrenceId,
      changed.body.content[0].attrs.occurrenceId,
    );
    assert.equal(restored.content, renderRichDocument(restored.body));
    assert.equal(restored.history[0].content, renderRichDocument(restored.history[0].body));
    assert.equal(restored.contentEditedAt, changed.contentEditedAt);
    assert.equal(restored.history[0].contentEditedAt, saved.contentEditedAt);
    assert.equal(restored.body.content[0].attrs.insertedAt, null);
    const bytes = await (await target.request('/media/' + restored.attachments[0])).arrayBuffer();
    assert.equal(bytes.byteLength, media.size);
    assert.equal(createHash('sha256').update(Buffer.from(bytes)).digest('hex'), media.sha256);
  }
});

test('legacy metadata edits keep absent content clocks absent and ignore client forged clocks', () => {
  const previous = { ...sample, contentFormat: 'html' };
  const value = validateEntry(
    { ...previous, tags: ['新分类'], contentEditedAt: '2099-01-01T00:00:00Z' },
    { media: [] },
    previous,
  );
  assert.equal(value.contentEditedAt, undefined);
  assert.equal(value.content, sample.content);
});

test('backup imports reject unregistered richdoc image references in current and historical bodies', () => {
  const body = doc(image('unregistered'));
  const candidate = {
    ...entryFor(body),
    id: 'fictional',
    attachments: ['unregistered'],
    content: renderRichDocument(body),
    tags: [],
  };
  const db = () => ({ media: [], entries: [], imports: [], conflicts: [] });
  assert.throws(() => reconcileImport(db(), { entries: [candidate], media: [] }), /未登记/);
  const current = { ...sample, id: 'fictional-current', attachments: [], history: [candidate] };
  assert.throws(() => reconcileImport(db(), { entries: [current], media: [] }), /未登记/);
  assert.throws(() => remapEntryMedia({ ...candidate, attachments: [] }, new Map()), /图片关联/);
});

test('chat-derived entry body and attachments are read-only while taxonomy remains mutable', async (t) => {
  const { request } = await isolated(t);
  const info = await (await request('/api/chat-journal')).json();
  const sourceId = randomUUID();
  assert.equal(
    (
      await request('/api/chat-journal/rooms', 'PUT', {
        sourceId,
        id: '-1',
        title: '虚构会话',
        category: info.categories[0],
        idleHours: 5,
      })
    ).status,
    200,
  );
  const appended = await (
    await request('/api/chat-journal/messages', 'POST', {
      sourceId,
      roomId: '-1',
      messages: [
        { id: '1', text: '虚构消息正文', sentAt: '2026-10-16T00:00:00.000Z', attachments: [] },
      ],
    })
  ).json();
  const id = appended.accepted[0].entryId;
  const saved = await (await request('/api/entries/' + id)).json();
  assert.equal(
    (await request('/api/entries/' + id, 'PUT', { ...saved, content: '<p>禁止改写</p>' })).status,
    409,
  );
  assert.equal(
    (
      await request('/api/entries/' + id, 'PUT', {
        ...saved,
        contentFormat: 'richdoc',
        body: doc(paragraph(text('禁止另造正文'))),
      })
    ).status,
    409,
  );
  const metadataResponse = await request('/api/entries/' + id, 'PUT', {
    ...saved,
    category: '可变分类',
    tags: ['可变标签'],
  });
  assert.equal(metadataResponse.status, 200);
  const metadata = await metadataResponse.json();
  assert.equal(metadata.content, saved.content);
  assert.deepEqual(metadata.chatJournal.messages, saved.chatJournal.messages);
  assert.equal(metadata.category, '可变分类');
  assert.deepEqual(metadata.tags, ['可变标签']);
  assert.equal(metadata.contentEditedAt, saved.contentEditedAt || saved.updatedAt);
});

test('metadata freezes the previous effective edit clock, never the new save time', () => {
  const oldClock = '2001-01-01T00:00:00.000Z';
  const previous = { ...sample, updatedAt: oldClock };
  const metadata = validateEntry({ ...previous, tags: ['新标签'] }, { media: [] }, previous);
  assert.equal(metadata.contentEditedAt, oldClock);
  const knownClock = { ...previous, contentEditedAt: '2000-01-01T00:00:00.000Z' };
  assert.equal(
    validateEntry({ ...knownClock, title: '新标题' }, { media: [] }, knownClock).contentEditedAt,
    knownClock.contentEditedAt,
  );
  const explicitUnknown = { ...previous, contentEditedAt: null };
  assert.equal(
    validateEntry({ ...explicitUnknown, tags: ['只改属性'] }, { media: [] }, explicitUnknown)
      .contentEditedAt,
    null,
  );
});

test('remap chains are applied once to both richdoc and generated HTML', () => {
  const body = doc(image('a'));
  const entry = { ...entryFor(body), attachments: ['a'], content: renderRichDocument(body) };
  const mapped = remapEntryMedia(
    entry,
    new Map([
      ['a', 'b'],
      ['b', 'c'],
    ]),
  );
  assert.equal(mapped.body.content[0].attrs.assetId, 'b');
  assert.deepEqual(mapped.attachments, ['b']);
  assert.equal(mapped.content, renderRichDocument(mapped.body));
});

test('legacy Android upload refuses richdoc while pull-only keeps local canonical bodies intact', async (t) => {
  const { request } = await isolated(t);
  const body = doc(paragraph(text('不允许丢失的新正文')));
  const saved = await (await request('/api/entries', 'POST', entryFor(body))).json();
  assert.throws(() => toDiarySource({ entries: [saved], media: [] }), { status: 409 });
  assert.doesNotThrow(() => toDiarySource({ entries: [{ ...saved, draft: true }], media: [] }));
  const stats = { writes: 0 };
  const remote = http.createServer((req, res) => {
    if (req.method === 'PUT' || req.method === 'MKCOL') stats.writes++;
    if (req.method === 'PROPFIND') {
      res.writeHead(207, { 'Content-Type': 'application/xml' });
      res.end('<d:multistatus xmlns:d="DAV:"><d:collection/></d:multistatus>');
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) => remote.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    remote.closeAllConnections();
    await new Promise((resolve) => remote.close(resolve));
  });
  const credentials = {
    url: `http://127.0.0.1:${remote.address().port}/`,
    username: 'fictional',
    password: 'fictional-password',
  };
  const pull = await request('/api/sync', 'POST', { ...credentials, action: 'pull' });
  assert.equal(pull.status, 200);
  assert.equal((await pull.json()).status, 'pulled');
  const push = await request('/api/sync', 'POST', {
    ...credentials,
    action: 'sync',
    allowUnencrypted: true,
  });
  assert.equal(push.status, 409);
  assert.equal(stats.writes, 0);
  assert.deepEqual((await (await request('/api/entries/' + saved.id)).json()).body, body);
});

test('video body validation requires registered matching media and attachments, and keeps insertion timestamps distinct', () => {
  const body = doc(
    video('media-video', { insertedAt: null }),
    video('media-video', {
      insertedAt: '2026-10-16T01:02:03.000Z',
      widthRatio: 0.4,
      align: 'right',
    }),
  );
  const entry = { ...entryFor(body), attachments: ['media-video'] };
  const db = { media: [{ id: 'media-video', type: 'video/mp4' }] };
  assert.deepEqual(validateEntry(entry, db).body, body);
  assert.throws(() => validateEntry({ ...entry, attachments: [] }, db), /富文档/);
  assert.throws(
    () => validateEntry(entry, { media: [{ id: 'media-video', type: 'image/png' }] }),
    /富文档/,
  );
  assert.throws(() => validateEntry(entry, { media: [] }), /附件不存在/);
  const invalidTime = structuredClone(entry);
  invalidTime.body.content[0].attrs.insertedAt = '2026-10-16T01:02:03+08:00';
  assert.throws(() => validateEntry(invalidTime, db), /富文档/);
  const mapped = remapEntryMedia(
    {
      ...entry,
      futureMetadata: { keep: true },
      history: [{ ...entry, futureHistoricalMetadata: 'keep' }],
    },
    new Map([['media-video', 'new-video']]),
  );
  assert.equal(mapped.body.content[0].attrs.assetId, 'new-video');
  assert.equal(mapped.history[0].body.content[1].attrs.assetId, 'new-video');
  assert.equal(mapped.body.content[0].attrs.insertedAt, null);
  assert.equal(mapped.body.content[1].attrs.insertedAt, '2026-10-16T01:02:03.000Z');
  assert.deepEqual(mapped.futureMetadata, { keep: true });
  assert.equal(mapped.history[0].futureHistoricalMetadata, 'keep');
  assert.throws(
    () =>
      reconcileImport(
        {
          media: [{ id: 'media-video', type: 'image/png' }],
          entries: [],
          imports: [],
          conflicts: [],
        },
        { entries: [{ ...entry, id: 'fictional' }] },
      ),
    /类型不符/,
  );
});

test('video API export and both backup restore paths retain exact bytes, occurrence identities and historical bodies', async (t) => {
  const source = await isolated(t);
  const originalBytes = Buffer.from(
    '000000186674797069736f6d0000020069736f6d6d7034320000000c6d64617401020304',
    'hex',
  );
  const response = await fetch(source.base + '/api/media', {
    method: 'POST',
    headers: {
      'X-Diary-Client': 'desktop',
      'Content-Type': 'video/mp4',
      'X-File-Name': 'fictional-video.mp4',
    },
    body: originalBytes,
  });
  assert.equal(response.status, 201);
  const media = await response.json();
  const body = doc(
    video(media.id, { insertedAt: null }),
    paragraph(text('虚构视频正文')),
    video(media.id, { insertedAt: '2026-10-16T00:00:00.000Z', widthRatio: 0.4, align: 'left' }),
  );
  const initialResponse = await source.request('/api/entries', 'POST', {
    ...entryFor(body),
    attachments: [media.id],
  });
  assert.equal(initialResponse.status, 201);
  const initial = await initialResponse.json();
  const updatedBody = structuredClone(body);
  updatedBody.content[1].content[0].text = '编辑后的虚构正文';
  const updated = await (
    await source.request('/api/entries/' + initial.id, 'PUT', { ...initial, body: updatedBody })
  ).json();
  const exportedResponse = await source.request('/api/open/v1/entries/' + initial.id);
  assert.equal(exportedResponse.status, 200);
  const exported = await exportedResponse.json();
  const projected = exported.entry || exported;
  assert.deepEqual(projected.document.body, updatedBody);
  assert.equal(projected.attachments[0].type, 'video/mp4');
  assert.equal(projected.contentEditedAt, updated.contentEditedAt);
  const oldClient = { ...updated, contentFormat: 'html', content: '<p>不能降级视频</p>' };
  delete oldClient.body;
  assert.equal((await source.request('/api/entries/' + initial.id, 'PUT', oldClient)).status, 409);
  for (const version of [1, 2]) {
    const target = await isolated(t);
    if (version === 1) {
      const bundle = await (await source.request('/api/bundle')).json();
      const restoredBundle = await decryptVault(
        await encryptVault(bundle, 'fictional-video-backup'),
        'fictional-video-backup',
      );
      assert.equal((await target.request('/api/restore', 'POST', restoredBundle)).status, 200);
    } else {
      const manifest = await (await source.request('/api/backup-manifest')).json();
      const job = await (await target.request('/api/restore-jobs', 'POST', manifest)).json();
      for (const file of manifest.files) {
        const bytes = await (await fetch(source.base + file.url)).arrayBuffer();
        assert.equal(
          (
            await fetch(
              target.base + `/api/restore-jobs/${job.id}/file/${file.folder}/${file.id}`,
              {
                method: 'POST',
                headers: { 'X-Diary-Client': 'desktop', 'X-Offset': '0' },
                body: bytes,
              },
            )
          ).status,
          200,
        );
      }
      assert.equal(
        (await target.request('/api/restore-jobs/' + job.id + '/commit', 'POST', {})).status,
        200,
      );
    }
    const restored = (await (await target.request('/api/library')).json()).entries[0];
    assert.notEqual(restored.attachments[0], media.id);
    const expected = remapEntryMedia(updated, new Map([[media.id, restored.attachments[0]]]));
    assert.deepEqual(restored.body, expected.body);
    assert.deepEqual(restored.history[0].body, expected.history[0].body);
    assert.equal(restored.content, renderRichDocument(restored.body));
    assert.equal(restored.contentEditedAt, updated.contentEditedAt);
    const bytes = Buffer.from(
      await (await target.request('/media/' + restored.attachments[0])).arrayBuffer(),
    );
    assert.deepEqual(bytes, originalBytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), media.sha256);
  }
});
