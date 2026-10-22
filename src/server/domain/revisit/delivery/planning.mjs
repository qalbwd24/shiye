import { fail } from '../../../http.mjs';
import { revisitSources } from '../../revisit-sources.mjs';
import { planRevisitWindow, REVISIT_ENGINE_VERSION } from '../engine/index.mjs';
import { digest, freezeTree } from '../sources/identity.mjs';
import { emptyRevisitState, deliveryToken, iso, zoneFor } from './state.mjs';
import { planDailyRandom } from './daily-random.mjs';
import { upgradeParagraphDeliveries } from './paragraph-upgrade.mjs';
import { deliveryTickWindow } from './window.mjs';

const MINUTE = 60000;

/** Pure with respect to the library: prepare owned state, then commit it atomically. */
export function planDeliveryTick(
  db,
  input = {},
  now,
  { readSources = revisitSources, planWindow = planRevisitWindow } = {},
) {
  const { manual = false } = input;
  const { config, result, initialize, start, finish, end } = deliveryTickWindow(db, input, now);
  const state = structuredClone(db.revisit || emptyRevisitState(config));
  const expectedToken = deliveryToken(db);
  const prepared = (result) => freezeTree({ version: 1, expectedToken, nextState: state, result });
  if (result) return prepared(result);
  if (initialize) {
    state.cursor = iso(now);
    const catalog = readSources(db);
    const reprojected = upgradeParagraphDeliveries(db, state, catalog, now);
    if (config.mode === 'daily-random')
      planDailyRandom({
        sources: catalog.sources,
        config,
        state,
        after: now,
        through: now,
        now,
        timeZone: zoneFor(config),
      });
    return prepared({ created: 0, reprojected, initialized: true, cursor: state.cursor });
  }
  const catalog = readSources(db);
  const reprojected = upgradeParagraphDeliveries(db, state, catalog, now);
  const zone = zoneFor(config);
  const plan =
    config.mode === 'daily-random'
      ? planDailyRandom({
          sources: catalog.sources,
          config,
          state,
          after: start,
          through: finish,
          now,
          timeZone: zone,
        })
      : planWindow({
          version: REVISIT_ENGINE_VERSION,
          sources: catalog.sources.map((source) => ({
            ref: source.ref,
            eventTime: source.unit.eventTime,
            category: typeof source.entry.category === 'string' ? source.entry.category : '',
          })),
          rule: { interval: config.interval, categories: config.categories },
          window: { after: start, through: finish },
          timeZone: zone,
        });
  const known = new Set(state.deliveries.map((item) => item.id));
  let created = 0;
  for (const { minute, occurrences } of plan.groups) {
    const deliveries = [];
    for (const occurrence of occurrences) {
      const id =
        'revisit:' +
        digest([
          ...(db.revisitInstanceId ? [db.revisitInstanceId] : []),
          config.ruleRevision,
          occurrence.ref,
          Date.parse(occurrence.replayAt),
        ]);
      if (known.has(id)) continue;
      known.add(id);
      deliveries.push({
        id,
        ref: occurrence.ref,
        replayAt: occurrence.replayAt,
        originalAt: occurrence.originalAt,
        sender: structuredClone(config.sender),
      });
    }
    if (!deliveries.length) continue;
    deliveries.sort(
      (a, b) =>
        a.replayAt.localeCompare(b.replayAt) ||
        a.originalAt.localeCompare(b.originalAt) ||
        (a.ref.unitId.includes(':paragraph-v1:') &&
        a.ref.unitId.split(':paragraph-v1:')[0] === b.ref.unitId.split(':paragraph-v1:')[0]
          ? a.ref.unitId.localeCompare(b.ref.unitId)
          : 0) ||
        a.id.localeCompare(b.id),
    );
    const batch = {
      id:
        'batch:' +
        digest([
          ...(db.revisitInstanceId ? [db.revisitInstanceId] : []),
          config.ruleRevision,
          minute,
          deliveries.map((item) => item.id),
        ]),
      ruleRevision: config.ruleRevision,
      replayAt: iso(minute * MINUTE),
      createdAt: iso(now),
      timeZone: zone,
      targets: deliveries.map((item) => item.ref),
    };
    state.batches.push(batch);
    for (const item of deliveries)
      state.deliveries.push({ ...item, batchId: batch.id, sequence: state.deliveries.length + 1 });
    created += deliveries.length;
  }
  if (!manual) state.cursor = iso(finish);
  return prepared({
    created,
    reprojected,
    cursor: state.cursor,
    remaining: !manual && finish < Math.floor(end / MINUTE) * MINUTE - 1,
    issues: catalog.issues,
  });
}

/** Call inside the shared library's synchronous mutate callback. */
export function commitDeliveryPlan(db, plan) {
  if (plan?.version !== 1 || plan.expectedToken !== deliveryToken(db))
    throw fail(409, '推送计划对应的数据已变化，请重试');
  const next = structuredClone(plan.nextState);
  const result = structuredClone(plan.result);
  db.revisit = next;
  return result;
}
