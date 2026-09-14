import { recall } from '../shared/recall.js';
import { dayKey } from '../shared/entry-state.js';
import {
  recollectionEntries,
  normalizeRecollectionSession,
  reconcileRecollection,
  advanceRecollection,
  restartRecollection,
} from '../shared/memories.js';

const STORAGE_KEY = 'shiye.recollection.v1';
export const RECOLLECTION_PAGE_SIZE = 80;
export async function fadeRecollectionOut(
  element,
  reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
) {
  if (reducedMotion || typeof element?.animate !== 'function') return;
  let animation;
  try {
    animation = element.animate(
      [
        { opacity: 1, transform: 'translateX(0)' },
        { opacity: 0, transform: 'translateX(-5px)' },
      ],
      { duration: 100, easing: 'ease-in', fill: 'forwards' },
    );
    await animation.finished;
  } catch {
    // Canceled/detached animations must not turn a navigation into a save failure.
  } finally {
    animation?.cancel?.();
  }
}
const validDate = (value) =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value))
    ? value
    : '';
export function normalizeRecollectionPreferences(raw = {}) {
  if (!raw || typeof raw !== 'object') raw = {};
  return {
    mode: raw.mode === 'list' ? 'list' : 'single',
    strategy: raw.strategy === 'random' ? 'random' : 'round',
    category: typeof raw.category === 'string' ? raw.category.slice(0, 200) : '',
    start: validDate(raw.start),
    end: validDate(raw.end),
    excludeRecent: raw.excludeRecent === true,
    recallDate: validDate(raw.recallDate) || dayKey(new Date()),
    period: [1, 3, 6, 12].includes(raw.period) ? raw.period : 12,
  };
}

/** Shared by random and anniversary views; no IDs or listener ownership outside this module. */
export function recollectionModeSelector(mode = 'single') {
  return (
    '<div class="recollection-mode" role="group" aria-label="阅读方式">' +
    [
      ['single', '单篇阅读'],
      ['list', '列表'],
    ]
      .map(
        ([value, label]) =>
          '<button type="button" data-recollection-mode="' +
          value +
          '" aria-pressed="' +
          (mode === value) +
          '">' +
          label +
          '</button>',
      )
      .join('') +
    '</div>'
  );
}

export function createRecollection(c) {
  const esc = c.escape;
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {};
  } catch {
    /* Optional browser state. */
  }
  let preferences = normalizeRecollectionPreferences(stored.preferences);
  let session = normalizeRecollectionSession(stored.session);
  let recallId = typeof stored.recallId === 'string' ? stored.recallId.slice(0, 200) : '';
  let generation = 0;
  let busy = false;

  function save() {
    try {
      // A very large round stays in memory; capped persistence never truncates its visited set.
      const savedSession = session.deck.length <= 5000 ? normalizeRecollectionSession(session) : {};
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ version: 1, preferences, session: savedSession, recallId }),
      );
    } catch {
      /* Storage can be disabled/full without interrupting reading. */
    }
  }
  function eligible(view) {
    const entries = c.library.entries;
    if (view === 'recall')
      return recall(entries, {
        date: preferences.recallDate + 'T12:00:00',
        period: preferences.period,
        categories: preferences.category ? [preferences.category] : [],
      });
    return recollectionEntries(entries, preferences);
  }
  function cards(entries) {
    const media = new Map(c.library.media.map((m) => [m.id, m]));
    return entries
      .map((entry) => {
        const first = (entry.attachments || [])
          .map((id) => media.get(id))
          .find((m) => m?.type?.startsWith('image/'));
        return (
          '<article class="recollection-card">' +
          (first
            ? '<img loading="lazy" src="/media/' +
              encodeURIComponent(first.id) +
              '" alt="' +
              esc(first.name || '日记图片') +
              '">'
            : '') +
          '<div><small>' +
          esc(dayKey(entry.date)) +
          ' · ' +
          esc(entry.category || '未分类') +
          '</small><h3>' +
          esc(entry.title || '无标题日记') +
          '</h3><p>' +
          esc(c.textOf(entry.content || '').slice(0, 300)) +
          '</p><button class="secondary" data-open-entry="' +
          esc(entry.id) +
          '">打开日记</button></div></article>'
        );
      })
      .join('');
  }
  function render(view, root) {
    if (!['memories', 'recall'].includes(view)) return false;
    const ticket = ++generation;
    busy = false;
    c.releaseEntryReader();
    const entries = eligible(view);
    let listLimit = RECOLLECTION_PAGE_SIZE;
    let shownIds = entries.slice(0, listLimit).map((entry) => entry.id);
    const ids = entries.map((entry) => entry.id);
    let currentId;
    if (view === 'memories') {
      reconcileRecollection(session, ids);
      currentId =
        session.history[session.cursor] || advanceRecollection(session, ids, preferences.strategy);
    } else {
      recallId = ids.includes(recallId) ? recallId : ids[0] || '';
      currentId = recallId;
    }
    save();
    const currentIndex = ids.indexOf(currentId);
    const categoryOptions = [
      ...new Set([preferences.category, ...(c.library.categories || [])]),
    ].filter(Boolean);
    const scope = preferences.category || '全部分类';
    const description =
      view === 'memories'
        ? preferences.strategy === 'round'
          ? '每轮打乱，不重复漫游；新一轮避开刚看过的一篇。'
          : '每次重新抽取；有多篇时避开紧邻重复，其他日记可以再次出现。'
        : '同一日号，间隔为所选周期的整数倍；排除当天和未来，闰日只匹配实际的 2 月 29 日。';
    const progress =
      view === 'recall'
        ? currentIndex + 1 + ' / ' + ids.length
        : preferences.strategy === 'round'
          ? '第 ' +
            session.round +
            ' 轮 · 已抽 ' +
            Math.max(0, session.index + 1) +
            ' / ' +
            ids.length
          : '随手一页 · 范围 ' + ids.length + ' 篇';
    root.innerHTML =
      '<section class="recollection-workspace"><header class="recollection-heading"><div><h2>' +
      (view === 'recall' ? '往日此时' : '拾光回顾') +
      '</h2><p>' +
      description +
      '</p></div>' +
      recollectionModeSelector(preferences.mode) +
      '</header>' +
      '<details class="recollection-range"><summary>范围：' +
      esc(scope) +
      (view === 'recall'
        ? ' · ' + preferences.recallDate + ' · 每 ' + preferences.period + ' 个月'
        : '') +
      ' · ' +
      ids.length +
      ' 篇' +
      (view === 'memories' && (preferences.start || preferences.end)
        ? ' · ' + esc(preferences.start || '最早') + ' 至 ' + esc(preferences.end || '现在')
        : '') +
      (view === 'memories' && preferences.excludeRecent ? ' · 排除最近 7 天' : '') +
      '</summary><div class="recollection-filters">' +
      '<label>分类<select data-recollection-pref="category"><option value="">全部分类</option>' +
      categoryOptions
        .map(
          (name) =>
            '<option value="' +
            esc(name) +
            '"' +
            (name === preferences.category ? ' selected' : '') +
            '>' +
            esc(name) +
            '</option>',
        )
        .join('') +
      '</select></label>' +
      (view === 'memories'
        ? '<label>抽取方式<select data-recollection-pref="strategy"><option value="round"' +
          (preferences.strategy === 'round' ? ' selected' : '') +
          '>不重复漫游</option><option value="random"' +
          (preferences.strategy === 'random' ? ' selected' : '') +
          '>随手一页</option></select></label><label>开始日期<input type="date" data-recollection-pref="start" value="' +
          preferences.start +
          '"></label><label>结束日期<input type="date" data-recollection-pref="end" value="' +
          preferences.end +
          '"></label><label class="recollection-checkbox"><input type="checkbox" data-recollection-pref="excludeRecent"' +
          (preferences.excludeRecent ? ' checked' : '') +
          '>排除最近 7 天</label>'
        : '<label>回顾日期<input type="date" data-recollection-pref="recallDate" value="' +
          preferences.recallDate +
          '"></label><label>周期<select data-recollection-pref="period">' +
          [
            [1, '每月'],
            [3, '每三个月'],
            [6, '每半年'],
            [12, '每年'],
          ]
            .map(
              ([n, label]) =>
                '<option value="' +
                n +
                '"' +
                (n === preferences.period ? ' selected' : '') +
                '>' +
                label +
                '</option>',
            )
            .join('') +
          '</select></label>') +
      '</div><small>排除隐藏、草稿和回收站；范围与阅读方式仅在当前浏览器保存。</small></details>' +
      (preferences.mode === 'single'
        ? '<nav class="recollection-controls" aria-label="回顾翻页"><button class="secondary" data-recollection-action="previous"' +
          ((view === 'memories' ? session.cursor <= 0 : currentIndex <= 0) ? ' disabled' : '') +
          '>上一篇</button><span role="status">' +
          progress +
          '</span><button class="primary" data-recollection-action="next"' +
          (!ids.length || (view === 'recall' && currentIndex >= ids.length - 1)
            ? ' disabled'
            : '') +
          '>' +
          (view === 'memories' &&
          preferences.strategy === 'round' &&
          session.index === ids.length - 1 &&
          session.cursor === session.history.length - 1
            ? '开始下一轮'
            : '下一篇') +
          '</button>' +
          (view === 'memories'
            ? '<button class="secondary" data-recollection-action="restart"' +
              (!ids.length ? ' disabled' : '') +
              '>重新开始</button>'
            : '') +
          '</nav>'
        : '') +
      (ids.length
        ? preferences.mode === 'single'
          ? '<div class="recollection-reader-host" data-recollection-host></div>'
          : '<div class="recollection-list">' +
            cards(entries.slice(0, listLimit)) +
            '</div><footer class="recollection-list-footer"><span role="status" data-recollection-count>已显示 ' +
            Math.min(listLimit, entries.length) +
            ' / ' +
            entries.length +
            ' 篇</span><button class="secondary" data-recollection-more' +
            (entries.length <= listLimit ? ' hidden' : '') +
            '>再显示 ' +
            Math.min(RECOLLECTION_PAGE_SIZE, entries.length - listLimit) +
            ' 篇</button></footer>'
        : '<div class="recollection-empty"><h3>这个范围还没有可以回顾的日记</h3><p>展开范围，试试其他分类或日期。</p></div>') +
      '</section>';
    const frame = root.querySelector('.recollection-workspace');
    const active = () => ticket === generation && frame.isConnected && root.contains(frame);
    const transition = async (fn) => {
      if (busy || !active()) return;
      busy = true;
      frame.setAttribute('aria-busy', 'true');
      frame.inert = true;
      try {
        await c.flush();
        if (!active()) return;
        await fadeRecollectionOut(
          frame.querySelector('.recollection-reader-host, .recollection-list'),
        );
        if (!active()) return;
        fn();
        save();
        render(view, root);
      } catch (error) {
        if (active()) {
          frame.querySelectorAll('[data-recollection-pref]').forEach((input) => {
            const key = input.dataset.recollectionPref;
            if (input.type === 'checkbox') input.checked = preferences[key];
            else input.value = preferences[key];
          });
          c.toast(error.message || '保存未完成，请重试');
        }
      } finally {
        if (active()) {
          busy = false;
          frame.removeAttribute('aria-busy');
          frame.inert = false;
        }
      }
    };
    frame.querySelectorAll('[data-recollection-mode]').forEach((button) => {
      button.onclick = () =>
        transition(() => {
          preferences.mode = button.dataset.recollectionMode;
        });
    });
    frame.querySelectorAll('[data-recollection-pref]').forEach((input) => {
      input.onchange = () => {
        const key = input.dataset.recollectionPref;
        const value =
          input.type === 'checkbox'
            ? input.checked
            : key === 'period'
              ? Number(input.value)
              : input.value;
        const next = normalizeRecollectionPreferences({ ...preferences, [key]: value });
        if (next.start && next.end && next.start > next.end) {
          c.toast('开始日期不能晚于结束日期');
          input.value = preferences[key];
          return;
        }
        return transition(() => {
          preferences = next;
          session = normalizeRecollectionSession();
          recallId = '';
        });
      };
    });
    frame.querySelectorAll('[data-recollection-action]').forEach((button) => {
      button.onclick = () =>
        transition(() => {
          const freshIds = eligible(view).map((entry) => entry.id);
          if (view === 'memories') {
            reconcileRecollection(session, freshIds);
            if (button.dataset.recollectionAction === 'previous')
              session.cursor = Math.max(0, session.cursor - 1);
            else if (button.dataset.recollectionAction === 'restart')
              restartRecollection(session, freshIds);
            else advanceRecollection(session, freshIds, preferences.strategy);
          } else {
            const index = freshIds.indexOf(recallId);
            recallId =
              freshIds[
                Math.max(
                  0,
                  Math.min(
                    freshIds.length - 1,
                    index + (button.dataset.recollectionAction === 'previous' ? -1 : 1),
                  ),
                )
              ] || '';
          }
        });
    });
    const more = frame.querySelector('[data-recollection-more]');
    if (more)
      more.onclick = () => {
        if (busy || !active()) return;
        const fresh = eligible(view);
        listLimit += RECOLLECTION_PAGE_SIZE;
        const list = frame.querySelector('.recollection-list');
        const scrollTop = list.scrollTop;
        if (shownIds.every((id, index) => fresh[index]?.id === id)) {
          list.insertAdjacentHTML('beforeend', cards(fresh.slice(shownIds.length, listLimit)));
        } else {
          list.innerHTML = cards(fresh.slice(0, listLimit));
        }
        shownIds = fresh.slice(0, listLimit).map((entry) => entry.id);
        list.scrollTop = scrollTop;
        frame.querySelector('[data-recollection-count]').textContent =
          '已显示 ' + Math.min(listLimit, fresh.length) + ' / ' + fresh.length + ' 篇';
        more.hidden = listLimit >= fresh.length;
        more.textContent =
          '再显示 ' +
          Math.min(RECOLLECTION_PAGE_SIZE, Math.max(0, fresh.length - listLimit)) +
          ' 篇';
      };
    const host = frame.querySelector('[data-recollection-host]');
    if (host && currentId) {
      // Entry-reader mounting owns the single editor, gallery and comment instances.
      Promise.resolve()
        .then(async () => {
          if (!active() || !eligible(view).some((entry) => entry.id === currentId)) return;
          const mounted = await c.mountEntryReader(host, currentId);
          if (mounted === false && active()) render(view, root);
        })
        .catch((error) => {
          if (active()) c.toast(error.message || '日记暂时无法打开');
        });
    }
    return true;
  }
  return { render };
}
