import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLegacyConversionLab } from '../tools/serve-legacy-conversion-lab.mjs';

test('private conversion viewer requires its token and offers only read routes', async (t) => {
  const base = fileURLToPath(new URL('../tmp/legacy-lab-tests/', import.meta.url));
  await fs.mkdir(base, { recursive: true });
  const dir = await fs.mkdtemp(path.join(base, 'case-'));
  const key = 'a'.repeat(64),
    token = 'b'.repeat(48);
  await fs.mkdir(path.join(dir, 'entries'));
  await fs.writeFile(
    path.join(dir, 'source-snapshot.json'),
    JSON.stringify({
      sourceUrl: 'http://127.0.0.1:1',
      media: [],
      entries: [{ id: 'x', title: '虚构标题', content: '<p>虚构正文</p>' }],
    }),
  );
  await fs.writeFile(
    path.join(dir, 'development-report.json'),
    JSON.stringify({ rows: [{ key, cohort: 'development', safeForPreview: true }] }),
  );
  await fs.writeFile(
    path.join(dir, 'entries', key + '.json'),
    JSON.stringify({
      source: { id: 'x' },
      original: {
        title: '虚构标题',
        content: '<p>虚构正文</p>',
        legacy: { privateField: '不应在预览API发出' },
      },
      candidate: { body: {} },
      validation: {},
      media: [],
    }),
  );
  const { server } = await createLegacyConversionLab({ runDir: dir, token });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = 'http://127.0.0.1:' + server.address().port;
  const request = (route, options = {}) =>
    fetch(url + route, { ...options, headers: { 'X-Lab-Session': token, ...options.headers } });
  assert.equal((await fetch(url + '/api/samples')).status, 403);
  assert.equal(
    (await request('/api/samples', { headers: { 'X-Lab-Session': 'wrong' } })).status,
    403,
  );
  assert.equal(
    (await request('/api/samples', { headers: { Origin: 'https://example.invalid' } })).status,
    403,
  );
  assert.equal((await request('/api/samples', { method: 'POST' })).status, 405);
  assert.equal((await request('/api/media/not-a-known-id')).status, 404);
  assert.equal((await request('/api/entry/' + key)).status, 200);
  const payload = await (await request('/api/entry/' + key)).json();
  assert.equal(payload.original.legacy, undefined);
  assert.equal(payload.original.content, '<p>虚构正文</p>');
  assert.equal((await fetch(url + '/')).status, 200);
  assert.equal((await fetch(url + '/source-snapshot.json')).status, 404);
  assert.equal((await fetch(url + '/api/samples')).headers.get('cache-control'), 'no-store');
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(dir, 'development-report.json'), 'utf8')).rows[0],
    { key, cohort: 'development', safeForPreview: true },
  );
});
