import { createHash } from 'node:crypto';
import { sharedMessageEditHeadSha256 } from '../../../public/shared/shared-message-edit-protocol.js';

const rawSha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const key = (s, r, id) => JSON.stringify([s, r, id]);
const self = (actor) => !actor || (actor.kind === 'self' && actor.id === 'self');
const visible = (entry) =>
  entry &&
  !entry.deleted &&
  !entry.hidden &&
  !entry.draft &&
  !entry.withdrawn &&
  entry.state !== 'withdrawn';

/** One entry/message/unit pass, then O(roots). Never re-scan all entries per ledger root. */
export function createMessageEditProjection(db) {
  const messages = new Map(),
    units = new Map(),
    children = new Map(),
    roots = new Map(),
    entryVisible = new Map();
  const withdrawals = new Set(
    (db.chatJournal?.withdrawals || []).map((w) => key(w.sourceId, w.roomId, w.messageId)),
  );
  for (const unit of db.messageStore?.units || []) {
    if (unit.origin?.kind !== 'chat') continue;
    const o = unit.origin,
      id = key(o.sourceId, o.roomId, o.messageId);
    units.set(id, units.has(id) ? null : unit);
  }
  for (const record of db._messageEdits?.roots || [])
    roots.set(key(record.sourceId, record.roomId, record.rootMessageId), record);
  for (const entry of db.entries || []) {
    const journal = entry.chatJournal;
    if (!journal) continue;
    entryVisible.set(
      entry,
      visible(entry) &&
        rawSha([entry.title, entry.content, entry.category, entry.attachments]) ===
          journal.projectionHash,
    );
    for (const message of journal.messages) {
      const id = key(journal.sourceId, journal.roomId, message.id);
      const unit = units.get(id);
      const item = {
        id,
        entry,
        message,
        unit,
        compatible:
          self(message.actor) &&
          (!units.has(id) ||
            (unit &&
              self(unit.actor) &&
              unit.origin.entryId === entry.id &&
              unit.compatibilityHash === rawSha(message))),
      };
      messages.set(id, messages.has(id) ? null : item);
      if (message.replacementOf) {
        const parent = key(journal.sourceId, journal.roomId, message.replacementOf);
        children.set(parent, (children.get(parent) || 0) + 1);
      }
    }
  }
  const chainCache = new Map();
  function chain(item) {
    if (!item) return null;
    if (chainCache.has(item.id)) return chainCache.get(item.id);
    const path = [],
      seen = new Set();
    let cursor = item,
      result = null;
    while (cursor && !chainCache.has(cursor.id)) {
      if (seen.has(cursor.id) || !cursor.compatible) {
        cursor = null;
        break;
      }
      seen.add(cursor.id);
      path.push(cursor);
      if (!cursor.message.replacementOf) {
        result = cursor.message.replacementRootId ? null : cursor;
        chainCache.set(cursor.id, result);
        break;
      }
      cursor = messages.get(
        key(
          cursor.entry.chatJournal.sourceId,
          cursor.entry.chatJournal.roomId,
          cursor.message.replacementOf,
        ),
      );
    }
    if (cursor && chainCache.has(cursor.id)) result = chainCache.get(cursor.id);
    for (const child of path.reverse()) {
      if (!child.message.replacementOf) {
        chainCache.set(child.id, result);
        continue;
      }
      const parentId = key(
        child.entry.chatJournal.sourceId,
        child.entry.chatJournal.roomId,
        child.message.replacementOf,
      );
      const parent = messages.get(parentId);
      if (
        !result ||
        !parent ||
        !parent.message.withdrawn ||
        !(withdrawals.has(parentId) || parent.unit?.state === 'withdrawn') ||
        children.get(parentId) !== 1 ||
        child.entry !== result.entry ||
        child.message.sentAt !== result.message.sentAt ||
        (child.message.replacementRootId && child.message.replacementRootId !== result.message.id)
      )
        result = null;
      chainCache.set(child.id, result);
    }
    return chainCache.get(item.id) ?? null;
  }
  function actual(item, editOperationId = null) {
    if (
      !item ||
      !entryVisible.get(item.entry) ||
      !chain(item) ||
      item.message.withdrawn ||
      (item.unit && item.unit.state !== 'active') ||
      children.has(item.id)
    )
      return null;
    return {
      headMessageId: item.message.id,
      headRevision: item.unit?.revision ?? null,
      headSha256: sharedMessageEditHeadSha256(item.message, item.unit?.revision ?? null),
      editOperationId,
    };
  }
  const known = new Map();
  for (const record of db._messageEdits?.roots || []) {
    const item = messages.get(key(record.sourceId, record.roomId, record.head.headMessageId));
    const value = actual(item, record.head.editOperationId);
    known.set(
      record.rootKey,
      record.state === 'active' &&
        value &&
        ['headMessageId', 'headRevision', 'headSha256', 'editOperationId'].every(
          (field) => value[field] === record.head[field],
        )
        ? value
        : null,
    );
  }
  return {
    entry(entry) {
      if (!entryVisible.get(entry)) return entry;
      let changed = false;
      const annotated = entry.chatJournal.messages.map((message) => {
        const journal = entry.chatJournal,
          item = messages.get(key(journal.sourceId, journal.roomId, message.id));
        const root = chain(item);
        if (!root || message.withdrawn || (item?.unit && item.unit.state !== 'active'))
          return message;
        const record = roots.get(key(journal.sourceId, journal.roomId, root.message.id));
        const base = record ? known.get(record.rootKey) : actual(item);
        changed = true;
        return {
          ...message,
          editBase:
            base && base.headMessageId === message.id ? { ...base } : { state: 'unknown-stale' },
        };
      });
      return changed
        ? { ...entry, chatJournal: { ...entry.chatJournal, messages: annotated } }
        : entry;
    },
    heads() {
      return (db._messageEdits?.roots || []).map((record) => {
        const root = messages.get(key(record.sourceId, record.roomId, record.rootMessageId));
        if (record.state === 'withdrawn')
          return { entityId: record.rootKey, state: 'withdrawn', data: {} };
        if (!root || !visible(root.entry))
          return { entityId: record.rootKey, state: 'deleted', data: {} };
        const base = known.get(record.rootKey);
        return {
          entityId: record.rootKey,
          state: 'active',
          data: {
            version: 1,
            readOnlyProjection: true,
            sourceId: record.sourceId,
            roomId: record.roomId,
            rootMessageId: record.rootMessageId,
            state: base ? 'active' : 'unknown-stale',
            headVersion: record.version,
            base: base ?? null,
            editedAt: base ? record.head.editedAt : null,
            stamp: base ? record.head.stamp : null,
          },
        };
      });
    },
  };
}
