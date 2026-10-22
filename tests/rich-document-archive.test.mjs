import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromEditorJSON } from '../public/shared/rich-document.js';
import {
  richAssetFromBlob,
  richMediaAssetFromBlob,
  encodeRichArchive,
  decodeRichArchive,
} from '../public/shared/rich-document-archive.js';

const png = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',
    'base64',
  ),
);
async function fixture() {
  const asset = await richAssetFromBlob(new Blob([png]), '中文原图.png');
  const image = (id) => ({
    type: 'image',
    attrs: {
      assetId: asset.id,
      occurrenceId: id,
      insertedAt: '2026-10-16T10:00:00.000Z',
      widthRatio: 0.42,
      align: 'right',
      caption: '图注 🌿',
      alt: '同一图片，不同出现',
    },
  });
  const body = fromEditorJSON({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: '之前 空格\n中文',
            marks: [{ type: 'italic' }, { type: 'highlight' }],
          },
        ],
      },
      image('first'),
      { type: 'paragraph', content: [{ type: 'text', text: '之后' }] },
      image('second'),
    ],
  });
  return { body, assets: new Map([[asset.id, asset]]) };
}
test('portable original roundtrip retains exact JSON, original media bytes and distinct image occurrences', async () => {
  const original = await fixture();
  const pack = await encodeRichArchive(original.body, original.assets);
  assert.equal(pack.assets.length, 1);
  const restored = await decodeRichArchive(JSON.stringify(pack));
  assert.deepEqual(restored.body, original.body);
  assert.equal(restored.assets.size, 1);
  const asset = [...restored.assets.values()][0];
  assert.deepEqual(new Uint8Array(await asset.blob.arrayBuffer()), png);
  assert.equal(asset.name, '中文原图.png');
  assert.equal(asset.type, 'image/png');
  assert.equal(restored.body.content[1].attrs.occurrenceId, 'first');
  assert.equal(restored.body.content[3].attrs.occurrenceId, 'second');
});
test('export captures a stable snapshot even if editing continues during image encoding', async () => {
  const original = await fixture();
  const before = structuredClone(original.body);
  const writing = encodeRichArchive(original.body, original.assets);
  original.body.content[0].content[0].text = '生成导出期间的新内容';
  assert.deepEqual((await writing).body, before);
});
test('corrupt, duplicated, missing, mismatched and unknown media fields cannot be restored', async () => {
  const original = await fixture();
  const pack = await encodeRichArchive(original.body, original.assets);
  const invalid = [
    [
      (p) => {
        p.assets[0].base64 = '***';
      },
      /编码/,
    ],
    [
      (p) => {
        p.assets[0].size++;
      },
      /大小/,
    ],
    [
      (p) => {
        p.assets[0].base64 = Buffer.from(png.map((b, i) => (i === 20 ? b ^ 1 : b))).toString(
          'base64',
        );
      },
      /校验/,
    ],
    [
      (p) => {
        p.assets[0].type = 'image/svg+xml';
      },
      /校验/,
    ],
    [
      (p) => {
        p.assets.push(structuredClone(p.assets[0]));
      },
      /重复/,
    ],
    [
      (p) => {
        p.assets = [];
      },
      /缺图片/,
    ],
    [
      (p) => {
        p.assets[0].futureAttribute = 'must not silently disappear';
      },
      /未知字段/,
    ],
    [
      (p) => {
        p.body.futureAttribute = 1;
      },
      /未知字段/,
    ],
    [
      (p) => {
        p.futureAttribute = 1;
      },
      /未知字段/,
    ],
  ];
  for (const [change, pattern] of invalid) {
    const broken = structuredClone(pack);
    change(broken);
    await assert.rejects(decodeRichArchive(JSON.stringify(broken)), pattern);
  }
  assert.deepEqual((await decodeRichArchive(JSON.stringify(pack))).body, original.body);
});
test('image MIME is identified from original bytes, and non-images are refused by the image picker API', async () => {
  const actual = await richAssetFromBlob(
    new Blob([png], { type: 'text/plain' }),
    'image.wrong-extension',
  );
  assert.equal(actual.type, 'image/png');
  await assert.rejects(
    richAssetFromBlob(
      new Blob(['<svg><script>1</script></svg>'], { type: 'image/png' }),
      'fake.png',
    ),
    /无法识别/,
  );
});

test('portable video archive preserves original bytes, distinct occurrences, layout and unknown insertion time', async () => {
  const bytes = Uint8Array.from(
    Buffer.from('000000186674797069736f6d0000020069736f6d6d7034320000000c6d64617401020304', 'hex'),
  );
  const asset = await richMediaAssetFromBlob(
    new Blob([bytes], { type: 'image/png' }),
    'fictional.wrong-extension',
  );
  assert.equal(asset.type, 'video/mp4');
  await assert.rejects(richAssetFromBlob(new Blob([bytes]), 'fictional.mp4'), /图片原件/);
  const video = (occurrenceId, insertedAt, widthRatio, align) => ({
    type: 'video',
    attrs: {
      assetId: asset.id,
      occurrenceId,
      insertedAt,
      widthRatio,
      align,
      caption: '虚构视频图注',
      alt: '虚构视频',
    },
  });
  const body = fromEditorJSON({
    type: 'doc',
    content: [
      video('video-first', null, 0.4, 'left'),
      video('video-second', '2026-10-16T00:00:00.000Z', 0.8, 'right'),
    ],
  });
  const archive = await encodeRichArchive(body, new Map([[asset.id, asset]]));
  assert.equal(archive.version, 1);
  assert.equal(archive.assets.length, 1);
  const restored = await decodeRichArchive(JSON.stringify(archive));
  assert.deepEqual(restored.body, body);
  assert.deepEqual(new Uint8Array(await restored.assets.get(asset.id).blob.arrayBuffer()), bytes);
  const missing = { ...archive, assets: [] };
  await assert.rejects(decodeRichArchive(JSON.stringify(missing)), /缺视频/);
  const wrongKind = structuredClone(archive);
  wrongKind.body.content[0].type = 'image';
  await assert.rejects(decodeRichArchive(JSON.stringify(wrongKind)), /类型不符/);
  const originalPng = await fixture();
  originalPng.body.content[1].type = 'video';
  await assert.rejects(encodeRichArchive(originalPng.body, originalPng.assets), /类型不符/);
});
test('archive codec handles a multi-megabyte binary without argument-limit truncation', async () => {
  const bytes = new Uint8Array(3 * 1024 * 1024);
  bytes.set(png);
  for (let i = png.length; i < bytes.length; i++) bytes[i] = i % 251;
  const asset = await richAssetFromBlob(new Blob([bytes]), 'synthetic-binary.png');
  const { body } = await fixture();
  body.content
    .filter((node) => node.type === 'image')
    .forEach((node) => {
      node.attrs.assetId = asset.id;
    });
  const packed = await encodeRichArchive(body, new Map([[asset.id, asset]]));
  const restored = await decodeRichArchive(JSON.stringify(packed));
  assert.deepEqual(new Uint8Array(await restored.assets.get(asset.id).blob.arrayBuffer()), bytes);
});
