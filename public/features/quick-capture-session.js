import {
  hasQuickContent,
  nextQuickEntry,
  previousQuickEntry,
  rememberQuickEntry,
} from '../shared/quick-capture.js';

/**
 * Window workflow adapter, deliberately independent of the editor/save queue.
 * flush must finish IME composition and reject on failure or unresolved conflict.
 * mountNew prepares an in-memory document only; the shared persistence adapter owns lazy creation.
 * freeze prevents user edits during flush/navigation and must restore interaction on rejection.
 */
export function createQuickCaptureSession(c) {
  let busy = false;
  let lastError = null;
  let historyQueue = Promise.resolve();
  let categoryPending = false;
  let pendingTransition = null;

  async function findPrevious(latest = false) {
    // getAccessibleEntries also refreshes history; use both current values afterwards.
    const entries = await c.getAccessibleEntries();
    return previousQuickEntry(c.getHistory(), entries, latest ? null : c.current()?.id);
  }

  async function openPrevious(latest = false, skipCurrent = false) {
    const entry = await findPrevious(latest);
    if (!entry) return { status: 'no-previous' };
    if (!skipCurrent || c.current()?.id !== entry.id) await c.mountEntry(entry.id);
    return { status: 'opened', id: entry.id };
  }

  async function transition(action) {
    if (busy) return { status: 'busy' };
    busy = true;
    lastError = null;
    let release;
    let result;
    try {
      release = c.freeze();
      result = await action();
    } catch (error) {
      lastError = error;
      throw error;
    } finally {
      busy = false;
      release?.();
    }
    if (result.status === 'opened' || result.status === 'opened-new') c.focusBody();
    return result;
  }

  async function chooseNewEntry() {
    categoryPending = true;
    try {
      const category = await c.chooseCategory({
        getPrevious: async () => !!(await findPrevious(true)),
      });
      if (category === null) return { status: 'cancelled' };
      // Resolve inside the active transition: the chooser resumes the latest
      // quick edit, whereas the toolbar's previous walks back from this record.
      if (category?.action === 'previous') return await openPrevious(true);
      await c.mountNew(category);
      return { status: 'opened-new' };
    } finally {
      categoryPending = false;
    }
  }

  async function trackedTransition(action) {
    // A repeated click must not replace the pending picker operation needed by close().
    if (busy) return { status: 'busy' };
    const operation = transition(action);
    pendingTransition = operation;
    try {
      return await operation;
    } finally {
      if (pendingTransition === operation) pendingTransition = null;
    }
  }

  return {
    async newEntry() {
      return trackedTransition(async () => {
        await c.flush();
        return chooseNewEntry();
      });
    },
    async previous() {
      return transition(async () => {
        await c.flush();
        return openPrevious();
      });
    },
    async latest() {
      return trackedTransition(async () => {
        await c.flush();
        await historyQueue;
        return openPrevious(true, true);
      });
    },
    async resumeLatest() {
      return trackedTransition(async () => {
        // An unfinished save or an in-memory new draft must never be replaced by navigation.
        if (c.pending?.() || (c.current()?._unsaved && hasQuickContent(c.current())))
          return { status: 'retained-draft' };
        await historyQueue;
        return openPrevious(true, true);
      });
    },
    async next() {
      return trackedTransition(async () => {
        await c.flush();
        const entries = await c.getAccessibleEntries();
        const entry = nextQuickEntry(c.getHistory(), entries, c.current()?.id);
        if (!entry) return chooseNewEntry();
        await c.mountEntry(entry.id);
        return { status: 'opened', id: entry.id };
      });
    },
    async openMain() {
      return transition(async () => {
        await c.flush();
        // An unsaved blank draft has no server ID. Do not POST just to obtain one.
        const id = c.persistedId();
        if (!id) return { status: 'empty' };
        await c.openMain(id);
        return { status: 'opened-main', id };
      });
    },
    async close() {
      // The first quick-window page opens the category picker before an entry
      // exists. Native X must cancel that choice, wait for newEntry() to thaw,
      // then run the normal save/close path instead of being reported busy.
      if (busy && categoryPending && pendingTransition) {
        c.cancelCategory?.();
        await pendingTransition;
      }
      return transition(async () => {
        await c.flush();
        await c.closeWindow();
        return { status: 'closed' };
      });
    },
    // Call after a real successful user-edit save, not mount, focus or category defaults.
    async editedAndSaved(entry) {
      const snapshot = structuredClone(entry);
      const task = historyQueue.then(() =>
        c.setHistory(rememberQuickEntry(c.getHistory(), snapshot)),
      );
      historyQueue = task.catch(() => {});
      await task;
    },
    get busy() {
      return busy;
    },
    get lastError() {
      return lastError;
    },
    get categoryPending() {
      return categoryPending;
    },
  };
}
