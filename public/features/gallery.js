import { installDragSort } from '../core/drag-sort.js';

/** Gallery changes references only; existing media bytes and dates stay intact. */
export function createGallery(c) {
  const { $, escape: esc, toast } = c;
  const host = $('#attachments');
  const doc = host.ownerDocument || globalThis.document;
  const isEditing = () => !!doc?.body?.classList?.contains('writing-mode');
  let entryId = null,
    activeId = null,
    lastEditing = isEditing(),
    disposeSort = () => {},
    viewer = null;
  const currentEntry = () => c.library.entries.find((entry) => entry.id === entryId);
  function closeViewer() {
    if (viewer?.open) viewer.close();
  }
  function view(id, trigger) {
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
        viewer.innerHTML = '';
      });
    }
    let index = images.indexOf(id);
    if (index < 0) return;
    function show() {
      const media = c.library.media.find((m) => m.id === images[index]);
      if (!media) return closeViewer();
      viewer.innerHTML = `<header><span>${esc(media.name)} · ${index + 1} / ${images.length}</span><button class="secondary" data-gallery-close autofocus>关闭</button></header><div class="gallery-full-image"><img src="/media/${encodeURIComponent(media.id)}" alt="${esc(media.name)}" draggable="false"></div><footer><button class="secondary" data-gallery-prev ${index === 0 ? 'disabled' : ''}>上一张</button><a class="secondary" href="/media/${encodeURIComponent(media.id)}" download="${esc(media.name)}">保存原图</a><button class="secondary" data-gallery-next ${index === images.length - 1 ? 'disabled' : ''}>下一张</button></footer>`;
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
    viewer.addEventListener('close', () => trigger?.focus(), { once: true });
    show();
    viewer.showModal();
  }
  host.addEventListener('click', (event) => {
    const button = event.target.closest('[data-view-media]');
    if (button) view(button.dataset.viewMedia, button);
    const step = event.target.closest('[data-gallery-step]');
    if (step && !step.disabled) {
      const entry = currentEntry(),
        order = entry?.attachments || [];
      const index = order.indexOf(activeId) + Number(step.dataset.galleryStep);
      if (index < 0 || index >= order.length) return;
      activeId = order[index];
      render(entry);
      host.querySelector('.gallery-pagination')?.focus();
    }
  });
  host.addEventListener('keydown', (event) => {
    if (
      isEditing() ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      !['ArrowLeft', 'ArrowRight'].includes(event.key)
    )
      return;
    if (event.target.closest('audio,video,input,textarea,select')) return;
    const step = event.key === 'ArrowLeft' ? -1 : 1;
    const button = host.querySelector(`[data-gallery-step="${step}"]`);
    if (button && !button.disabled) {
      event.preventDefault();
      button.click();
    }
  });
  const Observer = doc?.defaultView?.MutationObserver || globalThis.MutationObserver;
  if (Observer && doc?.body) {
    new Observer(() => {
      if (lastEditing !== isEditing()) render(currentEntry());
    }).observe(doc.body, { attributes: true, attributeFilter: ['class'] });
  }
  function render(entry) {
    disposeSort();
    if (entry?.id !== entryId) {
      closeViewer();
      activeId = null;
    }
    entryId = entry?.id || null;
    lastEditing = isEditing();
    host.classList.add('entry-gallery');
    host.classList.toggle('gallery-editing', lastEditing);
    host.classList.toggle('gallery-reading', !lastEditing);
    host.setAttribute('aria-label', lastEditing ? '编辑日记附件' : '日记附件，逐张查看');
    if (!entry) {
      host.innerHTML = '';
      return;
    }
    const order = entry.attachments || [];
    if (!order.includes(activeId)) activeId = order[0] || null;
    const activeIndex = order.indexOf(activeId);
    host.innerHTML =
      (lastEditing ? order : order.filter((id) => id === activeId))
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
    if (!lastEditing && order.length) {
      host.insertAdjacentHTML(
        'beforeend',
        `<nav class="gallery-pagination" aria-label="附件翻页" tabindex="0"><button class="secondary" data-gallery-step="-1" ${activeIndex === 0 ? 'disabled' : ''}>上一张</button><span role="status" aria-live="polite">${activeIndex + 1} / ${order.length}</span><button class="secondary" data-gallery-step="1" ${activeIndex === order.length - 1 ? 'disabled' : ''}>下一张</button></nav>`,
      );
    }
    if (entry.legacy?.mediaReferences?.length) {
      const missing = entry.legacy.mediaReferences.filter(
        (r) => r.status !== 'basename_candidate',
      ).length;
      host.insertAdjacentHTML(
        'beforeend',
        `<p class="legacy-note">旧备份媒体：${missing} 项未匹配。已显示的附件按文件名匹配，仍需核对原图和排版。</p>`,
      );
    }
    if (entry.deleted || !lastEditing) return;
    const renderedId = entry.id;
    disposeSort = installDragSort(host, {
      itemSelector: '[data-media-id]',
      getId: (node) => node.dataset.mediaId,
      getOrder: () => currentEntry()?.attachments || [],
      label: '日记附件',
      onError: (error) => toast(error.message),
      onReorder: async (next) => {
        const live = currentEntry();
        if (!live || live.deleted || live.id !== renderedId) return;
        live.attachments = next;
        c.markDirty(live);
        render(live);
        await c.flush();
        toast('附件顺序已保存');
      },
    });
  }
  return { render, closeViewer };
}
