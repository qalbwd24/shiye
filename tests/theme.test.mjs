import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createThemeController } from '../public/features/theme.js';

test('system colors update live; manual and quick choices win; preview cancellation restores inheritance', () => {
  const listeners = new Set();
  const mediaQuery = {
    matches: false,
    addEventListener: (_, handler) => listeners.add(handler),
    removeEventListener: (_, handler) => listeners.delete(handler),
  };
  const root = { dataset: {}, style: {} };
  const notifications = [];
  const controller = createThemeController({
    root,
    mediaQuery,
    notify: (t) => notifications.push(t),
  });
  const os = (dark) => {
    mediaQuery.matches = dark;
    for (const listener of listeners) listener();
  };
  controller.apply();
  assert.equal(root.dataset.theme, 'light');
  os(true);
  assert.equal(root.dataset.theme, 'dark');
  assert.equal(root.style.colorScheme, 'dark');
  controller.apply('light');
  os(false);
  os(true);
  assert.equal(root.dataset.theme, 'light');
  controller.apply('light', 'system');
  assert.equal(root.dataset.theme, 'dark');
  os(false);
  assert.equal(root.dataset.theme, 'light');
  controller.apply('system', 'dark');
  os(false);
  assert.equal(root.dataset.theme, 'dark');
  controller.apply('system', 'inherit');
  assert.equal(root.dataset.theme, 'light');
  assert.equal(listeners.size, 1);
  assert.equal(notifications.at(-1), 'light');
  controller.dispose();
  assert.equal(listeners.size, 0);
});
