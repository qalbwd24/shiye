import { normalizeLayout } from '../shared/appearance.js';

export function createLayout(c) {
  const { $ } = c;
  let pending = {};
  let queue = Promise.resolve();
  let legacy = {};
  try {
    legacy = normalizeLayout(JSON.parse(localStorage.getItem('shiye.collapsed') || '{}'));
  } catch {
    /* Invalid legacy browser preferences do not prevent startup. */
  }
  const read = () => ({
    categories: false,
    tags: false,
    list: false,
    ...legacy,
    ...c.library.settings?.preferences?.layout,
    ...pending,
  });
  function apply() {
    const state = read();
    for (const [key, id] of [
      ['categories', 'categories'],
      ['tags', 'tagCloud'],
    ]) {
      $('#' + id).hidden = state[key];
      const button = $(`[data-fold="${key}"]`);
      button.setAttribute('aria-expanded', String(!state[key]));
      button.querySelector('.fold-caret').textContent = state[key] ? '›' : '⌄';
    }
    $('#entryPanel').classList.toggle('list-collapsed', state.list);
    $('#listFold').setAttribute('aria-expanded', String(!state.list));
    $('#listFold').setAttribute('aria-label', state.list ? '展开日记列表' : '折叠日记列表');
    $('#listFold').title = state.list ? '展开日记列表' : '折叠日记列表';
    $('#listFold').textContent = state.list ? '›' : '‹';
  }
  function toggle(key) {
    const value = !read()[key];
    pending[key] = value;
    apply();
    queue = queue.then(async () => {
      const layout = normalizeLayout({
        ...legacy,
        ...c.library.settings.preferences?.layout,
        [key]: value,
      });
      try {
        const prefs = await c.api('/api/preferences', { method: 'PUT', data: { layout } });
        c.library.settings.preferences = prefs;
      } catch (e) {
        c.toast(e.message);
      } finally {
        if (pending[key] === value) delete pending[key];
        apply();
      }
    });
  }
  for (const button of c.$$('[data-fold]')) button.onclick = () => toggle(button.dataset.fold);
  $('#listFold').onclick = () => toggle('list');
  return { apply };
}
