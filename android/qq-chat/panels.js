import {
  ORDER_KEY,
  preferenceMode,
  preferenceWeight,
  rankStickers,
  recordStickerUse,
  updateStickerPreference,
} from './sticker-ranking.js';
import { installTouchRangeGuard } from './touch-range.js';
const STICKER_LIMIT = 64 * 1024 * 1024;
const IMAGE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
]);

/** Independent QQ-style panels. The source remains the only owner of message persistence and ACK. */
export function installQQPanels({
  source,
  getReplyId = () => undefined,
  onSent = () => {},
  onMediaState = () => {},
  captureExternalSend = () => null,
  cancelExternalSend = () => {},
  isActive = () => true,
}) {
  if (!source?.getSnapshot || !source?.sendFiles) throw Error('QQ_PANEL_SOURCE_REQUIRED');
  const host = document.createElement('div');
  host.id = 'shiye-qq-panels';
  const shadow = host.attachShadow({ mode: 'open' });
  const releaseTouchRangeGuard = installTouchRangeGuard(shadow);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('./panels.css', import.meta.url).href;
  shadow.append(link);
  document.body.append(host);
  let current,
    generation = 0,
    destroyed = false;
  const closing = new Set();
  const node = (tag, className, text) => {
    const value = document.createElement(tag);
    if (className) value.className = className;
    if (text !== undefined) value.textContent = text;
    return value;
  };
  const button = (label, action, className) => {
    const value = node('button', className, label);
    value.type = 'button';
    value.onclick = action;
    return value;
  };
  function context() {
    const value = source.getContext?.() || source.getSnapshot();
    return {
      roomId: String(value?.roomId ?? ''),
      version: value?.contextVersion ?? value?.version,
    };
  }
  function alive(state, strict = true) {
    if (destroyed || current !== state || state.ticket !== generation || !isActive()) return false;
    const value = context();
    return (
      value.roomId === state.context.roomId && (!strict || value.version === state.context.version)
    );
  }
  function revoke(state, url) {
    if (state.urls.delete(url)) URL.revokeObjectURL(url);
  }
  function ownURL(state, blob) {
    const url = URL.createObjectURL(blob);
    state.urls.add(url);
    return url;
  }
  function message(state, text) {
    if (alive(state) && state.status) state.status.textContent = text;
  }
  function closeAll() {
    generation++;
    const state = current;
    current = undefined;
    if (!state) return;
    if (state.initialSendToken) cancelExternalSend(state.initialSendToken);
    if (state.activeSendToken) cancelExternalSend(state.activeSendToken);
    if (state.kind === 'files') onMediaState('', state.context.roomId);
    for (const cleanup of state.cleanups) cleanup();
    for (const cleanup of state.thumbnailCleanups || []) cleanup();
    state.previewObserver?.disconnect();
    state.external?.close();
    state.manager?.close();
    state.input?.remove();
    state.manager?.remove();
    const release = () => {
      if (!closing.delete(release)) return;
      state.dialog?.close();
      state.dialog?.remove();
      for (const url of state.urls) URL.revokeObjectURL(url);
      state.urls.clear();
      state.resolveClosed?.();
    };
    closing.add(release);
    if (state.dialog?.open && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      state.dialog.inert = true;
      state.dialog
        .animate(
          state.kind === 'stickers'
            ? [{ transform: 'translateY(0)' }, { transform: 'translateY(16px)', opacity: 0 }]
            : [{ opacity: 1 }, { opacity: 0 }],
          {
            duration: 100,
            easing: 'ease-in',
          },
        )
        .finished.then(release, release);
    } else release();
  }
  function start(kind) {
    closeAll();
    for (const release of [...closing]) release();
    if (destroyed || !isActive()) return undefined;
    const captured = context();
    if (!captured.roomId) return undefined;
    const state = {
      kind,
      context: captured,
      replyId: getReplyId(),
      ticket: generation,
      urls: new Set(),
      cleanups: [],
      busy: false,
    };
    state.closed = new Promise((resolve) => {
      state.resolveClosed = resolve;
    });
    current = state;
    return state;
  }
  function shell(state, label, viewer = false) {
    const dialog = node('dialog', viewer ? 'qq-panel qq-viewer' : 'qq-panel');
    dialog.setAttribute('aria-label', label);
    const header = node('header', 'toolbar');
    const close = button('×', closeAll, 'icon');
    close.setAttribute('aria-label', '关闭');
    header.append(close);
    const body = node('div', 'panel-body'),
      status = node('p', 'status');
    status.setAttribute('role', 'status');
    dialog.append(header, body, status);
    shadow.append(dialog);
    Object.assign(state, { dialog, header, body, status });
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      closeAll();
    });
    dialog.addEventListener(
      'close',
      () => {
        if (current === state) closeAll();
      },
      { once: true },
    );
    if (state.kind === 'stickers' || state.kind === 'files') {
      dialog.classList.add(state.kind === 'stickers' ? 'qq-sticker-dock' : 'qq-file-retry-dock');
      // Setting open avoids dialog.show()'s focus algorithm; the composer owns IME.
      dialog.setAttribute('open', '');
      const layout = () => {
        const frame = document.querySelector('#shiye-qq-chat iframe');
        const root = frame?.contentDocument?.querySelector('#qq-frame-root')?.shadowRoot;
        const composer = root?.querySelector('.qq-footer');
        const viewport = window.visualViewport;
        const top = viewport?.offsetTop || 0;
        const bottom =
          composer && frame
            ? frame.getBoundingClientRect().top + composer.getBoundingClientRect().top
            : top + (viewport?.height || window.innerHeight) - 50;
        dialog.style.bottom = `${Math.max(0, window.innerHeight - bottom)}px`;
        dialog.style.maxHeight = `${Math.max(100, Math.min(340, bottom - top - 48))}px`;
      };
      const preserveFocus = (event) => {
        if (!event.target.closest('input,textarea,select')) event.preventDefault();
      };
      dialog.addEventListener('mousedown', preserveFocus);
      dialog.addEventListener('pointerdown', preserveFocus);
      window.addEventListener('resize', layout);
      window.visualViewport?.addEventListener('resize', layout);
      window.visualViewport?.addEventListener('scroll', layout);
      const observer =
        typeof window.ResizeObserver === 'function' ? new window.ResizeObserver(layout) : null;
      const frame = document.querySelector('#shiye-qq-chat iframe');
      const footer = frame?.contentDocument
        ?.querySelector('#qq-frame-root')
        ?.shadowRoot?.querySelector('.qq-footer');
      if (footer) observer?.observe(footer);
      state.cleanups.push(() => {
        observer?.disconnect();
        window.removeEventListener('resize', layout);
        window.visualViewport?.removeEventListener('resize', layout);
        window.visualViewport?.removeEventListener('scroll', layout);
      });
      layout();
    } else dialog.showModal();
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      dialog.animate(
        [
          { opacity: 0.75, transform: 'translateY(12px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ],
        { duration: 160, easing: 'cubic-bezier(.2,.8,.2,1)' },
      );
    return state;
  }
  function setBusy(state, busy) {
    state.busy = busy;
    for (const control of state.dialog?.querySelectorAll('button,input') || []) {
      if (!control.matches('[aria-label="关闭"]')) control.disabled = busy;
    }
  }
  function sendError(state, error) {
    if (!alive(state, false)) return;
    if (state.kind === 'files' && !state.dialog) showFileFailure(state);
    setBusy(state, false);
    if (error?.uncertain || error?.locked) {
      state.sendLocked = true;
      if (state.retry) state.retry.disabled = true;
      message(state, '发送结果尚未确认，请核对聊天记录后重新选择；已保留本次选择。');
      return;
    }
    if (state.retry) state.retry.hidden = false;
    message(state, `${error?.message || '发送未完成'}；已保留本次选择，可重试。`);
  }
  async function sent(state, files, sticker = false, stickerId) {
    if (!alive(state) || state.busy || state.sendLocked) return;
    const sendToken = state.initialSendToken || captureExternalSend();
    state.initialSendToken = null;
    state.activeSendToken = sendToken;
    setBusy(state, true);
    if (state.kind === 'files') onMediaState('正在发送原件…', state.context.roomId);
    message(state, '正在发送原件…');
    try {
      const receipt =
        sticker && source.sendSticker
          ? await source.sendSticker(files[0], state.replyId)
          : await source.sendFiles(files, state.replyId);
      if (stickerId) void recordStickerUse(window.shiyeLocalAssets, stickerId).catch(() => {});
      // A successful source ACK can advance its data revision. It must not affect a new room/panel.
      if (alive(state, false)) {
        closeAll();
        onSent(receipt, sendToken);
      }
    } catch (error) {
      cancelExternalSend(sendToken);
      state.activeSendToken = null;
      if (state.kind === 'files') onMediaState('', state.context.roomId);
      sendError(state, error);
    }
  }
  function showFileFailure(state) {
    shell(state, '图片与视频');
    const title = node('strong', 'media-title', `已选择 ${state.files.length} 项`);
    const retry = button('重试发送', () => sent(state, [...state.files]), 'send');
    retry.hidden = true;
    state.retry = retry;
    state.header.prepend(title, retry);
    state.body.append(node('p', 'original-note', '按原始文件发送 · 保留原格式和字节'));
    const grid = node('div', 'attachment-grid');
    state.body.append(grid);
    state.files.forEach((file, index) => {
      const item = node('div', 'attachment');
      const type = file.type.toLowerCase();
      if (type.startsWith('image/') && type !== 'image/svg+xml') {
        const img = node('img');
        img.src = ownURL(state, file);
        img.alt = file.name;
        item.append(img);
      } else if (type.startsWith('video/')) {
        const video = node('video');
        video.src = ownURL(state, file);
        video.controls = true;
        video.preload = 'metadata';
        video.playsInline = true;
        item.append(video);
      } else item.append(node('span', 'file-icon', '文件'));
      item.append(node('span', 'filename', file.name));
      item.append(node('span', 'selection-order', String(index + 1)));
      grid.append(item);
    });
  }
  function files(onPickerReturn = () => {}, onPickerOpened = () => {}, initialSendToken = null) {
    const state = start('files');
    if (!state) return;
    state.initialSendToken = initialSendToken;
    let returned = false;
    const returnOnce = () => {
      if (returned) return;
      returned = true;
      onPickerReturn();
    };
    const input = node('input');
    input.type = 'file';
    input.accept = 'image/*,video/*';
    input.multiple = true;
    input.hidden = true;
    state.input = input;
    shadow.append(input);
    input.addEventListener(
      'cancel',
      () => {
        if (returned) return;
        returnOnce();
        if (current === state) closeAll();
      },
      { once: true },
    );
    input.onchange = () => {
      if (returned) return;
      returnOnce();
      if (!alive(state)) {
        if (current === state) closeAll();
        return;
      }
      state.files = [...(input.files || [])];
      input.remove();
      if (!state.files.length) {
        closeAll();
        return;
      }
      // The native picker has the Send action. Returning its chosen files commits once.
      // Keep the same File objects for retry, but never flash the old confirmation sheet.
      void sent(state, [...state.files]);
    };
    // Keep this synchronous in the initiating user gesture for Android's native AttachmentPicker.
    onPickerOpened();
    input.click();
  }
  async function orderedAssets(state) {
    const store = window.shiyeLocalAssets;
    if (!store?.list || !window.shiyeStickers) throw Error('表情图库尚未就绪');
    const [records, preference] = await Promise.all([store.list('sticker:'), store.get(ORDER_KEY)]);
    if (!alive(state)) return [];
    state.preference = preference || {};
    state.mode = preferenceMode(state.preference);
    state.weight = preferenceWeight(state.preference);
    return rankStickers(records, state.preference);
  }
  async function saveOrder(state) {
    const order = state.assets.map((asset) => asset.id);
    const saved = await updateStickerPreference(window.shiyeLocalAssets, (prior) => {
      const previous = Array.isArray(prior.order)
        ? prior.order.filter((id) => typeof id === 'string')
        : [];
      return { order: [...new Set([...order, ...previous.filter((id) => !order.includes(id))])] };
    });
    window.dispatchEvent(new Event('shiye-sticker-priority-updated'));
    return saved;
  }
  async function move(state, asset, delta) {
    if (!alive(state) || state.busy || state.mode !== 'manual') return;
    const index = state.assets.findIndex((value) => value.id === asset.id),
      next = index + delta;
    if (index < 0 || next < 0 || next >= state.assets.length) return;
    const before = [...state.assets];
    [state.assets[index], state.assets[next]] = [state.assets[next], state.assets[index]];
    setBusy(state, true);
    try {
      await saveOrder(state);
    } catch (error) {
      state.assets = before;
      message(state, error.message || '排序未保存，请重试');
    } finally {
      if (alive(state)) {
        setBusy(state, false);
        renderStickers(state);
      }
    }
  }
  function manage(state, asset) {
    if (!alive(state) || state.busy || state.manager?.open) return;
    const dialog = node('dialog', 'qq-manager');
    dialog.setAttribute('aria-label', '管理表情包');
    const title = node('strong', '', asset.name || '表情包'),
      controls = node('div', 'manager-actions');
    const close = () => {
      dialog.close();
      dialog.remove();
      if (state.manager === dialog) state.manager = undefined;
    };
    controls.append(
      button('名称与备注', () => {
        close();
        if (!alive(state)) return;
        state.external = window.shiyeStickers.promptEdit(asset);
      }),
      ...(state.mode === 'manual'
        ? [
            button('前移', () => move(state, asset, -1)),
            button('后移', () => move(state, asset, 1)),
          ]
        : []),
      button('移除收藏', async () => {
        if (!alive(state) || state.busy) return;
        setBusy(state, true);
        try {
          await window.shiyeStickers.remove(asset);
          if (alive(state)) {
            close();
            await refreshStickers(state);
            window.dispatchEvent(new Event('shiye-stickers-updated'));
          }
        } catch (error) {
          message(state, error.message || '移除未完成，请重试');
        } finally {
          if (alive(state)) setBusy(state, false);
        }
      }),
      button('关闭', close),
    );
    dialog.append(title, controls);
    shadow.append(dialog);
    state.manager = dialog;
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      close();
    });
    dialog.classList.add('sticker-preview');
    state.dialog.append(dialog);
    dialog.setAttribute('open', '');
    const image = node('img', 'manager-preview');
    image.alt = asset.name || '表情预览';
    dialog.prepend(image);
    const note = node('p', 'preview-note', asset.note || asset.remark || '原件预览 · 长按管理');
    title.after(note);
    let previewURL;
    const cleanup = () => {
      if (previewURL) {
        revoke(state, previewURL);
        previewURL = null;
      }
    };
    state.cleanups.push(cleanup);
    dialog.addEventListener('close', cleanup, { once: true });
    window.shiyeStickers
      .materialize(asset)
      .then((owned) => {
        if (!alive(state) || !dialog.isConnected) return;
        if (
          !(owned.blob instanceof Blob) ||
          !owned.blob.size ||
          owned.blob.size > STICKER_LIMIT ||
          !IMAGE_MIMES.has(owned.blob.type)
        )
          throw Error('原件不可预览');
        previewURL = ownURL(state, owned.blob);
        image.src = previewURL;
      })
      .catch((error) => {
        if (dialog.isConnected) note.textContent = error.message || '预览暂不可用';
      });
  }
  function bindThumbnail(state, item, asset) {
    let timer,
      startX,
      startY,
      moved = false,
      suppressUntil = 0;
    const cancel = () => {
      clearTimeout(timer);
      timer = undefined;
    };
    item.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.isPrimary === false || state.busy) return;
      cancel();
      startX = event.clientX;
      startY = event.clientY;
      moved = false;
      timer = setTimeout(() => {
        suppressUntil = Date.now() + 900;
        manage(state, asset);
      }, 420);
    });
    item.addEventListener('pointermove', (event) => {
      if (Math.hypot(event.clientX - startX, event.clientY - startY) > 8) {
        moved = true;
        suppressUntil = Date.now() + 900;
        cancel();
      }
    });
    item.addEventListener('pointerup', cancel);
    item.addEventListener('pointercancel', () => {
      moved = true;
      suppressUntil = Date.now() + 900;
      cancel();
    });
    item.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      cancel();
      suppressUntil = Date.now() + 900;
      manage(state, asset);
    });
    item.addEventListener('click', async (event) => {
      if (moved || Date.now() < suppressUntil) {
        event.preventDefault();
        return;
      }
      if (!alive(state) || state.busy) return;
      if (state.sorting) {
        manage(state, asset);
        return;
      }
      setBusy(state, true);
      try {
        const owned = await window.shiyeStickers.materialize(asset);
        if (!alive(state)) return;
        if (!(owned.blob instanceof Blob) || !owned.blob.size || owned.blob.size > STICKER_LIMIT)
          throw Error('表情原件不可用或超过64 MiB');
        if (owned.blob.type === 'image/svg+xml' || /\.svg(?:$|[?#])/i.test(owned.name || ''))
          throw Error('不支持SVG表情');
        const file = new File([owned.blob], owned.name || asset.name || 'sticker', {
          type: owned.blob.type,
        });
        file.shiyeOriginalSticker = true;
        setBusy(state, false);
        await sent(state, [file], true, asset.id);
      } catch (error) {
        if (alive(state)) {
          setBusy(state, false);
          message(state, error.message || '原件读取失败，请重试');
        }
      }
    });
    state.cleanups.push(cancel);
  }
  function renderStickers(state) {
    if (!alive(state)) return;
    state.previewObserver?.disconnect();
    for (const url of [...state.urls]) revoke(state, url);
    for (const cleanup of state.thumbnailCleanups || []) cleanup();
    const oldCount = state.cleanups.length;
    const grid = node('div', 'sticker-grid');
    state.body.replaceChildren(grid);
    const previews = new Map();
    const loadPreview = (item) => {
      const preview = previews.get(item);
      previews.delete(item);
      if (!preview) return;
      const { asset, image } = preview;
      window.shiyeStickers
        .preview(asset)
        .then((blob) => {
          if (!alive(state) || !image.isConnected) return;
          if (!(blob instanceof Blob) || !blob.size) throw Error('预览不可用');
          image.src = ownURL(state, blob);
        })
        .catch((error) => {
          if (alive(state) && image.isConnected) {
            item.dataset.preview = 'failed';
            item.title = error.message || '预览暂不可用，可点击尝试发送原件';
          }
        });
    };
    state.previewObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          state.previewObserver?.unobserve(entry.target);
          loadPreview(entry.target);
        }
      },
      { root: state.body, rootMargin: '80px' },
    );
    for (const asset of state.assets) {
      const cell = node('div', 'sticker-cell'),
        item = button('', undefined, 'thumbnail');
      item.dataset.assetId = asset.id;
      item.setAttribute('aria-label', `发送表情包：${asset.name || '表情'}`);
      const image = node('img');
      image.alt = '';
      image.setAttribute('aria-hidden', 'true');
      item.dataset.preview = 'loading';
      image.addEventListener('load', () => {
        if (image.isConnected) item.dataset.preview = 'ready';
      });
      image.addEventListener('error', () => {
        if (image.isConnected) {
          item.dataset.preview = 'failed';
          item.title = '预览暂不可用，可点击尝试发送原件';
        }
      });
      image.draggable = false;
      item.append(image);
      item.addEventListener('dragstart', (event) => event.preventDefault());
      bindThumbnail(state, item, asset);
      cell.append(item, node('span', 'sticker-name', asset.name || '表情'));
      if (asset.mime === 'image/gif' || /\.gif$/i.test(asset.name || ''))
        item.append(node('span', 'gif-badge', 'GIF'));
      if (state.sorting && state.mode === 'manual') {
        const controls = node('div', 'order-actions');
        controls.append(
          button('前移', () => move(state, asset, -1)),
          button('后移', () => move(state, asset, 1)),
        );
        cell.append(controls);
      }
      grid.append(cell);
      previews.set(item, { asset, image });
      state.previewObserver.observe(item);
    }
    state.thumbnailCleanups = state.cleanups.splice(oldCount);
    setBusy(state, state.busy);
  }
  async function refreshStickers(state) {
    const ticket = (state.renderTicket || 0) + 1;
    state.renderTicket = ticket;
    try {
      const assets = await orderedAssets(state);
      if (!alive(state) || ticket !== state.renderTicket) return;
      state.assets = assets;
      renderStickers(state);
      state.updateControls?.();
    } catch (error) {
      message(state, error.message || '图库读取失败，请重试');
    }
  }
  async function importStickers(state, files) {
    if (!alive(state) || state.busy) return;
    setBusy(state, true);
    const imported = [];
    try {
      for (const file of files) {
        if (!alive(state)) return;
        if (
          file.size > STICKER_LIMIT ||
          /\.svg$/i.test(file.name) ||
          file.type.toLowerCase() === 'image/svg+xml'
        )
          throw Error('表情须为64 MiB以内的图片，不能是SVG');
        const bytes = await file.arrayBuffer();
        if (!alive(state)) return;
        if (
          !bytes.byteLength ||
          bytes.byteLength > STICKER_LIMIT ||
          !IMAGE_MIMES.has(file.type.toLowerCase())
        )
          throw Error('图片格式暂不支持或原件超过64 MiB');
        const head = new TextDecoder().decode(bytes.slice(0, 1024));
        if (/<svg[\s>]/i.test(head)) throw Error('不支持SVG表情');
        const blob = new Blob([bytes], { type: file.type });
        const asset = {
          id: 'sticker:' + crypto.randomUUID(),
          name: file.name,
          blob,
          // The original and its new-sort timestamp commit in one IndexedDB put.
          createdAt: Date.now(),
        };
        await window.shiyeLocalAssets.put(asset);
        imported.push(asset);
        if (!alive(state)) return;
      }
      await refreshStickers(state);
      if (!alive(state)) return;
      // Naming is optional metadata editing after the original's durable local ACK.
      // Cancelling the shared form never rolls back the already imported original.
      if (files.length === 1 && imported.length === 1)
        state.external = window.shiyeStickers.promptEdit(imported[0]);
      window.dispatchEvent(new Event('shiye-stickers-updated'));
      if (window.shiyeStickers.sync)
        Promise.resolve()
          .then(() => window.shiyeStickers.sync())
          .catch(() => {});
    } catch (error) {
      message(state, error.message || '导入未完成，请重试');
    } finally {
      if (alive(state)) setBusy(state, false);
    }
  }
  function stickers() {
    if (current?.kind === 'stickers') {
      closeAll();
      return;
    }
    const state = start('stickers');
    if (!state) return;
    shell(state, '表情包');
    const ordering = node('div', 'sticker-ordering');
    const modes = [
      ['common', '常用'],
      ['new', '新增'],
      ['manual', '手动'],
    ];
    const modeButtons = modes.map(([mode, label]) =>
      button(
        label,
        async () => {
          if (!alive(state) || state.busy || state.mode === mode) return;
          setBusy(state, true);
          try {
            const saved = await updateStickerPreference(window.shiyeLocalAssets, () => ({
              sortMode: mode,
            }));
            window.dispatchEvent(new Event('shiye-sticker-priority-updated'));
            if (!alive(state)) return;
            state.preference = saved;
            state.mode = preferenceMode(saved);
            updateControls();
            await refreshStickers(state);
          } catch (error) {
            if (alive(state)) message(state, error.message || '排序方式未保存');
          } finally {
            if (alive(state)) {
              setBusy(state, false);
              updateControls();
            }
          }
        },
        'sort-mode',
      ),
    );
    const weightLabel = node('label', 'new-weight');
    const weightText = node('span', '', '新增优先 35');
    const weightInput = node('input');
    weightInput.type = 'range';
    weightInput.min = '0';
    weightInput.max = '100';
    weightInput.value = '35';
    weightInput.setAttribute('aria-label', '常用排序的新增优先程度');
    weightInput.addEventListener('input', () => {
      if (state.busy) return;
      weightText.textContent = `新增优先 ${weightInput.value}`;
    });
    weightInput.addEventListener('change', async () => {
      if (!alive(state)) return;
      if (state.busy) return;
      const weight = Number(weightInput.value);
      setBusy(state, true);
      try {
        const saved = await updateStickerPreference(window.shiyeLocalAssets, () => ({
          newWeight: weight,
        }));
        window.dispatchEvent(new Event('shiye-sticker-priority-updated'));
        if (!alive(state)) return;
        state.preference = saved;
        state.weight = preferenceWeight(saved);
        updateControls();
        await refreshStickers(state);
      } catch (error) {
        if (alive(state)) message(state, error.message || '新增优先程度未保存');
      } finally {
        if (alive(state)) {
          setBusy(state, false);
          updateControls();
        }
      }
    });
    weightLabel.append(weightText, weightInput);
    const weightDetails = node('details', 'weight-details');
    weightDetails.append(node('summary', '', '优先级'), weightLabel);
    ordering.append(...modeButtons, weightDetails);
    state.body.before(ordering);
    function updateControls() {
      modeButtons.forEach((item, i) =>
        item.setAttribute('aria-pressed', String(modes[i][0] === state.mode)),
      );
      weightDetails.hidden = state.mode !== 'common';
      weightInput.value = String(state.weight);
      weightText.textContent = `新增优先 ${state.weight}`;
    }
    state.updateControls = updateControls;
    updateControls();
    const input = node('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.hidden = true;
    state.input = input;
    state.header.append(input);
    input.onchange = () => {
      const files = [...(input.files || [])];
      input.value = '';
      importStickers(state, files);
    };
    const add = button(
      '+',
      () => {
        if (alive(state) && !state.busy) input.click();
      },
      'icon',
    );
    add.setAttribute('aria-label', '导入表情包');
    const sort = button(
      '↕',
      () => {
        if (!alive(state) || state.busy) return;
        state.sorting = !state.sorting;
        message(state, state.sorting ? '点击表情预览与管理；手动模式可调整顺序' : '');
        sort.setAttribute('aria-pressed', String(state.sorting));
        renderStickers(state);
      },
      'icon',
    );
    sort.setAttribute('aria-label', '管理与排序');
    sort.setAttribute('aria-pressed', 'false');
    add.textContent = '＋';
    sort.textContent = '管理';
    sort.classList.add('manage-toggle');
    state.header.prepend(node('strong', 'panel-title', '表情'), add, sort);
    const updated = () => {
      if (alive(state) && !state.busy) refreshStickers(state);
    };
    window.addEventListener('shiye-stickers-updated', updated);
    state.cleanups.push(() => window.removeEventListener('shiye-stickers-updated', updated));
    refreshStickers(state);
  }
  async function viewMedia(messageValue) {
    const state = start('media');
    if (!state) return;
    shell(state, '查看附件', true);
    message(state, '正在读取原件…');
    try {
      const loaded = await Promise.race([
        Promise.resolve()
          .then(() => source.getMedia(messageValue))
          .then((media) => ({ media })),
        state.closed.then(() => ({ closed: true })),
      ]);
      if (loaded.closed) return;
      const media = loaded.media;
      if (!alive(state)) return;
      const mime = String(media.mime || media.blob?.type || '').toLowerCase();
      if (!(media.blob instanceof Blob) && !media.url) throw Error('原件尚不可用');
      const url = media.blob instanceof Blob ? ownURL(state, media.blob) : media.url;
      if (mime.startsWith('image/') && mime !== 'image/svg+xml') {
        const image = node('img', 'full-media');
        image.src = url;
        image.alt = media.name || '图片';
        state.body.append(image);
      } else if (mime.startsWith('video/')) {
        const video = node('video', 'full-media');
        video.src = url;
        video.controls = true;
        video.autoplay = false;
        video.playsInline = true;
        video.preload = 'metadata';
        state.body.append(video);
      } else state.body.append(node('p', 'filename', media.name || '文件'));
      const save = button(
        '保存文件',
        async () => {
          if (!alive(state) || state.busy) return;
          if (!(media.blob instanceof Blob) || !window.shiyeAndroidFiles?.export) {
            message(state, '当前原件或文件保存接口不可用');
            return;
          }
          setBusy(state, true);
          try {
            await window.shiyeAndroidFiles.export({
              blob: media.blob,
              name: media.name || 'attachment',
              mimeType: mime || 'application/octet-stream',
              action: 'save',
            });
            message(state, '文件保存已完成');
          } catch (error) {
            message(state, error.message || '保存未完成，请重试');
          } finally {
            if (alive(state)) setBusy(state, false);
          }
        },
        'save',
      );
      state.header.prepend(save);
      message(state, '');
    } catch (error) {
      message(state, error.message || '原件读取失败，请重试');
    } finally {
      // Also covers closing while getMedia is pending or just after its reply.
      await state.closed;
    }
  }
  function collect(messageValue) {
    if (destroyed || !isActive()) return false;
    const captured = context(),
      id = messageValue?.id ?? messageValue?.messageId;
    if (
      !captured.roomId ||
      id === undefined ||
      id === null ||
      (messageValue?.roomId !== undefined && String(messageValue.roomId) !== captured.roomId)
    )
      return false;
    window.dispatchEvent(
      new CustomEvent('shiye-save-sticker', {
        detail: { roomId: captured.roomId, messageId: String(id) },
      }),
    );
    return true;
  }
  function back() {
    const state = current;
    if (!state) return false;
    if (state.external?.open) {
      state.external.close();
      state.external = undefined;
      return true;
    }
    if (state.manager?.open) {
      state.manager.close();
      state.manager.remove();
      state.manager = undefined;
      return true;
    }
    closeAll();
    return true;
  }
  return {
    files,
    stickers,
    viewMedia,
    collect,
    back,
    closeAll,
    destroy() {
      releaseTouchRangeGuard();
      closeAll();
      for (const release of [...closing]) release();
      destroyed = true;
      host.remove();
    },
  };
}
