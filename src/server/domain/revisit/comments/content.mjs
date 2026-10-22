import { fail } from '../../../http.mjs';
import { LIMITS } from '../../../../../public/shared/limits.js';
import { validateMessageUnit } from '../../../../../public/shared/message-units.js';
import { validateRenderableRichDocument } from '../../../../../public/shared/rich-document-renderer.js';
import { digest } from '../sources/identity.mjs';

export function validateCommentText(text) {
  if (typeof text !== 'string' || text.length > LIMITS.revisitCommentCharacters)
    throw fail(400, '评论格式不正确');
  if (!text.trim()) throw fail(400, '评论不能为空');
}

/** Keep the existing text API: Markdown characters are preserved literally, not reparsed here. */
export const commentBody = (text) => ({
  format: 'shiye-richdoc',
  version: 1,
  content: text.split(/\r\n|\n|\r/).map((value, index) => ({
    type: 'paragraph',
    attrs: { blockId: 'comment-paragraph:' + index },
    ...(value ? { content: [{ type: 'text', text: value }] } : {}),
  })),
});

export function assertCommentContent(comment) {
  validateCommentText(comment.text);
  validateMessageUnit(comment);
  validateRenderableRichDocument(comment.body);
  if (
    comment.origin.kind !== 'comment' ||
    digest(comment.body) !== digest(commentBody(comment.text)) ||
    comment.eventTime.instant !== comment.createdAt ||
    comment.eventTime.source !== 'comment-created'
  )
    throw fail(409, '评论正文与兼容文本不一致，未保存');
}
