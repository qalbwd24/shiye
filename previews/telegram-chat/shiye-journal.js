(() => {
  const pending = new Map(),
    acknowledged = new Set(),
    mediaCache = new Map();
  let datetimeCache;
  let configuration,
    running,
    rerun = false,
    rerunForce = false,
    dirtyRevision = 0,
    scannedRevision = -1,
    lastScanAt,
    scanFailed = false,
    lastError = '',
    locked = false,
    categories = [],
    lastSuccess;
  const stateDb = new Promise((resolve, reject) => {
    const r = indexedDB.open('shiye-journal-link-v1', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('settings');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  async function loadConfiguration() {
    const db = await stateDb;
    return new Promise((resolve, reject) => {
      // One transaction owns initialization across windows. A separate read then
      // write can expose two different conversation namespaces on first launch.
      const tx = db.transaction('settings', 'readwrite');
      const store = tx.objectStore('settings');
      const r = store.get('link');
      let value;
      r.onsuccess = () => {
        value = r.result || { sourceId: crypto.randomUUID(), rooms: {} };
        store.put(value, 'link');
      };
      tx.oncomplete = () => resolve(value);
      tx.onerror = tx.onabort = () => reject(tx.error || r.error);
    });
  }
  async function saveConfiguration(value) {
    const db = await stateDb;
    await new Promise((resolve, reject) => {
      const tx = db.transaction('settings', 'readwrite');
      tx.objectStore('settings').put(value, 'link');
      tx.oncomplete = resolve;
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  }
  const ready = loadConfiguration().then(async (value) => {
    configuration = value;
    const db = await stateDb;
    await new Promise((resolve) => {
      const request = db.transaction('settings').objectStore('settings').get('datetime');
      request.onsuccess = () => { if (request.result?.version === 1) datetimeCache = request.result; resolve(); };
      request.onerror = () => resolve();
    });
  });
  function bridge(action, fields = {}) {
    return new Promise((resolve, reject) => {
      if (!window.chrome?.webview) {
        reject(Error('请从拾页桌面入口打开'));
        return;
      }
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(Error('日记库响应超时，消息仍保存在本机，将自动重试'));
      }, 60000);
      pending.set(id, { resolve, reject, timer });
      window.chrome.webview.postMessage({ kind: 'journal-request', id, action, ...fields });
    });
  }
  window.chrome?.webview?.addEventListener('message', ({ data }) => {
    if (data.kind !== 'journal-result') return;
    const p = pending.get(data.id);
    if (!p) return;
    pending.delete(data.id);
    clearTimeout(p.timer);
    if (data.error) p.reject(Error(data.error));
    else if (data.result.status && data.result.status >= 400) {
      locked = data.result.status === 401;
      p.reject(
        Object.assign(Error(data.result.data?.error || '日记保存失败，消息仍在本机'), {
          status: data.result.status,
        }),
      );
    } else {
      locked = false;
      p.resolve(data.result.data ?? data.result);
    }
  });
  async function readLibrary() {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open('shiye-telegram-preview-v1', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('preview');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const r = db.transaction('preview').objectStore('preview').get('library');
        r.onsuccess = () => {
          db.close();
          resolve(r.result);
        };
        r.onerror = () => {
          db.close();
          reject(r.error);
        };
      };
    });
  }
  const localRequests = new Map();
  const localChannel = new BroadcastChannel('shiye-local-rooms');
  localChannel.onmessage = ({ data }) => {
    const request = localRequests.get(data?.requestId);
    if (!request) return;
    localRequests.delete(data.requestId);
    clearTimeout(request.timer);
    if (data.error) request.reject(Error(data.error));
    else request.resolve(data);
  };
  function localCommand(action, fields) {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timer = setTimeout(() => {
        localRequests.delete(requestId);
        reject(Error('等待本机耐久回执超时，请保留当前操作后安全重试'));
      }, 10000);
      localRequests.set(requestId, { resolve, reject, timer });
      localChannel.postMessage({ requestId, action, ...fields });
    });
  }
  async function datetimeSettings(refresh = false) {
    await ready;
    if (!refresh && datetimeCache) return structuredClone(datetimeCache);
    try {
      const [value, state] = await Promise.all([bridge('datetime-settings'), bridge('status')]);
      value.manualCut = state.manualCut;
      value.manualCutOwners = (state.rooms || []).filter((room) => room.sourceId === configuration.sourceId)
        .map((room) => ({ id: room.id, messageOwner: room.messageOwner }));
      if (value.version !== 1 || typeof value.extendedShortcuts !== 'boolean' || !value.shortcuts
        || typeof value.shortcuts !== 'object') throw Error('时间戳快捷键配置版本尚不支持');
      const db = await stateDb;
      await new Promise((resolve, reject) => {
        const transaction = db.transaction('settings', 'readwrite');
        transaction.objectStore('settings').put(value, 'datetime');
        transaction.oncomplete = resolve;
        transaction.onerror = transaction.onabort = () => reject(transaction.error);
      });
      datetimeCache = value;
      return structuredClone(value);
    } catch (error) {
      if (datetimeCache) return { ...structuredClone(datetimeCache), offline: true };
      throw error;
    }
  }
  async function manualCut(roomId, operationId) {
    await ready;
    if (!configuration.rooms[roomId]?.enabled) throw Error('请先为当前会话启用归入拾页日记');
    const settings = await datetimeSettings();
    if (settings.manualCut?.writeEnabled === false) throw Error('当前后台明确禁用手动归篇，未更改本机分篇');
    if (settings.manualCutVersion !== 1 && settings.manualCut?.version !== 1) throw Error('后台尚未支持手动截断，请保留消息后稍后重试');
    if (settings.manualCutOwners?.find((room) => room.id === roomId)?.messageOwner === 'conversation-services-v1')
      throw Error('此会话由统一服务写口维护，暂不能手动归篇');
    const result = await localCommand('manual-cut', { roomId, operationId });
    dirtyRevision++;
    void flush().catch(() => {});
    return result.cut;
  }
  function acknowledgeWithdrawals(operationIds) {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timer = setTimeout(() => {
        localRequests.delete(requestId);
        reject(Error('撤回已送达，等待本机确认；将安全重试'));
      }, 10000);
      localRequests.set(requestId, { resolve, reject, timer });
      localChannel.postMessage({ requestId, action: 'withdrawal-ack', operationIds });
    });
  }
  async function upload(document) {
    if (!document?.bytes?.length) throw Error('附件原文件未找到，已保留消息，暂不归篇');
    if (mediaCache.has(document.id)) return mediaCache.get(document.id);
    const { token } = await bridge('upload-start');
    try {
      const bytes = new Uint8Array(document.bytes);
      for (let offset = 0; offset < bytes.length; offset += 262144) {
        const part = bytes.subarray(offset, offset + 262144);
        let binary = '';
        for (let i = 0; i < part.length; i += 8192)
          binary += String.fromCharCode(...part.subarray(i, i + 8192));
        await bridge('upload-chunk', { token, offset, bytes: btoa(binary) });
      }
      const name =
        document.attributes?.find((a) => a.shiyeType === 'DocumentAttributeFilename')?.fileName ||
        `聊天附件-${document.id}`;
      const result = await bridge('upload-finish', {
        token,
        name,
        mime: document.mimeType || 'application/octet-stream',
      });
      mediaCache.set(document.id, result.id);
      return result.id;
    } catch (error) {
      await bridge('upload-cancel', { token }).catch(() => {});
      throw error;
    }
  }
  // Recover formatting from old Telegram-style entities without making the database depend on that schema.
  function formatText(message) {
    const text = String(message.message || '');
    const markers = {
      MessageEntityBold: '**',
      MessageEntityItalic: '*',
      MessageEntityStrike: '~~',
      MessageEntityCode: '`',
      MessageEntityPre: '```',
    };
    const edits = [];
    for (const e of message.entities || []) {
      const mark = markers[e.shiyeType];
      if (
        !mark ||
        !Number.isInteger(e.offset) ||
        e.length <= 0 ||
        e.offset < 0 ||
        e.offset + e.length > text.length
      )
        continue;
      edits.push({
        at: e.offset,
        value:
          mark === '```'
            ? `\n\n\`\`\`${String(e.language || '').replace(/[^a-z0-9_+-]/gi, '')}\n`
            : mark,
        close: false,
      });
      edits.push({
        at: e.offset + e.length,
        value: mark === '```' ? '\n```\n\n' : mark,
        close: true,
      });
    }
    let result = text;
    for (const edit of edits.sort((a, b) => b.at - a.at || Number(a.close) - Number(b.close)))
      result = result.slice(0, edit.at) + edit.value + result.slice(edit.at);
    return result;
  }
  async function sync() {
    await ready;
    const status = await bridge('status');
    categories = status.categories;
    // Do not hold a complete media-bearing library while an offline bridge times out.
    const library = await readLibrary();
    if (!library) return;
    let repaired = false;
    const nextConfiguration = structuredClone(configuration);
    for (const [roomId, link] of Object.entries(nextConfiguration.rooms)) {
      const serverRoom = status.rooms?.find(
        (room) => room.sourceId === configuration.sourceId && room.id === roomId,
      );
      if (
        !categories.includes(link.category) &&
        serverRoom &&
        categories.includes(serverRoom.category)
      ) {
        link.category = serverRoom.category;
        repaired = true;
      }
    }
    if (repaired) {
      await saveConfiguration(nextConfiguration);
      configuration = nextConfiguration;
    }
    const errors = [];
    for (const [roomId, link] of Object.entries(configuration.rooms)) {
      if (library.shiyeRooms?.[roomId]?.program === 'revisit') continue;
      const withdrawals = (library.shiyeWithdrawalOutbox || []).filter(
        (item) => item.roomId === roomId && !library.shiyeRevisitComments?.[item.messageId],
      );
      // Stopping future archiving must not undo a withdrawal already queued for this link.
      if (!link.enabled && !withdrawals.length) continue;
      const room = library.shiyeRooms?.[roomId];
      if (!room) continue;
      try {
        await bridge('room', {
          payload: {
            sourceId: configuration.sourceId,
            id: roomId,
            title: room.title,
            category: link.category,
            idleHours: Number(room.idleHours) || 5,
          },
        });
        // This durable operation stream is independent of the ordinary message ack cache.
        for (const operation of withdrawals) {
          const receipts = await bridge('receipts', {
            payload: { sourceId: configuration.sourceId, roomId, ids: [operation.messageId] },
          });
          const receipt = receipts.accepted.find((item) => item.id === operation.messageId);
          await bridge('withdraw', {
            payload: {
              sourceId: configuration.sourceId,
              roomId,
              messageId: operation.messageId,
              operationId: operation.operationId,
              sentAt: operation.sentAt,
              requestedAt: operation.requestedAt,
              ...(Number.isSafeInteger(receipt?.revision)
                ? { expectedRevision: receipt.revision }
                : {}),
            },
          });
          acknowledged.add(`${roomId}:${operation.messageId}`);
          await acknowledgeWithdrawals([operation.operationId]);
        }
        if (!link.enabled) continue;
        // The durable barrier is sent before any later-segment message. Media still
        // arriving for a sealed segment keeps its own persisted epoch on append.
        for (const cut of library.shiyeManualCut?.cuts || []) {
          if (cut.roomId !== roomId || cut.status !== 'pending') continue;
          const { operationId, segmentId, nextSegmentId, acceptedCount, lastAcceptedOperationId } = cut;
          const receipt = await bridge('manual-cut', { payload: {
            sourceId: configuration.sourceId, roomId, operationId, segmentId, nextSegmentId, acceptedCount,
            ...(acceptedCount ? { lastAcceptedOperationId } : {}),
          } });
          if (receipt.operationId !== operationId || receipt.segmentId !== segmentId
            || receipt.nextSegmentId !== nextSegmentId) throw Error('归篇回执与本机屏障不一致，将安全重试');
          await localCommand('manual-cut-ack', { operationId });
        }
        const retired = new Set(
          (library.shiyeWithdrawnMessages || [])
            .filter((item) => item.roomId === roomId)
            .map((item) => item.messageId),
        );
        const messages = (library.messages[roomId] || [])
          .filter((m) => {
            const demo = ['-10', '-20', '-30'].includes(roomId) && m.id >= 1 && m.id <= 10;
            return (
              !m.shiyeProgram &&
              !m.shiyeComment &&
              !demo &&
              !retired.has(String(m.id)) &&
              !acknowledged.has(`${roomId}:${m.id}`)
            );
          })
          .sort((a, b) => a.date - b.date || a.id - b.id);
        for (let offset = 0; offset < messages.length; offset += 50) {
          const batch = messages.slice(offset, offset + 50);
          const received = await bridge('receipts', {
            payload: {
              sourceId: configuration.sourceId,
              roomId,
              ids: batch.map((m) => String(m.id)),
            },
          });
          for (const receipt of received.accepted) acknowledged.add(`${roomId}:${receipt.id}`);
          const outgoing = [];
          for (const m of batch) {
            if (acknowledged.has(`${roomId}:${m.id}`)) continue;
            const attachments = m.media
              ? [await upload(library.documents.find((d) => d.id === m.media.id))]
              : [];
            outgoing.push({
              id: String(m.id),
              sentAt: new Date(m.date * 1000).toISOString(),
              text: formatText(m),
              attachments,
              ...(m.shiyeSegmentId ? { segmentId: m.shiyeSegmentId } : {}),
              ...(m.sendOperationId ? { sendOperationId: m.sendOperationId } : {}),
              ...(m.replyToMsgId ? { replyTo: String(m.replyToMsgId) } : {}),
              ...(m.replacesMessageId
                ? {
                    replacementOf: String(m.replacesMessageId),
                    replacementRootId: String(m.orderRootId || m.replacesMessageId),
                  }
                : {}),
            });
          }
          while (outgoing.length) {
            const portion = [];
            let size = 0;
            while (outgoing.length) {
              const nextSize = new TextEncoder().encode(JSON.stringify(outgoing[0])).length;
              if (portion.length && size + nextSize > 3 * 1024 * 1024) break;
              size += nextSize;
              portion.push(outgoing.shift());
            }
            const result = await bridge('messages', {
              payload: { sourceId: configuration.sourceId, roomId, messages: portion },
            });
            for (const receipt of result.accepted) acknowledged.add(`${roomId}:${receipt.id}`);
          }
        }
      } catch (error) {
        errors.push(`${room.title}：${error.message}`);
      }
    }
    for (const accepted of Object.values(library.shiyeManualCut?.accepts || {})) {
      if (accepted.request && accepted.recoveryError) errors.push('已接受消息待恢复：' + accepted.recoveryError);
    }
    if (errors.length) throw Error(errors.join('；'));
    lastSuccess = Date.now();
    lastError = '';
    locked = false;
    window.dispatchEvent(new Event('shiye-journal-status'));
  }
  function needsScan() {
    return (
      scanFailed ||
      scannedRevision !== dirtyRevision ||
      lastScanAt === undefined ||
      Date.now() - lastScanAt >= 300000
    );
  }
  function flush(force = true) {
    if (running) {
      rerun = true;
      rerunForce ||= force;
      return running;
    }
    if (!force && !needsScan()) return Promise.resolve();
    running = (async () => {
      do {
        rerun = false;
        const revision = dirtyRevision;
        if (force || needsScan()) {
          await sync();
          // A save broadcast received during sync must survive this completion.
          scannedRevision = revision;
          lastScanAt = Date.now();
          scanFailed = false;
        }
        force = rerunForce;
        rerunForce = false;
      } while (rerun);
    })()
      .catch((error) => {
        scanFailed = true;
        lastError = error.message;
        mediaCache.clear();
        window.dispatchEvent(new Event('shiye-journal-status'));
        throw error;
      })
      .finally(() => {
        running = undefined;
        rerunForce = false;
      });
    return running;
  }
  async function status() {
    await ready;
    let connectionError = '';
    try {
      categories = (await bridge('status')).categories;
    } catch (error) {
      connectionError = error.message;
    }
    return {
      categories,
      rooms: structuredClone(configuration.rooms),
      lastError: connectionError || lastError,
      locked,
      lastSuccess,
      saving: !!running,
    };
  }
  async function configure(roomId, enabled, category) {
    await ready;
    const next = structuredClone(configuration);
    next.rooms[roomId] = { enabled, category };
    await saveConfiguration(next);
    configuration = next;
    if (enabled) await flush();
  }
  window.shiyeJournal = {
    shared(method, payload = {}) {
      if (
        ![
          'info',
          'snapshot',
          'pull',
          'command',
          'entity-read',
          'feed-item-read',
          'media-read',
          'media-begin',
          'media-chunk',
          'media-complete',
          'seed-resolve',
          'seed-register',
          'seed-wire-begin',
          'seed-wire-chunk',
          'seed-wire-finish',
          'seed-wire-cancel',
          'pair',
          'unlock',
          'auth-status',
          'forget-device',
        ].includes(method)
      )
        return Promise.reject(Error('不支持的共享业务操作'));
      return bridge('shared-' + method, { payload });
    },
    async sourceId() {
      await ready;
      return configuration.sourceId;
    },
    services(action, payload = {}) {
      action = action.replace(/^service-/, '');
      if (
        ![
          'catalog',
          'create',
          'bind',
          'request',
          'health',
          'settings-read',
          'settings-save',
        ].includes(action)
      )
        return Promise.reject(Error('不支持的会话服务操作'));
      return bridge('service-' + action, { payload });
    },
    conversation(action, payload = {}) {
      if (!['state', 'update', 'feed', 'context', 'send', 'withdraw'].includes(action))
        return Promise.reject(Error('不支持的会话消息操作'));
      return bridge('conversation-' + action, { payload });
    },
    // Fixed sticker operations share this authenticated native bridge, never Telegram networking.
    async stickers(action, payload = {}) {
      if (!['catalog', 'collect', 'from-message', 'update', 'media'].includes(action))
        throw Error('不支持的表情包操作');
      return bridge('sticker-' + action, { payload });
    },
    async uploadSticker(asset) {
      return upload({
        id: asset.id,
        bytes: new Uint8Array(await asset.blob.arrayBuffer()),
        mimeType: asset.blob.type,
        attributes: [{ shiyeType: 'DocumentAttributeFilename', fileName: asset.name }],
      });
    },
    async stickerSource(roomId, messageId) {
      await ready;
      if (!configuration.rooms[roomId]?.enabled) return undefined;
      await flush();
      const result = await bridge('receipts', {
        payload: {
          sourceId: configuration.sourceId,
          roomId: String(roomId),
          ids: [String(messageId)],
        },
      });
      if (!result.accepted?.some((item) => item.id === String(messageId)))
        throw Error('这条消息尚未归篇，请稍后重试');
      return {
        kind: 'chat',
        sourceId: configuration.sourceId,
        roomId: String(roomId),
        messageId: String(messageId),
      };
    },
    program(action, payload = {}) {
      if (
        ![
          'status',
          'config',
          'tick',
          'feed',
          'source',
          'media',
          'comment',
          'withdraw',
          'context',
          'runner-status',
          'runner-start',
          'runner-stop',
        ].includes(action)
      )
        return Promise.reject(Error('不支持的回看操作'));
      return bridge('revisit-' + action, { payload });
    },
    status,
    datetimeSettings,
    manualCut,
    configure,
    flush,
    async unlock(password) {
      await bridge('unlock', { payload: { password } });
      return status();
    },
  };
  ready
    .then(async () => {
      const { createConversationServicesPort } =
        await import('./shiye-conversation-services.js?v=20261019-atomic45');
      const port = createConversationServicesPort({
        request: (action, payload) =>
          action.startsWith('conversation-')
            ? window.shiyeJournal.conversation(action.slice('conversation-'.length), payload)
            : window.shiyeJournal.services(action, payload),
        sourceId: configuration.sourceId,
      });
      const routingReady = async (snapshot) => {
        try {
          if (!window.shiyeRevisit?.syncServices) throw Error('本机会话服务尚未就绪');
          await window.shiyeRevisit.syncServices();
          return snapshot;
        } catch (error) {
          error.partial = {
            settingsSaved: true,
            instanceId: snapshot.instanceId,
            bindingId: snapshot.bindingId,
          };
          throw error;
        }
      };
      window.shiyeConversationServicesPort = {
        ...port,
        saveSettings: async (input) => routingReady(await port.saveSettings(input)),
        recoverSettings: async (input) => routingReady(await port.recoverSettings(input)),
      };
      window.dispatchEvent(new Event('shiye-services-ready'));
      // Shared data binding is separate from the existing UI and legacy owner.
      // No default identity adoption, worker migration or background installer.
      if (localStorage.getItem('shiye-desktop-shared-runtime-v1')) {
        const { bootstrapDesktopSharedRuntime } =
          await import('./shiye-shared-runtime.js?v=shared-business1');
        const runtime = await bootstrapDesktopSharedRuntime({
          journal: window.shiyeJournal,
          onError: (error) => {
            window.shiyeSharedDataError = error.code || error.message;
          },
        });
        if (runtime) {
          window.shiyeSharedRuntime = runtime;
          await runtime.start();
          window.dispatchEvent(new Event('shiye-shared-data-ready'));
        }
      }
    })
    .catch(() => {});
  new BroadcastChannel('shiye-journal-changes').onmessage = () => {
    dirtyRevision += 1;
    flush(false).catch(() => {});
  };
  setInterval(() => {
    flush(false).catch(() => {});
  }, 20000);
  setTimeout(() => {
    flush(false).catch(() => {});
  }, 2000);
})();
