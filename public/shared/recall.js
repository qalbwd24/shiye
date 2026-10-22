import { ordinal, isHidden } from './entry-state.js';
import { dateParts } from './time-zone.js';
export function recall(entries, { date = new Date(), period = 12, categories = [] } = {}) {
  const target = dateParts(date),
    today = ordinal(date);
  return entries
    .filter((e) => {
      if (
        e.deleted ||
        e.draft ||
        isHidden(e) ||
        (categories.length && !categories.includes(e.category))
      )
        return false;
      const d = dateParts(e.date),
        months = (+target.year - +d.year) * 12 + +target.month - +d.month;
      return ordinal(e.date) < today && d.day === target.day && months > 0 && months % period === 0;
    })
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}
