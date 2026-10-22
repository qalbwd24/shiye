import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  pageKind,
  endpoint,
  variables,
  checkedOverrides,
  replaceVariables,
  injectionExpression,
  STYLE_ID,
  SHADOW_STYLE_ID,
  SOURCES,
  EXTRA_SOURCES,
  Cdp,
  validValue,
  variableControl,
  previewCss,
  layeredPreviewCss,
  hasOwnedForward,
} from './core.mjs';

test('forward cleanup tolerates reconnect loss and refuses reused or other-device ports', () => {
  const listing =
    'emulator-5554 tcp:61000 localabstract:webview_devtools_remote_2273\r\nphone tcp:61001 localabstract:webview_devtools_remote_14851\n';
  assert.equal(hasOwnedForward(listing, 'emulator-5554', '2273', '61000'), true);
  assert.equal(hasOwnedForward('', 'emulator-5554', '14851', '61881'), false);
  assert.equal(hasOwnedForward(listing, 'emulator-5554', '14851', '61000'), false);
  assert.equal(hasOwnedForward(listing, 'emulator-5554', '14851', '61001'), false);
});

test('target and endpoint restrictions reject unrelated origins, paths and remote endpoints', () => {
  assert.equal(pageKind('https://appassets.androidplatform.net/editor.html?id=private'), 'editor');
  assert.equal(pageKind('https://appassets.androidplatform.net/telegram/index.html'), 'chat');
  for (const url of [
    'http://appassets.androidplatform.net/editor.html',
    'https://example.com/editor.html',
    'https://appassets.androidplatform.net/editor.html/no',
    'about:blank',
  ])
    assert.equal(pageKind(url), null);
  assert.equal(
    endpoint('ws://localhost/devtools/page/abc', 19280),
    'ws://127.0.0.1:19280/devtools/page/abc',
  );
  for (const url of [
    'ws://example.com/devtools/page/a',
    'ws://localhost/json',
    'ws://user@localhost/devtools/page/a',
    'ws://localhost/devtools/page/a?x=1',
    'wss://localhost/devtools/page/a',
  ])
    assert.throws(() => endpoint(url, 19280));
});
test('variable control cannot inject CSS or modify unknown / non-root declarations', () => {
  const css =
    ':root { --ink: #fff; --body-size: 18px; --font-family: test; } body { --ink: #123; }';
  assert.deepEqual(variables(css), { '--ink': '#fff', '--body-size': '18px' });
  assert.throws(() =>
    checkedOverrides(css, { '--ink': 'red; background:url(https://example.com)' }),
  );
  assert.throws(() => checkedOverrides(css, { '--new': '#fff' }));
  assert.throws(() => checkedOverrides(css, { '--font-family': '#fff' }));
  assert.throws(() => checkedOverrides(css, { '--body-size': '100px' }));
  assert.equal(
    replaceVariables(css, { '--ink': '#123456' }),
    ':root { --ink: #123456; --body-size: 18px; --font-family: test; } body { --ink: #123; }',
  );
});
test('temporary overlay outranks normal inline preferences without changing source or saved values', () => {
  const css = ':root { --body-size: 18px; --ink: #111; } body { font-size:var(--body-size); }';
  assert.equal(
    previewCss(css, { '--body-size': '24px' }),
    css + '\n:root{--body-size:24px!important;}',
  );
  assert.equal(
    previewCss(css, { '--ink': '#fff', '--body-size': '24px' }),
    css + '\n:root{--ink:#fff!important;--body-size:24px!important;}',
  );
  assert.equal(previewCss(css, {}), css);
  const saved = replaceVariables(css, { '--body-size': '24px' });
  assert.equal(
    saved,
    ':root { --body-size: 24px; --ink: #111; } body { font-size:var(--body-size); }',
  );
  assert.equal(saved.includes('!important'), false);
  assert.throws(() => previewCss(css, { '--body-size': '24px!important' }));
  assert.throws(() => previewCss(css, { '--unknown': '#fff' }));
});
test('019 layers are separate allowlisted reads and editor overrides write only the base', () => {
  assert.equal(SOURCES.editor, 'android/app/src/main/assets/editor.css');
  assert.equal(EXTRA_SOURCES.editor, 'android/ui-refinement-019/editor.css');
  assert.equal(EXTRA_SOURCES.chat, 'android/qq-chat/view.css');
  const base = ':root { --body-size: 18px; }';
  const overlay = '.entry-context-header { position: sticky; }';
  assert.equal(
    layeredPreviewCss(base, overlay, { '--body-size': '20px' }),
    base + '\n' + overlay + '\n:root{--body-size:20px!important;}',
  );
  assert.equal(replaceVariables(base, { '--body-size': '20px' }), ':root { --body-size: 20px; }');
  assert.throws(() => layeredPreviewCss(base, ':root{--new:#fff}', { '--new': '#000' }));
});
test('list size tokens accept only integer pixels in their explicit ranges', () => {
  const fields = [
    ['--shiye-list-avatar-size', 40, 56, 50],
    ['--shiye-list-title-size', 14, 22, 16],
    ['--shiye-list-preview-size', 12, 18, 14],
    ['--shiye-list-time-size', 10, 14, 11],
    ['--body-size', 8, 40, 16],
  ];
  const css =
    ':root{' +
    fields.map(([name, , , initial]) => `${name}:${initial}px;`).join('') +
    '--ink:#fff;--other-size:14px;}';
  const parsed = variables(css);
  for (const [name, min, max, initial] of fields) {
    assert.equal(parsed[name], `${initial}px`);
    assert.deepEqual(variableControl(name), { type: 'number', min, max, step: 1, unit: 'px' });
    for (const value of [`${min}px`, `${max}px`]) assert.equal(validValue(name, value), true);
    for (const value of [
      `${min - 1}px`,
      `${max + 1}px`,
      '14.5px',
      '14em',
      '14',
      '14px; color:red',
      '#fff',
      'calc(14px)',
    ])
      assert.equal(validValue(name, value), false, `${name}: ${value}`);
    assert.equal(checkedOverrides(css, { [name]: `${max}px` })[name], `${max}px`);
    assert.match(replaceVariables(css, { [name]: `${min}px` }), new RegExp(`${name}:${min}px;`));
  }
  assert.equal(parsed['--other-size'], undefined);
  assert.deepEqual(variableControl('--ink'), { type: 'text', unit: '' });
  assert.throws(() => checkedOverrides(css, { '--ink': '16px' }));
});
function page(kind = 'editor', withShadow = false) {
  const nodes = new Map();
  const shadowNodes = new Map();
  const shadow = {
    getElementById(id) {
      return shadowNodes.get(id);
    },
    querySelectorAll(selector) {
      return shadowNodes.has(selector.slice(1)) ? [shadowNodes.get(selector.slice(1))] : [];
    },
    append(element) {
      shadowNodes.set(element.id, element);
    },
    ownerDocument: {
      createElement() {
        return {
          dataset: {},
          textContent: '',
          remove() {
            shadowNodes.delete(this.id);
          },
        };
      },
    },
  };
  const frame = {
    contentWindow: { location: { origin: 'https://appassets.androidplatform.net' } },
    contentDocument: {
      querySelector: (selector) => (selector === '#qq-frame-root' ? { shadowRoot: shadow } : null),
    },
  };
  const context = vm.createContext({
    location: {
      origin: 'https://appassets.androidplatform.net',
      pathname: kind === 'chat' ? '/telegram/index.html' : '/editor.html',
    },
    document: {
      querySelector: (selector) =>
        withShadow && selector === '#shiye-qq-chat iframe' ? frame : null,
      head: {
        append(element) {
          nodes.set(element.id, element);
        },
      },
      createElement() {
        return {
          dataset: {},
          textContent: '',
          remove() {
            nodes.delete(this.id);
          },
        };
      },
      getElementById(id) {
        return nodes.get(id);
      },
      querySelectorAll(selector) {
        return nodes.has(selector.slice(1)) ? [nodes.get(selector.slice(1))] : [];
      },
    },
  });
  return {
    nodes,
    shadowNodes,
    context,
    inject: (owner, css, enabled = true, shadowCss = '') =>
      vm.runInContext(
        injectionExpression({ kind, owner, css, shadowCss, enabled, sourceHash: css }),
        context,
      ),
  };
}
test('actual generated expression deduplicates, preserves node, rejects foreign owner and restores original CSS', () => {
  const p = page();
  p.inject('session-a', 'body{color:red}');
  const original = p.nodes.get(STYLE_ID);
  p.inject('session-a', 'body{color:blue}');
  assert.equal(p.nodes.size, 1);
  assert.equal(p.nodes.get(STYLE_ID), original);
  assert.equal(original.textContent, 'body{color:blue}');
  assert.throws(() => p.inject('session-b', 'body{}'), /Another preview session/);
  p.inject('session-a', '', false);
  assert.equal(p.nodes.size, 0);
  p.context.location.origin = 'https://example.com';
  assert.throws(() => p.inject('session-a', 'body{}'), /Page changed/);
});
test('QQ shadow style is independently owned, updated and removed without touching package link', () => {
  const p = page('chat', true);
  p.inject('session-a', 'body{color:red}', true, '.qq-shell{color:blue}');
  assert.equal(p.nodes.size, 1);
  assert.equal(p.shadowNodes.size, 1);
  const injected = p.shadowNodes.get(SHADOW_STYLE_ID);
  assert.equal(injected.textContent, '.qq-shell{color:blue}');
  p.inject('session-a', 'body{color:red}', true, '.qq-shell{color:green}');
  assert.equal(p.shadowNodes.get(SHADOW_STYLE_ID), injected);
  assert.throws(
    () => p.inject('session-b', 'body{}', true, '.qq-shell{}'),
    /Another preview session/,
  );
  p.inject('session-a', '', false);
  assert.equal(p.nodes.size, 0);
  assert.equal(p.shadowNodes.size, 0);
  const noFrame = page('chat');
  const result = noFrame.inject('session-a', 'body{}', true, '.qq-shell{}');
  assert.equal(result.shadow, false);
  noFrame.inject('session-a', '', false);
});
test('same-owner document rebuild reinjects and CDP disconnect rejects in-flight requests', async () => {
  const p = page();
  p.inject('session-a', 'body{}');
  p.nodes.clear();
  p.inject('session-a', 'body{}');
  assert.equal(p.nodes.size, 1);
  class Socket extends EventTarget {
    readyState = WebSocket.OPEN;
    send(value) {
      this.sent = JSON.parse(value);
    }
    close() {
      this.dispatchEvent(new Event('close'));
    }
  }
  const ws = new Socket();
  const cdp = new Cdp(ws);
  const result = cdp.send('Runtime.evaluate', {});
  ws.dispatchEvent(
    new MessageEvent('message', { data: JSON.stringify({ id: ws.sent.id, result: { ok: true } }) }),
  );
  assert.deepEqual(await result, { ok: true });
  const pending = cdp.send('Page.captureScreenshot');
  ws.close();
  await assert.rejects(pending, /disconnected/);
});

test('real local control server rejects foreign Origin/token and stops cleanly without ADB', async () => {
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(new URL('./preview.mjs', import.meta.url)),
      '--serial',
      'synthetic-device',
      '--adb',
      '__shiye_preview_deliberately_nonexistent_adb__',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  );
  let output = '';
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const finished = new Promise((resolve) =>
    child.once('exit', (code, signal) => resolve({ code, signal })),
  );
  try {
    const origin = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error('Local server startup timed out: ' + stderr)),
        5000,
      );
      child.stdout.on('data', (chunk) => {
        output += chunk;
        const url = output.match(/Control: (http:\/\/127\.0\.0\.1:\d+)\//);
        if (url) {
          clearTimeout(timer);
          resolve(url[1]);
        }
      });
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    const html = await (await fetch(origin)).text();
    const token = html.match(/const token = '([\da-f]+)'/)[1];
    const bad = await fetch(origin + '/enabled', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://example.com',
        'X-Preview-Token': token,
      },
      body: '{"enabled":false}',
    });
    assert.equal(bad.status, 403);
    const noToken = await fetch(origin + '/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: '{}',
    });
    assert.equal(noToken.status, 403);
    const invalid = await fetch(origin + '/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin, 'X-Preview-Token': token },
      body: JSON.stringify({ kind: 'unknown', values: {} }),
    });
    assert.equal(invalid.status, 409);
    const stop = await fetch(origin + '/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin, 'X-Preview-Token': token },
      body: '{}',
    });
    assert.equal(stop.status, 200);
    const result = await Promise.race([
      finished,
      new Promise((_, reject) => {
        const t = setTimeout(() => reject(Error('Tool failed to exit')), 5000);
        t.unref();
      }),
    ]);
    assert.equal(result.code, 0, stderr);
    assert.match(output, /owned forwards removed/);
  } finally {
    if (child.exitCode === null) child.kill();
  }
});
