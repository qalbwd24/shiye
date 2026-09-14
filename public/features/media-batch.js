/** A checked box means original quality, never inclusion in the upload. */
export function batchSelection(files, preserveOriginal, removed, quality = 'balanced') {
  const compressedQuality = quality === 'high' ? 'high' : 'balanced';
  return files.flatMap((file, index) =>
    removed.has(index)
      ? []
      : [{ file, quality: preserveOriginal.has(index) ? 'original' : compressedQuality }],
  );
}

/** Review local File objects before any upload. Canceling does not issue a request. */
export function chooseMediaBatch(
  files,
  { escape: esc, quality = 'balanced', targetLabel = '当前日记' },
) {
  if (!files.length) return Promise.resolve([]);
  const dialog = document.createElement('dialog'),
    urls = [],
    removed = new Set();
  dialog.className = 'media-batch-dialog';
  const size = (bytes) =>
    bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
  dialog.innerHTML = `<header><div><h2>添加文件 · 默认压缩</h2><p>添加到：${esc(targetLabel)}</p></div><button class="secondary" data-batch-cancel aria-label="取消添加">×</button></header><div class="media-batch-toolbar"><button class="secondary" data-batch-compress>全部压缩</button><button class="secondary" data-batch-preserve>全部保留原件</button><label>压缩质量 <select data-batch-quality aria-label="本批文件压缩质量"><option value="balanced">均衡 · 更省空间</option><option value="high">清晰 · 保留更多细节</option></select></label></div><div class="media-batch-list">${files
    .map((file, index) => {
      let preview = `<span class="batch-file-kind">${file.type.startsWith('video/') ? '视频' : file.type.startsWith('audio/') ? '音频' : '文件'}</span>`;
      if (/^image\/(jpeg|png|webp|gif)$/.test(file.type)) {
        const url = URL.createObjectURL(file);
        urls.push(url);
        preview = `<img src="${url}" alt="" loading="lazy" draggable="false">`;
      }
      return `<div class="media-batch-item" data-batch-row="${index}">${preview}<div><strong>${esc(file.name)}</strong><small>${size(file.size)} · ${esc(file.type || '未知格式')}</small><label class="batch-preserve"><input type="checkbox" data-batch-index="${index}" aria-label="保留原件：${esc(file.name)}">保留原件</label></div><button class="secondary" data-batch-remove="${index}" aria-label="不添加${esc(file.name)}">不添加</button></div>`;
    })
    .join(
      '',
    )}</div><p class="media-batch-note">所有文件默认添加并压缩，勾选「保留原件」才跳过压缩。不需要添加的文件请点「不添加」，可恢复。动画图片保留原件；压缩副本不保留完整 EXIF，读取到的 EXIF 日期会另存。视频压缩可能需要较长时间。</p><footer><span role="status" data-batch-count></span><button class="secondary" data-batch-cancel>取消</button><button class="primary" data-batch-confirm>确认添加</button></footer>`;
  dialog.querySelector('[data-batch-quality]').value = quality === 'high' ? 'high' : 'balanced';
  const boxes = [...dialog.querySelectorAll('[data-batch-index]')];
  const selected = () =>
    batchSelection(
      files,
      new Set(boxes.filter((box) => box.checked).map((box) => Number(box.dataset.batchIndex))),
      removed,
      dialog.querySelector('[data-batch-quality]').value,
    );
  const update = () => {
    const selection = selected(),
      originals = selection.filter((item) => item.quality === 'original').length;
    dialog.querySelector('[data-batch-count]').textContent =
      `待添加 ${selection.length} 项 · 保留原件 ${originals} · 压缩 ${selection.length - originals}`;
    dialog.querySelector('[data-batch-confirm]').disabled = !selection.length;
  };
  boxes.forEach((box) => box.addEventListener('change', update));
  for (const [selector, checked] of [
    ['[data-batch-compress]', false],
    ['[data-batch-preserve]', true],
  ]) {
    dialog.querySelector(selector).onclick = () => {
      boxes.forEach((box) => {
        box.checked = checked;
      });
      update();
    };
  }
  dialog.querySelectorAll('[data-batch-remove]').forEach((button) => {
    button.onclick = () => {
      const index = Number(button.dataset.batchRemove);
      if (removed.has(index)) removed.delete(index);
      else removed.add(index);
      const excluded = removed.has(index);
      boxes[index].disabled = excluded;
      button.closest('[data-batch-row]').classList.toggle('batch-excluded', excluded);
      button.textContent = excluded ? '恢复添加' : '不添加';
      button.setAttribute('aria-label', `${excluded ? '恢复添加' : '不添加'}${files[index].name}`);
      update();
    };
  });
  dialog.querySelectorAll('[data-batch-cancel]').forEach((button) => {
    button.onclick = () => dialog.close();
  });
  update();
  document.body.append(dialog);
  return new Promise((resolve) => {
    let selection = [];
    dialog.querySelector('[data-batch-confirm]').onclick = () => {
      selection = selected();
      try {
        localStorage.setItem(
          'shiye.media-quality',
          dialog.querySelector('[data-batch-quality]').value,
        );
      } catch {
        /* This batch can still proceed. */
      }
      dialog.close();
    };
    dialog.addEventListener(
      'close',
      () => {
        urls.forEach((url) => URL.revokeObjectURL(url));
        dialog.remove();
        resolve(selection);
      },
      { once: true },
    );
    dialog.showModal();
  });
}
