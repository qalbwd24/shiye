import {
  revisitSources,
  resolveRevisitSource,
  presentRevisitSource,
} from '../../revisit-sources.mjs';
import { LIMITS } from '../../../../../public/shared/limits.js';
import { revisitConfig } from './state.mjs';
export function revisitFeed(db, { after = 0, limit = 50 } = {}) {
  const state = db.revisit;
  let catalog;
  const deliveries = (state?.deliveries || [])
    .filter((item) => item.sequence > after)
    .slice(0, limit)
    .map((item) => {
      if (item.paragraphReplacements?.length)
        return { ...item, superseded: true, source: { available: false, media: [] } };
      catalog ||= revisitSources(db);
      const {
        body: _body,
        html: _html,
        ...source
      } = presentRevisitSource(resolveRevisitSource(db, item.ref, catalog));
      if (source.markdown?.length > LIMITS.revisitPreviewCharacters)
        source.markdown =
          source.markdown.slice(0, LIMITS.revisitPreviewCharacters) +
          '\n\n（内容较长，请查看原日记）';
      return { ...item, source };
    });
  return structuredClone({
    config: revisitConfig(db),
    deliveries,
    batches: (state?.batches || []).filter((batch) =>
      deliveries.some((item) => item.batchId === batch.id),
    ),
    next: deliveries.at(-1)?.sequence ?? after,
    total: state?.deliveries.length || 0,
  });
}
