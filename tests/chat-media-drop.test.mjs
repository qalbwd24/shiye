import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(
  new URL('../previews/telegram-chat/shiye-media-drop.js', import.meta.url),
  'utf8',
);
const window = {};
vm.runInNewContext(source, { window, File, Blob, Uint8Array, Promise, Date, Error, RegExp, atob });
const api = window.shiyeDroppedMedia;
const gif = Buffer.from(
  '47494638396101000100800000000000ffffff21ff0b4e45545343415045322e30030100000021f904000a0000002c000000000100010000020244010021f904000a0000002c00000000010001000002024c01003b',
  'hex',
);
const drop = (files = [], types = ['Files'], values = {}) => ({
  dataTransfer: { files, types, getData: (k) => values[k] || '' },
});

test('virtual file handles are captured in the drop tick and recovered without a second drag', async () => {
  let valid = true,
    calls = 0;
  const event = drop([]);
  event.dataTransfer.items = [
    {
      kind: 'file',
      getAsFile: () => null,
      getAsFileSystemHandle: () => {
        assert.ok(valid);
        calls++;
        return Promise.resolve({
          kind: 'file',
          getFile: async () => new File([gif], '微信动图', { type: '' }),
        });
      },
    },
  ];
  const pending = api.capture(event);
  valid = false;
  assert.equal(calls, 1);
  const [file] = await pending;
  assert.equal(file.type, 'image/gif');
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), gif);
});

test('raw Qt image transfer is decoded locally while unknown private formats are rejected', async () => {
  const event = drop([], ['application/x-qt-image'], {
    'application/x-qt-image': gif.toString('base64'),
  });
  assert.equal(api.isCandidate(event.dataTransfer), true);
  const [file] = await api.capture(event);
  assert.equal(file.type, 'image/gif');
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), gif);
  await assert.rejects(api.capture(drop([], ['application/x-weixin-private'])), /来源没有提供/);
});
test('empty and application/octet-stream MIME drags become image previews, including GIF named jpg', async () => {
  for (const mime of ['', 'application/octet-stream', 'image/jpeg']) {
    const f = new File([gif], 'QQ表情.jpg', { type: mime });
    assert.ok(api.isCandidate(drop([f]).dataTransfer));
    const [owned] = await api.capture(drop([f]));
    assert.equal(owned.type, 'image/gif');
    assert.equal(owned.name, 'QQ表情.gif');
    assert.deepEqual(Buffer.from(await owned.arrayBuffer()), gif);
  }
});
test('drop owns ephemeral bytes immediately and recovers real File from an empty file-list placeholder', async () => {
  let valid = true,
    reads = 0;
  const f = {
    name: 'image',
    size: gif.length,
    type: '',
    arrayBuffer() {
      reads++;
      assert.ok(valid);
      return Promise.resolve(gif.buffer.slice(gif.byteOffset, gif.byteOffset + gif.length));
    },
  };
  const pending = api.capture(drop([f]));
  valid = false;
  assert.equal(reads, 1);
  assert.equal((await pending)[0].size, gif.length);
  const event = drop([
    { name: 'empty.jpg', size: 0, type: '', arrayBuffer: async () => new ArrayBuffer(0) },
  ]);
  event.dataTransfer.items = [
    { kind: 'file', getAsFile: () => new File([gif], 'real.gif', { type: '' }) },
  ];
  assert.equal((await api.capture(event))[0].type, 'image/gif');
});
test('inline HTML/data URI supports original GIF without requesting a remote image', async () => {
  const event = drop([], ['text/html'], {
    'text/html': '<img src="data:image/jpeg;base64,' + gif.toString('base64') + '">',
  });
  const [file] = await api.capture(event);
  assert.equal(file.type, 'image/gif');
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), gif);
  await assert.rejects(
    api.capture(
      drop([], ['text/html'], { 'text/html': '<img src="https://example.invalid/a.gif">' }),
    ),
    /没有提供/,
  );
});
test('invalid jpg, empty virtual files and regular text are not silently sent', async () => {
  await assert.rejects(
    api.capture(drop([new File(['<html>login</html>'], 'broken.jpg', { type: 'image/jpeg' })])),
    /有效图片/,
  );
  await assert.rejects(
    api.capture(drop([new File([], 'blank.gif', { type: 'image/gif' })])),
    /内容为空/,
  );
  assert.equal(api.capture(drop([], ['text/plain'], { 'text/plain': '普通文字' })), null);
  await assert.rejects(api.capture(drop([], ['Files'])), /没有提供/);
});
test('large image is rejected from its header without allocating the full file', async () => {
  let full = 0;
  const f = {
    name: 'large.gif',
    type: '',
    size: 65 * 1024 * 1024,
    arrayBuffer() {
      full++;
      throw Error('must not read whole image');
    },
    slice() {
      return new Blob([gif]);
    },
  };
  await assert.rejects(api.capture(drop([f])), /64 MiB/);
  assert.equal(full, 0);
});
