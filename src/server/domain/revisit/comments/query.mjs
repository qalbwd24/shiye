import { isHidden } from '../../../../../public/shared/entry-state.js';
import { richMediaReferences } from '../../../../../public/shared/rich-document.js';
import { openRevisitSources } from '../../revisit-sources.mjs';

export function commentsForEntry(db, entryId) {
  const entry = db.entries.find((item) => item.id === entryId);
  if (!entry || entry.deleted || entry.draft || isHidden(entry)) return [];
  return structuredClone(
    (db.revisit?.comments || []).filter(
      (comment) =>
        comment.state === 'active' && comment.targets.some((ref) => ref.entryId === entryId),
    ),
  );
}

/** One authoritative comment, projected under each target diary with local target annotations. */
export function describeCommentsForEntry(db, entryId) {
  const comments = commentsForEntry(db, entryId);
  const session = comments.length ? openRevisitSources(db) : null;
  return {
    entryId,
    comments: comments.map((comment) => ({
      ...comment,
      context: {
        scope: comment.deliveryId
          ? comment.commentOn?.[0]?.kind === 'media'
            ? 'media'
            : 'message'
          : 'group',
        batchId: comment.batchId,
        deliveryId: comment.deliveryId,
        targets: (comment.commentOn || [])
          .filter((target) => target.entryId === entryId)
          .map((target) => {
            const ref = {
              entryId: target.entryId,
              unitId: target.unitId,
              ...(target.snapshot ? { snapshot: target.snapshot } : {}),
            };
            const source = session.resolve(ref);
            const available =
              !!source &&
              (target.kind !== 'media' ||
                richMediaReferences(source.unit.body).some(
                  (item) => item.occurrenceId === target.occurrenceId,
                ));
            return { ...target, available };
          }),
      },
    })),
  };
}
