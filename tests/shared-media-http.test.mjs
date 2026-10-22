import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { createDiaryServer } from '../src/server/app.mjs';
import { createSharedMediaClient } from '../public/shared/shared-media-client.js';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function lab(t) {
  const dataDir = path.resolve('tmp/shared-media-integration', randomUUID());
  await fs.mkdir(dataDir, { recursive: true });
  let server, base;
  async function open() {
    server = await createDiaryServer({ dataDir, seed: false, sharedSync: true });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function close() {
    if (server?.listening) {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
  }
  await open();
  t.after(close);
  const info = await fetch(base + '/api/shared/v1/info').then((r) => r.json());
  async function request(action, input) {
    const res = await fetch(base + '/api/shared/v1/media/' + action, {
      method: 'POST',
      headers: { 'X-Diary-Client': 'desktop', 'Content-Type': 'application/json' },
      body: JSON.stringify({ libraryId: info.libraryId, epoch: info.epoch, ...input }),
    });
    return { status: res.status, value: await res.json() };
  }
  return {
    request,
    info,
    dataDir,
    reopen: async () => {
      await close();
      await open();
    },
    url: () => base,
  };
}
const ok = (res) => {
  assert.equal(res.status, 200, JSON.stringify(res.value));
  return res.value;
};
const metadata = (bytes) => ({
  name: '原图.gif',
  mime: 'image/gif',
  size: bytes.length,
  sha256: sha(bytes),
});
const chunk = (operationId, offset, bytes) => ({
  operationId,
  offset,
  bytesBase64: bytes.toString('base64'),
  chunkSha256: sha(bytes),
});
test('original chunks resume after restart, duplicate chunk ACK does not append twice, old media endpoint reads same bytes', async (t) => {
  const f = await lab(t),
    operationId = randomUUID(),
    bytes = Buffer.alloc(300000);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
  assert.equal(ok(await f.request('begin', { operationId, metadata: metadata(bytes) })).next, 0);
  const first = bytes.subarray(0, 180000);
  ok(await f.request('chunk', chunk(operationId, 0, first)));
  await f.reopen();
  assert.equal(
    ok(await f.request('begin', { operationId, metadata: metadata(bytes) })).next,
    first.length,
  );
  assert.equal(ok(await f.request('chunk', chunk(operationId, 0, first))).replayed, true);
  ok(await f.request('chunk', chunk(operationId, first.length, bytes.subarray(first.length))));
  const done = ok(await f.request('complete', { operationId }));
  assert.equal(done.asset.id, operationId);
  assert.equal(done.asset.sha256, sha(bytes));
  await f.reopen();
  assert.deepEqual(ok(await f.request('complete', { operationId })).asset, done.asset);
  const read = ok(await f.request('read', { assetId: done.asset.id, offset: 179990, length: 30 }));
  assert.deepEqual(Buffer.from(read.bytesBase64, 'base64'), bytes.subarray(179990, 180020));
  assert.equal(read.chunkSha256, sha(bytes.subarray(179990, 180020)));
  const old = await fetch(f.url() + '/media/' + done.asset.id);
  assert.deepEqual(Buffer.from(await old.arrayBuffer()), bytes);
  const db = JSON.parse(await fs.readFile(path.join(f.dataDir, 'diary.json'), 'utf8'));
  assert.equal(db.media.length, 1);
  assert.ok(
    db._sharedSync.entities.some((r) => r.entityType === 'media' && r.entityId === operationId),
  );
});
test('malformed hashes, wrong library, chunk holes and changed replay cannot corrupt a pending original', async (t) => {
  const f = await lab(t),
    operationId = randomUUID(),
    bytes = Buffer.from('原件原件原件');
  ok(await f.request('begin', { operationId, metadata: metadata(bytes) }));
  assert.equal((await f.request('chunk', chunk(operationId, 3, bytes.subarray(3)))).status, 409);
  assert.equal(
    (await f.request('chunk', { ...chunk(operationId, 0, bytes), chunkSha256: '0'.repeat(64) }))
      .status,
    400,
  );
  ok(await f.request('chunk', chunk(operationId, 0, bytes)));
  assert.equal(
    (await f.request('chunk', chunk(operationId, 0, Buffer.alloc(bytes.length)))).status,
    409,
  );
  assert.equal(
    (await f.request('begin', { operationId, metadata: { ...metadata(bytes), name: '改名' } }))
      .status,
    409,
  );
  assert.equal((await f.request('complete', { operationId, libraryId: randomUUID() })).status, 409);
  assert.equal(ok(await f.request('complete', { operationId })).asset.sha256, sha(bytes));
});
test('same bytes reuse existing original identity and a chosen colliding UUID cannot replace another original file', async (t) => {
  const f = await lab(t),
    bytes = Buffer.from('现存原件');
  async function upload(bytes, operationId = randomUUID()) {
    ok(await f.request('begin', { operationId, metadata: metadata(bytes) }));
    ok(await f.request('chunk', chunk(operationId, 0, bytes)));
    return ok(await f.request('complete', { operationId }));
  }
  const one = await upload(bytes),
    two = await upload(bytes);
  assert.equal(two.asset.id, one.asset.id);
  const old = Buffer.from(
    await fetch(f.url() + '/media/' + one.asset.id).then((r) => r.arrayBuffer()),
  );
  assert.equal(
    (
      await f.request('begin', {
        operationId: one.asset.id,
        metadata: metadata(Buffer.from('不同原件')),
      })
    ).status,
    409,
  );
  assert.deepEqual(
    Buffer.from(await fetch(f.url() + '/media/' + one.asset.id).then((r) => r.arrayBuffer())),
    old,
  );
});
test('missing existing duplicate never ACKs or discards the newly uploaded good original', async (t) => {
  const f = await lab(t),
    bytes = Buffer.from('唯一正确原件'),
    original = randomUUID(),
    retry = randomUUID();
  for (const operationId of [original, retry]) {
    ok(await f.request('begin', { operationId, metadata: metadata(bytes) }));
    ok(await f.request('chunk', chunk(operationId, 0, bytes)));
    if (operationId === original) {
      ok(await f.request('complete', { operationId }));
      await fs.unlink(path.join(f.dataDir, 'media', original));
    }
  }
  const failed = await f.request('complete', { operationId: retry });
  assert.equal(failed.status, 409);
  assert.equal(failed.value.error.code, 'SHARED_EXISTING_ORIGINAL_UNAVAILABLE');
  assert.deepEqual(await fs.readFile(path.join(f.dataDir, 'media', retry)), bytes);
  const db = JSON.parse(await fs.readFile(path.join(f.dataDir, 'diary.json'), 'utf8'));
  assert.equal(
    db._sharedMedia.some((row) => row.operationId === retry),
    false,
  );
});
test('streaming client resumes upload/download checkpoints and verifies every chunk and the complete original', async (t) => {
  const f = await lab(t),
    bytes = Buffer.alloc(700003);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 239;
  let failChunk = true;
  const client = createSharedMediaClient({
    ...f.info,
    request: async (action, input) => {
      const result = await f.request(action.slice(6), input);
      if (result.status !== 200)
        throw Object.assign(new Error(result.value.error?.code), {
          code: result.value.error?.code,
          status: result.status,
        });
      if (action === 'media-chunk' && failChunk) {
        failChunk = false;
        throw new Error('ACK_LOST');
      }
      return result.value;
    },
  });
  const operationId = randomUUID(),
    file = new File([bytes], '完整原件.gif', { type: 'image/gif' });
  await assert.rejects(client.upload(file, { operationId }), /ACK_LOST/);
  const asset = await client.upload(file, { operationId });
  assert.equal(asset.sha256, sha(bytes));
  const chunks = Buffer.alloc(bytes.length);
  let checkpoint = 0,
    broken = true;
  const sink = {
    checkpoint: () => checkpoint,
    read: (start, end) => chunks.subarray(start, end),
    write: (offset, value) => {
      chunks.set(value, offset);
    },
    saveCheckpoint: (offset) => {
      checkpoint = offset;
      if (broken) {
        broken = false;
        throw new Error('INTERRUPTED');
      }
    },
    finish: () => chunks,
  };
  await assert.rejects(client.download(asset, { sink }), /INTERRUPTED/);
  assert.equal(checkpoint, 262144);
  assert.deepEqual(await client.download(asset, { sink }), bytes);
  chunks[0] ^= 1;
  await assert.rejects(
    client.download(asset, { sink }),
    (e) => e.code === 'SHARED_MEDIA_HASH_MISMATCH',
  );
});
test('shared sticker collection reuses the existing business identity and media, and rejects stale cross-device edits', async (t) => {
  const f = await lab(t),
    operationId = randomUUID(),
    bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
  ok(
    await f.request('begin', {
      operationId,
      metadata: { ...metadata(bytes), name: '表情.png', mime: 'image/png' },
    }),
  );
  ok(await f.request('chunk', chunk(operationId, 0, bytes)));
  const asset = ok(await f.request('complete', { operationId })).asset;
  const command = async (action, input) => {
    const res = await fetch(f.url() + '/api/shared/v1/command', {
      method: 'POST',
      headers: { 'X-Diary-Client': 'desktop', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        libraryId: f.info.libraryId,
        epoch: f.info.epoch,
        operationId: randomUUID(),
        action,
        input,
      }),
    });
    return { status: res.status, value: await res.json() };
  };
  ok(await command('sticker-collect', { mediaId: asset.id, name: '共同收藏', group: '常用' }));
  const catalog = ok(await command('sticker-catalog', {})).result;
  const items = catalog.stickers || catalog.items;
  const sticker = items.find((item) => item.mediaId === asset.id);
  assert.ok(sticker);
  const db = JSON.parse(await fs.readFile(path.join(f.dataDir, 'diary.json'), 'utf8')),
    index = db._sharedSync.entities.find(
      (row) => row.entityType === 'sticker' && row.entityId === sticker.id,
    );
  assert.ok(index);
  ok(
    await command('sticker-update', {
      stickerId: sticker.id,
      expectedRevision: index.revision,
      value: { name: '安卓改名' },
    }),
  );
  assert.equal(
    (
      await command('sticker-update', {
        stickerId: sticker.id,
        expectedRevision: index.revision,
        value: { name: '旧PC覆盖' },
      })
    ).status,
    409,
  );
  const old = await fetch(f.url() + '/api/stickers').then((r) => r.json());
  assert.equal(old.find((row) => row.id === sticker.id).name, '安卓改名');
});
