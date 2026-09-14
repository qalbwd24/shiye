import { fail } from '../http.mjs';
export function validateEntry(v, db) {
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
  const markdownSource =
    typeof v.markdownSource === 'string' &&
    v.markdownSource.length <= 2000000 &&
    v.markdownHtml === v.content
      ? v.markdownSource
      : null;
  return {
    title: v.title,
    content: v.content,
    markdownSource,
    markdownHtml: markdownSource !== null ? v.content : null,
    date: v.date,
    category: String(v.category || '日常').slice(0, 100),
    tags: [...new Set(v.tags)],
    attachments: v.attachments,
    mood: String(v.mood || '').slice(0, 30),
    weather: String(v.weather || '').slice(0, 30),
    location: String(v.location || '').slice(0, 100),
    hidden: !!v.hidden,
    draft: !!v.draft,
    pinned: !!v.pinned,
    deleted: !!v.deleted,
    cover: ['morning', 'evening'].includes(v.cover) ? v.cover : null,
    demo: !!v.demo,
  };
}
