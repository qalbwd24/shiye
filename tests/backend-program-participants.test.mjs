import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createDiaryServer } from '../src/server/app.mjs';
import {
  PROGRAM_SCOPES,
  createProgramAuth,
} from '../src/server/conversation-services/program-auth.mjs';
import { runSyntheticProgramStep } from '../src/server/conversation-services/synthetic-worker.mjs';
import { programCredential } from '../tools/program-credential.mjs';
import { commentLibrary } from './helpers/revisit-comment-fixtures.mjs';

async function lab(t, seed) {
  const root = path.resolve('tmp/backend-program-participants');
  await mkdir(root, { recursive: true });
  const dataDir = await mkdtemp(path.join(root, 'case-'));
  if (seed) {
    seed.categories = [...new Set([...seed.categories, '日常'])];
    await writeFile(path.join(dataDir, 'diary.json'), JSON.stringify(seed));
  }
  let server;
  const start = async () => {
    server = await createDiaryServer({
      dataDir,
      seed: false,
      sharedSync: true,
      sharedRemote: { enabled: true },
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
  };
  const stop = async () => {
    server.close();
    await once(server, 'close');
  };
  await start();
  t.after(stop);
  const base = () => `http://127.0.0.1:${server.address().port}`;
  async function request(
    route,
    input,
    { method = input === undefined ? 'GET' : 'POST', token, cookie, headers = {} } = {},
  ) {
    const response = await fetch(base() + route, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Diary-Client': 'desktop',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    });
    const value = await response.json();
    if (!response.ok)
      throw Object.assign(Error(value.error?.code || value.error), {
        code: value.error?.code,
        status: response.status,
      });
    return { value, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  const sourceId = randomUUID(),
    roomId = '-11',
    conversationId = `desktop:${sourceId}:${roomId}`;
  await request(
    '/api/chat-journal/rooms',
    { sourceId, id: roomId, title: '合成服务会话', category: '日常', idleHours: 5 },
    { method: 'PUT' },
  );
  const settings = async (slotId, changes = {}, previous) =>
    (
      await request('/api/conversation-services/settings/save', {
        conversationId,
        slotId,
        providerId: 'external-program',
        expectedBindingRevision: previous?.bindingRevision || 0,
        expectedConfigRevision: previous?.config.revision || 0,
        config: {
          enabled: true,
          kind: 'program',
          title: '合成独立程序',
          sender: { name: '同名程序' },
          parameters: { syntheticReply: '独立后端回复' },
          ...changes,
        },
      })
    ).value;
  const a = await settings('a'),
    b = await settings('b');
  const issue = (instanceId, scopes = [...PROGRAM_SCOPES]) =>
    server.programIssuer.issue({ instanceId, scopes });
  const aCredential = issue(a.instanceId),
    bCredential = issue(b.instanceId);
  const program = async (action, input = {}, credential = aCredential) =>
    (await request('/api/shared/v1/program/' + action, input, { token: credential.token })).value;
  return {
    dataDir,
    base,
    request,
    sourceId,
    roomId,
    conversationId,
    a,
    b,
    aCredential,
    bCredential,
    issue,
    program,
    settings,
    issuer: () => server.programIssuer,
    async restart() {
      await stop();
      await start();
    },
    async changeEpoch() {
      await stop();
      const db = JSON.parse(await readFile(path.join(dataDir, 'diary.json'), 'utf8'));
      db._sharedSync.epoch = randomUUID();
      await writeFile(path.join(dataDir, 'diary.json'), JSON.stringify(db));
      await start();
    },
  };
}

test('independent real HTTP worker participates in legacy room, survives restart/rename/rotation, and never changes owner or historical attribution', async (t) => {
  const f = await lab(t);
  const human = {
    id: '100',
    sentAt: new Date(Date.now() - 1000).toISOString(),
    text: '本人输入',
    attachments: [],
  };
  await f.request('/api/chat-journal/messages', {
    sourceId: f.sourceId,
    roomId: f.roomId,
    messages: [human],
  });
  const operationId = randomUUID();
  const result = await runSyntheticProgramStep({
    baseUrl: f.base(),
    token: f.aCredential.token,
    operationId,
  });
  assert.equal(result.executed, true);
  assert.equal(result.requests, 3);
  const feed = await f.program('feed');
  const bot = feed.messages.find((row) => row.actor?.id === `program:${f.a.instanceId}`);
  assert.equal(bot.actor.name, '同名程序');
  assert.equal(bot.actor.sourceKind, 'backend-service');
  assert.equal(bot.replyTo, feed.messages.find((row) => row.actor.kind === 'self').id);
  const raw = JSON.parse(await readFile(path.join(f.dataDir, 'diary.json'), 'utf8'));
  assert.equal(
    raw.chatJournal.rooms.find((row) => row.id === f.roomId).messageOwner || 'legacy',
    'legacy',
  );
  assert.deepEqual(
    raw.entries.flatMap((e) => e.chatJournal?.messages || []).find((m) => m.id === '100'),
    human,
  );
  assert.ok(raw.messageStore.units.some((unit) => unit.id === result.reply.messageId));
  const renamed = await f.settings('a', { sender: { name: '已改显示名' } }, f.a);
  assert.equal(
    renamed.bindingRevision,
    f.a.bindingRevision,
    'ordinary config edits do not invalidate authorization generation',
  );
  const replay = await f.program('send', {
    operationId,
    kind: 'message',
    text: '独立后端回复',
    replyToMessageId: bot.replyTo,
  });
  assert.equal(replay.messageId, result.reply.messageId);
  const next = await f.program('send', {
    operationId: randomUUID(),
    kind: 'message',
    text: '新署名',
  });
  const afterRename = await f.program('feed');
  assert.equal(afterRename.messages.find((row) => row.id === bot.id).actor.name, '同名程序');
  assert.equal(
    afterRename.messages.find((row) => row.id === next.messageId).actor.name,
    '已改显示名',
  );
  await assert.rejects(
    () =>
      f.program(
        'withdraw',
        {
          kind: 'message',
          messageId: bot.id,
          expectedRevision: bot.revision,
          operationId: randomUUID(),
        },
        f.bCredential,
      ),
    (e) => e.status === 409,
  );
  const rotated = f.issuer().rotate(f.aCredential.credentialId);
  await assert.rejects(() => f.program('info'), { code: 'PROGRAM_UNAUTHORIZED' });
  await f.restart();
  const rotatedReplay = await f.program(
    'send',
    { operationId, kind: 'message', text: '独立后端回复', replyToMessageId: bot.replyTo },
    rotated,
  );
  assert.equal(rotatedReplay.messageId, bot.id);
  await f.program(
    'withdraw',
    {
      kind: 'message',
      messageId: bot.id,
      expectedRevision: bot.revision,
      operationId: randomUUID(),
    },
    rotated,
  );
  assert.equal(
    (await f.program('feed', {}, rotated)).messages.find((row) => row.id === bot.id).state,
    'withdrawn',
  );
  await assert.rejects(
    () =>
      f.program(
        'send',
        { operationId, kind: 'message', text: '异文复用', replyToMessageId: bot.replyTo },
        rotated,
      ),
    (e) => e.status === 409,
  );
});

test('scopes, actor injection, other conversation, device credentials, disable/rebind/revoke and independent frontend password boundaries', async (t) => {
  const f = await lab(t),
    readOnly = f.issue(f.a.instanceId, ['read', 'feed']);
  const before = await readFile(path.join(f.dataDir, 'diary.json'), 'utf8');
  await assert.rejects(
    () =>
      f.program(
        'send',
        { operationId: randomUUID(), kind: 'message', text: 'forbidden' },
        readOnly,
      ),
    { code: 'PROGRAM_SCOPE_FORBIDDEN' },
  );
  await assert.rejects(
    () =>
      f.program('send', {
        operationId: randomUUID(),
        kind: 'message',
        text: 'forged',
        actorId: 'self',
      }),
    { code: 'PROGRAM_ACTOR_FORBIDDEN' },
  );
  await assert.rejects(() => f.program('read', { conversationId: `desktop:${randomUUID()}:-1` }), {
    code: 'PROGRAM_CONVERSATION_FORBIDDEN',
  });
  assert.equal(await readFile(path.join(f.dataDir, 'diary.json'), 'utf8'), before);
  const code = (
    await f.request(
      '/api/shared/v1/auth/local-pairing',
      {},
      { headers: { 'X-Sync-Client': 'local-admin' } },
    )
  ).value.code;
  const device = (
    await f.request('/api/shared/v1/auth/pair', { code, deviceName: 'frontend fixture' })
  ).value;
  await assert.rejects(() => f.program('info', {}, device), { code: 'PROGRAM_UNAUTHORIZED' });
  const info = (await f.request('/api/shared/v1/info', undefined, { token: device.token })).value;
  await assert.rejects(
    () =>
      f.request(
        '/api/shared/v1/command',
        {
          libraryId: info.libraryId,
          epoch: info.epoch,
          operationId: randomUUID(),
          action: 'conversation-send',
          input: {
            conversationId: f.conversationId,
            actorId: `program:${f.a.instanceId}`,
            kind: 'message',
            text: 'spoof',
            operationId: randomUUID(),
          },
        },
        { token: device.token },
      ),
    { code: 'SHARED_PROGRAM_ACTOR_FORBIDDEN' },
  );
  const disabled = await f.settings('a', { enabled: false }, f.a);
  await assert.rejects(() => f.program('info'), { code: 'PROGRAM_BINDING_INACTIVE' });
  const enabled = await f.settings('a', { enabled: true }, disabled);
  assert.equal((await f.program('info')).actorId, `program:${f.a.instanceId}`);
  const detached = (
    await f.request('/api/conversation-services/settings/save', {
      conversationId: f.conversationId,
      slotId: 'a',
      providerId: null,
      expectedBindingRevision: enabled.bindingRevision,
    })
  ).value;
  await f.settings('a', {}, { ...detached, config: enabled.config });
  await assert.rejects(() => f.program('info'), { code: 'PROGRAM_BINDING_INACTIVE' });
  const renewed = f.issue(f.a.instanceId);
  assert.equal((await f.program('info', {}, renewed)).instanceId, f.a.instanceId);
  const lock = await f.request(
    '/api/access',
    { password: 'synthetic backend password' },
    { method: 'PUT' },
  );
  await f.request('/api/lock', {}, { cookie: lock.cookie });
  await assert.rejects(
    () =>
      f.request('/api/conversation-services/conversations/state', {
        conversationId: f.conversationId,
      }),
    (e) => e.status === 401,
  );
  await f.program(
    'send',
    { operationId: randomUUID(), kind: 'message', text: '前端锁定但后台显式授权继续' },
    renewed,
  );
  f.issuer().revoke(renewed.credentialId);
  await assert.rejects(() => f.program('info', {}, renewed), { code: 'PROGRAM_UNAUTHORIZED' });
  await f.restart();
  await assert.rejects(() => f.program('info', {}, renewed), { code: 'PROGRAM_UNAUTHORIZED' });
});

test('service legacy compatibility does not relax old-time or hand-maintained segment protection', async (t) => {
  const f = await lab(t),
    now = Date.now();
  await f.request('/api/chat-journal/messages', {
    sourceId: f.sourceId,
    roomId: f.roomId,
    messages: [
      { id: '100', sentAt: new Date(now - 1000).toISOString(), text: '本人原文', attachments: [] },
    ],
  });
  await assert.rejects(
    () =>
      f.program('send', {
        kind: 'message',
        operationId: randomUUID(),
        text: '不得回写旧时',
        sentAt: new Date(now - 2000).toISOString(),
      }),
    (e) => e.status === 409,
  );
  const raw = JSON.parse(await readFile(path.join(f.dataDir, 'diary.json'), 'utf8'));
  const entry = raw.entries.find((row) => row.chatJournal?.sourceId === f.sourceId);
  await f.request(
    '/api/entries/' + entry.id,
    { ...entry, title: '本人手工维护标题' },
    { method: 'PUT' },
  );
  const before = await readFile(path.join(f.dataDir, 'diary.json'), 'utf8');
  await assert.rejects(
    () => f.program('send', { kind: 'message', operationId: randomUUID(), text: '不得改手工归篇' }),
    { code: 'PROGRAM_SEGMENT_PROTECTED' },
  );
  assert.equal(await readFile(path.join(f.dataDir, 'diary.json'), 'utf8'), before);
  await assert.rejects(
    () =>
      f.program('send', {
        kind: 'message',
        operationId: randomUUID(),
        text: '不假实现重编辑',
        replacementOf: '100',
      }),
    { code: 'PROGRAM_REPLACEMENT_UNSUPPORTED' },
  );
});

test('media upload/chunks/read are scoped to the service or visible conversation; nonreferenced library assets are inaccessible', async (t) => {
  const f = await lab(t),
    operationId = randomUUID(),
    bytes = Buffer.from('synthetic image'),
    sha256 = createHash('sha256').update(bytes).digest('hex');
  await f.program('media/begin', {
    operationId,
    metadata: { name: 'fixture.png', mime: 'image/png', size: bytes.length, sha256 },
  });
  await assert.rejects(
    () =>
      f.program(
        'media/chunk',
        { operationId, offset: 0, bytesBase64: bytes.toString('base64'), chunkSha256: sha256 },
        f.bCredential,
      ),
    { code: 'PROGRAM_MEDIA_FORBIDDEN' },
  );
  await f.program('media/chunk', {
    operationId,
    offset: 0,
    bytesBase64: bytes.toString('base64'),
    chunkSha256: sha256,
  });
  const asset = (await f.program('media/complete', { operationId })).asset;
  await assert.rejects(
    () => f.program('media/read', { assetId: asset.id, offset: 0, length: 100 }, f.bCredential),
    { code: 'PROGRAM_MEDIA_FORBIDDEN' },
  );
  assert.equal(
    (await f.program('media/read', { assetId: asset.id, offset: 0, length: 100 })).bytesBase64,
    bytes.toString('base64'),
  );
  const sent = await f.program('send', {
    operationId: randomUUID(),
    kind: 'message',
    text: '图片说明',
    attachments: [asset.id],
  });
  assert.ok(sent.messageId);
  const otherConversation = `desktop:${f.sourceId}:-22`;
  await f.request(
    '/api/chat-journal/rooms',
    { sourceId: f.sourceId, id: '-22', title: '其他授权范围', category: '日常', idleHours: 5 },
    { method: 'PUT' },
  );
  const other = (
    await f.request('/api/conversation-services/settings/save', {
      conversationId: otherConversation,
      slotId: 'c',
      providerId: 'external-program',
      expectedBindingRevision: 0,
      expectedConfigRevision: 0,
      config: { enabled: true, title: '同名程序', sender: { name: '同名程序' }, parameters: {} },
    })
  ).value;
  await assert.rejects(
    () =>
      f.program(
        'media/read',
        { assetId: asset.id, offset: 0, length: 100 },
        f.issue(other.instanceId),
      ),
    { code: 'PROGRAM_MEDIA_FORBIDDEN' },
  );
  assert.equal(
    (await f.program('media/read', { assetId: asset.id, offset: 0, length: 100 }, f.bCredential))
      .bytesBase64,
    bytes.toString('base64'),
  );
  const pairing = (
    await f.request(
      '/api/shared/v1/auth/local-pairing',
      {},
      { headers: { 'X-Sync-Client': 'local-admin' } },
    )
  ).value;
  const device = (
    await f.request('/api/shared/v1/auth/pair', { code: pairing.code, deviceName: 'media owner' })
  ).value;
  const info = (await f.request('/api/shared/v1/info', undefined, { token: device.token })).value;
  const outsideOp = randomUUID(),
    metadata = { name: 'outside.png', mime: 'image/png', size: bytes.length, sha256 };
  const outside = { libraryId: info.libraryId, epoch: info.epoch, operationId: outsideOp };
  await f.request('/api/shared/v1/media/begin', { ...outside, metadata }, { token: device.token });
  await assert.rejects(() => f.program('media/begin', { operationId: outsideOp, metadata }), {
    code: 'PROGRAM_MEDIA_FORBIDDEN',
  });
  await f.request(
    '/api/shared/v1/media/chunk',
    { ...outside, offset: 0, bytesBase64: bytes.toString('base64'), chunkSha256: sha256 },
    { token: device.token },
  );
  await f.request('/api/shared/v1/media/complete', outside, { token: device.token });
  await assert.rejects(() => f.program('media/begin', { operationId: outsideOp, metadata }), {
    code: 'PROGRAM_MEDIA_FORBIDDEN',
  });
  const raw = await readFile(path.join(f.dataDir, 'diary.json'), 'utf8');
  assert.equal(raw.includes(f.aCredential.token), false);
  assert.equal(
    (await readFile(path.join(f.dataDir, '.program-auth', 'credentials.sqlite'))).includes(
      Buffer.from(f.aCredential.token),
    ),
    false,
  );
});

test('scoped program reads explicit history context, comments as itself, and only withdraws its own comment; unrelated source cannot be requested', async (t) => {
  const seed = commentLibrary().db;
  seed.chatJournal.rooms = [];
  seed.entries = seed.entries.filter((entry) => !entry.chatJournal);
  const f = await lab(t, seed);
  const history = (
    await f.request('/api/conversation-services/settings/save', {
      conversationId: f.conversationId,
      slotId: 'history',
      providerId: 'revisit',
      expectedBindingRevision: 0,
      expectedConfigRevision: 0,
      config: {
        enabled: true,
        title: '合成回看',
        mode: 'interval',
        interval: { count: 1, unit: 'year' },
        timeZone: 'Asia/Shanghai',
        categories: [],
        sender: { name: '合成回看' },
      },
    })
  ).value;
  await f.request('/api/conversation-services/request', {
    instanceId: history.instanceId,
    action: 'tick',
    payload: { manual: true, from: '2026-10-17T00:00:00Z', to: '2026-10-17T03:00:00Z' },
  });
  const feed = await f.program('feed'),
    delivery = feed.messages.find((row) => row.kind === 'history' && row.state === 'active');
  assert.ok(delivery);
  const displayedTarget = {
    instanceId: history.instanceId,
    batchId: delivery.batchId,
    deliveryId: delivery.deliveryId,
  };
  assert.ok(await f.program('context', { displayedTarget }));
  const operationId = randomUUID();
  const beforeMissing = await readFile(path.join(f.dataDir, 'diary.json'), 'utf8');
  await assert.rejects(
    () => f.program('withdraw', { kind: 'comment', instanceId: history.instanceId, operationId }),
    { status: 404, code: 'PROGRAM_COMMENT_NOT_FOUND' },
  );
  // No tombstone, shared index advance or operation receipt may survive denial.
  assert.equal(await readFile(path.join(f.dataDir, 'diary.json'), 'utf8'), beforeMissing);
  const comment = await f.program('send', {
    kind: 'comment',
    operationId,
    text: '程序对明确来源评论',
    displayedTarget,
  });
  assert.equal(comment.message.author.id, `program:${f.a.instanceId}`);
  assert.equal(comment.message.author.sourceKind, 'backend-service');
  await assert.rejects(
    () =>
      f.program('context', { displayedTarget: { ...displayedTarget, instanceId: f.b.instanceId } }),
    (e) => [400, 409].includes(e.status),
  );
  await assert.rejects(
    () =>
      f.program(
        'withdraw',
        { kind: 'comment', instanceId: history.instanceId, operationId },
        f.bCredential,
      ),
    (e) => e.status === 409,
  );
  await f.program('withdraw', { kind: 'comment', instanceId: history.instanceId, operationId });
  await f.program('withdraw', { kind: 'comment', instanceId: history.instanceId, operationId });
  assert.equal(
    (await f.program('feed')).messages.find((row) => row.operationId === operationId).state,
    'withdrawn',
  );
  const adminOperationId = randomUUID();
  await f.request('/api/conversation-services/conversations/withdraw', {
    conversationId: f.conversationId,
    kind: 'comment',
    instanceId: history.instanceId,
    operationId: adminOperationId,
  });
  assert.equal(
    (await f.program('feed')).messages.find((row) => row.operationId === adminOperationId).state,
    'withdrawn',
  );
  await assert.rejects(() => f.program('entry/read', { entryId: 'canonical' }), {
    code: 'PROGRAM_ACTION_FORBIDDEN',
  });
});

test('trusted private CLI issues actual HTTP credential; AI is not executed, and token cannot cross libraries or survive epoch change', async (t) => {
  const f = await lab(t),
    output = path.join(f.dataDir, '.program-auth', 'fixture.credential.json');
  const receipt = await programCredential({
    dataDir: f.dataDir,
    action: 'issue',
    instanceId: f.a.instanceId,
    scopes: ['read', 'feed', 'send', 'reply'],
    output,
  });
  assert.equal(Object.hasOwn(receipt, 'token'), false);
  const credential = JSON.parse(await readFile(output, 'utf8'));
  assert.equal((await f.program('info', {}, credential)).actorId, `program:${f.a.instanceId}`);
  await f.settings('a', { kind: 'ai' }, f.a);
  const result = await runSyntheticProgramStep({ baseUrl: f.base(), token: credential.token });
  assert.equal(result.executed, false);
  assert.equal(result.reason, 'AI_PROVIDER_NOT_EXECUTED');
  assert.equal(result.requests, 1);
  const other = await lab(t);
  await assert.rejects(() => other.program('info', {}, credential), {
    code: 'PROGRAM_UNAUTHORIZED',
  });
  await assert.rejects(
    () =>
      f.request(
        '/api/shared/v1/program/info',
        {},
        { token: credential.token, headers: { Origin: 'https://invalid.example' } },
      ),
    { code: 'ORIGIN_NOT_ALLOWED' },
  );
  await programCredential({
    dataDir: f.dataDir,
    action: 'revoke',
    credentialId: receipt.credentialId,
  });
  await assert.rejects(() => f.program('info', {}, credential), { code: 'PROGRAM_UNAUTHORIZED' });
  await f.changeEpoch();
  await assert.rejects(() => f.program('info'), { code: 'PROGRAM_LIBRARY_MISMATCH' });
});

test('credential output failure rolls back issue and rotation without invalidating the old HTTP token', async (t) => {
  const f = await lab(t),
    output = path.join(f.dataDir, '.program-auth', 'occupied.credential.json');
  await writeFile(output, 'existing private file');
  const sql = new DatabaseSync(path.join(f.dataDir, '.program-auth', 'credentials.sqlite'));
  t.after(() => sql.close());
  const count = () => sql.prepare('SELECT count(*) AS n FROM credentials').get().n;
  const before = count();
  for (const action of ['issue', 'rotate']) {
    await assert.rejects(
      () =>
        programCredential({
          dataDir: f.dataDir,
          action,
          instanceId: f.a.instanceId,
          scopes: ['read'],
          credentialId: f.aCredential.credentialId,
          output,
        }),
      { code: 'EEXIST' },
    );
    assert.equal(count(), before);
    assert.equal(await readFile(output, 'utf8'), 'existing private file');
    assert.ok(await f.program('info'));
  }
  const auth = await createProgramAuth({ dataDir: f.dataDir });
  try {
    const db = JSON.parse(await readFile(path.join(f.dataDir, 'diary.json'), 'utf8'));
    let uncommitted;
    const brokenDisk = (issued) => {
      uncommitted = issued;
      throw Object.assign(Error('synthetic disk failure after output begins'), { code: 'ENOSPC' });
    };
    assert.throws(
      () => auth.issue(db, { instanceId: f.a.instanceId, scopes: ['read'] }, brokenDisk),
      { code: 'ENOSPC' },
    );
    assert.equal(count(), before);
    assert.throws(() => auth.authenticate('Bearer ' + uncommitted.token, db), {
      code: 'PROGRAM_UNAUTHORIZED',
    });
    assert.throws(() => auth.rotate(db, f.aCredential.credentialId, brokenDisk), {
      code: 'ENOSPC',
    });
    assert.equal(count(), before);
    assert.ok(auth.authenticate('Bearer ' + f.aCredential.token, db));
    assert.throws(() => auth.authenticate('Bearer ' + uncommitted.token, db), {
      code: 'PROGRAM_UNAUTHORIZED',
    });
  } finally {
    auth.close();
  }
  await f.restart();
  assert.ok(await f.program('info'));
  const nextOutput = path.join(f.dataDir, '.program-auth', 'rotated.credential.json');
  await programCredential({
    dataDir: f.dataDir,
    action: 'rotate',
    credentialId: f.aCredential.credentialId,
    output: nextOutput,
  });
  const rotated = JSON.parse(await readFile(nextOutput, 'utf8'));
  assert.ok(await f.program('info', {}, rotated));
  await assert.rejects(() => f.program('info'), { code: 'PROGRAM_UNAUTHORIZED' });
});
