/* Local Android WebView page. The MessagePort is transferred by the native host. */
(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const pending = new Map();
  let port;
  let nextRequest = 0;
  const bridgeReady = new Promise((resolve) => {
    function receive(event) {
      if (
        event.data !== 'shiye-app-port-v1' ||
        !event.ports?.[0] ||
        (event.origin && event.origin !== 'null' && event.origin !== location.origin)
      )
        return;
      window.removeEventListener('message', receive);
      port = event.ports[0];
      port.onmessage = ({ data }) => {
        let response;
        try {
          response = typeof data === 'string' ? JSON.parse(data) : data;
        } catch {
          return;
        }
        const task = pending.get(response?.requestId);
        if (!task) return;
        pending.delete(response.requestId);
        if (response.ok) task.resolve(response.result);
        else {
          const error = new Error(
            response.error?.message || response.error || '操作未完成，请重试。',
          );
          error.code = response.code ?? response.error?.code;
          error.current = response.current ?? response.error?.current;
          task.reject(error);
        }
      };
      port.start();
      resolve();
    }
    window.addEventListener('message', receive);
  });

  async function rpc(op, args = {}) {
    await bridgeReady;
    return new Promise((resolve, reject) => {
      const requestId = ++nextRequest;
      pending.set(requestId, { resolve, reject });
      try {
        port.postMessage(JSON.stringify({ requestId, op, ...args }));
      } catch (error) {
        pending.delete(requestId);
        reject(error);
      }
    });
  }

  let entry = null;
  let adapter = null;
  let diarySearch = null;
  let installDiaryTouchRangeGuard = null;
  let imageRangeRelease = null;
  let editorInput = null;
  let categories = [];
  let defaultCategoryId = '';
  let revision = 0;
  let version = 0;
  let savedVersion = 0;
  let timer = null;
  let queue = Promise.resolve();
  let lastError = '';
  let lastSavedAt = '';
  let saving = false;
  let blocked = false;
  let reading = new URLSearchParams(location.search).get('read') === '1';
  let closing = false;
  let imageEditing = null;
  let imageInsertionPosition = null;
  let caretFrame = 0;
  let pickerActive = false;
  let composingField = false;
  let toastTimer;
  let formatDateTime;
  let diaryTimeZone;
  let entryCapability;
  let inspectEntryEnvelope;
  let mergeEntryChanges;
  let validateRenderableBody;
  let contentAlgorithms;
  let productContent;
  let productState;
  let suggestedTitle = '';
  let titleTouched = false;
  let suggestionGeneration = 0;
  let titleFormatPreferences = null;
  let entryImageWidthPercent = null;
  let entryImageWidthDraft;
  let imageWidthModes = new Map();
  let imageWidthModesDirty = false;
  let imageWidthWasTouched = false;
  const inspectLocalEntry = (value) =>
    inspectEntryEnvelope(value, {
      ...contentAlgorithms,
      sink: 'android-product',
      validateCanonicalEntry: (raw) => {
        try {
          const record = raw?.record?.local;
          if (!record || record.entityId !== raw.entry.id || record.state !== 'active')
            return false;
          productContent.validateProductRecord(record.entityType, record.entityId, record.data);
          return JSON.stringify(record.data.body) === JSON.stringify(raw.entry.body);
        } catch {
          return false;
        }
      },
    });
  const dirty = () => version !== savedVersion;
  let wallpaperState = Object.freeze({ generation: 0, status: 'loading', settled: false, url: '' });
  let wallpaperLoad = null;
  const setWallpaperState = (generation, status, url) => {
    wallpaperState = Object.freeze({ generation, status, settled: status !== 'loading', url });
  };
  function applyWallpaper(url, invalid) {
    const generation = wallpaperState.generation + 1;
    const style = $('#editorPage').style;
    if (wallpaperLoad?.url === url && url) {
      setWallpaperState(generation, wallpaperLoad.status, url);
      return;
    }
    if (wallpaperLoad) {
      clearTimeout(wallpaperLoad.timer);
      wallpaperLoad.image.onload = wallpaperLoad.image.onerror = null;
    }
    wallpaperLoad = null;
    style.setProperty('--diary-image', 'none');
    if (!url) {
      setWallpaperState(generation, invalid ? 'failed' : 'none', '');
      return;
    }
    const load = { url, image: new Image(), status: 'loading', timer: null };
    wallpaperLoad = load;
    setWallpaperState(generation, 'loading', url);
    const settle = (status) => {
      if (wallpaperLoad !== load || load.status !== 'loading') return;
      clearTimeout(load.timer);
      load.image.onload = load.image.onerror = null;
      load.status = status;
      style.setProperty('--diary-image', status === 'ready' ? `url("${url}")` : 'none');
      setWallpaperState(wallpaperState.generation, status, url);
    };
    load.timer = setTimeout(() => settle('failed'), 2000);
    load.image.onerror = () => settle('failed');
    load.image.onload = () => {
      if (typeof load.image.decode === 'function')
        load.image.decode().then(
          () => settle('ready'),
          () => settle('failed'),
        );
      else settle('ready');
    };
    load.image.src = url;
  }
  // This is a visual projection only. The editor and authoritative body remain mounted.
  window.shiyeApplyAppearance = (value) => {
    const mode = ['sky', 'custom', 'none'].includes(value?.backgroundMode)
      ? value.backgroundMode
      : 'sky';
    const background = value?.background;
    const validImage =
      mode === 'custom' &&
      typeof background?.url === 'string' &&
      /^\/appearance\/[a-z0-9-]+\.(?:png|jpe?g|webp|gif)$/i.test(background.url);
    const style = $('#editorPage').style;
    const theme = value?.theme === 'dark' ? 'dark' : 'light';
    const veil = ['none', 'light', 'dark'].includes(value?.veil) ? value.veil : 'light';
    document.documentElement.dataset.theme = theme;
    $('#editorPage').dataset.veil = veil;
    $('#editorPage').dataset.background = mode;
    applyWallpaper(validImage ? background.url : '', mode === 'custom' && !validImage);
    style.setProperty(
      '--diary-image-opacity',
      validImage
        ? String(
            Math.max(
              0,
              Math.min(
                1,
                Number.isFinite(Number(background.opacity)) ? Number(background.opacity) : 1,
              ),
            ),
          )
        : '0',
    );
    style.setProperty(
      '--diary-image-size',
      ['cover', 'contain'].includes(background?.fill)
        ? background.fill
        : background?.fill === 'tile'
          ? 'auto'
          : 'cover',
    );
    style.setProperty('--diary-image-repeat', background?.fill === 'tile' ? 'repeat' : 'no-repeat');
    style.setProperty(
      '--diary-image-position',
      ['center', 'top', 'bottom', 'left', 'right'].includes(background?.position)
        ? background.position
        : 'center',
    );
    style.setProperty(
      '--diary-image-blur',
      `${Math.max(0, Math.min(20, Number(value?.blur) || 0))}px`,
    );
  };
  // Start appearance independently of module/body reads. A settings preview owns a
  // newer generation and must never be replaced by this late initial response.
  const initialAppearance = bridgeReady.then(async () => {
    const generation = wallpaperState.generation;
    let timeout;
    const fallback = { backgroundMode: 'none' };
    const value = await Promise.race([
      rpc('getAppearance').catch(() => fallback),
      new Promise((resolve) => {
        timeout = setTimeout(() => resolve(fallback), 2000);
      }),
    ]);
    clearTimeout(timeout);
    if (wallpaperState.generation === generation) window.shiyeApplyAppearance(value);
  });
  // Presentation choices stay separate from the authoritative entry/body and native store.
  const preferenceKey = 'shiye.android.diary.presentation.v2';
  const entryImageWidthKey = 'shiye.android.diary.entry-image-width.v1';
  const imageWidthModesKey = 'shiye.android.diary.image-width-modes.v1';
  const imageWidthModeLimit = 4096;
  const writingToolbarIds = ['timestampButton', 'indentButton', 'imageButton', 'richToolsButton'];
  const diaryActionButtons = {
    copyAllButton: ['copyAll', '复制全文', '全文'],
    exportTxtButton: ['exportTxt', '导出 TXT', 'TXT'],
    exportPdfButton: ['exportPdf', '打印／导出 PDF', 'PDF'],
    shareTextButton: ['shareText', '分享文本', '分享'],
  };
  const actionToolbarIds = Object.keys(diaryActionButtons);
  const toolbarIds = [...writingToolbarIds, ...actionToolbarIds];
  let preferences = {
    showTitle: false,
    showMetadata: false,
    chooseCategoryOnCreate: true,
    fontSize: 15,
    lineHeight: 1.85,
    fontWeight: 500,
    paragraphSpacing: 0,
    serifFont: false,
    autoIndentParagraph: true,
    emptyPrompt: '你好呀，请输入时间戳～',
    imageWidthPercent: 40,
    toolbarOrder: [...toolbarIds],
    toolbarSides: Object.fromEntries(toolbarIds.map((id) => [id, actionToolbarIds.includes(id) ? 'right' : 'left'])),
    favoriteActions: [],
  };
  // 017 per-item projection; independently saved local appearance, not entry data.
  const infoLabels = {
    title: '标题',
    date: '日期',
    weekday: '星期',
    time: '时间',
    location: '地点',
    wordCount: '字数',
    category: '分类',
  };
  const infoDefaults = {
    title: 'top',
    date: 'top',
    weekday: 'top',
    time: 'hidden',
    location: 'top',
    wordCount: 'top',
    category: 'top',
  };
  const infoPositions = ['top', 'toolbar', 'hidden'];
  let infoPlacement = {};
  let infoPlacementDraft = null;
  const infoNodes = {};
  let titleEditCapture = null;
  try {
    const stored = JSON.parse(localStorage.getItem(preferenceKey) || '{}');
    if (
      stored.infoPlacementV1 &&
      typeof stored.infoPlacementV1 === 'object' &&
      !Array.isArray(stored.infoPlacementV1)
    )
      infoPlacement = { ...stored.infoPlacementV1 };
  } catch {
    /* Fall back only in memory; opening never writes a preference. */
  }

  function currentInfoPositions() {
    const raw = infoPlacementDraft || infoPlacement;
    return Object.fromEntries(
      Object.keys(infoLabels).map((id) => [
        id,
        infoPositions.includes(raw[id]) ? raw[id] : infoDefaults[id],
      ]),
    );
  }
  function infoValues() {
    return {
      title: entry?.title || '',
      date: $('#entryDateDisplay')?.textContent || '',
      weekday: $('#weekday')?.textContent || '',
      time: $('#entryMetaTime')?.textContent || '',
      location: $('#entryMetaPlace')?.textContent || '',
      wordCount: $('#wordCount')?.textContent || '',
      category: $('#entryCategoryName')?.textContent || '',
    };
  }
  function applyInfoPlacement() {
    if (!infoNodes.date) return;
    const positions = currentInfoPositions();
    const values = infoValues();
    const top = document.querySelector('.entry-meta');
    const heading = document.querySelector('.page-heading');
    const right = $('#toolbarInfoSlot');
    const active = [];
    for (const id of Object.keys(infoLabels)) {
      const node =
        id === 'title' ? (reading ? $('#readingTitle') : $('#entryTitle')) : infoNodes[id];
      if (!node) continue;
      const absent = !String(values[id]).trim() && !(id === 'title' && !reading);
      const hidden = positions[id] === 'hidden' || absent;
      const target = positions[id] === 'toolbar' ? right : id === 'title' ? heading : top;
      if (node.parentElement !== target) target.append(node);
      node.classList.add('diary-info-item');
      node.dataset.infoItem = id;
      node.style.order = String(Object.keys(infoLabels).indexOf(id));
      node.hidden = hidden;
      node.title = `${infoLabels[id]}：${values[id]}`;
      if (id === 'title') {
        const inactive = reading ? $('#entryTitle') : $('#readingTitle');
        inactive.hidden = true;
        if (inactive.parentElement !== heading) heading.append(inactive);
      }
      if (!hidden && target === right) active.push(id);
    }
    // Empty date wrapper must not reserve a grid column after date/weekday separate moves.
    const dateGroup = document.querySelector('.entry-meta-date');
    if (dateGroup) dateGroup.hidden = true;
    $('#editorPage').classList.add('info-placement-enabled');
    $('#editorPage').classList.toggle('has-toolbar-info', active.length > 0);
    $('#editorPage').classList.toggle(
      'has-top-title',
      positions.title === 'top' && (!reading || !!values.title.trim()),
    );
    right.hidden = active.length === 0;
    $('#editEntryTitleButton').disabled = reading || blocked || settingsSaving;
  }
  function showFullInfo(parent) {
    const list = $('#infoFullValues');
    list.replaceChildren();
    for (const [id, value] of Object.entries(infoValues())) {
      if (!String(value).trim()) continue;
      const dt = document.createElement('dt'),
        dd = document.createElement('dd');
      dt.textContent = infoLabels[id];
      dd.textContent = value;
      list.append(dt, dd);
    }
    openDialog('infoValueDialog', parent);
  }
  function setupInfoPlacement() {
    Object.assign(infoNodes, {
      date: document.querySelector('.date-control'),
      weekday: $('#weekday'),
      time: $('#entryMetaTime'),
      location: $('#entryMetaPlace'),
      wordCount: $('#wordCount'),
      category: document.querySelector('.entry-category-shortcut'),
    });
    $('#editEntryTitleButton').addEventListener('click', () => {
      if (reading || blocked || settingsSaving || !entry) return;
      titleEditCapture = { id: entry.id, title: entry.title || '' };
      $('#entryTitleDraftInput').value = titleEditCapture.title;
      $('#entryTitleEditStatus').textContent = '确认后沿原日记自动保存；取消不改标题。';
      openDialog('entryTitleEditDialog', 'moreDialog');
    });
    $('#applyEntryTitleEdit').addEventListener('click', () => {
      if (
        reading ||
        blocked ||
        settingsSaving ||
        !titleEditCapture ||
        entry?.id !== titleEditCapture.id ||
        (entry.title || '') !== titleEditCapture.title
      ) {
        $('#entryTitleEditStatus').textContent =
          '篇目、权限或原标题已改变，修改尚未应用，请取消后重新打开。';
        return;
      }
      if (composingField) {
        $('#entryTitleEditStatus').textContent = '请先完成当前组词，再应用标题修改。';
        return;
      }
      const value = $('#entryTitleDraftInput').value;
      if (value.length > 500) {
        $('#entryTitleEditStatus').textContent = '标题最多500字。';
        return;
      }
      if (value !== (entry.title || '')) {
        // Route through the existing titleTouched/suggestedTitle/dirty/autosave handler.
        // The hidden source input is not duplicated or replaced, and position changes never dispatch input.
        $('#entryTitle').value = value;
        $('#entryTitle').dispatchEvent(new Event('input', { bubbles: true }));
      }
      titleEditCapture = null;
      closeDialog('entryTitleEditDialog');
    });
    for (const id of Object.keys(infoLabels)) {
      const label = document.createElement('label');
      label.className = 'preference-row';
      const caption = document.createElement('span');
      caption.textContent = infoLabels[id];
      const select = document.createElement('select');
      select.id = `infoPosition-${id}`;
      label.htmlFor = select.id;
      for (const [value, text] of [
        ['top', '顶部'],
        ['toolbar', '工具栏右侧'],
        ['hidden', '不显示'],
      ]) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = text;
        select.append(option);
      }
      select.addEventListener('change', () => {
        if (!infoPlacementDraft) return;
        infoPlacementDraft = { ...infoPlacementDraft, [id]: select.value };
        applyInfoPlacement();
        $('#infoPlacementStatus').textContent = '位置正在预览，尚未保存到本机。';
      });
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.textContent = '恢复';
      reset.setAttribute('aria-label', `恢复${infoLabels[id]}默认位置`);
      reset.addEventListener('click', () => {
        if (!infoPlacementDraft) return;
        delete infoPlacementDraft[id];
        select.value = infoDefaults[id];
        applyInfoPlacement();
      });
      label.append(caption, select, reset);
      $('#infoPlacementRows').append(label);
    }
    const paintControls = () => {
      const current = currentInfoPositions();
      for (const id of Object.keys(infoLabels)) $(`#infoPosition-${id}`).value = current[id];
    };
    $('#infoPlacementButton').addEventListener('click', () => {
      if (settingsSaving) return;
      infoPlacementDraft = { ...infoPlacement };
      paintControls();
      $('#infoPlacementStatus').textContent = '仅预览信息位置；返回或取消不保存。';
      openDialog('infoPlacementDialog', 'moreDialog');
    });
    $('#cancelInfoPlacement').addEventListener('click', () => closeDialog('infoPlacementDialog'));
    $('#resetInfoPlacement').addEventListener('click', () => {
      if (!infoPlacementDraft) return;
      for (const id of Object.keys(infoLabels)) delete infoPlacementDraft[id];
      paintControls();
      applyInfoPlacement();
    });
    $('#saveInfoPlacement').addEventListener('click', () => {
      if (!infoPlacementDraft) return;
      try {
        const stored = JSON.parse(localStorage.getItem(preferenceKey) || '{}');
        if (!stored || typeof stored !== 'object' || Array.isArray(stored))
          throw Error('偏好原件无效');
        const retained =
          stored.infoPlacementV1 &&
          typeof stored.infoPlacementV1 === 'object' &&
          !Array.isArray(stored.infoPlacementV1)
            ? stored.infoPlacementV1
            : {};
        const next = { ...retained };
        for (const id of Object.keys(infoLabels)) {
          // Only changed fields overwrite freshly read preferences; untouched fields survive.
          if (infoPlacementDraft[id] === infoPlacement[id]) continue;
          if (Object.hasOwn(infoPlacementDraft, id)) next[id] = infoPlacementDraft[id];
          else delete next[id];
        }
        localStorage.setItem(preferenceKey, JSON.stringify({ ...stored, infoPlacementV1: next }));
        const readback = JSON.parse(localStorage.getItem(preferenceKey) || '{}');
        if (JSON.stringify(readback.infoPlacementV1) !== JSON.stringify(next))
          throw Error('本机偏好回读不一致');
        infoPlacement = { ...next };
        infoPlacementDraft = null;
        closeDialog('infoPlacementDialog');
        applyInfoPlacement();
        toast('信息位置已保存到本机。');
      } catch (error) {
        $('#infoPlacementStatus').textContent =
          `位置未能确认保存：${error.message || '请重试'}；预览仍保留。`;
      }
    });
    $('#inspectAllInfo').addEventListener('click', () => showFullInfo('infoPlacementDialog'));
    for (const id of ['location', 'wordCount', 'time', 'weekday']) {
      const node = infoNodes[id];
      node.tabIndex = 0;
      node.setAttribute('role', 'button');
      node.addEventListener('click', () => showFullInfo(null));
      node.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          showFullInfo(null);
        }
      });
    }
    // Existing title/date/category remain actual interactive nodes, with full-value action in settings.
    applyInfoPlacement();
  }

  let preferenceDraft = null;
  let entryLocationDraft;
  let settingsGeneration = 0;
  let autoLocationGeneration = 0;
  let navigationCommitted = false;
  function retireAutoLocation() {
    navigationCommitted = true;
    autoLocationGeneration++;
  }
  let settingsSaving = false;
  let diaryActions = null;
  let diaryActionRich = null;
  let diaryActionRunning = false;
  const dialogParents = new Map();
  const presentation = () => preferenceDraft || preferences;
  const pendingSettings = () =>
    (preferenceDraft && JSON.stringify(preferenceDraft) !== JSON.stringify(preferences)) ||
    (entryImageWidthDraft !== undefined && entryImageWidthDraft !== entryImageWidthPercent) ||
    (entryLocationDraft !== undefined && entryLocationDraft !== (entry?.location || ''));
  try {
    const stored = JSON.parse(localStorage.getItem(preferenceKey) || '{}');
    for (const key of [
      'showTitle',
      'showMetadata',
      'serifFont',
      'chooseCategoryOnCreate',
      'autoIndentParagraph',
    ]) {
      if (typeof stored[key] === 'boolean') preferences[key] = stored[key];
    }
    if (
      typeof stored.emptyPrompt === 'string' &&
      stored.emptyPrompt.length <= 120 &&
      !/[\r\n]/u.test(stored.emptyPrompt)
    )
      preferences.emptyPrompt = stored.emptyPrompt;
    if (
      Number.isInteger(stored.imageWidthPercent) &&
      stored.imageWidthPercent >= 10 &&
      stored.imageWidthPercent <= 100
    )
      preferences.imageWidthPercent = stored.imageWidthPercent;
    if (Array.isArray(stored.toolbarOrder) &&
        new Set(stored.toolbarOrder).size === stored.toolbarOrder.length &&
        stored.toolbarOrder.every((id) => toolbarIds.includes(id)) &&
        writingToolbarIds.every((id) => stored.toolbarOrder.includes(id)))
      preferences.toolbarOrder = [...stored.toolbarOrder, ...toolbarIds.filter((id) => !stored.toolbarOrder.includes(id))];
    if (Array.isArray(stored.favoriteActions) &&
        new Set(stored.favoriteActions).size === stored.favoriteActions.length &&
        stored.favoriteActions.every((id) => actionToolbarIds.includes(id)))
      preferences.favoriteActions = [...stored.favoriteActions];
    if (stored.toolbarSides && typeof stored.toolbarSides === 'object' && !Array.isArray(stored.toolbarSides))
      for (const id of toolbarIds)
        if (['left', 'right'].includes(stored.toolbarSides[id]))
          preferences.toolbarSides[id] = stored.toolbarSides[id];
    if (Number.isInteger(stored.fontSize) && stored.fontSize >= 8 && stored.fontSize <= 40)
      preferences.fontSize = stored.fontSize;
    if (Number.isInteger(stored.fontWeight) && stored.fontWeight >= 400 && stored.fontWeight <= 700)
      preferences.fontWeight = stored.fontWeight;
    if (
      typeof stored.paragraphSpacing === 'number' &&
      stored.paragraphSpacing >= 0 &&
      stored.paragraphSpacing <= 2
    )
      preferences.paragraphSpacing = stored.paragraphSpacing;
    if (
      typeof stored.lineHeight === 'number' &&
      stored.lineHeight >= 1.2 &&
      stored.lineHeight <= 2.5
    )
      preferences.lineHeight = stored.lineHeight;
  } catch {
    // Local appearance storage is optional; opening or saving the entry must still work.
  }

  function persistPreferences() {
    try {
      writePreferences(preferences);
    } catch {
      toast('当前排版仅在本次打开时保留。');
    }
  }

  function writePreferences(next) {
    let retained = {};
    try {
      const stored = JSON.parse(localStorage.getItem(preferenceKey) || '{}');
      if (stored && typeof stored === 'object' && !Array.isArray(stored)) retained = stored;
    } catch {
      // A corrupt local appearance value is replaceable; diary content is elsewhere.
    }
    localStorage.setItem(preferenceKey, JSON.stringify({
      ...retained,
      ...next,
      toolbarSides: { ...(retained.toolbarSides || {}), ...next.toolbarSides },
    }));
  }

  function readEntryImageWidth(id) {
    try {
      const rows = JSON.parse(localStorage.getItem(entryImageWidthKey) || '[]');
      const value = Array.isArray(rows) ? rows.findLast((row) => row?.id === id)?.width : null;
      return Number.isInteger(value) && value >= 10 && value <= 100 ? value : null;
    } catch {
      return null;
    }
  }

  function saveEntryImageWidth(id, width) {
    try {
      const parsed = JSON.parse(localStorage.getItem(entryImageWidthKey) || '[]');
      const rows = (Array.isArray(parsed) ? parsed : []).filter((row) => row?.id !== id);
      if (width !== null) rows.push({ id, width });
      localStorage.setItem(entryImageWidthKey, JSON.stringify(rows.slice(-100)));
      return true;
    } catch {
      return false;
    }
  }

  function readImageWidthModes(id) {
    try {
      const parsed = JSON.parse(localStorage.getItem(imageWidthModesKey) || '{}');
      const rows = Array.isArray(parsed?.rows) ? parsed.rows : [];
      return new Map(
        rows
          .filter(
            (row) =>
              row?.entryId === id &&
              typeof row.occurrenceId === 'string' &&
              row.occurrenceId &&
              ['inherit', 'explicit'].includes(row.mode) &&
              Number.isFinite(row.baseline) &&
              row.baseline >= 0.1 &&
              row.baseline <= 1,
          )
          .map((row) => [
            row.occurrenceId,
            {
              mode: row.mode,
              baseline: row.baseline,
              explicit: Number.isFinite(row.explicit) ? row.explicit : null,
            },
          ]),
      );
    } catch {
      return new Map();
    }
  }

  function persistImageWidthModes(snapshot = imageWidthModes) {
    if (!entry?.id) return false;
    try {
      const parsed = JSON.parse(localStorage.getItem(imageWidthModesKey) || '{}');
      const retained = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      const others = (Array.isArray(retained.rows) ? retained.rows : []).filter(
        (row) => row?.entryId !== entry.id && typeof row?.entryId === 'string',
      );
      const own = [...snapshot].map(([occurrenceId, value]) => ({
        entryId: entry.id,
        occurrenceId,
        ...value,
      }));
      if (own.length > imageWidthModeLimit) {
        toast('本篇图片宽度设置数量已达上限，未能记住新的继承方式。');
        return false;
      }
      localStorage.setItem(
        imageWidthModesKey,
        JSON.stringify({
          ...retained,
          version: 1,
          rows: [...others.slice(-(imageWidthModeLimit - own.length)), ...own],
        }),
      );
      imageWidthModesDirty = false;
      return true;
    } catch {
      toast('图片宽度偏好暂未保存到本机，正文仍可继续保存。');
      return false;
    }
  }

  function confirmedImageIds(body) {
    const ids = new Set();
    const walk = (nodes) => {
      for (const node of nodes || []) {
        if (node.type === 'image' && node.attrs?.occurrenceId) ids.add(node.attrs.occurrenceId);
        walk(node.content);
      }
    };
    walk(body?.content);
    return ids;
  }

  function effectiveImageWidth() {
    return (
      ((entryImageWidthDraft === undefined ? entryImageWidthPercent : entryImageWidthDraft) ??
        presentation().imageWidthPercent) / 100
    );
  }

  function paintInheritedImages() {
    const editor = adapter?.editor;
    if (!editor || !entry) return;
    const widths = new Map();
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'image') widths.set(node.attrs.occurrenceId, node.attrs.widthRatio);
    });
    for (const figure of editor.view.dom.querySelectorAll('figure[data-rich-image]')) {
      const id = figure.dataset.richImage;
      const width = widths.get(id);
      if (!Number.isFinite(width)) continue;
      const inherits = !reading && imageWidthModes.get(id)?.mode === 'inherit';
      figure.style.setProperty(
        'width',
        `${reading ? 100 : Math.round((inherits ? effectiveImageWidth() : width) * 100)}%`,
        reading || inherits ? 'important' : '',
      );
    }
  }

  function reconcileImageWidthHistory(transaction) {
    if (!transaction.docChanged || !imageWidthModes.size) return;
    const previousWidths = new Map();
    transaction.before.descendants((node) => {
      if (node.type.name === 'image')
        previousWidths.set(node.attrs.occurrenceId, node.attrs.widthRatio);
    });
    adapter.editor.state.doc.descendants((node) => {
      if (node.type.name !== 'image') return;
      const row = imageWidthModes.get(node.attrs.occurrenceId);
      if (!row || row.explicit === null) return;
      const width = node.attrs.widthRatio;
      if (previousWidths.get(node.attrs.occurrenceId) === width) return;
      const nextMode = Math.abs(width - row.baseline) < 0.000001 ? 'inherit' : 'explicit';
      if (nextMode !== row.mode) {
        row.mode = nextMode;
        imageWidthModesDirty = true;
      }
    });
    paintInheritedImages();
  }

  function arrangeToolbar(order, sides) {
    const bar = $('#formatBar');
    if (!bar) return;
    const infoSlot = $('#toolbarInfoSlot');
    const rightTools = $('#toolbarRightTools');
    for (const id of order) {
      if (!toolbarIds.includes(id)) continue;
      const button = $(`#${id}`);
      if (button) (sides[id] === 'right' ? rightTools : bar).insertBefore(button, sides[id] === 'right' ? null : rightTools);
      if (button && actionToolbarIds.includes(id)) button.hidden = !presentation().favoriteActions.includes(id);
    }
    $('#editorPage').classList.toggle('has-diary-action-tools', presentation().favoriteActions.length > 0);
    // The information slot retains its independent position map and stays after the right tools.
    if (infoSlot.previousElementSibling !== rightTools) bar.append(infoSlot);
  }

  function paintToolbarOrder() {
    const container = $('#toolbarOrderSetting');
    if (!container) return;
    container.replaceChildren();
    const labels = {
      timestampButton: '时间戳',
      indentButton: '两格缩进',
      imageButton: '图片',
      richToolsButton: '正文格式',
      copyAllButton: '复制全文',
      exportTxtButton: '导出 TXT',
      exportPdfButton: '打印／导出 PDF',
      shareTextButton: '分享文本',
    };
    presentation().toolbarOrder.forEach((id, index) => {
      const row = document.createElement('div');
      row.className = 'preference-row';
      const label = document.createElement('span');
      label.textContent = labels[id];
      row.append(label);
      if (actionToolbarIds.includes(id)) {
        const favorite = document.createElement('input');
        favorite.type = 'checkbox';
        favorite.checked = presentation().favoriteActions.includes(id);
        favorite.setAttribute('aria-label', `将${labels[id]}加入常用工具`);
        favorite.addEventListener('change', () => {
          if (!preferenceDraft) return;
          preferenceDraft.favoriteActions = favorite.checked
            ? [...preferenceDraft.favoriteActions, id]
            : preferenceDraft.favoriteActions.filter((item) => item !== id);
          applyPresentation();
        });
        row.append(favorite);
      }
      const side = document.createElement('select');
      side.setAttribute('aria-label', `${labels[id]}所在侧`);
      for (const [value, title] of [['left', '左侧'], ['right', '右侧']]) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = title;
        side.append(option);
      }
      side.value = presentation().toolbarSides[id];
      side.addEventListener('change', () => {
        if (!preferenceDraft) return;
        preferenceDraft.toolbarSides = { ...preferenceDraft.toolbarSides, [id]: side.value };
        applyPresentation();
      });
      row.append(side);
      const siblings = presentation().toolbarOrder.filter((candidate) => presentation().toolbarSides[candidate] === presentation().toolbarSides[id]);
      const groupIndex = siblings.indexOf(id);
      for (const [text, direction] of [
        ['上移', -1],
        ['下移', 1],
      ]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = text;
        button.setAttribute('aria-label', `${labels[id]}${text}`);
        button.disabled = groupIndex + direction < 0 || groupIndex + direction >= siblings.length;
        button.addEventListener('click', () => {
          if (!preferenceDraft) return;
          const order = [...preferenceDraft.toolbarOrder];
          const neighbor = siblings[groupIndex + direction];
          const otherIndex = order.indexOf(neighbor);
          [order[index], order[otherIndex]] = [order[otherIndex], order[index]];
          preferenceDraft.toolbarOrder = order;
          applyPresentation();
        });
        row.append(button);
      }
      container.append(row);
    });
  }

  function addPresentationSettings() {
    setupInfoPlacement();
    const scroll = $('#moreDialog .settings-scroll');
    const actionEntry = document.createElement('button');
    actionEntry.id = 'diaryActionsButton';
    actionEntry.className = 'appearance-button preference-row';
    actionEntry.type = 'button';
    actionEntry.textContent = '本篇操作  ·  复制全文 / TXT / PDF / 分享';
    scroll.insertBefore(actionEntry, $('#editEntryTitleButton'));
    const actionsDialog = document.createElement('dialog');
    actionsDialog.id = 'diaryActionsDialog';
    actionsDialog.className = 'sheet-dialog settings-dialog';
    actionsDialog.setAttribute('aria-labelledby', 'diaryActionsHeading');
    const actionHeading = document.createElement('div');
    actionHeading.className = 'dialog-heading';
    const back = document.createElement('button');
    back.type = 'button'; back.dataset.close = 'diaryActionsDialog';
    back.className = 'icon-button'; back.setAttribute('aria-label', '返回日记设置');
    back.textContent = '‹';
    const heading = document.createElement('h2');
    heading.id = 'diaryActionsHeading'; heading.textContent = '本篇操作';
    actionHeading.append(back, heading);
    const actionScroll = document.createElement('div');
    actionScroll.className = 'settings-scroll';
    for (const [id, label] of [['copyAll', '复制全文'], ['exportTxt', '导出 TXT'],
      ['exportPdf', '打印／导出 PDF'], ['shareText', '分享文本']]) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'appearance-button preference-row';
      button.dataset.diaryAction = id; button.textContent = label;
      actionScroll.append(button);
    }
    const trashNote = document.createElement('p');
    trashNote.className = 'entry-info';
    trashNote.textContent = '移入回收站暂不可用：当前本篇存储还缺提交期间输入保护。';
    actionScroll.append(trashNote);
    const status = document.createElement('p');
    status.id = 'diaryActionsStatus'; status.className = 'entry-info';
    status.setAttribute('role', 'status'); actionScroll.append(status);
    actionsDialog.append(actionHeading, actionScroll);
    document.body.append(actionsDialog);
    for (const [id, [, label, short]] of Object.entries(diaryActionButtons)) {
      const button = document.createElement('button');
      button.id = id; button.type = 'button'; button.className = 'diary-action-tool';
      button.dataset.diaryAction = diaryActionButtons[id][0];
      button.setAttribute('aria-label', label); button.title = label;
      button.textContent = short; button.hidden = true;
      $('#formatBar').insertBefore(button, $('#toolbarRightTools'));
    }
    const locationInput = $('#entryLocation');
    locationInput.maxLength = 100;
    const locationRow = locationInput.closest('.preference-row');
    const locationHelp = locationRow?.querySelector('small');
    if (locationHelp) locationHelp.textContent = '可手填，或点击定位读取一次手机位置';
    const locationButton = document.createElement('button');
    locationButton.id = 'requestEntryLocationButton';
    locationButton.className = 'appearance-button preference-row';
    locationButton.type = 'button';
    locationButton.textContent = '定位本篇地点';
    locationButton.setAttribute('aria-label', '定位本篇地点');
    locationRow?.after(locationButton);
    const field = (id, title, type, attributes = {}) => {
      const label = document.createElement('label');
      label.className = 'preference-row';
      label.htmlFor = id;
      const text = document.createElement('span');
      text.textContent = title;
      const input = document.createElement('input');
      input.id = id;
      input.type = type;
      for (const [name, value] of Object.entries(attributes)) input.setAttribute(name, value);
      label.append(text, input);
      scroll.append(label);
      return input;
    };
    field('emptyPromptSetting', '空白正文提示（不保存为正文）', 'text', { maxlength: '120' });
    field('autoIndentSetting', '新段落自动两格缩进', 'checkbox');
    field('globalImageWidthSetting', '新图片默认宽度 %', 'number', {
      min: '10',
      max: '100',
      step: '1',
    });
    field('entryImageWidthSetting', '本篇新图片宽度 %（留空继承默认）', 'number', {
      min: '10',
      max: '100',
      step: '1',
    });
    const order = document.createElement('section');
    order.id = 'toolbarOrderSetting';
    order.setAttribute('aria-label', '写作工具顺序');
    scroll.append(order);
  }

  function applyPresentation() {
    const view = presentation();
    const hasTitle = !!entry?.title?.trim();
    $('#entryTitle').hidden = reading;
    $('#readingTitle').hidden = !reading || !hasTitle;
    $('#readingTitle').textContent = entry?.title || '';
    $('#entryDetails').hidden = !view.showMetadata;
    $('#metadataButton').setAttribute('aria-expanded', String(view.showMetadata));
    $('#metadataButton').setAttribute('aria-label', view.showMetadata ? '收起标签' : '展开标签');
    $('#showTitle').checked = hasTitle || view.showTitle;
    $('#showTitle').disabled = hasTitle;
    $('#titlePreferenceHint').textContent = hasTitle
      ? '已有标题会一直显示，清空标题后可以收起'
      : '无标题时，直接从正文开始';
    $('#showMetadata').checked = view.showMetadata;
    $('#entryTitle').placeholder = suggestedTitle || '标题';
    $('#emptyHint').textContent = `${view.autoIndentParagraph ? '　　' : ''}${view.emptyPrompt}`;
    adapter?.editor?.view.dom.setAttribute('data-placeholder', view.emptyPrompt);
    paintInheritedImages();
    arrangeToolbar(view.toolbarOrder, view.toolbarSides);
    for (const [id, value] of [
      ['emptyPromptSetting', view.emptyPrompt],
      ['globalImageWidthSetting', view.imageWidthPercent],
      [
        'entryImageWidthSetting',
        (entryImageWidthDraft === undefined ? entryImageWidthPercent : entryImageWidthDraft) ?? '',
      ],
    ]) {
      const input = $(`#${id}`);
      if (input && document.activeElement !== input) input.value = value;
    }
    if ($('#autoIndentSetting')) $('#autoIndentSetting').checked = view.autoIndentParagraph;
    paintToolbarOrder();
    // Reading remains available from the ordinary diary list. Settings no longer
    // exposes a second mode switch that can be mistaken for a successful save.
    if ($('#readingModeButton')) $('#readingModeButton').hidden = true;
    $('#chooseCategoryOnCreate').checked = view.chooseCategoryOnCreate;
    $('#serifFont').checked = view.serifFont;
    $('#editorPage').classList.toggle('system-font', !view.serifFont);
    document.documentElement.style.setProperty('--body-size', `${view.fontSize}px`);
    document.documentElement.style.setProperty('--body-line-height', String(view.lineHeight));
    document.documentElement.style.setProperty('--body-font-weight', String(view.fontWeight));
    document.documentElement.style.setProperty(
      '--body-paragraph-spacing',
      `${view.paragraphSpacing}em`,
    );
    if (!$('#typographyDialog').open) {
      $('#bodyFontSize').value = view.fontSize;
      $('#bodyLineHeight').value = view.lineHeight;
      $('#bodyFontWeight').value = view.fontWeight;
      $('#bodyParagraphSpacing').value = view.paragraphSpacing;
    }
    $('#typographySummary').textContent =
      `${view.fontSize}px · 字重${view.fontWeight} · 行高${view.lineHeight} · 段距${view.paragraphSpacing} · ${view.serifFont ? '衬线字体' : '系统字体'}`;
    $('#settingsStatus').textContent = pendingSettings()
      ? '有未保存设置；返回不会丢失，点保存后记住。'
      : '设置会即时预览，保存后记住。';
    $('#moreButton').classList.toggle('has-pending-settings', !!pendingSettings());
    updateStats();
  }

  function openDialog(id, parent = null) {
    if (parent === 'moreDialog' && settingsSaving) return;
    if (parent) {
      if (parent === 'moreDialog') settingsGeneration++;
      $(`#${parent}`).close();
    }
    dialogParents.set(id, parent);
    $(`#${id}`).showModal();
  }

  function closeDialog(id) {
    if (id === 'infoPlacementDialog') {
      infoPlacementDraft = null;
      applyInfoPlacement();
    }
    const dialog = $(`#${id}`);
    if (id === 'moreDialog' && settingsSaving) return false;
    if (id === 'typographyDialog' && !validTypography()) return false;
    if (id === 'moreDialog') settingsGeneration++;
    dialog.close();
    const parent = dialogParents.get(id);
    dialogParents.delete(id);
    if (parent) $(`#${parent}`).showModal();
    return true;
  }

  function openSettings() {
    preferenceDraft ||= { ...preferences, toolbarOrder: [...preferences.toolbarOrder], toolbarSides: { ...preferences.toolbarSides }, favoriteActions: [...preferences.favoriteActions] };
    if (entryImageWidthDraft === undefined) entryImageWidthDraft = entryImageWidthPercent;
    if (entryLocationDraft === undefined) entryLocationDraft = entry?.location || '';
    $('#entryLocation').value = entryLocationDraft;
    settingsGeneration++;
    applyPresentation();
    openDialog('moreDialog');
  }

  function validTypography() {
    const size = Number($('#bodyFontSize').value);
    const line = Number($('#bodyLineHeight').value);
    const weight = Number($('#bodyFontWeight').value);
    const paragraph = Number($('#bodyParagraphSpacing').value);
    const valid =
      Number.isInteger(size) &&
      size >= 8 &&
      size <= 40 &&
      Number.isInteger(weight) &&
      weight >= 400 &&
      weight <= 700 &&
      $('#bodyParagraphSpacing').value.trim() !== '' &&
      Number.isFinite(paragraph) &&
      paragraph >= 0 &&
      paragraph <= 2 &&
      Number.isFinite(line) &&
      line >= 1.2 &&
      line <= 2.5;
    $('#typographyStatus').textContent = valid
      ? '正在预览。返回后点“保存设置”记住排版。'
      : '请输入8–40px字号、400–700字重、0–2倍段距与1.2–2.5倍行高。';
    return valid;
  }

  function normalizeCategories(list) {
    return (list || [])
      .map((category) =>
        typeof category === 'string'
          ? { id: category, name: category }
          : {
              id: category.id,
              productId: category.productId,
              name: category.name || category.title || '未命名分类',
            },
      )
      .filter((category) => category.id);
  }

  async function manageCategories(operation, buttonId) {
    $(buttonId).disabled = true;
    try {
      await flush();
      const bootstrap = await rpc(operation);
      if (bootstrap?.categories) categories = normalizeCategories(bootstrap.categories);
      if (bootstrap?.writingPreferences)
        defaultCategoryId = bootstrap.writingPreferences.defaultCategoryId || '';
      const result = await rpc('productEntryGet', { id: entry.id });
      const fresh = result?.entry || result;
      if (
        fresh?.id === entry.id &&
        Number.isInteger(fresh.revision) &&
        fresh.revision >= revision
      ) {
        revision = fresh.revision;
        entry.revision = revision;
        entry.categoryId = fresh.categoryId || '';
        entry.updatedAt = fresh.updatedAt || entry.updatedAt;
        productState = result;
        entryCapability = inspectLocalEntry(result);
      }
      paintCategories();
      savedStatus();
    } catch (error) {
      toast(error.message || '分类管理未能打开，请重试。');
    } finally {
      $(buttonId).disabled = false;
    }
  }

  function updateMetadataSummary() {
    const parts = [];
    if (reading && entry?.categoryId) parts.push(categoryName(entry.categoryId));
    if (entry?.tags?.length) parts.push(`${entry.tags.length} 个标签`);
    $('#metadataSummary').textContent = parts.join(' · ') || (reading ? '分类与标签' : '标签');
  }

  let wallpaperViewportWidth = 0,
    wallpaperViewportHeight = 0;
  let inputScrollAnchor = null;
  let userScrollOverride = false;
  let scrollPointer = null;
  const caretClearance = 84;
  function rememberInputScroll(event) {
    if (!event.target?.closest?.('.tiptap')) return;
    const scroller = $('#pageScroll');
    if (!scroller || reading || !adapter?.editor) return;
    userScrollOverride = false;
    if (!inputScrollAnchor || !composingField)
      inputScrollAnchor = { scrollTop: scroller.scrollTop, at: performance.now() };
  }
  function updateViewport() {
    const viewport = window.visualViewport;
    const width = Math.round(viewport?.width || innerWidth),
      height = Math.round(viewport?.height || innerHeight);
    if (Math.abs(width - wallpaperViewportWidth) > 1) {
      wallpaperViewportWidth = width;
      wallpaperViewportHeight = height;
    } else wallpaperViewportHeight = Math.max(wallpaperViewportHeight, height);
    document.documentElement.style.setProperty(
      '--diary-wallpaper-height',
      `${wallpaperViewportHeight}px`,
    );
    document.documentElement.style.setProperty(
      '--viewport-height',
      `${Math.round(viewport?.height || innerHeight)}px`,
    );
    scheduleCaretVisibility();
  }
  function keepCaretVisible() {
    const editor = adapter?.editor;
    const scroller = $('#pageScroll');
    if (
      window.shiyeDiaryScrollCapture ||
      userScrollOverride ||
      reading ||
      !editor ||
      document.activeElement !== editor.view.dom ||
      !scroller
    )
      return;
    try {
      const caret = editor.view.coordsAtPos(editor.state.selection.head);
      const area = scroller.getBoundingClientRect();
      const top = area.top + 10;
      const visibleBottom = Math.min(
        area.bottom,
        (window.visualViewport?.offsetTop || 0) + (window.visualViewport?.height || innerHeight),
      );
      // The phone's reference layout is 15px × 1.85 line-height: about 83px
      // for three lines. This is a fixed viewport clearance, independent of
      // a later user change to line-height. A visible caret does not move.
      // A text insertion can make ProseMirror/the browser scroll first. In
      // that case the caret is already technically visible by this frame,
      // but its clearance can be much smaller than the editor's fixed target.
      const scrolledForInput =
        inputScrollAnchor &&
        performance.now() - inputScrollAnchor.at < 1500 &&
        scroller.scrollTop > inputScrollAnchor.scrollTop + 2;
      if (
        caret.bottom > visibleBottom - 2 ||
        (scrolledForInput && caret.bottom > visibleBottom - caretClearance + 2)
      ) {
        const targetBottom = Math.max(top + 24, visibleBottom - caretClearance);
        const delta = caret.bottom - targetBottom;
        if (delta > 2) scroller.scrollTop += delta;
      } else if (caret.top < top - 2) scroller.scrollTop -= top - caret.top;
      if (!composingField) inputScrollAnchor = null;
    } catch {
      // The selection can be temporarily unmapped during IME composition.
    }
  }
  function scheduleCaretVisibility() {
    if (window.shiyeDiaryScrollCapture) return;
    if (caretFrame) cancelAnimationFrame(caretFrame);
    caretFrame = requestAnimationFrame(() => {
      caretFrame = 0;
      keepCaretVisible();
    });
  }
  updateViewport();
  window.visualViewport?.addEventListener('resize', updateViewport);
  window.addEventListener('resize', updateViewport);

  function toast(message) {
    clearTimeout(toastTimer);
    $('#toast').textContent = message;
    $('#toast').hidden = false;
    toastTimer = setTimeout(() => {
      $('#toast').hidden = true;
    }, 4200);
  }

  function savedStatus() {
    const status = $('#saveStatus');
    if (blocked) {
      status.textContent = '只读保护';
      status.dataset.state = 'error';
    } else if (lastError) {
      status.textContent = '保存失败 · 点此重试';
      status.dataset.state = 'error';
    } else if (saving) {
      status.textContent = '正在保存…';
      status.dataset.state = 'saving';
    } else if (dirty()) {
      status.textContent = '尚未保存';
      status.dataset.state = 'dirty';
    } else {
      status.textContent = entry?.draftOnly ? (savedVersion ? '草稿已保存到本机' : '未写内容') : '已保存到本机';
      status.dataset.state = 'saved';
    }
    status.title = lastError || (lastSavedAt ? `最近本地确认：${lastSavedAt}` : '本地自动保存');
  }

  function scheduleSave(delay = 400) {
    clearTimeout(timer);
    if (!blocked && !reading && dirty() && !composingField && !adapter?.composing) {
      timer = setTimeout(() => save().catch(showSaveError), delay);
    }
  }

  function markDirty() {
    if (blocked || !entry) return;
    version++;
    lastError = '';
    savedStatus();
    updateStats();
    scheduleSave();
  }

  function showSaveError(error) {
    lastError = error?.message || '保存失败，请重试。';
    savedStatus();
    toast(lastError);
  }

  async function waitForComposition() {
    const start = Date.now();
    while (composingField || adapter?.composing) {
      if (Date.now() - start > 15000) throw new Error('请先完成当前组词，再保存或返回。');
      await new Promise((resolve) => setTimeout(resolve, 35));
    }
  }

  function richBodyText(body) {
    const lines = [];
    const walk = (nodes) => {
      for (const node of nodes || []) {
        if (node.type === 'text') lines.push(node.text || '');
        else if (node.type === 'hardBreak') lines.push('\n');
        else if (node.type === 'image' || node.type === 'video')
          lines.push(node.type === 'image' ? '［图片］' : '［视频］');
        if (Array.isArray(node.content)) walk(node.content);
        if (
          [
            'paragraph',
            'heading',
            'blockquote',
            'listItem',
            'taskItem',
            'codeBlock',
            'tableRow',
          ].includes(node.type)
        )
          lines.push('\n');
      }
    };
    walk(body?.content);
    return lines.join('').trim();
  }

  async function requestSuggestedTitle() {
    if (
      !entry?.draftOnly ||
      new URLSearchParams(location.search).get('new') !== '1' ||
      titleTouched ||
      entry.title?.trim()
    )
      return;
    const generation = ++suggestionGeneration;
    const requestedEntryId = entry.id;
    const categoryId = entry.categoryId || '';
    const date = datePart(entry.date);
    suggestedTitle = '';
    $('#entryTitle').placeholder = '标题';
    try {
      const answer = await rpc('getSuggestedTitle', { entryId: entry.id, categoryId, date });
      if (
        generation !== suggestionGeneration || requestedEntryId !== entry?.id ||
        categoryId !== (entry.categoryId || '') ||
        date !== datePart(entry.date) ||
        titleTouched ||
        entry.title?.trim()
      )
        return;
      const title = answer?.title;
      if (
        answer?.date === date &&
        (answer?.categoryId || '') === categoryId &&
        Number.isSafeInteger(answer?.sequence) &&
        answer.sequence >= 1 &&
        typeof title === 'string' &&
        title.length > 0 &&
        title.length <= 500
      ) {
        suggestedTitle = title;
        $('#entryTitle').placeholder = title;
      }
    } catch {
      // Older native packages have no safe diary-only counter. Never guess from
      // generic bootstrap entries, which can include chat-derived journals.
    }
  }

  function save({ finalizeDraft = false } = {}) {
    clearTimeout(timer);
    const task = queue.then(async () => {
      await waitForComposition();
      if (blocked || !entry) return entry;
      if (adapter.commit({ markDirty: false })) version++;
      if (!dirty() && !(finalizeDraft && entry.draftOnly)) return entry;
      const ticket = version;
      const meaningful = (node) =>
        !!node &&
        ((typeof node.text === 'string' && !!node.text.replace(/[\u200b\ufeff]/gu, '').trim()) ||
          ['image', 'video'].includes(node.type) ||
          node.content?.some(meaningful));
      // New entries remain in the existing native draft owner until exit. This
      // persists body/media locally without assigning a title or publishing an Entry.
      if (entry.draftOnly && (!finalizeDraft ||
          (!String(entry.title || '').trim() && !meaningful({ content: entry.body?.content }) && !(entry.attachments || []).length))) {
        const draftSnapshot = Object.fromEntries(
          ['title', 'date', 'categoryId', 'tags', 'attachments', 'body', 'location']
            .filter((key) => Object.hasOwn(entry, key))
            .map((key) => [key, structuredClone(entry[key])]),
        );
        saving = true; lastError = ''; savedStatus();
        try {
          const answer = await rpc('saveEntryDraft', {
            id: entry.id, baseRevision: revision, ...draftSnapshot,
          });
          const saved = answer?.entry;
          if (!Number.isSafeInteger(saved?.revision) || saved.revision <= revision || !saved.draftOnly)
            throw new Error('草稿保存结果未确认，请保留本页并重试。');
          revision = saved.revision;
          productState = answer;
          entryCapability = inspectLocalEntry(answer);
          entry.revision = revision;
          entry.updatedAt = saved.updatedAt;
          savedVersion = ticket;
          lastSavedAt = saved.updatedAt;
          return entry;
        } catch (error) {
          lastError = error?.message || '草稿保存失败，请重试。';
          throw error;
        } finally { saving = false; savedStatus(); }
      }
      if (
        entry.draftOnly &&
        !titleTouched &&
        !entry.title?.trim() &&
        (meaningful({ content: entry.body?.content }) || (entry.attachments || []).length)
      )
        await requestSuggestedTitle();
      if (entry.draftOnly && !titleTouched && !entry.title?.trim() &&
          (meaningful({ content: entry.body?.content }) || (entry.attachments || []).length) && !suggestedTitle)
        throw new Error('自动标题尚未确认，请稍后重试或手填标题。');
      const changes = {};
      for (const key of ['title', 'date', 'categoryId', 'tags', 'attachments', 'body', 'location'])
        if (
          Object.hasOwn(entry, key) &&
          JSON.stringify(entry[key]) !== JSON.stringify(entryCapability.entryOriginal[key])
        )
          changes[key] = structuredClone(entry[key]);
      if (
        suggestedTitle &&
        entry.draftOnly &&
        !titleTouched &&
        !entry.title?.trim() &&
        (meaningful({ content: entry.body?.content }) || (entry.attachments || []).length)
      )
        changes.title = suggestedTitle;
      if (finalizeDraft && entry.draftOnly && entry.title?.trim() && !Object.hasOwn(changes, 'title'))
        changes.title = entry.title;
      if (finalizeDraft && entry.draftOnly && !Object.keys(changes).length &&
          (meaningful({ content: entry.body?.content }) || (entry.attachments || []).length))
        changes.body = structuredClone(entry.body);
      // A new draft with only the editor's automatic indent/prompt or a title
      // that was typed and then erased is still empty. Existing entries never
      // take this path, and an explicitly nonempty title or image is retained.
      if (
        entry.draftOnly &&
        !String(entry.title || '').trim() &&
        !meaningful({ content: entry.body?.content }) &&
        !(entry.attachments || []).length
      ) {
        savedVersion = ticket;
        savedStatus();
        return entry;
      }
      if (!Object.keys(changes).length) {
        // A selection/format transaction can schedule autosave without changing
        // the committed rich document. Do not bump revision or updatedAt with an
        // empty declaration; ProductDiaryStore correctly rejects that mismatch.
        savedVersion = ticket;
        savedStatus();
        return entry;
      }
      const merged = mergeEntryChanges(entryCapability, changes, {
        validateRenderableRichDocument: validateRenderableBody,
      });
      const previousRecord = productState?.record?.local;
      const original = previousRecord?.data
        ? structuredClone(previousRecord.data)
        : structuredClone(entryCapability.entryOriginal);
      delete original._product;
      delete original._canonical;
      for (const [key, value] of Object.entries(changes)) original[key] = structuredClone(value);
      if (
        !previousRecord &&
        entryCapability.entryOriginal?.draftOnly &&
        !String(original.title || '').trim() &&
        !meaningful({ content: original.body?.content }) &&
        !(original.attachments || []).length
      ) {
        // No blank Entry is published; the native draft remains discardable on return.
        savedVersion = ticket;
        return entry;
      }
      const refs = structuredClone(previousRecord?.data?._product?.refs || {});
      const changedFields = Object.keys(changes);
      // A legacy draft becomes a regular Entry on its first meaningful save.
      // The repository compares every preserved field, so declare this transition.
      if (previousRecord?.data?.draftOnly === true && !changedFields.includes('draftOnly'))
        changedFields.push('draftOnly');
      if (!previousRecord || Object.hasOwn(changes, 'categoryId')) {
        const selected = categories.find((category) => category.id === merged.categoryId);
        original.category = selected?.name || '';
        refs.category = selected?.productId || selected?.id || null;
        if (!changedFields.includes('category')) changedFields.push('category');
      }
      if (!previousRecord || Object.hasOwn(changes, 'tags')) {
        const oldNames = entryCapability.entryOriginal.tags || [],
          oldRefs = refs.tags || [];
        refs.tags = (original.tags || []).map(
          (name) =>
            oldRefs[oldNames.indexOf(name)] ||
            productContent.legacyTaxonomyId(productState.sourceId, 'tag', name),
        );
      }
      const now = new Date().toISOString();
      original.revision = revision + 1;
      original.updatedAt = now;
      original.draftOnly = false;
      if (Object.hasOwn(changes, 'body') || Object.hasOwn(changes, 'attachments'))
        original.contentEditedAt = now;
      const contentDirty = Object.hasOwn(changes, 'body') || Object.hasOwn(changes, 'attachments');
      // prepareProductEntry owns canonical units; these list/search projections follow
      // the same rich body and never become a second body authority.
      if (contentDirty || !previousRecord) {
        const text = richBodyText(original.body);
        original.searchText = text;
        original.preview = text.replace(/\s+/gu, ' ').trim().slice(0, 100);
        original.wordCount = [...text.replace(/\s/gu, '')].length;
      }
      let preparedRecord;
      if (previousRecord && !contentDirty) {
        // Metadata must retain canonical units, layout, provenance and unknown annotations exactly.
        const data = structuredClone(previousRecord.data);
        for (const [key, value] of Object.entries(changes)) data[key] = structuredClone(value);
        data.revision = original.revision;
        data.updatedAt = original.updatedAt;
        data.draftOnly = false;
        data.category = original.category;
        data._product.refs = refs;
        preparedRecord = { entityType: 'journalAggregate', entityId: original.id, data };
        productContent.validateProductRecord(
          preparedRecord.entityType,
          preparedRecord.entityId,
          data,
        );
      } else {
        preparedRecord = productContent.prepareProductEntry(original, {
          refs,
          previousRecord,
          media: productState?.media || [],
          timeZone: 'Asia/Shanghai',
        });
        const oldProduct = previousRecord?.data?._product;
        if (oldProduct) {
          for (const [key, value] of Object.entries(oldProduct))
            if (!Object.hasOwn(preparedRecord.data._product, key))
              preparedRecord.data._product[key] = structuredClone(value);
          productContent.validateProductRecord(
            preparedRecord.entityType,
            preparedRecord.entityId,
            preparedRecord.data,
          );
        }
      }
      const snapshot = {
        preparedRecord,
        dirtyFields: changedFields,
        expectedLocalRevision: productState?.localRevision || 0,
        ...(productState?.legacy ? { legacyId: original.id } : {}),
        ...(entry.draftOnly ? { draftBaseRevision: revision } : {}),
      };
      const submittedTitle = entry.title;
      const submittedTitleTouched = titleTouched;
      const modeSnapshot = new Map([...imageWidthModes].map(([id, mode]) => [id, { ...mode }]));
      saving = true;
      lastError = '';
      savedStatus();
      try {
        const answer = await rpc('productEntrySave', snapshot);
        const saved = answer?.entry || answer;
        if (!Number.isInteger(saved?.revision) || saved.revision <= revision) {
          throw new Error('保存结果未确认，请保留本页并重试。');
        }
        revision = saved.revision;
        productState = answer;
        entryCapability = inspectLocalEntry(answer);
        entry.revision = revision;
        entry.draftOnly = saved.draftOnly === true;
        // The persisted title acknowledges this snapshot only; later typing owns the field.
        if (entry.title === submittedTitle && titleTouched === submittedTitleTouched) {
          entry.title = saved.title ?? original.title;
          $('#entryTitle').value = entry.title;
          applyPresentation();
        }
        entry.updatedAt = saved.updatedAt || entry.updatedAt;
        savedVersion = ticket;
        lastSavedAt = saved.updatedAt || new Date().toISOString();
        if (imageWidthModesDirty) {
          const confirmed = confirmedImageIds(saved.body || original.body);
          const durable = new Map([...modeSnapshot].filter(([id]) => confirmed.has(id)));
          persistImageWidthModes(durable);
          if (JSON.stringify([...imageWidthModes]) !== JSON.stringify([...modeSnapshot]))
            imageWidthModesDirty = true;
        }
        return entry;
      } catch (error) {
        lastError = error?.message || '保存失败，请重试。';
        throw error;
      } finally {
        saving = false;
        savedStatus();
      }
    });
    queue = task.catch(() => {});
    return task;
  }

  async function flush(options = {}) {
    await ready;
    await waitForComposition();
    await save(options);
    while (dirty() && !blocked) await save(options);
    return structuredClone(entry);
  }

  async function requestClose() {
    if (closing) return false;
    closing = true;
    $('#backButton').disabled = true;
    try {
      const dialog = document.querySelector('dialog[open]');
      if (dialog) {
        closeDialog(dialog.id);
        return false;
      }
      if (pendingSettings()) {
        openSettings();
        toast('排版设置尚未保存，请保存设置或取消修改后返回。');
        return false;
      }
      if (blocked && !window.shiyeEditor.ready) {
        await rpc('closeEditor');
        retireAutoLocation();
        return true;
      }
      await flush({ finalizeDraft: true });
      await rpc('closeEditor');
      retireAutoLocation();
      return true;
    } catch (error) {
      showSaveError(error);
      if (error.code === 'empty_entry') {
        $('#emptyCloseError').hidden = true;
        openDialog('emptyCloseDialog');
      }
      return false;
    } finally {
      closing = false;
      $('#backButton').disabled = false;
    }
  }

  function snapshot() {
    return {
      ready: window.shiyeEditor.ready,
      id: entry?.id || null,
      revision,
      dirty: dirty(),
      saving,
      composing: composingField || !!adapter?.composing,
      reading,
      blocked,
      draftOnly: entry?.draftOnly === true,
      contentCapability: entryCapability
        ? {
            supported: entryCapability.supported,
            readOnly: entryCapability.readOnly,
            reason: entryCapability.reason,
          }
        : null,
      error: lastError,
      title: entry?.title || '',
      date: entry?.date || '',
      categoryId: entry?.categoryId || '',
      tags: [...(entry?.tags || [])],
      body: entry?.body ? structuredClone(entry.body) : null,
      wordCount: [...(adapter?.editor?.state.doc.textContent || '').replace(/\s/gu, '')].length,
      imageCount: $('#bodyEditor').querySelectorAll('figure[data-rich-image]').length,
    };
  }
  function captureCurrentDiaryAction() {
    if (!entry || !entryCapability?.supported || !adapter?.editor ||
        !window.shiyeEditor.ready || closing || navigationCommitted)
      throw new Error('请等本篇完整正文就绪后重试。');
    if (entry.body?.format !== 'shiye-richdoc')
      throw new Error('当前正文格式尚不能完整导出，原件未改变。');
    // snapshot().body is the last committed entry; the live editor JSON is authoritative here.
    const body = diaryActionRich.fromEditorJSON(adapter.editor.getJSON());
    return {
      owner: productState?.legacy ? 'legacy' : 'product',
      id: entry.id,
      generation: version,
      revision,
      title: reading ? entry.title || '' : $('#entryTitle').value,
      date: entry.date || '',
      body,
      contentFormat: 'richdoc',
      complete: true,
      composing: composingField || !!adapter.composing || !!adapter.editor.view.composing,
      dirty: dirty(),
      readOnly: !!entryCapability.readOnly,
      draftOnly: entry.draftOnly === true,
    };
  }
  function diaryDocumentRpc(args) {
    const request = { op: 'diaryDocumentAction', ...args };
    if (new TextEncoder().encode(JSON.stringify(request)).length > 3_800_000)
      throw new Error('本篇导出请求超过当前系统出口容量，未发送。');
    return rpc('diaryDocumentAction', args);
  }
  async function runDiaryAction(id) {
    if (diaryActionRunning || !diaryActions) return;
    diaryActionRunning = true;
    const buttons = [...document.querySelectorAll('[data-diary-action]')];
    buttons.forEach((button) => { button.disabled = true; });
    const status = $('#diaryActionsStatus');
    try {
      const targetId = entry?.id;
      await waitForComposition();
      if (!targetId || entry?.id !== targetId || closing || navigationCommitted)
        throw new Error('当前篇目已经改变，请重新操作。');
      const result = await diaryActions.run(id);
      const message = result?.cancelled ? '已取消，未导出文件。' :
        id === 'copyAll' ? '全文已复制到系统剪贴板。' :
        id === 'exportTxt' ? (result?.saved ? 'TXT 已写入所选文件。' : 'TXT 未完成。') :
        id === 'exportPdf' ? (result?.printDialogOpened ? '已打开系统打印页；文件保存由系统确认。' : '打印页未打开。') :
        (result?.chooserOpened ? '已打开系统分享选择器。' : '分享选择器未打开。');
      if (status && entry?.id === targetId) status.textContent = message;
      if (!navigationCommitted && entry?.id === targetId) toast(message);
    } catch (error) {
      if (status) status.textContent = error?.message || '本篇操作未完成。';
      if (!navigationCommitted) toast(error?.message || '本篇操作未完成。');
    } finally {
      diaryActionRunning = false;
      buttons.forEach((button) => { button.disabled = false; });
    }
  }
  window.shiyeEditor = { ready: false, flush, snapshot, requestClose };
  Object.defineProperty(window.shiyeEditor, 'wallpaperState', { get: () => wallpaperState });

  function updateStats() {
    if (!adapter?.editor) return;
    const text = adapter.editor.state.doc.textContent;
    const count = [...text.replace(/\s/gu, '')].length;
    const countText = `${count.toLocaleString('zh-CN')} 字`;
    if ($('#wordCount').textContent !== countText) $('#wordCount').textContent = countText;
    const info = `${count.toLocaleString('zh-CN')} 字 · ${$('#bodyEditor').querySelectorAll('figure[data-rich-image]').length} 张图片 · 仅保存在本机`;
    if ($('#entryInfo').textContent !== info) $('#entryInfo').textContent = info;
    $('#emptyHint').hidden =
      reading ||
      !!text.trim() ||
      adapter.editor.state.doc.content.childCount > 1 ||
      !!$('#bodyEditor').querySelector('figure[data-rich-image], video');
    const paper = $('#bodyEditor');
    const paperStyle = getComputedStyle(paper);
    $('#emptyHint').style.top = `${paper.offsetTop + parseFloat(paperStyle.paddingTop || 0)}px`;
    $('#emptyHint').style.left = `${paper.offsetLeft + parseFloat(paperStyle.paddingLeft || 0)}px`;
    paintAttachments();
    applyInfoPlacement();
  }

  function paintAttachments() {
    if (!adapter?.editor) return;
    const media = [];
    adapter.editor.state.doc.descendants((node, position) => {
      if (node.type.name === 'image') media.push({ attrs: node.attrs, position });
    });
    $('#attachmentCount').textContent = String(media.length);
    $('#attachmentSection').classList.toggle('is-empty', !media.length);
    $('#attachmentEmpty').hidden = media.length > 0;
    $('#attachmentSection').hidden = !media.length;
    $('#imageButton').hidden = reading;
    const grid = $('#attachmentGrid');
    // Reuse cards while typing so image decoding and keyboard focus remain stable.
    const previous = new Map([...grid.children].map((card) => [card.dataset.occurrenceId, card]));
    for (const [index, item] of media.entries()) {
      const a = item.attrs;
      let card = previous.get(a.occurrenceId);
      previous.delete(a.occurrenceId);
      if (!card) {
        card = document.createElement('article');
        card.className = 'attachment-card';
        card.dataset.occurrenceId = a.occurrenceId;
        const preview = document.createElement('button');
        preview.type = 'button';
        preview.className = 'attachment-preview';
        const img = document.createElement('img');
        img.loading = 'lazy';
        img.addEventListener('error', () => preview.classList.add('preview-unavailable'));
        img.addEventListener('load', () => preview.classList.remove('preview-unavailable'));
        preview.append(img);
        preview.addEventListener('click', () =>
          rpc('viewImage', { assetId: card.dataset.assetId }).catch((error) =>
            toast(error.message),
          ),
        );
        const caption = document.createElement('p');
        caption.className = 'attachment-caption';
        const time = document.createElement('p');
        time.className = 'attachment-time';
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'attachment-edit';
        edit.textContent = '编辑信息';
        edit.addEventListener('click', () => {
          let target;
          adapter.editor.state.doc.descendants((node, position) => {
            if (node.type.name === 'image' && node.attrs.occurrenceId === card.dataset.occurrenceId)
              target = position;
          });
          if (reading || target === undefined) return;
          adapter.editor.commands.setNodeSelection(target);
          editImage();
        });
        card.append(preview, caption, time, edit);
      }
      card.dataset.assetId = a.assetId;
      const image = card.querySelector('img');
      const src = `/media/${encodeURIComponent(a.assetId)}`;
      if (image.getAttribute('src') !== src) image.src = src;
      image.alt = a.alt || `图片附件 ${index + 1}`;
      card
        .querySelector('.attachment-preview')
        .setAttribute('aria-label', `查看图片附件 ${index + 1}`);
      const captionText = a.caption || `图片 ${index + 1}`;
      if (card.querySelector('.attachment-caption').textContent !== captionText)
        card.querySelector('.attachment-caption').textContent = captionText;
      const timeText = a.insertedAt
        ? `插入于 ${new Date(a.insertedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
        : '插入时间未知';
      if (card.querySelector('.attachment-time').textContent !== timeText)
        card.querySelector('.attachment-time').textContent = timeText;
      card.querySelector('.attachment-edit').hidden = reading;
      if (grid.children[index] !== card) grid.insertBefore(card, grid.children[index] || null);
    }
    for (const card of previous.values()) card.remove();
  }

  function updateToolbar() {
    const editor = adapter?.editor;
    if (!editor) return;
    const active = {
      bold: 'bold',
      italic: 'italic',
      underline: 'underline',
      strikeThrough: 'strike',
      hiliteColor: 'highlight',
      insertUnorderedList: 'bulletList',
      insertOrderedList: 'orderedList',
    };
    document.querySelectorAll('[data-command]').forEach((button) => {
      const command = button.dataset.command;
      let pressed = active[command] ? editor.isActive(active[command]) : false;
      if (command === 'formatBlock' && button.dataset.value === 'h2')
        pressed = editor.isActive('heading', { level: 2 });
      if (command === 'formatBlock' && button.dataset.value === 'p') {
        // Show the real block state. Selecting ¶ cancels headings, quotes and
        // code blocks; selecting any of those again leaves the paragraph state.
        button.setAttribute('aria-pressed', String(editor.isActive('paragraph')));
        button.setAttribute('aria-label', editor.isActive('paragraph') ? '普通段落，当前格式' : '改为普通段落');
        return;
      }
      if (command === 'formatBlock' && button.dataset.value === 'blockquote')
        pressed = editor.isActive('blockquote');
      if (command === 'formatBlock' && button.dataset.value === 'pre')
        pressed = editor.isActive('codeBlock');
      if (command === 'undo' || command === 'redo') button.disabled = !editor.can()[command]();
      else button.setAttribute('aria-pressed', String(pressed));
    });
    $('#imageInfoButton').hidden = !adapter.selectedImage();
  }

  function paintTags() {
    $('#tagList').replaceChildren();
    for (const tag of entry.tags || []) {
      const node = document.createElement('span');
      node.className = 'tag';
      node.textContent = `# ${tag}`;
      $('#tagList').append(node);
    }
    $('#tagsButton').textContent = entry.tags?.length ? '编辑标签' : '＋ 标签';
    updateMetadataSummary();
  }

  function categoryName(id) {
    return categories.find((category) => category.id === id)?.name || (id ? '其他分类' : '未分类');
  }

  function paintCategories() {
    $('#categoryButton').textContent = categoryName(entry.categoryId);
    $('#entryCategoryName').textContent = categoryName(entry.categoryId);
    $('#entryCategoryButton').setAttribute(
      'aria-label',
      `选择本篇写作分类，当前${categoryName(entry.categoryId)}`,
    );
    $('#settingsCategoryName').textContent = categoryName(entry.categoryId);
    updateMetadataSummary();
    const choices = [{ id: '', name: '未分类' }, ...categories];
    $('#categoryChoices').replaceChildren();
    for (const category of choices) {
      const button = document.createElement('button');
      button.type = 'button';
      button.disabled = blocked;
      const isDefault = category.id === defaultCategoryId;
      button.textContent = category.name + (isDefault ? ' · 默认' : '');
      button.setAttribute('aria-label', `${category.name}${isDefault ? '，新建日记默认分类' : ''}`);
      button.setAttribute('aria-pressed', String((entry.categoryId || '') === category.id));
      button.addEventListener('click', () => {
        if (blocked || (entry.categoryId || '') === category.id) {
          closeDialog('categoryDialog');
          return;
        }
        entry.categoryId = category.id;
        suggestedTitle = '';
        requestSuggestedTitle();
        markDirty();
        paintCategories();
        closeDialog('categoryDialog');
        // Reading keeps the editor readonly, but an explicit category choice is
        // metadata work. A failed save leaves the choice visibly unsaved and
        // available through the existing status retry action.
        if (reading) save().catch(showSaveError);
      });
      $('#categoryChoices').append(button);
    }
  }

  function datePart(value) {
    if (value === undefined || value === null || value === '') return '';
    const day = diaryTimeZone.zonedDay(value);
    return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : '';
  }

  function paintWeekday() {
    const value = $('#entryDate').value;
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    $('#entryDateDisplay').textContent = parts
      ? `${parts[1].slice(2)}.${parts[2]}.${parts[3]}`
      : '选择日期';
    $('#weekday').textContent = value
      ? new Date(`${value}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' })
      : '';
    $('#readingDay').textContent = parts ? String(Number(parts[3])).padStart(2, '0') : '—';
    $('#readingMonth').textContent = parts
      ? `${Number(parts[2])}月 · ${$('#weekday').textContent}`
      : '';
    $('#readingYear').textContent = parts ? `${parts[1]}年` : '';
    const dateTime =
      entry?.date && !(typeof entry.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.date))
        ? diaryTimeZone.dateParts(entry.date)
        : null;
    $('#entryMetaTime').textContent =
      dateTime && dateTime.hour !== 'NaN' ? `${dateTime.hour}:${dateTime.minute}` : ''; // Same selected-zone algorithm as datePart; date-only never manufactures time.
    $('#entryMetaTime').hidden = true;
    const place =
      typeof entry?.location === 'string'
        ? entry.location
        : typeof entry?.place === 'string'
          ? entry.place
          : '';
    $('#entryMetaPlace').textContent = place.trim();
    $('#entryMetaPlace').hidden = !place.trim();
    if (document.activeElement !== $('#entryLocation'))
      $('#entryLocation').value = entryLocationDraft === undefined ? place : entryLocationDraft;
    applyInfoPlacement();
  }

  async function setReading(next) {
    if (next && !reading) {
      try {
        await flush();
      } catch (error) {
        showSaveError(error);
        return;
      }
    }
    reading = next || blocked;
    $('#editorPage').classList.toggle('reading', reading);
    $('#pageModeLabel').textContent = reading ? '思绪' : '写日记';
    $('#modeButton').textContent = reading ? '编辑' : '阅读';
    $('#modeButton').setAttribute('aria-label', reading ? '切换到编辑' : '切换到阅读');
    $('#modeButton').disabled = blocked;
    $('#entryTitle').readOnly = reading;
    $('#entryDate').disabled = reading;
    $('#entryLocation').disabled = reading;
    if ($('#requestEntryLocationButton')) $('#requestEntryLocationButton').disabled = reading;
    $('#categoryButton').disabled = blocked;
    $('#entryCategoryButton').disabled = blocked;
    $('#tagsButton').disabled = reading;
    $('#moreButton').disabled = false;
    $('#metadataButton').disabled = false;
    $('#continueButton').hidden = !reading || blocked;
    $('#saveNowButton').disabled = blocked;
    $('#formatButton').disabled = reading || blocked;
    if (reading) setRichToolsExpanded(false);
    // Switching presentation must not emit a content update or create a save revision.
    adapter?.editor?.setEditable(!reading, false);
    if (reading) document.activeElement?.blur();
    applyPresentation();
    paintCategories();
  }

  function editImage() {
    imageEditing = adapter.selectedImage();
    if (!imageEditing || reading || blocked) return;
    imageWidthWasTouched = false;
    const inherits = imageWidthModes.get(imageEditing.occurrenceId)?.mode === 'inherit';
    $('#imageFollowWidth').checked = inherits;
    $('#imageCaption').value = imageEditing.caption || '';
    $('#imageAlt').value = imageEditing.alt || '';
    $('#imageWidth').value = Math.round(
      (inherits ? effectiveImageWidth() : imageEditing.widthRatio) * 100,
    );
    $('#imageWidth').disabled = inherits;
    $('#imageWidthValue').textContent = `${$('#imageWidth').value}%`;
    $('#imageAlign').value = imageEditing.align;
    $('#imageTimestamp').textContent = imageEditing.insertedAt
      ? `插入于 ${new Date(imageEditing.insertedAt).toLocaleString('zh-CN')}`
      : '原图片插入时间未知';
    imageRangeRelease?.();
    imageRangeRelease = installDiaryTouchRangeGuard($('#imageDialog'), { selector: '#imageWidth' });
    $('#imageDialog').showModal();
  }

  async function pickImage() {
    if (pickerActive || reading || blocked) return;
    if (adapter.composing) {
      toast('请先完成当前组词，再插入图片。');
      return;
    }
    const insertionStartedAt = new Date().toISOString();
    const position = imageInsertionPosition || adapter.capturePosition();
    imageInsertionPosition = null;
    pickerActive = true;
    $('#imageButton').disabled = true;
    try {
      const result = await rpc('pickImages', { entryId: entry.id });
      const assets = result?.assets || (result?.assetId ? [result] : []);
      if (result?.cancelled || !assets.length) return;
      productState.media ||= [];
      const editor = adapter.editor;
      const existingEmptyParagraphs = new Set();
      editor.state.doc.descendants((node) => {
        if (node.type.name === 'paragraph' && !node.textContent.trim() && node.attrs?.blockId)
          existingEmptyParagraphs.add(node.attrs.blockId);
      });
      let nextPosition = position;
      let lastOccurrenceId;
      // Replacing a truly empty source paragraph with an atomic image may leave
      // Tiptap's split paragraph before it. Keep nonempty timestamp/prose blocks.
      const selection = editor.state.selection;
      const source =
        position?.selectionType !== 'node' && Number.isInteger(position?.head)
          ? editor.state.doc.resolve(
              Math.max(0, Math.min(position.head, editor.state.doc.content.size)),
            )
          : selection.$from;
      const sourceWasEmptyParagraph =
        selection.empty &&
        source.parent.type.name === 'paragraph' &&
        !source.parent.textContent.trim();
      try {
        for (const [index, asset] of assets.entries()) {
          if (!asset?.assetId) throw new Error('图片选择结果不完整，请重试。');
          if (!productState.media.some((item) => item.id === asset.assetId))
            productState.media.push({ ...asset, id: asset.assetId });
          lastOccurrenceId = crypto.randomUUID();
          if (
            !adapter.insertImage(
              {
                assetId: asset.assetId,
                occurrenceId: lastOccurrenceId,
                insertedAt: insertionStartedAt,
                // Richdoc requires a concrete fallback width. A local
                // occurrence marker keeps new images inheriting later changes.
                widthRatio: (entryImageWidthPercent ?? preferences.imageWidthPercent) / 100,
              },
              { position: nextPosition },
            )
          )
            throw new Error('图片未能插入正文，请重试。');
          if (imageWidthModes.size < imageWidthModeLimit) {
            imageWidthModes.set(lastOccurrenceId, {
              mode: 'inherit',
              baseline: effectiveImageWidth(),
              explicit: null,
            });
            imageWidthModesDirty = true;
            paintInheritedImages();
          } else toast('本篇图片继承设置已达上限，这张图片将保持插入时宽度。');
          if (nextPosition !== position) adapter.releasePosition(nextPosition);
          let insertedAt;
          editor.state.doc.descendants((node, at) => {
            if (node.type.name === 'image' && node.attrs.occurrenceId === lastOccurrenceId)
              insertedAt = at;
          });
          if (insertedAt === undefined) throw new Error('图片位置未能确认，请保留本页。');
          if (index === 0 && sourceWasEmptyParagraph && insertedAt > 0) {
            const preceding = editor.state.doc.resolve(insertedAt).nodeBefore;
            if (preceding?.type.name === 'paragraph' && !preceding.textContent.trim())
              editor.commands.deleteRange({
                from: insertedAt - preceding.nodeSize,
                to: insertedAt,
              });
            // The command may remap this image, so locate it again by occurrence.
            editor.state.doc.descendants((node, at) => {
              if (node.type.name === 'image' && node.attrs.occurrenceId === lastOccurrenceId)
                insertedAt = at;
            });
          }
          // Capture the inserted atomic node's end, rather than mapping the original
          // text caret repeatedly (which can prepend later images).
          editor.commands.setNodeSelection(insertedAt);
          nextPosition = adapter.capturePosition();
        }
      } finally {
        if (nextPosition !== position) adapter.releasePosition(nextPosition);
      }
      // Keep the editable paragraph immediately after the last inserted image.
      let imageEnd = null;
      editor.state.doc.descendants((node, at) => {
        if (node.type.name === 'image' && node.attrs.occurrenceId === lastOccurrenceId)
          imageEnd = at + node.nodeSize;
      });
      if (imageEnd !== null) {
        let after = editor.state.doc.nodeAt(imageEnd);
        if (!after?.isTextblock || (after.type.name === 'paragraph' && !after.textContent.trim() && existingEmptyParagraphs.has(after.attrs?.blockId))) {
          editor.commands.insertContentAt(imageEnd, {
            type: 'paragraph',
            content: [{ type: 'text', text: '　　' }],
          });
        } else if (!after.textContent.trim()) {
          if (!after.textContent.startsWith('　　'))
            editor.commands.insertContentAt(imageEnd + 1, '　　');
        }
        after = editor.state.doc.nodeAt(imageEnd);
        const offset = after?.textContent.startsWith('　　') ? 3 : 1;
        editor.commands.setTextSelection(
          Math.min(imageEnd + offset, editor.state.doc.content.size - 1),
        );
      }
      adapter.focus();
      await rpc('showEditorKeyboard', { entryId: entry.id });
      await flush();
    } catch (error) {
      toast(error.message || '图片未插入，请重试。');
    } finally {
      if (position) adapter.releasePosition(position);
      pickerActive = false;
      $('#imageButton').disabled = false;
    }
  }

  function setRichToolsExpanded(expanded) {
    const open = !!expanded && !reading && !blocked;
    $('#richToolsPanel').hidden = !open;
    $('#richToolsButton').setAttribute('aria-expanded', String(open));
    $('#richToolsButton').setAttribute(
      'aria-label',
      open ? '收起正文格式工具' : '展开正文格式工具',
    );
    $('#formatButton').disabled = reading || blocked;
    if (open) updateToolbar();
  }

  async function locateNewEntryOnce() {
    if (
      new URLSearchParams(location.search).get('new') !== '1' ||
      reading || blocked || !entry?.draftOnly || String(entry.location || '').trim()
    ) return;
    const targetId = entry.id;
    const generation = autoLocationGeneration;
    const settingsAtStart = settingsGeneration;
    try {
      const answer = await rpc('requestEntryLocation', { entryId: targetId });
      const place = typeof answer?.location === 'string' ? answer.location.trim() : '';
      if (
        !place || place.length > 100 || closing || navigationCommitted || reading || blocked ||
        entry?.id !== targetId ||
        generation !== autoLocationGeneration || settingsAtStart !== settingsGeneration ||
        entryLocationDraft !== undefined || String(entry.location || '').trim() ||
        $('#moreDialog').open
      ) return;
      // Empty drafts stay discardable: save() waits for an explicit title, prose,
      // or media before publishing. Once present, location follows the same ACK.
      entry.location = place;
      paintWeekday();
      markDirty();
    } catch {
      // Permission denial or timeout must leave the editor writable and manual entry available.
    }
  }

  function setupTitleFormats() {
    $('#titleFormatButton').addEventListener('click', async () => {
      const button = $('#titleFormatButton'); button.disabled = true;
      try {
        titleFormatPreferences = await rpc('getWritingPreferences');
        $('#titleFormatGlobal').value = titleFormatPreferences.titleFormat || '{category}{sequence}_{date}';
        const categoryId = entry.categoryId || '';
        $('#titleFormatCategory').value = titleFormatPreferences.categoryTitleFormats?.[categoryId] || '';
        $('#titleFormatCategory').disabled = !categoryId;
        $('#titleFormatCategoryLabel').textContent = categoryId ? categoryName(categoryId) + '的独立格式（留空跟随全局）' : '未分类使用全局格式';
        $('#titleFormatDialog').dataset.categoryId = categoryId;
        $('#titleFormatStatus').textContent = '仅用于新篇；原有标题保持。';
        openDialog('titleFormatDialog', 'moreDialog');
      } catch (error) { toast(error.message || '命名设置未读取，请重试。'); }
      finally { button.disabled = false; }
    });
    $('#saveTitleFormatsButton').addEventListener('click', async () => {
      if (composingField || !titleFormatPreferences) return;
      const button = $('#saveTitleFormatsButton'); button.disabled = true;
      const categoryId = $('#titleFormatDialog').dataset.categoryId;
      const overrides = { ...titleFormatPreferences.categoryTitleFormats };
      const override = $('#titleFormatCategory').value;
      if (categoryId) { if (override) overrides[categoryId] = override; else delete overrides[categoryId]; }
      try {
        titleFormatPreferences = await rpc('saveSuggestedTitleFormats', {
          baseRevision: titleFormatPreferences.revision,
          titleFormat: $('#titleFormatGlobal').value, categoryTitleFormats: overrides,
        });
        await requestSuggestedTitle();
        closeDialog('titleFormatDialog');
      } catch (error) { $('#titleFormatStatus').textContent = error.message || '保存失败，请保留修改重试。'; }
      finally { button.disabled = false; }
    });
  }

  function setupEvents() {
    setupTitleFormats();
    addPresentationSettings();
    $('#diaryActionsButton').addEventListener('click', () => openDialog('diaryActionsDialog', 'moreDialog'));
    document.querySelectorAll('[data-diary-action]').forEach((button) => {
      button.addEventListener('pointerdown', (event) => event.preventDefault());
      button.addEventListener('click', () => runDiaryAction(button.dataset.diaryAction));
    });
    const followLabel = document.createElement('label');
    followLabel.className = 'field-label';
    followLabel.htmlFor = 'imageFollowWidth';
    const followWidth = document.createElement('input');
    followWidth.id = 'imageFollowWidth';
    followWidth.type = 'checkbox';
    followLabel.append(followWidth, ' 跟随本篇／默认宽度');
    $('#imageForm .image-layout-fields').before(followLabel);
    $('#imageDialog').addEventListener('close', () => {
      imageRangeRelease?.();
      imageRangeRelease = null;
    });
    window.addEventListener('pagehide', () => imageRangeRelease?.(), { once: true });
    // Expose the already-shared commands next to the keyboard, without a modal
    // taking focus or replacing the authoritative editor/document.
    $('#richToolsPanel').append($('#formatDialog .format-scroll'));
    $('#richToolsButton').addEventListener('pointerdown', (event) => event.preventDefault());
    $('#richToolsButton').addEventListener('click', () =>
      setRichToolsExpanded($('#richToolsPanel').hidden),
    );
    $('#backButton').addEventListener('click', requestClose);
    $('#previousEntryButton').addEventListener('click', async () => {
      if (closing) return;
      closing = true;
      $('#previousEntryButton').disabled = true;
      try {
        await flush({ finalizeDraft: true });
        const result = await rpc('openPreviousEntry', { id: entry.id, reading });
        if (result?.found) retireAutoLocation();
        else toast('没有更早的一篇日记。');
      } catch (error) {
        showSaveError(error);
      } finally {
        closing = false;
        $('#previousEntryButton').disabled = false;
      }
    });
    $('#discardEmptyChangesButton').addEventListener('click', async () => {
      if (closing) return;
      closing = true;
      clearTimeout(timer);
      $('#discardEmptyChangesButton').disabled = true;
      $('#emptyCloseError').hidden = true;
      try {
        await rpc('closeEditor');
        retireAutoLocation();
        $('#emptyCloseDialog').close();
      } catch (error) {
        showSaveError(error);
        $('#emptyCloseError').textContent = error.message || '暂时无法返回，请重试。';
        $('#emptyCloseError').hidden = false;
      } finally {
        closing = false;
        $('#discardEmptyChangesButton').disabled = false;
      }
    });
    $('#modeButton').addEventListener('click', () => setReading(!reading));
    $('#continueButton').addEventListener('click', () => setReading(false));
    for (const id of ['timestampButton', 'indentButton']) {
      $(`#${id}`).addEventListener('pointerdown', (event) => {
        editorInput?.capture();
        event.preventDefault();
      });
    }
    $('#timestampButton').addEventListener('click', () => {
      editorInput?.runAction(() => {
        if (!formatDateTime) return false;
        const inserted = adapter.insertDateTime(formatDateTime());
        updateStats();
        return inserted;
      });
    });
    $('#formatButton').addEventListener('pointerdown', (event) => event.preventDefault());
    $('#formatButton').addEventListener('click', () => {
      if (closeDialog('moreDialog')) setRichToolsExpanded(true);
    });
    $('#appearanceButton').addEventListener('click', async () => {
      try {
        await rpc('showAppearance');
      } catch (error) {
        toast(error.message || '外观设置暂时无法打开。');
      }
    });
    $('#moreButton').addEventListener('click', openSettings);
    $('#typographyButton').addEventListener('click', () =>
      openDialog('typographyDialog', 'moreDialog'),
    );
    $('#categorySettingsButton').addEventListener('click', () =>
      openDialog('categoryDialog', 'moreDialog'),
    );
    $('#entryCategoryButton').addEventListener('click', () => openDialog('categoryDialog'));
    $('#appSettingsButton').addEventListener('click', () =>
      manageCategories('showAppSettings', '#appSettingsButton'),
    );
    $('#discardSettingsButton').addEventListener('click', () => {
      if (settingsSaving) return;
      preferenceDraft = null;
      entryImageWidthDraft = undefined;
      entryLocationDraft = undefined;
      $('#entryLocation').value = entry?.location || '';
      applyPresentation();
      closeDialog('moreDialog');
    });
    $('#saveSettingsButton').addEventListener('click', async () => {
      if (settingsSaving) return;
      if (!validTypography()) return;
      const globalWidth = Number($('#globalImageWidthSetting').value);
      const ownWidth = $('#entryImageWidthSetting').value.trim();
      const entryWidth = ownWidth === '' ? null : Number(ownWidth);
      if (
        !Number.isInteger(globalWidth) ||
        globalWidth < 10 ||
        globalWidth > 100 ||
        (entryWidth !== null &&
          (!Number.isInteger(entryWidth) || entryWidth < 10 || entryWidth > 100))
      ) {
        $('#settingsStatus').textContent = '新图片宽度请输入 10–100 的整数；本篇留空会继承默认。';
        return;
      }
      settingsSaving = true;
      settingsGeneration++;
      $('#saveSettingsButton').disabled = true;
      $('#discardSettingsButton').disabled = true;
      $('#entryLocation').disabled = true;
      $('#requestEntryLocationButton').disabled = true;
      const settingsEntryId = entry?.id;
      let locationConfirmed = false;
      try {
        const requestedLocation =
          entryLocationDraft === undefined ? entry?.location || '' : entryLocationDraft;
        if (requestedLocation !== (entry?.location || '')) {
          const previousLocation = entry.location;
          entry.location = requestedLocation;
          markDirty();
          clearTimeout(timer);
          try {
            await flush();
            if (
              entry?.id !== settingsEntryId ||
              entryCapability.entryOriginal.location !== requestedLocation
            )
              throw new Error('地点保存尚未确认，请填写正文后重试。');
            locationConfirmed = true;
          } catch (error) {
            if (entry?.id === settingsEntryId) {
              if (previousLocation === undefined) delete entry.location;
              else entry.location = previousLocation;
              paintWeekday();
              clearTimeout(timer);
            }
            throw error;
          }
        }
        const next = { ...presentation(), imageWidthPercent: globalWidth };
        writePreferences(next);
        if (!saveEntryImageWidth(entry.id, entryWidth))
          throw new Error('ENTRY_WIDTH_STORAGE_FAILED');
        preferences = { ...presentation() };
        preferences.imageWidthPercent = globalWidth;
        entryImageWidthPercent = entryWidth;
        preferenceDraft = null;
        entryImageWidthDraft = undefined;
        entryLocationDraft = undefined;
        applyPresentation();
        settingsSaving = false;
        closeDialog('moreDialog');
        toast('日记设置已保存。');
      } catch (error) {
        $('#settingsStatus').textContent = locationConfirmed
          ? '地点已保存，其他设置未完成；请保留本页并重试。'
          : `设置未能保存：${error?.message || '请保留本页并重试。'}`;
      } finally {
        settingsSaving = false;
        $('#saveSettingsButton').disabled = false;
        $('#discardSettingsButton').disabled = false;
        $('#entryLocation').disabled = reading;
        $('#requestEntryLocationButton').disabled = reading || blocked;
      }
    });
    $('#emptyPromptSetting').addEventListener('input', (event) => {
      if (!preferenceDraft) return;
      preferenceDraft.emptyPrompt = event.target.value.slice(0, 120).replace(/[\r\n]/gu, '');
      applyPresentation();
    });
    $('#autoIndentSetting').addEventListener('change', (event) => {
      if (!preferenceDraft) return;
      preferenceDraft.autoIndentParagraph = event.target.checked;
      applyPresentation();
    });
    $('#globalImageWidthSetting').addEventListener('change', (event) => {
      if (!preferenceDraft) return;
      const width = Number(event.target.value);
      if (Number.isInteger(width) && width >= 10 && width <= 100)
        preferenceDraft.imageWidthPercent = width;
      applyPresentation();
    });
    $('#entryImageWidthSetting').addEventListener('change', (event) => {
      if (!preferenceDraft) return;
      const raw = event.target.value.trim();
      const width = raw === '' ? null : Number(raw);
      if (width === null || (Number.isInteger(width) && width >= 10 && width <= 100))
        entryImageWidthDraft = width;
      applyPresentation();
    });
    for (const [id, key] of [
      ['bodyFontSize', 'fontSize'],
      ['bodyLineHeight', 'lineHeight'],
      ['bodyFontWeight', 'fontWeight'],
      ['bodyParagraphSpacing', 'paragraphSpacing'],
    ]) {
      $(`#${id}`).addEventListener('input', () => {
        if (!validTypography()) return;
        preferenceDraft ||= { ...preferences };
        preferenceDraft[key] = Number($(`#${id}`).value);
        applyPresentation();
      });
    }
    $('#metadataButton').addEventListener('click', () => {
      presentation().showMetadata = !presentation().showMetadata;
      applyPresentation();
      if (!preferenceDraft) persistPreferences();
    });
    for (const key of ['showTitle', 'showMetadata', 'serifFont', 'chooseCategoryOnCreate']) {
      $(`#${key}`).addEventListener('change', () => {
        preferenceDraft ||= { ...preferences };
        preferenceDraft[key] = $(`#${key}`).checked;
        applyPresentation();
      });
    }
    $('#saveNowButton').addEventListener('click', async () => {
      $('#saveNowButton').disabled = true;
      try {
        await flush();
        if (!entry?.draftOnly) toast('已保存到本机。');
      } catch (error) {
        showSaveError(error);
      } finally {
        $('#saveNowButton').disabled = blocked;
      }
    });
    $('#saveStatus').addEventListener('click', () => {
      if (!blocked) flush().catch(showSaveError);
    });
    $('#entryTitle').addEventListener('input', () => {
      titleTouched = true;
      suggestedTitle = '';
      $('#entryTitle').placeholder = '标题';
      entry.title = $('#entryTitle').value;
      // Do not hide the active field when its last character is removed.
      if (!entry.title.trim()) presentation().showTitle = true;
      applyPresentation();
      markDirty();
    });
    $('#entryDate').addEventListener('change', () => {
      if (!$('#entryDate').value) {
        $('#entryDate').value = datePart(entry.date);
        return;
      }
      entry.date =
        $('#entryDate').value + (typeof entry.date === 'string' ? entry.date.slice(10) : '');
      suggestedTitle = '';
      requestSuggestedTitle();
      paintWeekday();
      markDirty();
    });
    $('#entryLocation').addEventListener('input', () => {
      if (!$('#moreDialog').open || settingsSaving) return;
      autoLocationGeneration++;
      settingsGeneration++;
      entryLocationDraft = $('#entryLocation').value.trim().slice(0, 100);
      applyPresentation();
    });
    $('#requestEntryLocationButton').addEventListener('click', async () => {
      const button = $('#requestEntryLocationButton');
      if (reading || blocked || settingsSaving || button.disabled || !$('#moreDialog').open) return;
      autoLocationGeneration++;
      const requestedEntryId = entry?.id;
      const requestedGeneration = settingsGeneration;
      button.disabled = true;
      try {
        const answer = await rpc('requestEntryLocation', { entryId: requestedEntryId });
        if (
          entry?.id !== requestedEntryId ||
          settingsGeneration !== requestedGeneration ||
          !$('#moreDialog').open
        )
          return;
        const place = answer?.location?.trim();
        if (typeof answer?.location !== 'string' || !place || place.length > 100)
          throw new Error('未取得可用地点，请手动填写。');
        entryLocationDraft = place;
        $('#entryLocation').value = place;
        applyPresentation();
      } catch (error) {
        if (
          entry?.id === requestedEntryId &&
          settingsGeneration === requestedGeneration &&
          $('#moreDialog').open
        )
          toast(error?.message || '定位未完成，可手动填写地点。');
      } finally {
        button.disabled = reading || blocked;
      }
    });
    $('#categoryButton').addEventListener('click', () => openDialog('categoryDialog'));
    $('#tagsButton').addEventListener('click', () => {
      $('#tagsInput').value = (entry.tags || []).join('，');
      openDialog('tagsDialog', $('#moreDialog').open ? 'moreDialog' : null);
    });
    $('#tagsForm').addEventListener('submit', (event) => {
      event.preventDefault();
      const tags = [
        ...new Set(
          $('#tagsInput')
            .value.split(/[,，;；\n]+/u)
            .map((tag) => tag.trim())
            .filter(Boolean),
        ),
      ];
      if (tags.length > 32 || tags.some((tag) => tag.length > 80)) {
        toast('最多添加 32 个标签，每个标签不超过 80 字。');
        return;
      }
      entry.tags = tags;
      paintTags();
      markDirty();
      closeDialog('tagsDialog');
    });
    document
      .querySelectorAll('[data-close]')
      .forEach((button) =>
        button.addEventListener('click', () => closeDialog(button.dataset.close)),
      );
    document.querySelectorAll('dialog').forEach((dialog) =>
      dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        closeDialog(dialog.id);
      }),
    );
    document
      .querySelectorAll('#richToolsPanel button[data-command], #imageInfoButton')
      .forEach((button) => {
        button.addEventListener('pointerdown', (event) => {
          editorInput?.capture();
          event.preventDefault();
        });
      });
    document.querySelectorAll('[data-command]').forEach((button) =>
      button.addEventListener('click', () => {
        if (['undo', 'redo'].includes(button.dataset.command)) {
          if (reading || blocked) return;
          if (composingField || adapter.composing || adapter.editor.view.composing) {
            toast('请先完成当前输入，再点击此操作。');
            return;
          }
          adapter.command(button.dataset.command);
          adapter.focus();
          updateToolbar();
          return;
        }
        editorInput?.runAction(() => {
          if (button.dataset.command === 'formatBlock')
            adapter.editor.view.dispatch(adapter.editor.state.tr.setMeta('closeHistory$', true));
          if (
            button.dataset.command === 'formatBlock' &&
            button.dataset.value === 'h2' &&
            adapter.editor.isActive('heading', { level: 2 })
          )
            adapter.command('formatBlock', 'p');
          else if (button.dataset.command === 'formatBlock' && button.dataset.value === 'p')
            adapter.editor.chain().clearNodes().setParagraph().run();
          else adapter.command(button.dataset.command, button.dataset.value);
          adapter.focus();
          updateToolbar();
          return true;
        });
      }),
    );
    $('#indentButton').addEventListener('click', () => {
      editorInput?.runAction(() => {
        const inserted = adapter.command('insertText', '　　');
        adapter.focus();
        return inserted;
      });
    });
    $('#imageButton').addEventListener('pointerdown', (event) => {
      imageInsertionPosition && adapter.releasePosition(imageInsertionPosition);
      imageInsertionPosition = adapter.capturePosition();
      event.preventDefault();
    });
    $('#imageButton').addEventListener('click', pickImage);
    $('#pageScroll').addEventListener('click', (event) => {
      if (reading || blocked || !adapter?.editor || !event.isTrusted) return;
      const editor = adapter.editor;
      if (!editor.state.selection.empty) return;
      const dom = editor.view.dom;
      const target = event.target;
      if (
        ![
          $('#pageScroll'),
          document.querySelector('.diary-page'),
          $('#bodyEditor'),
          $('#emptyHint'),
          dom,
        ].includes(target)
      )
        return;
      // Native ProseMirror clicks inside prose/images retain their own exact
      // placement and selection. This only fills the unused page surface.
      const rect = dom.getBoundingClientRect();
      const end = Math.max(1, editor.state.doc.content.size - 1);
      const nearest =
        event.clientY >= rect.top && event.clientY <= rect.bottom
          ? editor.view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
          : null;
      const at = event.clientY < rect.top ? 1 : Number.isInteger(nearest) ? nearest : end;
      editor.commands.setTextSelection(Math.max(1, Math.min(end, at)));
      adapter.focus();
      rpc('showEditorKeyboard', { entryId: entry.id }).catch(() => {});
    });
    $('#imageInfoButton').addEventListener('click', editImage);
    $('#imageForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!imageEditing) return;
      try {
        const occurrenceId = imageEditing.occurrenceId;
        const previousMode = imageWidthModes.get(occurrenceId);
        const follow = $('#imageFollowWidth').checked;
        const widthRatio = Number($('#imageWidth').value) / 100;
        if (follow && !previousMode && imageWidthModes.size >= imageWidthModeLimit)
          throw new Error('本篇图片继承设置已达上限，请先保留当前宽度。');
        const changes = {
          caption: $('#imageCaption').value,
          alt: $('#imageAlt').value,
          align: $('#imageAlign').value,
        };
        if (!follow && (imageWidthWasTouched || previousMode?.mode === 'inherit'))
          changes.widthRatio = widthRatio;
        const updated = adapter.updateSelectedImage(changes, { occurrenceId });
        if (!updated) throw new Error('这张图片已发生变化，请重新选择。');
        if (follow) {
          imageWidthModes.set(occurrenceId, {
            mode: 'inherit',
            baseline: previousMode?.baseline ?? imageEditing.widthRatio,
            explicit: previousMode?.explicit ?? null,
          });
          imageWidthModesDirty = true;
        } else if (previousMode) {
          imageWidthModes.set(occurrenceId, {
            ...previousMode,
            mode: 'explicit',
            explicit: widthRatio,
          });
          imageWidthModesDirty = true;
        }
        paintInheritedImages();
        await flush();
        if (imageWidthModesDirty) persistImageWidthModes();
        $('#imageDialog').close();
      } catch (error) {
        showSaveError(error);
      }
    });
    $('#imageWidth').addEventListener('input', () => {
      imageWidthWasTouched = true;
      $('#imageFollowWidth').checked = false;
      $('#imageWidth').disabled = false;
      $('#imageWidthValue').textContent = `${$('#imageWidth').value}%`;
    });
    $('#imageFollowWidth').addEventListener('change', () => {
      const follow = $('#imageFollowWidth').checked;
      $('#imageWidth').disabled = follow;
      if (follow) $('#imageWidth').value = Math.round(effectiveImageWidth() * 100);
      $('#imageWidthValue').textContent = `${$('#imageWidth').value}%`;
    });
    $('#removeImageButton').addEventListener('click', () => {
      if (!imageEditing || reading || blocked) return;
      let target;
      adapter.editor.state.doc.descendants((node, at) => {
        if (node.type.name === 'image' && node.attrs.occurrenceId === imageEditing.occurrenceId)
          target = at;
      });
      if (target === undefined) return toast('图片位置已变化，请重新选择。');
      adapter.editor.commands.setNodeSelection(target);
      adapter.editor.commands.deleteSelection();
      $('#imageDialog').close();
      imageEditing = null;
      flush().catch(showSaveError);
    });
    $('#viewImageButton').addEventListener('click', () => {
      if (imageEditing)
        rpc('viewImage', { assetId: imageEditing.assetId }).catch((error) => toast(error.message));
    });
    let imagePointer = null;
    $('#bodyEditor').addEventListener(
      'pointerdown',
      (event) => {
        imagePointer = event.target.closest?.('figure[data-rich-image] img')
          ? { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false }
          : null;
      },
      true,
    );
    $('#bodyEditor').addEventListener(
      'pointermove',
      (event) => {
        if (
          imagePointer?.id === event.pointerId &&
          Math.hypot(event.clientX - imagePointer.x, event.clientY - imagePointer.y) > 10
        )
          imagePointer.moved = true;
      },
      true,
    );
    $('#bodyEditor').addEventListener(
      'pointercancel',
      () => {
        imagePointer = null;
      },
      true,
    );
    $('#bodyEditor').addEventListener(
      'click',
      (event) => {
        const image = event.target.closest?.('figure[data-rich-image] img');
        if (!image || (imagePointer?.moved && event.detail !== 0)) {
          imagePointer = null;
          return;
        }
        imagePointer = null;
        const occurrenceId = image.closest('figure').dataset.richImage;
        let assetId;
        adapter.editor.state.doc.descendants((node) => {
          if (node.type.name === 'image' && node.attrs.occurrenceId === occurrenceId)
            assetId = node.attrs.assetId;
        });
        if (assetId) {
          event.preventDefault();
          event.stopPropagation();
          rpc('viewImage', { assetId }).catch((error) => toast(error.message));
        }
      },
      true,
    );
    document.addEventListener('compositionstart', (event) => {
      rememberInputScroll(event);
      composingField = true;
      clearTimeout(timer);
    });
    document.addEventListener('compositionend', () => {
      composingField = false;
      if (inputScrollAnchor) inputScrollAnchor.at = performance.now();
      scheduleCaretVisibility();
      setTimeout(() => scheduleSave(), 0);
    });
    $('#pageScroll').addEventListener('pointerdown', (event) => {
      inputScrollAnchor = null;
      userScrollOverride = false;
      scrollPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    }, { passive: true });
    $('#pageScroll').addEventListener('pointermove', (event) => {
      if (scrollPointer?.id !== event.pointerId) return;
      if (Math.abs(event.clientX - scrollPointer.x) > 8 || Math.abs(event.clientY - scrollPointer.y) > 8) {
        inputScrollAnchor = null;
        userScrollOverride = true;
      }
    }, { passive: true });
    for (const kind of ['pointerup', 'pointercancel'])
      $('#pageScroll').addEventListener(kind, () => { scrollPointer = null; }, { passive: true });
    $('#pageScroll').addEventListener('wheel', () => {
      inputScrollAnchor = null;
      userScrollOverride = true;
    }, { passive: true });
    document.addEventListener('focusout', (event) => {
      if (event.target === adapter?.editor?.view?.dom) inputScrollAnchor = null;
      if (!entry || blocked || event.target.closest?.('dialog')) return;
      if (dirty()) save().catch(showSaveError);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && dirty() && !blocked) save().catch(showSaveError);
    });
  }

  async function boot() {
    const [
      { createRichBodyAdapter },
      dateInput,
      timeZone,
      { installAndroidEditorInput },
      envelopeAdapter,
      algorithms,
      product,
      searchModule,
      { installTouchRangeGuard },
      diaryActionRichModule,
      diaryActionRenderer,
      diaryActionModule,
    ] = await Promise.all([
      import('/public/editor/rich-body-adapter.js'),
      import('/public/features/editor-input.js'),
      import('/public/shared/time-zone.js'),
      import('/android-editor-input.js'),
      import('/desktop-entry-adapter.js'),
      import('/content-algorithms.js'),
      import('/product-content019.js'),
      import('/diary-search.js'),
      import('/public/editor/diary-touch-range.js'),
      import('/public/shared/rich-document.js'),
      import('/public/shared/rich-document-renderer.js'),
      import('/diary-actions.js'),
    ]);
    // Match desktop's default interpretation until a shared Repository supplies preferences.
    timeZone.setTimeZone(timeZone.DEFAULT_TIME_ZONE);
    diaryTimeZone = timeZone;
    formatDateTime = dateInput.formatLocalDateTime;
    ({ inspectEntryEnvelope, mergeEntryChanges } = envelopeAdapter);
    contentAlgorithms = algorithms;
    productContent = product;
    installDiaryTouchRangeGuard = installTouchRangeGuard;
    validateRenderableBody = algorithms.validateRenderableRichDocument;
    diaryActionRich = diaryActionRichModule;
    diaryActions = diaryActionModule.createDiaryActions({
      capture: captureCurrentDiaryAction,
      validate: diaryActionRenderer.validateRenderableRichDocument,
      documentNode: (body) => adapter.editor.schema.nodeFromJSON(diaryActionRich.toEditorJSON(body)),
      render: diaryActionRenderer.renderRichDocument,
      native: {
        copy: (text, snap) => diaryDocumentRpc({ entryId: snap.id, action: 'copyAll', text }),
        saveTxt: ({ name, text }, snap) => diaryDocumentRpc({ entryId: snap.id, action: 'exportTxt', name, text }),
        shareText: ({ title, text }, snap) => diaryDocumentRpc({ entryId: snap.id, action: 'shareText', title, text }),
        printDocument: ({ title, html, snapshot: snap }) => diaryDocumentRpc({ entryId: snap.id, action: 'exportPdf', title, html }),
      },
    });
    await bridgeReady;
    const id = new URLSearchParams(location.search).get('id');
    if (!id) throw new Error('未找到这篇日记，请返回列表后重试。');
    const [bootstrap, result] = await Promise.all([
      rpc('bootstrap'),
      rpc('productEntryGet', { id }),
    ]);
    productState = result;
    // The appearance request is already running; body readiness never waits for image decode.
    void initialAppearance;
    entryCapability = inspectLocalEntry(result);
    entry = entryCapability.entry;
    if (!entry || entry.id !== id) throw new Error('这篇日记暂时无法打开，请返回列表后重试。');
    entryImageWidthPercent = readEntryImageWidth(entry.id);
    imageWidthModes = readImageWidthModes(entry.id);
    revision = Number.isSafeInteger(entry.revision) ? entry.revision : 0;
    lastSavedAt = entry.updatedAt || '';
    categories = normalizeCategories(bootstrap.categories);
    defaultCategoryId = bootstrap.writingPreferences?.defaultCategoryId || '';
    requestSuggestedTitle();
    $('#entryTitle').value = entry.title || '';
    $('#entryTitle').disabled = false;
    $('#previousEntrySection').hidden = new URLSearchParams(location.search).get('new') !== '1';
    $('#previousEntryButton').disabled = false;
    $('#entryDate').value = datePart(entry.date);
    paintWeekday();
    paintTags();
    paintCategories();
    setupEvents();
    try {
      if (!entryCapability.supported) throw new Error(entryCapability.reason);
      if (entryCapability.readOnly) {
        blocked = true;
        reading = true;
        $('#entryNotice').hidden = false;
        $('#entryNotice').textContent = entryCapability.reason;
      }
      adapter = createRichBodyAdapter(
        {
          $,
          current: () => entry,
          get library() {
            return {
              settings: {
                preferences: { autoIndentParagraph: presentation().autoIndentParagraph },
              },
            };
          },
          markDirty,
          pause() {
            clearTimeout(timer);
          },
          toast,
          onContentChanged: updateStats,
        },
        {
          resolveAsset: (assetId) => `/media/${encodeURIComponent(assetId)}`,
          onImage: (assetId) =>
            rpc('viewImage', { assetId }).catch((error) => toast(error.message)),
          onMediaEdit: editImage,
          onConflict() {
            toast('正文出现版本冲突，已保留当前输入。请暂时留在本页。');
          },
        },
      );
      adapter.render(entry);
      adapter.editor.view.dom.addEventListener('beforeinput', rememberInputScroll, true);
      adapter.editor.view.dom.addEventListener('keydown', (event) => {
        if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End')
          userScrollOverride = false;
      });
      adapter.editor.view.dom.addEventListener('input', () => {
        if (!composingField) {
          if (caretFrame) cancelAnimationFrame(caretFrame);
          caretFrame = 0;
          // Browser/ProseMirror may have already scrolled on this input. Finish
          // its fixed-clearance correction before the next paint.
          keepCaretVisible();
          inputScrollAnchor = null;
        }
      });
      if (
        new URLSearchParams(location.search).get('new') === '1' &&
        entry.draftOnly &&
        !reading &&
        preferences.autoIndentParagraph &&
        !adapter.editor.state.doc.textContent.trim() &&
        adapter.editor.state.doc.content.childCount === 1
      ) {
        adapter.editor.commands.setTextSelection(1);
        adapter.editor.commands.insertContent('　　');
      }
      diarySearch = searchModule.installDiarySearch(adapter.editor, {
        bar: $('#diarySearchBar'), input: $('#diarySearchInput'),
        previous: $('#diarySearchPrevious'), next: $('#diarySearchNext'),
        status: $('#diarySearchStatus'), close: $('#diarySearchClose'),
        scroller: $('#pageScroll'),
      }, searchModule.parseSearchContext(new URLSearchParams(location.search).get('find')));
      $('#diarySearchButton').addEventListener('click', () => diarySearch.show(true));
      editorInput = installAndroidEditorInput(adapter, {
        canEdit: () => !reading && !blocked,
        toast,
      });
      window.addEventListener('pagehide', () => editorInput?.destroy(), { once: true });
      adapter.editor.on('selectionUpdate', () => {
        updateToolbar();
        scheduleCaretVisibility();
      });
      adapter.editor.on('transaction', ({ transaction }) => {
        updateToolbar();
        reconcileImageWidthHistory(transaction);
      });
      adapter.editor.view.dom.setAttribute('aria-label', '日记正文');
      adapter.editor.view.dom.setAttribute('data-placeholder', preferences.emptyPrompt);
      updateStats();
      updateToolbar();
    } catch (error) {
      blocked = true;
      reading = true;
      $('#entryNotice').hidden = false;
      $('#entryNotice').textContent =
        `${error.message}\n为保护原文，此页已暂停修改。请返回后使用兼容的版本打开。`;
    }
    await setReading(reading);
    savedStatus();
    $('#editorPage').setAttribute('aria-busy', 'false');
    if (
      new URLSearchParams(location.search).get('new') === '1' &&
      !reading &&
      !blocked &&
      preferences.chooseCategoryOnCreate
    )
      openDialog('categoryDialog');
    window.shiyeEditor.ready = true;
    void locateNewEntryOnce();
  }

  const ready = boot().catch((error) => {
    blocked = true;
    lastError = error.message;
    $('#entryNotice').hidden = false;
    $('#entryNotice').textContent = error.message;
    $('#saveStatus').textContent = '打开失败';
    $('#saveStatus').dataset.state = 'error';
    $('#editorPage').setAttribute('aria-busy', 'false');
    $('#backButton').addEventListener('click', () => rpc('closeEditor').catch(() => {}));
    throw error;
  });
  ready.catch(() => {});
})();
