import { legacyReadingRoot } from './legacy-reading-dom.mjs';

/** Inert runtime DOM sanitizer, including legacy disclosure/code and local media. */
export function sanitizeLegacyReadingHTML(html, media = []) {
  const root = legacyReadingRoot(html);
  const issues = [];
  try {
    const ids = new Set(media.map((asset) => String(asset.id)));
    const allowed = new Set(
      'p br div h1 h2 h3 h4 h5 h6 blockquote ul ol li pre code hr table thead tbody tfoot tr td th strong b i em u s del strike mark a span details summary img video audio source'.split(
        ' ',
      ),
    );
    for (const element of Array.from(root.querySelectorAll('*'))) {
      const tag = element.localName;
      if (
        [
          'script',
          'style',
          'iframe',
          'object',
          'embed',
          'template',
          'link',
          'meta',
          'base',
        ].includes(tag)
      ) {
        issues.push({ code: 'unsafe-legacy-element-removed', tag });
        element.remove();
        continue;
      }
      if (!allowed.has(tag)) {
        issues.push({ code: 'unsupported-legacy-element-unwrapped', tag });
        element.replaceWith(...element.childNodes);
        continue;
      }
      for (const attr of Array.from(element.attributes)) {
        let safe = ['title', 'alt'].includes(attr.name);
        if (attr.name === 'class' && tag === 'code' && /^language-[\w-]+$/.test(attr.value))
          safe = true;
        if (attr.name === 'open' && tag === 'details') safe = true;
        if (attr.name === 'start' && tag === 'ol' && /^\d+$/.test(attr.value)) safe = true;
        if (
          ['colspan', 'rowspan'].includes(attr.name) &&
          ['td', 'th'].includes(tag) &&
          /^\d+$/.test(attr.value)
        )
          safe = true;
        if (attr.name === 'href' && tag === 'a' && /^(https?:\/\/|mailto:)/i.test(attr.value))
          safe = true;
        if (['src', 'href'].includes(attr.name) && /^\/media\/([^/?#]+)$/.test(attr.value)) {
          try {
            safe = ids.has(decodeURIComponent(attr.value.slice(7)));
          } catch {
            safe = false;
          }
        }
        if (attr.name === 'style') {
          const accepted = [];
          for (let i = 0; i < element.style.length; i++) {
            const property = element.style.item(i),
              value = element.style.getPropertyValue(property).trim();
            if (
              [
                'font-weight',
                'font-style',
                'text-decoration',
                'color',
                'background-color',
                'font-size',
                'font-family',
                'text-align',
                'white-space',
                'text-indent',
                'line-height',
              ].includes(property) &&
              /^[\w\s,#%().\-'"\u3400-\u9fff]+$/u.test(value) &&
              !/url|expression|behavior|javascript|@/i.test(value)
            )
              accepted.push(`${property}:${value}`);
            else issues.push({ code: 'unsupported-legacy-style-removed', property });
          }
          element.removeAttribute('style');
          if (accepted.length) element.setAttribute('style', accepted.join(';'));
          continue;
        }
        if (!safe) {
          element.removeAttribute(attr.name);
          issues.push({ code: 'unsafe-legacy-attribute-removed', tag, attribute: attr.name });
        }
      }
      if (tag === 'a') element.setAttribute('rel', 'noopener noreferrer');
      if (['video', 'audio'].includes(tag)) {
        element.setAttribute('controls', '');
        element.setAttribute('preload', 'metadata');
      }
    }
    return { html: root.innerHTML, issues };
  } finally {
    root.replaceChildren();
  }
}
