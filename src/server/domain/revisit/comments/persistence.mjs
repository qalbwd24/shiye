import { randomUUID } from 'node:crypto';
import { fail } from '../../../http.mjs';
import { deliveryToken, ensureRevisitState, iso } from '../delivery/state.mjs';
import { freezeTree } from '../sources/identity.mjs';
import { resolveCommentContext, assertStoredCommentContext } from './context.mjs';
import { commentBody, validateCommentText, assertCommentContent } from './content.mjs';

export function validateCommentOperation(input) {
  if (
    !input ||
    Array.isArray(input) ||
    typeof input.operationId !== 'string' ||
    !input.operationId ||
    input.operationId.length > 120
  )
    throw fail(400, '评论操作标识不正确');
}
const command = (db, action, record, result) =>
  freezeTree({
    version: 1,
    expectedToken: deliveryToken(db),
    action,
    record: record ? structuredClone(record) : null,
    result: structuredClone(result),
  });

export function planRevisitComment(db, input, now, { createId = randomUUID, actor } = {}) {
  validateCommentOperation(input);
  const old = db.revisit?.comments.find((item) => item.operationId === input.operationId);
  if (old?.state === 'withdrawn') return command(db, 'none', null, old);
  validateCommentText(input.text);
  if (old) {
    if (
      old.text !== input.text ||
      old.batchId !== input.batchId ||
      old.deliveryId !== (input.deliveryId || null) ||
      old.commentOn?.[0]?.occurrenceId !== input.occurrenceId ||
      (input.sentAt !== undefined && iso(input.sentAt) !== old.createdAt) ||
      (actor &&
        ((old.author?.id || 'self') !== actor.id || (old.author?.kind || 'self') !== actor.kind))
    )
      throw fail(409, '同一评论操作标识不能更换正文或目标');
    return command(db, 'none', null, old);
  }
  const context = resolveCommentContext(db, input);
  const commentAt = iso(input.sentAt ?? now);
  if (
    Date.parse(commentAt) > now + 300000 ||
    Date.parse(commentAt) < Date.parse(context.createdAt) - 60000
  )
    throw fail(400, '评论发送时间与回看组不匹配');
  const record = {
    id: 'revisit-comment:' + createId(),
    operationId: input.operationId,
    batchId: context.batchId,
    deliveryId: context.deliveryId,
    targets: structuredClone(context.targets),
    text: input.text,
    createdAt: commentAt,
    receivedAt: iso(now),
    state: 'active',
    origin: { kind: 'comment', entryId: context.targets[0].entryId, source: 'revisit' },
    body: commentBody(input.text),
    eventTime: {
      instant: commentAt,
      timeZone: 'UTC',
      precision: 'millisecond',
      source: 'comment-created',
      sourceField: 'createdAt',
    },
    revision: 1,
    sourceSpans: [],
    replyTo: structuredClone(context.replyTo),
    commentOn: structuredClone(context.commentOn),
    author: actor ? structuredClone(actor) : { name: '我' },
  };
  if (db.revisit?.comments.some((item) => item.id === record.id))
    throw fail(409, '评论编号已存在，未覆盖');
  assertCommentContent(record);
  const batch = db.revisit.batches.find((item) => item.id === record.batchId);
  const delivery = record.deliveryId
    ? db.revisit.deliveries.find((item) => item.id === record.deliveryId)
    : null;
  assertStoredCommentContext(record, batch, delivery);
  return command(db, 'append', record, record);
}

export function planRevisitWithdrawal(db, input) {
  validateCommentOperation(input);
  const old = db.revisit?.comments.find((item) => item.operationId === input.operationId);
  if (!old) {
    const record = {
      id: input.operationId,
      operationId: input.operationId,
      state: 'withdrawn',
      text: '',
      targets: [],
      origin: 'revisit-comment',
    };
    return command(db, 'append', record, { state: 'withdrawn' });
  }
  if (old.state === 'withdrawn') return command(db, 'none', null, { id: old.id, state: old.state });
  const record = {
    ...structuredClone(old),
    state: 'withdrawn',
    text: '',
    body: null,
    revision: (old.revision || 0) + 1,
  };
  return command(db, 'replace', record, { id: record.id, state: record.state });
}

/** Always use the shared library mutate callback; never write Entry or messageStore. */
export function commitCommentPlan(db, plan) {
  if (
    plan?.version !== 1 ||
    !['none', 'append', 'replace'].includes(plan.action) ||
    plan.expectedToken !== deliveryToken(db)
  )
    throw fail(409, '评论或来源已变化，请重试');
  const result = structuredClone(plan.result);
  if (plan.action === 'none') return result;
  const record = structuredClone(plan.record);
  const state = ensureRevisitState(db);
  if (plan.action === 'append') state.comments.push(record);
  else
    state.comments[state.comments.findIndex((item) => item.operationId === record.operationId)] =
      record;
  return result;
}

export const addRevisitComment = (db, input, now = Date.now()) =>
  commitCommentPlan(db, planRevisitComment(db, input, now));
export const withdrawRevisitComment = (db, input) =>
  commitCommentPlan(db, planRevisitWithdrawal(db, input));
