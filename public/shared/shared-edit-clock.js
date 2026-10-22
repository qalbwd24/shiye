// Pure, local-first edit metadata. Transport/storage owners decide when to persist and send it.
const MAX_LOGICAL = 0x7fffffff;
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const text = (value, name) => {
  if (typeof value !== 'string' || !value || value.length > 256)
    throw new TypeError(`invalid ${name}`);
  return value;
};
const millis = (value, name) => {
  if (!Number.isSafeInteger(value) || value < 0 || value > 8640000000000000)
    throw new TypeError(`invalid ${name}`);
  return value;
};
const revision = (value) =>
  value === null || value === undefined ? null : text(String(value), 'revision');
const jsonValue = (value) => {
  let encoded;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new TypeError('edit value must be JSON serializable');
  }
  if (encoded === undefined) throw new TypeError('edit value must be JSON serializable');
  return JSON.parse(encoded);
};

export function compareEditStamps(a, b) {
  for (const stamp of [a, b]) {
    if (!stamp || typeof stamp !== 'object') throw new TypeError('missing edit stamp');
    millis(stamp.physicalMs, 'physicalMs');
    if (!Number.isSafeInteger(stamp.logical) || stamp.logical < 0 || stamp.logical > MAX_LOGICAL)
      throw new TypeError('invalid logical counter');
    text(stamp.deviceId, 'deviceId');
    text(stamp.operationId, 'operationId');
  }
  return (
    Math.sign(a.physicalMs - b.physicalMs) ||
    Math.sign(a.logical - b.logical) ||
    (a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : 0) ||
    (a.operationId < b.operationId ? -1 : a.operationId > b.operationId ? 1 : 0)
  );
}

export function createEditClock({
  deviceId,
  state,
  now = () => Date.now(),
  newId = () => globalThis.crypto.randomUUID(),
}) {
  text(deviceId, 'deviceId');
  if (state && state.deviceId !== deviceId) throw new TypeError('clock belongs to another device');
  let lastPhysicalMs = state ? millis(state.lastPhysicalMs, 'lastPhysicalMs') : 0;
  let lastLogical = state ? state.lastLogical : 0;
  if (!Number.isSafeInteger(lastLogical) || lastLogical < 0 || lastLogical > MAX_LOGICAL)
    throw new TypeError('invalid clock state');
  const current = () => millis(now(), 'now');
  const nextLogical = (value) => {
    if (value >= MAX_LOGICAL) throw new RangeError('edit clock logical counter exhausted');
    return value + 1;
  };
  return {
    snapshot() {
      return { version: 1, deviceId, lastPhysicalMs, lastLogical };
    },
    observe(remote) {
      compareEditStamps(remote, remote);
      const wall = current(),
        merged = Math.max(wall, lastPhysicalMs, remote.physicalMs);
      let logical = 0;
      if (merged === lastPhysicalMs && merged === remote.physicalMs)
        logical = nextLogical(Math.max(lastLogical, remote.logical));
      else if (merged === lastPhysicalMs) logical = nextLogical(lastLogical);
      else if (merged === remote.physicalMs) logical = nextLogical(remote.logical);
      lastPhysicalMs = merged;
      lastLogical = logical;
      return this.snapshot();
    },
    issue({
      entityType,
      entityId,
      fieldPath,
      action = 'edit',
      baseRevision = null,
      parentOpId = null,
      resultRevision = null,
      operationId,
      value,
      sentAt,
      retryOp,
    } = {}) {
      if (retryOp) {
        if (retryOp.stamp?.deviceId !== deviceId || !hasStamp(retryOp))
          throw new TypeError('retry operation clock mismatch');
        if (
          !operationId ||
          retryOp.operationId !== operationId ||
          retryOp.entityType !== entityType ||
          retryOp.entityId !== entityId ||
          retryOp.fieldPath !== fieldPath ||
          retryOp.action !== action ||
          retryOp.baseRevision !== revision(baseRevision) ||
          retryOp.parentOpId !== parentOpId ||
          retryOp.resultRevision !== revision(resultRevision) ||
          (own(retryOp, 'sentAt') ? retryOp.sentAt !== sentAt : sentAt !== undefined) ||
          (action === 'edit' && JSON.stringify(retryOp.value) !== JSON.stringify(jsonValue(value)))
        )
          throw new TypeError('retry intent differs from persisted operation');
        return jsonValue(retryOp);
      }
      if (entityType !== 'message' && entityType !== 'diary')
        throw new TypeError('invalid entityType');
      text(entityId, 'entityId');
      text(fieldPath, 'fieldPath');
      if (action !== 'edit' && action !== 'withdraw') throw new TypeError('invalid action');
      const id = text(operationId || newId(), 'operationId');
      if (parentOpId !== null) text(parentOpId, 'parentOpId');
      const portableValue = action === 'edit' ? jsonValue(value) : undefined;
      if (sentAt !== undefined) text(sentAt, 'sentAt');
      const wall = current();
      if (wall > lastPhysicalMs) {
        lastPhysicalMs = wall;
        lastLogical = 0;
      } else lastLogical = nextLogical(lastLogical);
      const op = {
        version: 1,
        entityType,
        entityId,
        fieldPath,
        action,
        operationId: id,
        baseRevision: revision(baseRevision),
        parentOpId,
        resultRevision: revision(resultRevision),
        editedAt: new Date(wall).toISOString(),
        stamp: { physicalMs: lastPhysicalMs, logical: lastLogical, deviceId, operationId: id },
      };
      if (action === 'edit') op.value = portableValue;
      if (sentAt !== undefined) op.sentAt = sentAt;
      return op;
    },
  };
}

function hasStamp(op) {
  try {
    if (!op || typeof op.editedAt !== 'string' || Number.isNaN(Date.parse(op.editedAt)))
      return false;
    compareEditStamps(op.stamp, op.stamp);
    return op.stamp.operationId === op.operationId;
  } catch {
    return false;
  }
}
function descends(child, ancestor, history, verifiedRevisionEdges) {
  if (child.parentOpId === ancestor.operationId) return true;
  const byId = new Map(history.map((op) => [op.operationId, op]));
  let cursor = child.parentOpId;
  const seen = new Set();
  while (cursor && !seen.has(cursor)) {
    if (cursor === ancestor.operationId) return true;
    seen.add(cursor);
    cursor = byId.get(cursor)?.parentOpId;
  }
  return verifiedRevisionEdges.some(
    (edge) =>
      edge.ancestorOpId === ancestor.operationId &&
      edge.descendantOpId === child.operationId &&
      child.baseRevision !== null &&
      child.baseRevision !== undefined &&
      ancestor.resultRevision !== null &&
      ancestor.resultRevision !== undefined &&
      String(child.baseRevision) === String(ancestor.resultRevision),
  );
}
function scopesOverlap(a, b) {
  if (a === b) return true;
  if (a === 'body' && b.startsWith('body/unit:')) return true;
  if (b === 'body' && a.startsWith('body/unit:')) return true;
  return false;
}
const result = (decision, winner, variants, reason) => ({
  decision,
  winner,
  variants,
  recoverableRevisions: variants,
  reason,
});
const tombstone = (op) => ({
  entityType: op.entityType,
  entityId: op.entityId,
  fieldPath: op.fieldPath,
  action: 'withdraw',
  operationId: op.operationId,
  baseRevision: op.baseRevision ?? null,
  parentOpId: op.parentOpId ?? null,
  resultRevision: op.resultRevision ?? null,
  editedAt: hasStamp(op) ? op.editedAt : null,
  stamp: hasStamp(op)
    ? {
        physicalMs: op.stamp.physicalMs,
        logical: op.stamp.logical,
        deviceId: op.stamp.deviceId,
        operationId: op.stamp.operationId,
      }
    : null,
});
function validateHistory(left, right, history, verifiedRevisionEdges) {
  if (left.entityType === 'diary' && left.fieldPath !== right.fieldPath) {
    if (history.length || verifiedRevisionEdges.length || left.operationId === right.operationId)
      throw new TypeError('history field scope mismatch');
    return;
  }
  const scope = (op) =>
    op &&
    op.entityType === left.entityType &&
    op.entityId === left.entityId &&
    op.fieldPath === left.fieldPath &&
    typeof op.operationId === 'string' &&
    op.operationId.length > 0;
  if (!scope(right) || history.some((op) => !scope(op)))
    throw new TypeError('history scope, entity, or field mismatch');
  const byId = new Map();
  for (const op of [left, right, ...history]) {
    if (op.parentOpId !== null && op.parentOpId !== undefined && typeof op.parentOpId !== 'string')
      throw new TypeError('invalid history parent operation');
    if (op.parentOpId === op.operationId) throw new TypeError('cyclic history ancestry');
    const prior = byId.get(op.operationId);
    if (prior && JSON.stringify(prior) !== JSON.stringify(op))
      throw new TypeError('history operationId collision');
    byId.set(op.operationId, op);
  }
  for (const op of byId.values()) {
    const seen = new Set();
    let cursor = op.operationId;
    while (cursor && byId.has(cursor)) {
      if (seen.has(cursor)) throw new TypeError('cyclic history ancestry');
      seen.add(cursor);
      cursor = byId.get(cursor).parentOpId;
    }
  }
  if (
    !Array.isArray(verifiedRevisionEdges) ||
    verifiedRevisionEdges.some(
      (edge) =>
        !edge ||
        typeof edge.ancestorOpId !== 'string' ||
        typeof edge.descendantOpId !== 'string' ||
        !byId.has(edge.ancestorOpId) ||
        !byId.has(edge.descendantOpId),
    )
  )
    throw new TypeError('invalid verified revision history');
}

// Pairwise planner. A storage owner folds heads per entity after deduplication and persists
// recoverableRevisions. It never edits message IDs, owner, sentAt, or replacement chains.
export function planEditMerge({ left, right, history = [], verifiedRevisionEdges = [] }) {
  if (!left || !right || !Array.isArray(history))
    throw new TypeError('two edits and history required');
  for (const op of [left, right]) {
    if (
      !['message', 'diary'].includes(op.entityType) ||
      !op.entityId ||
      !op.fieldPath ||
      !op.operationId
    )
      throw new TypeError('invalid edit operation');
  }
  if (left.entityType !== right.entityType || left.entityId !== right.entityId)
    throw new TypeError('edits target different entities');
  validateHistory(left, right, history, verifiedRevisionEdges);
  if (left.operationId === right.operationId) {
    if (JSON.stringify(left) !== JSON.stringify(right))
      throw new TypeError('operationId collision');
    if (left.action === 'withdraw')
      return result('same', tombstone(left), [], 'idempotent-withdrawal-retry');
    return result('same', left, [left], 'idempotent-retry');
  }
  const revisions = [left, right];
  if (left.action === 'withdraw' || right.action === 'withdraw') {
    const winner =
      left.action === 'withdraw' && right.action !== 'withdraw'
        ? left
        : right.action === 'withdraw' && left.action !== 'withdraw'
          ? right
          : hasStamp(left) && hasStamp(right) && compareEditStamps(left.stamp, right.stamp) >= 0
            ? left
            : right;
    return result('withdrawn', tombstone(winner), [], 'withdrawal-terminal');
  }
  if (left.entityType === 'diary' && !scopesOverlap(left.fieldPath, right.fieldPath))
    return result('apply-both', null, revisions, 'independent-fields-or-units');
  if (left.entityType === 'diary' && left.fieldPath !== right.fieldPath)
    return result('unresolved', null, revisions, 'whole-body-overlaps-unit');
  const rightAfter = descends(right, left, history, verifiedRevisionEdges);
  const leftAfter = descends(left, right, history, verifiedRevisionEdges);
  if (rightAfter && leftAfter) throw new TypeError('cyclic edit ancestry');
  if (rightAfter) return result('apply-right', right, revisions, 'causal-successor');
  if (leftAfter) return result('apply-left', left, revisions, 'causal-successor');
  const sameBase =
    left.baseRevision !== null &&
    left.baseRevision !== undefined &&
    String(left.baseRevision) === String(right.baseRevision);
  if (
    left.entityType === 'diary' &&
    (left.fieldPath === 'body' || left.fieldPath.startsWith('body/unit:'))
  ) {
    if (sameBase) return result('variants', null, revisions, 'concurrent-body-edits');
    return result('unresolved', null, revisions, 'body-ancestry-not-proven');
  }
  if (!hasStamp(left) || !hasStamp(right))
    return result('unresolved', null, revisions, 'missing-trustworthy-edit-stamp');
  const winner = compareEditStamps(left.stamp, right.stamp) >= 0 ? left : right;
  return result(
    winner === left ? 'apply-left' : 'apply-right',
    winner,
    revisions,
    sameBase ? 'concurrent-later-edit' : 'later-edit',
  );
}
