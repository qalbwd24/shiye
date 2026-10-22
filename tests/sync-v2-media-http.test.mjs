import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { createSyncServer } from '../src/server/sync-v2/server.mjs';
import { uploadAsset, downloadAsset } from '../public/shared/sync-v2-media.js';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const temporaryRoot = path.resolve(import.meta.dirname, '../tmp/sync-backend');
const route = (f, suffix) => `${f.baseUrl}api/sync/v1/${suffix}`;
async function fixture(t) {
  await mkdir(temporaryRoot, { recursive: true });
  const dataDir = await mkdtemp(path.join(temporaryRoot, 'media-http-'));
  let instance;
  let baseUrl;
  async function start() {
    instance = await createSyncServer({ dataDir, basePath: '/isolated/' });
    instance.server.listen(0, '127.0.0.1');
    await once(instance.server, 'listening');
    baseUrl = `http://127.0.0.1:${instance.server.address().port}/isolated/`;
  }
  await start();
  t.after(async () => {
    await instance.close();
  });
  const f = {
    dataDir,
    get instance() {
      return instance;
    },
    get baseUrl() {
      return baseUrl;
    },
    async restart() {
      await instance.close();
      await start();
    },
  };
  // Pairing is performed over the real loopback HTTP endpoint, never through auth.pair().
  const codeResponse = await fetch(route(f, 'local-pairing'), {
    method: 'POST',
    headers: { 'X-Sync-Client': 'local-admin' },
  });
  assert.equal(codeResponse.status, 200);
  const { code } = await codeResponse.json();
  const pairing = await fetch(route(f, 'pair'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, deviceName: 'isolated-media-http-test' }),
  });
  assert.equal(pairing.status, 201);
  const { token } = await pairing.json();
  f.token = token;
  return f;
}
async function request(f, suffix, { method = 'GET', json, headers, body } = {}) {
  return fetch(route(f, suffix), {
    method,
    headers: {
      Authorization: `Bearer ${f.token}`,
      ...(json ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: json ? JSON.stringify(json) : body,
  });
}
async function readJson(f, suffix, json = {}) {
  const response = await request(f, suffix, { method: 'POST', json });
  assert.equal(response.status, 200);
  return response.json();
}
const helperOptions = (f) => ({ baseUrl: f.baseUrl, token: f.token });

test('empty attachment is explicitly rejected before upload rather than becoming a broken preview', async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    uploadAsset({
      ...helperOptions(f),
      assetId: 'empty-original',
      bytes: new Uint8Array(),
      name: 'empty.txt',
      mime: 'text/plain',
    }),
    (error) => error.statusCode === 413,
  );
  const response = await request(f, 'media/assets/empty-original/content');
  assert.equal(response.status, 404);
});

test('real paired HTTP preserves PNG/GIF/video originals, serves exact ranges and publishes each asset once', async (t) => {
  const f = await fixture(t);
  const samples = [
    [
      'png-original',
      'image/png',
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJZUAAAAASUVORK5CYII=',
        'base64',
      ),
    ],
    [
      'gif-original',
      'image/gif',
      Buffer.from(
        '47494638396101000100800000000000ffffff21ff0b4e45545343415045322e30030100000021f90400010000002c000000000100010000020244010021f90400010000002c00000000010001000002024401003b',
        'hex',
      ),
    ],
    [
      'video-original',
      'video/mp4',
      Buffer.concat([
        Buffer.from('000000186674797069736f6d0000020069736f6d69736f32', 'hex'),
        Buffer.alloc(300001, 42),
      ]),
    ],
  ];
  for (const [assetId, mime, bytes] of samples) {
    const metadata = await uploadAsset({
      ...helperOptions(f),
      assetId,
      bytes,
      mime,
      name: '原件.bin',
    });
    assert.equal(metadata.sha256, hash(bytes));
    assert.equal(metadata.size, bytes.length);
    assert.equal(metadata.mime, mime);
    assert.equal('contentPath' in metadata, false);
    assert.deepEqual(
      Buffer.from(await downloadAsset({ ...helperOptions(f), assetId, sha256: hash(bytes) })),
      bytes,
    );
    const range = await request(f, `media/assets/${assetId}/content`, {
      headers: { Range: 'bytes=2-8' },
    });
    assert.equal(range.status, 206);
    assert.equal(range.headers.get('content-range'), `bytes 2-8/${bytes.length}`);
    assert.equal(range.headers.get('accept-ranges'), 'bytes');
    assert.deepEqual(Buffer.from(await range.arrayBuffer()), bytes.subarray(2, 9));
    // A repeated begin/complete sequence must not publish a second change.
    await uploadAsset({ ...helperOptions(f), assetId, bytes, mime });
    const unauthenticated = await fetch(route(f, `media/assets/${assetId}/content`));
    assert.equal(unauthenticated.status, 401);
  }
  const changes = await readJson(f, 'pull');
  const snapshot = await readJson(f, 'snapshot');
  assert.equal(changes.changes.length, samples.length);
  assert.equal(snapshot.entities.length, samples.length);
  for (const [assetId, , bytes] of samples) {
    const entities = snapshot.entities.filter(
      (entity) => entity.entityType === 'asset' && entity.entityId === assetId,
    );
    assert.equal(entities.length, 1);
    assert.equal(entities[0].data.sha256, hash(bytes));
    assert.equal(changes.changes.filter((change) => change.entity.entityId === assetId).length, 1);
  }
  assert.deepEqual((await readJson(f, 'pull', { cursor: changes.cursor })).changes, []);
  const invalidRange = await request(f, 'media/assets/png-original/content', {
    headers: { Range: 'bytes=999999-' },
  });
  assert.equal(invalidRange.status, 416);
  const suffixRange = await request(f, 'media/assets/png-original/content', {
    headers: { Range: 'bytes=-5' },
  });
  assert.equal(suffixRange.status, 416);
});

test('real HTTP resumes after service reopen and retries a chunk whose accepted ACK was lost', async (t) => {
  const f = await fixture(t);
  const bytes = Uint8Array.from({ length: 700003 }, (_, index) => index % 251);
  const begin = await request(f, 'media/uploads', {
    method: 'POST',
    json: { assetId: 'http-resume', sha256: hash(bytes), size: bytes.length, mime: 'video/mp4' },
  });
  assert.equal(begin.status, 201);
  const status = await begin.json();
  const firstChunk = bytes.subarray(0, status.chunkSize);
  assert.equal(
    (
      await request(f, `media/uploads/${status.uploadId}/chunks/0`, {
        method: 'PUT',
        body: firstChunk,
        headers: { 'X-Chunk-Sha256': hash(firstChunk) },
      })
    ).status,
    200,
  );
  await f.restart();
  const recovered = await request(f, `media/uploads/${status.uploadId}`);
  assert.equal(recovered.status, 200);
  assert.deepEqual((await recovered.json()).receivedChunks, [0]);
  let lostAck = false;
  const uploadedIndices = [];
  const fetchImpl = async (url, options) => {
    const response = await fetch(url, options);
    const match = new URL(url).pathname.match(/\/chunks\/(\d+)$/);
    if (match) {
      uploadedIndices.push(Number(match[1]));
      if (!lostAck) {
        assert.equal(response.status, 200);
        await response.arrayBuffer();
        lostAck = true;
        throw new Error('Synthetic network loss after real accepted chunk');
      }
    }
    return response;
  };
  const result = await uploadAsset({
    ...helperOptions(f),
    assetId: 'http-resume',
    bytes,
    mime: 'video/mp4',
    fetchImpl,
  });
  assert.equal(result.sha256, hash(bytes));
  assert.equal(lostAck, true);
  assert.deepEqual(uploadedIndices, [1, 1, 2]);
  assert.deepEqual(
    Buffer.from(await downloadAsset({ ...helperOptions(f), assetId: 'http-resume' })),
    Buffer.from(bytes),
  );
  assert.equal((await readJson(f, 'pull')).changes.length, 1);
  assert.equal((await readJson(f, 'snapshot')).entities.length, 1);
});

test('real HTTP restart publishes durable pending manifests and repeats committed publication idempotently', async (t) => {
  const f = await fixture(t);
  const bytes = Buffer.from('Pending original survives failure between two independent databases.');
  f.instance.store.publishAsset = () => {
    throw new Error('Synthetic failure before main publication');
  };
  await assert.rejects(
    uploadAsset({ ...helperOptions(f), assetId: 'pending-before', bytes, retries: 0 }),
    { statusCode: 500 },
  );
  assert.equal((await readJson(f, 'snapshot')).entities.length, 0);
  assert.equal((await request(f, 'media/assets/pending-before')).status, 200);
  assert.deepEqual(
    (await f.instance.media.listUnpublished()).map((asset) => asset.assetId),
    ['pending-before'],
  );
  await f.restart();
  assert.equal((await readJson(f, 'pull')).changes.length, 1);
  assert.equal((await readJson(f, 'snapshot')).entities.length, 1);
  assert.deepEqual(await f.instance.media.listUnpublished(), []);
  assert.deepEqual(
    Buffer.from(await downloadAsset({ ...helperOptions(f), assetId: 'pending-before' })),
    bytes,
  );

  f.instance.media.markPublished = async () => {
    throw new Error('Synthetic failure after main publication');
  };
  await assert.rejects(
    uploadAsset({
      ...helperOptions(f),
      assetId: 'pending-after',
      bytes: Buffer.from('Second pending original'),
      retries: 0,
    }),
    { statusCode: 500 },
  );
  const publishedBeforeRestart = await readJson(f, 'pull');
  assert.equal(publishedBeforeRestart.changes.length, 2);
  await f.restart();
  assert.equal((await readJson(f, 'pull')).changes.length, 2);
  assert.equal((await readJson(f, 'snapshot')).entities.length, 2);
  assert.deepEqual(
    (await readJson(f, 'pull', { cursor: publishedBeforeRestart.cursor })).changes,
    [],
  );
  assert.deepEqual(await f.instance.media.listUnpublished(), []);
});

test('active HTML and SVG originals are authenticated attachments with unchanged bytes', async (t) => {
  const f = await fixture(t);
  const originals = [
    ['html-attachment', 'text/html', '<!doctype html><script>document.title="fixture"</script>'],
    [
      'svg-attachment',
      'image/svg+xml',
      '<svg xmlns="http://www.w3.org/2000/svg"><script>document.title="fixture"</script></svg>',
    ],
  ];
  for (const [assetId, mime, content] of originals) {
    const bytes = Buffer.from(content);
    await uploadAsset({ ...helperOptions(f), assetId, mime, bytes });
    const response = await request(f, `media/assets/${assetId}/content`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-disposition'), /^attachment(?:;|$)/i);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    assert.equal((await (await request(f, `media/assets/${assetId}`)).json()).mime, mime);
  }
});
