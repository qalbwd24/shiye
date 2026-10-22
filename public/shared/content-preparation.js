// Pure, isolated preparation contract. Not wired to production entry writes.
import { validateRichDocument, richMediaReferences } from './rich-document.js';
import {
  DEFAULT_TIME_ZONE,
  normalizeTimeZone,
  resolveTimeZone,
  parseZonedInput,
  dateParts,
} from './time-zone.js';

export const CONTENT_PROCESSOR_VERSION = 2;
const brackets = new Map([
  ['[', ']'],
  ['(', ')'],
  ['【', '】'],
  ['（', '）'],
]);
const timestampCandidate = /^[\[（(【]?(?:\d{4}[-/年]\d{1,2}[-/月]\d{1,2}|\d{1,2}:\d{2})/;
const unknownTime = () => ({
  instant: null,
  local: null,
  timeZone: null,
  precision: 'unknown',
  source: 'legacy-unknown',
});

function utc(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value))
    return null;
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) return null;
  const normalized = value.replace(
    /(?:\.(\d{1,3}))?Z$/,
    (_, fraction) => '.' + (fraction || '').padEnd(3, '0') + 'Z',
  );
  return date.toISOString() === normalized ? normalized : null;
}
function systemTime(value, source, sourceField) {
  const instant = utc(value);
  return instant
    ? {
        instant,
        local: null,
        timeZone: 'UTC',
        precision: value.includes('.') ? 'millisecond' : 'second',
        source,
        sourceField,
      }
    : unknownTime();
}
function text(node) {
  if (node.type === 'text') return node.text;
  if (node.type === 'hardBreak') return '\n';
  if (node.type === 'image' || node.type === 'video')
    return node.attrs.caption || node.attrs.alt || '';
  const separator = ['paragraph', 'heading'].includes(node.type) ? '' : '\n';
  return (node.content || []).map(text).join(separator);
}
function allNodes(node) {
  return [node, ...(node.content || []).flatMap(allNodes)];
}

// Only a standalone, complete wall-clock paragraph is a v1 anchor.
export function readManualTime(value, timeZone = DEFAULT_TIME_ZONE) {
  const zone = resolveTimeZone(normalizeTimeZone(timeZone));
  return readManualTimeInZone(value, zone);
}
// A preparation pass already resolved its timezone. Avoid rebuilding Intl for
// every ordinary paragraph in a long diary.
function readManualTimeInZone(value, zone) {
  let line = String(value).trim();
  if (brackets.has(line[0])) {
    if (!line.endsWith(brackets.get(line[0])))
      return { time: null, issue: timestampCandidate.test(line) ? 'unclassified-time' : null };
    line = line.slice(1, -1).trim();
  }
  const match =
    /^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(Z|[+-]\d{2}:\d{2}))?$/.exec(
      line,
    );
  if (!match)
    return { time: null, issue: timestampCandidate.test(line) ? 'unclassified-time' : null };
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  if (
    year < 1000 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    (match[6] && second > 59)
  )
    return { time: null, issue: 'invalid-time' };
  const local = `${match[1]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${match[5]}${match[6] ? ':' + match[6] : ''}`;
  try {
    const offset = match[7];
    // Calendar validation independent of any DST policy.
    parseZonedInput(local, 'UTC');
    let date;
    if (offset) {
      if (
        offset !== 'Z' &&
        (+offset.slice(1, 3) > 14 ||
          +offset.slice(4) > 59 ||
          (+offset.slice(1, 3) === 14 && +offset.slice(4) !== 0))
      )
        return { time: null, issue: 'invalid-time' };
      date = new Date(local + offset);
    } else {
      date = parseZonedInput(local, zone);
      const expected = JSON.stringify(dateParts(date, zone));
      // Repeated civil times must not silently choose one side of a DST fold.
      for (const delta of [-120, -90, -60, -30, 30, 60, 90, 120]) {
        if (JSON.stringify(dateParts(date.valueOf() + delta * 60000, zone)) === expected)
          return { time: null, issue: 'ambiguous-time' };
      }
    }
    return {
      time: {
        instant: date.toISOString(),
        local,
        timeZone: offset || zone,
        precision: match[6] ? 'second' : 'minute',
        source: 'manual-marker',
        assumedZone: !offset,
      },
      issue: null,
    };
  } catch {
    return { time: null, issue: 'invalid-time' };
  }
}

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ':' + canonical(value[key]))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
async function fingerprint(value) {
  const bytes = new TextEncoder().encode(canonical(value));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Prepare a richdoc plus a caller-resolved identity/time context. No IO, mutation,
 * current-time fallback, record IDs, or per-save image insertion times are added.
 * Asset availability is checked against IDs only; byte/hash checks belong to storage.
 */
export async function prepareContent({
  body,
  recordId,
  revision,
  kind = 'diary',
  state = 'active',
  visibility = { hidden: false, draft: false },
  updatedAt = null,
  contentEditedAt,
  editTimeSource = 'entry-updatedAt',
  sentAt = null,
  createdAt = null,
  timeZone = DEFAULT_TIME_ZONE,
  availableAssetIds = null,
}) {
  if (
    typeof recordId !== 'string' ||
    !recordId ||
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    !['diary', 'message', 'comment'].includes(kind) ||
    !['active', 'withdrawn', 'deleted'].includes(state)
  )
    throw Error('内容身份、版本或类型无效。');
  if (!['entry-updatedAt', 'legacy-updateTime'].includes(editTimeSource))
    throw Error('编辑时间来源无效。');
  if (
    !visibility ||
    typeof visibility.hidden !== 'boolean' ||
    typeof visibility.draft !== 'boolean' ||
    Object.keys(visibility).some((key) => !['hidden', 'draft'].includes(key))
  )
    throw Error('内容可见性无效。');
  const zone = resolveTimeZone(normalizeTimeZone(timeZone));
  if (
    availableAssetIds !== null &&
    (!Array.isArray(availableAssetIds) ||
      availableAssetIds.some((id) => typeof id !== 'string' || !id))
  )
    throw Error('媒体 ID 清单无效。');
  // Withdrawn bodies must already have been removed by the authoritative store.
  if (state === 'withdrawn' && (kind !== 'message' || body !== null))
    throw Error('撤回消息不得保留正文或派生原文。');
  if (state !== 'withdrawn') validateRichDocument(body);
  const snapshot = structuredClone({
    body,
    recordId,
    revision,
    kind,
    state,
    visibility,
    updatedAt,
    contentEditedAt: contentEditedAt === undefined ? updatedAt : contentEditedAt,
    editTimeSource,
    sentAt,
    createdAt,
    timeZone: zone,
  });
  const available = availableAssetIds === null ? null : new Set(availableAssetIds);
  const warnings = [];
  const warn = (code, blockId = null) => warnings.push({ code, blockId });
  const baseTime =
    kind === 'message'
      ? systemTime(sentAt, 'message-send', 'sentAt')
      : kind === 'comment'
        ? systemTime(createdAt, 'comment-created', 'createdAt')
        : systemTime(
            snapshot.contentEditedAt,
            'edit-fallback',
            contentEditedAt === undefined ? editTimeSource : 'content-editedAt',
          );
  if (state === 'active' && kind !== 'diary' && !baseTime.instant)
    throw Error('消息/评论必须提供有效的原发送/创建 UTC 时间。');
  const blocks = [],
    media = [];
  let currentTime = baseTime,
    anchorBlockId = null;
  for (const block of snapshot.body?.content || []) {
    const blockId = block.attrs.blockId;
    const contentText = text(block);
    let role = block.type === 'horizontalRule' ? 'divider' : 'content';
    if (kind === 'diary' && block.type === 'paragraph') {
      const hasInlineCode = allNodes(block).some((n) => n.marks?.some((m) => m.type === 'code'));
      if (!hasInlineCode && !contentText.includes('\n')) {
        const parsed = readManualTimeInZone(contentText, zone);
        if (parsed.time) {
          currentTime = parsed.time;
          anchorBlockId = blockId;
          role = 'time-anchor';
        } else if (parsed.issue) {
          // An unresolved new marker stops inheriting the previous marker.
          currentTime = unknownTime();
          anchorBlockId = null;
          warn(parsed.issue, blockId);
        }
      } else if (timestampCandidate.test(contentText.trim()) && !hasInlineCode) {
        currentTime = unknownTime();
        anchorBlockId = null;
        warn('embedded-marker-not-segmented', blockId);
      }
    }
    if (!currentTime.instant && contentText) warn('unknown-content-time', blockId);
    blocks.push({ blockId, role, time: structuredClone(currentTime), anchorBlockId });
    for (const image of richMediaReferences({
      format: 'shiye-richdoc',
      version: 1,
      content: [block],
    })) {
      const insertedAt = image.insertedAt === null ? null : utc(image.insertedAt);
      if (image.insertedAt !== null && !insertedAt)
        throw Error('图片插入时间无效，不能替换为当前保存时间。');
      media.push({
        blockId: image.blockId,
        parentBlockId: blockId,
        assetId: image.assetId,
        occurrenceId: image.occurrenceId,
        type: image.type,
        insertedAt,
        contentTime: structuredClone(currentTime),
        anchorBlockId,
      });
    }
  }
  const assetIds = [...new Set(media.map((image) => image.assetId))];
  const missingAssetIds = available ? assetIds.filter((id) => !available.has(id)) : [];
  if (assetIds.length && !available) warn('asset-availability-unchecked');
  const missing = new Set(missingAssetIds);
  for (const image of media) if (missing.has(image.assetId)) warn('missing-asset', image.blockId);
  return {
    format: 'shiye-prepared-content',
    processorVersion: CONTENT_PROCESSOR_VERSION,
    source: { recordId, revision, kind, state, visibility: snapshot.visibility },
    inputFingerprint: await fingerprint(snapshot),
    body: snapshot.body,
    derived: {
      timeZone: zone,
      plainText: (snapshot.body?.content || []).map(text).join('\n\n'),
      blocks,
      media,
      assetIds,
      missingAssetIds,
      assetsChecked: available !== null,
      searchEligible:
        state === 'active' && !snapshot.visibility.hidden && !snapshot.visibility.draft,
      recallEligible:
        state === 'active' &&
        kind !== 'comment' &&
        !snapshot.visibility.hidden &&
        !snapshot.visibility.draft,
    },
    warnings,
  };
}
