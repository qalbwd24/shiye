import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createSyncMediaStore } from '../src/server/sync-v2/media.mjs';
import { uploadAsset, downloadAsset, sha256Bytes } from '../public/shared/sync-v2-media.js';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const temporaryRoot = path.resolve('tmp/sync-backend');
async function fixture(t, options = {}) {
  await mkdir(temporaryRoot, { recursive: true });
  const dataDir = await mkdtemp(path.join(temporaryRoot, 'media-'));
  let store = await createSyncMediaStore({ dataDir, chunkSize: 7, ...options });
  t.after(async () => {
    await store.close();
  });
  return {
    dataDir,
    get store() {
      return store;
    },
    async reopen() {
      await store.close();
      store = await createSyncMediaStore({ dataDir, chunkSize: 7, ...options });
    },
  };
}
async function send(store, assetId, bytes, mime = 'application/octet-stream') {
  const status = await store.begin({
    assetId,
    size: bytes.length,
    sha256: digest(bytes),
    mime,
    name: '../原件.bin',
  });
  for (const index of status.missingChunks)
    await store.putChunk(
      status.uploadId,
      index,
      bytes.subarray(index * status.chunkSize, (index + 1) * status.chunkSize),
    );
  return { result: await store.complete(status.uploadId), status };
}

test('PNG, animated GIF and video original bytes survive restart and range reads', async (t) => {
  const f = await fixture(t);
  const samples = [
    [
      Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex'),
      'image/png',
    ],
    [
      Buffer.from(
        '47494638396101000100800000000000ffffff21ff0b4e45545343415045322e30030100000021f90400010000002c000000000100010000020244010021f90400010000002c00000000010001000002024401003b',
        'hex',
      ),
      'image/gif',
    ],
    [
      Buffer.concat([
        Buffer.from('000000186674797069736f6d0000020069736f6d69736f32', 'hex'),
        Buffer.from('原件视频占位：不转换编码'),
      ]),
      'video/mp4',
    ],
  ];
  for (const [index, [bytes, mime]] of samples.entries()) {
    const { result } = await send(f.store, `asset-${index}`, bytes, mime);
    assert.equal(result.sha256, digest(bytes));
    assert.equal(result.mime, mime);
    assert.equal(result.name, '../原件.bin');
    assert.equal('contentPath' in result, false);
  }
  await f.reopen();
  for (const [index, [bytes]] of samples.entries()) {
    assert.deepEqual(await f.store.readContent(`asset-${index}`), bytes);
    assert.deepEqual(
      await f.store.readContent(`asset-${index}`, { start: 2, end: 8 }),
      bytes.subarray(2, 9),
    );
  }
  assert.equal((await readdir(path.join(f.dataDir, 'media/originals'))).length, 3);
});

test('missing chunk query, idempotent retries and full original hash protect completion', async (t) => {
  const f = await fixture(t);
  const bytes = Buffer.from('a resumable original with four chunks');
  const status = await f.store.begin({
    assetId: 'resume',
    sha256: digest(bytes),
    size: bytes.length,
  });
  await f.store.putChunk(status.uploadId, 0, bytes.subarray(0, 7));
  await f.store.putChunk(status.uploadId, 0, bytes.subarray(0, 7));
  await assert.rejects(f.store.putChunk(status.uploadId, 0, Buffer.alloc(7)), {
    code: 'chunk-conflict',
  });
  await assert.rejects(f.store.complete(status.uploadId), { code: 'missing-chunks' });
  await f.reopen();
  const resumed = await f.store.begin({
    assetId: 'resume',
    sha256: digest(bytes),
    size: bytes.length,
  });
  assert.equal(resumed.uploadId, status.uploadId);
  assert.deepEqual(resumed.receivedChunks, [0]);
  await assert.rejects(f.store.putChunk(status.uploadId, -1, Buffer.alloc(7)), {
    code: 'invalid-chunk-index',
  });
  await assert.rejects(f.store.putChunk(status.uploadId, 1, Buffer.alloc(2)), {
    code: 'chunk-size',
  });
  await assert.rejects(
    f.store.putChunk(status.uploadId, 1, bytes.subarray(7, 14), { sha256: '0'.repeat(64) }),
    { code: 'chunk-hash-mismatch' },
  );
  for (const index of resumed.missingChunks)
    await f.store.putChunk(status.uploadId, index, bytes.subarray(index * 7, (index + 1) * 7));
  assert.equal((await f.store.complete(status.uploadId)).sha256, digest(bytes));
  assert.deepEqual(await f.store.complete(status.uploadId), await f.store.getAsset('resume'));
  await assert.rejects(f.store.putChunk(status.uploadId, 0, Buffer.alloc(7)), {
    code: 'chunk-conflict',
  });
  const invalid = await f.store.begin({ assetId: 'bad-hash', sha256: '0'.repeat(64), size: 3 });
  await f.store.putChunk(invalid.uploadId, 0, Buffer.from('bad'));
  await assert.rejects(f.store.complete(invalid.uploadId), { code: 'hash-mismatch' });
  await assert.rejects(f.store.getAsset('bad-hash'), { statusCode: 404 });
  assert.equal((await f.store.status(invalid.uploadId)).status, 'uploading');
});

test('asset identity is immutable, hash reuse is library-local and publish outbox is durable', async (t) => {
  const f = await fixture(t);
  const bytes = Buffer.from('one immutable original');
  await send(f.store, 'original', bytes);
  await assert.rejects(
    f.store.begin({ assetId: 'original', sha256: '0'.repeat(64), size: bytes.length }),
    { statusCode: 409 },
  );
  const reused = await f.store.begin({
    assetId: 'avatar',
    sha256: digest(bytes),
    size: bytes.length,
    mime: 'image/png',
    name: '头像.png',
  });
  assert.equal(reused.status, 'complete');
  assert.equal((await readdir(path.join(f.dataDir, 'media/originals'))).length, 1);
  await f.store.markPublished('original');
  await f.reopen();
  assert.deepEqual(
    (await f.store.listUnpublished()).map((asset) => asset.assetId),
    ['avatar'],
  );
  await f.store.markPublished('avatar');
  await f.store.markPublished('avatar');
  assert.deepEqual(await f.store.listUnpublished(), []);
  const other = await fixture(t);
  const isolated = await other.store.begin({
    assetId: 'avatar',
    sha256: digest(bytes),
    size: bytes.length,
  });
  assert.equal(isolated.status, 'uploading');
});

test('durable finalize intent recovers after bytes rename but before asset transaction', async (t) => {
  const f = await fixture(t);
  const bytes = Buffer.from('crash window original');
  const started = await f.store.begin({
    assetId: 'crash',
    sha256: digest(bytes),
    size: bytes.length,
  });
  for (const index of started.missingChunks)
    await f.store.putChunk(started.uploadId, index, bytes.subarray(index * 7, (index + 1) * 7));
  await f.store.close();
  const db = new DatabaseSync(path.join(f.dataDir, 'media/media.sqlite'));
  db.prepare("UPDATE uploads SET state='finalizing' WHERE upload_id=?").run(started.uploadId);
  db.close();
  await writeFile(path.join(f.dataDir, 'media/originals', digest(bytes)), bytes);
  await writeFile(path.join(f.dataDir, 'media/staging/unknown.keep'), 'not owned');
  await f.reopen();
  assert.deepEqual(await f.store.readContent('crash'), bytes);
  assert.deepEqual(
    (await f.store.listUnpublished()).map((asset) => asset.assetId),
    ['crash'],
  );
  assert.deepEqual(await readdir(path.join(f.dataDir, 'media/staging')), ['unknown.keep']);
});

test('media identifiers, bounds and metadata cannot choose storage paths', async (t) => {
  const f = await fixture(t, { maxBytes: 100 });
  for (const assetId of ['../escape', 'a/b', 'a\\b', 'C:drive', '', '\u0000']) {
    await assert.rejects(f.store.begin({ assetId, sha256: '0'.repeat(64), size: 1 }), {
      code: 'invalid-id',
    });
    await assert.rejects(f.store.getAsset(assetId), { code: 'invalid-id' });
  }
  for (const size of [0, -1, 101, 1.5])
    await assert.rejects(f.store.begin({ assetId: 'size', sha256: '0'.repeat(64), size }), {
      code: 'invalid-size',
    });
  await assert.rejects(
    f.store.begin({
      assetId: 'mime',
      sha256: '0'.repeat(64),
      size: 1,
      mime: 'image/png\r\nInjected: header',
    }),
    { code: 'invalid-mime' },
  );
  await send(f.store, 'range', Buffer.from('original'));
  await assert.rejects(f.store.readContent('range', { start: -1 }), { statusCode: 416 });
});

test('HTTP-safe SHA-256 fallback matches standard hashes including block boundaries', () => {
  for (const size of [0, 1, 55, 56, 63, 64, 65, 127, 128, 129, 1048599]) {
    const bytes = Uint8Array.from({ length: size }, (_, index) => (index * 31) % 256);
    assert.equal(sha256Bytes(bytes), digest(bytes));
  }
});

test('client helper resumes missing chunks, retries lost ACK and verifies range download', async (t) => {
  const f = await fixture(t, { chunkSize: 262144 });
  const bytes = Uint8Array.from({ length: 1048599 }, (_, index) => index % 251);
  const initial = await f.store.begin({
    assetId: 'client',
    sha256: digest(bytes),
    size: bytes.length,
    mime: 'image/gif',
  });
  await f.store.putChunk(initial.uploadId, 0, bytes.subarray(0, initial.chunkSize));
  const calls = [];
  let lostAck = false;
  let downloadFailure = false;
  const fetchImpl = async (url, options = {}) => {
    assert.equal(options.headers.Authorization, 'Bearer test-only-token');
    const pathname = new URL(url).pathname;
    calls.push({ pathname, method: options.method ?? 'GET' });
    assert.ok(pathname.startsWith('/prefix/api/sync/v1/media/'));
    const suffix = pathname.slice('/prefix/api/sync/v1/media'.length);
    if (suffix === '/uploads') return Response.json(await f.store.begin(JSON.parse(options.body)));
    const chunk = suffix.match(/^\/uploads\/([^/]+)\/chunks\/(\d+)$/);
    if (chunk) {
      const result = await f.store.putChunk(chunk[1], Number(chunk[2]), options.body, {
        sha256: options.headers['X-Chunk-Sha256'],
      });
      if (!lostAck) {
        lostAck = true;
        throw new Error('synthetic lost ACK');
      }
      return Response.json(result);
    }
    const complete = suffix.match(/^\/uploads\/([^/]+)\/complete$/);
    if (complete) return Response.json(await f.store.complete(complete[1]));
    if (suffix === '/assets/client') return Response.json(await f.store.getAsset('client'));
    if (suffix === '/assets/client/content') {
      if (!downloadFailure) {
        downloadFailure = true;
        return {
          ok: true,
          arrayBuffer: async () => {
            throw new Error('synthetic interrupted response body');
          },
        };
      }
      const [, start, end] = options.headers.Range.match(/^bytes=(\d+)-(\d+)$/);
      return new Response(
        await f.store.readContent('client', { start: Number(start), end: Number(end) }),
        { status: 206 },
      );
    }
    throw new Error('Unexpected test route');
  };
  const progress = [];
  const options = {
    baseUrl: 'http://example.test/prefix/',
    token: 'test-only-token',
    assetId: 'client',
    fetchImpl,
  };
  const result = await uploadAsset({
    ...options,
    bytes,
    mime: 'image/gif',
    onProgress: (event) => progress.push(event.transferred),
  });
  assert.equal(result.sha256, digest(bytes));
  assert.equal(progress[0], 262144);
  assert.equal(progress.at(-1), bytes.length);
  assert.equal(
    calls.some((call) => call.pathname.endsWith('/chunks/0')),
    false,
  );
  assert.deepEqual(await downloadAsset({ ...options, sha256: digest(bytes) }), bytes);
  assert.equal(downloadFailure, true);
  const corruptFetch = async (url, requestOptions) => {
    const response = await fetchImpl(url, requestOptions);
    if (url.endsWith('/content')) {
      const data = new Uint8Array(await response.arrayBuffer());
      data[0] ^= 1;
      return new Response(data, { status: 206 });
    }
    return response;
  };
  await assert.rejects(
    downloadAsset({ ...options, fetchImpl: corruptFetch }),
    /SHA-256 verification/,
  );
  const blobResult = await uploadAsset({
    ...options,
    assetId: 'blob-client',
    blob: new Blob([bytes]),
    fetchImpl: async (url, requestOptions) => {
      if (url.endsWith('/media/uploads'))
        return Response.json(await f.store.begin(JSON.parse(requestOptions.body)));
      const completeId = new URL(url).pathname.match(/\/uploads\/([^/]+)\/complete$/)?.[1];
      if (completeId) return Response.json(await f.store.complete(completeId));
      throw new Error('Deduplicated Blob should not upload chunks');
    },
  });
  assert.equal(blobResult.mime, 'application/octet-stream');
  await assert.rejects(
    downloadAsset({ ...options, sha256: '0'.repeat(64) }),
    /metadata does not match/,
  );
  await assert.rejects(
    uploadAsset({ ...options, baseUrl: 'http://example.test/?token=secret', bytes }),
    /query parameters/,
  );
});
