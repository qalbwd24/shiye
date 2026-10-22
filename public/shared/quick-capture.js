import { getEditorDocument } from './editor-document.js';

/** Entry policy only. No DOM, requests, storage or automatic deletion. */
export function hasQuickContent(entry) {
  if (!entry) return false;
  if (String(entry.title || '').trim() || entry.attachments?.length) return true;
  const { format, source, body } = getEditorDocument(entry);
  if (format === 'richdoc') {
    const meaningful = (node) =>
      ['image', 'video'].includes(node.type) ||
      (node.type === 'text' && !!node.text.replace(/[\u200b\ufeff]/g, '').trim()) ||
      (node.content || []).some(meaningful);
    return body.content.some(meaningful);
  }
  if (format === 'markdown') return !!source.trim();
  // Legacy HTML may contain inline media without a populated attachment list.
  if (/<(?:img|video|audio|iframe|object|embed)\b/i.test(source)) return true;
  return !!source
    .replace(/<!--[^]*?-->/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:nbsp|ensp|emsp|thinsp|ZeroWidthSpace);/gi, ' ')
    .replace(/&#(?:x([a-f0-9]+)|(\d+));/gi, (match, hex, decimal) => {
      const code = Number.parseInt(hex || decimal, hex ? 16 : 10);
      return code <= 0x10ffff ? String.fromCodePoint(code) : match;
    })
    .replace(/[\u200b\ufeff]/g, '')
    .trim();
}

/** Persist IDs only; chronology means successful quick edits, never diary dates. */
export function rememberQuickEntry(history, entry) {
  const ids = [...new Set((Array.isArray(history) ? history : []).filter(isId))];
  if (!isId(entry?.id) || entry.deleted || !hasQuickContent(entry)) return ids;
  return [entry.id, ...ids.filter((id) => id !== entry.id)];
}

function isId(value) {
  return typeof value === 'string' && value.length > 0;
}

export function previousQuickEntry(history, entries, currentId = null) {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const ids = Array.isArray(history) ? history : [];
  const start = currentId ? ids.indexOf(currentId) + 1 : 0;
  for (const id of ids.slice(start)) {
    const entry = byId.get(id);
    if (id !== currentId && entry && !entry.deleted && hasQuickContent(entry)) return entry;
  }
  return null;
}

/** Walk toward newer successful quick edits, without treating an unknown draft as history. */
export function nextQuickEntry(history, entries, currentId) {
  const ids = Array.isArray(history) ? history : [];
  const position = ids.indexOf(currentId);
  if (position <= 0) return null;
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  for (let index = position - 1; index >= 0; index--) {
    const entry = byId.get(ids[index]);
    if (entry && !entry.deleted && hasQuickContent(entry)) return entry;
  }
  return null;
}

/** Canonical editable state; renderer projections, comments and revision metadata are separate. */
export function quickEditableState(entry) {
  const document = getEditorDocument(entry);
  return {
    title: entry.title || '',
    document,
    date: entry.date || '',
    category: entry.category || '',
    tags: [...new Set(entry.tags || [])].sort(),
    attachments: [...(entry.attachments || [])],
    mood: entry.mood || '',
    weather: entry.weather || '',
    location: entry.location || '',
    hidden: !!(entry.hidden ?? entry.legacy?.isHidden),
    draft: !!entry.draft,
    pinned: !!entry.pinned,
    deleted: !!entry.deleted,
    cover: entry.cover || null,
    demo: !!entry.demo,
  };
}

function equalContent(a, b) {
  return JSON.stringify(quickEditableState(a)) === JSON.stringify(quickEditableState(b));
}

function exactVersion(a, b) {
  return (
    a?.id === b?.id &&
    Number.isInteger(a?.revision) &&
    a.revision >= 1 &&
    a.revision === b?.revision &&
    equalContent(a, b)
  );
}

/**
 * base is the last acknowledged server snapshot; saved and saved.history must be freshly fetched.
 * Outcomes are advice, never writes. All writes still require saved.revision at the server.
 */
export function compareQuickVersions({ base, local, saved }) {
  if (!local || !saved || !local.id || local.id !== saved.id)
    return { action: 'conflict', reason: 'missing-or-different-entry' };
  if (equalContent(local, saved)) return { action: 'adopt-saved', reason: 'identical' };
  if (!base || base.id !== saved.id) return { action: 'conflict', reason: 'missing-base' };
  const proven =
    exactVersion(base, saved) ||
    (Number.isInteger(saved.revision) &&
      saved.revision > base.revision &&
      (saved.history || []).some((snapshot) => exactVersion(base, snapshot)));
  if (!proven) return { action: 'conflict', reason: 'unproven-history' };
  if (equalContent(base, local)) return { action: 'adopt-saved', reason: 'saved-descendant' };
  if (equalContent(base, saved)) return { action: 'save-local', reason: 'only-local-changed' };
  return { action: 'conflict', reason: 'both-changed' };
}
