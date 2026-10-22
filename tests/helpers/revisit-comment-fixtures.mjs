import { sourceLibrary } from './revisit-source-fixtures.mjs';
import { configureRevisit, tickRevisit } from '../../src/server/domain/revisit.mjs';
import { openRevisitSources } from '../../src/server/domain/revisit-sources.mjs';
import { richMediaReferences } from '../../public/shared/rich-document.js';

export const commentNow = Date.parse('2026-10-17T03:01:00Z');
export function commentLibrary(variant = 0) {
  const db = sourceLibrary(variant);
  configureRevisit(db, { expectedRevision: 1, enabled: true });
  tickRevisit(
    db,
    { manual: true, from: '2026-10-17T00:00:00Z', to: '2026-10-17T03:00:00Z' },
    commentNow,
  );
  const group = db.revisit.batches.find(
    (batch) => new Set(batch.targets.map((target) => target.entryId)).size > 1,
  );
  const quote = db.revisit.deliveries.find((delivery) => delivery.batchId === group.id);
  const session = openRevisitSources(db);
  const media = db.revisit.deliveries.find(
    (delivery) =>
      delivery.ref.entryId === 'canonical' &&
      richMediaReferences(session.resolve(delivery.ref).unit.body).length,
  );
  const occurrence = richMediaReferences(session.resolve(media.ref).unit.body)[0];
  return { db, group, quote, media, occurrence };
}
