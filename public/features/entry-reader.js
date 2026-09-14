/** Mount the one editor/gallery/comments tree in a browsing view; never clone diary state. */
export function createEntryReader(c) {
  const panel = c.$('#editorPanel');
  const home = c.$('#journalView');
  let generation = 0;
  function release() {
    generation++;
    if (panel.parentElement !== home) home.append(panel);
    panel.classList.remove('embedded-entry-reader');
    c.$('#alternateView').classList.remove('has-entry-reader');
  }
  async function mount(container, entryId) {
    const turn = ++generation;
    const active = () => turn === generation && container.isConnected;
    const selected = await c.openPreviewEntry(entryId, active);
    if (!selected || !active()) return false;
    panel.classList.add('embedded-entry-reader');
    c.$('#alternateView').classList.add('has-entry-reader');
    container.append(panel);
    return true;
  }
  return { release, mount };
}
