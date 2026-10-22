/* Local room identity, wallpaper and keyboard navigation. */
(() => {
  const ui = window.shiyeRoomUi;
  let rooms = [];
  let activeId;
  let composing = false;
  let compositionUntil = 0;
  let switching = Promise.resolve();
  const switchModeKey = 'shiye-room-switch-mode-v1';
  const enterArrowsKey = 'shiye-room-enter-arrows-v1';
  function horizontalEnterKey(key) {
    const mode = localStorage.getItem(enterArrowsKey) || 'both';
    return (
      (key === 'ArrowLeft' && ['left', 'both'].includes(mode)) ||
      (key === 'ArrowRight' && ['right', 'both'].includes(mode))
    );
  }
  const sidebarMigrationKey = 'shiye-room-switch-sidebar-v1';
  const switchModes = ['sidebar', 'direct', 'list', 'manual'];
  if (!localStorage.getItem(sidebarMigrationKey)) {
    const previousMode = localStorage.getItem(switchModeKey);
    localStorage.setItem(
      sidebarMigrationKey,
      JSON.stringify({
        previousMode,
        effectivePreviousMode: switchModes.includes(previousMode) ? previousMode : 'direct',
      }),
    );
    localStorage.setItem(switchModeKey, 'sidebar');
  }
  let sidebarFocusRequest = 0;
  let sidebarTargetId;
  const images = new Map();
  const retiredUrls = new Set();
  const avatarEdge = 192;
  let imagesGeneration = 0;
  const avatarStyle = document.createElement('style');
  avatarStyle.id = 'shiye-room-avatars';
  document.head.append(avatarStyle);
  const stateStyle = document.createElement('style');
  stateStyle.id = 'shiye-room-state-styles';
  document.head.append(stateStyle);

  function paintRoomState() {
    stateStyle.textContent = rooms
      .filter((room) => room.isPinned && !room.isArchived)
      .map((room) => {
        const selector = `#LeftColumn .ListItem.Chat:has(.Avatar[data-peer-id="${CSS.escape(room.id)}"])`;
        return `${selector}{--shiye-pinned-room:1;--shiye-sidebar-row-background:var(--shiye-pinned-background);--shiye-sidebar-row-hover:var(--shiye-pinned-hover)}`;
      })
      .join('\n');
  }

  async function changeRoomState(room, fields) {
    if (fields.isArchived && ui.currentId() === room.id) {
      await new Promise((resolve, reject) =>
        window.dispatchEvent(
          new CustomEvent('shiye-prepare-room-archive', {
            detail: { id: room.id, resolve, reject },
          }),
        ),
      );
      await ui.command('flush');
    }
    await ui.command('set-state', { id: room.id, ...fields });
    const next =
      fields.isArchived && ui.currentId() === room.id ? orderedRooms()[0]?.id : undefined;
    window.dispatchEvent(new CustomEvent('shiye-refresh-rooms', { detail: {} }));
    if (fields.isArchived && ui.currentId() === room.id) {
      window.dispatchEvent(new CustomEvent('shiye-open-room', { detail: { id: next } }));
    }
  }

  async function openRoomManagement(requestedId) {
    return openNavigation(requestedId);
  }

  function isSystemRoom(room) {
    return room.program === 'revisit' || room.id === '-900000001';
  }

  function mountRoomManagement(element, requestedId) {
    let archived = Boolean(rooms.find((room) => room.id === requestedId)?.isArchived);
    let busy = false;
    const list = element.querySelector('.shiye-room-management-list');
    const status = element.querySelector('[data-management-status]');
    async function update(room, fields) {
      if (busy) return;
      busy = true;
      render();
      status.textContent = '正在保存…';
      try {
        await changeRoomState(room, fields);
        status.textContent = '已保存';
      } catch (error) {
        status.textContent = error.message;
      } finally {
        busy = false;
        render();
        element.refreshRoomOrder?.();
      }
    }
    function render() {
      list.replaceChildren();
      for (const tab of element.querySelectorAll('[data-room-tab]')) {
        tab.setAttribute('aria-pressed', String((tab.dataset.roomTab === 'archived') === archived));
        tab.disabled = busy;
      }
      element.querySelector('[data-create-room]').disabled = busy;
      const shown = archived ? rooms.filter((room) => room.isArchived) : orderedRooms();
      if (!shown.length) {
        const empty = document.createElement('p');
        empty.textContent = archived ? '没有已归档会话' : '还没有会话，点击“新增会话”开始';
        list.append(empty);
      }
      for (const room of shown) {
        const row = document.createElement('div');
        row.className = 'shiye-managed-room';
        row.dataset.roomId = room.id;
        if (room.isPinned) row.classList.add('is-pinned');
        const name = document.createElement('button');
        name.type = 'button';
        name.className = 'shiye-managed-room-name';
        name.textContent = room.title;
        name.title = '打开' + room.title + '的对话设置';
        name.disabled = busy;
        name.onclick = () =>
          window.dispatchEvent(new CustomEvent('shiye-edit-room', { detail: { id: room.id } }));
        row.append(name);
        const actions = document.createElement('div');
        actions.className = 'shiye-managed-room-actions';
        for (const [text, fields] of [
          [room.isPinned ? '取消置顶' : '置顶', { isPinned: !room.isPinned }],
          [archived ? '恢复' : '归档', { isArchived: !archived }],
        ]) {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = text;
          button.disabled = busy || ('isArchived' in fields && isSystemRoom(room));
          button.onclick = () => update(room, fields);
          if ('isArchived' in fields && isSystemRoom(room))
            button.title = '朝花夕拾系统会话，请在朝花夕拾设置管理推送';
          actions.append(button);
        }
        row.append(actions);
        list.append(row);
      }
    }
    element.querySelector('[data-create-room]').onclick = () =>
      window.dispatchEvent(new Event('shiye-new-topic'));
    for (const tab of element.querySelectorAll('[data-room-tab]'))
      tab.onclick = () => {
        archived = tab.dataset.roomTab === 'archived';
        render();
      };
    element.settingsShowRoom = (id) => {
      archived = Boolean(rooms.find((room) => room.id === id)?.isArchived);
      render();
      list
        .querySelector(`[data-room-id="${CSS.escape(id)}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    };
    const refresh = () => {
      if (!busy) {
        render();
        element.refreshRoomOrder?.();
      }
    };
    window.addEventListener('shiye-rooms-changed', refresh);
    element.addEventListener(
      'close',
      () => window.removeEventListener('shiye-rooms-changed', refresh),
      { once: true },
    );
    render();
    return render;
  }

  window.addEventListener('shiye-room-state-controls', ({ detail }) => {
    const { form, room } = detail;
    if (!room) return;
    form.dataset.stateRoomId = room.id;
    let section = form.querySelector('.shiye-room-state-controls');
    if (!section) {
      section = document.createElement('fieldset');
      section.className = 'shiye-room-state-controls';
      const container = form.querySelector('.shiye-room-settings-parameters') || form;
      container.prepend(section);
    }
    let busy = false;
    function render() {
      const current = rooms.find((item) => item.id === form.dataset.stateRoomId) || room;
      section.innerHTML =
        '<legend>会话状态</legend><div class="shiye-managed-room-actions"><button type="button" data-room-pin></button><button type="button" data-room-archive></button></div><p role="status"></p>';
      const pin = section.querySelector('[data-room-pin]');
      const archive = section.querySelector('[data-room-archive]');
      pin.textContent = current.isPinned ? '取消置顶' : '置顶会话';
      archive.textContent = current.isArchived ? '恢复会话' : '归档会话';
      pin.disabled = busy;
      archive.disabled = busy || isSystemRoom(current);
      if (isSystemRoom(current))
        section.querySelector('[role=status]').textContent =
          '朝花夕拾系统会话，推送在朝花夕拾设置管理。';
      else
        section.querySelector('[role=status]').textContent = current.isArchived
          ? '已归档，消息和草稿保留；恢复后可继续使用。'
          : '归档后退出普通列表，消息、草稿和已归篇日记保留。';
      async function update(fields) {
        if (busy) return;
        busy = true;
        render();
        try {
          await changeRoomState(current, fields);
          render();
        } catch (error) {
          section.querySelector('[role=status]').textContent = error.message;
        } finally {
          busy = false;
          pin.disabled = false;
          archive.disabled = isSystemRoom(current);
          for (const button of section.querySelectorAll('button'))
            button.disabled = button.matches('[data-room-archive]') && isSystemRoom(current);
        }
      }
      pin.onclick = () => update({ isPinned: !current.isPinned });
      archive.onclick = () => update({ isArchived: !current.isArchived });
    }
    render();
    const dialog = form.closest('dialog');
    if (dialog && !form.dataset.stateResumeBound) {
      form.dataset.stateResumeBound = 'true';
      const resume = dialog.settingsResume;
      dialog.settingsResume = () => {
        resume?.();
        const selected = rooms.find((item) => item.id === form.dataset.stateRoomId);
        if (selected)
          window.dispatchEvent(
            new CustomEvent('shiye-room-state-controls', { detail: { form, room: selected } }),
          );
      };
    }
  });
  window.addEventListener('shiye-manage-rooms', ({ detail }) => openRoomManagement(detail?.id));
  document.addEventListener(
    'contextmenu',
    (event) => {
      const row = event.target.closest?.('#LeftColumn .ListItem.Chat');
      const id = row?.querySelector('.Avatar[data-peer-id]')?.dataset.peerId;
      if (!rooms.some((room) => room.id === id)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      window.dispatchEvent(new CustomEvent('shiye-edit-room', { detail: { id } }));
    },
    true,
  );
  for (const type of ['shiye-open-room', 'shiye-focus-message'])
    window.addEventListener(
      type,
      (event) => {
        const id = event.detail?.id || event.detail?.chatId;
        if (!rooms.find((room) => room.id === id)?.isArchived) return;
        event.stopImmediatePropagation();
        navigationStatus('此会话已归档，请在会话管理中恢复后进入');
        openRoomManagement(id);
      },
      true,
    );
  async function validateImage(file) {
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type))
      throw Error('请选择 PNG、JPEG、WebP 或 GIF 图片');
    const bitmap = await createImageBitmap(file);
    bitmap.close();
  }
  function imageUrls(image) {
    return new Set([image?.wallpaperUrl, image?.avatarUrl].filter(Boolean));
  }
  function releaseImage(image) {
    for (const url of imageUrls(image)) URL.revokeObjectURL(url);
  }
  function releaseRetiredUrl(url) {
    if (!retiredUrls.has(url)) return;
    if (
      avatarStyle.textContent.includes(url) ||
      document.body.style.getPropertyValue('--shiye-wallpaper').includes(url) ||
      [...document.images].some(
        (image) =>
          image.getAttribute('src') === url &&
          !image.hidden &&
          !image.closest('dialog:not([open])'),
      )
    ) {
      setTimeout(() => releaseRetiredUrl(url), 1000);
      return;
    }
    retiredUrls.delete(url);
    URL.revokeObjectURL(url);
  }
  function retireImage(image) {
    for (const url of imageUrls(image)) {
      if (retiredUrls.has(url)) continue;
      retiredUrls.add(url);
      // An open wallpaper preview can still be displaying the old source.
      setTimeout(() => releaseRetiredUrl(url), 1000);
    }
  }
  async function avatarThumbnail(blob, assetId, generation) {
    const bitmap = await createImageBitmap(blob);
    let canvas;
    try {
      // A directory bitmap may finish after refresh or pagehide released its owner.
      if (generation !== imagesGeneration) return undefined;
      seedWallpaperPreview(assetId, bitmap, generation);
      canvas = document.createElement('canvas');
      canvas.width = avatarEdge;
      canvas.height = avatarEdge;
      const context = canvas.getContext('2d', { alpha: true });
      if (!context) return undefined;
      const scale = Math.max(avatarEdge / bitmap.width, avatarEdge / bitmap.height);
      const width = bitmap.width * scale;
      const height = bitmap.height * scale;
      context.drawImage(bitmap, (avatarEdge - width) / 2, (avatarEdge - height) / 2, width, height);
      return await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85));
    } catch {
      // Keep the original as the avatar if this WebView cannot encode a thumbnail.
      return undefined;
    } finally {
      bitmap.close();
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
    }
  }
  // Active CSS backgrounds do not wait for the serial directory/avatar pipeline.
  // Keep at most the active and one recently used decoded source, never room DOM.
  const wallpapers = new Map();
  const wallpaperCacheLimit = 2;
  const wallpaperCacheBytes = 32 * 1024 * 1024;
  let wallpaperRequest = 0;
  let activeWallpaperAssetId;
  // Reuse the bitmap already decoded for the directory, preserving the original
  // aspect ratio. Four <=256px previews cost <=1MiB estimated RGBA in total.
  const wallpaperPreviews = new Map();
  function releaseWallpaperPreview(entry) {
    entry.cancelled = true;
    entry.image?.removeAttribute('src');
    if (entry.url) URL.revokeObjectURL(entry.url);
  }
  function pruneWallpaperPreviews() {
    const live = new Set(rooms.map((room) => room.wallpaperAssetId).filter(Boolean));
    for (const [assetId, entry] of wallpaperPreviews) {
      if (!live.has(assetId)) { wallpaperPreviews.delete(assetId); releaseWallpaperPreview(entry); }
    }
    while (wallpaperPreviews.size > 4) {
      const id = [...wallpaperPreviews.keys()].find((id) => id !== activeWallpaperAssetId);
      if (id === undefined) break;
      const entry = wallpaperPreviews.get(id);
      wallpaperPreviews.delete(id);
      releaseWallpaperPreview(entry);
    }
  }
  function seedWallpaperPreview(assetId, bitmap, generation) {
    if (generation !== imagesGeneration || !assetId || wallpaperPreviews.has(assetId) ||
        !rooms.some((room) => room.wallpaperAssetId === assetId)) return;
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const entry = { ready: false, cancelled: false };
    wallpaperPreviews.set(assetId, entry);
    pruneWallpaperPreviews();
    entry.promise = (async () => {
      try {
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.7));
        if (!blob || entry.cancelled) return;
        entry.url = URL.createObjectURL(blob);
        entry.image = new Image();
        entry.image.src = entry.url;
        await entry.image.decode();
        if (!entry.cancelled) entry.ready = true;
      } catch {
        if (wallpaperPreviews.get(assetId) === entry) wallpaperPreviews.delete(assetId);
        releaseWallpaperPreview(entry);
      } finally {
        canvas.width = canvas.height = 0;
        entry.settled = true;
        if (!entry.ready && wallpaperPreviews.get(assetId) === entry) {
          wallpaperPreviews.delete(assetId);
          releaseWallpaperPreview(entry);
        }
        if (wallpaperTarget?.assetId === assetId) wallpaperTarget.notifyVisualReady();
      }
    })();
  }
  function releaseWallpaper(entry) {
    entry.cancelled = true;
    if (entry.image) entry.image.removeAttribute('src');
    entry.image = undefined;
    if (entry.url) URL.revokeObjectURL(entry.url);
    entry.url = undefined;
  }
  function pruneWallpapers() {
    pruneWallpaperPreviews();
    const live = new Set(rooms.map((room) => room.wallpaperAssetId).filter(Boolean));
    for (const [assetId, entry] of wallpapers) {
      if (!live.has(assetId)) {
        wallpapers.delete(assetId);
        releaseWallpaper(entry);
      }
    }
    const decodedBytes = () => [...wallpapers.values()].reduce((sum, entry) => sum + (entry.bytes || 0), 0);
    // A single oversized active source is required for display; it evicts every other decoded entry.
    while (wallpapers.size > wallpaperCacheLimit || decodedBytes() > wallpaperCacheBytes) {
      const obsolete = [...wallpapers.keys()].find((id) => id !== activeWallpaperAssetId);
      if (obsolete === undefined) break;
      const entry = wallpapers.get(obsolete);
      wallpapers.delete(obsolete);
      releaseWallpaper(entry);
    }
  }
  function prepareWallpaper(assetId) {
    let entry = wallpapers.get(assetId);
    if (entry) {
      wallpapers.delete(assetId);
      wallpapers.set(assetId, entry);
      return entry;
    }
    entry = { assetId, ready: false, cancelled: false };
    wallpapers.set(assetId, entry);
    pruneWallpapers();
    entry.promise = (async () => {
      try {
        const asset = await window.shiyeLocalAssets.get(assetId);
        if (entry.cancelled) return undefined;
        if (!asset?.blob) throw Error('Wallpaper is not available locally');
        entry.url = URL.createObjectURL(asset.blob);
        const image = new Image();
        entry.image = image;
        image.src = entry.url;
        await image.decode();
        if (entry.cancelled) return undefined;
        entry.ready = true;
        entry.bytes = image.naturalWidth * image.naturalHeight * 4;
        pruneWallpapers();
        return entry;
      } catch {
        if (wallpapers.get(assetId) === entry) wallpapers.delete(assetId);
        releaseWallpaper(entry);
        // A missing/corrupt source keeps the ordinary appearance and can retry on refresh.
        return undefined;
      }
    })();
    return entry;
  }
  async function loadImages() {
    const generation = ++imagesGeneration;
    const nextRooms = [...rooms];
    const next = new Map();
    const created = [];
    for (const room of nextRooms) {
      const previous = images.get(room.id);
      if (previous?.assetId === room.wallpaperAssetId) {
        next.set(room.id, previous);
        continue;
      }
      let asset;
      try {
        asset = room.wallpaperAssetId
          ? await window.shiyeLocalAssets.get(room.wallpaperAssetId)
          : undefined;
      } catch {
        // Keep the displayed image and retry on the next room refresh.
        if (previous) next.set(room.id, previous);
        continue;
      }
      if (generation !== imagesGeneration) {
        created.forEach(releaseImage);
        return;
      }
      const image = { assetId: room.wallpaperAssetId };
      if (asset?.blob) {
        try {
          // A corrupt image uses the ordinary room appearance instead of a broken CSS URL.
          const thumbnail = await avatarThumbnail(asset.blob, room.wallpaperAssetId, generation);
          if (generation !== imagesGeneration) {
            created.forEach(releaseImage);
            return;
          }
          image.wallpaperUrl = URL.createObjectURL(asset.blob);
          try {
            image.avatarUrl = thumbnail ? URL.createObjectURL(thumbnail) : image.wallpaperUrl;
          } catch {
            image.avatarUrl = image.wallpaperUrl;
          }
        } catch {
          // A corrupt source uses the ordinary appearance; its original stays in local storage.
        }
      }
      next.set(room.id, image);
      created.push(image);
    }
    if (generation !== imagesGeneration) {
      created.forEach(releaseImage);
      return;
    }
    const obsolete = [...images].filter(([id, image]) => next.get(id) !== image);
    images.clear();
    for (const [id, image] of next) images.set(id, image);
    avatarStyle.textContent = nextRooms
      .filter((room) => images.get(room.id)?.avatarUrl)
      .map((room) => {
        const selector = `#LeftColumn .Avatar[data-peer-id="${CSS.escape(room.id)}"]`;
        return `${selector}{background-image:url("${images.get(room.id).avatarUrl}");background-size:cover;background-position:center}${selector}>.inner{visibility:hidden}`;
      })
      .join('\n');
    updateActiveRoom();
    for (const [, image] of obsolete) retireImage(image);
  }
  let wallpaperTarget;
  function prepareActiveWallpaper() {
    const id = ui.currentId();
    const assetId = rooms.find((room) => room.id === id)?.wallpaperAssetId;
    activeWallpaperAssetId = assetId;
    if (id && wallpaperTarget && wallpaperTarget.id === id && wallpaperTarget.assetId === assetId) return wallpaperTarget;
    wallpaperTarget?.invalidate();
    const request = ++wallpaperRequest;
    const entry = assetId ? prepareWallpaper(assetId) : undefined;
    let invalidate, resolveVisual;
    const visualReady = new Promise((resolve) => { resolveVisual = resolve; });
    const preview = () => wallpaperPreviews.get(assetId);
    const target = {
      id, assetId,
      ready: Promise.race([
        visualReady,
        new Promise((resolve) => { invalidate = resolve; }),
      ]),
      invalidate: () => invalidate(),
      get isReady() { return !entry || entry.ready || preview()?.ready || target.phase; },
      notifyVisualReady() {
        const small = preview();
        if (target.isReady || (target.fullSettled && (!small || small.settled))) resolveVisual();
        const pending = document.body.dataset.shiyeRoomPending;
        if (target.isReady && (!pending || pending.startsWith(id + '_'))) target.commit();
      },
      commit(fallback = false) {
        if (request !== wallpaperRequest || ui.currentId() !== id ||
            rooms.find((room) => room.id === id)?.wallpaperAssetId !== assetId) return false;
        document.body.dataset.shiyeRoomBackgroundReady = id;
        if (target.phase === 'fallback' || target.phase === 'full') return true;
        const small = preview();
        const displayed = !fallback && (entry?.ready && !entry.cancelled ? entry
          : small?.ready && !small.cancelled ? small : undefined);
        if (displayed) {
          document.body.dataset.shiyeRoomWallpaper = id;
          document.body.style.setProperty('--shiye-wallpaper', 'url("' + displayed.url + '")');
          target.phase = displayed === entry ? 'full' : 'preview';
        } else {
          delete document.body.dataset.shiyeRoomWallpaper;
          target.phase = 'fallback';
        }
        target.failed = Boolean(assetId) && (target.phase === 'fallback' ||
          (target.fullSettled && !entry?.ready));
        document.body.dataset.shiyeWallpaperStage = target.phase;
        ui.restoreDefaultWallpaper();
        return true;
      },
    };
    if (entry) entry.promise.then(() => {
      target.fullSettled = true;
      target.notifyVisualReady();
    });
    preview()?.promise?.then(() => target.notifyVisualReady());
    target.notifyVisualReady();
    wallpaperTarget = target;
    return target;
  }
  function updateActiveRoom(retry = false) {
    const id = ui.currentId();
    activeId = id;
    if (!id) return; // Keep the current surface until a real room context exists.
    if (rooms.find((room) => room.id === id)?.isArchived) {
      window.dispatchEvent(
        new CustomEvent('shiye-open-room', { detail: { id: orderedRooms()[0]?.id } }),
      );
      return;
    }
    if (retry === true && wallpaperTarget?.failed) {
      wallpaperTarget.invalidate();
      wallpaperTarget = undefined;
    }
    const target = prepareActiveWallpaper();
    // Decoded target backgrounds may appear before its messages. Pending still
    // hides every old list/footer, so this cannot mix an old room with the new image.
    const commit = () => {
      const pending = document.body.dataset.shiyeRoomPending;
      if (!pending || pending.startsWith(`${id}_`)) target.commit();
    };
    if (target.isReady) commit();
    else target.ready.then(commit);
  }
  let scheduled = false;
  new MutationObserver((records) => {
    if (records.some((record) => record.type === 'attributes' && record.target === document.body) &&
        document.body.dataset.shiyeRoomPending?.startsWith(ui.currentId() + '_')) {
      updateActiveRoom();
    }
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      if (ui.currentId() !== activeId) updateActiveRoom();
    });
  }).observe(document.body, { childList: true, subtree: true, attributes: true,
    attributeFilter: ['data-shiye-room-pending'] });
  window.addEventListener('hashchange', updateActiveRoom);
  window.addEventListener('shiye-room-switch-start', () => {
    delete document.body.dataset.shiyeRoomBackgroundReady;
  });
  window.addEventListener('shiye-room-view-prepare', ({ detail }) => {
    const id = ui.currentId();
    if (id && detail?.key?.startsWith(`${id}_`)) {
      activeId = id;
      const target = prepareActiveWallpaper();
      if (typeof detail.waitUntil === 'function') {
        detail.waitUntil(target.isReady ? undefined : target.ready, target.commit);
      }
      else updateActiveRoom();
    }
  });
  window.addEventListener('shiye-rooms-changed', ({ detail }) => {
    rooms = detail;
    paintRoomState();
    updateActiveRoom(true);
    pruneWallpapers();
    loadImages().catch(() => {});
  });
  window.addEventListener('pagehide', () => {
    ++wallpaperRequest;
    wallpaperTarget?.invalidate();
    wallpaperTarget = undefined;
    ++imagesGeneration;
    avatarStyle.textContent = '';
    delete document.body.dataset.shiyeRoomWallpaper;
    delete document.body.dataset.shiyeRoomBackgroundReady;
    document.body.style.removeProperty('--shiye-wallpaper');
    for (const entry of wallpapers.values()) releaseWallpaper(entry);
    wallpapers.clear();
    for (const entry of wallpaperPreviews.values()) releaseWallpaperPreview(entry);
    wallpaperPreviews.clear();
    delete document.body.dataset.shiyeWallpaperStage;
    for (const image of images.values()) releaseImage(image);
    images.clear();
    for (const url of retiredUrls) URL.revokeObjectURL(url);
    retiredUrls.clear();
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      updateActiveRoom();
      loadImages().catch(() => {});
    }
  });
  async function initialize() {
    try {
      await ui.command('list');
    } catch {
      setTimeout(initialize, 1000);
    }
  }
  initialize();
  function orderedRooms() {
    let ids = [];
    window.dispatchEvent(
      new CustomEvent('shiye-room-order', {
        detail: {
          receive(value) {
            ids = value;
          },
        },
      }),
    );
    let preferred = [];
    try {
      preferred = JSON.parse(localStorage.getItem('shiye-room-order-v1') || '[]');
    } catch {
      /* Ordinary order. */
    }
    const unique = [
      ...new Set([
        ...(Array.isArray(preferred) ? preferred.filter((id) => typeof id === 'string') : []),
        ...ids,
      ]),
    ];
    return [
      ...unique.map((id) => rooms.find((room) => room.id === id)).filter(Boolean),
      ...rooms.filter((room) => !unique.includes(room.id)),
    ]
      .filter((room) => !room.isArchived)
      .sort((a, b) => Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned)));
  }
  function switchTo(id) {
    if (!id) return;
    return (switching = switching
      .catch(() => {})
      .then(async () => {
        if (ui.currentId() !== id) {
          window.dispatchEvent(new Event('shiye-flush-draft'));
          await new Promise((resolve) => setTimeout(resolve, 100));
          await ui.command('flush');
          window.dispatchEvent(new CustomEvent('shiye-open-room', { detail: { id } }));
        }
        for (let attempt = 0; ui.currentId() !== id && attempt < 30; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        updateActiveRoom();
        window.dispatchEvent(new Event('shiye-hotkey-resume'));
      })
      .catch((error) => {
        navigationStatus('切换未完成：' + error.message);
      }));
  }
  let directTarget;
  function navigationStatus(text) {
    const status = document.createElement('div');
    status.className = 'shiye-ui-status';
    status.setAttribute('role', 'status');
    status.textContent = text;
    document.body.append(status);
    setTimeout(() => status.remove(), 1800);
  }
  function navigationMode() {
    const mode = localStorage.getItem(switchModeKey);
    return switchModes.includes(mode) ? mode : 'sidebar';
  }
  function sidebarEntries() {
    return [...document.querySelectorAll('#LeftColumn .ListItem.Chat .ListItem-button')]
      .map((button) => ({
        button,
        id:
          button.querySelector('.shiye-room-settings[data-room-id]')?.dataset.roomId ||
          button.querySelector('.Avatar[data-peer-id]')?.dataset.peerId,
      }))
      .filter(({ id, button }) => id && button.getAttribute('aria-disabled') !== 'true');
  }
  function requestSidebar(collapsed, focusCurrent = false) {
    window.dispatchEvent(
      new CustomEvent('shiye-set-sidebar', { detail: { collapsed, focusCurrent } }),
    );
  }
  document.addEventListener(
    'click',
    (event) => {
      if (
        document.body.dataset.shiyeSidebar !== 'expanded' ||
        event.target.closest?.('#LeftColumn, .shiye-toggle-topics, .shiye-sidebar-fallback, .shiye-settings-dialog')
      )
        return;
      // Finish the clicked control's own event before changing the page geometry.
      queueMicrotask(() => {
        if (document.body.dataset.shiyeSidebar === 'expanded' && !window.shiyeSettingsUi.active())
          requestSidebar(true);
      });
    },
    true,
  );
  function focusSidebarRoom(id) {
    const request = ++sidebarFocusRequest;
    sidebarTargetId = id;
    let attempts = 0;
    function focus() {
      if (request !== sidebarFocusRequest || document.body.dataset.shiyeSidebar !== 'expanded')
        return;
      if (
        composing ||
        document.querySelector(
          'dialog[open], .Modal.open, #MediaViewer, #shiye-commands, .Menu .bubble.open',
        )
      )
        return;
      const entries = sidebarEntries();
      const entry = entries.find((item) => item.id === id) || (!id && entries[0]);
      if (entry) {
        sidebarTargetId = entry.id;
        entry.button.focus({ preventScroll: true });
        entry.button.scrollIntoView({ block: 'nearest' });
        return;
      }
      if (++attempts > 20) return;
      // The pinned client virtualizes long lists. Scroll its existing list to mount the target.
      const index = orderedRooms().findIndex((room) => room.id === id);
      const list = document.querySelector('#LeftColumn .chat-list.custom-scroll');
      if (list && index >= 0) {
        const height = entries[0]?.button.closest('.ListItem').getBoundingClientRect().height || 72;
        list.scrollTop = index * height;
        list.dispatchEvent(new Event('scroll'));
      }
      setTimeout(focus, 50);
    }
    focus();
  }
  window.addEventListener('shiye-sidebar-changed', ({ detail }) => {
    ++sidebarFocusRequest;
    sidebarTargetId = undefined;
    if (detail.collapsed) {
      if (document.activeElement?.closest?.('#LeftColumn'))
        document.querySelector('#editable-message-text')?.focus({ preventScroll: true });
    } else if (detail.focusCurrent) {
      focusSidebarRoom(ui.currentId());
    }
  });
  document.addEventListener('focusin', (event) => {
    const entry = sidebarEntries().find(({ button }) => button === event.target);
    if (entry) sidebarTargetId = entry.id;
  });
  for (const type of ['pointerdown', 'keydown', 'input', 'compositionstart'])
    document.addEventListener(type, () => ++sidebarFocusRequest, true);
  function directNext() {
    const list = orderedRooms();
    if (!list.length) {
      ui.command('list')
        .then(() => {
          if (rooms.length) directNext();
          else navigationStatus('还没有对话，请先新建对话');
        })
        .catch((error) => navigationStatus(error.message));
      return;
    }
    const index = list.findIndex((room) => room.id === (directTarget || ui.currentId()));
    const next = list[(index + 1 + list.length) % list.length];
    directTarget = next.id;
    switchTo(next.id).finally(() => {
      if (directTarget === next.id) directTarget = undefined;
    });
  }
  async function openNavigation(requestedId) {
    const parent = window.shiyeSettingsUi.active();
    await ui.command('list');
    if (parent && !parent.isConnected) return;
    const element = window.shiyeSettingsUi.open({
      page: 'navigation',
      parent,
      title: '会话管理与排列',
      content:
        '<section class="shiye-room-management-section"><h3>会话</h3><div class="shiye-room-management-toolbar"><button type="button" data-create-room>＋ 新增会话</button><button type="button" data-room-tab="active" aria-pressed="true">使用中</button><button type="button" data-room-tab="archived" aria-pressed="false">已归档</button></div><div class="shiye-room-management-list"></div><p data-management-status role="status"></p></section><h3>切换与排列</h3><label>Esc切换方式<select data-switch-mode><option value="sidebar">会话侧栏，Esc展开／收起</option><option value="direct">立即切换到下一会话</option><option value="list">弹窗预选，停顿后进入</option><option value="manual">弹窗手选，方向键选择、Enter进入</option></select></label><p>四种方式使用下面的排列。默认Esc展开／收起原会话侧栏；展开时聚焦当前会话，方向键选择、Enter进入并收起。方向键只在会话列表中导航，输入时用于编辑文字。弹窗预选／手选仍可选，预选等待在外观设置中调整。</p><details class="shiye-room-order-details"><summary>调整手工顺序</summary><div class="shiye-room-order"></div><button data-reset-order>恢复默认排列</button></details><p role="status"></p>',
    });
    element.classList.add('shiye-navigation-settings');
    if (element.dataset.settingsRestored === 'true') {
      if (requestedId) element.settingsShowRoom?.(requestedId);
      return;
    }
    const renderManagement = mountRoomManagement(element, requestedId);
    const select = element.querySelector('[data-switch-mode]');
    const enterLabel = document.createElement('label');
    enterLabel.textContent = '列表中进入会话的方向键';
    const enterArrows = document.createElement('select');
    enterArrows.id = 'shiyeRoomEnterArrows';
    for (const [value, name] of [
      ['both', '左键或右键'],
      ['left', '仅左键'],
      ['right', '仅右键'],
      ['none', '关闭，仅用 Enter'],
    ])
      enterArrows.add(new Option(name, value));
    const storedArrows = localStorage.getItem(enterArrowsKey) || 'both';
    enterArrows.value = ['both', 'left', 'right', 'none'].includes(storedArrows)
      ? storedArrows
      : 'both';
    enterArrows.onchange = () => localStorage.setItem(enterArrowsKey, enterArrows.value);
    enterLabel.append(enterArrows);
    select.closest('label').after(enterLabel);
    const motionLabel = document.createElement('label');
    motionLabel.textContent = '侧栏过渡';
    const motion = document.createElement('select');
    motion.id = 'shiyeSidebarMotion';
    motion.add(new Option('流畅', 'smooth'));
    motion.add(new Option('立即', 'instant'));
    try {
      motion.value =
        localStorage.getItem('shiye-sidebar-motion') === 'instant' ? 'instant' : 'smooth';
    } catch {
      motion.value = document.body.dataset.shiyeSidebarMotion === 'instant' ? 'instant' : 'smooth';
    }
    motion.onchange = () => {
      try {
        localStorage.setItem('shiye-sidebar-motion', motion.value);
      } catch {
        /* Session preference still applies. */
      }
      window.dispatchEvent(
        new CustomEvent('shiye-sidebar-motion-changed', { detail: motion.value }),
      );
    };
    motionLabel.append(motion);
    select.closest('label').after(motionLabel);
    select.value = navigationMode();
    select.onchange = () => {
      localStorage.setItem(switchModeKey, select.value);
      element.querySelector('[role=status]').textContent = '切换方式已保存';
    };
    function saveOrder(ids) {
      localStorage.setItem('shiye-room-order-v1', JSON.stringify(ids));
      window.dispatchEvent(new Event('shiye-room-order-changed'));
      element.querySelector('[role=status]').textContent = '排列已保存';
      render();
    }
    function render() {
      const container = element.querySelector('.shiye-room-order');
      container.replaceChildren();
      const list = orderedRooms();
      list.forEach((room, index) => {
        const row = document.createElement('div');
        row.dataset.roomId = room.id;
        const label = document.createElement('span');
        label.textContent = room.title;
        row.append(label);
        for (const [step, title] of [
          [-1, '上移'],
          [1, '下移'],
        ]) {
          const button = document.createElement('button');
          button.textContent = title;
          button.setAttribute('aria-label', title + room.title);
          button.disabled = index + step < 0 || index + step >= list.length;
          button.onclick = () => {
            const ids = list.map((item) => item.id);
            [ids[index], ids[index + step]] = [ids[index + step], ids[index]];
            saveOrder(ids);
          };
          row.append(button);
        }
        container.append(row);
      });
    }
    element.querySelector('[data-reset-order]').onclick = () => {
      localStorage.removeItem('shiye-room-order-v1');
      window.dispatchEvent(new Event('shiye-room-order-changed'));
      render();
    };
    element.refreshRoomOrder = render;
    element.settingsResume = () => {
      renderManagement();
      select.value = navigationMode();
      try {
        motion.value =
          localStorage.getItem('shiye-sidebar-motion') === 'instant' ? 'instant' : 'smooth';
      } catch {
        motion.value =
          document.body.dataset.shiyeSidebarMotion === 'instant' ? 'instant' : 'smooth';
      }
      render();
    };
    render();
    select.focus();
  }
  window.addEventListener('shiye-open-navigation', () =>
    openNavigation().catch((error) => navigationStatus(error.message)),
  );
  function openSwitcher() {
    if (document.querySelector('.shiye-room-switcher[open]')) return;
    if (!rooms.length) {
      ui.command('list')
        .then(() => {
          if (rooms.length) openSwitcher();
        })
        .catch(() => {});
      return;
    }
    const list = orderedRooms();
    const element = document.createElement('dialog');
    element.className = 'shiye-dialog shiye-room-switcher';
    const manual = navigationMode() === 'manual';
    element.dataset.mode = manual ? 'manual' : 'list';
    element.setAttribute('data-stricterdom-ignore', '');
    element.innerHTML =
      '<header><h2>切换对话</h2><button aria-label="取消切换">×</button></header><div class="shiye-room-choices"></div><p>Esc / ↓ 下一项 · ↑ 上一项 · Enter 进入 · 停顿自动进入</p><div class="shiye-switch-progress"></div>';
    if (manual) element.querySelector('p').textContent = '↑ / ↓ 选择 · Enter 进入 · Esc 取消';
    const choices = element.querySelector('.shiye-room-choices');
    let index = Math.max(
      0,
      list.findIndex((room) => room.id === ui.currentId()),
    );
    let timer;
    let committed = false;
    const delay = window.shiyeSwitchDelay.get();
    function commit() {
      if (!element.open || committed || !document.hasFocus()) return;
      committed = true;
      const id = list[index].id;
      element.close();
      switchTo(id);
    }
    function arm() {
      clearTimeout(timer);
      if (manual) return;
      element.style.setProperty('--shiye-switch-delay', `${delay}ms`);
      element.classList.remove('counting');
      requestAnimationFrame(() => {
        if (element.open) element.classList.add('counting');
      });
      timer = setTimeout(commit, delay);
    }
    const buttons = list.map((room, i) => {
      const button = document.createElement('button');
      button.type = 'button';
      const image = images.get(room.id)?.url;
      if (image) {
        const avatar = document.createElement('img');
        avatar.src = image;
        avatar.alt = '';
        button.append(avatar);
      }
      const label = document.createElement('span');
      label.textContent = room.title;
      button.append(label);
      button.onclick = () => {
        index = i;
        commit();
      };
      button.onfocus = () => {
        index = i;
        buttons.forEach((item, j) => item.setAttribute('aria-current', String(i === j)));
      };
      choices.append(button);
      return button;
    });
    function select() {
      buttons.forEach((button, i) => button.setAttribute('aria-current', String(index === i)));
      buttons[index].focus();
      buttons[index].scrollIntoView({ block: 'nearest' });
    }
    element.querySelector('header button').onclick = () => element.close();
    function handleSwitchKey(event) {
      if (!element.open) return;
      if (event.isComposing || event.keyCode === 229 || composing) {
        clearTimeout(timer);
        return;
      }
      if (
        ['Escape', 'ArrowUp', 'ArrowDown', 'Enter'].includes(event.key) ||
        horizontalEnterKey(event.key)
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (manual && event.key === 'Escape') {
          element.close();
          return;
        }
        if (event.key === 'Enter' || horizontalEnterKey(event.key)) {
          if (event.target === element.querySelector('header button')) element.close();
          else commit();
          return;
        }
        index = (index + (event.key === 'ArrowUp' ? -1 : 1) + list.length) % list.length;
        select();
        arm();
      } else if (event.key === 'Tab') {
        clearTimeout(timer);
        element.classList.remove('counting');
      }
    }
    const pause = () => {
      clearTimeout(timer);
      element.classList.remove('counting');
    };
    window.addEventListener('keydown', handleSwitchKey, true);
    window.addEventListener('blur', pause);
    element.addEventListener('pointermove', arm);
    element.addEventListener('cancel', (event) => event.preventDefault());
    element.addEventListener(
      'close',
      () => {
        pause();
        window.removeEventListener('keydown', handleSwitchKey, true);
        window.removeEventListener('blur', pause);
        element.remove();
        document.querySelector('#editable-message-text')?.focus({ preventScroll: true });
      },
      { once: true },
    );
    document.body.append(element);
    element.showModal();
    select();
    arm();
  }
  document.addEventListener(
    'compositionstart',
    () => {
      composing = true;
    },
    true,
  );
  document.addEventListener(
    'compositionend',
    () => {
      composing = false;
      compositionUntil = Date.now() + 100;
    },
    true,
  );
  window.addEventListener(
    'keydown',
    (event) => {
      if (
        composing ||
        event.isComposing ||
        event.keyCode === 229 ||
        Date.now() < compositionUntil ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.shiftKey ||
        document.querySelector(
          'dialog[open], .Modal.open, #MediaViewer, #shiye-commands, .Menu .bubble.open',
        )
      )
        return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (navigationMode() === 'sidebar') {
          const collapsed = document.body.dataset.shiyeSidebar === 'collapsed';
          requestSidebar(!collapsed, collapsed);
        } else if (navigationMode() === 'direct') directNext();
        else openSwitcher();
      } else if (
        navigationMode() === 'sidebar' &&
        document.body.dataset.shiyeSidebar === 'expanded' &&
        (['ArrowUp', 'ArrowDown', 'Enter'].includes(event.key) || horizontalEnterKey(event.key))
      ) {
        const row = event.target.closest?.('#LeftColumn .ListItem.Chat .ListItem-button');
        if (!row || event.target !== row) return;
        const focused = sidebarEntries().find(({ button }) => button === row);
        if (!focused) return;
        const list = orderedRooms();
        if (!list.length) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.key === 'Enter' || horizontalEnterKey(event.key)) {
          requestSidebar(true);
          switchTo(focused.id);
        } else {
          const index = list.findIndex((room) => room.id === (sidebarTargetId || focused.id));
          const next =
            list[(index + (event.key === 'ArrowUp' ? -1 : 1) + list.length) % list.length];
          focusSidebarRoom(next.id);
        }
      }
    },
    true,
  );
  window.addEventListener('shiye-room-wallpaper-preview', ({ detail: { form, room } }) => {
    const input = form.elements.wallpaper;
    const preview = form.querySelector('.shiye-room-wallpaper-preview');
    let temporary;
    input.value = '';
    function show(url) {
      preview.hidden = !url;
      if (url) preview.src = url;
      else preview.removeAttribute('src');
    }
    show(images.get(room?.id)?.wallpaperUrl);
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) {
        show(images.get(room?.id)?.wallpaperUrl);
        if (temporary) URL.revokeObjectURL(temporary);
        temporary = undefined;
        return;
      }
      try {
        await validateImage(file);
        const next = URL.createObjectURL(file);
        show(next);
        if (temporary) URL.revokeObjectURL(temporary);
        temporary = next;
      } catch (error) {
        form.querySelector('.shiye-wallpaper-hint').textContent = error.message;
        input.value = '';
      }
    };
    function releaseTemporary() {
      show(undefined);
      if (temporary) URL.revokeObjectURL(temporary);
      temporary = undefined;
      window.removeEventListener('pagehide', releaseTemporary);
    }
    window.addEventListener('pagehide', releaseTemporary);
    form.closest('dialog')?.addEventListener('close', releaseTemporary, { once: true });
  });
  window.shiyeRoomWorkspace = { validateImage };
})();

