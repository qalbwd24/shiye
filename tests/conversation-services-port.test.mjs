import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createConversationServicesPort } from '../previews/telegram-chat/shiye-conversation-services.js';
import {
  catalog,
  createInstance,
  bindConversation,
} from '../src/server/conversation-services/registry.mjs';
import {
  readConversationSettings,
  saveConversationSettings,
} from '../src/server/conversation-services/settings.mjs';
import { describeConversation } from '../src/server/conversation-services/conversations.mjs';
import { commentLibrary } from './helpers/revisit-comment-fixtures.mjs';

const sourceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const config = (title = '合成回看') => ({
  enabled: false,
  title,
  dailyTime: '08:00',
  mode: 'daily-random',
  sender: { name: '过去的我' },
});
function lab() {
  let db = commentLibrary().db,
    health = { conversationServices: { atomicConversationSettings: 1, conversationMessaging: 1 } },
    loseReply = false;
  const calls = [];
  const request = async (action, payload) => {
    calls.push({ action, payload: structuredClone(payload) });
    if (action === 'service-health') return structuredClone(health);
    if (action === 'service-catalog') return catalog(db);
    if (action === 'conversation-state') return describeConversation(db, payload);
    if (action === 'service-settings-read') return readConversationSettings(db, payload);
    if (action === 'service-settings-save') {
      const candidate = structuredClone(db),
        result = saveConversationSettings(candidate, payload);
      db = candidate;
      if (loseReply) {
        loseReply = false;
        throw Error('synthetic lost atomic reply');
      }
      return result;
    }
    throw Error('Forbidden old multi-step bridge action: ' + action);
  };
  const make = () => createConversationServicesPort({ sourceId, request });
  const input = async (
    port,
    roomId = '10',
    slotId = 'history',
    providerId = 'revisit',
    value = config(),
  ) => {
    const base = await port.readSettings({ roomId, slotId });
    return {
      roomId,
      slotId,
      providerId,
      instanceId: base.instanceId,
      expectedBindingRevision: base.bindingRevision,
      expectedConfigRevision: base.config?.revision || 0,
      config: value,
    };
  };
  return {
    make,
    input,
    calls,
    db: () => db,
    health: (value) => {
      health = value;
    },
    loseReply: () => {
      loseReply = true;
    },
  };
}
test('atomic settings use one write and independent slots in the same conversation', async () => {
  const l = lab(),
    port = l.make();
  const first = await port.saveSettings(await l.input(port));
  const second = await port.saveSettings(
    await l.input(port, '10', 'assistant', 'external-program', {
      enabled: true,
      title: '助手',
      sender: { name: '小助手' },
      kind: 'ai',
      parameters: { model: 'external' },
    }),
  );
  assert.notEqual(first.instanceId, second.instanceId);
  assert.equal(l.calls.filter((c) => c.action === 'service-settings-save').length, 2);
  const directory = await l.make().readConversation({ roomId: '10' });
  assert.equal(directory.bindings.length, 2);
  assert.equal(directory.state.mode, 'group');
  assert.equal(directory.state.messageOwner, 'legacy');
  assert.equal(directory.participants.find((a) => a.instanceId === second.instanceId).kind, 'ai');
});
test('two rooms retain independent identities and a later window discovers an existing binding', async () => {
  const l = lab(),
    p = l.make();
  const a = await p.saveSettings(await l.input(p));
  const b = await p.saveSettings(await l.input(p, '20'));
  assert.notEqual(a.instanceId, b.instanceId);
  const read = await l.make().readSettings({ roomId: '10', bindingId: a.bindingId });
  assert.equal(read.instanceId, a.instanceId);
  assert.equal(read.conversationId, `desktop:${sourceId}:10`);
});
test('same atomic request retries a lost reply without duplicate instance or progress reset', async () => {
  const l = lab(),
    p = l.make(),
    input = await l.input(p);
  l.loseReply();
  await assert.rejects(p.saveSettings(input), /lost atomic reply/);
  const result = await p.saveSettings(input);
  assert.equal(l.db().conversationServices.instances.length, 1);
  assert.equal(result.bindingRevision, 1);
  const writes = l.calls.filter((c) => c.action === 'service-settings-save');
  assert.deepEqual(writes[0].payload, writes[1].payload);
});
test('409 leaves input intact and explicit reread supplies fresh independent revisions', async () => {
  const l = lab(),
    p = l.make();
  await p.saveSettings(await l.input(p));
  const stale = await l.input(p),
    update = await l.input(l.make());
  update.config.dailyTime = '09:00';
  await p.saveSettings(update);
  const original = structuredClone(stale);
  stale.config.dailyTime = '10:00';
  await assert.rejects(p.saveSettings(stale), { status: 409 });
  assert.equal(stale.config.dailyTime, '10:00');
  assert.equal(stale.expectedConfigRevision, original.expectedConfigRevision);
  assert.equal(
    (await p.recoverSettings({ roomId: '10', slotId: 'history' })).config.dailyTime,
    '09:00',
  );
});
test('missing live capabilities block saving without calling any old multi-step writes', async () => {
  const l = lab(),
    p = l.make();
  l.health({ conversationServices: { atomicConversationSettings: 1 } });
  assert.equal((await p.readSettings({ roomId: '10', slotId: 'history' })).canSave, false);
  await assert.rejects(
    p.saveSettings({ roomId: '10', slotId: 'history', providerId: 'revisit', config: config() }),
    { status: 503 },
  );
  assert.equal(
    l.calls.filter(
      (c) =>
        c.action === 'service-settings-save' ||
        c.action === 'service-settings-read' ||
        c.action === 'conversation-state',
    ).length,
    0,
  );
});
test('external public parameters strip server metadata and never switch message owner', async () => {
  const l = lab(),
    p = l.make();
  const value = {
    version: 1,
    revision: 99,
    enabled: false,
    title: '工具',
    sender: { id: 'server', name: '工具', avatarAssetId: 'x' },
    kind: 'program',
    parameters: { language: 'zh' },
    messageOwner: 'conversation-services-v1',
  };
  await p.saveSettings(await l.input(p, '10', 'assistant', 'external-program', value));
  const payload = l.calls.find((c) => c.action === 'service-settings-save').payload;
  assert.deepEqual(Object.keys(payload.config).sort(), [
    'enabled',
    'kind',
    'parameters',
    'sender',
    'title',
  ]);
  assert.deepEqual(payload.config.sender, { name: '工具' });
  assert.equal(payload.messageOwner, undefined);
});
test('external JSON must be an object within the byte limit before an atomic write', async () => {
  const l = lab(),
    p = l.make();
  for (const parameters of [[], { text: '中'.repeat(6000) }]) {
    const input = await l.input(p, '10', 'assistant', 'external-program', {
      enabled: false,
      title: '程序',
      sender: { name: '程序' },
      kind: 'program',
      parameters,
    });
    await assert.rejects(p.saveSettings(input), { status: 400 });
  }
  assert.equal(
    l.calls.some((c) => c.action === 'service-settings-save'),
    false,
  );
});
test('detach and reattach a slot preserves instance identity and never changes another slot', async () => {
  const l = lab(),
    p = l.make(),
    a = await p.saveSettings(await l.input(p));
  const b = await p.saveSettings(await l.input(p, '10', 'second'));
  await p.saveSettings({
    roomId: '10',
    bindingId: a.bindingId,
    instanceId: a.instanceId,
    providerId: null,
    expectedBindingRevision: a.bindingRevision,
  });
  const restored = await p.saveSettings(await l.input(p));
  assert.equal(restored.instanceId, a.instanceId);
  assert.equal(
    (await p.readSettings({ roomId: '10', bindingId: b.bindingId })).providerId,
    'revisit',
  );
});
test('unknown providers stay read only and invalid slots are rejected', async () => {
  assert.throws(() =>
    createConversationServicesPort({ request: async () => {}, sourceId: 'unstable-source' }),
  );
  const l = lab(),
    p = l.make();
  await assert.rejects(p.readSettings({ roomId: '10', slotId: '../bad' }), { status: 400 });
  await assert.rejects(
    p.saveSettings({ roomId: '10', slotId: 'ai', providerId: 'unimplemented-ai' }),
    { status: 400 },
  );
});
test('legacy aliases may be read but atomic UI work does not migrate legacy progress', async () => {
  const l = lab(),
    p = l.make(),
    original = structuredClone(l.db().revisit);
  const read = await p.readSettings({ roomId: '-900000001', slotId: 'revisit' });
  assert.equal(read.legacy, true);
  assert.equal(read.instanceId, 'legacy-revisit');
  assert.deepEqual(l.db().revisit, original);
  assert.equal(l.db().conversationServices, undefined);
});

test('targetless ui44 callers reuse their single random binding for both read and atomic save', async () => {
  const l = lab(),
    p = l.make(),
    instanceId = randomUUID(),
    bindingId = randomUUID();
  createInstance(l.db(), {
    id: instanceId,
    providerId: 'revisit',
    name: '旧ui44程序',
    config: config(),
  });
  bindConversation(l.db(), {
    id: bindingId,
    conversationId: `desktop:${sourceId}:10`,
    instanceId,
    expectedRevision: 0,
  });
  const read = await p.readSettings({ roomId: '10' });
  assert.equal(read.bindingId, bindingId);
  assert.equal(read.instanceId, instanceId);
  const saved = await p.saveSettings({
    roomId: '10',
    providerId: 'revisit',
    expectedBindingRevision: read.bindingRevision,
    expectedConfigRevision: read.config.revision,
    config: { ...read.config, enabled: !read.config.enabled },
  });
  assert.equal(saved.bindingId, bindingId);
  assert.equal(saved.instanceId, instanceId);
  assert.equal(l.db().conversationServices.instances.length, 1);
  assert.equal(
    l.calls.find((c) => c.action === 'service-settings-read').payload.bindingId,
    bindingId,
  );
  assert.equal(
    l.calls.find((c) => c.action === 'service-settings-save').payload.bindingId,
    bindingId,
  );
  // An explicit new slot continues to mean a separate program even with a sole old binding.
  const separate = await p.saveSettings(await l.input(p, '10', 'history'));
  assert.notEqual(separate.instanceId, instanceId);
  await assert.rejects(p.readSettings({ roomId: '10' }), { status: 409 });
  await assert.rejects(p.saveSettings({ roomId: '10', providerId: 'revisit', config: config() }), {
    status: 409,
  });
});

test('targetless defaults use history for a new ordinary room and revisit for the legacy room', async () => {
  const l = lab(),
    p = l.make();
  assert.equal((await p.readSettings({ roomId: '10' })).slotId, 'history');
  const legacy = await p.readSettings({ roomId: '-900000001' });
  assert.equal(legacy.slotId, 'revisit');
  assert.equal(legacy.legacy, true);
});
