import { readSharedRuntimeConfig, saveSharedRuntimeConfig } from './shared-runtime.js';
export { openOfflineSharedImport as openSharedImport } from './shared-offline-import-ui.js';

const identity = (value) =>
  typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const errorCode = (error) => error?.code || error?.message || 'SHARED_IMPORT_FAILED';
const fail = (code) => {
  throw Object.assign(new Error(code), { code });
};

/** UI state controller. It never selects an identity from a seed ticket. */
export function createSharedImportFlow({
  runtime,
  nativeRequest,
  onState = () => {},
  storage = globalThis.localStorage,
}) {
  const pendingKey = runtime?.config
    ? `shiye-shared-import-pending-v1:${runtime.config.libraryId}:${runtime.config.epoch}`
    : null;
  const pending = (method, value) => {
    try {
      return pendingKey ? storage?.[method](pendingKey, value) : null;
    } catch {
      return null;
    }
  };
  let busy = false,
    disposed = false,
    abort,
    packageId = pending('getItem');
  const emit = (state) => {
    if (!disposed) onState(state);
    return state;
  };
  async function finish(result) {
    if (!identity(result?.packageId)) fail('SHARED_IMPORT_UNKNOWN_RESULT');
    if (result?.status === 'quarantined') {
      packageId = result.packageId;
      if (identity(packageId)) pending('setItem', packageId);
      return emit({ phase: 'quarantined', packageId, code: result.errorCode });
    }
    if (result?.status !== 'imported') fail('SHARED_IMPORT_UNKNOWN_RESULT');
    packageId = result.packageId;
    pending('removeItem');
    // A committed transaction remains imported even if cancel arrived too late.
    emit({ phase: 'committed', packageId });
    try {
      await runtime.refreshLocal();
      const [directory, diary, preferences] = await Promise.all([
        runtime.directory.list({ includeArchived: true }),
        runtime.diary.list(),
        runtime.diary.preferences(),
      ]);
      return emit({ phase: 'imported', packageId, directory, diary, preferences });
    } catch (error) {
      return emit({ phase: 'committed-readback-failed', packageId, code: errorCode(error) });
    }
  }
  async function run(resume = false) {
    if (disposed) fail('SHARED_IMPORT_DISPOSED');
    if (busy) return { phase: 'busy' };
    if (!runtime?.seed || !identity(runtime.config?.libraryId) || !identity(runtime.config?.epoch))
      return emit({ phase: 'configuration-required' });
    busy = true;
    abort = new AbortController();
    emit({ phase: resume ? 'resolving' : 'choosing' });
    let ticket;
    try {
      if (resume) {
        if (!packageId) fail('SHARED_IMPORT_PACKAGE_REQUIRED');
        return await finish(await runtime.seed.resume(packageId));
      }
      ticket = await nativeRequest('choose', {});
      if (disposed || abort.signal.aborted) fail('SHARED_SEED_CANCELLED');
      emit({ phase: 'validating' });
      return await finish(
        await runtime.seed.importNativeTicket(ticket, { resolve: true, signal: abort.signal }),
      );
    } catch (error) {
      return emit({
        phase: /CANCELLED|OWNER_REVOKED/.test(errorCode(error)) ? 'cancelled' : 'failed',
        code: errorCode(error),
      });
    } finally {
      // The runtime also closes from its finally. Always request cleanup here:
      // it may reject before entering that finally. The native owner registry
      // makes close idempotent and disposes the container exactly once.
      if (typeof ticket?.seedToken === 'string' && ticket.seedToken)
        await nativeRequest('sharedSeedClose', { seedToken: ticket.seedToken }).catch(() => {});
      busy = false;
      abort = null;
    }
  }
  return {
    run: () => run(false),
    resume: () => run(true),
    get busy() {
      return busy;
    },
    get hasPending() {
      return identity(packageId);
    },
    cancel() {
      abort?.abort();
      if (busy) emit({ phase: 'cancel-requested' });
      void nativeRequest('cancel', {}).catch(() => {});
    },
    dispose() {
      disposed = true;
      this.cancel();
    },
  };
}

/** Visible entry from native settings, using the existing shared runtime owner. */
export async function openLegacySharedImport({
  nativeRequest = window.shiyeSharedImportRequest,
  runtime = window.shiyeSharedData,
} = {}) {
  if (!runtime && readSharedRuntimeConfig()) {
    for (let i = 0; i < 100 && !window.shiyeSharedData; i++)
      await new Promise((resolve) => setTimeout(resolve, 100));
    runtime = window.shiyeSharedData;
    if (!runtime) fail('SHARED_RUNTIME_NOT_READY');
  }
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
  const text = (tag, value) => {
    const node = document.createElement(tag);
    node.textContent = value;
    root.append(node);
    return node;
  };
  text('h2', '导入电脑资料');
  text(
    'p',
    '选择电脑导出的 .syseed 或受限 ZIP。原有手机资料保留；只有同库核验并追完增量后才会发布。',
  );
  const status = text('p', '先校验服务与资料库身份。');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const results = text('div', '');
  const controls = document.createElement('div');
  root.append(controls);
  const button = (label, action) => {
    const node = document.createElement('button');
    node.type = 'button';
    node.textContent = label;
    Object.assign(node.style, { minHeight: '44px', margin: '4px' });
    node.onclick = () =>
      Promise.resolve()
        .then(action)
        .catch((error) => {
          status.textContent = `操作未完成：${errorCode(error)}`;
        });
    controls.append(node);
    return node;
  };
  let info = null,
    configuring = false;
  const renderRow = (label, value) => {
    const row = document.createElement('p');
    row.textContent = `${label}：${value}`;
    results.append(row);
  };
  const flow = createSharedImportFlow({
    runtime,
    nativeRequest,
    onState(state) {
      const labels = {
        choosing: '请选择电脑资料包…',
        validating: '正在校验原件并核验同库增量…',
        resolving: '正在重新核验隔离包…',
        committed: '资料已提交，正在回读页面…',
        imported: '导入成功，本机共享投影已回读。',
        quarantined: '资料包已隔离，尚未导入。连接同一资料库后可重新核验。',
        'cancel-requested': '正在停止后续步骤；已经提交的资料会保留，完成后可重新回读核对。',
        cancelled: '已停止后续步骤；已完成的提交会保留，可重新回读核对。',
        failed: '导入未完成，原资料保留。',
        'configuration-required': '请先配对、读取资料库身份，再明确启用。',
        'committed-readback-failed': '导入已提交，页面回读未完成，请重试回读。',
      };
      status.textContent =
        (labels[state.phase] || state.phase) + (state.code ? `（${state.code}）` : '');
      choose.disabled = [
        'choosing',
        'validating',
        'resolving',
        'committed',
        'cancel-requested',
      ].includes(state.phase);
      retry.hidden = state.phase !== 'quarantined';
      readback.hidden = state.phase !== 'committed-readback-failed';
      if (state.phase === 'imported') {
        results.replaceChildren();
        renderRow('共享会话', state.directory.rooms.length);
        renderRow('思绪', state.diary.length);
        renderRow('共享设置本地投影', state.preferences?.local ? '已读取' : '尚无记录');
        for (const room of state.directory.rooms.slice(0, 20))
          renderRow('会话', room.title || room.id);
        for (const entry of state.diary.slice(0, 20))
          renderRow('思绪', entry.local?.data?.title || entry.entityId);
      }
    },
  });
  button('服务地址设置', () => {
    if (flow.busy) return;
    info = null;
    activate.hidden = true;
    return nativeRequest('service-settings', {});
  });
  const code = document.createElement('input');
  code.type = 'password';
  code.placeholder = '服务器配对码';
  code.setAttribute('aria-label', '服务器配对码');
  code.maxLength = 200;
  Object.assign(code.style, {
    display: 'block',
    width: '100%',
    boxSizing: 'border-box',
    minHeight: '44px',
    margin: '8px 0',
  });
  root.insertBefore(code, controls);
  const device = document.createElement('input');
  device.placeholder = '设备名称';
  device.value = 'Android 拾页';
  device.maxLength = 100;
  device.setAttribute('aria-label', '设备名称');
  Object.assign(device.style, {
    display: 'block',
    width: '100%',
    boxSizing: 'border-box',
    minHeight: '44px',
    margin: '8px 0',
  });
  root.insertBefore(device, controls);
  button('配对此设备', async () => {
    if (flow.busy || configuring) return;
    configuring = true;
    info = null;
    activate.hidden = true;
    try {
      await nativeRequest('sharedPair', { code: code.value, deviceName: device.value });
      status.textContent = '配对已保存，请读取并核对资料库身份。';
    } finally {
      code.value = '';
      configuring = false;
    }
  });
  button('读取资料库身份', async () => {
    if (flow.busy || configuring) return;
    configuring = true;
    info = null;
    activate.hidden = true;
    try {
      const value = await nativeRequest('sharedInfo', {});
      if (!identity(value.libraryId) || !identity(value.epoch)) fail('SHARED_INVALID_IDENTITY');
      info = value;
      status.textContent = `资料库：${info.libraryId}\n代际：${info.epoch}\n请与电脑导出资料核对。`;
      activate.hidden = false;
    } finally {
      configuring = false;
    }
  });
  const activate = button('确认使用此资料库并重开', async () => {
    if (flow.busy || configuring || !info) return;
    configuring = true;
    try {
      const current = await nativeRequest('sharedInfo', {});
      if (current.libraryId !== info.libraryId || current.epoch !== info.epoch)
        fail('SHARED_IDENTITY_CHANGED');
      saveSharedRuntimeConfig({ enabled: true, libraryId: info.libraryId, epoch: info.epoch });
      code.value = '';
      flow.dispose();
      window.location.reload();
    } finally {
      configuring = false;
    }
  });
  activate.hidden = true;
  if (runtime?.config)
    text('p', `当前资料库：${runtime.config.libraryId}\n代际：${runtime.config.epoch}`);
  const choose = button('选择电脑资料包', () => flow.run());
  const retry = button('重新核验隔离包', () => flow.resume());
  retry.hidden = !flow.hasPending;
  const readback = button('重新回读页面', async () => {
    await runtime.refreshLocal();
    const [rooms, entries, prefs] = await Promise.all([
      runtime.directory.list({ includeArchived: true }),
      runtime.diary.list(),
      runtime.diary.preferences(),
    ]);
    results.replaceChildren();
    renderRow('共享会话', rooms.rooms.length);
    renderRow('思绪', entries.length);
    renderRow('共享设置本地投影', prefs?.local ? '已读取' : '尚无记录');
    status.textContent = '导入成功，本机共享投影回读完成。';
    readback.hidden = true;
  });
  readback.hidden = true;
  button('取消导入', () => flow.cancel());
  button('返回', () => {
    if (flow.busy) {
      flow.cancel();
      status.textContent = '正在取消，请等待当前步骤结束后返回。';
      return;
    }
    flow.dispose();
    window.removeEventListener('shiye-shared-import-progress', progress);
    window.removeEventListener('pagehide', dispose);
    code.value = '';
    root.remove();
  });
  const progress = (event) => {
    if (flow.busy && event.detail)
      status.textContent = `正在处理资料包：${event.detail.phase} ${event.detail.completed}/${event.detail.total}`;
  };
  const dispose = () => {
    flow.dispose();
    code.value = '';
    window.removeEventListener('shiye-shared-import-progress', progress);
    window.removeEventListener('pagehide', dispose);
  };
  window.addEventListener('shiye-shared-import-progress', progress);
  window.addEventListener('pagehide', dispose, { once: true });
  document.body.append(root);
  choose.focus();
}
