/* Android view adapter only. Favorites and message originals keep their existing owners. */
export function installAndroidStickers({ readLibrary, currentId }) {
  const hashes = new Map();
  const observed = new WeakSet();
  const visible = new Set();
  let pending = false;
  let running = false;
  const digest = async (bytes) =>
    [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
  function layout(image) {
    const row = image.closest('.Message');
    if (!row || !image.naturalWidth || !image.naturalHeight) return;
    // Same presentation rule as desktop shiye-sticker-layout: ten current
    // characters, portrait width / landscape height, fit original and viewport.
    const em =
      parseFloat(getComputedStyle(document.body).getPropertyValue('--shiye-message-size')) || 13;
    const ratio = image.naturalWidth / image.naturalHeight;
    let width = ratio < 1 ? em * 10 : em * 10 * ratio;
    let height = ratio < 1 ? (em * 10) / ratio : em * 10;
    const area = document.querySelector('#MiddleColumn');
    const fit = Math.min(
      1,
      image.naturalWidth / width,
      image.naturalHeight / height,
      Math.max(1, (area?.clientWidth || innerWidth) - 56) / width,
      Math.max(1, innerHeight * 0.65) / height,
    );
    width *= fit;
    height *= fit;
    row.dataset.shiyeSticker = ratio < 1 ? 'portrait' : 'landscape';
    row.style.setProperty('--shiye-sticker-width', `${width.toFixed(2)}px`);
    row.style.setProperty('--shiye-sticker-height', `${height.toFixed(2)}px`);
  }
  async function sync() {
    const images = [...visible].filter(
      (image) => image.isConnected && image.complete && image.naturalWidth,
    );
    if (!images.length) return;
    const room = currentId();
    if (!room) return;
    const assets = await window.shiyeLocalAssets.list('sticker:');
    if (!assets.length) return;
    const knownHashes = new Set();
    const mediaIds = new Set();
    const sourceIds = new Set();
    for (const asset of assets) {
      // Include soft removed favorites: removal does not restyle historical messages.
      let hash = asset.contentHash || asset.media?.sha256;
      if (!hash && asset.blob?.size && asset.blob.size <= 64 * 1024 * 1024) {
        const key = `asset:${asset.id}:${asset.blob.size}`;
        let cached = hashes.get(key);
        if (!cached) {
          cached = digest(await asset.blob.arrayBuffer());
          hashes.set(key, cached);
        }
        hash = await cached;
      }
      if (hash) knownHashes.add(hash);
      if (asset.serverMediaId) mediaIds.add(String(asset.serverMediaId));
      if (asset.media?.id) mediaIds.add(String(asset.media.id));
      if (String(asset.localSource?.roomId) === room)
        sourceIds.add(String(asset.localSource.messageId));
    }
    const library = await readLibrary();
    if (room !== currentId()) return;
    for (const image of images) {
      const row = image.closest('.Message');
      if (
        !row?.isConnected ||
        row.classList.contains('is-album') ||
        image.closest('.embedded-message')
      )
        continue;
      const message = library?.messages?.[room]?.find(
        (item) => String(item.id) === row.dataset.messageId,
      );
      if (!message?.media || message.shiyeWithdrawn) continue;
      const id = String(message.media.id);
      let favorite = mediaIds.has(id) || sourceIds.has(String(message.id));
      const original = library.documents?.find((item) => String(item.id) === id);
      if (!favorite && original?.bytes?.length && original.bytes.length <= 64 * 1024 * 1024) {
        // Only visible media, never a whole-library scan or a fetch of remote URLs.
        const key = `${room}:${id}:${original.bytes.length}`;
        let hash = hashes.get(key);
        if (!hash) {
          hash = digest(new Uint8Array(original.bytes));
          hashes.set(key, hash);
          if (hashes.size > 256) hashes.delete(hashes.keys().next().value);
        }
        favorite = knownHashes.has(await hash);
      }
      if (favorite && room === currentId() && image.isConnected) layout(image);
    }
  }
  function schedule() {
    pending = true;
    if (running) return;
    running = true;
    requestAnimationFrame(async () => {
      pending = false;
      try {
        await sync();
      } catch (error) {
        console.warn('表情图片显示暂不可用：', error.message);
      } finally {
        running = false;
        if (pending) schedule();
      }
    });
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target);
        else visible.delete(entry.target);
      }
      schedule();
    },
    { rootMargin: '100px' },
  );
  function discover(node) {
    if (!(node instanceof Element)) return;
    const images = node.matches('.Message img') ? [node] : node.querySelectorAll('.Message img');
    for (const image of images) {
      if (observed.has(image) || !image.closest('.media-inner, .File')) continue;
      observed.add(image);
      observer.observe(image);
      image.addEventListener('load', schedule);
    }
  }
  new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes') schedule();
      else {
        for (const node of record.addedNodes) discover(node);
        for (const image of visible)
          if (!image.isConnected) {
            observer.unobserve(image);
            visible.delete(image);
          }
      }
    }
  }).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'data-message-id'],
  });
  new MutationObserver(schedule).observe(document.body, {
    attributes: true,
    attributeFilter: ['style'],
  });
  window.addEventListener('resize', schedule);
  window.addEventListener('shiye-stickers-updated', schedule);
  window.addEventListener('shiye-local-media-committed', schedule);
  discover(document.body);
}
