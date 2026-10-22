// Serializable legacy-HTML selection points. No retained DOM nodes or Range.
const atomic = (node) =>
  node.nodeType === 1 && /^(BR|IMG|HR|VIDEO|AUDIO|IFRAME|OBJECT)$/.test(node.nodeName);
const length = (node) =>
  node.nodeType === 3
    ? node.data.length
    : atomic(node)
      ? 1
      : [...node.childNodes].reduce((sum, child) => sum + length(child), 0);
function logicalOffset(host, node, offset) {
  let result =
    node.nodeType === 3
      ? offset
      : [...node.childNodes].slice(0, offset).reduce((sum, child) => sum + length(child), 0);
  while (node !== host) {
    const parent = node.parentNode;
    if (!parent) return null;
    for (const sibling of parent.childNodes) {
      if (sibling === node) break;
      result += length(sibling);
    }
    node = parent;
  }
  return result;
}
function point(host, node, offset) {
  if (!node || !host.contains(node)) return null;
  const path = [];
  let target = node;
  while (target !== host) {
    path.unshift([...target.parentNode.childNodes].indexOf(target));
    target = target.parentNode;
  }
  return { path, offset, textOffset: logicalOffset(host, node, offset), nodeType: node.nodeType };
}
export function captureDOMResumePosition(host) {
  const selection = host.ownerDocument.getSelection();
  const anchor = point(host, selection?.anchorNode, selection?.anchorOffset);
  const head = point(host, selection?.focusNode, selection?.focusOffset);
  return anchor && head ? { anchor, head } : null;
}
function resolve(host, saved) {
  if (!saved || !Number.isFinite(saved.offset) || !Number.isFinite(saved.textOffset)) return null;
  let node = host;
  if (Array.isArray(saved.path)) {
    for (const index of saved.path) {
      if (!Number.isSafeInteger(index) || index < 0 || !node.childNodes[index]) {
        node = null;
        break;
      }
      node = node.childNodes[index];
    }
    const max = node?.nodeType === 3 ? node.data.length : node?.childNodes.length;
    if (
      node?.nodeType === saved.nodeType &&
      saved.offset >= 0 &&
      saved.offset <= max &&
      logicalOffset(host, node, saved.offset) === saved.textOffset
    )
      return { node, offset: Math.trunc(saved.offset) };
  }
  let remaining = Math.max(0, Math.min(length(host), Math.trunc(saved.textOffset)));
  function visit(target) {
    if (target.nodeType === 3)
      return { node: target, offset: Math.min(target.data.length, remaining) };
    for (let i = 0; i < target.childNodes.length; i++) {
      const child = target.childNodes[i],
        size = length(child);
      if (remaining <= size) {
        if (atomic(child)) return { node: target, offset: i + Number(remaining > 0) };
        return visit(child);
      }
      remaining -= size;
    }
    return { node: target, offset: target.childNodes.length };
  }
  return visit(host);
}
export function restoreDOMResumePosition(host, saved) {
  const anchor = resolve(host, saved?.anchor),
    head = resolve(host, saved?.head);
  if (!anchor || !head) return false;
  const selection = host.ownerDocument.getSelection();
  if (!selection) return false;
  selection.setBaseAndExtent(anchor.node, anchor.offset, head.node, head.offset);
  return true;
}
