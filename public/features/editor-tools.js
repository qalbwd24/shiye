import { isHidden } from '../shared/insights.js';

import { marked } from '../vendor/marked.js';
/** Feature-local state; c.library is a live getter, never a cached snapshot. */
export function createEditorTools(c) {
  const { $, api, escape: esc, modal, closeModal, toast, textOf, sanitize } = c;

  async function toggle(field) {
    const e = c.current();
    if (!e) return;
    await c.flush();
    const updated = await api('/api/entries/' + e.id, {
      method: 'PUT',
      data: { ...e, [field]: field === 'hidden' ? !isHidden(e) : !e[field] },
    });
    Object.assign(e, updated);
    c.renderView();
    toast(field === 'hidden' ? '已更新隐藏状态' : '已更新草稿状态');
  }
  function markdown() {
    const e = c.current();
    if (!e) return;
    modal(
      'Markdown 编辑',
      `<p>保留 Markdown 源码并转为富文本。若直接修改富文本，下次打开将以最新正文为起点；旧内容保留在历史中。</p><textarea class="field" rows="12" id="markdownSource" aria-label="Markdown 源码">${esc(e.markdownHtml === e.content && typeof e.markdownSource === 'string' ? e.markdownSource : textOf(e.content))}</textarea><button class="secondary" id="previewMarkdown">预览</button><button class="primary" id="applyMarkdown">应用到正文</button><div id="markdownPreview"></div>`,
    );
    $('#previewMarkdown').onclick = () =>
      ($('#markdownPreview').innerHTML = sanitize(marked.parse($('#markdownSource').value)));
    $('#applyMarkdown').onclick = () => {
      e.markdownSource = $('#markdownSource').value;
      e.content = sanitize(marked.parse(e.markdownSource));
      e.markdownHtml = e.content;
      closeModal();
      c.renderEditor();
      c.markDirty(e);
    };
  }

  return { toggle, markdown };
}
