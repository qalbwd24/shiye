import { promises as fs } from 'node:fs';
import path from 'node:path';
import { legacyContent, legacyMood } from '../../../public/shared/legacy-content.js';

/** Fill only missing, identifiable old-import metadata; never rewrite diary bodies. */
export function repairLegacyMetadata(db) {
  const count = { hidden: 0, markdown: 0, mood: 0, deletedTemplates: 0 };
  for (const e of db.entries) {
    const original = e.legacy?.original;
    if (!original) continue;
    let changed = false;
    if (e.hidden === undefined && (original.isHidden || e.legacy.isHidden)) {
      e.hidden = true;
      count.hidden++;
      changed = true;
    }
    if (
      Number(original.contentType) === 1 &&
      (e.markdownSource === null || e.markdownSource === undefined) &&
      e.content === legacyContent(original)
    ) {
      e.markdownSource = String(original.content || '');
      e.markdownHtml = e.content;
      count.markdown++;
      changed = true;
    }
    // Revision 1 means the user has not explicitly cleared or replaced the mood.
    if (e.revision === 1 && !e.mood && original.m && !original.mood) {
      e.mood = legacyMood(original.m);
      count.mood++;
      changed = true;
    }
    if (changed) e.revision = (e.revision || 1) + 1;
  }
  for (const t of db.templates || []) {
    if (
      t.deleted === undefined &&
      t.legacy?.isDelete &&
      t.content === legacyContent(t.legacy) &&
      t.name === t.legacy.name
    ) {
      t.deleted = true;
      count.deletedTemplates++;
    }
  }
  return count;
}

export async function preserveLegacyMetadata({ dataDir, getDb, mutate }) {
  const db = getDb();
  if (db.migrations?.legacyMetadataV06) return;
  const counts = repairLegacyMetadata(structuredClone(db));
  if (!Object.values(counts).some(Boolean)) return;
  // Copy before publishing any repair. The snapshot remains private in data/.
  const snapshot = path.join(dataDir, 'before-legacy-metadata-v06-' + Date.now() + '.json');
  await fs.copyFile(path.join(dataDir, 'diary.json'), snapshot, fs.constants.COPYFILE_EXCL);
  await mutate((next) => {
    const result = repairLegacyMetadata(next);
    next.migrations = {
      ...next.migrations,
      legacyMetadataV06: { at: new Date().toISOString(), counts: result },
    };
  });
}
