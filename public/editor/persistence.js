import { getEditorDocument } from '../shared/editor-document.js';
import { hasQuickContent, quickEditableState } from '../shared/quick-capture.js';

/** One serial autosave queue shared by both window types, including lazy new documents. */
export function createPersistence(c) {
  const { api, sanitize, status, toast } = c;
  const dirty = new Set(),
    bases = new WeakMap(),
    initial = new WeakMap();
  let timer,
    saving = 0,
    queue = Promise.resolve();
  const same = (a, b) =>
    JSON.stringify(quickEditableState(a)) === JSON.stringify(quickEditableState(b));
  function observe(entry) {
    if (!entry || bases.has(entry)) return;
    bases.set(entry, structuredClone(entry));
    if (entry._unsaved) initial.set(entry, structuredClone(entry));
  }
  function markDirty(entry = c.current()) {
    if (!entry || entry.deleted) return;
    dirty.add(entry);
    status('正在保存…');
    clearTimeout(timer);
    timer = setTimeout(() => flush().catch(() => {}), 450);
    c.onDirty();
  }
  async function flush() {
    clearTimeout(timer);
    const task = queue.then(async () => {
      for (const entry of dirty) {
        if (
          entry._unsaved &&
          !entry._creationAttempted &&
          (!hasQuickContent(entry) || (initial.has(entry) && same(entry, initial.get(entry))))
        ) {
          dirty.delete(entry);
          if (c.current() === entry) status('尚未输入 · 空白不会保存');
          continue;
        }
        saving++;
        try {
          // Pull a final CodeMirror snapshot before serializing. This is a
          // no-op when the normal update listener already committed it.
          c.syncEditor?.(entry, { markDirty: false });
          const {
            editorOriginalHtml: _original,
            history: _history,
            ...snapshot
          } = structuredClone(entry);
          const content =
            getEditorDocument(entry).format === 'markdown'
              ? sanitize(entry.content)
              : entry.content;
          snapshot.content = content;
          if (entry.markdownHtml === entry.content) snapshot.markdownHtml = content;
          const result = c.saveEntry
            ? await c.saveEntry(snapshot, { base: bases.get(entry), entry })
            : {
                saved: await api('/api/entries/' + entry.id, { method: 'PUT', data: snapshot }),
                acknowledged: snapshot,
              };
          const { saved, acknowledged } = result;
          const unchanged = same(entry, acknowledged);
          const oldId = entry.id;
          if (unchanged) Object.assign(entry, saved);
          else {
            for (const key of [
              'id',
              'revision',
              'history',
              'updatedAt',
              'contentEditedAt',
              'createdAt',
              'editorOriginalHtml',
            ])
              if (saved[key] !== undefined) entry[key] = saved[key];
          }
          entry._unsaved = false;
          bases.set(entry, structuredClone(saved));
          if (unchanged) dirty.delete(entry);
          if (oldId !== entry.id) await c.onIdentity?.(entry, oldId);
          await c.onEntrySaved?.(entry, saved);
          if (c.current() === entry) status(dirty.has(entry) ? '正在保存…' : '已保存到本地');
        } catch (error) {
          if (c.current() === entry) status('保存失败 · 内容仍在此页', true);
          toast(error.message);
          throw error;
        } finally {
          saving--;
        }
      }
      c.onSaved();
    });
    queue = task.catch(() => {});
    await task;
    if (dirty.size) return flush();
  }
  return {
    observe,
    markDirty,
    flush,
    pause() {
      clearTimeout(timer);
    },
    get pending() {
      return dirty.size > 0 || saving > 0;
    },
  };
}
