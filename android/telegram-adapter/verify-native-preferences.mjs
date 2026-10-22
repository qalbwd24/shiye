import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url),
  { chromium } = require(
    path.join(root, 'previews/telegram-chat/vendor/web-a/node_modules/playwright'),
  );
const app = path.join(root, 'tmp/android-input-refinement/telegram-build/assets/telegram');
const output = path.join(root, 'outputs/2026-10-17-android-input-refinement/telegram');
const nativeFile = path.join(
  root,
  `tmp/android-input-refinement/native-mock-${Date.now()}/preferences.json`,
);
await fs.mkdir(path.dirname(nativeFile), { recursive: true });
const report = {
  synthetic: true,
  nativeBackend: 'Node file mock of explicit load/commit contract; not Android LocalStore',
  androidVerified: false,
  checks: [],
  errors: [],
};
const check = (name, value) => {
  assert.ok(value, name);
  report.checks.push(name);
};
let commits = 0,
  failNext = false,
  holdCommit = false,
  releaseCommit,
  commitStarted;
async function load() {
  try {
    return JSON.parse(await fs.readFile(nativeFile, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--disable-gpu'],
});
const context = await browser.newContext({
  viewport: { width: 412, height: 780 },
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36',
  serviceWorkers: 'block',
});
await context.exposeBinding('nativePreferencesMock', async (_source, action, value) => {
  if (action === 'load') return load();
  if (action !== 'commit') throw Error('Unknown mock operation');
  commits += 1;
  if (failNext) {
    failNext = false;
    throw Error('Injected native commit failure');
  }
  if (holdCommit) {
    commitStarted?.();
    await new Promise((resolve) => {
      releaseCommit = resolve;
    });
  }
  const handle = await fs.open(nativeFile, 'w');
  try {
    await handle.writeFile(JSON.stringify(value));
    await handle.sync();
  } finally {
    await handle.close();
  }
  return load();
});
await context.addInitScript(() => {
  Object.defineProperty(navigator, 'platform', { get: () => 'Linux armv8l' });
  if (location.origin !== 'https://appassets.androidplatform.net') return;
  const seed = localStorage.getItem('nativeMockSeeded')
    ? Promise.resolve()
    : new Promise((resolve, reject) => {
        const q = indexedDB.open('shiye-android-telegram-v2', 1);
        q.onupgradeneeded = () => q.result.createObjectStore('preview');
        q.onerror = () => reject(q.error);
        q.onsuccess = () => {
          const db = q.result,
            t = db.transaction('preview', 'readwrite');
          t.objectStore('preview').put(
            { version: 1, pinIds: [], future: { keep: true } },
            'android-ui-preferences-v1',
          );
          t.oncomplete = () => {
            db.close();
            localStorage.setItem('shiye-android-pins-v1', '["-10"]');
            localStorage.setItem('nativeMockSeeded', '1');
            resolve();
          };
          t.onabort = () => reject(t.error);
        };
      });
  window.installNativePreferencesForTest = async () => {
    await seed;
    window.shiyeAndroidPreferences = {
      load: () => window.nativePreferencesMock('load'),
      commit: (value) => window.nativePreferencesMock('commit', value),
    };
    window.dispatchEvent(new Event('shiye-native-preferences-ready'));
  };
});
await context.route('**/*', async (route) => {
  const url = new URL(route.request().url());
  if (
    url.origin !== 'https://appassets.androidplatform.net' ||
    !url.pathname.startsWith('/telegram/')
  )
    return route.abort();
  const rel = decodeURIComponent(url.pathname.slice('/telegram/'.length));
  if (rel.includes('..')) return route.abort();
  const types = {
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.html': 'text/html',
    '.woff2': 'font/woff2',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.wasm': 'application/wasm',
  };
  try {
    await route.fulfill({
      body: await fs.readFile(path.join(app, rel || 'index.html')),
      contentType: types[path.extname(rel)] || 'application/octet-stream',
    });
  } catch {
    await route.fulfill({ status: 404, body: 'not found' });
  }
});
const page = await context.newPage();
page.on('pageerror', (error) => report.errors.push(error.message));
async function readLegacy() {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const q = indexedDB.open('shiye-android-telegram-v2', 1);
        q.onsuccess = () => {
          const db = q.result,
            r = db.transaction('preview').objectStore('preview').get('android-ui-preferences-v1');
          r.onsuccess = () => {
            db.close();
            resolve(r.result);
          };
          r.onerror = () => reject(r.error);
        };
      }),
  );
}
try {
  await page.goto('https://appassets.androidplatform.net/telegram/index.html');
  await page.waitForFunction(
    () => !!window.shiyeAndroidChat && !!window.installNativePreferencesForTest,
  );
  await page.evaluate(() => {
    window.flushBeforeNativeResolved = false;
    window.pendingNativeFlush = window.shiyeAndroidChat.flush().then(() => {
      window.flushBeforeNativeResolved = true;
    });
  });
  report.waiting = await page.evaluate(() => ({
    snapshot: window.shiyeAndroidChat.snapshot(),
    resolved: window.flushBeforeNativeResolved,
  }));
  check(
    'no native API means not ready and no successful flush fallback',
    !report.waiting.snapshot.preferencesReady && !report.waiting.resolved && commits === 0,
  );
  await page.evaluate(() => window.installNativePreferencesForTest());
  await page.evaluate(() => window.pendingNativeFlush);
  await page.waitForFunction(() => window.shiyeAndroidChat.ready);
  report.migrated = await load();
  check(
    'late native-ready event enables one-time migration',
    commits === 1 && report.migrated.future.keep,
  );
  check(
    'existing empty IDB array wins over stale localStorage during migration',
    report.migrated.pinIds.length === 0,
  );
  const legacyBefore = JSON.stringify(await readLegacy());
  report.concurrent = await page.evaluate(async () => {
    await Promise.all([
      window.shiyeAndroidChat.togglePin('-10'),
      window.shiyeAndroidChat.togglePin('-20'),
      window.shiyeAndroidChat.togglePin('-10'),
    ]);
    return window.shiyeAndroidChat.pinIds();
  });
  check('queued mutations preserve serial order', JSON.stringify(report.concurrent) === '["-20"]');
  holdCommit = true;
  const started = new Promise((resolve) => {
    commitStarted = resolve;
  });
  await page.evaluate(() => {
    window.pinResolved = false;
    window.flushResolved = false;
    window.pendingPin = window.shiyeAndroidChat.togglePin('-30').then(() => {
      window.pinResolved = true;
    });
    window.pendingFlush = window.shiyeAndroidChat.flush().then(() => {
      window.flushResolved = true;
    });
  });
  await started;
  report.pending = await page.evaluate(() => ({
    pinResolved: window.pinResolved,
    flushResolved: window.flushResolved,
    cache: localStorage.getItem('shiye-android-pins-v1'),
    pins: window.shiyeAndroidChat.pinIds(),
  }));
  check(
    'toggle and flush wait for the native commit ACK without publishing cache',
    !report.pending.pinResolved &&
      !report.pending.flushResolved &&
      report.pending.cache === '["-20"]',
  );
  holdCommit = false;
  releaseCommit();
  await page.evaluate(() => Promise.all([window.pendingPin, window.pendingFlush]));
  check('ACK publishes the committed native value', (await load()).pinIds[0] === '-30');
  failNext = true;
  report.failedCommit = await page.evaluate(async () => {
    const before = localStorage.getItem('shiye-android-pins-v1');
    let pinRejected = false,
      flushRejected = false;
    try {
      await window.shiyeAndroidChat.togglePin('-30');
    } catch {
      pinRejected = true;
    }
    try {
      await window.shiyeAndroidChat.flush();
    } catch {
      flushRejected = true;
    }
    return {
      pinRejected,
      flushRejected,
      cacheSame: before === localStorage.getItem('shiye-android-pins-v1'),
    };
  });
  check(
    'native failure rejects both mutation and flush while preserving cache',
    report.failedCommit.pinRejected &&
      report.failedCommit.flushRejected &&
      report.failedCommit.cacheSame,
  );
  await page.evaluate(() => window.shiyeAndroidChat.togglePin('-30'));
  check('explicit retry recovers queue', (await load()).pinIds.join(',') === '-20');
  check(
    'post-migration pin writes never modify the legacy IDB key',
    legacyBefore === JSON.stringify(await readLegacy()),
  );
  await page.evaluate(async () => {
    await window.shiyeAndroidChat.togglePin('-20');
    localStorage.setItem('shiye-android-pins-v1', '["-10"]');
  });
  const beforeReloadCommits = commits;
  await page.reload();
  await page.waitForFunction(
    () => !!window.installNativePreferencesForTest && !!window.shiyeAndroidChat,
  );
  await page.evaluate(() => window.installNativePreferencesForTest());
  await page.waitForFunction(() => window.shiyeAndroidChat.ready);
  check(
    'native empty preference remains authoritative on reload without remigration',
    commits === beforeReloadCommits &&
      (await page.evaluate(() => window.shiyeAndroidChat.pinIds().length)) === 0,
  );
  await page.locator('#LeftColumn a[href="#-10"]').click();
  await page.waitForFunction(() => !!document.querySelector('#editable-message-text')?.editor);
  report.draft = await page.evaluate(async () => {
    const editor = document.querySelector('#editable-message-text').editor;
    editor.commands.setContent({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '原生桥  草稿' }] },
        { type: 'paragraph' },
        { type: 'paragraph', content: [{ type: 'text', text: '第三段　中文' }] },
      ],
    });
    const text = editor.getText({ blockSeparator: '\n' });
    return { text, ack: await window.shiyeAndroidChat.flush() };
  });
  check(
    'native preference bridge preserves semantic multiline draft flush',
    report.draft.ack.flushed && report.draft.text === '原生桥  草稿\n\n第三段　中文',
  );
  check('native record preserves migrated unknown fields', (await load()).future.keep);
  check('no page errors', report.errors.length === 0);
} catch (error) {
  report.failure = error.stack;
  process.exitCode = 1;
} finally {
  await browser.close();
}
await fs.writeFile(
  path.join(output, 'native-preferences-mock-check.json'),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report));
