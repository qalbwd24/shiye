import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(
  new URL('../previews/telegram-chat/shiye-preview.js', import.meta.url),
  'utf8',
);
const timing = source.slice(
  source.indexOf('  // Migrate the old default once;'),
  source.indexOf('  let lastEditor;'),
);
function open(storage = new Map()) {
  const window = {};
  const localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
  };
  vm.runInNewContext(timing, { window, localStorage });
  return { setting: window.shiyeSwitchDelay, storage };
}

test('chat switcher upgrades the old default once and preserves later user choices', () => {
  const { setting, storage } = open(new Map([['shiye-switch-delay', '800']]));
  assert.equal(setting.get(), 1200);
  setting.set(800);
  assert.equal(open(storage).setting.get(), 800);
});

test('chat switcher retains a custom delay across reopening', () => {
  const { setting, storage } = open(new Map([['shiye-switch-delay', '1900']]));
  assert.equal(setting.get(), 1900);
  setting.set(2400);
  assert.equal(open(storage).setting.get(), 2400);
});

test('chat switcher clamps out-of-range and invalid settings without an instant switch', () => {
  const { setting } = open();
  assert.equal(setting.get(), 1200);
  for (const [value, expected] of [
    ['', 1200],
    ['bad', 1200],
    [Infinity, 1200],
    [0, 1200],
    [50, 400],
    [9000, 5000],
  ]) {
    assert.equal(setting.set(value), expected);
    assert.equal(setting.get(), expected);
  }
});
