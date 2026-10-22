/* A favorite is still an ordinary image resource. Layout never rewrites message content. */
(() => {
  let hashes = new Set();
  let generation = 0;
  const sourceHashes = new Map();
  const observed = new WeakSet();
  const visible = new Set();
  const queue = new Set();
  let working = 0;
  const digest = async (blob) =>
    [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  function layout(image) {
    const message = image.closest('.Message');
    if (!message || !image.naturalWidth || !image.naturalHeight) return;
    const reference = document.querySelector('.Message .text-content') || message;
    const em =
      parseFloat(getComputedStyle(document.body).getPropertyValue('--shiye-message-size')) ||
      parseFloat(getComputedStyle(reference).fontSize) ||
      16;
    const ratio = image.naturalWidth / image.naturalHeight;
    let width = ratio < 1 ? em * 10 : em * 10 * ratio;
    let height = ratio < 1 ? (em * 10) / ratio : em * 10;
    const area = document.querySelector('#MiddleColumn');
    const fit = Math.min(
      1,
      image.naturalWidth / width,
      image.naturalHeight / height,
      Math.max(80, (area?.clientWidth || innerWidth) - 56) / width,
      Math.max(100, innerHeight * 0.65) / height,
    );
    width *= fit;
    height *= fit;
    message.dataset.shiyeSticker = ratio < 1 ? 'portrait' : 'landscape';
    message.style.setProperty('--shiye-sticker-width', width.toFixed(2) + 'px');
    message.style.setProperty('--shiye-sticker-height', height.toFixed(2) + 'px');
  }
  async function inspect(image) {
    const source = image.currentSrc || image.src;
    if (
      !source ||
      !source.startsWith('blob:') ||
      !image.complete ||
      !hashes.size ||
      !image.closest('.media-inner') ||
      image.closest('.embedded-message')
    )
      return;
    let promise = sourceHashes.get(source);
    if (!promise) {
      promise = fetch(source)
        .then((response) => response.blob())
        .then((blob) => (blob.size <= 64 * 1024 * 1024 ? digest(blob) : undefined));
      sourceHashes.set(source, promise);
      if (sourceHashes.size > 256) sourceHashes.delete(sourceHashes.keys().next().value);
    }
    try {
      if (
        hashes.has(await promise) &&
        image.isConnected &&
        (image.currentSrc || image.src) === source
      )
        layout(image);
    } catch {
      sourceHashes.delete(source);
    }
  }
  function pump() {
    while (working < 2 && queue.size) {
      const image = queue.values().next().value;
      queue.delete(image);
      working++;
      inspect(image).finally(() => {
        working--;
        pump();
      });
    }
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          visible.add(entry.target);
          queue.add(entry.target);
        } else visible.delete(entry.target);
      }
      pump();
    },
    { rootMargin: '100px' },
  );
  function discover(node) {
    if (!(node instanceof Element)) return;
    const images = node.matches('.Message img') ? [node] : node.querySelectorAll('.Message img');
    for (const image of images) {
      if (observed.has(image)) continue;
      observed.add(image);
      observer.observe(image);
      image.addEventListener('load', () => {
        queue.add(image);
        pump();
      });
    }
  }
  async function refresh() {
    const request = ++generation;
    const assets = await window.shiyeLocalAssets?.list('sticker:');
    const next = new Set();
    for (const asset of assets || []) {
      // Removing a favorite must not change how previously sent sticker images are read.
      const hash =
        asset.contentHash ||
        asset.media?.sha256 ||
        (asset.blob?.size <= 64 * 1024 * 1024 ? await digest(asset.blob) : undefined);
      if (hash) next.add(hash);
    }
    if (request !== generation) return;
    hashes = next;
    for (const image of visible)
      if (image.isConnected) queue.add(image);
      else visible.delete(image);
    pump();
  }
  new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes') {
        if (visible.has(record.target)) queue.add(record.target);
      } else {
        for (const node of record.addedNodes) discover(node);
        for (const node of record.removedNodes)
          if (node instanceof Element) {
            for (const image of node.matches('img') ? [node] : node.querySelectorAll('img')) {
              observer.unobserve(image);
              visible.delete(image);
              queue.delete(image);
              observed.delete(image);
            }
          }
      }
    }
    pump();
  }).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src'],
  });
  window.addEventListener('shiye-stickers-updated', () => refresh().catch(() => {}));
  window.addEventListener('resize', () => {
    for (const image of visible) if (image.closest('[data-shiye-sticker]')) layout(image);
  });
  window.addEventListener('message', () => {
    for (const image of visible) if (image.closest('[data-shiye-sticker]')) layout(image);
  });
  window.chrome?.webview?.addEventListener('message', ({ data }) => {
    if (data.kind === 'window-state')
      for (const image of visible) if (image.closest('[data-shiye-sticker]')) layout(image);
  });
  let lastFont = getComputedStyle(document.body).getPropertyValue('--shiye-message-size');
  new MutationObserver(() => {
    const font = getComputedStyle(document.body).getPropertyValue('--shiye-message-size');
    if (font === lastFont) return;
    lastFont = font;
    for (const image of visible) if (image.closest('[data-shiye-sticker]')) layout(image);
  }).observe(document.body, { attributes: true, attributeFilter: ['style'] });
  discover(document.body);
  refresh().catch(() => {});
})();
