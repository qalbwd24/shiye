import {
  validateSharedSeedEntity,
  sharedSeedEntityKey,
  SHARED_SEED_LIMITS,
} from './shared-seed.js';
const fail = (code) => {
  throw Object.assign(Error(code), { code });
};
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** Unpublished authenticated delta merge. An old seed is never briefly visible:
 * redactions, latest replacements and cursor commit with its body in one tx.
 */
export async function catchupSharedSeed({
  rows,
  proof,
  request,
  identity,
  hydrate,
  libraryId,
  epoch,
}) {
  let authoritative = new Map(rows.map((row) => [sharedSeedEntityKey(row), row]));
  let mode = proof.snapshotRequired ? 'snapshot' : 'pull',
    position = proof.watermark,
    firstWatermark;
  if (mode === 'snapshot') {
    authoritative.clear();
    position = null;
  }
  let pages = 0,
    resets = 0,
    total = [...authoritative.values()].reduce(
      (n, row) => n + new TextEncoder().encode(JSON.stringify(row)).length,
      0,
    );
  const sizes = new Map(
    [...authoritative].map(([key, row]) => [
      key,
      new TextEncoder().encode(JSON.stringify(row)).length,
    ]),
  );
  while (++pages <= 10000) {
    let page;
    try {
      page = await request(mode, {
        libraryId,
        epoch,
        limit: 100,
        ...(mode === 'pull'
          ? { after: position }
          : position === null
            ? {}
            : { afterKey: position }),
      });
    } catch (error) {
      if (
        (error.code || error.message) !== 'SHARED_RESNAPSHOT_REQUIRED' ||
        mode !== 'pull' ||
        resets++ >= 1
      )
        throw error;
      mode = 'snapshot';
      position = null;
      firstWatermark = undefined;
      authoritative.clear();
      sizes.clear();
      total = 0;
      continue;
    }
    identity(page.info);
    if (
      !Array.isArray(page.entities || page.changes) ||
      typeof page.hasMore !== 'boolean' ||
      page.next === undefined ||
      (page.hasMore && equal(page.next, position))
    )
      fail('SHARED_SEED_INVALID_CATCHUP');
    if (mode === 'snapshot' && firstWatermark === undefined) firstWatermark = page.watermark;
    for (const value of page.entities || page.changes) {
      const { changeSeq: _changeSeq, ...body } = await hydrate(value);
      const row = validateSharedSeedEntity(body),
        key = sharedSeedEntityKey(row),
        old = authoritative.get(key);
      // Envelope key order may differ between canonical offline JSON and wire JSON.
      if (
        old &&
        row.revision === old.revision &&
        (row.sha256 !== old.sha256 || row.seq !== old.seq || row.state !== old.state)
      )
        fail('SHARED_REVISION_CONFLICT');
      if (old?.state === 'withdrawn' && row.state !== 'withdrawn' && row.revision > old.revision)
        fail('SHARED_TOMBSTONE_FINAL');
      if (!old || row.revision > old.revision) {
        const size = new TextEncoder().encode(JSON.stringify(row)).length;
        total += size - (sizes.get(key) || 0);
        sizes.set(key, size);
        authoritative.set(key, row);
        if (authoritative.size > 100000 || total > SHARED_SEED_LIMITS.entityTotal)
          fail('SHARED_SEED_LIMIT_EXCEEDED');
      }
    }
    position = page.next;
    if (page.hasMore) continue;
    if (mode === 'snapshot') {
      if (!Number.isSafeInteger(firstWatermark) || firstWatermark < 0)
        fail('SHARED_SEED_INVALID_CATCHUP');
      mode = 'pull';
      position = firstWatermark;
      continue;
    }
    if (!Number.isSafeInteger(position) || position < proof.watermark)
      fail('SHARED_SEED_INVALID_CATCHUP');
    const latest = await request('info', {});
    identity(latest.info || latest);
    if ((latest.info || latest).seq < position) fail('SHARED_SEED_INVALID_CATCHUP');
    if ((latest.info || latest).seq === position) break;
  }
  if (pages > 10000 || [...authoritative.values()].some((row) => row.seq > position))
    fail('SHARED_SEED_CATCHUP_LIMIT');
  return {
    entities: [...authoritative.values()],
    after: position,
    snapshotFallback: !!proof.snapshotRequired || resets > 0,
  };
}
