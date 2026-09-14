import { normalizeLayout } from '../shared/appearance.js';

/** Partial updates are queued so rapid independent panel toggles cannot overwrite each other. */
export function createLayout(c) {
  const { $ } = c;
  const pending = {};
  let queue = Promise.resolve();
  let legacy = {};
  try {
    legacy = normalizeLayout(JSON.parse(localStorage.getItem('shiye.collapsed') || '{}'));
  } catch {
    /* Invalid legacy browser preferences do not prevent startup. */
  }
  const read = () => ({
    sidebar: matchMedia('(max-width: 650px)').matches,
    media: false,
    mediaPosition: 'right',
    mediaWidth: 340,
    listWidth: 280,
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
    $('#app').classList.toggle('sidebar-collapsed', state.sidebar);
    $('#entryPanel').classList.toggle('list-collapsed', state.list);
    $('#entryColumns').classList.toggle('media-collapsed', state.media);
    $('#entryColumns').dataset.mediaPosition = state.mediaPosition;
    document.documentElement.style.setProperty('--media-width', state.mediaWidth + 'px');
    document.documentElement.style.setProperty('--list', state.listWidth + 'px');
    $('#mediaResize').setAttribute('aria-valuenow', state.mediaWidth);
    for (const [id, key, name] of [
      ['sidebarFold', 'sidebar', '导航'],
      ['listFold', 'list', '日记列表'],
      ['listToggle', 'list', '日记列表'],
      ['mediaToggle', 'media', '图片与评论'],
      ['mediaFold', 'media', '图片与评论'],
    ]) {
      const button = $('#' + id);
      button.setAttribute('aria-expanded', String(!state[key]));
      button.setAttribute('aria-label', (state[key] ? '展开' : '折叠') + name);
      button.title = (state[key] ? '展开' : '折叠') + name;
      button.classList.toggle('active', !state[key]);
    }
    $('#listFold').textContent = state.list ? '›' : '‹';
  }
  function set(changes) {
    normalizeLayout(changes);
    Object.assign(pending, changes);
    apply();
    const request = queue.then(async () => {
      try {
        const layout = normalizeLayout({
          ...legacy,
          ...c.library.settings?.preferences?.layout,
          ...changes,
        });
        const prefs = await c.api('/api/preferences', { method: 'PUT', data: { layout } });
        c.library.settings.preferences = prefs;
      } finally {
        for (const [key, value] of Object.entries(changes))
          if (pending[key] === value) delete pending[key];
        apply();
      }
    });
    queue = request.catch((e) => c.toast(e.message));
    return request;
  }
  const toggle = (key) => set({ [key]: !read()[key] }).catch(() => {});
  for (const button of c.$$('[data-fold]')) button.onclick = () => toggle(button.dataset.fold);
  for (const [id, key] of [
    ['sidebarFold', 'sidebar'],
    ['listFold', 'list'],
    ['listToggle', 'list'],
    ['mediaToggle', 'media'],
    ['mediaFold', 'media'],
  ]) {
    $('#' + id).onclick = () => {
      if (['sidebar', 'list'].includes(key) && document.body.classList.contains('writing-mode')) {
        document.dispatchEvent(new Event('shiye:read-mode'));
        if (!read()[key]) return;
      }
      document.body.classList.remove('focus-mode');
      $('#focusButton').classList.remove('active');
      if (id === 'listToggle' && matchMedia('(max-width: 650px)').matches) {
        $('#journalView').classList.toggle('has-selected');
        return;
      }
      toggle(key);
    };
  }
  const resizer = $('#mediaResize');
  resizer.onkeydown = (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const direction = read().mediaPosition === 'left' ? 1 : -1;
    const width =
      event.key === 'Home'
        ? 240
        : event.key === 'End'
          ? 680
          : read().mediaWidth + (event.key === 'ArrowRight' ? 20 : -20) * direction;
    set({ mediaWidth: Math.max(240, Math.min(680, width)) }).catch(() => {});
  };
  resizer.onpointerdown = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const initial = read(),
      start = event.clientX;
    resizer.setPointerCapture(event.pointerId);
    const move = (e) => {
      pending.mediaWidth = Math.max(
        240,
        Math.min(
          680,
          Math.round(
            initial.mediaWidth + (e.clientX - start) * (initial.mediaPosition === 'left' ? 1 : -1),
          ),
        ),
      );
      apply();
    };
    const finish = () => {
      resizer.removeEventListener('pointermove', move);
      resizer.removeEventListener('pointerup', finish);
      resizer.removeEventListener('pointercancel', finish);
      set({ mediaWidth: read().mediaWidth }).catch(() => {});
    };
    resizer.addEventListener('pointermove', move);
    resizer.addEventListener('pointerup', finish);
    resizer.addEventListener('pointercancel', finish);
  };
  return { apply, set, read };
}
