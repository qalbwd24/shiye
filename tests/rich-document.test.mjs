import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { richExtensions } from '../public/editor/rich-document-editor.js';
import { MarkdownManager, getSchema } from '../public/vendor/rich-editor.js';
import {
  validateRichDocument,
  fromEditorJSON,
  toEditorJSON,
  richImageReferences,
  richMediaReferences,
  assertRichFieldsPreserved,
  prepareRichMarkdown,
} from '../public/shared/rich-document.js';

const extensions = richExtensions();
const manager = new MarkdownManager({ extensions });
const schema = getSchema(extensions);
const walk = (node) => [node, ...(node.content || []).flatMap(walk)];
const parse = (text) => fromEditorJSON(manager.parse(prepareRichMarkdown(text)));
function schemaRoundTrip(body) {
  const json = toEditorJSON(body);
  const node = schema.nodeFromJSON(json);
  node.check();
  const back = node.toJSON();
  assertRichFieldsPreserved(json, back);
  return fromEditorJSON(back);
}

test('real Markdown parser handles Chinese, spaces, nested marks, highlight and GFM structures', () => {
  const body = parse(
    '# 标题\n\n中文 **加粗** *斜体* _另一斜体_ __另一加粗__ ==高亮== ~~删除~~ `代码`\n\n> 引用\n\n1. 有序\n2. 第二项\n\n- 无序\n\n- [x] 完成\n- [ ] 未完成\n\n```js\nconst 中文 = 1;\n```\n\n|甲|乙|\n|---|---|\n|1|2|\n\n---\n\n[本地项目说明](https://example.com)',
  );
  const nodes = walk(toEditorJSON(schemaRoundTrip(body)));
  for (const type of [
    'heading',
    'blockquote',
    'orderedList',
    'bulletList',
    'taskList',
    'table',
    'codeBlock',
    'horizontalRule',
  ])
    assert.ok(
      nodes.some((n) => n.type === type),
      type,
    );
  for (const type of ['bold', 'italic', 'highlight', 'strike', 'code', 'link'])
    assert.ok(
      nodes.some((n) => n.marks?.some((m) => m.type === type)),
      type,
    );
  assert.equal(nodes.find((n) => n.text === '中文 ').text, '中文 ');
  const exported = manager.serialize(toEditorJSON(body));
  const reread = walk(toEditorJSON(schemaRoundTrip(parse(exported))));
  for (const type of ['italic', 'highlight', 'bold'])
    assert.ok(reread.some((n) => n.marks?.some((m) => m.type === type)));
});

test('document JSON retains stable block IDs and exact Unicode through save/reopen', () => {
  const body = parse('你好，拾页 👩🏽‍💻\n\n**不是合成实体** 和 空 格');
  const saved = JSON.parse(JSON.stringify(schemaRoundTrip(body)));
  assert.deepEqual(schemaRoundTrip(saved), saved);
  const ids = walk(toEditorJSON(saved))
    .filter((n) => n.type !== 'doc' && n.type !== 'text')
    .map((n) => n.attrs.blockId);
  assert.equal(ids.length, new Set(ids).size);
});

test('diary separators do not turn preceding prose into headings; fenced code remains exact', () => {
  const body = parse('前文\n第二行\n---\n后文');
  assert.equal(body.content[0].type, 'paragraph');
  assert.equal(body.content[1].type, 'horizontalRule');
  const code = '```text\n前文\n---\n```';
  assert.equal(prepareRichMarkdown(code), code);
  assert.equal(parse(code).content[0].type, 'codeBlock');
  assert.equal(parse('一级标题\n===\n').content[0].type, 'heading');
});

test('image bytes are separate from occurrences, width, caption and insertion time', () => {
  const bytes = Buffer.from('synthetic-image-original-bytes');
  const sha = createHash('sha256').update(bytes).digest('hex');
  const image = (occurrenceId) => ({
    type: 'image',
    attrs: {
      assetId: `sha256:${sha}`,
      occurrenceId,
      insertedAt: '2026-10-16T10:00:00.000Z',
      widthRatio: 0.75,
      align: 'center',
      caption: '中文图注',
      alt: '原图',
    },
  });
  const body = fromEditorJSON({
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: '图片之前' }] },
      image('one'),
      { type: 'paragraph', content: [{ type: 'text', text: '图片之后' }] },
      image('two'),
    ],
  });
  const back = schemaRoundTrip(body);
  const refs = richImageReferences(back);
  assert.equal(refs[0].assetId, refs[1].assetId);
  assert.notEqual(refs[0].occurrenceId, refs[1].occurrenceId);
  assert.equal(back.content[2].content[0].text, '图片之后');
  back.content[1].attrs.widthRatio = 0.4;
  back.content[1].attrs.align = 'right';
  const resized = schemaRoundTrip(back);
  assert.equal(resized.content[1].attrs.caption, '中文图注');
  assert.equal(resized.content[1].attrs.widthRatio, 0.4);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), sha);
  assert.match(manager.serialize(toEditorJSON(resized)), /shiye-asset:sha256:/);
});

test('unsupported versions, nodes, marks and schema attributes fail before replacement', () => {
  assert.throws(
    () => validateRichDocument({ format: 'shiye-richdoc', version: 2, content: [] }),
    /版本/,
  );
  assert.throws(() => parse('![远程图片](https://example.com/a.png)'), /本地图片/);
  const body = parse('原文');
  const original = structuredClone(body);
  body.content[0].type = 'futureColumns';
  assert.throws(() => validateRichDocument(body), /暂不支持/);
  body.content[0] = structuredClone(original.content[0]);
  body.content[0].content[0].marks = [{ type: 'futureMark' }];
  assert.throws(() => validateRichDocument(body), /暂不支持/);
  body.content[0] = structuredClone(original.content[0]);
  body.content[0].attrs.futurePosition = 'must not disappear';
  assert.throws(() => schemaRoundTrip(body), /futurePosition/);
  assert.equal(original.content[0].content[0].text, '原文');
});

test('unsafe links and duplicate image occurrence IDs are rejected', () => {
  const body = parse('原文');
  body.content[0].content[0].marks = [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }];
  assert.throws(() => validateRichDocument(body), /不安全/);
  const a = {
    assetId: 'sha256:abc',
    occurrenceId: 'same',
    insertedAt: null,
    widthRatio: 1,
    align: 'left',
    caption: '',
    alt: '',
  };
  assert.throws(
    () =>
      fromEditorJSON({
        type: 'doc',
        content: [
          { type: 'image', attrs: a },
          { type: 'image', attrs: a },
        ],
      }),
    /出现位置/,
  );
});

test('video nodes extend richdoc v1 without changing image references or losing media identity', () => {
  const attrs = {
    assetId: 'local-video',
    occurrenceId: 'video-one',
    insertedAt: null,
    widthRatio: 0.6,
    align: 'right',
    caption: '虚构视频图注',
    alt: '视频说明',
  };
  const body = fromEditorJSON({
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: '正文前后保留🙂' }] },
      { type: 'video', attrs },
      { type: 'image', attrs: { ...attrs, assetId: 'local-image', occurrenceId: 'image-one' } },
    ],
  });
  const original = structuredClone(body);
  const back = schemaRoundTrip(body);
  assert.deepEqual(
    richMediaReferences(back).map((item) => item.type),
    ['video', 'image'],
  );
  assert.equal(richMediaReferences(back)[0].insertedAt, null);
  assert.equal(richMediaReferences(back)[0].caption, attrs.caption);
  assert.equal(richImageReferences(back).length, 1);
  assert.equal(richImageReferences(back)[0].assetId, 'local-image');
  assert.deepEqual(body, original);
  assert.throws(() => manager.serialize(toEditorJSON(body)), /视频.*富文档/);
  const duplicate = structuredClone(body);
  duplicate.content[2].attrs.occurrenceId = 'video-one';
  assert.throws(() => validateRichDocument(duplicate), /出现位置/);
  const arbitrary = structuredClone(body);
  arbitrary.content[1].attrs.autoplay = true;
  assert.throws(() => schemaRoundTrip(arbitrary), /autoplay/);
});
