import { createDiaryClient } from '../integrations/diary-client.js';
import { sanitize } from '../editor/content.js';
import { renderMarkdown } from '../editor/markdown-renderer.js';

const client = createDiaryClient();
const $ = (selector) => document.querySelector(selector);
let mode = 'recent';
let current = null;
let nextOffset = null;
let snapshot;
let generation = 0;
let busy = false;

function controls() {
  $('.card').setAttribute('aria-busy', String(busy));
  $('#pin').disabled = busy || !current;
  $('#refresh').disabled = busy;
  $('#next').disabled = busy || !current || (mode !== 'random' && nextOffset === null);
  // Mode changes can supersede an in-flight read; writes disable every control.
  for (const button of document.querySelectorAll('[data-mode]'))
    button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
}

function render(entry) {
  current = entry || null;
  $('#entry').hidden = !entry;
  $('#content').replaceChildren();
  $('#image').removeAttribute('src');
  $('#picture').hidden = true;
  $('#pin').setAttribute('aria-pressed', String(!!entry?.state?.pinned));
  $('#pin').textContent = entry?.state?.pinned ? '取消置顶' : '置顶';
  if (!entry) return;
  $('#title').textContent = entry.title || '无标题日记';
  $('#metadata').textContent = [entry.recordedDate || entry.date, entry.category]
    .filter(Boolean)
    .join(' · ');
  const html =
    entry.document?.format === 'markdown'
      ? renderMarkdown(entry.document.source || '')
      : sanitize(entry.document?.html || '');
  const body = new DOMParser().parseFromString(html, 'text/html');
  let imageURL = body.body.querySelector('img')?.getAttribute('src');
  body.body.querySelectorAll('img').forEach((image) => image.remove());
  $('#content').replaceChildren(...body.body.childNodes);
  imageURL ||= entry.attachments?.find((attachment) => attachment.type?.startsWith('image/'))?.url;
  if (imageURL && /^\/media\/[a-zA-Z0-9%._-]+$/.test(imageURL)) {
    $('#image').src = imageURL;
    $('#picture').hidden = false;
  }
}

function showError(error) {
  $('#unlock').hidden = error.status !== 401;
  $('#status').textContent =
    error.status === 401
      ? '日记库已锁定。请在主应用解锁，然后点击刷新。'
      : error.status === 409
        ? '日记库已有变化。请刷新后再试。'
        : '暂时无法读取日记，请点击刷新重试。';
}

async function load({ next = false } = {}) {
  const token = ++generation;
  const previousId = current?.id;
  busy = true;
  $('#unlock').hidden = true;
  $('#status').textContent = '正在翻开日记…';
  render(null);
  controls();
  try {
    const parameters = { limit: 1, timeZone: 'Asia/Shanghai' };
    if (next && mode !== 'random') Object.assign(parameters, { offset: nextOffset, snapshot });
    const page =
      mode === 'random'
        ? await client.random({ ...parameters, exclude: next ? previousId : undefined })
        : mode === 'anniversary'
          ? await client.anniversary(parameters)
          : await client.list({ ...parameters, sort: 'date-desc' });
    if (token !== generation) return;
    snapshot = page.snapshot;
    nextOffset = page.nextOffset;
    render(page.entries[0]);
    $('#status').textContent = current
      ? ''
      : mode === 'anniversary'
        ? '往年的今天还没有日记。试试最近或随机吧。'
        : '这里还没有可显示的日记。';
  } catch (error) {
    if (token !== generation) return;
    showError(error);
  } finally {
    if (token === generation) {
      busy = false;
      controls();
    }
  }
}

for (const button of document.querySelectorAll('[data-mode]')) {
  button.addEventListener('click', () => {
    mode = button.dataset.mode;
    nextOffset = null;
    snapshot = undefined;
    void load();
  });
}
$('#refresh').addEventListener('click', () => void load());
$('#next').addEventListener('click', () => void load({ next: true }));
$('#image').addEventListener('error', () => {
  $('#picture').hidden = true;
});
$('#pin').addEventListener('click', async () => {
  if (!current || busy) return;
  const entry = current;
  const token = ++generation;
  busy = true;
  controls();
  document.querySelectorAll('[data-mode]').forEach((button) => (button.disabled = true));
  $('#status').textContent = '正在保存置顶状态…';
  try {
    const saved = await client.setPinned(entry.id, !entry.state.pinned, entry.revision);
    if (token !== generation) return;
    render(saved);
    snapshot = undefined;
    nextOffset = null;
    $('#status').textContent = '已保存。刷新可重新浏览日记。';
  } catch (error) {
    if (token === generation) {
      // Do not keep potentially stale private content visible after a lock or conflict.
      render(null);
      showError(error);
    }
  } finally {
    if (token === generation) {
      busy = false;
      document.querySelectorAll('[data-mode]').forEach((button) => (button.disabled = false));
      controls();
    }
  }
});
void load();
