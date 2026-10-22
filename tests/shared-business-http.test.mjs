import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createDiaryServer } from '../src/server/app.mjs';

async function lab(t) {
  const dir = path.resolve('tmp/shared-business-integration', randomUUID());
  await fs.mkdir(dir, { recursive: true });
  let server, url;
  const open = async () => {
    server = await createDiaryServer({ dataDir: dir, seed: false, sharedSync: true });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${server.address().port}`;
  };
  const close = async () => {
    if (server?.listening) {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
  };
  await open();
  t.after(close);
  const request = async (route, input, method = input === undefined ? 'GET' : 'POST') => {
    const response = await fetch(url + route, {
      method,
      headers: { 'X-Diary-Client': 'desktop', 'Content-Type': 'application/json' },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    });
    return { status: response.status, value: await response.json() };
  };
  const info = (await request('/api/shared/v1/info')).value;
  const command = (action, input, operationId = randomUUID()) =>
    request('/api/shared/v1/command', {
      libraryId: info.libraryId,
      epoch: info.epoch,
      operationId,
      action,
      input,
    });
  const read = () => fs.readFile(path.join(dir, 'diary.json'), 'utf8').then(JSON.parse);
  return {
    request,
    command,
    info,
    read,
    reopen: async () => {
      await close();
      await open();
    },
    dir,
  };
}
const ok = (r) => {
  assert.equal(r.status, 200, JSON.stringify(r.value));
  return r.value;
};
const entry = (title = '共同日记') => ({
  title,
  content: '<p>原有正文</p>',
  contentFormat: 'html',
  date: '2026-10-19T01:00:00.000Z',
  category: '日常',
  tags: [],
  attachments: [],
  location: '',
  mood: '平静',
  weather: '晴',
});

test('local-first Entry keeps client id, replays ACK and applies only trusted dependent revision', async (t) => {
  const f = await lab(t);
  assert.equal(f.info.capabilities.localFirstCreate.entry, true);
  const id = randomUUID(),
    createOp = randomUUID(),
    saveOp = randomUUID();
  const first = ok(
    await f.command('entry-create-local', { entryId: id, entry: { ...entry(), id } }, createOp),
  );
  assert.equal(first.result.id, id);
  await f.reopen();
  assert.equal(
    ok(await f.command('entry-create-local', { entryId: id, entry: { ...entry(), id } }, createOp))
      .replayed,
    true,
  );
  assert.equal(
    (await f.command('entry-create-local', { entryId: id, entry: { ...entry('collision'), id } }))
      .status,
    409,
  );
  assert.equal(
    (
      await f.command('entry-save-local', {
        entryId: id,
        entry: { ...entry('bad'), id },
        baseOperationId: randomUUID(),
      })
    ).status,
    409,
  );
  const saved = ok(
    await f.command(
      'entry-save-local',
      { entryId: id, entry: { ...entry('offline edit'), id }, baseOperationId: createOp },
      saveOp,
    ),
  );
  assert.equal(saved.result.revision, 2);
  assert.equal(ok(await f.request('/api/entries/' + id)).title, 'offline edit');
  assert.equal(
    ok(
      await f.command(
        'entry-save-local',
        { entryId: id, entry: { ...entry('offline edit'), id }, baseOperationId: createOp },
        saveOp,
      ),
    ).replayed,
    true,
  );
  assert.equal(
    (
      await f.command('entry-save-local', {
        entryId: id,
        entry: { ...entry('stale'), id },
        baseOperationId: createOp,
      })
    ).status,
    409,
  );
  assert.equal((await f.read()).entries.filter((row) => row.id === id).length, 1);
});

test('local-first conversation keeps source UUID and decimal room id across replay', async (t) => {
  const f = await lab(t);
  const id = `desktop:${randomUUID()}:-2000000000000000001`,
    operationId = randomUUID();
  const input = {
    conversationId: id,
    title: '离线房',
    mode: 'session',
    selfName: '我',
    category: null,
    idleHours: 5,
    description: '',
    clientMetadata: {},
  };
  const first = ok(await f.command('conversation-create-local', input, operationId));
  assert.equal(first.result.conversationId, id);
  await f.reopen();
  assert.equal(ok(await f.command('conversation-create-local', input, operationId)).replayed, true);
  assert.equal(
    (await f.command('conversation-create-local', { ...input, title: 'collision' }, operationId))
      .status,
    409,
  );
  assert.equal(
    (await f.command('conversation-create-local', { ...input, title: 'other' })).status,
    409,
  );
  const listing = ok(await f.request('/api/conversation-services/conversations'));
  assert.ok(listing.conversations.some((room) => room.conversationId === id));
});

test('local conversation update and order depend on server receipts, not caller revisions', async (t) => {
  const f = await lab(t);
  const id = `desktop:${randomUUID()}:-71`,
    createOp = randomUUID(),
    saveOp = randomUUID();
  const input = {
    conversationId: id,
    title: 'new',
    mode: 'session',
    selfName: '我',
    category: null,
    idleHours: 5,
    description: '',
    clientMetadata: {},
  };
  const created = ok(await f.command('conversation-create-local', input, createOp));
  assert.equal(created.result.revision, 1);
  const updated = ok(
    await f.command(
      'conversation-save-local',
      { ...input, title: 'edited', baseOperationId: createOp },
      saveOp,
    ),
  );
  assert.equal(updated.result.revision, 2);
  assert.equal(
    (
      await f.command('conversation-save-local', {
        ...input,
        title: 'stale',
        baseOperationId: createOp,
      })
    ).status,
    409,
  );
  const order = ok(
    await f.command('conversation-order-local', { order: [id], baseOperationId: createOp }),
  );
  assert.ok(Number.isSafeInteger(order.result.revision));
  assert.deepEqual(ok(await f.request('/api/conversation-services/conversations')).order, [id]);
  assert.equal(
    (await f.command('conversation-order-local', { order: [id], baseOperationId: randomUUID() }))
      .status,
    409,
  );
});

test('desktop writes and two shared callers use the same diary transaction, durable changes and identity after restart', async (t) => {
  const f = await lab(t);
  assert.equal(f.info.service, 'shiye-shared-business');
  const created = await f.request('/api/entries', entry());
  assert.equal(created.status, 201);
  const page = ok(
    await f.request('/api/shared/v1/pull', {
      libraryId: f.info.libraryId,
      epoch: f.info.epoch,
      after: f.info.seq,
      limit: 200,
    }),
  );
  const remote = page.changes.find(
    (r) => r.entityType === 'entry' && r.entityId === created.value.id,
  );
  assert.equal(remote.data.title, '共同日记');
  const saved = ok(
    await f.command('entry-save', {
      entryId: created.value.id,
      entry: { ...created.value, title: '安卓修改' },
    }),
  );
  assert.equal(saved.result.id, created.value.id);
  const desktop = ok(await f.request('/api/entries/' + created.value.id));
  assert.equal(desktop.title, '安卓修改');
  assert.equal(desktop.history.length, 1);
  const seq = saved.info.seq;
  await f.reopen();
  const identity = ok(await f.request('/api/shared/v1/info'));
  assert.equal(identity.libraryId, f.info.libraryId);
  assert.equal(identity.epoch, f.info.epoch);
  assert.equal(identity.seq, seq);
  assert.equal(ok(await f.request('/api/entries/' + created.value.id)).title, '安卓修改');
});

test('lost ACK replay is durable, immutable and creates no duplicate diary or plaintext receipt', async (t) => {
  const f = await lab(t),
    id = randomUUID(),
    input = entry('丢ACK');
  const first = ok(await f.command('entry-create', input, id));
  await f.reopen();
  const replay = ok(await f.command('entry-create', input, id));
  assert.equal(replay.replayed, true);
  assert.equal(replay.result.id, first.result.id);
  assert.equal(replay.info.seq, first.info.seq);
  assert.equal((await f.read()).entries.length, 1);
  const receipt = (await f.read())._sharedCommands.find((r) => r.operationId === id);
  assert.ok(!JSON.stringify(receipt).includes('原有正文'));
  assert.equal((await f.command('entry-create', entry('不同值'), id)).status, 409);
});

test('shared conversation and program settings are live in the old desktop catalog and survive restart', async (t) => {
  const f = await lab(t);
  const created = ok(
    await f.command('conversation-create', {
      title: '共享房',
      mode: 'session',
      selfName: '我',
      category: '日常',
      idleHours: 5,
    }),
  );
  const id = created.result.conversationId;
  assert.ok(id.startsWith('desktop:'));
  ok(
    await f.command('conversation-list-state', {
      conversationId: id,
      expectedRevision: 0,
      pinned: true,
    }),
  );
  ok(
    await f.command('service-settings-save', {
      conversationId: id,
      slotId: 'assistant',
      providerId: 'external-program',
      expectedBindingRevision: 0,
      expectedConfigRevision: 0,
      config: {
        enabled: true,
        title: '助手',
        kind: 'ai',
        sender: { name: '助手' },
        parameters: { temperature: 0.3 },
      },
    }),
  );
  const old = ok(await f.request('/api/conversation-services/conversations'));
  assert.equal(old.conversations.find((r) => r.conversationId === id).pinned, true);
  const programs = ok(
    await f.command('service-settings-read', { conversationId: id, slotId: 'assistant' }),
  );
  assert.equal(programs.result.config.parameters.temperature, 0.3);
  await f.reopen();
  assert.equal(
    ok(await f.command('conversation-list', {})).result.conversations.find(
      (r) => r.conversationId === id,
    ).pinned,
    true,
  );
});

test('stale writes and wrong library never commit command receipts, identities or business state', async (t) => {
  const f = await lab(t);
  const made = ok(await f.command('entry-create', entry()));
  const full = ok(await f.request('/api/entries/' + made.result.id));
  ok(await f.command('entry-save', { entryId: full.id, entry: { ...full, title: '较新' } }));
  const before = await fs.readFile(path.join(f.dir, 'diary.json'), 'utf8'),
    op = randomUUID();
  assert.equal(
    (await f.command('entry-save', { entryId: full.id, entry: { ...full, title: '旧草稿' } }, op))
      .status,
    409,
  );
  assert.equal(await fs.readFile(path.join(f.dir, 'diary.json'), 'utf8'), before);
  assert.equal(
    (
      await f.request('/api/shared/v1/command', {
        libraryId: randomUUID(),
        epoch: f.info.epoch,
        operationId: randomUUID(),
        action: 'entry-create',
        input: entry(),
      })
    ).status,
    409,
  );
  assert.equal(await fs.readFile(path.join(f.dir, 'diary.json'), 'utf8'), before);
});
