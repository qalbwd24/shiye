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
const baseline = process.argv.includes('--baseline');
const app = path.join(
  root,
  baseline
    ? 'tmp/android-frontend-v2/telegram-build/assets/telegram'
    : 'tmp/android-input-refinement/telegram-build/assets/telegram',
);
const output = path.join(root, 'outputs/2026-10-17-android-input-refinement/telegram');
await fs.mkdir(output, { recursive: true });
const report = { baseline, synthetic: true, phoneOrAvd: false, checks: [], errors: [] };
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
await context.addInitScript(() =>
  Object.defineProperty(navigator, 'platform', { get: () => 'Linux armv8l' }),
);
await context.route('**/*', async (route) => {
  const url = new URL(route.request().url());
  if (
    url.origin !== 'https://appassets.androidplatform.net' ||
    !url.pathname.startsWith('/telegram/')
  )
    return route.abort();
  const relative = decodeURIComponent(url.pathname.slice('/telegram/'.length));
  if (relative.includes('..')) return route.abort();
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
      body: await fs.readFile(path.join(app, relative || 'index.html')),
      contentType: types[path.extname(relative)] || 'application/octet-stream',
    });
  } catch {
    await route.fulfill({ status: 404, body: 'not found' });
  }
});
const page = await context.newPage();
page.on('pageerror', (e) => report.errors.push(e.message));
try {
  await page.goto('https://appassets.androidplatform.net/telegram/index.html');
  await page.waitForFunction(() => window.shiyeAndroidChat?.ready);
  await page.locator('#LeftColumn a[href="#-10"]').click();
  const input = page.locator('#editable-message-text');
  await input.waitFor();
  await input.click();
  await page.keyboard.insertText('第一段  双空格');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.insertText('第二段中文');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.insertText('第三段　全角空格');
  report.dom = await input.evaluate((e) => ({
    html: e.innerHTML,
    text: e.textContent,
    innerText: e.innerText,
    editor: !!e.editor,
    semanticText: e.editor?.getText({ blockSeparator: '\n' }),
    doc: e.editor?.getJSON?.(),
    pmKeys: Object.keys(e).filter((k) => k.startsWith('pm')),
    viewText: e.pmViewDesc?.view?.state?.doc?.textBetween(
      0,
      e.pmViewDesc.view.state.doc.content.size,
      '\n',
      '\n',
    ),
  }));
  try {
    report.flush = await page.evaluate(() => window.shiyeAndroidChat.flush());
  } catch (err) {
    report.flushError = err.message;
  }
  report.stored = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const q = indexedDB.open('shiye-android-telegram-v2', 1);
        q.onerror = () => reject(q.error);
        q.onsuccess = () => {
          const db = q.result,
            r = db.transaction('preview').objectStore('preview').get('library');
          r.onsuccess = () => {
            db.close();
            resolve(r.result?.dialogs.active.find((d) => d.id === '-10')?.draft?.message);
          };
          r.onerror = () => reject(r.error);
        };
      }),
  );
  if (!baseline) {
    const check = (name, value) => {
      assert.ok(value, name);
      report.checks.push(name);
    };
    check(
      'multiline flush returns a successful transaction ACK',
      report.flush?.flushed && !report.flushError,
    );
    check(
      'hardBreak text equals persisted draft character for character',
      report.stored === report.dom.semanticText,
    );
    check(
      'double spaces and fullwidth space are retained',
      report.stored.includes('第一段  双空格') && report.stored.includes('第三段　全角空格'),
    );
    check(
      'blank line and real trailing hardBreak are retained',
      report.stored.includes('第二段中文\n\n第三段') && report.stored.endsWith('\n'),
    );
    check('presentation-only trailingBreak is excluded', report.dom.innerText !== report.stored);
    check('no page errors', report.errors.length === 0);
  }
  await page.screenshot({
    path: path.join(output, baseline ? 'draft-baseline.png' : 'draft-fixed.png'),
  });
} catch (err) {
  report.failure = err.stack;
  process.exitCode = 1;
} finally {
  await browser.close();
}
await fs.writeFile(
  path.join(output, baseline ? 'draft-baseline.json' : 'refinement-check.json'),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report));
