import { remapEntryMedia } from '../domain/import-reconciliation.mjs';
import { createHash } from 'node:crypto';
import { commitDiaryUnits } from '../domain/message-store.mjs';
import { commitCommentUnit } from '../domain/message-comments.mjs';

const projectionHash = (entry) =>
  createHash('sha256')
    .update(JSON.stringify([entry.title, entry.content, entry.category, entry.attachments]))
    .digest('hex');

const snapshot = (entry) => {
  const result = structuredClone(entry);
  delete result.history;
  return result;
};
const save = (entry, before) => {
  if (entry.contentEditedAt === undefined && Number.isFinite(Date.parse(before.updatedAt)))
    entry.contentEditedAt = before.updatedAt;
  entry.history = [before, ...(entry.history || [])].slice(0, 20);
  entry.revision++;
  entry.updatedAt = new Date().toISOString();
};

/** Conflict edits and their undo must move the authoritative tree with its cache. */
const syncMessages = (db, entry, before) => {
  commitDiaryUnits(db, entry, before);
  for (const comment of entry.comments || []) {
    const previous = db.messageStore?.units.find((unit) => unit.id === comment.messageUnitId);
    if (!previous) continue;
    const oldComment = before.comments?.find((item) => item.id === comment.id);
    if (JSON.stringify(comment.attachments) !== JSON.stringify(oldComment?.attachments)) {
      comment.revision = Math.max(comment.revision || 1, previous.revision) + 1;
      comment.updatedAt = entry.updatedAt;
    }
    commitCommentUnit(db, entry, comment);
  }
};

const guardChatMedia = (entry, fail) => {
  if (entry.chatJournal)
    throw fail(409, '聊天归篇只读，请在聊天窗口撤回并重新发送，不能在日记端替换原消息附件');
};

export function createRoutes({ mutate, body, reply, fail }) {
  return async (req, res, p) => {
    const match = p.match(/^\/api\/conflicts\/([a-f0-9-]+)$/);
    if (!match || req.method !== 'PUT') return false;
    const input = JSON.parse(await body(req));
    if (!['both', 'left', 'right', 'undo'].includes(input.choice))
      throw fail(400, '请选择保留方式');
    const result = await mutate((db) => {
      const conflict = db.conflicts?.find((item) => item.id === match[1]);
      if (!conflict) throw fail(409, '此冲突不存在，请刷新');
      if (input.choice === 'undo') {
        const action = conflict.actions?.at(-1);
        if (
          conflict.kind !== 'media' ||
          conflict.status !== 'resolved' ||
          !action?.targets?.length ||
          action.undoneAt
        )
          throw fail(409, '此记录不能直接撤销，请打开对应日记的编辑历史恢复');
        const restores = action.targets.map((target) => {
          const entry = db.entries.find((e) => e.id === target.id);
          const expected = input.targets?.find((e) => e.id === target.id);
          const before = entry?.history?.find((h) => h.revision === target.beforeRevision);
          if (
            !entry ||
            expected?.revision !== entry.revision ||
            entry.revision !== target.afterRevision ||
            !before
          )
            throw fail(409, '处理后日记已改变或历史已过期，请打开日记历史核对，不能覆盖后续编辑');
          guardChatMedia(entry, fail);
          return { entry, before };
        });
        for (const { entry, before } of restores) {
          const previous = snapshot(entry);
          const restored = {
            ...structuredClone(before),
            revision: entry.revision,
            history: entry.history,
          };
          save(restored, previous);
          restored.contentEditedAt = restored.updatedAt;
          syncMessages(db, restored, previous);
          db.entries[db.entries.indexOf(entry)] = restored;
        }
        action.undoneAt = new Date().toISOString();
        conflict.status = 'open';
        delete conflict.choice;
        delete conflict.resolvedAt;
        return { updated: true, affected: restores.length };
      }
      if (conflict.status !== 'open') throw fail(409, '此冲突已处理，请刷新');
      const items = conflict.kind === 'entry' ? db.entries : db.media;
      const left = items.find((i) => i.id === conflict.left),
        right = items.find((i) => i.id === conflict.right);
      if (!left || !right) throw fail(409, '对比内容已变化，请刷新');
      if (
        conflict.kind === 'entry' &&
        (input.leftRevision !== left.revision || input.rightRevision !== right.revision)
      )
        throw fail(409, '日记已被编辑，请重新对比后选择');
      if (input.title !== undefined) {
        if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 500)
          throw fail(400, '新名称不正确');
        const ownedTitle =
          conflict.kind === 'entry' && right.chatJournal?.projectionHash === projectionHash(right);
        if (conflict.kind === 'entry') save(right, snapshot(right));
        right[conflict.kind === 'entry' ? 'title' : 'name'] = input.title.trim();
        if (ownedTitle) right.chatJournal.projectionHash = projectionHash(right);
      }
      const targets = [];
      if (input.choice !== 'both') {
        const keep = input.choice === 'left' ? left : right,
          discard = input.choice === 'left' ? right : left;
        if (conflict.kind === 'entry') {
          const old = snapshot(discard);
          discard.deleted = true;
          save(discard, old);
        } else {
          // A filename never authorizes changing every diary in the library.
          if (
            !Array.isArray(input.targets) ||
            !input.targets.length ||
            new Set(input.targets.map((t) => t.id)).size !== input.targets.length
          )
            throw fail(400, '请明确选择要替换附件的日记，不能全库替换');
          for (const target of input.targets) {
            const entry = db.entries.find((e) => e.id === target.id);
            if (
              !entry ||
              target.revision !== entry.revision ||
              !(entry.attachments || []).includes(discard.id)
            )
              throw fail(409, '选中的日记或附件已变化，请重新核对');
            if ((entry.attachments || []).includes(keep.id))
              throw fail(409, '这篇日记已同时包含两份附件，请保留两份；不能将不同图片合并为一个');
            if (
              (entry.comments || []).some(
                (comment) =>
                  comment.attachments?.includes(discard.id) &&
                  comment.attachments.includes(keep.id),
              )
            )
              throw fail(409, '评论已同时包含两份附件，请保留两份，不能合并不同图片');
            guardChatMedia(entry, fail);
            const old = snapshot(entry);
            const mapped = remapEntryMedia(
              { ...entry, history: [] },
              new Map([[discard.id, keep.id]]),
            );
            mapped.history = entry.history || [];
            save(mapped, old);
            mapped.contentEditedAt = mapped.updatedAt;
            syncMessages(db, mapped, old);
            db.entries[db.entries.indexOf(entry)] = mapped;
            targets.push({
              id: entry.id,
              beforeRevision: entry.revision,
              afterRevision: mapped.revision,
            });
          }
        }
      }
      conflict.status = 'resolved';
      conflict.choice = input.choice;
      conflict.resolvedAt = new Date().toISOString();
      conflict.actions ||= [];
      conflict.actions.push({ choice: input.choice, appliedAt: conflict.resolvedAt, targets });
      return { updated: true, affected: targets.length };
    });
    reply(res, 200, result);
    return true;
  };
}
