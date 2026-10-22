import { normalizeAvatarCrop } from '../../../public/shared/profile.js';
import { randomUUID } from 'node:crypto';
import { LIMITS } from '../../../public/shared/limits.js';
import { commitCommentUnit, validateCommentTargets } from '../domain/message-comments.mjs';

/** Private entry annotations. Authors and quoted replies are creation-time snapshots. */
export function createRoutes({ mutate, body, reply, fail, messageUnitsEnabled }) {
  const imageIds = (value, db) => {
    if (!Array.isArray(value) || value.some((id) => typeof id !== 'string'))
      throw fail(400, '评论图片须为有效附件列表');
    const ids = [...new Set(value)];
    for (const id of ids) {
      const media = db.media.find((m) => m.id === id);
      if (!media || !/^image\/(png|jpeg|webp|gif|avif)$/.test(media.type))
        throw fail(400, '评论和头像仅支持库中已有的图片或 GIF');
    }
    return ids;
  };
  return async (req, res, p) => {
    const match = p.match(/^\/api\/entries\/([a-f0-9-]+)\/comments(?:\/([a-f0-9-]+))?$/);
    if (!match || !['POST', 'PUT'].includes(req.method)) return false;
    if ((req.method === 'POST') === !!match[2]) throw fail(405, '不支持此评论操作');
    const input = JSON.parse((await body(req)).toString('utf8'));
    if (input.body !== undefined && typeof input.body !== 'string')
      throw fail(400, '评论内容格式不正确');
    const value = input.body?.trim();
    if (value !== undefined && value.length > 10000) throw fail(400, '评论最多为 10000 个字符');
    return reply(
      res,
      match[2] ? 200 : 201,
      await mutate((db) => {
        const entry = db.entries.find((e) => e.id === match[1]);
        if (!entry || entry.deleted) throw fail(404, '请先恢复日记再管理评论');
        if (input.entryRevision !== entry.revision)
          throw fail(409, '日记已在另一窗口更新，请重新打开后再提交。评论草稿仍保留。');
        const previous = { ...entry };
        delete previous.history;
        const comments = structuredClone(entry.comments || []);
        const now = new Date().toISOString();
        const attachments =
          input.attachments === undefined ? undefined : imageIds(input.attachments, db);
        let changedComment;
        if (match[2]) {
          const comment = comments.find((c) => c.id === match[2]);
          if (!comment) throw fail(404, '评论不存在');
          if (input.revision !== comment.revision) throw fail(409, '评论已更新，请重新打开后核对');
          if (
            value === undefined &&
            attachments === undefined &&
            typeof input.deleted !== 'boolean'
          )
            throw fail(400, '没有可保存的评论修改');
          if (
            (value !== undefined || attachments !== undefined) &&
            !(value ?? comment.body ?? '').trim() &&
            !(attachments ?? comment.attachments ?? []).length
          )
            throw fail(400, '请填写评论或添加图片');
          if (value !== undefined) comment.body = value;
          if (attachments !== undefined) comment.attachments = attachments;
          if (typeof input.deleted === 'boolean') comment.deleted = input.deleted;
          comment.revision++;
          comment.updatedAt = now;
          changedComment = comment;
        } else {
          if (!value && !attachments?.length) throw fail(400, '请填写评论或添加图片');
          const profile = db.settings?.preferences?.profile || {};
          const authorName = input.authorName ?? profile.authorName ?? '我';
          if (typeof authorName !== 'string' || !authorName.trim() || authorName.trim().length > 80)
            throw fail(400, '评论用户名须为 1–80 个字符');
          const authorAvatarId =
            input.authorAvatarId === undefined
              ? (profile.authorAvatarId ?? null)
              : input.authorAvatarId;
          if (authorAvatarId) imageIds([authorAvatarId], db);
          else if (authorAvatarId !== null && authorAvatarId !== '')
            throw fail(400, '头像附件格式不正确');
          let authorAvatarCrop;
          try {
            authorAvatarCrop = normalizeAvatarCrop(
              input.authorAvatarCrop ?? profile.authorAvatarCrop,
            );
          } catch (error) {
            throw fail(400, error.message);
          }
          let replyTarget;
          if (input.replyTo !== undefined && input.replyTo !== null && input.replyTo !== '') {
            replyTarget = comments.find(
              (comment) => comment.id === input.replyTo && !comment.deleted,
            );
            if (!replyTarget) throw fail(400, '回复目标须为本篇日记中尚未删除的评论');
          }
          comments.push({
            id: randomUUID(),
            body: value || '',
            attachments: attachments || [],
            authorName: authorName.trim(),
            authorAvatarId: authorAvatarId || null,
            authorAvatarCrop,
            ...(replyTarget
              ? {
                  replyTo: replyTarget.id,
                  replyPreview: {
                    id: replyTarget.id,
                    body: Array.from(replyTarget.body || '')
                      .slice(0, 120)
                      .join(''),
                    authorName: replyTarget.authorName || '我',
                  },
                }
              : {}),
            createdAt: now,
            updatedAt: now,
            revision: 1,
            deleted: false,
            commentOn: validateCommentTargets(input.commentOn, entry, db),
          });
          changedComment = comments.at(-1);
        }
        // Annotation and taxonomy changes must never become the diary's content clock.
        if (
          !Object.hasOwn(entry, 'contentEditedAt') &&
          Number.isFinite(Date.parse(entry.updatedAt))
        )
          entry.contentEditedAt = entry.updatedAt;
        entry.comments = comments;
        commitCommentUnit(db, entry, changedComment, { messageUnitsEnabled });
        entry.revision++;
        entry.updatedAt = now;
        entry.history = [previous, ...(entry.history || [])].slice(0, LIMITS.historyEntries);
        return entry;
      }),
    );
  };
}
