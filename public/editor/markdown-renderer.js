import { marked } from '../vendor/marked.js';
import { sanitize } from './content.js';

/** HTML is a compatibility projection; Markdown remains the editing source. */
export function renderMarkdown(source) {
  return sanitize(
    marked
      .parse(String(source), { gfm: true, breaks: true })
      .replace(/<input\b[^>]*>/gi, (tag) =>
        /\btype="checkbox"/.test(tag) ? (/\bchecked/.test(tag) ? '☑ ' : '☐ ') : '',
      ),
  );
}
