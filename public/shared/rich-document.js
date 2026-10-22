// Stage-one content subset. This module never reads or writes the diary library.
import { LIMITS } from './limits.js';
export const RICHDOC_VERSION = 1;
// Diary convention: a standalone --- separates prose instead of enlarging it.
// Keep fenced code intact; the untouched Markdown source remains an input, not the authority.
export function prepareRichMarkdown(value) {
  const lines = String(value).replaceAll('\r\n', '\n').split('\n');
  const result = [];
  let fence = null;
  for (const line of lines) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      result.push(line);
      if (
        marker &&
        marker[1][0] === fence.char &&
        marker[1].length >= fence.length &&
        !marker[2].trim()
      )
        fence = null;
      continue;
    }
    if (marker) fence = { char: marker[1][0], length: marker[1].length };
    if (/^ {0,3}-{3,}[ \t]*$/.test(line) && result.at(-1)?.trim()) result.push('');
    result.push(line);
  }
  return result.join('\n');
}
export const richNodeTypes = Object.freeze([
  'paragraph',
  'heading',
  'blockquote',
  'bulletList',
  'orderedList',
  'listItem',
  'taskList',
  'taskItem',
  'codeBlock',
  'horizontalRule',
  'hardBreak',
  'text',
  'table',
  'tableRow',
  'tableCell',
  'tableHeader',
  'image',
  'video',
]);
const marks = new Set(['bold', 'italic', 'highlight', 'strike', 'code', 'underline', 'link']);
const nodes = new Set(richNodeTypes);
export function safeRichLink(value) {
  return typeof value === 'string' && /^(https?:\/\/|mailto:)/i.test(value.trim());
}
export function validateRichDocument(body) {
  if (body?.format !== 'shiye-richdoc' || body.version !== 1 || !Array.isArray(body.content))
    throw new Error('无法编辑此文档格式或版本；原件未改变。');
  if (Object.keys(body).some((key) => !['format', 'version', 'content'].includes(key)))
    throw new Error('文档含未知字段，须保留原件。');
  const blockIds = new Set();
  const occurrences = new Set();
  let count = 0;
  const visit = (node, depth) => {
    if (++count > LIMITS.richDocumentNodes || depth > LIMITS.richDocumentDepth)
      throw new Error('文档过大或嵌套过深。');
    if (!node || !nodes.has(node.type)) throw new Error(`暂不支持的内容块：${node?.type}`);
    if (
      Object.keys(node).some((key) => !['type', 'attrs', 'content', 'text', 'marks'].includes(key))
    )
      throw new Error('内容含未知字段，须保留原件。');
    if (node.type === 'text' && typeof node.text !== 'string') throw new Error('文字块无效。');
    if (node.type !== 'text') {
      const id = node.attrs?.blockId;
      if (typeof id !== 'string' || !id || blockIds.has(id))
        throw new Error('内容块 ID 缺失或重复。');
      blockIds.add(id);
    }
    if (node.type === 'image' || node.type === 'video') {
      const a = node.attrs;
      if (!/^[\w:-]+$/.test(a.assetId || '') || !a.occurrenceId || occurrences.has(a.occurrenceId))
        throw new Error('图片文件或出现位置 ID 无效。');
      occurrences.add(a.occurrenceId);
      if (
        !Number.isFinite(a.widthRatio) ||
        a.widthRatio < 0.1 ||
        a.widthRatio > 1 ||
        !['left', 'center', 'right'].includes(a.align)
      )
        throw new Error('图片排版参数无效。');
      if (typeof a.caption !== 'string' || typeof a.alt !== 'string')
        throw new Error('图片图注或替代文本无效。');
      if (
        a.insertedAt !== null &&
        (!/^\d{4}-\d\d-\d\dT.*Z$/.test(a.insertedAt || '') ||
          !Number.isFinite(Date.parse(a.insertedAt)))
      )
        throw new Error('图片时间须为 UTC，未知旧时间须为 null。');
    }
    if (node.marks !== undefined && !Array.isArray(node.marks)) throw new Error('格式列表无效。');
    const seenMarks = new Set();
    for (const mark of node.marks || []) {
      if (
        !mark ||
        Object.keys(mark).some((key) => !['type', 'attrs'].includes(key)) ||
        seenMarks.has(mark.type)
      )
        throw new Error('格式含未知字段或重复项，须保留原件。');
      seenMarks.add(mark.type);
      if (!marks.has(mark.type)) throw new Error(`暂不支持的格式：${mark.type}`);
      if (mark.type === 'link' && !safeRichLink(mark.attrs?.href))
        throw new Error('不安全的链接。');
    }
    if (node.content && !Array.isArray(node.content)) throw new Error('内容块结构无效。');
    for (const child of node.content || []) visit(child, depth + 1);
  };
  for (const node of body.content) visit(node, 0);
  return body;
}
export function assertRichFieldsPreserved(before, after) {
  if (!after || before.type !== after.type || before.text !== after.text)
    throw new Error('编辑器无法完整保留内容，原件未改变。');
  for (const [key, value] of Object.entries(before.attrs || {}))
    if (JSON.stringify(after.attrs?.[key]) !== JSON.stringify(value))
      throw new Error(`暂不支持属性 ${key}，原件未改变。`);
  if (
    (before.content?.length || 0) !== (after.content?.length || 0) ||
    (before.marks?.length || 0) !== (after.marks?.length || 0)
  )
    throw new Error('编辑器无法完整保留内容结构。');
  (before.content || []).forEach((node, i) => assertRichFieldsPreserved(node, after.content[i]));
  for (const mark of before.marks || []) {
    const other = after.marks.find((item) => item.type === mark.type);
    if (!other) throw new Error('编辑器无法保留格式。');
    assertRichFieldsPreserved(mark, other);
  }
}
export function fromEditorJSON(doc, idFactory = () => crypto.randomUUID()) {
  if (doc?.type !== 'doc' || !Array.isArray(doc.content)) throw new Error('编辑器文档无效。');
  // JSON documents are trees. Break any object aliases supplied by in-memory callers.
  const copy = JSON.parse(JSON.stringify(doc.content));
  const seen = new Set();
  const visit = (node) => {
    if (node.type !== 'text') {
      node.attrs ||= {};
      if (!node.attrs.blockId || seen.has(node.attrs.blockId)) node.attrs.blockId = idFactory();
      seen.add(node.attrs.blockId);
    }
    for (const child of node.content || []) visit(child);
  };
  copy.forEach(visit);
  return validateRichDocument({ format: 'shiye-richdoc', version: 1, content: copy });
}
export function toEditorJSON(body) {
  validateRichDocument(body);
  return { type: 'doc', content: structuredClone(body.content) };
}
export function richImageReferences(body) {
  validateRichDocument(body);
  const result = [];
  const visit = (node) => {
    if (node.type === 'image') result.push({ ...node.attrs });
    (node.content || []).forEach(visit);
  };
  body.content.forEach(visit);
  return result;
}

/** All inline-body resource appearances, in document order; image API stays compatible. */
export function richMediaReferences(body) {
  validateRichDocument(body);
  const result = [];
  const visit = (node) => {
    if (node.type === 'image' || node.type === 'video')
      result.push({ ...node.attrs, type: node.type });
    (node.content || []).forEach(visit);
  };
  body.content.forEach(visit);
  return result;
}
