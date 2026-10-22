const escape = (text) => String(text).replace(/[\\`*_{}[\]<>#+.!|~-]/g, '\\$&');
/** Compatibility text only; original richdoc remains authoritative. */
export function revisitMarkdown(body, { normalizeDiaryParagraphIndent = false } = {}) {
  // Remove writing indentation before wrapping marks in Markdown. Trimming the
  // finished Markdown misses spaces inside **marks** or after a time marker.
  // Work on detached inline atoms; original body, code and nested layouts stay intact.
  function paragraphContent(content = []) {
    let lineStart = true;
    return content.map((atom) => {
      if (atom.type === 'hardBreak') {
        lineStart = true;
        return atom;
      }
      if (atom.type !== 'text') {
        lineStart = false;
        return atom;
      }
      const code = atom.marks?.some((mark) => mark.type === 'code');
      const text = atom.text
        .split(/(\r?\n)/)
        .map((part) => {
          if (/^\r?\n$/.test(part)) {
            lineStart = true;
            return part;
          }
          const value = lineStart && !code ? part.replace(/^[^\S\r\n]+/u, '') : part;
          if (value) lineStart = false;
          return value;
        })
        .join('');
      return { ...atom, text };
    });
  }
  function node(n, topLevel = false) {
    const a = n.attrs || {},
      children = () => (n.content || []).map((child) => node(child)).join('');
    if (n.type === 'text') {
      if (!n.text) return '';
      let value = escape(n.text);
      for (const mark of n.marks || []) {
        const syntax = { bold: '**', italic: '*', strike: '~~', highlight: '==' }[mark.type];
        if (syntax) value = syntax + value + syntax;
        if (mark.type === 'code') value = '`' + n.text.replaceAll('`', '\\`') + '`';
        if (mark.type === 'link' && /^(https?:|mailto:)/.test(mark.attrs?.href || ''))
          value = `[${value}](${mark.attrs.href.replace(/[()\s]/g, encodeURIComponent)})`;
      }
      return value;
    }
    if (n.type === 'hardBreak') return '\n';
    const prose = () =>
      topLevel && normalizeDiaryParagraphIndent
        ? paragraphContent(n.content)
            .map((child) => node(child))
            .join('')
        : children();
    if (n.type === 'paragraph') return prose() + '\n\n';
    if (n.type === 'heading') return '#'.repeat(a.level || 2) + ' ' + prose() + '\n\n';
    if (n.type === 'horizontalRule') return '\n---\n\n';
    if (n.type === 'blockquote')
      return (
        children()
          .trim()
          .split('\n')
          .map((line) => '> ' + line)
          .join('\n') + '\n\n'
      );
    if (n.type === 'codeBlock') {
      const value = (n.content || []).map((child) => child.text || '').join('');
      let fence = '```';
      while (value.includes(fence)) fence += '`';
      return fence + (a.language || '') + '\n' + value + '\n' + fence + '\n\n';
    }
    if (['image', 'video'].includes(n.type))
      return `[${n.type === 'image' ? '图片' : '视频'}${a.caption ? '：' + escape(a.caption) : ''}]\n\n`;
    if (['bulletList', 'orderedList', 'taskList'].includes(n.type))
      return (
        (n.content || [])
          .map((item, i) => {
            const prefix =
              n.type === 'orderedList'
                ? `${(a.start || 1) + i}. `
                : n.type === 'taskList'
                  ? `- [${item.attrs?.checked ? 'x' : ' '}] `
                  : '- ';
            return (
              prefix +
              (item.content || [])
                .map((child) => node(child))
                .join('')
                .trim()
                .replaceAll('\n', '\n  ')
            );
          })
          .join('\n') + '\n\n'
      );
    if (n.type === 'table') {
      const rows = (n.content || []).map(
        (row) =>
          '| ' +
          (row.content || [])
            .map((cell) =>
              (cell.content || [])
                .map((child) => node(child))
                .join('')
                .trim()
                .replaceAll('\n', ' '),
            )
            .join(' | ') +
          ' |',
      );
      if (rows.length)
        rows.splice(1, 0, '| ' + (n.content[0].content || []).map(() => '---').join(' | ') + ' |');
      return rows.join('\n') + '\n\n';
    }
    return children();
  }
  return (body?.content || [])
    .map((child) => node(child, true))
    .join('')
    .trim();
}
