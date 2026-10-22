import { validateRenderableRichDocument } from './rich-document-renderer.js';

/** Select an editable document without converting or rewriting legacy HTML. */
export function getEditorDocument(entry = {}) {
  if (entry.contentFormat === 'richdoc') {
    try {
      validateRenderableRichDocument(entry.body);
      return { format: 'richdoc', body: entry.body };
    } catch {
      // Never revive stale Markdown for a broken authoritative richdoc candidate.
      return { format: 'html', source: typeof entry.content === 'string' ? entry.content : '' };
    }
  }
  const content = typeof entry.content === 'string' ? entry.content : '';
  const markdown =
    entry.contentFormat !== 'html' &&
    typeof entry.markdownSource === 'string' &&
    entry.markdownHtml === content;
  return markdown
    ? { format: 'markdown', source: entry.markdownSource }
    : { format: 'html', source: content };
}
