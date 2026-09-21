/** Select an editable document without converting or rewriting legacy HTML. */
export function getEditorDocument(entry = {}) {
  const content = typeof entry.content === 'string' ? entry.content : '';
  const markdown =
    entry.contentFormat !== 'html' &&
    typeof entry.markdownSource === 'string' &&
    entry.markdownHtml === content;
  return markdown
    ? { format: 'markdown', source: entry.markdownSource }
    : { format: 'html', source: content };
}
