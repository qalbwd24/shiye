import { compareQuickVersions } from '../shared/quick-capture.js';

/** Existing and quick editors use the same revision protocol; UI is injected. */
export function createEntrySave(c) {
  const creations = new WeakMap();
  function payload(entry) {
    return Object.fromEntries(Object.entries(entry).filter(([key]) => !key.startsWith('_')));
  }
  async function update(local, base, entry) {
    try {
      const saved = await c.api('/api/entries/' + local.id, {
        method: 'PUT',
        data: payload(local),
      });
      return { saved, acknowledged: local };
    } catch (error) {
      if (error.status !== 409) throw error;
    }
    const release = c.freeze();
    try {
      // Include edits made while the original save request was in flight.
      local = structuredClone(entry);
      for (let attempt = 0; attempt < 8; attempt++) {
        const saved = await c.api('/api/entries/' + local.id);
        const comparison = compareQuickVersions({ base, local, saved });
        if (comparison.action === 'adopt-saved') return { saved, acknowledged: local };
        let action = comparison.action === 'save-local' ? 'keep-local' : null;
        let title = local.title;
        if (!action) {
          const choice = await c.chooseConflict(local, saved);
          if (!choice) throw Error('尚未处理内容差异，输入仍保留在窗口中');
          if (choice.action === 'saved') {
            const latest = await c.api('/api/entries/' + saved.id);
            if (latest.revision !== saved.revision) continue;
            return { saved: latest, acknowledged: local };
          }
          ({ action, title } = choice);
        }
        try {
          const resolved = await c.api('/api/entries/' + saved.id + '/resolve', {
            method: 'POST',
            data: {
              action,
              expectedRevision: saved.revision,
              entry: payload({ ...local, title }),
              clientToken: crypto.randomUUID(),
            },
          });
          return { saved: resolved, acknowledged: local };
        } catch (error) {
          if (error.status !== 409) throw error;
          c.toast('另一窗口又更新了内容，请核对最新版本');
        }
      }
      throw Error('另一窗口正在持续修改，请稍后重试；当前内容仍保留');
    } finally {
      release();
    }
  }
  return async function save(local, { base, entry }) {
    if (!entry._unsaved) return update(local, base, entry);
    entry._creationAttempted = true;
    let first = creations.get(entry);
    if (!first) {
      first = payload(local);
      creations.set(entry, first);
    }
    // Keep the first request immutable until its outcome is known: safe retry after lost response.
    const saved = await c.api('/api/quick-entries', {
      method: 'POST',
      data: { clientToken: entry._captureToken, entry: first },
    });
    return { saved, acknowledged: first };
  };
}
