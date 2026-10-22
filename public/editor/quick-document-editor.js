import { createBodyEditor } from './body-editor.js';
import { createRichBodyAdapter } from './rich-body-adapter.js';
import { renderRichDocument } from '../shared/rich-document-renderer.js';
import { richMediaReferences, validateRichDocument } from '../shared/rich-document.js';
import { htmlToMarkdown } from './markdown-transforms.js';
import { renderMarkdown } from './markdown-renderer.js';
import { richTemplateDocument } from './rich-template-document.js';
import { captureDOMResumePosition, restoreDOMResumePosition } from './dom-resume-position.js';
import { sanitizeReadingHtml } from '../shared/reading-html.js';

/** Only explicitly opted-in development windows create new rich documents. */
export function richQuickEnabled(location) {
  return (
    ['127.0.0.1', 'localhost'].includes(location.hostname) &&
    location.port === '18766' &&
    new URLSearchParams(location.search).get('richdoc') === '1'
  );
}

/** Keep the quick window's lifecycle and save queue; replace only its body control. */
export function createQuickDocumentEditor(c, { richNewDocuments = false } = {}) {
  let mounted = null,
    rich = false,
    imageControls = null,
    reading = null;
  const host = c.$('#bodyEditor');
  function insertAttachedImage(assetId, { position } = {}) {
    const entry = c.current();
    const media = c.library.media.find(
      (item) => item.id === assetId && /^(image|video)\//.test(item.type || ''),
    );
    if (!rich || !entry || entry.deleted || !entry.attachments?.includes(assetId) || !media)
      return false;
    return mounted.insertMedia(
      { assetId, alt: media.name || '' },
      { position, type: media.type.startsWith('video/') ? 'video' : 'image' },
    );
  }
  function imageLayout() {
    const adapter = mounted;
    const entryId = c.current()?.id;
    const selected = adapter?.selectedMedia?.();
    if (!selected) return c.toast('请先在正文中选中图片或视频');
    c.modal(
      '媒体排版',
      '<p>仅调整这次出现的显示效果，原图文件保持不变。</p><div class="rich-image-layout"><label>显示宽度（10–100%）<input id="richImageWidth" class="field" type="number" min="10" max="100" step="1"></label><label>对齐<select id="richImageAlign" class="field"><option value="left">靠左</option><option value="center">居中</option><option value="right">靠右</option></select></label><label>图注<textarea id="richImageCaption" class="field" rows="3"></textarea></label><label>替代文字<input id="richImageAlt" class="field" type="text"></label></div><button class="primary" id="applyRichImageLayout">应用</button>',
    );
    c.$('#richImageWidth').value = String(Math.round(selected.widthRatio * 100));
    c.$('#richImageAlign').value = selected.align;
    c.$('#richImageCaption').value = selected.caption;
    c.$('#richImageAlt').value = selected.alt;
    c.$('#applyRichImageLayout').onclick = () => {
      if (mounted !== adapter || c.current()?.id !== entryId)
        return c.toast('请回到原日记后再调整图片');
      const width = Number(c.$('#richImageWidth').value);
      if (!Number.isInteger(width) || width < 10 || width > 100)
        return c.toast('显示宽度须为10–100%');
      try {
        if (
          !adapter.updateSelectedMedia(
            {
              widthRatio: width / 100,
              align: c.$('#richImageAlign').value,
              caption: c.$('#richImageCaption').value,
              alt: c.$('#richImageAlt').value,
            },
            { occurrenceId: selected.occurrenceId },
          )
        )
          return c.toast('图片位置已变化，请重新选中后调整');
        c.closeModal();
        adapter.focus();
      } catch (error) {
        c.toast(error.message);
      }
    };
  }
  function attachedImages() {
    const adapter = mounted;
    const entryId = c.current()?.id;
    const position = adapter.capturePosition();
    c.modal(
      '插入已有图片或视频',
      '<p>选择本篇已有图片或视频，插入到刚才的正文光标处。</p><div id="richAttachmentChoices" class="rich-attachment-choices"></div>',
    );
    const dialog = c.$('#modal') || document.querySelector('dialog[open]');
    const release = (event) => {
      // close is queued: replacing the settings dialog may deliver its old
      // close event after this new modal has already opened. Keep the bookmark.
      if (event && (event.target !== dialog || dialog?.open)) return;
      adapter.releasePosition(position);
      document.removeEventListener('close', release, true);
    };
    document.addEventListener('close', release, { capture: true });
    const choices = c.$('#richAttachmentChoices');
    const items = (c.current()?.attachments || [])
      .map((id) =>
        c.library.media.find((item) => item.id === id && /^(image|video)\//.test(item.type || '')),
      )
      .filter(Boolean);
    if (!items.length) choices.textContent = '本篇还没有图片或视频附件。';
    for (const item of items) {
      const button = host.ownerDocument.createElement('button');
      button.type = 'button';
      button.className = 'option-button';
      button.textContent = item.name || '图片';
      button.dataset.richAttachment = item.id;
      button.onclick = () => {
        if (mounted !== adapter || c.current()?.id !== entryId)
          return c.toast('请回到原日记后再插入');
        if (!insertAttachedImage(item.id, { position }))
          return c.toast('插入位置暂不可用，请结束输入法组词后重试');
        release();
        c.closeModal();
        adapter.focus();
      };
      choices.append(button);
    }
  }
  function mountImageControls() {
    imageControls = host.ownerDocument.createElement('div');
    imageControls.className = 'editor-document-controls rich-image-controls';
    for (const [id, label, action] of [
      ['richImageLayout', '媒体排版', imageLayout],
      ['insertRichAttachment', '插入已有图片或视频', attachedImages],
    ]) {
      const button = host.ownerDocument.createElement('button');
      button.type = 'button';
      button.className = 'secondary';
      button.id = id;
      button.textContent = label;
      button.onclick = action;
      imageControls.append(button);
    }
    c.$('#editorToolboxContent')?.append(imageControls);
  }
  function choose(useRich) {
    if (reading) {
      reading = null;
      host.classList.remove('rich-reading-document');
      host.removeAttribute('tabindex');
      host.setAttribute('contenteditable', 'true');
      host.setAttribute('aria-label', '日记正文');
    }
    if (mounted && rich === useRich) return mounted;
    mounted?.dispose();
    imageControls?.remove();
    imageControls = null;
    host.replaceChildren();
    host.classList.remove('markdown-editor', 'rich-document-editor');
    rich = useRich;
    mounted = useRich
      ? createRichBodyAdapter(c, {
          renderProjection: renderRichDocument,
          onMediaEdit: imageLayout,
          onConflict: () => {
            const adapter = mounted;
            c.toast('输入期间出现另一个正文版本，当前文字已保留，请完成组词后核对');
            const show = () => {
              if (mounted !== adapter || !adapter.pendingConflict) return;
              if (adapter.composing || document.querySelector('dialog[open]')) return;
              c.modal(
                '核对正文版本',
                '<p>输入期间收到另一份正文。两份内容已保留在本窗口，请选择继续使用哪份。</p><button class="primary" data-rich-conflict="local">保留本窗口输入</button><button class="secondary" data-rich-conflict="incoming">采用传入正文</button>',
              );
              document.querySelectorAll('[data-rich-conflict]').forEach((button) => {
                button.onclick = () => {
                  if (adapter.resolveConflict(button.dataset.richConflict)) {
                    c.closeModal();
                    adapter.focus();
                  }
                };
              });
            };
            setTimeout(show, 0);
            host.addEventListener('compositionend', () => setTimeout(show, 0), { once: true });
            // If another modal was open at composition end, retry when it closes.
            document.addEventListener('close', show, { once: true, capture: true });
          },
          resolveAsset: (id, type = 'image') =>
            c.library.media.some((item) => item.id === id && item.type?.startsWith(type + '/'))
              ? '/media/' + encodeURIComponent(id)
              : '',
        })
      : createBodyEditor(c);
    host.classList.toggle('rich-document-editor', useRich);
    if (useRich) mountImageControls();
    return mounted;
  }
  const delegate = (name, ...args) => mounted?.[name]?.(...args);
  return {
    render(entry) {
      if (reading && reading.source?.id === entry?.id) return;
      const result = choose(entry?.contentFormat === 'richdoc').render(entry);
      imageControls?.querySelectorAll('button').forEach((button) => {
        button.disabled = !entry || !!entry.deleted;
      });
      return result;
    },
    renderReadingDocument(entry, projection) {
      if (!entry || projection?.source?.id !== entry.id) return false;
      const html = sanitizeReadingHtml(projection.html, host.ownerDocument);
      mounted?.dispose();
      mounted = null;
      rich = false;
      imageControls?.remove();
      imageControls = null;
      reading = projection;
      host.classList.remove('markdown-editor');
      host.classList.add('rich-document-editor', 'rich-reading-document');
      host.setAttribute('contenteditable', 'false');
      host.setAttribute('tabindex', '0');
      host.setAttribute('aria-label', '旧日记图文阅读');
      host.innerHTML = `<article class="tiptap rich-reading-content">${html}</article>`;
      return true;
    },
    exitReadingDocument(entry = c.current()) {
      return choose(entry?.contentFormat === 'richdoc').render(entry);
    },
    newDocument(...args) {
      // Do not switch the currently mounted editor before navigation commits it.
      const useRich =
        typeof richNewDocuments === 'function' ? richNewDocuments() : richNewDocuments;
      if (useRich) {
        if (args[0]) {
          const body = richTemplateDocument(args[0], {
            media: c.library.media,
            ownerDocument: host.ownerDocument,
          });
          return { contentFormat: 'richdoc', body, content: renderRichDocument(body) };
        }
        const temporary = createRichBodyAdapter(c, { renderProjection: renderRichDocument });
        try {
          const next = temporary.newDocument(...args);
          next.content = renderRichDocument(next.body);
          return next;
        } finally {
          temporary.dispose();
        }
      }
      // Match the legacy document factory without unmounting an active rich
      // draft while navigation is still preparing its next template.
      const [template = '', autoIndent = true] = args;
      const source = template ? htmlToMarkdown(c.sanitize(template)) : autoIndent ? '　　' : '';
      const content = renderMarkdown(source);
      return { contentFormat: 'markdown', markdownSource: source, content, markdownHtml: content };
    },
    command(name, value) {
      if (reading) {
        c.toast('当前为图文阅读，请点“继续编辑原文”后修改');
        return true;
      }
      const handled = delegate('command', name, value);
      if (!handled && rich) {
        c.toast('新图文编辑器暂不支持此格式操作，正文已保留');
        return true;
      }
      return handled;
    },
    insertDateTime: (...args) => (reading ? true : delegate('insertDateTime', ...args)),
    selectedImage: (...args) => delegate('selectedImage', ...args),
    selectedMedia: (...args) => delegate('selectedMedia', ...args),
    updateSelectedImage: (...args) => delegate('updateSelectedImage', ...args),
    updateSelectedMedia: (...args) => delegate('updateSelectedMedia', ...args),
    insertMedia: (...args) => delegate('insertMedia', ...args),
    imageLayout,
    attachedImages,
    insertAttachedImage,
    focus: (...args) =>
      reading ? host.focus({ preventScroll: true }) : delegate('focus', ...args),
    atStart: (...args) => delegate('atStart', ...args),
    commit: (...args) => (reading ? false : delegate('commit', ...args)),
    syncIdentity: (...args) => delegate('syncIdentity', ...args),
    capturePosition: (...args) => delegate('capturePosition', ...args),
    restorePosition: (...args) => delegate('restorePosition', ...args),
    captureResumePosition() {
      if (reading)
        return { ...captureDOMResumePosition(host), format: 'reading', entryId: c.current()?.id };
      if (!mounted || !c.current()) return null;
      if (rich) return delegate('captureResumePosition');
      const position = mounted.isMarkdown
        ? mounted.capturePosition()
        : captureDOMResumePosition(host);
      return position
        ? { ...position, format: mounted.isMarkdown ? 'markdown' : 'html', entryId: c.current().id }
        : null;
    },
    restoreResumePosition(position) {
      if (reading)
        return (
          position?.entryId === c.current()?.id &&
          position.format === 'reading' &&
          restoreDOMResumePosition(host, position)
        );
      if (!mounted || position?.entryId !== c.current()?.id) return false;
      if (rich) return !!delegate('restoreResumePosition', position);
      if (mounted.isMarkdown) {
        if (
          position.format !== 'markdown' ||
          !Number.isFinite(position.anchor) ||
          !Number.isFinite(position.head)
        )
          return false;
        mounted.restorePosition({
          ...position,
          anchor: Math.trunc(position.anchor),
          head: Math.trunc(position.head),
        });
        return true;
      }
      return position.format === 'html' && restoreDOMResumePosition(host, position);
    },
    toggleSource() {
      if (rich) return c.toast('新图文正文直接编辑；旧篇仍可使用原来的 Markdown 源码模式');
      return delegate('toggleSource');
    },
    captureMediaPosition(entry) {
      return rich && c.current() === entry ? delegate('capturePosition') : null;
    },
    releaseMediaPosition(position) {
      return rich && delegate('releasePosition', position);
    },
    insertUploadedMedia(entry, media, position, insertedAt, occurrenceId) {
      if (entry?.contentFormat !== 'richdoc' || !/^(image|video)\//.test(media.type || ''))
        return false;
      const type = media.type.startsWith('video/') ? 'video' : 'image';
      if (richMediaReferences(entry.body).some((item) => item.occurrenceId === occurrenceId))
        return true;
      const attrs = {
        blockId: crypto.randomUUID(),
        assetId: media.id,
        occurrenceId,
        insertedAt,
        widthRatio: 0.75,
        align: 'center',
        caption: '',
        alt: media.name || '',
      };
      if (rich && c.current() === entry) {
        if (!delegate('insertMedia', attrs, { position, type }))
          throw Error('媒体原件已上传，插入位置暂不可用，请结束输入法组词后在上传队列重试');
        delegate('commit');
      } else {
        // A slow upload can finish after navigation. Never insert into the new active diary.
        const body = structuredClone(entry.body);
        body.content.push({ type, attrs });
        validateRichDocument(body);
        entry.body = body;
        entry.content = renderRichDocument(body);
        c.markDirty(entry);
      }
      return true;
    },
    usesMedia(id) {
      const entry = c.current();
      return (
        entry?.contentFormat === 'richdoc' &&
        richMediaReferences(entry.body).some((item) => item.assetId === id)
      );
    },
    get isMarkdown() {
      return !!mounted?.isMarkdown;
    },
    get isRichDocument() {
      return rich;
    },
    get isStructured() {
      return !!reading || rich || !!mounted?.isMarkdown;
    },
    get isReadingDocument() {
      return !!reading;
    },
    dispose() {
      mounted?.dispose();
      imageControls?.remove();
      imageControls = null;
      mounted = null;
      reading = null;
    },
  };
}
