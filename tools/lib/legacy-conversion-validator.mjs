// Independent audit: source HTML is inspected with an inert DOM, never the converter.
import { JSDOM } from 'jsdom';
import { getSchema } from '../../public/vendor/rich-editor.js';
import { richExtensions } from '../../public/editor/rich-document-editor.js';
import { toEditorJSON, assertRichFieldsPreserved } from '../../public/shared/rich-document.js';

const schema = getSchema(richExtensions());
const blockTags = new Set([
  'p',
  'div',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'ul',
  'ol',
  'li',
  'pre',
  'table',
  'tr',
  'td',
  'th',
  'hr',
  'img',
]);
const tags = {
  p: 'paragraph',
  div: 'paragraph',
  blockquote: 'blockquote',
  ul: 'bulletList',
  ol: 'orderedList',
  li: 'listItem',
  pre: 'codeBlock',
  table: 'table',
  tr: 'tableRow',
  td: 'tableCell',
  th: 'tableHeader',
  hr: 'horizontalRule',
  br: 'hardBreak',
};
const markTags = {
  b: 'bold',
  strong: 'bold',
  i: 'italic',
  em: 'italic',
  u: 'underline',
  s: 'strike',
  del: 'strike',
  strike: 'strike',
  mark: 'highlight',
  code: 'code',
};
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const flatten = (nodes) => nodes.flatMap((node) => [node, ...flatten(node.content || [])]);
const assetOf = (value) =>
  typeof value === 'string' ? value : value?.assetId || value?.mediaId || value?.id;
const linkKey = (href, title) => `link:${JSON.stringify([href || '', title || null])}`;

function signature() {
  return { text: '', lines: [], marks: [], images: [], imageAlts: [] };
}
function appendText(out, text, marks) {
  out.text += text;
  // Character-level runs avoid treating inline element boundaries as spaces.
  const key = [...marks].sort().join('|');
  for (const char of text) out.marks.push([char, key]);
}
function sourceSignature(html, media, issue) {
  const dom = new JSDOM('<!doctype html><body></body>');
  const template = dom.window.document.createElement('template');
  template.innerHTML = html;
  const out = signature();
  const visit = (node, inherited = [], inCode = false) => {
    if (node.nodeType === 3) {
      if (inCode) appendText(out, node.data, inherited);
      else
        node.data.split('\n').forEach((part, index) => {
          if (index) {
            out.lines.push(['open', 'hardBreak'], ['close', 'hardBreak']);
            appendText(out, '\n', []);
          }
          appendText(out, part, inherited);
        });
      return;
    }
    if (node.nodeType !== 1 && node.nodeType !== 11) return;
    const tag = node.localName;
    if (
      tag &&
      [
        'script',
        'style',
        'iframe',
        'object',
        'embed',
        'svg',
        'math',
        'form',
        'input',
        'video',
        'audio',
      ].includes(tag)
    ) {
      issue('source-unsafe-or-unsupported', 'review');
      return;
    }
    for (const attr of node.attributes || []) {
      if (/^on/i.test(attr.name) || ['srcdoc', 'hidden'].includes(attr.name))
        issue('source-unsafe-attribute', 'review');
      else if (attr.name === 'style' && attr.value.trim()) {
        if (!node.style.length) issue('source-style-review', 'review');
        for (const property of node.style) {
          const value = node.style.getPropertyValue(property).trim();
          if (!(
            (property === 'font-weight' && /^(bold|[6-9]00)$/.test(value)) ||
            (property === 'font-style' && value === 'italic') ||
            (property === 'text-decoration' &&
              /^(underline|line-through)( (underline|line-through))*$/.test(value))
          ))
            issue('source-style-review', 'review');
        }
      } else if (
        !['href', 'src', 'alt', 'title', 'start', 'colspan', 'rowspan', 'class', 'style'].includes(
          attr.name,
        )
      )
        issue('source-attribute-review', 'review');
      if (attr.name === 'class' && attr.value.trim()) issue('source-class-review', 'review');
    }
    if (tag === 'img') {
      const src = node.getAttribute('src') || '';
      const match = /^(?:shiye-asset:|\/(?:api\/)?media\/)([\w:-]+)$/.exec(src);
      const item = media.find((m) => [m.url, m.src].includes(src));
      const id = match?.[1] || item?.id;
      if (!id) issue('source-image-unresolved', 'review');
      out.images.push(id || null);
      out.imageAlts.push(node.getAttribute('alt') || '');
      out.lines.push(['image', id || null]);
      return;
    }
    const mark =
      tag === 'a' ? linkKey(node.getAttribute('href'), node.getAttribute('title')) : markTags[tag];
    if (tag === 'a' && !/^(https?:\/\/|mailto:)/i.test(node.getAttribute('href') || ''))
      issue('source-unsafe-link', 'review');
    const styles = [];
    if (/^(bold|[6-9]00)$/.test(node.style?.fontWeight || '')) styles.push('bold');
    if (node.style?.fontStyle === 'italic') styles.push('italic');
    if ((node.style?.textDecoration || '').includes('underline')) styles.push('underline');
    if ((node.style?.textDecoration || '').includes('line-through')) styles.push('strike');
    const marks = [
      ...new Set([...inherited, ...(mark && !(inCode && tag === 'code') ? [mark] : []), ...styles]),
    ];
    let type = /^h[1-6]$/.test(tag || '') ? `heading:${tag.slice(1)}` : tags[tag];
    // HTML container divs are transparent when they contain their own blocks.
    if (tag === 'div' && [...node.children].some((c) => blockTags.has(c.localName))) type = null;
    if (tag && !type && !mark && !['span', 'div', 'tbody', 'thead', 'tfoot'].includes(tag))
      issue('source-element-review', 'review');
    if (type === 'orderedList') type += `:${Number(node.getAttribute('start') || 1)}`;
    if (type === 'tableCell' || type === 'tableHeader')
      type += `:${Number(node.getAttribute('colspan') || 1)}:${Number(node.getAttribute('rowspan') || 1)}`;
    if (type) out.lines.push(['open', type]);
    if (type === 'hardBreak') appendText(out, '\n', []);
    const blockContainer =
      ['li', 'td', 'th', 'blockquote'].includes(tag) || (tag === 'div' && !type);
    const containsBlocks =
      blockContainer && [...node.children].some((child) => blockTags.has(child.localName));
    let inlineRun = false;
    let emittedChild = false;
    const closeRun = () => {
      if (inlineRun) out.lines.push(['close', 'paragraph']);
      inlineRun = false;
    };
    for (const child of node.childNodes) {
      if (containsBlocks && !inlineRun && child.nodeType === 3 && /^[\t\r\n ]*$/.test(child.data))
        continue;
      // HTML indentation between block children has no visible paragraph/text semantics.
      if (
        ['ul', 'ol', 'table', 'tbody', 'thead', 'tfoot', 'tr'].includes(tag) &&
        child.nodeType === 3 &&
        /^[\t\r\n ]*$/.test(child.data)
      )
        continue;
      if (blockContainer && child.nodeType === 1 && blockTags.has(child.localName)) {
        closeRun();
        // The editor requires an initial paragraph for a list item, including nested-only items.
        if (tag === 'li' && !emittedChild && child.localName !== 'p')
          out.lines.push(['open', 'paragraph'], ['close', 'paragraph']);
        emittedChild = true;
      } else if (blockContainer && child.nodeType !== 8) {
        if (!inlineRun) out.lines.push(['open', 'paragraph']);
        inlineRun = true;
        emittedChild = true;
      }
      visit(child, marks, inCode || tag === 'pre');
    }
    closeRun();
    if (blockContainer && !emittedChild)
      out.lines.push(['open', 'paragraph'], ['close', 'paragraph']);
    if (type) out.lines.push(['close', type]);
  };
  // Naked inline source has an implicit editor paragraph.
  let pending = [];
  const flush = () => {
    if (!pending.length) return;
    out.lines.push(['open', 'paragraph']);
    pending.forEach((n) => visit(n));
    out.lines.push(['close', 'paragraph']);
    pending = [];
  };
  for (const node of template.content.childNodes) {
    if (!pending.length && node.nodeType === 3 && /^[\t\r\n ]*$/.test(node.data)) continue;
    if (node.nodeType === 1 && blockTags.has(node.localName)) {
      flush();
      visit(node);
    } else pending.push(node);
  }
  flush();
  if (!out.lines.length && !out.text && !out.images.length)
    out.lines.push(['open', 'paragraph'], ['close', 'paragraph']);
  dom.window.close();
  return out;
}
function targetSignature(nodes) {
  const out = signature();
  const visit = (node) => {
    if (node.type === 'text') {
      appendText(
        out,
        node.text,
        (node.marks || []).map((m) =>
          m.type === 'link' ? linkKey(m.attrs?.href, m.attrs?.title) : m.type,
        ),
      );
      return;
    }
    if (node.type === 'image') {
      out.images.push(node.attrs.assetId);
      out.imageAlts.push(node.attrs.alt || '');
      out.lines.push(['image', node.attrs.assetId]);
      return;
    }
    let type = node.type;
    if (type === 'heading') type += `:${node.attrs.level}`;
    if (type === 'orderedList') type += `:${node.attrs?.start ?? 1}`;
    if (type === 'tableCell' || type === 'tableHeader')
      type += `:${node.attrs?.colspan ?? 1}:${node.attrs?.rowspan ?? 1}`;
    out.lines.push(['open', type]);
    if (type === 'hardBreak') appendText(out, '\n', []);
    (node.content || []).forEach(visit);
    out.lines.push(['close', type]);
  };
  nodes.forEach(visit);
  return out;
}

/** No body, title, filenames, IDs or parser messages are placed in diagnostics. */
export function validateLegacyConversion(entry, converted, { media = [] } = {}) {
  const issues = [];
  const issue = (code, severity = 'error') => {
    if (!issues.some((i) => i.code === code && i.severity === severity))
      issues.push({ code, severity });
  };
  const result = {
    structureValid: false,
    textPreserved: false,
    whitespacePreserved: false,
    lineStructurePreserved: false,
    attachmentsPreserved: false,
    safeForPreview: false,
    issues,
    metrics: {},
  };
  let nodes;
  try {
    const json = toEditorJSON(converted?.body);
    const parsed = schema.nodeFromJSON(json);
    parsed.check();
    assertRichFieldsPreserved(json, parsed.toJSON());
    nodes = json.content;
    result.structureValid = true;
  } catch {
    issue('richdoc-schema-invalid');
    return result;
  }
  const allImages = flatten(nodes).filter((n) => n.type === 'image');
  if (allImages.some((n) => n.attrs.insertedAt !== null)) issue('legacy-image-time-invented');
  const attachments = entry?.attachments || [];
  const placements = converted.attachmentPlacements || [];
  if (!Array.isArray(attachments) || !Array.isArray(placements)) {
    issue('attachment-list-invalid');
    return result;
  }
  let attachmentOK = attachments.length === placements.length;
  if (!attachmentOK) issue('attachment-count-mismatch');
  let imagePrefix = 0;
  for (let index = 0; index < attachments.length; index++) {
    const id = assetOf(attachments[index]);
    const p = placements[index];
    const mappedId = p?.assetId || p?.mediaId || p?.sourceAttachmentId;
    if (
      !p ||
      mappedId !== id ||
      (p.sourceIndex !== undefined && p.sourceIndex !== index) ||
      (p.order !== undefined && p.order !== index)
    ) {
      attachmentOK = false;
      issue('attachment-order-or-reference-mismatch');
    }
    const resource = media.find((m) => m.id === id || m.assetId === id);
    if (
      (p?.sourceAttachment !== undefined && !equal(p.sourceAttachment, attachments[index])) ||
      (p?.description !== undefined && !equal(p.description, resource || null))
    ) {
      attachmentOK = false;
      issue('attachment-descriptor-mismatch');
    }
    if (!resource) {
      attachmentOK = false;
      issue('media-reference-missing');
    }
    const isImage = (resource?.type || resource?.mime || resource?.mimeType || '').startsWith(
      'image/',
    );
    if (isImage) {
      const node = nodes[imagePrefix++];
      if (
        node?.type !== 'image' ||
        node.attrs.assetId !== id ||
        (p?.occurrenceId && node.attrs.occurrenceId !== p.occurrenceId) ||
        (p?.blockId && node.attrs.blockId !== p.blockId)
      ) {
        attachmentOK = false;
        issue('attachment-prefix-mismatch');
      }
    } else {
      issue('non-image-attachment-preview-gap', 'review');
      if (
        !p ||
        !['external-prefix', 'legacy-default-start', 'prefix-descriptor'].includes(
          p.placementSource || p.placement || p.position || p.kind,
        )
      ) {
        attachmentOK = false;
        issue('non-image-prefix-descriptor-missing');
      }
    }
  }
  const bodyNodes = nodes.slice(imagePrefix);
  const source = sourceSignature(
    typeof entry?.content === 'string' ? entry.content : '',
    media,
    issue,
  );
  const target = targetSignature(bodyNodes);
  result.textPreserved = source.text.replace(/\s/gu, '') === target.text.replace(/\s/gu, '');
  result.whitespacePreserved = source.text === target.text;
  result.lineStructurePreserved = equal(source.lines, target.lines);
  if (!result.textPreserved) issue('text-sequence-mismatch');
  if (!result.whitespacePreserved) issue('exact-text-or-whitespace-mismatch');
  if (!result.lineStructurePreserved) issue('line-or-block-structure-mismatch');
  if (!equal(source.marks, target.marks)) issue('inline-format-mismatch');
  if (!equal(source.images, target.images)) {
    attachmentOK = false;
    issue('inline-image-sequence-mismatch');
  }
  if (source.imageAlts.some((alt, index) => alt && alt !== target.imageAlts[index]))
    issue('inline-image-alt-mismatch');
  for (const id of target.images)
    if (!media.some((m) => (m.id || m.assetId) === id)) {
      attachmentOK = false;
      issue('media-reference-missing');
    }
  if (entry?.contentFormat && !['html', 'markdown'].includes(entry.contentFormat))
    issue('source-format-unsupported', 'review');
  // Stored HTML remains the reference for Markdown records; Markdown source parsing is separate.
  for (const item of converted.issues || [])
    issue('converter-reported-issue', item.severity === 'error' ? 'error' : 'review');
  result.attachmentsPreserved =
    attachmentOK && !issues.some((i) => i.code === 'legacy-image-time-invented');
  result.metrics = {
    sourceCharacters: [...source.text].length,
    targetCharacters: [...target.text].length,
    sourceStructureEvents: source.lines.length,
    targetStructureEvents: target.lines.length,
    sourceInlineImages: source.images.length,
    targetInlineImages: target.images.length,
    sourceAttachments: attachments.length,
    targetPlacements: placements.length,
    targetImages: allImages.length,
  };
  result.safeForPreview =
    result.structureValid &&
    result.textPreserved &&
    result.whitespacePreserved &&
    result.lineStructurePreserved &&
    result.attachmentsPreserved &&
    issues.length === 0;
  return result;
}
