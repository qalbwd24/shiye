import { fail } from '../http.mjs';
import { getEditorDocument } from '../../../public/shared/editor-document.js';
import {
  renderRichDocument,
  validateRenderableRichDocument,
} from '../../../public/shared/rich-document-renderer.js';
import { richMediaReferences } from '../../../public/shared/rich-document.js';

const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
export function validateEntry(v, db, previous = null) {
  if (
    !v ||
    typeof v.title !== 'string' ||
    (typeof v.content !== 'string' && v.contentFormat !== 'richdoc') ||
    v.title.length > 500 ||
    (typeof v.content === 'string' && v.content.length > 2000000) ||
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
    (v.contentFormat !== undefined && !['html', 'markdown', 'richdoc'].includes(v.contentFormat)) ||
    (typeof v.markdownSource === 'string' && v.markdownSource.length > 2000000) ||
    (v.editorOriginalHtml !== undefined &&
      v.editorOriginalHtml !== null &&
      (typeof v.editorOriginalHtml !== 'string' || v.editorOriginalHtml.length > 2000000))
  )
    throw fail(400, '编辑器文档格式不正确');
  // Older clients may save a title or taxonomy without sending editor metadata.
  // Reuse a snapshot only if the exact HTML is unchanged; never revive stale Markdown.
  let document = getEditorDocument(
    v.markdownSource === undefined &&
      v.markdownHtml === undefined &&
      previous?.content === v.content
      ? { ...previous, ...v }
      : v,
  );
  let content = v.content;
  if (v.contentFormat === 'richdoc' || previous?.contentFormat === 'richdoc') {
    const metadataOnly =
      previous?.contentFormat === 'richdoc' &&
      v.body === undefined &&
      v.content === previous.content &&
      (v.markdownSource === undefined || v.markdownSource === null) &&
      (v.markdownHtml === undefined ||
        v.markdownHtml === null ||
        v.markdownHtml === previous.content);
    if (v.contentFormat !== 'richdoc' && !metadataOnly)
      throw fail(409, '此篇使用富文档，旧编辑器不能覆盖正文；原件未改变');
    const candidate = metadataOnly ? previous.body : v.body;
    try {
      if (JSON.stringify(candidate)?.length > 2000000) throw new Error('size');
      validateRenderableRichDocument(candidate);
      for (const ref of richMediaReferences(candidate)) {
        const resource = db.media.find((m) => m.id === ref.assetId);
        if (
          !resource ||
          !String(resource.type || resource.mimeType || resource.mime || '').startsWith(
            ref.type + '/',
          ) ||
          !v.attachments.includes(ref.assetId)
        )
          throw new Error('media');
      }
      content = renderRichDocument(candidate);
      if (content.length > 2000000) throw new Error('size');
      document = { format: 'richdoc', body: structuredClone(candidate) };
    } catch {
      throw fail(400, '富文档结构、图片或视频关联或内容大小不正确；原件未改变');
    }
  } else if (v.body !== undefined) throw fail(400, '富文档正文须显式指定格式');
  if (
    previous?.chatJournal &&
    (content !== previous.content ||
      !same(document, getEditorDocument(previous)) ||
      !same(v.attachments, previous.attachments || []))
  )
    throw fail(409, '聊天归篇正文只读，请在原聊天中修改消息；分类和标签仍可调整');
  const markdownSource = document.format === 'markdown' ? document.source : null;
  const editorOriginalHtml =
    typeof previous?.editorOriginalHtml === 'string'
      ? previous.editorOriginalHtml
      : previous &&
          getEditorDocument(previous).format === 'html' &&
          ['markdown', 'richdoc'].includes(document.format)
        ? previous.content
        : typeof v.editorOriginalHtml === 'string'
          ? v.editorOriginalHtml
          : null;
  return {
    title: v.title,
    content,
    contentFormat: document.format,
    ...(document.format === 'richdoc' ? { body: document.body } : {}),
    markdownSource,
    markdownHtml: markdownSource !== null ? content : null,
    ...(!previous ||
    !same(getEditorDocument(previous), document) ||
    !same(previous.attachments || [], v.attachments)
      ? { contentEditedAt: new Date().toISOString() }
      : previous.contentEditedAt !== undefined
        ? { contentEditedAt: previous.contentEditedAt }
        : Number.isFinite(Date.parse(previous.updatedAt))
          ? { contentEditedAt: previous.updatedAt }
          : {}),
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
