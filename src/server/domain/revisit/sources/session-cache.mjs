import { createHash } from 'node:crypto';

// Exactly the inputs consumed by library-port.capture. Rule/cursor/comment state
// is not source material; the planner still reads that state separately per instance.
export const sourceSnapshotInputs = (db) => [
  db.entries || [],
  db.media || [],
  db.messageStore || null,
  db.chatJournal?.rooms || [],
  db.chatJournal?.withdrawals || [],
];

function fingerprint(inputs) {
  const hash = createHash('sha256').update('revisit-source-session-v1\0');
  for (const value of inputs) hash.update(JSON.stringify(value)).update('\0');
  return hash.digest('hex');
}

/** Conservative accounting, not an assertion about V8 heap or process RSS.
 * Include input graphs as additional allowance for snapshot maps/hidden units. */
function retainedEstimate(inputs, session, limit) {
  const seen = new Set(),
    pending = [inputs, session.catalog];
  let bytes = (session.catalog?.sources?.length || 0) * 128;
  while (pending.length && bytes <= limit) {
    const value = pending.pop();
    if (typeof value === 'string') {
      bytes += 32 + value.length * 2;
      continue;
    }
    if (!value || typeof value !== 'object') {
      bytes += 8;
      continue;
    }
    if (seen.has(value)) continue;
    seen.add(value);
    bytes += Array.isArray(value) ? 64 + value.length * 8 : 128;
    for (const [key, child] of Object.entries(value)) {
      bytes += 16 + key.length * 2;
      pending.push(child);
    }
  }
  return bytes;
}

/** One immutable content-addressed snapshot. Never cache authorization or mutable
 * per-instance state. Every read fingerprints current inputs, including in-place edits. */
export function createSourceSessionCache({ read, maxBytes = 160 * 1024 * 1024 }) {
  if (typeof read !== 'function' || !Number.isSafeInteger(maxBytes) || maxBytes < 0)
    throw new TypeError('来源缓存参数不正确');
  let cached,
    hits = 0,
    builds = 0;
  return Object.freeze({
    capture(db) {
      if (!maxBytes) {
        builds++;
        return read(db);
      }
      const inputs = sourceSnapshotInputs(db);
      const key = fingerprint(inputs);
      if (cached?.key === key) {
        hits++;
        return cached.session;
      }
      // Release our previous snapshot before allocating a replacement, even if
      // building fails or the replacement is too large to retain.
      cached = undefined;
      builds++;
      const [entries, media, messageStore, rooms, withdrawals] = inputs;
      // Fingerprint and capture must use the same single read of each input.
      const session = read({ entries, media, messageStore, chatJournal: { rooms, withdrawals } });
      const bytes = retainedEstimate(inputs, session, maxBytes);
      if (bytes <= maxBytes) cached = { key, session, bytes };
      return session;
    },
    statistics: () => ({ hits, builds, retainedBytes: cached?.bytes || 0, maxBytes }),
    clear() {
      cached = undefined;
    },
  });
}
