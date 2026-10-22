import {
  createSyncClient,
  createIndexedDbSyncStorage,
  createSyncOperationId,
  normalizeSyncBaseUrl,
} from './assets/sync-v2-client.js';
import { createSyncMediaCache } from './assets/sync-v2-media-cache.js';
import { fromEditorJSON } from './assets/rich-document.js';

const $ = (id) => document.getElementById(id);
const settingsKey = 'shiye-sync-v2-lab-connection';
let settings;
try {
  settings = JSON.parse(localStorage.getItem(settingsKey) || '{}');
} catch {
  settings = {};
}
settings.profile ||= createSyncOperationId();
let client,
  storage,
  media,
  selected = null,
  attachmentIds = [],
  paused = false,
  mediaBusy = false;
let mediaTimer,
  rendering = 0;
let verifiedBase = '';
let activeBase = '';
let attachmentRender = 0,
  lastAttachmentSignature = '';
const objectUrls = new Set();
const labels = {
  chatMessage: '随想',
  journalAggregate: '思绪',
  conversation: '会话',
  taxonomy: '分类',
};
$('base-url').value = settings.baseUrl || new URL('./', location.href).href;
$('device-name').value = settings.deviceName || '';
function persist() {
  localStorage.setItem(settingsKey, JSON.stringify(settings));
}
function notice(error) {
  $('notice').textContent = error
    ? `操作未完成：${error.message || error}。本地内容保留，可检查连接后重试。`
    : '';
}
function run(fn) {
  return async () => {
    try {
      notice();
      await fn();
    } catch (error) {
      notice(error);
    }
  };
}
async function api(route, init = {}, authorization = true) {
  const response = await fetch(
    new URL(
      `api/sync/v1/${route}`,
      authorization && activeBase ? activeBase : normalizeSyncBaseUrl($('base-url').value),
    ),
    {
      ...init,
      headers: {
        ...(authorization && settings.token ? { Authorization: `Bearer ${settings.token}` } : {}),
        ...init.headers,
      },
    },
  );
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.code || `HTTP ${response.status}`);
  return result;
}
function setState(state) {
  const names = {
    online: '已连接',
    idle: '已连接',
    syncing: '正在同步',
    stopped: '已暂停',
    retrying: '等待重试',
    paused: '同步已暂停',
    error: '连接异常',
  };
  $('state').textContent =
    `${names[state.phase] || state.phase} · 待同步 ${state.pending || 0} · 冲突 ${state.conflicts || 0}${state.error ? ` · ${typeof state.error === 'string' ? state.error : state.error.code || '请检查连接'}` : ''}`;
}
function watch() {
  const controller = new AbortController();
  const delay = (ms) =>
    new Promise((resolve) => {
      if (controller.signal.aborted) return resolve();
      const finish = () => {
        clearTimeout(timer);
        controller.signal.removeEventListener('abort', finish);
        resolve();
      };
      const timer = setTimeout(finish, ms);
      controller.signal.addEventListener('abort', finish, { once: true });
    });
  (async () => {
    let failures = 0;
    while (!controller.signal.aborted) {
      try {
        const meta = await storage.transaction((tx) => tx.getMeta());
        if (!meta?.cursor) {
          await delay(500);
          continue;
        }
        const result = await api(`watch?cursor=${encodeURIComponent(meta.cursor)}&timeout=25000`, {
          signal: controller.signal,
        });
        failures = 0;
        if (result.changed && !controller.signal.aborted) await client.sync();
      } catch (error) {
        if (controller.signal.aborted) break;
        if (error.message === 'DEVICE_UNAUTHORIZED') {
          client.stop();
          notice(error);
          break;
        }
        await delay(Math.min(30000, 1000 * 2 ** Math.min(failures++, 5)));
      }
    }
  })();
  return () => controller.abort();
}
async function syncMedia() {
  if (!media || !client || paused || mediaBusy) return;
  mediaBusy = true;
  try {
    const currentBase = activeBase;
    if (verifiedBase !== currentBase) {
      const meta = await storage.transaction((tx) => tx.getMeta());
      if (!meta?.identity) return;
      const info = await api('info');
      if (meta.identity.libraryId !== info.libraryId || meta.identity.epoch !== info.epoch)
        throw new Error('server-identity-mismatch');
      verifiedBase = currentBase;
    }
    const result = await media.sync(await client.list('asset'));
    $('media-state').textContent =
      `原件 ${result.localOriginals} · 待传 ${result.pendingUploads} · 待收 ${result.pendingDownloads} · 失败 ${result.failed}`;
    if (selected) await renderAttachments();
  } finally {
    mediaBusy = false;
  }
}
async function connect() {
  if (!settings.token || !settings.deviceId) throw new Error('请先输入配对码完成配对');
  const baseUrl = normalizeSyncBaseUrl($('base-url').value);
  activeBase = baseUrl;
  verifiedBase = '';
  client?.stop();
  if (mediaTimer) clearInterval(mediaTimer);
  if (!storage)
    storage = createIndexedDbSyncStorage({ dbName: `shiye-sync-v2-lab-${settings.profile}` });
  if (!media)
    media = await createSyncMediaCache({
      dbName: `shiye-sync-v2-lab-media-${settings.profile}`,
      baseUrl,
      token: settings.token,
    });
  else media.setConnection({ baseUrl, token: settings.token });
  settings.baseUrl = baseUrl;
  persist();
  client = createSyncClient({
    baseUrl,
    deviceId: settings.deviceId,
    token: settings.token,
    storage,
    onState: setState,
    onChange: () => {
      renderRecords().catch(notice);
      syncMedia().catch(notice);
    },
    watch,
  });
  paused = false;
  $('pause').textContent = '暂停同步，测试离线';
  $('workspace').hidden = false;
  $('connection').open = false;
  await renderRecords();
  mediaTimer = setInterval(() => syncMedia().catch(notice), 5000);
  await client.start();
  await syncMedia();
}
const textOf = (body) =>
  (body?.content || [])
    .map((node) => (node.content || []).map((item) => item.text || '').join(''))
    .join('\n');
async function renderRecords() {
  if (!client) return;
  const serial = ++rendering;
  const rows = (await client.list()).filter(
    (row) => labels[row.entityType] && row.state === 'active',
  );
  if (serial !== rendering) return;
  rows.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  $('records').replaceChildren();
  for (const row of rows) {
    const button = document.createElement('button');
    button.className = `record${selected?.entityId === row.entityId ? ' selected' : ''}`;
    button.textContent =
      row.data.title || row.data.name || textOf(row.data.body).slice(0, 50) || '未命名';
    const info = document.createElement('small');
    info.textContent = `${labels[row.entityType]} · ${row.data.categoryId || '未分类'} · v${row.revision || 0}`;
    button.append(info);
    button.onclick = run(() => openRecord(row));
    $('records').append(button);
  }
  if (!rows.length) $('records').textContent = '先在任一设备保存一条测试内容。';
}
async function openRecord(row) {
  if (
    !$('save').disabled &&
    ($('body').value || $('title').value) &&
    !selected &&
    !confirm('当前尚有未保存内容，仍要切换吗？')
  )
    return;
  selected = await client.read(row.entityType, row.entityId);
  $('editor-heading').textContent = '编辑测试内容（远端变化不会覆盖正在输入的文字）';
  $('type').value = row.entityType;
  $('type').disabled = true;
  $('title').value = selected.data.title || selected.data.name || '';
  $('category').value = selected.data.categoryId || '';
  $('body').value = textOf(selected.data.body) || selected.data.description || '';
  attachmentIds = [...(selected.data.attachments || []).map((item) => item.assetId)];
  if (selected.data.wallpaperAssetId && !attachmentIds.includes(selected.data.wallpaperAssetId))
    attachmentIds.push(selected.data.wallpaperAssetId);
  $('saved').textContent = '';
  await renderAttachments();
  await renderRecords();
}
function newRecord() {
  selected = null;
  attachmentIds = [];
  $('type').disabled = false;
  for (const id of ['title', 'body', 'category', 'files']) $(id).value = '';
  $('editor-heading').textContent = '新建测试内容';
  $('saved').textContent = '';
  renderAttachments().catch(notice);
  renderRecords().catch(notice);
}
async function renderAttachments() {
  const serial = ++attachmentRender;
  const ids = [...attachmentIds];
  const assets = await Promise.all(ids.map((id) => media.get(id)));
  if (serial !== attachmentRender) return;
  const signature = JSON.stringify(
    ids.map((id, index) => [
      id,
      assets[index]?.sha256,
      assets[index]?.uploadState,
      assets[index]?.downloadState,
      !!assets[index]?.blob,
    ]),
  );
  if (signature === lastAttachmentSignature) return;
  lastAttachmentSignature = signature;
  const target = $('attachments');
  for (const url of objectUrls) URL.revokeObjectURL(url);
  objectUrls.clear();
  target.replaceChildren();
  for (const [index, assetId] of ids.entries()) {
    const asset = assets[index];
    const box = document.createElement('div');
    box.className = 'asset';
    box.textContent = asset
      ? `${asset.name || assetId} · ${asset.size} 字节 · ${{ pending: '待上传', complete: '原件已保存', failed: '等待重试' }[asset.uploadState === 'none' ? asset.downloadState : asset.uploadState] || '等待传输'}`
      : `${assetId} · 等待原件下载`;
    if (asset?.blob) {
      const url = URL.createObjectURL(asset.blob);
      objectUrls.add(url);
      if (/^(image\/(png|jpeg|gif|webp|avif|bmp)|video\/)/.test(asset.mime)) {
        const preview = document.createElement(asset.mime.startsWith('video/') ? 'video' : 'img');
        preview.src = url;
        if (preview.tagName === 'VIDEO') preview.controls = true;
        else preview.alt = asset.name || '测试图片';
        box.append(preview);
      }
      const link = document.createElement('a');
      link.href = url;
      link.download = asset.name || assetId;
      link.textContent = '下载本地原件';
      box.append(link);
    }
    target.append(box);
  }
}
$('generate').onclick = run(async () => {
  const result = await api(
    'local-pairing',
    { method: 'POST', headers: { 'X-Sync-Client': 'local-admin' } },
    false,
  );
  $('pair-code').textContent = result.code;
  $('code').value = result.code;
});
$('pair').onclick = run(async () => {
  if (settings.deviceId)
    throw new Error('本浏览器已配对，请使用“连接已配对设备”；新设备请使用另一个浏览器');
  const credentials = await api(
    'pair',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: $('code').value.trim(),
        deviceName: $('device-name').value.trim(),
      }),
    },
    false,
  );
  Object.assign(settings, credentials);
  persist();
  $('code').value = '';
  $('pair-code').textContent = '';
  await connect();
});
$('reconnect').onclick = run(connect);
$('pause').onclick = run(async () => {
  paused = !paused;
  if (paused) client.stop();
  else {
    await client.start();
    await syncMedia();
  }
  $('pause').textContent = paused ? '恢复后台同步' : '暂停同步，测试离线';
});
$('sync').onclick = run(async () => {
  await client.sync();
  await syncMedia();
});
$('files').onchange = run(async () => {
  for (const file of $('files').files) {
    const asset = await media.add(file);
    attachmentIds.push(asset.assetId);
  }
  $('files').value = '';
  await renderAttachments();
  if (!paused) await syncMedia();
});
$('save').onclick = run(async () => {
  $('save').disabled = true;
  try {
    const type = selected?.entityType || $('type').value,
      entityId = selected?.entityId || createSyncOperationId();
    const time = new Date().toISOString(),
      title = $('title').value,
      categoryId = $('category').value;
    const data = {
      title,
      categoryId,
      attachments: attachmentIds.map((assetId) => ({ assetId })),
      updatedAt: time,
    };
    if (type === 'journalAggregate' || type === 'chatMessage')
      data.body = fromEditorJSON(
        {
          type: 'doc',
          content: $('body')
            .value.split('\n')
            .map((text) => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] })),
        },
        createSyncOperationId,
      );
    else {
      data.name = title;
      data.description = $('body').value;
    }
    if (type === 'conversation') data.wallpaperAssetId = attachmentIds[0] || null;
    const result = await client.enqueue({
      entityType: type,
      entityId,
      command: selected ? 'updateFields' : 'create',
      ...(selected ? { changes: data } : { data: { ...data, createdAt: time, eventTime: time } }),
    });
    selected = result.entity;
    $('type').disabled = true;
    $('saved').textContent = '本地已保存。联网时自动同步；可在另一设备查看。';
    await renderRecords();
  } finally {
    $('save').disabled = false;
  }
});
$('new').onclick = newRecord;
$('history').onclick = run(async () => {
  const result = await api('conflicts');
  $('conflict-items').replaceChildren();
  $('conflicts').open = true;
  for (const conflict of result.conflicts) {
    const box = document.createElement('div');
    box.className = 'history';
    box.textContent = `${conflict.entityType || conflict.type} / ${conflict.entityId || conflict.id}\n${JSON.stringify(conflict.detail || conflict, null, 2)}`;
    const restore = document.createElement('button');
    restore.textContent = '将被替换版本恢复为当前版本';
    restore.onclick = run(async () => {
      const detail = conflict.detail || conflict;
      const remote = detail.remote;
      if (!remote?.data || !confirm('恢复会产生一次新的编辑，仍保留冲突历史。继续吗？')) return;
      await client.enqueue({
        entityType: remote.entityType,
        entityId: remote.entityId,
        command: 'updateFields',
        changes: remote.data,
      });
      $('saved').textContent = '恢复版本已保存到本地，等待同步。';
    });
    box.append(restore);
    $('conflict-items').append(box);
  }
  if (!result.conflicts.length)
    $('conflict-items').textContent = '暂无冲突。旧版本不会重复出现在日记或回看中。';
});
window.addEventListener('pagehide', () => {
  client?.stop();
  clearInterval(mediaTimer);
});
if (settings.token) connect().catch(notice);
