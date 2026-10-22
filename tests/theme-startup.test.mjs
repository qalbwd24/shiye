import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { fixture, sample } from './helpers.mjs';
import { startupTheme } from '../public/shared/theme.js';

test('startup theme resolves independent quick choice with strict public enum', () => {
  assert.equal(startupTheme(), 'system');
  assert.equal(startupTheme(null), 'system');
  assert.equal(startupTheme({ theme: 'dark', quickAppearance: { theme: 'light' } }), 'dark');
  assert.equal(startupTheme({ theme: 'dark', quickAppearance: { theme: 'light' } }, true), 'light');
  assert.equal(
    startupTheme({ theme: 'dark', quickAppearance: { theme: 'inherit' } }, true),
    'dark',
  );
  assert.equal(startupTheme({ theme: '"><script>alert(1)</script>' }), 'system');
});

test('head boot colors the document synchronously, follows OS while loading and hands listener off', async () => {
  const script = await readFile(new URL('../public/theme-start.js', import.meta.url), 'utf8');
  for (const [choice, osDark, expected] of [
    ['dark', false, 'dark'],
    ['light', true, 'light'],
    ['system', true, 'dark'],
  ]) {
    const root = { dataset: { themePreference: choice }, style: {} };
    let changed, mounted;
    const query = {
      matches: osDark,
      addEventListener: (_, listener) => {
        changed = listener;
      },
      removeEventListener: (_, listener) => {
        assert.equal(listener, changed);
        changed = null;
      },
    };
    const messages = [];
    runInNewContext(script, {
      document: {
        documentElement: root,
        addEventListener: (_, listener) => {
          mounted = listener;
        },
      },
      window: {
        matchMedia: () => query,
        chrome: { webview: { postMessage: (m) => messages.push(m) } },
      },
    });
    assert.equal(root.dataset.theme, expected);
    assert.equal(root.style.colorScheme, expected);
    assert.equal(messages.at(-1).value, expected);
    query.matches = !osDark;
    changed();
    assert.equal(root.dataset.theme, choice === 'system' ? 'light' : expected);
    mounted();
    assert.equal(changed, null);
  }
});

test('fresh HTML contains current theme before assets, including locked startup without diary disclosure', async (t) => {
  const { request, base } = await fixture(t);
  await request('/api/entries', 'POST', { ...sample, title: 'PRIVATE-STARTUP-SENTINEL' });
  await request('/api/preferences', 'PUT', { theme: 'dark', quickAppearance: { theme: 'light' } });
  const main = await request('/');
  const html = await main.text();
  assert.equal(main.headers.get('cache-control'), 'no-store');
  assert.match(html, /data-theme-preference="dark"/);
  assert.ok(html.indexOf('/theme-start.js') < html.indexOf('/style.css'));
  assert.doesNotMatch(html, /PRIVATE-STARTUP-SENTINEL/);
  assert.match(await (await request('/?quick=1')).text(), /<body class="quick-capture">/);
  assert.match(
    await (await request('/index.html?quick=1')).text(),
    /data-theme-preference="light"/,
  );
  const setup = await request('/api/access', 'PUT', { password: 'isolated-theme-lock-only' });
  assert.equal(setup.status, 200);
  assert.equal((await request('/api/library')).status, 401);
  assert.deepEqual(await (await request('/startup-theme.json?quick=1')).json(), { theme: 'light' });
  assert.match(await (await request('/')).text(), /data-theme-preference="dark"/);
  assert.equal(await (await fetch(base + '/startup-theme.json', { method: 'HEAD' })).text(), '');
});
