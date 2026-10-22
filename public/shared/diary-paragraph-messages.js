// Read-only, versioned message projection. The original richdoc/layout remains authoritative.
import { buildLegacyTimeSegments } from './legacy-time-segments.js';
import { validateMessageUnit } from './message-units.js';

export const DIARY_PARAGRAPH_VERSION = 1;
const copy = (value) => structuredClone(value);
const text = (node) =>
  node.type === 'text'
    ? node.text
    : node.type === 'hardBreak'
      ? '\n'
      : (node.content || []).map(text).join('');
const hasMedia = (node) =>
  ['image', 'video'].includes(node.type) || (node.content || []).some(hasMedia);

// Preserve text atoms/marks, including newlines inside a single text atom.
function linesOf(node) {
  const lines = [[]];
  for (const atom of node.content || []) {
    if (atom.type === 'hardBreak') {
      lines.push([]);
      continue;
    }
    if (atom.type === 'text') {
      const parts = atom.text.split('\n');
      parts.forEach((part, i) => {
        if (i) lines.push([]);
        if (part) lines.at(-1).push({ ...copy(atom), text: part });
      });
    } else lines.at(-1).push(copy(atom));
  }
  return lines;
}

/** A screen-wrapped line is never a boundary. Explicit paragraphs, blank lines and
 * a real line break followed by indentation are. Lists/code/quotes/tables remain intact. */
function paragraphNodes(unit) {
  const index = buildLegacyTimeSegments(unit.body, { fallbackAt: unit.eventTime.instant });
  const markers = new Set(
    index.segments
      .filter((s) => ['time-anchor', 'date-context'].includes(s.role))
      .map((s) => s.blockId + ':' + s.range.from),
  );
  const pieces = [];
  for (const node of unit.body.content) {
    if (node.type === 'horizontalRule') continue;
    if (!['paragraph', 'heading'].includes(node.type)) {
      if (text(node).trim() || hasMedia(node)) pieces.push([copy(node)]);
      continue;
    }
    let nodes = [],
      from = 0,
      part = 0;
    const flush = () => {
      if (nodes.some((n) => text(n).trim() || hasMedia(n))) {
        pieces.push([
          {
            ...copy(node),
            attrs: {
              ...copy(node.attrs),
              blockId: node.attrs.blockId + ':paragraph-line:' + part++,
            },
            content: nodes,
          },
        ]);
      }
      nodes = [];
    };
    for (const line of linesOf(node)) {
      const raw = line.map(text).join('');
      const marker = markers.has(node.attrs.blockId + ':' + from);
      if (marker || !raw.trim()) flush();
      else {
        if (/^(?:\u3000|\t|[ \u00a0]{2,})/.test(raw)) flush();
        if (nodes.length)
          nodes.push({
            type: 'hardBreak',
            attrs: { blockId: node.attrs.blockId + ':paragraph-break:' + from },
          });
        nodes.push(...line);
      }
      from += raw.length + 1;
    }
    flush();
  }
  return pieces;
}

/** Return common MessageUnits with stable parent IDs and explicit estimated clocks.
 * This never edits parent units, original timestamps, media insertedAt or layout.
 * Small groups prefer 2s; longer groups use 1s. Tight next-marker bounds clamp
 * offsets (and mark them), rather than crossing a real later timestamp. */
export function projectDiaryParagraphMessages(units) {
  return units.flatMap((unit, index) => {
    if (
      unit.origin?.kind !== 'diary' ||
      !unit.body ||
      unit.state !== 'active' ||
      unit.paragraphProjection ||
      hasMedia(unit.body)
    )
      return [unit];
    if (
      unit.body.content.length === 1 &&
      ['paragraph', 'heading'].includes(unit.body.content[0].type) &&
      !unit.body.content[0].content?.some(
        (node) => node.type === 'hardBreak' || (node.type === 'text' && node.text.includes('\n')),
      )
    )
      return [unit];
    const pieces = paragraphNodes(unit);
    if (pieces.length < 2) return [unit];
    const base = Date.parse(unit.eventTime.instant);
    let bound = Infinity;
    if (Number.isFinite(base)) {
      // UTC date transitions are not the user's calendar boundary. Next known
      // marker is the hard boundary; the engine still uses explicit source zones.
      const next = units
        .slice(index + 1)
        .find(
          (next) =>
            next.eventTime?.source === 'manual-marker' && Date.parse(next.eventTime.instant) > base,
        );
      if (next) bound = Date.parse(next.eventTime.instant) - base - 1;
    }
    const desired = pieces.length <= 8 && (pieces.length - 1) * 2000 <= bound ? 2000 : 1000;
    return pieces.map((content, position) => {
      const offset = Math.min(position * desired, Math.max(0, bound));
      const eventTime = Number.isFinite(base)
        ? {
            ...copy(unit.eventTime),
            instant: new Date(base + offset).toISOString(),
            local: null,
            source: 'paragraph-estimated',
            precision: offset % 1000 ? 'millisecond' : 'second',
            baseInstant: unit.eventTime.instant,
            baseSource: unit.eventTime.source,
            offsetMilliseconds: offset,
          }
        : copy(unit.eventTime);
      const projected = {
        ...copy({ ...unit, body: null, sourceSpans: [] }),
        id: unit.id + ':paragraph-v1:r' + unit.revision + ':' + String(position).padStart(6, '0'),
        body: { format: 'shiye-richdoc', version: 1, content },
        eventTime,
        paragraphProjection: {
          version: 1,
          parentUnitId: unit.id,
          position,
          count: pieces.length,
          parentBlockIds: content.map((node) => node.attrs.blockId.split(':paragraph-line:')[0]),
          preferredStepSeconds: desired / 1000,
          clamped: offset < position * desired,
        },
      };
      validateMessageUnit(projected);
      return projected;
    });
  });
}
