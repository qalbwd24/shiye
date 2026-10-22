export { sanitize, textOf } from '../editor/content.js';
import { formatZoned, zonedDay, zonedInput } from '../shared/time-zone.js';
export const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
export const escape = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export const dateText = (d) => formatZoned(d, { year: 'numeric', month: 'long', day: 'numeric' });
export const timeText = (d) =>
  formatZoned(d, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export const localDate = zonedDay;
export const inputDate = zonedInput;
