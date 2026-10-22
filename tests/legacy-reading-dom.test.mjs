import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legacyReadingRoot } from '../src/server/domain/legacy-reading-dom.mjs';
import { convertLegacyReadingEntry } from '../src/server/domain/legacy-reading-converter.mjs';
import { convertLegacyEntry } from '../tools/lib/legacy-content-converter.mjs';
import { sanitizeLegacyReadingHTML } from '../src/server/domain/legacy-reading-html.mjs';

test('legacy parsing has no browsing context and conversion stays detached and inert', () => {
  const root = legacyReadingRoot('<script>globalThis.shouldNotRun=1</script><p>中文</p>');
  assert.equal(root.ownerDocument.defaultView, null);
  assert.equal(root.isConnected, false);
  assert.equal(globalThis.shouldNotRun, undefined);
  assert.equal(legacyReadingRoot('<p>独立</p>').textContent, '独立');
  assert.equal(root.querySelector('p').textContent, '中文');
});

test('runtime DOM conversion matches frozen converter text, marks, IDs, layout and source hashes', () => {
  const media = [{ id: 'image', type: 'image/png', name: '图片' }];
  for (const content of [
    '<p>　　中文  &nbsp;<br>换行\n文字<strong>粗体</strong><em>斜体</em><mark>高亮</mark></p><p></p><hr>',
    '<table><tr><th>A</th><td rowspan="2">B</td></tr><tr><td>C</td></tr></table>',
    '<p>[2025/10/19 12:00:00]</p><ul><li>甲<ol start="2"><li>乙</li></ol></li></ul><pre><code class="language-js">let a=1;</code></pre>',
    '<details><summary>摘要</summary>内容</details><p style="font-weight:700;color:red">保留<strong>格式</strong></p><img src="/media/image">',
    '<script>alert(1)</script><iframe src="https://example.invalid"></iframe><p onclick="bad()"><a href="javascript:bad()">正文</a></p>',
    '<p>不完整 <b>标签<p>第二段 &amp; emoji😀',
  ]) {
    const entry = { id: 'synthetic-compat', content, attachments: ['image'] };
    const before = structuredClone(entry);
    const old = convertLegacyEntry(entry, { media });
    const current = convertLegacyReadingEntry(entry, { media });
    assert.deepEqual(current.body, old.body);
    assert.deepEqual(current.issues, old.issues);
    assert.deepEqual(current.attachmentPlacements, old.attachmentPlacements);
    assert.equal(current.provenance.sourceHash, old.provenance.sourceHash);
    assert.deepEqual(entry, before);
  }
});

test('sanitizer preserves disclosures/media/styles and removes active content after repeated parses', () => {
  for (let i = 0; i < 3; i++) {
    const { html } = sanitizeLegacyReadingHTML(
      '<details open><summary>摘要</summary><p style="text-indent:2em" onclick="bad()">正文</p><img src="/media/i"><video src="/media/v"></video><script>bad()</script><img src="https://example.invalid/x"></details>',
      [{ id: 'i' }, { id: 'v' }],
    );
    assert.match(html, /<details open/);
    assert.match(html, /text-indent:2em/);
    assert.match(html, /src="\/media\/i"/);
    assert.match(html, /controls="" preload="metadata"/);
    assert.doesNotMatch(html, /script|onclick|example.invalid/);
  }
});
