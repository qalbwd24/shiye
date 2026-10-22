import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertLegacyEntry } from '../tools/lib/legacy-content-converter.mjs';
import { getSchema } from '../public/vendor/rich-editor.js';
import { richExtensions } from '../public/editor/rich-document-editor.js';
import {
  validateRichDocument,
  toEditorJSON,
  assertRichFieldsPreserved,
} from '../public/shared/rich-document.js';

const schema = getSchema(richExtensions());
const walk = (node) => [node, ...(node.content || []).flatMap(walk)];
const nodes = (result) => result.body.content.flatMap(walk);
const text = (node) =>
  node.type === 'hardBreak' ? '\n' : node.text || (node.content || []).map(text).join('');
function checked(entry, options) {
  const result = convertLegacyEntry(entry, options);
  validateRichDocument(result.body);
  const json = toEditorJSON(result.body);
  const parsed = schema.nodeFromJSON(json);
  parsed.check();
  assertRichFieldsPreserved(json, parsed.toJSON());
  return result;
}

test('legacy HTML preserves exact spaces, full-width indentation, blank paragraphs, breaks and formatting', () => {
  const content =
    '<p>　　开头  空格&nbsp;<br>第二行\n第三行 <strong>粗<b>体</b></strong><em>斜</em><u>线</u><mark>亮</mark><s>删</s></p><p></p><hr><h3>标题</h3>';
  const result = checked({ id: 'synthetic-html', content });
  assert.equal(text(result.body.content[0]), '　　开头  空格\u00a0\n第二行\n第三行 粗体斜线亮删');
  assert.equal(result.body.content[1].type, 'paragraph');
  assert.equal(result.body.content[1].content, undefined);
  assert.equal(result.body.content[2].type, 'horizontalRule');
  assert.equal(result.body.content[3].attrs.level, 3);
  for (const type of ['bold', 'italic', 'underline', 'highlight', 'strike'])
    assert.ok(nodes(result).some((item) => item.marks?.some((mark) => mark.type === type)));
  assert.deepEqual(result.issues, []);
});

test('trusted Markdown uses saved rendering and preserves its soft line breaks and separators', () => {
  const content = '<p>前文\n第二行</p><hr><p>后文</p>';
  const result = checked({
    id: 'synthetic-md',
    content,
    markdownHtml: content,
    markdownSource: '前文\n第二行\n---\n后文',
  });
  assert.equal(result.provenance.sourceFormat, 'markdown');
  assert.equal(text(result.body.content[0]), '前文\n第二行');
  assert.equal(result.body.content[1].type, 'horizontalRule');
  assert.ok(!nodes(result).some((item) => item.type === 'heading'));
  const untrusted = checked({
    id: 'synthetic-untrusted',
    content: '<p>当前正文</p>',
    markdownHtml: content,
    markdownSource: '过期',
  });
  assert.equal(untrusted.provenance.sourceFormat, 'html');
  assert.equal(text(untrusted.body.content[0]), '当前正文');
});

test('attachments retain original sequence and file descriptions while repeated image appearances stay distinct', () => {
  const media = [
    { id: 'one', type: 'image/png', name: '一.png' },
    { id: 'pdf', type: 'application/pdf', name: '材料.pdf', custom: { keep: true } },
    { id: 'two', type: 'image/jpeg', name: '二.jpg' },
  ];
  const result = checked(
    {
      id: 'synthetic-assets',
      attachments: ['two', 'pdf', 'one', 'two'],
      content: '<p>前<img src="/media/two" alt="文中图">中<img src="/media/two">后</p>',
    },
    { media },
  );
  assert.deepEqual(
    result.attachmentPlacements.map((item) => item.assetId),
    ['two', 'pdf', 'one', 'two'],
  );
  assert.deepEqual(
    result.attachmentPlacements.map((item) => item.sourceIndex),
    [0, 1, 2, 3],
  );
  assert.equal(result.attachmentPlacements[1].blockId, null);
  assert.equal(result.attachmentPlacements[1].description.custom.keep, true);
  assert.ok(result.issues.some((item) => item.code === 'non-image-attachment-body-unsupported'));
  const images = nodes(result).filter((item) => item.type === 'image');
  assert.deepEqual(
    images.map((item) => item.attrs.assetId),
    ['two', 'one', 'two', 'two', 'two'],
  );
  assert.equal(new Set(images.map((item) => item.attrs.occurrenceId)).size, 5);
  assert.ok(
    images.every(
      (item) =>
        item.attrs.insertedAt === null &&
        item.attrs.widthRatio === 0.75 &&
        item.attrs.align === 'center' &&
        item.attrs.caption === '',
    ),
  );
  assert.equal(images[0].attrs.alt, '二.jpg');
  assert.equal(images[3].attrs.alt, '文中图');
});

test('conversion retries are fully deterministic and never mutate source, media, global DOM or console', () => {
  const entry = {
    id: 'synthetic-stable',
    revision: 7,
    content: '<p>文字<br>换行</p>',
    attachments: ['image'],
  };
  const media = [{ id: 'image', type: 'image/png', name: '图片.png' }];
  const before = structuredClone({ entry, media });
  const oldDocument = globalThis.document;
  const oldConsole = console.warn;
  const first = checked(entry, { media });
  assert.deepEqual(checked(entry, { media }), first);
  assert.deepEqual({ entry, media }, before);
  assert.equal(globalThis.document, oldDocument);
  assert.equal(console.warn, oldConsole);
  assert.notEqual(
    first.body.content[0].attrs.blockId,
    checked({ ...entry, id: 'another' }, { media }).body.content[0].attrs.blockId,
  );
});

test('nested lists, quotes, code, safe links, semantic styles and tables remain schema-valid', () => {
  const result = checked({
    id: 'synthetic-complex',
    content:
      '<blockquote><p>引文</p></blockquote><ol start="3"><li>第一<ul><li>嵌套</li></ul></li><li>第二</li></ol>' +
      '<pre><code class="language-js">  const a = 1;\n\n---\n</code></pre>' +
      '<p style="font-weight:bold">粗 <span style="font-style:italic;text-decoration:underline">斜线</span> <a href="https://example.com">链接</a></p>' +
      '<table><tbody><tr><th colspan="2">表头</th></tr><tr><td>甲<br>乙</td><td><p>丙</p></td></tr></tbody></table>',
  });
  assert.equal(result.body.content[1].attrs.start, 3);
  assert.equal(
    text(nodes(result).find((item) => item.type === 'codeBlock')),
    '  const a = 1;\n\n---\n',
  );
  assert.equal(nodes(result).find((item) => item.type === 'codeBlock').attrs.language, 'js');
  assert.equal(nodes(result).find((item) => item.type === 'tableHeader').attrs.colspan, 2);
  assert.equal(text(nodes(result).find((item) => item.type === 'tableCell')), '甲\n乙');
  assert.deepEqual(result.issues, []);
});

test('missing media, external images and unrepresentable styles produce explicit issues without fetching or fake images', () => {
  const result = checked(
    {
      id: 'synthetic-unknown',
      attachments: ['absent', 'audio'],
      content:
        '<p style="color:red;text-align:right"><font color="red">文字</font><img src="https://invalid.example/image" alt="外链原描述"><img src="/media/lost" alt="缺图原描述"></p>' +
        '<script>globalThis.converterExecuted = true</script><p><a href="javascript:alert(1)">不安全</a></p>',
    },
    { media: [{ id: 'audio', type: 'audio/ogg', name: '声音.ogg' }] },
  );
  assert.equal(nodes(result).filter((item) => item.type === 'image').length, 0);
  assert.equal(result.attachmentPlacements[0].kind, 'missing');
  assert.equal(result.attachmentPlacements[1].kind, 'audio');
  assert.equal(result.provenance.unresolvedImages.length, 2);
  for (const code of [
    'missing-attachment-media',
    'non-image-attachment-body-unsupported',
    'unsupported-style',
    'unsupported-element',
    'unsupported-image-source',
    'unresolved-inline-media',
    'inert-content-omitted',
    'unsupported-link',
  ])
    assert.ok(
      result.issues.some((item) => item.code === code),
      code,
    );
  assert.equal(globalThis.converterExecuted, undefined);
  assert.ok(text(result.body.content[0]).includes('外链原描述缺图原描述'));
});

test('nested mark order is canonical and code incompatibilities are reported rather than silently accepted', () => {
  const result = checked({
    id: 'synthetic-mark-order',
    content:
      '<p><em><strong><a href="https://example.com">混合</a></strong></em> <b><code>code</code></b></p>',
  });
  const mixed = nodes(result).find((item) => item.text === '混合');
  assert.deepEqual(
    mixed.marks.map((mark) => mark.type),
    ['link', 'bold', 'italic'],
  );
  assert.deepEqual(nodes(result).find((item) => item.text === 'code').marks, [{ type: 'code' }]);
  assert.ok(result.issues.some((item) => item.code === 'incompatible-code-marks'));
});

test('block-container markup indentation creates no extra paragraphs while explicit blanks and inline spaces survive', () => {
  const result = checked({
    id: 'synthetic-block-whitespace',
    content:
      '<blockquote>\n<p>x</p>\n</blockquote>' +
      '<div>\n<p></p>\n<p><br></p>\n</div>' +
      '<ul><li>\n<p>列表</p>\n</li></ul>' +
      '<p> <strong>中间</strong> 空格 </p><div>　　</div>',
  });
  assert.equal(result.body.content[0].type, 'blockquote');
  assert.deepEqual(
    result.body.content[0].content.map((item) => item.type),
    ['paragraph'],
  );
  assert.equal(text(result.body.content[0]), 'x');
  assert.equal(result.body.content[1].type, 'paragraph');
  assert.equal(result.body.content[1].content, undefined);
  assert.equal(result.body.content[2].content[0].type, 'hardBreak');
  const listItem = nodes(result).find((item) => item.type === 'listItem');
  assert.equal(listItem.content.length, 1);
  assert.equal(text(listItem), '列表');
  assert.equal(text(result.body.content[4]), ' 中间 空格 ');
  assert.equal(text(result.body.content[5]), '　　');
  assert.deepEqual(result.issues, []);
});
