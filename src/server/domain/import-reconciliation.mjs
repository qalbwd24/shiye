import { createHash, randomUUID } from 'node:crypto';
import { isHidden } from '../../../public/shared/entry-state.js';
import { getEditorDocument } from '../../../public/shared/editor-document.js';
import {
  renderRichDocument,
  validateRenderableRichDocument,
} from '../../../public/shared/rich-document-renderer.js';
import { richMediaReferences } from '../../../public/shared/rich-document.js';
import { fail } from '../http.mjs';
import { oneDiaryCandidates } from '../imports/one-diary-source.mjs';

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
  // Explicit editor metadata and its older inferred equivalent describe one document.
  value.contentFormat = getEditorDocument(entry).format;
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
  if (entry.contentFormat === 'richdoc') {
    try {
      validateRenderableRichDocument(entry.body);
      if (richMediaReferences(entry.body).some((ref) => !entry.attachments?.includes(ref.assetId)))
        throw new Error('media');
    } catch {
      throw fail(400, '备份富文档结构或图片关联/视频关联不完整');
    }
  }
  const result = structuredClone(entry);
  // Callers may supply shared object aliases; each historical body must remap independently.
  if (result.body) result.body = structuredClone(result.body);
  result.attachments = [...new Set((result.attachments || []).map((id) => map.get(id) || id))];
  // Remap the authoritative tree as well as HTML, including history snapshots below.
  const remapBody = (node) => {
    if (['image', 'video'].includes(node?.type) && typeof node.attrs?.assetId === 'string')
      node.attrs.assetId = map.get(node.attrs.assetId) || node.attrs.assetId;
    if (Array.isArray(node?.content)) node.content.forEach(remapBody);
  };
  if (result.body?.format === 'shiye-richdoc' && Array.isArray(result.body.content))
    result.body.content.forEach(remapBody);
  for (const field of ['content', 'markdownHtml', 'markdownSource', 'editorOriginalHtml'])
    if (typeof result[field] === 'string')
      result[field] = result[field].replace(
        /\/media\/([a-zA-Z0-9-]+)(?=[/"'\s<>?#)\]]|$)/g,
        (url, id) => (map.has(id) ? '/media/' + map.get(id) : url),
      );
  // Render after textual remapping: generated URLs must not be remapped a second time.
  if (result.contentFormat === 'richdoc') result.content = renderRichDocument(result.body);
  if (Array.isArray(result.comments))
    for (const comment of result.comments) {
      if (Array.isArray(comment.mediaOccurrences))
        for (const occurrence of comment.mediaOccurrences)
          if (typeof occurrence.assetId === 'string')
            occurrence.assetId = map.get(occurrence.assetId) || occurrence.assetId;
      if (Array.isArray(comment.attachments))
        comment.attachments = [...new Set(comment.attachments.map((id) => map.get(id) || id))];
      if (comment.authorAvatarId)
        comment.authorAvatarId = map.get(comment.authorAvatarId) || comment.authorAvatarId;
    }
  if (result.chatJournal?.messages)
    for (const message of result.chatJournal.messages)
      message.attachments = (message.attachments || []).map((id) => map.get(id) || id);
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
    entryKeys = new Map(),
    entryNames = new Map();
  const push = (map, key, item) => {
    if (key) map.set(key, [...(map.get(key) || []), item]);
  };
  const mediaKey = (m) => (m.sha256 ? `${m.sha256}:${m.size}:${m.type}:${m.purpose || ''}` : null);
  const indexMedia = (m) => {
    push(mediaKeys, mediaKey(m), m);
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
      if (media.id !== match.id && !db.media.some((old) => old.id === media.id))
        report.redundantMedia.push(media.id);
      continue;
    }
    db.media.push(media);
    indexMedia(media);
    report.media++;
  }
  const entryMap = new Map();
  const validateRichMedia = (entry) => {
    if (entry.contentFormat === 'richdoc') {
      for (const ref of richMediaReferences(entry.body)) {
        const resource = db.media.find((item) => item.id === ref.assetId);
        if (
          !resource ||
          !String(resource.type || resource.mimeType || resource.mime || '').startsWith(
            ref.type + '/',
          )
        )
          throw fail(400, '备份富文档引用未登记或类型不符的图片/视频');
      }
    }
    for (const snapshot of entry.history || []) validateRichMedia(snapshot);
  };
  for (const raw of incoming.entries || []) {
    const entry = remapEntryMedia(raw, mediaMap);
    validateRichMedia(entry);
    const explicit = oneDiaryCandidates(db.entries, entry);
    const identified = explicit || [
      ...new Set([...identity(entry)].flatMap((key) => entryKeys.get(key) || [])),
    ];
    const candidates =
      explicit || (identified.length ? identified : entryNames.get(entry.title) || []);
    const signature = entryFingerprint(entry);
    const match = candidates.find((old) => entryFingerprint(old) === signature);
    if (match) {
      // Bind a matching pre-provenance legacy record once. Without this, two
      // explicitly different export lineages could both claim its bare UUID.
      if (explicit && !match.legacy?.source)
        match.legacy = { ...match.legacy, source: structuredClone(entry.legacy.source) };
      entryMap.set(entry.id, match.id);
      report.mergedEntries++;
      continue;
    }
    db.entries.push(entry);
    indexEntry(entry);
    report.entries++;
    entryMap.set(entry.id, entry.id);
    // Titles are display labels; only stable identifiers establish a version conflict.
    for (const old of identified) {
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
  if (incoming.chatJournal?.rooms) {
    db.chatJournal ||= { version: 1, rooms: [] };
    for (const room of incoming.chatJournal.rooms)
      if (!db.chatJournal.rooms.some((r) => r.sourceId === room.sourceId && r.id === room.id))
        db.chatJournal.rooms.push(structuredClone(room));
  }
  return { report, mediaMap, entryMap };
}
