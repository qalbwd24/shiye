import { createStatistics } from './statistics.js';
import { statistics, recall, isHidden, dayKey } from '../shared/insights.js';

/** Feature-local state; c.library is a live getter, never a cached snapshot. */
export function createInsights(c, services = {}) {
  const { $, escape: esc, textOf } = c;
  let recallDate = dayKey(new Date());
  const statsView = createStatistics(c, { chart, cards });
  const { prefs, preference } = services;
  function chart(title, values) {
    const pairs =
        title === '每月篇数'
          ? Object.entries(values)
          : Object.entries(values).sort((a, b) => b[1] - a[1]),
      max = Math.max(1, ...pairs.map((p) => p[1]));
    return `<section class="stat-panel"><h3>${title}</h3>${pairs.map(([label, value]) => `<div class="bar-row"><span>${esc(label)}</span><div class="bar-track"><div style="width:${(value / max) * 100}%"></div></div><small>${value}</small></div>`).join('') || '<p>没有记录</p>'}</section>`;
  }
  function cards(entries) {
    return (
      entries
        .map(
          (e) =>
            `<article class="memory-card"><small>${dayKey(e.date)} · ${esc(e.category)}</small><h2>${esc(e.title || '无标题日记')}</h2><p>${esc(textOf(e.content).slice(0, 360))}</p><button class="secondary" data-open-entry="${e.id}">打开日记</button></article>`,
        )
        .join('') || '<p class="empty">这个范围还没有记录。</p>'
    );
  }
  function render(view, root) {
    if (statsView.render(view, root)) return true;
    if (view === 'recall') {
      const period = prefs().memoryPeriod || 12,
        entries = recall(c.library.entries, {
          date: recallDate + 'T12:00:00',
          period,
          categories: prefs().memoryCategories || [],
        });
      root.innerHTML = `<h2>往日此时</h2><div class="filter-row"><input type="date" aria-label="回忆日期" id="recallDate" value="${recallDate}"><select id="recallPeriod" aria-label="回忆周期"><option value="1">每月</option><option value="3">每三个月</option><option value="6">每半年</option><option value="12">每年</option></select></div><p>同一日号，间隔为所选周期的整数倍；排除当天、未来、草稿、删除及隐藏日记。闰日只匹配实际存在的 2 月 29 日。</p>${cards(entries)}`;
      $('#recallPeriod').value = period;
      $('#recallDate').onchange = () => {
        if ($('#recallDate').value) {
          recallDate = $('#recallDate').value;
          render(view, root);
        }
      };
      $('#recallPeriod').onchange = async () => {
        await preference({ memoryPeriod: Number($('#recallPeriod').value) });
        render(view, root);
      };
      return true;
    }
    if (view === 'places') {
      const list = c.library.entries.filter(
        (e) => !e.deleted && !e.draft && !isHidden(e) && e.location,
      );
      root.innerHTML =
        '<h2>日记里的地点</h2><p>根据日记中保存的地点汇总，不请求在线地图。</p>' +
        chart(
          '足迹',
          statistics(list, c.library.media, textOf, { includeDemo: true }).groups.location,
        ) +
        cards(list);
      return true;
    }
    return false;
  }

  return { render };
}
