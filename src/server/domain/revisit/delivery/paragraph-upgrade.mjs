import { digest } from '../sources/identity.mjs';

/** Upgrade only derived replay receipts, never source data or old comment targets.
 * Parents remain resolvable; child IDs use the ordinary dedupe/archival contract. */
export function upgradeParagraphDeliveries(db, state, catalog, now) {
  const children = new Map();
  for (const source of catalog.sources) {
    const parent = source.unit.paragraphProjection?.parentUnitId;
    if (!parent) continue;
    const key = digest({ ...source.ref, unitId: parent });
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(source);
  }
  const known = new Set(state.deliveries.map((d) => d.id));
  const byId = new Map(state.deliveries.map((d) => [d.id, d]));
  const batches = new Map(state.batches.map((b) => [b.id, b]));
  const grouped = new Map();
  let created = 0;
  for (const parent of [...state.deliveries]) {
    const parts = children.get(digest(parent.ref));
    if (!parts?.length) continue;
    const batch = batches.get(parent.batchId);
    if (!batch) continue;
    const replacements = [];
    for (const source of parts) {
      const offset =
        Date.parse(source.unit.eventTime.instant) - Date.parse(source.unit.eventTime.baseInstant);
      const due = Date.parse(parent.replayAt) + offset;
      if (!Number.isFinite(due) || due > now) continue;
      const id =
        'revisit:' +
        digest([
          ...(db.revisitInstanceId ? [db.revisitInstanceId] : []),
          batch.ruleRevision,
          source.ref,
          due,
        ]);
      replacements.push(id);
      if (known.has(id)) {
        if (source.unit.paragraphProjection.position === 0)
          byId.get(id).replacesDeliveryId ||= parent.id;
        continue;
      }
      known.add(id);
      const key = batch.ruleRevision + ':' + Math.floor(due / 60000);
      if (!grouped.has(key))
        grouped.set(key, {
          ruleRevision: batch.ruleRevision,
          minute: Math.floor(due / 60000),
          timeZone: batch.timeZone,
          deliveries: [],
        });
      grouped.get(key).deliveries.push({
        id,
        ref: structuredClone(source.ref),
        originalAt: source.unit.eventTime.instant,
        replayAt: new Date(due).toISOString(),
        sender: structuredClone(parent.sender),
        ...(source.unit.paragraphProjection.position === 0
          ? { replacesDeliveryId: parent.id }
          : {}),
      });
    }
    // Optional projection metadata, not deletion/withdrawal of the old receipt.
    if (replacements.length) parent.paragraphReplacements = replacements;
  }
  for (const group of [...grouped.values()].sort((a, b) => a.minute - b.minute)) {
    group.deliveries.sort(
      (a, b) => a.replayAt.localeCompare(b.replayAt) || a.ref.unitId.localeCompare(b.ref.unitId),
    );
    const batch = {
      id:
        'batch:' +
        digest([
          ...(db.revisitInstanceId ? [db.revisitInstanceId] : []),
          group.ruleRevision,
          group.minute,
          group.deliveries.map((d) => d.id),
        ]),
      ruleRevision: group.ruleRevision,
      replayAt: new Date(group.minute * 60000).toISOString(),
      createdAt: new Date(now).toISOString(),
      timeZone: group.timeZone,
      targets: group.deliveries.map((d) => d.ref),
    };
    state.batches.push(batch);
    for (const delivery of group.deliveries) {
      state.deliveries.push({
        ...delivery,
        batchId: batch.id,
        sequence: state.deliveries.length + 1,
      });
      created++;
    }
  }
  return created;
}
