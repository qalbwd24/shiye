import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url),
  { chromium } = require(
    path.join(root, 'previews/telegram-chat/vendor/web-a/node_modules/playwright'),
  );
const app = path.join(root, 'tmp/android-input-refinement/telegram-build/assets/telegram');
const output = path.join(root, 'outputs/2026-10-17-android-input-refinement/telegram');
const profile = path.join(root, `tmp/android-input-refinement/pin-profile-${Date.now()}`);
await fs.mkdir(output, { recursive: true });
const report = { synthetic: true, phoneOrAvd: false, profile, checks: [], errors: [] };
const check = (name, value) => {
  assert.ok(value, name);
  report.checks.push(name);
};
const preferenceKey = 'android-ui-preferences-v1';
const options = {
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--disable-gpu'],
  viewport: { width: 412, height: 780 },
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36',
  serviceWorkers: 'block',
};
async function configure(context) {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'platform', { get: () => 'Linux armv8l' });
    if (!localStorage.getItem('refinement-test-seeded')) {
      localStorage.setItem('shiye-android-pins-v1', '["-10"]');
      localStorage.setItem('refinement-test-seeded', '1');
    }
    const originalPut = IDBObjectStore.prototype.put;
    const originalGet = IDBObjectStore.prototype.get;
    window.pinTest = {
      hold: false,
      issued: false,
      committed: false,
      resolved: false,
      failNext: false,
    };
    IDBObjectStore.prototype.put = function (value, key) {
      if (key === 'android-ui-preferences-v1') {
        window.pinTest.durability = this.transaction.durability;
        if (window.pinTest.failNext) {
          window.pinTest.failNext = false;
          throw new DOMException('Injected preference write failure', 'QuotaExceededError');
        }
        window.pinTest.issued = true;
        this.transaction.addEventListener('complete', () => {
          window.pinTest.committed = true;
        });
        if (window.pinTest.hold) {
          const keep = () => {
            if (window.pinTest.hold) {
              const r = originalGet.call(this, 'refinement-keepalive');
              r.onsuccess = keep;
            }
          };
          keep();
        }
      }
      return originalPut.call(this, value, key);
    };
    IDBObjectStore.prototype.get = function (key) {
      const request = originalGet.call(this, key);
      if (key === 'library')
        request.addEventListener('success', () => {
          if (!window.draftReadFault || !request.result) return;
          const changed = structuredClone(request.result),
            draft = changed.dialogs.active.find((d) => d.id === '-10')?.draft;
          if (draft) {
            draft.message =
              window.draftReadFault === 'spaces'
                ? draft.message.replace('  ', ' ')
                : draft.message.replace('\n\n', '\n');
            Object.defineProperty(request, 'result', { get: () => changed });
          }
        });
      return request;
    };
  });
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
}
async function load(context) {
  const page = await context.newPage();
  page.on('pageerror', (e) => report.errors.push(e.message));
  await page.goto('https://appassets.androidplatform.net/telegram/index.html');
  await page.waitForFunction(() => window.shiyeAndroidChat?.ready);
  return page;
}
async function read(page, key) {
  return page.evaluate(
    (key) =>
      new Promise((resolve, reject) => {
        const q = indexedDB.open('shiye-android-telegram-v2', 1);
        q.onerror = () => reject(q.error);
        q.onsuccess = () => {
          const db = q.result,
            r = db.transaction('preview').objectStore('preview').get(key);
          r.onsuccess = () => {
            db.close();
            resolve(r.result);
          };
          r.onerror = () => reject(r.error);
        };
      }),
    key,
  );
}
async function libraryHash(page) {
  return page.evaluate(async () => {
    const text = await new Promise((resolve, reject) => {
      const q = indexedDB.open('shiye-android-telegram-v2', 1);
      q.onsuccess = () => {
        const db = q.result,
          r = db.transaction('preview').objectStore('preview').get('library');
        r.onsuccess = () => {
          db.close();
          resolve(JSON.stringify(r.result, (_, v) => (typeof v === 'bigint' ? `${v}n` : v)));
        };
        r.onerror = () => reject(r.error);
      };
    });
    return Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))),
    )
      .map((n) => n.toString(16).padStart(2, '0'))
      .join('');
  });
}
let context;
try {
  context = await chromium.launchPersistentContext(profile, options);
  await configure(context);
  let page = await load(context);
  report.migration = await read(page, preferenceKey);
  check(
    'missing-key legacy pins migrate transactionally',
    JSON.stringify(report.migration.pinIds) === '["-10"]',
  );
  await page.evaluate(
    (key) =>
      new Promise((resolve, reject) => {
        const q = indexedDB.open('shiye-android-telegram-v2', 1);
        q.onsuccess = () => {
          const db = q.result,
            t = db.transaction('preview', 'readwrite'),
            s = t.objectStore('preview'),
            r = s.get(key);
          r.onsuccess = () => s.put({ ...r.result, unknownFutureField: { keep: true } }, key);
          t.oncomplete = () => {
            db.close();
            resolve();
          };
          t.onabort = () => reject(t.error);
        };
      }),
    preferenceKey,
  );
  report.concurrent = await page.evaluate(async () => {
    await Promise.all([
      window.shiyeAndroidChat.togglePin('-20'),
      window.shiyeAndroidChat.togglePin('-30'),
      window.shiyeAndroidChat.togglePin('-20'),
    ]);
    return window.shiyeAndroidChat.pinIds();
  });
  check(
    'concurrent mutations serialize without lost update',
    JSON.stringify(report.concurrent) === '["-30","-10"]',
  );
  await page.evaluate(() => {
    window.pinTest = {
      hold: true,
      issued: false,
      committed: false,
      resolved: false,
      failNext: false,
    };
    window.pendingPin = window.shiyeAndroidChat.togglePin('-20').then(() => {
      window.pinTest.resolved = true;
    });
    window.pendingFlush = window.shiyeAndroidChat.flush().then(() => {
      window.pinTest.flushResolved = true;
    });
  });
  await page.waitForFunction(() => window.pinTest.issued);
  report.beforeCommit = await page.evaluate(() => ({
    pins: window.shiyeAndroidChat.pinIds(),
    cache: localStorage.getItem('shiye-android-pins-v1'),
    ...window.pinTest,
  }));
  check(
    'pin and flush await real transaction completion',
    !report.beforeCommit.committed &&
      !report.beforeCommit.resolved &&
      !report.beforeCommit.flushResolved &&
      report.beforeCommit.cache === '["-30","-10"]',
  );
  await page.evaluate(async () => {
    window.pinTest.hold = false;
    await Promise.all([window.pendingPin, window.pendingFlush]);
  });
  report.afterCommit = await page.evaluate(() => ({
    pins: window.shiyeAndroidChat.pinIds(),
    ...window.pinTest,
  }));
  check(
    'strict transaction ACK precedes resolve and cache update',
    report.afterCommit.committed &&
      report.afterCommit.resolved &&
      report.afterCommit.flushResolved &&
      report.afterCommit.durability === 'strict',
  );
  report.writeFailure = await page.evaluate(async () => {
    const previous = localStorage.getItem('shiye-android-pins-v1');
    window.pinTest.failNext = true;
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
      unchanged: previous === localStorage.getItem('shiye-android-pins-v1'),
      pins: window.shiyeAndroidChat.pinIds(),
    };
  });
  check(
    'write failure rejects pin and flush without changing old cache',
    report.writeFailure.pinRejected &&
      report.writeFailure.flushRejected &&
      report.writeFailure.unchanged,
  );
  await page.evaluate(() => window.shiyeAndroidChat.togglePin('-30'));
  check(
    'queue recovers after explicit retry',
    JSON.stringify((await read(page, preferenceKey)).pinIds) === '["-20","-10"]',
  );
  await page.evaluate(async () => {
    for (const id of window.shiyeAndroidChat.pinIds()) await window.shiyeAndroidChat.togglePin(id);
    localStorage.setItem('shiye-android-pins-v1', '["-30"]');
  });
  await page.reload();
  await page.waitForFunction(() => window.shiyeAndroidChat?.ready);
  report.empty = await read(page, preferenceKey);
  check(
    'committed empty pins override stale legacy cache',
    report.empty.pinIds.length === 0 &&
      (await page.evaluate(() => window.shiyeAndroidChat.pinIds().length)) === 0,
  );
  check('unknown preference fields survive writes', report.empty.unknownFutureField.keep);
  await page.locator('#LeftColumn a[href="#-10"]').click();
  await page.waitForFunction(() => !!document.querySelector('#editable-message-text')?.editor);
  report.paragraph = await page.evaluate(async () => {
    const input = document.querySelector('#editable-message-text');
    input.editor.commands.setContent({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '首段  双空格' }] },
        { type: 'paragraph' },
        { type: 'paragraph', content: [{ type: 'text', text: '末段　空格' }] },
      ],
    });
    const expected = input.editor.getText({ blockSeparator: '\n' });
    try {
      const flush = await window.shiyeAndroidChat.flush();
      return { expected, flush };
    } catch (error) {
      return {
        expected,
        error: error.message,
        html: input.innerHTML,
        global: window.getGlobal().messages.byChatId['-10']?.threadsById,
      };
    }
  });
  report.paragraph.stored = (await read(page, 'library'))?.dialogs.active.find(
    (d) => d.id === '-10',
  )?.draft?.message;
  const stored = (await read(page, 'library')).dialogs.active.find((d) => d.id === '-10').draft
    .message;
  check(
    'Chinese paragraphs blank paragraph and spaces compare exactly',
    !report.paragraph.error &&
      report.paragraph.flush?.flushed &&
      stored === report.paragraph.expected &&
      stored === '首段  双空格\n\n末段　空格',
  );
  report.negative = [];
  for (const fault of ['spaces', 'blankline']) {
    const result = await page.evaluate(async (fault) => {
      window.draftReadFault = fault;
      let rejected = false;
      try {
        await window.shiyeAndroidChat.flush();
      } catch {
        rejected = true;
      }
      window.draftReadFault = undefined;
      return { fault, rejected };
    }, fault);
    report.negative.push(result);
    check(`${fault} mismatch must not receive successful flush ACK`, result.rejected);
  }
  await page.evaluate(() => window.shiyeAndroidChat.flush());
  const libraryBefore = await libraryHash(page);
  await page.evaluate(async () => {
    await window.shiyeAndroidChat.togglePin('-20');
    localStorage.setItem('shiye-android-pins-v1', '["-10"]');
  });
  const cdp = await context.browser().newBrowserCDPSession();
  const processes = await cdp.send('SystemInfo.getProcessInfo');
  const pid = processes.processInfo.find((p) => p.type === 'browser').id;
  report.forceKilledOwnBrowserPid = pid;
  await promisify(execFile)('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
  context = await chromium.launchPersistentContext(profile, options);
  await configure(context);
  page = await load(context);
  await page.waitForSelector('#LeftColumn a[href="#-20"]');
  report.afterKill = {
    pins: await page.evaluate(() => window.shiyeAndroidChat.pinIds()),
    stored: await read(page, preferenceKey),
    order: await page
      .locator('#LeftColumn a[href^="#"]')
      .evaluateAll((links) => links.map((e) => e.getAttribute('href'))),
  };
  check(
    'ACK then immediate browser force kill retains pin and order',
    JSON.stringify(report.afterKill.pins) === '["-20"]' && report.afterKill.order[0] === '#-20',
  );
  report.library = { before: libraryBefore, after: await libraryHash(page) };
  check(
    'pin preferences never modify library or unknown fields',
    report.library.before === report.library.after &&
      report.afterKill.stored.unknownFutureField.keep,
  );
  await page.locator('#LeftColumn a[href="#-10"]').click();
  await page.waitForFunction(() => !!document.querySelector('#editable-message-text')?.editor);
  report.reopenedDraft = await page
    .locator('#editable-message-text')
    .evaluate((e) => e.editor.getText({ blockSeparator: '\n' }));
  check(
    'Chinese paragraph draft retains all whitespace after force restart',
    report.reopenedDraft === stored,
  );
  await page.screenshot({ path: path.join(output, 'pin-force-restart.png') });
  check('no page errors', report.errors.length === 0);
} catch (error) {
  report.failure = error.stack;
  process.exitCode = 1;
} finally {
  await context?.close().catch(() => {});
}
await fs.writeFile(path.join(output, 'pin-storage-check.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
