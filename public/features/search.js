import { dayKey } from '../shared/insights.js';

/** Feature-local state; c.library is a live getter, never a cached snapshot. */
export function createSearch(c) {
  const { $, escape: esc, modal, closeModal } = c;
  let searchFilter = {};
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
      closeModal();
      c.changeView('all');
    };
    $('#clearSearch').onclick = () => {
      searchFilter = {};
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
