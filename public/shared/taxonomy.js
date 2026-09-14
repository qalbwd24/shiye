import { isHidden } from './entry-state.js';
export function taxonomyItems(library, kind) {
  const entries = library.entries || [];
  const names = [
    ...new Set(
      [
        ...(kind === 'category' ? library.categories || [] : library.tags || []),
        ...entries.flatMap((e) => (kind === 'category' ? [e.category] : e.tags || [])),
      ].filter((n) => typeof n === 'string' && n),
    ),
  ];
  const counts = new Map(),
    total = new Map();
  for (const e of entries) {
    for (const n of new Set(kind === 'category' ? [e.category] : e.tags || [])) {
      total.set(n, (total.get(n) || 0) + 1);
      if (!e.deleted && !e.draft && !isHidden(e)) counts.set(n, (counts.get(n) || 0) + 1);
    }
  }
  return names.map((name) => ({ name, count: counts.get(name) || 0, total: total.get(name) || 0 }));
}
export function sortedTaxonomy(
  library,
  kind,
  sort = library.settings?.preferences?.[kind + 'Sort'] || 'manual',
) {
  const items = taxonomyItems(library, kind);
  if (sort === 'name')
    items.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
  if (sort === 'count') items.sort((a, b) => b.count - a.count);
  return items;
}
export function validateOrder(items, order) {
  if (
    !Array.isArray(order) ||
    order.length !== items.length ||
    new Set(order).size !== order.length ||
    order.some((n) => typeof n !== 'string' || !items.some((i) => i.name === n))
  )
    throw Error('分类或标签已变化，请刷新后重新排序');
  return [...order];
}
