/** Local presentation metadata only. No sticker originals or message content enter this record. */
export const ORDER_KEY = 'view:sticker-panel-order:v1';
export const MODES = Object.freeze(['common', 'new', 'manual']);
let writes = Promise.resolve();

export function preferenceMode(value) {
  return MODES.includes(value?.sortMode) ? value.sortMode : 'common';
}
export function preferenceWeight(value) {
  const number = Number(value?.newWeight);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : 35;
}
function time(value) {
  const n = typeof value === 'number' ? value : Date.parse(value || '');
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function added(asset, preference) {
  return time(preference?.addedAt?.[asset.id]) || time(asset.createdAt) || 0;
}
function count(asset, preference) {
  const value = Number(preference?.usage?.[asset.id]?.count);
  return Number.isFinite(value) && value > 0 ? Math.min(value, 1000000) : 0;
}
function freshness(asset, preference, now) {
  const at = added(asset, preference);
  return at ? Math.max(0, 1 - Math.max(0, now - at) / (30 * 86400000)) : 0;
}
/**
 * Common score = 100*log(1+uses)/log(1+maxUses) + weight*newness.
 * Newness decays linearly over 30 days. Unknown old import dates get zero.
 * Equal scores use saved manual order, then stable asset ID; no enumeration jitter.
 */
export function rankStickers(assets, preference = {}, now = Date.now()) {
  const mode = preferenceMode(preference),
    weight = preferenceWeight(preference);
  const order = Array.isArray(preference.order) ? preference.order : [];
  const rank = new Map(order.filter((id) => typeof id === 'string').map((id, i) => [id, i]));
  const valid = assets.filter((asset) => !asset.removed && String(asset.id).startsWith('sticker:'));
  const maxUses = Math.max(1, ...valid.map((asset) => count(asset, preference)));
  const fallback = (a, b) =>
    (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER) ||
    a.id.localeCompare(b.id, 'en');
  return [...valid].sort((a, b) => {
    if (mode === 'new') return added(b, preference) - added(a, preference) || fallback(a, b);
    if (mode === 'common') {
      const score = (asset) =>
        (100 * Math.log1p(count(asset, preference))) / Math.log1p(maxUses) +
        weight * freshness(asset, preference, now);
      return score(b) - score(a) || fallback(a, b);
    }
    return fallback(a, b);
  });
}

/** Re-rank only an already keyword-matched, bounded recall set. Relevance retains
 * 100 points; panel preference can add at most 20, so unrelated IDs never enter.
 */
export function rankStickerSuggestions(candidates, assets, preference = {}, now = Date.now()) {
  const mode = preferenceMode(preference);
  const weight = preferenceWeight(preference) / 100;
  const byId = assets instanceof Map ? assets : new Map(assets.map((asset) => [asset.id, asset]));
  const order = Array.isArray(preference.order) ? preference.order : [];
  const manual = new Map(order.filter((id) => typeof id === 'string').map((id, i) => [id, i]));
  const maxRelevance = Math.max(1, ...candidates.map((item) => Number(item.score) || 0));
  const maxUses = Math.max(1, ...candidates.map((item) => count({ id: item.id }, preference)));
  const fallback = (a, b) =>
    (manual.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (manual.get(b.id) ?? Number.MAX_SAFE_INTEGER) ||
    a.id.localeCompare(b.id, 'en');
  const bonus = (item) => {
    const asset = byId.get(item.id) || item;
    const use = Math.log1p(count(item, preference)) / Math.log1p(maxUses);
    const fresh = freshness(asset, preference, now);
    if (mode === 'new') return 20 * fresh;
    if (mode === 'manual') {
      const position = manual.get(item.id);
      return position === undefined ? 0 : 20 * (1 - position / Math.max(1, order.length));
    }
    return 20 * ((1 - weight) * use + weight * fresh);
  };
  return [...candidates].sort((a, b) => {
    const aScore = (100 * (Number(a.score) || 0)) / maxRelevance + bonus(a);
    const bScore = (100 * (Number(b.score) || 0)) / maxRelevance + bonus(b);
    return bScore - aScore || (Number(b.score) || 0) - (Number(a.score) || 0) || fallback(a, b);
  });
}

/** Serialize all panel and suggestion metadata writes on this page; preserve unknown fields. */
export function updateStickerPreference(store, change) {
  const job = writes
    .catch(() => {})
    .then(async () => {
      const prior = (await store.get(ORDER_KEY)) || {};
      const next = change(prior);
      if (!next) return prior;
      const merged = { ...prior, ...next, id: ORDER_KEY, version: 2 };
      await store.put(merged);
      return merged;
    });
  writes = job;
  return job;
}

export function recordStickerUse(store, id, at = Date.now()) {
  if (typeof id !== 'string' || !id.startsWith('sticker:')) return Promise.resolve();
  return updateStickerPreference(store, (prior) => {
    const usage = { ...(prior.usage || {}) };
    const old = usage[id] || {};
    usage[id] = { ...old, count: Math.min(1000000, (Number(old.count) || 0) + 1), lastUsedAt: at };
    return { usage };
  });
}
