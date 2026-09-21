import { isHidden } from '../shared/entry-state.js';

export const ALBUM_PAGE_SIZE = 80;
const PREF_KEY = 'shiye.album.v1';
const RANDOM_KEY = 'shiye.album-random.v1';
const defaults = Object.freeze({
  layout: 'masonry',
  density: 'comfortable',
  sort: 'date-desc',
  type: 'all',
});
const allowed = {
  layout: ['masonry', 'grid', 'list'],
  density: ['comfortable', 'compact'],
  sort: ['date-desc', 'date-asc', 'name', 'random'],
  type: ['all', 'image', 'video', 'audio'],
};
export function normalizeAlbumPreferences(value) {
  return Object.fromEntries(
    Object.entries(defaults).map(([key, fallback]) => [
      key,
      allowed[key].includes(value?.[key]) ? value[key] : fallback,
    ]),
  );
}
export function readAlbumPreferences(storage) {
  try {
    const saved = JSON.parse(storage?.getItem(PREF_KEY) || 'null');
    return normalizeAlbumPreferences(saved?.version === 1 ? saved : null);
  } catch {
    return { ...defaults };
  }
}
export function saveAlbumPreferences(storage, value) {
  try {
    storage?.setItem(PREF_KEY, JSON.stringify({ version: 1, ...normalizeAlbumPreferences(value) }));
  } catch {
    /* Layout still changes if device storage is blocked or full. */
  }
}
const validSeed = (seed) => Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff;
export function readAlbumRandomSeed(storage) {
  try {
    const saved = JSON.parse(storage?.getItem(RANDOM_KEY) || 'null');
    return saved?.version === 1 && validSeed(saved.seed) ? saved.seed : null;
  } catch {
    return null;
  }
}
export function nextAlbumRandomSeed(previous, random = Math.random) {
  const value = Math.floor(random() * 0x100000000) >>> 0;
  return value === previous ? (value + 1) >>> 0 : value;
}
export function saveAlbumRandomSeed(storage, seed) {
  if (!validSeed(seed)) return;
  try {
    storage?.setItem(RANDOM_KEY, JSON.stringify({ version: 1, seed }));
  } catch {
    /* Keep the same in-memory shuffle when device storage is unavailable. */
  }
}
// Rank IDs independently so filtering and newly added media preserve relative order.
function randomRank(id, seed) {
  let value = (2166136261 ^ seed) >>> 0;
  for (const character of String(id)) value = Math.imul(value ^ character.codePointAt(0), 16777619);
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
  return (value ^ (value >>> 16)) >>> 0;
}
const mediaType = (media) => {
  const type = (media.type || '').split('/')[0];
  return ['image', 'video', 'audio'].includes(type) ? type : 'other';
};
const timestamp = (entry) => {
  const value = Date.parse(entry.date);
  return Number.isFinite(value) ? value : null;
};
const byDate = (a, b, ascending = false) => {
  const left = timestamp(a),
    right = timestamp(b);
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return ascending ? left - right : right - left;
};

/** One card per media ID; sources are only the visible diaries that reference it. */
export function albumItems(library, options = {}) {
  const prefs = normalizeAlbumPreferences(options),
    media = new Map((library.media || []).map((item) => [item.id, item])),
    grouped = new Map();
  for (const entry of library.entries || []) {
    if (entry.deleted || entry.draft || isHidden(entry)) continue;
    for (const id of new Set(entry.attachments || [])) {
      const item = media.get(id);
      if (!item) continue;
      const type = mediaType(item);
      if (prefs.type !== 'all' && type !== prefs.type) continue;
      if (!grouped.has(id)) grouped.set(id, { id, media: item, type, sources: [] });
      const card = grouped.get(id);
      if (!card.sources.some((source) => source.id === entry.id)) card.sources.push(entry);
    }
  }
  const cards = [...grouped.values()],
    ascending = prefs.sort === 'date-asc';
  for (const card of cards)
    card.sources.sort(
      (a, b) => byDate(a, b, ascending) || String(a.id).localeCompare(String(b.id)),
    );
  const compareName = (a, b) =>
    String(a.media.name || '').localeCompare(String(b.media.name || ''), 'zh-CN', {
      numeric: true,
    });
  if (prefs.sort === 'random') {
    const seed = validSeed(options.randomSeed) ? options.randomSeed : 0;
    const ranks = new Map(cards.map((card) => [card.id, randomRank(card.id, seed)]));
    return cards.sort(
      (a, b) => ranks.get(a.id) - ranks.get(b.id) || String(a.id).localeCompare(String(b.id)),
    );
  }
  cards.sort(
    (a, b) =>
      (prefs.sort === 'name' ? compareName(a, b) : byDate(a.sources[0], b.sources[0], ascending)) ||
      compareName(a, b) ||
      String(a.id).localeCompare(String(b.id)),
  );
  return cards;
}
export function albumPage(items, offset = 0) {
  const start = Math.min(
      items.length,
      Math.max(0, Number.isFinite(offset) ? Math.floor(offset) : 0),
    ),
    page = items.slice(start, start + ALBUM_PAGE_SIZE);
  return {
    items: page,
    nextOffset: start + page.length,
    hasMore: start + page.length < items.length,
    total: items.length,
  };
}

export function createAlbum(c) {
  const { escape: esc } = c;
  let storage;
  try {
    storage = globalThis.localStorage;
  } catch {
    /* Device preferences are optional. */
  }
  let preferences = readAlbumPreferences(storage),
    randomSeed = readAlbumRandomSeed(storage),
    navigationLimit = ALBUM_PAGE_SIZE,
    restoredLimit = null,
    disconnect = () => {};
  if (randomSeed === null) {
    randomSeed = nextAlbumRandomSeed(null);
    saveAlbumRandomSeed(storage, randomSeed);
  }
  function render(view, root) {
    if (view !== 'gallery') {
      disconnect();
      disconnect = () => {};
      return false;
    }
    disconnect();
    let limit = restoredLimit ?? ALBUM_PAGE_SIZE,
      presented = [],
      resizeObserver;
    restoredLimit = null;
    navigationLimit = limit;
    const doc = root.ownerDocument || document;
    root.innerHTML = `<section class="album-workspace" aria-label="相册"><header class="album-heading"><div><span class="album-eyebrow">拾起日常的片段</span><h2>日子里的画面</h2><p data-album-summary></p></div><button class="primary" data-album-new>新建图文日记</button></header><div class="album-controls" aria-label="相册显示选项"><label>排列<select data-album-pref="layout"><option value="masonry">自然比例瀑布流</option><option value="grid">整齐方格</option><option value="list">列表</option></select></label><label>密度<select data-album-pref="density"><option value="comfortable">舒适</option><option value="compact">紧凑</option></select></label><label>排序<select data-album-pref="sort"><option value="date-desc">日记日期 · 从新到旧</option><option value="date-asc">日记日期 · 从旧到新</option><option value="name">媒体名称</option><option value="random">随机排列</option></select></label><label>类型<select data-album-pref="type"><option value="all">全部媒体</option><option value="image">图片</option><option value="video">视频</option><option value="audio">音频</option></select></label><button class="secondary album-shuffle" data-album-shuffle hidden title="更换随机顺序；筛选和加载更多不会打乱">重新打乱相册</button></div><div class="album-cards" data-album-cards></div><footer class="album-footer"><p role="status" aria-live="polite" data-album-count></p><button class="secondary" data-album-more>再显示 80 项</button></footer></section>`;
    const workspace = root.querySelector('.album-workspace'),
      grid = root.querySelector('[data-album-cards]');
    const measure = (card) => {
      if (preferences.layout !== 'masonry') {
        card.style.removeProperty('grid-row-end');
        return;
      }
      const computedGap = Number.parseFloat(doc.defaultView?.getComputedStyle?.(grid).rowGap);
      const gap = Number.isFinite(computedGap)
        ? computedGap
        : preferences.density === 'compact'
          ? 10
          : 16;
      const span = Math.ceil((card.getBoundingClientRect().height + gap) / (8 + gap));
      card.style.gridRowEnd = `span ${Math.max(1, span)}`;
    };
    const Observer = doc.defaultView?.ResizeObserver;
    if (Observer)
      resizeObserver = new Observer((entries) => entries.forEach((entry) => measure(entry.target)));
    const onImageLoad = (event) => {
      const card = event.target.closest?.('.album-card');
      if (card) measure(card);
    };
    grid.addEventListener('load', onImageLoad, true);
    disconnect = () => {
      resizeObserver?.disconnect();
      grid.removeEventListener('load', onImageLoad, true);
    };
    function cardMarkup(card) {
      const source = card.sources[0],
        name = card.media.name || '未命名附件',
        date =
          timestamp(source) === null
            ? '日期未记录'
            : new Date(source.date).toLocaleDateString('zh-CN');
      const typeNames = { image: '图片', video: '视频', audio: '音频', other: '附件' };
      const preview =
        card.type === 'image'
          ? `<img src="/media/${encodeURIComponent(card.id)}" alt="${esc(name)}" loading="lazy" decoding="async" draggable="false">`
          : `<span class="album-placeholder"><span aria-hidden="true">${card.type === 'video' ? '▶' : card.type === 'audio' ? '♫' : '▤'}</span><small>${typeNames[card.type]}</small></span>`;
      const sources =
        card.sources.length > 1
          ? `<details class="album-sources"><summary>关联 ${card.sources.length} 篇日记</summary><div>${card.sources
              .slice(0, 3)
              .map(
                (entry) =>
                  `<button data-open-entry="${esc(entry.id)}">${esc(entry.title || '无标题日记')}</button>`,
              )
              .join(
                '',
              )}${card.sources.length > 3 ? `<small>另有 ${card.sources.length - 3} 篇可见日记关联此媒体</small>` : ''}</div></details>`
          : '';
      const excerpt =
        preferences.layout === 'list' && c.textOf
          ? c.textOf(source.content || '').slice(0, 130)
          : '';
      return `<article class="album-card" data-album-media="${esc(card.id)}"><button class="album-preview" data-open-entry="${esc(source.id)}" aria-label="打开${esc(source.title || '无标题日记')}，查看${esc(name)}">${preview}<span class="album-type-badge">${typeNames[card.type]}</span></button><div class="album-card-info"><h3><button data-open-entry="${esc(source.id)}">${esc(name)}</button></h3><p class="album-source-title">${esc(source.title || '无标题日记')}</p><time>${esc(date)}</time>${excerpt ? `<p class="album-excerpt">${esc(excerpt)}</p>` : ''}${sources}</div></article>`;
    }
    function draw(reset = false) {
      navigationLimit = limit;
      const cards = albumItems(c.library, { ...preferences, randomSeed });
      const signature = (card) =>
        JSON.stringify([
          card.id,
          card.media.name,
          ...card.sources.map((source) => [source.id, source.revision, source.title, source.date]),
        ]);
      workspace.dataset.layout = preferences.layout;
      workspace.dataset.density = preferences.density;
      const canAppend =
        !reset &&
        presented.every((value, index) => cards[index] && signature(cards[index]) === value);
      if (!canAppend) {
        resizeObserver?.disconnect();
        grid.innerHTML = '';
        presented = [];
      }
      grid.querySelector('.album-empty')?.remove();
      let offset = presented.length;
      while (offset < limit && offset < cards.length) {
        const page = albumPage(cards, offset);
        grid.insertAdjacentHTML('beforeend', page.items.map(cardMarkup).join(''));
        presented.push(...page.items.map(signature));
        offset = page.nextOffset;
      }
      const shown = cards.slice(0, presented.length);
      grid.classList.toggle('album-is-empty', !cards.length);
      if (!cards.length)
        grid.innerHTML =
          '<div class="album-empty"><h3>这里还没有画面</h3><p>换一种媒体类型看看，或在日记中添加图片、视频和音频。</p></div>';
      const sourceCount = new Set(cards.flatMap((card) => card.sources.map((source) => source.id)))
        .size;
      root.querySelector('[data-album-summary]').textContent =
        `${cards.length} 份媒体，连着 ${sourceCount} 篇记忆。相同媒体合并展示。`;
      root.querySelector('[data-album-count]').textContent =
        `已显示 ${shown.length} / ${cards.length} 项`;
      const more = root.querySelector('[data-album-more]');
      const shuffle = root.querySelector('[data-album-shuffle]');
      shuffle.hidden = preferences.sort !== 'random';
      shuffle.disabled = cards.length < 2;
      more.hidden = shown.length >= cards.length;
      more.textContent = `再显示 ${Math.min(ALBUM_PAGE_SIZE, cards.length - shown.length)} 项`;
      grid.querySelectorAll('.album-card').forEach((card) => {
        resizeObserver?.observe(card);
        measure(card);
      });
    }
    root.querySelectorAll('[data-album-pref]').forEach((control) => {
      control.value = preferences[control.dataset.albumPref];
      control.onchange = () => {
        preferences = normalizeAlbumPreferences({
          ...preferences,
          [control.dataset.albumPref]: control.value,
        });
        saveAlbumPreferences(storage, preferences);
        limit = ALBUM_PAGE_SIZE;
        draw(true);
      };
    });
    root.querySelector('[data-album-new]').onclick = () =>
      Promise.resolve(c.newEntry()).catch((error) => c.toast?.(error.message));
    root.querySelector('[data-album-more]').onclick = () => {
      limit += ALBUM_PAGE_SIZE;
      draw();
    };
    root.querySelector('[data-album-shuffle]').onclick = () => {
      const before = albumItems(c.library, { ...preferences, randomSeed }).map((card) => card.id);
      // Avoid an apparently unchanged shuffle in small filtered albums when possible.
      for (let attempt = 0; attempt < 16; attempt++) {
        randomSeed = nextAlbumRandomSeed(randomSeed);
        const after = albumItems(c.library, { ...preferences, randomSeed });
        if (after.some((card, index) => card.id !== before[index])) break;
      }
      saveAlbumRandomSeed(storage, randomSeed);
      limit = ALBUM_PAGE_SIZE;
      draw(true);
      root.querySelector('[data-album-count]').textContent += '，已重新打乱';
    };
    draw(true);
    return true;
  }
  function captureNavigation() {
    return {
      version: 1,
      preferences: { ...preferences },
      randomSeed,
      limit: navigationLimit,
    };
  }
  function restoreNavigation(snapshot) {
    if (!snapshot || snapshot.version !== 1) return false;
    preferences = normalizeAlbumPreferences(snapshot.preferences);
    if (validSeed(snapshot.randomSeed)) randomSeed = snapshot.randomSeed;
    restoredLimit =
      Number.isSafeInteger(snapshot.limit) && snapshot.limit >= ALBUM_PAGE_SIZE
        ? snapshot.limit
        : ALBUM_PAGE_SIZE;
    navigationLimit = restoredLimit;
    saveAlbumPreferences(storage, preferences);
    saveAlbumRandomSeed(storage, randomSeed);
    return true;
  }
  return { render, captureNavigation, restoreNavigation };
}
