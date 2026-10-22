import {
  createSharedRuntime,
  inspectSharedSeedFile,
  inspectSharedSeedNativeTicket,
  readSharedRuntimeConfig,
  saveSharedRuntimeConfig,
  SHARED_RUNTIME_CONFIG,
} from './shared-runtime.js';

export const IMPORT_ACTIVATION_RECOVERY = 'shiye-shared-import-activation-v1';
const uuid = (value) =>
  typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const hash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const codeOf = (error) => error?.code || error?.message || 'SHARED_IMPORT_FAILED';
const fail = (code) => {
  throw Object.assign(new Error(code), { code });
};
const same = (a, b) => a?.libraryId === b?.libraryId && a?.epoch === b?.epoch;
const clone = (value) => structuredClone(value);
const assertSummary = (value) => {
  if (
    value?.verified !== true ||
    value.bytesVerified !== true ||
    !uuid(value.libraryId) ||
    !uuid(value.epoch) ||
    !uuid(value.packageId) ||
    !hash(value.keyFingerprintSha256) ||
    !hash(value.manifestSha256) ||
    typeof value.publicKeyRawBase64 !== 'string'
  )
    fail('SHARED_IMPORT_VERIFIED_SUMMARY_REQUIRED');
  return value;
};

/** A temporary runtime is a local library handle, never an activation setting.
 * No start/sync/info/pair call is made by construction or first offline import. */
export function createOfflineImportFlow({
  currentRuntime,
  nativeRequest,
  storage = globalThis.localStorage,
  createRuntime = (options) => createSharedRuntime(options),
  inspectNative = inspectSharedSeedNativeTicket,
  inspectFile = inspectSharedSeedFile,
  onState = () => {},
  onActivated = () => {},
} = {}) {
  let busy = false,
    disposed = false,
    abort = null,
    summary = null,
    ticket = null,
    file = null,
    ownership = 'none';
  let selectedRuntime = null,
    ownsRuntime = false,
    lastError = null,
    committed = false,
    result = null,
    activationSaved = false;
  const emit = (value) => {
    if (!disposed) onState(value);
    return value;
  };
  const active = () => {
    if (disposed || abort?.signal.aborted) fail('SHARED_SEED_CANCELLED');
  };
  const reportError = (error) => {
    lastError = error;
    return emit({
      phase: error.cleanupRequired
        ? 'cleanup-required'
        : committed
          ? 'committed-recovery'
          : /CANCELLED|OWNER_REVOKED/.test(codeOf(error))
            ? 'cancelled'
            : 'failed',
      code: codeOf(error),
      cleanupRequired: ownership === 'cleanup-required',
      committed,
    });
  };
  async function closeHeld() {
    if (ownership !== 'ui') return;
    if (!uuid(ticket?.seedToken)) {
      ownership = 'none';
      ticket = null;
      return;
    }
    try {
      await nativeRequest('sharedSeedClose', { seedToken: ticket.seedToken });
      ownership = 'none';
      ticket = null;
    } catch (error) {
      ownership = 'cleanup-required';
      throw Object.assign(error, { cleanupRequired: true });
    }
  }
  async function localReadback() {
    await selectedRuntime.refreshLocal();
    const [directory, diary, preferences, status] = await Promise.all([
      selectedRuntime.directory.list({ includeArchived: true }),
      selectedRuntime.diary.list(),
      selectedRuntime.diary.preferences(),
      selectedRuntime.client.status(),
    ]);
    return { directory, diary, preferences, status, source: selectedRuntime.source.getSnapshot() };
  }
  async function verifiedCommit() {
    const [seed, trust] = await Promise.all([
      selectedRuntime.seed.status(summary.packageId),
      selectedRuntime.seed.trust(),
    ]);
    if (
      seed.status !== 'imported' ||
      !same(seed, summary) ||
      seed.keyFingerprintSha256 !== summary.keyFingerprintSha256 ||
      trust.initialized !== true ||
      trust.pinned !== true ||
      !same(trust, summary) ||
      trust.keyFingerprintSha256 !== summary.keyFingerprintSha256 ||
      trust.publicKeyRawBase64 !== summary.publicKeyRawBase64
    )
      fail('SHARED_IMPORT_COMMIT_NOT_CONFIRMED');
    return { seed, trust };
  }
  function saveRecovery() {
    const value = { version: 1, summary: clone(summary) };
    storage.setItem(IMPORT_ACTIVATION_RECOVERY, JSON.stringify(value));
    if (storage.getItem(IMPORT_ACTIVATION_RECOVERY) !== JSON.stringify(value))
      fail('SHARED_IMPORT_RECOVERY_NOT_SAVED');
  }
  function rememberImportError(error) {
    // The marker is not proof of commit. Preserve it even after an exception:
    // a durable commit can precede the returned error/ACK.
    try {
      const value = JSON.parse(storage.getItem(IMPORT_ACTIVATION_RECOVERY));
      if (
        value?.version !== 1 ||
        !same(value.summary, summary) ||
        value.summary.packageId !== summary.packageId
      )
        return;
      const code = codeOf(error);
      value.lastErrorCode ||= /^[A-Z][A-Z0-9_]{0,95}$/.test(code) ? code : 'SHARED_IMPORT_FAILED';
      storage.setItem(IMPORT_ACTIVATION_RECOVERY, JSON.stringify(value));
    } catch {}
  }
  async function activate() {
    const verified = await verifiedCommit();
    committed = true;
    if (disposed || abort?.signal.aborted)
      return emit({
        phase: 'committed-not-activated',
        summary: clone(summary),
        pendingSync: verified.seed.pendingSync === true,
      });
    const prior = storage.getItem(SHARED_RUNTIME_CONFIG);
    try {
      saveSharedRuntimeConfig(
        { enabled: true, libraryId: summary.libraryId, epoch: summary.epoch },
        storage,
      );
      if (!same(readSharedRuntimeConfig(storage), summary))
        fail('SHARED_IMPORT_ACTIVATION_NOT_SAVED');
    } catch (error) {
      let restoreFailed = false;
      try {
        if (prior === null) storage.removeItem(SHARED_RUNTIME_CONFIG);
        else storage.setItem(SHARED_RUNTIME_CONFIG, prior);
      } catch {
        restoreFailed = true;
      }
      return emit({
        phase: 'activation-recovery',
        code: codeOf(error),
        restoreFailed,
        summary: clone(summary),
        localCommitted: true,
        pendingSync: verified.seed.pendingSync === true,
      });
    }
    // This cleanup is optional: a leftover marker is safely rechecked on reopen.
    try {
      storage.removeItem(IMPORT_ACTIVATION_RECOVERY);
    } catch {}
    activationSaved = true;
    let readback;
    try {
      readback = await localReadback();
    } catch (error) {
      return emit({
        phase: 'activated-readback-failed',
        code: codeOf(error),
        summary: clone(summary),
        localCommitted: true,
        activationSaved: true,
        pendingSync: verified.seed.pendingSync === true,
      });
    }
    const state = emit({
      phase: 'imported',
      summary: clone(summary),
      localCommitted: true,
      activationSaved: true,
      pendingSync: verified.seed.pendingSync === true,
      ...readback,
    });
    if (!disposed)
      try {
        await onActivated({ runtime: selectedRuntime, ...state });
      } catch (error) {
        return emit({
          phase: 'activated-view-failed',
          code: codeOf(error),
          localCommitted: true,
          activationSaved: true,
          summary: clone(summary),
        });
      }
    return state;
  }
  async function selectRuntime() {
    if (same(currentRuntime?.config, summary)) {
      if (
        !currentRuntime.seed?.trust ||
        !currentRuntime.seed?.status ||
        typeof currentRuntime.seed.importNativeTicket !== 'function' ||
        typeof currentRuntime.seed.importFile !== 'function'
      )
        fail('SHARED_IMPORT_RUNTIME_UPDATE_REQUIRED');
      selectedRuntime = currentRuntime;
      ownsRuntime = false;
      return;
    }
    selectedRuntime = await createRuntime({
      config: { version: 1, enabled: true, libraryId: summary.libraryId, epoch: summary.epoch },
      nativeRequest,
      currentRoom: () => null,
      contextVersion: () => 0,
    });
    ownsRuntime = true;
    if (!same(selectedRuntime?.config, summary) || !selectedRuntime?.seed?.importNativeTicket)
      fail('SHARED_IMPORT_RUNTIME_IDENTITY_MISMATCH');
  }
  async function inspect(source, isFile) {
    if (disposed) fail('SHARED_IMPORT_DISPOSED');
    if (busy) return { phase: 'busy' };
    if (ownership === 'cleanup-required')
      return emit({ phase: 'cleanup-required', code: codeOf(lastError) });
    busy = true;
    abort = new AbortController();
    summary = null;
    committed = false;
    result = null;
    activationSaved = false;
    try {
      await closeHeld();
      if (ownsRuntime) {
        await selectedRuntime.dispose();
        selectedRuntime = null;
        ownsRuntime = false;
      }
      emit({ phase: isFile ? 'inspecting' : 'choosing' });
      if (isFile) {
        file = source;
        ticket = null;
        ownership = 'none';
      } else {
        file = null;
        ticket = await nativeRequest('choose', {});
        ownership = 'ui';
        active();
      }
      emit({ phase: 'inspecting' });
      if (isFile) {
        summary = assertSummary(
          await inspectFile(file, {
            signal: abort.signal,
            nativeVerify: async (input) =>
              (await nativeRequest('sharedSeedVerifyAttestation', input)).verified === true,
          }),
        );
      } else {
        ownership = 'inspect';
        try {
          const verified = await inspectNative(ticket, { nativeRequest, signal: abort.signal });
          if (verified.ticketDisposition !== 'retained')
            fail('SHARED_IMPORT_TICKET_DISPOSITION_REQUIRED');
          ownership = 'ui';
          summary = assertSummary(verified);
        } catch (error) {
          if (ownership === 'ui') throw error;
          if (error.ticketDisposition === 'closed' || error.ticketDisposition === 'unowned') {
            ownership = 'none';
            ticket = null;
          } else {
            ownership = 'cleanup-required';
            error.cleanupRequired = true;
          }
          throw error;
        }
      }
      active();
      return emit({
        phase: 'trust-required',
        summary: clone(summary),
        reuseCurrent: same(currentRuntime?.config, summary),
      });
    } catch (error) {
      if (ownership === 'ui')
        try {
          await closeHeld();
        } catch (cleanup) {
          error.cleanupRequired = true;
          error.closeFailed = true;
          ownership = 'cleanup-required';
        }
      return reportError(error);
    } finally {
      busy = false;
      abort = null;
      if (disposed && ownsRuntime) {
        await selectedRuntime?.dispose();
        selectedRuntime = null;
        ownsRuntime = false;
      }
    }
  }
  async function confirm(intent) {
    if (disposed) fail('SHARED_IMPORT_DISPOSED');
    if (busy) return { phase: 'busy' };
    if (
      !summary ||
      intent?.explicit !== true ||
      !same(intent, summary) ||
      intent.keyFingerprintSha256 !== summary.keyFingerprintSha256
    )
      return reportError(
        Object.assign(Error('SHARED_SEED_EXPLICIT_TRUST_REQUIRED'), {
          code: 'SHARED_SEED_EXPLICIT_TRUST_REQUIRED',
        }),
      );
    if (!file && (!ticket || ownership !== 'ui'))
      return reportError(
        Object.assign(Error('SHARED_IMPORT_RESELECT_REQUIRED'), {
          code: 'SHARED_IMPORT_RESELECT_REQUIRED',
        }),
      );
    busy = true;
    abort = new AbortController();
    try {
      emit({ phase: 'preparing-local-library', summary: clone(summary) });
      await selectRuntime();
      active();
      saveRecovery();
      active();
      emit({ phase: 'importing', summary: clone(summary) });
      const options = {
        signal: abort.signal,
        offlineTrust: { explicit: true, keyFingerprintSha256: summary.keyFingerprintSha256 },
      };
      if (ticket) {
        ownership = 'importer';
        result = await selectedRuntime.seed.importNativeTicket(ticket, options);
        ticket = null;
        ownership = 'none';
      } else result = await selectedRuntime.seed.importFile(file, options);
      if (result?.status !== 'imported' || result.packageId !== summary.packageId)
        fail('SHARED_IMPORT_NOT_ACTIVE');
      committed = true;
      return await activate();
    } catch (error) {
      rememberImportError(error);
      if (ownership === 'ui')
        try {
          await closeHeld();
        } catch {
          error.cleanupRequired = true;
        }
      return reportError(error);
    } finally {
      busy = false;
      abort = null;
      if (disposed && ownsRuntime) {
        await selectedRuntime?.dispose();
        selectedRuntime = null;
        ownsRuntime = false;
      }
    }
  }
  return {
    choose: () => inspect(null, false),
    inspectFile: (file) => inspect(file, true),
    confirm,
    get busy() {
      return busy;
    },
    get canSwitch() {
      return activationSaved;
    },
    get needsCleanup() {
      return ownership === 'cleanup-required';
    },
    get summary() {
      return summary ? clone(summary) : null;
    },
    get hasRecovery() {
      try {
        return !!storage.getItem(IMPORT_ACTIVATION_RECOVERY);
      } catch {
        return false;
      }
    },
    async recover() {
      if (busy) return { phase: 'busy' };
      busy = true;
      abort = new AbortController();
      try {
        const pending = JSON.parse(storage.getItem(IMPORT_ACTIVATION_RECOVERY));
        if (pending?.version !== 1) fail('SHARED_IMPORT_RECOVERY_NOT_FOUND');
        summary = assertSummary(pending.summary);
        await selectRuntime();
        active();
        let state;
        try {
          state = await selectedRuntime.seed.status(summary.packageId);
        } catch (error) {
          if (codeOf(error) === 'SHARED_SEED_PACKAGE_NOT_FOUND')
            return emit({
              phase: 'not-imported',
              code: codeOf(error),
              previousErrorCode: pending.lastErrorCode,
              localCommitted: false,
            });
          return emit({
            phase: 'recovery-status-failed',
            code: codeOf(error),
            previousErrorCode: pending.lastErrorCode,
          });
        }
        if (state.status !== 'imported')
          return emit({
            phase: 'not-imported',
            code: 'SHARED_IMPORT_NOT_ACTIVE',
            previousErrorCode: pending.lastErrorCode,
            localCommitted: false,
          });
        return await activate();
      } catch (error) {
        return reportError(error);
      } finally {
        busy = false;
        abort = null;
        if (disposed && ownsRuntime) {
          await selectedRuntime?.dispose();
          selectedRuntime = null;
          ownsRuntime = false;
        }
      }
    },
    async retryCleanup() {
      if (busy) return { phase: 'busy' };
      if (ownership !== 'cleanup-required' || !uuid(ticket?.seedToken))
        return { phase: 'no-cleanup' };
      const original = lastError;
      busy = true;
      ownership = 'ui';
      try {
        await closeHeld();
        return emit({ phase: 'cleanup-complete', code: codeOf(original) });
      } catch (error) {
        return emit({
          phase: 'cleanup-required',
          code: codeOf(original),
          cleanupCode: codeOf(error),
          cleanupRequired: true,
        });
      } finally {
        busy = false;
      }
    },
    async cancel() {
      if (ownership === 'cleanup-required')
        return emit({ phase: 'cleanup-required', code: codeOf(lastError), cleanupRequired: true });
      abort?.abort();
      if (busy) emit({ phase: 'cancel-requested' });
      void nativeRequest('cancel', {}).catch(() => {});
      if (!busy) {
        try {
          await closeHeld();
          summary = null;
          file = null;
          return emit({ phase: 'cancelled' });
        } catch (error) {
          return reportError(error);
        }
      }
    },
    async readback() {
      if (!selectedRuntime) fail('SHARED_IMPORT_RUNTIME_REQUIRED');
      return localReadback();
    },
    async syncNow() {
      if (busy) return { phase: 'busy' };
      if (!selectedRuntime || !committed) fail('SHARED_IMPORT_COMMIT_REQUIRED');
      busy = true;
      emit({ phase: 'syncing', localCommitted: true });
      try {
        await selectedRuntime.client.sync();
        const state = await localReadback();
        return emit({ phase: 'sync-finished', localCommitted: true, ...state });
      } catch (error) {
        return emit({ phase: 'sync-pending', code: codeOf(error), localCommitted: true });
      } finally {
        busy = false;
      }
    },
    async dispose() {
      disposed = true;
      abort?.abort();
      void nativeRequest('cancel', {}).catch(() => {});
      if (!busy) await closeHeld().catch(() => {});
      if (ownsRuntime && !busy) {
        await selectedRuntime?.dispose();
        selectedRuntime = null;
        ownsRuntime = false;
      }
    },
  };
}

/** The existing native settings entry opens this page; no online prerequisite. */
export async function openOfflineSharedImport({
  nativeRequest = window.shiyeSharedImportRequest,
  currentRuntime = window.shiyeSharedData,
  ...options
} = {}) {
  if (document.getElementById('shiye-shared-import')) return;
  const root = document.createElement('section');
  root.id = 'shiye-shared-import';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', '导入电脑资料');
  Object.assign(root.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '99999',
    overflow: 'auto',
    padding: '20px',
    boxSizing: 'border-box',
    background: 'var(--color-background, Canvas)',
    color: 'var(--color-text, CanvasText)',
  });
  const node = (tag, text, parent = root) => {
    const n = document.createElement(tag);
    n.textContent = text;
    parent.append(n);
    return n;
  };
  node('h2', '导入电脑资料');
  node('p', '无需联网或配对。完整校验签名后，确认资料库及公钥指纹，再导入到本机；原有资料保留。');
  const status = node('p', '请选择电脑导出的资料包。');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const verified = node('div', ''),
    trust = node('div', ''),
    results = node('div', '');
  trust.hidden = true;
  const choice = node('select', '', trust);
  choice.setAttribute('aria-label', '导入目标资料库');
  const label = node('label', '', trust),
    check = document.createElement('input');
  check.type = 'checkbox';
  check.setAttribute('aria-label', '明确确认公钥指纹');
  label.append(check, document.createTextNode('我已核对并信任上方公钥指纹'));
  const buttons = node('div', '');
  const button = (text, action, parent = buttons) => {
    const b = node('button', text, parent);
    b.type = 'button';
    Object.assign(b.style, { minHeight: '44px', margin: '4px' });
    b.onclick = () =>
      Promise.resolve()
        .then(action)
        .catch((error) => {
          status.textContent = `操作未完成：${codeOf(error)}`;
        });
    return b;
  };
  const captions = {
    choosing: '请选择电脑资料包…',
    inspecting: '正在逐成员校验与验签…',
    'trust-required': '完整校验通过，请选择资料库并明确确认指纹。',
    'preparing-local-library': '正在打开所选本地资料库…',
    importing: '正在再次校验并持久导入，本步骤不要求联网。',
    imported: '已在本机导入并保存。共享投影已回读，远端同步状态单独显示。',
    'activation-recovery':
      '资料已在本机导入，但选择配置未保存。可继续打开已导入资料，无需重新导入。',
    'not-imported': '上次尚未完成可用资料导入，原资料库选择保持。请重新选包核验。',
    'recovery-status-failed': '上次导入状态暂未查明，原选择保持；请重试检查。',
    'committed-recovery':
      '资料已在本机提交，后续确认未完成。请继续打开已导入资料核对，不必创建新库。',
    'activated-view-failed': '本机导入和选择已保存，共享页面打开未完成。可重试切换页面。',
    'committed-not-activated': '资料已在本机提交，未切换原资料库。可稍后继续打开。',
    'activated-readback-failed': '本机导入与选择已保存，页面回读未完成。',
    'cleanup-required': '本机暂存清理未完成，请重试清理；原错误保留。',
    'cleanup-complete': '本机暂存已清理。',
    'cancel-requested': '正在停止后续步骤；已经提交的资料保留。',
    cancelled: '后续步骤已停止，原选择与资料保留。',
    failed: '导入未完成，原资料保留。',
    syncing: '正在立即同步；本机资料已保存。',
    'sync-pending': '本机已保存，远端同步未完成。',
    'sync-finished': '同步请求结束，请以下方实际状态为准。',
  };
  const flow = createOfflineImportFlow({
    nativeRequest,
    currentRuntime,
    ...options,
    onState(state) {
      status.textContent =
        (captions[state.phase] || state.phase) + (state.code ? `（${state.code}）` : '');
      if (state.previousErrorCode)
        status.textContent += ` 原导入错误：${state.previousErrorCode}。`;
      if (state.restoreFailed) status.textContent += ' 原选择回写尚未确认，请先恢复后再切换。';
      const busy = [
        'choosing',
        'inspecting',
        'preparing-local-library',
        'importing',
        'cancel-requested',
        'syncing',
      ].includes(state.phase);
      choose.disabled = busy;
      confirm.disabled = busy;
      recover.disabled = busy;
      sync.disabled = busy;
      cleanup.hidden = state.phase !== 'cleanup-required';
      if (state.phase === 'trust-required') {
        verified.replaceChildren();
        const s = state.summary;
        for (const [key, value] of [
          ['资料库', s.libraryId],
          ['代际', s.epoch],
          ['资料包', s.packageId],
          ['公钥指纹 SHA-256', s.keyFingerprintSha256],
        ]) {
          const p = node('p', `${key}：${value}`, verified);
          p.style.overflowWrap = 'anywhere';
        }
        choice.replaceChildren();
        const empty = node('option', '请选择要使用的已验证资料库', choice);
        empty.value = '';
        const target = node(
          'option',
          state.reuseCurrent ? '使用当前同身份资料库' : '使用此已验证资料库（原库保留）',
          choice,
        );
        target.value = 'verified';
        check.checked = false;
        trust.hidden = false;
      } else if (state.phase !== 'failed') trust.hidden = true;
      if (state.localCommitted) {
        sync.hidden = false;
        recover.hidden = false;
      }
      switchView.disabled = !flow.canSwitch;
      if (state.directory) {
        results.replaceChildren();
        node(
          'p',
          `本机共享投影：${state.directory.rooms.length} 个会话，${state.diary.length} 篇思绪；共享设置${state.preferences?.local ? '已读取' : '尚无记录'}。`,
          results,
        );
        node(
          'p',
          `本机保存：已持久；远端：${state.status?.sharedLibraryTrust?.syncStatus || '待核对'}；待发 ${state.status?.pending ?? '未知'} 项。`,
          results,
        );
        for (const room of state.directory.rooms.slice(0, 5))
          node('p', `会话：${room.title || room.id}`, results);
        for (const entry of state.diary.slice(0, 5))
          node('p', `思绪：${entry.local?.data?.title || entry.entityId}`, results);
        node('p', '当前回读来自本机共享客户端；原生思绪主页接线另验。', results);
        node(
          'p',
          state.source?.inConversation
            ? `当前会话源：${state.source.messages.length} 条本机消息。`
            : '当前会话源尚未选择房间；消息页面仍需按原共享入口接线验证。',
          results,
        );
      }
      options.onState?.(state);
    },
  });
  const choose = button('选择电脑资料包', () => flow.choose());
  const confirm = button(
    '确认指纹并导入',
    () => {
      if (choice.value !== 'verified' || !check.checked)
        fail('SHARED_SEED_EXPLICIT_TRUST_REQUIRED');
      const s = flow.summary;
      return flow.confirm({
        explicit: true,
        libraryId: s.libraryId,
        epoch: s.epoch,
        keyFingerprintSha256: s.keyFingerprintSha256,
      });
    },
    trust,
  );
  const recover = button('检查上次导入状态', () => flow.recover());
  recover.hidden = !flow.hasRecovery;
  const cleanup = button('重试本机清理', () => flow.retryCleanup());
  cleanup.hidden = true;
  const sync = button('立即同步', () => flow.syncNow());
  sync.hidden = true;
  button('重读本机共享投影', async () => {
    const value = await flow.readback();
    results.replaceChildren();
    node(
      'p',
      `本机共享投影：${value.directory.rooms.length} 个会话，${value.diary.length} 篇思绪；待发${value.status.pending}项。`,
      results,
    );
  });
  button('服务与配对设置（同步时使用）', () => {
    if (!flow.busy) return nativeRequest('service-settings', {});
  });
  const switchView = button('切换到已导入共享页面', () => {
    if (!flow.busy && flow.canSwitch && same(readSharedRuntimeConfig(), flow.summary))
      window.location.reload();
  });
  switchView.disabled = true;
  button('取消导入', () => flow.cancel());
  button('返回', async () => {
    if (flow.busy) {
      await flow.cancel();
      return;
    }
    if (flow.needsCleanup) {
      await flow.retryCleanup();
      if (flow.needsCleanup) return;
    }
    await flow.dispose();
    window.removeEventListener('pagehide', dispose);
    root.remove();
  });
  const dispose = () => {
    void flow.dispose();
  };
  window.addEventListener('pagehide', dispose, { once: true });
  document.body.append(root);
  choose.focus();
  return flow;
}
