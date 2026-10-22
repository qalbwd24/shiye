import { getSchema } from '../vendor/rich-editor.js';
import { richExtensions } from '../editor/rich-document-editor.js';
import { toEditorJSON, assertRichFieldsPreserved, safeRichLink } from './rich-document.js';

const schema = getSchema(richExtensions());
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
const attrsFor = {
  heading: ['level'],
  orderedList: ['start', 'type'],
  taskItem: ['checked'],
  codeBlock: ['language'],
  tableCell: ['colspan', 'rowspan', 'colwidth'],
  tableHeader: ['colspan', 'rowspan', 'colwidth'],
  image: ['assetId', 'occurrenceId', 'insertedAt', 'widthRatio', 'align', 'caption', 'alt'],
  video: ['assetId', 'occurrenceId', 'insertedAt', 'widthRatio', 'align', 'caption', 'alt'],
};
function invalid() {
  throw new Error('富文档结构或属性不受支持，原件未改变。');
}
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;

/** Real editor schema plus explicit value checks; never invokes DOM or resource loading. */
export function validateRenderableRichDocument(body) {
  const json = toEditorJSON(body);
  const visit = (node) => {
    if (
      node.attrs !== undefined &&
      (!node.attrs || typeof node.attrs !== 'object' || Array.isArray(node.attrs))
    )
      invalid();
    const attrs = node.attrs || {};
    const allowed = ['blockId', ...(attrsFor[node.type] || [])];
    if (Object.keys(attrs).some((key) => !allowed.includes(key))) invalid();
    if (node.type !== 'text' && (typeof attrs.blockId !== 'string' || attrs.blockId.length > 200))
      invalid();
    if (
      node.type === 'text' &&
      (node.attrs !== undefined || !node.text.length || node.content !== undefined)
    )
      invalid();
    if (node.type !== 'text' && node.text !== undefined) invalid();
    if (node.type === 'heading' && !integer(attrs.level, 1, 6)) invalid();
    if (
      node.type === 'orderedList' &&
      ((attrs.start !== undefined && !integer(attrs.start, -1000000000, 1000000000)) ||
        (attrs.type !== null &&
          attrs.type !== undefined &&
          !['1', 'a', 'A', 'i', 'I'].includes(attrs.type)))
    )
      invalid();
    if (node.type === 'taskItem' && typeof attrs.checked !== 'boolean') invalid();
    if (
      node.type === 'codeBlock' &&
      attrs.language !== null &&
      attrs.language !== undefined &&
      (typeof attrs.language !== 'string' || attrs.language.length > 100)
    )
      invalid();
    if (['tableCell', 'tableHeader'].includes(node.type)) {
      for (const key of ['colspan', 'rowspan'])
        if (attrs[key] !== undefined && !integer(attrs[key], 1, 1000)) invalid();
      if (
        attrs.colwidth !== null &&
        attrs.colwidth !== undefined &&
        (!Array.isArray(attrs.colwidth) ||
          attrs.colwidth.length !== (attrs.colspan || 1) ||
          attrs.colwidth.some((width) => !integer(width, 1, 100000)))
      )
        invalid();
    }
    if (
      ['image', 'video'].includes(node.type) &&
      (typeof attrs.occurrenceId !== 'string' ||
        attrs.occurrenceId.length > 200 ||
        attrs.assetId.length > 200 ||
        attrs.alt.length > 10000 ||
        attrs.caption.length > 10000)
    )
      invalid();
    for (const mark of node.marks || []) {
      if (
        mark.attrs !== undefined &&
        (!mark.attrs || typeof mark.attrs !== 'object' || Array.isArray(mark.attrs))
      )
        invalid();
      const a = mark.attrs || {};
      if (mark.type !== 'link' && Object.keys(a).length) invalid();
      if (mark.type === 'link') {
        if (
          !safeRichLink(a.href) ||
          /[\u0000-\u0020]/.test(a.href) ||
          Object.keys(a).some((key) => !['href', 'target', 'rel', 'title'].includes(key))
        )
          invalid();
        for (const key of ['target', 'rel', 'title'])
          if (
            a[key] !== null &&
            a[key] !== undefined &&
            (typeof a[key] !== 'string' || a[key].length > 10000)
          )
            invalid();
        if (
          a.target !== null &&
          a.target !== undefined &&
          !['_blank', '_self', '_parent', '_top'].includes(a.target)
        )
          invalid();
      }
    }
    (node.content || []).forEach(visit);
  };
  json.content.forEach(visit);
  const parsed = schema.nodeFromJSON(json);
  parsed.check();
  assertRichFieldsPreserved(json, parsed.toJSON());
  return body;
}

/** Safe compatibility projection. Body remains authoritative; HTML is regenerated on saves. */
export function renderRichDocument(body) {
  validateRenderableRichDocument(body);
  const render = (node) => {
    const a = node.attrs || {};
    if (node.type === 'text') {
      let html = escape(node.text);
      for (const mark of node.marks || []) {
        const tag = {
          bold: 'strong',
          italic: 'em',
          underline: 'u',
          strike: 's',
          code: 'code',
          highlight: 'mark',
        }[mark.type];
        if (tag) html = `<${tag}>${html}</${tag}>`;
        else if (mark.type === 'link')
          html = `<a href="${escape(mark.attrs.href)}" target="${escape(mark.attrs.target || '_blank')}" rel="noopener noreferrer nofollow"${mark.attrs.title !== null && mark.attrs.title !== undefined ? ` title="${escape(mark.attrs.title)}"` : ''}>${html}</a>`;
      }
      return html;
    }
    if (node.type === 'hardBreak') return '<br>';
    if (node.type === 'horizontalRule') return '<hr>';
    if (node.type === 'image')
      return `<figure data-rich-image="${escape(a.occurrenceId)}" data-align="${a.align}" style="width:${a.widthRatio * 100}%"><img src="/media/${encodeURIComponent(a.assetId)}" alt="${escape(a.alt)}">${a.caption ? `<figcaption>${escape(a.caption)}</figcaption>` : ''}</figure>`;
    if (node.type === 'video')
      return `<figure data-rich-video="${escape(a.occurrenceId)}" data-align="${a.align}" style="width:${a.widthRatio * 100}%"><video src="/media/${encodeURIComponent(a.assetId)}" controls preload="metadata" playsinline aria-label="${escape(a.alt || '视频')}">${escape(a.alt || '当前浏览器无法播放此视频。')}</video>${a.caption ? `<figcaption>${escape(a.caption)}</figcaption>` : ''}</figure>`;
    const content = (node.content || []).map(render).join('');
    if (node.type === 'heading')
      return `<h${a.level} style="white-space:pre-wrap">${content}</h${a.level}>`;
    if (node.type === 'paragraph') return `<p style="white-space:pre-wrap">${content}</p>`;
    if (node.type === 'codeBlock')
      return `<pre><code${a.language ? ` class="language-${escape(a.language)}"` : ''}>${content}</code></pre>`;
    if (node.type === 'orderedList')
      return `<ol start="${a.start ?? 1}"${a.type ? ` type="${escape(a.type)}"` : ''}>${content}</ol>`;
    if (node.type === 'taskList') return `<ul data-type="taskList">${content}</ul>`;
    if (node.type === 'taskItem')
      return `<li data-type="taskItem" data-checked="${a.checked}">${a.checked ? '☑ ' : '☐ '}${content}</li>`;
    if (node.type === 'tableCell' || node.type === 'tableHeader') {
      const tag = node.type === 'tableCell' ? 'td' : 'th';
      return `<${tag} colspan="${a.colspan ?? 1}" rowspan="${a.rowspan ?? 1}">${content}</${tag}>`;
    }
    const tag = {
      blockquote: 'blockquote',
      bulletList: 'ul',
      listItem: 'li',
      table: 'table',
      tableRow: 'tr',
    }[node.type];
    if (!tag) invalid();
    return `<${tag}>${content}</${tag}>`;
  };
  return body.content.map(render).join('');
}
