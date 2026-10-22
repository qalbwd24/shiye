export const dayKey = (value) => {
  // Date-only values already identify a civil day. Parsing as UTC moves them
  // to the preceding day in time zones west of UTC.
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return zonedDay(value);
};
export const ordinal = (value) => {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    return Date.UTC(year, month - 1, day) / 86400000;
  }
  const [year, month, day] = zonedDay(value).split('-').map(Number);
  return Date.UTC(year, month - 1, day) / 86400000;
};
export const isHidden = (e) => (e.hidden === undefined ? !!e.legacy?.isHidden : !!e.hidden);
import { zonedDay } from './time-zone.js';
