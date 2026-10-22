import { createHash } from 'node:crypto';
import { validateMessageUnit, reassembleDiaryUnits } from '../../../public/shared/message-units.js';
import {
  validateRenderableRichDocument,
  renderRichDocument,
} from '../../../public/shared/rich-document-renderer.js';
import { richMediaReferences } from '../../../public/shared/rich-document.js';
import { rebuildChatProjection, scrubChatMessageHistory } from './chat-journal.mjs';
import { fail } from '../http.mjs';

const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const same = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
const tombstone = (unit) =>
  unit.state === 'withdrawn' || (unit.state === 'deleted' && unit.body === null);
const withdrawalKey = (record) =>
  JSON.stringify([record.sourceId, record.roomId, record.messageId]);

function withdrawalRecords(library) {
  const records = library.chatJournal?.withdrawals;
  if (records === undefined) return [];
  if (!Array.isArray(records)) throw fail(400, '备份撤回记录结构错误');
  return records.map((record) => {
    if (
      !record ||
      typeof record.sourceId !== 'string' ||
      !/^[a-f0-9-]{36}$/i.test(record.sourceId) ||
      typeof record.roomId !== 'string' ||
      !/^-?\d{1,20}$/.test(record.roomId) ||
      typeof record.messageId !== 'string' ||
      !/^\d{1,20}$/.test(record.messageId) ||
      !Number.isFinite(Date.parse(record.sentAt)) ||
      !Number.isFinite(Date.parse(record.requestedAt)) ||
      (record.operationId !== undefined &&
        (typeof record.operationId !== 'string' || !/^[a-f0-9-]{36}$/i.test(record.operationId)))
    )
      throw fail(400, '备份撤回身份或时间无效');
    // Only identity and clock metadata may survive a withdrawal archive.
    return {
      sourceId: record.sourceId,
      roomId: record.roomId,
      messageId: record.messageId,
      ...(record.operationId !== undefined ? { operationId: record.operationId } : {}),
      sentAt: record.sentAt,
      requestedAt: record.requestedAt,
    };
  });
}

function mergeWithdrawalRecords(db, library) {
  const records = withdrawalRecords(library);
  if (!records.length) return;
  db.chatJournal ||= { version: 1, rooms: [] };
  db.chatJournal.withdrawals ||= [];
  const seen = new Set(db.chatJournal.withdrawals.map(withdrawalKey));
  const operations = new Map(
    db.chatJournal.withdrawals
      .filter((record) => record.operationId)
      .map((record) => [record.operationId, withdrawalKey(record)]),
  );
  for (const record of records) {
    const target = withdrawalKey(record);
    if (record.operationId) {
      const previous = operations.get(record.operationId);
      if (previous && previous !== target) throw fail(409, '备份撤回操作编号指向不同消息');
      operations.set(record.operationId, target);
    }
    if (!seen.has(withdrawalKey(record))) {
      db.chatJournal.withdrawals.push(record);
      seen.add(withdrawalKey(record));
    }
  }
}

function applyWithdrawalRecords(db) {
  const keys = new Set((db.chatJournal?.withdrawals || []).map(withdrawalKey));
  const affected = [];
  for (const entry of db.entries) {
    const journal = entry.chatJournal;
    if (!journal) continue;
    let changed = false;
    for (const message of journal.messages || []) {
      if (
        !keys.has(
          withdrawalKey({
            sourceId: journal.sourceId,
            roomId: journal.roomId,
            messageId: message.id,
          }),
        )
      )
        continue;
      message.text = '';
      message.attachments = [];
      message.withdrawn = true;
      const unit = db.messageStore?.units.find(
        (item) =>
          item.origin.kind === 'chat' &&
          item.origin.sourceId === journal.sourceId &&
          item.origin.roomId === journal.roomId &&
          item.origin.messageId === message.id,
      );
      if (unit) {
        if (unit.state !== 'withdrawn') unit.revision++;
        unit.state = 'withdrawn';
        unit.body = null;
        unit.attachments = [];
        unit.compatibilityHash = hash(message);
      }
      scrubChatMessageHistory(entry, message.id, db);
      changed = true;
    }
    if (changed) affected.push(entry);
  }
  return affected;
}

function archive(library) {
  const store = library.messageStore;
  if (store === undefined) {
    if (
      library.entries.some(
        (entry) =>
          entry.messageUnits?.ids?.length ||
          entry.comments?.some((comment) => comment.messageUnitId),
      )
    )
      throw fail(400, '备份缺少统一消息主体');
    return null;
  }
  if (
    store?.version !== 1 ||
    !Array.isArray(store.units) ||
    !store.layouts ||
    typeof store.layouts !== 'object' ||
    Array.isArray(store.layouts)
  )
    throw fail(400, '备份统一消息结构错误');
  if (new Set(library.entries.map((entry) => entry.id)).size !== library.entries.length)
    throw fail(400, '备份含重复日记身份');
  const seen = new Set();
  for (const unit of store.units) {
    try {
      validateMessageUnit(unit);
      if (unit.body) validateRenderableRichDocument(unit.body);
    } catch {
      throw fail(400, '备份统一消息正文或身份无效');
    }
    if (seen.has(unit.id)) throw fail(400, '备份含重复统一消息身份');
    seen.add(unit.id);
    if (!library.entries.some((entry) => entry.id === unit.origin.entryId))
      throw fail(400, '备份统一消息缺少归属日记');
  }
  for (const entry of library.entries) {
    if (entry.messageUnits?.ids?.length && !store.layouts[entry.id])
      throw fail(400, '备份日记缺少消息顺序清单');
    for (const id of entry.messageUnits?.ids || [])
      if (!seen.has(id)) throw fail(400, '备份日记引用缺少统一消息');
    for (const comment of entry.comments || [])
      if (comment.messageUnitId && !seen.has(comment.messageUnitId))
        throw fail(400, '备份评论引用缺少统一消息');
  }
  for (const unit of store.units)
    if (unit.origin.kind === 'chat') {
      const entry = library.entries.find((item) => item.id === unit.origin.entryId);
      const message = entry.chatJournal?.messages?.find(
        (item) => item.id === unit.origin.messageId,
      );
      if (!message || unit.compatibilityHash !== hash(message))
        throw fail(400, '备份聊天兼容索引校验失败');
      if (tombstone(unit) && (message.text || message.attachments.length))
        throw fail(400, '备份撤回消息仍含原文');
    }
  for (const [entryId, saved] of Object.entries(store.layouts)) {
    const entry = library.entries.find((item) => item.id === entryId);
    try {
      const restored = reassembleDiaryUnits(
        store.units.filter(
          (unit) => unit.origin.kind === 'diary' && unit.origin.entryId === entryId,
        ),
        saved.layout,
      );
      if (!entry || !same(restored, entry.body) || renderRichDocument(restored) !== entry.content)
        throw Error('cache');
    } catch {
      throw fail(400, '备份消息顺序或日记兼容投影校验失败');
    }
  }
  return store;
}

/** Existing global identities select their current owner before ordinary Entry deduplication. */
export function preserveMessageArchiveOwners(db, library, preparedEntries) {
  withdrawalRecords(library);
  const incoming = archive(library);
  if (!incoming)
    return preparedEntries.map((prepared, index) => {
      const source = library.entries[index];
      const retiredOwners = new Set(
        (db.messageStore?.units || []).filter(tombstone).map((unit) => unit.origin.entryId),
      );
      for (const entry of db.entries)
        if (entry.chatJournal?.messages?.some((message) => message.withdrawn))
          retiredOwners.add(entry.id);
      const current = db.entries.find(
        (entry) =>
          retiredOwners.has(entry.id) &&
          (entry.id === source.id ||
            entry.restoredFrom?.id === source.id ||
            (entry.chatJournal?.sourceId &&
              entry.chatJournal.sourceId === source.chatJournal?.sourceId &&
              entry.chatJournal.roomId === source.chatJournal.roomId &&
              same(
                entry.chatJournal.messages.map((message) => message.id).sort(),
                source.chatJournal.messages.map((message) => message.id).sort(),
              ))),
      );
      return current
        ? { ...structuredClone(current), id: prepared.id, restoredFrom: { id: current.id } }
        : prepared;
    });
  const existing = new Map((db.messageStore?.units || []).map((unit) => [unit.id, unit]));
  return preparedEntries.map((prepared, index) => {
    const source = library.entries[index];
    const owners = new Set(
      incoming.units
        .filter((unit) => unit.origin.entryId === source.id && existing.has(unit.id))
        .map((unit) => existing.get(unit.id).origin.entryId),
    );
    if (owners.size > 1) throw fail(409, '统一消息身份指向不同归属，未恢复');
    if (!owners.size) return prepared;
    const current = db.entries.find((entry) => entry.id === [...owners][0]);
    if (!current) throw fail(409, '现有统一消息缺少归属日记，未恢复');
    return { ...structuredClone(current), id: prepared.id, restoredFrom: { id: current.id } };
  });
}

function remapReferences(value, entryMap, mediaMap) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (key === 'entryId' && typeof child === 'string') {
      if (!entryMap.has(child)) throw fail(400, '统一消息引用缺失归属日记');
      value[key] = entryMap.get(child);
    } else if (key === 'assetId' && typeof child === 'string') {
      if (!mediaMap.has(child)) throw fail(400, '统一消息引用缺失媒体原件');
      value[key] = mediaMap.get(child);
    } else if (key === 'attachments' && Array.isArray(child))
      value[key] = child.map((id) => {
        if (!mediaMap.has(id)) throw fail(400, '统一消息附件缺失');
        return mediaMap.get(id);
      });
    else remapReferences(child, entryMap, mediaMap);
  }
}

function remapEntryTargets(value, entryMap) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (key === 'entryId' && typeof child === 'string') {
      if (!entryMap.has(child)) throw fail(400, '备份评论目标缺少归属');
      value[key] = entryMap.get(child);
    } else remapEntryTargets(child, entryMap);
  }
}

/** Must share the same library-store.mutate transaction as Entry/media reconciliation. */
export function reconcileMessageArchive(db, library, { entryMap, mediaMap }) {
  const incoming = archive(library);
  mergeWithdrawalRecords(db, library);
  const retiredEntries = applyWithdrawalRecords(db);
  if (!incoming) {
    for (const entry of retiredEntries) rebuildChatProjection(entry, db);
    return { messages: 0, mergedMessages: 0 };
  }
  const withdrawn = new Set((db.chatJournal?.withdrawals || []).map(withdrawalKey));
  db.messageStore ||= { version: 1, units: [], layouts: {} };
  const store = db.messageStore,
    byId = new Map(store.units.map((unit) => [unit.id, unit]));
  const currentEntryIds = new Set(store.units.map((unit) => unit.origin.entryId));
  const report = { messages: 0, mergedMessages: 0 };
  const incomingLayouts = new Map();
  for (const [sourceId, saved] of Object.entries(incoming.layouts)) {
    const entryId = entryMap.get(sourceId);
    if (!entryId || saved.layout?.entryId !== sourceId) throw fail(400, '备份消息顺序清单归属无效');
    const mapped = structuredClone(saved);
    remapReferences(mapped, entryMap, mediaMap);
    incomingLayouts.set(entryId, mapped);
  }
  for (const source of incoming.units) {
    const unit = structuredClone(source);
    remapReferences(unit, entryMap, mediaMap);
    const entry = db.entries.find((item) => item.id === unit.origin.entryId);
    if (!entry) throw fail(400, '统一消息恢复后归属不存在');
    for (const ref of unit.body ? richMediaReferences(unit.body) : []) {
      const media = db.media.find((asset) => asset.id === ref.assetId);
      if (!media || !String(media.type).startsWith(ref.type + '/'))
        throw fail(400, '统一消息媒体类型或原件无效');
    }
    if (unit.origin.kind === 'chat') {
      const message = entry.chatJournal?.messages.find((item) => item.id === unit.origin.messageId);
      if (!message) throw fail(400, '统一聊天消息缺少兼容索引');
      if (withdrawn.has(withdrawalKey(unit.origin))) {
        unit.body = null;
        unit.attachments = [];
        unit.state = 'withdrawn';
      }
      unit.compatibilityHash = hash(message);
    }
    const old = byId.get(unit.id);
    if (old) {
      if (!same(old.origin, unit.origin)) throw fail(409, '统一消息全局编号归属冲突，未覆盖');
      if (tombstone(old)) {
        report.mergedMessages++;
        continue;
      }
      if (!tombstone(unit)) {
        const left = { ...old },
          right = { ...unit };
        delete left.revision;
        delete right.revision;
        delete left.updatedAt;
        delete right.updatedAt;
        if (!same(left, right)) throw fail(409, '统一消息全局编号内容冲突，未覆盖');
        old.revision = Math.max(old.revision, unit.revision);
        report.mergedMessages++;
        continue;
      }
      store.units[store.units.indexOf(old)] = unit;
    } else {
      store.units.push(unit);
      report.messages++;
    }
    byId.set(unit.id, unit);
  }
  const affected = new Set(incoming.units.map((unit) => entryMap.get(unit.origin.entryId)));
  for (const entryId of affected) {
    const entry = db.entries.find((item) => item.id === entryId);
    const units = store.units.filter((unit) => unit.origin.entryId === entryId);
    if (!currentEntryIds.has(entryId)) {
      // Media were remapped by the restore path; current and historical target IDs also need mapping.
      remapEntryTargets(entry, entryMap);
    }
    const layouts = [store.layouts[entryId], incomingLayouts.get(entryId)].filter(Boolean);
    if (layouts.length) {
      let restored = null;
      for (const saved of layouts) {
        try {
          restored = reassembleDiaryUnits(
            units.filter((unit) => unit.origin.kind === 'diary'),
            saved.layout,
          );
          validateRenderableRichDocument(restored);
          store.layouts[entryId] = saved;
          break;
        } catch {
          restored = null;
        }
      }
      if (!restored) throw fail(409, '备份消息顺序与保留的墓碑冲突，未恢复');
      entry.body = restored;
      entry.content = renderRichDocument(restored);
      entry.contentFormat = 'richdoc';
      entry.messageUnits = {
        version: 1,
        ids: units
          .filter((unit) => unit.origin.kind === 'diary' && unit.body !== null)
          .map((unit) => unit.id),
        authority: 'messageStore',
      };
    }
    for (const unit of units) {
      if (unit.origin.kind === 'chat' && tombstone(unit)) {
        const message = entry.chatJournal?.messages.find(
          (item) => item.id === unit.origin.messageId,
        );
        if (message) {
          message.text = '';
          message.attachments = [];
          unit.compatibilityHash = hash(message);
        }
        scrubChatMessageHistory(entry, unit.origin.messageId, db);
      }
      if (unit.origin.kind === 'comment') {
        const comment = entry.comments?.find((item) => item.id === unit.origin.commentId);
        if (!comment) throw fail(400, '统一评论缺少兼容索引');
        comment.commentOn = structuredClone(unit.commentOn);
        comment.messageUnitId = unit.id;
        comment.revision = unit.revision;
        if (tombstone(unit)) comment.deleted = true;
      }
    }
    if (entry.chatJournal) rebuildChatProjection(entry, db);
  }
  for (const unit of store.units) {
    const refs = [
      typeof unit.replyTo === 'string' ? unit.replyTo : unit.replyTo?.unitId,
      ...(unit.commentOn || []).map((target) => target.unitId),
    ].filter(Boolean);
    // A chat reply may precede delivery of its target; comments must always resolve.
    if (unit.origin.kind === 'comment' && refs.some((id) => !byId.has(id)))
      throw fail(400, '备份评论或回复目标缺失');
  }
  for (const entry of retiredEntries) rebuildChatProjection(entry, db);
  return report;
}
