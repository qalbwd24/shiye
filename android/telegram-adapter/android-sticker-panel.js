/** Android view adapter over the existing shared picker and its original send handlers. */
const ORDER_KEY = 'view:sticker-panel-order:v1';
export function installAndroidStickerPanel(host = window) {
  if (host.shiyeAndroidStickerPanel) return host.shiyeAndroidStickerPanel;
  const doc = host.document,
    states = new WeakMap();
  let queued = false,
    writes = Promise.resolve();
  const icon = (symbol) => {
    const glyph = doc.createElement('i');
    glyph.className = 'icon icon-' + symbol;
    glyph.setAttribute('aria-hidden', 'true');
    return glyph;
  };
  const items = (state) => [
    ...state.dialog.querySelectorAll('.shiye-sticker-grid > .shiye-sticker-item'),
  ];
  const idOf = (item) => item?.querySelector('[data-sticker-id]')?.dataset.stickerId;
  function report(state, message) {
    const node = state.dialog.querySelector('[role=status]');
    if (node) node.textContent = message;
  }
  function saveOrder(state) {
    const visible = items(state).map(idOf).filter(Boolean);
    state.saving = true;
    const operation = writes
      .catch(() => {})
      .then(async () => {
        const prior = (await host.shiyeLocalAssets.get(ORDER_KEY)) || {};
        const previous = Array.isArray(prior.order)
          ? prior.order.filter((id) => typeof id === 'string')
          : [];
        const order = [...new Set([...visible, ...previous.filter((id) => !visible.includes(id))])];
        await host.shiyeLocalAssets.put({ ...prior, id: ORDER_KEY, version: 1, order });
        state.order = order;
      });
    writes = operation;
    return operation
      .catch((error) => {
        report(state, error.message || '顺序未保存，请重试');
        throw error;
      })
      .finally(() => {
        state.saving = false;
      });
  }
  function applyOrder(state) {
    const grid = state.dialog.querySelector('.shiye-sticker-grid');
    if (!grid || state.dragging || state.saving) return;
    const current = items(state),
      rank = new Map(state.order.map((id, at) => [id, at]));
    const ordered = current
      .map((item, at) => ({ item, at, rank: rank.get(idOf(item)) ?? Number.MAX_SAFE_INTEGER }))
      .sort((a, b) => a.rank - b.rank || a.at - b.at)
      .map((item) => item.item);
    // Do not reinsert an unchanged list: that would trigger the adapter observer forever.
    if (ordered.some((item, at) => item !== current[at])) grid.append(...ordered);
  }
  function closeManager(state) {
    state.manager?.close();
    state.manager = undefined;
  }
  async function manage(state, item) {
    if (state.saving || !state.dialog.open) return;
    closeManager(state);
    const id = idOf(item),
      asset = await host.shiyeLocalAssets.get(id);
    if (!asset || asset.removed || !state.dialog.open) return;
    const dialog = doc.createElement('dialog');
    dialog.className = 'shiye-android-dialog shiye-sticker-panel-manager';
    dialog.setAttribute('aria-label', '管理表情包');
    const title = doc.createElement('strong');
    title.textContent = asset.name || '表情包';
    const actions = doc.createElement('div'),
      status = doc.createElement('p');
    status.setAttribute('role', 'status');
    const action = (label, run) => {
      const button = doc.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.onclick = async () => {
        button.disabled = true;
        try {
          await run();
        } catch (error) {
          status.textContent = error.message || '操作未完成，请重试';
        } finally {
          button.disabled = false;
        }
      };
      actions.append(button);
    };
    action('名称与备注', () => {
      dialog.close();
      host.shiyeStickers.promptEdit(asset);
    });
    action('前移', async () => {
      const previous = item.previousElementSibling;
      if (!previous) return;
      item.parentElement.insertBefore(item, previous);
      await saveOrder(state);
    });
    action('后移', async () => {
      const next = item.nextElementSibling;
      if (!next) return;
      item.parentElement.insertBefore(next, item);
      await saveOrder(state);
    });
    action('移除收藏', async () => {
      await host.shiyeStickers.remove(asset);
      dialog.close();
      host.dispatchEvent(new host.Event('shiye-stickers-updated'));
    });
    action('关闭', () => dialog.close());
    dialog.append(title, actions, status);
    doc.body.append(dialog);
    state.manager = dialog;
    dialog.addEventListener(
      'close',
      () => {
        dialog.remove();
        if (state.manager === dialog) state.manager = undefined;
      },
      { once: true },
    );
    dialog.showModal();
  }
  function bindItem(state, item) {
    const button = item.querySelector('[data-sticker-id]');
    if (!button || button.dataset.shiyePanelBound) return;
    button.dataset.shiyePanelBound = 'true';
    // Browser image dragging would cancel the pointer stream before our reorder commits.
    for (const image of button.querySelectorAll('img')) image.draggable = false;
    button.addEventListener('dragstart', (event) => event.preventDefault());
    let timer,
      pointer,
      startX,
      startY,
      armed = false,
      dragging = false,
      suppressUntil = 0;
    let originalOrder;
    const reset = () => {
      host.clearTimeout(timer);
      timer = undefined;
      armed = dragging = false;
      state.dragging = false;
      item.classList.remove('shiye-panel-dragging');
    };
    button.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || state.saving || event.isPrimary === false) return;
      reset();
      pointer = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      originalOrder = items(state);
      const arm = () => {
        armed = true;
        item.classList.add('shiye-panel-dragging');
        try {
          button.setPointerCapture(pointer);
        } catch {
          /* Detached/cancelled pointer. */
        }
      };
      if (state.sortMode) arm();
      else timer = host.setTimeout(arm, 420);
    });
    button.addEventListener(
      'pointermove',
      (event) => {
        if (event.pointerId !== pointer) return;
        const distance = Math.hypot(event.clientX - startX, event.clientY - startY);
        if (!armed) {
          if (distance > 10) host.clearTimeout(timer);
          return;
        }
        if (distance < 6 && !dragging) return;
        dragging = state.dragging = true;
        event.preventDefault();
        const target = doc
          .elementFromPoint(event.clientX, event.clientY)
          ?.closest('.shiye-sticker-item');
        if (!target || target === item || target.parentElement !== item.parentElement) return;
        const nodes = items(state),
          from = nodes.indexOf(item),
          to = nodes.indexOf(target);
        item.parentElement.insertBefore(item, from < to ? target.nextElementSibling : target);
        // Moving a captured node releases capture in Chromium; retain the same gesture.
        try {
          button.setPointerCapture(pointer);
        } catch {
          /* A cancelled pointer is restored by pointercancel. */
        }
      },
      { passive: false },
    );
    function finish(event, cancelled) {
      if (event.pointerId !== pointer) return;
      const held = armed,
        moved = dragging;
      reset();
      try {
        button.releasePointerCapture(pointer);
      } catch {
        /* No active pointer capture. */
      }
      pointer = undefined;
      if (held || cancelled) suppressUntil = Date.now() + 800;
      if (cancelled) {
        if (moved && originalOrder[0]?.parentElement)
          originalOrder[0].parentElement.append(...originalOrder);
        return;
      }
      if (moved) saveOrder(state).catch(() => {});
      else if (held) manage(state, item).catch((error) => report(state, error.message));
    }
    button.addEventListener('pointerup', (event) => finish(event, false));
    button.addEventListener('pointercancel', (event) => finish(event, true));
    button.addEventListener(
      'contextmenu',
      (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        reset();
        suppressUntil = Date.now() + 800;
        manage(state, item).catch((error) => report(state, error.message));
      },
      true,
    );
    button.addEventListener(
      'click',
      (event) => {
        if (Date.now() < suppressUntil || state.saving || state.sortMode) {
          event.preventDefault();
          event.stopImmediatePropagation();
          if (state.sortMode && Date.now() >= suppressUntil && !state.saving)
            manage(state, item).catch((error) => report(state, error.message));
        }
        // All ordinary taps continue to the ORIGINAL shared picker onclick/sendSticker.
      },
      true,
    );
    state.cleanups.push(reset);
  }
  function adapt(dialog) {
    let state = states.get(dialog);
    if (!state) {
      state = { dialog, order: [], cleanups: [], sortMode: false, saving: false, dragging: false };
      states.set(dialog, state);
      dialog.classList.add('shiye-compact-sticker-panel');
      dialog.addEventListener(
        'close',
        () => {
          for (const cleanup of state.cleanups) cleanup();
          closeManager(state);
        },
        { once: true },
      );
      host.shiyeLocalAssets
        .get(ORDER_KEY)
        .then((record) => {
          state.order = Array.isArray(record?.order)
            ? [...new Set(record.order.filter((id) => typeof id === 'string'))]
            : [];
          applyOrder(state);
        })
        .catch((error) => report(state, error.message));
    }
    state.stickerTab ||= dialog.querySelector('[data-tab="sticker"]');
    if (dialog.querySelector('.shiye-emoji-grid')) state.stickerTab?.click();
    dialog.querySelector('.shiye-symbol-tabs')?.remove();
    const heading = dialog.querySelector('header h2');
    if (heading) heading.remove();
    const header = dialog.querySelector('header');
    if (header && !header.querySelector('[data-panel-sort]')) {
      const sort = doc.createElement('button');
      sort.type = 'button';
      sort.dataset.panelSort = 'true';
      sort.setAttribute('aria-label', '管理与排序');
      sort.setAttribute('aria-pressed', 'false');
      sort.textContent = '↕';
      sort.onclick = () => {
        state.sortMode = !state.sortMode;
        sort.setAttribute('aria-pressed', String(state.sortMode));
        dialog.classList.toggle('shiye-panel-sort-mode', state.sortMode);
      };
      header.prepend(sort);
    }
    const importer = dialog.querySelector('.shiye-sticker-import');
    if (importer && header && !importer.classList.contains('shiye-panel-import')) {
      const input = importer.querySelector('input');
      importer.classList.add('shiye-panel-import');
      importer.setAttribute('aria-label', '导入表情包');
      importer.replaceChildren(icon('add'), ...(input ? [input] : []));
      header.prepend(importer);
    }
    for (const button of dialog.querySelectorAll('.shiye-sticker-item > .shiye-sticker-remove')) {
      button.hidden = true;
      button.tabIndex = -1;
      button.setAttribute('aria-hidden', 'true');
    }
    const status = dialog.querySelector(':scope > [role=status]');
    if (status?.textContent.startsWith('收藏图片或动图后')) status.textContent = '';
    for (const item of items(state)) bindItem(state, item);
    applyOrder(state);
  }
  function scan() {
    queued = false;
    for (const dialog of doc.querySelectorAll('.shiye-symbol-dialog[open]')) adapt(dialog);
  }
  const observer = new host.MutationObserver(() => {
    if (!queued) {
      queued = true;
      host.queueMicrotask(scan);
    }
  });
  observer.observe(doc.body, { childList: true, subtree: true });
  scan();
  const api = {
    orderKey: ORDER_KEY,
    scan,
    destroy() {
      observer.disconnect();
      delete host.shiyeAndroidStickerPanel;
    },
  };
  host.shiyeAndroidStickerPanel = api;
  return api;
}
