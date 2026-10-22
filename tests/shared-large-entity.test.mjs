import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createDiaryServer } from '../src/server/app.mjs';
import {
  prepareSharedCommit,
  sharedSnapshot,
  sharedEntityRead,
} from '../src/server/shared-sync/replication.mjs';
import { createSharedBusinessClient } from '../public/shared/shared-business-client.js';
import { createMemorySyncStorage } from './helpers/sync-v2-client-memory.mjs';

test('snapshot byte bound paginates by bytes with no skipped entity and large rows use explicit descriptors', () => {
  const db = {
    entries: Array.from({ length: 8 }, (_, i) => ({
      id: `entry-${i}`,
      content: 'x'.repeat(320000),
    })),
  };
  db.entries.push({ id: 'large', history: [{ nested: '大'.repeat(200000) }] });
  prepareSharedCommit({}, db, { enabled: true });
  const ids = [];
  let afterKey;
  do {
    const page = sharedSnapshot(db, { afterKey, limit: 200 });
    assert.ok(Buffer.byteLength(JSON.stringify(page)) < 1024 * 1024);
    for (const row of page.entities) {
      ids.push(JSON.stringify([row.entityType, row.entityId]));
      if (row.entityId === 'large') {
        assert.equal(row.data, undefined);
        assert.equal(row.payload.kind, 'shared-entity-json');
      }
    }
    afterKey = page.hasMore ? page.afterKey : null;
  } while (afterKey);
  assert.equal(new Set(ids).size, db._sharedSync.entities.length);
  assert.equal(ids.length, db._sharedSync.entities.length);
  assert.throws(
    () =>
      sharedEntityRead(db, {
        entityType: 'entry',
        entityId: 'large',
        revision: 1,
        offset: 0,
        length: 262145,
      }),
    { code: 'SHARED_INVALID_ENTITY_RANGE' },
  );
});

test('real HTTP transfers >8MiB unknown/history exactly; interrupted or changed revision never advances cursor', async (t) => {
  const root = path.resolve('tmp/backend-shared-auth/large-entity');
  await mkdir(root, { recursive: true });
  const dataDir = await mkdtemp(path.join(root, 'case-')),
    id = randomUUID();
  const nested = '合成🙂'.repeat(950000),
    historyValue = '合成历史'.repeat(50000);
  await writeFile(
    path.join(dataDir, 'diary.json'),
    JSON.stringify({
      schema: 1,
      categories: ['日常'],
      media: [],
      entries: [
        {
          id,
          revision: 1,
          title: 'v1',
          content: '<p>合成</p>',
          date: '2026-10-19T00:00:00Z',
          category: '日常',
          tags: [],
          attachments: [],
          unknownFuture: { nested: [{ value: nested }] },
          history: [{ unknownFuture: { body: historyValue } }],
        },
      ],
    }),
  );
  const server = await createDiaryServer({ dataDir, seed: false, sharedSync: true });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.close();
    await once(server, 'close');
  });
  const base = `http://127.0.0.1:${server.address().port}`,
    responses = [];
  async function http(route, input, method) {
    const response = await fetch(base + route, {
      method: method || (input ? 'POST' : 'GET'),
      headers: { 'Content-Type': 'application/json', 'X-Diary-Client': 'desktop' },
      ...(input ? { body: JSON.stringify(input) } : {}),
    });
    const text = await response.text(),
      value = JSON.parse(text);
    if (route.startsWith('/api/shared/')) {
      responses.push(Buffer.byteLength(text));
      assert.ok(Buffer.byteLength(text) < 1024 * 1024);
    }
    if (!response.ok)
      throw Object.assign(Error(value.error?.code || value.error), {
        code: value.error?.code,
        status: response.status,
      });
    return value;
  }
  const info = await http('/api/shared/v1/info');
  const storage = createMemorySyncStorage();
  let mode = 'interrupt',
    chunks = 0;
  const edit = async (revision, title) =>
    http(
      '/api/entries/' + id,
      {
        revision,
        title,
        content: '<p>合成</p>',
        date: '2026-10-19T00:00:00Z',
        category: '日常',
        tags: [],
        attachments: [],
      },
      'PUT',
    );
  const request = async (action, input) => {
    if (action === 'entity-read') {
      chunks++;
      if (mode === 'interrupt' && input.offset > 0) throw Error('SYNTHETIC_CHUNK_INTERRUPTED');
      if (mode === 'change' && input.offset > 0) {
        mode = 'normal';
        await edit(2, 'v3');
      }
    }
    return http(
      '/api/shared/v1/' + (action === 'entity-read' ? 'entity/read' : action),
      action === 'info' ? undefined : input,
    );
  };
  const client = createSharedBusinessClient({
    request,
    storage,
    libraryId: info.libraryId,
    epoch: info.epoch,
  });
  await assert.rejects(() => client.receive(), /SYNTHETIC_CHUNK_INTERRUPTED/);
  assert.equal((await client.status()).cursor, null);
  assert.equal(await client.read('entry', id), undefined);
  mode = 'normal';
  await client.receive();
  assert.ok(chunks > 32);
  const record = await client.read('entry', id);
  assert.equal(record.base.data.unknownFuture.nested[0].value, nested);
  assert.equal(record.base.data.history[0].unknownFuture.body, historyValue);
  const cursor = (await client.status()).cursor;
  await edit(1, 'v2');
  mode = 'change';
  await assert.rejects(() => client.receive(), { code: 'SHARED_ENTITY_CHANGED', status: 409 });
  assert.deepEqual((await client.status()).cursor, cursor);
  assert.equal((await client.read('entry', id)).base.data.title, 'v1');
  await client.receive();
  assert.equal((await client.read('entry', id)).base.data.title, 'v3');
  assert.equal((await client.read('entry', id)).base.data.unknownFuture.nested[0].value, nested);
  assert.equal((await client.status()).pending, 0);
  assert.ok(responses.length > 64);
});

test('ref command keeps >4MiB local optimistic body out of wire; oversized descriptor fails before chunk allocation/read', async () => {
  const libraryId = randomUUID(),
    epoch = randomUUID(),
    storage = createMemorySyncStorage();
  const body = 'LOCAL_ONLY'.repeat(550000);
  const client = createSharedBusinessClient({
    storage,
    libraryId,
    epoch,
    request: async (action) => {
      if (action === 'info') return { libraryId, epoch };
      if (action === 'entity-read') assert.fail('must reject >64MiB descriptor before read');
      return {
        info: { libraryId, epoch },
        entities: [
          {
            entityType: 'entry',
            entityId: 'big',
            revision: 1,
            seq: 1,
            state: 'active',
            sha256: 'a'.repeat(64),
            payload: {
              version: 1,
              kind: 'shared-entity-json',
              byteLength: 64 * 1024 * 1024 + 1,
              sha256: 'b'.repeat(64),
              entityType: 'entry',
              entityId: 'big',
              revision: 1,
              seq: 1,
            },
          },
        ],
        next: 'x',
        hasMore: false,
      };
    },
  });
  await client.enqueue({
    operationId: randomUUID(),
    action: 'entry-save-ref',
    input: { entryId: 'big', payload: { assetId: randomUUID() } },
    optimistic: [{ entityType: 'entry', entityId: 'big', changes: { unknownFuture: body } }],
  });
  const pending = await storage.transaction((tx) => tx.listPending());
  assert.equal(JSON.stringify(pending[0].wire).includes('LOCAL_ONLY'), false);
  assert.equal((await client.read('entry', 'big')).local.data.unknownFuture, body);
  await assert.rejects(() => client.receive(), { code: 'SHARED_ENTITY_TOO_LARGE' });
  assert.equal((await client.status()).cursor, null);
  assert.equal((await client.status()).pending, 1);
});

test('chunk/hash/UTF8/identity corruption cannot enter cache or advance snapshot cursor', async () => {
  const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
  const row = {
    entityType: 'entry',
    entityId: 'one',
    revision: 1,
    seq: 1,
    state: 'active',
    sha256: 'a'.repeat(64),
    data: { unknown: 'kept' },
  };
  for (const corruption of ['chunk', 'hash', 'utf8', 'identity']) {
    const libraryId = randomUUID(),
      epoch = randomUUID(),
      info = { libraryId, epoch };
    const bytes =
      corruption === 'utf8'
        ? Buffer.from([255])
        : Buffer.from(
            JSON.stringify({ ...row, ...(corruption === 'identity' ? { entityId: 'other' } : {}) }),
          );
    const payload = {
      version: 1,
      kind: 'shared-entity-json',
      byteLength: bytes.length,
      sha256: corruption === 'hash' ? '0'.repeat(64) : hash(bytes),
      entityType: row.entityType,
      entityId: row.entityId,
      revision: 1,
      seq: 1,
    };
    const { data: _data, ...descriptor } = row;
    const client = createSharedBusinessClient({
      libraryId,
      epoch,
      storage: createMemorySyncStorage(),
      request: async (action) => {
        if (action === 'info') return info;
        if (action === 'entity-read')
          return {
            info,
            payload,
            offset: 0,
            next: bytes.length,
            done: true,
            bytesBase64: bytes.toString('base64'),
            chunkSha256: corruption === 'chunk' ? '0'.repeat(64) : hash(bytes),
          };
        return { info, entities: [{ ...descriptor, payload }], next: 'next', hasMore: false };
      },
    });
    await assert.rejects(() => client.receive(), {
      code: corruption === 'hash' ? 'SHARED_ENTITY_HASH_MISMATCH' : 'SHARED_INVALID_ENTITY_PAYLOAD',
    });
    assert.equal((await client.status()).cursor, null);
    assert.equal(await client.read('entry', 'one'), undefined);
  }
});
