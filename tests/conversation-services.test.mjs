import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createDiaryServer } from '../src/server/app.mjs';
import { commentLibrary } from './helpers/revisit-comment-fixtures.mjs';
import { scope } from '../src/server/conversation-services/registry.mjs';
import { deliveryToken } from '../src/server/domain/revisit/delivery/state.mjs';
import { readMessageUnits } from '../src/server/domain/message-store.mjs';

const root = path.resolve(import.meta.dirname, '..'),
  hash = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const preserved = (db) => hash([db.entries, db.media, db.messageStore, db.chatJournal, db.revisit]);
async function lab(t, { automatic = false, setup = () => {} } = {}) {
  const original = commentLibrary().db;
  original.categories.push('其他分类');
  setup(original);
  const dir = path.join(root, 'tmp/conversation-services', randomUUID());
  await fs.mkdir(path.join(dir, 'media'), { recursive: true });
  await fs.writeFile(path.join(dir, 'diary.json'), JSON.stringify(original));
  await fs.writeFile(
    path.join(dir, 'media/synthetic-image'),
    Buffer.from('synthetic-original-image'),
  );
  let server, url;
  const open = async (autoStart = automatic) => {
    server = await createDiaryServer({ dataDir: dir, seed: false, revisitAutoStart: autoStart });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${server.address().port}`;
  };
  const close = async () => {
    if (server?.listening) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  };
  await open();
  t.after(close);
  const request = async (endpoint, method = 'GET', payload, cookie = '') => {
    const response = await fetch(url + endpoint, {
      method,
      headers: { 'X-Diary-Client': 'desktop', ...(cookie ? { Cookie: cookie } : {}) },
      ...(method === 'GET' ? {} : { body: JSON.stringify(payload || {}) }),
    });
    return {
      status: response.status,
      data: await response.json(),
      cookie: response.headers.get('set-cookie')?.split(';')[0],
    };
  };
  const command = (id, action, payload = {}, cookie = '') =>
    request(
      '/api/conversation-services/request',
      'POST',
      { instanceId: id, action, payload },
      cookie,
    );
  const create = async (config = {}) => {
    const id = randomUUID();
    const r = await request('/api/conversation-services/instances', 'POST', {
      id,
      providerId: 'revisit',
      name: '合成实例',
      config: { enabled: true, mode: 'interval', ...config },
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return id;
  };
  const bind = async (id, conversationId = randomUUID()) => {
    const binding = { id: randomUUID(), conversationId, instanceId: id, expectedRevision: 0 };
    const r = await request('/api/conversation-services/bindings', 'PUT', binding);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r.data;
  };
  const read = async () => JSON.parse(await fs.readFile(path.join(dir, 'diary.json'), 'utf8'));
  return { request, command, create, bind, read, original, close, open, dir };
}
async function until(read, accept) {
  for (let i = 0; i < 300; i++) {
    const v = await read();
    if (accept(v)) return v;
    await delay(10);
  }
  throw Error('isolated service condition timed out');
}
const manual = { manual: true, from: '2026-10-17T00:00:00Z', to: '2026-10-17T03:00:00Z' };

test('instance source date floors persist independently through the fixed API', async (t) => {
  const l = await lab(t),
    before = preserved(await l.read());
  const a = await l.create({
    mode: 'daily-random',
    sourceDateFrom: '2025-10-01',
    sourceDateTo: '2025-10-31',
  });
  const b = await l.create({ mode: 'daily-random', sourceDateFrom: '2025-11-01' });
  const sa = await l.command(a, 'status'),
    sb = await l.command(b, 'status');
  assert.equal(sa.data.config.sourceDateFrom, '2025-10-01');
  assert.equal(sa.data.config.sourceDateTo, '2025-10-31');
  assert.equal(sb.data.config.sourceDateFrom, '2025-11-01');
  assert.equal(
    (
      await l.command(a, 'config', {
        expectedRevision: sa.data.config.revision,
        sourceDateFrom: null,
      })
    ).status,
    200,
  );
  assert.equal((await l.command(b, 'status')).data.config.sourceDateFrom, '2025-11-01');
  assert.equal(
    (
      await l.command(b, 'config', {
        expectedRevision: sb.data.config.revision,
        sourceDateFrom: '2025-02-30',
      })
    ).status,
    400,
  );
  await l.close();
  await l.open();
  assert.equal((await l.command(b, 'status')).data.config.sourceDateFrom, '2025-11-01');
  assert.equal(preserved(await l.read()), before);
});

test('catalog is read-only, creates independent instances idempotently and bindings reject stale or shared-instance routing', async (t) => {
  const l = await lab(t),
    before = hash(await l.read());
  const discovery = await l.request('/api/conversation-services');
  assert.deepEqual(discovery.data.providers.map((p) => p.id).sort(), [
    'external-program',
    'revisit',
  ]);
  assert.deepEqual(discovery.data.instances, []);
  assert.equal(hash(await l.read()), before);
  const id = randomUUID(),
    input = {
      id,
      providerId: 'revisit',
      name: '合成',
      config: { enabled: true, interval: { unit: 'year', count: 1 } },
    };
  assert.equal(
    (await l.request('/api/conversation-services/instances', 'POST', input)).status,
    201,
  );
  assert.equal(
    (
      await l.request('/api/conversation-services/instances', 'POST', {
        config: { interval: { count: 1, unit: 'year' }, enabled: true },
        name: '合成',
        providerId: 'revisit',
        id,
      })
    ).status,
    201,
  );
  assert.equal((await l.read()).conversationServices.instances.length, 1);
  assert.equal(
    (await l.request('/api/conversation-services/instances', 'POST', { ...input, name: '另一个' }))
      .status,
    409,
  );
  assert.equal(
    (
      await l.request('/api/conversation-services/instances', 'POST', {
        ...input,
        id: randomUUID(),
        providerId: 'unimplemented-ai',
      })
    ).status,
    400,
  );
  const binding = await l.bind(id);
  assert.equal(
    (
      await l.request('/api/conversation-services/bindings', 'PUT', {
        ...binding,
        expectedRevision: 0,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await l.request('/api/conversation-services/bindings', 'PUT', {
        id: randomUUID(),
        conversationId: randomUUID(),
        instanceId: id,
        expectedRevision: 0,
      })
    ).status,
    409,
  );
  const second = await l.create();
  const switched = await l.request('/api/conversation-services/bindings', 'PUT', {
    id: binding.id,
    conversationId: binding.conversationId,
    instanceId: second,
    expectedRevision: 1,
  });
  assert.equal(switched.status, 200);
  assert.equal(
    (
      await l.request('/api/conversation-services/bindings', 'PUT', {
        id: binding.id,
        conversationId: binding.conversationId,
        instanceId: id,
        expectedRevision: 1,
      })
    ).status,
    409,
  );
  assert.equal(preserved(await l.read()), preserved(l.original));
});

test('same sources in two instances have different delivery IDs; cursors, configuration, replies, media and withdrawals never cross', async (t) => {
  const l = await lab(t),
    a = await l.create(),
    b = await l.create();
  await l.bind(a);
  await l.bind(b);
  const untouched = hash((await l.read()).conversationServices.instances.find((x) => x.id === b));
  assert.equal((await l.command(a, 'tick', manual)).status, 200);
  assert.equal(
    hash((await l.read()).conversationServices.instances.find((x) => x.id === b)),
    untouched,
  );
  const at = await l.command(a, 'status'),
    bt = await l.command(b, 'status');
  assert.equal(bt.data.cursor, null);
  assert.equal(at.data.scope.instanceId, a);
  await l.command(b, 'tick', manual);
  const af = (await l.command(a, 'feed', { after: 0 })).data,
    bf = (await l.command(b, 'feed', { after: 0 })).data;
  assert.ok(af.deliveries.length > 0);
  assert.equal(af.deliveries.length, bf.deliveries.length);
  assert.ok(af.deliveries.every((d) => !bf.deliveries.some((x) => x.id === d.id)));
  assert.ok(af.batches.every((d) => !bf.batches.some((x) => x.id === d.id)));
  const da = af.deliveries[0],
    db = bf.deliveries.find((item) => hash(item.ref) === hash(da.ref));
  const ca = await l.command(a, 'comment', {
    operationId: 'same-operation',
    batchId: da.batchId,
    deliveryId: da.id,
    text: '实例A的评论',
  });
  const cb = await l.command(b, 'comment', {
    operationId: 'same-operation',
    batchId: db.batchId,
    deliveryId: db.id,
    text: '实例B的评论',
  });
  assert.equal(ca.status, 201, JSON.stringify(ca.data));
  assert.equal(cb.status, 201, JSON.stringify(cb.data));
  assert.notEqual(ca.data.id, cb.data.id);
  assert.ok(
    [404, 409].includes(
      (await l.command(b, 'context', { batchId: da.batchId, deliveryId: da.id })).status,
    ),
  );
  assert.equal((await l.command(b, 'source', { deliveryId: da.id })).status, 404);
  const media = af.deliveries.find((d) => d.source.media.includes('synthetic-image'));
  const image = await l.command(a, 'media', {
    deliveryId: media.id,
    assetId: 'synthetic-image',
    offset: 0,
  });
  assert.equal(image.status, 200);
  assert.equal(Buffer.from(image.data.bytes, 'base64').toString(), 'synthetic-original-image');
  assert.equal(
    (await l.command(b, 'media', { deliveryId: media.id, assetId: 'synthetic-image', offset: 0 }))
      .status,
    404,
  );
  const perEntry = await l.request(
    '/api/conversation-services/comments?entryId=' + encodeURIComponent(da.ref.entryId),
  );
  assert.deepEqual(new Set(perEntry.data.comments.map((c) => c.instanceId)), new Set([a, b]));
  const own = (await l.command(a, 'comments', { entryId: da.ref.entryId })).data;
  assert.equal(own.comments.length, 1);
  await l.command(a, 'withdraw', { operationId: 'same-operation' });
  assert.equal(
    (await l.command(a, 'comments', { entryId: da.ref.entryId })).data.comments.length,
    0,
  );
  assert.equal(
    (await l.command(b, 'comments', { entryId: db.ref.entryId })).data.comments.length,
    1,
  );
  const bState = hash((await l.read()).conversationServices.instances.find((x) => x.id === b));
  const config = (await l.command(a, 'status')).data.config;
  assert.equal(
    (
      await l.command(a, 'config', {
        expectedRevision: config.revision,
        categories: ['其他分类'],
        dailyTime: '09:30',
      })
    ).status,
    200,
  );
  assert.equal(
    hash((await l.read()).conversationServices.instances.find((x) => x.id === b)),
    bState,
  );
  const final = await l.read();
  assert.equal(preserved(final), preserved(l.original));
  assert.equal(readMessageUnits(final).length, readMessageUnits(l.original).length);
  assert.notEqual(deliveryToken(scope(final, a)), deliveryToken(scope(final, b)));
});

test('each random-day instance keeps its own reset cycle; detach and rebind preserve state and legacy data after restart', async (t) => {
  const l = await lab(t),
    a = await l.create({ mode: 'daily-random', dailyTime: '08:00' }),
    b = await l.create({ mode: 'daily-random', dailyTime: '09:00' });
  const binding = await l.bind(a);
  await l.bind(b);
  await l.command(a, 'tick');
  await l.command(b, 'tick');
  const db = await l.read(),
    one = scope(db, a).revisit,
    two = scope(db, b).revisit;
  assert.notEqual(one.randomDays[0].cycleStart, two.randomDays[0].cycleStart);
  const held = hash(one);
  const detached = await l.request('/api/conversation-services/bindings', 'PUT', {
    id: binding.id,
    conversationId: binding.conversationId,
    instanceId: null,
    expectedRevision: 1,
  });
  assert.equal(detached.status, 200);
  assert.equal((await l.command(a, 'tick')).data.disabled, true);
  assert.equal((await l.command(a, 'runner-start')).status, 409);
  assert.equal(hash(scope(await l.read(), a).revisit), held);
  await l.close();
  await l.open();
  assert.equal(hash(scope(await l.read(), a).revisit), held);
  assert.equal(
    (
      await l.request('/api/conversation-services/bindings', 'PUT', {
        id: binding.id,
        conversationId: binding.conversationId,
        instanceId: a,
        expectedRevision: 2,
      })
    ).status,
    200,
  );
  assert.equal(hash(scope(await l.read(), a).revisit), held);
  assert.equal(preserved(await l.read()), preserved(l.original));
});

test('automatic background owns one runtime per binding; stopping A leaves B running and both resume after restart', async (t) => {
  const l = await lab(t, {
    automatic: true,
    setup: (db) => {
      db.revisit.config.enabled = false;
    },
  });
  const a = await l.create(),
    b = await l.create();
  await l.bind(a);
  await l.bind(b);
  await until(
    () => l.command(a, 'runner-status'),
    (r) => !!r.data.lastSuccessAt,
  );
  await until(
    () => l.command(b, 'runner-status'),
    (r) => !!r.data.lastSuccessAt,
  );
  assert.equal((await l.command(a, 'runner-stop')).data.running, false);
  await l.command(a, 'status');
  assert.equal((await l.command(a, 'runner-status')).data.running, false);
  assert.equal((await l.command(b, 'runner-status')).data.running, true);
  const before = await l.read();
  await l.close();
  await l.open();
  await until(
    () => l.command(a, 'runner-status'),
    (r) => !!r.data.lastSuccessAt,
  );
  await until(
    () => l.command(b, 'runner-status'),
    (r) => !!r.data.lastSuccessAt,
  );
  const after = await l.read();
  for (const id of [a, b]) {
    assert.deepEqual(scope(after, id).revisit.randomDays, scope(before, id).revisit.randomDays);
    assert.ok(scope(after, id).revisit.cursor >= scope(before, id).revisit.cursor);
  }
  assert.equal(preserved(after), preserved(l.original));
});

test('instance endpoints retain authentication and reject invalid IDs, operations, archive restore and unbound automatic ticks', async (t) => {
  const l = await lab(t),
    id = await l.create();
  const unbound = await l.request(
    `/api/conversation-services/instances/${id}/revisit/tick`,
    'POST',
    {},
  );
  assert.equal(unbound.data.disabled, true);
  const manualResult = await l.request(
    `/api/conversation-services/instances/${id}/revisit/tick`,
    'POST',
    manual,
  );
  assert.equal(manualResult.status, 200);
  assert.ok(manualResult.data.created > 0);
  assert.equal((await l.command(id, '__proto__')).status, 400);
  assert.equal((await l.command('../legacy', 'status')).status, 400);
  assert.equal(
    (await l.request(`/api/conversation-services/instances/${id}/revisit/archive`, 'PUT', {}))
      .status,
    404,
  );
  assert.equal(
    (await l.request(`/api/conversation-services/instances/${id}/revisit/tick`)).status,
    404,
  );
  const password = randomUUID();
  await l.request('/api/access', 'PUT', { password });
  assert.equal((await l.command(id, 'status')).status, 401);
  assert.equal((await l.request('/api/conversation-services')).status, 401);
  const login = await l.request('/api/unlock', 'POST', { password });
  assert.equal((await l.command(id, 'status', {}, login.cookie)).status, 200);
  assert.ok(!(await fs.readFile(path.join(l.dir, 'diary.json'), 'utf8')).includes(password));
});

test('locked multi-instance startup preserves both cursors, then normal unlock resumes both without exposing credentials', async (t) => {
  const l = await lab(t, {
      setup: (db) => {
        db.revisit.config.enabled = false;
      },
    }),
    a = await l.create(),
    b = await l.create();
  await l.bind(a);
  await l.bind(b);
  const password = randomUUID();
  await l.request('/api/access', 'PUT', { password });
  const prior = await l.read();
  await l.close();
  await l.open(true);
  await delay(40);
  const locked = await l.read();
  assert.equal(scope(locked, a).revisit.cursor, scope(prior, a).revisit.cursor);
  assert.equal(scope(locked, b).revisit.cursor, scope(prior, b).revisit.cursor);
  assert.equal((await l.command(a, 'runner-status')).status, 401);
  const login = await l.request('/api/unlock', 'POST', { password });
  await until(
    () => l.command(a, 'runner-status', {}, login.cookie),
    (r) => !!r.data.lastSuccessAt,
  );
  await until(
    () => l.command(b, 'runner-status', {}, login.cookie),
    (r) => !!r.data.lastSuccessAt,
  );
  const saved = await fs.readFile(path.join(l.dir, 'diary.json'), 'utf8');
  assert.ok(!saved.includes(password));
  assert.ok(!saved.includes(login.cookie));
  assert.equal(preserved(await l.read()), preserved(l.original));
});

test('concurrent instance commits keep both independent results; restore refuses to silently discard new service state', async (t) => {
  const l = await lab(t),
    a = await l.create(),
    b = await l.create();
  await l.bind(a);
  await l.bind(b);
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, i) => l.command(i % 2 ? a : b, 'tick', manual)),
  );
  assert.ok(results.every((r) => r.status === 200));
  const db = await l.read();
  for (const id of [a, b]) {
    const state = scope(db, id).revisit;
    assert.ok(state.deliveries.length > 0);
    assert.equal(new Set(state.deliveries.map((d) => d.id)).size, state.deliveries.length);
  }
  assert.equal(preserved(db), preserved(l.original));
  const before = hash(db),
    result = await l.request('/api/restore-jobs', 'POST', { library: db, files: [] });
  assert.equal(result.status, 422);
  assert.ok(result.data.error.includes('独立会话服务状态'));
  assert.equal(hash(await l.read()), before);
});

test('unknown stored service versions fail closed without rewriting any record', async (t) => {
  const l = await lab(t, {
    setup: (db) => {
      db.conversationServices = {
        version: 99,
        revision: 0,
        instances: [],
        bindings: [],
        unknown: 'keep',
      };
    },
  });
  const before = hash(await l.read());
  assert.equal((await l.request('/api/conversation-services')).status, 409);
  assert.equal(hash(await l.read()), before);
});

test('renaming a selected category updates only the affected instance filter without resetting its progress or comments', async (t) => {
  const l = await lab(t),
    a = await l.create({ categories: ['合成分类'] }),
    b = await l.create({ categories: ['其他分类'] });
  const externalId = randomUUID();
  assert.equal(
    (
      await l.request('/api/conversation-services/instances', 'POST', {
        id: externalId,
        providerId: 'external-program',
        name: '合成AI',
        config: { kind: 'ai', parameters: { note: '独立参数' } },
      })
    ).status,
    201,
  );
  await l.bind(a);
  await l.bind(b);
  await l.command(a, 'tick', manual);
  const feed = (await l.command(a, 'feed', { after: 0 })).data,
    delivery = feed.deliveries[0];
  await l.command(a, 'comment', {
    operationId: 'keep-comment',
    batchId: delivery.batchId,
    deliveryId: delivery.id,
    text: '保留关联',
  });
  const before = await l.read(),
    old = scope(before, a).revisit,
    beforeB = hash(scope(before, b).revisit);
  const externalBefore = hash(
    before.conversationServices.instances.find((i) => i.id === externalId),
  );
  assert.equal(
    (
      await l.request('/api/taxonomy', 'POST', {
        kind: 'category',
        action: 'rename',
        from: '合成分类',
        to: '已改名',
      })
    ).status,
    200,
  );
  const after = await l.read(),
    current = scope(after, a).revisit;
  assert.deepEqual(current.config.categories, ['已改名']);
  assert.equal(current.config.revision, old.config.revision + 1);
  assert.equal(current.cursor, old.cursor);
  assert.deepEqual(current.deliveries, old.deliveries);
  assert.deepEqual(current.comments, old.comments);
  assert.equal(hash(scope(after, b).revisit), beforeB);
  assert.equal(
    hash(after.conversationServices.instances.find((i) => i.id === externalId)),
    externalBefore,
  );
  assert.equal((await l.command(a, 'source', { deliveryId: delivery.id })).data.available, true);
});
