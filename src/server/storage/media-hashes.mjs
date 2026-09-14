import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
/** Upgrade missing hashes with bounded stream memory. Does not alter any file bytes. */
export async function ensureMediaHashes({ dataDir, getDb, mutate }) {
  const values = new Map();
  for (const media of getDb().media) {
    if (media.sha256 || !/^[a-f0-9-]+$/.test(media.id)) continue;
    const hash = createHash('sha256');
    try {
      for await (const bytes of createReadStream(path.join(dataDir, 'media', media.id)))
        hash.update(bytes);
      values.set(media.id, hash.digest('hex'));
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  if (values.size)
    await mutate((db) => {
      for (const media of db.media)
        if (!media.sha256 && values.has(media.id)) media.sha256 = values.get(media.id);
    });
}
