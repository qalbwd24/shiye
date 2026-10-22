import assert from 'node:assert/strict';
import test from 'node:test';
import { compileChatSnapshot } from '../src/server/sync-product/chat-snapshot.mjs';
import { productMessageId, productConversationId } from '../public/shared/sync-product.js';

const sourceId = '12345678-1234-4567-8910-123456789012';
function fixture() {
  return {
    format: 'shiye-chat-snapshot',
    version: 1,
    sourceId,
    revision: 7,
    rooms: [
      {
        id: '-12345678901234567890',
        sourceId,
        title: '合成房',
        future: { keep: true },
        configuration: { prompt: '合成程序参数', enabled: true },
      },
    ],
    messages: [
      {
        roomId: '-12345678901234567890',
        id: '12345678901234567890',
        state: 'active',
        data: {
          id: '12345678901234567890',
          sentAt: '2020-01-02T03:04:05+08:00',
          text: 'token=plain authored text **源码**',
          attachments: ['media-safe_1'],
          replyTo: '12345678901234567889',
          unknown: { keep: ['原始'] },
        },
      },
    ],
    media: [
      {
        assetId: 'media-safe_1',
        sha256: 'a'.repeat(64),
        size: 3,
        mime: 'image/png',
        name: 'original.png',
      },
    ],
  };
}
const rejects = (input, code) => assert.throws(() => compileChatSnapshot(input), { code });
test('preserves complete active message and room values, times and string identity without source mutation', () => {
  const input = fixture(),
    before = structuredClone(input);
  const plan = compileChatSnapshot(input);
  assert.deepEqual(input, before);
  const room = plan.records.find((r) => r.entityType === 'conversation');
  assert.equal(room.entityId, productConversationId(sourceId, input.rooms[0].id));
  const message = plan.records.find((r) => r.entityType === 'chatMessage');
  assert.equal(
    message.entityId,
    productMessageId(sourceId, input.messages[0].roomId, input.messages[0].id),
  );
  const { _product, ...data } = message.data;
  assert.deepEqual(data, input.messages[0].data);
  assert.equal(_product.readOnlyProjection, true);
  assert.deepEqual(_product.refs.assets, ['media-safe_1']);
  assert.deepEqual(plan.assets, []);
  assert.deepEqual(plan.requiredAssets, input.media);
  assert.equal(plan.coverage.completeComputerExport, false);
  assert.equal(plan.coverage.originalBytesVerified, false);
});
test('withdrawn snapshots contain only empty-data tombstones and reject any retained body', () => {
  const input = fixture();
  input.messages[0].state = 'withdrawn';
  input.messages[0].data = {};
  const tombstone = compileChatSnapshot(input).records.find((r) => r.entityType === 'chatMessage');
  assert.deepEqual(tombstone, {
    entityType: 'chatMessage',
    entityId: productMessageId(sourceId, input.messages[0].roomId, input.messages[0].id),
    state: 'withdrawn',
    data: {},
  });
  delete input.messages[0].data;
  assert.deepEqual(
    compileChatSnapshot(input).records.find((r) => r.entityType === 'chatMessage'),
    tombstone,
  );
  for (const data of [{ text: '' }, { text: 'must not restore' }, { attachments: [] }, null]) {
    input.messages[0].data = data;
    rejects(input, 'CHAT_WITHDRAWN_BODY_FORBIDDEN');
  }
});
test('root shape and private domains fail closed, including nested message recovery', () => {
  for (const key of [
    'withdrawalRecovery',
    'rawProfile',
    'auth',
    'credentials',
    'token',
    'futureRoot',
  ]) {
    const input = fixture();
    input[key] = { secret: 'never log' };
    rejects(input, 'CHAT_UNKNOWN_ROOT_FIELD');
  }
  const input = fixture();
  input.messages[0].data.unknown.withdrawalRecovery = { text: 'private' };
  rejects(input, 'CHAT_PRIVATE_DOMAIN');
});
test('room configurations exclude known credentials/private device values with no values in report', () => {
  const input = fixture();
  input.rooms[0].configuration = {
    prompt: 'preserved',
    token: 'secret-value',
    auth: { raw: 'secret-value' },
    withdrawalRecovery: { text: 'secret-value' },
    nested: { localPath: 'C:/private', retained: true },
    endpoint: 'https://user:pass@example.com/api?token=secret-value&model=one',
  };
  const plan = compileChatSnapshot(input);
  const config = plan.records[0].data.configuration;
  assert.equal(config.prompt, 'preserved');
  assert.equal(config.nested.retained, true);
  assert.equal(config.nested.localPath, undefined);
  assert.equal(config.token, undefined);
  assert.equal(config.auth, undefined);
  assert.equal(config.withdrawalRecovery, undefined);
  assert.equal(config.endpoint, 'https://example.com/api?model=one');
  assert.ok(plan.coverage.excluded.length >= 5);
  assert.equal(JSON.stringify(plan).includes('secret-value'), false);
  assert.equal(JSON.stringify(plan.coverage.excluded).includes('C:/private'), false);
});
test('attachment and room image references require safe declared assets; no real bytes are claimed', () => {
  const input = fixture();
  input.rooms[0].avatarAssetId = 'media-safe_1';
  const plan = compileChatSnapshot(input);
  assert.deepEqual(plan.records[0].data._product.refs.assets, ['media-safe_1']);
  input.media = [];
  rejects(input, 'CHAT_MISSING_MEDIA');
  for (const attachments of [
    'media-safe_1',
    ['sha256:unsafe'],
    [{ assetId: 'media-safe_1' }],
    [123],
  ]) {
    const v = fixture();
    v.messages[0].data.attachments = attachments;
    rejects(v, 'CHAT_INVALID_ATTACHMENTS');
  }
});
test('declarations validate byte metadata, uniqueness, safety and exact root fields', () => {
  for (const [key, value] of [
    ['assetId', '../escape'],
    ['sha256', 'oops'],
    ['size', 0],
    ['size', 2 ** 53],
    ['mime', 'bad'],
    ['path', 'private'],
  ]) {
    const input = fixture();
    input.media[0][key] = value;
    assert.throws(() => compileChatSnapshot(input));
  }
  const input = fixture();
  input.media.push(input.media[0]);
  rejects(input, 'CHAT_INVALID_MEDIA');
});
test('cross-source, cross-room, missing rooms, duplicate messages and invalid identity fail closed', () => {
  for (const mutate of [
    (v) => {
      v.rooms[0].sourceId = 'another';
    },
    (v) => {
      v.messages[0].data.sourceId = 'another';
    },
    (v) => {
      v.messages[0].data.roomId = '-1';
    },
    (v) => {
      v.rooms = [];
    },
    (v) => {
      v.messages.push(v.messages[0]);
    },
    (v) => {
      v.messages[0].data.id = '1';
    },
    (v) => {
      v.messages[0].id = 123;
    },
    (v) => {
      v.rooms[0].id = 123;
    },
    (v) => {
      v.messages[0].data.replyTo = 123;
    },
    (v) => {
      v.messages[0].data.sentAt = 'invalid';
    },
  ]) {
    const input = fixture();
    mutate(input);
    assert.throws(() => compileChatSnapshot(input));
  }
});
test('stable canonical logical hash ignores JSON key and input collection order, detects business changes', () => {
  const input = fixture();
  const first = compileChatSnapshot(input);
  assert.deepEqual(compileChatSnapshot(JSON.stringify(input)), first);
  const reordered = Object.fromEntries(Object.entries(input).reverse());
  assert.equal(compileChatSnapshot(reordered).sourceSha256, first.sourceSha256);
  input.rooms[0].title = 'changed';
  assert.notEqual(compileChatSnapshot(input).sourceSha256, first.sourceSha256);
  input.rooms[0].title = '合成房';
  input.revision++;
  assert.notEqual(compileChatSnapshot(input).sourceSha256, first.sourceSha256);
});
test('unsafe integers, nonpositive revision, non-UUID sources, unknown JSON and execution hooks reject', () => {
  for (const revision of [0, -1, 1.5, 2 ** 53, '7']) {
    const input = fixture();
    input.revision = revision;
    assert.throws(() => compileChatSnapshot(input));
  }
  const input = fixture();
  input.sourceId = 'not-uuid';
  rejects(input, 'CHAT_INVALID_SOURCE_ID');
  const unsafe = fixture();
  unsafe.messages[0].data.value = 2 ** 53;
  rejects(unsafe, 'CHAT_INVALID_JSON');
  let calls = 0;
  const getter = fixture();
  Object.defineProperty(getter, 'getter', {
    enumerable: true,
    get() {
      calls++;
      return 1;
    },
  });
  rejects(getter, 'CHAT_INVALID_JSON');
  assert.equal(calls, 0);
  const cyclic = fixture();
  cyclic.self = cyclic;
  rejects(cyclic, 'CHAT_INVALID_JSON');
  rejects(Buffer.from([0xff]), 'CHAT_INVALID_JSON');
});
test('JSON size, excessive depth and record count limits bound capture', () => {
  const input = fixture();
  input.messages[0].data.text = 'a'.repeat(16 * 1024 * 1024);
  rejects(input, 'CHAT_JSON_TOO_LARGE');
  const deep = fixture();
  let at = deep.rooms[0];
  for (let n = 0; n < 100; n++) {
    at.next = {};
    at = at.next;
  }
  rejects(deep, 'CHAT_JSON_TOO_LARGE');
  const many = fixture();
  many.messages = Array.from({ length: 10001 }, () => ({}));
  rejects(many, 'CHAT_RECORDS_TOO_LARGE');
});
