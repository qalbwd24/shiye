import { uploadMediaFile } from '../core/api.js';

/** Owns file drops, upload queue and progress UI. Captures the target entry per batch. */
export function createMediaImport(c) {
  const { $, escape: esc, toast } = c;
  const jobs = [];
  let queue = Promise.resolve(),
    depth = 0,
    visible = false;
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
  document.body.append(panel);
  const hasFiles = (event) => [...(event.dataTransfer?.types || [])].includes('Files');
  const targetReady = () =>
    c.current() &&
    !c.current().deleted &&
    !$('#journalView').classList.contains('hidden') &&
    !$('#modal').open;
  const hide = () => {
    depth = 0;
    overlay.hidden = true;
  };
  function render() {
    panel.hidden = !visible || !jobs.length;
    panel.innerHTML = `<header><strong>媒体文件 · ${jobs.filter((j) => j.state === 'done').length}/${jobs.length} 已保存</strong><button class="secondary" data-dismiss>收起</button></header><div class="media-upload-rows">${jobs.map((j, i) => `<div class="media-upload-row"><span>${esc(j.file.name)}</span><small>${esc(j.message)}</small><progress max="1" value="${j.progress}" aria-label="${esc(j.file.name)}上传进度"></progress>${j.state === 'error' ? `<button class="secondary" data-retry="${i}">重试</button>` : ''}</div>`).join('')}</div><p role="status">${jobs.some((j) => ['queued', 'uploading', 'saving'].includes(j.state)) ? '完成上传后还会确认日记附件已保存。' : '队列已完成；失败项可单独重试。'}</p>`;
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
  }
  async function run(job) {
    try {
      if (!job.media) {
        job.state = 'uploading';
        job.message = '正在上传';
        render();
        job.media = await uploadMediaFile(job.file, (n) => {
          job.progress = n;
          job.message = `已上传 ${Math.floor(n * 100)}%`;
          render();
        });
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
    // Release old completed File references between batches.
    for (let i = jobs.length - 1; i >= 0; i--) if (jobs[i].state === 'done') jobs.splice(i, 1);
    visible = true;
    for (const file of files) {
      const job = { file, entryId: entry.id, progress: 0, state: 'queued', message: '等待上传' };
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
  document.addEventListener('dragend', hide);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hide();
  });
  window.addEventListener('beforeunload', (event) => {
    if (jobs.some((j) => ['queued', 'uploading', 'saving'].includes(j.state))) {
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
