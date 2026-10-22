/* Local program deliveries. No Telegram requests, no default shortcuts, no scheduler startup. */
(async () => {
  const { historyDate, REVISIT_VIEW_KEY, REVISIT_DATE_STYLES } =
    await import('./shiye-revisit-view.js?v=20261017-mode-switch1');
  const roomId = '-900000001';
  const clients = new Map();
  const currentRoom = () => String(window.shiyeRoomUi?.currentId() || roomId);
  const activeRecord = () =>
    [...clients.values()].find((item) => item.roomId === currentRoom() && item.active) ||
    [...clients.values()].find((item) => item.roomId === currentRoom());
  const serviceApi = async (instanceId, action, payload = {}) => {
    const response = instanceId
      ? await window.shiyeJournal.services('request', { instanceId, action, payload })
      : await window.shiyeJournal.program(action, payload);
    if (instanceId && response?.scope?.instanceId !== instanceId)
      throw Error('回看响应的实例身份不一致');
    return response;
  };
  let batches = [],
    deliveries = [],
    lastError = '',
    target;
  const api = (action, payload) => window.shiyeJournal.program(action, payload);
  const command = (action, payload) => window.shiyeRoomUi.command(action, payload);
  const indicator = document.createElement('button');
  indicator.className = 'shiye-revisit-target';
  indicator.type = 'button';
  indicator.title = '引用消息时以引用目标为准；新推送不会改动当前评论对象';
  indicator.hidden = true;
  const feedback = document.createElement('div');
  feedback.className = 'shiye-revisit-feedback';
  feedback.hidden = true;
  feedback.setAttribute('role', 'status');
  feedback.setAttribute('aria-live', 'polite');
  const errorText = document.createElement('span');
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = '重试';
  retry.onclick = async () => {
    retry.disabled = true;
    try {
      await sync();
    } finally {
      retry.disabled = false;
    }
  };
  feedback.append(errorText, retry);
  let composing = false;
  let compositionUntil = 0;
  let roomMetadata;
  let lifecycleNotice;
  let dateStyle = 'system';
  try {
    const saved = localStorage.getItem(REVISIT_VIEW_KEY);
    if (REVISIT_DATE_STYLES.includes(saved)) dateStyle = saved;
  } catch {
    /* A blocked preference store does not block reading. */
  }
  let historyMessages = new Map();
  let viewZone = 'Asia/Shanghai';
  let viewFrame;
  let displayNotice;
  let noticeTimer;
  let noticeVisibleUntil = 0;
  const noticeNode = document.createElement('div');
  noticeNode.className = 'shiye-revisit-date-note';
  noticeNode.setAttribute('role', 'status');
  noticeNode.setAttribute('aria-live', 'polite');
  function consumeNotice(notice) {
    if (
      !['history-day', 'history-interval'].includes(notice?.kind) ||
      (notice.kind === 'history-day' &&
        notice.displayDate !== null &&
        !/^\d{2}-\d{2}-\d{2}$/.test(notice.displayDate))
    )
      return;
    displayNotice = notice;
    noticeVisibleUntil = Date.now() + 4000;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      noticeVisibleUntil = 0;
      noticeNode.remove();
    }, 4000);
    refreshHistoryView();
  }
  window.addEventListener('shiye-revisit-notice', ({ detail }) => consumeNotice(detail));
  window.addEventListener('shiye-revisit-notice-clear', () => {
    displayNotice = undefined;
    noticeVisibleUntil = 0;
    clearTimeout(noticeTimer);
    noticeNode.remove();
    refreshHistoryView();
  });
  window.addEventListener('shiye-room-switch-start', () => {
    noticeVisibleUntil = 0;
    clearTimeout(noticeTimer);
    noticeNode.remove();
  });
  window.addEventListener('shiye-room-view-ready', () => {
    if (activeRecord()) consumeNotice(window.shiyeRevisit?.readNotice());
    refreshTarget();
    library()
      .then(updateHistory)
      .then(refreshHistoryView)
      .catch(() => {});
  });
  function refreshHistoryView() {
    if (viewFrame) return;
    viewFrame = requestAnimationFrame(() => {
      viewFrame = undefined;
      if (document.body.dataset.shiyeRevisitDateStyle !== dateStyle)
        document.body.dataset.shiyeRevisitDateStyle = dateStyle;
      const inRoom = Boolean(activeRecord());
      for (const old of document.querySelectorAll('.shiye-revisit-date-note')) {
        if (old !== noticeNode) old.remove();
      }
      for (const node of document.querySelectorAll('#MiddleColumn .Message[data-message-id]')) {
        const item = inRoom && historyMessages.get(Number(node.dataset.messageId));
        if (!item) {
          delete node.dataset.shiyeHistoryDate;
          const wrapper = node.querySelector(':scope > .message-content-wrapper');
          if (wrapper) delete wrapper.dataset.shiyeHistoryDate;
          continue;
        }
        const date = historyDate(item.originalAt, item.timeZone);
        if (node.dataset.shiyeHistoryDate !== date) node.dataset.shiyeHistoryDate = date;
        const wrapper = node.querySelector(':scope > .message-content-wrapper');
        if (wrapper && wrapper.dataset.shiyeHistoryDate !== date)
          wrapper.dataset.shiyeHistoryDate = date;
      }
      const list = document.querySelector('#MiddleColumn .Transition_slide-active > .MessageList');
      const layer = list?.parentElement;
      if (
        inRoom &&
        dateStyle === 'system' &&
        displayNotice &&
        Date.now() < noticeVisibleUntil &&
        layer
      ) {
        const unit = { year: '年', month: '个月', day: '天' }[displayNotice.interval?.unit];
        const text =
          displayNotice.kind === 'history-interval'
            ? `正在回看每隔 ${displayNotice.interval.count} ${unit}的往日记录`
            : displayNotice.displayDate
              ? `正在回看 ${displayNotice.displayDate}`
              : '暂无可回看的日期';
        if (noticeNode.textContent !== text) noticeNode.textContent = text;
        if (noticeNode.parentElement !== layer) layer.append(noticeNode);
      } else noticeNode.remove();
    });
  }
  function visible(element) {
    return Boolean(element?.getClientRects().length);
  }
  function currentFooter() {
    return [...document.querySelectorAll('#MiddleColumn .middle-column-footer')].find(visible);
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
      compositionUntil = Date.now() + 120;
    },
    true,
  );
  function hasDraft() {
    if (composing || Date.now() < compositionUntil) return true;
    const footer = currentFooter();
    const editors = [
      ...(footer?.querySelectorAll('[contenteditable="true"]') || []),
      ...document.querySelectorAll('.shiye-attachment-modal [contenteditable="true"]'),
    ];
    return (
      editors.some(
        (input) => visible(input) && (input.textContent || input.querySelector('img')),
      ) ||
      [
        ...document.querySelectorAll(
          '.shiye-attachment-modal, .shiye-attachment-modal .modal-dialog',
        ),
      ].some(visible)
    );
  }
  function refreshTarget() {
    const current = activeRecord();
    if (current) {
      ({ batches, deliveries, target, lastError } = current.client.status());
      lifecycleNotice = current.notice;
    } else {
      batches = [];
      deliveries = [];
      target = undefined;
      lastError = '';
    }
    const footer = currentFooter();
    const inRevisit = Boolean(current);
    if (document.body.dataset.shiyeRevisitRoom !== String(inRevisit))
      document.body.dataset.shiyeRevisitRoom = String(inRevisit);
    const show = inRevisit && Boolean(footer);
    if (show && indicator.parentElement !== footer) footer.prepend(indicator, feedback);
    // Replies use the normal chat quote UI. Keep the legacy selector internal.
    if (!indicator.hidden) indicator.hidden = true;
    refreshHistoryView();
    const showError = Boolean(show && lastError);
    if (feedback.hidden === showError) feedback.hidden = !showError;
    const errorMessage = lastError
      ? `回看同步未完成：${String(lastError).slice(0, 200)}。待发内容仍保留。`
      : '';
    if (errorText.textContent !== errorMessage) errorText.textContent = errorMessage;
    const batch = batches.find((item) => item.id === target?.batchId);
    const stamp = batch
      ? new Date(batch.replayAt).toLocaleString('zh-CN', {
          timeZone: batch.timeZone,
          month: 'numeric',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : '';
    const text = target
      ? `正在评论：${target.deliveryId ? '所选一条旧记录' : `${stamp}组（${batch?.targets.length || 0}条）`} · 点击切换`
      : '朝花夕拾 · 请选择评论对象';
    if (indicator.textContent !== text) indicator.textContent = text;
  }
  const { createRevisitClient } =
    await import('./shiye-revisit-client.js?v=20261019-reedit47');
  function registerClient(destination, instanceId, active = true) {
    const key = instanceId || 'legacy';
    const existing = clients.get(key);
    if (existing) {
      existing.active = active;
      return existing;
    }
    const record = { roomId: String(destination), instanceId, active, notice: null };
    record.client = createRevisitClient({
      roomId: record.roomId,
      instanceId,
      api: (action, payload) => serviceApi(instanceId, action, payload),
      command,
      readLibrary: library,
      isComposing: () => currentRoom() === record.roomId && hasDraft(),
      onNotice(notice) {
        record.notice = notice;
        if (activeRecord() !== record) return;
        lifecycleNotice = notice;
        window.dispatchEvent(
          new CustomEvent(notice ? 'shiye-revisit-notice' : 'shiye-revisit-notice-clear', {
            detail: notice,
          }),
        );
      },
      async decorateMedia(media) {
        if (media.type.startsWith('image/') && media.type !== 'image/gif') {
          const bitmap = await createImageBitmap(new Blob([media.bytes], { type: media.type }));
          media.width = bitmap.width;
          media.height = bitmap.height;
          bitmap.close();
        }
        return media;
      },
      onState(state) {
        invalidateSourceViews(state);
        if (activeRecord() !== record) return;
        ({ batches, deliveries, target, lastError } = state);
        if (state.locked || state.config?.enabled === false) {
          lifecycleNotice = undefined;
          historyMessages.clear();
          window.dispatchEvent(new CustomEvent('shiye-revisit-notice-clear'));
        }
        viewZone = state.timeZone || viewZone;
        refreshTarget();
      },
    });
    clients.set(key, record);
    return record;
  }
  const client = registerClient(roomId).client;
  const select = (...args) => (activeRecord()?.client || client).select(...args);
  function dialog(title) {
    const el = document.createElement('dialog');
    el.className = 'shiye-revisit-dialog';
    const heading = document.createElement('h2');
    heading.textContent = title;
    const close = document.createElement('button');
    close.textContent = '关闭';
    close.onclick = () => el.close();
    el.append(heading, close);
    el.addEventListener('close', () => el.remove(), { once: true });
    document.body.append(el);
    el.showModal();
    return el;
  }
  function button(el, text, run) {
    const b = document.createElement('button');
    b.textContent = text;
    b.type = 'button';
    b.onclick = () =>
      Promise.resolve(run()).catch((error) => {
        lastError = error.message;
        const p = document.createElement('p');
        p.textContent = lastError;
        p.role = 'status';
        el.append(p);
      });
    el.append(b);
    return b;
  }
  indicator.onclick = () => {
    const el = dialog('评论哪一组往日记录');
    if (batches.length)
      button(el, '最近展示的一组（无草稿时跟随）', async () => {
        if (await select(batches.at(-1).id, undefined, true)) el.close();
      });
    for (const batch of [...batches].reverse()) {
      button(
        el,
        `${new Date(batch.replayAt).toLocaleString('zh-CN', { timeZone: batch.timeZone })} · ${batch.targets.length}条`,
        async () => {
          if (await select(batch.id)) el.close();
        },
      );
    }
    if (!batches.length) {
      const p = document.createElement('p');
      p.textContent = '尚未收到回看记录';
      el.append(p);
    }
  };
  async function library() {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('shiye-telegram-preview-v1', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('preview');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const r = db.transaction('preview').objectStore('preview').get('library');
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    } finally {
      db.close();
    }
  }
  let serviceRouting = Promise.resolve();
  function syncServices(catalog) {
    const next = serviceRouting.catch(() => {}).then(() => applyServiceCatalog(catalog));
    serviceRouting = next;
    return next;
  }
  async function applyServiceCatalog(catalog) {
    if (!window.shiyeJournal?.services || !window.shiyeJournal?.sourceId) return;
    const sourceId = await window.shiyeJournal.sourceId();
    catalog ||= await window.shiyeJournal.services('catalog');
    const prefix = `desktop:${sourceId}:`;
    const bindings = (catalog.bindings || [])
      .filter((item) => item.conversationId?.startsWith(prefix))
      .map((item) => ({
        ...item,
        roomId: item.conversationId.slice(prefix.length),
        providerId: catalog.instances?.find((instance) => instance.id === item.instanceId)
          ?.providerId,
      }));
    await command('program-bindings', { bindings, replaceActive: true });
    const snapshot = await library();
    for (const record of clients.values()) if (record.instanceId) record.active = false;
    for (const [instanceId, saved] of Object.entries(snapshot?.shiyeServiceStates || {})) {
      if (saved.providerId !== 'revisit' || !saved.roomId) continue;
      registerClient(saved.roomId, instanceId, Boolean(saved.active));
    }
    refreshTarget();
  }
  let syncingServices;
  function discoverServices() {
    if (!syncingServices)
      syncingServices = syncServices().finally(() => {
        syncingServices = undefined;
      });
    return syncingServices;
  }
  async function updateHistory(snapshot) {
    const selectedRoom = currentRoom();
    const entries = [...clients.values()].filter((item) => item.roomId === selectedRoom);
    historyMessages = new Map(
      (snapshot?.messages?.[selectedRoom] || []).flatMap((message) => {
        const record = entries.find(
          (item) =>
            (item.instanceId || undefined) === (message.shiyeProgram?.instanceId || undefined),
        );
        const state = record?.client.status();
        const delivery = state?.deliveries.find(
          (item) => item.id === message.shiyeProgram?.deliveryId,
        );
        return delivery
          ? [[message.id, { ...delivery, timeZone: state.timeZone || viewZone }]]
          : [];
      }),
    );
  }
  async function sync(options) {
    try {
      // Recover cached scopes even while catalog access is locked, so every stored
      // source cache is still cleared by the authenticated instance request.
      const local = await library();
      for (const [instanceId, saved] of Object.entries(local?.shiyeServiceStates || {})) {
        if (saved.providerId === 'revisit' && saved.roomId)
          registerClient(saved.roomId, instanceId, Boolean(saved.active));
      }
      try {
        await discoverServices();
      } catch (error) {
        lastError = error.message;
      }
      for (const record of clients.values()) {
        try {
          // Historical instances remain addressable after unbinding. Their outbox never
          // falls back to the newly selected service.
          if (record.active) await record.client.sync(options);
          else await record.client.sync({ ...options, historical: true });
        } catch (error) {
          if ([401, 403].includes(error.status)) {
            await command('program-clear', {
              roomId: record.roomId,
              instanceId: record.instanceId,
              providerId: 'revisit',
            });
            invalidateSourceViews({ locked: true });
          }
        }
      }
      // Worker updates already deliver changed messages. Reloading every chat after an
      // unchanged poll replaces list data and can recreate old message nodes.
      const snapshot = await library();
      await updateHistory(snapshot);
      refreshHistoryView();
      const room = snapshot?.shiyeRooms?.[roomId];
      const sender = snapshot?.users?.find((item) => item.shiyeProgramUser === 'revisit');
      const metadata = JSON.stringify([room?.title, sender?.firstName, sender?.lastName]);
      if (room && metadata !== roomMetadata) {
        roomMetadata = metadata;
        window.dispatchEvent(new CustomEvent('shiye-refresh-rooms', { detail: {} }));
      }
    } catch (error) {
      lastError = error.message;
    } finally {
      refreshTarget();
    }
  }
  function safeHTML(html) {
    const parsed = new DOMParser().parseFromString(html || '', 'text/html');
    const allowed = new Set(
      'P BR STRONG B EM I U S DEL MARK SPAN H1 H2 H3 H4 H5 H6 UL OL LI BLOCKQUOTE HR PRE CODE TABLE THEAD TBODY TR TH TD FIGURE FIGCAPTION IMG VIDEO A DETAILS SUMMARY'.split(
        ' ',
      ),
    );
    for (const el of [...parsed.body.querySelectorAll('*')]) {
      if (!allowed.has(el.tagName)) {
        el.remove();
        continue;
      }
      const src = el.getAttribute('src'),
        href = el.getAttribute('href');
      for (const attr of [...el.attributes]) el.removeAttribute(attr.name);
      if (['IMG', 'VIDEO'].includes(el.tagName) && /^\/media\/[a-zA-Z0-9._%-]+$/.test(src || ''))
        el.dataset.assetId = decodeURIComponent(src.slice(7));
      if (el.tagName === 'VIDEO') {
        el.controls = true;
        el.preload = 'metadata';
      }
      if (el.tagName === 'A' && /^(https?:|mailto:)/i.test(href || '')) {
        el.href = href;
        el.rel = 'noopener noreferrer';
        el.target = '_blank';
      }
    }
    return document.importNode(parsed.body, true);
  }
  const sourceViews = new Set();
  let sourceAccessEpoch = 0;
  function invalidateSourceViews(state) {
    if (!state.locked) return;
    sourceAccessEpoch += 1;
    for (const view of sourceViews) view.close();
  }
  async function openSource(id, scope = {}) {
    const accessEpoch = sourceAccessEpoch;
    const source = await serviceApi(scope.instanceId, 'source', { deliveryId: id });
    const sourceClient = (
      clients.get(scope.instanceId || 'legacy') ||
      registerClient(scope.roomId || roomId, scope.instanceId, false)
    ).client;
    if (accessEpoch !== sourceAccessEpoch) return;
    const el = dialog(source.title || '原日记 · 只读');
    sourceViews.add(el);
    const content = document.createElement('article');
    content.append(safeHTML(source.html));
    el.append(content);
    const urls = new Set();
    let contentRevision = 0;
    function releaseMedia() {
      contentRevision += 1;
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    }
    el.addEventListener(
      'close',
      () => {
        releaseMedia();
        content.replaceChildren();
        sourceViews.delete(el);
      },
      { once: true },
    );
    button(el, '展开整篇原日记（只读）', async () => {
      releaseMedia();
      content.replaceChildren(safeHTML(source.entryHtml || source.html));
      await fillMedia();
    });
    async function fillMedia() {
      const revision = contentRevision;
      for (const media of content.querySelectorAll('[data-asset-id]')) {
        try {
          const value = await sourceClient.mediaBytes(id, media.dataset.assetId, 256 * 1024 * 1024);
          if (!el.open || revision !== contentRevision || !media.isConnected) return;
          const url = URL.createObjectURL(new Blob([value.bytes], { type: value.type }));
          urls.add(url);
          media.src = url;
        } catch {
          media.replaceWith(document.createTextNode('媒体暂不可查看'));
        }
      }
    }
    await fillMedia();
    for (const comment of source.comments || []) {
      const p = document.createElement('p');
      p.textContent = `${new Date(comment.createdAt).toLocaleString('zh-CN', { timeZone: source.timeZone === 'system' ? undefined : source.timeZone || 'Asia/Shanghai' })} · ${comment.text}`;
      el.append(p);
    }
  }
  document.addEventListener(
    'click',
    (event) => {
      const link = event.target.closest?.('a[href]');
      if (!link) return;
      let url;
      try {
        url = new URL(link.href);
      } catch {
        return;
      }
      if (url.origin !== 'https://shiye-preview.local' || !url.pathname.startsWith('/revisit/'))
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const messageId = Number(link.closest('.Message[data-message-id]')?.dataset.messageId);
      const destination = currentRoom();
      library()
        .then((snapshot) => {
          const message = snapshot?.messages?.[destination]?.find((item) => item.id === messageId);
          if (destination !== roomId && !message?.shiyeProgram) throw Error('回看来源身份已失效');
          return openSource(decodeURIComponent(url.pathname.slice(9)), {
            ...message?.shiyeProgram,
            roomId: destination,
          });
        })
        .catch((error) => {
          const el = dialog('回看来源');
          const p = document.createElement('p');
          p.textContent = error.message;
          el.append(p);
        });
    },
    true,
  );
  window.addEventListener('shiye-revisit-source', async ({ detail }) => {
    const snapshot = await library();
    const destination = String(detail?.roomId || currentRoom());
    const message = snapshot?.messages?.[destination]?.find(
      (item) => item.id === detail?.messageId,
    );
    if (message?.shiyeProgram?.deliveryId)
      await openSource(message.shiyeProgram.deliveryId, {
        ...message.shiyeProgram,
        roomId: destination,
      });
  });
  window.addEventListener('shiye-open-revisit', async () => {
    const el = dialog('朝花夕拾 · 本会话推送与回看');
    el.classList.add('shiye-revisit-settings');
    const actions = document.createElement('div');
    actions.className = 'shiye-revisit-actions';
    const close = el.querySelector('button');
    const body = document.createElement('div');
    body.className = 'shiye-revisit-settings-body';
    actions.append(close);
    el.append(body, actions);
    const status = document.createElement('p');
    status.role = 'status';
    body.append(status);
    const appearance = document.createElement('label');
    appearance.textContent = '历史日期显示';
    const style = document.createElement('select');
    for (const [value, label] of [
      ['system', '切换日期时提示一次'],
      ['date', '每条显示简短日期'],
      ['none', '不显示历史日期'],
    ]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      style.append(option);
    }
    style.value = dateStyle;
    style.onchange = () => {
      dateStyle = style.value;
      try {
        localStorage.setItem(REVISIT_VIEW_KEY, dateStyle);
      } catch {
        /* Local preference only. */
      }
      refreshHistoryView();
      if (dateStyle === 'system') consumeNotice(window.shiyeRevisit.readNotice());
    };
    appearance.append(style);
    body.append(appearance);
    const refresh = button(actions, '刷新回看', async () => {
      refresh.disabled = true;
      try {
        await window.shiyeRevisit.refresh();
        status.textContent = lastError
          ? '回看刷新未完成，请确认后台可用。'
          : '已刷新当前回看规则和来信。';
      } finally {
        refresh.disabled = false;
      }
    });
    try {
      const { config, categories } = await api('status');
      for (const item of historyMessages.values()) item.timeZone = config.timeZone;
      const form = document.createElement('form');
      form.id = `shiye-revisit-config-${Date.now()}`;
      form.innerHTML =
        '<label class="shiye-revisit-enable"><input name="enabled" type="checkbox"><strong>开启朝花夕拾</strong><span>修改后点击“保存设置”生效。关闭只停止后续推送，保留历史消息、评论和推送进度。</span></label><label>群聊名称<input name="title" maxlength="80" required></label><label>发送者名称<input name="sender" maxlength="80" required></label><label>回看间隔<input name="count" type="number" min="1" max="3660" required><select name="unit"><option value="year">年</option><option value="month">月</option><option value="day">天</option></select></label><label>时区<select name="zone"><option value="Asia/Shanghai">北京时间</option><option value="system">系统时间</option></select></label><p>会回看所有更早整数倍间隔的记录。初次从程序启动时刻开始，缺失日期跳过；旧日记保持原样。已启用规则随拾页后台自动运行；过去时段可手动补看。</p><button type="submit">保存设置</button>';
      const field = (name) => form.elements.namedItem(name);
      const modeLabel = document.createElement('label');
      modeLabel.textContent = '回看方式';
      const mode = document.createElement('select');
      mode.name = 'mode';
      for (const [value, title] of [
        ['daily-random', '每日随机回看一天'],
        ['interval', '按年／月／日间隔回看'],
      ]) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = title;
        mode.append(option);
      }
      mode.value = config.mode || 'interval';
      modeLabel.append(mode);
      const timeLabel = document.createElement('label');
      timeLabel.textContent = '每天更换日期的时间（所选时区）';
      const dailyTime = document.createElement('input');
      dailyTime.name = 'dailyTime';
      dailyTime.type = 'time';
      dailyTime.required = true;
      dailyTime.value = config.dailyTime || '08:00';
      timeLabel.append(dailyTime);
      form.prepend(modeLabel, timeLabel);
      const randomHint = document.createElement('p');
      randomHint.textContent =
        '随机选择一个有记录的历史日期，按原时间推送24小时。08:00换日时，凌晨记录会在次日凌晨出现；重启不会重新抽选。';
      form.append(randomHint);
      const sourceRange = document.createElement('fieldset');
      const rangeLegend = document.createElement('legend');
      rangeLegend.textContent = '历史日期范围（包含起止日期，留空不限）';
      sourceRange.append(rangeLegend);
      const rangeFields = {};
      for (const [name, title] of [
        ['sourceDateFrom', '开始日期'],
        ['sourceDateTo', '结束日期'],
      ]) {
        const label = document.createElement('label');
        label.textContent = title;
        const input = document.createElement('input');
        input.type = 'date';
        input.name = name;
        input.value = config[name] || '';
        rangeFields[name] = input;
        label.append(input);
        sourceRange.append(label);
      }
      form.append(sourceRange);
      mode.onchange = () => {
        timeLabel.hidden = randomHint.hidden = mode.value !== 'daily-random';
        sourceRange.hidden = mode.value !== 'daily-random';
        field('count').closest('label').hidden = mode.value === 'daily-random';
        field('zone').closest('label').nextElementSibling.hidden = mode.value === 'daily-random';
      };
      mode.onchange();
      field('enabled').checked = config.enabled;
      field('title').value = config.title;
      field('sender').value = config.sender.name;
      field('count').value = config.interval.count;
      field('unit').value = config.interval.unit;
      field('zone').value = config.timeZone;
      const categoryLabel = document.createElement('label');
      categoryLabel.textContent = '回看分类（不选则包含全部分类）';
      const categorySelect = document.createElement('select');
      categorySelect.multiple = true;
      categorySelect.size = Math.min(5, Math.max(2, categories?.length || 2));
      for (const category of categories || []) {
        const option = document.createElement('option');
        option.value = option.textContent = category;
        option.selected = config.categories.includes(category);
        categorySelect.append(option);
      }
      categoryLabel.append(categorySelect);
      form.insertBefore(categoryLabel, form.querySelector('button'));
      const save = form.querySelector('button[type="submit"]');
      save.setAttribute('form', form.id);
      actions.prepend(save);
      form.onsubmit = async (event) => {
        event.preventDefault();
        if (save.disabled) return;
        save.disabled = true;
        try {
          const next = await api('config', {
            expectedRevision: config.revision,
            mode: mode.value,
            dailyTime: dailyTime.value,
            sourceDateFrom: rangeFields.sourceDateFrom.value || null,
            sourceDateTo: rangeFields.sourceDateTo.value || null,
            enabled: field('enabled').checked,
            title: field('title').value,
            sender: { ...config.sender, name: field('sender').value },
            interval: { unit: field('unit').value, count: Number(field('count').value) },
            timeZone: field('zone').value,
            categories: [...categorySelect.selectedOptions].map((option) => option.value),
          });
          Object.assign(config, next);
          await sync({ reason: 'settings' });
          await controlRunner('status');
          status.textContent =
            lastError || '已保存并刷新。新规则从切换时刻继续推送，过去时段可手动补看。';
        } catch (error) {
          status.textContent = error.message;
        } finally {
          save.disabled = false;
        }
      };
      form.prepend(field('enabled').closest('label'));
      body.prepend(form);
      const runner = document.createElement('fieldset');
      runner.className = 'shiye-revisit-runner';
      const legend = document.createElement('legend');
      legend.textContent = '本机推送程序';
      const runnerStatus = document.createElement('p');
      runnerStatus.className = 'shiye-revisit-runner-status';
      runnerStatus.role = 'status';
      runner.append(legend, runnerStatus);
      body.append(runner);
      const runnerStates = {
        stopped: '已停止',
        stopping: '正在停止',
        authenticating: '正在授权',
        running: '正在检查推送',
        waiting: '运行中，等待下一轮',
        catching_up: '正在补齐未处理时段',
        disabled: '运行中，推送规则尚未启用',
        retrying: '连接暂时中断，正在等待重试',
        locked: '等待解锁，请解锁后重新启动',
        unsupported: '后台版本暂不支持',
        failed: '已暂停，请检查后重新启动',
      };
      const runnerButtons = [];
      async function controlRunner(action) {
        runnerButtons.forEach((item) => {
          item.disabled = true;
        });
        try {
          const state = await api('runner-' + action);
          runnerStatus.textContent = runnerStates[state.state] || '状态未知，请刷新';
          const detail = await api('status');
          if ((detail.config.mode || 'interval') === 'interval')
            runnerStatus.textContent += ` · 每隔 ${detail.config.interval.count} ${{ year: '年', month: '个月', day: '天' }[detail.config.interval.unit]}回看`;
          if (detail.randomDay)
            runnerStatus.textContent += detail.randomDay.date
              ? ` · 本轮回看：${detail.randomDay.date}`
              : ' · 暂无可回看的历史日期';
          if (state.lastSuccessAt)
            runnerStatus.textContent +=
              ' · 最近检查：' +
              new Date(state.lastSuccessAt).toLocaleString('zh-CN', {
                ...(config.timeZone === 'system' ? {} : { timeZone: config.timeZone }),
              });
          if (action !== 'stop') await sync();
        } catch (error) {
          runnerStatus.textContent = '推送程序连接未完成：' + error.message;
        } finally {
          runnerButtons.forEach((item) => {
            item.disabled = false;
          });
        }
      }
      runnerButtons.push(
        button(runner, '启动推送', () => controlRunner('start')),
        button(runner, '停止推送', () => controlRunner('stop')),
        button(runner, '刷新推送状态', () => controlRunner('status')),
      );
      const runnerHint = document.createElement('p');
      runnerHint.textContent =
        '已启用的回看随拾页后台自动启动，关闭窗口退到托盘后继续推送，重启保留进度。停止推送暂停本次后台运行；要持续关闭请取消启用。';
      runner.append(runnerHint);
      void controlRunner('status');
      button(body, '打开朝花夕拾群聊', async () => {
        await command('program-feed', { feed: { config, deliveries: [] } });
        window.dispatchEvent(new CustomEvent('shiye-refresh-rooms', { detail: { id: roomId } }));
        el.close();
      });
      const from = document.createElement('input'),
        to = document.createElement('input');
      from.type = to.type = 'text';
      from.placeholder = '开始 ISO时间（含+08:00）';
      to.placeholder = '结束 ISO时间（含+08:00）';
      body.append(from, to);
      button(body, '手动补看这个时段', async () => {
        const result = await api('tick', { manual: true, from: from.value, to: to.value });
        await sync();
        status.textContent = `已加入${result.created}条旧记录`;
      });
    } catch {
      status.textContent = '回看后台暂不可用；本机日期显示仍可调整。推送配置与启停需后台连接。';
    }
  });
  window.addEventListener('hashchange', refreshTarget);
  new MutationObserver(refreshTarget).observe(document.body, { childList: true, subtree: true });
  new BroadcastChannel('shiye-journal-changes').onmessage = () => {
    /* The timer drains durable comments without recursively feeding itself. */
  };
  setInterval(() => {
    sync();
    refreshTarget();
  }, 15000);
  setTimeout(sync, 3000);
  window.shiyeRevisit = {
    isHistoryMessage: (messageId, destination = currentRoom()) =>
      String(destination) === currentRoom() && historyMessages.has(messageId),
    sync,
    syncServices,
    refresh: () => sync({ reason: 'refresh' }),
    readNotice: () => (lifecycleNotice ? structuredClone(lifecycleNotice) : null),
    openSource,
    async readCommentTarget(messageId, destination = currentRoom()) {
      if (!Number.isSafeInteger(messageId)) return undefined;
      const data = await library();
      const comment = data?.messages?.[destination]?.find(
        (item) => item.id === messageId,
      )?.shiyeComment;
      if (!comment?.batchId) return undefined;
      const sourceMessage = data?.messages?.[destination]?.find(
        (item) =>
          item.shiyeProgram &&
          item.shiyeProgram.instanceId === comment.instanceId &&
          item.shiyeProgram.deliveryId === comment.deliveryId,
      );
      return {
        sourceMessageId: sourceMessage?.id,
        roomId: String(destination),
        instanceId: comment.instanceId,
        providerId: 'revisit',
        batchId: comment.batchId,
        ...(comment.deliveryId ? { deliveryId: comment.deliveryId } : {}),
        ...(comment.occurrenceId ? { occurrenceId: comment.occurrenceId } : {}),
      };
    },
    async selectCommentTarget(value) {
      if (
        !value ||
        typeof value.batchId !== 'string' ||
        !value.batchId ||
        (value.deliveryId !== undefined &&
          (typeof value.deliveryId !== 'string' || !value.deliveryId))
      )
        throw Error('评论恢复目标无效');
      if (value.occurrenceId !== undefined)
        throw Error('暂不支持恢复精确媒体评论，请重新选择原对象');
      const record =
        clients.get(value.instanceId || 'legacy') ||
        registerClient(value.roomId || roomId, value.instanceId, false);
      if (record.roomId !== String(value.roomId || roomId)) throw Error('评论恢复会话不一致');
      return record.client.select(value.batchId, value.deliveryId, false);
    },
    status: () => ({ lastError, deliveryCount: deliveries.length, batchCount: batches.length }),
  };
  window.addEventListener('shiye-services-ready', () => {
    void sync();
  });
  window.addEventListener('shiye-room-service-saved', () => {
    void sync({ reason: 'refresh' });
  });
  new BroadcastChannel('shiye-service-settings-changed').onmessage = () => {
    void sync({ reason: 'refresh' });
  };
  consumeNotice(window.shiyeRevisit.readNotice());
})();
