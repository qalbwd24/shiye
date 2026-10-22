import { REVISIT_ENGINE_VERSION, assertEngineRequest } from './contracts.mjs';
import { calendar, fromCalendar, replayInstantInZone } from './calendar.mjs';

export { REVISIT_ENGINE_VERSION } from './contracts.mjs';

/**
 * Return a plan only. No cursor, delivery identity, persistence, sender, UI or content access.
 * @param {{version:1,sources:import('./contracts.mjs').RevisitSource[],rule:import('./contracts.mjs').RevisitRule,window:import('./contracts.mjs').RevisitWindow,timeZone:string}} request
 * @returns {{version:1,timeZone:string,groups:import('./contracts.mjs').RevisitPlanGroup[]}}
 */
export function planRevisitWindow(request) {
  assertEngineRequest(request);
  const { sources, rule, window, timeZone } = request;
  const first = calendar(window.after, timeZone),
    last = calendar(window.through, timeZone);
  const firstDay = Date.UTC(first[0], first[1] - 1, first[2]),
    lastDay = Date.UTC(last[0], last[1] - 1, last[2]);
  const seen = new Set(),
    groups = new Map();
  for (const source of sources) {
    if (rule.categories.length && !rule.categories.includes(source.category)) continue;
    for (let day = firstDay; day <= lastDay; day += 86400000) {
      const date = new Date(day);
      const midday = fromCalendar(
        [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), 12, 0, 0],
        timeZone,
      );
      if (midday === null) continue;
      const due = replayInstantInZone(source.eventTime.instant, midday, rule.interval, timeZone);
      if (due === null || due <= window.after || due > window.through) continue;
      const identity = JSON.stringify([source.ref, due]);
      if (seen.has(identity)) continue;
      seen.add(identity);
      const minute = Math.floor(due / 60000);
      if (!groups.has(minute)) groups.set(minute, []);
      groups.get(minute).push({
        ref: structuredClone(source.ref),
        replayAt: new Date(due).toISOString(),
        originalAt: source.eventTime.instant,
      });
    }
  }
  return {
    version: REVISIT_ENGINE_VERSION,
    timeZone,
    groups: [...groups]
      .sort(([a], [b]) => a - b)
      .map(([minute, occurrences]) => ({ minute, occurrences })),
  };
}
