export function createEditorCommands(c) {
  const { $, sanitize } = c;
  let range = null;
  function recoverRange() {
    const editor = $('#bodyEditor');
    editor.focus();
    const s = getSelection();
    if (range && editor.contains(range.commonAncestorContainer)) {
      s.removeAllRanges();
      s.addRange(range);
    } else {
      const r = document.createRange();
      r.selectNodeContents(editor);
      r.collapse(false);
      s.removeAllRanges();
      s.addRange(r);
    }
  }
  function command(cmd, value) {
    if (!c.current() || c.current().deleted) return;
    recoverRange();
    document.execCommand(cmd, false, value);
    c.current().content = sanitize($('#bodyEditor').innerHTML);
    c.markDirty();
  }
  return {
    command,
    resetSelection() {
      range = null;
    },
    captureSelection() {
      const s = getSelection();
      if (s.rangeCount && $('#bodyEditor').contains(s.anchorNode))
        range = s.getRangeAt(0).cloneRange();
    },
  };
}
