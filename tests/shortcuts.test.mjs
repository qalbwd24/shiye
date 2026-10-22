import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  match,
  chord,
  conflicts,
  commands,
  effectiveShortcuts,
  pausedShortcut,
} from '../public/shared/hotkeys.js';

import { fixture } from './helpers.mjs';
test('only datetime runs by default even with old bindings; standard editing and IME remain available', () => {
  const saved = { new: 'F2', datetime: 'F8', bold: 'Ctrl+B', search: 'J' };
  const active = effectiveShortcuts(saved);
  assert.deepEqual(
    Object.entries(active).filter(([, key]) => key),
    [['datetime', 'Alt+T']],
  );
  assert.equal(match({ key: 't', code: 'KeyT', altKey: true }, active, true, true).id, 'datetime');
  assert.equal(match({ key: 't', code: 'KeyT', altKey: true }, active, false, true), undefined);
  for (const key of ['F2', 'F8', 'F9']) assert.equal(match({ key }, active, true, true), undefined);
  for (const c of commands.filter((c) => c.id !== 'datetime' && c.default !== 'Tab')) {
    const bits = c.default.split('+'),
      key = bits.at(-1);
    assert.equal(
      pausedShortcut(
        {
          key,
          ctrlKey: bits.includes('Ctrl'),
          altKey: bits.includes('Alt'),
          shiftKey: bits.includes('Shift'),
        },
        saved,
      ),
      true,
      c.id,
    );
  }
  assert.equal(pausedShortcut({ key: 'ArrowUp', altKey: true }, saved), true);
  assert.equal(pausedShortcut({ key: 'F8' }, saved), true);
  for (const key of ['a', 'c', 'v', 'x', 'z', 'y'])
    assert.equal(pausedShortcut({ key, ctrlKey: true }, saved), false);
  for (const key of ['j', 'Tab', 'Enter', 'ArrowUp', 'Escape'])
    assert.equal(pausedShortcut({ key }, saved), false);
  assert.equal(pausedShortcut({ key: 'b', ctrlKey: true, isComposing: true }, saved), false);
  assert.equal(pausedShortcut({ key: 'b', ctrlKey: true }, saved, true), false);
  assert.equal(effectiveShortcuts(saved, true), saved);
  assert.equal(saved.datetime, 'F8');
});

test('enabling extra shortcuts is explicit and reversible without erasing stored bindings', async (t) => {
  const { request } = await fixture(t);
  await request('/api/settings', 'PUT', { shortcuts: { new: 'F2' } });
  for (const enabled of [true, false]) {
    assert.equal(
      (await request('/api/preferences', 'PUT', { extendedShortcuts: enabled })).status,
      200,
    );
    const library = await (await request('/api/library')).json();
    assert.equal(library.settings.preferences.extendedShortcuts, enabled);
    assert.equal(library.settings.shortcuts.new, 'F2');
  }
  assert.equal(
    (await request('/api/preferences', 'PUT', { extendedShortcuts: 'yes' })).status,
    400,
  );
});
test('shortcut scopes, IME, disabled keys and conflicts', () => {
  const key = { key: 'Tab', code: 'Tab' };
  assert.equal(match(key, {}, true, true).id, 'indent');
  assert.equal(match(key, {}, false, true), undefined);
  assert.equal(match(key, { indent: null }, true, true), undefined);
  assert.equal(match({ key: 'Shift' }, { indent: null }, true, true), undefined);
  assert.equal(match({ ...key, isComposing: true }, {}, true, true), undefined);
  assert.equal(chord({ key: 't', code: 'KeyT', altKey: true }), 'Alt+T');
  assert.equal(match({ key: 'F8', code: 'F8' }, { datetime: 'F8' }, true, true).id, 'datetime');
  assert.equal(conflicts('Ctrl+S', 'datetime', {})[0].id, 'save');
});
test('shortcut settings persist and reject unknown commands', async (t) => {
  const { request, dir } = await fixture(t);
  const r = await request('/api/settings', 'PUT', {
    shortcuts: { datetime: 'F8', indent: null, stats: 'Alt+S' },
  });
  assert.equal(r.status, 200);
  const disk = JSON.parse(await fs.readFile(path.join(dir, 'diary.json'), 'utf8'));
  assert.equal(disk.settings.shortcuts.datetime, 'F8');
  assert.equal(disk.settings.shortcuts.indent, null);
  assert.equal(
    (await request('/api/settings', 'PUT', { shortcuts: { invalid: 'F2' } })).status,
    400,
  );
});
