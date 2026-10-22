import { createHash } from 'node:crypto';
import path from 'node:path';
import { readDesktopCapture } from './desktop-source-plan.mjs';
import { formatDesktopJournalText } from './desktop-journal-format.mjs';
import { sharedSeedEntityBytes } from '../../../public/shared/shared-seed.js';

const proofs = new WeakMap();
const fail = (code, status = 409) => {
  throw Object.assign(Error(code), { code, status });
};
const uuid = (v) =>
  typeof v === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const hash = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const id = (v) => typeof v === 'string' && /^-?\d{1,20}$/.test(v);
export const sourceMessageFingerprint = (value) =>
  createHash('sha256').update(sharedSeedEntityBytes(value)).digest('hex');
const identity = (value) => JSON.stringify([value.sourceId, value.roomId, value.messageId]);
const unavailable = (entry, message) =>
  !entry ||
  entry.deleted ||
  entry.hidden ||
  entry.draft ||
  entry.withdrawn ||
  entry.state === 'withdrawn' ||
  !message ||
  message.withdrawn ||
  message.state === 'withdrawn';
function original(db, record) {
  const found = [];
  for (const entry of db.entries || []) {
    if (record.ownerEntryId && entry.id !== record.ownerEntryId) continue;
    if (
      entry.chatJournal?.sourceId !== record.sourceId ||
      String(entry.chatJournal.roomId) !== record.roomId
    )
      continue;
    for (const message of entry.chatJournal.messages || [])
      if (String(message.id) === record.messageId) found.push({ entry, message });
  }
  return found.length === 1 ? found[0] : {};
}
function domain(db) {
  const value = db.sourceMessageConflicts;
  if (value === undefined) return { version: 1, records: [], receipts: [] };
  if (
    value?.version !== 1 ||
    !Array.isArray(value.records) ||
    value.records.length > 2 ||
    !Array.isArray(value.receipts) ||
    value.receipts.length > 1
  )
    fail('SOURCE_CONFLICT_SCHEMA');
  const seen = new Set();
  for (const row of value.records) {
    if (
      !row ||
      !hash(row.id) ||
      !uuid(row.sourceId) ||
      !id(row.roomId) ||
      !id(row.messageId) ||
      !['pending', 'redacted'].includes(row.state) ||
      !Number.isSafeInteger(row.revision) ||
      row.revision < 1 ||
      seen.has(identity(row))
    )
      fail('SOURCE_CONFLICT_SCHEMA');
    if (
      row.state === 'redacted' &&
      (row.versions !== undefined ||
        Object.keys(row).some(
          (k) =>
            ![
              'id',
              'sourceId',
              'roomId',
              'messageId',
              'ownerEntryId',
              'state',
              'revision',
              'ownerSha256',
              'sourceSha256',
              'proof',
            ].includes(k),
        ))
    )
      fail('SOURCE_CONFLICT_SCHEMA');
    seen.add(identity(row));
  }
  for (const receipt of value.receipts)
    if (!uuid(receipt?.operationId) || !hash(receipt.digest)) fail('SOURCE_CONFLICT_SCHEMA');
  return value;
}

/** Only private, verified capture members can authorize source extraction. */
export async function loadSourceMessageProof({ exportsDir, relativePath, manifestSha256 }) {
  if (
    !path.isAbsolute(exportsDir || '') ||
    typeof relativePath !== 'string' ||
    relativePath.length > 512 ||
    !relativePath.split('/').every((p) => /^[a-zA-Z0-9_-]+$/.test(p)) ||
    !hash(manifestSha256)
  )
    fail('SOURCE_COLLECTION_CAPTURE_INVALID', 400);
  let capture;
  try {
    capture = await readDesktopCapture(path.join(exportsDir, ...relativePath.split('/')));
  } catch {
    fail('SOURCE_COLLECTION_CAPTURE_INVALID', 422);
  }
  if (capture.manifestSha256 !== manifestSha256) fail('SOURCE_COLLECTION_CAPTURE_CHANGED');
  const proof = Object.freeze({});
  proofs.set(proof, capture);
  return proof;
}
export function getSourceCollectionCapture(proof) {
  const capture = proofs.get(proof);
  if (!capture) fail('SOURCE_COLLECTION_INVALID', 400);
  return capture;
}

export function registerSourceMessageConflicts(db, { operationId, records }, proof) {
  const capture = proofs.get(proof);
  if (
    !capture ||
    !uuid(operationId) ||
    !Array.isArray(records) ||
    records.length < 1 ||
    records.length > 2
  )
    fail('SOURCE_COLLECTION_INVALID', 400);
  for (const row of records)
    if (
      !row ||
      Object.keys(row).sort().join(',') !== 'expectedOwnerSha256,messageId,roomId' ||
      !id(row.roomId) ||
      !id(row.messageId) ||
      !hash(row.expectedOwnerSha256)
    )
      fail('SOURCE_COLLECTION_INVALID', 400);
  if (new Set(records.map((row) => row.roomId + ':' + row.messageId)).size !== records.length)
    fail('SOURCE_COLLECTION_INVALID', 400);
  const value = domain(db);
  const digest = sourceMessageFingerprint({
    operationId,
    records,
    sourceId: capture.sourceId,
    manifestSha256: capture.manifestSha256,
  });
  const old = value.receipts.find((row) => row.operationId === operationId);
  if (old) {
    if (old.digest !== digest) fail('SOURCE_COLLECTION_OPERATION_REUSED');
    return {
      registered: true,
      replayed: true,
      conflictCount: value.records.length,
      redactedCount: value.records.filter((row) => row.state === 'redacted').length,
    };
  }
  if (value.receipts.length || value.records.length) fail('SOURCE_COLLECTION_CAPACITY');
  const rows = records.map((request) => {
    const key = {
      sourceId: capture.sourceId,
      roomId: request.roomId,
      messageId: request.messageId,
    };
    const { entry, message } = original(db, key);
    if (unavailable(entry, message)) fail('SOURCE_COLLECTION_OWNER_UNAVAILABLE');
    if (sourceMessageFingerprint(message) !== request.expectedOwnerSha256)
      fail('SOURCE_COLLECTION_OWNER_CHANGED');
    const candidates =
      capture.library.messages?.[request.roomId]?.filter(
        (row) => String(row.id) === request.messageId,
      ) || [];
    if (candidates.length !== 1) fail('SOURCE_COLLECTION_SOURCE_UNAVAILABLE');
    const source = candidates[0];
    if (
      source.out !== true ||
      source.isPending ||
      source.isFailed ||
      source.isLocal ||
      source.sendingState ||
      source.localForward ||
      source.replacementMediaIntent ||
      source.draft ||
      source.shiyeProgram ||
      source.shiyeComment ||
      capture.library.shiyeWithdrawnMessages?.some(
        (row) =>
          String(row.roomId) === request.roomId && String(row.messageId) === request.messageId,
      ) ||
      capture.library.shiyeWithdrawalOutbox?.some(
        (row) =>
          String(row.roomId) === request.roomId && String(row.messageId) === request.messageId,
      )
    )
      fail('SOURCE_COLLECTION_SOURCE_UNAVAILABLE');
    if (source.media || message.attachments?.length)
      fail('SOURCE_COLLECTION_MEDIA_UNSUPPORTED', 422);
    if (!Number.isFinite(source.date) || !Number.isFinite(new Date(source.date * 1000).valueOf()))
      fail('SOURCE_COLLECTION_SOURCE_INVALID', 422);
    const sourcePayload = {
      id: request.messageId,
      sentAt: new Date(source.date * 1000).toISOString(),
      text: formatDesktopJournalText(source),
      attachments: [],
    };
    for (const [from, to] of [
      ['replyToMsgId', 'replyTo'],
      ['replacesMessageId', 'replacementOf'],
      ['orderRootId', 'replacementRootId'],
    ])
      if (source[from] !== undefined) {
        const v = String(source[from]);
        if (!id(v)) fail('SOURCE_COLLECTION_SOURCE_INVALID', 422);
        sourcePayload[to] = v;
      }
    if (
      Buffer.byteLength(JSON.stringify(sourcePayload)) > 256 * 1024 ||
      Buffer.byteLength(JSON.stringify(message)) > 256 * 1024
    )
      fail('SOURCE_COLLECTION_TOO_LARGE', 413);
    if (sourcePayload.text === message.text && sourcePayload.sentAt === message.sentAt)
      fail('SOURCE_COLLECTION_NOT_CONFLICT');
    const sourceSha256 = sourceMessageFingerprint(sourcePayload);
    return {
      ...key,
      id: sourceMessageFingerprint(key),
      ownerEntryId: entry.id,
      revision: 1,
      state: 'pending',
      ownerSha256: request.expectedOwnerSha256,
      sourceSha256,
      proof: {
        manifestSha256: capture.manifestSha256,
        sourceSha256: capture.sourceSha256,
        libraryMemberSha256: capture.members.get('logical/library.typed.json').sha256,
      },
      versions: { owner: structuredClone(message), source: sourcePayload },
    };
  });
  db.sourceMessageConflicts = { ...value, records: rows, receipts: [{ operationId, digest }] };
  return { registered: true, replayed: false, conflictCount: rows.length, redactedCount: 0 };
}

/** Runs in the same original JSON commit, including legacy-only writes. No feed
 * scan: at most two exact parent/message lookups, and terminal data never revives. */
export function purgeSourceMessageConflicts(db) {
  if (db.sourceMessageConflicts === undefined) return;
  const value = domain(db);
  db.sourceMessageConflicts = {
    ...value,
    records: value.records.map((row) => {
      if (row.state === 'redacted') return row;
      const { entry, message } = original(db, row);
      if (!unavailable(entry, message)) return row;
      const {
        id,
        sourceId,
        roomId,
        messageId,
        ownerEntryId,
        revision,
        ownerSha256,
        sourceSha256,
        proof,
      } = row;
      return {
        id,
        sourceId,
        roomId,
        messageId,
        ownerEntryId,
        revision: revision + 1,
        ownerSha256,
        sourceSha256,
        proof,
        state: 'redacted',
      };
    }),
  };
}

export function sourceMessageConflictEntities(db) {
  return domain(db).records.map((row) => ({
    entityId: row.id,
    state: row.state === 'redacted' ? 'withdrawn' : 'active',
    data: row.state === 'redacted' ? {} : { ...row, readOnlyProjection: true },
  }));
}
