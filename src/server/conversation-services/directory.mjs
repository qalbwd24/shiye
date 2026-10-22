import { randomUUID, createHash } from 'node:crypto';
import { registry } from './registry.mjs';
import { describeConversation, saveConversation } from './conversations.mjs';

const MAX_ROOMS = 1024;
const uuid = (value) =>
  typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const canonicalId = (value) =>
  typeof value === 'string' &&
  /^desktop:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}:-?\d{1,20}$/.test(value);
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const revision = (value) => Number.isSafeInteger(value) && value >= 0;
const fail = (code, status = 409) => {
  throw Object.assign(new Error(code), { code, status });
};
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : object(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
const digest = (value) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');

function readDirectory(db) {
  const directory = registry(db).directory;
  if (directory === undefined)
    return { version: 1, sourceId: null, revision: 0, order: [], states: [], creations: [] };
  if (
    !object(directory) ||
    directory.version !== 1 ||
    !uuid(directory.sourceId) ||
    !revision(directory.revision) ||
    !Array.isArray(directory.order) ||
    directory.order.some((id) => !canonicalId(id)) ||
    new Set(directory.order).size !== directory.order.length ||
    !Array.isArray(directory.states) ||
    directory.states.some(
      (state) =>
        !object(state) ||
        !canonicalId(state.conversationId) ||
        typeof state.pinned !== 'boolean' ||
        typeof state.archived !== 'boolean' ||
        !revision(state.revision),
    ) ||
    new Set(directory.states.map((state) => state.conversationId)).size !==
      directory.states.length ||
    !Array.isArray(directory.creations) ||
    directory.creations.some(
      (receipt) =>
        !object(receipt) ||
        !uuid(receipt.operationId) ||
        !/^[a-f0-9]{64}$/.test(receipt.digest) ||
        !canonicalId(receipt.conversationId),
    ) ||
    new Set(directory.creations.map((receipt) => receipt.operationId)).size !==
      directory.creations.length
  )
    fail('DIRECTORY_INVALID_PERSISTED_STATE');
  return directory;
}

function realIds(db) {
  const ids = [];
  for (const room of db.chatJournal?.rooms || []) {
    const id = `desktop:${room.sourceId}:${room.id}`;
    if (!canonicalId(id)) fail('DIRECTORY_INVALID_ROOM_ID');
    ids.push(id);
  }
  for (const conversation of registry(db).conversations || []) {
    if (!canonicalId(conversation.id)) fail('DIRECTORY_INVALID_ROOM_ID');
    ids.push(conversation.id);
  }
  return [...new Set(ids)];
}
const fullOrder = (directory, ids) => [
  ...directory.order.filter((id) => ids.includes(id)),
  ...ids.filter((id) => !directory.order.includes(id)),
];
const bump = (value) => {
  if (value === Number.MAX_SAFE_INTEGER) fail('DIRECTORY_REVISION_EXHAUSTED');
  return value + 1;
};
function commitDirectory(db, directory) {
  db.conversationServices ||= structuredClone(registry(db));
  db.conversationServices.directory = directory;
}
function inputObject(input, allowed) {
  if (!object(input) || Object.keys(input).some((key) => !allowed.includes(key)))
    fail('DIRECTORY_INVALID_INPUT', 400);
}
function checkDirectoryRevision(directory, expected) {
  if (expected !== undefined && (!revision(expected) || expected !== directory.revision))
    fail('DIRECTORY_REVISION_CONFLICT');
}
function viewRow(db, directory, id) {
  const state = directory.states.find((item) => item.conversationId === id);
  const [, sourceId, roomId] = id.split(':');
  const room = db.chatJournal?.rooms.find(
    (item) => item.sourceId === sourceId && item.id === roomId,
  );
  const conversation = describeConversation(db, { conversationId: id });
  return {
    ...conversation,
    selfName:
      conversation.participants.find((participant) => participant.kind === 'self')?.name || '我',
    idleHours: room?.idleHours ?? 5,
    description: room?.description ?? '',
    pinned: state?.pinned ?? false,
    archived: state?.archived ?? false,
    listStateRevision: state?.revision ?? 0,
  };
}

/** Shared directory over real registered server rooms. Reading never allocates an ID. */
export function directoryView(db) {
  const directory = readDirectory(db),
    order = fullOrder(directory, realIds(db));
  const conversations = order.map((id) => viewRow(db, directory, id));
  conversations.sort((a, b) => Number(b.pinned) - Number(a.pinned));
  return {
    version: 1,
    sourceId: directory.sourceId,
    revision: directory.revision,
    order,
    conversations,
  };
}

export function createDirectoryConversation(db, input, { fixedId = false } = {}) {
  inputObject(input, [
    'operationId',
    'title',
    'category',
    'idleHours',
    'mode',
    'selfName',
    'description',
    'clientMetadata',
    'expectedDirectoryRevision',
    ...(fixedId ? ['conversationId'] : []),
  ]);
  if (!uuid(input.operationId)) fail('DIRECTORY_OPERATION_ID_REQUIRED', 400);
  if (
    fixedId &&
    (!canonicalId(input.conversationId) || input.conversationId.endsWith(':-900000001'))
  )
    fail('DIRECTORY_INVALID_ROOM_ID', 400);
  // All accepted request properties are scalar; never silently hash an undefined,
  // non-finite or executable extension into the same creation receipt.
  for (const [key, value] of Object.entries(input)) {
    if (key === 'conversationId') continue;
    if (key === 'category' && value === null) continue;
    if (key === 'clientMetadata' && object(value)) continue;
    if (
      ['idleHours', 'expectedDirectoryRevision'].includes(key)
        ? typeof value !== 'number' || !Number.isFinite(value)
        : typeof value !== 'string'
    )
      fail('DIRECTORY_INVALID_INPUT', 400);
  }
  if (input.description !== undefined && input.description.length > 2000)
    fail('DIRECTORY_INVALID_DESCRIPTION', 400);
  const old = readDirectory(db),
    requestDigest = digest(input);
  const receipt = old.creations.find((item) => item.operationId === input.operationId);
  if (receipt) {
    if (receipt.digest !== requestDigest) fail('DIRECTORY_OPERATION_REUSED');
    if (!realIds(db).includes(receipt.conversationId)) fail('DIRECTORY_CREATION_TARGET_MISSING');
    return {
      ...viewRow(db, old, receipt.conversationId),
      directoryRevision: old.revision,
      replayed: true,
    };
  }
  checkDirectoryRevision(old, input.expectedDirectoryRevision);
  const ids = realIds(db);
  if (ids.length >= MAX_ROOMS || old.creations.length >= MAX_ROOMS) fail('DIRECTORY_ROOM_LIMIT');
  const directory = structuredClone(old);
  directory.sourceId ||= randomUUID();
  const used = new Set([...ids, ...directory.creations.map((item) => item.conversationId)]);
  let number = -1n;
  while (used.has(`desktop:${directory.sourceId}:${number}`) || number === -900000001n) number--;
  const conversationId = fixedId ? input.conversationId : `desktop:${directory.sourceId}:${number}`;
  if (!canonicalId(conversationId)) fail('DIRECTORY_ROOM_ID_EXHAUSTED');
  if (used.has(conversationId)) fail('DIRECTORY_ROOM_ID_COLLISION');
  const nextRevision = bump(directory.revision);
  saveConversation(db, {
    conversationId,
    expectedRevision: 0,
    title: input.title,
    category: input.category,
    idleHours: input.idleHours,
    mode: input.mode,
    selfName: input.selfName,
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.clientMetadata === undefined ? {} : { clientMetadata: input.clientMetadata }),
  });
  directory.order = [...fullOrder(directory, ids), conversationId];
  directory.creations.push({
    operationId: input.operationId,
    digest: requestDigest,
    conversationId,
  });
  directory.revision = nextRevision;
  commitDirectory(db, directory);
  return {
    ...viewRow(db, directory, conversationId),
    directoryRevision: directory.revision,
    replayed: false,
  };
}

export function createLocalDirectoryConversation(db, input) {
  return createDirectoryConversation(
    db,
    {
      selfName: '我',
      description: '',
      clientMetadata: {},
      category: null,
      idleHours: 5,
      mode: 'session',
      ...input,
    },
    { fixedId: true },
  );
}

export function updateDirectoryState(db, input) {
  inputObject(input, [
    'conversationId',
    'expectedRevision',
    'expectedDirectoryRevision',
    'pinned',
    'archived',
  ]);
  if (
    !canonicalId(input.conversationId) ||
    !revision(input.expectedRevision) ||
    (input.pinned === undefined && input.archived === undefined) ||
    (input.pinned !== undefined && typeof input.pinned !== 'boolean') ||
    (input.archived !== undefined && typeof input.archived !== 'boolean')
  )
    fail('DIRECTORY_INVALID_INPUT', 400);
  const old = readDirectory(db),
    ids = realIds(db);
  if (!ids.includes(input.conversationId)) fail('DIRECTORY_CONVERSATION_NOT_FOUND', 404);
  checkDirectoryRevision(old, input.expectedDirectoryRevision);
  const previous = old.states.find((item) => item.conversationId === input.conversationId);
  if (input.expectedRevision !== (previous?.revision ?? 0))
    fail('DIRECTORY_STATE_REVISION_CONFLICT');
  if (input.archived === true && input.conversationId.endsWith(':-900000001'))
    fail('DIRECTORY_SYSTEM_ARCHIVE_FORBIDDEN');
  const pinned = input.pinned ?? previous?.pinned ?? false;
  const archived = input.archived ?? previous?.archived ?? false;
  if (pinned === (previous?.pinned ?? false) && archived === (previous?.archived ?? false))
    return { ...viewRow(db, old, input.conversationId), directoryRevision: old.revision };
  const directory = structuredClone(old);
  directory.sourceId ||= randomUUID();
  const state = {
    ...previous,
    conversationId: input.conversationId,
    pinned,
    archived,
    revision: bump(previous?.revision ?? 0),
  };
  directory.states = previous
    ? directory.states.map((item) => (item.conversationId === state.conversationId ? state : item))
    : [...directory.states, state];
  directory.order = fullOrder(directory, ids);
  directory.revision = bump(directory.revision);
  commitDirectory(db, directory);
  return { ...viewRow(db, directory, input.conversationId), directoryRevision: directory.revision };
}

export function saveDirectoryOrder(db, input) {
  inputObject(input, ['expectedRevision', 'order']);
  if (
    !revision(input.expectedRevision) ||
    !Array.isArray(input.order) ||
    input.order.some((id) => !canonicalId(id))
  )
    fail('DIRECTORY_INVALID_INPUT', 400);
  const old = readDirectory(db),
    ids = realIds(db);
  checkDirectoryRevision(old, input.expectedRevision);
  if (
    input.order.length !== ids.length ||
    new Set(input.order).size !== ids.length ||
    input.order.some((id) => !ids.includes(id))
  )
    fail('DIRECTORY_ORDER_INCOMPLETE');
  if (JSON.stringify(input.order) === JSON.stringify(fullOrder(old, ids))) return directoryView(db);
  const directory = structuredClone(old);
  directory.sourceId ||= randomUUID();
  directory.order = [...input.order];
  directory.revision = bump(directory.revision);
  commitDirectory(db, directory);
  return directoryView(db);
}
