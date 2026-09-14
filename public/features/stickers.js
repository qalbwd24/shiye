import { uploadMediaFile } from '../core/api.js';
import { compressUpload } from '../core/media-compression.js';
import { chooseMediaBatch } from './media-batch.js';

export function filterStickers(items, { query = '', group = '', deleted = false } = {}) {
  const needle = query.trim().toLocaleLowerCase();
  return items.filter(
    (item) =>
      !!item.deleted === deleted &&
      (!group || item.group === group) &&
      (!needle || `${item.name} ${item.group}`.toLocaleLowerCase().includes(needle)),
  );
}

/** A picker only supplies an existing media ID. Publishing stays with its caller. */
export function createStickers(c) {
  const { api, escape: esc, toast } = c;
  let active = null;
  const mediaFor = (id) => c.library.media.find((media) => media.id === id);
  const image = (id, name) =>
    `<img src="/media/${encodeURIComponent(id)}" alt="${esc(name)}" loading="lazy" draggable="false">`;
  function shell(title, className = '') {
    const dialog = document.createElement('dialog');
    dialog.className = `sticker-dialog ${className}`;
    dialog.setAttribute('aria-label', title);
    dialog.innerHTML = `<header><h2>${esc(title)}</h2><button class="secondary" data-sticker-close aria-label="关闭${esc(title)}">关闭</button></header><div data-sticker-content><p role="status">正在读取…</p></div>`;
    dialog.querySelector('[data-sticker-close]').onclick = () => dialog.close();
    dialog.addEventListener(
      'close',
      () => {
        dialog.remove();
        if (active === dialog) active = null;
      },
      { once: true },
    );
    document.body.append(dialog);
    dialog.showModal();
    return dialog;
  }
  async function open(pickCallback = null) {
    active?.close();
    const dialog = shell(
      pickCallback ? '选择表情包' : '表情包管理',
      pickCallback ? 'sticker-picker' : 'sticker-manager',
    );
    active = dialog;
    let items = [],
      query = '',
      group = '',
      deleted = false,
      selected = null,
      busy = false;
    const body = dialog.querySelector('[data-sticker-content]');
    const status = (message, error = false) => {
      const node = dialog.querySelector('[data-sticker-status]');
      if (node) {
        node.textContent = message;
        node.classList.toggle('sticker-error', error);
      } else if (error) toast(message);
    };
    const upsert = (item) => {
      const index = items.findIndex((old) => old.id === item.id);
      if (index < 0) items.push(item);
      else items[index] = item;
    };
    async function mutate(action, success) {
      if (busy) return;
      busy = true;
      body.inert = true;
      try {
        await action();
        if (dialog.open) {
          render();
          status(success);
        }
      } catch (error) {
        if (dialog.open) status(error.message, true);
        else toast(error.message);
      } finally {
        busy = false;
        body.inert = false;
      }
    }
    async function reload() {
      try {
        items = await api('/api/stickers');
        if (dialog.open) render();
      } catch (error) {
        body.innerHTML = `<p role="alert">${esc(error.message)}</p><button class="secondary" data-sticker-retry>重试</button>`;
        body.querySelector('[data-sticker-retry]').onclick = reload;
      }
    }
    async function favorite(mediaId) {
      const media = mediaFor(mediaId);
      upsert(
        await api('/api/stickers', {
          method: 'POST',
          data: { mediaId, name: media?.name || '表情', group: group || '默认' },
        }),
      );
    }
    function collectExisting() {
      const chooser = shell('从已有图片收藏', 'sticker-existing');
      const content = chooser.querySelector('[data-sticker-content]');
      let search = '',
        limit = 100;
      content.innerHTML =
        '<input class="field" data-existing-search placeholder="搜索图片文件名" aria-label="搜索已有图片"><div class="sticker-grid" data-existing-grid></div><p data-existing-status role="status"></p><button class="secondary" data-existing-more>显示更多</button>';
      function show() {
        const media = c.library.media.filter(
          (item) =>
            item.type?.startsWith('image/') &&
            (!search || item.name?.toLocaleLowerCase().includes(search.toLocaleLowerCase())),
        );
        content.querySelector('[data-existing-grid]').innerHTML =
          media
            .slice(0, limit)
            .map(
              (item) =>
                `<button class="sticker-card" data-favorite-media="${esc(item.id)}" title="收藏${esc(item.name)}">${image(item.id, item.name)}<span>${esc(item.name)}</span></button>`,
            )
            .join('') || '<p class="sticker-empty">没有匹配的图片。</p>';
        content.querySelector('[data-existing-more]').hidden = media.length <= limit;
        content.querySelector('[data-existing-status]').textContent =
          `点击图片即可收藏；当前显示 ${Math.min(media.length, limit)} / ${media.length} 项。`;
      }
      content.querySelector('[data-existing-search]').oninput = (event) => {
        search = event.target.value;
        limit = 100;
        show();
      };
      content.querySelector('[data-existing-more]').onclick = () => {
        limit += 100;
        show();
      };
      content.querySelector('[data-existing-grid]').onclick = (event) => {
        const button = event.target.closest('[data-favorite-media]');
        if (!button) return;
        const id = button.dataset.favoriteMedia;
        chooser.close();
        void mutate(() => favorite(id), '已收藏；已有收藏会保留原记录');
      };
      show();
    }
    async function importFiles(files) {
      const chosen = await chooseMediaBatch(files, { escape: esc, targetLabel: '表情包收藏' });
      if (!chosen.length) return;
      await mutate(async () => {
        let completed = 0;
        for (const { file, quality } of chosen) {
          status(`正在处理 ${completed + 1} / ${chosen.length}：${file.name}`);
          const processed = await compressUpload(file, { quality });
          const media = await uploadMediaFile(
            processed.file,
            (progress) =>
              status(
                `正在上传 ${completed + 1} / ${chosen.length}：${Math.floor(progress * 100)}%`,
              ),
            {
              quality,
              originalSize: processed.originalSize,
              sourceCapturedAtRaw: processed.sourceCapturedAtRaw,
              sourceCapturedOffset: processed.sourceCapturedOffset,
              sourceCapturedTag: processed.sourceCapturedTag,
              compression: processed.changed ? 'image-canvas' : null,
            },
          );
          if (!c.library.media.some((item) => item.id === media.id)) c.library.media.push(media);
          await favorite(media.id);
          completed++;
        }
      }, '所选图片已加入表情包；GIF 保留动画');
    }
    function render() {
      const groups = [
        ...new Set(
          items.filter((item) => !!item.deleted === deleted).map((item) => item.group || '默认'),
        ),
      ].sort((a, b) => a.localeCompare(b, 'zh-CN'));
      if (group && !groups.includes(group)) group = '';
      body.innerHTML = `<div class="sticker-toolbar"><input class="field" data-sticker-search value="${esc(query)}" placeholder="搜索名称或分组" aria-label="搜索表情包"><select data-sticker-group aria-label="筛选表情包分组"><option value="">全部分组</option>${groups.map((name) => `<option>${esc(name)}</option>`).join('')}</select>${!pickCallback ? `<select data-sticker-state aria-label="表情包状态"><option value="active">正在使用</option><option value="deleted">已删除 · 可恢复</option></select><button class="primary" data-sticker-import>导入图片 / GIF</button><button class="secondary" data-sticker-existing>从已有图片收藏</button><input type="file" data-sticker-files accept="image/*" multiple hidden>` : ''}</div><p class="sticker-hint">${pickCallback ? '点击只会插入到当前输入草稿，发送仍由你确认。' : '静态图片默认压缩，GIF 动画保留。删除只移出收藏，不删除媒体文件。'}</p><div class="sticker-workspace"><div class="sticker-grid" data-sticker-grid></div>${!pickCallback ? '<section class="sticker-detail" data-sticker-detail aria-label="编辑表情包"></section>' : ''}</div><p role="status" aria-live="polite" data-sticker-status></p>`;
      body.querySelector('[data-sticker-group]').value = group;
      body.querySelector('[data-sticker-search]').oninput = (event) => {
        query = event.target.value;
        grid();
      };
      body.querySelector('[data-sticker-group]').onchange = (event) => {
        group = event.target.value;
        selected = null;
        grid();
        detail();
      };
      body.querySelector('[data-sticker-grid]').onclick = (event) => {
        const button = event.target.closest('[data-sticker-id]');
        if (!button) return;
        const item = items.find((value) => value.id === button.dataset.stickerId);
        if (!item || item.deleted) {
          if (item) {
            selected = item.id;
            grid();
            detail();
          }
          return;
        }
        if (pickCallback) {
          dialog.close();
          Promise.resolve()
            .then(() => pickCallback(item.mediaId))
            .catch((error) => toast(error.message));
        } else {
          selected = item.id;
          grid();
          detail();
        }
      };
      if (!pickCallback) {
        body.querySelector('[data-sticker-state]').value = deleted ? 'deleted' : 'active';
        body.querySelector('[data-sticker-state]').onchange = (event) => {
          deleted = event.target.value === 'deleted';
          selected = null;
          group = '';
          render();
        };
        body.querySelector('[data-sticker-import]').onclick = () =>
          body.querySelector('[data-sticker-files]').click();
        body.querySelector('[data-sticker-existing]').onclick = collectExisting;
        body.querySelector('[data-sticker-files]').onchange = (event) => {
          const files = [...event.target.files].filter((file) => file.type.startsWith('image/'));
          event.target.value = '';
          if (files.length) void importFiles(files).catch((error) => status(error.message, true));
        };
      }
      grid();
      detail();
    }
    function grid() {
      const list = filterStickers(items, { query, group, deleted });
      body.querySelector('[data-sticker-grid]').innerHTML =
        list
          .map(
            (item) =>
              `<button class="sticker-card ${item.id === selected ? 'selected' : ''}" data-sticker-id="${esc(item.id)}" title="${esc(item.name)}">${image(item.mediaId, item.name)}<span>${esc(item.name)}</span><small>${esc(item.group)}</small></button>`,
          )
          .join('') ||
        `<p class="sticker-empty">${deleted ? '没有已删除的表情包。' : '还没有匹配的表情包。可以在管理中导入或从已有图片收藏。'}</p>`;
    }
    function detail() {
      if (pickCallback) return;
      const target = body.querySelector('[data-sticker-detail]'),
        item = items.find((value) => value.id === selected);
      if (!item) {
        target.innerHTML = '<h3>选择一个表情包</h3><p>修改名称和分组，或移到已删除列表。</p>';
        return;
      }
      target.innerHTML = `${image(item.mediaId, item.name)}<label>名称<input class="field" data-sticker-name maxlength="100" value="${esc(item.name)}"></label><label>分组<input class="field" data-sticker-edit-group maxlength="60" value="${esc(item.group)}" placeholder="默认"></label><button class="primary" data-sticker-save>保存名称和分组</button><button class="secondary" data-sticker-delete>${item.deleted ? '恢复收藏' : '移到已删除'}</button>`;
      target.querySelector('[data-sticker-save]').onclick = () => {
        const name = target.querySelector('[data-sticker-name]').value.trim(),
          editedGroup = target.querySelector('[data-sticker-edit-group]').value.trim() || '默认';
        if (!name) return status('请填写表情包名称', true);
        void mutate(
          async () =>
            upsert(
              await api('/api/stickers/' + encodeURIComponent(item.id), {
                method: 'PUT',
                data: { name, group: editedGroup },
              }),
            ),
          '名称和分组已保存',
        );
      };
      target.querySelector('[data-sticker-delete]').onclick = () =>
        void mutate(
          async () => {
            upsert(
              await api('/api/stickers/' + encodeURIComponent(item.id), {
                method: 'PUT',
                data: { deleted: !item.deleted },
              }),
            );
            selected = null;
          },
          item.deleted ? '已恢复收藏' : '已移到已删除，媒体文件保留',
        );
    }
    await reload();
  }
  return { manage: () => open(), pick: (onSelect) => open(onSelect) };
}
