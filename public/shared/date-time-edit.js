/** A single editor transaction: inline within a sentence, a new block at its end. */
export function dateTimeEdit(source, from, to, stamp, { indent = '　　', inline = false } = {}) {
  const lineStart = from === 0 ? 0 : source.lastIndexOf('\n', from - 1) + 1;
  let lineEnd = source.indexOf('\n', to);
  if (lineEnd < 0) lineEnd = source.length;
  const edit = (start, end, insert) => ({
    from: start,
    to: end,
    insert,
    selection: { anchor: start + insert.length },
  });
  if (inline || from !== to || source.slice(to, lineEnd).trim()) return edit(from, to, stamp);
  if (source.slice(lineStart, lineEnd).trim())
    return edit(from, lineEnd, '\n\n' + indent + stamp + '\n' + indent);
  // Reuse an empty/indent-only current line, keeping one blank separator after prose.
  const prefix = source.slice(0, lineStart);
  const separator = prefix.trim() && !/\n[\t \u3000]*\n$/.test(prefix) ? '\n' : '';
  return edit(lineStart, lineEnd, separator + indent + stamp + '\n' + indent);
}
