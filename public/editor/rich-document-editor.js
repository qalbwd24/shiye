import {
  Editor,
  Node,
  Mark,
  Extension,
  mergeAttributes,
  markInputRule,
  markPasteRule,
  StarterKit,
  Markdown,
  TableKit,
  TaskList,
  TaskItem,
  Plugin,
  getSchema,
} from '../vendor/rich-editor.js';
import {
  fromEditorJSON,
  toEditorJSON,
  richNodeTypes,
  safeRichLink,
  assertRichFieldsPreserved,
  prepareRichMarkdown,
} from '../shared/rich-document.js';

export const Highlight = Mark.create({
  name: 'highlight',
  parseHTML: () => [{ tag: 'mark' }],
  renderHTML: ({ HTMLAttributes }) => ['mark', HTMLAttributes, 0],
  markdownTokenName: 'shiyeHighlight',
  markdownTokenizer: {
    name: 'shiyeHighlight',
    level: 'inline',
    start: (src) => src.indexOf('=='),
    tokenize(src, _tokens, lexer) {
      const match = /^==([^=\n]+)==/.exec(src);
      if (match)
        return { type: 'shiyeHighlight', raw: match[0], tokens: lexer.inlineTokens(match[1]) };
    },
  },
  parseMarkdown: (token, h) => h.applyMark('highlight', h.parseInline(token.tokens || [])),
  renderMarkdown: (node, h) => `==${h.renderChildren(node)}==`,
  addInputRules() {
    return [markInputRule({ find: /(?:^|\s)(==([^=\n]+)==)$/, type: this.type })];
  },
  addPasteRules() {
    return [markPasteRule({ find: /(==([^=\n]+)==)/g, type: this.type })];
  },
});

const StableBlocks = Extension.create({
  name: 'shiyeStableBlocks',
  addGlobalAttributes() {
    return [
      {
        types: richNodeTypes.filter((t) => t !== 'text'),
        attributes: {
          blockId: { default: null, parseHTML: () => null, rendered: false },
        },
      },
    ];
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction(transactions, _old, state) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          const seen = new Set();
          const occurrences = new Set();
          const tr = state.tr;
          state.doc.descendants((node, pos) => {
            if (node.isText) return;
            const attrs = { ...node.attrs };
            let changed = false;
            if (!attrs.blockId || seen.has(attrs.blockId)) {
              attrs.blockId = crypto.randomUUID();
              changed = true;
            }
            seen.add(attrs.blockId);
            if (node.type.name === 'image' || node.type.name === 'video') {
              if (!attrs.occurrenceId || occurrences.has(attrs.occurrenceId)) {
                attrs.occurrenceId = crypto.randomUUID();
                changed = true;
              }
              occurrences.add(attrs.occurrenceId);
            }
            if (changed) tr.setNodeMarkup(pos, undefined, attrs);
          });
          return tr.docChanged ? tr.setMeta('addToHistory', false) : null;
        },
      }),
    ];
  },
});

export function richExtensions(resolveAsset = () => '', onImage = () => {}, onMediaEdit) {
  const localSource = (assetId, type) => {
    const value = resolveAsset(assetId, type);
    return typeof value === 'string' &&
      (value === '/media/' + encodeURIComponent(assetId) || value.startsWith('blob:'))
      ? value
      : '';
  };
  const Image = Node.create({
    name: 'image',
    group: 'block',
    atom: true,
    draggable: true,
    addAttributes() {
      return Object.fromEntries(
        Object.entries({
          assetId: null,
          occurrenceId: null,
          insertedAt: null,
          widthRatio: 0.75,
          align: 'center',
          caption: '',
          alt: '',
        }).map(([key, value]) => [key, { default: value, rendered: false }]),
      );
    },
    // External and clipboard HTML images are never fetched. Files go through the local Blob store.
    parseHTML: () => [],
    markdownTokenName: 'image',
    parseMarkdown(token, h) {
      if (!token.href?.startsWith('shiye-asset:'))
        throw new Error('Markdown 图片须为已插入的本地图片；请用“插入图片”。');
      return h.createNode('image', {
        assetId: token.href.slice(12),
        occurrenceId: crypto.randomUUID(),
        insertedAt: new Date().toISOString(),
        widthRatio: 0.75,
        align: 'center',
        caption: '',
        alt: token.text || '',
      });
    },
    renderMarkdown(node) {
      return `![${String(node.attrs.alt || '').replace(/[\[\]\\]/g, '\\$&')}](shiye-asset:${node.attrs.assetId})`;
    },
    renderHTML({ node, HTMLAttributes }) {
      const a = node.attrs;
      const src = localSource(a.assetId, 'image');
      return [
        'figure',
        mergeAttributes(HTMLAttributes, {
          'data-rich-image': a.occurrenceId,
          'data-align': a.align,
          style: `width:${Math.round(a.widthRatio * 100)}%`,
        }),
        ...(src
          ? [['img', { src, alt: a.alt || '', draggable: 'false' }]]
          : [['span', {}, '图片原件缺失']]),
        ...(a.caption ? [['figcaption', {}, a.caption]] : []),
      ];
    },
    addNodeView() {
      return ({ node, editor, getPos }) => {
        const dom = document.createElement('figure');
        dom.contentEditable = 'false';
        const paint = (current) => {
          const a = current.attrs;
          dom.dataset.richImage = a.occurrenceId;
          dom.dataset.align = a.align;
          dom.style.width = `${Math.round(a.widthRatio * 100)}%`;
          dom.replaceChildren();
          const src = localSource(a.assetId, 'image');
          if (src) {
            const img = document.createElement('img');
            img.src = src;
            img.alt = a.alt || '';
            img.draggable = false;
            img.addEventListener('dblclick', () => onImage(a.assetId));
            dom.append(img);
          } else dom.append('图片原件缺失');
          if (a.caption) {
            const caption = document.createElement('figcaption');
            caption.textContent = a.caption;
            dom.append(caption);
          }
          if (editor.isEditable && onMediaEdit) {
            const edit = document.createElement('button');
            edit.type = 'button';
            edit.className = 'rich-media-edit secondary';
            edit.textContent = '编辑信息';
            edit.setAttribute('aria-label', '编辑图片信息');
            edit.addEventListener('click', (event) => {
              event.stopPropagation();
              const pos = getPos();
              if (!editor.isEditable || typeof pos !== 'number') return;
              editor.commands.setNodeSelection(pos);
              onMediaEdit();
            });
            dom.append(edit);
          }
        };
        paint(node);
        dom.addEventListener('click', () => {
          if (editor.isEditable && typeof getPos() === 'number')
            editor.commands.setNodeSelection(getPos());
        });
        return {
          dom,
          stopEvent: (event) => !!event.target.closest?.('.rich-media-edit'),
          update(next) {
            if (next.type.name !== 'image') return false;
            paint(next);
            return true;
          },
        };
      };
    },
  });
  const Video = Node.create({
    name: 'video',
    group: 'block',
    atom: true,
    draggable: true,
    addAttributes() {
      return Object.fromEntries(
        Object.entries({
          assetId: null,
          occurrenceId: null,
          insertedAt: null,
          widthRatio: 0.75,
          align: 'center',
          caption: '',
          alt: '',
        }).map(([key, value]) => [key, { default: value, rendered: false }]),
      );
    },
    // Only programmatic local asset insertions create media nodes. Clipboard
    // HTML cannot cause an arbitrary external video/source request.
    parseHTML: () => [],
    renderMarkdown() {
      throw new Error('Markdown 无法完整保留正文视频，请保留富文档格式。');
    },
    renderHTML({ node, HTMLAttributes }) {
      const a = node.attrs,
        src = localSource(a.assetId, 'video');
      return [
        'figure',
        mergeAttributes(HTMLAttributes, {
          'data-rich-video': a.occurrenceId,
          'data-align': a.align,
          style: `width:${Math.round(a.widthRatio * 100)}%`,
        }),
        ...(src
          ? [
              [
                'video',
                {
                  src,
                  controls: '',
                  preload: 'metadata',
                  playsinline: '',
                  'aria-label': a.alt || '视频',
                },
                a.alt || '当前浏览器无法播放此视频。',
              ],
            ]
          : [['span', {}, '视频原件缺失']]),
        ...(a.caption ? [['figcaption', {}, a.caption]] : []),
      ];
    },
    addNodeView() {
      return ({ node, editor, getPos }) => {
        const dom = document.createElement('figure');
        dom.contentEditable = 'false';
        let current = node;
        const paint = () => {
          const a = current.attrs;
          dom.dataset.richVideo = a.occurrenceId;
          dom.dataset.align = a.align;
          dom.style.width = `${Math.round(a.widthRatio * 100)}%`;
          dom.replaceChildren();
          const src = localSource(a.assetId, 'video');
          if (src) {
            const video = document.createElement('video');
            video.src = src;
            video.controls = true;
            video.preload = 'metadata';
            video.playsInline = true;
            video.setAttribute('aria-label', a.alt || '视频');
            video.textContent = a.alt || '当前浏览器无法播放此视频。';
            dom.append(video);
          } else dom.append('视频原件缺失');
          if (a.caption) {
            const caption = document.createElement('figcaption');
            caption.textContent = a.caption;
            dom.append(caption);
          }
        };
        paint();
        dom.addEventListener('click', () => {
          // Node selection is metadata only; paint is skipped for unchanged
          // content, so native playback controls keep their live DOM/state.
          if (editor.isEditable && typeof getPos() === 'number')
            editor.commands.setNodeSelection(getPos());
        });
        return {
          dom,
          stopEvent: (event) => !!event.target.closest?.('video'),
          update(next) {
            if (next.type.name !== 'video') return false;
            if (!current.eq(next)) {
              current = next;
              paint();
            }
            return true;
          },
        };
      };
    },
  });
  return [
    StarterKit.configure({
      link: { openOnClick: false, autolink: false, isAllowedUri: safeRichLink },
    }),
    Highlight,
    StableBlocks,
    Image,
    Video,
    TableKit.configure({ table: { resizable: false } }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Markdown.configure({ markedOptions: { gfm: true, breaks: false } }),
  ];
}

export function createRichEditor(
  element,
  {
    body,
    onUpdate = () => {},
    resolveAsset,
    onImage,
    onMediaEdit,
    editable = true,
    enableInputRules = true,
    enablePasteRules = true,
  } = {},
) {
  const extensions = richExtensions(resolveAsset, onImage, onMediaEdit);
  const schema = getSchema(extensions);
  const checked = (body) => {
    const json = toEditorJSON(body);
    const parsed = schema.nodeFromJSON(json);
    parsed.check();
    assertRichFieldsPreserved(json, parsed.toJSON());
    return json;
  };
  const editor = new Editor({
    element,
    extensions,
    editable,
    enableInputRules,
    enablePasteRules,
    content: checked(body || fromEditorJSON({ type: 'doc', content: [{ type: 'paragraph' }] })),
    editorProps: {
      attributes: {
        lang: 'zh-CN',
        'aria-label': editable ? '富文本试写正文' : '同内容消息只读预览',
      },
    },
    onUpdate: () => onUpdate(),
  });
  return {
    editor,
    checkBody(next) {
      checked(next);
    },
    getBody() {
      return fromEditorJSON(editor.getJSON());
    },
    setBody(next) {
      editor.commands.setContent(checked(next));
    },
    parseMarkdown(text) {
      return fromEditorJSON(editor.markdown.parse(prepareRichMarkdown(text)));
    },
    insertMarkdown(text) {
      const body = fromEditorJSON(editor.markdown.parse(prepareRichMarkdown(text)));
      editor.chain().focus().insertContent(toEditorJSON(body).content).run();
    },
    getMarkdown() {
      return editor.getMarkdown();
    },
    destroy() {
      editor.destroy();
    },
  };
}
