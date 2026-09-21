import { getEditorDocument } from '../shared/editor-document.js';

/** Serial autosave queue. UI and network dependencies are injected for independent testing. */
export function createPersistence(c) {
  const { api, sanitize, status, toast } = c;
  const dirty = new Map(),
    versions = new Map();
  let timer,
    saving = 0,
    saveQueue = Promise.resolve();
  function markDirty(e = c.current()) {
    if (!e || e.deleted) return;
    dirty.set(e.id, e);
    versions.set(e.id, (versions.get(e.id) || 0) + 1);
    status('正在保存…');
    clearTimeout(timer);
    timer = setTimeout(() => flush().catch(() => {}), 450);
    c.onDirty();
  }
  async function flush() {
    clearTimeout(timer);
    const task = saveQueue.then(async () => {
      for (const [id, e] of dirty) {
        const version = versions.get(id);
        saving++;
        try {
          const { editorOriginalHtml: _original, history: _history, ...editable } = e;
          // Metadata-only saves must not rewrite legacy HTML. Rendering still sanitizes it.
          const content =
            getEditorDocument(e).format === 'markdown' ? sanitize(e.content) : e.content;
          const saved = await api('/api/entries/' + id, {
            method: 'PUT',
            data: {
              ...editable,
              content,
              markdownHtml: e.markdownHtml === e.content ? content : e.markdownHtml,
            },
          });
          e.revision = saved.revision;
          e.history = saved.history;
          e.updatedAt = saved.updatedAt;
          if (saved.editorOriginalHtml !== undefined)
            e.editorOriginalHtml = saved.editorOriginalHtml;
          if (versions.get(id) === version) dirty.delete(id);
          if (c.current()?.id === id) status(dirty.has(id) ? '正在保存…' : '已保存到本地');
        } catch (err) {
          if (c.current()?.id === id) status('保存失败 · 内容仍在此页', true);
          toast(err.message);
          throw err;
        } finally {
          saving--;
        }
      }
      c.onSaved();
    });
    saveQueue = task.catch(() => {});
    await task;
    if (dirty.size) return flush();
  }
  return {
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
