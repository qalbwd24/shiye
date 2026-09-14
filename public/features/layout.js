import { normalizeLayout } from '../shared/appearance.js';

/** Partial updates are queued so rapid independent panel toggles cannot overwrite each other. */
export function createLayout(c) {
  const { $ } = c;
  const pending = {};
  let dragWidth = null;
  let queue = Promise.resolve();
  let legacy = {};
  let positionFrame = 0;
  const positionTabs = () => {
    positionFrame = 0;
    const sidebar = $('#mainSidebar').getBoundingClientRect();
    const list = $('#entryPanel').getBoundingClientRect();
    const workspace = $('.workspace').getBoundingClientRect();
    const editor = $('#editorPanel').getBoundingClientRect();
    const media = $('#entryMediaPane').getBoundingClientRect();
    const columns = $('#entryColumns');
    const stacked = getComputedStyle(columns).display === 'block';
    const listVisible = !$('#journalView').classList.contains('hidden') && list.height > 0;
    const viewport = document.documentElement.clientWidth;
    const tabWidth = 30;
    const positions = [
      ['sidebarFold', sidebar.right, sidebar.top + 22, 'right'],
      [
        'listToggle',
        listVisible ? list.right : workspace.left,
        Math.max(workspace.top + 110, sidebar.top + 112),
        'right',
      ],
      [
        'mediaToggle',
        stacked
          ? editor.right - tabWidth
          : columns.dataset.mediaPosition === 'left'
            ? media.right
            : media.left - tabWidth,
        editor.top + 118,
        columns.dataset.mediaPosition === 'left' ? 'right' : 'left',
      ],
    ];
    // Read all geometry before writing; no diary list/editor rebuild is involved.
    for (const [id, x, y, edge] of positions) {
      const button = $('#' + id);
      const transform = `translate3d(${Math.round(Math.max(12, Math.min(viewport - tabWidth - 12, x)))}px, ${Math.round(Math.max(20, y))}px, 0)`;
      if (button.style.transform !== transform) button.style.transform = transform;
      button.dataset.edge = edge;
    }
  };
  const scheduleTabPosition = () => {
    if (!positionFrame && typeof requestAnimationFrame === 'function')
      positionFrame = requestAnimationFrame(positionTabs);
  };
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
    ...(dragWidth === null ? {} : { mediaWidth: dragWidth }),
  });
  function apply() {
    const state = read();
    for (const [key, id] of [
      ['categories', 'categoryGroup'],
      ['tags', 'tagCloud'],
    ]) {
      $('#' + id).hidden = state[key];
      const button = $(`[data-fold="${key}"]`);
      button.setAttribute('aria-expanded', String(!state[key]));
      button.querySelector('.fold-caret').textContent = state[key] ? '›' : '⌄';
    }
    $('#app').classList.toggle('sidebar-collapsed', state.sidebar);
    $('#mainSidebar').inert = state.sidebar;
    $('#entryMediaPane').inert = state.media;
    $('#entryPanel').inert = state.list && !matchMedia('(max-width: 650px)').matches;
    $('#entryPanel').classList.toggle('list-collapsed', state.list);
    $('#entryColumns').classList.toggle('media-collapsed', state.media);
    $('#entryColumns').dataset.mediaPosition = state.mediaPosition;
    document.documentElement.style.setProperty('--media-width', state.mediaWidth + 'px');
    document.documentElement.style.setProperty('--list', state.listWidth + 'px');
    $('#mediaResize').setAttribute('aria-valuenow', state.mediaWidth);
    for (const [id, key, name] of [
      ['sidebarFold', 'sidebar', '导航'],
      ['listFold', 'list', '日记列表'],
      ['listToggle', 'list', $('#listToggleLabel')?.textContent || '日记列表'],
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
    scheduleTabPosition();
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
    $('#' + id).onclick = async () => {
      if (id === 'listToggle' && $('#journalView')?.classList.contains('hidden')) {
        try {
          await c.flush();
          document.dispatchEvent(new Event('shiye:read-mode'));
          await c.changeView('all');
          await showList();
        } catch (error) {
          c.toast(error.message);
        }
        return;
      }
      if (id === 'listToggle' && matchMedia('(max-width: 650px)').matches) {
        $('#journalView').classList.toggle('has-selected');
        scheduleTabPosition();
        return;
      }
      toggle(key);
    };
  }
  const resizer = $('#mediaResize');
  const renderedWidth = () =>
    Math.max(
      240,
      Math.min(
        680,
        Math.round($('#entryMediaPane').getBoundingClientRect().width) || read().mediaWidth,
      ),
    );
  let cancelDrag = () => {};
  resizer.onkeydown = (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const direction = read().mediaPosition === 'left' ? 1 : -1;
    const width =
      event.key === 'Home'
        ? 240
        : event.key === 'End'
          ? 680
          : renderedWidth() + (event.key === 'ArrowRight' ? 20 : -20) * direction;
    set({ mediaWidth: Math.max(240, Math.min(680, width)) }).catch(() => {});
  };
  resizer.onpointerdown = (event) => {
    if (event.button !== 0 || event.isPrimary === false) return;
    event.preventDefault();
    cancelDrag();
    const initial = read(),
      start = event.clientX,
      startWidth = renderedWidth();
    resizer.setPointerCapture(event.pointerId);
    document.body.classList.add('resizing-pane');
    let previewFrame = 0;
    const preview = () => {
      previewFrame = 0;
      document.documentElement.style.setProperty('--media-width', dragWidth + 'px');
      resizer.setAttribute('aria-valuenow', dragWidth);
      scheduleTabPosition();
    };
    const move = (e) => {
      if (e.pointerId !== event.pointerId) return;
      dragWidth = Math.max(
        240,
        Math.min(
          680,
          Math.round(
            startWidth + (e.clientX - start) * (initial.mediaPosition === 'left' ? 1 : -1),
          ),
        ),
      );
      if (!previewFrame) previewFrame = requestAnimationFrame(preview);
    };
    const finish = (commit) => {
      const width = dragWidth;
      cancelAnimationFrame(previewFrame);
      dragWidth = null;
      document.body.classList.remove('resizing-pane');
      resizer.removeEventListener('pointermove', move);
      resizer.removeEventListener('pointerup', release);
      resizer.removeEventListener('pointercancel', cancel);
      resizer.removeEventListener('lostpointercapture', cancel);
      window.removeEventListener('blur', cancel);
      cancelDrag = () => {};
      if (resizer.hasPointerCapture(event.pointerId))
        resizer.releasePointerCapture(event.pointerId);
      if (commit && width !== null) set({ mediaWidth: width }).catch(() => {});
      else apply();
    };
    const release = (e) => {
      if (e.pointerId === event.pointerId) finish(true);
    };
    const cancel = () => finish(false);
    cancelDrag = cancel;
    resizer.addEventListener('pointermove', move);
    resizer.addEventListener('pointerup', release);
    resizer.addEventListener('pointercancel', cancel);
    resizer.addEventListener('lostpointercapture', cancel);
    window.addEventListener('blur', cancel);
  };
  async function showList() {
    document.dispatchEvent(new Event('shiye:read-mode'));
    $('#journalView').classList.remove('has-selected');
    await set({
      list: false,
      ...(matchMedia('(max-width: 650px)').matches ? { sidebar: true } : {}),
    });
  }
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(scheduleTabPosition);
    for (const selector of [
      '#mainSidebar',
      '#entryPanel',
      '#editorPanel',
      '#entryMediaPane',
      '.workspace',
    ])
      observer.observe($(selector));
  }
  if (typeof MutationObserver === 'function') {
    const observer = new MutationObserver(scheduleTabPosition);
    for (const selector of ['#journalView', '#alternateView', '#entryColumns'])
      observer.observe($(selector), {
        attributes: true,
        attributeFilter: ['class', 'data-media-position'],
      });
  }
  window.addEventListener('resize', scheduleTabPosition);
  scheduleTabPosition();
  return { apply, set, read, showList };
}
