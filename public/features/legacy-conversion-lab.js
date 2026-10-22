import { sanitize } from '../editor/content.js';
import { createRichEditor } from '../editor/rich-document-editor.js';
const token = location.hash.slice(1);
const $ = (s) => document.querySelector(s);
let samples = [],
  current = null,
  reader = null,
  navigation = 0;
const blobs = new Map();
async function api(route) {
  const r = await fetch(route, { headers: { 'X-Lab-Session': token } });
  if (!r.ok) throw Error('试验库读取失败，请使用本次试验入口；原库未改变。');
  return r.json();
}
async function mediaUrl(id) {
  if (!blobs.has(id)) {
    const r = await fetch('/api/media/' + encodeURIComponent(id), {
      headers: { 'X-Lab-Session': token },
    });
    if (!r.ok) return '';
    blobs.set(id, URL.createObjectURL(await r.blob()));
  }
  return blobs.get(id);
}
function list() {
  const query = $('#search').value.trim().toLowerCase(),
    cohort = $('#cohort').value,
    result = $('#result').value;
  const fragment = document.createDocumentFragment();
  for (const row of samples.filter(
    (s) =>
      (cohort === 'all' || s.cohort === cohort) &&
      (result === 'all' || (result === 'review') === s.requiresReview) &&
      s.title.toLowerCase().includes(query),
  )) {
    const b = document.createElement('button');
    b.className = row.key === current ? 'active' : '';
    b.textContent = row.title || '无标题';
    const small = document.createElement('small');
    small.textContent = `${row.requiresReview ? '需要核对' : '未发现保真差异'} · ${row.format} · ${row.sourceYear}`;
    b.append(small);
    b.onclick = () => open(row.key);
    fragment.append(b);
  }
  $('#samples').replaceChildren(fragment);
}
async function attachment(id, byId) {
  const item = document.createElement('div');
  item.className = 'attachment';
  const metadata = byId.get(id);
  const url = await mediaUrl(id);
  if (metadata?.type?.startsWith('image/') && url) {
    const image = document.createElement('img');
    image.src = url;
    image.alt = '原附件图片';
    image.onclick = () => window.open(url, '_blank', 'noopener');
    item.append(image);
  } else {
    const b = document.createElement('button');
    b.textContent = metadata?.name || '附件不可用';
    b.disabled = !url;
    b.onclick = () => {
      const a = document.createElement('a');
      a.href = url;
      a.download = metadata?.name || 'attachment';
      a.click();
    };
    item.append(b);
  }
  return item;
}
async function open(key) {
  const turn = ++navigation;
  try {
    const payload = await api('/api/entry/' + key);
    const ids = [...new Set(payload.media.map((m) => m.id))];
    await Promise.all(ids.map(mediaUrl));
    if (turn !== navigation) return;
    current = key;
    list();
    reader?.destroy();
    $('#title').textContent = payload.original.title || '无标题';
    $('#metadata').textContent =
      `${payload.original.category || '未分类'} · ${(payload.original.tags || []).join('、')} · ${payload.temporal.anchors.length} 个时间锚点`;
    $('#diagnostics').textContent = JSON.stringify(
      { 检查: payload.validation, 时间问题: payload.temporal.issues },
      null,
      2,
    );
    const old = document.createElement('div');
    old.innerHTML = sanitize(payload.original.content);
    for (const img of old.querySelectorAll('img')) {
      const match = /^\/media\/([^/]+)$/.exec(img.getAttribute('src') || '');
      if (match) {
        img.src = blobs.get(decodeURIComponent(match[1])) || '';
        img.onclick = () => window.open(img.src, '_blank', 'noopener');
      }
    }
    $('#original').replaceChildren(...old.childNodes);
    const byId = new Map(payload.media.map((m) => [m.id, m]));
    const oldAttachments = await Promise.all(
      (payload.candidate.attachmentPlacements || []).map((p) => attachment(p.assetId, byId)),
    );
    if (turn !== navigation) return;
    $('#original-attachments').replaceChildren(...oldAttachments);
    const prefix = await Promise.all(
      (payload.candidate.attachmentPlacements || []).map((p) => attachment(p.assetId, byId)),
    );
    if (turn !== navigation) return;
    $('#candidate-attachments').replaceChildren(...prefix);
    const prefixBlocks = new Set(
      payload.candidate.attachmentPlacements.map((p) => p.blockId).filter(Boolean),
    );
    const body = structuredClone(payload.candidate.body);
    body.content = body.content.filter((n) => !prefixBlocks.has(n.attrs?.blockId));
    if (!body.content.length)
      body.content.push({ type: 'paragraph', attrs: { blockId: 'readonly-empty-body' } });
    $('#candidate').replaceChildren();
    reader = createRichEditor($('#candidate'), {
      body,
      editable: false,
      resolveAsset: (id) => blobs.get(id) || '',
      onImage: (id) => {
        const url = blobs.get(id);
        if (url) window.open(url, '_blank', 'noopener');
      },
    });
    $('#status').textContent = `${samples.length} 篇独立样本 · 当前只读`;
  } catch (error) {
    $('#status').textContent = error.message;
  }
}
for (const id of ['#search', '#cohort', '#result']) $(id).addEventListener('input', list);
try {
  samples = (await api('/api/samples')).samples;
  list();
  $('#status').textContent = `${samples.length} 篇独立样本`;
  if (samples.length) await open(samples[0].key);
} catch (error) {
  $('#status').textContent = error.message;
}
window.addEventListener('pagehide', () => {
  reader?.destroy();
  for (const url of blobs.values()) URL.revokeObjectURL(url);
});
