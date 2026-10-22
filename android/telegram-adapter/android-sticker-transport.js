import './shiye-media-drop.js';

/* Fixed native collection transport. No URLs, credentials or message bodies cross this port. */
(() => {
  const MAX_BYTES = 64 * 1024 * 1024;
  const actions = new Set(['catalog', 'collect', 'from-message', 'update', 'media']);
  let refreshVersion = 0;
  let installed;
  let inRefresh;
  let refreshing;
  let refreshAgain = false;
  const uploadQueue = new Map();
  const request = (type, value = {}) => {
    if (!window.shiyeNativeStickerRequest) throw Error('本机收藏连接尚未准备好');
    return window.shiyeNativeStickerRequest(type, value);
  };
  const hex = (bytes) => [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const base64 = (bytes) => {
    let value = '';
    for (let offset = 0; offset < bytes.length; offset += 8192)
      value += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    return btoa(value);
  };
  async function upload(asset) {
    const blob = asset?.blob;
    if (!(blob instanceof Blob) || !blob.size || blob.size > MAX_BYTES)
      throw Error('原表情包不可用或超过64 MiB；本机文件继续保留');
    const head = new Uint8Array(await blob.slice(0, 64).arrayBuffer());
    const mime = window.shiyeDroppedMedia?.detectType(head, blob.type, asset.name);
    if (!/^image\/(png|jpeg|gif|webp|avif)$/.test(mime || ''))
      throw Error('原文件不是支持的图片或 GIF');
    const digest = hex(
      new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())),
    );
    const begin = await request('sticker-upload-begin', {
      name: String(asset.name || '表情包'),
      mime,
      size: blob.size,
      sha256: digest,
    });
    const token = begin?.token;
    try {
      if (
        typeof token !== 'string' ||
        begin.received !== 0 ||
        !Number.isInteger(begin.chunkBytes) ||
        begin.chunkBytes < 1 ||
        begin.chunkBytes > 131072
      )
        throw Error('原件传输确认不正确');
      let offset = 0;
      while (offset < blob.size) {
        const bytes = new Uint8Array(
          await blob.slice(offset, offset + begin.chunkBytes).arrayBuffer(),
        );
        const ack = await request('sticker-upload-chunk', { token, offset, data: base64(bytes) });
        if (ack.token !== token || ack.received !== offset + bytes.length)
          throw Error('原件片段未完整保存');
        offset = ack.received;
      }
      const media = await request('sticker-upload-finish', { token });
      if (
        typeof media?.id !== 'string' ||
        !media.id ||
        media.size !== blob.size ||
        media.type !== mime ||
        media.sha256 !== digest
      )
        throw Error('服务端原件确认不一致');
      return media.id;
    } catch (error) {
      if (token) await request('sticker-upload-cancel', { token }).catch(() => {});
      throw error;
    }
  }
  const transport = {
    stickers(action, payload = {}) {
      if (!actions.has(action)) return Promise.reject(Error('不支持的收藏操作'));
      return request('sticker-request', { action, payload });
    },
    uploadSticker(asset) {
      const id = String(asset?.id || '');
      if (uploadQueue.has(id)) return uploadQueue.get(id);
      const pending = upload(asset);
      uploadQueue.set(id, pending);
      const cleanup = () => {
        if (uploadQueue.get(id) === pending) uploadQueue.delete(id);
      };
      pending.then(cleanup, cleanup);
      return pending;
    },
    // These local TL messages have no canonical archive receipts yet. Never forge a source.
    async stickerSource() {
      return undefined;
    },
  };
  async function refreshOnce() {
    if (!window.shiyeNativeStickerRequest || !window.shiyeStickers?.setTransport) return;
    const version = ++refreshVersion;
    let state;
    try {
      state = await request('sticker-state');
    } catch (error) {
      state = { enabled: false, connected: false, error: error.message };
    }
    if (version !== refreshVersion) return;
    const available = state.enabled && state.connected;
    window.shiyeStickers.setTransport(available ? transport : undefined);
    installed = window.shiyeStickers;
    window.dispatchEvent(new CustomEvent('shiye-sticker-connection-state', { detail: state }));
    // User opted in through native settings. Collection sync merges durable local assets;
    // failures remain pending in the shared client and never clear the original library.
    if (available) {
      inRefresh = window.shiyeStickers.sync();
      await inRefresh.catch(() => {});
      window.dispatchEvent(new Event('shiye-stickers-updated'));
    }
  }
  function refresh() {
    if (refreshing) {
      refreshAgain = true;
      return refreshing;
    }
    refreshing = refreshOnce().finally(() => {
      refreshing = undefined;
      if (refreshAgain) {
        refreshAgain = false;
        refresh().catch(() => {});
      }
    });
    return refreshing;
  }
  window.addEventListener('shiye-native-stickers-ready', () => refresh().catch(() => {}));
  window.addEventListener('shiye-native-stickers-changed', () => {
    refreshVersion++;
    window.shiyeStickers?.setTransport?.(undefined);
    refresh().catch(() => {});
  });
  window.addEventListener('shiye-android-view-state', () => {
    if (installed !== window.shiyeStickers) refresh().catch(() => {});
  });
  let attempts = 0;
  const wait = setInterval(() => {
    if (window.shiyeStickers?.setTransport && window.shiyeNativeStickerRequest) {
      clearInterval(wait);
      refresh().catch(() => {});
    } else if (++attempts > 150) clearInterval(wait);
  }, 100);
  window.shiyeAndroidStickerConnection = {
    refresh,
    async flush() {
      if (inRefresh) await inRefresh;
    },
    ready: () => installed === window.shiyeStickers,
  };
})();
