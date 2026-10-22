import { resolveCommentContext } from './context.mjs';
import { planRevisitComment, planRevisitWithdrawal, commitCommentPlan } from './persistence.mjs';
import { commentsForEntry, describeCommentsForEntry } from './query.mjs';

/** The host injects the same transaction port used by delivery, plus its clock. */
export function createRevisitCommentService(port, { clock = () => Date.now() } = {}) {
  return Object.freeze({
    context: (input) => port.read((db) => resolveCommentContext(db, input)),
    add: (input) =>
      port.transaction((db) => commitCommentPlan(db, planRevisitComment(db, input, clock()))),
    withdraw: (input) =>
      port.transaction((db) => commitCommentPlan(db, planRevisitWithdrawal(db, input))),
    forEntry: (entryId) => port.read((db) => commentsForEntry(db, entryId)),
    describeForEntry: (entryId) => port.read((db) => describeCommentsForEntry(db, entryId)),
  });
}
