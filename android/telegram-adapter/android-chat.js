/* Android local-room controls and the independent QQ chat data adapter. */
(async () => {
  const { r: mutate } = await import('./assets/fasterdom-CywUsd2n.js');
  const { migrateCompactPreferences } = await import('./qq-chat/compact-preferences.js');
  const { installTouchRangeGuard } = await import('./qq-chat/touch-range.js');
  installTouchRangeGuard(document, {
    selector: '.shiye-android-dialog[open] input[type="range"]',
  });
  const channel = new BroadcastChannel('shiye-local-rooms');
  const pending = new Map();
  let sharedRuntime = null;
  let sharedCurrentRoom = null;
  let sharedDirectoryView = null;
  const sharedModeRequested = (() => {
    try {
      return (
        JSON.parse(localStorage.getItem('shiye-shared-runtime-v1') || 'null')?.enabled === true
      );
    } catch {
      return !!localStorage.getItem('shiye-shared-runtime-v1');
    }
  })();
  if (sharedModeRequested) {
    document.documentElement.dataset.shiyeSharedBusiness = 'true';
    const guard = document.createElement('style');
    guard.textContent =
      '[data-shiye-shared-business="true"] #LeftColumn > :not(.shiye-shared-directory){visibility:hidden!important;pointer-events:none!important}';
    document.head.append(guard);
  }
  let transportReady = false;
  let transportHandshake;
  channel.onmessage = ({ data }) => {
    const request = pending.get(data?.requestId);
    if (!request) return;
    pending.delete(data.requestId);
    clearTimeout(request.timer);
    clearInterval(request.retry);
    if (!sharedModeRequested && Array.isArray(data.rooms)) {
      roomCache = data.rooms;
      scheduleShell();
    }
    data.error ? request.reject(new Error(data.error)) : request.resolve(data);
  };
  function sendCommand(action, values = {}, repeatReadOnly = false) {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      let retry;
      const timer = setTimeout(() => {
        pending.delete(requestId);
        clearInterval(retry);
        transportReady = false;
        reject(new Error('本地保存未确认，请重试'));
      }, 12000);
      const message = { action, ...values, requestId };
      // Only the read-only handshake may be replayed. A mutation is sent exactly once.
      if (repeatReadOnly) retry = setInterval(() => channel.postMessage(message), 250);
      pending.set(requestId, { resolve, reject, timer, retry });
      channel.postMessage(message);
    });
  }
  function ensureTransport() {
    if (transportReady) return Promise.resolve();
    if (!transportHandshake) {
      transportHandshake = sendCommand('list', {}, true)
        .then((response) => {
          if (!Array.isArray(response.rooms)) throw new Error('本地会话连接回执无效');
          transportReady = true;
          scheduleShell();
        })
        .finally(() => {
          transportHandshake = undefined;
        });
    }
    return transportHandshake;
  }
  async function command(action, values = {}) {
    if (sharedModeRequested) {
      if (!sharedRuntime) throw new Error('SHARED_RUNTIME_NOT_READY');
      return sharedRuntime.directoryCommand(action, values);
    }
    await ensureTransport();
    const receipt = await sendCommand(action, values);
    if (action === 'create' || action === 'update') {
      const id = String(receipt.id || values.id || '');
      if (id) await ensureChatProjection(id, receipt.rooms?.find((room) => room.id === id)?.title);
    }
    return receipt;
  }
  async function ensureChatProjection(id, title, ownsRequest = () => true) {
    if (!ownsRequest()) throw new Error('刷新请求已结束');
    const exists = () => {
      const chat = window.getGlobal?.()?.chats?.byId?.[id];
      return !!chat && (title === undefined || chat.title === title);
    };
    if (exists()) return;
    // MockClient persists the room first. Telegram's own draft action requires
    // its ApiChat projection too; opening an unknown ID alone is insufficient.
    window.dispatchEvent(new CustomEvent('shiye-refresh-rooms', { detail: {} }));
    const started = performance.now();
    while (!exists()) {
      if (!ownsRequest()) throw new Error('刷新请求已结束');
      if (performance.now() - started > 12000)
        throw new Error('会话已保存，列表尚未完成更新，请稍后重试');
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  }
  let roomId;
  let roomContextVersion = 0;
  let roomCache = [];
  let initialListShown = false;
  let inConversation = false;
  let reportedRoomId = null;
  let userHasNavigated = false;
  document.addEventListener(
    'pointerdown',
    () => {
      document.body.dataset.shiyeKeyboardNavigation = 'false';
    },
    { capture: true, passive: true },
  );
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Tab') document.body.dataset.shiyeKeyboardNavigation = 'true';
    },
    true,
  );
  let wallpaperViewportWidth = 0,
    wallpaperViewportHeight = 0,
    wallpaperNativeHeight = 0;
  function updateListWallpaperViewport() {
    const viewport = window.visualViewport;
    const width = Math.round(viewport?.width || innerWidth),
      height = Math.round(viewport?.height || innerHeight);
    const nativeWidth = Number.parseFloat(document.documentElement.style.getPropertyValue('--shiye-native-wallpaper-width'));
    const nativeHeight = Number.parseFloat(document.documentElement.style.getPropertyValue('--shiye-native-wallpaper-height'));
    const wallpaperWidth = Number.isFinite(nativeWidth) && nativeWidth > 0 ? nativeWidth : width;
    if (Math.abs(wallpaperWidth - wallpaperViewportWidth) > 1) {
      wallpaperViewportWidth = wallpaperWidth;
      wallpaperViewportHeight = height;
      wallpaperNativeHeight = 0;
    } else wallpaperViewportHeight = Math.max(wallpaperViewportHeight, height);
    if (Number.isFinite(nativeHeight)) wallpaperNativeHeight = Math.max(wallpaperNativeHeight, nativeHeight);
    document.body.style.setProperty('--shiye-wallpaper-height', `${Math.max(wallpaperViewportHeight, wallpaperNativeHeight)}px`);
  }
  updateListWallpaperViewport();
  window.addEventListener('resize', updateListWallpaperViewport);
  window.visualViewport?.addEventListener('resize', updateListWallpaperViewport);
  window.addEventListener('shiye-native-bottom-geometry', updateListWallpaperViewport);
  const preferenceKey = 'android-ui-preferences-v1';
  let pinIds = [];
  const appearanceDefaults = {
    messageFontSize: 16,
    inputFontSize: 14,
    bubblePadding: 8,
    bubblePaddingBlock: 6,
    bubbleRadius: 8,
    bubbleWidth: 90,
    messageGap: 3,
    messageTimeSize: 8,
    messageTimeOpacity: 62,
    bubbleOpacity: 100,
    theme: 'light',
    enterToSend: false,
    qqChromeTone: 'white',
    selfMessageSide: 'right',
    rememberReadingPosition: false,
    stickerSuggestionsEnabled: true,
    messageMotion: 'smooth',
  };
  let appearance = { ...appearanceDefaults };
  let roomAppearance = {};
  let roomBackgrounds = {};
  let listBackground, chatBackground;
  let listWallpaperReady = true;
  let listRowOpacity = 0;
  const defaultListDividerColor = '#d7eaf5';
  const checkedListDividerColor = (value) =>
    typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)
      ? value.toLowerCase() : defaultListDividerColor;
  let listDividerColor = defaultListDividerColor;
  const checkedListOpacity = (value) =>
    typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  let preferencesReady = false;
  let appearanceVersion = 0;
  let preferencesInitialization;
  let nativePreferencesConnection;
  let pinWriteQueue = Promise.resolve();
  let assetWriteQueue = Promise.resolve();
  let localInputReady = false;
  let qqReady = false;
  let qqFailure = '';
  let optionalInputFailure = '';
  function initializationDeadline(operation, code) {
    let timer;
    return Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error(code), { code })), 15000);
      }),
    ]).finally(() => clearTimeout(timer));
  }
  function updateQQGate(open) {
    document.body.dataset.shiyeChatRequired = String(open);
    let gate = document.getElementById('shiye-qq-loading');
    if (!gate) {
      gate = document.createElement('section');
      gate.id = 'shiye-qq-loading';
      gate.setAttribute('role', 'status');
      const title = document.createElement('h2');
      title.textContent = '随想';
      const message = document.createElement('p');
      const back = document.createElement('button');
      back.type = 'button';
      back.textContent = '返回会话列表';
      back.onclick = closeConversation;
      gate.append(title, message, back);
      document.body.append(gate);
    }
    gate.hidden = !open || qqReady;
    const message = qqFailure
      ? `聊天页面加载失败（${qqFailure}）。请返回列表后重新打开应用。`
      : '正在打开聊天…';
    if (gate.querySelector('p').textContent !== message)
      gate.querySelector('p').textContent = message;
  }
  function checkedAppearance(value = {}) {
    const ranges = {
      messageFontSize: [6, 28],
      inputFontSize: [6, 28],
      bubblePadding: [2, 24],
      bubbleRadius: [4, 24],
      bubbleWidth: [55, 100],
      messageGap: [0, 20],
      messageTimeSize: [5, 16],
      messageTimeOpacity: [35, 100],
      bubbleOpacity: [25, 100],
    };
    return {
      ...Object.fromEntries(
        Object.entries(ranges).map(([key, [min, max]]) => [
          key,
          typeof value[key] === 'number' && Number.isFinite(value[key])
            ? Math.max(min, Math.min(max, Math.round(value[key])))
            : appearanceDefaults[key],
        ]),
      ),
      ...(Object.hasOwn(value, 'bubblePaddingBlock')
        ? {
            bubblePaddingBlock:
              typeof value.bubblePaddingBlock === 'number' &&
              Number.isFinite(value.bubblePaddingBlock)
                ? Math.max(2, Math.min(20, Math.round(value.bubblePaddingBlock)))
                : appearanceDefaults.bubblePaddingBlock,
          }
        : Object.hasOwn(value, 'bubblePadding')
          ? {}
          : { bubblePaddingBlock: appearanceDefaults.bubblePaddingBlock }),
      theme: value.theme === 'dark' ? 'dark' : 'light',
      enterToSend: value.enterToSend === true,
      qqChromeTone: value.qqChromeTone === 'blue' ? 'blue' : 'white',
      selfMessageSide: value.selfMessageSide === 'left' ? 'left' : 'right',
      rememberReadingPosition: value.rememberReadingPosition === true,
      stickerSuggestionsEnabled: value.stickerSuggestionsEnabled !== false,
      messageMotion: value.messageMotion === 'instant' ? 'instant' : 'smooth',
    };
  }
  function effectiveAppearance(id = roomId) {
    const override = roomAppearance[id] || {};
    const value = { ...appearance, ...override };
    // Old per-room padding meant all four sides, including when global has a new block value.
    if (Object.hasOwn(override, 'bubblePadding') && !Object.hasOwn(override, 'bubblePaddingBlock'))
      delete value.bubblePaddingBlock;
    return checkedAppearance(value);
  }
  let appliedTheme;
  let qqPreviewAppearance;
  function applyAppearance(value = effectiveAppearance()) {
    const theme = ['light', 'dark'].includes(window.shiyeAppTheme)
      ? window.shiyeAppTheme
      : value.theme;
    qqPreviewAppearance = { ...value, theme };
    document.body.dataset.shiyeQqChromeTone = value.qqChromeTone || 'white';
    window.shiyeQQRebuild?.view.refresh();
    const names = {
      messageFontSize: '--shiye-message-size',
      inputFontSize: '--shiye-input-size',
      bubblePadding: '--shiye-bubble-padding',
      bubbleRadius: '--shiye-bubble-radius',
      messageGap: '--shiye-message-gap',
      messageTimeSize: '--shiye-message-time-size',
    };
    mutate(() => {
      for (const [key, variable] of Object.entries(names))
        document.body.style.setProperty(variable, `${value[key]}px`);
      if (value.bubblePaddingBlock === undefined)
        document.body.style.removeProperty('--shiye-bubble-padding-block');
      else
        document.body.style.setProperty(
          '--shiye-bubble-padding-block',
          `${value.bubblePaddingBlock}px`,
        );
      document.body.style.setProperty('--shiye-bubble-width', `${value.bubbleWidth}%`);
      document.body.style.setProperty(
        '--shiye-message-time-opacity',
        String(value.messageTimeOpacity / 100),
      );
      document.body.style.setProperty('--shiye-bubble-opacity', String(value.bubbleOpacity / 100));
      if (document.body.dataset.shiyeChatTheme !== theme)
        document.body.dataset.shiyeChatTheme = theme;
      if (
        appliedTheme !== theme &&
        window.getGlobal?.()?.sharedState?.settings &&
        window.getActions?.()?.setSharedSettingOption
      ) {
        window.getActions().setSharedSettingOption({ theme });
        appliedTheme = theme;
      }
    });
  }
  window.addEventListener('shiye-app-theme', ({ detail }) => {
    if (!['light', 'dark'].includes(detail?.theme)) return;
    window.shiyeAppTheme = detail.theme;
    applyAppearance();
  });
  function checkedPins(value) {
    if (!Array.isArray(value) || value.some((id) => typeof id !== 'string'))
      throw new Error('置顶偏好格式无效，原值已保留');
    return [...new Set(value)];
  }
  function legacyPins() {
    const cached = localStorage.getItem('shiye-android-pins-v1');
    return cached === null ? [] : checkedPins(JSON.parse(cached));
  }
  function connectNativePreferences() {
    const available = () =>
      typeof window.shiyeAndroidPreferences?.load === 'function' &&
      typeof window.shiyeAndroidPreferences?.commit === 'function';
    if (available()) return Promise.resolve(window.shiyeAndroidPreferences);
    if (!nativePreferencesConnection)
      nativePreferencesConnection = new Promise((resolve, reject) => {
        const receive = () => {
          if (!available()) return;
          clearTimeout(timer);
          window.removeEventListener('shiye-native-preferences-ready', receive);
          resolve(window.shiyeAndroidPreferences);
        };
        const timer = setTimeout(() => {
          window.removeEventListener('shiye-native-preferences-ready', receive);
          reject(new Error('原生偏好连接尚未准备好，请重试'));
        }, 12000);
        window.addEventListener('shiye-native-preferences-ready', receive);
        receive();
      }).finally(() => {
        nativePreferencesConnection = undefined;
      });
    return nativePreferencesConnection;
  }
  async function connectNativeVisualPreferences() {
    const native = await connectNativePreferences();
    const visual = window.__shiyeAndroidVisualPreferences;
    return typeof visual?.load === 'function' && typeof visual?.commit === 'function'
      ? visual : native;
  }
  async function readLegacyPreference() {
    await ensureTransport();
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('shiye-android-telegram-v2', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('preview', 'readonly');
      const request = transaction.objectStore('preview').get(preferenceKey);
      request.onsuccess = () => {
        try {
          const previous = request.result;
          // This key is now read only: native storage owns every subsequent write.
          resolve(
            previous === undefined
              ? { version: 1, pinIds: legacyPins() }
              : { ...previous, pinIds: checkedPins(previous.pinIds) },
          );
        } catch (error) {
          reject(error);
        } finally {
          db.close();
        }
      };
      request.onerror = transaction.onabort = () => {
        db.close();
        reject(request.error || transaction.error);
      };
    });
  }
  function applyPinCache() {
    localStorage.setItem('shiye-android-pins-v1', JSON.stringify(pinIds));
    localStorage.setItem('shiye-room-order-v1', JSON.stringify(pinIds));
    window.dispatchEvent(new Event('shiye-room-order-changed'));
    scheduleShell();
  }
  function preferenceReceipt(response) {
    return response && typeof response === 'object' && response.__shiyePreferenceReceipt === true
      ? response
      : { value: response, listWallpaper: null };
  }
  function applyListWallpaperReceipt(receipt, preference) {
    const visual = receipt.listWallpaper;
    listWallpaperReady = visual?.ready !== false;
    listBackground = visual && Object.hasOwn(visual, 'displayed')
      ? visual.displayed || undefined
      : preference.listBackground;
  }
  function ensurePreferences() {
    if (preferencesReady) return Promise.resolve();
    if (!preferencesInitialization)
      preferencesInitialization = connectNativeVisualPreferences()
        .then(async (native) => {
          const storedReceipt = preferenceReceipt(await native.load());
          const stored = storedReceipt.value;
          const initial = stored === null ? await readLegacyPreference() : stored;
          const corrected = migrateCompactPreferences(initial);
          const committedReceipt = stored === null || corrected !== initial
            ? preferenceReceipt(await native.commit(corrected)) : storedReceipt;
          const committed = committedReceipt.value;
          pinIds = checkedPins(committed.pinIds);
          appearance = checkedAppearance(committed.appearance);
          roomAppearance = committed.roomAppearance || {};
          roomBackgrounds = committed.roomBackgrounds || {};
          applyListWallpaperReceipt(committedReceipt, committed);
          listRowOpacity = checkedListOpacity(committed.listRowOpacity);
          listDividerColor = checkedListDividerColor(committed.listDividerColor);
          chatBackground = committed.chatBackground;
          preferencesReady = true;
          applyAppearance();
          applyPinCache();
        })
        .finally(() => {
          preferencesInitialization = undefined;
        });
    return preferencesInitialization;
  }
  function updatePreference(change, ownsContext = () => true) {
    const operation = pinWriteQueue
      .catch(() => {})
      .then(async () => {
        await ensurePreferences();
        const native = await connectNativeVisualPreferences();
        const previous = preferenceReceipt(await native.load()).value;
        if (!ownsContext()) return [...pinIds];
        if (previous === null) throw new Error('原生置顶偏好尚未初始化，请重试');
        const committedReceipt = preferenceReceipt(await native.commit(change(previous)));
        const committed = committedReceipt.value;
        pinIds = checkedPins(committed.pinIds);
        appearance = checkedAppearance(committed.appearance);
        roomAppearance = committed.roomAppearance || {};
        roomBackgrounds = committed.roomBackgrounds || {};
        applyListWallpaperReceipt(committedReceipt, committed);
        listRowOpacity = checkedListOpacity(committed.listRowOpacity);
        listDividerColor = checkedListDividerColor(committed.listDividerColor);
        chatBackground = committed.chatBackground;
        appearanceVersion++;
        applyAppearance();
        applyPinCache();
        return [...pinIds];
      });
    pinWriteQueue = operation;
    return operation;
  }
  async function reloadListWallpaperVisual() {
    await pinWriteQueue.catch(() => {});
    await ensurePreferences();
    const native = await connectNativeVisualPreferences();
    const receipt = preferenceReceipt(await native.load());
    if (receipt.value === null) return { ready: false };
    applyListWallpaperReceipt(receipt, receipt.value);
    scheduleShell();
    return { ready: listWallpaperReady };
  }
  function updatePins(change) {
    return updatePreference((previous) => ({
      ...previous,
      pinIds: checkedPins(change(checkedPins(previous.pinIds))),
    }));
  }
  window.addEventListener('shiye-current-room-result', ({ detail }) => {
    if (sharedModeRequested) return;
    const changed = roomId !== detail?.id;
    if (changed) roomContextVersion++;
    roomId = detail?.id;
    if (changed && preferencesReady) applyAppearance();
  });
  window.addEventListener('shiye-chat-appearance-retry', ({ detail }) => {
    if (detail?.roomId !== currentId()) return;
    ensurePreferences()
      .then(() => window.shiyeQQRebuild?.view.refresh())
      .catch(() => {});
  });
  function currentId() {
    if (sharedModeRequested) return sharedCurrentRoom?.conversationId || null;
    window.dispatchEvent(new Event('shiye-current-room'));
    return roomId;
  }
  async function openRoom(id) {
    document.querySelector('.shiye-keyboard-panel[open]')?.close();
    userHasNavigated = true;
    if (sharedModeRequested) {
      if (!sharedRuntime) throw new Error('SHARED_RUNTIME_NOT_READY');
      const room = await sharedRuntime.room(id);
      if (sharedCurrentRoom?.conversationId !== id) roomContextVersion++;
      sharedCurrentRoom = { ...room, version: roomContextVersion };
      await sharedRuntime.source.refreshLocal();
      scheduleShell();
      return;
    }
    await ensureChatProjection(id);
    window.dispatchEvent(new CustomEvent('shiye-open-room', { detail: { id } }));
  }
  document.addEventListener(
    'click',
    (event) => {
      if (event.target.closest('#LeftColumn a[href^="#"]')) userHasNavigated = true;
    },
    true,
  );
  async function refreshRooms() {
    const result = await command('list');
    roomCache = result.rooms;
    if (sharedRuntime) pinIds = roomCache.filter((room) => room.pinned).map((room) => room.id);
    return roomCache;
  }
  function togglePin(id) {
    if (sharedRuntime)
      return sharedRuntime.directory
        .row(id)
        .then((room) => sharedRuntime.directory.setState(id, { pinned: !room.pinned }))
        .then(refreshRooms);
    return updatePins((pins) =>
      pins.includes(id) ? pins.filter((item) => item !== id) : [id, ...pins],
    );
  }
  const iconPaths = {
    back: 'm15 18-6-6 6-6',
    more: 'M12 5h.01M12 12h.01M12 19h.01',
    edit: 'm15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15v5Z',
    pin: 'm8 3 8 0-1 6 3 4v2H6v-2l3-4-1-6ZM12 15v6',
    top: 'M5 4h14M12 20V8m-5 5 5-5 5 5',
    add: 'M12 5v14M5 12h14',
    search: 'M20 20l-5-5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',
    close: 'm6 6 12 12M6 18 18 6',
    display: 'M4 4h16v12H4zM8 21h8M12 16v5',
    file: 'M14 3H5v18h14V8l-5-5ZM14 3v5h5M8 13h8M8 17h6',
    symbol: 'M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM8 14s1 3 4 3 4-3 4-3M9 9h.01M15 9h.01',
    settings: 'M4 6h16M4 12h16M4 18h16M9 3v6M15 9v6M10 15v6',
  };
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', name === 'more' ? '3.2' : '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    const stroke = document.createElementNS(svg.namespaceURI, 'path');
    stroke.setAttribute('d', iconPaths[name]);
    svg.append(stroke);
    return svg;
  }
  function menuButton(label, name, action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'shiye-menu-row';
    const text = document.createElement('span');
    text.textContent = label;
    button.append(icon(name), text);
    button.onclick = action;
    return button;
  }
  function roomMenu(id, parent) {
    settingsEpoch++;
    const { modal, form, restored } = dialog(roomCache.find((r) => r.id === id)?.title || '会话', parent, `room-root:${id}`);
    if (restored) return;
    const type = window.getGlobal?.()?.chats?.byId?.[id]?.type;
    const typeLabels = {
      chatTypePrivate: '个人会话',
      chatTypeBasicGroup: '群会话',
      chatTypeSuperGroup: '群会话',
      chatTypeChannel: '频道会话',
    };
    if (typeLabels[type]) {
      const note = document.createElement('p');
      note.className = 'shiye-dialog-note';
      note.textContent = typeLabels[type];
      form.append(note);
    }
    const add = (label, name, action, navigate = false) => {
      const button = menuButton(label, name, async () => {
        try {
          button.disabled = true;
          await action();
          if (!navigate) {
            modal.__back = !!parent;
            modal.close();
          }
        } catch (error) {
          showError(error.message);
        } finally {
          button.disabled = false;
        }
      });
      form.append(button);
    };
    add('会话信息', 'edit', () => editRoom(id, modal), true);
    add('聊天显示', 'display', () => appearanceSettings(modal, id), true);
    add('当前会话背景', 'display', () => backgroundSettings(id, modal), true);
    if (id === currentId())
      add(
        '发送文件',
        'file',
        () => {
          closeAllDialogs();
          openDocumentChooser();
        },
        true,
      );
    const roomPinned = sharedRuntime
      ? roomCache.find((room) => room.id === id)?.pinned
      : pinIds.includes(id);
    add(roomPinned ? '取消置顶' : '置顶会话', 'pin', () => togglePin(id));
    if (roomPinned)
      add('移到置顶首位', 'top', () => {
        if (sharedRuntime)
          return sharedRuntime.directory
            .list({ includeArchived: true })
            .then(({ order }) =>
              sharedRuntime.directory.setOrder([id, ...order.filter((value) => value !== id)]),
            )
            .then(refreshRooms);
        return updatePins((pins) => [id, ...pins.filter((item) => item !== id)]);
      });
    const sharedRoom = sharedRuntime && roomCache.find((room) => room.id === id);
    const archive = menuButton(
      sharedRuntime
        ? sharedRoom?.archived
          ? '恢复会话'
          : '归档会话'
        : '归档（等待接入共用会话能力）',
      'file',
      async () => {
        if (!sharedRuntime) return;
        await sharedRuntime.source.flush();
        await sharedRuntime.directory.setState(id, { archived: !sharedRoom?.archived });
        if (id === currentId() && !sharedRoom?.archived) await closeConversation();
        await refreshRooms();
        modal.close();
      },
    );
    archive.disabled = !sharedRuntime;
    archive.title = '当前版本保留消息与草稿，待接入电脑版共用会话能力后开放';
    form.append(archive);
  }
  const settingsPages = new Map();
  let settingsEpoch = 0;
  // Keep list taps and native vertical panning, but do not start the frozen Web A
  // horizontal page recognizer. The capture listener does not cancel browser defaults.
  for (const type of ['touchstart', 'mousedown']) {
    document.addEventListener(
      type,
      (event) => {
        if (inConversation || document.querySelector('.shiye-android-dialog[open]')) return;
        if (!event.target.closest?.('#LeftColumn .chat-list')) return;
        if (event.target.closest('input,textarea,select')) return;
        event.stopPropagation();
      },
      { capture: true, passive: true },
    );
  }
  function closeAllDialogs() {
    document.querySelector('.shiye-keyboard-panel[open]')?.close();
    for (const element of document.querySelectorAll('.shiye-android-dialog')) element.remove();
    settingsPages.clear();
    applyAppearance();
  }
  function pauseOpenDialogs() {
    document.querySelector('.shiye-keyboard-panel[open]')?.close();
    for (const modal of document.querySelectorAll('.shiye-android-dialog[open]')) {
      // Keep only keyed settings pages and their local form state. An ordinary
      // close still follows its existing save/discard semantics.
      modal.dataset.retained = 'true';
      modal.__back = false;
      modal.close();
      if (![...settingsPages.values()].includes(modal)) modal.remove();
    }
    applyAppearance();
  }
  function dismissForModuleChange() {
    settingsEpoch++;
    pauseOpenDialogs();
  }
  function dialog(title, parent, pageKey) {
    if (!parent) {
      if (pageKey === 'settings-root' || pageKey?.startsWith('room-root:')) pauseOpenDialogs();
      else closeAllDialogs();
    }
    if (parent?.open) {
      parent.dataset.retained = 'true';
      parent.close();
    }
    const cached = pageKey && settingsPages.get(pageKey);
    if (cached?.isConnected) {
      cached.__parent = parent;
      cached.dataset.retained = 'false';
      cached.dataset.settingsRestored = 'true';
      mutate(() => cached.showModal());
      return { modal: cached, form: cached.__form, restored: true };
    }
    const modal = document.createElement('dialog');
    modal.className = 'shiye-android-dialog';
    modal.__parent = parent;
    if (pageKey) settingsPages.set(pageKey, modal);
    const form = document.createElement('form');
    form.id = `shiye-settings-${crypto.randomUUID()}`;
    form.className = 'shiye-dialog-body';
    const heading = document.createElement('h2');
    heading.textContent = title;
    const top = document.createElement('div');
    top.className = 'shiye-dialog-heading';
    if (parent) {
      const back = menuButton('返回上一级', 'back', () => {
        modal.__back = true;
        modal.close();
      });
      back.className = 'shiye-dialog-back';
      back.ariaLabel = '返回上一级';
      top.append(back);
    }
    const close = menuButton('关闭', 'close', () => {
      modal.__back = !!modal.__parent;
      modal.close();
    });
    close.className = 'shiye-dialog-close';
    close.ariaLabel = '关闭';
    top.append(heading, close);
    modal.append(top, form);
    modal.__form = form;
    modal.addEventListener('close', () =>
      mutate(() => {
        if (!modal.isConnected) return;
        if (modal.dataset.retained === 'true') return;
        if (modal.__back && modal.__parent?.isConnected) {
          modal.__back = false;
          modal.dataset.retained = 'true';
          modal.__parent.dataset.retained = 'false';
          modal.__parent.showModal();
        } else closeAllDialogs();
      }),
    );
    modal.addEventListener('click', (event) => {
      if (event.target !== modal) return;
      const bounds = modal.getBoundingClientRect();
      if (
        event.clientX >= bounds.left &&
        event.clientX <= bounds.right &&
        event.clientY >= bounds.top &&
        event.clientY <= bounds.bottom
      )
        return;
      modal.__back = !!modal.__parent;
      modal.close();
    });
    modal.addEventListener('cancel', (event) => {
      event.preventDefault();
      modal.__back = !!modal.__parent;
      modal.close();
    });
    mutate(() => {
      document.body.append(modal);
      modal.showModal();
    });
    return { modal, form };
  }
  function field(form, label, value = '') {
    const wrap = document.createElement('label');
    wrap.append(document.createTextNode(label));
    const input = document.createElement('input');
    input.value = value;
    input.maxLength = 80;
    wrap.append(input);
    form.append(wrap);
    return input;
  }
  function actions(form, modal, submit) {
    const row = document.createElement('div');
    row.className = 'actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = '取消';
    cancel.onclick = () => {
      modal.__back = !!modal.__parent;
      modal.close();
    };
    const save = document.createElement('button');
    save.type = 'submit';
    save.setAttribute('form', form.id);
    save.textContent = submit;
    row.append(cancel, save);
    const footer = document.createElement('footer');
    footer.className = 'shiye-dialog-footer';
    footer.append(row);
    modal.append(footer);
    const error = document.createElement('div');
    error.className = 'error';
    error.setAttribute('role', 'alert');
    footer.append(error);
    return { save, error };
  }
  async function editRoom(id, parent) {
    try {
      const { rooms } = await command('list');
      const room = rooms.find((item) => item.id === id);
      const sharedCreateOperationId = sharedRuntime && !room ? crypto.randomUUID() : undefined;
      const { modal, form } = dialog(room ? '会话信息' : '新建会话', parent);
      const name = field(form, '名称', room?.title || '');
      name.required = true;
      name.placeholder = '为这段随想起个名字';
      const description = room ? field(form, '说明', room.description || '') : undefined;
      if (description) description.maxLength = 2000;
      const { save, error } = actions(form, modal, room ? '保存' : '创建');
      name.focus();
      form.onsubmit = async (event) => {
        event.preventDefault();
        save.disabled = true;
        try {
          const result = await command(room ? 'update' : 'create', {
            ...room,
            ...(sharedCreateOperationId ? { operationId: sharedCreateOperationId } : {}),
            id,
            title: name.value.trim(),
            description: description?.value ?? room?.description,
            idleHours: room?.idleHours || 5,
          });
          await refreshRooms();
          if (!room) await openRoom(result.id);
          modal.__back = !!parent;
          modal.close();
        } catch (err) {
          error.textContent = err.message;
          save.disabled = false;
        }
      };
    } catch (err) {
      showError(err.message);
    }
  }
  function showError(message) {
    const { form } = dialog('本地操作');
    const text = document.createElement('p');
    text.textContent = message;
    form.append(text);
  }
  async function settings() {
    const epoch = ++settingsEpoch;
    try {
      await ensurePreferences();
      if (epoch !== settingsEpoch) return;
      const { modal, form, restored } = dialog('随想设置', null, 'settings-root');
      if (restored) return;
      const note = document.createElement('p');
      note.className = 'shiye-dialog-note';
      note.textContent = '记录片刻想法，按会话慢慢整理。';
      form.append(note);
      for (const [label, glyph, action] of [
        ['聊天显示', 'display', () => appearanceSettings(modal)],
        ['会话列表背景', 'display', () => backgroundSettings(undefined, modal, 'list')],
        ['列表行透明度', 'display', () => listAppearanceSettings(modal)],
        ['列表分割线颜色', 'display', () => listDividerSettings(modal)],
        ['聊天默认背景', 'display', () => backgroundSettings(undefined, modal, 'chat')],
        [
          '表情与快捷命令',
          'symbol',
          () => window.dispatchEvent(new Event('shiye-open-input-settings')),
        ],
        ['会话管理', 'edit', () => manageRooms(modal)],
        [
          '刷新会话列表',
          'top',
          async () => {
            await refreshLocalList();
            closeAllDialogs();
          },
        ],
        [
          '应用设置',
          'settings',
          () => {
            window.shiyeAndroidSettings?.open?.();
          },
        ],
      ])
        form.append(menuButton(label, glyph, action));
      const create = menuButton('新建会话', 'add', () => editRoom(undefined, modal));
      create.classList.add('shiye-menu-primary');
      form.append(create);
      form.onsubmit = (e) => e.preventDefault();
    } catch (err) {
      showError(err.message);
    }
  }
  function listAppearanceSettings(parent) {
    const { modal, form, restored } = dialog('列表行透明度', parent, 'list-appearance');
    if (restored) return;
    const note = document.createElement('p');
    note.className = 'shiye-dialog-note';
    note.textContent = '默认与思绪列表一样，普通行透明显示壁纸。置顶保留单独强调。';
    const input = field(form, '普通行不透明度（0–100%）', String(listRowOpacity));
    input.type = 'number';
    input.min = '0';
    input.max = '100';
    input.step = '1';
    input.inputMode = 'numeric';
    form.prepend(note);
    const { save, error } = actions(form, modal, '保存');
    // Explicit Cancel discards this value; module leave still retains its draft.
    modal.querySelector('.shiye-dialog-footer button[type="button"]').addEventListener('click', () => {
      input.value = String(listRowOpacity);
    });
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const submitEpoch = settingsEpoch;
      const submittedOpacity = checkedListOpacity(Number(input.value));
      save.disabled = true;
      try {
        await updatePreference((previous) => ({
          ...previous,
          listRowOpacity: submittedOpacity,
        }), () => submitEpoch === settingsEpoch && modal.open);
        if (submitEpoch !== settingsEpoch || !modal.open) return;
        scheduleShell();
        settingsPages.delete('list-appearance');
        modal.__back = !!parent;
        modal.close();
      } catch (err) {
        error.textContent = err.message;
      } finally {
        save.disabled = false;
      }
    };
  }
  function listDividerSettings(parent) {
    const { modal, form, restored } = dialog('列表分割线颜色', parent, 'list-divider');
    if (restored) return;
    const note = document.createElement('p');
    note.className = 'shiye-dialog-note';
    note.textContent = '仅设置随想会话列表，思绪列表颜色可独立设置。默认很淡浅蓝色 #d7eaf5。';
    form.append(note);
    const picker = field(form, '选择颜色', listDividerColor);
    picker.type = 'color';
    const input = field(form, '颜色值（#RRGGBB）', listDividerColor);
    input.maxLength = 7;
    input.pattern = '#[0-9a-fA-F]{6}';
    input.required = true;
    input.autocomplete = 'off';
    input.spellcheck = false;
    picker.addEventListener('input', () => { input.value = picker.value; });
    input.addEventListener('input', () => {
      if (/^#[0-9a-fA-F]{6}$/.test(input.value)) picker.value = input.value;
    });
    const { save, error } = actions(form, modal, '保存');
    modal.querySelector('.shiye-dialog-footer button[type="button"]').addEventListener('click', () => {
      input.value = picker.value = listDividerColor;
    });
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const epoch = settingsEpoch;
      const color = checkedListDividerColor(input.value);
      save.disabled = true;
      try {
        await updatePreference((previous) => ({ ...previous, listDividerColor: color }),
          () => epoch === settingsEpoch && modal.open);
        if (epoch !== settingsEpoch || !modal.open) return;
        scheduleShell();
        settingsPages.delete('list-divider');
        modal.__back = !!parent;
        modal.close();
      } catch (err) {
        error.textContent = err.message;
      } finally {
        save.disabled = false;
      }
    };
  }
  let listRefresh;
  let listRefreshStatus;
  let listRefreshStatusTimer;
  let listRefreshEpoch = 0,
    listRefreshFeedback = false;
  let lastQuietRefresh = -Infinity;
  function refreshLocalList({ silent = false } = {}) {
    if (sharedModeRequested) {
      if (!sharedRuntime) return Promise.reject(new Error('SHARED_RUNTIME_NOT_READY'));
      return sharedRuntime.client
        .sync()
        .then(refreshRooms)
        .then(() => sharedDirectoryView?.refresh());
    }
    if (!silent) listRefreshFeedback = true;
    if (!silent && !listRefreshStatus) {
      clearTimeout(listRefreshStatusTimer);
      listRefreshStatus =
        document.querySelector('.shiye-refresh-status') || document.createElement('p');
      listRefreshStatus.className = 'shiye-refresh-status';
      listRefreshStatus.setAttribute('role', 'status');
      listRefreshStatus.dataset.state = 'loading';
      listRefreshStatus.textContent = '正在刷新本机会话…';
      document.body.append(listRefreshStatus);
    }
    if (listRefresh) return listRefresh;
    if (silent && performance.now() - lastQuietRefresh < 1500) return Promise.resolve();
    const token = ++listRefreshEpoch;
    let deadline;
    const work = (async () => {
      const previousRooms = JSON.stringify(roomCache);
      await refreshRooms();
      if (token !== listRefreshEpoch) return;
      // A cached page already has its dialog projections. Avoid even the upstream
      // loading-parameter reset when this read confirms the same local metadata.
      if (!silent || JSON.stringify(roomCache) !== previousRooms)
        window.dispatchEvent(new CustomEvent('shiye-refresh-rooms', { detail: {} }));
      await Promise.all(
        roomCache.map((room) =>
          ensureChatProjection(room.id, room.title, () => token === listRefreshEpoch),
        ),
      );
      if (token !== listRefreshEpoch) return;
      lastQuietRefresh = performance.now();
      if (listRefreshStatus) {
        listRefreshStatus.textContent = '本机会话已刷新';
        listRefreshStatus.dataset.state = 'success';
      }
    })();
    listRefresh = Promise.race([
      work,
      new Promise((_, reject) => {
        deadline = setTimeout(() => {
          listRefreshEpoch++;
          reject(new Error('刷新超时，当前列表与草稿已保留'));
        }, 15000);
      }),
    ])
      .catch((error) => {
        if (token === listRefreshEpoch) listRefreshEpoch++;
        if (listRefreshStatus) {
          listRefreshStatus.textContent = '刷新失败，请重试';
          listRefreshStatus.dataset.state = 'error';
        }
        if (
          listRefreshFeedback &&
          document.visibilityState === 'visible' &&
          !document.querySelector('.shiye-android-dialog[open]')
        ) {
          const { modal, form } = dialog('刷新未完成');
          const detail = document.createElement('p');
          detail.className = 'shiye-dialog-note';
          detail.textContent = error.message;
          form.append(detail);
          form.append(
            menuButton('关闭', 'close', () => modal.close()),
            menuButton('重试刷新', 'top', () => {
              modal.close();
              refreshLocalList().catch(() => {});
            }),
          );
          form.onsubmit = (event) => event.preventDefault();
        }
        throw error;
      })
      .finally(() => {
        clearTimeout(deadline);
        const status = listRefreshStatus;
        listRefreshStatus = undefined;
        if (status)
          listRefreshStatusTimer = setTimeout(
            () => status.remove(),
            status.dataset.state === 'error' ? 1500 : 650,
          );
        listRefresh = undefined;
        listRefreshFeedback = false;
      });
    return listRefresh;
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && initialListShown)
      refreshLocalList({ silent: true }).catch((error) =>
        console.warn('本机会话静默刷新未完成：', error.message),
      );
  });
  // One cached list and one refresh operation serve both native navigation entries.
  let pullStart;
  const listScrollTop = (target) => {
    for (
      let node = target;
      node instanceof Element && node.id !== 'LeftColumn';
      node = node.parentElement
    )
      if (
        node.scrollHeight > node.clientHeight + 1 &&
        /auto|scroll/.test(getComputedStyle(node).overflowY)
      )
        return node.scrollTop;
    return 0;
  };
  document.addEventListener(
    'touchstart',
    (event) => {
      pullStart = undefined;
      if (
        currentId() ||
        event.touches.length !== 1 ||
        document.querySelector('.shiye-android-dialog[open]')
      )
        return;
      const target = event.target instanceof Element ? event.target : undefined;
      if (
        !target?.closest('#LeftColumn') ||
        target.closest('input, textarea, button, .shiye-room-settings') ||
        listScrollTop(target) > 1
      )
        return;
      pullStart = {
        x: event.touches[0].clientX,
        y: event.touches[0].clientY,
        target,
        ready: false,
      };
    },
    { passive: true, capture: true },
  );
  document.addEventListener(
    'touchmove',
    (event) => {
      if (!pullStart || event.touches.length !== 1 || currentId()) {
        pullStart = undefined;
        return;
      }
      const dx = event.touches[0].clientX - pullStart.x,
        dy = event.touches[0].clientY - pullStart.y;
      if (Math.abs(dx) > 28 || dy < -8 || listScrollTop(pullStart.target) > 1) {
        pullStart = undefined;
        return;
      }
      pullStart.ready = dy >= 70;
      if (dy > 16) {
        if (event.cancelable) event.preventDefault();
        let hint = document.querySelector('.shiye-list-pull-hint');
        if (!hint) {
          hint = document.createElement('p');
          hint.className = 'shiye-refresh-status shiye-list-pull-hint';
          hint.setAttribute('role', 'status');
          document.body.append(hint);
        }
        hint.textContent = pullStart.ready ? '松开刷新' : '下拉刷新';
      }
    },
    { passive: false },
  );
  const finishPull = (event) => {
    const ready = pullStart?.ready && event.type === 'touchend';
    pullStart = undefined;
    document.querySelector('.shiye-list-pull-hint')?.remove();
    if (ready) refreshLocalList().catch((error) => console.warn('会话刷新未完成：', error.message));
  };
  document.addEventListener('touchend', finishPull, { passive: true });
  document.addEventListener('touchcancel', finishPull, { passive: true });

  let inputComposition = false,
    compositionEndedAt = -Infinity;
  const isComposerTarget = (target) =>
    target instanceof Element &&
    !!target.closest('#editable-message-text, .shiye-attachment-modal [contenteditable="true"]');
  document.addEventListener(
    'compositionstart',
    (event) => {
      if (isComposerTarget(event.target)) inputComposition = true;
    },
    true,
  );
  document.addEventListener(
    'compositionend',
    (event) => {
      if (isComposerTarget(event.target)) {
        inputComposition = false;
        compositionEndedAt = performance.now();
      }
    },
    true,
  );
  document.addEventListener(
    'keydown',
    (event) => {
      if (
        !isComposerTarget(event.target) ||
        (!event.target.closest('.shiye-attachment-modal') && !effectiveAppearance().enterToSend) ||
        event.key !== 'Enter' ||
        event.repeat ||
        event.shiftKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      )
        return;
      const attachmentModal = event.target.closest('.shiye-attachment-modal.open');
      const editor = attachmentModal
        ? attachmentModal.querySelector('[contenteditable="true"]')?.editor
        : document.querySelector('#editable-message-text')?.editor;
      if (
        event.isComposing ||
        event.keyCode === 229 ||
        inputComposition ||
        editor?.view?.composing ||
        performance.now() - compositionEndedAt < 80 ||
        document.querySelector('.shiye-android-dialog[open]')
      )
        return;
      const send = [
        ...document.querySelectorAll(
          attachmentModal
            ? '.shiye-attachment-modal.open .shiye-media-send'
            : '#MiddleColumn button.send',
        ),
      ].find(
        (button) =>
          visible(button) && !button.disabled && button.getAttribute('aria-disabled') !== 'true',
      );
      if (!send) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      // Web A's Button dispatches on mousedown in non-touch environments and on
      // click on touch devices. Follow that same sequence, once per Enter.
      send.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }),
      );
      send.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }));
      send.click();
    },
    true,
  );
  function localMessageContext(element) {
    const row = element?.closest?.('#MiddleColumn .Message[data-message-id]'),
      id = currentId();
    const messageId = Number(row?.dataset.messageId);
    if (!row || !id || !Number.isSafeInteger(messageId) || messageId < 1) return;
    const message = window.getGlobal?.()?.messages?.byChatId?.[id]?.byId?.[messageId];
    if (!message) return;
    return { roomId: id, messageId, version: roomContextVersion, message };
  }
  function readWithdrawalReceipt(context) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('shiye-android-telegram-v2', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result,
          read = db.transaction('preview').objectStore('preview').get('library');
        read.onerror = () => {
          db.close();
          reject(read.error);
        };
        read.onsuccess = () => {
          const library = read.result;
          db.close();
          resolve(
            !!library?.shiyeWithdrawnMessages?.some(
              (item) =>
                item.roomId === context.roomId && item.messageId === String(context.messageId),
            ) &&
              !library?.messages?.[context.roomId]?.some((item) => item.id === context.messageId),
          );
        };
      };
    });
  }
  function messageActions(context) {
    const ownsRoom = () => currentId() === context.roomId && roomContextVersion === context.version;
    if (!ownsRoom()) return;
    const { modal, form } = dialog('消息操作');
    if (document.body.dataset.shiyeChatSkin === 'qq')
      import('./android-qq-skin.js').then(({ positionQQMessageMenu }) =>
        positionQQMessageMenu(modal, context.messageId),
      );
    form.append(
      menuButton('引用回复', 'back', () => {
        if (
          !ownsRoom() ||
          !window.getGlobal?.()?.messages?.byChatId?.[context.roomId]?.byId?.[context.messageId]
        )
          return showError('消息已变化，请重新选择');
        window.getActions().updateDraftReplyInfo({ replyToMsgId: context.messageId });
        modal.close();
        requestAnimationFrame(() => window.dispatchEvent(new Event('shiye-focus-end')));
      }),
    );
    if (context.message.isOutgoing)
      form.append(
        menuButton('撤回消息', 'close', () => {
          const { modal: confirm, form: confirmation } = dialog('撤回这条消息？', modal);
          const note = document.createElement('p');
          note.className = 'shiye-dialog-note';
          note.textContent = '撤回后移除这条消息的正文，保留原消息身份及已有回复关系。';
          confirmation.append(note);
          const { save, error } = actions(confirmation, confirm, '确认撤回');
          confirmation.querySelector('.actions button:first-child').onclick = () => {
            confirm.__back = true;
            confirm.close();
          };
          confirmation.onsubmit = async (event) => {
            event.preventDefault();
            if (save.disabled) return;
            save.disabled = true;
            try {
              const current =
                window.getGlobal?.()?.messages?.byChatId?.[context.roomId]?.byId?.[
                  context.messageId
                ];
              if (!ownsRoom() || !current?.isOutgoing)
                throw new Error('消息或会话已变化，请重新选择');
              window
                .getActions()
                .deleteMessages({ messageIds: [context.messageId], shouldDeleteForAll: true });
              const started = performance.now();
              while (!(await readWithdrawalReceipt(context))) {
                if (!ownsRoom() || performance.now() - started > 12000)
                  throw new Error('撤回尚未得到本地保存确认，请稍后查看原会话');
                await new Promise((resolve) => setTimeout(resolve, 80));
              }
              if (confirm.isConnected) confirm.close();
            } catch (failure) {
              error.textContent = failure.message;
            } finally {
              save.disabled = false;
            }
          };
        }),
      );
    form.append(
      menuButton('更多', 'more', () => {
        modal.close();
        requestAnimationFrame(() => {
          if (!ownsRoom()) return;
          const target = document.querySelector(
            `#MiddleColumn .Message[data-message-id="${context.messageId}"] .message-content`,
          );
          if (!target) return;
          const rect = target.getBoundingClientRect();
          originalContextMenu = true;
          try {
            target.dispatchEvent(
              new MouseEvent('contextmenu', {
                bubbles: true,
                cancelable: true,
                button: 2,
                clientX: rect.x + rect.width / 2,
                clientY: rect.y + rect.height / 2,
              }),
            );
          } finally {
            originalContextMenu = false;
          }
        });
      }),
    );
    form.onsubmit = (event) => event.preventDefault();
  }
  let originalContextMenu = false;
  document.addEventListener(
    'contextmenu',
    (event) => {
      if (originalContextMenu || event.target.closest?.('a[href],video')) return;
      const context = localMessageContext(event.target);
      if (!context || document.querySelector('.shiye-android-dialog[open]')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      messageActions(context);
    },
    true,
  );
  let messagePress,
    consumeMessagePressEnd = false;
  const clearMessagePress = () => {
    if (messagePress) clearTimeout(messagePress.timer);
    messagePress = undefined;
  };
  document.addEventListener(
    'touchstart',
    (event) => {
      if (document.body.dataset.shiyeChatSkin === 'qq') return;
      clearMessagePress();
      consumeMessagePressEnd = false;
      if (
        event.touches.length !== 1 ||
        event.target.closest?.('a,button,input,textarea,video') ||
        document.querySelector('.shiye-android-dialog[open]')
      )
        return;
      const context = localMessageContext(event.target);
      if (!context) return;
      // Do not run Web A's earlier 200ms Android selection timer as well. Native
      // scrolling remains enabled; movement only cancels this wrapper's timer.
      event.stopPropagation();
      const touch = event.touches[0];
      const press = { x: touch.clientX, y: touch.clientY, timer: undefined };
      press.timer = setTimeout(() => {
        if (messagePress !== press) return;
        messagePress = undefined;
        consumeMessagePressEnd = true;
        messageActions(context);
      }, 420);
      messagePress = press;
    },
    { passive: true, capture: true },
  );
  document.addEventListener(
    'touchmove',
    (event) => {
      if (document.body.dataset.shiyeChatSkin === 'qq') return;
      if (
        messagePress &&
        (event.touches.length !== 1 ||
          Math.abs(event.touches[0].clientX - messagePress.x) > 10 ||
          Math.abs(event.touches[0].clientY - messagePress.y) > 10)
      )
        clearMessagePress();
    },
    { passive: true, capture: true },
  );
  document.addEventListener(
    'touchend',
    (event) => {
      if (document.body.dataset.shiyeChatSkin === 'qq') return;
      clearMessagePress();
      if (!consumeMessagePressEnd) return;
      consumeMessagePressEnd = false;
      if (event.cancelable) event.preventDefault();
      event.stopImmediatePropagation();
    },
    { passive: false, capture: true },
  );
  document.addEventListener(
    'touchcancel',
    () => {
      if (document.body.dataset.shiyeChatSkin === 'qq') return;
      clearMessagePress();
      consumeMessagePressEnd = false;
    },
    { passive: true, capture: true },
  );
  async function manageRooms(parent) {
    try {
      const { rooms } = await command('list');
      const { modal, form } = dialog('会话管理', parent);
      for (const room of rooms) {
        const button = menuButton(room.title, 'edit', () => {
          roomMenu(room.id, modal);
        });
        form.append(button);
      }
      const create = menuButton('新建会话', 'add', () => editRoom(undefined, modal));
      create.classList.add('shiye-menu-primary');
      form.append(create);
      form.onsubmit = (e) => e.preventDefault();
    } catch (err) {
      showError(err.message);
    }
  }
  function appearanceSettings(parent, id) {
    const pageKey = `appearance:${id || 'global'}`;
    const { modal, form, restored } = dialog(
      id ? '这个会话的显示' : '全局聊天显示',
      parent,
      pageKey,
    );
    if (restored) return;
    form.classList.add('shiye-display-form');
    const fields = document.createElement('div');
    fields.className = 'shiye-appearance-fields';
    form.append(fields);
    const draft = id ? effectiveAppearance(id) : { ...appearance };
    const inherit = document.createElement('input');
    inherit.type = 'checkbox';
    inherit.checked = !!roomAppearance[id];
    inherit.dataset.appearance = 'roomOverride';
    const initialDraft = JSON.stringify({ draft, override: inherit.checked });
    let accepted = false,
      saving = false;
    const unsaved = () =>
      !accepted && initialDraft !== JSON.stringify({ draft, override: inherit.checked });
    const close = modal.close.bind(modal);
    modal.close = (...args) => {
      if (modal.dataset.retained === 'true') return close(...args);
      if (saving) return;
      if (unsaved()) {
        if (form.querySelector('.shiye-unsaved-confirm')) return;
        const requestedBack = modal.__back;
        const prompt = document.createElement('section');
        prompt.className = 'shiye-unsaved-confirm';
        prompt.setAttribute('role', 'alert');
        const note = document.createElement('p');
        note.className = 'shiye-dialog-note';
        note.textContent = '显示参数尚未保存。继续调整，还是放弃这次修改？';
        const keep = menuButton('继续调整', 'edit', () => {
          modal.__back = false;
          prompt.remove();
        });
        const discard = menuButton('放弃修改并返回', 'back', () => {
          accepted = true;
          applyAppearance();
          settingsPages.delete(pageKey);
          modal.__back = requestedBack;
          prompt.remove();
          close(...args);
        });
        prompt.append(note, keep, discard);
        form.append(prompt);
        prompt.scrollIntoView({ block: 'nearest' });
        keep.focus();
        return;
      }
      applyAppearance();
      settingsPages.delete(pageKey);
      return close(...args);
    };
    if (id) {
      const label = document.createElement('label');
      label.append(inherit, document.createTextNode('为这个会话单独设置'));
      fields.append(label);
    }
    const previewDraft = () => applyAppearance(id && !inherit.checked ? appearance : draft);
    const preview = document.createElement('p');
    preview.className = 'shiye-dialog-note';
    preview.textContent = id
      ? '未启用单独设置时跟随全局。调整可预览，保存后生效。'
      : '应用于跟随全局的会话。调整可预览，保存后生效。';
    fields.append(preview);
    const controls = [];
    const toneLabel = document.createElement('label');
    toneLabel.textContent = '聊天栏配色';
    const tone = document.createElement('select');
    tone.dataset.appearance = 'qqChromeTone';
    for (const [value, label] of [
      ['white', 'QQ 白色（默认）'],
      ['blue', '淡蓝色'],
    ]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      tone.append(option);
    }
    tone.value = draft.qqChromeTone;
    tone.onchange = () => {
      draft.qqChromeTone = tone.value;
      previewDraft();
    };
    toneLabel.append(tone);
    fields.append(toneLabel);
    controls.push({ key: 'qqChromeTone', input: tone, refresh() {} });
    for (const [key, label, min, max] of [
      ['messageFontSize', '消息字号', 6, 28],
      ['inputFontSize', '输入字号', 6, 28],
      ['bubblePadding', '气泡左右留白', 2, 24],
      ['bubblePaddingBlock', '气泡上下留白', 2, 20],
      ['bubbleRadius', '气泡圆角', 4, 24],
      ['bubbleWidth', '气泡最大宽度', 55, 100],
      ['messageGap', '消息间距', 0, 20],
      ['messageTimeSize', '时间字号', 5, 16],
      ['messageTimeOpacity', '时间不透明度', 35, 100],
      ['bubbleOpacity', '气泡不透明度', 25, 100],
    ]) {
      const wrap = document.createElement('label');
      const text = document.createElement('span');
      const input = document.createElement('input');
      input.type = 'range';
      input.min = min;
      input.max = max;
      input.step = 1;
      if (key === 'bubblePaddingBlock' && draft[key] === undefined)
        input.max = Math.max(max, draft.bubblePadding);
      input.value = draft[key] ?? (key === 'bubblePaddingBlock' ? draft.bubblePadding : min);
      input.dataset.appearance = key;
      const refresh = () => {
        text.textContent = `${label}：${input.value}${['bubbleWidth', 'messageTimeOpacity', 'bubbleOpacity'].includes(key) ? '%' : ' px'}`;
      };
      input.oninput = () => {
        draft[key] = Number(input.value);
        refresh();
        previewDraft();
      };
      refresh();
      wrap.append(text, input);
      fields.append(wrap);
      controls.push({ key, input, refresh });
    }
    const themeNote = document.createElement('p');
    themeNote.className = 'shiye-dialog-note';
    themeNote.textContent =
      '主题跟随全局，在应用设置 → 全局外观修改。壁纸仍可按页面和会话单独设置。';
    fields.append(
      themeNote,
      menuButton('打开全局外观设置', 'display', () => {
        if (typeof window.shiyeAndroidSettings?.open !== 'function')
          return showError('应用设置连接尚未准备好，请重试');
        window.shiyeAndroidSettings.open();
      }),
    );
    const enterLabel = document.createElement('label');
    const enter = document.createElement('input');
    enter.type = 'checkbox';
    enter.checked = draft.enterToSend;
    enter.dataset.appearance = 'enterToSend';
    enter.onchange = () => {
      draft.enterToSend = enter.checked;
    };
    enterLabel.append(enter, document.createTextNode('Enter 直接发送（Shift+Enter 换行）'));
    fields.append(enterLabel);
    const sideLabel = document.createElement('label');
    sideLabel.textContent = '本人消息位置';
    const side = document.createElement('select');
    side.dataset.appearance = 'selfMessageSide';
    for (const [value, label] of [
      ['right', '靠右'],
      ['left', '靠左'],
    ]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      side.append(option);
    }
    side.value = draft.selfMessageSide;
    side.onchange = () => {
      draft.selfMessageSide = side.value;
      previewDraft();
    };
    sideLabel.append(side);
    fields.append(sideLabel);
    controls.push({ key: 'selfMessageSide', input: side, refresh() {} });
    const motionLabel = document.createElement('label');
    motionLabel.textContent = '消息出现方式';
    const motion = document.createElement('select');
    motion.dataset.appearance = 'messageMotion';
    for (const [value, label] of [
      ['smooth', '平滑过渡'],
      ['instant', '立即出现'],
    ]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      motion.append(option);
    }
    motion.value = draft.messageMotion;
    motion.onchange = () => {
      draft.messageMotion = motion.value;
      previewDraft();
    };
    motionLabel.append(motion);
    fields.append(motionLabel);
    controls.push({ key: 'messageMotion', input: motion, refresh() {} });
    const suggestionLabel = document.createElement('label');
    const suggestions = document.createElement('input');
    suggestions.type = 'checkbox';
    suggestions.dataset.appearance = 'stickerSuggestionsEnabled';
    const refreshSuggestions = () => {
      suggestions.checked = draft.stickerSuggestionsEnabled !== false;
    };
    refreshSuggestions();
    suggestions.onchange = () => {
      draft.stickerSuggestionsEnabled = suggestions.checked;
      previewDraft();
    };
    suggestionLabel.append(suggestions, document.createTextNode('根据输入文字联想表情包'));
    fields.append(suggestionLabel);
    controls.push({
      key: 'stickerSuggestionsEnabled',
      input: suggestions,
      refresh: refreshSuggestions,
    });
    const positionLabel = document.createElement('label');
    const rememberPosition = document.createElement('input');
    rememberPosition.type = 'checkbox';
    rememberPosition.checked = draft.rememberReadingPosition;
    rememberPosition.dataset.appearance = 'rememberReadingPosition';
    rememberPosition.onchange = () => {
      draft.rememberReadingPosition = rememberPosition.checked;
      previewDraft();
    };
    positionLabel.append(
      rememberPosition,
      document.createTextNode('进入会话时恢复上次阅读位置（默认看最新）'),
    );
    fields.append(positionLabel);
    const enableControls = () => {
      const disabled = !!id && !inherit.checked;
      for (const { input } of controls) input.disabled = disabled;
      enter.disabled = disabled;
      rememberPosition.disabled = disabled;
    };
    inherit.onchange = () => {
      enableControls();
      previewDraft();
    };
    enableControls();
    const reset = menuButton('恢复默认显示', 'display', () => {
      const legacyTheme = draft.theme;
      Object.assign(draft, id ? appearance : appearanceDefaults);
      draft.theme = legacyTheme;
      if (id) inherit.checked = false;
      for (const { key, input, refresh } of controls) {
        input.value = draft[key] ?? draft.bubblePadding;
        refresh();
      }
      enter.checked = draft.enterToSend;
      rememberPosition.checked = draft.rememberReadingPosition;
      enableControls();
      previewDraft();
    });
    fields.append(reset);
    const recommended = menuButton('应用紧凑推荐', 'display', () => {
      Object.assign(draft, {
        messageFontSize: 16,
        inputFontSize: 14,
        bubblePadding: 8,
        bubblePaddingBlock: 4,
        bubbleRadius: 8,
        bubbleWidth: 90,
        messageGap: 3,
        messageTimeSize: 8,
        messageTimeOpacity: 62,
        bubbleOpacity: 100,
        qqChromeTone: 'white',
      });
      if (id) inherit.checked = true;
      for (const { key, input, refresh } of controls) {
        input.value = draft[key];
        refresh();
      }
      enableControls();
      previewDraft();
    });
    fields.append(recommended);
    if (id)
      fields.append(
        menuButton('恢复跟随全局', 'display', () => {
          inherit.checked = false;
          enableControls();
          previewDraft();
        }),
      );
    const { save, error } = actions(form, modal, '保存');
    modal.querySelector('.actions button:first-child').onclick = () => {
      modal.__back = !!parent;
      modal.close();
    };
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (saving) return;
      const submitEpoch = settingsEpoch;
      const submitted = checkedAppearance(draft);
      const submittedOverride = inherit.checked;
      saving = true;
      save.disabled = true;
      try {
        await updatePreference(
          (previous) => {
            if (!id)
              return {
                ...previous,
                appearance: { ...previous.appearance, ...submitted },
              };
            const overrides = { ...previous.roomAppearance };
            if (submittedOverride) overrides[id] = { ...overrides[id], ...submitted };
            else delete overrides[id];
            return { ...previous, roomAppearance: overrides };
          },
          () => submitEpoch === settingsEpoch && modal.isConnected && modal.open,
        );
        if (submitEpoch !== settingsEpoch || !modal.open) {
          if (modal.open) previewDraft();
          return;
        }
        accepted = true;
        saving = false;
        settingsPages.delete(pageKey);
        modal.__back = !!parent;
        modal.close();
      } catch (err) {
        error.textContent = err.message;
      } finally {
        saving = false;
        save.disabled = false;
      }
    };
  }
  function getEditor() {
    let editor;
    window.dispatchEvent(
      new CustomEvent('shiye-editor-request', {
        detail: {
          receive: (value) => {
            editor = value;
          },
        },
      }),
    );
    return editor;
  }
  function backgroundUrl(value) {
    if (typeof value !== 'string') return undefined;
    try {
      const url = new URL(value, location.href);
      return url.origin === location.origin &&
        url.pathname.startsWith('/telegram/local-background/')
        ? url.href
        : undefined;
    } catch {
      return undefined;
    }
  }
  function backgroundSettings(id, parent, scope = 'room') {
    const { modal, form } = dialog(
      scope === 'list' ? '会话列表背景' : scope === 'chat' ? '聊天默认背景' : '当前会话背景',
      parent,
    );
    const note = document.createElement('p');
    note.className = 'shiye-dialog-note';
    note.textContent =
      scope === 'list'
        ? '只用于随想会话列表，不改变任何会话的消息背景。'
        : scope === 'chat'
          ? '用于未单独设置背景的会话，不写入消息正文。'
          : '只用于这个会话。恢复跟随全局后使用聊天默认背景。';
    form.append(note);
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    let retryButton;
    const syncRetry = () => {
      if (scope !== 'list') return;
      if (!listWallpaperReady && !retryButton) {
        retryButton = menuButton('重试显示已存壁纸', 'display', async () => {
          retryButton.disabled = true;
          try {
            await pinWriteQueue.catch(() => {});
            const native = await connectNativeVisualPreferences();
            const receipt = preferenceReceipt(await native.load());
            if (!modal.isConnected || !modal.open) return;
            if (receipt.value === null) throw new Error('本机偏好尚未就绪，请重试');
            applyListWallpaperReceipt(receipt, receipt.value);
            scheduleShell();
            status.textContent = listWallpaperReady
              ? '已显示已保存的壁纸'
              : '已保存到本机，壁纸暂未显示，请重试';
            syncRetry();
          } catch (error) {
            status.textContent = error.message;
          } finally {
            retryButton.disabled = false;
          }
        });
      }
      if (!listWallpaperReady && retryButton && !retryButton.isConnected) form.append(retryButton);
      if (listWallpaperReady) retryButton?.remove();
    };
    for (const [label, choose] of [
      ['选择背景图片', true],
      [scope === 'room' ? '恢复跟随全局' : '恢复默认背景', false],
    ]) {
      const button = menuButton(label, 'display', async () => {
        button.disabled = true;
        const ownerRoom = currentId();
        const ownerVersion = roomContextVersion;
        const ownsContext = () =>
          modal.isConnected &&
          modal.open &&
          currentId() === ownerRoom &&
          roomContextVersion === ownerVersion;
        try {
          let selected;
          if (choose) {
            if (!window.shiyeAndroidBackground?.choose)
              throw new Error('背景选图连接尚未准备好，请重试');
            selected = await window.shiyeAndroidBackground.choose();
            if (!ownsContext()) return;
            if (!selected || selected.cancelled) return;
            if (
              !selected.assetId ||
              !backgroundUrl(selected.url) ||
              !backgroundUrl(selected.avatarUrl)
            )
              throw new Error('背景图片回执无效，原背景已保留');
          }
          if (!ownsContext()) return;
          await updatePreference((previous) => {
            if (scope !== 'room') {
              const next = { ...previous },
                key = scope === 'list' ? 'listBackground' : 'chatBackground';
              if (choose) next[key] = selected;
              else delete next[key];
              return next;
            }
            const backgrounds = { ...previous.roomBackgrounds };
            if (choose) backgrounds[id] = selected;
            else delete backgrounds[id];
            return { ...previous, roomBackgrounds: backgrounds };
          }, ownsContext);
          if (ownsContext()) {
            status.textContent = scope === 'list' && !listWallpaperReady
              ? '已保存到本机，壁纸暂未显示，请重试'
              : '已保存';
            syncRetry();
          }
        } catch (error) {
          status.textContent = error.message;
        } finally {
          button.disabled = false;
        }
      });
      form.append(button);
    }
    if (scope === 'list' && !listWallpaperReady) {
      status.textContent = '已保存到本机，壁纸暂未显示，请重试';
      syncRetry();
    }
    form.append(status);
    form.onsubmit = (event) => event.preventDefault();
    return modal;
  }
  // Keep the existing local symbol library, replace only its presentation seam.
  const originalDialogShowModal = HTMLDialogElement.prototype.showModal;
  HTMLDialogElement.prototype.showModal = function (...args) {
    if (!this.classList.contains('shiye-symbol-dialog'))
      return originalDialogShowModal.apply(this, args);
    document.activeElement?.blur();
    const messageList = document.querySelector('#MiddleColumn .MessageList');
    const wasAtEnd =
      messageList &&
      messageList.scrollHeight - messageList.clientHeight - messageList.scrollTop < 100;
    this.classList.add('shiye-keyboard-panel');
    this.show();
    document.body.classList.add('shiye-symbol-panel-open');
    const footer = document.querySelector('#MiddleColumn .middle-column-footer');
    const sizeFooter = () =>
      document.body.style.setProperty(
        '--shiye-symbol-footer-height',
        `${footer?.getBoundingClientRect().height || 60}px`,
      );
    sizeFooter();
    if (wasAtEnd)
      requestAnimationFrame(() => {
        if (this.open && messageList.isConnected) messageList.scrollTop = messageList.scrollHeight;
      });
    const footerObserver = new ResizeObserver(sizeFooter);
    if (footer) footerObserver.observe(footer);
    this.addEventListener(
      'close',
      () => {
        footerObserver.disconnect();
        document.body.style.removeProperty('--shiye-symbol-footer-height');
        document.body.classList.remove('shiye-symbol-panel-open');
      },
      { once: true },
    );
  };
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (event.target.closest?.('#editable-message-text'))
        document.querySelector('.shiye-keyboard-panel[open]')?.close();
    },
    true,
  );
  document.addEventListener('focusin', (event) => {
    if (event.target.closest?.('#editable-message-text'))
      document.querySelector('.shiye-keyboard-panel[open]')?.close();
  });
  document.addEventListener(
    'click',
    (event) => {
      const panel = document.querySelector('.shiye-keyboard-panel[open]');
      if (panel && event.target.closest?.('.shiye-symbol-button')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        panel.close();
      }
    },
    true,
  );
  let previousViewportHeight = window.visualViewport?.height || innerHeight;
  const closePanelForKeyboard = () => {
    const height = window.visualViewport?.height || innerHeight;
    if (previousViewportHeight - height > 100)
      document.querySelector('.shiye-keyboard-panel[open]')?.close();
    previousViewportHeight = height;
  };
  window.visualViewport?.addEventListener('resize', closePanelForKeyboard);
  window.addEventListener('resize', closePanelForKeyboard);
  function openDocumentChooser() {
    const editor = getEditor();
    if (!editor) return showError('请先进入会话后选择文件');
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '*/*';
    input.multiple = true;
    input.onchange = () => {
      if (input.files?.length) editor.files([...input.files]);
    };
    input.click();
  }
  window.shiyeSettingsUi = {
    open({ page, title, content }) {
      const parent = document.querySelector('.shiye-android-dialog[open]');
      const { modal, form, restored } = dialog(title, parent, `local-input:${page}`);
      if (!restored) {
        const section = document.createElement('section');
        section.className = 'shiye-local-input-settings shiye-dialog-body';
        section.append(...form.childNodes);
        // This HTML is a fixed UI template from the frozen local input module.
        const body = document.createElement('div');
        body.innerHTML = content;
        section.append(body);
        form.replaceWith(section);
        modal.__form = section;
      }
      return modal;
    },
    saved(element) {
      element.dataset.dirty = 'false';
    },
    bindForm(element, form) {
      const controls = form.querySelector('.shiye-actions');
      if (controls) {
        form.id ||= `shiye-settings-${crypto.randomUUID()}`;
        for (const button of controls.querySelectorAll('button'))
          button.setAttribute('form', form.id);
        const footer = document.createElement('footer');
        footer.className = 'shiye-dialog-footer';
        footer.append(controls);
        element.append(footer);
      }
      form.addEventListener('input', () => {
        element.dataset.dirty = 'true';
      });
    },
  };
  const nativeAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (...args) {
    const localDownload = this.download && this.href.startsWith(`blob:${location.origin}/`);
    if (!localDownload || !window.shiyeAndroidFiles?.export)
      return nativeAnchorClick.apply(this, args);
    const name = this.download,
      url = this.href;
    (async () => {
      const blob = await (await fetch(url)).blob();
      if (blob.size > 64 * 1024 * 1024) throw new Error('文件超过当前可导出的 64 MiB 上限');
      const result = await window.shiyeAndroidFiles.export({
        blob,
        name,
        mimeType: blob.type || 'application/octet-stream',
        action: 'save',
      });
      if (!result?.saved && !result?.cancelled) throw new Error('文件尚未得到保存确认');
    })().catch((error) => showError(error.message));
  };
  document.addEventListener(
    'click',
    (event) => {
      const info = event.target.closest?.('.Message .File .file-info');
      if (!info || event.target.closest('a, button') || !window.getSelection()?.isCollapsed) return;
      const messageId = info.closest('.Message')?.dataset.messageId;
      const message = window.getGlobal?.()?.messages?.byChatId?.[currentId()]?.byId?.[messageId];
      const media = message?.content?.document;
      const download = window.getActions?.()?.downloadMedia;
      if (media && download) {
        // Upstream icon clicks cancel an in-flight automatic preload. A local
        // filename tap requests export through the same download manager.
        event.preventDefault();
        event.stopImmediatePropagation();
        download({ media, originMessage: message });
      }
    },
    true,
  );
  const originalInputClick = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function (...args) {
    if (this.type === 'file' && !this.isConnected) {
      const hidden = this.hidden;
      this.hidden = true;
      document.body.append(this);
      const cleanup = () =>
        queueMicrotask(() => {
          this.remove();
          this.hidden = hidden;
        });
      this.addEventListener('change', cleanup, { once: true });
      this.addEventListener('cancel', cleanup, { once: true });
    }
    return originalInputClick.apply(this, args);
  };
  const normalizedFileInputs = new WeakSet();
  document.addEventListener(
    'change',
    (event) => {
      const input = event.target;
      if (
        !(input instanceof HTMLInputElement) ||
        input.type !== 'file' ||
        normalizedFileInputs.has(input) ||
        ![...(input.files || [])].some((file) => file.size === 0)
      )
        return;
      event.stopImmediatePropagation();
      (async () => {
        const transfer = new DataTransfer();
        for (const file of input.files) {
          if (file.size !== 0) {
            transfer.items.add(file);
            continue;
          }
          const bytes = await file.arrayBuffer();
          transfer.items.add(
            bytes.byteLength
              ? new File([bytes], file.name, {
                  type: file.type,
                  lastModified: file.lastModified,
                })
              : file,
          );
        }
        input.files = transfer.files;
        normalizedFileInputs.add(input);
        try {
          input.dispatchEvent(new Event('change', { bubbles: true }));
        } finally {
          normalizedFileInputs.delete(input);
        }
      })().catch((error) => showError('读取所选文件失败：' + error.message));
    },
    true,
  );
  const localLibrary = () =>
    new Promise((resolve, reject) => {
      const request = indexedDB.open('shiye-android-telegram-v2', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const read = db.transaction('preview').objectStore('preview').get('library');
        read.onsuccess = () => {
          db.close();
          resolve(read.result);
        };
        read.onerror = () => {
          db.close();
          reject(read.error);
        };
      };
    });
  async function installLocalInput() {
    // Reuse ui18's local picker, aliases and editor hook, without its desktop shell.
    const {
      qt: buildAttachment,
      shiyePrepareAttachment: prepareAttachment,
      shiyePrepareAttachmentsToSend: prepareAttachmentsToSend,
    } = await import('./assets/useConnectionStatus-Dy1kHT8L.js');
    let stickerSending = false;
    function stickerContext(editor) {
      const id = currentId(),
        global = window.getGlobal?.();
      const candidates = Object.entries(global?.byTabId || {}).filter(
        ([, tab]) => tab.messageLists?.at(-1)?.chatId === id,
      );
      if (
        !id ||
        candidates.length !== 1 ||
        !editor.input?.isConnected ||
        document.querySelector('#editable-message-text') !== editor.input
      )
        throw new Error('请先打开一个会话');
      const [tabId, tab] = candidates[0],
        list = tab.messageLists.at(-1);
      const local = global.messages?.byChatId?.[id]?.threadsById?.[list.threadId]?.localState;
      if (
        list.type === 'scheduled' ||
        local?.editingId ||
        local?.editingScheduledId ||
        tab.forwardMessages?.messageIds?.length ||
        document.querySelector(
          '.shiye-attachment-modal.open, [class*=AttachmentModal-module__send-wrapper]',
        )
      )
        throw new Error('请先完成当前附件、转发或消息编辑，再发送表情包');
      return {
        id,
        tabId,
        list: { ...list },
        version: roomContextVersion,
        reply: JSON.stringify(local?.draft?.replyInfo || null),
      };
    }
    async function sendSticker(editor, file) {
      if (stickerSending) throw new Error('上一张表情包尚未得到本地保存确认');
      if (
        !(file instanceof File) ||
        file.shiyeOriginalSticker !== true ||
        !file.type.startsWith('image/') ||
        !file.size ||
        file.size > 64 * 1024 * 1024
      )
        throw new Error('请选择64 MiB以内的原图片或动图表情包');
      const context = stickerContext(editor);
      stickerSending = true;
      let attachment,
        submitted = false;
      try {
        const before = await localLibrary();
        const previousIds = new Set(
          (before?.messages?.[context.id] || []).map((message) => message.id),
        );
        const expected = new Uint8Array(await file.arrayBuffer());
        attachment = await prepareAttachment(await buildAttachment(file.name, file));
        const active = stickerContext(editor);
        if (
          active.id !== context.id ||
          active.version !== context.version ||
          active.list.threadId !== context.list.threadId ||
          active.reply !== context.reply
        )
          throw new Error('会话或引用已改变，请重新选择表情包');
        const actions = window.getActions?.();
        if (!actions?.sendMessage) throw new Error('本地发送连接尚未准备好，请重试');
        actions.sendMessage({
          messageList: context.list,
          tabId: context.tabId,
          text: '',
          attachments: prepareAttachmentsToSend([attachment], true),
          shouldGroupMessages: false,
        });
        submitted = true;
        const started = performance.now();
        while (true) {
          // Read the worker's committed message AND its original media, not DOM visibility.
          await new Promise((resolve) => setTimeout(resolve, 150));
          const saved = await localLibrary();
          const received = (saved?.messages?.[context.id] || []).find((message) => {
            if (previousIds.has(message.id) || !message.out || !message.media) return false;
            const media = saved.documents?.find((item) => item.id === message.media.id);
            const bytes = media?.bytes;
            return (
              bytes?.length === expected.length &&
              media.mimeType === file.type &&
              expected.every((value, index) => value === bytes[index])
            );
          });
          if (received) {
            // Do not clear a reply newly chosen while this original was saving.
            try {
              const current = stickerContext(editor);
              if (
                current.id === context.id &&
                current.version === context.version &&
                current.reply === context.reply
              )
                actions.resetDraftReplyInfo?.({ tabId: context.tabId });
            } catch {
              /* A completed send must survive navigation or a newly opened modal. */
            }
            // MockClient clears the remote draft on send; retain the editor's unrelated text.
            window.dispatchEvent(new Event('shiye-flush-draft'));
            const receipt = await command('flush');
            if (!receipt.flushed) throw new Error('表情包保存状态尚未确认，请先查看聊天记录');
            window.dispatchEvent(new Event('shiye-local-media-committed'));
            return {
              messageId: String(received.id),
              roomId: context.id,
              mediaId: String(received.media.id),
              flushed: true,
            };
          }
          if (performance.now() - started > 12000)
            throw new Error('表情包本地保存尚未确认，请先查看聊天记录再重试');
        }
      } finally {
        stickerSending = false;
        if (attachment && !submitted)
          for (const url of new Set([
            attachment.blobUrl,
            attachment.compressedBlobUrl,
            attachment.previewBlobUrl,
          ]))
            if (url) URL.revokeObjectURL(url);
      }
    }
    // Shared sticker UI already uses sendSticker when present. Adapt only this
    // frozen editor hook; ordinary files() and the upstream confirmation stay intact.
    window.addEventListener(
      'shiye-editor-request',
      (event) => {
        const receive = event.detail?.receive;
        if (typeof receive !== 'function') return;
        event.detail.receive = (editor) =>
          receive({ ...editor, sendSticker: (file) => sendSticker(editor, file) });
      },
      { capture: true },
    );
    await import('./shiye-local-assets.js');
    async function ownedSticker(asset, materialize = false) {
      if (!asset?.id?.startsWith('sticker:') || !(asset.blob instanceof Blob)) return asset;
      // Android DocumentsUI can return a File whose size is 0 while reads return
      // valid bytes. Blob concatenation trusts that metadata and loses the data.
      // Own imported bytes; repair old malformed metadata only in the read result.
      if (!materialize && asset.blob.size !== 0) return asset;
      const bytes = await asset.blob.arrayBuffer();
      if (!bytes.byteLength) throw new Error('图片文件为空，请重新选择原图');
      return { ...asset, blob: new Blob([bytes], { type: asset.blob.type }) };
    }
    const originalGet = window.shiyeLocalAssets.get;
    const originalList = window.shiyeLocalAssets.list;
    window.shiyeLocalAssets.get = async (...args) => ownedSticker(await originalGet(...args));
    window.shiyeLocalAssets.list = async (...args) =>
      Promise.all((await originalList(...args)).map((asset) => ownedSticker(asset)));
    for (const method of ['put', 'remove', 'saveMapping']) {
      const original = window.shiyeLocalAssets[method];
      window.shiyeLocalAssets[method] = (...args) => {
        const operation = assetWriteQueue
          .catch(() => {})
          .then(async () => {
            if (method === 'put') args[0] = await ownedSticker(args[0], true);
            return original(...args);
          });
        assetWriteQueue = operation;
        return operation;
      };
    }
    await import('./shiye-stickers.js');
    window.shiyeStickers.setLibraryReader(async () => {
      // Shared metadata form calls its lexical saveMessage implementation. Guard
      // its reader too, so a just-painted bubble is never mistaken for an ACK.
      await flush();
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('shiye-android-telegram-v2', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise((resolve, reject) => {
          const request = db.transaction('preview').objectStore('preview').get('library');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      } finally {
        db.close();
      }
    });
    const { installAndroidStickers } = await import('./android-stickers.js');
    installAndroidStickers({ readLibrary: localLibrary, currentId });
    // The frozen Android vendor menu predates the desktop custom action.
    let stickerTarget;
    document.addEventListener(
      'contextmenu',
      (event) => {
        const node = event.target.closest?.('.Message[data-message-id]');
        stickerTarget = node
          ? { roomId: currentId(), messageId: node.dataset.messageId }
          : undefined;
      },
      true,
    );
    new MutationObserver(() => {
      const menu = document.querySelector('.MessageContextMenu_items');
      if (!menu || !stickerTarget || menu.querySelector('[data-save-local-sticker]')) return;
      const message =
        window.getGlobal?.()?.messages?.byChatId?.[stickerTarget.roomId]?.byId?.[
          stickerTarget.messageId
        ];
      const content = message?.content;
      if (
        !content ||
        !(
          content.photo ||
          content.video?.mimeType === 'image/gif' ||
          /^image\/(png|jpeg|webp|gif|avif)$/.test(content.document?.mimeType || '')
        )
      )
        return;
      const target = { ...stickerTarget };
      const save = document.createElement('button');
      save.className = 'MenuItem compact';
      save.dataset.saveLocalSticker = 'true';
      save.textContent = '保存为表情包';
      save.onclick = () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        window.dispatchEvent(new CustomEvent('shiye-save-sticker', { detail: target }));
      };
      menu.append(save);
    }).observe(document.body, { childList: true, subtree: true });
    await import('./shiye-input.js');
    const { installAndroidStickerPanel } = await import('./android-sticker-panel.js');
    installAndroidStickerPanel();
    localInputReady = true;
  }
  async function installRequiredQQ() {
    if (sharedModeRequested) {
      const { loadConfiguredRuntime } = await import('./qq-chat/shared-runtime.js');
      sharedRuntime = await loadConfiguredRuntime({
        readThoughtPreferences: async () => {
          const local = await (await connectNativePreferences()).load();
          if (!local || typeof local !== 'object') return local;
          const captured = { ...local };
          // This page's line color is local presentation, not shared business data.
          delete captured.listDividerColor;
          return captured;
        },
        currentRoom: () => sharedCurrentRoom,
        contextVersion: () => roomContextVersion,
        appearance: () => qqPreviewAppearance || effectiveAppearance(),
        onChange: () => {
          void refreshRooms()
            .then(scheduleShell)
            .catch(() => {});
        },
        onError: (error) => {
          window.dispatchEvent(
            new CustomEvent('shiye-shared-error', {
              detail: { code: error.code || 'SHARED_NETWORK_UNAVAILABLE' },
            }),
          );
        },
      });
      if (!sharedRuntime) throw new Error('SHARED_EXPLICIT_IDENTITY_REQUIRED');
      // Data-only API for diary/settings/order/service UI; no credential is available to this object.
      window.shiyeSharedData = Object.assign(sharedRuntime, {
        openRoom,
        closeRoom: closeConversation,
      });
      await refreshRooms();
      void sharedRuntime.start();
    }
    const { installAndroidQQSkin } = await import('./android-qq-skin.js');
    installAndroidQQSkin({
      resolveContext: localMessageContext,
      openMenu: messageActions,
      isBlocked: () => !!document.querySelector('dialog[open], .Modal.open') || !!mediaViewer(),
      reply(context) {
        if (
          currentId() !== context.roomId ||
          roomContextVersion !== context.version ||
          !window.getGlobal?.()?.messages?.byChatId?.[context.roomId]?.byId?.[context.messageId]
        )
          return;
        window.getActions().updateDraftReplyInfo({ replyToMsgId: context.messageId });
        requestAnimationFrame(() => window.dispatchEvent(new Event('shiye-focus-end')));
      },
    });

    const { installIndependentQQChat } = await import('./qq-chat/install.js');
    const independentChat = installIndependentQQChat({
      ...(sharedRuntime ? { source: sharedRuntime.source } : {}),
      currentId,
      contextVersion: () => roomContextVersion,
      readLibrary: localLibrary,
      flush: () => command('flush'),
      appearance: () => ({
        ...(qqPreviewAppearance || effectiveAppearance()),
        theme: window.shiyeAppTheme || effectiveAppearance().theme,
        background: roomBackgrounds[currentId()] || chatBackground || null,
        appearanceReady: preferencesReady,
        appearanceVersion,
      }),
      onSettings: () => roomMenu(currentId()),
      onBack: closeConversation,
      onMessageGesture: (gesture) =>
        window.dispatchEvent(new CustomEvent('shiye-chat-message-gesture', { detail: gesture })),
      onTextSelection: (active) =>
        window.dispatchEvent(
          new CustomEvent('shiye-chat-text-selection', {
            detail: { active: active === true },
          }),
        ),
    });
    if (!(await independentChat.view.readyPromise))
      throw Object.assign(new Error('QQ_FRAME_FAILED'), { code: 'QQ_FRAME_FAILED' });
    if (sharedRuntime) {
      let mount = document.querySelector('#LeftColumn');
      const deadline = performance.now() + 10000;
      while (!mount && performance.now() < deadline) {
        await new Promise(requestAnimationFrame);
        mount = document.querySelector('#LeftColumn');
      }
      const { installSharedDirectoryView } = await import('./qq-chat/shared-directory-view.js');
      sharedDirectoryView = installSharedDirectoryView({
        runtime: sharedRuntime,
        mount,
        onOpen: openRoom,
        onCreate: () => editRoom(),
        onSettings: roomMenu,
        onError: (error) => showError(error.message),
      });
    }
    // A late iframe may recover after timeout; never allow a second data owner.
    qqReady = true;
    qqFailure = '';
    scheduleShell();
  }
  initializationDeadline(installRequiredQQ(), 'QQ_INIT_TIMEOUT').catch((error) => {
    if (sharedModeRequested)
      showError(
        `共享会话未能打开（${error.code || 'SHARED_RUNTIME_NOT_READY'}），已保留原本机历史。请检查共享连接或明确关闭共享配置后重开。`,
      );
    qqFailure = ['QQ_INIT_TIMEOUT', 'QQ_FRAME_FAILED'].includes(error?.code)
      ? error.code
      : 'QQ_MODULE_FAILED';
    scheduleShell();
  });
  initializationDeadline(installLocalInput(), 'INPUT_INIT_TIMEOUT').catch((error) => {
    optionalInputFailure =
      error?.code === 'INPUT_INIT_TIMEOUT' ? error.code : 'INPUT_MODULE_FAILED';
  });
  let searchReturnQuery = null;
  let searchNavigation = 0;
  const searchSessions = new Map();
  const searchTime = (value) => {
    const stamp =
      typeof value === 'number' || /^\d+$/.test(String(value || ''))
        ? Number(value) * (Number(value) < 1e12 ? 1000 : 1)
        : Date.parse(value || '');
    if (!Number.isFinite(stamp) || stamp <= 0) return '';
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(stamp));
  };
  function search(query = '', restore = false) {
    const { modal, form } = dialog('搜索聊天记录');
    modal.classList.add('shiye-search-dialog');
    const input = field(form, '关键字');
    input.type = 'search';
    input.maxLength = 300;
    input.placeholder = '搜索所有会话中的消息';
    input.value = typeof query === 'string' ? query : '';
    const { save, error } = actions(form, modal, '搜索');
    const results = document.createElement('div');
    results.className = 'shiye-search-results';
    results.tabIndex = -1;
    form.append(results);
    let ticket = 0;
    let active = restore ? searchSessions.get(input.value) : null;
    const remember = () => {
      if (!active) return;
      active.scrollTop = results.scrollTop;
      searchSessions.delete(active.query);
      searchSessions.set(active.query, active);
      if (searchSessions.size > 5) searchSessions.delete(searchSessions.keys().next().value);
    };
    const paint = () => {
      results.replaceChildren();
      error.textContent = active?.total ? '' : '没有匹配记录';
      for (const item of active?.matches || []) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'room-result';
        button.dataset.messageId = String(item.messageId);
        const heading = document.createElement('div');
        heading.className = 'room-result-heading';
        const title = document.createElement('strong');
        title.textContent = item.title;
        const time = document.createElement('time');
        time.textContent = searchTime(item.date || item.sentAt);
        heading.append(title, time);
        const preview = document.createElement('span');
        preview.textContent = item.text;
        button.append(icon('search'), heading, preview);
        button.onclick = () => {
          active.selected = String(item.chatId) + ':' + String(item.messageId);
          remember();
          searchReturnQuery = active.query;
          modal.close();
          userHasNavigated = true;
          window.dispatchEvent(
            new CustomEvent('shiye-focus-message', {
              detail: { chatId: item.chatId, messageId: item.messageId },
            }),
          );
        };
        results.append(button);
      }
      if (active && active.matches.length < active.total) {
        const more = menuButton('加载更多结果', 'search', () => run(true));
        more.classList.add('shiye-search-more');
        results.append(more);
      }
      results.scrollTop = active?.scrollTop || 0;
    };
    async function run(more = false) {
      const term = input.value.trim();
      const request = ++ticket;
      save.disabled = true;
      try {
        const offset = more && active?.query === term ? active.matches.length : 0;
        const response = await command('search', { query: term, offset });
        if (request !== ticket || !modal.open || input.value.trim() !== term) return;
        if (!Array.isArray(response.matches)) throw new Error('搜索结果未确认，请重试');
        const oldTop = more ? results.scrollTop : 0;
        active = {
          query: term,
          total: response.total,
          matches: offset ? [...active.matches, ...response.matches] : response.matches,
          scrollTop: oldTop,
        };
        remember();
        paint();
      } catch (err) {
        if (request === ticket && modal.open) error.textContent = err.message;
      } finally {
        if (request === ticket) save.disabled = false;
      }
    }
    form.onsubmit = (event) => {
      event.preventDefault();
      void run();
    };
    results.addEventListener('scroll', remember, { passive: true });
    input.addEventListener('input', () => {
      ticket++;
      remember();
      active = null;
      results.replaceChildren();
      error.textContent = '';
      save.disabled = false;
    });
    modal.addEventListener('close', () => {
      ticket++;
    });
    if (active) {
      paint();
      requestAnimationFrame(() => {
        if (modal.open) results.scrollTop = active.scrollTop;
      });
    } else {
      input.focus();
      if (input.value) form.requestSubmit();
    }
  }
  window.addEventListener('shiye-new-topic', () => editRoom());
  window.addEventListener('shiye-open-settings', settings);
  window.addEventListener('shiye-open-search', () => search());
  window.addEventListener(
    'shiye-focus-message',
    async (event) => {
      const { detail } = event;
      if (sharedModeRequested) event.stopImmediatePropagation();
      if (!detail?.chatId || detail.messageId === null || detail.messageId === undefined) return;
      const ticket = ++searchNavigation;
      userHasNavigated = true;
      if (sharedModeRequested) {
        try {
          await openRoom(detail.chatId);
        } catch (error) {
          return showError(error.message);
        }
      }
      const started = performance.now();
      while (
        ticket === searchNavigation &&
        (String(currentId()) !== String(detail.chatId) ||
          !qqReady ||
          String(window.shiyeQQRebuild?.snapshot().renderer?.roomId) !== String(detail.chatId) ||
          !window.shiyeQQRebuild?.snapshot().renderer?.visible)
      ) {
        if (performance.now() - started > 12000)
          return showError('会话尚未就绪，请返回搜索结果重试');
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      if (ticket !== searchNavigation) return;
      const found = await window.shiyeQQRebuild?.view.locateMessage(detail.messageId);
      if (!found && ticket === searchNavigation) showError('未能定位这条消息，请返回搜索结果重试');
    },
    true,
  );
  window.addEventListener('shiye-edit-room', ({ detail }) => roomMenu(detail.id));
  const visible = (element) =>
    element &&
    element.getBoundingClientRect().width > 0 &&
    element.getBoundingClientRect().height > 0 &&
    getComputedStyle(element).visibility !== 'hidden';
  function clickFirst(selector) {
    const element = [...document.querySelectorAll(selector)].find(visible);
    if (!element) return false;
    element.click();
    return true;
  }
  async function closeConversation() {
    if (window.shiyeQQRebuild?.active) {
      try {
        await window.shiyeQQRebuild.flush();
      } catch (error) {
        showError(error.message);
        return;
      }
    }
    document.querySelector('.shiye-keyboard-panel[open]')?.close();
    if (sharedModeRequested) {
      sharedCurrentRoom = null;
      roomContextVersion++;
      scheduleShell();
      searchNavigation++;
      if (searchReturnQuery !== null) {
        const query = searchReturnQuery;
        searchReturnQuery = null;
        requestAnimationFrame(() => search(query, true));
      }
      return;
    }
    searchNavigation++;
    window.getActions?.().openPreviousChat();
    if (searchReturnQuery !== null) {
      const query = searchReturnQuery;
      searchReturnQuery = null;
      setTimeout(() => {
        if (!currentId()) search(query, true);
      }, 200);
    }
  }
  function syncShell() {
    if (!document.querySelector('#LeftMainHeader') || typeof window.getActions !== 'function')
      return;
    if (!initialListShown) {
      initialListShown = true;
      history.replaceState(null, '', location.pathname);
      closeConversation();
      refreshRooms()
        .then(() => ensurePreferences())
        .catch(() => {});
    }
    const id = currentId();
    if (
      preferencesReady &&
      appliedTheme !== effectiveAppearance(id).theme &&
      window.getGlobal?.()?.sharedState?.settings
    )
      applyAppearance();
    const listSource = backgroundUrl(listBackground?.url),
      listCss = listSource ? `url("${listSource}")` : 'none';
    const listOpacity = `${listRowOpacity}%`;
    if (document.body.style.getPropertyValue('--shiye-list-divider') !== listDividerColor)
      document.body.style.setProperty('--shiye-list-divider', listDividerColor);
    if (document.body.style.getPropertyValue('--shiye-list-row-opacity') !== listOpacity)
      document.body.style.setProperty('--shiye-list-row-opacity', listOpacity);
    if (document.body.style.getPropertyValue('--shiye-list-background') !== listCss)
      document.body.style.setProperty('--shiye-list-background', listCss);
    if (document.body.dataset.shiyeListBackground !== String(!!listSource))
      document.body.dataset.shiyeListBackground = String(!!listSource);
    const listHeader = document.querySelector('#LeftMainHeader');
    if (listHeader && listHeader.getAttribute('aria-label') !== '随想会话列表')
      listHeader.setAttribute('aria-label', '随想会话列表');
    const background = backgroundUrl((roomBackgrounds[id] || chatBackground)?.url);
    const backgroundCss =
      document.body.dataset.shiyeQqOwnerInstalled !== 'true' && background
        ? `url("${background}")`
        : 'none';
    if (document.body.style.getPropertyValue('--shiye-room-background') !== backgroundCss)
      document.body.style.setProperty('--shiye-room-background', backgroundCss);
    const composer = document.querySelector('.Composer.is-chat-composer');
    if (composer && !composer.querySelector('.shiye-empty-send')) {
      const empty = document.createElement('button');
      empty.type = 'button';
      empty.className = 'shiye-empty-send';
      const plane = document.createElement('i');
      plane.className = 'icon icon-new-send';
      plane.setAttribute('aria-hidden', 'true');
      empty.append(plane);
      empty.ariaLabel = '发送（请输入内容）';
      empty.disabled = true;
      composer.append(empty);
    }
    if (id && !userHasNavigated) {
      closeConversation();
      return;
    }
    const isOpen = !!id;
    updateQQGate(isOpen);
    window.shiyeQQRebuild?.setActive(isOpen && qqReady);
    if (inConversation !== isOpen || reportedRoomId !== (id || null)) {
      inConversation = isOpen;
      reportedRoomId = id || null;
      window.dispatchEvent(
        new CustomEvent('shiye-android-view-state', { detail: { inConversation: isOpen } }),
      );
    }
    const middle = document.querySelector('#MiddleColumn');
    let header = document.querySelector('.shiye-android-header');
    if (middle && !header) {
      header = document.createElement('header');
      header.className = 'shiye-android-header';
      const back = document.createElement('button');
      back.type = 'button';
      back.ariaLabel = '返回会话';
      back.append(icon('back'));
      back.onclick = closeConversation;
      const text = document.createElement('strong');
      const menu = document.createElement('button');
      menu.type = 'button';
      menu.ariaLabel = '会话设置';
      menu.append(icon('settings'));
      menu.onclick = () => roomMenu(currentId());
      header.append(back, text, menu);
      document.body.append(header);
    }
    if (header) {
      header.hidden = !isOpen;
      const text = header.querySelector('strong'),
        value = roomCache.find((r) => r.id === id)?.title || '随想';
      if (text.textContent !== value) text.textContent = value;
    }
    for (const settings of document.querySelectorAll('.shiye-room-settings')) {
      const row = settings.closest('.ListItem') || settings.parentElement;
      row?.classList.toggle('shiye-android-pinned', pinIds.includes(settings.dataset.roomId));
      const gradients = [
        '#65a4e3, #537dd0',
        '#82bc91, #4e9c8b',
        '#bd9ce1, #9277c7',
        '#e0a77a, #ca816e',
      ];
      const color = Math.abs(Number(settings.dataset.roomId) || 0) % gradients.length;
      const gradient = `linear-gradient(145deg, ${gradients[color]})`;
      if (row && row.style.getPropertyValue('--shiye-avatar-gradient') !== gradient)
        row.style.setProperty('--shiye-avatar-gradient', gradient);
      const avatar = row?.querySelector('.Avatar');
      if (avatar) {
        const source = backgroundUrl(roomBackgrounds[settings.dataset.roomId]?.avatarUrl);
        avatar.classList.toggle('shiye-room-background-avatar', !!source);
        const image = source ? `url("${source}")` : '';
        if (avatar.style.backgroundImage !== image) avatar.style.backgroundImage = image;
      }
    }
    const days = {
      Sunday: '周日',
      Monday: '周一',
      Tuesday: '周二',
      Wednesday: '周三',
      Thursday: '周四',
      Friday: '周五',
      Saturday: '周六',
    };
    for (const time of document.querySelectorAll(
      '#LeftColumn .last-message-meta, #LeftColumn .time, #LeftColumn time',
    )) {
      if (time.children.length) continue;
      const replacement = time.textContent.replace(
        /Weekday\.Short(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)/g,
        (_, day) => days[day],
      );
      if (replacement !== time.textContent && time.dataset.androidDate !== replacement)
        time.dataset.androidDate = replacement;
    }
  }
  // Telegram's animation path expects server-converted video. Local GIF files
  // retain their original bytes and filename card; add only a read-only preview.
  let gifRoom;
  let gifScheduled = false;
  const gifCandidates = new Set();
  const gifUrls = new Map();
  const gifRetries = new Map();
  const gifTimers = new Set();
  let gifGeneration = 0;
  function releaseGifUrls() {
    gifGeneration++;
    for (const timer of gifTimers) clearTimeout(timer);
    gifTimers.clear();
    gifRetries.clear();
    for (const image of document.querySelectorAll('.shiye-local-gif')) {
      image.closest('.shiye-local-gif-frame')?.classList.remove('shiye-local-gif-frame');
      image.closest('.File')?.classList.remove('shiye-local-gif-file');
      image.remove();
    }
    for (const value of gifUrls.values()) if (value?.url) URL.revokeObjectURL(value.url);
    gifUrls.clear();
    gifCandidates.clear();
  }
  function observeGifNode(node) {
    if (!(node instanceof Element)) return;
    if (node.matches('.File')) gifCandidates.add(node);
    const messageFile = node.closest('.Message')?.querySelector('.File');
    if (messageFile) gifCandidates.add(messageFile);
    for (const file of node.querySelectorAll('.File')) gifCandidates.add(file);
  }
  async function syncLocalGifs() {
    const room = currentId();
    if (room !== gifRoom) {
      releaseGifUrls();
      gifRoom = room;
      if (room) observeGifNode(document.querySelector('#MiddleColumn'));
    }
    if (!room) {
      gifCandidates.clear();
      return;
    }
    if (!gifCandidates.size) return;
    const generation = gifGeneration;
    const candidates = [...gifCandidates];
    gifCandidates.clear();
    const matches = [];
    for (const file of candidates) {
      if (!file.isConnected) continue;
      // A fresh local send may already have its native media preview. Keep that
      // renderer and add a fallback only after persistence lacks that metadata.
      if (file.parentElement.querySelector('.media-inner img.full-media')) {
        file.parentElement.querySelector('.shiye-local-gif')?.remove();
        file.parentElement
          .querySelector('.shiye-local-gif-frame')
          ?.classList.remove('shiye-local-gif-frame');
        file.classList.remove('shiye-local-gif-file');
        continue;
      }
      if (file.parentElement.querySelector('.shiye-local-gif')) continue;
      const messageId = file.closest('.Message')?.dataset.messageId;
      const message = window.getGlobal?.()?.messages?.byChatId?.[room]?.byId?.[messageId];
      const document = message?.content?.document || message?.content?.video;
      if (document?.mimeType !== 'image/gif') continue;
      matches.push({ file, key: room + ':' + messageId, documentId: String(document.id) });
    }
    if (!matches.length) return;
    const missing = matches.filter((item) => !gifUrls.has(item.key));
    if (missing.length) {
      const library = await new Promise((resolve, reject) => {
        const request = indexedDB.open('shiye-android-telegram-v2', 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const read = db.transaction('preview').objectStore('preview').get('library');
          read.onsuccess = () => {
            db.close();
            resolve(read.result);
          };
          read.onerror = () => {
            db.close();
            reject(read.error);
          };
        };
      });
      if (room !== currentId() || gifRoom !== room || generation !== gifGeneration) return;
      for (const item of missing) {
        if (gifUrls.has(item.key)) continue;
        const stored = library?.documents?.find((doc) => String(doc.id) === item.documentId);
        if (!stored?.bytes?.length) {
          const attempt = gifRetries.get(item.key) || 0;
          if (attempt < 3) {
            gifRetries.set(item.key, attempt + 1);
            const timer = setTimeout(() => {
              gifTimers.delete(timer);
              if (generation !== gifGeneration || room !== currentId() || !item.file.isConnected)
                return;
              gifCandidates.add(item.file);
              scheduleLocalGifs();
            }, [100, 300, 700][attempt]);
            gifTimers.add(timer);
          }
          continue;
        }
        const bytes = new Uint8Array(stored.bytes);
        const signature = bytes && String.fromCharCode(...bytes.subarray(0, 6));
        if (stored?.mimeType !== 'image/gif' || !['GIF87a', 'GIF89a'].includes(signature)) {
          gifUrls.set(item.key, null);
          continue;
        }
        gifUrls.set(item.key, {
          url: URL.createObjectURL(new Blob([bytes], { type: 'image/gif' })),
        });
      }
    }
    if (room !== currentId() || generation !== gifGeneration) return;
    mutate(() => {
      if (room !== currentId() || generation !== gifGeneration) return;
      for (const item of matches) {
        const cached = gifUrls.get(item.key);
        if (
          !cached ||
          !item.file.isConnected ||
          item.file.parentElement.querySelector('.shiye-local-gif')
        )
          continue;
        const image = document.createElement('img');
        image.className = 'shiye-local-gif';
        image.alt = item.file.querySelector('.file-title')?.textContent || 'GIF 表情包';
        image.src = cached.url;
        image.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          const viewer = document.createElement('dialog');
          viewer.className = 'shiye-local-image-viewer';
          const close = document.createElement('button');
          close.textContent = '关闭图片';
          close.onclick = () => viewer.close();
          const original = image.cloneNode();
          original.className = '';
          viewer.append(close, original);
          viewer.addEventListener(
            'close',
            () => {
              viewer.remove();
              document.querySelector('#editable-message-text')?.focus({ preventScroll: true });
            },
            { once: true },
          );
          document.body.append(viewer);
          viewer.showModal();
          close.focus();
        });
        const frame = item.file.parentElement.querySelector('.media-inner');
        if (frame) {
          frame.classList.add('shiye-local-gif-frame');
          frame.append(image);
        } else {
          item.file.classList.add('shiye-local-gif-file');
          item.file.prepend(image);
        }
      }
    });
  }
  function scheduleLocalGifs() {
    if (gifScheduled) return;
    gifScheduled = true;
    queueMicrotask(async () => {
      try {
        await syncLocalGifs();
      } catch (error) {
        console.warn('Local GIF preview unavailable:', error.message);
      } finally {
        gifScheduled = false;
        if (gifCandidates.size) scheduleLocalGifs();
      }
    });
  }
  new MutationObserver((records) => {
    for (const record of records) for (const node of record.addedNodes) observeGifNode(node);
    if (gifCandidates.size || currentId() !== gifRoom) scheduleLocalGifs();
  }).observe(document.body, { childList: true, subtree: true });
  window.addEventListener('pagehide', releaseGifUrls);
  let shellScheduled = false;
  let viewerWasOpen = false;
  function mediaViewer() {
    return [
      ...document.querySelectorAll('#MediaViewer, .MediaViewer, .shiye-local-image-viewer[open]'),
    ].find(visible);
  }
  function syncViewerFocus() {
    const viewer = mediaViewer();
    if (viewer && !viewerWasOpen) {
      viewerWasOpen = true;
      viewer.setAttribute('tabindex', '-1');
      if (!viewer.contains(document.activeElement)) viewer.focus({ preventScroll: true });
    } else if (!viewer && viewerWasOpen) {
      viewerWasOpen = false;
      if (!document.querySelector('dialog[open], .Modal.open'))
        document.querySelector('#editable-message-text')?.focus({ preventScroll: true });
    }
  }
  function scheduleShell() {
    if (shellScheduled) return;
    shellScheduled = true;
    mutate(() => {
      shellScheduled = false;
      syncShell();
      syncViewerFocus();
    });
  }
  new MutationObserver(scheduleShell).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'open'],
  });
  async function flush() {
    if (sharedModeRequested) {
      if (!sharedRuntime) throw new Error('SHARED_RUNTIME_NOT_READY');
      return sharedRuntime.source.flush();
    }
    if (window.shiyeQQRebuild?.active) {
      await assetWriteQueue;
      await pinWriteQueue;
      return window.shiyeQQRebuild.flush();
    }
    await assetWriteQueue;
    await ensureTransport();
    await ensurePreferences();
    await pinWriteQueue;
    await assetWriteQueue;
    const leavingRoom = currentId();
    if (leavingRoom) await ensureChatProjection(leavingRoom);
    const input = document.querySelector('#editable-message-text');
    // Tiptap serializes real paragraph/hardBreak nodes. DOM textContent drops <br>,
    // while innerText includes ProseMirror's presentation-only trailingBreak.
    if (leavingRoom && input && !input.editor?.getText)
      throw new Error('暂时无法确认草稿正文，请重试');
    // The existing hook schedules draft state through the shared measure queue.
    // Cross two animation boundaries, then require the actual API ACK state and worker transaction queue.
    const expectedText = leavingRoom && input ? input.editor.getText({ blockSeparator: '\n' }) : '';
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const start = performance.now();
    while (true) {
      window.dispatchEvent(new Event('shiye-flush-draft'));
      const global = window.getGlobal?.();
      const branches = global?.messages?.byChatId || {};
      let pendingWrite = false;
      for (const data of Object.values(branches)) {
        for (const message of Object.values(data.byId || {}))
          if (message.sendingState === 'messageSendingStatePending') pendingWrite = true;
      }
      let draftMatches = !leavingRoom;
      if (leavingRoom) {
        const stored = await new Promise((resolve, reject) => {
          const request = indexedDB.open('shiye-android-telegram-v2', 1);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const read = db.transaction('preview').objectStore('preview').get('library');
            read.onsuccess = () => {
              db.close();
              const dialog = [
                ...(read.result?.dialogs.active || []),
                ...(read.result?.dialogs.archived || []),
              ].find((item) => item.id === leavingRoom);
              resolve(dialog?.draft?.message || '');
            };
            read.onerror = () => {
              db.close();
              reject(read.error);
            };
          };
        });
        draftMatches = stored === expectedText;
      }
      if (!pendingWrite && draftMatches) break;
      if (performance.now() - start > 10000) throw new Error('消息或草稿尚未得到本地保存确认');
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    await pinWriteQueue;
    await assetWriteQueue;
    const receipt = await command('flush');
    if (!receipt.flushed) throw new Error('本地事务未确认');
    return { flushed: true, storage: 'indexeddb-only', draftChars: expectedText.length };
  }
  window.shiyeAndroidChat = {
    version: 'android-web-a-v2',
    command,
    openRoom,
    currentId,
    get ready() {
      return (
        (sharedRuntime || transportReady) &&
        preferencesReady &&
        qqReady &&
        !!window.shiyeQQRebuild &&
        !!document.querySelector('#LeftMainHeader')
      );
    },
    flush,
    dismissForModuleChange,
    refresh: () => refreshLocalList(),
    reloadListWallpaperVisual,
    resume() {
      reloadListWallpaperVisual().catch(() => {});
      return refreshLocalList({ silent: true }).then(() => ({
        resumed: true,
        refreshed: true,
        roomId: currentId() || null,
      }));
    },
    togglePin,
    pinIds: () => [...pinIds],
    snapshot() {
      return {
        version: this.version,
        ready: this.ready,
        transportReady,
        preferencesReady,
        sharedModeRequested,
        sharedRuntimeReady: !!sharedRuntime,
        localInputReady,
        uiReady: !!document.querySelector('#LeftMainHeader'),
        roomId: currentId() || null,
        inConversation: !!currentId(),
        messages: document.querySelectorAll('.Message').length,
        composer: !!document.querySelector('#editable-message-text'),
        offline: !sharedModeRequested,
        storage: sharedModeRequested ? 'shared-inbox-outbox' : 'indexeddb-only',
        preferenceStorage: 'native',
        independentChat: window.shiyeQQRebuild?.snapshot() || null,
        initialization: { qqReady, qqFailure, localInputReady, optionalInputFailure },
      };
    },
    back() {
      if (window.shiyeQQRebuild?.back()) return true;
      const metadata = document.querySelector('.shiye-sticker-metadata[open]');
      if (metadata) {
        metadata.close();
        return true;
      }
      const viewer = mediaViewer();
      if (viewer) {
        if (viewer.matches('.shiye-local-image-viewer')) {
          viewer.close();
          return true;
        }
        const backdrop = viewer.querySelector('.Menu .backdrop, .ContextMenu .backdrop');
        if (backdrop)
          document.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }),
          );
        else
          clickFirst(
            '#MediaViewer .media-viewer-close, #MediaViewer button[aria-label="Close"], .MediaViewer .close',
          );
        // Consume return even while a closing animation is still visible.
        return true;
      }
      const stickerManager = document.querySelector('.shiye-sticker-panel-manager[open]');
      if (stickerManager) {
        stickerManager.close();
        return true;
      }
      const symbols = document.querySelector('.shiye-symbol-dialog[open]');
      if (symbols) {
        symbols.close();
        return true;
      }
      const modal = document.querySelector('.shiye-android-dialog[open]');
      if (modal) {
        modal.__back = !!modal.__parent;
        modal.close();
        return true;
      }
      if (window.shiyeQQRebuild?.active && currentId()) {
        closeConversation();
        return true;
      }
      if (
        clickFirst(
          '.media-viewer-close, #MediaViewer .close, .MediaViewer .close, #MediaViewer button[aria-label="Close"], .media-viewer-header button[aria-label="Close"]',
        )
      )
        return true;
      if (document.querySelector('.Menu.open, .Modal.open, .ContextMenu.open')) {
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }),
        );
        return true;
      }
      if (
        clickFirst(
          '.embedded-cancel, .embedded-message .cancel, .Composer .cancel-button, .composer .cancel-button',
        )
      )
        return true;
      if (clickFirst('#MiddleColumn .back-button button')) return true;
      if (currentId()) {
        closeConversation();
        return true;
      }
      return false;
    },
  };
  ensurePreferences().catch(() => {});
  scheduleShell();
})();
