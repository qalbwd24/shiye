/** Collapse infrequent writing tools without losing the document selection. */
export function createEditorToolbox(c) {
  const root = c.$('#editorToolbox');
  const toggle = c.$('#editorToolsToggle');
  const panel = c.$('#editorToolsPanel');
  let expanded = false;
  try {
    expanded = localStorage.getItem('shiye.editor.tools-expanded') === 'true';
  } catch {
    /* Storage is optional. */
  }
  function apply() {
    root.dataset.expanded = String(expanded);
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.title = expanded ? '收起编辑工具' : '展开编辑工具';
    panel.inert = !expanded;
    panel.setAttribute('aria-hidden', String(!expanded));
  }
  toggle.addEventListener('mousedown', (event) => event.preventDefault());
  toggle.onclick = () => {
    expanded = !expanded;
    apply();
    try {
      localStorage.setItem('shiye.editor.tools-expanded', String(expanded));
    } catch {
      /* Storage is optional. */
    }
  };
  apply();
}
