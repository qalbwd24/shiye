import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorState, markdown, markdownLanguage } from '../public/vendor/codemirror.js';
import { buildLivePreviewDecorations, previewMediaURL } from '../public/editor/live-preview.js';

function presentation(source, { cursor = 0, focus = false, resolveMedia, visibleRanges } = {}) {
  const state = EditorState.create({
    doc: source,
    selection: { anchor: cursor },
    extensions: [markdown({ base: markdownLanguage })],
  });
  const decorations = buildLivePreviewDecorations(
    { state, hasFocus: focus, visibleRanges: visibleRanges || [{ from: 0, to: source.length }] },
    { resolveMedia },
  );
  const result = [];
  for (const cursor = decorations.iter(); cursor.value; cursor.next()) {
    result.push({ from: cursor.from, to: cursor.to, spec: cursor.value.spec });
  }
  assert.equal(state.doc.toString(), source, 'Preview never changes the Markdown source');
  return result;
}

test('live preview styles Markdown and hides inactive inline syntax only', () => {
  const source = '# 标题\n**重点**、*斜体*、`code`\n[链接](https://example.com)\n正文';
  const result = presentation(source, { focus: true, cursor: source.length });
  assert.ok(result.some(({ spec }) => spec.class === 'md-heading md-heading-1'));
  assert.ok(result.some(({ spec }) => spec.class === 'md-strong'));
  assert.ok(result.some(({ spec }) => spec.class === 'md-emphasis'));
  assert.ok(result.some(({ spec }) => spec.class === 'md-inline-code'));
  assert.ok(result.some(({ spec }) => spec.class === 'md-link'));
  const hidden = result.filter(({ spec }) => !spec.class && !spec.widget);
  assert.ok(hidden.some(({ from, to }) => source.slice(from, to) === '**'));
  assert.ok(hidden.some(({ from, to }) => source.slice(from, to) === '`'));
  assert.ok(hidden.some(({ from, to }) => source.slice(from, to) === 'https://example.com'));
  for (const { from, to } of hidden) assert.ok(!source.slice(from, to).includes('\n'));
});

test('active line exposes markers, escaped syntax and fenced code are not stripped', () => {
  const source = '**正在输入**\n\\*原样\\*\n```js\nconst bold = "**text**";\n```';
  const result = presentation(source, { focus: true, cursor: 4 });
  assert.ok(!result.some(({ from, spec }) => from < source.indexOf('\n') && !spec.class));
  assert.ok(result.some(({ spec }) => spec.class === 'md-code-line'));
  assert.ok(!result.some(({ from, to, spec }) => !spec.class && source.slice(from, to) === '```'));
});

test('only explicitly resolved local media becomes an image; remote source stays visible', () => {
  const source = '![本地图](/media/local-image)\n![远程](https://remote.invalid/pixel.gif)';
  const resolveMedia = (url) => (url.startsWith('/media/') ? url : null);
  const result = presentation(source, { resolveMedia });
  const widgets = result.filter(({ spec }) => spec.widget);
  assert.equal(widgets.length, 1);
  assert.equal(widgets[0].spec.widget.src, '/media/local-image');
  assert.ok(!result.some(({ from }) => from >= source.indexOf('\n') + 1));
  assert.equal(presentation(source, { focus: true, cursor: 5, resolveMedia }).length, 0);
  for (const bad of [
    'https://remote.invalid/a',
    '//remote.invalid/a',
    '/media/../secret',
    'data:image/svg+xml,x',
  ]) {
    assert.equal(
      previewMediaURL('input', () => bad),
      null,
    );
  }
});

test('separated visible ranges still style children of their common parent', () => {
  const source = '> **first**\n> body\n> **last**';
  const result = presentation(source, {
    visibleRanges: [
      { from: 0, to: 10 },
      { from: 18, to: source.length },
    ],
  });
  assert.equal(result.filter(({ spec }) => spec.class === 'md-strong').length, 2);
});

test('task items have static checked state and expose editable source on their active line', () => {
  const source = '- [x] done\n- [ ] later';
  const result = presentation(source);
  assert.deepEqual(
    result.filter(({ spec }) => spec.widget).map(({ spec }) => spec.widget.checked),
    [true, false],
  );
  const active = presentation(source, { focus: true, cursor: 3 });
  assert.ok(active.some(({ spec }) => spec.class === 'md-task-marker'));
  assert.equal(active.filter(({ spec }) => spec.widget).length, 1);
});

test('date-time brackets and unresolved link references remain visible text', () => {
  const source = '[2026/09/22  01:10:58]\n[普通备注]\n[text][missing]';
  const result = presentation(source);
  assert.ok(!result.some(({ spec }) => !spec.class));
  assert.ok(!result.some(({ spec }) => spec.class === 'md-link'));
});

test('toolbar underline and safe color HTML become text decorations outside active lines', () => {
  const source =
    '<u>下划线</u>\n<span style="color:#aabbcc">色彩</span>\n<span style="color: rgb(12, 34, 56);">RGB</span>';
  const result = presentation(source);
  assert.ok(result.some(({ spec }) => spec.class === 'md-underline'));
  const colors = result.filter(({ spec }) => spec.class === 'md-custom-color');
  assert.deepEqual(
    colors.map(({ spec }) => spec.attributes.style),
    ['color:#aabbcc', 'color:rgb(12, 34, 56)'],
  );
  assert.equal(result.filter(({ spec }) => !spec.class).length, 6);
  const active = presentation(source, { focus: true, cursor: 4 });
  assert.ok(!active.some(({ from, spec }) => from < source.indexOf('\n') && !spec.class));
});

test('HTML bridge preserves code examples, unsupported tags and unsafe color attributes as source', () => {
  const source =
    '`<u>code</u>`\n```html\n<span style="color:#fff">code</span>\n```\n<span style="color:url(https://invalid)">bad</span>\n<span style="color:#fff;background:url(x)">bad</span>\n<u onclick="x">bad</u>\n<span style="color:rgb(999,0,0)">bad</span>';
  const result = presentation(source);
  assert.ok(!result.some(({ spec }) => ['md-underline', 'md-custom-color'].includes(spec.class)));
});
