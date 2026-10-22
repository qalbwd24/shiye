import { fail } from '../../../http.mjs';
import { digest, freezeTree } from '../sources/identity.mjs';

export const DEFAULT_REVISIT_CONFIG = freezeTree({
  version: 1,
  revision: 1,
  ruleRevision: 1,
  enabled: false,
  title: '朝花夕拾',
  interval: { unit: 'year', count: 1 },
  timeZone: 'Asia/Shanghai',
  categories: [],
  sender: { id: 'revisit', name: '过去的我', avatarAssetId: null },
  invalidDate: 'skip',
});
export const revisitConfig = (db) => structuredClone(db.revisit?.config || DEFAULT_REVISIT_CONFIG);
export const emptyRevisitState = (config = structuredClone(DEFAULT_REVISIT_CONFIG)) => ({
  version: 1,
  config,
  cursor: null,
  batches: [],
  deliveries: [],
  comments: [],
});
export const ensureRevisitState = (db) => (db.revisit ||= emptyRevisitState(revisitConfig(db)));

export function iso(value) {
  if (
    typeof value !== 'number' &&
    (typeof value !== 'string' || !/T.*(?:Z|[+-]\d\d:\d\d)$/.test(value))
  )
    throw fail(400, '时间须为带时区的ISO时间');
  const result = new Date(value);
  if (!Number.isFinite(result.getTime())) throw fail(400, '时间格式不正确');
  return result.toISOString();
}
export const zoneFor = (config) =>
  config.timeZone === 'system' ? Intl.DateTimeFormat().resolvedOptions().timeZone : config.timeZone;

// A plan is valid only against the state and source snapshot it actually inspected.
export const deliveryToken = (db) =>
  digest([
    ...(db.revisitInstanceId ? [db.revisitInstanceId] : []),
    db.revisit ?? null,
    db.entries || [],
    db.messageStore ?? null,
    db.chatJournal ?? null,
    db.media || [],
    db.categories || [],
  ]);
