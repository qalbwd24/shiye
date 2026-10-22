import { isHidden } from '../../../public/shared/entry-state.js';
import { richMediaReferences } from '../../../public/shared/rich-document.js';
import { chatUnitId, canonicalChatHTML } from './message-store.mjs';
import { stickerMedia } from './stickers.mjs';

const fields = (value, allowed, fail) => {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    throw fail(400, '消息收藏参数包含未知字段或格式不正确');
};
const withdrawn = (db, origin) =>
  (db.chatJournal?.withdrawals || []).some(
    (item) =>
      item.sourceId === origin.sourceId &&
      item.roomId === origin.roomId &&
      item.messageId === origin.messageId,
  );
const available = (entry, fail) => {
  if (!entry) throw fail(404, '原消息不存在或尚未归档');
  if (entry.deleted || entry.draft || isHidden(entry)) throw fail(409, '原消息当前不可收藏');
};
function checkUnit(db, entry, unit, fail) {
  if (
    unit.state !== 'active' ||
    !unit.body ||
    (unit.origin.kind === 'chat' && withdrawn(db, unit.origin))
  )
    throw fail(409, '原消息已撤回、删除或不可收藏');
  if (unit.origin.kind === 'chat') {
    const cached = entry.chatJournal?.messages?.find((item) => item.id === unit.origin.messageId);
    if (cached?.withdrawn) throw fail(409, '原消息已撤回');
    if (cached) canonicalChatHTML(db, entry, cached); // reject divergent compatibility caches
  }
}

/** Resolve only registered business messages. Never import/rewrite a source while collecting. */
export function resolveStickerMessage(db, input, fail) {
  fields(input, ['version', 'source', 'mediaId', 'occurrenceId', 'name', 'group', 'note'], fail);
  if (input.version !== 1) throw fail(400, '消息收藏协议版本不支持');
  const source = input.source;
  let unit,
    entry,
    ids = [];
  if (source?.kind === 'chat') {
    fields(source, ['kind', 'sourceId', 'roomId', 'messageId'], fail);
    if (
      typeof source.sourceId !== 'string' ||
      !/^[a-f0-9-]{36}$/i.test(source.sourceId) ||
      typeof source.roomId !== 'string' ||
      !/^-?\d{1,20}$/.test(source.roomId) ||
      typeof source.messageId !== 'string' ||
      !/^\d{1,20}$/.test(source.messageId)
    )
      throw fail(400, '消息来源标识不正确');
    if (withdrawn(db, source)) throw fail(409, '原消息已撤回');
    entry = (db.entries || []).find(
      (item) =>
        item.chatJournal?.sourceId === source.sourceId &&
        item.chatJournal.roomId === source.roomId &&
        item.chatJournal.messages.some((message) => message.id === source.messageId),
    );
    available(entry, fail);
    const message = entry.chatJournal.messages.find((item) => item.id === source.messageId);
    if (message.withdrawn) throw fail(409, '原消息已撤回');
    unit = db.messageStore?.units.find(
      (item) => item.id === chatUnitId(source.sourceId, source.roomId, source.messageId),
    );
    ids = message.attachments || [];
  } else if (source?.kind === 'unit') {
    fields(source, ['kind', 'unitId', 'revision'], fail);
    if (
      typeof source.unitId !== 'string' ||
      !source.unitId ||
      source.unitId.length > 500 ||
      !Number.isSafeInteger(source.revision) ||
      source.revision < 1
    )
      throw fail(400, '规范消息标识或版本不正确');
    unit = db.messageStore?.units.find((item) => item.id === source.unitId);
    if (!unit) throw fail(404, '规范消息不存在；候选或本地编号不能代替规范身份');
    if (!['diary', 'chat'].includes(unit.origin?.kind)) throw fail(400, '此类消息暂不支持收藏媒体');
    if (unit.revision !== source.revision) throw fail(409, '原消息版本已变化，请重新读取');
    entry = (db.entries || []).find((item) => item.id === unit.origin.entryId);
    available(entry, fail);
  } else throw fail(400, '消息来源须为chat或unit');
  let appearances = [];
  if (unit) {
    checkUnit(db, entry, unit, fail);
    appearances = richMediaReferences(unit.body);
    ids = [...appearances.map((item) => item.assetId), ...(unit.attachments || [])];
  }
  ids = [...new Set(ids)];
  let selected = input.mediaId;
  if (selected !== undefined && (typeof selected !== 'string' || !selected))
    throw fail(400, '请选择有效的图片资源');
  if (input.occurrenceId !== undefined) {
    if (typeof input.occurrenceId !== 'string' || !input.occurrenceId)
      throw fail(400, '图片出现标识不正确');
    const occurrence = appearances.find((item) => item.occurrenceId === input.occurrenceId);
    if (!occurrence || (selected !== undefined && selected !== occurrence.assetId))
      throw fail(400, '图片出现位置与原消息不匹配');
    selected = occurrence.assetId;
  }
  if (selected === undefined) {
    const images = ids.filter((id) =>
      (db.media || []).some((m) => m.id === id && /^image\/(png|jpeg|webp|gif|avif)$/.test(m.type)),
    );
    if (!images.length) throw fail(400, '原消息没有可收藏的图片或GIF');
    if (images.length > 1) throw fail(400, '原消息含多张图片，请指定mediaId或occurrenceId');
    selected = images[0];
  }
  if (!ids.includes(selected)) throw fail(400, '所选图片不属于这条消息');
  const media = stickerMedia(db, selected, fail);
  return {
    source: structuredClone(source),
    media,
    ...(input.occurrenceId ? { occurrenceId: input.occurrenceId } : {}),
  };
}
