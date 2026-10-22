import { fail } from '../../../http.mjs';
import { LIMITS } from '../../../../../public/shared/limits.js';
import { iso, revisitConfig } from './state.mjs';

const DAY = 86400000,
  MINUTE = 60000;

/** Pure clock/window validation shared by planning and the queued no-op preflight. */
export function deliveryTickWindow(db, { from, to, manual = false } = {}, now) {
  if (typeof manual !== 'boolean') throw fail(400, '补看开关不正确');
  const config = revisitConfig(db);
  const cursor = db.revisit?.cursor ?? null;
  const end = Date.parse(iso(to ?? now));
  if (end > now) throw fail(400, '不能提前推送未来时段');
  if (!manual && !config.enabled) return { config, result: { created: 0, disabled: true, cursor } };
  if (!manual && !cursor) return { config, initialize: true };
  const start = Date.parse(iso(manual ? from : cursor));
  if (!manual && end < start)
    return { config, result: { created: 0, cursor, waitingForClock: true } };
  if (end < start || (manual && end - start > LIMITS.revisitManualDays * DAY))
    throw fail(400, '单次补看范围须为0–31天');
  const finish = manual
    ? end
    : Math.min(
        Math.floor(end / MINUTE) * MINUTE - 1,
        Math.floor((start + DAY + 1) / MINUTE) * MINUTE - 1,
      );
  if (finish < start || (!manual && finish === start))
    return { config, result: { created: 0, cursor, waitingForMinute: true } };
  return { config, start, finish, end };
}

/** Only skip current-version state (or disabled with no state). Never skip an empty result
 * merely because created=0: cursor, random-day and receipt upgrades may still change. */
export function preflightDeliveryTick(db, input, now) {
  if (db.revisit && db.revisit.version !== 1) return undefined;
  const { result } = deliveryTickWindow(db, input, now);
  return result ? { result } : undefined;
}
