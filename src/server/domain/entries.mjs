import { fail } from '../http.mjs';
import { getEditorDocument } from '../../../public/shared/editor-document.js';
export function validateEntry(v, db, previous = null) {
  if (
    !v ||
    typeof v.title !== 'string' ||
    typeof v.content !== 'string' ||
    v.title.length > 500 ||
    v.content.length > 2000000 ||
    !Number.isFinite(Date.parse(v.date))
  )
    throw fail(400, '日记格式不正确');
  if (
    !Array.isArray(v.tags) ||
    !v.tags.every((t) => typeof t === 'string' && t.length < 100) ||
    v.tags.length > 50
  )
    throw fail(400, '标签格式不正确');
  if (
    !Array.isArray(v.attachments) ||
    !v.attachments.every((a) => typeof a === 'string' && db.media.some((m) => m.id === a))
  )
    throw fail(400, '附件不存在');
  if (
    (v.contentFormat !== undefined && !['html', 'markdown'].includes(v.contentFormat)) ||
    (typeof v.markdownSource === 'string' && v.markdownSource.length > 2000000) ||
    (v.editorOriginalHtml !== undefined &&
      v.editorOriginalHtml !== null &&
      (typeof v.editorOriginalHtml !== 'string' || v.editorOriginalHtml.length > 2000000))
  )
    throw fail(400, '编辑器文档格式不正确');
  // Older clients may save a title or taxonomy without sending editor metadata.
  // Reuse a snapshot only if the exact HTML is unchanged; never revive stale Markdown.
  const document = getEditorDocument(
    v.markdownSource === undefined &&
      v.markdownHtml === undefined &&
      previous?.content === v.content
      ? { ...previous, ...v }
      : v,
  );
  const markdownSource = document.format === 'markdown' ? document.source : null;
  const editorOriginalHtml =
    typeof previous?.editorOriginalHtml === 'string'
      ? previous.editorOriginalHtml
      : previous && getEditorDocument(previous).format === 'html' && document.format === 'markdown'
        ? previous.content
        : typeof v.editorOriginalHtml === 'string'
          ? v.editorOriginalHtml
          : null;
  return {
    title: v.title,
    content: v.content,
    contentFormat: document.format,
    markdownSource,
    markdownHtml: markdownSource !== null ? v.content : null,
    ...(editorOriginalHtml !== null ? { editorOriginalHtml } : {}),
    date: v.date,
    category: String(v.category || '日常').slice(0, 100),
    tags: [...new Set(v.tags)],
    attachments: v.attachments,
    mood: String(v.mood || '').slice(0, 30),
    weather: String(v.weather || '').slice(0, 30),
    location: String(v.location || '').slice(0, 100),
    hidden:
      v.hidden === undefined ? !!(previous?.hidden ?? previous?.legacy?.isHidden) : !!v.hidden,
    draft: !!v.draft,
    pinned: !!v.pinned,
    deleted: !!v.deleted,
    cover: ['morning', 'evening'].includes(v.cover) ? v.cover : null,
    demo: !!v.demo,
  };
}
