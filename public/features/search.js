import { dayKey } from '../shared/insights.js';

/** Feature-local state; c.library is a live getter, never a cached snapshot. */
export function createSearch(c) {
  const { $, escape: esc, modal, closeModal } = c;
  let searchFilter = {};
  try {
    const saved = JSON.parse(localStorage.getItem('shiye.search-filter.v1') || '{}');
    if (saved && typeof saved === 'object')
      for (const k of ['start', 'end', 'media', 'mood'])
        if (typeof saved[k] === 'string' && saved[k].length <= 100) searchFilter[k] = saved[k];
  } catch {
    /* Optional device-local preferences. */
  }
  function rememberFilter() {
    try {
      localStorage.setItem('shiye.search-filter.v1', JSON.stringify(searchFilter));
    } catch {
      /* Optional storage. */
    }
    updateIndicator();
  }
  function updateIndicator() {
    const active = Object.values(searchFilter).some(Boolean);
    const button = $('#filterButton');
    if (button) {
      button.classList.toggle('active', active);
      button.textContent = active ? '筛选 · 已启用' : '筛选';
      button.setAttribute('aria-label', active ? '筛选日记，已有筛选条件' : '筛选日记');
    }
  }
  queueMicrotask(updateIndicator);
  function advancedSearch() {
    modal(
      '筛选日记',
      `<label>开始日期<input class="field" type="date" id="filterStart" value="${esc(searchFilter.start || '')}"></label><label>结束日期<input class="field" type="date" id="filterEnd" value="${esc(searchFilter.end || '')}"></label><label>媒体<select class="field" id="filterMedia"><option value="">不限</option><option value="image/">含图片</option><option value="video/">含视频</option><option value="audio/">含录音</option></select></label><label>心情<input class="field" id="filterMood" value="${esc(searchFilter.mood || '')}"></label><button class="primary" id="applySearch">应用</button><button class="secondary" id="clearSearch">清除筛选</button>`,
    );
    $('#filterMedia').value = searchFilter.media || '';
    $('#applySearch').onclick = () => {
      searchFilter = {
        start: $('#filterStart').value,
        end: $('#filterEnd').value,
        media: $('#filterMedia').value,
        mood: $('#filterMood').value,
      };
      rememberFilter();
      closeModal();
      c.changeView('all');
    };
    $('#clearSearch').onclick = () => {
      searchFilter = {};
      rememberFilter();
      closeModal();
      c.changeView('all');
    };
  }
  function filter(e) {
    const f = searchFilter,
      day = dayKey(e.date);
    return (
      (!f.start || day >= f.start) &&
      (!f.end || day <= f.end) &&
      (!f.mood || e.mood === f.mood) &&
      (!f.media ||
        e.attachments.some((id) =>
          c.library.media.some((m) => m.id === id && m.type.startsWith(f.media)),
        ))
    );
  }

  return { advancedSearch, filter };
}
