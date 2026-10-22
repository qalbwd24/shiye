import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createDiaryServer } from '../server.mjs';
import { fixture, sample } from './helpers.mjs';
import { projectOpenEntry } from '../public/shared/open-data.js';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('open hidden state respects explicit false and falls back to legacy only when absent', () => {
  assert.equal(projectOpenEntry({ hidden: false, legacy: { isHidden: true } }).state.hidden, false);
  assert.equal(projectOpenEntry({ legacy: { isHidden: true } }).state.hidden, true);
});
async function seeded(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'diary-open-test-'));
  const entry = (n, extra = {}) => ({
    ...sample,
    id: id(n),
    revision: 1,
    date: '2024-02-28T16:30:00.000Z',
    createdAt: sample.date,
    updatedAt: sample.date,
    ...extra,
  });
  const entries = [
    entry(1, {
      contentFormat: 'markdown',
      markdownSource: '**正文**',
      markdownHtml: sample.content,
      attachments: [id(50)],
      history: [{ secret: 'PRIVATE_HISTORY' }],
      legacy: { secret: 'PRIVATE_LEGACY' },
      editorOriginalHtml: 'PRIVATE_ORIGINAL',
      comments: [
        { id: id(60), body: '评论', authorName: '作者', attachments: [id(50)] },
        { id: id(61), body: 'PRIVATE_DELETED_COMMENT', deleted: true },
        {
          id: id(62),
          body: '回复',
          replyTo: id(61),
          replyPreview: { body: 'PRIVATE_DELETED_COMMENT' },
        },
      ],
    }),
    entry(2, { legacy: { isHidden: true } }),
    entry(3, { draft: true }),
    entry(4, { deleted: true }),
    entry(5, { date: '2023-02-28T16:30:00.000Z', category: '其他' }),
    entry(6, { date: 'invalid', contentFormat: 'html' }),
    entry(7, { date: '2025-02-28T16:30:00.000Z', hidden: false, legacy: { isHidden: true } }),
  ];
  await fs.writeFile(
    path.join(dir, 'diary.json'),
    JSON.stringify({
      schema: 1,
      entries,
      media: [
        {
          id: id(50),
          name: '合成图片.png',
          type: 'image/png',
          size: 0,
          sourceCapturedAtRaw: '2024:02:29 08:30:00',
          compression: {
            method: 'image-canvas',
            originalSize: 42,
            sourcePath: 'PRIVATE_COMPRESSION_PATH',
          },
          path: 'PRIVATE_PATH',
          legacy: 'PRIVATE_MEDIA_LEGACY',
        },
      ],
      settings: { password: 'PRIVATE_SETTINGS' },
    }),
    'utf8',
  );
  const server = await createDiaryServer({ dataDir: dir, seed: false });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    const absolute = path.resolve(dir);
    assert.ok(
      absolute.startsWith(path.resolve(os.tmpdir()) + path.sep) &&
        path.basename(absolute).startsWith('diary-open-test-'),
    );
    await fs.rm(absolute, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, get: (url) => fetch(base + '/api/open/v1/' + url) };
}

test('open DTO uses an allowlist and preserves editable body and media metadata', async (t) => {
  const { get } = await seeded(t);
  const response = await get(`entries/${id(1)}`);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.apiVersion, 1);
  assert.deepEqual(data.entry.document, {
    format: 'markdown',
    source: '**正文**',
    html: sample.content,
  });
  assert.equal(data.entry.recordedDate, '2024-02-29');
  assert.equal(data.entry.attachments[0].sourceCapturedAtRaw, '2024:02:29 08:30:00');
  assert.deepEqual(data.entry.attachments[0].compression, {
    method: 'image-canvas',
    originalSize: 42,
  });
  assert.equal(data.entry.attachments[0].url, '/media/' + id(50));
  assert.equal('comments' in data.entry, false);
  assert.equal(JSON.stringify(data).includes('PRIVATE_'), false);
  const comments = await (await get(`entries/${id(1)}?includeComments=true`)).json();
  assert.equal(comments.entry.comments.length, 2);
  assert.equal('replyPreview' in comments.entry.comments[1], false);
  assert.equal(JSON.stringify(comments).includes('PRIVATE_'), false);
  const html = await (await get(`entries/${id(6)}`)).json();
  assert.equal(html.entry.document.source, sample.content);
  assert.equal(html.entry.recordedDate, null);
});

test('open lists filter state, paginate, export and match dates in the requested zone', async (t) => {
  const { get } = await seeded(t);
  const first = await (await get('entries?limit=2&sort=date-asc')).json();
  assert.equal(first.total, 4);
  assert.equal(first.nextOffset, 2);
  const second = await (
    await get(`entries?limit=2&offset=2&sort=date-asc&snapshot=${first.snapshot}`)
  ).json();
  assert.equal(second.nextOffset, null);
  assert.equal(new Set([...first.entries, ...second.entries].map((entry) => entry.id)).size, 4);
  assert.equal((await get(`entries/${id(2)}`)).status, 404);
  assert.equal((await (await get(`entries/${id(7)}`)).json()).entry.state.hidden, false);
  assert.equal(
    (await (await get(`entries/${id(2)}?includeHidden=true`)).json()).entry.state.hidden,
    true,
  );
  assert.equal(
    (await (await get('entries?includeHidden=true&includeDrafts=true&includeDeleted=true')).json())
      .total,
    7,
  );
  assert.equal(
    (await (await get('entries?from=2024-02-29&to=2024-02-29&tag=数学&q=正文')).json()).total,
    1,
  );
  assert.equal(
    (await (await get('entries?from=2024-02-28&to=2024-02-28&timeZone=UTC')).json()).total,
    1,
  );
  assert.equal((await (await get('entries?category=其他')).json()).total, 1);
  assert.equal((await (await get(`entries?ids=${id(1)},${id(5)}`)).json()).total, 2);
  assert.equal((await (await get('anniversary?date=2028-02-29')).json()).total, 1);
  assert.equal((await (await get('anniversary?date=2024-02-29')).json()).total, 0);
  const exported = await get('export?limit=1');
  assert.match(exported.headers.get('content-disposition'), /attachment/);
  assert.equal(exported.headers.get('cache-control'), 'no-store');
  const data = await exported.json();
  assert.equal(data.format, 'shiye-open-data');
  assert.equal(data.entries.length, 1);
  assert.ok(data.exportedAt);
});

test('random requests return new seeds and explicit seeds retain pagination order', async (t) => {
  const { get } = await seeded(t);
  const a = await (await get('random')).json();
  const b = await (await get('random')).json();
  assert.notEqual(a.seed, b.seed);
  const all = await (await get('random?seed=test&limit=200')).json();
  const page = await (
    await get(`random?seed=test&limit=2&offset=2&snapshot=${all.snapshot}`)
  ).json();
  assert.deepEqual(
    page.entries.map((entry) => entry.id),
    all.entries.slice(2, 4).map((entry) => entry.id),
  );
  const excluded = await (await get(`random?exclude=${a.entries[0].id}&limit=200`)).json();
  assert.equal(
    excluded.entries.some((entry) => entry.id === a.entries[0].id),
    false,
  );
});

test('strict query validation, same-origin policy and unknown routes', async (t) => {
  const { base, get } = await seeded(t);
  for (const query of [
    'limit=0',
    'limit=201',
    'limit=01',
    'offset=-1',
    'offset=9007199254740992',
    'from=20240229',
    'from=2023-02-29',
    'from=2025-01-01&to=2024-01-01',
    'timeZone=invalid',
    'includeHidden=1',
    'ids=bad',
    'snapshot=bad',
    'sort=random',
    'q=',
    'unknown=true',
    'limit=1&limit=2',
    'seed=x',
    'exclude=bad',
  ])
    assert.equal((await get('entries?' + query)).status, 400, query);
  assert.equal((await get('random?seed=')).status, 400);
  assert.equal((await get('anniversary?date=2023-02-29')).status, 400);
  assert.equal((await get('anniversary?date=20280229')).status, 400);
  assert.equal((await get(`entries/${id(1)}?limit=1`)).status, 400);
  assert.equal((await get('schema?limit=1')).status, 400);
  assert.equal((await get('missing')).status, 404);
  assert.equal((await get('entries/not-an-id')).status, 400);
  assert.equal(
    (await fetch(base + '/api/open/v1/entries', { headers: { Origin: 'https://foreign.invalid' } }))
      .status,
    403,
  );
  const response = await fetch(base + '/api/open/v1/schema', { headers: { Origin: base } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.equal(
    (
      await fetch(base + '/api/open/v1/entries', {
        method: 'POST',
        headers: { 'X-Diary-Client': 'desktop' },
      })
    ).status,
    405,
  );
});

test('library mutations invalidate snapshot and existing access lock protects open endpoints', async (t) => {
  const { request, base } = await fixture(t);
  const first = await (await request('/api/open/v1/entries')).json();
  assert.equal((await request('/api/entries', 'POST', sample)).status, 201);
  assert.equal((await request('/api/open/v1/entries?snapshot=' + first.snapshot)).status, 409);
  const setup = await request('/api/access', 'PUT', { password: 'open-test-password-123' });
  const cookie = setup.headers.get('set-cookie').split(';')[0];
  for (const endpoint of ['schema', 'entries', 'random', 'anniversary', 'export']) {
    assert.equal((await request('/api/open/v1/' + endpoint)).status, 401);
    assert.equal(
      (await fetch(base + '/api/open/v1/' + endpoint, { headers: { Cookie: cookie } })).status,
      200,
    );
  }
});
