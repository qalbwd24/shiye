// 015-C preparation seam only. No RPC, persistence, migration or canonical switch.
import * as algorithms from './content-algorithms.js';
import { inspectEntryEnvelope, mergeEntryChanges } from './desktop-entry-adapter.js';

const copy = (value) => structuredClone(value);
const same = (a, b) => {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && same(a[key], b[key]))
  );
};

/** Full Entry/envelope + explicitly dirty fields -> lossless candidate and read-only plan.
 * IDs allocated by the shared algorithm are candidate identities, never upload permission.
 * A future Repository must validate its base and commit the sole authority atomically.
 */
export function prepareEntrySave(
  rawEnvelope,
  dirtyFields = {},
  {
    previousUnits = [],
    previousLayout = null,
    media = null,
    timeZone = 'Asia/Shanghai',
    createId,
  } = {},
) {
  const capability = inspectEntryEnvelope(rawEnvelope, { ...algorithms, sink: 'desktop-entry' });
  const original = capability.entryOriginal;
  const authority =
    original?.messageUnits?.authority === 'messageStore'
      ? 'messageStore'
      : original?.messageUnits
        ? 'unknown'
        : 'entry-body';
  const result = {
    version: 1,
    stage: 'preparation-only',
    canCommit: false,
    currentCanonicalEnabled: algorithms.currentCanonicalEnabled,
    prepared: false,
    authority,
    capability: { ...capability, authority, canPrepare: false },
    rawOriginal: capability.rawOriginal,
    envelope: copy(capability.rawOriginal),
    entry: copy(original),
    baseRevision: original?.revision ?? null,
    dirtyFields: [],
    derivedPlan: null,
  };
  const blocked = (reason) => ({
    ...result,
    capability: { ...result.capability, readOnly: true, reason },
  });
  if (capability.readOnly || !capability.supported) return result;
  if (authority === 'unknown') return blocked('未知正文权威标记，保留完整信封并只读。');
  if (
    rawEnvelope?.entry &&
    ((rawEnvelope.version !== undefined && rawEnvelope.version !== 1) ||
      rawEnvelope.format !== undefined)
  )
    return blocked('未知外层信封格式或版本，原件只读。');
  try {
    const merged = mergeEntryChanges(capability, dirtyFields, algorithms);
    if (!Array.isArray(previousUnits)) throw Error('旧消息单元必须是完整数组。');
    if (previousUnits.length && !previousLayout) throw Error('缺少旧顺序清单，不能核对既有身份。');
    if (previousLayout) {
      if (
        previousLayout.entryId !== original.id ||
        previousLayout.sourceRevision !== original.revision
      )
        throw Error('旧顺序清单的日记身份或基线版本不一致。');
      if (
        previousUnits.some(
          (unit) => unit.origin?.kind !== 'diary' || unit.origin.entryId !== original.id,
        )
      )
        throw Error('旧消息单元包含其他来源，不能替换其身份。');
      const before = algorithms.reassembleDiaryUnits(previousUnits, previousLayout);
      if (!same(before, original.body)) throw Error('旧消息与原篇不一致，原件保留并只读。');
    }
    const prepared = algorithms.prepareDiaryUnits(merged, {
      previousUnits,
      media,
      timeZone,
      ...(createId ? { createId } : {}),
    });
    prepared.units.forEach(algorithms.validateMessageUnit);
    const reassembled = algorithms.reassembleDiaryUnits(prepared.units, prepared.layout);
    if (!same(reassembled, merged.body)) throw Error('共用分段不能完整重组原文，禁止保存。');
    const paragraphProjection = algorithms.projectDiaryParagraphMessages(prepared.units);
    const envelope =
      rawEnvelope?.entry && typeof rawEnvelope.entry === 'object'
        ? { ...copy(rawEnvelope), entry: merged }
        : merged;
    return {
      ...result,
      prepared: true,
      capability: { ...result.capability, canPrepare: true },
      envelope,
      entry: merged,
      dirtyFields: Object.keys(dirtyFields),
      derivedPlan: {
        authoritative: false,
        persist: false,
        purpose: 'shared-algorithm-preview',
        bodyChanged: !same(original.body, merged.body),
        prepared,
        reassembled,
        paragraphProjection,
      },
    };
  } catch (error) {
    return blocked(String(error.message || error));
  }
}
