import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url),
  { chromium } = require(
    path.join(root, 'previews/telegram-chat/vendor/web-a/node_modules/playwright'),
  );
const app = path.join(root, 'tmp/android-frontend-v2/telegram-build/assets/telegram');
const output = path.join(root, 'outputs/2026-10-17-android-frontend-v2/telegram');
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
const report = {
  synthetic: true,
  androidWebView: false,
  errors: [],
  requests: [],
  missing: [],
  checks: [],
};
const context = await browser.newContext({
  viewport: { width: 412, height: 780 },
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36',
  serviceWorkers: 'block',
});
await context.addInitScript(() =>
  Object.defineProperty(navigator, 'platform', { get: () => 'Linux armv8l' }),
);
// Simulate the actual fresh-WebView race: a rendered page can precede the worker's
// BroadcastChannel listener. Drop only read-only probes, never a real mutation.
await context.addInitScript(() => {
  const Original = BroadcastChannel;
  const status = {
    droppedProbes: 0,
    handshakeObserved: false,
    mutations: [],
    mutationsBeforeHandshake: 0,
  };
  window.shiyeTransportTest = status;
  window.BroadcastChannel = class extends Original {
    constructor(name) {
      super(name);
      this.roomCommands = name === 'shiye-local-rooms';
      if (this.roomCommands)
        this.addEventListener('message', ({ data }) => {
          if (Array.isArray(data?.rooms)) status.handshakeObserved = true;
        });
    }
    postMessage(data) {
      if (this.roomCommands && data.action === 'list' && status.droppedProbes < 5) {
        status.droppedProbes += 1;
        return;
      }
      if (this.roomCommands && data.action !== 'list') {
        status.mutations.push(data.action);
        if (!status.handshakeObserved) status.mutationsBeforeHandshake += 1;
      }
      return super.postMessage(data);
    }
  };
});
await context.route('**/*', async (route) => {
  const u = new URL(route.request().url());
  report.requests.push(u.origin + u.pathname);
  if (u.origin !== 'https://appassets.androidplatform.net' || !u.pathname.startsWith('/telegram/'))
    return route.abort();
  const relative = decodeURIComponent(u.pathname.slice('/telegram/'.length));
  if (relative.includes('..')) return route.abort();
  const file = path.join(app, relative || 'index.html');
  const types = {
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.html': 'text/html',
    '.json': 'application/json',
    '.woff2': 'font/woff2',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.wasm': 'application/wasm',
    '.webmanifest': 'application/manifest+json',
  };
  try {
    await route.fulfill({
      body: await fs.readFile(file),
      contentType: types[path.extname(file)] || 'application/octet-stream',
    });
  } catch {
    report.missing.push(relative);
    await route.fulfill({ status: 404, body: 'not found' });
  }
});
const page = await context.newPage();
page.on('pageerror', (e) => report.errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') report.errors.push(m.text().slice(0, 300));
});
try {
  await page.goto('https://appassets.androidplatform.net/telegram/index.html');
  await page.waitForFunction(() => !!window.shiyeAndroidChat);
  report.earlyFlush = await page.evaluate(async () => {
    const before = window.shiyeAndroidChat.snapshot();
    const result = await window.shiyeAndroidChat.flush();
    return {
      before,
      result,
      after: window.shiyeAndroidChat.snapshot(),
      transport: window.shiyeTransportTest,
    };
  });
  if (
    report.earlyFlush.transport.droppedProbes !== 5 ||
    report.earlyFlush.transport.mutationsBeforeHandshake !== 0 ||
    report.earlyFlush.transport.mutations.filter((action) => action === 'flush').length !== 1 ||
    !report.earlyFlush.after.transportReady
  )
    throw new Error('Fresh-WebView transport handshake failed');
  await page.waitForSelector('#LeftMainHeader', { timeout: 45000 });
  await page.waitForTimeout(1500);
  report.snapshot = await page.evaluate(() => ({
    snapshot: window.shiyeAndroidChat?.snapshot(),
    body: document.body.className,
    main: document.querySelector('#Main')?.className,
    globals: typeof window.getActions,
    roomLinks: [...document.querySelectorAll('#LeftColumn a')]
      .map((e) => ({ text: e.innerText.slice(0, 80), href: e.getAttribute('href') }))
      .slice(0, 8),
  }));
  await page.screenshot({ path: path.join(output, 'mobile-list.png') });
  await fs.writeFile(path.join(output, 'mobile-dom.txt'), await page.locator('body').innerText());
  const rooms = await page.evaluate(() => window.shiyeAndroidChat.command('list'));
  report.rooms = rooms.rooms.map((r) => ({ id: r.id, title: r.title }));
  await page.locator(`#LeftColumn a[href="#${rooms.rooms[0].id}"]`).click();
  await page.waitForSelector('#editable-message-text', { timeout: 15000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(output, 'mobile-chat.png') });
  report.chat = await page.evaluate(() => ({
    snapshot: window.shiyeAndroidChat.snapshot(),
    main: document.querySelector('#Main')?.className,
    buttons: [...document.querySelectorAll('#MiddleColumn button')]
      .map((b) => ({ class: b.className, label: b.getAttribute('aria-label'), title: b.title }))
      .slice(0, 20),
  }));
  report.layout = await page.evaluate(() => ({
    firstBubble: document.querySelector('.message-content')?.getBoundingClientRect().height,
    markdown: document.querySelector('.shiye-markdown')?.getBoundingClientRect().height,
    header: document.querySelector('.shiye-android-header')?.getBoundingClientRect().height,
  }));
  await page.locator('#editable-message-text').fill('Android local synthetic saved message');
  await page.locator('#MiddleColumn button.send').click();
  await page.waitForFunction(
    () => document.querySelector('#editable-message-text')?.textContent === '',
  );
  report.flush = await page.evaluate(() => window.shiyeAndroidChat.flush());
  await page
    .locator('#editable-message-text')
    .pressSequentially('Android local synthetic unsent draft');
  report.draftFlush = await page.evaluate(() => window.shiyeAndroidChat.flush());
  report.drafts = await page.evaluate(() =>
    Object.values(window.getGlobal().messages.byChatId).flatMap((data) =>
      Object.values(data.threadsById || {})
        .filter((t) => t.draft)
        .map((t) => ({ isLocal: t.draft.isLocal, text: t.draft.text?.text })),
    ),
  );
  await page.evaluate(() => window.shiyeAndroidChat.togglePin('-10'));
  report.pins = await page.evaluate(() => window.shiyeAndroidChat.pinIds());
  report.back = await page.evaluate(() => window.shiyeAndroidChat.back());
  await page.waitForTimeout(350);
  report.backSnapshot = await page.evaluate(() => window.shiyeAndroidChat.snapshot());
  await page.reload();
  await page.waitForSelector('#LeftMainHeader');
  await page.waitForTimeout(800);
  report.reopen = await page.evaluate(() => ({
    snapshot: window.shiyeAndroidChat.snapshot(),
    pins: window.shiyeAndroidChat.pinIds(),
    date: document.querySelector('#LeftColumn .time')?.textContent,
  }));
  await page.locator('#LeftColumn a[href="#-10"]').click();
  await page.waitForSelector('#editable-message-text');
  report.restoredDraft = await page.locator('#editable-message-text').textContent();
  report.networkGuard = await page.evaluate(async () => {
    const checks = {};
    for (const url of [
      'http://127.0.0.1:18765/api/health',
      'https://example.com/',
      'https://appassets.androidplatform.net/editor.html',
    ]) {
      try {
        await fetch(url);
        checks[url] = false;
      } catch {
        checks[url] = true;
      }
    }
    return checks;
  });
} catch (e) {
  report.failure = e.stack;
} finally {
  await fs.writeFile(path.join(output, 'browser-check.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(
  JSON.stringify({
    failure: report.failure,
    errors: report.errors,
    missing: report.missing,
    snapshot: report.snapshot,
    chat: report.chat,
  }),
);
