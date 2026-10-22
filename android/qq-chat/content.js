import { renderMarkdown } from '../../public/editor/markdown-renderer.js';
import { renderRichDocument } from '../../public/shared/rich-document-renderer.js';
import { sanitizeReadingHtml } from '../../public/shared/reading-html.js';
import { formatText } from 'shiye:desktop-legacy-format';

/** Reading projection only. Never serializes HTML back into the original message/body. */
export function projectQQContent(message) {
  const text = typeof message.text === 'string' ? message.text : '';
  if (message.contentFormat === 'richdoc' || message.body?.format === 'shiye-richdoc') {
    return { format: 'richdoc', html: sanitizeReadingHtml(renderRichDocument(message.body)) };
  }
  if (message.contentFormat === 'html') {
    return { format: 'html', html: sanitizeReadingHtml(message.content ?? text) };
  }
  const entities = (message.entities || []).map((entity) => ({
    ...entity,
    shiyeType: entity.shiyeType || entity.className || entity.type,
  }));
  const source = entities.length ? formatText({ message: text, entities }) : text;
  return { format: 'markdown', html: renderMarkdown(source) };
}

export function renderQQContent(target, message) {
  target.classList.add('qq-rich-body');
  try {
    const result = projectQQContent(message);
    target.dataset.contentFormat = result.format;
    // Both renderers use the desktop allowlist, not raw message HTML.
    target.innerHTML = result.html;
    return { rendered: true, format: result.format };
  } catch {
    target.dataset.contentFormat = 'unsupported';
    target.textContent = '此正文格式暂不能完整显示，原文已保留。';
    return { rendered: false, format: 'unsupported' };
  }
}
