import { dayKey, ordinal, isHidden } from './entry-state.js';
import { dateParts } from './time-zone.js';
export function statistics(
  entries,
  media,
  textOf,
  { year = '', category = '', includeDemo = false, includeHidden = false, now = new Date() } = {},
) {
  const list = entries.filter(
    (e) =>
      !e.deleted &&
      !e.draft &&
      (includeDemo || !e.demo) &&
      (includeHidden || !isHidden(e)) &&
      (!year || +dateParts(e.date).year === Number(year)) &&
      (!category || e.category === category),
  );
  const days = new Map(),
    months = Array(12).fill(0),
    groups = { category: {}, mood: {}, weather: {}, location: {}, tags: {} };
  let chars = 0,
    longest = null,
    longestLength = -1;
  for (const e of list) {
    const length = Array.from(textOf(e.content).replace(/\s/g, '')).length;
    chars += length;
    if (length > longestLength) {
      longest = e;
      longestLength = length;
    }
    const key = dayKey(e.date);
    days.set(key, (days.get(key) || 0) + 1);
    months[+dateParts(e.date).month - 1]++;
    for (const field of ['category', 'mood', 'weather', 'location']) {
      const value = e[field] || '未填写';
      groups[field][value] = (groups[field][value] || 0) + 1;
    }
    for (const t of e.tags || []) groups.tags[t] = (groups.tags[t] || 0) + 1;
  }
  const ord = [...days.keys()].map(ordinal).sort((a, b) => a - b);
  let longestStreak = 0,
    run = 0,
    last = -Infinity;
  for (const d of ord) {
    run = d === last + 1 ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
    last = d;
  }
  const set = new Set(ord),
    today = ordinal(now);
  let end = set.has(today) ? today : today - 1,
    currentStreak = 0;
  while (set.has(end--)) currentStreak++;
  const ids = new Set(list.flatMap((e) => e.attachments || []));
  const attached = media.filter((m) => ids.has(m.id));
  return {
    list,
    count: list.length,
    chars,
    days: Object.fromEntries(days),
    dayCount: days.size,
    months,
    groups,
    longest,
    longestLength: Math.max(0, longestLength),
    currentStreak,
    longestStreak,
    images: attached.filter((m) => m.type.startsWith('image/')).length,
    videos: attached.filter((m) => m.type.startsWith('video/')).length,
    audio: attached.filter((m) => m.type.startsWith('audio/')).length,
    mediaBytes: attached.reduce((n, m) => n + m.size, 0),
  };
}
