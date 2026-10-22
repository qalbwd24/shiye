/** View state stays in the retained window; never persist text or DOM in diary JSON. */
export function createQuickResumePosition({ current, editor, title, scroller }) {
  const snapshots = new Map();
  let snapshot = null;
  return {
    capture(field) {
      snapshot = {
        entryId: current()?.id,
        field,
        body: editor.captureResumePosition
          ? editor.captureResumePosition()
          : editor.capturePosition(),
        title: [title.selectionStart, title.selectionEnd, title.selectionDirection],
        scroll: scroller.scrollTop,
        pending: true,
      };
      if (snapshot.entryId) snapshots.set(snapshot.entryId, snapshot);
    },
    saved() {
      if (snapshot && current()?.id && snapshot.entryId !== current().id) {
        const oldId = snapshot.entryId;
        snapshots.delete(snapshot.entryId);
        snapshot.entryId = current().id;
        if (snapshot.body?.entryId === oldId) snapshot.body.entryId = current().id;
        snapshots.set(snapshot.entryId, snapshot);
      }
    },
    restore() {
      const saved = snapshots.get(current()?.id);
      if (!saved?.pending) return false;
      saved.pending = false; // Ordinary activation must not rewind later edits.
      if (saved.field === 'title') {
        title.focus({ preventScroll: true });
        title.setSelectionRange(...saved.title);
      } else {
        editor.focus();
        const restored = editor.restoreResumePosition
          ? editor.restoreResumePosition(saved.body)
          : editor.restorePosition(saved.body);
        if (restored === false) return false;
      }
      scroller.scrollTop = saved.scroll;
      scroller.ownerDocument.defaultView.requestAnimationFrame(() => {
        if (current()?.id === saved.entryId) scroller.scrollTop = saved.scroll;
      });
      return true;
    },
  };
}
