import { fromEditorJSON, safeRichLink } from '../shared/rich-document.js';
import { validateRenderableRichDocument } from '../shared/rich-document-renderer.js';

const markTags = {
  B: 'bold',
  STRONG: 'bold',
  I: 'italic',
  EM: 'italic',
  U: 'underline',
  S: 'strike',
  STRIKE: 'strike',
  DEL: 'strike',
  MARK: 'highlight',
  CODE: 'code',
};
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
  'IMG',
  'VIDEO',
  'FIGURE',
  'TABLE',
  'THEAD',
  'TBODY',
  'TFOOT',
  'TR',
  'TD',
  'TH',
]);
const unsupported = (detail) => {
  throw new Error(`模板包含暂不支持的${detail}，原模板未改变；请先调整模板后重试。`);
};

/**
 * Convert only a caller-selected NEW document's template, never saved entries.
 * HTML is parsed inside an unattached template element: scripts and resources
 * remain inert. Unsupported markup/attributes fail explicitly rather than
 * being stripped by an HTML-to-Markdown or permissive editor import. The final
 * JSON passes the real Tiptap schema and field-preservation validator.
 */
export function richTemplateDocument(
  source,
  { media = [], ownerDocument = document, insertedAt = new Date().toISOString() } = {},
) {
  if (typeof source !== 'string') unsupported('模板正文类型');
  const inert = ownerDocument.createElement('template');
  inert.innerHTML = source;
  const addMark = (marks, mark) => [...marks.filter((item) => item.type !== mark.type), mark];
  function attributes(el, allowed = []) {
    for (const attr of el.attributes)
      if (!allowed.includes(attr.name)) unsupported(`${el.tagName} 属性 ${attr.name}`);
  }
  function styledMarks(el, marks) {
    let result = marks;
    for (const property of el.style) {
      const value = el.style.getPropertyValue(property).trim();
      if (property === 'white-space' && ['pre-wrap', 'pre', 'break-spaces'].includes(value))
        continue;
      if (
        property === 'font-weight' &&
        ['bold', 'bolder', '600', '700', '800', '900'].includes(value)
      )
        result = addMark(result, { type: 'bold' });
      else if (property === 'font-style' && value === 'italic')
        result = addMark(result, { type: 'italic' });
      else if (
        property === 'text-decoration' &&
        /^(?:underline|line-through)(?: (?:underline|line-through))*$/.test(value)
      ) {
        if (value.includes('underline')) result = addMark(result, { type: 'underline' });
        if (value.includes('line-through')) result = addMark(result, { type: 'strike' });
      } else unsupported(`样式 ${property}`);
    }
    return result;
  }
  function image(el, figure = null) {
    const type = el.tagName === 'VIDEO' ? 'video' : 'image';
    attributes(
      el,
      type === 'video'
        ? ['src', 'controls', 'preload', 'playsinline', 'aria-label', 'style', 'width']
        : ['src', 'alt', 'style', 'width'],
    );
    if (type === 'video' && el.children.length) unsupported('视频内嵌资源结构');
    const match = /^\/media\/([^/?#]+)$/.exec(el.getAttribute('src') || '');
    if (!match) unsupported('图片来源（仅允许已登记的本地图片）');
    let assetId;
    try {
      assetId = decodeURIComponent(match[1]);
    } catch {
      unsupported('图片地址');
    }
    if (!media.some((item) => item.id === assetId && item.type?.startsWith(type + '/')))
      unsupported('未登记的本地图片');
    let widthRatio = 0.75;
    const readWidth = (value) => {
      if (!/^\d+(?:\.\d+)?%$/.test(value)) unsupported('图片宽度（须为10–100%）');
      const ratio = Number(value.slice(0, -1)) / 100;
      if (ratio < 0.1 || ratio > 1) unsupported('图片宽度（须为10–100%）');
      return ratio;
    };
    let figureWidth = null,
      imageWidth = null;
    for (const target of [figure, el].filter(Boolean)) {
      for (const property of target.style) {
        if (property !== 'width') unsupported(`图片样式 ${property}`);
        const ratio = readWidth(target.style.getPropertyValue(property).trim());
        if (target === figure) figureWidth = ratio;
        else imageWidth = ratio;
      }
    }
    if (el.hasAttribute('width') && imageWidth === null)
      imageWidth = readWidth(el.getAttribute('width'));
    if (figureWidth !== null && imageWidth !== null && imageWidth !== 1)
      unsupported('图片区域与原图的不同宽度');
    widthRatio = figureWidth ?? imageWidth ?? widthRatio;
    const align = figure?.getAttribute('data-align') || 'center';
    if (!['left', 'center', 'right'].includes(align)) unsupported('图片对齐');
    const caption = figure?.querySelector('figcaption');
    if (caption) {
      attributes(caption);
      if ([...caption.childNodes].some((child) => child.nodeType !== 3))
        unsupported('带格式的图片图注');
    }
    return {
      type,
      attrs: {
        assetId,
        occurrenceId: crypto.randomUUID(),
        insertedAt,
        widthRatio,
        align,
        caption: caption?.textContent || '',
        alt:
          el.getAttribute(type === 'video' ? 'aria-label' : 'alt') ||
          (type === 'video' ? el.textContent : ''),
      },
    };
  }
  function children(parent, marks = []) {
    return [...parent.childNodes].flatMap((child) => convert(child, marks));
  }
  function blocks(nodes) {
    const result = [];
    let inline = [];
    const flush = () => {
      if (inline.length) {
        result.push({ type: 'paragraph', content: inline });
        inline = [];
      }
    };
    for (const node of nodes) {
      if (node.type === 'text' || node.type === 'hardBreak') inline.push(node);
      else {
        flush();
        result.push(node);
      }
    }
    flush();
    return result;
  }
  function convert(node, marks = []) {
    if (node.nodeType === 3)
      return node.data
        ? [{ type: 'text', text: node.data, ...(marks.length ? { marks } : {}) }]
        : [];
    if (node.nodeType !== 1) unsupported('非文字节点');
    const tag = node.tagName;
    if (tag === 'BR') {
      attributes(node);
      return [{ type: 'hardBreak' }];
    }
    if (tag === 'IMG' || tag === 'VIDEO') return [image(node)];
    if (tag === 'FIGURE') {
      attributes(node, ['data-rich-image', 'data-rich-video', 'data-align', 'style']);
      const items = [...node.children];
      if (
        items.filter((child) => ['IMG', 'VIDEO'].includes(child.tagName)).length !== 1 ||
        items.some((child) => !['IMG', 'VIDEO', 'FIGCAPTION'].includes(child.tagName)) ||
        items.filter((child) => child.tagName === 'FIGCAPTION').length > 1 ||
        [...node.childNodes].some((child) => child.nodeType === 3 && child.data.length)
      )
        unsupported('图片区域结构');
      return [image(node.querySelector('img,video'), node)];
    }
    if (tag === 'A') {
      attributes(node, ['href', 'target', 'rel', 'title']);
      const href = node.getAttribute('href') || '';
      if (!safeRichLink(href)) unsupported('链接地址');
      const attrs = { href };
      for (const name of ['target', 'rel', 'title'])
        if (node.hasAttribute(name)) attrs[name] = node.getAttribute(name);
      return children(node, addMark(marks, { type: 'link', attrs }));
    }
    if (markTags[tag] || tag === 'SPAN') {
      attributes(node, ['style']);
      const inherited = styledMarks(node, marks);
      return children(
        node,
        markTags[tag] ? addMark(inherited, { type: markTags[tag] }) : inherited,
      );
    }
    if (!blockTags.has(tag)) unsupported(`节点 ${tag}`);
    if (tag === 'PRE') {
      attributes(node);
      const code = node.children[0];
      if (node.children.length && (node.children.length !== 1 || code.tagName !== 'CODE'))
        unsupported('代码块结构');
      let language = null;
      if (code) {
        attributes(code, ['class']);
        const cls = code.getAttribute('class');
        if (cls && !/^language-[\w+-]+$/.test(cls)) unsupported('代码块语言');
        language = cls?.slice(9) || null;
        if (code.children.length) unsupported('代码块内嵌节点');
      }
      return [
        {
          type: 'codeBlock',
          attrs: { language },
          content: node.textContent ? [{ type: 'text', text: node.textContent }] : [],
        },
      ];
    }
    const extra =
      tag === 'OL'
        ? ['start', 'type']
        : ['TD', 'TH'].includes(tag)
          ? ['colspan', 'rowspan', 'colwidth']
          : [];
    attributes(node, ['style', ...extra]);
    const inherited = styledMarks(node, marks);
    const nested = children(node, inherited);
    if (tag === 'HR') return [{ type: 'horizontalRule' }];
    if (['THEAD', 'TBODY', 'TFOOT'].includes(tag)) return nested;
    if (tag === 'P' || tag === 'DIV')
      return blocks(nested).length ? blocks(nested) : [{ type: 'paragraph' }];
    if (/^H[1-6]$/.test(tag))
      return [{ type: 'heading', attrs: { level: +tag[1] }, content: nested }];
    if (tag === 'BLOCKQUOTE') return [{ type: 'blockquote', content: blocks(nested) }];
    if (tag === 'LI')
      return [
        {
          type: 'listItem',
          content: blocks(nested).length ? blocks(nested) : [{ type: 'paragraph' }],
        },
      ];
    if (tag === 'UL') return [{ type: 'bulletList', content: nested }];
    if (tag === 'OL')
      return [
        {
          type: 'orderedList',
          attrs: {
            start: node.hasAttribute('start') ? Number(node.getAttribute('start')) : 1,
            type: node.getAttribute('type'),
          },
          content: nested,
        },
      ];
    if (tag === 'TABLE') return [{ type: 'table', content: nested }];
    if (tag === 'TR') return [{ type: 'tableRow', content: nested }];
    const attrs = {
      colspan: Number(node.getAttribute('colspan') || 1),
      rowspan: Number(node.getAttribute('rowspan') || 1),
      colwidth: node.hasAttribute('colwidth')
        ? node.getAttribute('colwidth').split(',').map(Number)
        : null,
    };
    return [
      {
        type: tag === 'TH' ? 'tableHeader' : 'tableCell',
        attrs,
        content: blocks(nested).length ? blocks(nested) : [{ type: 'paragraph' }],
      },
    ];
  }
  const content = blocks(children(inert.content));
  try {
    const body = fromEditorJSON({
      type: 'doc',
      content: content.length ? content : [{ type: 'paragraph' }],
    });
    validateRenderableRichDocument(body);
    return body;
  } catch {
    unsupported('结构（编辑器无法完整保留）');
  }
}
