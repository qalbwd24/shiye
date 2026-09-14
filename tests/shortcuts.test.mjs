import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { match, chord, conflicts } from '../public/shared/hotkeys.js';

import { fixture } from './helpers.mjs';
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
