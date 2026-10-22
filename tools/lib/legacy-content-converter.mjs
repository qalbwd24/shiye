import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { getEditorDocument } from '../../public/shared/editor-document.js';
import { validateRichDocument, safeRichLink } from '../../public/shared/rich-document.js';

export const LEGACY_CONVERSION_VERSION = 'legacy-richdoc-v1';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const blockTags = new Set([
  'P',
  'DIV',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'BLOCKQUOTE',
  'UL',
  'OL',
  'LI',
  'PRE',
  'HR',
  'TABLE',
  'THEAD',
  'TBODY',
  'TFOOT',
  'TR',
  'TD',
  'TH',
  'SECTION',
  'ARTICLE',
  'FIGURE',
]);
const markTags = {
  B: 'bold',
  STRONG: 'bold',
  I: 'italic',
  EM: 'italic',
  U: 'underline',
  S: 'strike',
  STRIKE: 'strike',
  DEL: 'strike',
  CODE: 'code',
  MARK: 'highlight',
};
const inertTags = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META']);
// Tiptap/ProseMirror mark ranks from the current richExtensions schema.
const markOrder = ['link', 'bold', 'code', 'italic', 'strike', 'underline', 'highlight'];
const clone = (value) => (value === undefined ? null : JSON.parse(JSON.stringify(value)));

/** Deterministic, detached conversion only. No source data, global DOM, or files are mutated. */
export function convertLegacyEntry(entry, { media = [], timeZone = 'Asia/Shanghai' } = {}) {
  if (!entry || typeof entry !== 'object') throw new TypeError('Legacy entry is required');
  const source = getEditorDocument(entry);
  const html = typeof entry.content === 'string' ? entry.content : '';
  const sourceId = String(entry.id ?? '');
  const issues = [];
  const attachmentPlacements = [];
  const unresolvedImages = [];
  const assets = new Map(media.map((item) => [String(item.id), item]));
  const id = (kind, path) => `${kind}:${hash(JSON.stringify([sourceId, kind, path])).slice(0, 32)}`;
  const issue = (code, path, details = {}) =>
    issues.push({ code, path, severity: 'warning', ...details });
  const node = (type, path, content, attrs = {}) => ({
    type,
    attrs: { blockId: id('block', path), ...attrs },
    ...(content?.length ? { content } : {}),
  });
  const kindOf = (asset) => {
    const mime = String(asset?.type || asset?.mimeType || asset?.mime || '').toLowerCase();
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
    if (asset?.kind && ['image', 'video', 'audio', 'file'].includes(asset.kind)) return asset.kind;
    return asset ? 'file' : 'missing';
  };
  const image = (assetId, path, alt) =>
    node('image', path, null, {
      assetId,
      occurrenceId: id('occurrence', path),
      insertedAt: null,
      widthRatio: 0.75,
      align: 'center',
      caption: '',
      alt: String(alt || ''),
    });
  const validAssetId = (value) => /^[\w:-]+$/.test(value);
  const attachments = Array.isArray(entry.attachments) ? entry.attachments : [];
  const leading = [];
  attachments.forEach((attachment, order) => {
    const assetId =
      typeof attachment === 'string'
        ? attachment
        : String(attachment?.assetId || attachment?.id || '');
    const asset = assets.get(assetId);
    const kind = kindOf(asset);
    const path = `attachments/${order}`;
    let blockId = null;
    if (!asset) issue('missing-attachment-media', path, { assetId });
    if (!validAssetId(assetId)) issue('invalid-asset-id', path, { assetId });
    if (kind === 'image' && validAssetId(assetId)) {
      const item = image(assetId, path, asset.name || asset.fileName || '');
      leading.push(item);
      blockId = item.attrs.blockId;
    } else issue('non-image-attachment-body-unsupported', path, { assetId, kind });
    attachmentPlacements.push({
      order,
      sourceIndex: order,
      assetId,
      kind,
      blockId,
      occurrenceId: blockId ? id('occurrence', path) : null,
      placementSource: 'legacy-default-start',
      // All metadata is retained for the compatibility attachment region; never reinterpret a file as an image.
      description: asset ? clone(asset) : null,
      sourceAttachment: clone(attachment),
    });
  });
  if (!sourceId) issue('missing-source-entry-id', 'entry/id');
  if (entry.contentFormat && !['html', 'markdown'].includes(entry.contentFormat))
    issue('unknown-source-content-format', 'entry/contentFormat');
  if (entry.attachments !== undefined && !Array.isArray(entry.attachments))
    issue('invalid-attachment-list', 'entry/attachments');
  if (source.format === 'markdown' && source.source && !html)
    issue('markdown-rendered-html-empty', 'entry/content');

  // JSDOM defaults neither execute scripts nor load subresources. Never enable either option.
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const root = dom.window.document.createElement('div');
  root.innerHTML = html;
  const paths = new WeakMap();
  const register = (parent, path) =>
    Array.from(parent.childNodes).forEach((child, index) => {
      const next = `${path}/${index}`;
      paths.set(child, next);
      register(child, next);
    });
  register(root, 'html');
  const pathOf = (element) => paths.get(element);
  const inspected = new WeakSet();
  function inspect(element) {
    if (inspected.has(element)) return;
    inspected.add(element);
    const knownAttrs = {
      A: ['href', 'title', 'target', 'rel'],
      IMG: ['src', 'alt', 'title'],
      OL: ['start', 'data-type'],
      UL: ['data-type'],
      LI: ['data-type', 'data-checked'],
      TD: ['colspan', 'rowspan', 'colwidth'],
      TH: ['colspan', 'rowspan', 'colwidth'],
      CODE: ['class'],
    };
    for (const attr of Array.from(element.attributes)) {
      if (attr.name === 'style') {
        for (let i = 0; i < element.style.length; i++) {
          const property = element.style.item(i);
          const value = element.style.getPropertyValue(property).trim();
          const supported =
            (property === 'font-weight' && /^(bold|[6-9]00)$/.test(value)) ||
            (property === 'font-style' && value === 'italic') ||
            (property === 'text-decoration' &&
              /^(underline|line-through)( (underline|line-through))*$/.test(value));
          if (!supported) issue('unsupported-style', pathOf(element), { property, value });
        }
      } else if (!(knownAttrs[element.tagName] || []).includes(attr.name)) {
        issue('unsupported-attribute', pathOf(element), {
          tag: element.tagName.toLowerCase(),
          attribute: attr.name,
        });
      }
    }
  }
  function marksFor(element, inherited) {
    const result = [...inherited];
    const add = (type, attrs) => {
      const old = result.findIndex((mark) => mark.type === type);
      if (old !== -1) result.splice(old, 1);
      result.push({ type, ...(attrs ? { attrs } : {}) });
    };
    if (markTags[element.tagName]) add(markTags[element.tagName]);
    if (/^(bold|[6-9]00)$/.test(element.style.fontWeight)) add('bold');
    if (element.style.fontStyle === 'italic') add('italic');
    if (element.style.textDecoration.includes('underline')) add('underline');
    if (element.style.textDecoration.includes('line-through')) add('strike');
    if (element.tagName === 'A') {
      const href = element.getAttribute('href') || '';
      if (safeRichLink(href))
        add('link', {
          href,
          target: element.getAttribute('target') || '_blank',
          rel: element.getAttribute('rel') || 'noopener noreferrer nofollow',
          title: element.getAttribute('title'),
        });
      else issue('unsupported-link', pathOf(element));
    }
    if (result.some((mark) => mark.type === 'code') && result.length > 1) {
      issue('incompatible-code-marks', pathOf(element));
      return [{ type: 'code' }];
    }
    return result.sort((a, b) => markOrder.indexOf(a.type) - markOrder.indexOf(b.type));
  }
  function inline(element, marks = []) {
    const path = pathOf(element);
    if (element.nodeType === 3) {
      return element.nodeValue
        .split('\n')
        .flatMap((text, index) => [
          ...(index ? [node('hardBreak', `${path}/newline/${index}`)] : []),
          ...(text ? [{ type: 'text', text, ...(marks.length ? { marks } : {}) }] : []),
        ]);
    }
    if (element.nodeType !== 1) return [];
    inspect(element);
    if (inertTags.has(element.tagName)) {
      issue('inert-content-omitted', path, { tag: element.tagName.toLowerCase() });
      return [];
    }
    if (element.tagName === 'BR') return [node('hardBreak', path)];
    if (element.tagName === 'IMG') {
      const src = element.getAttribute('src') || '';
      const match = /^\/media\/([^/?#]+)(?:[?#].*)?$/.exec(src);
      let assetId = null;
      try {
        if (match) assetId = decodeURIComponent(match[1]);
      } catch {
        /* Report as unresolved. */
      }
      const asset = assets.get(assetId);
      if (asset && kindOf(asset) === 'image' && validAssetId(assetId)) {
        if (attachmentPlacements.some((placement) => placement.assetId === assetId))
          issue('attachment-inline-reference-overlap', path, { assetId });
        return [
          image(assetId, path, element.getAttribute('alt') || asset.name || asset.fileName || ''),
        ];
      }
      issue(assetId ? 'unresolved-inline-media' : 'unsupported-image-source', path, { assetId });
      unresolvedImages.push({ path, assetId, src, alt: element.getAttribute('alt') || '' });
      const alt = element.getAttribute('alt');
      return alt ? [{ type: 'text', text: alt, ...(marks.length ? { marks } : {}) }] : [];
    }
    if (
      !markTags[element.tagName] &&
      !['SPAN', 'A', 'SMALL', 'LABEL'].includes(element.tagName) &&
      !blockTags.has(element.tagName)
    )
      issue('unsupported-element', path, { tag: element.tagName.toLowerCase() });
    const next = marksFor(element, marks);
    return Array.from(element.childNodes).flatMap((child) => inline(child, next));
  }
  function flow(
    elements,
    path,
    { paragraphType = 'paragraph', attrs = {}, forceParagraph = false, marks = [] } = {},
  ) {
    const result = [];
    const hasBlockChildren = elements.some(
      (element) => element.nodeType === 1 && blockTags.has(element.tagName),
    );
    let pending = [];
    let run = 0;
    const flush = () => {
      if (pending.length) {
        result.push(node(paragraphType, `${path}/run/${run++}`, pending, attrs));
        pending = [];
      }
    };
    for (const element of elements) {
      if (element.nodeType === 1 && blockTags.has(element.tagName)) {
        flush();
        result.push(...block(element));
      } else {
        // Whitespace between HTML block tags is layout indentation, not a visible blank paragraph.
        if (
          (!forceParagraph || hasBlockChildren) &&
          !pending.length &&
          element.nodeType === 3 &&
          /^[\t\n\r ]*$/.test(element.nodeValue)
        )
          continue;
        for (const child of inline(element, marks)) {
          if (child.type === 'image') {
            flush();
            result.push(child);
          } else pending.push(child);
        }
      }
    }
    flush();
    if (!result.length && forceParagraph)
      result.push(node(paragraphType, `${path}/empty`, [], attrs));
    return result;
  }
  function block(element) {
    inspect(element);
    const path = pathOf(element);
    const children = Array.from(element.childNodes);
    const tag = element.tagName;
    if (tag === 'HR') return [node('horizontalRule', path)];
    if (tag === 'PRE') {
      const code = element.querySelector('code');
      if (code) inspect(code);
      const language = code?.className.match(/(?:^|\s)language-([^\s]+)/)?.[1] || null;
      if (Array.from(element.querySelectorAll('*')).some((child) => child !== code))
        issue('code-html-flattened', path);
      return [
        node(
          'codeBlock',
          path,
          element.textContent ? [{ type: 'text', text: element.textContent }] : [],
          { language },
        ),
      ];
    }
    if (tag === 'P' || /^H[1-6]$/.test(tag))
      return flow(children, path, {
        forceParagraph: true,
        paragraphType: tag === 'P' ? 'paragraph' : 'heading',
        attrs: tag === 'P' ? {} : { level: Number(tag[1]) },
        marks: marksFor(element, []),
      });
    if (tag === 'UL' || tag === 'OL') {
      const task = element.getAttribute('data-type') === 'taskList';
      const type = task ? 'taskList' : tag === 'UL' ? 'bulletList' : 'orderedList';
      const content = [];
      children.forEach((child) => {
        if (child.nodeType === 3 && !child.nodeValue.trim()) return;
        if (child.nodeType === 1 && child.tagName === 'LI') {
          inspect(child);
          let nested = flow(Array.from(child.childNodes), pathOf(child), { forceParagraph: true });
          if (nested[0]?.type !== 'paragraph')
            nested = [node('paragraph', `${pathOf(child)}/first`, []), ...nested];
          content.push(
            node(
              task ? 'taskItem' : 'listItem',
              pathOf(child),
              nested,
              task ? { checked: child.getAttribute('data-checked') === 'true' } : {},
            ),
          );
        } else {
          issue('invalid-list-child', pathOf(child));
          const nested = flow([child], `${pathOf(child)}/content`, { forceParagraph: true });
          if (nested[0]?.type !== 'paragraph')
            nested.unshift(node('paragraph', `${pathOf(child)}/first`, []));
          content.push(
            node(
              task ? 'taskItem' : 'listItem',
              `${pathOf(child)}/list-item`,
              nested,
              task ? { checked: false } : {},
            ),
          );
        }
      });
      if (!content.length) {
        issue('empty-list-normalized', path);
        content.push(
          node(
            task ? 'taskItem' : 'listItem',
            `${path}/empty-item`,
            [node('paragraph', `${path}/empty-paragraph`, [])],
            task ? { checked: false } : {},
          ),
        );
      }
      const start = Number(element.getAttribute('start') || 1);
      return [
        node(
          type,
          path,
          content,
          type === 'orderedList' ? { start: Number.isInteger(start) ? start : 1, type: null } : {},
        ),
      ];
    }
    if (tag === 'TABLE') {
      const extra = [];
      for (const child of Array.from(element.children)) {
        if (['THEAD', 'TBODY', 'TFOOT', 'TR'].includes(child.tagName)) inspect(child);
        else {
          issue('unsupported-table-content', pathOf(child), { tag: child.tagName.toLowerCase() });
          extra.push(
            ...flow(Array.from(child.childNodes), pathOf(child), { forceParagraph: true }),
          );
        }
      }
      const rows = Array.from(element.rows);
      const content = rows.map((row) => {
        inspect(row);
        const cells = Array.from(row.cells).map((cell) => {
          inspect(cell);
          const colwidthRaw = cell.getAttribute('colwidth');
          const colwidth = colwidthRaw ? colwidthRaw.split(',').map(Number) : null;
          if (colwidth?.some((value) => !Number.isFinite(value) || value <= 0))
            issue('invalid-table-width', pathOf(cell));
          return node(
            cell.tagName === 'TH' ? 'tableHeader' : 'tableCell',
            pathOf(cell),
            flow(Array.from(cell.childNodes), pathOf(cell), { forceParagraph: true }),
            {
              colspan: cell.colSpan,
              rowspan: cell.rowSpan,
              colwidth: colwidth?.every((value) => Number.isFinite(value) && value > 0)
                ? colwidth
                : null,
            },
          );
        });
        if (!cells.length) issue('empty-table-row', pathOf(row));
        return node('tableRow', pathOf(row), cells);
      });
      if (!content.length || content.some((row) => !row.content?.length)) {
        issue('invalid-table-structure', path);
        return flow(children, `${path}/fallback`, { forceParagraph: true });
      }
      return [...extra, node('table', path, content)];
    }
    const content = flow(children, path, { forceParagraph: true, marks: marksFor(element, []) });
    if (tag === 'BLOCKQUOTE') return [node('blockquote', path, content)];
    if (!['DIV', 'SECTION', 'ARTICLE'].includes(tag))
      issue('unsupported-block-wrapper', path, { tag: tag.toLowerCase() });
    return content;
  }
  let content;
  try {
    content = [...leading, ...flow(Array.from(root.childNodes), 'html')];
  } finally {
    dom.window.close();
  }
  if (!content.length) content.push(node('paragraph', 'html/empty-document', []));
  const normalize = (parent) => {
    if (!parent.content) return;
    const merged = [];
    for (const child of parent.content) {
      normalize(child);
      const previous = merged.at(-1);
      if (
        previous?.type === 'text' &&
        child.type === 'text' &&
        JSON.stringify(previous.marks || []) === JSON.stringify(child.marks || [])
      )
        previous.text += child.text;
      else merged.push(child);
    }
    parent.content = merged;
  };
  content.forEach(normalize);
  const body = validateRichDocument({ format: 'shiye-richdoc', version: 1, content });
  return {
    body,
    attachmentPlacements,
    issues,
    provenance: {
      converterVersion: LEGACY_CONVERSION_VERSION,
      sourceEntryId: sourceId,
      sourceRevision: entry.revision ?? null,
      sourceFormat: source.format,
      renderingSource: 'saved-html',
      timeZone,
      sourceHash: hash(JSON.stringify(entry)),
      htmlHash: hash(html),
      attachmentPlacementSource: 'legacy-default-start',
      unresolvedImages,
    },
  };
}
