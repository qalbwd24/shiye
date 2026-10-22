import { createHash } from 'node:crypto';
import {
  productRecord,
  productMessageId,
  productConversationId,
} from '../../../public/shared/sync-product.js';
import { portableConfiguration } from './migration-metadata.mjs';

export const CHAT_SNAPSHOT_LIMITS = Object.freeze({
  maxJsonBytes: 16 * 1024 * 1024,
  maxNodes: 200000,
  maxDepth: 96,
  maxRecords: 10000,
});
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const hash = (v) => createHash('sha256').update(v).digest('hex');
const uuid = (v) =>
  typeof v === 'string' && /^[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$/.test(v);
const roomId = (v) => typeof v === 'string' && /^-?\d{1,20}$/.test(v);
const messageId = (v) =>
  typeof v === 'string' && v.length > 0 && v.length <= 20 && !/[\u0000-\u0020\u007f]/.test(v);
const assetId = (v) => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v);
const privateKey = (key) =>
  new Set([
    'withdrawalrecovery',
    'withdrawalrecoveries',
    'rawprofile',
    'auth',
    'credentials',
    'token',
    'accesstoken',
    'refreshtoken',
    'authorization',
    'cookie',
    'password',
    'secret',
    'privatekey',
  ]).has(key.replace(/[_\-\s]/g, '').toLowerCase());
const fail = (code) => {
  throw Object.assign(new Error(code), { code, status: code.includes('TOO_LARGE') ? 413 : 400 });
};
const canonical = (v) =>
  Array.isArray(v)
    ? v.map(canonical)
    : object(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((key) => [key, canonical(v[key])]),
        )
      : v;

function cloneJson(input) {
  if (typeof input === 'string' || Buffer.isBuffer(input)) {
    if (Buffer.byteLength(input) > CHAT_SNAPSHOT_LIMITS.maxJsonBytes) fail('CHAT_JSON_TOO_LARGE');
    try {
      input = JSON.parse(
        Buffer.isBuffer(input) ? new TextDecoder('utf-8', { fatal: true }).decode(input) : input,
      );
    } catch {
      fail('CHAT_INVALID_JSON');
    }
  }
  let nodes = 0,
    bytes = 0;
  const seen = new Set();
  function visit(value, depth) {
    if (++nodes > CHAT_SNAPSHOT_LIMITS.maxNodes || depth > CHAT_SNAPSHOT_LIMITS.maxDepth)
      fail('CHAT_JSON_TOO_LARGE');
    if (typeof value === 'string') {
      bytes += Buffer.byteLength(value);
      if (bytes > CHAT_SNAPSHOT_LIMITS.maxJsonBytes) fail('CHAT_JSON_TOO_LARGE');
      return value;
    }
    if (value === null || typeof value === 'boolean') return value;
    if (
      typeof value === 'number' &&
      Number.isFinite(value) &&
      (!Number.isInteger(value) || Number.isSafeInteger(value))
    )
      return value;
    if (!object(value) && !Array.isArray(value)) fail('CHAT_INVALID_JSON');
    if (
      ![Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(value)) ||
      seen.has(value)
    )
      fail('CHAT_INVALID_JSON');
    seen.add(value);
    const keys = Object.keys(value);
    if (
      Array.isArray(value) &&
      (keys.length !== value.length || keys.some((key, index) => key !== String(index)))
    )
      fail('CHAT_INVALID_JSON');
    const result = Array.isArray(value) ? [] : {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!Object.hasOwn(descriptor, 'value')) fail('CHAT_INVALID_JSON');
      bytes += Buffer.byteLength(key);
      if (bytes > CHAT_SNAPSHOT_LIMITS.maxJsonBytes) fail('CHAT_JSON_TOO_LARGE');
      Object.defineProperty(result, key, {
        value: visit(descriptor.value, depth + 1),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    seen.delete(value);
    return result;
  }
  const value = visit(input, 0);
  if (Buffer.byteLength(JSON.stringify(value)) > CHAT_SNAPSHOT_LIMITS.maxJsonBytes)
    fail('CHAT_JSON_TOO_LARGE');
  return value;
}
function rejectPrivate(value) {
  if (!object(value) || Object.keys(value).some(privateKey)) fail('CHAT_PRIVATE_DOMAIN');
}
function checkPrivateTree(value) {
  if (!value || typeof value !== 'object') return;
  if (Object.keys(value).some(privateKey)) fail('CHAT_PRIVATE_DOMAIN');
  for (const child of Object.values(value)) checkPrivateTree(child);
}
function privateConfig(value, path, excluded) {
  if (Array.isArray(value))
    return value.map((v, index) => privateConfig(v, `${path}[${index}]`, excluded));
  if (!object(value)) return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (privateKey(key))
      excluded.push({ path: `${path}.${key}`, reason: 'credential-or-private-domain' });
    else
      Object.defineProperty(result, key, {
        value: privateConfig(child, `${path}.${key}`, excluded),
        enumerable: true,
      });
  }
  return result;
}
function checkSource(value, sourceId, expectedRoom) {
  if (value.sourceId !== undefined && value.sourceId !== sourceId) fail('CHAT_CROSS_SOURCE');
  if (expectedRoom !== undefined && value.roomId !== undefined && value.roomId !== expectedRoom)
    fail('CHAT_CROSS_ROOM');
}

/** Read-only capture of explicitly supplied logical messages, never a send/owner switch. */
export function compileChatSnapshot(input) {
  const snapshot = cloneJson(input);
  if (!object(snapshot)) fail('CHAT_INVALID_FORMAT');
  const allowed = new Set([
    'format',
    'version',
    'sourceId',
    'revision',
    'rooms',
    'messages',
    'media',
  ]);
  if (Object.keys(snapshot).some((key) => !allowed.has(key))) fail('CHAT_UNKNOWN_ROOT_FIELD');
  if (snapshot.format !== 'shiye-chat-snapshot' || snapshot.version !== 1)
    fail('CHAT_INVALID_FORMAT');
  if (!uuid(snapshot.sourceId)) fail('CHAT_INVALID_SOURCE_ID');
  if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 1)
    fail('CHAT_INVALID_REVISION');
  if (
    !Array.isArray(snapshot.rooms) ||
    !Array.isArray(snapshot.messages) ||
    (snapshot.media !== undefined && !Array.isArray(snapshot.media))
  )
    fail('CHAT_INVALID_COLLECTIONS');
  if (
    snapshot.rooms.length + snapshot.messages.length + (snapshot.media?.length || 0) >
    CHAT_SNAPSHOT_LIMITS.maxRecords
  )
    fail('CHAT_RECORDS_TOO_LARGE');
  const sourceId = snapshot.sourceId;
  const records = [],
    excluded = [],
    requiredAssets = [],
    declarations = new Map(),
    rooms = new Set(),
    messages = new Set();
  for (const media of snapshot.media || []) {
    if (
      !object(media) ||
      Object.keys(media).some(
        (key) => !['assetId', 'sha256', 'size', 'mime', 'name'].includes(key),
      ) ||
      !assetId(media.assetId) ||
      declarations.has(media.assetId) ||
      !/^[a-f0-9]{64}$/.test(media.sha256 || '') ||
      !Number.isSafeInteger(media.size) ||
      media.size < 1 ||
      media.size > 512 * 1024 * 1024 ||
      typeof media.mime !== 'string' ||
      media.mime.length > 200 ||
      !/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(media.mime) ||
      typeof media.name !== 'string'
    )
      fail('CHAT_INVALID_MEDIA');
    declarations.set(media.assetId, media);
    requiredAssets.push(media);
  }
  const resolveAssets = (value) => {
    const refs = new Set();
    const visit = (item) => {
      if (!item || typeof item !== 'object') return;
      for (const [key, child] of Object.entries(item)) {
        if ((key === 'assetId' || key.endsWith('AssetId')) && child !== null && child !== '') {
          if (!assetId(child) || !declarations.has(child)) fail('CHAT_MISSING_MEDIA');
          refs.add(child);
        }
        visit(child);
      }
    };
    if (
      value.attachments !== undefined &&
      (!Array.isArray(value.attachments) || value.attachments.some((id) => !assetId(id)))
    )
      fail('CHAT_INVALID_ATTACHMENTS');
    for (const id of value.attachments || []) {
      if (!declarations.has(id)) fail('CHAT_MISSING_MEDIA');
      refs.add(id);
    }
    visit(value);
    return [...refs];
  };
  for (const [index, original] of snapshot.rooms.entries()) {
    rejectPrivate(original);
    if (!roomId(original.id) || rooms.has(original.id)) fail('CHAT_INVALID_ROOM_ID');
    checkSource(original, sourceId);
    rooms.add(original.id);
    const room = { ...original };
    for (const key of ['config', 'configuration']) {
      if (room[key] !== undefined) {
        if (!object(room[key])) fail('CHAT_INVALID_ROOM_CONFIG');
        const path = `rooms[${index}].${key}`;
        room[key] = portableConfiguration(privateConfig(room[key], path, excluded), {
          path,
          excluded,
        });
      }
    }
    checkPrivateTree(room);
    const record = productRecord('conversation', productConversationId(sourceId, room.id), room, {
      origin: { sourceId, roomId: room.id },
      assets: resolveAssets(room),
    });
    record.state = 'active';
    record.data._product.readOnlyProjection = true;
    record.data._product.sourceSnapshot = { version: 1, kind: 'chat', sourceId };
    records.push(record);
  }
  for (const message of snapshot.messages) {
    if (
      !object(message) ||
      Object.keys(message).some((key) => !['roomId', 'id', 'state', 'data'].includes(key)) ||
      !roomId(message.roomId) ||
      !rooms.has(message.roomId) ||
      !messageId(message.id) ||
      !['active', 'withdrawn'].includes(message.state)
    )
      fail('CHAT_INVALID_MESSAGE');
    const entityId = productMessageId(sourceId, message.roomId, message.id);
    if (messages.has(entityId)) fail('CHAT_DUPLICATE_MESSAGE');
    messages.add(entityId);
    if (message.state === 'withdrawn') {
      if (message.data !== undefined && (!object(message.data) || Object.keys(message.data).length))
        fail('CHAT_WITHDRAWN_BODY_FORBIDDEN');
      records.push({ entityType: 'chatMessage', entityId, state: 'withdrawn', data: {} });
      continue;
    }
    rejectPrivate(message.data);
    checkPrivateTree(message.data);
    checkSource(message.data, sourceId, message.roomId);
    if (
      message.data.id !== message.id ||
      typeof message.data.sentAt !== 'string' ||
      !Number.isFinite(Date.parse(message.data.sentAt)) ||
      (message.data.replyTo !== undefined && !messageId(message.data.replyTo)) ||
      message.data.withdrawn === true
    )
      fail('CHAT_INVALID_MESSAGE_DATA');
    const record = productRecord('message', entityId, message.data, {
      origin: { sourceId, roomId: message.roomId },
      conversation: productConversationId(sourceId, message.roomId),
      assets: resolveAssets(message.data),
    });
    record.state = 'active';
    record.data._product.readOnlyProjection = true;
    record.data._product.sourceSnapshot = { version: 1, kind: 'chat', sourceId };
    records.push(record);
  }
  const sourceSha256 = hash(
    JSON.stringify(
      canonical({
        schema: 1,
        sourceId,
        snapshotRevision: snapshot.revision,
        records: [...records].sort((a, b) =>
          a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0,
        ),
        requiredAssets: [...requiredAssets].sort((a, b) =>
          a.assetId < b.assetId ? -1 : a.assetId > b.assetId ? 1 : 0,
        ),
      }),
    ),
  );
  return {
    schema: 1,
    sourceId,
    snapshotKind: 'chat',
    snapshotRevision: snapshot.revision,
    sourceSha256,
    records,
    assets: [],
    requiredAssets,
    coverage: {
      disposition: 'read-only-logical-snapshot',
      roomCount: rooms.size,
      messageCount: messages.size,
      withdrawnCount: snapshot.messages.filter((m) => m.state === 'withdrawn').length,
      requiredAssetCount: requiredAssets.length,
      excluded,
      originalBytesVerified: false,
      completeComputerExport: false,
      changesMessageOwner: false,
    },
    issues: [],
  };
}
