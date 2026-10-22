import TurndownService from '../vendor/turndown.js';

const INDENT = '　　';

/** Convert a sanitized legacy fragment without discarding unsupported rich formatting. */
export function htmlToMarkdown(html) {
  const doc = new DOMParser().parseFromString(String(html ?? ''), 'text/html');
  doc.body.querySelectorAll('script,style,iframe,object,form').forEach((node) => node.remove());
  // Turndown treats ideographic spaces as trim-able whitespace. Protect diary indentation.
  let space = '\uE000';
  while (doc.body.innerHTML.includes(space)) space += '\uE000';
  const walker = doc.createTreeWalker(doc.body, 4);
  let text;
  while ((text = walker.nextNode())) text.nodeValue = text.nodeValue.replaceAll('　', space);
  const converter = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
    blankReplacement: (_content, node) =>
      /^(P|DIV)$/.test(node.nodeName) ? `\n\n${node.outerHTML}\n\n` : node.isBlock ? '\n\n' : '',
  });
  converter.keep(['table', 'u']);
  // A BR makes Turndown consider a paragraph nonblank, bypassing blankReplacement.
  // Keep these explicit spacer blocks too; whitespace-only Markdown would be discarded.
  converter.addRule('emptyParagraph', {
    filter: (node) =>
      /^(P|DIV)$/.test(node.nodeName) &&
      !node.textContent.trim() &&
      [...node.children].every((child) => child.nodeName === 'BR'),
    replacement: (_content, node) => `\n\n${node.outerHTML}\n\n`,
  });
  converter.addRule('legacyFormatting', {
    filter: (node) => !!node.style?.color || node.nodeName === 'FONT',
    replacement: (_content, node) => (node.isBlock ? `\n\n${node.outerHTML}\n\n` : node.outerHTML),
  });
  converter.addRule('strikethrough', {
    filter: ['s', 'strike', 'del'],
    replacement: (content) => `~~${content}~~`,
  });
  return converter.turndown(doc.body).replaceAll(space, '　');
}

function edit(from, to, insert, anchor = from + insert.length, head = anchor) {
  return { from, to, insert, selection: { anchor, head } };
}

/** Block fragments need Markdown boundaries even when pasted into the middle of prose. */
export function blockMarkdownEdit(source, from, to, insert) {
  const before = source.slice(0, from);
  const after = source.slice(to);
  const leading = (before.match(/\n*$/)?.[0].length || 0) + (insert.match(/^\n*/)?.[0].length || 0);
  const trailing = (insert.match(/\n*$/)?.[0].length || 0) + (after.match(/^\n*/)?.[0].length || 0);
  const prefix = before ? '\n'.repeat(Math.max(0, 2 - leading)) : '';
  const suffix = after ? '\n'.repeat(Math.max(0, 2 - trailing)) : '';
  return edit(from, to, prefix + insert + suffix, from + prefix.length + insert.length);
}

function wrap(source, from, to, before, after = before) {
  const selected = source.slice(from, to);
  const italic = before === '*' && after === '*';
  const selectedIsItalic =
    !italic ||
    ((selected.match(/^\*+/)?.[0].length || 0) % 2 === 1 &&
      (selected.match(/\*+$/)?.[0].length || 0) % 2 === 1);
  if (
    selected.length >= before.length + after.length &&
    selected.startsWith(before) &&
    selected.endsWith(after) &&
    selectedIsItalic
  ) {
    const content = selected.slice(before.length, -after.length);
    return edit(from, to, content, from, from + content.length);
  }
  if (
    source.slice(Math.max(0, from - before.length), from) === before &&
    source.slice(to, to + after.length) === after &&
    (!italic ||
      ((source.slice(0, from).match(/\*+$/)?.[0].length || 0) % 2 === 1 &&
        (source.slice(to).match(/^\*+/)?.[0].length || 0) % 2 === 1))
  ) {
    return edit(
      from - before.length,
      to + after.length,
      selected,
      from - before.length,
      to - before.length,
    );
  }
  return edit(from, to, before + selected + after, from + before.length, to + before.length);
}

function lines(source, from, to, transform) {
  const start = source.lastIndexOf('\n', from - 1) + 1;
  const selectedEnd = to > from && source[to - 1] === '\n' ? to - 1 : to;
  const newline = source.indexOf('\n', selectedEnd);
  const end = newline < 0 ? source.length : newline;
  const insert = transform(source.slice(start, end).split('\n')).join('\n');
  return edit(start, end, insert, start, start + insert.length);
}

function safeLink(value) {
  const url = String(value ?? '').trim();
  if (!/^(https?:\/\/|mailto:)/i.test(url) || /[\u0000-\u001f\u007f]/.test(url)) return null;
  return url.replace(/[\s<>"'()\\]/g, (char) =>
    encodeURIComponent(char).replace(/[()']/g, (c) => `%${c.charCodeAt(0).toString(16)}`),
  );
}

/** One transaction in UTF-16 offsets, matching CodeMirror's document positions. */
export function transformMarkdown(source, from, to, command, value) {
  source = String(source ?? '');
  from = Math.max(0, Math.min(source.length, Number.isFinite(from) ? from : 0));
  to = Math.max(from, Math.min(source.length, Number.isFinite(to) ? to : from));
  const selected = source.slice(from, to);
  switch (command) {
    case 'insertText':
      return edit(from, to, String(value ?? ''));
    case 'insertHorizontalRule':
      // A divider separates existing prose. A stale or multi-line selection
      // must never replace entire paragraphs with a single rule.
      return blockMarkdownEdit(source, to, to, '---');
    case 'insertHTML': {
      const html = String(value ?? '');
      const insert = htmlToMarkdown(html);
      return /<(?:p|div|h[1-6]|ul|ol|li|blockquote|pre|table|hr)\b/i.test(html) && insert
        ? blockMarkdownEdit(source, from, to, insert)
        : edit(from, to, insert);
    }
    case 'bold':
      return wrap(source, from, to, '**');
    case 'italic':
      return wrap(source, from, to, '*');
    case 'strikeThrough':
      return wrap(source, from, to, '~~');
    case 'underline':
      return wrap(source, from, to, '<u>', '</u>');
    case 'foreColor': {
      const color = String(value ?? '');
      if (!/^(#[0-9a-f]{3,8}|rgb\([0-9, ]+\))$/i.test(color)) return null;
      return wrap(source, from, to, `<span style="color:${color}">`, '</span>');
    }
    case 'createLink': {
      const url = safeLink(value);
      if (!url) return null;
      const label = selected || '链接';
      const escaped = label.replace(/(?<!\\)([\[\]])/g, '\\$1');
      return edit(from, to, `[${escaped}](<${url}>)`, from + 1, from + 1 + escaped.length);
    }
    case 'insertUnorderedList':
    case 'insertOrderedList':
      return lines(source, from, to, (rows) => {
        const ordered = command === 'insertOrderedList';
        const active = ordered ? /^\s*\d+[.)] / : /^\s*[-+*] /;
        const nonempty = rows.filter((row) => row.trim());
        const remove = nonempty.length > 0 && nonempty.every((row) => active.test(row));
        let number = 0;
        return rows.map((row) => {
          if (!row.trim() && rows.length > 1) return row;
          const content = row.replace(/^\s*(?:[-+*]|\d+[.)])\s+/, '').replace(/^　　/, '');
          if (remove) return content;
          return `${ordered ? `${++number}.` : '-'} ${content}`;
        });
      });
    case 'formatBlock': {
      const block = String(value ?? '')
        .toLowerCase()
        .replace(/[<>]/g, '');
      if (!/^(p|div|blockquote|h[1-6]|pre)$/.test(block)) return null;
      if (block === 'pre') return wrap(source, from, to, '```\n', '\n```');
      const prefix =
        block === 'blockquote' ? '> ' : /^h/.test(block) ? `${'#'.repeat(Number(block[1]))} ` : '';
      return lines(source, from, to, (rows) => {
        const remove = prefix && rows.every((row) => row.startsWith(prefix));
        return rows.map((row) => `${remove ? '' : prefix}${row.replace(/^(?:#{1,6}|>)\s+/, '')}`);
      });
    }
    case 'removeFormat': {
      if (!selected) return null;
      const text = selected
        .replace(
          /<(?:span|u|font|b|strong|i|em|s|strike)\b[^>]*>|<\/(?:span|u|font|b|strong|i|em|s|strike)>/gi,
          '',
        )
        .replace(/(\*\*|__|~~)([\s\S]*?)\1/g, '$2')
        .replace(
          /(?<!\*)\*([^*\n]+)\*(?!\*)|(?<!_)_([^_\n]+)_(?!_)/g,
          (_all, star, underscore) => star ?? underscore,
        )
        .replace(/^\s*(?:#{1,6}|>|[-+*]|\d+[.)])\s+/gm, '');
      return edit(from, to, text, from, from + text.length);
    }
    default:
      return null;
  }
}

function openFenceBefore(source, start) {
  let fence = null;
  let quoted = false;
  for (const row of source.slice(0, start).split('\n')) {
    // Recognize quoted/list fences too, so example text remains untouched.
    const unquoted = row.replace(/^(?: {0,3}>[ \t]?)+/, '');
    const content = fence
      ? quoted
        ? unquoted
        : row
      : unquoted.replace(/^ {0,3}(?:[-+*]|\d+[.)])[ \t]+/, '');
    const match = content.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (!match) continue;
    if (!fence) {
      if (match[1][0] !== '`' || !match[2].includes('`')) {
        fence = match[1];
        quoted = unquoted !== row;
      }
    } else if (
      match[1][0] === fence[0] &&
      match[1].length >= fence.length &&
      /^[ \t]*$/.test(match[2])
    ) {
      fence = null;
    }
  }
  return fence;
}

/** Repair only the active line on Enter, never normalize stored or pasted Markdown. */
export function markdownStructureEnter(source, from, to, enabled = true) {
  if (from !== to || from < 0 || from > source.length) return null;
  const start = source.lastIndexOf('\n', from - 1) + 1;
  const newline = source.indexOf('\n', start);
  const end = newline < 0 ? source.length : newline;
  if (from !== end || openFenceBefore(source, start)) return null;
  const original = source.slice(start, end);
  const prefixed = original.startsWith(INDENT);
  const line = prefixed ? original.slice(INDENT.length) : original;
  // Only the diary's exact two-space prefix can be repaired; ASCII code indentation stays literal.
  if (/^(?: {4}|\t|　)/.test(line)) return null;
  const paragraph = enabled ? INDENT : '';
  const thematic = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(line);
  if (thematic) {
    const previous =
      source
        .slice(0, Math.max(0, start - 1))
        .split('\n')
        .at(-1) || '';
    // In diary input, completing a thematic marker means a divider even when
    // auto-indent is off. Otherwise --- turns the preceding paragraph into a
    // Setext heading. This only handles the active Enter, never stored sources.
    // The automatic ideographic indent is not a Markdown blank line. Keep a
    // real empty line before a new rule, or it becomes an empty Setext heading.
    const leading = start && previous.length ? '\n' : '';
    return edit(start, end, `${leading}${line}\n\n${paragraph}`);
  }
  if (!prefixed) return null;
  const fence = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  if (fence && (fence[1][0] !== '`' || !fence[2].includes('`')))
    return edit(start, end, `${line}\n`);
  if (/^ {0,3}#{1,6}(?:[ \t]+|$)/.test(line)) return edit(start, end, `${line}\n${paragraph}`);
  const quote = line.match(/^( {0,3}(?:>[ \t]?)+)(.*)$/);
  if (quote) return edit(start, end, quote[2].trim() ? `${line}\n${quote[1]}` : paragraph);
  const list = line.match(/^( {0,3})([-+*]|\d+[.)])([ \t]+)(.*)$/);
  if (list) {
    if (!list[4].trim()) return edit(start, end, paragraph);
    const marker = /^\d/.test(list[2])
      ? `${Number.parseInt(list[2], 10) + 1}${list[2].at(-1)}`
      : list[2];
    const task = /^\[[ xX]\][ \t]+/.test(list[4]) ? '[ ] ' : '';
    // Ordered lists starting after 1 cannot interrupt prose without a blank line.
    const previous =
      source
        .slice(0, Math.max(0, start - 1))
        .split('\n')
        .at(-1) || '';
    const leading = start && previous.trim() ? '\n' : '';
    return edit(start, end, `${leading}${line}\n${list[1]}${marker}${list[3]}${task}`);
  }
  return null;
}

/** Leave Markdown's structured Enter handling to CodeMirror; indent ordinary diary prose. */
export function paragraphEnter(source, from, to, enabled = true) {
  if (!enabled || from !== to) return null;
  const before = source.slice(0, from);
  const start = before.lastIndexOf('\n') + 1;
  const end = source.indexOf('\n', from);
  const line = source.slice(start, end < 0 ? source.length : end);
  if (
    openFenceBefore(source, start) ||
    /^(?: {4}|\t| {0,3}(?:#{1,6}(?:\s|$)|>|[-+*]\s|\d+[.)]\s|`{3,}|~{3,}|<))/.test(line) ||
    /\|/.test(line) ||
    /^\s*(?:[-=*]_?\s*){3,}$/.test(line)
  )
    return null;
  return edit(from, to, `\n${source.slice(from).startsWith(INDENT) ? '' : INDENT}`);
}
