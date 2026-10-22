import { Sha256, sha256Bytes } from './sync-v2-media.js';
import { richMediaReferences } from './rich-document.js';

export const SHARED_SEED_MAGIC = 'SHIYE-SEED-V1\n';
export const SHARED_SEED_FORMAT = 'shiye-shared-seed';
export const SHARED_SEED_LIMITS = Object.freeze({
  manifest: 32 * 1024 ** 2,
  entity: 64 * 1024 ** 2,
  entityTotal: 512 * 1024 ** 2,
  original: 16 * 1024 ** 3,
  total: 64 * 1024 ** 3,
  members: 200000,
  chunk: 256 * 1024,
});
const preparedSeeds = new WeakMap();
const fail = (code) => {
  throw Object.assign(Error(code), { code, status: 422 });
};
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const uuid = (v) =>
  typeof v === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const hash = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const integer = (v, min, max = Number.MAX_SAFE_INTEGER) =>
  Number.isSafeInteger(v) && v >= min && v <= max;
const conversation = (v) =>
  typeof v === 'string' &&
  /^desktop:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}:-?\d{1,20}$/.test(v);
export const SHARED_SEED_FEED_FEATURE = 'conversation-feeds-v1';
export const SHARED_SEED_ATTESTATION_FEATURE = 'seed-attestation-ed25519-v1';
export const sharedSeedEntityKey = (v) => JSON.stringify([v.entityType, v.entityId]);
function inert(value, depth = 0, seen = new Set()) {
  if (depth > 96) fail('SHARED_SEED_INVALID_JSON');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    (!Number.isInteger(value) || Number.isSafeInteger(value))
  )
    return value;
  if (
    !value ||
    typeof value !== 'object' ||
    ![Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(value)) ||
    seen.has(value)
  )
    fail('SHARED_SEED_INVALID_JSON');
  seen.add(value);
  const result = Array.isArray(value) ? [] : {};
  for (const k of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && k === 'length') continue;
    const d = Object.getOwnPropertyDescriptor(value, k);
    if (typeof k !== 'string' || !d.enumerable || !Object.hasOwn(d, 'value'))
      fail('SHARED_SEED_INVALID_JSON');
    Object.defineProperty(result, k, {
      value: inert(d.value, depth + 1, seen),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  if (Array.isArray(value) && Object.keys(result).length !== value.length)
    fail('SHARED_SEED_INVALID_JSON');
  seen.delete(value);
  return result;
}
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : object(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((k) => [k, canonical(value[k])]),
        )
      : value;
export const sharedSeedEntityBytes = (row) =>
  new TextEncoder().encode(JSON.stringify(canonical(row)));
export const sharedSeedFeedRosterSha256 = (feed) =>
  sha256Bytes(
    sharedSeedEntityBytes({
      conversationId: feed.conversationId,
      watermark: feed.watermark,
      feedRevision: feed.feedRevision,
      messages: feed.messages,
      redactions: feed.redactions,
    }),
  );
export function validateSharedSeedFeedPart(raw, descriptor) {
  const part = inert(raw);
  if (
    !object(part) ||
    part.format !== 'shiye-conversation-feed-part' ||
    part.version !== 1 ||
    !conversation(part.conversationId) ||
    !integer(part.watermark, 0) ||
    !hash(part.feedRevision) ||
    !Array.isArray(part.messages) ||
    !Array.isArray(part.redactions) ||
    Object.keys(part).some(
      (key) =>
        ![
          'format',
          'version',
          'conversationId',
          'watermark',
          'feedRevision',
          'messages',
          'redactions',
        ].includes(key),
    )
  )
    fail('SHARED_SEED_INVALID_FEED_PART');
  if (
    descriptor &&
    (part.conversationId !== descriptor.conversationId ||
      part.watermark !== descriptor.watermark ||
      part.feedRevision !== descriptor.feedRevision)
  )
    fail('SHARED_SEED_FEED_GENERATION_MISMATCH');
  for (const row of part.messages) {
    if (
      !object(row) ||
      row.conversationId !== part.conversationId ||
      typeof row.id !== 'string' ||
      !row.id ||
      row.id.length > 1024 ||
      !['message', 'history', 'comment'].includes(row.kind) ||
      !['active', 'withdrawn', 'unavailable'].includes(row.state) ||
      Object.hasOwn(row, 'payload')
    )
      fail('SHARED_SEED_INVALID_FEED_ROW');
    if (
      row.state !== 'active' &&
      ((row.body !== undefined && row.body !== null) ||
        (row.source !== undefined && row.source !== null) ||
        (row.markdown !== undefined && row.markdown !== '') ||
        (row.attachments !== undefined &&
          (!Array.isArray(row.attachments) || row.attachments.length)))
    )
      fail('SHARED_SEED_FEED_TOMBSTONE_BODY');
  }
  for (const row of part.redactions)
    if (
      !object(row) ||
      typeof row.id !== 'string' ||
      !row.id ||
      !['withdrawn', 'unavailable'].includes(row.state)
    )
      fail('SHARED_SEED_INVALID_FEED_REDACTION');
  if (sharedSeedEntityBytes(part).length > SHARED_SEED_LIMITS.entity)
    fail('SHARED_SEED_FEED_PART_TOO_LARGE');
  return part;
}
export const sharedSeedLogicalSha256 = (row) =>
  sha256Bytes(
    new TextEncoder().encode(
      JSON.stringify(
        canonical({
          state: row.state,
          data: row.data,
          ...(row.canonical ? { canonical: row.canonical } : {}),
        }),
      ),
    ),
  );
export function validateSharedSeedEntity(raw) {
  const row = inert(raw);
  if (
    !object(row) ||
    typeof row.entityType !== 'string' ||
    !/^[a-z][a-zA-Z0-9-]{0,63}$/.test(row.entityType) ||
    typeof row.entityId !== 'string' ||
    !row.entityId ||
    row.entityId.length > 256 ||
    !integer(row.revision, 1) ||
    !integer(row.seq, 0) ||
    !['active', 'deleted', 'withdrawn'].includes(row.state) ||
    !object(row.data) ||
    !hash(row.sha256) ||
    Object.hasOwn(row, 'payload')
  )
    fail('SHARED_SEED_INVALID_ENTITY');
  if (
    row.state !== 'active' &&
    (Object.keys(row.data).length || (row.canonical && Object.keys(row.canonical).length))
  )
    fail('SHARED_SEED_TOMBSTONE_BODY');
  if (sharedSeedLogicalSha256(row) !== row.sha256) fail('SHARED_SEED_ENTITY_HASH_MISMATCH');
  return row;
}
export function validateSharedSeedManifest(raw, { allowUnsignedAttestation = false } = {}) {
  const m = inert(raw);
  const allowed = new Set([
    'format',
    'version',
    'mode',
    'packageId',
    'libraryId',
    'epoch',
    'watermark',
    'snapshotWatermark',
    'cursor',
    'complete',
    'createdAt',
    'entities',
    'assets',
    'members',
    'bytes',
    'entityBytes',
    'entityCount',
    'assetCount',
    'containsCredentials',
    'containsSourceArchives',
    'requiredFeatures',
    'conversationFeeds',
    'attestation',
  ]);
  if (!object(m) || Object.keys(m).some((k) => !allowed.has(k)))
    fail('SHARED_SEED_INVALID_MANIFEST');
  if (
    !object(m) ||
    m.format !== SHARED_SEED_FORMAT ||
    ![1, 2].includes(m.version) ||
    m.mode !== 'shared-bootstrap' ||
    !uuid(m.packageId) ||
    !uuid(m.libraryId) ||
    !uuid(m.epoch) ||
    !integer(m.watermark, 0) ||
    !integer(m.snapshotWatermark, 0, m.watermark) ||
    m.complete !== true ||
    !object(m.cursor) ||
    m.cursor.libraryId !== m.libraryId ||
    m.cursor.epoch !== m.epoch ||
    m.cursor.after !== m.watermark ||
    !Array.isArray(m.entities) ||
    !Array.isArray(m.assets) ||
    !Array.isArray(m.members) ||
    m.members.length > SHARED_SEED_LIMITS.members ||
    m.entities.length > 100000 ||
    m.assets.length > 100000 ||
    m.containsCredentials !== false ||
    m.containsSourceArchives !== false
  )
    fail('SHARED_SEED_INVALID_MANIFEST');
  if (
    (m.version === 1 &&
      (m.requiredFeatures !== undefined ||
        m.conversationFeeds !== undefined ||
        m.attestation !== undefined)) ||
    (m.version === 2 &&
      (!Array.isArray(m.requiredFeatures) ||
        ![1, 2].includes(m.requiredFeatures.length) ||
        m.requiredFeatures[0] !== SHARED_SEED_FEED_FEATURE ||
        (m.requiredFeatures.length === 2 &&
          m.requiredFeatures[1] !== SHARED_SEED_ATTESTATION_FEATURE) ||
        !Array.isArray(m.conversationFeeds) ||
        m.conversationFeeds.length > 1024))
  )
    fail('SHARED_SEED_UNSUPPORTED_FEATURE');
  const signed = m.requiredFeatures?.includes(SHARED_SEED_ATTESTATION_FEATURE);
  if (
    (m.attestation !== undefined && !signed) ||
    (signed && !m.attestation && !allowUnsignedAttestation)
  )
    fail('SHARED_SEED_INVALID_ATTESTATION');
  if (m.attestation !== undefined) {
    const a = m.attestation;
    if (
      !object(a) ||
      Object.keys(a).sort().join(',') !==
        'algorithm,exportId,issuedAt,keyFingerprintSha256,manifestPayloadSha256,publicKeyRawBase64,signatureBase64,version' ||
      a.version !== 1 ||
      a.algorithm !== 'Ed25519' ||
      !uuid(a.exportId) ||
      typeof a.issuedAt !== 'string' ||
      !Number.isFinite(Date.parse(a.issuedAt)) ||
      new Date(a.issuedAt).toISOString() !== a.issuedAt ||
      !hash(a.keyFingerprintSha256) ||
      !hash(a.manifestPayloadSha256) ||
      typeof a.publicKeyRawBase64 !== 'string' ||
      !/^[A-Za-z0-9+/]{43}=$/.test(a.publicKeyRawBase64) ||
      typeof a.signatureBase64 !== 'string' ||
      !/^[A-Za-z0-9+/]{86}==$/.test(a.signatureBase64)
    )
      fail('SHARED_SEED_INVALID_ATTESTATION');
    const { attestation: _attestation, ...payload } = m;
    if (sha256Bytes(sharedSeedEntityBytes(payload)) !== a.manifestPayloadSha256)
      fail('SHARED_SEED_ATTESTATION_PAYLOAD_MISMATCH');
  }
  const members = new Map();
  let total = 0,
    entityBytes = 0;
  for (const member of m.members) {
    if (
      !object(member) ||
      !hash(member.sha256) ||
      !integer(
        member.size,
        1,
        member.path?.startsWith('entities/')
          ? SHARED_SEED_LIMITS.entity
          : SHARED_SEED_LIMITS.original,
      ) ||
      ![`entities/${member.sha256}.json`, `media/${member.sha256}`].includes(member.path) ||
      members.has(member.path)
    )
      fail('SHARED_SEED_INVALID_MEMBER');
    members.set(member.path, member);
    total += member.size;
    if (member.path.startsWith('entities/')) entityBytes += member.size;
  }
  if (
    !integer(total, 0, SHARED_SEED_LIMITS.total) ||
    total !== m.bytes ||
    entityBytes > SHARED_SEED_LIMITS.entityTotal ||
    entityBytes !== m.entityBytes ||
    m.entityCount !== m.entities.length ||
    m.assetCount !== m.assets.length
  )
    fail('SHARED_SEED_LIMIT_EXCEEDED');
  const keys = new Set(),
    assets = new Set(),
    required = new Set();
  for (const e of m.entities) {
    const member = members.get(e.path);
    if (
      !member ||
      !e.path.startsWith('entities/') ||
      !integer(e.revision, 1) ||
      !integer(e.seq, 0, m.watermark) ||
      !hash(e.sha256) ||
      typeof e.entityType !== 'string' ||
      typeof e.entityId !== 'string' ||
      !e.entityId ||
      keys.has(sharedSeedEntityKey(e))
    )
      fail('SHARED_SEED_INVALID_ENTITY_DESCRIPTOR');
    keys.add(sharedSeedEntityKey(e));
    required.add(e.path);
  }
  for (const a of m.assets) {
    const member = members.get(a.path);
    if (
      !member ||
      a.path !== `media/${a.sha256}` ||
      !hash(a.sha256) ||
      !integer(a.size, 1, SHARED_SEED_LIMITS.original) ||
      member.size !== a.size ||
      typeof a.assetId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(a.assetId) ||
      assets.has(a.assetId) ||
      !keys.has(JSON.stringify(['media', a.assetId])) ||
      typeof a.mime !== 'string' ||
      typeof a.name !== 'string'
    )
      fail('SHARED_SEED_INVALID_ASSET');
    assets.add(a.assetId);
    required.add(a.path);
  }
  const feeds = new Set(),
    feedParts = new Set();
  for (const feed of m.conversationFeeds || []) {
    if (
      !object(feed) ||
      !conversation(feed.conversationId) ||
      feeds.has(feed.conversationId) ||
      feed.watermark !== m.watermark ||
      !hash(feed.feedRevision) ||
      !hash(feed.rosterSha256) ||
      !integer(feed.rowCount, 0, 100000) ||
      !integer(feed.redactionCount, 0, 100000) ||
      !Array.isArray(feed.parts) ||
      !feed.parts.length ||
      feed.parts.length > 100000 ||
      Object.keys(feed).some(
        (k) =>
          ![
            'conversationId',
            'watermark',
            'feedRevision',
            'rosterSha256',
            'rowCount',
            'redactionCount',
            'parts',
          ].includes(k),
      )
    )
      fail('SHARED_SEED_INVALID_FEED_DESCRIPTOR');
    feeds.add(feed.conversationId);
    if (!keys.has(JSON.stringify(['conversation', feed.conversationId])))
      fail('SHARED_SEED_FEED_CONVERSATION_MISSING');
    let rows = 0,
      redactions = 0;
    for (const part of feed.parts) {
      if (!object(part)) fail('SHARED_SEED_INVALID_FEED_DESCRIPTOR');
      const member = members.get(part.path);
      if (
        !member ||
        feedParts.has(part.path) ||
        part.path !== `entities/${part.sha256}.json` ||
        !hash(part.sha256) ||
        !integer(part.size, 1, SHARED_SEED_LIMITS.entity) ||
        part.size !== member.size ||
        part.sha256 !== member.sha256 ||
        !integer(part.rowCount, 0, 100000) ||
        !integer(part.redactionCount, 0, 100000) ||
        Object.keys(part).some(
          (k) => !['path', 'size', 'sha256', 'rowCount', 'redactionCount'].includes(k),
        )
      )
        fail('SHARED_SEED_INVALID_FEED_DESCRIPTOR');
      rows += part.rowCount;
      redactions += part.redactionCount;
      feedParts.add(part.path);
      required.add(part.path);
    }
    if (rows !== feed.rowCount || redactions !== feed.redactionCount)
      fail('SHARED_SEED_INVALID_FEED_DESCRIPTOR');
  }
  if (
    m.version === 2 &&
    m.entities.filter((e) => e.entityType === 'conversation' && feeds.has(e.entityId)).length !==
      m.entities.filter((e) => e.entityType === 'conversation').length
  )
    fail('SHARED_SEED_INCOMPLETE_FEEDS');
  if (required.size !== members.size) fail('SHARED_SEED_UNDECLARED_MEMBER');
  if (new TextEncoder().encode(JSON.stringify(m)).length > SHARED_SEED_LIMITS.manifest)
    fail('SHARED_SEED_MANIFEST_TOO_LARGE');
  return m;
}

/** Known actual business references only; ordinary body strings and unknown
 * config fields are never interpreted as executable content or credentials. */
export function validateSharedSeedReferences(entities, assets, feeds = []) {
  const available = new Set(assets.map((a) => a.assetId));
  const check = (ids) => {
    if (ids === undefined || ids === null) return;
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || !available.has(id)))
      fail('SHARED_SEED_MEDIA_REFERENCE_MISSING');
  };
  for (const row of entities) {
    if (row.state !== 'active') continue;
    if (row.entityType === 'entry') {
      check(row.data.attachments);
      for (const message of row.data.chatJournal?.messages || [])
        if (message.state !== 'withdrawn' && !message.withdrawn) check(message.attachments);
      for (const unit of row.canonical?.units || [])
        if (unit.state !== 'withdrawn' && !unit.withdrawn) check(unit.attachments);
    }
    if (row.entityType === 'sticker')
      for (const id of [row.data.assetId, row.data.mediaId])
        if (id !== undefined && id !== null && !available.has(id))
          fail('SHARED_SEED_MEDIA_REFERENCE_MISSING');
    if (row.entityType === 'client-preferences' && row.entityId === 'desktop:thoughts') {
      const id = row.data.values?.['shiye-preview-appearance-v1']?.wallpaperAssetId;
      if (id !== undefined && id !== null && !available.has(id))
        fail('SHARED_SEED_MEDIA_REFERENCE_MISSING');
    }
    if (row.entityType === 'wallpaper') {
      for (const id of [
        row.data.sharedAssetId,
        row.data.independent?.desktop?.assetId,
        row.data.independent?.android?.assetId,
      ])
        if (id !== null && id !== undefined && !available.has(id))
          fail('SHARED_SEED_MEDIA_REFERENCE_MISSING');
    }
  }
  for (const feed of feeds)
    for (const row of feed.messages) {
      if (row.state !== 'active') continue;
      check(row.attachments);
      check(row.source?.media);
      for (const body of [row.body, row.source?.body])
        if (body) {
          const ids = richMediaReferences(body).map((ref) => ref.assetId);
          check(ids);
        }
    }
}

/** All reads are bounded ranges over already private staging. stageOriginal is
 * {begin(asset),write(token,offset,bytes),finish(token,asset),abort(token)};
 * finish returns an opaque durable immutable handle (or an immutable Blob).
 * Nothing is active until the client's single import transaction publishes it.
 */
export async function prepareSharedSeed({ manifest, readMember, stageOriginal, signal } = {}) {
  const m = validateSharedSeedManifest(manifest),
    entities = [],
    originals = [],
    feeds = [],
    tokens = [];
  if (
    typeof readMember !== 'function' ||
    (m.assets.length &&
      (!stageOriginal?.begin ||
        !stageOriginal?.write ||
        !stageOriginal?.finish ||
        !stageOriginal?.abort))
  )
    fail('SHARED_SEED_PORT_REQUIRED');
  const active = () => {
    if (signal?.aborted) fail('SHARED_SEED_CANCELLED');
  };
  async function read(member, sink) {
    const digest = new Sha256();
    for (let offset = 0; offset < member.size; offset += SHARED_SEED_LIMITS.chunk) {
      active();
      const length = Math.min(SHARED_SEED_LIMITS.chunk, member.size - offset);
      const bytes = await readMember(member.path, offset, length);
      if (!(bytes instanceof Uint8Array) || bytes.length !== length) fail('SHARED_SEED_TRUNCATED');
      digest.update(bytes);
      await sink(bytes, offset);
    }
    if (digest.digest() !== member.sha256) fail('SHARED_SEED_MEMBER_HASH_MISMATCH');
  }
  const members = new Map(m.members.map((x) => [x.path, x]));
  try {
    for (const d of m.entities) {
      const member = members.get(d.path),
        bytes = new Uint8Array(member.size);
      await read(member, async (chunk, offset) => {
        bytes.set(chunk, offset);
      });
      let raw;
      try {
        raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      } catch {
        fail('SHARED_SEED_INVALID_ENTITY_JSON');
      }
      const row = validateSharedSeedEntity(raw);
      if (sha256Bytes(sharedSeedEntityBytes(row)) !== member.sha256)
        fail('SHARED_SEED_ENTITY_NOT_CANONICAL');
      if (
        sharedSeedEntityKey(row) !== sharedSeedEntityKey(d) ||
        row.revision !== d.revision ||
        row.seq !== d.seq ||
        row.sha256 !== d.sha256
      )
        fail('SHARED_SEED_ENTITY_DESCRIPTOR_MISMATCH');
      entities.push(row);
    }
    const assetMap = new Map(m.assets.map((x) => [x.assetId, x]));
    for (const descriptor of m.conversationFeeds || []) {
      const feed = {
        conversationId: descriptor.conversationId,
        watermark: descriptor.watermark,
        feedRevision: descriptor.feedRevision,
        rosterSha256: descriptor.rosterSha256,
        messages: [],
        redactions: [],
      };
      const rowIds = new Set(),
        redactionIds = new Set();
      for (const d of descriptor.parts) {
        const member = members.get(d.path),
          bytes = new Uint8Array(member.size);
        await read(member, async (chunk, offset) => bytes.set(chunk, offset));
        let raw;
        try {
          raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        } catch {
          fail('SHARED_SEED_INVALID_FEED_JSON');
        }
        const part = validateSharedSeedFeedPart(raw, descriptor);
        if (
          sha256Bytes(sharedSeedEntityBytes(part)) !== member.sha256 ||
          part.messages.length !== d.rowCount ||
          part.redactions.length !== d.redactionCount
        )
          fail('SHARED_SEED_FEED_PART_MISMATCH');
        for (const row of part.messages) {
          if (rowIds.has(row.id)) fail('SHARED_SEED_DUPLICATE_FEED_ROW');
          rowIds.add(row.id);
          feed.messages.push(row);
        }
        for (const row of part.redactions) {
          if (redactionIds.has(row.id)) fail('SHARED_SEED_DUPLICATE_FEED_REDACTION');
          redactionIds.add(row.id);
          feed.redactions.push(row);
        }
      }
      if (
        feed.messages.length !== descriptor.rowCount ||
        feed.redactions.length !== descriptor.redactionCount ||
        sharedSeedFeedRosterSha256(feed) !== descriptor.rosterSha256
      )
        fail('SHARED_SEED_FEED_ROSTER_MISMATCH');
      const redactions = new Map(feed.redactions.map((row) => [row.id, row.state]));
      for (const row of feed.messages)
        if (redactions.has(row.id) && row.state === 'active')
          fail('SHARED_SEED_FEED_TOMBSTONE_BODY');
      feeds.push(feed);
    }
    validateSharedSeedReferences(entities, m.assets, feeds);
    for (const row of entities.filter((e) => e.entityType === 'media' && e.state === 'active')) {
      const asset = assetMap.get(row.entityId);
      if (
        !asset ||
        (row.data.sha256 && row.data.sha256 !== asset.sha256) ||
        row.data.size !== asset.size ||
        (row.data.id && row.data.id !== asset.assetId)
      )
        fail('SHARED_SEED_MEDIA_BINDING_MISMATCH');
    }
    for (const asset of m.assets) {
      if (
        !entities.some(
          (e) => e.entityType === 'media' && e.entityId === asset.assetId && e.state === 'active',
        )
      )
        fail('SHARED_SEED_MEDIA_BINDING_MISMATCH');
      const token = await stageOriginal.begin(structuredClone(asset));
      tokens.push(token);
      await read(members.get(asset.path), (bytes, offset) =>
        stageOriginal.write(token, offset, bytes),
      );
      const handle = await stageOriginal.finish(token, structuredClone(asset));
      if (
        !(typeof handle === 'string' && handle.length > 0 && handle.length <= 512) &&
        !(typeof Blob !== 'undefined' && handle instanceof Blob && handle.size === asset.size)
      )
        fail('SHARED_SEED_INVALID_ORIGINAL_HANDLE');
      originals.push({ assetId: asset.assetId, sha256: asset.sha256, size: asset.size, handle });
    }
    const result = {
      manifest: m,
      entities,
      originals,
      feeds,
      manifestSha256: sha256Bytes(sharedSeedEntityBytes(m)),
      async discard() {
        if (preparedSeeds.get(result)?.consumed) return { retained: true };
        preparedSeeds.delete(result);
        for (const token of tokens) await stageOriginal.abort(token);
        return { retained: false };
      },
    };
    preparedSeeds.set(result, {
      manifest: structuredClone(m),
      entities: structuredClone(entities),
      originals: structuredClone(originals),
      feeds: structuredClone(feeds),
      manifestSha256: result.manifestSha256,
    });
    return result;
  } catch (error) {
    for (const token of tokens) {
      try {
        await stageOriginal.abort(token);
      } catch {
        /* do not replace original verification error */
      }
    }
    throw error;
  }
}
export function assertPreparedSharedSeed(value) {
  if (!value || !preparedSeeds.has(value)) fail('SHARED_SEED_PREPARE_REQUIRED');
  return structuredClone(preparedSeeds.get(value));
}
/** Called only after the inbox/original-index transaction successfully commits. */
export function consumePreparedSharedSeed(value) {
  if (!preparedSeeds.has(value)) fail('SHARED_SEED_PREPARE_REQUIRED');
  preparedSeeds.get(value).consumed = true;
}
