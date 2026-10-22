import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createDiaryServer } from '../src/server/app.mjs';
import { appendChatMessages, saveChatRoom } from '../src/server/domain/chat-journal.mjs';
import { resolveStickerMessage } from '../src/server/domain/sticker-message-source.mjs';
import { richBody, paragraph } from './helpers/revisit-source-fixtures.mjs';

const gif = Buffer.from(
  '47494638396101000100800000000000ffffff21ff0b4e45545343415045322e30030100000021f904000a0000002c000000000100010000020244010021f904000a0000002c00000000010001000002024c01003b',
  'hex',
);
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jA2kAAAAASUVORK5CYII=',
  'base64',
);
const sourceId = '22222222-2222-4222-8222-222222222222',
  roomId = '-20';
const chat = (messageId) => ({ kind: 'chat', sourceId, roomId, messageId });
const fail = (status, message) => Object.assign(Error(message), { status });

async function laboratory(t, { messageUnits = false } = {}) {
  const root = path.resolve('tmp/sticker-message-backend');
  await fs.mkdir(root, { recursive: true });
  const dir = await fs.mkdtemp(path.join(root, 'http-'));
  let server, base;
  async function launch() {
    server = await createDiaryServer({ dataDir: dir, seed: false, messageUnits });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = 'http://127.0.0.1:' + server.address().port;
  }
  async function stop() {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
  await launch();
  t.after(stop);
  const request = async (route, method = 'GET', body) => {
    const response = await fetch(base + route, {
      method,
      headers: { 'X-Diary-Client': 'desktop', 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: await response.json() };
  };
  const upload = async (bytes = gif, type = 'image/gif') => {
    const r = await fetch(base + '/api/media', {
      method: 'POST',
      headers: {
        'X-Diary-Client': 'desktop',
        'Content-Type': type,
        'X-File-Name': encodeURIComponent(type === 'image/gif' ? '合成动画.gif' : '合成资源'),
      },
      body: bytes,
    });
    assert.equal(r.status, 201);
    return r.json();
  };
  async function register() {
    assert.equal(
      (
        await request('/api/chat-journal/rooms', 'PUT', {
          sourceId,
          id: roomId,
          title: '合成会话',
          category: '日常',
          idleHours: 5,
        })
      ).status,
      200,
    );
  }
  async function send(id, attachments) {
    const result = await request('/api/chat-journal/messages', 'POST', {
      sourceId,
      roomId,
      messages: [{ id, sentAt: '2025-10-18T00:32:00.123Z', text: '合成图片消息', attachments }],
    });
    assert.equal(result.status, 200);
    return result.data.accepted[0];
  }
  return {
    dir,
    address: () => base,
    request,
    upload,
    register,
    send,
    restart: async () => {
      await stop();
      await launch();
    },
    bytes: async (id) => Buffer.from(await (await fetch(base + '/media/' + id)).arrayBuffer()),
  };
}

test('PNG/GIF ordinary messages reuse the existing collection, preserve source bytes and survive restart', async (t) => {
  const lab = await laboratory(t),
    animated = await lab.upload(),
    image = await lab.upload(png, 'image/png');
  await lab.register();
  await lab.send('9007199254740993', [animated.id]);
  await lab.send('9007199254740994', [image.id]);
  const before = (await lab.request('/api/library')).data;
  const first = await lab.request('/api/stickers/from-message', 'POST', {
    version: 1,
    source: chat('9007199254740993'),
    name: '合成动画',
    group: '心情',
    note: '合成收藏备注',
  });
  assert.equal(first.status, 201);
  assert.equal(first.data.status, 'created');
  assert.equal(first.data.sticker.note, '合成收藏备注');
  assert.equal(first.data.media.type, 'image/gif');
  assert.equal(first.data.media.thumbnailUrl, null);
  const legacy = await lab.request('/api/stickers', 'POST', {
    mediaId: animated.id,
    name: '不要改名',
  });
  assert.deepEqual(legacy.data, first.data.sticker);
  const second = await lab.request('/api/stickers/from-message', 'POST', {
    version: 1,
    source: chat('9007199254740994'),
  });
  assert.equal(second.status, 201);
  const after = (await lab.request('/api/library')).data;
  const { stickers: _, ...withoutCollection } = after;
  assert.deepEqual(withoutCollection, { ...before });
  assert.deepEqual(await lab.bytes(animated.id), gif);
  assert.deepEqual(await lab.bytes(image.id), png);
  const catalog = (await lab.request('/api/stickers/catalog')).data;
  assert.equal(catalog.version, 1);
  assert.equal(catalog.items.length, 2);
  assert.ok(catalog.items.every((i) => i.media.url === '/media/' + i.mediaId));
  await lab.restart();
  assert.deepEqual((await lab.request('/api/stickers/catalog')).data, catalog);
  assert.deepEqual(await lab.bytes(animated.id), gif);
});

test('catalog reads do not initialize storage and message collection retains local-origin protection', async (t) => {
  const lab = await laboratory(t);
  const before = await fs.readFile(path.join(lab.dir, 'diary.json'));
  assert.deepEqual((await lab.request('/api/stickers/catalog')).data, {
    version: 1,
    limits: { maxBytes: 67108864, noteCharacters: 2000 },
    items: [],
  });
  const response = await fetch(lab.address() + '/api/stickers/from-message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version: 1, source: chat('1') }),
  });
  assert.equal(response.status, 403);
  assert.deepEqual(await fs.readFile(path.join(lab.dir, 'diary.json')), before);
});

test('concurrent mobile/desktop retries dedupe, keep user metadata and restore a soft-deleted favorite', async (t) => {
  const lab = await laboratory(t),
    media = await lab.upload();
  await lab.register();
  await lab.send('5', [media.id]);
  const input = { version: 1, source: chat('5') };
  const results = await Promise.all(
    Array.from({ length: 4 }, () => lab.request('/api/stickers/from-message', 'POST', input)),
  );
  assert.equal(results.filter((r) => r.status === 201).length, 1);
  assert.ok(results.every((r) => [200, 201].includes(r.status)));
  const first = results[0].data.sticker;
  assert.ok(results.every((r) => r.data.sticker.id === first.id));
  await lab.request('/api/stickers/' + first.id, 'PUT', {
    name: '保留我的名称',
    group: '保留分组',
    deleted: true,
  });
  assert.equal((await lab.request('/api/stickers/catalog')).data.items.length, 0);
  assert.equal((await lab.request('/api/stickers/catalog?includeDeleted=1')).data.items.length, 1);
  const restored = await lab.request('/api/stickers/from-message', 'POST', {
    ...input,
    name: '重试不覆盖名称',
  });
  assert.equal(restored.status, 200);
  assert.equal(restored.data.status, 'restored');
  assert.equal(restored.data.sticker.id, first.id);
  assert.equal(restored.data.sticker.name, '保留我的名称');
  assert.equal(restored.data.sticker.group, '保留分组');
  assert.deepEqual(await lab.bytes(media.id), gif);
});

test('multi-image selection, foreign media, wrong types and malformed identities fail without changing messages', async (t) => {
  const lab = await laboratory(t),
    image = await lab.upload(png, 'image/png'),
    animated = await lab.upload(),
    video = await lab.upload(Buffer.from('synthetic-video'), 'video/mp4'),
    foreign = await lab.upload(Buffer.from('unreferenced'), 'image/webp');
  await lab.register();
  await lab.send('10', [image.id, animated.id, video.id]);
  await lab.send('11', [video.id]);
  const before = (await lab.request('/api/library')).data;
  const failures = [
    [{ version: 1, source: chat('10') }, 400],
    [{ version: 1, source: chat('10'), mediaId: foreign.id }, 400],
    [{ version: 1, source: chat('10'), mediaId: video.id }, 400],
    [{ version: 1, source: chat('11') }, 400],
    [{ version: 1, source: chat('999') }, 404],
    [{ version: 1, source: { ...chat('10'), messageId: 10 } }, 400],
    [{ version: 2, source: chat('10') }, 400],
    [{ version: 1, source: chat('10'), unexpected: true }, 400],
    [{ version: 1, source: chat('10'), occurrenceId: 'unregistered' }, 400],
  ];
  for (const [input, status] of failures)
    assert.equal((await lab.request('/api/stickers/from-message', 'POST', input)).status, status);
  assert.deepEqual((await lab.request('/api/library')).data, before);
  assert.equal(
    (
      await lab.request('/api/stickers/from-message', 'POST', {
        version: 1,
        source: chat('10'),
        mediaId: animated.id,
      })
    ).status,
    201,
  );
  for (const query of ['?includeDeleted=yes', '?includeDeleted=1&includeDeleted=0', '?unknown=1'])
    assert.equal((await lab.request('/api/stickers/catalog' + query)).status, 400);
});

test('canonical units use exact revision and media occurrence; stale, deleted and withdrawn sources are rejected', async (t) => {
  const lab = await laboratory(t, { messageUnits: true }),
    media = await lab.upload();
  const body = richBody(paragraph('合成正文'), {
    type: 'image',
    attrs: {
      assetId: media.id,
      occurrenceId: 'appearance-1',
      insertedAt: '2025-10-18T00:31:00.000Z',
      widthRatio: 1,
      align: 'center',
      caption: '',
      alt: '',
    },
  });
  const entry = (
    await lab.request('/api/entries', 'POST', {
      title: '合成日记',
      contentFormat: 'richdoc',
      body,
      date: '2025-10-18T00:30:00.000Z',
      category: '日常',
      tags: [],
      attachments: [media.id],
    })
  ).data;
  const units = (await lab.request('/api/message-units?entryId=' + entry.id)).data.units;
  const unit = units.find((u) => u.body.content.some((n) => n.type === 'image'));
  const input = {
    version: 1,
    source: { kind: 'unit', unitId: unit.id, revision: unit.revision },
    occurrenceId: 'appearance-1',
  };
  assert.equal(
    (
      await lab.request('/api/stickers/from-message', 'POST', {
        ...input,
        source: { ...input.source, revision: unit.revision + 1 },
      })
    ).status,
    409,
  );
  assert.equal(
    (await lab.request('/api/stickers/from-message', 'POST', { ...input, occurrenceId: 'another' }))
      .status,
    400,
  );
  const before = (await lab.request('/api/library')).data;
  assert.equal((await lab.request('/api/stickers/from-message', 'POST', input)).status, 201);
  const after = (await lab.request('/api/library')).data;
  for (const key of ['entries', 'messageStore', 'media']) assert.deepEqual(after[key], before[key]);
  await lab.register();
  const receipt = await lab.send('20', [media.id]);
  const canonicalReceipt = (
    await lab.request('/api/chat-journal/receipts', 'POST', {
      sourceId,
      roomId,
      ids: ['20'],
    })
  ).data.accepted[0];
  assert.ok(canonicalReceipt.unitId);
  assert.equal(
    (
      await lab.request('/api/chat-journal/withdraw', 'POST', {
        sourceId,
        roomId,
        messageId: '20',
        expectedRevision: receipt.revision ?? 1,
        operationId: '33333333-3333-4333-8333-333333333333',
      })
    ).status,
    200,
  );
  assert.equal(
    (await lab.request('/api/stickers/from-message', 'POST', { version: 1, source: chat('20') }))
      .status,
    409,
  );
  assert.equal((await lab.request('/api/stickers/catalog')).data.items.length, 1);
  assert.equal(
    (
      await lab.request('/api/stickers/from-message', 'POST', {
        version: 1,
        source: { kind: 'unit', unitId: canonicalReceipt.unitId, revision: 2 },
      })
    ).status,
    409,
  );
  const deletion = await lab.request('/api/entries/' + entry.id, 'PUT', {
    ...entry,
    deleted: true,
  });
  assert.equal(deletion.status, 200);
  assert.equal((await lab.request('/api/stickers/from-message', 'POST', input)).status, 409);
});

test('canonical cache divergence is rejected without repairing or changing the original message', () => {
  const db = { entries: [], media: [{ id: 'gif', type: 'image/gif' }], categories: ['日常'] };
  saveChatRoom(db, { sourceId, id: roomId, title: '合成', category: '日常', idleHours: 5 });
  appendChatMessages(
    db,
    {
      sourceId,
      roomId,
      messages: [
        { id: '1', sentAt: '2025-10-18T00:32:00.000Z', text: '原始合成内容', attachments: ['gif'] },
      ],
    },
    Date.now(),
    { messageUnitsEnabled: true },
  );
  db.entries[0].chatJournal.messages[0].text = '故意损坏兼容缓存';
  const before = JSON.stringify(db);
  assert.throws(
    () => resolveStickerMessage(db, { version: 1, source: chat('1') }, fail),
    (e) => e.status === 409,
  );
  assert.equal(JSON.stringify(db), before);
});

test('disk commit failure rolls back collection, and the same source can be safely retried', async (t) => {
  const lab = await laboratory(t),
    media = await lab.upload();
  await lab.register();
  await lab.send('30', [media.id]);
  const before = await fs.readFile(path.join(lab.dir, 'diary.json'));
  const rename = fs.rename;
  try {
    fs.rename = async (from, to) => {
      if (path.dirname(from) === lab.dir)
        throw Object.assign(Error('synthetic write failure'), { code: 'EACCES' });
      return rename(from, to);
    };
    assert.equal(
      (await lab.request('/api/stickers/from-message', 'POST', { version: 1, source: chat('30') }))
        .status,
      500,
    );
  } finally {
    fs.rename = rename;
  }
  assert.deepEqual(await fs.readFile(path.join(lab.dir, 'diary.json')), before);
  assert.equal((await lab.request('/api/stickers/catalog')).data.items.length, 0);
  assert.equal(
    (await lab.request('/api/stickers/from-message', 'POST', { version: 1, source: chat('30') }))
      .status,
    201,
  );
});
