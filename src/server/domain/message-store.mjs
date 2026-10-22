import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  prepareDiaryUnits,
  reassembleDiaryUnits,
  validateMessageUnit,
} from '../../../public/shared/message-units.js';
import {
  renderRichDocument,
  validateRenderableRichDocument,
} from '../../../public/shared/rich-document-renderer.js';
import { convertLegacyReadingEntry } from './legacy-reading-converter.mjs';
import { fail } from '../http.mjs';
import { isHidden } from '../../../public/shared/entry-state.js';
import { projectDiaryParagraphMessages } from '../../../public/shared/diary-paragraph-messages.js';

const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const bodyKey = (entry) =>
  hash([entry.contentFormat, entry.body, entry.content, entry.markdownSource, entry.attachments]);
const ensure = (db) => (db.messageStore ||= { version: 1, units: [], layouts: {} });
export const messageUnitsEnabled = (options = {}) => options.messageUnitsEnabled === true;

/** Called only inside the library mutation that owns this entry save. No reads migrate data. */
export function commitDiaryUnits(db, entry, previous = null, options = {}) {
  const existing = db.messageStore?.layouts?.[entry.id];
  if (entry.chatJournal || (!existing && !messageUnitsEnabled(options))) return entry;
  if (existing && previous) {
    const canonical = reassembleDiaryUnits(
      db.messageStore.units.filter(
        (unit) =>
          unit.origin?.kind === 'diary' && unit.origin.entryId === entry.id && unit.body !== null,
      ),
      existing.layout,
    );
    if (
      !isDeepStrictEqual(canonical, previous.body) ||
      renderRichDocument(canonical) !== previous.content
    )
      throw fail(409, '正文兼容投影与统一消息不一致，未覆盖');
  }
  if (previous && bodyKey(previous) === bodyKey(entry)) return entry;
  // Legacy HTML/Markdown originals remain untouched until an explicit richdoc edit.
  if (entry.contentFormat !== 'richdoc') {
    if (existing) throw fail(409, '此篇已使用统一消息正文，不能降级覆盖');
    return entry;
  }
  const store = ensure(db);
  const previousUnits = store.units.filter(
    (unit) =>
      unit.origin?.kind === 'diary' && unit.origin.entryId === entry.id && unit.body !== null,
  );
  const tombstones = store.units.filter(
    (unit) =>
      unit.origin?.kind === 'diary' && unit.origin.entryId === entry.id && unit.body === null,
  );
  const prepared = prepareDiaryUnits(entry, {
    previousUnits,
    media: db.media,
    timeZone: db.settings?.preferences?.timeZone || 'Asia/Shanghai',
    createId: randomUUID,
  });
  const restored = reassembleDiaryUnits(prepared.units, prepared.layout);
  if (!isDeepStrictEqual(restored, entry.body))
    throw fail(409, '统一消息重组未完整保留正文，未保存');
  validateRenderableRichDocument(restored);
  const ids = new Set(
    store.units.filter((unit) => unit.origin?.entryId !== entry.id).map((unit) => unit.id),
  );
  for (const unit of prepared.units) {
    validateMessageUnit(unit);
    if (unit.state === 'active') validateRenderableRichDocument(unit.body);
    if (ids.has(unit.id)) throw fail(409, '消息编号重复，未保存');
    ids.add(unit.id);
  }
  // Retain retired identities as body-free tombstones for existing references.
  const currentIds = new Set(prepared.units.map((unit) => unit.id));
  const retired = previousUnits
    .filter((unit) => !currentIds.has(unit.id))
    .map((unit) => ({ ...unit, body: null, state: 'deleted', revision: unit.revision + 1 }));
  store.units = [
    ...store.units.filter(
      (unit) => !(unit.origin?.kind === 'diary' && unit.origin.entryId === entry.id),
    ),
    ...prepared.units,
    ...retired,
    ...tombstones,
  ];
  store.layouts[entry.id] = {
    layout: prepared.layout,
    mappings: prepared.mappings || [],
    issues: prepared.issues,
    revision: entry.revision,
  };
  entry.body = restored;
  entry.content = renderRichDocument(restored);
  entry.messageUnits = {
    version: 1,
    ids: prepared.units.map((unit) => unit.id),
    authority: 'messageStore',
  };
  return entry;
}

/** Global identity includes all three source coordinates; local message numbers are never global IDs. */
export function chatUnitId(sourceId, roomId, messageId) {
  return 'chat:' + hash([sourceId, String(roomId), String(messageId)]);
}

export function commitChatUnit(db, entry, message, html, options = {}) {
  if (
    !messageUnitsEnabled(options) &&
    !db.messageStore?.units.some(
      (unit) => unit.origin.kind === 'chat' && unit.origin.entryId === entry.id,
    )
  )
    return null;
  const journal = entry.chatJournal;
  const id = chatUnitId(journal.sourceId, journal.roomId, message.id);
  const store = ensure(db);
  const existing = store.units.find((unit) => unit.id === id);
  if (existing) return existing;
  const converted = convertLegacyReadingEntry(
    {
      id,
      contentFormat: 'html',
      content: html,
      attachments: message.attachments,
      date: message.sentAt,
      contentEditedAt: message.sentAt,
    },
    { media: db.media },
  );
  if (converted.issues.some((issue) => issue.code !== 'non-image-attachment-body-unsupported'))
    throw fail(400, '聊天正文格式无法完整转换，未保存');
  validateRenderableRichDocument(converted.body);
  const annotateMedia = (node) => {
    if (node.type === 'image' || node.type === 'video') node.attrs.insertedAt = message.sentAt;
    (node.content || []).forEach(annotateMedia);
  };
  converted.body.content.forEach(annotateMedia);
  const unit = {
    id,
    origin: {
      kind: 'chat',
      entryId: entry.id,
      sourceId: journal.sourceId,
      roomId: journal.roomId,
      messageId: message.id,
    },
    body: converted.body,
    eventTime: {
      instant: message.sentAt,
      local: null,
      timeZone: 'UTC',
      precision: 'millisecond',
      source: 'sent',
      sourceField: 'sentAt',
    },
    state: 'active',
    revision: 1,
    replyTo: message.replyTo ? chatUnitId(journal.sourceId, journal.roomId, message.replyTo) : null,
    ...(message.actor ? { actor: structuredClone(message.actor) } : {}),
    sourceSpans: [],
    attachments: [...message.attachments],
    // The legacy text is a compatibility cache, checked before use, never a second edit API.
    compatibilityHash: hash(message),
  };
  validateMessageUnit(unit);
  store.units.push(unit);
  return unit;
}

export function canonicalChatHTML(db, entry, message) {
  const unit = db.messageStore?.units.find(
    (item) =>
      item.id === chatUnitId(entry.chatJournal.sourceId, entry.chatJournal.roomId, message.id),
  );
  if (!unit) return null;
  if (unit.compatibilityHash !== hash(message))
    throw fail(409, '聊天兼容投影与统一消息不一致，未覆盖');
  if (unit.state !== 'active') return '<p>消息已撤回</p>';
  const escape = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
  const files = (unit.attachments || [])
    .map((id) => db.media.find((asset) => asset.id === id))
    .filter((asset) => asset && !/^(image|video)\//.test(asset.type))
    .map(
      (asset) =>
        `<p><a href="/media/${encodeURIComponent(asset.id)}">${escape(asset.name)}</a></p>`,
    )
    .join('');
  return renderRichDocument(unit.body) + files;
}

export function withdrawChatUnit(db, entry, message, expectedRevision) {
  const unit = db.messageStore?.units.find(
    (item) =>
      item.id === chatUnitId(entry.chatJournal.sourceId, entry.chatJournal.roomId, message.id),
  );
  if (!unit) throw fail(409, '旧消息尚未纳入统一消息，原件未改变');
  if (unit.state === 'withdrawn') return unit;
  if (unit.revision !== expectedRevision) throw fail(409, '消息已被另一窗口修改');
  message.text = '';
  message.attachments = [];
  unit.body = null;
  unit.attachments = [];
  unit.state = 'withdrawn';
  unit.revision++;
  unit.compatibilityHash = hash(message);
  validateMessageUnit(unit);
  return unit;
}

export function readMessageUnits(db, { entryId, roomId, sourceId } = {}) {
  const units = [
    ...(db.messageStore?.units || []),
    ...(db.revisit?.comments || []).filter((unit) => unit.origin?.kind === 'comment'),
  ].filter(
    (unit) =>
      (!entryId || unit.origin.entryId === entryId) &&
      (!roomId || unit.origin.roomId === roomId) &&
      (!sourceId || unit.origin.sourceId === sourceId),
  );
  return units.map((unit) => {
    const entry = db.entries.find((item) => item.id === unit.origin.entryId);
    const room = db.chatJournal?.rooms?.find(
      (item) => item.sourceId === unit.origin.sourceId && item.id === unit.origin.roomId,
    );
    return {
      ...structuredClone(unit),
      attributes: {
        entryId: entry?.id ?? null,
        position:
          entry?.messageUnits?.ids?.indexOf(unit.id) ??
          entry?.chatJournal?.messages?.findIndex(
            (message) => message.id === unit.origin.messageId,
          ) ??
          0,
        title: entry?.title ?? null,
        category: entry?.category ?? null,
        tags: [...(entry?.tags || [])],
        deleted: !!entry?.deleted,
        hidden: entry ? isHidden(entry) : false,
        draft: !!entry?.draft,
        roomTitle: room?.title ?? null,
      },
    };
  });
}

/** Read-only candidate for old richdoc entries, never inserted into messageStore. */
export function readDiaryCandidate(db, entry) {
  if (entry.chatJournal) return null;
  let adapted = entry;
  let issues = [];
  if (entry.contentFormat !== 'richdoc') {
    try {
      const converted = convertLegacyReadingEntry(entry, { media: db.media });
      adapted = { ...entry, body: converted.body, contentFormat: 'richdoc' };
      issues = converted.issues;
    } catch {
      return { units: [], layout: null, issues: [{ code: 'legacy-candidate-unavailable' }] };
    }
  }
  const result = prepareDiaryUnits(adapted, {
    media: db.media,
    createId: (() => {
      let index = 0;
      return () => `candidate:${entry.id}:${index++}`;
    })(),
  });
  return {
    ...result,
    paragraphMessages: projectDiaryParagraphMessages(result.units),
    issues: [...issues, ...result.issues],
    readOnly: true,
  };
}
