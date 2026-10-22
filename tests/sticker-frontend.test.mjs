import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, webcrypto, createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { createDiaryServer } from '../src/server/app.mjs';
const gif = Buffer.from(
  '47494638396101000100800000000000ffffff21ff0b4e45545343415045322e30030100000021f904000a0000002c000000000100010000020244010021f904000a0000002c00000000010001000002024c01003b',
  'hex',
);
const source = await fs.readFile(
  new URL('../previews/telegram-chat/shiye-stickers.js', import.meta.url),
  'utf8',
);
test('shared sticker client preserves old aliases/blobs, uploads originals, dedupes, downloads and removes without changing messages', async () => {
  const dir = path.resolve('tmp/sticker-frontend/tests', randomUUID());
  await fs.mkdir(dir, { recursive: true });
  const server = await createDiaryServer({ dataDir: dir, seed: false });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const dom = new JSDOM('', { url: 'https://shiye-preview.local/', runScripts: 'outside-only' }),
    w = dom.window;
  Object.defineProperty(w, 'crypto', { value: webcrypto });
  w.Blob = Blob;
  const local = new Map();
  w.shiyeLocalAssets = {
    get: async (id) => local.get(id),
    list: async (prefix) => [...local.values()].filter((x) => x.id.startsWith(prefix)),
    put: async (x) => local.set(x.id, x),
  };
  const old = {
    id: 'sticker:old',
    name: '原动图.gif',
    blob: new Blob([gif], { type: 'image/gif' }),
    custom: 'preserve',
  };
  local.set(old.id, old);
  local.set('mapping:开心', { id: 'mapping:开心', assetId: old.id, kind: 'sticker' });
  w.eval(source);
  const request = async (route, method = 'GET', payload) => {
    const response = await fetch(base + route, {
      method,
      headers: { 'X-Diary-Client': 'desktop', 'Content-Type': 'application/json' },
      ...(method === 'GET' ? {} : { body: JSON.stringify(payload) }),
    });
    const data = await response.json();
    if (!response.ok) throw Object.assign(Error(data.error), { status: response.status });
    return data;
  };
  let offline = false,
    fromMessageCalls = 0;
  const transport = {
    stickers: async (action, payload) => {
      if (offline) throw Error('offline');
      if (action === 'media') {
        const r = await fetch(base + '/media/' + payload.mediaId, {
          headers: { Range: `bytes=${payload.offset}-${payload.offset + 262143}` },
        });
        assert.equal(r.status, 206);
        return {
          bytes: Buffer.from(await r.arrayBuffer()).toString('base64'),
          offset: payload.offset,
          mime: r.headers.get('content-type'),
        };
      }
      if (action === 'from-message') fromMessageCalls++;
      const map = {
        catalog: ['/api/stickers/catalog', 'GET'],
        collect: ['/api/stickers', 'POST'],
        update: ['/api/stickers/' + payload?.id, 'PUT'],
        'from-message': ['/api/stickers/from-message', 'POST'],
      };
      return request(...map[action], payload);
    },
    uploadSticker: async (asset) => {
      const r = await fetch(base + '/api/chat-journal/media', {
        method: 'POST',
        headers: {
          'X-Diary-Client': 'desktop',
          'Content-Type': asset.blob.type,
          'X-File-Name': encodeURIComponent(asset.name),
        },
        body: await asset.blob.arrayBuffer(),
      });
      assert.equal(r.status, 201);
      return (await r.json()).id;
    },
  };
  w.shiyeStickers.setTransport(transport);
  const library = {
    messages: {
      '-1': [{ id: 99, date: 123, media: { id: 10, type: 'document' }, replyToMsgId: 5 }],
    },
    documents: [
      {
        id: 10,
        mimeType: 'image/gif',
        bytes: Uint8Array.from(gif),
        attributes: [{ fileName: '再次收藏.gif' }],
      },
    ],
  };
  const before = structuredClone(library);
  w.shiyeStickers.setLibraryReader(async () => library);
  try {
    await w.shiyeStickers.sync();
    const linked = local.get(old.id);
    assert.ok(linked.serverStickerId);
    assert.equal(linked.custom, 'preserve');
    assert.equal(local.get('mapping:开心').assetId, old.id);
    assert.deepEqual(Buffer.from(await linked.blob.arrayBuffer()), gif);
    const first = await w.shiyeStickers.saveMessage({ roomId: '-1', messageId: '99' });
    const second = await w.shiyeStickers.saveMessage({ roomId: '-1', messageId: '99' });
    assert.equal(first.asset.id, second.asset.id);
    assert.equal((await request('/api/stickers/catalog')).items.length, 1);
    assert.deepEqual(library, before);
    const remote = (await request('/api/stickers/catalog')).items[0];
    const downloaded = await w.shiyeStickers.materialize({
      id: 'sticker:download',
      name: remote.name,
      serverStickerId: remote.id,
      serverMediaId: remote.mediaId,
      media: remote.media,
    });
    assert.deepEqual(Buffer.from(await downloaded.blob.arrayBuffer()), gif);
    assert.equal(createHash('sha256').update(gif).digest('hex'), remote.media.sha256);
    offline = true;
    await assert.rejects(w.shiyeStickers.sync(), /offline/);
    assert.equal(local.get(old.id).removed, undefined);
    assert.equal(local.get('mapping:开心').assetId, old.id);
    offline = false;
    await w.shiyeStickers.remove(linked);
    assert.equal((await request('/api/stickers/catalog')).items.length, 0);
    assert.ok(local.get(old.id).blob);
    assert.deepEqual(library, before);
    // A new explicit collect restores the existing backend identity, not a second favorite.
    const restored = await request('/api/stickers', 'POST', { mediaId: linked.serverMediaId });
    assert.equal(restored.id, linked.serverStickerId);
    await w.shiyeStickers.sync();
    assert.equal(local.get(old.id).removed, false);
    const bad = {
      ...downloaded,
      id: 'sticker:bad',
      blob: undefined,
      media: { ...remote.media, sha256: '0'.repeat(64) },
    };
    await assert.rejects(w.shiyeStickers.materialize(bad), /校验失败/);
    library.shiyeWithdrawnMessages = [{ roomId: '-1', messageId: '99' }];
    await assert.rejects(w.shiyeStickers.saveMessage({ roomId: '-1', messageId: '99' }), /不可用/);
    assert.equal(fromMessageCalls, 0);
    delete library.shiyeWithdrawnMessages;
    let committed = false;
    w.shiyeRoomUi = {
      command: async (action) => {
        assert.equal(action, 'flush');
        committed = true;
      },
    };
    w.shiyeStickers.setLibraryReader(async () => {
      assert.ok(committed, 'Read only after local write queue commits');
      return library;
    });
    transport.stickerSource = async () => {
      throw Error('合成归篇回执尚未就绪');
    };
    const pending = await w.shiyeStickers.saveMessage({
      roomId: '-1',
      messageId: '99',
      name: '首次就收藏',
      note: '待同步备注',
    });
    assert.equal(pending.localOnly, true);
    assert.ok(local.get(pending.asset.id).blob);
    assert.equal(local.get(pending.asset.id).pendingMetadata.note, '待同步备注');
    await w.shiyeStickers.sync();
    const updated = (await request('/api/stickers/catalog')).items[0];
    assert.equal(updated.name, '首次就收藏');
    assert.equal(updated.note, '待同步备注');
    assert.equal(local.get(pending.asset.id).pendingMetadata, undefined);
    assert.deepEqual(library, before);
  } finally {
    dom.window.close();
    await new Promise((r) => server.close(r));
  }
});
