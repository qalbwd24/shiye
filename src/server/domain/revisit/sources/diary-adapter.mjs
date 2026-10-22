import { readDiaryCandidate } from '../../message-store.mjs';
import { convertLegacyReadingEntry } from '../../legacy-reading-converter.mjs';
import { richMediaReferences } from '../../../../../public/shared/rich-document.js';
import { digest, freezeTree } from './identity.mjs';

/** The cache owns its values. Callers receive detached candidates, never cache references. */
export function createDiarySourceAdapter({ maxBytes = 96 * 1024 * 1024 } = {}) {
  const cache = new Map();
  let bytes = 0;
  return {
    read(snapshot, entry) {
      // Conversion may inspect legacy flags and sourceRevision, beyond content identity.
      const key = digest([entry, snapshot.mediaFingerprint]);
      const cached = cache.get(key);
      if (cached) return structuredClone(cached.value);
      let adapted = entry;
      if (entry.contentFormat === 'richdoc') {
        const placed = new Set(richMediaReferences(entry.body).map((item) => item.assetId));
        const orphaned = (entry.attachments || []).filter((id) => !placed.has(id));
        if (orphaned.length) {
          const legacy = convertLegacyReadingEntry(
            { ...entry, contentFormat: 'html', content: '', attachments: orphaned },
            { media: snapshot.media },
          );
          adapted = {
            ...entry,
            body: { ...entry.body, content: [...legacy.body.content, ...entry.body.content] },
          };
        }
      }
      const value = readDiaryCandidate({ media: snapshot.media }, adapted);
      const size = JSON.stringify(value).length * 2;
      while (bytes + size > maxBytes && cache.size) {
        const first = cache.keys().next().value;
        bytes -= cache.get(first).size;
        cache.delete(first);
      }
      if (size < maxBytes) {
        cache.set(key, { value: freezeTree(structuredClone(value)), size });
        bytes += size;
      }
      return value;
    },
  };
}
