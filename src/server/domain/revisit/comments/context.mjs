import { fail } from '../../../http.mjs';
import { openRevisitSources } from '../../revisit-sources.mjs';
import { richMediaReferences } from '../../../../../public/shared/rich-document.js';
import { digest, freezeTree } from '../sources/identity.mjs';

const conflict = (message) => {
  throw fail(409, message);
};

/** A selection is an explicit fixed batch, never whichever batch is newest at send time. */
export function resolveCommentContext(db, input, session) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw fail(400, '评论选择须为对象');
  const batch = db.revisit?.batches.find((item) => item.id === input.batchId);
  if (!batch || !batch.targets?.length) conflict('请选择已展示的回看组');
  const delivery = input.deliveryId
    ? db.revisit.deliveries.find(
        (item) => item.id === input.deliveryId && item.batchId === batch.id,
      )
    : null;
  if (input.deliveryId && !delivery) conflict('引用目标不属于当前组');
  const targets = structuredClone(delivery ? [delivery.ref] : batch.targets);
  session ||= openRevisitSources(db);
  const sources = targets.map((ref) => session.resolve(ref));
  if (sources.some((source) => !source)) conflict('评论来源已变化，请重新查看');
  if (
    input.occurrenceId !== undefined &&
    (!delivery ||
      typeof input.occurrenceId !== 'string' ||
      !input.occurrenceId ||
      !richMediaReferences(sources[0].unit.body).some(
        (item) => item.occurrenceId === input.occurrenceId,
      ))
  )
    conflict('评论对应的图片或视频位置不存在');
  const entries = new Map();
  for (const { entry } of sources)
    if (!entries.has(entry.id))
      entries.set(entry.id, {
        entryId: entry.id,
        title: entry.title,
        category: entry.category,
        tags: [...(entry.tags || [])],
      });
  return freezeTree({
    version: 1,
    batchId: batch.id,
    createdAt: batch.createdAt,
    deliveryId: delivery?.id || null,
    scope: input.occurrenceId !== undefined ? 'media' : delivery ? 'message' : 'group',
    targets,
    replyTo: delivery ? structuredClone(delivery.ref) : null,
    commentOn: targets.map((ref) => ({
      kind: input.occurrenceId !== undefined ? 'media' : 'message',
      ...ref,
      ...(input.occurrenceId !== undefined ? { occurrenceId: input.occurrenceId } : {}),
    })),
    entries: [...entries.values()],
  });
}

/** Structural history validation; a later unavailable source does not change the saved target. */
export function assertStoredCommentContext(comment, batch, delivery) {
  const expected = delivery ? [delivery.ref] : batch?.targets;
  const media = comment.commentOn?.[0]?.kind === 'media';
  const occurrenceId = comment.commentOn?.[0]?.occurrenceId;
  if (
    !Array.isArray(expected) ||
    !expected.length ||
    digest(comment.targets) !== digest(expected) ||
    comment.origin?.entryId !== expected[0].entryId ||
    digest(comment.replyTo) !== digest(delivery ? delivery.ref : null) ||
    !Array.isArray(comment.commentOn) ||
    (media && (!delivery || typeof occurrenceId !== 'string' || !occurrenceId))
  )
    conflict('评论保存的上下文关联不一致');
  const on = expected.map((ref) => ({
    kind: media ? 'media' : 'message',
    ...ref,
    ...(media ? { occurrenceId } : {}),
  }));
  if (digest(comment.commentOn) !== digest(on)) conflict('评论保存的消息或媒体关联不一致');
}
