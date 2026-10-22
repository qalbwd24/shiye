import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateLegacyConversion } from '../tools/lib/legacy-conversion-validator.mjs';
import { convertLegacyEntry } from '../tools/lib/legacy-content-converter.mjs';

let serial = 0;
const block = (type, content = [], attrs = {}) => ({
  type,
  attrs: { blockId: `block-${++serial}`, ...attrs },
  ...(content.length ? { content } : {}),
});
const text = (value, marks) => ({ type: 'text', text: value, ...(marks ? { marks } : {}) });
const paragraph = (...content) => block('paragraph', content);
const image = (assetId, attrs = {}) =>
  block('image', [], {
    assetId,
    occurrenceId: `occ-${++serial}`,
    insertedAt: null,
    widthRatio: 0.75,
    align: 'center',
    caption: '',
    alt: '',
    ...attrs,
  });
const converted = (...content) => ({
  body: { format: 'shiye-richdoc', version: 1, content },
  attachmentPlacements: [],
  issues: [],
});
const validate = (html, value, options) =>
  validateLegacyConversion(
    { content: html, contentFormat: 'html', attachments: [] },
    value,
    options,
  );

test('exact Unicode, spaces, inline marks and breaks are preserved without adding inline spaces', () => {
  const result = validate(
    '<p>　　甲<strong>乙</strong> 丙&nbsp;丁<br>下一行</p><p></p><hr>',
    converted(
      paragraph(
        text('　　甲'),
        text('乙', [{ type: 'bold' }]),
        text(' 丙\u00a0丁'),
        block('hardBreak'),
        text('下一行'),
      ),
      paragraph(),
      block('horizontalRule'),
    ),
  );
  assert.equal(result.safeForPreview, true);
});

test('missing characters, merged hard breaks and lost fullwidth indent cannot pass', () => {
  assert.equal(validate('<p>甲乙</p>', converted(paragraph(text('甲')))).textPreserved, false);
  const merged = validate('<p>甲<br>乙</p>', converted(paragraph(text('甲乙'))));
  assert.equal(merged.textPreserved, true);
  assert.equal(merged.lineStructurePreserved, false);
  const indent = validate('<p>　　甲</p>', converted(paragraph(text('甲'))));
  assert.equal(indent.textPreserved, true);
  assert.equal(indent.whitespacePreserved, false);
  assert.equal(indent.safeForPreview, false);
});

test('paragraph boundaries, empty lines, separator and formatting are audited separately', () => {
  assert.equal(
    validate('<p>甲</p><p>乙</p>', converted(paragraph(text('甲乙')))).lineStructurePreserved,
    false,
  );
  assert.equal(
    validate('<p>甲</p><p></p>', converted(paragraph(text('甲')))).lineStructurePreserved,
    false,
  );
  assert.equal(
    validate('<p><b>甲</b></p>', converted(paragraph(text('甲')))).safeForPreview,
    false,
  );
  assert.equal(
    validate('<p>甲</p><hr>', converted(paragraph(text('甲')))).lineStructurePreserved,
    false,
  );
});

test('real schema rejects legal-looking but invalid nesting and lost unknown fields', () => {
  assert.equal(
    validate('<p>甲</p>', converted(block('paragraph', [paragraph(text('甲'))]))).structureValid,
    false,
  );
  assert.equal(
    validate('<p>甲</p>', converted(paragraph(text('甲'), block('tableRow')))).structureValid,
    false,
  );
  assert.equal(
    validate(
      '<p>甲</p>',
      converted(block('paragraph', [text('甲')], { unknownField: 'must not disappear' })),
    ).structureValid,
    false,
  );
});

test('ordered attachment image prefix is permitted and every occurrence stays distinct', () => {
  const first = image('a');
  const second = image('b');
  const inline = image('a');
  const value = converted(first, second, paragraph(text('甲')), inline);
  value.attachmentPlacements = [first, second].map((n, sourceIndex) => ({
    assetId: n.attrs.assetId,
    sourceIndex,
    occurrenceId: n.attrs.occurrenceId,
    placement: 'legacy-default-start',
  }));
  const entry = { content: '<p>甲</p><img src="/media/a">', attachments: ['a', 'b'] };
  const options = {
    media: [
      { id: 'a', type: 'image/png' },
      { id: 'b', type: 'image/png' },
    ],
  };
  // A top-level HTML image has its own block, not an implicit paragraph.
  assert.equal(validateLegacyConversion(entry, value, options).safeForPreview, true);
  const missing = structuredClone(value);
  missing.body.content.splice(0, 1);
  assert.equal(validateLegacyConversion(entry, missing, options).attachmentsPreserved, false);
  const duplicated = structuredClone(value);
  duplicated.body.content.push(image('b'));
  assert.equal(validateLegacyConversion(entry, duplicated, options).attachmentsPreserved, false);
  const swapped = structuredClone(value);
  swapped.attachmentPlacements.reverse();
  assert.equal(validateLegacyConversion(entry, swapped, options).attachmentsPreserved, false);
  const invented = structuredClone(value);
  invented.body.content[0].attrs.insertedAt = '2026-10-16T00:00:00Z';
  assert.equal(validateLegacyConversion(entry, invented, options).safeForPreview, false);
});

test('same asset at two inline locations must retain both occurrences', () => {
  const entry = { content: '<img src="/media/a"><img src="/media/a">', attachments: [] };
  const options = { media: [{ id: 'a', type: 'image/png' }] };
  assert.equal(
    validateLegacyConversion(entry, converted(image('a'), image('a')), options).safeForPreview,
    true,
  );
  assert.equal(
    validateLegacyConversion(entry, converted(image('a')), options).attachmentsPreserved,
    false,
  );
});

test('list and table structures are checked beyond flattened text', () => {
  const list = converted(block('bulletList', [block('listItem', [paragraph(text('甲'))])]));
  assert.equal(validate('<ul><li>甲</li></ul>', list).safeForPreview, true);
  assert.equal(
    validate('<ul><li>甲</li></ul>', converted(paragraph(text('甲')))).safeForPreview,
    false,
  );
  const table = converted(
    block('table', [
      block('tableRow', [
        block('tableCell', [paragraph(text('甲'))], { colspan: 1, rowspan: 1, colwidth: null }),
      ]),
    ]),
  );
  assert.equal(validate('<table><tr><td>甲</td></tr></table>', table).safeForPreview, true);
});

test('unknown style and unsafe content require review without executing scripts or mutating globals', () => {
  const oldWindow = globalThis.window;
  assert.equal(
    validate('<p style="color:red">甲</p>', converted(paragraph(text('甲')))).safeForPreview,
    false,
  );
  const unsafe = validate(
    '<script>globalThis.secret=1</script><p>甲</p>',
    converted(paragraph(text('甲'))),
  );
  assert.equal(unsafe.safeForPreview, false);
  assert.equal(globalThis.secret, undefined);
  assert.equal(globalThis.window, oldWindow);
  assert.equal(JSON.stringify(unsafe).includes('secret'), false);
});

test('nonimage external prefix remains associated but cannot claim preview fidelity', () => {
  const value = converted(paragraph(text('甲')));
  value.attachmentPlacements = [{ assetId: 'audio', placement: 'external-prefix' }];
  const result = validateLegacyConversion({ content: '<p>甲</p>', attachments: ['audio'] }, value, {
    media: [{ id: 'audio', type: 'audio/ogg' }],
  });
  assert.equal(result.attachmentsPreserved, true);
  assert.equal(result.safeForPreview, false);
  assert.ok(result.issues.some((i) => i.code === 'non-image-attachment-preview-gap'));
});

test('validation does not repair IDs or mutate inputs and diagnostics contain counts only', () => {
  const entry = { content: '<p>PRIVATE-TEXT</p>', attachments: [] };
  const value = converted(paragraph(text('PRIVATE-TEXT')));
  const before = JSON.stringify({ entry, value });
  const result = validateLegacyConversion(entry, value);
  assert.equal(result.safeForPreview, true);
  assert.equal(JSON.stringify({ entry, value }), before);
  assert.equal(JSON.stringify(result).includes('PRIVATE-TEXT'), false);
  value.body.content.push(structuredClone(value.body.content[0]));
  assert.equal(validateLegacyConversion(entry, value).structureValid, false);
});

test('literal LF and br are equivalent logical breaks, while missing LF still fails', () => {
  const html = '<p><b>甲\n乙</b>\n丙</p>';
  const value = converted(
    paragraph(
      text('甲', [{ type: 'bold' }]),
      block('hardBreak'),
      text('乙', [{ type: 'bold' }]),
      block('hardBreak'),
      text('丙'),
    ),
  );
  assert.equal(validate(html, value).safeForPreview, true);
  assert.equal(
    validate(html, converted(paragraph(text('甲乙丙', [{ type: 'bold' }])))).safeForPreview,
    false,
  );
  assert.equal(validate('', converted(paragraph())).safeForPreview, true);
});

test('actual converter placementSource metadata keeps mixed attachments associated', () => {
  const entry = {
    id: 'synthetic-integration',
    content: '<p>甲\n乙</p>',
    attachments: ['a', 'b', 'c'],
  };
  const media = [
    { id: 'a', type: 'image/png' },
    { id: 'b', type: 'audio/ogg' },
    { id: 'c', type: 'image/jpeg' },
  ];
  const candidate = convertLegacyEntry(entry, { media });
  const result = validateLegacyConversion(entry, candidate, { media });
  assert.equal(result.structureValid, true);
  assert.equal(result.whitespacePreserved, true);
  assert.equal(result.lineStructurePreserved, true);
  assert.equal(result.attachmentsPreserved, true);
  assert.equal(result.safeForPreview, false);
  assert.equal(
    result.issues.some((i) => i.code === 'non-image-prefix-descriptor-missing'),
    false,
  );
});

test('mixed inline runs inside list items and quotes have individual implicit paragraphs', () => {
  const html =
    '<ul><li>甲<p>乙</p>丙<ul><li>丁</li></ul>戊</li></ul><blockquote>己<p>庚</p>辛</blockquote>';
  const value = converted(
    block('bulletList', [
      block('listItem', [
        paragraph(text('甲')),
        paragraph(text('乙')),
        paragraph(text('丙')),
        block('bulletList', [block('listItem', [paragraph(text('丁'))])]),
        paragraph(text('戊')),
      ]),
    ]),
    block('blockquote', [paragraph(text('己')), paragraph(text('庚')), paragraph(text('辛'))]),
  );
  assert.equal(validate(html, value).safeForPreview, true);
  const droppedBoundary = structuredClone(value);
  droppedBoundary.body.content[1].content = [paragraph(text('己庚辛'))];
  assert.equal(validate(html, droppedBoundary).lineStructurePreserved, false);
});

test('ASCII layout indentation around block children is not an implicit visible blank paragraph', () => {
  const html = '<blockquote>\n<p>甲</p>\n</blockquote>';
  assert.equal(
    validate(html, converted(block('blockquote', [paragraph(text('甲'))]))).safeForPreview,
    true,
  );
  const inventedBlankLines = converted(
    block('blockquote', [
      paragraph(block('hardBreak')),
      paragraph(text('甲')),
      paragraph(block('hardBreak')),
    ]),
  );
  assert.equal(validate(html, inventedBlankLines).lineStructurePreserved, false);
  const explicitBlanks = '<blockquote><p></p><p>甲</p><p><br></p></blockquote>';
  assert.equal(
    validate(
      explicitBlanks,
      converted(
        block('blockquote', [paragraph(), paragraph(text('甲')), paragraph(block('hardBreak'))]),
      ),
    ).safeForPreview,
    true,
  );
  const fullwidth = '<blockquote>　<p>甲</p></blockquote>';
  assert.equal(
    validate(
      fullwidth,
      converted(block('blockquote', [paragraph(text('　')), paragraph(text('甲'))])),
    ).safeForPreview,
    true,
  );
});
