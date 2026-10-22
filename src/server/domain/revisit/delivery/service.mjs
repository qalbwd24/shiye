import { revisitConfig } from './state.mjs';
import { configureRevisit } from './configuration.mjs';
import { planDeliveryTick, commitDeliveryPlan } from './planning.mjs';
import { revisitFeed } from './query.mjs';
import { exportRevisitArchive, restoreRevisitArchive } from './archive.mjs';
import { currentRandomDay } from './daily-random.mjs';
import { preflightDeliveryTick } from './window.mjs';

/** The host supplies the shared transaction port and clock, never a UI timer. */
export function createRevisitDeliveryService(port, { clock = () => Date.now() } = {}) {
  return Object.freeze({
    status: () =>
      port.read((db) => ({
        config: revisitConfig(db),
        categories: [...db.categories],
        cursor: db.revisit?.cursor || null,
        ...(revisitConfig(db).mode === 'daily-random'
          ? {
              randomDay: structuredClone(
                currentRandomDay(db.revisit, clock(), revisitConfig(db).ruleRevision),
              ),
            }
          : {}),
      })),
    configure: (input) => port.transaction((db) => configureRevisit(db, input)),
    tick: (input = {}) => {
      let now;
      return port.transaction(
        (db) => commitDeliveryPlan(db, planDeliveryTick(db, input, now ?? clock())),
        {
          preflight: (db) => {
            now = clock();
            return preflightDeliveryTick(db, input, now);
          },
        },
      );
    },
    feed: (input) => port.read((db) => revisitFeed(db, input)),
    archive: () => port.read(exportRevisitArchive),
    restore: (input) => port.transaction((db) => restoreRevisitArchive(db, input)),
  });
}
