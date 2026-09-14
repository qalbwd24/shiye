import { statistics } from '../shared/statistics.js';
export function createStatistics(c, { chart, cards }) {
  const { $, escape: esc, textOf } = c;
  let statsOptions = {
    year: String(new Date().getFullYear()),
    category: '',
    includeDemo: false,
    includeHidden: false,
  };
  function render(view, root) {
    if (view === 'stats') {
      const years = [...new Set(c.library.entries.map((e) => new Date(e.date).getFullYear()))].sort(
          (a, b) => b - a,
        ),
        s = statistics(c.library.entries, c.library.media, textOf, statsOptions);
      root.innerHTML = `<h2>记录统计</h2><div class="filter-row"><select id="statYear" aria-label="统计年份"><option value="">全部年份</option>${years.map((y) => `<option>${y}</option>`).join('')}</select><select id="statCategory" aria-label="统计分类"><option value="">全部分类</option>${c.library.categories.map((v) => `<option>${esc(v)}</option>`).join('')}</select><label><input type="checkbox" id="statDemo" ${statsOptions.includeDemo ? 'checked' : ''}>包含示例</label><label><input type="checkbox" id="statHidden" ${statsOptions.includeHidden ? 'checked' : ''}>包含隐藏日记</label></div><div class="stat-cards">${[
        ['日记', s.count, '篇'],
        ['文字', s.chars, '字'],
        ['记录日期', s.dayCount, '天'],
        ['当前连续', s.currentStreak, '天'],
        ['最长连续', s.longestStreak, '天'],
        ['图片 / 视频 / 音频', `${s.images} / ${s.videos} / ${s.audio}`, ''],
      ]
        .map(
          ([name, n, unit]) =>
            `<div class="stat-card"><small>${name}</small><strong>${n}<small>${unit}</small></strong></div>`,
        )
        .join(
          '',
        )}</div><p>按记录日期统计，不含草稿和回收站。字数按可见正文去空白后的 Unicode 字符计数；附件按文件 ID 去重。当前连续天数允许今天尚未开始记录。</p>${chart('每月篇数', Object.fromEntries(s.months.map((v, i) => [i + 1 + '月', v])))}<section class="stat-panel"><h3>记录日历</h3><div class="heatmap">${
        Object.entries(s.days)
          .sort()
          .map(
            ([d, n]) =>
              `<button title="${d}：${n} 篇" data-day="${d}" style="opacity:${Math.min(1, 0.4 + n * 0.15)}">${d.slice(5)}<small>${n}</small></button>`,
          )
          .join('') || '暂无记录'
      }</div></section>${chart('分类分布', s.groups.category)}${chart('心情', s.groups.mood)}${chart('天气', s.groups.weather)}${chart('地点', s.groups.location)}${chart('标签', s.groups.tags)}${s.longest ? '<h3>写得最多的一页 · ' + s.longestLength + ' 字</h3>' + cards([s.longest]) : ''}`;
      $('#statYear').value = statsOptions.year;
      $('#statCategory').value = statsOptions.category;
      for (const id of ['statYear', 'statCategory', 'statDemo', 'statHidden'])
        $('#' + id).onchange = () => {
          statsOptions = {
            year: $('#statYear').value,
            category: $('#statCategory').value,
            includeDemo: $('#statDemo').checked,
            includeHidden: $('#statHidden').checked,
          };
          render(view, root);
        };
      return true;
    }
    return false;
  }
  return { render };
}
