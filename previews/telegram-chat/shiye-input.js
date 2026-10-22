/* Local symbol library and slash commands over the existing Tiptap editor. */
(() => {
  const emoji = [
    '😀',
    '😄',
    '😊',
    '🥰',
    '😂',
    '🤣',
    '🥹',
    '😭',
    '😌',
    '😔',
    '😤',
    '😱',
    '🤔',
    '🫠',
    '🙃',
    '😴',
    '❤️',
    '💙',
    '💚',
    '✨',
    '🌈',
    '🌙',
    '☀️',
    '🌻',
    '🍀',
    '🎉',
    '👍',
    '👏',
    '🙌',
    '🫂',
    '🙏',
    '💪',
    '🐱',
    '🐾',
    '☕',
    '🍰',
    '📖',
    '✍️',
    '💡',
    '✅',
  ];
  const usageKey = 'shiye-symbol-usage-v1';
  let usage;
  try {
    usage = JSON.parse(localStorage.getItem(usageKey) || '{}');
  } catch {
    usage = {};
  }
  let pendingSticker;
  let pendingStickerModal = false;
  new MutationObserver(() => {
    if (!pendingSticker) {
      pendingStickerModal = false;
      return;
    }
    const modal = document.querySelector('[class*=AttachmentModal-module__send-wrapper]');
    if (modal) pendingStickerModal = true;
    else if (pendingStickerModal) {
      pendingSticker = undefined;
      pendingStickerModal = false;
    }
  }).observe(document.body, { childList: true, subtree: true });
  function recordUsage(id) {
    usage[id] = (Number(usage[id]) || 0) + 1;
    try {
      localStorage.setItem(usageKey, JSON.stringify(usage));
    } catch {
      /* Optional ranking must not block input. */
    }
  }
  window.addEventListener('shiye-media-confirmed', () => {
    if (pendingSticker) recordUsage(pendingSticker);
    pendingSticker = undefined;
  });
  const preferenceKey = 'shiye-input-commands-v1';
  let preferences;
  try {
    preferences = JSON.parse(localStorage.getItem(preferenceKey) || '{}');
  } catch {
    preferences = {};
  }
  let mappings = [];
  let namedStickers = [];
  const stickerOrderKey = 'preference:sticker-order-v1';
  let stickerOrder = {};
  let orderWrites = Promise.resolve();
  const orderIds = (value) =>
    Array.isArray(value?.ids) ? value.ids.filter((id) => typeof id === 'string') : [];
  function sortStickers(records) {
    const rank = new Map(orderIds(stickerOrder).map((id, index) => [id, index]));
    return [...records].sort((a, b) => {
      if (stickerOrder.version === 1 && stickerOrder.mode === 'manual') {
        const difference = (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity);
        if (difference && !Number.isNaN(difference)) return difference;
      }
      return (usage[b.id] || 0) - (usage[a.id] || 0) || a.id.localeCompare(b.id);
    });
  }
  function moveSticker(id, action) {
    const operation = orderWrites
      .catch(() => {})
      .then(async () => {
        if (!['top', 'up', 'down', 'bottom', 'usage', 'name', 'reverse'].includes(action))
          throw Error('未知的排序操作');
        const [all, saved] = await Promise.all([
          window.shiyeLocalAssets.list('sticker:'),
          window.shiyeLocalAssets.get(stickerOrderKey),
        ]);
        if (saved && saved.version !== 1) throw Error('排序偏好版本暂不支持，已保留原数据');
        stickerOrder = saved || {};
        const visible = sortStickers(all.filter((asset) => !asset.removed));
        const from = visible.findIndex((asset) => asset.id === id);
        if (!['usage', 'name', 'reverse'].includes(action) && from < 0)
          throw Error('表情包已移除，请重新选择');
        if (action === 'name')
          visible.sort(
            (a, b) =>
              String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN', {
                numeric: true,
                sensitivity: 'base',
              }) || a.id.localeCompare(b.id),
          );
        else if (action === 'reverse') visible.reverse();
        else if (action !== 'usage') {
          const target =
            action === 'top'
              ? 0
              : action === 'bottom'
                ? visible.length - 1
                : Math.max(0, Math.min(visible.length - 1, from + (action === 'up' ? -1 : 1)));
          if (from === target) return;
          visible.splice(target, 0, visible.splice(from, 1)[0]);
        }
        const ids = visible.map((asset) => asset.id);
        const next = {
          ...saved,
          id: stickerOrderKey,
          version: 1,
          mode: action === 'usage' ? 'usage' : 'manual',
          ids: [...new Set([...ids, ...orderIds(saved).filter((value) => !ids.includes(value))])],
        };
        await window.shiyeLocalAssets.put(next);
        stickerOrder = next;
        window.dispatchEvent(new Event('shiye-stickers-updated'));
      });
    orderWrites = operation;
    return operation;
  }
  window.shiyeStickerOrder = { move: moveSticker, sort: sortStickers };
  let collectionVersion = 0;
  let refreshing = 0;
  async function refreshMappings() {
    const ticket = ++refreshing;
    const [aliases, assets, order] = await Promise.all([
      window.shiyeLocalAssets.list('mapping:'),
      window.shiyeLocalAssets.list('sticker:'),
      window.shiyeLocalAssets.get(stickerOrderKey),
    ]);
    if (ticket !== refreshing) return;
    mappings = aliases.filter((asset) => asset.id.startsWith('mapping:'));
    stickerOrder = order || {};
    namedStickers = assets.filter((asset) => {
      if (!asset.id.startsWith('sticker:') || asset.removed) return false;
      const media = asset.blob || asset.media;
      return (
        media?.size > 0 &&
        media.size <= 64 * 1024 * 1024 &&
        /^image\/(png|jpeg|webp|gif|avif)$/.test(media.type || '')
      );
    });
    collectionVersion++;
    updateCommands();
  }
  refreshMappings().catch(() => {});
  function normalizeAlias(text) {
    const name = text.trim().normalize('NFKC').replace(/^\//, '').toLowerCase();
    if (!/^[\p{L}\p{N}_-]{1,24}$/u.test(name))
      throw Error('名称请用 1–24 个中英文字、数字、下划线或短横线');
    return name;
  }
  let composing = false;
  let confirmUntil = 0;
  let panel;
  let active = 0;
  let matches = [];
  let dismissed;
  let commandUrls = [];
  let commandObserver;
  let sendingCommand = false;
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
  function makeDialog(title, html) {
    const previous = document.activeElement;
    const element = document.createElement('dialog');
    element.className = 'shiye-dialog shiye-symbol-dialog';
    element.setAttribute('data-stricterdom-ignore', '');
    element.innerHTML = `<header><h2>${title}</h2><button aria-label="关闭">×</button></header>${html}`;
    element.querySelector('header button').onclick = () => element.close();
    element.addEventListener(
      'close',
      () => {
        element.remove();
        if (previous?.isConnected) previous.focus({ preventScroll: true });
      },
      { once: true },
    );
    document.body.append(element);
    element.showModal();
    return element;
  }
  async function openSymbols(tab = 'sticker', insert, manage = false) {
    closeCommands();
    if (document.querySelector('.shiye-symbol-dialog[open]')) return;
    const editor = getEditor();
    pendingSticker = undefined;
    const element = makeDialog(
      manage ? '表情包管理与排序' : '表情与表情包',
      '<div class="shiye-symbol-tabs"><button data-tab="emoji">表情</button><button data-tab="sticker">我的表情包</button></div><div class="shiye-symbol-content"></div><p role="status"></p>',
    );
    const status = element.querySelector('[role=status]');
    if (manage) {
      element.classList.add('shiye-sticker-manager');
      element.querySelector('.shiye-symbol-tabs').hidden = true;
    }
    const content = element.querySelector('.shiye-symbol-content');
    let urls = [];
    let imageObservers = [];
    let generation = 0;
    function focusGrid(assetId) {
      requestAnimationFrame(() => {
        if (
          element.open &&
          assetId &&
          element.querySelector(`[data-sticker-id="${CSS.escape(assetId)}"]`)
        )
          element.querySelector(`[data-sticker-id="${CSS.escape(assetId)}"]`).focus();
        else if (element.open)
          element
            .querySelector(
              '.shiye-emoji-grid button, .shiye-sticker-grid .shiye-sticker-item > button',
            )
            ?.focus();
      });
    }
    function handleSymbolsKey(event) {
      if (!element.open || event.isComposing || event.keyCode === 229) return;
      if (!element.contains(document.activeElement)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        element.close();
        return;
      }
      const buttons = [
        ...element.querySelectorAll(
          '.shiye-emoji-grid button, .shiye-sticker-grid .shiye-sticker-item > button:first-child',
        ),
      ];
      const index = buttons.indexOf(document.activeElement);
      if (
        index < 0 ||
        !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter'].includes(event.key)
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === 'Enter') {
        buttons[index].click();
        return;
      }
      const columns = Math.max(
        1,
        buttons.filter((button) => Math.abs(button.offsetTop - buttons[0].offsetTop) < 2).length,
      );
      const delta =
        event.key === 'ArrowLeft'
          ? -1
          : event.key === 'ArrowRight'
            ? 1
            : event.key === 'ArrowUp'
              ? -columns
              : columns;
      const next = buttons[(index + delta + buttons.length) % buttons.length];
      next.focus({ preventScroll: true });
      next.scrollIntoView({ block: 'nearest' });
    }
    window.addEventListener('keydown', handleSymbolsKey, true);
    element.addEventListener(
      'close',
      () => window.removeEventListener('keydown', handleSymbolsKey, true),
      { once: true },
    );
    function release() {
      imageObservers.forEach((observer) => observer.disconnect());
      imageObservers = [];
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls = [];
    }
    element.addEventListener('close', () => {
      generation++;
      release();
    });
    async function render(nextTab, synchronize = true) {
      const focusedAsset = element.contains(document.activeElement)
        ? document.activeElement.dataset.stickerId || document.activeElement.dataset.orderId
        : undefined;
      const focusedAction = document.activeElement.dataset.orderAction;
      const ticket = ++generation;
      release();
      content.replaceChildren();
      status.textContent = '';
      for (const button of element.querySelectorAll('[data-tab]'))
        button.setAttribute('aria-pressed', String(button.dataset.tab === nextTab));
      if (nextTab === 'emoji') {
        const grid = document.createElement('div');
        grid.className = 'shiye-emoji-grid';
        for (const text of [...emoji].sort(
          (a, b) => (usage['emoji:' + b] || 0) - (usage['emoji:' + a] || 0),
        )) {
          const button = document.createElement('button');
          button.textContent = text;
          button.setAttribute('aria-label', `插入表情 ${text}`);
          button.onclick = () => {
            element.close();
            (insert || editor?.insert)?.(text);
            recordUsage('emoji:' + text);
          };
          grid.append(button);
        }
        content.append(grid);
        focusGrid();
        return;
      }
      const importLabel = document.createElement('label');
      importLabel.className = 'shiye-sticker-import';
      importLabel.textContent = '＋ 导入表情包（图片 / GIF）';
      importLabel.setAttribute('role', 'button');
      importLabel.tabIndex = 0;
      importLabel.title = '常见图片和动图；单个最多64 MiB；BMP自动转换为PNG';
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = 'image/*';
      input.style.display = 'none';
      importLabel.onkeydown = (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          input.click();
        }
      };
      importLabel.append(input);
      content.append(importLabel);
      if (manage) {
        const toolbar = document.createElement('div');
        toolbar.className = 'shiye-sticker-order-toolbar';
        const description = document.createElement('p');
        description.textContent = '上移、下移或置顶调整顺序，自动保留。/ 浏览也按此顺序显示。';
        const reset = document.createElement('button');
        reset.textContent = '恢复常用顺序';
        reset.onclick = () =>
          moveSticker(undefined, 'usage').catch((error) => {
            status.textContent = error.message;
          });
        const byName = document.createElement('button');
        byName.textContent = '按名称排列';
        byName.onclick = () =>
          moveSticker(undefined, 'name').catch((error) => {
            status.textContent = error.message;
          });
        const reverse = document.createElement('button');
        reverse.textContent = '反转顺序';
        reverse.onclick = () =>
          moveSticker(undefined, 'reverse').catch((error) => {
            status.textContent = error.message;
          });
        toolbar.append(description, byName, reverse, reset);
        content.append(toolbar);
      }
      const grid = document.createElement('div');
      grid.className = 'shiye-sticker-grid';
      if (manage) grid.classList.add('shiye-sticker-management-list');
      content.append(grid);
      input.onchange = async () => {
        input.disabled = true;
        try {
          for (let file of input.files) {
            if (window.shiyeDroppedMedia) file = await window.shiyeDroppedMedia.normalize(file);
            if (!file.type.startsWith('image/') || file.type === 'image/svg+xml')
              throw Error('请选择 PNG、JPEG、WebP、AVIF 或 GIF 图片。');
            if (file.size > 64 * 1024 * 1024) throw Error('表情包不能超过64 MiB');
            await window.shiyeLocalAssets.put({
              id: `sticker:${crypto.randomUUID()}`,
              name: file.name,
              blob: file,
            });
          }
          window.dispatchEvent(new Event('shiye-stickers-updated'));
          await render('sticker');
        } catch (error) {
          status.textContent = `导入失败：${error.message}。请检查本机存储空间。`;
          input.disabled = false;
        }
      };
      try {
        const assets = (await window.shiyeLocalAssets.list('sticker:')).filter(
          (asset) => asset.id.startsWith('sticker:') && !asset.removed,
        );
        stickerOrder = (await window.shiyeLocalAssets.get(stickerOrderKey)) || {};
        if (ticket !== generation || !element.open) return;
        if (!assets.length)
          status.textContent = '收藏图片或动图后，点击或 Enter 直接发送；方向键选择。';
        const sorted = sortStickers(assets);
        for (const [index, asset] of sorted.entries()) {
          const item = document.createElement('div');
          item.className = 'shiye-sticker-item';
          const button = document.createElement('button');
          button.title = asset.name;
          if (asset.note) button.title += '\n' + asset.note;
          button.dataset.stickerId = asset.id;
          button.setAttribute(
            'aria-label',
            `${manage ? '表情包缩略图' : '发送表情包'}：${asset.name}`,
          );
          const img = document.createElement('img');
          img.alt = asset.name;
          const loadImage = async () => {
            const blob = window.shiyeStickers
              ? await window.shiyeStickers.preview(asset)
              : asset.blob;
            if (ticket !== generation || !element.open) return;
            img.src = URL.createObjectURL(blob);
            urls.push(img.src);
          };
          {
            const observer = new IntersectionObserver((entries) => {
              if (!entries.some((entry) => entry.isIntersecting)) return;
              observer.disconnect();
              loadImage().catch((error) => {
                status.textContent = error.message;
              });
            });
            observer.observe(button);
            imageObservers.push(observer);
          }
          button.append(img);
          button.onclick = async () => {
            if (manage) return;
            button.disabled = true;
            try {
              const owned = window.shiyeStickers
                ? await window.shiyeStickers.materialize(asset)
                : asset;
              if (!editor) throw Error('请先打开一个会话');
              const file = new File([owned.blob], owned.name, { type: owned.blob.type });
              file.shiyeOriginalSticker = true;
              if (editor.sendSticker) {
                await editor.sendSticker(file);
                recordUsage(asset.id);
                element.close();
                editor.input?.focus({ preventScroll: true });
              } else {
                element.close();
                pendingSticker = asset.id;
                editor.files([file]);
              }
            } catch (error) {
              status.textContent = error.message;
              button.disabled = false;
            }
          };
          const remove = document.createElement('button');
          remove.className = 'shiye-sticker-remove';
          remove.textContent = '移除收藏';
          remove.onclick = async () => {
            try {
              if (window.shiyeStickers) await window.shiyeStickers.remove(asset);
              else await window.shiyeLocalAssets.remove(asset.id);
              await render('sticker');
            } catch {
              status.textContent = '移除失败，请重试。';
            }
          };
          const edit = document.createElement('button');
          edit.className = 'shiye-sticker-remove';
          edit.textContent = '编辑信息';
          edit.onclick = () => window.shiyeStickers?.promptEdit(asset);
          const name = document.createElement('span');
          name.className = 'shiye-sticker-name';
          name.textContent = asset.name;
          name.title = asset.note ? `${asset.name}\n${asset.note}` : asset.name;
          item.append(button, name);
          if (manage) {
            const controls = document.createElement('div');
            controls.className = 'shiye-sticker-order-controls';
            for (const [action, label] of [
              ['top', '置顶'],
              ['up', '上移'],
              ['down', '下移'],
              ['bottom', '置底'],
            ]) {
              const move = document.createElement('button');
              move.textContent = label;
              move.dataset.orderId = asset.id;
              move.dataset.orderAction = action;
              move.setAttribute('aria-label', `${label} ${asset.name}`);
              move.disabled =
                (['top', 'up'].includes(action) && index === 0) ||
                (['bottom', 'down'].includes(action) && index === sorted.length - 1);
              move.onclick = async () => {
                move.disabled = true;
                try {
                  await moveSticker(asset.id, action);
                } catch (error) {
                  status.textContent = error.message;
                  move.disabled = false;
                }
              };
              controls.append(move);
            }
            controls.append(edit, remove);
            item.append(controls);
          } else item.append(edit, remove);
          grid.append(item);
        }
        if (focusedAsset && focusedAction && manage) {
          requestAnimationFrame(() => {
            const selector = `[data-order-id="${CSS.escape(focusedAsset)}"][data-order-action="${focusedAction}"]:not(:disabled)`;
            const target =
              element.querySelector(selector) ||
              element.querySelector(`[data-sticker-id="${CSS.escape(focusedAsset)}"]`);
            target?.focus({ preventScroll: true });
            target?.scrollIntoView({ block: 'nearest' });
          });
        } else focusGrid(focusedAsset);
        if (synchronize && window.shiyeStickers?.canSync()) {
          const presentation = (records) =>
            JSON.stringify(
              records
                .filter((asset) => !asset.removed)
                .map((asset) => [asset.id, asset.name, asset.note])
                .sort((a, b) => a[0].localeCompare(b[0])),
            );
          const beforeSync = presentation(assets);
          window.shiyeStickers
            .sync()
            .then(async () => {
              const afterSync = presentation(await window.shiyeLocalAssets.list('sticker:'));
              if (ticket === generation && element.open && beforeSync !== afterSync)
                return render('sticker', false);
            })
            .catch((error) => {
              if (ticket === generation && element.open)
                status.textContent = '同步提示：' + error.message + '；本地收藏已保留。';
            });
        }
      } catch (error) {
        status.textContent = `读取表情包失败：${error.message}`;
      }
    }
    element.querySelectorAll('[data-tab]').forEach((button) => {
      button.onclick = () => render(button.dataset.tab);
    });
    const updated = () => {
      if (element.open) render('sticker', false);
    };
    window.addEventListener('shiye-stickers-updated', updated);
    element.addEventListener(
      'close',
      () => window.removeEventListener('shiye-stickers-updated', updated),
      { once: true },
    );
    await render(tab);
  }
  function closeCommands() {
    commandObserver?.disconnect();
    commandObserver = undefined;
    commandUrls.forEach((url) => URL.revokeObjectURL(url));
    commandUrls = [];
    panel?.remove();
    panel = undefined;
    const input = document.querySelector('#editable-message-text');
    input?.removeAttribute('aria-controls');
    input?.removeAttribute('aria-activedescendant');
    input?.removeAttribute('aria-expanded');
  }
  function markActive() {
    panel?.querySelectorAll('[role=option]').forEach((button, index) => {
      button.setAttribute('aria-selected', String(index === active));
      if (index === active) button.scrollIntoView({ block: 'nearest' });
    });
    getEditor()?.input.setAttribute('aria-activedescendant', `shiye-command-${active}`);
  }
  async function runCommand(command) {
    if (command?.asset) {
      const editor = getEditor();
      if (!editor || composing || sendingCommand || Date.now() < confirmUntil) return;
      const originalRange = editor.readSlash();
      sendingCommand = true;
      try {
        const current = await window.shiyeLocalAssets.get(command.asset.id);
        if (!current || current.removed) throw Error('表情包已移除，请重新选择');
        const asset = window.shiyeStickers
          ? await window.shiyeStickers.materialize(current)
          : current;
        if (!asset?.blob?.size) throw Error('表情包原件暂时不可用');
        const currentRange = editor.readSlash();
        if (
          getEditor()?.input !== editor.input ||
          document.activeElement !== editor.input ||
          composing ||
          !originalRange ||
          !currentRange ||
          currentRange.from !== originalRange.from ||
          currentRange.to !== originalRange.to ||
          currentRange.query !== originalRange.query
        )
          return;
        if (!editor.removeSlash()) return;
        closeCommands();
        const file = new File([asset.blob], asset.name, { type: asset.blob.type });
        file.shiyeOriginalSticker = true;
        if (editor.sendSticker) {
          await editor.sendSticker(file);
          recordUsage(asset.id);
        } else {
          pendingSticker = asset.id;
          editor.files([file]);
        }
      } catch (error) {
        if (panel) {
          let status = panel.querySelector('[role=status]');
          if (!status) {
            status = document.createElement('p');
            status.setAttribute('role', 'status');
            panel.append(status);
          }
          status.textContent = error.message;
        } else window.getActions?.()?.showNotification({ message: error.message });
      } finally {
        sendingCommand = false;
      }
      return;
    }
  }
  function updateCommands() {
    const editor = getEditor();
    if (
      !editor ||
      document.activeElement !== editor.input ||
      composing ||
      Date.now() < confirmUntil ||
      preferences.enabled === false ||
      document.querySelector('dialog[open]')
    ) {
      closeCommands();
      return;
    }
    const range = editor.readSlash();
    if (!range) {
      dismissed = undefined;
      closeCommands();
      return;
    }
    const signature = `${range.from}:${range.query}`;
    if (signature === dismissed) return;
    const normalize = (value) =>
      String(value || '')
        .normalize('NFKC')
        .toLowerCase()
        .trim();
    const query = normalize(range.query);
    const key = `${signature}:${collectionVersion}`;
    if (panel?.dataset.searchKey === key) return;
    const order = new Map(sortStickers(namedStickers).map((asset, index) => [asset.id, index]));
    matches = namedStickers
      .map((asset) => {
        const label = String(asset.name || '表情包');
        const names = [label, label.replace(/\.(png|jpe?g|gif|webp|avif)$/i, '')];
        if (preferences.mappings !== false)
          names.push(
            ...mappings
              .filter((alias) => alias.kind === 'sticker' && alias.assetId === asset.id)
              .map((alias) => alias.name),
          );
        const score = Math.max(
          ...names.map((name) => {
            const value = normalize(name);
            return !query
              ? 1
              : value === query
                ? 4
                : value.startsWith(query)
                  ? 3
                  : value.includes(query)
                    ? 2
                    : 0;
          }),
        );
        return { asset, label, score };
      })
      .filter((item) => item.score)
      .sort((a, b) => b.score - a.score || order.get(a.asset.id) - order.get(b.asset.id));
    closeCommands();
    active = 0;
    panel = document.createElement('div');
    panel.id = 'shiye-commands';
    panel.setAttribute('data-stricterdom-ignore', '');
    panel.className = 'shiye-command-panel';
    panel.dataset.searchKey = key;
    panel.setAttribute('role', 'listbox');
    panel.setAttribute('aria-label', '按名称选择表情包');
    const title = document.createElement('div');
    title.className = 'shiye-command-heading';
    title.textContent = '我的表情包 · ↑↓ 选择，Enter 发送，Esc 收起';
    panel.append(title);
    const options = document.createElement('div');
    options.className = 'shiye-command-options';
    const visibleCount = Math.max(1, Math.min(5, Number(preferences.visibleCount) || 5));
    options.style.setProperty('--shiye-visible-options', String(visibleCount));
    panel.append(options);
    if (!matches.length) {
      const empty = document.createElement('p');
      empty.setAttribute('role', 'status');
      empty.textContent = namedStickers.length
        ? '没有匹配的表情包，试试名称中的其他文字'
        : '收藏图片或 GIF 并命名后，可用 /名称 查找';
      panel.append(empty);
    }
    const owner = panel;
    commandObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        commandObserver?.unobserve(entry.target);
        const asset = matches[Number(entry.target.dataset.index)]?.asset;
        if (!asset) continue;
        const preview = window.shiyeStickers?.preview(asset) || Promise.resolve(asset.blob);
        Promise.resolve(preview)
          .then((blob) => {
            if (panel !== owner || !entry.target.isConnected || !blob) return;
            const url = URL.createObjectURL(blob);
            commandUrls.push(url);
            entry.target.querySelector('img').src = url;
          })
          .catch(() => {
            if (panel === owner) entry.target.dataset.previewFailed = 'true';
          });
      }
    });
    matches.forEach((command, index) => {
      const button = document.createElement('button');
      button.id = `shiye-command-${index}`;
      button.type = 'button';
      button.setAttribute('role', 'option');
      button.dataset.index = String(index);
      button.dataset.stickerId = command.asset.id;
      const image = document.createElement('img');
      image.alt = '';
      image.className = 'shiye-command-preview';
      const label = document.createElement('strong');
      label.textContent = command.label;
      const hint = document.createElement('small');
      hint.textContent =
        (command.asset.blob?.type || command.asset.media?.type) === 'image/gif' ? 'GIF' : '';
      button.title = command.label;
      button.append(image, label, hint);
      button.onpointerdown = (event) => event.preventDefault();
      button.onclick = () => runCommand(command);
      button.onpointermove = () => {
        active = index;
        markActive();
      };
      options.append(button);
      commandObserver.observe(button);
    });
    const bounds = editor.input.getBoundingClientRect();
    panel.style.left = `${Math.max(8, Math.min(bounds.left, innerWidth - 376))}px`;
    panel.style.bottom = `${Math.max(8, innerHeight - bounds.top + 10)}px`;
    panel.style.maxHeight = `${Math.max(100, bounds.top - 20)}px`;
    document.body.append(panel);
    editor.input.setAttribute('aria-controls', panel.id);
    editor.input.setAttribute('aria-expanded', 'true');
    if (matches.length) markActive();
  }
  document.addEventListener('input', () => setTimeout(updateCommands, 0), true);
  document.addEventListener('selectionchange', () => {
    if (panel) updateCommands();
  });
  document.addEventListener(
    'compositionstart',
    () => {
      composing = true;
      closeCommands();
    },
    true,
  );
  document.addEventListener(
    'compositionend',
    () => {
      composing = false;
      confirmUntil = Date.now() + 80;
      setTimeout(updateCommands, 90);
    },
    true,
  );
  window.addEventListener(
    'keydown',
    (event) => {
      if (
        !panel ||
        composing ||
        event.isComposing ||
        event.keyCode === 229 ||
        Date.now() < confirmUntil
      )
        return;
      if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
      if (
        document.activeElement !== getEditor()?.input ||
        document.querySelector('dialog[open], .Modal.open')
      )
        return;
      if (
        !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape'].includes(event.key)
      )
        return;
      if (!matches.length && !['Enter', 'Escape'].includes(event.key)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === 'Escape') {
        const range = getEditor()?.readSlash();
        dismissed = range && `${range.from}:${range.query}`;
        closeCommands();
      } else if (event.key === 'Enter') {
        if (matches.length) runCommand(matches[active]);
      } else {
        active =
          (active + (['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : -1) + matches.length) %
          matches.length;
        markActive();
      }
    },
    true,
  );
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (panel && !panel.contains(event.target)) closeCommands();
    },
    true,
  );
  window.addEventListener('resize', closeCommands);
  window.addEventListener('shiye-stickers-updated', () => refreshMappings().catch(() => {}));
  window.addEventListener('shiye-open-symbols', (event) =>
    openSymbols('sticker', event.detail?.insert),
  );
  window.addEventListener('shiye-open-sticker-manager', () =>
    openSymbols('sticker', undefined, true),
  );
  async function openMappingManager() {
    const element = window.shiyeSettingsUi.open({
      page: 'mappings',
      title: '自定义 / 表情映射',
      content:
        '<p>例如 /开心 → 😊，/猫猫 → 本地表情包。确认命令后，emoji插入正文，表情包直接发送。</p><form class="shiye-mapping-form"><label>命令名称<input name="alias" type="text" required maxlength="25" placeholder="例如 /开心"></label><label>映射到<select name="kind"><option value="emoji">Emoji</option><option value="sticker">本地表情包</option></select></label><label data-emoji>Emoji<input name="value" type="text" placeholder="输入或粘贴一个 emoji" maxlength="32" value="😊" required></label><label data-sticker hidden>选择表情包<select name="asset"></select></label><p role="status"></p><div class="shiye-actions"><button type="button" data-new>新建映射</button><button type="submit">保存映射</button></div></form><div class="shiye-mapping-list"></div>',
      explicit: true,
    });
    if (element.dataset.settingsRestored === 'true') return;
    const form = element.querySelector('form');
    const status = form.querySelector('[role=status]');
    const list = element.querySelector('.shiye-mapping-list');
    let editing;
    let urls = [];
    element.addEventListener('close', () => urls.forEach((url) => URL.revokeObjectURL(url)));
    function setKind() {
      const sticker = form.elements.kind.value === 'sticker';
      form.querySelector('[data-emoji]').hidden = sticker;
      form.querySelector('[data-sticker]').hidden = !sticker;
      form.elements.value.required = !sticker;
      form.elements.asset.required = sticker;
      form.elements.asset.disabled = !sticker;
      form.elements.value.disabled = sticker;
    }
    function reset() {
      editing = undefined;
      form.reset();
      status.textContent = '';
      setKind();
    }
    form.elements.kind.onchange = setKind;
    form.querySelector('[data-new]').onclick = reset;
    async function render() {
      await refreshMappings();
      if (!element.open) return;
      const assets = await window.shiyeLocalAssets.list('sticker:');
      const stickers = assets.filter((asset) => asset.id.startsWith('sticker:') && !asset.removed);
      form.elements.asset.replaceChildren(new Option('请选择已导入的表情包', ''));
      stickers.forEach((asset) => form.elements.asset.add(new Option(asset.name, asset.id)));
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls = [];
      list.replaceChildren();
      for (const mapping of mappings) {
        const row = document.createElement('div');
        row.className = 'shiye-mapping-row';
        const label = document.createElement('span');
        label.textContent = `/${mapping.name}`;
        const preview = document.createElement('span');
        preview.className = 'shiye-mapping-preview';
        const asset = stickers.find((item) => item.id === mapping.assetId);
        if (mapping.kind === 'emoji') preview.textContent = mapping.value;
        else if (asset) {
          const image = document.createElement('img');
          image.alt = asset.name;
          image.src = URL.createObjectURL(asset.blob);
          urls.push(image.src);
          preview.append(image);
        } else preview.textContent = '素材已移除';
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.textContent = '编辑';
        edit.onclick = () => {
          editing = mapping.id;
          form.elements.alias.value = mapping.name;
          form.elements.kind.value = mapping.kind;
          form.elements.value.value = mapping.value || '';
          form.elements.asset.value = mapping.assetId || '';
          setKind();
          status.textContent = '';
          form.elements.alias.focus();
        };
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = '删除映射';
        remove.onclick = async () => {
          try {
            await window.shiyeLocalAssets.remove(mapping.id);
            if (editing === mapping.id) reset();
            await render();
          } catch {
            status.textContent = '删除映射失败，请重试';
          }
        };
        row.append(preview, label, edit, remove);
        list.append(row);
      }
      if (!mappings.length)
        list.textContent = '还没有自定义映射。表情包先从输入框笑脸 → 我的表情包导入。';
    }
    form.onsubmit = async (event) => {
      event.preventDefault();
      const button = element.querySelector('[type=submit]');
      button.disabled = true;
      try {
        const name = normalizeAlias(form.elements.alias.value);
        const kind = form.elements.kind.value;
        const value = form.elements.value.value.trim();
        if (
          kind === 'emoji' &&
          (!/\p{Extended_Pictographic}|\p{Regional_Indicator}|[0-9#*]\ufe0f?\u20e3/u.test(value) ||
            [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)]
              .length !== 1)
        )
          throw Error('请填一个完整的 emoji，可以包含肤色或组合符号');
        const assetId = form.elements.asset.value;
        if (kind === 'sticker' && !(await window.shiyeLocalAssets.get(assetId))?.blob)
          throw Error('请先导入并选择本地表情包');
        await window.shiyeLocalAssets.saveMapping(
          {
            id: `mapping:${name}`,
            name,
            kind,
            value: kind === 'emoji' ? value : undefined,
            assetId: kind === 'sticker' ? assetId : undefined,
          },
          editing,
        );
        reset();
        await render();
        status.textContent = '映射已保存';
        window.shiyeSettingsUi.saved(element);
      } catch (error) {
        status.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    };
    window.shiyeSettingsUi.bindForm(element, form);
    setKind();
    try {
      await render();
    } catch {
      status.textContent = '读取本地映射失败，请重试';
    }
  }
  window.addEventListener('shiye-open-mappings', openMappingManager);
  window.addEventListener('shiye-open-input-settings', () => {
    const element = window.shiyeSettingsUi.open({
      page: 'input',
      title: '表情包',
      content:
        '<button data-manage>管理表情包：名称、备注与排序</button><p>输入 / 后面的文字查找收藏名称，方向键选择，Enter 直接发送。候选默认同时显示5条，更多结果向下滚动；中文组词确认不会发送。</p><div class="shiye-command-settings"></div><label>同时显示的候选数量<select data-visible-count><option value="1">1条</option><option value="2">2条</option><option value="3">3条</option><option value="4">4条</option><option value="5">5条</option></select></label><button data-mappings>管理已有别名映射</button><p>收藏时设置名称即可检索，无须另建映射。旧 emoji 映射保留，但不出现在 / 候选中。</p>',
    });
    if (element.dataset.settingsRestored === 'true') return;
    element.querySelector('[data-manage]').onclick = () => openSymbols('sticker', undefined, true);
    const count = element.querySelector('[data-visible-count]');
    count.value = String(Math.max(1, Math.min(5, Number(preferences.visibleCount) || 5)));
    count.onchange = () => {
      preferences.visibleCount = Number(count.value);
      localStorage.setItem(preferenceKey, JSON.stringify(preferences));
      closeCommands();
    };
    element.querySelector('[data-mappings]').onclick = () => openMappingManager();
    const container = element.querySelector('.shiye-command-settings');
    for (const item of [
      { id: 'enabled', label: '启用 / 表情包名称检索' },
      { id: 'mappings', label: '同时匹配已有表情包别名' },
    ]) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = preferences[item.id] !== false;
      input.dataset.command = item.id;
      input.onchange = () => {
        preferences[item.id] = input.checked;
        localStorage.setItem(preferenceKey, JSON.stringify(preferences));
        closeCommands();
      };
      label.append(input, document.createTextNode(item.label));
      container.append(label);
    }
  });
})();
