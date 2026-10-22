// Pure message preparation. Layout contains structure and references, never a second body.
import { validateRichDocument } from './rich-document.js';
import { buildLegacyTimeSegments } from './legacy-time-segments.js';

const clone = (value) => structuredClone(value);
const unknown = () => ({
  instant: null,
  timeZone: null,
  precision: 'unknown',
  source: 'legacy-unknown',
  sourceField: null,
});
const rich = (content = []) => ({ format: 'shiye-richdoc', version: 1, content });
function utc(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value))
    return null;
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) return null;
  const normalized = value.replace(
    /(?:\.(\d{1,3}))?Z$/,
    (_, digits) => `.${(digits || '').padEnd(3, '0')}Z`,
  );
  return date.toISOString() === normalized ? normalized : null;
}
function event(value, source, sourceField) {
  const instant = utc(value);
  return instant
    ? {
        instant,
        timeZone: 'UTC',
        precision: value.includes('.') ? 'millisecond' : 'second',
        source,
        sourceField,
      }
    : unknown();
}
function normalizedTime(time) {
  return {
    ...clone(time),
    sourceField: time.sourceField ?? (time.source === 'manual-marker' ? 'body' : null),
  };
}

/** Validate the common contract, without resolving mutable entry metadata. */
export function validateMessageUnit(unit) {
  if (
    !unit ||
    typeof unit.id !== 'string' ||
    !unit.id ||
    !['diary', 'chat', 'comment'].includes(unit.origin?.kind) ||
    typeof unit.origin.entryId !== 'string' ||
    !unit.origin.entryId ||
    !Number.isSafeInteger(unit.revision) ||
    unit.revision < 1 ||
    !['active', 'deleted', 'withdrawn'].includes(unit.state)
  )
    throw Error('消息身份、来源、状态或版本无效。');
  const t = unit.eventTime;
  if (
    !t ||
    !Object.hasOwn(t, 'sourceField') ||
    typeof t.source !== 'string' ||
    !t.source ||
    !['unknown', 'minute', 'second', 'millisecond', 'day'].includes(t.precision) ||
    (t.timeZone !== null && typeof t.timeZone !== 'string') ||
    (t.sourceField !== null && typeof t.sourceField !== 'string') ||
    (t.instant !== null && !utc(t.instant)) ||
    (t.instant === null && t.precision !== 'unknown')
  )
    throw Error('消息事件时间无效。');
  if (
    unit.replyTo !== null &&
    !(typeof unit.replyTo === 'string' && unit.replyTo) &&
    (!unit.replyTo || typeof unit.replyTo !== 'object' || Array.isArray(unit.replyTo))
  )
    throw Error('消息回复引用无效。');
  if (unit.state === 'withdrawn') {
    if (unit.body !== null) throw Error('撤回消息不得保留正文。');
  } else if (unit.state !== 'deleted' || unit.body !== null) validateRichDocument(unit.body);
  return unit;
}

/**
 * Each layout node preserves the original AST shell. Text shells contain refs
 * to split text atoms, so joining restores original text-node boundaries, marks,
 * empty text, hardBreaks and all container attributes exactly. Offsets are only
 * revision-local provenance, never permanent message/comment identities.
 */
export function prepareDiaryUnits(
  entry,
  {
    previousUnits = [],
    media = null,
    timeZone = 'Asia/Shanghai',
    createId = () => crypto.randomUUID(),
  } = {},
) {
  if (!entry || typeof entry.id !== 'string' || !entry.id) throw Error('日记身份无效。');
  const body = entry.body ?? entry.richBody;
  validateRichDocument(body);
  const reserved = new Set(previousUnits.map((u) => u.id));
  const fresh = () => {
    const id = createId();
    if (typeof id !== 'string' || !id || reserved.has(id))
      throw Error('消息 ID 工厂产生缺失或重复身份。');
    reserved.add(id);
    return id;
  };
  const fallbackField = Object.hasOwn(entry, 'contentEditedAt') ? 'contentEditedAt' : 'updatedAt';
  const sourceField = entry.editTimeSourceField ?? entry.editTimeSource ?? fallbackField;
  if (typeof sourceField !== 'string' || !sourceField) throw Error('内容编辑时间依据字段无效。');
  const fallbackAt = entry[fallbackField] ?? null;
  const fallback = event(fallbackAt, 'edit-fallback', sourceField);
  const index = buildLegacyTimeSegments(body, {
    timeZone,
    fallbackAt,
    fallbackSource: sourceField,
  });
  const issues = clone(index.issues);
  if (!fallback.instant) issues.push({ code: 'unknown-content-edit-time', sourceField });
  const segmentMap = new Map();
  for (const s of index.segments) {
    if (!segmentMap.has(s.blockId)) segmentMap.set(s.blockId, []);
    segmentMap.get(s.blockId).push(s);
  }
  const drafts = [];
  let current = null,
    currentTime = fallback,
    anchorKey = null;
  const make = (time, key = null) => {
    const unit = {
      id: fresh(),
      body: rich(),
      eventTime: clone(time),
      origin: { kind: 'diary', entryId: entry.id },
      replyTo: null,
      state: entry.deleted ? 'deleted' : 'active',
      revision: 1,
      sourceSpans: [],
      identityKey: key,
    };
    drafts.push(unit);
    return unit;
  };
  const textUnit = () => (current ||= make(currentTime, anchorKey));
  const available =
    media === null ? null : new Set(media.map((m) => (typeof m === 'string' ? m : m.id)));
  const contexts = new Map(),
    fragments = new Map();
  const addAtom = (unit, atom, leaf, range, occurrenceId = null) => {
    let path, textRange;
    if (!['text', 'hardBreak'].includes(atom.type)) {
      path = [unit.body.content.length];
      let root = clone(atom);
      if (!['image', 'video'].includes(atom.type)) {
        const ancestors = contexts.get(leaf) || [];
        for (let i = ancestors.length - 1; i >= 0; i--)
          root = {
            ...clone(ancestors[i]),
            attrs: {
              ...clone(ancestors[i].attrs),
              blockId: `${ancestors[i].attrs.blockId}:fragment:${path[0]}:${i}`,
            },
            content: [root],
          };
        path.push(...ancestors.map(() => 0));
      }
      unit.body.content.push(root);
      fragments.delete(unit);
    } else {
      let fragment = fragments.get(unit);
      if (!fragment || fragment.sourceBlockId !== leaf.attrs.blockId) {
        const rootIndex = unit.body.content.length;
        const shells = [...(contexts.get(leaf) || []), leaf].map((source, depth) => ({
          ...clone(source),
          attrs: {
            ...clone(source.attrs),
            blockId: `${source.attrs.blockId}:fragment:${rootIndex}:${depth}`,
          },
          content: [],
        }));
        for (let i = 0; i < shells.length - 1; i++) shells[i].content.push(shells[i + 1]);
        unit.body.content.push(shells[0]);
        fragment = {
          sourceBlockId: leaf.attrs.blockId,
          node: shells.at(-1),
          path: [rootIndex, ...shells.slice(1).map(() => 0)],
        };
        fragments.set(unit, fragment);
      }
      const last = fragment.node.content.at(-1);
      if (
        atom.type === 'text' &&
        last?.type === 'text' &&
        JSON.stringify(atom.marks || []) === JSON.stringify(last.marks || [])
      ) {
        textRange = { from: last.text.length, to: last.text.length + atom.text.length };
        last.text += atom.text;
        path = [...fragment.path, fragment.node.content.length - 1];
      } else {
        path = [...fragment.path, fragment.node.content.length];
        fragment.node.content.push(clone(atom));
        if (atom.type === 'text') textRange = { from: 0, to: atom.text.length };
      }
    }
    unit.sourceSpans.push({
      blockId: leaf.attrs.blockId,
      range: clone(range),
      ...(occurrenceId ? { occurrenceId } : {}),
    });
    return { unitId: unit.id, path, ...(textRange ? { textRange } : {}) };
  };
  const mediaAtom = (node, leaf, range) => {
    const unit = make(
      node.attrs.insertedAt === null
        ? fallback
        : event(node.attrs.insertedAt, 'media-inserted', 'insertedAt'),
      `media:${node.attrs.occurrenceId}`,
    );
    if (available && !available.has(node.attrs.assetId))
      issues.push({
        code: 'missing-media',
        assetId: node.attrs.assetId,
        occurrenceId: node.attrs.occurrenceId,
      });
    return addAtom(unit, node, leaf, range, node.attrs.occurrenceId);
  };
  const visit = (node, leaf = null, position = null, ancestors = []) => {
    const shell = clone(node);
    delete shell.content;
    if (node.type === 'text') {
      if (!node.text.length) return { shell };
      const from = position.offset,
        end = from + node.text.length;
      const points = [from, ...position.cuts.filter((n) => n > from && n < end), end];
      const refs = [];
      for (let i = 0; i < points.length - 1; i++) {
        position.advance(points[i]);
        refs.push(
          addAtom(
            textUnit(),
            { ...clone(node), text: node.text.slice(points[i] - from, points[i + 1] - from) },
            leaf,
            { from: points[i], to: points[i + 1] },
          ),
        );
      }
      if (!refs.length) {
        position.advance(from);
        refs.push(addAtom(textUnit(), node, leaf, { from, to: end }));
      }
      position.offset = end;
      delete shell.text;
      return { shell, textRefs: refs };
    }
    if (node.type === 'image' || node.type === 'video') {
      const from = position?.offset || 0;
      if (position) {
        position.advance(from);
        position.offset += node.type === 'image' ? 1 : 0;
      }
      return { ref: mediaAtom(node, leaf || node, { from, to: position?.offset || 0 }) };
    }
    if (node.type === 'hardBreak') {
      position.advance(position.offset);
      const from = position.offset++;
      return { ref: addAtom(textUnit(), node, leaf, { from, to: position.offset }) };
    }
    if (['paragraph', 'heading', 'codeBlock'].includes(node.type)) {
      contexts.set(node, ancestors);
      const segments = segmentMap.get(node.attrs.blockId) || [];
      const entered = new Set();
      const state = {
        offset: 0,
        cuts: segments.map((s) => s.range.from),
        advance(offset) {
          for (const s of segments) {
            if (s.range.from > offset || entered.has(s)) continue;
            entered.add(s);
            if (s.role === 'time-anchor' && s.time.source === 'manual-marker') {
              currentTime = normalizedTime(s.time);
              anchorKey = `anchor:${node.attrs.blockId}:${s.time.local}:${s.time.timeZone}`;
              current = null;
            } else if (s.role === 'unresolved-time' || s.role === 'date-context') {
              currentTime = unknown();
              anchorKey = null;
              current = null;
            }
          }
        },
      };
      const result = {
        shell,
        ...(Object.hasOwn(node, 'content')
          ? { content: (node.content || []).map((child) => visit(child, node, state)) }
          : {}),
      };
      if (!node.content?.length) {
        state.advance(0);
        result.emptyRef = addAtom(textUnit(), node, node, { from: 0, to: 0 });
      }
      return result;
    }
    if (node.content)
      return {
        shell,
        content: node.content.map((child) => visit(child, null, null, [...ancestors, node])),
      };
    return { ref: addAtom(textUnit(), node, node, { from: 0, to: 0 }) };
  };
  const layout = {
    format: 'shiye-message-layout',
    version: 1,
    entryId: entry.id,
    sourceRevision: entry.revision ?? null,
    content: body.content.map((node) => visit(node)),
  };
  const mappings = matchIdentities(drafts, previousUnits, entry.id);
  const renames = new Map(
    mappings.filter((m) => m.kind === 'retained').map((m) => [m.preparedId, m.to[0]]),
  );
  const rewrite = (value) => {
    if (!value || typeof value !== 'object') return;
    if (value.unitId && renames.has(value.unitId)) value.unitId = renames.get(value.unitId);
    Object.values(value).forEach(rewrite);
  };
  rewrite(layout);
  drafts.forEach(validateMessageUnit);
  return {
    units: drafts,
    layout,
    issues,
    mappings: mappings.map(({ preparedId: _preparedId, ...mapping }) => mapping),
  };
}

function matchIdentities(units, previous, entryId) {
  const old = previous.filter(
    (u) =>
      u.origin?.kind === 'diary' &&
      u.origin.entryId === entryId &&
      u.body !== null &&
      u.state !== 'withdrawn',
  );
  const keyCache = new Map();
  const keys = (u) => {
    if (!keyCache.has(u))
      keyCache.set(
        u,
        new Set(
          u.sourceSpans?.map((s) =>
            s.occurrenceId ? `media:${s.occurrenceId}` : `block:${s.blockId}`,
          ) || [],
        ),
      );
    return keyCache.get(u);
  };
  const overlap = (a, b) => [...keys(a)].some((key) => keys(b).has(key));
  const stable = new Map(),
    usedOld = new Set();
  for (const n of units) {
    if (!n.identityKey) continue;
    const nextPeers = units.filter((u) => u.identityKey === n.identityKey);
    let candidates = old.filter((p) => !usedOld.has(p) && p.identityKey === n.identityKey);
    if (nextPeers.length !== 1 || candidates.length !== 1)
      candidates = candidates.filter(
        (p) =>
          JSON.stringify(p.sourceSpans) === JSON.stringify(n.sourceSpans) &&
          JSON.stringify(p.body) === JSON.stringify(n.body),
      );
    if (candidates.length === 1) {
      stable.set(n, candidates[0]);
      usedOld.add(candidates[0]);
    }
  }
  const text = (node) =>
    node.type === 'text'
      ? node.text
      : node.type === 'hardBreak'
        ? '\n'
        : (node.content || []).map(text).join('');
  const unassigned = units.filter((u) => !stable.has(u));
  // A marker inserted inside surviving old content is a real split. A marker
  // appended after that content, or prepended as an independent new unit, is
  // an addition. Ambiguous destructive edits retire the old identity explicitly.
  for (const [n, p] of stable) {
    if (text(n.body).includes(text(p.body).trimEnd())) continue;
    const split = unassigned.some(
      (added) =>
        added.identityKey?.startsWith('anchor:') &&
        added.sourceSpans.some((s) => {
          const ranges = p.sourceSpans
            .filter((before) => !before.occurrenceId && s.blockId === before.blockId)
            .map((before) => before.range);
          return (
            !s.occurrenceId &&
            ranges.length &&
            s.range.from > Math.min(...ranges.map((r) => r.from)) &&
            s.range.from < Math.max(...ranges.map((r) => r.to))
          );
        }),
    );
    if (split) {
      stable.delete(n);
      usedOld.delete(p);
    }
  }
  // Removing an old marker merges its content into a surviving neighbour.
  for (const [n, p] of stable) {
    const merged = old.some((removed) => {
      const payload = text(removed.body)
        .replace(/^[^\n]*\n/, '')
        .trim();
      return (
        removed !== p &&
        !usedOld.has(removed) &&
        overlap(n, removed) &&
        payload &&
        text(n.body).includes(payload)
      );
    });
    if (merged) {
      stable.delete(n);
      usedOld.delete(p);
    }
  }
  const unmatchedUnits = units.filter((u) => !stable.has(u));
  const unmatchedOld = old.filter((p) => !usedOld.has(p));
  const mappings = [],
    seen = new Set();
  const retain = (n, p) => {
    const preparedId = n.id;
    for (const [key, value] of Object.entries(p)) if (!Object.hasOwn(n, key)) n[key] = clone(value);
    n.id = p.id;
    n.origin = { ...clone(p.origin), ...n.origin };
    n.replyTo = clone(p.replyTo ?? null);
    n.revision =
      (p.revision || 1) +
      (JSON.stringify(n.body) === JSON.stringify(p.body) &&
      JSON.stringify(n.eventTime) === JSON.stringify(p.eventTime) &&
      n.state === p.state
        ? 0
        : 1);
    mappings.push({ kind: 'retained', from: [p.id], to: [n.id], preparedId });
  };
  for (const [n, p] of stable) retain(n, p);
  for (const first of unmatchedUnits) {
    if (seen.has(first)) continue;
    const next = new Set([first]),
      before = new Set();
    let changed = true;
    while (changed) {
      changed = false;
      for (const p of unmatchedOld)
        if (!before.has(p) && [...next].some((n) => overlap(n, p))) {
          before.add(p);
          changed = true;
        }
      for (const n of unmatchedUnits)
        if (!next.has(n) && [...before].some((p) => overlap(n, p))) {
          next.add(n);
          changed = true;
        }
    }
    next.forEach((u) => seen.add(u));
    const matches = new Map();
    if (next.size === before.size) {
      const used = new Set();
      for (const n of next) {
        let candidates = [...before].filter(
          (p) => !used.has(p) && n.identityKey && p.identityKey === n.identityKey,
        );
        // Repeated equal markers are not unique identities. For an unchanged
        // source revision, exact provenance may disambiguate; edits which make
        // that ambiguous produce an explicit repartition rather than guess.
        if (candidates.length > 1)
          candidates = candidates.filter(
            (p) =>
              JSON.stringify(p.sourceSpans) === JSON.stringify(n.sourceSpans) &&
              JSON.stringify(p.body) === JSON.stringify(n.body),
          );
        if (candidates.length === 1) {
          matches.set(n, candidates[0]);
          used.add(candidates[0]);
        }
      }
      const remainingNext = [...next].filter((n) => !matches.has(n)),
        remainingOld = [...before].filter((p) => !used.has(p));
      if (remainingNext.length === 1 && remainingOld.length === 1)
        matches.set(remainingNext[0], remainingOld[0]);
    }
    if (matches.size === next.size) {
      for (const [n, p] of matches) retain(n, p);
    } else if (before.size)
      mappings.push({
        kind: next.size > before.size ? 'split' : next.size < before.size ? 'merge' : 'repartition',
        from: [...before].map((p) => p.id),
        to: [...next].map((n) => n.id),
      });
    else mappings.push({ kind: 'created', from: [], to: [...next].map((n) => n.id) });
  }
  const covered = new Set(mappings.flatMap((m) => m.from));
  for (const p of old)
    if (!covered.has(p.id)) mappings.push({ kind: 'removed', from: [p.id], to: [] });
  return mappings;
}

export function reassembleDiaryUnits(units, layout) {
  if (
    layout?.format !== 'shiye-message-layout' ||
    layout.version !== 1 ||
    !Array.isArray(layout.content)
  )
    throw Error('长文顺序清单无效。');
  const byId = new Map();
  for (const unit of units) {
    validateMessageUnit(unit);
    if (byId.has(unit.id)) throw Error('消息身份重复。');
    byId.set(unit.id, unit);
  }
  const atom = (ref) => {
    const unit = byId.get(ref.unitId);
    if (unit?.origin.kind !== 'diary' || unit.origin.entryId !== layout.entryId)
      throw Error('顺序引用来源不匹配。');
    let value = unit.body;
    for (const index of ref.path || []) value = value?.content?.[index];
    if (!value) throw Error('顺序清单引用的消息片段缺失。');
    const result = clone(value);
    if (ref.textRange) result.text = result.text.slice(ref.textRange.from, ref.textRange.to);
    return result;
  };
  const visit = (node) => {
    if (node.ref) return atom(node.ref);
    const result = clone(node.shell);
    if (node.textRefs) {
      result.text = node.textRefs
        .map((ref) => {
          const part = atom(ref);
          if (part.type !== 'text') throw Error('文字片段类型改变。');
          return part.text;
        })
        .join('');
    }
    if (node.content) result.content = node.content.map(visit);
    if (node.emptyRef) atom(node.emptyRef);
    return result;
  };
  return validateRichDocument(rich(layout.content.map(visit)));
}
