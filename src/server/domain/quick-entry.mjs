import { createHash, randomUUID } from 'node:crypto';
import { fail } from '../http.mjs';
import { validateEntry } from './entries.mjs';
import { LIMITS } from '../../../public/shared/limits.js';
import { hasQuickContent, quickEditableState } from '../../../public/shared/quick-capture.js';
import { commitDiaryUnits } from './message-store.mjs';

// Invoked only inside library-store.mutate. Never trust client IDs/history/provenance.
function token(value) {
  if (
    typeof value !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)
  )
    throw fail(400, '快捷记录请求标记须为 UUID');
  return value.toLowerCase();
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function fingerprint(entry) {
  return digest({
    ...quickEditableState(entry),
    editorOriginalHtml: entry.editorOriginalHtml ?? null,
  });
}

function replay(db, key, requestHash) {
  const saved = db.quickEntryTokens?.[key];
  if (!saved) return null;
  if (saved.requestHash !== requestHash)
    throw Object.assign(fail(409, '同一请求标记已保存其他内容，请先核对已保存的日记。'), {
      existingEntryId: saved.entryId,
    });
  const entry = db.entries.find((e) => e.id === saved.entryId);
  if (!entry || fingerprint(entry) !== saved.entryHash)
    throw Object.assign(fail(409, '这次记录已创建，但之后又有修改，请先读取已保存内容。'), {
      existingEntryId: saved.entryId,
    });
  return { entry, created: false };
}

function remember(db, key, requestHash, entry, kind) {
  db.quickEntryTokens ||= {};
  db.quickEntryTokens[key] = {
    entryId: entry.id,
    requestHash,
    entryHash: fingerprint(entry),
    kind,
  };
}

function insert(db, value, extra = {}, options = {}) {
  const now = new Date().toISOString();
  const entry = {
    ...value,
    ...extra,
    id: randomUUID(),
    revision: 1,
    createdAt: now,
    updatedAt: now,
    contentEditedAt: now,
    history: [],
  };
  commitDiaryUnits(db, entry, null, options);
  db.entries.unshift(entry);
  if (!db.categories.includes(entry.category)) db.categories.push(entry.category);
  return entry;
}

export function replaceEntry(db, old, value, options = {}) {
  const previous = { ...old };
  delete previous.history;
  const entry = {
    ...old,
    ...value,
    revision: old.revision + 1,
    updatedAt: new Date().toISOString(),
    history: [previous, ...(old.history || [])].slice(0, LIMITS.historyEntries),
  };
  commitDiaryUnits(db, entry, old, options);
  db.entries[db.entries.findIndex((e) => e.id === old.id)] = entry;
  if (!db.categories.includes(entry.category)) db.categories.push(entry.category);
  return entry;
}

export function createQuickEntry(db, input, options = {}) {
  const key = token(input?.clientToken);
  const value = validateEntry(input.entry, db);
  const requestHash = digest({ kind: 'create', entry: fingerprint(value) });
  const existing = replay(db, key, requestHash);
  if (existing) return existing;
  if (!hasQuickContent(value)) throw fail(400, '请先输入内容或添加附件，空白日记无需保存');
  const entry = insert(db, value, {}, options);
  remember(db, key, requestHash, entry, 'create');
  return { entry, created: true };
}

export function resolveQuickEntry(db, id, input, options = {}) {
  if (!input || !['keep-local', 'keep-both'].includes(input.action))
    throw fail(400, '请选择使用本窗口内容或两份都保留');
  const old = db.entries.find((e) => e.id === id);
  if (!old) throw fail(404, '日记不存在');
  const value = validateEntry(input.entry, db, old);
  const key = input.action === 'keep-both' ? token(input.clientToken) : null;
  const requestHash = key
    ? digest({
        kind: 'keep-both',
        sourceEntryId: id,
        expectedRevision: input.expectedRevision,
        entry: fingerprint(value),
      })
    : null;
  if (key) {
    const existing = replay(db, key, requestHash);
    if (existing) return existing;
  }
  if (old.revision !== input.expectedRevision)
    throw fail(409, '选择期间日记又有更新，请重新核对两边内容');
  if (JSON.stringify(quickEditableState(old)) === JSON.stringify(quickEditableState(value))) {
    if (key) remember(db, key, requestHash, old, 'resolve-identical');
    return { entry: old, created: false };
  }
  if (input.action === 'keep-local')
    return { entry: replaceEntry(db, old, value, options), created: false };
  const entry = insert(db, value, { sourceEntryId: old.id }, options);
  remember(db, key, requestHash, entry, 'keep-both');
  return { entry, created: true };
}

export function discardEmptyQuickEntry(db, id, input) {
  const key = token(input?.clientToken);
  const registration = db.quickEntryTokens?.[key];
  if (!registration || registration.kind !== 'create' || registration.entryId !== id)
    throw fail(403, '只能清理本次快捷窗口新建的空白日记');
  const entry = db.entries.find((e) => e.id === id);
  if (!entry) throw fail(404, '日记不存在');
  if (entry.revision !== input.expectedRevision)
    throw fail(409, '日记已被其他窗口修改，未清理任何内容');
  if (hasQuickContent(entry) || entry.comments?.some((c) => !c.deleted))
    throw fail(409, '这篇日记仍有内容或评论，不能作为空白日记清理');
  if (entry.deleted) return entry;
  return replaceEntry(db, entry, { deleted: true });
}
