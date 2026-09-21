import { uploadMediaFile } from '../core/api.js';
import { isExternalFileDrag, SORT_MIME } from '../core/drag-sort.js';
import { compressUpload } from '../core/media-compression.js';
import { chooseMediaBatch } from './media-batch.js';

/** Owns file drops, upload queue and progress UI. Captures the target entry per batch. */
export function createMediaImport(c) {
  const { $, escape: esc, toast } = c;
  const jobs = [];
  const activeStates = ['queued', 'processing', 'uploading', 'saving'];
  const bytes = (size) =>
    size >= 1048576 ? `${(size / 1048576).toFixed(1)} MB` : `${Math.ceil(size / 1024)} KB`;
  let queue = Promise.resolve(),
    depth = 0,
    visible = false,
    internalDrag = false;
  const overlay = document.createElement('div');
  overlay.className = 'media-drop-overlay';
  overlay.innerHTML =
    '<div><strong>松开，加入当前日记</strong><p>图片、视频和音频将作为附件保存在本地</p></div>';
  overlay.hidden = true;
  document.body.append(overlay);
  const panel = document.createElement('section');
  panel.className = 'media-upload-panel';
  panel.hidden = true;
  panel.setAttribute('aria-label', '媒体上传队列');
  panel.setAttribute('role', 'region');
  document.body.append(panel);
  const hasFiles = (event) => isExternalFileDrag(event.dataTransfer, internalDrag);
  const targetReady = () =>
    c.current() &&
    !c.current().deleted &&
    (!$('#journalView').classList.contains('hidden') ||
      ($('#editorPanel')?.classList.contains('embedded-entry-reader') &&
        $('#editorPanel').getClientRects().length > 0)) &&
    !document.querySelector('dialog[open]');
  const hide = () => {
    depth = 0;
    overlay.hidden = true;
  };
  function render() {
    panel.hidden = !visible || !jobs.length;
    panel.innerHTML = `<header><strong>媒体文件 · ${jobs.filter((j) => j.state === 'done').length}/${jobs.length} 已保存</strong><button class="secondary" data-dismiss>收起</button></header><div class="media-upload-rows">${jobs.map((j, i) => `<div class="media-upload-row ${j.state === 'error' ? 'upload-error' : ''}"><span>${esc(j.file.name)}</span><small ${j.state === 'error' ? 'role="alert"' : ''}>${esc(j.message)}</small>${j.sizeNote ? `<small class="media-size-note">${esc(j.sizeNote)}</small>` : ''}${j.processed?.metadataWarning ? `<small class="media-size-note">${esc(j.processed.metadataWarning)}</small>` : ''}<progress max="1" value="${j.progress}" aria-label="${esc(j.file.name)}上传进度"></progress>${j.state === 'error' ? `<button class="secondary" data-retry="${i}">重试</button><button class="secondary" data-clear="${i}">移除失败项</button>` : ''}</div>`).join('')}</div><p role="status" aria-live="polite">${jobs.some((j) => activeStates.includes(j.state)) ? '完成上传与处理后还会确认日记附件已保存。' : jobs.some((j) => j.state === 'error') ? '有文件尚未保存，请查看错误并重试。移除失败项不会删除已上传文件。' : '全部附件已保存。'}</p>`;
    panel.querySelector('[data-dismiss]').onclick = () => {
      visible = false;
      panel.hidden = true;
    };
    panel.querySelectorAll('[data-retry]').forEach((button) => {
      button.onclick = () => {
        const j = jobs[Number(button.dataset.retry)];
        j.state = 'queued';
        enqueue(j);
      };
    });
    panel.querySelectorAll('[data-clear]').forEach((button) => {
      button.onclick = () => {
        jobs.splice(Number(button.dataset.clear), 1);
        render();
      };
    });
  }
  // Capture before child sort handlers run. Browser image drags may contain
  // Files, so inspecting the drop payload alone is not sufficient.
  document.addEventListener(
    'dragstart',
    (event) => {
      internalDrag = true;
      hide();
      // Native event dispatch can run microtasks between listeners. Wait for
      // the complete event (including a later canceled dragstart) instead.
      setTimeout(() => {
        if (event.defaultPrevented) internalDrag = false;
      }, 0);
    },
    true,
  );
  document.addEventListener(
    'drop',
    (event) => {
      if (Array.from(event.dataTransfer?.types || []).includes(SORT_MIME)) event.preventDefault();
      if (internalDrag)
        setTimeout(() => {
          internalDrag = false;
        }, 0);
    },
    true,
  );
  async function run(job) {
    try {
      if (!job.media) {
        if (!job.processed) {
          job.state = 'processing';
          job.message = '正在本地处理图片';
          render();
          job.processed = await compressUpload(job.file, { quality: job.quality });
          job.sizeNote =
            job.file.type.startsWith('video/') && job.quality !== 'original'
              ? `${bytes(job.file.size)} · 等待视频压缩结果`
              : `${bytes(job.processed.originalSize)} → ${bytes(job.processed.file.size)} · ${job.processed.reason}`;
        }
        job.state = 'uploading';
        job.message = '正在上传';
        render();
        job.media = await uploadMediaFile(
          job.processed.file,
          (n) => {
            job.progress = n;
            job.message = `${job.file.type.startsWith('video/') ? '上传 / 处理' : '已上传'} ${Math.floor(n * 100)}%`;
            render();
          },
          {
            quality: job.quality,
            originalSize: job.processed.originalSize,
            sourceCapturedAtRaw: job.processed.sourceCapturedAtRaw,
            sourceCapturedTag: job.processed.sourceCapturedTag,
            sourceCapturedOffset: job.processed.sourceCapturedOffset,
            compression: job.processed.changed ? 'image-canvas' : null,
          },
        );
        job.sizeNote = `${bytes(job.file.size)} → ${bytes(job.media.size ?? job.processed.file.size)}${job.processed.changed ? ' · 已压缩' : ''}`;
      }
      // A taxonomy operation may have refreshed the library during the upload.
      const entry = c.library.entries.find((e) => e.id === job.entryId);
      if (!entry || entry.deleted) throw Error('目标日记不可编辑，请恢复它后重试');
      if (!c.library.media.some((m) => m.id === job.media.id)) c.library.media.push(job.media);
      if (!entry.attachments.includes(job.media.id)) entry.attachments.push(job.media.id);
      job.state = 'saving';
      job.message = '正在保存附件关联';
      render();
      c.markDirty(entry);
      if (c.current()?.id === entry.id) c.renderAttachments();
      await c.flush();
      job.state = 'done';
      job.message = '已保存到目标日记';
      job.progress = 1;
    } catch (e) {
      job.state = 'error';
      job.message = e.message;
    }
    render();
  }
  function enqueue(job) {
    render();
    queue = queue.then(() => run(job));
    return queue;
  }
  async function upload(files, targetEntry = null) {
    const entry = targetEntry || c.current();
    if (!entry || entry.deleted) return toast('请先选择或新建一篇日记');
    if (!files.length) return;
    const targetId = entry.id;
    let quality = 'balanced';
    try {
      quality = localStorage.getItem('shiye.media-quality') || quality;
    } catch {
      /* Use the batch default. */
    }
    const selection = await (c.chooseMediaBatch || chooseMediaBatch)([...files], {
      escape: esc,
      quality,
      targetLabel: entry.title || '无标题日记',
    });
    if (!selection.length) return;
    if (!c.library.entries.some((item) => item.id === targetId && !item.deleted))
      return toast('原目标日记已不可编辑，本批文件没有上传');
    // Release old completed File references between batches.
    for (let i = jobs.length - 1; i >= 0; i--) if (jobs[i].state === 'done') jobs.splice(i, 1);
    visible = true;
    for (const { file, quality: selectedQuality } of selection) {
      const job = {
        file,
        quality: selectedQuality,
        entryId: targetId,
        progress: 0,
        state: 'queued',
        message: '等待处理',
      };
      jobs.push(job);
      enqueue(job);
    }
    await queue;
  }
  document.addEventListener('dragenter', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    depth++;
    if (targetReady()) overlay.hidden = false;
  });
  document.addEventListener('dragover', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = targetReady() ? 'copy' : 'none';
    if (!targetReady()) overlay.hidden = true;
  });
  document.addEventListener('dragleave', (event) => {
    if (!hasFiles(event)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) hide();
  });
  document.addEventListener('drop', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    hide();
    if (targetReady()) upload([...event.dataTransfer.files]).catch((e) => toast(e.message));
    else toast('请先打开一篇可编辑的日记，再拖入文件');
  });
  window.addEventListener('blur', hide);
  document.addEventListener('dragend', () => {
    internalDrag = false;
    hide();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hide();
  });
  window.addEventListener('beforeunload', (event) => {
    if (jobs.some((j) => activeStates.includes(j.state))) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  return {
    upload,
    show: () => {
      visible = true;
      render();
    },
  };
}
