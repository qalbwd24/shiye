import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capturePastedFiles } from '../public/core/clipboard-files.js';
const event = (files, extra = {}) => ({
  clipboardData: { files, items: [] },
  isTrusted: false,
  ...extra,
});
test('paste snapshots bytes before OS handles expire and preserves name/type/date', async () => {
  let valid = true,
    reads = 0;
  const bytes = new Uint8Array([137, 80, 78, 71]);
  const backed = {
    size: 4,
    name: 'clipboard.png',
    type: 'image/png',
    lastModified: 1234,
    arrayBuffer() {
      reads++;
      assert.ok(valid);
      return Promise.resolve(bytes.buffer);
    },
  };
  const result = capturePastedFiles(event([backed]));
  valid = false;
  assert.equal(reads, 1);
  const [file] = await result;
  assert.equal(file.name, backed.name);
  assert.equal(file.type, backed.type);
  assert.equal(file.lastModified, 1234);
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), bytes);
});
test('text paste does not read clipboard; file items can replace zero-byte FileList image', async () => {
  let reads = 0;
  const clipboard = {
    read() {
      reads++;
      throw Error('not allowed');
    },
  };
  assert.equal(capturePastedFiles(event([]), { clipboard }), null);
  const good = new File(['image bytes'], 'image.png', { type: 'image/png' });
  const zero = new File([], 'image.png', { type: 'image/png' });
  const e = event([zero]);
  e.clipboardData.items = [{ kind: 'file', getAsFile: () => good }];
  const [file] = await capturePastedFiles(e, { clipboard });
  assert.equal(await file.text(), 'image bytes');
  assert.equal(reads, 0);
});
test('trusted empty image paste recovers image bytes only; denied or synthetic requests fail explicitly', async () => {
  const zero = new File([], 'image.png', { type: 'image/png' });
  let reads = 0;
  const clipboard = {
    async read() {
      reads++;
      return [
        {
          types: ['text/html', 'image/png'],
          async getType(type) {
            assert.equal(type, 'image/png');
            return new Blob(['recovered'], { type });
          },
        },
      ];
    },
  };
  const [file] = await capturePastedFiles(event([zero], { isTrusted: true }), { clipboard });
  assert.equal(file.size, 9);
  assert.equal(file.type, 'image/png');
  assert.equal(reads, 1);
  await assert.rejects(capturePastedFiles(event([zero]), { clipboard }), /剪贴板.*为空或已失效/);
  assert.equal(reads, 1);
  await assert.rejects(
    capturePastedFiles(event([zero], { isTrusted: true }), {
      clipboard: {
        read: async () => {
          throw Error('denied');
        },
      },
    }),
    /剪贴板/,
  );
});
test('unreadable clipboard file cannot fall through to a zero-byte preview or upload', async () => {
  const broken = { size: 200, type: 'image/png', arrayBuffer: async () => new ArrayBuffer(0) };
  await assert.rejects(capturePastedFiles(event([broken])), /剪贴板/);
});
