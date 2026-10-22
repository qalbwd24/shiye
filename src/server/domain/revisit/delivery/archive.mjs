import { fail } from '../../../http.mjs';
import { validateMessageUnit } from '../../../../../public/shared/message-units.js';
import { assertInterval, isUTCInstant } from '../engine/contracts.mjs';
import { digest } from '../sources/identity.mjs';
import { emptyRevisitState } from './state.mjs';
import { assertCommentContent } from '../comments/content.mjs';
import { assertStoredCommentContext } from '../comments/context.mjs';
import { assertDailySelections, validDailyTime, validSourceDate } from './daily-random.mjs';

const sourceFingerprint = (db) =>
  digest([db.entries || [], db.messageStore ?? null, db.chatJournal ?? null, db.media || []]);
export const stateToken = (db) => digest(db.revisit ?? null);
const positive = (value) => Number.isSafeInteger(value) && value > 0;
const validRef = (ref) =>
  ref &&
  typeof ref.entryId === 'string' &&
  ref.entryId &&
  typeof ref.unitId === 'string' &&
  ref.unitId &&
  (ref.snapshot === undefined || /^[a-f0-9]{64}$/.test(ref.snapshot));

export function exportRevisitArchive(db) {
  const source = sourceFingerprint(db);
  const state = structuredClone(db.revisit || emptyRevisitState());
  return {
    format: 'shiye-revisit-state',
    version: 1,
    sourceFingerprint: source,
    state,
    checksum: digest([source, state]),
    targetToken: stateToken(db),
  };
}

/** Validate relationships as well as checksums: corrupt sequence/targets must not skip data. */
export function validateRevisitState(state, db) {
  const invalid = () => {
    throw fail(400, '回看状态归档结构或关联不完整');
  };
  const config = state?.config;
  if (
    state?.version !== 1 ||
    config?.version !== 1 ||
    !positive(config.revision) ||
    !positive(config.ruleRevision) ||
    typeof config.enabled !== 'boolean' ||
    !['Asia/Shanghai', 'system'].includes(config.timeZone) ||
    typeof config.title !== 'string' ||
    !config.title.trim() ||
    config.title.length > 80 ||
    !Array.isArray(config.categories) ||
    config.categories.some((item) => !db.categories.includes(item)) ||
    typeof config.sender?.name !== 'string' ||
    !config.sender.name.trim() ||
    config.sender.name.length > 80 ||
    (config.sender.avatarAssetId &&
      !db.media.some((item) => item.id === config.sender.avatarAssetId)) ||
    (state.cursor !== null && !isUTCInstant(state.cursor)) ||
    !Array.isArray(state.batches) ||
    !Array.isArray(state.deliveries) ||
    !Array.isArray(state.comments)
  )
    invalid();
  try {
    assertInterval(config.interval);
    if (
      (config.mode !== undefined && !['interval', 'daily-random'].includes(config.mode)) ||
      (config.dailyTime !== undefined && !validDailyTime(config.dailyTime)) ||
      ['sourceDateFrom', 'sourceDateTo'].some(
        (key) => config[key] !== undefined && config[key] !== null && !validSourceDate(config[key]),
      ) ||
      (config.sourceDateFrom && config.sourceDateTo && config.sourceDateFrom > config.sourceDateTo)
    )
      invalid();
    assertDailySelections(state);
  } catch {
    invalid();
  }
  const batches = new Map(),
    members = new Map();
  for (const batch of state.batches) {
    if (
      !batch ||
      typeof batch.id !== 'string' ||
      batches.has(batch.id) ||
      !positive(batch.ruleRevision) ||
      batch.ruleRevision > config.ruleRevision ||
      !isUTCInstant(batch.replayAt) ||
      Date.parse(batch.replayAt) % 60000 ||
      !isUTCInstant(batch.createdAt) ||
      typeof batch.timeZone !== 'string' ||
      batch.timeZone === 'system' ||
      !Array.isArray(batch.targets) ||
      !batch.targets.length ||
      batch.targets.some((ref) => !validRef(ref))
    )
      invalid();
    try {
      new Intl.DateTimeFormat('en-CA', { timeZone: batch.timeZone });
    } catch {
      invalid();
    }
    batches.set(batch.id, batch);
    members.set(batch.id, []);
  }
  const deliveries = new Map();
  for (const [index, delivery] of state.deliveries.entries()) {
    const batch = batches.get(delivery?.batchId);
    if (
      !batch ||
      delivery.sequence !== index + 1 ||
      deliveries.has(delivery.id) ||
      !validRef(delivery.ref) ||
      !isUTCInstant(delivery.replayAt) ||
      !isUTCInstant(delivery.originalAt) ||
      Math.floor(Date.parse(delivery.replayAt) / 60000) !== Date.parse(batch.replayAt) / 60000 ||
      delivery.id !==
        'revisit:' +
          digest([
            ...(db.revisitInstanceId ? [db.revisitInstanceId] : []),
            batch.ruleRevision,
            delivery.ref,
            Date.parse(delivery.replayAt),
          ])
    )
      invalid();
    deliveries.set(delivery.id, delivery);
    members.get(batch.id).push(delivery);
  }
  for (const batch of batches.values()) {
    const group = members.get(batch.id);
    if (
      digest(batch.targets) !== digest(group.map((delivery) => delivery.ref)) ||
      batch.id !==
        'batch:' +
          digest([
            ...(db.revisitInstanceId ? [db.revisitInstanceId] : []),
            batch.ruleRevision,
            Date.parse(batch.replayAt) / 60000,
            group.map((delivery) => delivery.id),
          ])
    )
      invalid();
  }
  const operations = new Set(),
    commentIds = new Set();
  for (const comment of state.comments) {
    if (
      !comment ||
      typeof comment.operationId !== 'string' ||
      !comment.operationId ||
      operations.has(comment.operationId) ||
      typeof comment.id !== 'string' ||
      commentIds.has(comment.id)
    )
      invalid();
    operations.add(comment.operationId);
    commentIds.add(comment.id);
    if (comment.state === 'withdrawn') {
      if (comment.text || comment.body) invalid();
      continue;
    }
    const batch = batches.get(comment.batchId);
    const delivery = comment.deliveryId ? deliveries.get(comment.deliveryId) : null;
    if (
      !batch ||
      comment.origin?.kind !== 'comment' ||
      comment.state !== 'active' ||
      (comment.deliveryId && delivery?.batchId !== batch.id) ||
      !Array.isArray(comment.targets) ||
      digest(comment.targets) !== digest(delivery ? [delivery.ref] : batch.targets)
    )
      invalid();
    try {
      validateMessageUnit(comment);
      assertCommentContent(comment);
      assertStoredCommentContext(comment, batch, delivery);
    } catch {
      invalid();
    }
  }
  return state;
}

/** Restore only an empty state, or accept the identical archive as an idempotent retry. */
export function restoreRevisitArchive(db, { archive, expectedToken } = {}) {
  if (expectedToken !== stateToken(db)) throw fail(409, '回看状态已变化，请重新读取');
  if (
    archive?.format !== 'shiye-revisit-state' ||
    archive.version !== 1 ||
    archive.checksum !== digest([archive.sourceFingerprint, archive.state])
  )
    throw fail(400, '回看状态归档校验失败');
  if (archive.sourceFingerprint !== sourceFingerprint(db))
    throw fail(409, '来源库身份或内容已变化，不能直接恢复回看状态');
  validateRevisitState(archive.state, db);
  const current = db.revisit;
  if (current && digest(current) === digest(archive.state))
    return { restored: false, identical: true, token: stateToken(db) };
  if (
    current &&
    (current.cursor ||
      current.randomDays?.length ||
      current.deliveries.length ||
      current.batches.length ||
      current.comments.length)
  )
    throw fail(409, '目标已有推送进度或评论，不能用归档覆盖');
  db.revisit = structuredClone(archive.state);
  return { restored: true, token: stateToken(db) };
}
