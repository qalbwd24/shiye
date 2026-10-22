export const DEFAULT_TIME_ZONE = 'Asia/Shanghai';
let selectedTimeZone = 'system';
const formatters = new Map();
let systemZone;
let systemZoneReadAt = 0;

export function normalizeTimeZone(value) {
  if (value === 'system') return value;
  if (typeof value !== 'string' || value.length > 80) throw Error('请选择有效时区');
  try {
    return new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    throw Error('请选择有效时区');
  }
}
export function setTimeZone(value = DEFAULT_TIME_ZONE) {
  selectedTimeZone = normalizeTimeZone(value);
}
export function getTimeZone() {
  return selectedTimeZone;
}
export function resolveTimeZone(value = selectedTimeZone) {
  if (value !== 'system') return value;
  if (!systemZone || Date.now() - systemZoneReadAt > 1000) {
    systemZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    systemZoneReadAt = Date.now();
  }
  return systemZone;
}
export function formatZoned(value, options = {}, timeZone = selectedTimeZone) {
  if (!Number.isFinite(new Date(value).getTime())) return '日期无效';
  return new Intl.DateTimeFormat('zh-CN', {
    ...options,
    timeZone: resolveTimeZone(timeZone),
  }).format(new Date(value));
}
export function dateParts(value = new Date(), timeZone = selectedTimeZone) {
  if (!Number.isFinite(new Date(value).getTime())) {
    return Object.fromEntries(
      ['year', 'month', 'day', 'hour', 'minute', 'second'].map((key) => [key, 'NaN']),
    );
  }
  const zone = resolveTimeZone(timeZone);
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(zone, formatter);
  }
  return Object.fromEntries(
    formatter
      .formatToParts(new Date(value))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
}
export function zonedDay(value, timeZone = selectedTimeZone) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const p = dateParts(value, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}
export function zonedInput(value, timeZone = selectedTimeZone) {
  const p = dateParts(value, timeZone);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
// Convert a wall clock input in the selected zone to one absolute timestamp.
export function parseZonedInput(value, timeZone = selectedTimeZone) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) throw Error('日期时间格式不正确');
  const [year, month, day, hour, minute, second] = match.slice(1).map((part) => Number(part || 0));
  const target = Date.UTC(year, month - 1, day, hour, minute, second);
  let instant = target;
  for (let i = 0; i < 4; i++) {
    const p = dateParts(instant, timeZone);
    const actual = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    if (actual === target) {
      if (zonedInput(instant, timeZone) !== value.slice(0, 16)) break;
      return new Date(instant);
    }
    instant += target - actual;
  }
  throw Error('该时区中不存在这个日期时间，请检查日期或夏令时');
}
