import { installDragSort } from '../core/drag-sort.js';
import { installImageViewport, imageZoomControls } from '../shared/image-viewport.js';
import { richMediaReferences } from '../shared/rich-document.js';

/** Inline occurrences render in the body; the attachment strip shows remaining resources. */
export function galleryAttachmentOrder(entry) {
  if (entry?._readingProjection) return [];
  const order = entry?.attachments || [];
  if (entry?.contentFormat !== 'richdoc') return order;
  try {
    const inline = new Set(richMediaReferences(entry.body).map((image) => image.assetId));
    return order.filter((id) => !inline.has(id));
  } catch {
    // A damaged/unknown body must not hide the original media references.
    return order;
  }
}

export function mergeGalleryOrder(entry, next) {
  const visible = galleryAttachmentOrder(entry);
  if (
    next.length !== visible.length ||
    new Set(next).size !== next.length ||
    next.some((id) => !visible.includes(id))
  )
    throw Error('附件列表已变化，请重新调整');
  const visibleIds = new Set(visible);
  let index = 0;
  return (entry.attachments || []).map((id) => (visibleIds.has(id) ? next[index++] : id));
}

export function galleryDots(count, active) {
  if (count <= 7) return Array.from({ length: count }, (_, index) => index);
  const start = Math.max(1, Math.min(count - 6, active - 2));
  return [0, ...Array.from({ length: 5 }, (_, index) => start + index), count - 1];
}
const POSITION_KEY = 'shiye.gallery-position.v1';
export function readGalleryPositions(storage) {
  const positions = new Map();
  try {
    const saved = JSON.parse(storage?.getItem(POSITION_KEY) || 'null');
    if (saved?.version !== 1 || !Array.isArray(saved.entries)) return positions;
    for (const pair of saved.entries.slice(-200)) {
      if (
        !Array.isArray(pair) ||
        pair.length !== 2 ||
        !pair.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 512)
      )
        continue;
      positions.delete(pair[0]);
      positions.set(pair[0], pair[1]);
    }
  } catch {
    /* A malformed or blocked local preference never blocks the gallery. */
  }
  return positions;
}
export function rememberGalleryPosition(positions, entryId, mediaId, storage) {
  positions.delete(entryId);
  positions.set(entryId, mediaId);
  while (positions.size > 200) positions.delete(positions.keys().next().value);
  try {
    storage?.setItem(POSITION_KEY, JSON.stringify({ version: 1, entries: [...positions] }));
  } catch {
    /* Navigation still works when browser storage is unavailable. */
  }
}

/** Gallery changes references only; existing media bytes and dates stay intact. */
export function createGallery(c, options = {}) {
  const { $, escape: esc, toast } = c;
  const host = options.host || $('#attachments');
  const doc = host.ownerDocument || globalThis.document;
  let positionStorage;
  try {
    positionStorage = doc?.defaultView?.localStorage || globalThis.localStorage;
  } catch {
    /* Private mode may block storage access. */
  }
  const rememberedPositions = readGalleryPositions(positionStorage);
  const isEditing = () => !!options.editing?.();
  const isDeferred = () => !!options.defer?.();
  let entryId = null,
    activeId = null,
    lastEditing = isEditing(),
    disposeSort = () => {},
    viewer = null,
    navigation = 0,
    pendingId = null,
    pointer = null,
    disposeViewport = () => {},
    suppressClickUntil = 0;
  function projectedEntry(entry) {
    if (!entry) return entry;
    const projection = c.readingProjection?.();
    if (!entry || !projection || projection.source?.id !== entry.id) return entry;
    let references = [];
    try {
      references = richMediaReferences(projection.body).map((media) => media.assetId);
    } catch {
      /* Compatibility may retain a non-canonical body. */
    }
    return {
      ...entry,
      attachments: [...new Set([...(entry.attachments || []), ...references])],
      _readingProjection: true,
    };
  }
  const currentEntry = () =>
    projectedEntry(c.library.entries.find((entry) => entry.id === entryId));
  const reducedMotion = () =>
    doc?.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  function preview(id) {
    const media = c.library.media.find((item) => item.id === id),
      src = '/media/' + encodeURIComponent(id);
    if (!media) return '<p class="gallery-missing">附件文件记录缺失，保留此关联供恢复。</p>';
    if (media.type?.startsWith('image/'))
      return `<img src="${src}" alt="${esc(media.name)}" draggable="false" decoding="async">`;
    if (media.type?.startsWith('video/'))
      return `<video src="${src}" controls preload="metadata" aria-label="${esc(media.name)}"></video>`;
    if (media.type?.startsWith('audio/'))
      return `<audio src="${src}" controls preload="metadata" aria-label="${esc(media.name)}"></audio>`;
    return `<a href="${src}" download="${esc(media.name)}">下载 ${esc(media.name)}</a>`;
  }
  function updateNavigation() {
    const order = galleryAttachmentOrder(currentEntry()),
      index = order.indexOf(activeId);
    const counter = host.querySelector('[data-gallery-counter]');
    if (counter) counter.textContent = `${index + 1} / ${order.length}`;
    host.querySelectorAll('[data-gallery-step]').forEach((button) => {
      button.setAttribute(
        'aria-disabled',
        String(Number(button.dataset.galleryStep) < 0 ? index === 0 : index === order.length - 1),
      );
    });
    const dots = host.querySelector('.gallery-dots');
    if (dots) {
      const wasFocused = dots.contains(doc.activeElement);
      dots.innerHTML = galleryDots(order.length, index)
        .map(
          (value) =>
            `<button class="gallery-dot ${value === index ? 'active' : ''}" data-gallery-index="${value}" aria-label="显示第 ${value + 1} 张，共 ${order.length} 张" ${value === index ? 'aria-current="true"' : ''}><span></span></button>`,
        )
        .join('');
      if (wasFocused)
        dots.querySelector(`[data-gallery-index="${index}"]`)?.focus({ preventScroll: true });
    }
    const expand = host.querySelector('.gallery-expand');
    if (expand) {
      expand.hidden = !c.library.media
        .find((item) => item.id === activeId)
        ?.type?.startsWith('image/');
      expand.dataset.viewMedia = activeId;
    }
    const status = host.querySelector('.gallery-announcement');
    if (status) status.textContent = `第 ${index + 1} 项，共 ${order.length} 项`;
  }
  async function navigate(index) {
    const entry = currentEntry(),
      order = galleryAttachmentOrder(entry);
    if (isEditing() || isDeferred() || index < 0 || index >= order.length) return;
    if (order[index] === activeId) {
      navigation++;
      pendingId = null;
      return;
    }
    const id = order[index],
      token = ++navigation,
      direction = index > order.indexOf(activeId) ? 1 : -1;
    pendingId = id;
    const media = c.library.media.find((item) => item.id === id);
    if (media?.type?.startsWith('image/')) {
      const preload = doc.createElement('img');
      preload.src = '/media/' + encodeURIComponent(id);
      try {
        await preload.decode();
      } catch {
        /* Missing images retain their reference and alt text. */
      }
    }
    if (token !== navigation || isEditing() || isDeferred() || entryId !== entry.id) return;
    const slide = host.querySelector('.gallery-slide');
    if (!slide) return;
    const mediaScroll = host.closest('.media-pane-scroll'),
      scrollTop = mediaScroll?.scrollTop;
    activeId = id;
    pendingId = null;
    rememberGalleryPosition(rememberedPositions, entry.id, id, positionStorage);
    slide.innerHTML = preview(id);
    slide.dataset.mediaId = id;
    slide.style.transform = '';
    updateNavigation();
    // A natural-height image changes the content above comments. Resolve that
    // layout before restoring the pane position; never rerender the comments.
    if (mediaScroll) {
      void mediaScroll.offsetHeight;
      mediaScroll.scrollTop = scrollTop;
    }
    if (!reducedMotion())
      slide.animate?.(
        [
          { opacity: 0.55, transform: `translateX(${direction * 18}px)` },
          { opacity: 1, transform: 'translateX(0)' },
        ],
        { duration: 190, easing: 'cubic-bezier(.2,.7,.2,1)' },
      );
  }
  const stepFrom = () => galleryAttachmentOrder(currentEntry()).indexOf(pendingId || activeId);
  function closeViewer() {
    if (viewer?.open) viewer.close();
  }
  function view(id, trigger) {
    if (isDeferred() && !isEditing()) return;
    const entry = currentEntry();
    if (!entry?.attachments.includes(id)) return;
    const images = entry.attachments.filter((key) =>
      c.library.media.find((m) => m.id === key)?.type?.startsWith('image/'),
    );
    if (!viewer) {
      viewer = document.createElement('dialog');
      viewer.className = 'gallery-viewer';
      viewer.setAttribute('aria-label', '查看完整图片');
      document.body.append(viewer);
      viewer.addEventListener('click', (event) => {
        if (event.target === viewer) closeViewer();
      });
      viewer.addEventListener('close', () => {
        disposeViewport();
        viewer.innerHTML = '';
      });
    }
    let index = images.indexOf(id);
    if (index < 0) return;
    function show() {
      disposeViewport();
      const media = c.library.media.find((m) => m.id === images[index]);
      if (!media) return closeViewer();
      viewer.innerHTML = `<header><span>${esc(media.name)} · ${index + 1} / ${images.length}</span><button class="secondary" data-gallery-close autofocus>关闭</button></header><div class="gallery-full-image" data-image-stage><img src="/media/${encodeURIComponent(media.id)}" alt="${esc(media.name)}" draggable="false"></div>${imageZoomControls}<footer><button class="secondary" data-gallery-prev ${index === 0 ? 'disabled' : ''}>上一张</button><a class="secondary" href="/media/${encodeURIComponent(media.id)}" download="${esc(media.name)}">保存原图</a><button class="secondary" data-gallery-next ${index === images.length - 1 ? 'disabled' : ''}>下一张</button></footer>`;
      disposeViewport = installImageViewport(viewer);
      viewer.querySelector('[data-gallery-close]').onclick = closeViewer;
      viewer.querySelector('[data-gallery-prev]').onclick = () => {
        index--;
        show();
      };
      viewer.querySelector('[data-gallery-next]').onclick = () => {
        index++;
        show();
      };
    }
    viewer.onkeydown = (event) => {
      if (event.key === 'ArrowLeft' && index > 0) {
        event.preventDefault();
        index--;
        show();
      }
      if (event.key === 'ArrowRight' && index < images.length - 1) {
        event.preventDefault();
        index++;
        show();
      }
    };
    viewer.addEventListener('close', () => trigger?.focus({ preventScroll: true }), { once: true });
    show();
    viewer.showModal();
  }
  const blockAccidentalActivation = (event) => {
    if (Date.now() < suppressClickUntil || (!isEditing() && event.type === 'dblclick')) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  host.addEventListener('click', blockAccidentalActivation, true);
  host.addEventListener('dblclick', blockAccidentalActivation, true);
  host.addEventListener('click', (event) => {
    if (!isEditing() && event.target.matches('.gallery-slide img')) view(activeId, event.target);
    const button = event.target.closest('[data-view-media]');
    if (button) view(button.dataset.viewMedia, button);
    const step = event.target.closest('[data-gallery-step]');
    if (step && step.getAttribute('aria-disabled') !== 'true') {
      event.preventDefault();
      void navigate(stepFrom() + Number(step.dataset.galleryStep));
    }
    const dot = event.target.closest('[data-gallery-index]');
    if (dot) {
      event.preventDefault();
      void navigate(Number(dot.dataset.galleryIndex));
    }
  });
  host.addEventListener('keydown', (event) => {
    if (
      isEditing() ||
      isDeferred() ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
    )
      return;
    if (event.target.closest('audio,video,input,textarea,select')) return;
    event.preventDefault();
    const index =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? (galleryAttachmentOrder(currentEntry()).length || 1) - 1
          : stepFrom() + (event.key === 'ArrowLeft' ? -1 : 1);
    void navigate(index);
  });
  host.addEventListener('pointerdown', (event) => {
    if (
      isEditing() ||
      isDeferred() ||
      event.button !== 0 ||
      event.isPrimary === false ||
      galleryAttachmentOrder(currentEntry()).length < 2
    )
      return;
    if (!event.target.closest('.gallery-slide img')) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, locked: false };
  });
  host.addEventListener('pointermove', (event) => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const dx = event.clientX - pointer.x,
      dy = event.clientY - pointer.y;
    if (!pointer.locked && Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) {
      pointer = null;
      return;
    }
    if (!pointer.locked && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      pointer.locked = true;
      host.setPointerCapture?.(event.pointerId);
    }
    if (!pointer.locked) return;
    event.preventDefault();
    pointer.dx = dx;
    const slide = host.querySelector('.gallery-slide');
    if (slide && !reducedMotion())
      slide.style.transform = `translateX(${Math.max(-70, Math.min(70, dx * 0.4))}px)`;
  });
  const finishSwipe = (event) => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const gesture = pointer;
    pointer = null;
    if (host.hasPointerCapture?.(event.pointerId)) host.releasePointerCapture(event.pointerId);
    const slide = host.querySelector('.gallery-slide');
    if (slide) slide.style.transform = '';
    if (!gesture.locked) return;
    suppressClickUntil = Date.now() + 450;
    if (event.type === 'pointerup' && Math.abs(gesture.dx) >= 38)
      void navigate(stepFrom() + (gesture.dx < 0 ? 1 : -1));
  };
  host.addEventListener('pointerup', finishSwipe);
  host.addEventListener('pointercancel', finishSwipe);
  function render(entry) {
    entry = projectedEntry(entry);
    if (entry && entry.id === entryId && isDeferred()) {
      navigation++;
      pendingId = null;
      if (pointer && host.hasPointerCapture?.(pointer.id)) host.releasePointerCapture(pointer.id);
      pointer = null;
      const slide = host.querySelector('.gallery-slide');
      if (slide) slide.style.transform = '';
      host.setAttribute('aria-busy', 'true');
      return;
    }
    disposeSort();
    navigation++;
    pendingId = null;
    pointer = null;
    if (entry?.id !== entryId) {
      closeViewer();
      activeId = rememberedPositions.get(entry?.id) || null;
    }
    entryId = entry?.id || null;
    lastEditing = isEditing();
    host.setAttribute('aria-busy', String(!!entry && isDeferred()));
    host.classList.add('entry-gallery');
    host.classList.toggle('gallery-editing', lastEditing);
    host.classList.toggle('gallery-reading', !lastEditing);
    host.setAttribute('aria-label', lastEditing ? '编辑日记附件' : '日记附件，逐张查看');
    if (!entry) {
      host.innerHTML = '';
      return;
    }
    const order = galleryAttachmentOrder(entry);
    if ((entry.contentFormat === 'richdoc' || entry._readingProjection) && !order.length) {
      host.innerHTML = '';
      appendLegacy(entry);
      return;
    }
    if (!order.includes(activeId)) activeId = order[0] || null;
    if (!lastEditing && order.length) {
      host.innerHTML = `<section class="gallery-carousel" role="region" aria-roledescription="轮播" aria-label="日记附件"><div class="gallery-stage" tabindex="0" aria-label="使用左右方向键或横向滑动切换"><div class="gallery-slide" data-media-id="${esc(activeId)}">${preview(activeId)}</div>${order.length > 1 ? '<button class="gallery-arrow gallery-arrow-prev" data-gallery-step="-1" aria-label="上一张">‹</button><button class="gallery-arrow gallery-arrow-next" data-gallery-step="1" aria-label="下一张">›</button><span class="gallery-counter" data-gallery-counter></span>' : ''}<button class="gallery-expand" data-view-media="${esc(activeId)}" aria-label="查看完整大图" title="查看完整大图">⛶</button></div>${order.length > 1 ? '<nav class="gallery-dots" aria-label="选择附件"></nav>' : ''}<span class="gallery-announcement" aria-live="polite" aria-atomic="true"></span></section>`;
      updateNavigation();
      appendLegacy(entry);
      return;
    }
    host.innerHTML =
      order
        .map((id) => {
          const index = order.indexOf(id);
          const editable = lastEditing && !entry.deleted;
          const media = c.library.media.find((m) => m.id === id);
          const name = media?.name || `缺少附件：${id}`;
          const src = '/media/' + encodeURIComponent(id);
          const preview = !media
            ? '<p class="gallery-missing">附件文件记录缺失，保留此关联供恢复。</p>'
            : media.type?.startsWith('image/')
              ? `<img src="${src}" alt="${esc(name)}" loading="lazy" draggable="false">`
              : media.type?.startsWith('video/')
                ? `<video src="${src}" controls preload="metadata"></video>`
                : media.type?.startsWith('audio/')
                  ? `<audio src="${src}" controls preload="metadata"></audio>`
                  : `<a href="${src}" download="${esc(name)}">下载附件</a>`;
          return `<article class="media-item" data-media-id="${esc(id)}" draggable="${editable}"><div class="gallery-item-head"><span class="gallery-number">${index + 1}</span>${editable ? `<button class="gallery-drag-handle" data-sort-handle draggable="true" aria-label="拖动${esc(name)}调整顺序，或按 Alt 加方向键" title="拖动调整顺序">⠿</button>` : ''}<small title="${esc(name)}">${esc(name)}</small>${editable ? `<button class="media-remove" data-remove-media="${esc(id)}" aria-label="移除此附件引用">×</button>` : ''}</div>${preview}<div class="gallery-item-actions">${media?.type?.startsWith('image/') ? `<button class="secondary" data-view-media="${esc(id)}">查看大图</button>` : ''}${editable ? `<button class="secondary" data-sort-step="-1" aria-label="上移${esc(name)}" ${index === 0 ? 'disabled' : ''}>↑</button><button class="secondary" data-sort-step="1" aria-label="下移${esc(name)}" ${index === order.length - 1 ? 'disabled' : ''}>↓</button>` : ''}</div></article>`;
        })
        .join('') ||
      '<p class="gallery-empty">把照片拖到这里，留住此刻。<br>也可以选择图片、音频或视频。</p>';
    appendLegacy(entry);
    if (entry.deleted || !lastEditing) return;
    const renderedId = entry.id;
    disposeSort = installDragSort(host, {
      itemSelector: '[data-media-id]',
      getId: (node) => node.dataset.mediaId,
      getOrder: () => galleryAttachmentOrder(currentEntry()),
      label: '日记附件',
      onError: (error) => toast(error.message),
      onReorder: async (next) => {
        const live = currentEntry();
        if (!live || live.deleted || live.id !== renderedId) return;
        live.attachments = mergeGalleryOrder(live, next);
        c.markDirty(live);
        render(live);
        await c.flush();
        toast('附件顺序已保存');
      },
    });
  }
  function appendLegacy(entry) {
    if (!entry.legacy?.mediaReferences?.length) return;
    const missing = entry.legacy.mediaReferences.filter(
      (reference) => reference.status !== 'basename_candidate',
    ).length;
    host.insertAdjacentHTML(
      'beforeend',
      `<p class="legacy-note">旧备份媒体：${missing} 项未匹配。已显示的附件按文件名匹配，仍需核对原图和排版。</p>`,
    );
  }
  doc.addEventListener?.('dblclick', (event) => {
    const image = event.target.closest?.('img[src^="/media/"]');
    if (!image || image.closest('.gallery-viewer, .entry-gallery')) return;
    view(decodeURIComponent(image.getAttribute('src').slice(7)), image);
  });
  return { render, closeViewer };
}
