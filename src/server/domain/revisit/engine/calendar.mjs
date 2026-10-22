// Explicit civil-time arithmetic. No environment timezone or wall clock is read here.
const formatters = new Map();
export function calendar(instant, zone) {
  if (!formatters.has(zone))
    formatters.set(
      zone,
      new Intl.DateTimeFormat('en-CA', {
        timeZone: zone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      }),
    );
  const parts = Object.fromEntries(
    formatters
      .get(zone)
      .formatToParts(new Date(instant))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
  return [parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second];
}
const utc = (parts) => Date.UTC(parts[0], parts[1] - 1, ...parts.slice(2));
export function fromCalendar(parts, zone) {
  const target = utc(parts);
  let guess = target;
  for (let attempt = 0; attempt < 4; attempt++) {
    const offset = utc(calendar(guess, zone)) - guess;
    guess = target - offset;
  }
  return calendar(guess, zone).every((part, i) => part === parts[i]) ? guess : null;
}

export function replayInstantInZone(original, now, interval, timeZone) {
  const source = calendar(original, timeZone),
    today = calendar(now, timeZone);
  let difference;
  if (interval.unit === 'year') difference = today[0] - source[0];
  else if (interval.unit === 'month')
    difference = (today[0] - source[0]) * 12 + today[1] - source[1];
  else
    difference = Math.round(
      (Date.UTC(today[0], today[1] - 1, today[2]) - Date.UTC(source[0], source[1] - 1, source[2])) /
        86400000,
    );
  if (difference <= 0 || difference % interval.count) return null;
  const parts = [...source];
  if (interval.unit === 'year') parts[0] = today[0];
  else if (interval.unit === 'month') {
    parts[0] = today[0];
    parts[1] = today[1];
  } else {
    parts[0] = today[0];
    parts[1] = today[1];
    parts[2] = today[2];
  }
  return fromCalendar(parts, timeZone);
}
