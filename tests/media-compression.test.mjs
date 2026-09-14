import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compressUpload,
  compressionDimensions,
  inspectUploadImage,
  readExifCapture,
} from '../public/core/media-compression.js';
function jpegWithExif() {
  const tiff = Buffer.alloc(180);
  tiff.write('II');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(2, 8);
  const tag = (at, id, type, count, value) => {
    tiff.writeUInt16LE(id, at);
    tiff.writeUInt16LE(type, at + 2);
    tiff.writeUInt32LE(count, at + 4);
    tiff.writeUInt32LE(value, at + 8);
  };
  tag(10, 0x0132, 2, 20, 100);
  tag(22, 0x8769, 4, 1, 40);
  tiff.writeUInt16LE(2, 40);
  tag(42, 0x9003, 2, 20, 120);
  tag(54, 0x9011, 2, 7, 144);
  tiff.write('2020:01:02 03:04:05\0', 100);
  tiff.write('2019:12:31 23:59:58\0', 120);
  tiff.write('+08:00\0', 144);
  const payload = Buffer.concat([Buffer.from('Exif\0\0'), tiff]),
    length = Buffer.alloc(2);
  length.writeUInt16BE(payload.length + 2);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe1]),
    length,
    payload,
    Buffer.from([0xff, 0xc0, 0, 11, 8, 0x07, 0xd0, 0x0f, 0xa0, 1, 1, 0x11, 0, 0xff, 0xd9]),
  ]);
}
function png(animated = false) {
  const chunk = (name, payload = Buffer.alloc(0)) => {
    const size = Buffer.alloc(4);
    size.writeUInt32BE(payload.length);
    return Buffer.concat([size, Buffer.from(name), payload, Buffer.alloc(4)]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(4000);
  header.writeUInt32BE(2000, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    ...(animated ? [chunk('acTL', Buffer.alloc(8))] : []),
    chunk('IEND'),
  ]);
}
const paddedFile = (bytes, type, name = 'source.png') =>
  new File([bytes, new Uint8Array(350_000)], name, { type, lastModified: 1_500_000_000_000 });

test('JPEG EXIF capture is bounded raw text, prefers DateTimeOriginal and never invents a timezone', () => {
  const bytes = jpegWithExif();
  assert.deepEqual(readExifCapture(bytes), {
    sourceCapturedAtRaw: '2019:12:31 23:59:58',
    sourceCapturedTag: 'DateTimeOriginal',
    sourceCapturedOffset: '+08:00',
  });
  const noOffset = Buffer.from(bytes);
  noOffset.fill(0, 156, 163);
  assert.deepEqual(readExifCapture(noOffset), {
    sourceCapturedAtRaw: '2019:12:31 23:59:58',
    sourceCapturedTag: 'DateTimeOriginal',
  });
  const editedOnly = Buffer.from(bytes);
  editedOnly.writeUInt16LE(0x9004, 12 + 42);
  assert.deepEqual(readExifCapture(editedOnly), {
    sourceCapturedAtRaw: '2020:01:02 03:04:05',
    sourceCapturedTag: 'DateTime',
  });
  const corrupt = Buffer.from(bytes);
  corrupt.writeUInt32LE(0xfffffff0, 12 + 4);
  assert.deepEqual(readExifCapture(corrupt), {});
  for (let length = 0; length < bytes.length; length += 7)
    assert.doesNotThrow(() => readExifCapture(bytes.subarray(0, length)));
  assert.equal(inspectUploadImage(bytes).width, 4000);
});

test('signature checks identify APNG/WebP animations and reject malformed bounds', () => {
  assert.equal(inspectUploadImage(png(true)).animated, true);
  assert.equal(inspectUploadImage(png()).animated, false);
  assert.equal(inspectUploadImage(png().subarray(0, 30)), null);
  const webp = Buffer.alloc(30);
  webp.write('RIFF');
  webp.writeUInt32LE(22, 4);
  webp.write('WEBPVP8X', 8);
  webp.writeUInt32LE(10, 16);
  webp[20] = 2;
  webp[24] = 9;
  webp[27] = 9;
  assert.equal(inspectUploadImage(webp).animated, true);
  webp.writeUInt32LE(5000, 16);
  assert.equal(inspectUploadImage(webp), null);
  assert.deepEqual(compressionDimensions(4000, 2000, 2048), { width: 2048, height: 1024 });
  assert.deepEqual(compressionDimensions(100, 50, 2048), { width: 100, height: 50 });
});

test('original/animation/unknown input remains byte-identical with original timestamps', async () => {
  for (const file of [
    paddedFile(png(true), 'image/png'),
    paddedFile(Buffer.from('GIF89a------'), 'image/gif'),
    paddedFile(Buffer.from('anything'), 'image/heic'),
  ]) {
    const result = await compressUpload(file, { quality: 'balanced' });
    assert.equal(result.file, file);
    assert.equal(result.changed, false);
    assert.equal(result.sourceLastModified, file.lastModified);
  }
  const file = paddedFile(jpegWithExif(), 'image/jpeg', 'photo.jpg');
  const result = await compressUpload(file, { quality: 'original' });
  assert.equal(result.file, file);
  assert.equal(result.sourceCapturedAtRaw, '2019:12:31 23:59:58');
  assert.equal(result.sourceCapturedOffset, '+08:00');
});

test('canvas output retains alpha, source modification time and EXIF snapshot, and larger output is discarded', async () => {
  const savedDocument = globalThis.document,
    savedBitmap = globalThis.createImageBitmap;
  let encodedSize = 1200,
    options,
    dimensions,
    closed = 0,
    outputType;
  globalThis.createImageBitmap = async () => ({
    width: 4000,
    height: 2000,
    close() {
      closed++;
    },
  });
  globalThis.document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext(_type, requested) {
        options = requested;
        return {
          drawImage(_image, _x, _y, width, height) {
            dimensions = { width, height };
          },
        };
      },
      toBlob(done, type) {
        outputType = type;
        done(new Blob([new Uint8Array(encodedSize)], { type }));
      },
    }),
  };
  try {
    const transparent = paddedFile(png(), 'image/png');
    const result = await compressUpload(transparent, { quality: 'balanced' });
    assert.equal(result.changed, true);
    assert.equal(result.file.type, 'image/webp');
    assert.equal(result.file.name, 'source.webp');
    assert.deepEqual(options, { alpha: true });
    assert.deepEqual(dimensions, { width: 2048, height: 1024 });
    assert.equal(result.file.lastModified, transparent.lastModified);
    const photo = paddedFile(jpegWithExif(), 'image/jpeg', 'photo.jpg');
    const compressed = await compressUpload(photo, { quality: 'high' });
    assert.equal(outputType, 'image/jpeg');
    assert.equal(compressed.sourceCapturedAtRaw, '2019:12:31 23:59:58');
    assert.match(compressed.metadataWarning, /EXIF/);
    assert.equal(compressed.file.lastModified, photo.lastModified);
    encodedSize = transparent.size + 1;
    const larger = await compressUpload(transparent, { quality: 'balanced' });
    assert.equal(larger.file, transparent);
    assert.equal(larger.changed, false);
    assert.equal(closed, 3);
  } finally {
    globalThis.document = savedDocument;
    globalThis.createImageBitmap = savedBitmap;
  }
});

test('batch cancel and deletion during confirmation never enqueue an upload', async () => {
  const { createMediaImport } = await import('../public/features/media-import.js');
  const savedDocument = globalThis.document,
    savedWindow = globalThis.window,
    savedXhr = globalThis.XMLHttpRequest;
  let uploads = 0,
    decision = [],
    duringReview = () => {},
    messages = [];
  const entry = { id: 'target', title: 'Synthetic', attachments: [] };
  const library = { entries: [entry], media: [] };
  try {
    globalThis.document = {
      createElement: () => ({ setAttribute() {} }),
      body: { append() {} },
      addEventListener() {},
    };
    globalThis.window = { addEventListener() {} };
    globalThis.XMLHttpRequest = class {
      constructor() {
        uploads++;
        throw Error('Unexpected upload');
      }
    };
    const importer = createMediaImport({
      $() {},
      escape: (s) => s,
      toast: (message) => messages.push(message),
      current: () => entry,
      get library() {
        return library;
      },
      chooseMediaBatch: async (_files, options) => {
        assert.equal(options.targetLabel, 'Synthetic');
        duringReview();
        return decision;
      },
    });
    const file = new File(['synthetic'], 'fixture.txt', { type: 'text/plain' });
    await importer.upload([file]);
    assert.equal(uploads, 0);
    assert.deepEqual(entry.attachments, []);
    decision = [{ file, quality: 'original' }];
    duringReview = () => {
      entry.deleted = true;
    };
    await importer.upload([file]);
    assert.equal(uploads, 0);
    assert.deepEqual(entry.attachments, []);
    assert.match(messages.at(-1), /原目标日记已不可编辑/);
  } finally {
    globalThis.document = savedDocument;
    globalThis.window = savedWindow;
    globalThis.XMLHttpRequest = savedXhr;
  }
});

test('batch checkboxes preserve originals while unchecked files remain included and default compressed', async () => {
  const { batchSelection } = await import('../public/features/media-batch.js');
  const files = ['a', 'b', 'c'].map((name) => new File([name], name));
  assert.deepEqual(
    batchSelection(files, new Set(), new Set(), 'original').map((item) => item.quality),
    ['balanced', 'balanced', 'balanced'],
  );
  assert.deepEqual(
    batchSelection(files, new Set([1]), new Set(), 'high').map((item) => item.quality),
    ['high', 'original', 'high'],
  );
  const removed = new Set([1]);
  assert.deepEqual(
    batchSelection(files, new Set([1]), removed).map((item) => item.file.name),
    ['a', 'c'],
  );
  removed.delete(1);
  assert.deepEqual(
    batchSelection(files, new Set([1]), removed).map((item) => item.quality),
    ['balanced', 'original', 'balanced'],
  );
});
