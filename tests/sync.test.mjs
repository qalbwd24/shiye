import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { fixture } from './helpers.mjs';

async function webdavFixture(t, initial = new Map()) {
  const files = initial;
  const stats = { GET: 0, HEAD: 0, PUT: 0, MKCOL: 0, PROPFIND: 0 };
  const etags = new Map(
    [...files].map(([key, value]) => [
      key,
      '"' + createHash('sha256').update(value).digest('hex') + '"',
    ]),
  );
  const server = http.createServer(async (req, res) => {
    stats[req.method] = (stats[req.method] || 0) + 1;
    const key = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    if (
      req.headers.authorization !==
      'Basic ' + Buffer.from('shiye:test-password').toString('base64')
    ) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="test"' });
      return res.end();
    }
    if (req.method === 'GET') {
      const data = files.get(key);
      if (!data) {
        res.writeHead(404);
        return res.end();
      }
      res.setHeader('ETag', etags.get(key) || '"empty"');
      if (req.headers['if-none-match'] && req.headers['if-none-match'] === etags.get(key)) {
        res.writeHead(304);
        return res.end();
      }
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      return res.end(data);
    }
    if (req.method === 'HEAD') {
      const data = files.get(key);
      if (!data) {
        res.writeHead(404);
        return res.end();
      }
      res.setHeader('ETag', etags.get(key));
      res.setHeader('Content-Length', data.length);
      res.writeHead(200);
      return res.end();
    }
    if (req.method === 'PROPFIND') {
      res.writeHead(207, { 'Content-Type': 'application/xml' });
      return res.end(
        '<d:multistatus xmlns:d="DAV:"><d:response><d:resourcetype><d:collection/></d:resourcetype></d:response></d:multistatus>',
      );
    }
    if (req.method === 'MKCOL') {
      res.writeHead(201);
      return res.end();
    }
    if (req.method === 'PUT') {
      const old = files.get(key);
      if (req.headers['if-none-match'] === '*' && old) {
        res.writeHead(412);
        return res.end();
      }
      if (req.headers['if-match'] && req.headers['if-match'] !== etags.get(key)) {
        res.writeHead(412);
        return res.end();
      }
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const data = Buffer.concat(chunks);
      files.set(key, data);
      etags.set(key, '"' + createHash('sha256').update(data).digest('hex') + '"');
      res.writeHead(201, { ETag: etags.get(key) });
      return res.end();
    }
    res.writeHead(405);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return { files, stats, url: `http://127.0.0.1:${server.address().port}/` };
}

test('desktop sync uploads an Android-compatible DiarySource to an empty WebDAV', async (t) => {
  const { request } = await fixture(t);
  const remote = await webdavFixture(t);
  const created = await request('/api/entries', 'POST', {
    title: '电脑同步样本',
    content: '<p>从电脑上传</p>',
    date: '2026-09-22T05:00:00.000Z',
    category: '日常',
    tags: ['测试'],
    attachments: [],
    mood: '',
    weather: '',
    location: '',
  });
  assert.equal(created.status, 201);
  const response = await request('/api/sync', 'POST', {
    action: 'sync',
    url: remote.url,
    username: 'shiye',
    password: 'test-password',
    allowUnencrypted: true,
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.status, 'synced');
  const raw = JSON.parse(remote.files.get('/diary/diary.json').toString('utf8'));
  assert.equal(JSON.parse(raw.json)[0].title, '电脑同步样本');
  assert.equal(JSON.parse(raw.catagory)[0].name, '日常');
  const status = await (await request('/api/sync/status')).json();
  assert.equal(status.username, 'shiye');
  assert.ok(status.lastSyncAt);
});

test('pull-only never uploads when the WebDAV library is empty', async (t) => {
  const remote = await webdavFixture(t);
  const { request } = await fixture(t);
  const response = await request('/api/sync', 'POST', {
    action: 'pull',
    url: remote.url,
    username: 'shiye',
    password: 'test-password',
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'pulled');
  assert.equal(remote.files.has('/diary/diary.json'), false);
});

test('desktop sync pulls the Android DiarySource format into the local library', async (t) => {
  const remote = await webdavFixture(
    t,
    new Map([
      [
        '/diary/diary.json',
        Buffer.from(
          JSON.stringify({
            json: JSON.stringify([
              {
                uuid: 'android-entry-1',
                title: '手机同步样本',
                content: '手机正文',
                createTime: 1790000000000,
                recordTime: 1790000000000,
                updateTime: 1790000000000,
                category: '日常',
                tag: '测试',
                images: '',
                localImages: '',
                contentType: 0,
              },
            ]),
            catagory: JSON.stringify([{ uuid: 'cat-1', name: '日常' }]),
            model: '[]',
            tag: JSON.stringify([{ uuid: 'tag-1', name: '测试' }]),
          }),
        ),
      ],
    ]),
  );
  const { request } = await fixture(t);
  const response = await request('/api/sync', 'POST', {
    action: 'pull',
    url: remote.url,
    username: 'shiye',
    password: 'test-password',
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.status, 'pulled');
  assert.equal(result.pulled.entries, 1);
  const library = await (await request('/api/library')).json();
  assert.equal(
    library.entries.some((entry) => entry.legacy?.original?.uuid === 'android-entry-1'),
    true,
  );
  assert.equal(
    library.entries.find((entry) => entry.legacy?.original?.uuid === 'android-entry-1').title,
    '手机同步样本',
  );
});

test('desktop sync uses conditional GET and skips an unchanged JSON PUT', async (t) => {
  const remote = await webdavFixture(t);
  const { request } = await fixture(t);
  const created = await request('/api/entries', 'POST', {
    title: '重复同步样本',
    content: '<p>只上传一次</p>',
    date: '2026-09-22T06:00:00.000Z',
    category: '日常',
    tags: [],
    attachments: [],
    mood: '',
    weather: '',
    location: '',
  });
  assert.equal(created.status, 201);
  const input = {
    action: 'sync',
    url: remote.url,
    username: 'shiye',
    password: 'test-password',
    allowUnencrypted: true,
  };
  assert.equal((await (await request('/api/sync', 'POST', input)).json()).status, 'synced');
  const firstPut = remote.stats.PUT;
  const firstGet = remote.stats.GET;
  const second = await (await request('/api/sync', 'POST', input)).json();
  assert.equal(second.status, 'synced');
  assert.equal(second.pushed.skipped, true);
  assert.equal(remote.stats.PUT, firstPut);
  assert.ok(remote.stats.GET > firstGet);
});
