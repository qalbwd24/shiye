/* Rebuildable display only. Never edit the source text, IDs, clocks or comments. */
export const REVISIT_VIEW_KEY = 'shiye-revisit-date-style-v1';
export const REVISIT_DATE_STYLES = ['system', 'date', 'none'];
/** Lifecycle metadata for the frontend's centered system message, never a diary/comment. */
export function createHistoryNoticePublisher(notify) {
  let current;
  return (state, reason = 'poll') => {
    if (state.locked || !state.config?.enabled) {
      if (current !== undefined) notify(null);
      current = undefined;
      return null;
    }
    const day = state.randomDay;
    const mode = state.config.mode || (day ? 'daily-random' : 'interval');
    const interval = state.config.interval;
    let notice;
    if (mode === 'interval' && interval && ['year', 'month', 'day'].includes(interval.unit)) {
      notice = {
        kind: 'history-interval',
        ruleRevision: state.config.ruleRevision,
        interval: structuredClone(interval),
        timeZone: state.config.timeZone,
      };
    } else if (mode === 'daily-random' && day) {
      notice = {
        kind: 'history-day',
        ruleRevision: day.ruleRevision,
        cycleStart: day.cycleStart,
        sourceDate: day.date,
        displayDate: day.date ? day.date.slice(2) : null,
        timeZone: day.timeZone,
      };
    } else {
      if (current !== undefined) notify(null);
      current = undefined;
      return null;
    }
    const key = JSON.stringify(notice);
    if (reason === 'poll' && key === current) return null;
    const previous = current;
    current = key;
    notice.reason = reason === 'poll' ? (previous ? 'day-change' : 'enable') : reason;
    notify(structuredClone(notice));
    return notice;
  };
}
export function historyDate(instant, zone = 'Asia/Shanghai') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone === 'system' ? undefined : zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instant));
  const part = (name) => parts.find((item) => item.type === name).value;
  return `${part('year').slice(-2)}-${part('month')}-${part('day')}`;
}
export function presentHistoryMessage(delivery, zone = 'Asia/Shanghai') {
  const source = delivery.source;
  let message = String(source.markdown || '');
  // Only remove a standalone leading marker that is the known event time.
  // Dates in prose, quotations, code and later lines remain untouched.
  const first = message.split('\n')[0];
  const plain = first.replace(/\\([\\`*_{}[\]<>#+.!|~-])/g, '$1').trim();
  const stamp =
    /^[\[【(（]?\s*(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?[ T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*[\]】)）]?$/.exec(
      plain,
    );
  if (stamp && !/^[>`]/.test(first.trim())) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone === 'system' ? undefined : zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(delivery.originalAt));
    const actual = ['year', 'month', 'day', 'hour', 'minute', 'second'].map((name) =>
      Number(parts.find((part) => part.type === name).value),
    );
    if (stamp.slice(1).every((value, i) => value === undefined || Number(value) === actual[i]))
      message = message.slice(first.length).replace(/^\n+/, '');
  }
  if (source.media?.length) {
    const media = /^\s*\\?\[(图片|视频)(?:：([\s\S]*?))?\\?\]\s*$/.exec(message);
    if (media) message = (media[2] || '').replace(/\\\]$/, '');
  }
  return { message, dateLabel: historyDate(delivery.originalAt, zone) };
}
