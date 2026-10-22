import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createDiaryServer } from '../src/server/app.mjs';
import { commentLibrary } from './helpers/revisit-comment-fixtures.mjs';
import { validateMessageUnit } from '../public/shared/message-units.js';
import { openRevisitSources } from '../src/server/domain/revisit-sources.mjs';
import { richMediaReferences } from '../public/shared/rich-document.js';
import { validateRevisitState } from '../src/server/domain/revisit/delivery/archive.mjs';
const base = '/api/conversation-services';
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const config = (name) => ({
  enabled: true,
  title: name,
  mode: 'interval',
  interval: { count: 1, unit: 'year' },
  timeZone: 'Asia/Shanghai',
  categories: [],
  sender: { id: 'revisit', name: '过去的我', avatarAssetId: null },
});
async function lab(t) {
  const original = commentLibrary().db;
  const directory = path.resolve('tmp/conversation-native', randomUUID());
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'diary.json'), JSON.stringify(original));
  let server, url;
  const open = async () => {
    server = await createDiaryServer({ dataDir: directory, seed: false });
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
  const request = async (suffix, data, method = 'POST') => {
    const response = await fetch(url + base + suffix, {
      method,
      headers: { 'X-Diary-Client': 'desktop' },
      ...(method === 'GET' ? {} : { body: JSON.stringify(data) }),
    });
    return { status: response.status, data: await response.json() };
  };
  const call = async (suffix, data, method) => {
    const result = await request(suffix, data, method);
    assert.equal(result.status, 200, JSON.stringify(result.data));
    return result.data;
  };
  const id = (room = '-101') => `desktop:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:${room}`;
  const read = () => fs.readFile(path.join(directory, 'diary.json'), 'utf8').then(JSON.parse);
  const create = (conversationId, slotId = 'revisit') =>
    call('/settings/save', {
      conversationId,
      slotId,
      providerId: 'revisit',
      expectedBindingRevision: 0,
      expectedConfigRevision: 0,
      config: config(slotId),
    });
  const command = (instanceId, action, payload = {}) =>
    call('/request', { instanceId, action, payload });
  const group = (conversationId) =>
    call(
      '/conversations/state',
      {
        conversationId,
        expectedRevision: 0,
        mode: 'group',
        title: '合成群聊',
        selfName: '我',
        category: original.categories[0],
        idleHours: 5,
        messageOwner: 'conversation-services-v1',
      },
      'PUT',
    );
  return { original, request, call, id, read, create, command, group, close, open, directory };
}
const manual = { manual: true, from: '2026-10-17T00:00:00Z', to: '2026-10-17T03:00:00Z' };
test('settings read is pure; duplicate create, windows CAS and failed transactions preserve old data', async (t) => {
  const l = await lab(t),
    id = l.id();
  const before = hash(await l.read());
  assert.equal((await l.call('/settings/read', { conversationId: id })).bindingRevision, 0);
  assert.equal(hash(await l.read()), before);
  const payload = {
    conversationId: id,
    providerId: 'revisit',
    expectedBindingRevision: 0,
    expectedConfigRevision: 0,
    config: config('A'),
  };
  const [a, b] = await Promise.all([
    l.call('/settings/save', payload),
    l.call('/settings/save', payload),
  ]);
  assert.deepEqual(a, b);
  assert.equal((await l.read()).conversationServices.instances.length, 1);
  const a2 = await l.call('/settings/save', {
    conversationId: id,
    bindingId: a.bindingId,
    instanceId: a.instanceId,
    expectedBindingRevision: a.bindingRevision,
    expectedConfigRevision: a.config.revision,
    providerId: 'revisit',
    config: { ...a.config, sender: { ...a.config.sender, name: '新的我' } },
  });
  const saved = hash(await l.read());
  assert.equal(
    (await l.request('/settings/save', { ...payload, config: config('过期窗口') })).status,
    409,
  );
  assert.equal(hash(await l.read()), saved);
  assert.equal(a2.config.sender.name, '新的我');
  const bad = await l.request('/settings/save', {
    ...payload,
    conversationId: l.id('-102'),
    config: { ...config('坏配置'), interval: { count: 0, unit: 'year' } },
  });
  assert.equal(bad.status, 400);
  assert.equal(hash(await l.read()), saved);
  const db = await l.read();
  assert.equal(
    hash([db.entries, db.media, db.messageStore, db.revisit]),
    hash([l.original.entries, l.original.media, l.original.messageStore, l.original.revisit]),
  );
});
test('two programs share one group, two groups isolate; pause, unbind, rebind and restart keep checkpoints', async (t) => {
  const l = await lab(t),
    id = l.id(),
    other = l.id('-102');
  const a = await l.create(id),
    a2 = await l.create(id, 'second'),
    b = await l.create(other);
  assert.notEqual(a.instanceId, a2.instanceId);
  assert.notEqual(a.instanceId, b.instanceId);
  assert.equal((await l.request('/settings/read', { conversationId: id })).status, 409);
  const state = await l.call('/conversations/state', { conversationId: id });
  assert.equal(state.mode, 'group');
  assert.equal(state.participants.length, 3);
  await l.command(a.instanceId, 'tick', manual);
  const progress = await l.command(a.instanceId, 'status'),
    feed = await l.command(a.instanceId, 'feed', { after: 0 });
  assert(feed.deliveries.length > 0);
  const pause = await l.call('/settings/save', {
    conversationId: id,
    bindingId: a.bindingId,
    instanceId: a.instanceId,
    providerId: 'revisit',
    expectedBindingRevision: a.bindingRevision,
    expectedConfigRevision: a.config.revision,
    config: { ...config('revisit'), enabled: false },
  });
  assert.equal((await l.command(a.instanceId, 'status')).cursor, progress.cursor);
  const detach = await l.call('/settings/save', {
    conversationId: id,
    bindingId: a.bindingId,
    providerId: null,
    expectedBindingRevision: pause.bindingRevision,
  });
  assert.equal(detach.providerId, null);
  const restore = await l.call('/settings/save', {
    conversationId: id,
    bindingId: a.bindingId,
    instanceId: a.instanceId,
    providerId: 'revisit',
    expectedBindingRevision: detach.bindingRevision,
    expectedConfigRevision: detach.config.revision,
    config: { ...config('revisit'), enabled: true },
  });
  assert.equal(restore.instanceId, a.instanceId);
  await l.close();
  await l.open();
  assert.equal((await l.command(a.instanceId, 'status')).cursor, progress.cursor);
  assert.deepEqual(
    (await l.command(a.instanceId, 'feed', { after: 0 })).deliveries,
    feed.deliveries,
  );
  assert.equal((await l.command(b.instanceId, 'status')).cursor, null);
  assert.equal(
    (
      await l.request(
        '/bindings',
        { id: randomUUID(), conversationId: other, instanceId: a.instanceId, expectedRevision: 0 },
        'PUT',
      )
    ).status,
    409,
  );
  assert.equal(hash((await l.read()).revisit), hash(l.original.revisit));
});
test('human and program use the same canonical messages, attachments, replies, idempotency and withdrawal', async (t) => {
  const l = await lab(t),
    id = l.id();
  await l.group(id);
  const a = await l.create(id),
    b = await l.create(l.id('-102'));
  const actor = `program:${a.instanceId}`,
    foreign = `program:${b.instanceId}`;
  const media = l.original.media[0].id;
  const original = {
    conversationId: id,
    kind: 'message',
    operationId: randomUUID(),
    actorId: 'self',
    text: '**图文消息**',
    sentAt: new Date().toISOString(),
    attachments: [media],
  };
  const sent = await l.call('/conversations/send', original);
  assert.equal((await l.call('/conversations/send', original)).messageId, sent.messageId);
  assert.equal(
    (await l.request('/conversations/send', { ...original, text: '不能覆盖' })).status,
    409,
  );
  const bot = await l.call('/conversations/send', {
    conversationId: id,
    kind: 'message',
    operationId: randomUUID(),
    actorId: actor,
    text: '程序的普通回复',
    sentAt: original.sentAt,
    replyToMessageId: sent.messageId,
  });
  const feed = await l.call('/conversations/feed', { conversationId: id, actorId: actor });
  assert.equal(feed.messages.length, 2);
  assert.deepEqual(
    feed.messages.map((m) => m.actor.kind),
    ['self', 'program'],
  );
  assert.equal(feed.messages.find((m) => m.id === bot.messageId).replyTo, sent.messageId);
  assert.deepEqual(feed.messages[0].attachments, [media]);
  validateMessageUnit((await l.read()).messageStore.units.find((u) => u.id === sent.messageId));
  assert.equal(
    (
      await l.request('/conversations/send', {
        ...original,
        operationId: randomUUID(),
        actorId: foreign,
      })
    ).status,
    409,
  );
  assert.equal(
    (await l.request('/conversations/feed', { conversationId: l.id('-102'), actorId: actor }))
      .status,
    409,
  );
  assert.equal(
    (
      await l.request('/conversations/withdraw', {
        conversationId: id,
        kind: 'message',
        messageId: bot.messageId,
        actorId: 'self',
        expectedRevision: 1,
      })
    ).status,
    409,
  );
  await l.call('/conversations/withdraw', {
    conversationId: id,
    kind: 'message',
    messageId: bot.messageId,
    actorId: actor,
    operationId: randomUUID(),
    expectedRevision: 1,
  });
  const delta = await l.call('/conversations/feed', { conversationId: id, after: feed.next });
  assert.equal(delta.messages.length, 0);
  assert(delta.redactions.some((r) => r.id === bot.messageId));
  assert.equal(
    (await l.request('/conversations/feed', { conversationId: l.id('-102'), after: feed.next }))
      .status,
    400,
  );
  assert.equal(
    (
      await l.request('/conversations/feed', {
        conversationId: id,
        after: { conversationId: id, positions: { ['service:' + b.instanceId]: 0 } },
      })
    ).status,
    400,
  );
  const old = await l.request('/../chat-journal/messages', {
    sourceId: id.split(':')[1],
    roomId: id.split(':')[2],
    messages: [
      { id: '999', sentAt: new Date().toISOString(), text: '旧入口不能重复写入', attachments: [] },
    ],
  });
  assert.equal(old.status, 409);
  assert.equal(
    (
      await l.request('/../chat-journal/withdraw', {
        sourceId: id.split(':')[1],
        roomId: id.split(':')[2],
        messageId: sent.localMessageId,
        expectedRevision: 1,
      })
    ).status,
    409,
  );
  const entries = await l.read();
  assert(
    entries.messageStore.units.some(
      (u) => u.actor?.kind === 'program' && u.state === 'withdrawn' && u.body === null,
    ),
  );
});
test('group and single comments freeze source scope, programs can reply; unbinding does not redirect history', async (t) => {
  const l = await lab(t),
    id = l.id(),
    a = await l.create(id),
    second = await l.create(id, 'second'),
    b = await l.create(l.id('-102'));
  await l.command(a.instanceId, 'tick', manual);
  await l.command(second.instanceId, 'tick', manual);
  await l.command(b.instanceId, 'tick', manual);
  const source = await l.command(a.instanceId, 'feed', { after: 0 });
  const batch = source.batches.find((x) => x.targets.length > 1),
    delivery = source.deliveries.find((d) => d.batchId === batch.id);
  const groupInput = {
    conversationId: id,
    kind: 'comment',
    operationId: randomUUID(),
    text: '这一组的感想',
    displayedTarget: { instanceId: a.instanceId, batchId: batch.id },
  };
  const group = await l.call('/conversations/send', groupInput);
  assert(group.message.targets.length > 1);
  const quoted = await l.call('/conversations/send', {
    ...groupInput,
    operationId: randomUUID(),
    text: '这一条',
    reply: { instanceId: a.instanceId, batchId: batch.id, deliveryId: delivery.id },
  });
  assert.equal(quoted.message.targets.length, 1);
  const program = await l.call('/conversations/send', {
    ...groupInput,
    operationId: randomUUID(),
    actorId: `program:${second.instanceId}`,
    text: '另一个程序的回复',
  });
  assert.equal(program.message.author.kind, 'program');
  assert.equal(
    (
      await l.request('/conversations/send', {
        ...groupInput,
        operationId: randomUUID(),
        displayedTarget: { instanceId: b.instanceId, batchId: batch.id },
      })
    ).status,
    404,
  );
  const context = await l.call('/conversations/context', groupInput);
  assert.equal(context.targets.length, group.message.targets.length);
  const detached = await l.call('/settings/save', {
    conversationId: id,
    bindingId: a.bindingId,
    providerId: null,
    expectedBindingRevision: a.bindingRevision,
  });
  assert.equal(detached.providerId, null);
  assert.deepEqual(
    (await l.call('/conversations/send', groupInput)).message.targets,
    group.message.targets,
  );
  const saved = (await l.read()).conversationServices.instances.find(
    (s) => s.id === a.instanceId,
  ).state;
  assert.equal(saved.comments.length, 3);
  validateRevisitState(saved, {
    ...(await l.read()),
    revisit: saved,
    revisitInstanceId: a.instanceId,
  });
  assert.throws(
    () =>
      validateRevisitState(saved, {
        ...l.original,
        revisit: saved,
        revisitInstanceId: second.instanceId,
      }),
    /归档结构/,
  );
  let after,
    all = [],
    drained = false;
  for (let i = 0; i < 100; i++) {
    const page = await l.call('/conversations/feed', {
      conversationId: id,
      limit: 2,
      ...(after ? { after } : {}),
    });
    all.push(...page.messages);
    after = page.next;
    if (!page.hasMore) {
      drained = true;
      break;
    }
  }
  assert(drained);
  assert.equal(new Set(all.map((m) => m.id)).size, all.length);
  assert(all.some((m) => m.kind === 'history' && m.instanceId === a.instanceId));
  assert(all.some((m) => m.kind === 'history' && m.instanceId === second.instanceId));
  assert(all.some((m) => m.kind === 'comment' && m.actor.kind === 'program'));
  assert(!all.some((m) => m.instanceId === b.instanceId));
  const previous = hash(saved.deliveries.map((d) => d.ref));
  await l.command(a.instanceId, 'tick', manual);
  const next = (await l.read()).conversationServices.instances.find(
    (s) => s.id === a.instanceId,
  ).state;
  assert.equal(hash(next.deliveries.map((d) => d.ref)), previous);
  assert(!next.deliveries.some((d) => d.ref.kind === 'comment'));
  assert.equal(hash((await l.read()).revisit), hash(l.original.revisit));
});
test('external program and AI are peers of self and revisit; config is data and never invokes a model or scheduler', async (t) => {
  const l = await lab(t),
    id = l.id();
  await l.group(id);
  const revisit = await l.create(id);
  const ai = await l.call('/settings/save', {
    conversationId: id,
    slotId: 'assistant',
    providerId: 'external-program',
    expectedBindingRevision: 0,
    expectedConfigRevision: 0,
    config: {
      enabled: true,
      title: '合成助手',
      sender: { name: '小助手' },
      kind: 'ai',
      parameters: { prompt: '合成测试提示词', readWindow: 20 },
    },
  });
  const robot = await l.call('/settings/save', {
    conversationId: id,
    slotId: 'reminder',
    providerId: 'external-program',
    expectedBindingRevision: 0,
    expectedConfigRevision: 0,
    config: {
      enabled: true,
      title: '合成提醒',
      sender: { name: '提醒程序' },
      kind: 'program',
      parameters: { message: '合成提醒参数' },
    },
  });
  const state = await l.call('/conversations/state', { conversationId: id });
  assert.deepEqual(
    state.participants.map((p) => p.kind),
    ['self', 'program', 'ai', 'program'],
  );
  assert.equal(
    (
      await l.request('/request', {
        instanceId: ai.instanceId,
        action: 'runner-start',
        payload: {},
      })
    ).status,
    400,
  );
  assert.equal(
    (await l.request('/request', { instanceId: ai.instanceId, action: 'tick', payload: manual }))
      .status,
    400,
  );
  const self = await l.call('/conversations/send', {
    conversationId: id,
    operationId: randomUUID(),
    kind: 'message',
    text: '人类发言',
  });
  const payload = {
    conversationId: id,
    operationId: randomUUID(),
    kind: 'message',
    actorId: `program:${ai.instanceId}`,
    text: '**AI角色消息**',
    replyToMessageId: self.messageId,
  };
  const sent = await l.call('/conversations/send', payload);
  await l.call('/conversations/send', {
    ...payload,
    operationId: randomUUID(),
    actorId: `program:${robot.instanceId}`,
    text: '普通程序消息',
  });
  const feed = await l.call('/conversations/feed', {
    conversationId: id,
    actorId: `program:${ai.instanceId}`,
  });
  assert(feed.messages.some((m) => m.id === sent.messageId && m.actor.kind === 'ai'));
  const changed = await l.call('/settings/save', {
    conversationId: id,
    bindingId: ai.bindingId,
    providerId: 'external-program',
    expectedBindingRevision: ai.bindingRevision,
    expectedConfigRevision: ai.config.revision,
    config: { parameters: { prompt: '后续的新参数' }, enabled: false },
  });
  assert.equal(changed.config.kind, 'ai');
  assert.equal(
    (await l.request('/conversations/send', { ...payload, operationId: randomUUID() })).status,
    409,
  );
  assert.equal((await l.call('/conversations/send', payload)).messageId, sent.messageId);
  await l.close();
  await l.open();
  const restored = await l.call('/conversations/state', { conversationId: id });
  assert.equal(restored.participants.find((p) => p.instanceId === ai.instanceId).active, false);
  assert.equal(
    restored.programs.find((p) => p.instanceId === ai.instanceId).config.parameters.prompt,
    '后续的新参数',
  );
  assert.equal((await l.command(revisit.instanceId, 'status')).config.enabled, true);
  const output = path.resolve('outputs/2026-10-19-conversation-native');
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(
    path.join(output, 'synthetic-contract-example.json'),
    JSON.stringify({ syntheticOnly: true, state: restored, feed }, null, 2),
  );
});
test('media comments and old instance replies survive replacement; ordinary hidden content is redacted', async (t) => {
  const l = await lab(t),
    id = l.id();
  await l.group(id);
  const a = await l.create(id);
  await l.command(a.instanceId, 'tick', manual);
  const db = await l.read(),
    service = db.conversationServices.instances.find((s) => s.id === a.instanceId);
  const view = { ...db, revisit: service.state, revisitInstanceId: a.instanceId },
    sources = openRevisitSources(view);
  const delivery = service.state.deliveries.find((d) => {
    const unit = sources.resolve(d.ref)?.unit;
    return unit && richMediaReferences(unit.body).length;
  });
  const occurrence = richMediaReferences(sources.resolve(delivery.ref).unit.body)[0];
  const comment = await l.call('/conversations/send', {
    conversationId: id,
    kind: 'comment',
    operationId: randomUUID(),
    text: '对图片的评论',
    reply: {
      instanceId: a.instanceId,
      batchId: delivery.batchId,
      deliveryId: delivery.id,
      occurrenceId: occurrence.occurrenceId,
    },
  });
  assert.equal(comment.message.commentOn[0].occurrenceId, occurrence.occurrenceId);
  const created = await l.request('/instances', {
    id: randomUUID(),
    providerId: 'revisit',
    name: '替换的程序',
    config: config('新的程序'),
  });
  assert.equal(created.status, 201);
  await l.call(
    '/bindings',
    {
      id: a.bindingId,
      conversationId: id,
      instanceId: created.data.id,
      expectedRevision: a.bindingRevision,
    },
    'PUT',
  );
  const oldReply = await l.call('/conversations/send', {
    conversationId: id,
    kind: 'comment',
    operationId: randomUUID(),
    text: '换绑后仍回复旧图',
    reply: {
      instanceId: a.instanceId,
      batchId: delivery.batchId,
      deliveryId: delivery.id,
    },
  });
  assert.equal(oldReply.instanceId, a.instanceId);
  assert.equal(
    (
      await l.request(
        '/bindings',
        {
          id: randomUUID(),
          conversationId: l.id('-102'),
          instanceId: a.instanceId,
          expectedRevision: 0,
        },
        'PUT',
      )
    ).status,
    409,
  );
  const own = await l.call('/conversations/send', {
    conversationId: id,
    kind: 'message',
    operationId: randomUUID(),
    text: '需要隐藏的合成普通消息',
  });
  const first = await l.call('/conversations/feed', { conversationId: id });
  await l.close();
  const saved = await l.read();
  const e = saved.entries.find((e) => e.id === own.entryId);
  e.hidden = true;
  // Isolated fixture change emulates an existing diary UI operation, never a formal write.
  // Persist through the test library location returned by the helper.
  await fs.writeFile(path.join(l.directory, 'diary.json'), JSON.stringify(saved));
  await l.open();
  const delta = await l.call('/conversations/feed', { conversationId: id, after: first.next });
  assert(delta.redactions.some((r) => r.id === own.messageId && r.state === 'unavailable'));
  const full = await l.call('/conversations/feed', { conversationId: id });
  const hidden = full.messages.find((m) => m.id === own.messageId);
  assert.equal(hidden.body, null);
  assert.equal(hidden.markdown, '');
  assert.equal(hash((await l.read()).revisit), hash(l.original.revisit));
});
test('existing fixed-room history uses a legacy alias without migration or recreating its progress', async (t) => {
  const l = await lab(t),
    id = l.id('-900000001'),
    before = hash(await l.read());
  const settings = await l.call('/settings/read', { conversationId: id });
  assert.equal(settings.legacy, true);
  assert.equal(settings.instanceId, 'legacy-revisit');
  const state = await l.call('/conversations/state', { conversationId: id });
  assert.equal(state.mode, 'group');
  assert(state.participants.some((p) => p.id === 'program:legacy-revisit'));
  const feed = await l.call('/conversations/feed', { conversationId: id });
  assert(feed.messages.some((m) => m.kind === 'history' && m.instanceId === 'legacy-revisit'));
  assert.equal(hash(await l.read()), before);
  const original = l.original.revisit,
    batch = original.batches[0];
  const result = await l.call('/conversations/send', {
    conversationId: id,
    kind: 'comment',
    operationId: randomUUID(),
    text: '旧会话的合成评论',
    displayedTarget: { instanceId: 'legacy-revisit', batchId: batch.id },
  });
  assert.equal(result.instanceId, 'legacy-revisit');
  const paused = await l.call('/settings/save', {
    conversationId: id,
    providerId: 'revisit',
    expectedBindingRevision: 0,
    expectedConfigRevision: settings.config.revision,
    config: { enabled: false },
  });
  assert.equal(paused.legacy, true);
  const after = await l.read();
  assert.equal(after.conversationServices.instances.length, 0);
  assert.equal(after.revisit.cursor, original.cursor);
  assert.equal(hash(after.revisit.deliveries), hash(original.deliveries));
  assert.equal(hash(after.entries), hash(l.original.entries));
});
test('new settings promote a personal room to group and storage failures leave no partial instance or binding', async (t) => {
  const l = await lab(t),
    id = l.id();
  const personal = await l.call(
    '/conversations/state',
    {
      conversationId: id,
      expectedRevision: 0,
      mode: 'session',
      title: '个人会话',
      selfName: '我',
      category: l.original.categories[0],
      idleHours: 5,
    },
    'PUT',
  );
  await l.create(id);
  const group = await l.call('/conversations/state', { conversationId: id });
  assert.equal(group.mode, 'group');
  assert.equal(group.revision, personal.revision + 1);
  const before = hash(await l.read()),
    rename = fs.rename;
  fs.rename = async (source, destination) => {
    if (String(destination) === path.join(l.directory, 'diary.json'))
      throw Error('synthetic transaction failure');
    return rename(source, destination);
  };
  const payload = {
    conversationId: l.id('-103'),
    providerId: 'revisit',
    slotId: 'revisit',
    expectedBindingRevision: 0,
    expectedConfigRevision: 0,
    config: config('失败恢复'),
  };
  try {
    assert.equal((await l.request('/settings/save', payload)).status, 500);
  } finally {
    fs.rename = rename;
  }
  assert.equal(hash(await l.read()), before);
  assert.equal(
    (await l.call('/settings/read', { conversationId: l.id('-103'), slotId: 'revisit' }))
      .bindingRevision,
    0,
  );
  const retried = await l.call('/settings/save', payload);
  assert.equal(retried.bindingRevision, 1);
  await l.close();
  await l.open();
  assert.equal(
    (await l.call('/settings/read', { conversationId: l.id('-103'), slotId: 'revisit' }))
      .instanceId,
    retried.instanceId,
  );
});
