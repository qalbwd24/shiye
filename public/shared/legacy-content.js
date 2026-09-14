import { marked } from '../vendor/marked.js';

// Android 1.96.55: o4/h.java p(int). Keep unknown codes distinguishable.
const moods = [
  '',
  '开心',
  '生气',
  '伤心',
  '着急',
  '得意',
  '鄙视',
  '暖心',
  '调皮',
  '惊讶',
  '尴尬',
  '愤怒',
  '疼痛',
  '劳累',
  '紧张',
  '闹心',
  '郁闷',
  '平静',
  '忙碌',
  '烦躁',
];
export const legacyMood = (v) =>
  v === null || v === undefined || Number(v) === 0 ? '' : moods[Number(v)] || `旧心情 ${v}`;
const escape = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export function legacyContent(original) {
  const source = String(original.content || '');
  return Number(original.contentType) === 1
    ? marked.parse(source)
    : source
        .split(/\r?\n/)
        .map((s) => '<p>' + escape(s) + '</p>')
        .join('');
}
export function markdownFor(entry, sanitize, textOf) {
  if (
    typeof entry.markdownSource === 'string' &&
    sanitize(entry.markdownHtml) === sanitize(entry.content)
  )
    return entry.markdownSource;
  const original = entry.legacy?.original;
  if (
    Number(original?.contentType) === 1 &&
    sanitize(legacyContent(original)) === sanitize(entry.content)
  )
    return String(original.content || '');
  return textOf(entry.content);
}
