import { randomUUID, createHash } from 'node:crypto';
import { directoryView } from '../conversation-services/directory.mjs';
import { portableConfiguration } from '../sync-product/migration-metadata.mjs';
import { sourceMessageConflictEntities } from './source-message-conflicts.mjs';
import { sourceCollectionReceiptEntities } from './desktop-collection-commit.mjs';
import { createMessageEditProjection } from './message-edit-projection.mjs';

const MAX_CHANGES = 50000;
const MAX_PAGE = 200;
const MAX_ENTITY_BYTES = 64 * 1024 * 1024;
const PAGE_BYTES = 900 * 1024;
const INLINE_BYTES = 512 * 1024;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const uuid = (value) =>
  typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const key = (value) => JSON.stringify([value.entityType, value.entityId]);
const identity = (value) =>
  object(value) &&
  typeof value.entityType === 'string' &&
  value.entityType.length > 0 &&
  typeof value.entityId === 'string' &&
  value.entityId.length > 0;
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
            .map((name) => [name, canonical(value[name])]),
        )
      : value;
const hash = (value) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
const copy = (value) => structuredClone(value);
const readCaches = new WeakMap();

/** Published db objects are immutable under the owner's copy-on-write contract.
 * Isolated tools/tests that deliberately edit one in place must clear its cache.
 * Preparing an unpublished, mutable next never primes this reader cache. */
export function clearSharedReadCache(db) {
  readCaches.delete(db);
}

function readIndex(db) {
  const index = db._sharedSync;
  if (index === undefined) return null;
  if (
    !object(index) ||
    index.version !== 1 ||
    !uuid(index.libraryId) ||
    !uuid(index.epoch) ||
    !integer(index.seq) ||
    !integer(index.earliestSeq) ||
    index.earliestSeq > index.seq ||
    !Array.isArray(index.entities) ||
    !Array.isArray(index.changes) ||
    index.changes.length > MAX_CHANGES
  )
    fail('SHARED_INDEX_INVALID');
  if (
    Object.keys(index).some(
      (name) =>
        !['version', 'libraryId', 'epoch', 'seq', 'earliestSeq', 'entities', 'changes'].includes(
          name,
        ),
    )
  )
    fail('SHARED_INDEX_INVALID');
  const entities = new Map();
  const entitySequences = new Set();
  for (const entity of index.entities) {
    if (
      !identity(entity) ||
      !integer(entity.revision) ||
      entity.revision < 1 ||
      !integer(entity.seq) ||
      entity.seq < 1 ||
      entity.seq > index.seq ||
      !['active', 'deleted', 'withdrawn'].includes(entity.state) ||
      !/^[a-f0-9]{64}$/.test(entity.sha256 || '') ||
      entity.revision > entity.seq ||
      entitySequences.has(entity.seq) ||
      Object.keys(entity).some(
        (name) => !['entityType', 'entityId', 'revision', 'seq', 'state', 'sha256'].includes(name),
      ) ||
      entities.has(key(entity))
    )
      fail('SHARED_INDEX_INVALID');
    entities.set(key(entity), entity);
    entitySequences.add(entity.seq);
  }
  let sequence = index.earliestSeq;
  const recent = new Map();
  for (const change of index.changes) {
    if (
      !identity(change) ||
      Object.keys(change).some((name) => !['seq', 'entityType', 'entityId'].includes(name)) ||
      change.seq !== sequence + 1 ||
      !entities.has(key(change))
    )
      fail('SHARED_INDEX_INVALID');
    sequence = change.seq;
    recent.set(key(change), change.seq);
  }
  if (sequence !== index.seq) fail('SHARED_INDEX_INVALID');
  for (const entity of entities.values())
    if (entity.seq > index.earliestSeq && recent.get(key(entity)) !== entity.seq)
      fail('SHARED_INDEX_INVALID');
  return index;
}

function readState(db) {
  const cached = readCaches.get(db),
    raw = db._sharedSync;
  const header = JSON.stringify([
    raw?.version,
    raw?.libraryId,
    raw?.epoch,
    raw?.seq,
    raw?.earliestSeq,
    raw?.entities?.length,
    raw?.changes?.length,
  ]);
  if (
    cached &&
    cached.raw === raw &&
    cached.header === header &&
    cached.entities === raw?.entities &&
    cached.changes === raw?.changes
  )
    return cached;
  const index = readIndex(db);
  const state = {
    raw,
    index,
    entities: raw?.entities,
    changes: raw?.changes,
    header,
    byKey: new Map((index?.entities || []).map((entity) => [key(entity), entity])),
  };
  readCaches.set(db, state);
  return state;
}

function withdrawn(value) {
  return value?.state === 'withdrawn' || value?.withdrawn === true;
}
function scrubEntry(entry) {
  if (!entry.chatJournal?.messages?.some(withdrawn)) return entry;
  const data = copy(entry);
  if (Array.isArray(data.chatJournal?.messages)) {
    data.chatJournal.messages = data.chatJournal.messages.map((message) =>
      withdrawn(message)
        ? {
            id: message.id,
            sentAt: message.sentAt,
            withdrawn: true,
            ...(message.revision === undefined ? {} : { revision: message.revision }),
          }
        : message,
    );
    // Chat projections may contain historical duplicate copies. Message identity
    // and active message values remain available in chatJournal.messages.
    if (data.chatJournal.messages.some(withdrawn)) {
      for (const field of [
        'content',
        'markdownSource',
        'markdownHtml',
        'editorOriginalHtml',
        'richDoc',
        'body',
        'messageUnits',
        '_canonical',
      ])
        delete data[field];
      data.history = [];
    }
  }
  return data;
}
function flatten(db) {
  const result = new Map();
  const editProjection =
    db._messageEditProjectionVersion === 1 ? createMessageEditProjection(db) : null;
  const add = (entityType, entityId, data, extra = {}) => {
    const row = { entityType, entityId, state: 'active', data, ...extra };
    if (!identity(row) || result.has(key(row))) fail('SHARED_BUSINESS_ID_INVALID');
    result.set(key(row), row);
  };
  const units = new Map();
  for (const unit of db.messageStore?.units || []) {
    if (unit.origin?.kind !== 'diary') continue;
    const list = units.get(unit.origin.entryId) || [];
    list.push(
      withdrawn(unit)
        ? {
            id: unit.id,
            origin: copy(unit.origin),
            eventTime: copy(unit.eventTime),
            revision: unit.revision,
            state: 'withdrawn',
            body: null,
            replyTo: unit.replyTo ?? null,
          }
        : unit,
    );
    units.set(unit.origin.entryId, list);
  }
  for (const entry of db.entries || []) {
    if (withdrawn(entry)) {
      add('entry', entry.id, {}, { state: 'withdrawn' });
      continue;
    }
    const layout = db.messageStore?.layouts?.[entry.id];
    add(
      'entry',
      entry.id,
      scrubEntry(editProjection ? editProjection.entry(entry) : entry),
      layout ? { canonical: { units: units.get(entry.id) || [], layout } } : {},
    );
  }
  const directory = directoryView(db);
  for (const head of editProjection?.heads() || [])
    add('message-edit-head', head.entityId, head.data, { state: head.state });
  for (const conflict of sourceMessageConflictEntities(db))
    add('source-message-conflict', conflict.entityId, conflict.data, { state: conflict.state });
  for (const receipt of sourceCollectionReceiptEntities(db))
    add('source-collection-receipt', receipt.id, receipt.data);
  add('order', 'conversation-directory', { revision: directory.revision, order: directory.order });
  for (const room of directory.conversations) {
    // Generated conversation state is configuration, never a message body.
    add('conversation', room.conversationId, portableConfiguration(room));
  }
  for (const media of db.media || []) {
    const { originalPath: _originalPath, thumbnailPath: _thumbnailPath, ...metadata } = media;
    add('media', media.id, portableConfiguration(metadata));
  }
  for (const kind of ['category', 'tag']) {
    const raw = [
      ...(db[kind === 'category' ? 'categories' : 'tags'] || []),
      ...(db.entries || [])
        .flatMap((entry) => (kind === 'category' ? [entry.category] : entry.tags || []))
        .filter((name) => typeof name === 'string' && name),
    ];
    const values = new Map();
    for (const item of raw) {
      const name = typeof item === 'string' ? item : item?.name;
      if (typeof name !== 'string' || !name) fail('SHARED_TAXONOMY_INVALID');
      const entityId =
        object(item) && typeof item.id === 'string' ? item.id : `taxonomy:${hash([kind, name])}`;
      if (values.has(entityId)) continue;
      values.set(entityId, object(item) ? { ...copy(item), kind, name } : { kind, name });
    }
    for (const [id, value] of values) add('taxonomy', id, value);
    add('order', `taxonomy:${kind}`, { kind, ids: [...values.keys()] });
  }
  for (const template of db.templates || []) add('template', template.id, template);
  for (const sticker of db.stickers || [])
    add('sticker', sticker.id, portableConfiguration(sticker), {
      state: sticker.deleted ? 'deleted' : 'active',
    });
  add('settings', 'library', portableConfiguration(db.settings || {}));
  const preferences = db.sharedClientPreferences;
  if (preferences !== undefined) {
    if (!object(preferences) || preferences.version !== 1 || !Array.isArray(preferences.profiles))
      fail('SHARED_PREFERENCES_SCHEMA');
    const scopes = new Set();
    for (const profile of preferences.profiles) {
      if (
        !object(profile) ||
        !['shared:thoughts', 'desktop:thoughts', 'android:thoughts', 'android:diary'].includes(
          profile.scope,
        ) ||
        scopes.has(profile.scope) ||
        !integer(profile.revision) ||
        profile.revision < 1 ||
        !object(profile.values)
      )
        fail('SHARED_PREFERENCES_SCHEMA');
      scopes.add(profile.scope);
      add('client-preferences', profile.scope, portableConfiguration(profile));
    }
  }
  const services = db.conversationServices;
  for (const wallpaper of services?.wallpapers || [])
    add('wallpaper', wallpaper.conversationId, copy(wallpaper));
  for (const instance of services?.instances || []) {
    const { state: _state, creationKey: _creationKey, ...configuration } = instance;
    add('service', instance.id, {
      ...portableConfiguration(configuration),
      config: portableConfiguration(instance.state?.config || {}),
    });
  }
  for (const binding of services?.bindings || [])
    add('binding', binding.id, portableConfiguration(binding));
  if (db.revisit?.config)
    add('service', 'legacy-revisit', {
      providerId: 'revisit',
      config: portableConfiguration(db.revisit.config),
    });
  return result;
}
const fingerprintValue = (row) => ({
  state: row.state,
  data: row.data,
  ...(row.canonical ? { canonical: row.canonical } : {}),
});
const fingerprint = (row) => hash(fingerprintValue(row));

/** Called synchronously before the owner's existing JSON write+rename. No I/O,
 * second database, body journal, credentials, runner leases or private archives. */
export function prepareSharedCommit(previous, next, { enabled = false, clock: _clock } = {}) {
  const prior = readIndex(previous);
  const supplied = readIndex(next);
  if (prior && !supplied) fail('SHARED_INDEX_REMOVED');
  if (prior && JSON.stringify(prior) !== JSON.stringify(supplied) && hash(prior) !== hash(supplied))
    fail('SHARED_INDEX_CHANGED_OUTSIDE_COMMIT');
  if (!supplied && !enabled) return null;
  if (
    ![undefined, 0, 1].includes(previous._messageEditProjectionVersion) ||
    ![undefined, 0, 1].includes(next._messageEditProjectionVersion)
  )
    fail('SHARED_MESSAGE_EDIT_PROJECTION_UNSUPPORTED');
  const migratingMessageProjection = previous._messageEditProjectionVersion !== 1;
  next._messageEditProjectionVersion = 1;
  const index = supplied
    ? copy(supplied)
    : {
        version: 1,
        libraryId: randomUUID(),
        epoch: randomUUID(),
        seq: 0,
        earliestSeq: 0,
        entities: [],
        changes: [],
      };
  const current = flatten(next),
    previousRows = prior ? flatten(previous) : null,
    indexed = new Map(index.entities.map((entity) => [key(entity), entity]));
  const all = new Set([...current.keys(), ...indexed.keys()]);
  for (const id of [...all].sort()) {
    const before = indexed.get(id),
      value = current.get(id);
    const row = value || {
      entityType: before.entityType,
      entityId: before.entityId,
      state: before.state === 'withdrawn' ? 'withdrawn' : 'deleted',
      data: {},
    };
    if (before?.state === 'withdrawn' && row.state !== 'withdrawn') fail('SHARED_TOMBSTONE_FINAL');
    // The published previous object and its index belong to the same COW
    // generation. Exact JSON equality of the entire public projection proves
    // its fingerprint is unchanged, including history, unknown fields and
    // canonical units/layout. Unequal bytes still require the canonical hash:
    // property insertion order alone must never create a business revision.
    // These strings are temporary, never retained in a per-library cache.
    const previousRow = previousRows?.get(id);
    const unchanged =
      !migratingMessageProjection &&
      before &&
      previousRow &&
      JSON.stringify(fingerprintValue(previousRow)) === JSON.stringify(fingerprintValue(row));
    const sha256 = unchanged ? before.sha256 : fingerprint(row);
    if (before?.sha256 === sha256 && before.state === row.state) continue;
    if (index.seq === Number.MAX_SAFE_INTEGER || before?.revision === Number.MAX_SAFE_INTEGER)
      fail('SHARED_REVISION_EXHAUSTED');
    const entity = {
      ...before,
      entityType: row.entityType,
      entityId: row.entityId,
      revision: (before?.revision || 0) + 1,
      seq: ++index.seq,
      state: row.state,
      sha256,
    };
    indexed.set(id, entity);
    index.changes.push({
      seq: entity.seq,
      entityType: entity.entityType,
      entityId: entity.entityId,
    });
  }
  index.entities = [...indexed.values()].sort((a, b) =>
    key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0,
  );
  if (index.changes.length > MAX_CHANGES) {
    const count = index.changes.length - MAX_CHANGES;
    index.earliestSeq = index.changes[count - 1].seq;
    index.changes = index.changes.slice(count);
  }
  next._sharedSync = index;
  return index;
}

export function sharedInfo(db) {
  const { index } = readState(db);
  return index
    ? {
        enabled: true,
        version: 1,
        libraryId: index.libraryId,
        epoch: index.epoch,
        seq: index.seq,
        earliestSeq: index.earliestSeq,
        entityCount: index.entities.length,
      }
    : { enabled: false, version: 1 };
}
function pageLimit(value = MAX_PAGE) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_PAGE)
    fail('SHARED_INVALID_PAGE', 400);
  return value;
}
function reader(db) {
  const state = readState(db),
    { index } = state;
  if (!index) fail('SHARED_SYNC_NOT_ENABLED', 503);
  if (!state.current) {
    state.current = flatten(db);
    state.fingerprints = new Map([...state.current].map(([id, row]) => [id, fingerprint(row)]));
  }
  const current = state.current;
  const envelope = (meta) => {
    const value = meta.state === 'active' ? current.get(key(meta)) : null;
    if (meta.state === 'active' && (!value || state.fingerprints.get(key(meta)) !== meta.sha256))
      fail('SHARED_INDEX_OUT_OF_DATE');
    return {
      entityType: meta.entityType,
      entityId: meta.entityId,
      revision: meta.revision,
      seq: meta.seq,
      state: meta.state,
      sha256: meta.sha256,
      data: value ? copy(value.data) : {},
      ...(value?.canonical ? { canonical: copy(value.canonical) } : {}),
    };
  };
  return { index, envelope, byKey: state.byKey, state };
}

function entityWire(view, meta) {
  const id = key(meta);
  if (view.state.lastWire?.id === id) return view.state.lastWire;
  const bytes = Buffer.from(JSON.stringify(view.envelope(meta)), 'utf8');
  if (bytes.length > MAX_ENTITY_BYTES) fail('SHARED_ENTITY_TOO_LARGE', 413);
  const payload = {
    version: 1,
    kind: 'shared-entity-json',
    byteLength: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    entityType: meta.entityType,
    entityId: meta.entityId,
    revision: meta.revision,
    seq: meta.seq,
  };
  // One immutable generation's last serialized entity only, never whole-library
  // JSON strings or an unpublished mutable next. Metadata contains no body.
  const wire = { id, bytes, payload };
  view.state.lastWire = wire;
  return wire;
}
function wireRow(view, meta) {
  const wire = entityWire(view, meta);
  if (wire.bytes.length <= INLINE_BYTES) return JSON.parse(wire.bytes.toString('utf8'));
  const { entityType, entityId, revision, seq, state, sha256 } = meta;
  return { entityType, entityId, revision, seq, state, sha256, payload: wire.payload };
}

export function sharedEntityRead(db, { entityType, entityId, revision, offset, length } = {}) {
  if (
    typeof entityType !== 'string' ||
    !entityType ||
    typeof entityId !== 'string' ||
    !entityId ||
    !integer(revision) ||
    revision < 1 ||
    !integer(offset) ||
    !integer(length) ||
    length < 1 ||
    length > 256 * 1024
  )
    fail('SHARED_INVALID_ENTITY_RANGE', 400);
  const view = reader(db),
    meta = view.byKey.get(key({ entityType, entityId }));
  if (!meta || meta.revision !== revision) fail('SHARED_ENTITY_CHANGED');
  const { bytes, payload } = entityWire(view, meta);
  if (offset > bytes.length) fail('SHARED_INVALID_ENTITY_RANGE', 416);
  const chunk = bytes.subarray(offset, Math.min(offset + length, bytes.length));
  return {
    payload,
    offset,
    next: offset + chunk.length,
    done: offset + chunk.length === bytes.length,
    bytesBase64: chunk.toString('base64'),
    chunkSha256: createHash('sha256').update(chunk).digest('hex'),
  };
}

export function sharedSnapshot(db, { afterKey, limit } = {}) {
  const size = pageLimit(limit),
    view = reader(db),
    { index } = view;
  if (afterKey !== undefined && typeof afterKey !== 'string') fail('SHARED_INVALID_AFTER_KEY', 400);
  const remaining = index.entities.filter((meta) => afterKey === undefined || key(meta) > afterKey);
  const page = [],
    entities = [];
  let bytes = 0;
  for (const meta of remaining.slice(0, size)) {
    const row = wireRow(view, meta),
      count = Buffer.byteLength(JSON.stringify(row));
    if (page.length && bytes + count > PAGE_BYTES) break;
    page.push(meta);
    entities.push(row);
    bytes += count;
  }
  return {
    ...sharedInfo(db),
    entities,
    afterKey: page.length ? key(page.at(-1)) : (afterKey ?? null),
    hasMore: remaining.length > page.length,
    watermark: index.seq,
  };
}

export function sharedPull(db, { after, limit } = {}) {
  const size = pageLimit(limit),
    view = reader(db),
    { index, byKey } = view;
  if (!integer(after) || after > index.seq) fail('SHARED_INVALID_CURSOR', 400);
  if (after < index.earliestSeq) fail('SHARED_RESNAPSHOT_REQUIRED');
  const remaining = index.changes.filter((change) => change.seq > after),
    page = [],
    changes = [];
  let bytes = 0;
  for (const change of remaining.slice(0, size)) {
    const row = { ...wireRow(view, byKey.get(key(change))), changeSeq: change.seq },
      count = Buffer.byteLength(JSON.stringify(row));
    if (page.length && bytes + count > PAGE_BYTES) break;
    page.push(change);
    changes.push(row);
    bytes += count;
  }
  return {
    ...sharedInfo(db),
    changes,
    after: page.length ? page.at(-1).seq : after,
    hasMore: remaining.length > page.length,
    watermark: index.seq,
  };
}
