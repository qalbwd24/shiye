import { ordinal, isHidden } from './entry-state.js';
export function recall(entries, { date = new Date(), period = 12, categories = [] } = {}) {
  const target = new Date(date),
    today = ordinal(target);
  return entries
    .filter((e) => {
      if (
        e.deleted ||
        e.draft ||
        isHidden(e) ||
        (categories.length && !categories.includes(e.category))
      )
        return false;
      const d = new Date(e.date),
        months = (target.getFullYear() - d.getFullYear()) * 12 + target.getMonth() - d.getMonth();
      return (
        ordinal(d) < today &&
        d.getDate() === target.getDate() &&
        months > 0 &&
        months % period === 0
      );
    })
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}
