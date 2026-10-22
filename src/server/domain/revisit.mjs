/** Compatibility facade; delivery and comments are separate services. */
import { replayInstantInZone } from './revisit/engine/calendar.mjs';
import { zoneFor } from './revisit/delivery/state.mjs';
import { planDeliveryTick, commitDeliveryPlan } from './revisit/delivery/planning.mjs';
export { revisitConfig } from './revisit/delivery/state.mjs';
export { configureRevisit } from './revisit/delivery/configuration.mjs';
export { revisitFeed } from './revisit/delivery/query.mjs';
export { addRevisitComment, withdrawRevisitComment } from './revisit/comments/persistence.mjs';
export { commentsForEntry } from './revisit/comments/query.mjs';

export function replayInstant(original, now, config) {
  return replayInstantInZone(original, now, config.interval, zoneFor(config));
}
export function tickRevisit(db, input = {}, now = Date.now()) {
  return commitDeliveryPlan(db, planDeliveryTick(db, input, now));
}
