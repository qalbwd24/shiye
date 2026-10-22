import { dateTimeEdit } from '../shared/date-time-edit.js';

const ATOMIC = /^(IMG|VIDEO|AUDIO|HR|IFRAME|OBJECT|TABLE|UL|OL|PRE|BLOCKQUOTE|H[1-6])$/;
const BLOCK = /^(P|DIV)$/;

/** Logical offsets for one native paragraph. BRs count as newlines, media as occupied text. */
export function mapRichBlock(root) {
  const leaves = [];
  const collect = (node) => {
    if (node.nodeType === 3 || node.nodeName === 'BR') leaves.push(node);
    else if (
      node !== root &&
      (ATOMIC.test(node.nodeName) ||
        BLOCK.test(node.nodeName) ||
        node.getAttribute?.('contenteditable') === 'false')
    )
      leaves.push(node);
    else for (const child of node.childNodes || []) collect(child);
  };
  collect(root);
  // A terminal BR is the browser's empty-line/caret placeholder. A preceding BR
  // still represents a real newline (e.g. text<br><br> ends on an empty line).
  const last = leaves.findLast((node) => node.nodeType !== 3 || node.data.length);
  const placeholder = last?.nodeName === 'BR' ? last : null;
  const leafSet = new Set(leaves);
  const spans = new Map();
  const points = [];
  let source = '';
  const visit = (node) => {
    const from = source.length;
    if (node.nodeType === 3) {
      source += node.data;
      points.push({ node, from, to: source.length, text: true });
    } else if (node !== root && leafSet.has(node)) {
      const text = node.nodeName === 'BR' ? (node === placeholder ? '' : '\n') : '\uFFFC';
      source += text;
      points.push({ node, from, to: source.length, text: false });
    } else {
      const boundaries = [from];
      for (const child of node.childNodes || []) {
        visit(child);
        boundaries.push(source.length);
      }
      spans.set(node, { from, to: source.length, boundaries });
      return;
    }
    spans.set(node, { from, to: source.length });
  };
  visit(root);
  const siblingPoint = (node, after) => ({
    node: node.parentNode,
    offset: [...node.parentNode.childNodes].indexOf(node) + Number(after),
  });
  return {
    source,
    offsetAt(node, offset) {
      const span = spans.get(node);
      if (!span) return null;
      return node.nodeType === 3 ? span.from + offset : (span.boundaries?.[offset] ?? span.from);
    },
    pointAt(offset) {
      for (const point of points) {
        if (offset < point.from || offset > point.to) continue;
        if (point.text) return { node: point.node, offset: offset - point.from };
        return siblingPoint(point.node, offset > point.from);
      }
      return { node: root, offset: 0 };
    },
  };
}

function nonblankPreviousBlock(block) {
  let previous = block.previousSibling;
  // Ignore formatting whitespace between block elements, but preserve a real empty block.
  while (previous?.nodeType === 3 && !previous.data.trim()) previous = previous.previousSibling;
  return previous
    ? ATOMIC.test(previous.nodeName) ||
        previous.getAttribute?.('contenteditable') === 'false' ||
        !!mapRichBlock(previous).source.trim()
    : false;
}

/** Plan one native insertText operation; never serialize or replace surrounding rich HTML. */
export function richDateTimeInsertion(
  range,
  block,
  stamp,
  { indent = '　　', inline = false, includePreviousBlock = true } = {},
) {
  const target = range.cloneRange();
  if (!range.collapsed || inline) return { range: target, insert: stamp };
  const map = mapRichBlock(block);
  const cursor = map.offsetAt(range.startContainer, range.startOffset);
  if (cursor === null) return { range: target, insert: stamp };
  const prefix = includePreviousBlock && nonblankPreviousBlock(block) ? '\uFFFC\n' : '';
  const position = prefix.length + cursor;
  const edit = dateTimeEdit(prefix + map.source, position, position, stamp, { indent });
  const start = map.pointAt(Math.max(0, edit.from - prefix.length));
  const end = map.pointAt(Math.max(0, edit.to - prefix.length));
  // Adjacent inline wrappers can share one logical offset but different styles.
  // Keep the actual DOM caret whenever that side of the edit has not moved.
  if (edit.from !== position) target.setStart(start.node, start.offset);
  if (edit.to !== position) target.setEnd(end.node, end.offset);
  return { range: target, insert: edit.insert };
}
