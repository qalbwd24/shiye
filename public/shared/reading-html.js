/** Detached, local-media-only HTML for non-editable legacy reading projections. */
export function sanitizeReadingHtml(html, doc = document) {
  const template = doc.createElement('template');
  template.innerHTML = String(html || '');
  const allowed = new Set(
    'P DIV BR STRONG B I EM MARK DEL U S STRIKE UL OL LI BLOCKQUOTE H1 H2 H3 H4 H5 H6 PRE CODE HR TABLE THEAD TBODY TFOOT TR TD TH A SPAN FONT IMG FIGURE FIGCAPTION VIDEO AUDIO SOURCE DETAILS SUMMARY'.split(
      ' ',
    ),
  );
  const media = (value) => /^\/media\/[a-zA-Z0-9%._:-]+$/.test(value || '');
  const clean = (parent) => {
    for (const node of [...parent.childNodes]) {
      if (node.nodeType !== 1) continue;
      if (
        /^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|LINK|META|SVG|MATH|FORM|INPUT|BUTTON)$/.test(
          node.tagName,
        )
      ) {
        node.remove();
        continue;
      }
      clean(node);
      if (!allowed.has(node.tagName)) {
        node.replaceWith(...node.childNodes);
        continue;
      }
      const values = Object.fromEntries([...node.attributes].map((a) => [a.name, a.value]));
      const style = node.style;
      const styles = Object.fromEntries(
        [
          'whiteSpace',
          'textAlign',
          'width',
          'color',
          'backgroundColor',
          'fontWeight',
          'fontStyle',
          'textDecoration',
        ].map((key) => [key, style[key]]),
      );
      for (const attribute of [...node.attributes]) node.removeAttribute(attribute.name);
      if (['IMG', 'VIDEO', 'AUDIO', 'SOURCE'].includes(node.tagName)) {
        if (!media(values.src)) {
          node.replaceWith(doc.createTextNode('[媒体来源不可用]'));
          continue;
        }
        node.setAttribute('src', values.src);
        if (node.tagName === 'IMG') {
          node.setAttribute('alt', values.alt || '');
          node.setAttribute('loading', 'lazy');
        }
        if (['VIDEO', 'AUDIO'].includes(node.tagName)) {
          node.setAttribute('controls', '');
          node.setAttribute('preload', 'metadata');
        }
        if (
          node.tagName === 'SOURCE' &&
          /^(image|video|audio)\/[a-zA-Z0-9.+-]+$/.test(values.type || '')
        )
          node.setAttribute('type', values.type);
      }
      if (node.tagName === 'A') {
        if (media(values.href) || /^(https?:\/\/|mailto:)/i.test(values.href || ''))
          node.setAttribute('href', values.href);
        node.setAttribute('rel', 'noopener noreferrer');
      }
      for (const name of ['colspan', 'rowspan', 'start'])
        if (/^\d{1,6}$/.test(values[name] || '')) node.setAttribute(name, values[name]);
      for (const name of [
        'data-rich-image',
        'data-rich-video',
        'data-legacy-attachment',
        'data-align',
      ])
        if (/^[\w:-]{1,200}$/.test(values[name] || '')) node.setAttribute(name, values[name]);
      if (styles.whiteSpace === 'pre-wrap') node.style.whiteSpace = 'pre-wrap';
      if (['left', 'center', 'right'].includes(styles.textAlign))
        node.style.textAlign = styles.textAlign;
      if (/^(?:100|\d{1,2})(?:\.\d+)?%$/.test(styles.width || '')) node.style.width = styles.width;
      for (const key of ['color', 'backgroundColor', 'fontWeight', 'fontStyle', 'textDecoration'])
        if (styles[key] && !/url|expression|[<>]/i.test(styles[key])) node.style[key] = styles[key];
    }
  };
  clean(template.content);
  return template.innerHTML;
}
