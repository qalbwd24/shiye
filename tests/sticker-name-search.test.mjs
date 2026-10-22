import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const source = await fs.readFile(
  new URL('../previews/telegram-chat/shiye-input.js', import.meta.url),
  'utf8',
);
async function setup() {
  const dom = new JSDOM('<div id="editable-message-text" contenteditable="true"></div>', {
    url: 'https://shiye-preview.local',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const w = dom.window,
    input = w.document.querySelector('div');
  const assets = new Map();
  const put = (id, name, extra = {}) =>
    assets.set('sticker:' + id, {
      id: 'sticker:' + id,
      name,
      blob: new Blob(['synthetic'], { type: 'image/gif' }),
      ...extra,
    });
  put('cat', '猫猫睡觉.gif');
  put('yes', '好的.PNG');
  put('gone', '已移除', { removed: true });
  assets.set('mapping:晚安', {
    id: 'mapping:晚安',
    kind: 'sticker',
    name: '晚安',
    assetId: 'sticker:cat',
  });
  assets.set('mapping:开心', { id: 'mapping:开心', kind: 'emoji', name: '开心', value: '😊' });
  let range,
    pending,
    sends = 0;
  w.File = File;
  w.URL.createObjectURL = () => 'blob:synthetic';
  w.URL.revokeObjectURL = () => {};
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  w.shiyeLocalAssets = {
    list: async (prefix) => [...assets.values()].filter((item) => item.id.startsWith(prefix)),
    get: async (id) => assets.get(id),
    put: async (asset) => assets.set(asset.id, asset),
  };
  w.shiyeStickers = { materialize: async (asset) => (pending ? pending.then(() => asset) : asset) };
  const editor = {
    input,
    readSlash: () => range,
    removeSlash: () => {
      range = undefined;
      return true;
    },
    sendSticker: async (file) => {
      assert.equal(file.shiyeOriginalSticker, true);
      sends++;
    },
  };
  w.addEventListener('shiye-editor-request', (e) => e.detail.receive(editor));
  w.eval(source);
  const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
  await tick();
  input.focus();
  return {
    w,
    input,
    assets,
    put,
    tick,
    editor,
    get sends() {
      return sends;
    },
    set pending(value) {
      pending = value;
    },
    async query(value) {
      range = { from: 1, to: value.length + 2, query: value };
      input.dispatchEvent(new w.Event('input', { bubbles: true }));
      await tick();
      return [...w.document.querySelectorAll('#shiye-commands [role=option]')];
    },
    key(key, extra = {}) {
      w.dispatchEvent(
        new w.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }),
      );
    },
    close() {
      dom.window.close();
    },
  };
}
test('slash uses collection names directly; old aliases dedupe and all built-in/emoji commands are absent', async () => {
  const h = await setup();
  try {
    assert.equal((await h.query('猫'))[0].dataset.stickerId, 'sticker:cat');
    assert.equal((await h.query('晚安'))[0].dataset.stickerId, 'sticker:cat');
    const all = await h.query('');
    assert.equal(all.length, 2);
    assert.ok(all.every((button) => button.querySelector('img.shiye-command-preview')));
    for (const name of ['图片', '时间', '搜索', '表情', '表情包', '开心'])
      assert.equal((await h.query(name)).length, 0);
    assert.equal((await h.query('猫猫睡觉.gif')).length, 1);
    await h.query('没有这张');
    const enter = new h.w.KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    h.w.dispatchEvent(enter);
    assert.equal(enter.defaultPrevented, true);
    assert.equal(h.sends, 0);
    h.put('reserved', '搜索.gif');
    h.w.dispatchEvent(new h.w.Event('shiye-stickers-updated'));
    await h.tick();
    assert.equal((await h.query('搜索'))[0].dataset.stickerId, 'sticker:reserved');
  } finally {
    h.close();
  }
});
test('arrows preserve input focus and selection across selectionchange; Enter sends once and IME never sends', async () => {
  const h = await setup();
  try {
    await h.query('');
    h.key('ArrowDown');
    const selected = () => h.w.document.querySelector('[aria-selected=true]')?.dataset.stickerId;
    const id = selected();
    h.w.document.dispatchEvent(new h.w.Event('selectionchange'));
    assert.equal(selected(), id);
    assert.equal(h.w.document.activeElement, h.input);
    h.input.dispatchEvent(new h.w.CompositionEvent('compositionstart', { bubbles: true }));
    h.key('Enter', { isComposing: true });
    assert.equal(h.sends, 0);
    h.input.dispatchEvent(new h.w.CompositionEvent('compositionend', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    await h.query('猫');
    h.key('Enter');
    h.key('Enter');
    await h.tick();
    assert.equal(h.sends, 1);
  } finally {
    h.close();
  }
});
test('renaming/removal refresh metadata; an asynchronous original never sends after input changes', async () => {
  const h = await setup();
  try {
    h.put('cat', 'ＨＡＰＰＹ.gif');
    h.w.dispatchEvent(new h.w.Event('shiye-stickers-updated'));
    await h.tick();
    assert.equal((await h.query('happy'))[0].dataset.stickerId, 'sticker:cat');
    let finish;
    h.pending = new Promise((resolve) => {
      finish = resolve;
    });
    h.key('Enter');
    await h.tick();
    await h.query('好的');
    finish();
    await h.tick();
    assert.equal(h.sends, 0);
    h.put('yes', '好的.PNG', { removed: true });
    h.w.dispatchEvent(new h.w.Event('shiye-stickers-updated'));
    await h.tick();
    assert.equal((await h.query('好的')).length, 0);
    h.key('Escape');
    assert.equal(h.w.document.querySelector('#shiye-commands'), null);
  } finally {
    h.close();
  }
});
test('all matches remain reachable after the fifth and manual ordering preserves assets and aliases', async () => {
  const h = await setup();
  try {
    for (let i = 0; i < 16; i++)
      h.put('many' + String(i).padStart(2, '0'), '候选' + String(i).padStart(2, '0'));
    h.w.dispatchEvent(new h.w.Event('shiye-stickers-updated'));
    await h.tick();
    assert.equal((await h.query('候选')).length, 16);
    for (let i = 0; i < 15; i++) h.key('ArrowDown');
    assert.equal(
      h.w.document.querySelector('[aria-selected=true]')?.dataset.stickerId,
      'sticker:many15',
    );
    const cat = h.assets.get('sticker:cat'),
      alias = h.assets.get('mapping:晚安');
    await h.w.shiyeStickerOrder.move('sticker:many15', 'top');
    await h.tick();
    assert.equal((await h.query(''))[0].dataset.stickerId, 'sticker:many15');
    await Promise.all([
      h.w.shiyeStickerOrder.move('sticker:many15', 'down'),
      h.w.shiyeStickerOrder.move('sticker:many15', 'down'),
    ]);
    await h.tick();
    assert.equal((await h.query(''))[2].dataset.stickerId, 'sticker:many15');
    assert.equal(h.assets.get('sticker:cat'), cat);
    assert.equal(h.assets.get('mapping:晚安'), alias);
    const record = h.assets.get('preference:sticker-order-v1');
    assert.equal(record.version, 1);
    assert.equal(new Set(record.ids).size, record.ids.length);
    await assert.rejects(h.w.shiyeStickerOrder.move('sticker:cat', 'invalid'), /未知/);
    await h.w.shiyeStickerOrder.move(undefined, 'usage');
    assert.equal(h.assets.get(record.id).mode, 'usage');
  } finally {
    h.close();
  }
});
