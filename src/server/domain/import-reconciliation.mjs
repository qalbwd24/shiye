import { createHash, randomUUID } from 'node:crypto';
import { isHidden } from '../../../public/shared/entry-state.js';

const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
const hash = (value) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
const identity = (entry) =>
  new Set([entry.id, entry.restoredFrom?.id, entry.legacy?.original?.uuid].filter(Boolean));
export function entryFingerprint(entry) {
  const value = structuredClone(entry);
  for (const key of [
    'id',
    'revision',
    'updatedAt',
    'createdAt',
    'restoredFrom',
    'origins',
    'conflictIds',
    'legacy',
    'markdownHtml',
  ])
    delete value[key];
  value.hidden = isHidden(entry);
  for (const key of ['deleted', 'draft', 'pinned', 'demo']) value[key] = !!value[key];
  value.tags = [...new Set(value.tags || [])].sort();
  // Keep unknown legacy fields in the comparison; transport status alone does not change a diary.
  if (entry.legacy?.original) {
    value.original = structuredClone(entry.legacy.original);
    for (const key of [
      'uuid',
      'id',
      'isSynced',
      'updateTime',
      'recordTime',
      'localImages',
      'localAudio',
      'localDraw',
    ])
      delete value.original[key];
  }
  return hash(value);
}
export function addConflict(db, kind, left, right, reason) {
  db.conflicts ||= [];
  const existing = db.conflicts.find(
    (c) => c.kind === kind && c.left === left && c.right === right && c.status === 'open',
  );
  if (existing) return existing;
  const record = {
    id: randomUUID(),
    kind,
    left,
    right,
    reason,
    status: 'open',
    createdAt: new Date().toISOString(),
  };
  db.conflicts.push(record);
  return record;
}
export function remapEntryMedia(entry, map) {
  const result = structuredClone(entry);
  result.attachments = [...new Set((result.attachments || []).map((id) => map.get(id) || id))];
  if (result.legacy?.mediaReferences)
    for (const r of result.legacy.mediaReferences)
      if (r.mediaId) r.mediaId = map.get(r.mediaId) || r.mediaId;
  if (result.history) result.history = result.history.map((h) => remapEntryMedia(h, map));
  return result;
}

export function reconcileArchives(db, imports) {
  const redundant = [];
  for (const item of imports) {
    const duplicate = item.sha256 && db.imports.find((old) => old.sha256 === item.sha256);
    if (duplicate) redundant.push(item.id);
    else db.imports.push(item);
  }
  return redundant;
}

/** Called inside the store's serial transaction, after incoming files have been verified. */
export function reconcileImport(db, incoming) {
  const report = {
    entries: 0,
    media: 0,
    mergedEntries: 0,
    mergedMedia: 0,
    conflicts: 0,
    redundantMedia: [],
  };
  const mediaMap = new Map();
  const mediaKeys = new Map(),
    mediaNames = new Map(),
    entryKeys = new Map(),
    entryNames = new Map();
  const push = (map, key, item) => {
    if (key) map.set(key, [...(map.get(key) || []), item]);
  };
  const mediaKey = (m) => (m.sha256 ? `${m.sha256}:${m.size}:${m.type}:${m.purpose || ''}` : null);
  const indexMedia = (m) => {
    push(mediaKeys, mediaKey(m), m);
    push(mediaNames, m.name, m);
  };
  const indexEntry = (e) => {
    for (const key of identity(e)) push(entryKeys, key, e);
    push(entryNames, e.title?.trim() ? e.title : null, e);
  };
  db.media.forEach(indexMedia);
  db.entries.forEach(indexEntry);
  for (const media of incoming.media || []) {
    const match = mediaKeys.get(mediaKey(media))?.[0];
    if (match) {
      mediaMap.set(media.id, match.id);
      report.mergedMedia++;
      report.redundantMedia.push(media.id);
      continue;
    }
    const named = (mediaNames.get(media.name) || []).filter((m) => m.purpose === media.purpose);
    db.media.push(media);
    indexMedia(media);
    report.media++;
    for (const old of named) {
      addConflict(db, 'media', old.id, media.id, 'same-name');
      report.conflicts++;
    }
  }
  const entryMap = new Map();
  for (const raw of incoming.entries || []) {
    const entry = remapEntryMedia(raw, mediaMap);
    const identified = [
      ...new Set([...identity(entry)].flatMap((key) => entryKeys.get(key) || [])),
    ];
    const candidates = identified.length ? identified : entryNames.get(entry.title) || [];
    const signature = entryFingerprint(entry);
    const match = candidates.find((old) => entryFingerprint(old) === signature);
    if (match) {
      entryMap.set(entry.id, match.id);
      report.mergedEntries++;
      continue;
    }
    db.entries.push(entry);
    indexEntry(entry);
    report.entries++;
    entryMap.set(entry.id, entry.id);
    for (const old of candidates) {
      addConflict(
        db,
        'entry',
        old.id,
        entry.id,
        identified.length ? 'same-identifier' : 'same-title',
      );
      report.conflicts++;
    }
  }
  return { report, mediaMap, entryMap };
}
