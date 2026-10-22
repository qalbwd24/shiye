import { validateMessageUnit } from '../../../public/shared/message-units.js';
import { validateRenderableRichDocument } from '../../../public/shared/rich-document-renderer.js';
import { richMediaReferences } from '../../../public/shared/rich-document.js';
import { fail } from '../http.mjs';
import { randomUUID } from 'node:crypto';

export const commentUnitId = (id) => 'comment:' + id;

/** Targets use source identities, never visible offsets, titles or timestamps. */
export function validateCommentTargets(input, entry, db) {
  const targets = input === undefined ? [{ kind: 'entry', entryId: entry.id }] : input;
  if (!Array.isArray(targets) || !targets.length || targets.length > 100)
    throw fail(400, '评论目标须为1–100项来源引用');
  const result = targets.map((target) => {
    if (
      !target ||
      target.entryId !== entry.id ||
      !['entry', 'message', 'media'].includes(target.kind)
    )
      throw fail(400, '评论目标须属于当前日记');
    if (target.kind === 'entry') return { kind: 'entry', entryId: entry.id };
    const unit = db.messageStore?.units.find(
      (item) =>
        item.id === target.unitId && item.origin.entryId === entry.id && item.state === 'active',
    );
    if (!unit) throw fail(409, '评论对应的消息已变化，请重新选择');
    if (target.kind === 'message') return { kind: 'message', entryId: entry.id, unitId: unit.id };
    const occurrence = richMediaReferences(unit.body).find(
      (item) => item.occurrenceId === target.occurrenceId,
    );
    if (!occurrence) throw fail(409, '评论对应的图片或视频出现位置不存在');
    return {
      kind: 'media',
      entryId: entry.id,
      unitId: unit.id,
      occurrenceId: occurrence.occurrenceId,
    };
  });
  return [...new Map(result.map((target) => [JSON.stringify(target), target])).values()];
}

/** Existing comment controls keep their text cache; the canonical body uses the same richdoc. */
export function commitCommentUnit(db, entry, comment, { messageUnitsEnabled = false } = {}) {
  const id = commentUnitId(comment.id);
  const existing = db.messageStore?.units.find((unit) => unit.id === id);
  if (!messageUnitsEnabled && !existing) return null;
  const previousOccurrences =
    comment.mediaOccurrences ||
    existing?.mediaOccurrences ||
    (existing?.body ? richMediaReferences(existing.body) : []);
  comment.mediaOccurrences = (comment.attachments || []).map((assetId) => {
    const previous = previousOccurrences.find((item) => item.assetId === assetId);
    return previous
      ? structuredClone(previous)
      : {
          assetId,
          occurrenceId: randomUUID(),
          blockId: randomUUID(),
          insertedAt: comment.createdAt,
        };
  });
  const content = String(comment.body || '')
    .split(/\r\n|\n|\r/)
    .map((text, index) => ({
      type: 'paragraph',
      attrs: { blockId: `${id}:paragraph:${index}` },
      ...(text ? { content: [{ type: 'text', text }] } : {}),
    }));
  for (const occurrence of comment.mediaOccurrences) {
    const { assetId } = occurrence;
    const asset = db.media.find((item) => item.id === assetId && item.type?.startsWith('image/'));
    if (!asset) throw fail(400, '评论图片原件不存在');
    content.push({
      type: 'image',
      attrs: {
        blockId: occurrence.blockId,
        assetId,
        occurrenceId: occurrence.occurrenceId,
        insertedAt: occurrence.insertedAt,
        widthRatio: 0.75,
        align: 'center',
        caption: '',
        alt: asset.name || '',
      },
    });
  }
  const body = comment.deleted ? null : { format: 'shiye-richdoc', version: 1, content };
  if (body) validateRenderableRichDocument(body);
  const unit = {
    id,
    body,
    origin: { kind: 'comment', entryId: entry.id, commentId: comment.id },
    eventTime: {
      instant: new Date(comment.createdAt).toISOString(),
      timeZone: 'UTC',
      precision: 'millisecond',
      source: 'comment-created',
      sourceField: 'createdAt',
    },
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    state: comment.deleted ? 'deleted' : 'active',
    revision: comment.revision,
    replyTo: comment.replyTo ? commentUnitId(comment.replyTo) : null,
    commentOn: structuredClone(
      comment.commentOn || existing?.commentOn || [{ kind: 'entry', entryId: entry.id }],
    ),
    sourceSpans: [],
    mediaOccurrences: structuredClone(comment.mediaOccurrences),
  };
  validateMessageUnit(unit);
  db.messageStore ||= { version: 1, units: [], layouts: {} };
  const at = db.messageStore.units.findIndex((item) => item.id === id);
  if (at < 0) db.messageStore.units.push(unit);
  else db.messageStore.units[at] = unit;
  comment.messageUnitId = id;
  comment.commentOn = structuredClone(unit.commentOn);
  return unit;
}
