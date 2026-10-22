import { createHash } from 'node:crypto';
import { reconcileImport } from '../domain/import-reconciliation.mjs';
import { legacyEntry } from './legacy-webdav.mjs';

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
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

export function wireFingerprints(source) {
  return Object.fromEntries(
    JSON.parse(source.json).map((entry) => {
      const value = { ...entry };
      for (const field of ['updateTime', 'recordTime', 'isSynced', 'device']) delete value[field];
      return [entry.uuid, digest(canonical(value))];
    }),
  );
}

function comparable(entry, media) {
  const projected = legacyEntry(entry, []);
  const byId = new Map(media.map((item) => [item.id, item]));
  return digest({
    title: entry.title || '',
    content: projected.content,
    contentType: projected.contentType,
    date: entry.date,
    category: entry.category || '未分类',
    tags: [...new Set(entry.tags || [])].sort(),
    weather: entry.weather || '',
    mood: entry.mood || '',
    location: entry.location || '',
    deleted: !!entry.deleted,
    hidden: !!entry.hidden,
    pinned: !!entry.pinned,
    attachments: (entry.attachments || []).map((id) => {
      const item = byId.get(id);
      return item?.sha256 ? `${item.sha256}:${item.size}` : id;
    }),
  });
}

/** Compare the Android projection, not desktop-only history/comments or regenerated IDs. */
export function reconcileCloud(db, remote, previous = {}) {
  const hashes = wireFingerprints(remote.source);
  const entries = [];
  let unchanged = 0;
  for (const incoming of remote.imported.entries) {
    const uuid = incoming.legacy?.original?.uuid;
    if (uuid && previous.wireFingerprints?.[uuid] === hashes[uuid]) {
      unchanged++;
      continue;
    }
    const candidates = db.entries.filter(
      (entry) => entry.id === uuid || entry.legacy?.original?.uuid === uuid,
    );
    const match = candidates.find(
      (entry) => comparable(entry, db.media) === comparable(incoming, remote.imported.media),
    );
    if (match) {
      // Preserve unknown Android fields while leaving desktop content, comments and history intact.
      match.legacy = {
        ...match.legacy,
        original: { ...match.legacy?.original, ...incoming.legacy.original },
      };
      unchanged++;
    } else entries.push(incoming);
  }
  const result = reconcileImport(db, {
    entries,
    media: remote.imported.media.map(({ data, ...media }) => media),
  });
  result.report.mergedEntries += unchanged;
  return result;
}
