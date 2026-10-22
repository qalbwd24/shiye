import { createQuickDocumentEditor } from '../editor/quick-document-editor.js';
import { createCategoryPicker } from '../features/category-picker.js';
import { installTitleNavigation } from '../features/title-navigation.js';
import { createEntrySave } from '../features/entry-save.js';
import { createWindowRefresh } from '../features/window-refresh.js';
import { chooseEntryConflict } from '../features/entry-conflict-dialog.js';
import { installQuickCapture } from '../features/quick-capture-window.js';
import { createQuickResumePosition } from '../features/quick-resume-position.js';
import { hasQuickContent } from '../shared/quick-capture.js';
import { getEditorDocument } from '../shared/editor-document.js';
import { richMediaReferences } from '../shared/rich-document.js';
import { capturePastedFiles } from '../core/clipboard-files.js';
import { createPersistence } from '../editor/persistence.js';
import { createMediaImport } from '../features/media-import.js';
import { sortedTaxonomy } from '../shared/taxonomy.js';
import { createEditorCommands } from '../editor/commands.js';
import { coverMarkup } from '../features/entry-cards.js';
import { createReturnNavigation, restoreBrowsePosition } from '../features/return-navigation.js';
import { createLegacyBackups } from '../features/legacy-backups.js';
import { download } from '../core/downloads.js';
import { LIMITS } from '../shared/limits.js';
import { dateParts, formatZoned, parseZonedInput } from '../shared/time-zone.js';
import {
  $,
  $$,
  escape,
  sanitize,
  textOf,
  dateText,
  timeText,
  localDate,
  inputDate,
} from '../core/dom.js';
import { icon, icons } from '../core/icons.js';
import { api, uploadLegacyFile } from '../core/api.js';
import { installOffline } from '../features/index.js';
import { isHidden } from '../shared/insights.js';
let offline;
let quickWindow;
let windowRefresh;
const launchParams = new URLSearchParams(location.search);
const isQuick = launchParams.get('quick') === '1';
let richQuickAvailable = false;
let lastInlineAssets = '';
document.body.classList.toggle('quick-capture', isQuick);
const categoryPicker = createCategoryPicker({ getLibrary: () => library });
let freezeCount = 0;
function freezeEditor() {
  freezeCount++;
  $('#editorPanel').inert = true;
  return () => {
    freezeCount--;
    $('#editorPanel').inert = freezeCount > 0;
  };
}
const saveEntry = createEntrySave({
  api,
  freeze: freezeEditor,
  chooseConflict: chooseEntryConflict,
  toast,
});

import {
  commands,
  chord,
  binding,
  conflicts,
  match,
  effectiveShortcuts,
  pausedShortcut,
} from '../shared/hotkeys.js';

let library = { entries: [], categories: [], media: [], imports: [] },
  selected = null,
  view = 'all',
  category = null,
  tag = null,
  day = null,
  ascending = false,
  query = '',
  calendarDate = new Date();
let calendarInitialized = false;
let listLimit = LIMITS.pageEntries;
let detailEntry = null;
let recordingShortcut = null,
  shortcutQuery = '';
const storedShortcuts = () => library.settings?.shortcuts || {};
const extendedShortcuts = () => library.settings?.preferences?.extendedShortcuts === true;
const shortcuts = () => effectiveShortcuts(storedShortcuts(), extendedShortcuts());

const persistence = createPersistence({
  saveEntry,
  async onIdentity(entry, oldId) {
    if (selected === oldId) selected = entry.id;
    bodyEditor.syncIdentity(entry, oldId);
    if (!oldId.startsWith('draft-')) {
      entry._captureToken = null;
      const original = await api('/api/entries/' + oldId);
      if (!library.entries.some((e) => e.id === oldId)) library.entries.push(original);
    }
  },
  async onEntrySaved(entry, saved) {
    if (isQuick && hasQuickContent(saved))
      await api('/api/quick-history', { method: 'POST', data: { entryId: saved.id } });
    if (current() === entry && document.activeElement?.closest?.('#editorPanel') === null)
      renderEditor();
    syncChannel?.postMessage({ type: 'saved', id: saved.id });
  },
  api,
  sanitize,
  status,
  toast,
  current,
  onDirty() {
    countWords();
    const entry = current();
    const assets =
      entry?.contentFormat === 'richdoc'
        ? JSON.stringify([entry.id, richMediaReferences(entry.body).map((image) => image.assetId)])
        : '';
    if (assets !== lastInlineAssets) {
      lastInlineAssets = assets;
      renderAttachments();
    }
    windowRefresh?.invalidate();
  },
  onContentChanged: countWords,
  syncEditor: (entry, options) => bodyEditor.commit(options),
  onSaved() {
    renderList();
    renderSide();
    windowRefresh?.resume();
  },
});
const { markDirty, flush } = persistence;
const syncChannel =
  typeof BroadcastChannel === 'function' ? new BroadcastChannel('shiye.windows.v1') : null;
const editorCommands = createEditorCommands({ $, sanitize, current, markDirty });
const bodyEditor = createQuickDocumentEditor(
  {
    $,
    sanitize,
    escape,
    modal,
    closeModal,
    toast,
    current,
    markDirty,
    flush,
    pause: persistence.pause,
    get library() {
      return library;
    },
    upload: (...args) => upload(...args),
  },
  { richNewDocuments: () => richQuickAvailable },
);
function command(name, value) {
  if (!bodyEditor.command(name, value)) editorCommands.command(name, value);
}

const returnNavigation = createReturnNavigation({
  prepare: async () => {
    await flush();
    await offline?.readingMode();
  },
  capture() {
    const root = $('#alternateView');
    const labels = {
      memories: '拾光回顾',
      recall: '往日此时',
      gallery: '相册',
      calendar: '日历',
      places: '地点',
      stats: '记录统计',
    };
    return {
      label: labels[view] || $('#viewTitle').textContent.replace(/\.$/, ''),
      view,
      category,
      tag,
      day,
      query,
      ascending,
      selected,
      listLimit,
      calendarDate: new Date(calendarDate),
      browsing: offline.captureNavigation(),
      scrollTop: root.scrollTop,
      listScrollTop: root.querySelector('.recollection-list')?.scrollTop || 0,
      details: [...root.querySelectorAll('details')].map((element) => element.open),
      entryId: document.activeElement?.closest('[data-open-entry]')?.dataset.openEntry,
    };
  },
  restore(source) {
    detailEntry = null;
    ({ view, category, tag, day, query, ascending, selected, listLimit } = source);
    calendarDate = new Date(source.calendarDate);
    $('#search').value = query;
    offline.restoreNavigation(source.browsing);
    renderView();
    const root = $('#alternateView');
    root.querySelectorAll('details').forEach((element, index) => {
      element.open = !!source.details[index];
    });
    const frame = root.firstElementChild;
    restoreBrowsePosition(
      root,
      source,
      () =>
        view === source.view &&
        !root.classList.contains('hidden') &&
        root.firstElementChild === frame,
    );
    requestAnimationFrame(() => {
      if (
        view !== source.view ||
        root.classList.contains('hidden') ||
        root.firstElementChild !== frame
      )
        return;
      const anchor = [...root.querySelectorAll('[data-open-entry]')].find(
        (element) => element.dataset.openEntry === source.entryId,
      );
      anchor?.focus({ preventScroll: true });
    });
  },
  update(source, busy) {
    const button = $('#returnToBrowse');
    button.hidden = !source;
    button.disabled = busy;
    button.textContent = source ? '← 返回' + source.label : '← 返回';
  },
});

const mediaImport = createMediaImport({
  editor: bodyEditor,
  $,
  escape,
  toast,
  current,
  get library() {
    return library;
  },
  markDirty,
  flush,
  renderAttachments,
});
const { upload } = mediaImport;

function toast(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $('#toast').classList.remove('show'), 3600);
}
function status(text, error = false) {
  $('#saveStatus').textContent = text;
  $('#saveStatus').classList.toggle('error', error);
}
async function refreshLibrary() {
  await flush();
  applyLibrary(await api('/api/library'));
}
function applyLibrary(nextLibrary) {
  const previous = library.entries;
  library = nextLibrary;
  for (const entry of previous) {
    if (entry._unsaved) library.entries.unshift(entry);
    else if (entry._captureToken) {
      const next = library.entries.find((e) => e.id === entry.id);
      if (next) next._captureToken = entry._captureToken;
    }
  }
  offline?.apply();
  if (!calendarInitialized) {
    const p = dateParts(new Date());
    calendarDate = new Date(+p.year, +p.month - 1, 1);
    calendarInitialized = true;
  }
  renderSide();
}
function current() {
  return library.entries.find((e) => e.id === selected);
}
function renderSide() {
  const live = library.entries.filter((e) => !e._unsaved && !e.deleted && !e.draft && !isHidden(e));
  $('#allCount').textContent = live.length;
  $('#allEntries').classList.toggle('active', view === 'all' && !category && !tag);
  const colors = ['#72b8b7', '#b8a4cc', '#d1b67f', '#8fadcd', '#c49c96'];
  $('#categories').innerHTML = sortedTaxonomy(library, 'category')
    .map((i) => i.name)
    .map(
      (c, i) =>
        `<button class="category-item ${category === c ? 'active' : ''}" data-category="${escape(c)}"><span class="category-dot" style="--dot:${colors[i % colors.length]}"></span>${escape(c)}<span class="count">${live.filter((e) => e.category === c).length}</span></button>`,
    )
    .join('');
  const tags = sortedTaxonomy(library, 'tag').map((i) => i.name);
  $('#tagCloud').innerHTML = tags
    .map(
      (t) =>
        `<button class="${t === tag ? 'active' : ''}" data-tag="${escape(t)}"># ${escape(t)}</button>`,
    )
    .join('');
  $$('#navigation [data-view]').forEach((e) =>
    e.classList.toggle('active', e.dataset.view === view && !category && !tag),
  );
}
function filtered() {
  return library.entries
    .filter(
      (e) =>
        !e._unsaved &&
        (view === 'trash'
          ? e.deleted
          : view === 'hidden'
            ? !e.deleted && isHidden(e)
            : view === 'drafts'
              ? !e.deleted && e.draft
              : !e.deleted && !e.draft && !isHidden(e)) &&
        (offline?.filter(e) ?? true) &&
        (!category || e.category === category) &&
        (!tag || e.tags.includes(tag)) &&
        (!day || localDate(e.date) === day) &&
        (!query ||
          [e.title, textOf(e.content), e.location, ...e.tags]
            .join(' ')
            .toLowerCase()
            .includes(query)),
    )
    .sort(
      (a, b) =>
        Number(b.pinned) -
        Number(a.pinned) +
        (Number(b.pinned) === Number(a.pinned)
          ? (offline?.prefs().sort === 'oldest' || ascending ? 1 : -1) *
            (new Date(offline?.prefs().sort === 'updated' ? a.updatedAt : a.date) -
              new Date(offline?.prefs().sort === 'updated' ? b.updatedAt : b.date))
          : 0),
    );
}
function renderList() {
  const entries = filtered();
  const mediaById = new Map(library.media.map((media) => [media.id, media]));
  const listName =
    day ||
    category ||
    (tag
      ? '# ' + tag
      : { trash: '回收站', drafts: '草稿箱', hidden: '隐藏日记' }[view] || '全部日记');
  const listLabel = $('#listToggleLabel');
  if (listLabel) {
    listLabel.textContent = listName;
    const toggle = $('#listToggle');
    const description =
      (toggle.getAttribute('aria-expanded') === 'true' ? '折叠' : '展开') + listName;
    toggle.setAttribute('aria-label', description);
    toggle.title = description;
  }
  $('#listSubtitle').textContent = day
    ? `${day} · ${entries.length} 篇`
    : `${category || (tag ? '# ' + tag : view === 'trash' ? '回收站' : '最近的记录')} · ${entries.length} 篇`;
  let month = '';
  $('#entryList').innerHTML =
    entries
      .slice(0, listLimit)
      .map((e) => {
        const d = dateParts(e.date),
          m = `${d.year} 年 ${Number(d.month)} 月`,
          heading = m !== month ? `<div class="month-label">${m}</div>` : '';
        month = m;
        return (
          heading +
          `<button class="entry-card ${e.id === selected ? 'active' : ''}" data-entry="${e.id}">${coverMarkup(e, mediaById, escape)}<div class="card-date"><strong>${d.day}</strong>${formatZoned(e.date, { weekday: 'short' })} · ${timeText(e.date)}<span class="card-weather">${escape(e.weather)}</span></div><h3>${escape(e.title || '无标题日记')}</h3>${offline?.prefs().showPreview === false ? '' : `<p>${escape(textOf(e.content).slice(0, 240) || '留一点空间，给今天的故事。')}</p>`}<div class="card-bottom"><span class="small-chip">${escape(e.category)}</span>${e.tags[0] ? `<span># ${escape(e.tags[0])}</span>` : ''}${e.pinned ? icon('pin') : e.attachments.length ? icon('image') : ''}${(library.conflicts || []).some((item) => item.kind === 'entry' && item.status === 'open' && [item.left, item.right].includes(e.id)) ? '<span class="conflict-badge">待核对</span>' : ''}</div></button>`
        );
      })
      .join('') || '<div class="empty-list">这里还没有记录<br>换个关键词，或写下新的一页。</div>';
  if (entries.length > listLimit)
    $('#entryList').insertAdjacentHTML(
      'beforeend',
      `<button class="secondary" id="loadMoreEntries">再显示 100 篇（共 ${entries.length} 篇）</button>`,
    );
  if ($('#loadMoreEntries'))
    $('#loadMoreEntries').onclick = () => {
      listLimit += LIMITS.pageEntries;
      renderList();
    };
}
function ensureOption(select, value) {
  if (value && ![...select.options].some((o) => o.value === value)) {
    const o = new Option(value, value);
    select.add(o);
  }
  select.value = value || '';
}
function renderEditor() {
  const e = current();
  if (e) persistence.observe(e);
  offline?.readingPosition.select(e?.id || null);
  $('#editorWrap').classList.toggle('hidden', !e);
  $('#editorEmpty').classList.toggle('hidden', !!e);
  offline?.comments.render(e);
  if (!e) {
    bodyEditor.render({ content: '', deleted: true });
    offline?.entryReading.render(null);
    renderAttachments();
    return;
  }
  $('#entryDateline').textContent =
    window.innerWidth < 650
      ? '‹ 返回列表'
      : dateText(e.date) + ' · ' + formatZoned(e.date, { weekday: 'long' });
  $('#entryCategory').innerHTML = sortedTaxonomy(library, 'category')
    .map((item) => item.name)
    .map((c) => `<option>${escape(c)}</option>`)
    .join('');
  ensureOption($('#entryCategory'), e.category);
  $('#entryDate').value = inputDate(e.date);
  $('#entryTitle').value = e.title;
  $('#entryLocation').value = e.location || '';
  $('#entryTags').value = e.tags.join('，');
  ensureOption($('#entryWeather'), e.weather);
  ensureOption($('#entryMood'), e.mood);
  bodyEditor.render(e);
  offline?.entryReading.render(e);
  $('#demoBadge').textContent = e.demo ? '体验示例' : e.legacy ? '旧格式导入' : '';
  $('#demoBadge').classList.toggle('hidden', !e.demo && !e.legacy);
  $('#pinButton').classList.toggle('active', e.pinned);
  $('#entryCover').classList.toggle('hidden', !e.cover);
  $('#entryCover').classList.toggle('evening', e.cover === 'evening');
  $('#footerDate').textContent = '';
  status(
    e.deleted
      ? '在回收站 · 可恢复'
      : e._unsaved
        ? '尚未输入 · 空白不会保存'
        : persistence.pending
          ? '正在保存…'
          : '已保存到本地',
  );
  countWords();
  renderAttachments();
  editorCommands.resetSelection();
  for (const id of [
    'entryTitle',
    'entryDate',
    'entryCategory',
    'entryWeather',
    'entryMood',
    'entryLocation',
    'entryTags',
  ])
    $('#' + id).disabled = e.deleted;
}
function renderAttachments() {
  offline?.gallery.render(current());
}
function countWords() {
  $('#wordCount').textContent =
    Array.from(textOf(current()?.content || '').replace(/\s/g, '')).length + ' 字';
}
async function openPreviewEntry(id, active) {
  await flush();
  await offline?.readingMode();
  if (
    !active() ||
    !library.entries.some(
      (entry) => entry.id === id && !entry.deleted && !entry.draft && !isHidden(entry),
    )
  )
    return false;
  selected = id;
  renderEditor();
  return true;
}
async function selectEntry(id) {
  await finishCurrent();
  await offline?.readingMode();
  selected = id;
  detailEntry = null;
  $('#journalView').classList.add('has-selected');
  renderList();
  renderEditor();
}
async function withLibraryMutation(action) {
  const editor = $('#editorPanel');
  editor.inert = true;
  try {
    await flush();
    return await action();
  } finally {
    editor.inert = false;
  }
}
async function newEntry(date = new Date(), initial = {}) {
  await finishCurrent();
  const chosenCategory = initial._confirmedCategory || (await categoryPicker.open());
  if (chosenCategory === null) return false;
  library.entries = library.entries.filter((entry) => !entry._unsaved);
  returnNavigation.clear();
  detailEntry = null;
  if (offline?.prefs().nightYesterday && +dateParts(date).hour < 4) {
    const p = dateParts(date);
    const previous = new Date(Date.UTC(+p.year, +p.month - 1, +p.day - 1))
      .toISOString()
      .slice(0, 10);
    date = parseZonedInput(`${previous}T${p.hour}:${p.minute}:${p.second}`);
  }
  const boundTemplate = library.templates?.find((t) => !t.deleted && t.category === chosenCategory);
  view = 'all';
  day = null;
  category = null;
  tag = null;
  query = '';
  $('#search').value = '';
  const token = crypto.randomUUID();
  const e = {
    id: 'draft-' + token,
    revision: 0,
    history: [],
    _unsaved: true,
    _captureToken: token,
    title: '',
    ...bodyEditor.newDocument(
      boundTemplate?.content || '',
      offline.prefs().autoIndentParagraph !== false,
    ),
    date: date.toISOString(),
    category: chosenCategory,
    tags: initial.tags || [],
    attachments: [],
    weather: '',
    mood: '',
    location: '',
  };
  if (e.contentFormat === 'richdoc')
    e.attachments = [...new Set(richMediaReferences(e.body).map((image) => image.assetId))];
  library.entries.unshift(e);
  selected = e.id;
  renderView();
  $('#journalView').classList.add('has-selected');
  bodyEditor.focus();
  return true;
}
async function finishCurrent() {
  await mediaImport.settle();
  await flush();
  const entry = current();
  if (
    entry &&
    !entry._unsaved &&
    entry._captureToken &&
    !hasQuickContent(entry) &&
    !entry.deleted
  ) {
    const saved = await api('/api/quick-entries/' + entry.id + '/discard-empty', {
      method: 'POST',
      data: { clientToken: entry._captureToken, expectedRevision: entry.revision },
    });
    Object.assign(entry, saved);
  }
}
async function changeView(next) {
  await finishCurrent();
  returnNavigation.clear();
  detailEntry = null;
  view = next;
  listLimit = LIMITS.pageEntries;
  category = null;
  tag = null;
  day = null;
  renderView();
}
async function filterView({ category: cat = null, tag: t = null } = {}) {
  await finishCurrent();
  returnNavigation.clear();
  detailEntry = null;
  await offline?.showList();
  view = 'all';
  category = cat;
  tag = t;
  day = null;
  query = '';
  $('#search').value = '';
  renderView();
}
function renderView({ preserveEntry = false } = {}) {
  offline?.releaseEntryReader();
  const journal = ['all', 'trash', 'drafts', 'hidden'].includes(view);
  $('#journalView').classList.toggle('hidden', !journal);
  $('#alternateView').classList.toggle('hidden', journal);
  const titles = {
    all: category || (tag ? '# ' + tag : '我的日记'),
    trash: '回收站',
    calendar: '日历',
    gallery: '相册',
    memories: '拾光回顾',
    stats: '记录统计',
    organization: '分类与标签',
    conflicts: '重复与冲突',
    recall: '往日此时',
    places: '地点',
    drafts: '草稿箱',
    hidden: '隐藏日记',
  };
  $('#viewTitle').innerHTML = escape(titles[view]) + '<span class="heading-dot">.</span>';
  renderSide();
  if (journal) {
    const openedDetail =
      view === 'all' &&
      selected === detailEntry &&
      library.entries.some(
        (entry) => entry.id === detailEntry && !entry.deleted && !entry.draft && !isHidden(entry),
      );
    if (
      !preserveEntry &&
      !current()?._unsaved &&
      !openedDetail &&
      !filtered().some((e) => e.id === selected)
    )
      selected = filtered()[0]?.id || null;
    renderList();
    renderEditor();
  } else renderAlternate();
}
function renderAlternate() {
  offline?.releaseEntryReader();
  const root = $('#alternateView');
  if (offline?.render(view, root)) return;
  const live = library.entries.filter((e) => !e.deleted && !e.draft && !isHidden(e));
  if (view === 'calendar') {
    const y = calendarDate.getFullYear(),
      m = calendarDate.getMonth(),
      first = new Date(y, m, 1),
      start = new Date(y, m, 1 - ((first.getDay() - (offline?.prefs().firstWeekday ?? 1) + 7) % 7));
    root.innerHTML = `<div class="alt-heading"><div><h2>${y} 年 ${m + 1} 月</h2><p>每一个有记录的日子，都有迹可循。</p></div><div><button class="icon-button" id="prevMonth">‹</button><button class="secondary" id="todayMonth">今天</button><button class="icon-button" id="nextMonth">›</button></div></div><div class="calendar-grid">${(offline?.prefs().firstWeekday === 0 ? ['日', '一', '二', '三', '四', '五', '六'] : ['一', '二', '三', '四', '五', '六', '日']).map((d) => `<div class="weekday">周${d}</div>`).join('')}${Array.from(
      { length: 42 },
      (_, i) => {
        const d = new Date(start);
        d.setDate(d.getDate() + i);
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
          entries = live.filter((e) => localDate(e.date) === iso);
        return `<button class="calendar-day ${d.getMonth() !== m ? 'outside' : ''} ${iso === localDate(new Date()) ? 'today' : ''}" data-day="${iso}"><strong>${d.getDate()}</strong>${entries
          .slice(0, 2)
          .map((e) => `<small>${escape(e.title || '无标题日记')}</small>`)
          .join(
            '',
          )}${entries.length > 2 ? `<small>还有 ${entries.length - 2} 篇</small>` : ''}</button>`;
      },
    ).join('')}</div>`;
    $('#prevMonth').onclick = () => {
      calendarDate = new Date(y, m - 1, 1);
      renderAlternate();
    };
    $('#nextMonth').onclick = () => {
      calendarDate = new Date(y, m + 1, 1);
      renderAlternate();
    };
    $('#todayMonth').onclick = () => {
      const p = dateParts(new Date());
      calendarDate = new Date(+p.year, +p.month - 1, 1);
      renderAlternate();
    };
  } else if (view === 'stats') {
    const chars = live.reduce((n, e) => n + textOf(e.content).replace(/\s/g, '').length, 0),
      days = new Set(live.map((e) => localDate(e.date))).size;
    root.innerHTML = `<div class="alt-heading"><div><h2>记录是一件慢慢积累的事</h2><p>基础统计，包含体验示例，排除回收站。文字按正文去除空白后的长度计数；尚未与原版全部统计口径对齐。</p></div></div><div class="stat-cards"><div class="stat-card"><small>写下的日记</small><strong>${live.length}<small> 篇</small></strong></div><div class="stat-card"><small>留下的文字</small><strong>${chars.toLocaleString()}<small> 字</small></strong></div><div class="stat-card"><small>有记录的日子</small><strong>${days}<small> 天</small></strong></div></div><div class="stat-panel"><h3>生活的不同侧面</h3>${library.categories
      .map((c) => {
        const n = live.filter((e) => e.category === c).length;
        return `<div class="bar-row"><span>${escape(c)}</span><div class="bar-track"><div style="width:${live.length ? (n / live.length) * 100 : 0}%"></div></div><small>${n} 篇</small></div>`;
      })
      .join('')}</div>`;
  } else {
    root.innerHTML = '<p class="empty">请选择一个日记视图。</p>';
  }
}
function modal(title, html) {
  $('#modal').dispatchEvent(new Event('modalreplace'));
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = html;
  icons($('#modalBody'));
  $('#modal').showModal();
}
function closeModal() {
  recordingShortcut = null;
  $('#modal').close();
}
function insertDate() {
  offline.editorInput.insertDateTime();
}
async function showHistory() {
  await flush();
  const e = current();
  if (!e) return;
  modal(
    '编辑历史',
    e.history.length
      ? `<p>保留最近 20 次保存。恢复会再创建一个版本。</p>${e.history.map((h, i) => `<button class="option-button" data-history="${i}">${dateText(h.updatedAt)} ${timeText(h.updatedAt)}<small>${escape(h.title || '无标题日记')} · ${textOf(h.content).length} 字</small></button>`).join('')}`
      : '<p>这篇日记还没有历史版本。开始编辑后会自动保留。</p>',
  );
}
function more() {
  const e = current();
  if (!e) return;
  modal(
    '这一页',
    `<button class="option-button" id="exportEntry">导出这一页为 HTML<small>保留正文格式；附件包含在完整加密备份中</small></button>${e.legacy ? '<button class="option-button" id="showLegacy">查看原始字段与媒体核对信息<small>原始字段保留，便于兼容与迁移</small></button>' : ''}<button class="option-button ${e.deleted ? '' : 'danger'}" id="toggleDeleted">${e.deleted ? '从回收站恢复' : '移入回收站'}<small>${e.deleted ? '恢复到全部日记' : '可以恢复，不会永久删除媒体文件'}</small></button>`,
  );
  $('#exportEntry').onclick = async () => {
    await flush();
    download(
      e.title || '日记',
      'text/html;charset=utf-8',
      `<!doctype html><meta charset="utf-8"><title>${escape(e.title)}</title><style>body{max-width:760px;margin:60px auto;font:18px/2 system-ui}blockquote{border-left:3px solid #9cc;padding-left:20px;color:#888}</style><h1>${escape(e.title)}</h1><p>${dateText(e.date)} · ${escape(e.category)}</p>${sanitize(e.content)}`,
      'html',
    );
  };
  $('#toggleDeleted').onclick = async () => {
    await flush();
    const saved = await api('/api/entries/' + e.id, {
      method: 'PUT',
      data: { ...e, deleted: !e.deleted },
    });
    Object.assign(e, saved);
    closeModal();
    selected = null;
    renderView();
    toast(e.deleted ? '已移入回收站' : '已恢复日记');
  };
  if ($('#showLegacy'))
    $('#showLegacy').onclick = () =>
      modal(
        '保留的原始数据',
        `<p>${escape(e.legacy.display === 'plain-preserving-original' ? '旧正文以原始文本显示，复杂排版尚未转换。' : '')}</p><pre class="json-preview">${escape(JSON.stringify(e.legacy, null, 2))}</pre>`,
      );
}

function updateKeyHints() {
  const map = {
    datetime: 'insertDateTime',
    indent: 'indentButton',
    template: 'templateButton',
    history: 'historyButton',
    focus: 'focusButton',
    save: 'saveButton',
    new: 'newEntry',
  };
  for (const c of commands) {
    const el = $('#' + map[c.id]);
    if (el)
      el.title = c.name + (binding(c, shortcuts()) ? '（' + binding(c, shortcuts()) + '）' : '');
  }
  $('.search-box kbd').textContent =
    binding(
      commands.find((c) => c.id === 'search'),
      shortcuts(),
    ) || '—';
  $('#newEntry kbd').textContent =
    binding(
      commands.find((c) => c.id === 'new'),
      shortcuts(),
    ) || '—';
  $('#saveButton kbd').textContent =
    binding(
      commands.find((c) => c.id === 'save'),
      shortcuts(),
    ) || '—';
  for (const kbd of document.querySelectorAll('.search-box kbd, #newEntry kbd, #saveButton kbd'))
    kbd.hidden = kbd.textContent === '—';
}
function shortcutRows() {
  const q = shortcutQuery.toLowerCase();
  $('#shortcutRows').innerHTML = commands
    .filter((c) =>
      [c.name, c.group, binding(c, shortcuts()) || ''].join(' ').toLowerCase().includes(q),
    )
    .map(
      (c) =>
        `<div class="shortcut-row"><div><strong>${escape(c.name)}</strong><small>${escape(c.group)} · ${c.scope === 'editor' ? '仅正文编辑区' : '应用内'}</small></div><button class="shortcut-key ${recordingShortcut === c.id ? 'recording' : ''}" data-record-key="${c.id}" aria-label="设置${escape(c.name)}快捷键">${recordingShortcut === c.id ? '请按快捷键…' : escape(binding(c, shortcuts()) || (extendedShortcuts() ? '未设置' : '已停用'))}</button><button class="icon-button" data-clear-key="${c.id}" aria-label="清除${escape(c.name)}快捷键">×</button><button class="icon-button" data-reset-key="${c.id}" aria-label="恢复${escape(c.name)}默认快捷键">↺</button></div>`,
    )
    .join('');
  for (const button of document.querySelectorAll('#shortcutRows button'))
    button.disabled = !extendedShortcuts();
  $('#resetAllShortcuts').disabled = !extendedShortcuts();
}
function keyboardSettings() {
  shortcutQuery = '';
  recordingShortcut = null;
  modal(
    '快捷键',
    `<p>正文 Tab／Shift＋Tab 缩进始终可用。扩展命令默认只保留 Alt＋T 插入日期时间。需要自定义其他按键时，先主动启用下方开关，再点击按键录入；Esc 取消录入。</p><input class="field" id="shortcutSearch" placeholder="搜索功能或快捷键" aria-label="搜索快捷键"><div id="shortcutNotice" role="status">正文命令只在正文内生效，输入法组词期间不会触发。</div><div id="shortcutRows"></div><div class="modal-actions"><button class="secondary" id="resetAllShortcuts">全部恢复默认</button></div>`,
  );
  $('#shortcutSearch').oninput = (e) => {
    shortcutQuery = e.target.value;
    shortcutRows();
  };
  const mode = document.createElement('label');
  mode.className = 'check-row';
  mode.innerHTML =
    '<input type="checkbox" id="enableExtendedShortcuts">启用其他应用快捷键（默认关闭）';
  $('#shortcutSearch').before(mode);
  const toggle = $('#enableExtendedShortcuts');
  toggle.checked = extendedShortcuts();
  const explain = () => {
    $('#shortcutNotice').textContent = extendedShortcuts()
      ? '其他应用快捷键已启用，使用下方保存的配置。'
      : '仅启用 Alt＋T 插入日期时间。其他应用快捷键已停用；复制、粘贴、全选、撤销和正常方向键操作保留。旧绑定已保留，勾选后才会恢复。';
  };
  toggle.onchange = async () => {
    toggle.disabled = true;
    recordingShortcut = null;
    try {
      library.settings.preferences = await api('/api/preferences', {
        method: 'PUT',
        data: { extendedShortcuts: toggle.checked },
      });
      shortcutRows();
      updateKeyHints();
      explain();
    } catch (error) {
      toggle.checked = extendedShortcuts();
      $('#shortcutNotice').textContent = error.message;
    } finally {
      toggle.disabled = false;
    }
  };
  explain();
  $('#resetAllShortcuts').onclick = async () => {
    try {
      library.settings = await api('/api/settings', { method: 'PUT', data: { shortcuts: {} } });
      shortcutRows();
      updateKeyHints();
      $('#shortcutNotice').textContent = '已恢复默认快捷键';
    } catch (e) {
      $('#shortcutNotice').textContent = e.message;
    }
  };
  shortcutRows();
}
async function setShortcut(id, value, reset = false) {
  if (!extendedShortcuts()) return false;
  const next = { ...storedShortcuts() };
  if (reset) delete next[id];
  else next[id] = value;
  const command = commands.find((c) => c.id === id),
    actual = binding(command, next),
    duplicates = conflicts(actual, id, next);
  if (duplicates.length) {
    $('#shortcutNotice').textContent =
      `冲突：${actual} 已用于“${duplicates.map((c) => c.name).join('、')}”。请先清除或修改原来的绑定。`;
    return false;
  }
  try {
    library.settings = await api('/api/settings', { method: 'PUT', data: { shortcuts: next } });
    recordingShortcut = null;
    shortcutRows();
    updateKeyHints();
    $('#shortcutNotice').textContent = '已保存，立即生效';
    return true;
  } catch (e) {
    $('#shortcutNotice').textContent = e.message;
    return false;
  }
}
function runCommand(id) {
  const actions = {
    new: () => newEntry(),
    search: () => $('#search').focus(),
    save: () => flush().then(() => toast('已保存到本地')),
    focus: () => $('#focusButton').click(),
    calendar: () => changeView('calendar'),
    gallery: () => changeView('gallery'),
    memories: () => changeView('memories'),
    stats: () => changeView('stats'),
    bold: () => command('bold'),
    italic: () => command('italic'),
    strike: () => command('strikeThrough'),
    list: () => command('insertUnorderedList'),
    quote: () => command('formatBlock', 'blockquote'),
    heading: () => command('formatBlock', 'h2'),
    datetime: insertDate,
    indent: () => command('insertText', '　　'),
    template: () => offline.templates(),
    history: showHistory,
    backup: () => offline.backups(),
    shortcuts: keyboardSettings,
  };
  return actions[id]?.();
}
function help() {
  modal(
    '打开就写，慢慢记录',
    `<div class="help-grid"><span>Tab</span><span>正文空两格</span><span>Alt ＋ T</span><span>插入完整日期和时间</span><span>Ctrl ＋ S</span><span>立即保存（平时自动保存）</span><span>Ctrl ＋ B / I</span><span>粗体 / 斜体</span><span>Alt ＋ N / Ctrl ＋ K</span><span>新建 / 搜索（可在快捷键设置中修改）</span></div><p>图片可以拖入或粘贴，视频和音频可以添加后播放。天气和地点目前手动填写。</p><p>这是独立的本地日记软件。统计、回忆、录音、绘画、模板、导出和本地锁在功能设置与编辑工具中。官方云下载和双向同步尚未接入。旧版复杂自定义排版仍需核对。</p><p>数据写在项目的 data 文件夹；删除浏览器缓存不影响它。云盘应保存 .syvault2 加密备份，不要直接公开本地 data 文件夹。</p>`,
  );
}
function bind() {
  $('#returnToBrowse').onclick = () =>
    returnNavigation.back().catch((error) => toast(error.message));
  $('#newEntry').onclick = () => newEntry().catch((e) => toast(e.message));
  $('#emptyNew').onclick = $('#newEntry').onclick;
  $('#navigation').onclick = (e) => {
    const b = e.target.closest('[data-view]');
    if (b) changeView(b.dataset.view).catch((e) => toast(e.message));
  };
  $('#trashButton').onclick = () => changeView('trash');
  $('#allEntries').onclick = () => filterView().catch((e) => toast(e.message));
  $('#categories').onclick = (e) => {
    const b = e.target.closest('[data-category]');
    if (b) filterView({ category: b.dataset.category }).catch((e) => toast(e.message));
  };
  $('#tagCloud').onclick = (e) => {
    const b = e.target.closest('[data-tag]');
    if (b) filterView({ tag: b.dataset.tag }).catch((e) => toast(e.message));
  };
  $('#addCategory').onclick = () => {
    modal(
      '为生活加一个分类',
      '<input class="field" id="categoryName" placeholder="例如：读书、运动、家人" maxlength="60"><button id="createCategory" class="primary">添加分类</button>',
    );
    $('#categoryName').focus();
    $('#createCategory').onclick = async () => {
      try {
        library.categories = await api('/api/categories', {
          method: 'POST',
          data: { name: $('#categoryName').value },
        });
        closeModal();
        renderSide();
        const e = current();
        if (e) {
          $('#entryCategory').innerHTML = sortedTaxonomy(library, 'category')
            .map((item) => item.name)
            .map((c) => `<option>${escape(c)}</option>`)
            .join('');
          ensureOption($('#entryCategory'), e.category);
        }
      } catch (e) {
        toast(e.message);
      }
    };
  };
  $('#entryList').onclick = (e) => {
    const b = e.target.closest('[data-entry]');
    if (b) selectEntry(b.dataset.entry).catch((e) => toast(e.message));
  };
  $('#search').oninput = (e) => {
    returnNavigation.clear();
    detailEntry = null;
    query = e.target.value.trim().toLowerCase();
    if (!['all', 'trash', 'drafts', 'hidden'].includes(view)) {
      view = 'all';
      category = tag = day = null;
      renderView();
    } else renderList();
  };
  $('#sortButton').onclick = () => {
    ascending = !ascending;
    renderList();
    toast(ascending ? '时间从旧到新' : '时间从新到旧');
  };
  $('#bodyEditor').addEventListener('input', () => {
    if (bodyEditor.isStructured) return;
    if (current()) {
      current().content = $('#bodyEditor').innerHTML;
      markDirty();
    }
  });
  $('#bodyEditor').addEventListener('compositionstart', () => {
    if (bodyEditor.isStructured) return;
    persistence.pause();
  });
  $('#bodyEditor').addEventListener('compositionend', () => {
    if (bodyEditor.isStructured) return;
    if (current()) {
      current().content = $('#bodyEditor').innerHTML;
      markDirty();
    }
  });
  installTitleNavigation($('#entryTitle'), {
    body: $('#bodyEditor'),
    atBodyStart: () => bodyEditor.atStart(),
    focusBody: () => bodyEditor.focus(),
    canFocus: () => !!current() && !current().deleted && freezeCount === 0,
  });
  for (const [id, field] of [
    ['entryTitle', 'title'],
    ['entryLocation', 'location'],
    ['entryCategory', 'category'],
    ['entryWeather', 'weather'],
    ['entryMood', 'mood'],
  ])
    $('#' + id).addEventListener('input', (e) => {
      if (current()) {
        current()[field] = e.target.value;
        markDirty();
      }
    });
  $('#entryTags').oninput = (e) => {
    if (current()) {
      current().tags = e.target.value
        .split(/[,，]/)
        .map((x) => x.trim())
        .filter(Boolean);
      markDirty();
    }
  };
  $('#entryDate').onchange = (e) => {
    if (current() && e.target.value) {
      try {
        current().date = parseZonedInput(e.target.value).toISOString();
      } catch (error) {
        e.target.value = inputDate(current().date);
        toast(error.message);
        return;
      }
      markDirty();
    }
  };
  $('#formatToolbar').addEventListener('mousedown', (e) => {
    if (e.target.closest('button')) e.preventDefault();
  });
  $('#formatToolbar').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.command) command(b.dataset.command);
    if (b.dataset.block) command('formatBlock', b.dataset.block);
  };
  $('#insertDateTime').title = '插入日期时间（Alt＋T）';
  $('#insertDateTime').onclick = insertDate;
  $('#indentButton').onclick = () => command('insertText', '　　');
  $('#templateButton').onclick = () => offline.templates();
  document.addEventListener('selectionchange', editorCommands.captureSelection);
  $('#bodyEditor').onpaste = (e) => {
    if (bodyEditor.isStructured) return;
    const files = capturePastedFiles(e);
    if (files) {
      e.preventDefault();
      upload(files).catch((e) => toast(e.message));
    } else {
      e.preventDefault();
      command('insertText', e.clipboardData.getData('text/plain'));
    }
  };
  $('#chooseMedia').onclick = () => $('#mediaInput').click();
  const queueButton = document.createElement('button');
  queueButton.className = 'secondary';
  queueButton.textContent = '上传队列';
  queueButton.onclick = mediaImport.show;
  $('#chooseMedia').after(queueButton);
  $('#mediaInput').onchange = (e) => {
    upload([...e.target.files]).catch((e) => toast(e.message));
    e.target.value = '';
  };
  $('#attachmentEditor').onclick = (e) => {
    const b = e.target.closest('[data-remove-media]');
    if (b && current()) {
      if (bodyEditor.usesMedia(b.dataset.removeMedia))
        return toast('这张图片仍在正文中，请先从正文移除，再移除附件关联');
      current().attachments = current().attachments.filter((id) => id !== b.dataset.removeMedia);
      markDirty();
      renderAttachments();
    }
  };
  $('#saveButton').onclick = () =>
    flush()
      .then(() => toast('已保存到本地'))
      .catch(() => {});
  $('#pinButton').onclick = () => {
    const e = current();
    if (!e || e.deleted) return;
    e.pinned = !e.pinned;
    markDirty();
    $('#pinButton').classList.toggle('active', e.pinned);
  };
  $('#historyButton').onclick = showHistory;
  $('#moreButton').onclick = more;
  $('#closeModal').onclick = closeModal;
  $('#modal').onclick = (e) => {
    if (e.target === $('#modal')) {
      const r = $('#modal').getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
        closeModal();
    }
  };
  $('#modalBody').addEventListener('click', (e) => {
    const t = e.target.closest('[data-template]');
    if (t) {
      const values = {
        today: '<h2>今天的三件事</h2><p>发生了什么：</p><p>此刻的心情：</p><p>明天的小期待：</p>',
        study: '<h2>今天的学习</h2><p>目标：</p><p>新的收获：</p><p>还没弄懂的问题：</p>',
        gratitude:
          '<h2>今天值得感谢的事</h2><p>一个温柔的瞬间：</p><p>一个小小的进步：</p><p>想感谢的人：</p>',
      };
      closeModal();
      command('insertHTML', values[t.dataset.template]);
    }
    const h = e.target.closest('[data-history]');
    if (h) {
      const entry = current(),
        old = entry?.history[Number(h.dataset.history)];
      if (old) {
        for (const key of [
          'title',
          'content',
          'date',
          'category',
          'tags',
          'mood',
          'weather',
          'location',
          'attachments',
        ])
          if (key in old) entry[key] = structuredClone(old[key]);
        const document = getEditorDocument(old);
        entry.contentFormat = document.format;
        entry.markdownSource = document.format === 'markdown' ? document.source : null;
        entry.markdownHtml = document.format === 'markdown' ? entry.content : null;
        closeModal();
        renderEditor();
        markDirty(entry);
      }
    }
  });
  $('#focusButton').onclick = () => offline?.toggleWriting().catch((error) => toast(error.message));
  $('#entryDateline').onclick = () => $('#journalView').classList.remove('has-selected');
  $('#exportLibrary').textContent = '备份与导入';
  $('#exportLibrary').onclick = () => offline.backups();
  $('#helpButton').onclick = help;
  $('#cloudStatus').onclick = () =>
    offline?.sync?.settings?.() ||
    modal('同步功能未加载', '<p>请先重启拾页日记，再打开云同步设置。</p>');
  $('#modalBody').addEventListener('click', (e) => {
    if (e.target.id === 'goBackup') backups();
  });
  $('#modalBody').addEventListener('click', (e) => {
    const record = e.target.closest('[data-record-key]'),
      clear = e.target.closest('[data-clear-key]'),
      reset = e.target.closest('[data-reset-key]');
    if (record) {
      recordingShortcut = record.dataset.recordKey;
      $('#shortcutNotice').textContent = '按下要绑定的组合键；Esc 取消。';
      shortcutRows();
    }
    if (clear) setShortcut(clear.dataset.clearKey, null);
    if (reset) setShortcut(reset.dataset.resetKey, null, true);
  });
  $('#alternateView').onclick = async (e) => {
    const entry = e.target.closest('[data-open-entry]'),
      date = e.target.closest('[data-day]');
    if (!entry && !date) return;
    try {
      await returnNavigation.open(() => {
        if (
          entry &&
          !library.entries.some(
            (item) =>
              item.id === entry.dataset.openEntry &&
              !item.deleted &&
              !item.draft &&
              !isHidden(item),
          )
        ) {
          toast('这篇日记已不在当前可浏览范围内');
          return false;
        }
        view = 'all';
        category = tag = null;
        day = entry ? null : date.dataset.day;
        query = '';
        $('#search').value = '';
        selected = entry ? entry.dataset.openEntry : null;
        detailEntry = selected;
        renderView();
        $('#journalView').classList.toggle('has-selected', !!entry);
        return true;
      });
    } catch (error) {
      toast(error.message);
    }
  };
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (document.querySelector('dialog[open]') && !recordingShortcut) return;
      if (recordingShortcut) {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'Escape') {
          recordingShortcut = null;
          shortcutRows();
          $('#shortcutNotice').textContent = '已取消录入';
          return;
        }
        const value = chord(e);
        if (value) setShortcut(recordingShortcut, value);
        return;
      }
      if (pausedShortcut(e, storedShortcuts(), extendedShortcuts())) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      if (document.querySelector('dialog[open]')) return;
      if (e.altKey && e.target.closest?.('[data-sort-handle]') && e.key.startsWith('Arrow')) return;
      const editor = $('#bodyEditor').contains(e.target),
        typing = !!e.target.closest('input,textarea,select,[contenteditable="true"]');
      // Body controls own Tab/Shift+Tab, including lists/tables and IME.
      // The configurable legacy "空两格" binding must not apply a second edit.
      if (editor && e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) return;
      const action = match(e, shortcuts(), editor, typing);
      if (action) {
        e.preventDefault();
        Promise.resolve(runCommand(action.id)).catch((e) => toast(e.message));
      }
    },
    true,
  );
  window.addEventListener('beforeunload', (e) => {
    if (persistence.pending) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && persistence.pending) flush().catch(() => {});
  });
  window.addEventListener('unhandledrejection', (e) => {
    toast(e.reason?.message || '操作没有完成');
  });
}
const { backups } = createLegacyBackups({
  modal,
  icon,
  localDate,
  download,
  flush,
  api,
  $,
  uploadLegacyFile,
  refreshLibrary,
  renderView,
  escape,
  get library() {
    return library;
  },
});
icons();
bind();
const shortcutButton = document.createElement('button');
shortcutButton.id = 'shortcutSettings';
shortcutButton.textContent = '快捷键';
shortcutButton.onclick = keyboardSettings;
$('.bottom-actions').insertBefore(shortcutButton, $('#helpButton'));
$('#exportLibrary').title = '旧格式导入、加密备份与原件归档';
$('#modal').addEventListener('close', () => (recordingShortcut = null));
offline = installOffline({
  editor: bodyEditor,
  $,
  $$,
  api,
  escape,
  modal,
  closeModal,
  toast,
  textOf,
  sanitize,
  command,
  get library() {
    return library;
  },
  current,
  flush,
  markDirty,
  renderView,
  renderEditor,
  renderAttachments,
  refreshLibrary,
  changeView,
  returnToEditor: async () => {
    await finishCurrent();
    view = 'all';
    category = tag = day = null;
    renderView({ preserveEntry: true });
    bodyEditor.focus();
  },
  filtered,
  upload,
  download,
  legacyBackups: backups,
  selectEntry,
  openPreviewEntry,
  newEntry,
  filterView,
  withLibraryMutation,
});
async function unlockGate() {
  const access = await api('/api/access');
  if (access.unlocked) return;
  $('#app').classList.add('hidden');
  await new Promise((resolve) => {
    modal(
      '解锁本地日记',
      '<input class="field" type="password" id="unlockPassword" placeholder="本地锁密码" autocomplete="current-password"><button class="primary" id="unlockButton">解锁</button><p id="unlockMessage" role="status"></p>',
    );
    $('#closeModal').hidden = true;
    $('#modal').addEventListener('cancel', (e) => e.preventDefault(), { once: true });
    $('#unlockButton').onclick = async () => {
      try {
        await api('/api/unlock', {
          method: 'POST',
          data: { password: $('#unlockPassword').value },
        });
        $('#closeModal').hidden = false;
        closeModal();
        $('#app').classList.remove('hidden');
        resolve();
      } catch (e) {
        $('#unlockMessage').textContent = e.message;
      }
    };
    $('#unlockPassword').onkeydown = (e) => {
      if (e.key === 'Enter') $('#unlockButton').click();
    };
  });
}
try {
  await unlockGate();
  const capabilities = await api('/api/health');
  richQuickAvailable =
    isQuick &&
    launchParams.get('richdoc') !== '0' &&
    capabilities.contentFormats?.includes('richdoc') === true;
  await refreshLibrary();
  selected = filtered()[0]?.id || null;
  renderView();
  updateKeyHints();
  if (isQuick) {
    selected = null;
    renderEditor();
    quickWindow = installQuickCapture({
      version: capabilities.version,
      editor: bodyEditor,
      resumePosition: createQuickResumePosition({
        current,
        editor: bodyEditor,
        title: $('#entryTitle'),
        scroller: $('.writing-scroll'),
      }),
      api,
      newEntry,
      current,
      flush: finishCurrent,
      pending: () => persistence.pending,
      freeze: freezeEditor,
      focus: () => {
        if (library.settings?.preferences?.quickInitialFocus === 'title') $('#entryTitle').focus();
        else bodyEditor.focus();
      },
      focusBody: () => bodyEditor.focus(),
      commit: () => bodyEditor.commit(),
      selectEntry,
      refreshLibrary,
      toast,
      chooseCategory: (options) => categoryPicker.open(options),
      appearanceSettings: offline.quickAppearanceSettings,
      settings: (section = 'quickAppearance') => offline.settings(section),
      readingDocument: offline.entryReading,
      modal,
      closeModal,
      cancelCategory: () => categoryPicker.cancel(),
      syncEditor: (entry, options) => bodyEditor.commit(options),
      launchParams,
    });
    await quickWindow.start();
  } else if (launchParams.get('entry')) {
    const id = launchParams.get('entry');
    if (library.entries.some((e) => e.id === id && !e.deleted)) await selectEntry(id);
    else toast('这篇日记不存在或已移入回收站');
  } else {
    if (offline.prefs().openView === 'calendar') await changeView('calendar');
    if (offline.prefs().openView === 'new') await newEntry();
  }
  const refreshContext = () => [library, selected, view, category, tag, day, query];
  windowRefresh = createWindowRefresh({
    canRefresh: () =>
      !document.hidden &&
      !persistence.pending &&
      !current()?._unsaved &&
      !freezeCount &&
      !document.querySelector('dialog[open]') &&
      !document.activeElement?.closest?.('#editorPanel'),
    capture: refreshContext,
    isCurrent: (before) => before.every((value, index) => value === refreshContext()[index]),
    fetch: () => api('/api/library'),
    apply(snapshot) {
      applyLibrary(snapshot);
      // Keep this window's selected article and browsing position. Never select
      // another window's saved article, or the first item in the refreshed list.
      renderList();
      if (['all', 'trash', 'drafts', 'hidden'].includes(view)) renderEditor();
      else renderAlternate();
    },
  });
  syncChannel?.addEventListener('message', ({ data }) => {
    if (data?.type === 'saved') windowRefresh.request();
  });
  // Native quick WebView2 and the Edge main window have separate browser
  // profiles. Refocusing also refreshes those windows without BroadcastChannel.
  window.addEventListener('focus', () => windowRefresh.request());
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) windowRefresh.request();
  });
  for (const event of ['input', 'change', 'compositionstart', 'pointerdown', 'keydown'])
    document.addEventListener(event, () => windowRefresh.invalidate(), true);
  document.addEventListener('focusin', () => windowRefresh.invalidate());
  document.addEventListener('focusout', () => windowRefresh.invalidate());
  document.addEventListener('close', () => windowRefresh.resume(), true);
  window.addEventListener('pagehide', () => windowRefresh.dispose(), { once: true });
} catch (e) {
  status('无法连接本地服务', true);
  toast(e.message);
  $('#entryList').innerHTML = '<p class="empty-list">本地服务未连接，请重新运行启动程序。</p>';
}
