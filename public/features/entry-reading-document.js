/** Read projections never replace an Entry or participate in autosave. */
export function createEntryReadingDocument(c) {
  const host = c.$('#bodyEditor');
  const notice = host.ownerDocument.createElement('div');
  notice.className = 'entry-reading-notice';
  notice.hidden = true;
  const label = host.ownerDocument.createElement('span');
  const edit = host.ownerDocument.createElement('button');
  edit.className = 'secondary';
  edit.textContent = '继续编辑原文';
  notice.append(label, edit);
  host.before(notice);
  const editing = new Set();
  let generation = 0,
    state = null;
  const active = (turn, entry) =>
    turn === generation && c.current()?.id === entry.id && c.current()?.revision === entry.revision;
  function render(entry) {
    if (!entry || entry._unsaved || entry.contentFormat === 'richdoc' || editing.has(entry.id)) {
      generation++;
      state = null;
      notice.hidden = true;
      if (c.editor.isReadingDocument) c.editor.exitReadingDocument(entry);
      return;
    }
    if (state?.id === entry.id && state.revision === entry.revision) return;
    const turn = ++generation;
    state = { id: entry.id, revision: entry.revision, projection: null };
    notice.hidden = false;
    label.textContent = '正在生成图文阅读视图，原文保持原样…';
    edit.disabled = !!entry.deleted || !!entry.chatJournal;
    c.editor.renderReadingDocument(entry, {
      source: { id: entry.id, revision: entry.revision },
      html: '<p>正在读取…</p>',
    });
    Promise.resolve(c.api('/api/entries/' + encodeURIComponent(entry.id) + '/reading-document'))
      .then((projection) => {
        if (
          !active(turn, entry) ||
          projection.source?.id !== entry.id ||
          projection.source.revision !== entry.revision
        )
          return;
        state.projection = projection;
        c.editor.renderReadingDocument(entry, projection);
        label.textContent =
          projection.mode === 'compatibility'
            ? '图文阅读 · 部分旧排版使用兼容显示，原文已保留'
            : '图文阅读 · 原始日记保留';
        c.renderAttachments?.();
      })
      .catch(() => {
        if (!active(turn, entry)) return;
        c.editor.renderReadingDocument(entry, {
          source: { id: entry.id, revision: entry.revision },
          html: entry.content || '',
        });
        label.textContent = '图文读取暂不可用，当前显示原文；可继续编辑原格式';
        c.renderAttachments?.();
      });
  }
  async function editOriginal() {
    const entry = c.current();
    if (!entry || entry.deleted || entry.chatJournal) return;
    try {
      await c.flush();
      if (c.current()?.id !== entry.id) return;
      generation++;
      editing.add(entry.id);
      state = null;
      notice.hidden = true;
      c.editor.exitReadingDocument(c.current());
      c.renderAttachments?.();
      c.editor.focus();
    } catch (error) {
      c.toast(error.message);
    }
  }
  edit.onclick = editOriginal;
  return {
    render,
    editOriginal,
    async show() {
      const entry = c.current();
      if (!entry || entry.contentFormat === 'richdoc' || entry._unsaved) return;
      await c.flush();
      if (c.current()?.id !== entry.id) return;
      editing.delete(entry.id);
      state = null;
      render(c.current());
    },
    projection: () => (state && state.id === c.current()?.id ? state.projection : null),
  };
}
