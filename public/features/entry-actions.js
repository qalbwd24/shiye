/** Shared operations for context menus. Use full, fresh entries and revision checks. */
export function createEntryActions(c) {
  const find = (id) => {
    const entry = c.library.entries.find((e) => e.id === id);
    if (!entry) throw Error('日记不存在，请刷新列表');
    return entry;
  };
  async function update(id, patch) {
    return c.withLibraryMutation(async () => {
      const entry = find(id);
      await c.api('/api/entries/' + id, { method: 'PUT', data: { ...entry, ...patch(entry) } });
      await c.refreshLibrary();
      c.renderView();
    });
  }
  async function duplicate(id) {
    let copy;
    await c.withLibraryMutation(async () => {
      const entry = find(id);
      copy = await c.api('/api/entries', {
        method: 'POST',
        data: {
          ...entry,
          title: (entry.title || '无标题日记') + '（副本）',
          date: new Date().toISOString(),
          deleted: false,
          demo: false,
          hidden: false,
          draft: false,
          pinned: false,
        },
      });
      await c.refreshLibrary();
    });
    await c.filterView();
    await c.selectEntry(copy.id);
  }
  async function taxonomy(kind, action, from = '', to = '') {
    await c.withLibraryMutation(async () => {
      await c.api('/api/taxonomy', { method: 'POST', data: { kind, action, from, to } });
      await c.refreshLibrary();
      c.renderView();
    });
  }
  return { update, duplicate, taxonomy };
}
