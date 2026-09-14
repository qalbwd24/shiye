export const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
export const escape = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export function sanitize(html) {
  const doc = new DOMParser().parseFromString(String(html), 'text/html');
  const allowed = new Set([
    'P',
    'DIV',
    'BR',
    'STRONG',
    'B',
    'I',
    'EM',
    'U',
    'S',
    'STRIKE',
    'UL',
    'OL',
    'LI',
    'BLOCKQUOTE',
    'H1',
    'H2',
    'H3',
    'H4',
    'H5',
    'H6',
    'PRE',
    'CODE',
    'HR',
    'TABLE',
    'THEAD',
    'TBODY',
    'TR',
    'TD',
    'TH',
    'A',
    'SPAN',
    'FONT',
  ]);
  function clean(node) {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 1) {
        if (
          ['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'SVG', 'MATH', 'FORM', 'INPUT'].includes(
            child.tagName,
          )
        ) {
          child.remove();
          continue;
        }
        clean(child);
        if (!allowed.has(child.tagName)) {
          child.replaceWith(...child.childNodes);
          continue;
        }
        const href = child.tagName === 'A' ? child.getAttribute('href') : null;
        const color = child.style.color || child.getAttribute('color');
        for (const a of [...child.attributes]) child.removeAttribute(a.name);
        if (href && /^(https?:|mailto:)/i.test(href)) {
          child.setAttribute('href', href);
          child.setAttribute('target', '_blank');
          child.setAttribute('rel', 'noopener noreferrer');
        }
        if (color && /^(#[0-9a-f]{3,8}|rgb\([0-9, ]+\))$/i.test(color)) child.style.color = color;
      } else if (child.nodeType !== 3) child.remove();
    }
  }
  clean(doc.body);
  return doc.body.innerHTML;
}
export const plainCache = new Map();
export function textOf(html) {
  if (plainCache.has(html)) return plainCache.get(html);
  const d = new DOMParser().parseFromString(sanitize(html), 'text/html');
  d.body.querySelectorAll('br').forEach((e) => e.replaceWith('\n'));
  d.body.querySelectorAll('p,div,li,h1,h2,h3,h4,blockquote,tr,pre').forEach((e) => e.append('\n'));
  const text = (d.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
  if (plainCache.size > 6000) plainCache.clear();
  plainCache.set(html, text);
  return text;
}
export const dateText = (d) =>
  new Date(d).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
export const timeText = (d) =>
  new Date(d).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
export const localDate = (d) => {
  const v = new Date(d);
  return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
};
export const inputDate = (d) => localDate(d) + 'T' + timeText(d);
