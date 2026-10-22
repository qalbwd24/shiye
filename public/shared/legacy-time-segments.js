// Rebuildable indexes only; no IO, source mutation, or current-time fallback.
import { validateRichDocument } from './rich-document.js';
import { readManualTime } from './content-preparation.js';
import { normalizeTimeZone, resolveTimeZone } from './time-zone.js';

const unknownTime = () => ({
  instant: null,
  local: null,
  timeZone: null,
  precision: 'unknown',
  source: 'legacy-unknown',
});
const pairs = new Map([
  ['[', ']'],
  ['(', ')'],
  ['【', '】'],
  ['（', '）'],
]);
function unwrap(value) {
  const line = value.trim();
  return pairs.has(line[0]) && line.endsWith(pairs.get(line[0])) ? line.slice(1, -1).trim() : line;
}
function fallbackTime(value, sourceField) {
  if (value === null) return unknownTime();
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d\d-\d\d)T(\d\d:\d\d:\d\d)(\.\d{1,3})?Z$/.exec(value);
  if (!match || !readManualTime(`${match[1]}T${match[2]}Z`, 'UTC').time) return null;
  return {
    instant: new Date(value).toISOString(),
    local: null,
    timeZone: 'UTC',
    precision: match[3] ? 'millisecond' : 'second',
    source: 'edit-fallback',
    sourceField,
  };
}
function inlineText(node, state) {
  if (node.type === 'text') {
    const from = state.text.length;
    state.text += node.text;
    if (node.marks?.some((mark) => mark.type === 'code'))
      state.code.push({ from, to: state.text.length });
  } else if (node.type === 'hardBreak') state.text += '\n';
  else if (node.type === 'image') {
    // An inline resource occupies a position, but its caption cannot be a marker.
    state.text += '\uFFFC';
  } else for (const child of node.content || []) inlineText(child, state);
}

/**
 * Pure richdoc-v1 time index. Return {segments, anchors, issues}; source body is
 * validated and never changed. All ranges are UTF-16 half-open {from,to}, local
 * to the indicated block's inline projection: text verbatim, hardBreak="\n",
 * inline image="\uFFFC". Segment ranges include their trailing line break;
 * anchor/issue ranges cover the original line including indentation but not LF.
 * A non-text leaf (e.g. image/divider) has a zero-length content segment.
 * Containers index their leaf blocks, not duplicate parent text. Code/quotes
 * inherit content time but never introduce markers or date context.
 *
 * segment: {blockId, range, role: content|time-anchor|date-context|
 * unresolved-time, time, anchor: {blockId,range}|null}.
 * anchor: {blockId,range,time}; issue: {code,blockId,range}.
 * time follows readManualTime's {instant,local,timeZone,precision,source,...}.
 * A date + immediately adjacent time-only line has source manual-date-context
 * and dateContext:{blockId,range,localDate}; it is explicitly derived, never a
 * new high-confidence complete marker. Full markers retain manual-marker and
 * assumedZone. Fallback uses edit-fallback + sourceField; unknown uses
 * legacy-unknown. An unresolved standalone marker stops prior inheritance.
 * Date-only lines do not invent midnight instants. Reversed times are retained
 * with time-order-reversed issues; they never imply a new day.
 *
 * These positions are valid only for this source body version. The caller must
 * attach its source revision/fingerprint; never use offsets as permanent
 * comment identities. No date is inferred from fallbackAt or today's date.
 */
export function buildLegacyTimeSegments(
  body,
  { timeZone = 'Asia/Shanghai', fallbackAt = null, fallbackSource = 'entry-updatedAt' } = {},
) {
  validateRichDocument(body);
  const zone = resolveTimeZone(normalizeTimeZone(timeZone));
  const segments = [],
    anchors = [],
    issues = [];
  let currentTime = fallbackTime(fallbackAt, fallbackSource),
    anchor = null,
    dateContext = null,
    previousInstant = null;
  if (!currentTime) {
    currentTime = unknownTime();
    issues.push({ code: 'invalid-fallback-time', blockId: null, range: null });
  }
  const visit = (node, excluded = false) => {
    const blocked = excluded || ['blockquote', 'codeBlock'].includes(node.type);
    if (!['paragraph', 'heading', 'codeBlock'].includes(node.type) && node.content?.length) {
      if (blocked) dateContext = null;
      for (const child of node.content) visit(child, blocked);
      return;
    }
    const blockId = node.attrs.blockId;
    const projection = { text: '', code: [] };
    if (node.type !== 'image') inlineText(node, projection);
    let from = 0;
    const lines = projection.text.split('\n');
    lines.forEach((raw, index) => {
      const range = { from, to: from + raw.length };
      const end = range.to + (index < lines.length - 1 ? 1 : 0);
      // split's trailing empty line is already represented by the preceding LF.
      if (index === lines.length - 1 && !raw && index > 0) return;
      let role = 'content';
      const line = unwrap(raw);
      const code = projection.code.some((span) => span.from < range.to && span.to > from);
      const eligible = !blocked && !code && ['paragraph', 'heading'].includes(node.type);
      const context = dateContext;
      dateContext = null;
      if (eligible) {
        const date = /^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?$/.exec(line);
        const clock = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(line);
        // Deliberately narrow: prose mentioning dates is ordinary content.
        const candidate =
          /^\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?[T\s]+\d/.test(line) &&
          !/[^\dT\s年月日Z:/+.\-]/.test(line);
        const incomplete =
          /^[\[（(【]/.test(raw.trim()) &&
          /^[\[（(【](?:\d{4}[-/年]|\d{1,2}:)[\d\s年月日T:/.+\-Z\]）)】]*$/.test(raw.trim());
        let parsed = null;
        if (date) {
          const localDate = `${date[1]}-${date[2].padStart(2, '0')}-${date[3].padStart(2, '0')}`;
          if (readManualTime(`${localDate}T12:00Z`, 'UTC').time) {
            role = 'date-context';
            currentTime = unknownTime();
            anchor = null;
            dateContext = { blockId, range, localDate, offset: '' };
          } else parsed = { time: null, issue: 'invalid-time' };
        } else if (clock) {
          if (+clock[1] > 23 || +clock[2] > 59 || +(clock[3] || 0) > 59)
            parsed = { time: null, issue: 'invalid-time' };
          else if (context) {
            parsed = readManualTime(`${context.localDate}T${line}${context.offset}`, zone);
            if (parsed.time) {
              parsed.time.source = 'manual-date-context';
              parsed.time.dateContext = {
                blockId: context.blockId,
                range: context.range,
                localDate: context.localDate,
              };
            }
          } else parsed = { time: null, issue: 'unresolved-time-only' };
        } else if (candidate || incomplete) parsed = readManualTime(raw, zone);
        if (parsed) {
          if (parsed.time) {
            role = 'time-anchor';
            currentTime = parsed.time;
            anchor = { blockId, range };
            anchors.push({ ...anchor, time: structuredClone(currentTime) });
            if (previousInstant && currentTime.instant < previousInstant)
              issues.push({ code: 'time-order-reversed', blockId, range });
            previousInstant = currentTime.instant;
            dateContext = {
              blockId: currentTime.dateContext?.blockId || blockId,
              range: currentTime.dateContext?.range || range,
              localDate: currentTime.local.slice(0, 10),
              offset: currentTime.assumedZone ? '' : currentTime.timeZone,
            };
          } else {
            role = 'unresolved-time';
            currentTime = unknownTime();
            anchor = null;
            issues.push({ code: parsed.issue || 'unclassified-time', blockId, range });
          }
        }
      }
      segments.push({
        blockId,
        range: { from, to: end },
        role,
        time: structuredClone(currentTime),
        anchor: structuredClone(anchor),
      });
      from = end;
    });
  };
  for (const node of body.content) visit(node);
  return { segments, anchors, issues };
}
