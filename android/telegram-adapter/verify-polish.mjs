import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url),
  { chromium } = require(
    path.join(root, 'previews/telegram-chat/vendor/web-a/node_modules/playwright'),
  );
const baseline = process.argv.includes('--baseline');
const app = path.join(
  root,
  baseline
    ? 'tmp/android-input-refinement/telegram-build/assets/telegram'
    : 'tmp/android-frontend-polish/telegram-build/assets/telegram',
);
const output = path.join(root, 'outputs/2026-10-17-android-frontend-polish/chat');
await fs.mkdir(output, { recursive: true });
const report = { baseline, synthetic: true, androidVerified: false, errors: [], checks: [] };
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
await context.addInitScript(() => {
  Object.defineProperty(navigator, 'platform', { get: () => 'Linux armv8l' });
  let stored = { version: 1, pinIds: [] };
  window.shiyeAndroidPreferences = {
    load: async () => structuredClone(stored),
    commit: async (value) => {
      stored = structuredClone(value);
      return structuredClone(stored);
    },
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
page.on('pageerror', (e) => report.errors.push(e.message));
try {
  await page.goto('https://appassets.androidplatform.net/telegram/index.html');
  await page.waitForFunction(() => window.shiyeAndroidChat?.ready);
  await page.waitForSelector('#LeftColumn a[href="#-10"]');
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(output, baseline ? 'baseline-list.png' : 'list.png') });
  const id = await page.evaluate(async () => {
    const r = await window.shiyeAndroidChat.command('create', { title: '草稿复现', idleHours: 5 });
    return r.id;
  });
  report.roomId = id;
  await page.evaluate((id) => window.shiyeAndroidChat.openRoom(id), id);
  await page.waitForFunction(() => !!document.querySelector('#editable-message-text')?.editor);
  await page.locator('#editable-message-text').click();
  const cdp = await context.newCDPSession(page);
  const text =
    'QA-INPUT-021 中文第一段\n\n第二段  保留两个空格\nemoji🙂 与中文　全角空格\n末段 结束';
  await cdp.send('Input.insertText', { text });
  report.before = await page.evaluate((id) => {
    const e = document.querySelector('#editable-message-text'),
      g = window.getGlobal();
    return {
      text: e.editor.getText({ blockSeparator: '\n' }),
      html: e.innerHTML,
      doc: e.editor.getJSON(),
      globalChat: !!g.chats.byId[id],
      currentRoom: window.shiyeAndroidChat.currentId(),
      drafts: g.messages.byChatId,
    };
  }, id);
  try {
    report.flush = await page.evaluate(() => window.shiyeAndroidChat.flush());
  } catch (error) {
    report.flushError = error.message;
  }
  report.stored = await page.evaluate(
    (id) =>
      new Promise((resolve, reject) => {
        const q = indexedDB.open('shiye-android-telegram-v2', 1);
        q.onsuccess = () => {
          const db = q.result,
            r = db.transaction('preview').objectStore('preview').get('library');
          r.onsuccess = () => {
            db.close();
            resolve(r.result?.dialogs.active.find((d) => d.id === id)?.draft?.message || '');
          };
          r.onerror = () => reject(r.error);
        };
      }),
    id,
  );
  await page.screenshot({
    path: path.join(output, baseline ? 'baseline-chat.png' : 'chat-draft.png'),
  });
  report.after = await page.evaluate(() => ({ drafts: window.getGlobal().messages.byChatId }));
  if (!baseline) {
    const check = (name, passed) => {
      assert.ok(passed, name);
      report.checks.push({ name, passed: true });
      console.log(JSON.stringify({ check: name }));
    };
    check('fresh room ApiChat projection exists before opening', report.before.globalChat);
    check(
      'CDP inserted five real paragraphs including an empty paragraph',
      report.before.doc.content.length === 5 && report.before.doc.content[1].content === undefined,
    );
    check(
      'Tiptap exact text retains blank line, two spaces, ideographic space and emoji',
      report.before.text === text,
    );
    check(
      'flush returns worker ACK and all 54 characters',
      report.flush?.flushed && report.flush.draftChars === 54,
    );
    check('actual IDB draft is identical character for character', report.stored === text);
    await page.evaluate(() => window.shiyeAndroidChat.back());
    await page.waitForFunction(() => !window.shiyeAndroidChat.snapshot().inConversation);
    await page.locator(`#LeftColumn a[href="#${id}"]`).click();
    await page.waitForFunction(() => !!document.querySelector('#editable-message-text')?.editor);
    check(
      'real list click reopens conversation with identical draft',
      await page.evaluate(
        (text) =>
          document
            .querySelector('#editable-message-text')
            .editor.getText({ blockSeparator: '\n' }) === text,
        text,
      ),
    );
    report.buttons = await page
      .locator('#MiddleColumn button')
      .evaluateAll((buttons) =>
        buttons.map((b) => ({ class: b.className, label: b.ariaLabel, title: b.title })),
      );
    const send = page.locator('#MiddleColumn button.send');
    await send.click();
    await page.waitForFunction(
      () => !document.querySelector('#editable-message-text').editor.getText(),
    );
    check(
      'real composer send clears draft and worker acknowledges',
      !!(await page.evaluate(() => window.shiyeAndroidChat.flush())).flushed,
    );
    check(
      'sent text is visible in actual Web A message bubble',
      await page
        .locator('.Message .text-content')
        .allTextContents()
        .then((items) => items.some((t) => t.includes('QA-INPUT-021'))),
    );
    report.sent = await page.evaluate(
      (id) =>
        new Promise((resolve) => {
          const q = indexedDB.open('shiye-android-telegram-v2', 1);
          q.onsuccess = () => {
            const db = q.result,
              r = db.transaction('preview').objectStore('preview').get('library');
            r.onsuccess = () => {
              db.close();
              resolve({
                dialog: r.result?.dialogs.active.find((d) => d.id === id),
                messages: r.result?.messages,
                dom: document.querySelector('.Message .text-content')?.innerHTML,
              });
            };
          };
        }),
      id,
    );
    check(
      'sent IDB message retains all 54 characters exactly',
      report.sent.messages[id][0].message === text,
    );
    report.rendered = await page
      .locator('.Message .shiye-markdown')
      .first()
      .evaluate((element) => {
        const p = [...element.querySelectorAll('p')];
        const serialize = (node) =>
          node.nodeType === Node.TEXT_NODE
            ? node.textContent
            : node.nodeName === 'BR'
              ? '\n'
              : [...node.childNodes].map(serialize).join('');
        return {
          text: p.map(serialize).join('\n\n'),
          paragraphs: p.length,
          gap: p[1].getBoundingClientRect().top - p[0].getBoundingClientRect().bottom,
          lineHeight: parseFloat(getComputedStyle(p[0]).lineHeight),
        };
      });
    check(
      'rendered paragraphs, br, spaces and emoji reconstruct the exact sent text',
      report.rendered.text === text,
    );
    check(
      'original blank line remains visible between rendered paragraphs',
      report.rendered.gap >= report.rendered.lineHeight - 1,
    );
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(output, 'chat-sent.png') });
    await page.locator('#editable-message-text').click();
    await cdp.send('Input.insertText', { text: '此刻，记下一句。' });
    await page.locator('#MiddleColumn button.send').click();
    await page.evaluate(() => window.shiyeAndroidChat.flush());
    await page.waitForTimeout(200);
    const bubble = page.locator('.Message .message-content').last();
    check(
      'single-line mature bubble has natural height under 70 CSS px',
      (await bubble.boundingBox()).height < 70,
    );
    await page.screenshot({ path: path.join(output, 'chat-bubbles.png') });
    await page.locator('button.AttachMenu--button').click();
    await page.waitForSelector('.MenuItem .icon-media');
    const media = page.locator('.MenuItem').filter({ has: page.locator('.icon-media') });
    const chooser = page.waitForEvent('filechooser');
    await media.click();
    const file = await chooser;
    check('original media menu reaches image file chooser', file.isMultiple());
    await file.setFiles({
      name: 'synthetic.png',
      mimeType: 'image/png',
      buffer: await fs.readFile(path.join(app, 'icon-dev-192x192.png')),
    });
    await page.waitForSelector('.Modal.open .modal-dialog');
    await page.waitForTimeout(350);
    report.attachment = await page.locator('.Modal.open .modal-dialog').evaluate((e) => ({
      box: e.getBoundingClientRect().toJSON(),
      style: { display: getComputedStyle(e).display, visibility: getComputedStyle(e).visibility },
    }));
    check(
      'mature media preview has visible positive-size dialog',
      report.attachment.box.width > 200 &&
        report.attachment.box.height > 200 &&
        report.attachment.style.visibility === 'visible',
    );
    await page.screenshot({ path: path.join(output, 'attachment-preview.png') });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.Modal.open'));
    check(
      'attachment preview cancels without losing conversation',
      await page.evaluate(() => window.shiyeAndroidChat.snapshot().inConversation),
    );
    await page.locator('.shiye-android-header button[aria-label="会话菜单"]').click();
    await page.waitForSelector('dialog[open]');
    await page.screenshot({ path: path.join(output, 'room-menu.png') });
    await page.getByRole('button', { name: '置顶会话', exact: true }).click();
    await page.waitForFunction((id) => window.shiyeAndroidChat.pinIds().includes(id), id);
    await page.waitForSelector(`.shiye-android-pinned .shiye-room-settings[data-room-id="${id}"]`, {
      state: 'attached',
    });
    check(
      'menu pin waits native mock commit and updates rendered pin marker',
      (await page
        .locator(`.shiye-android-pinned .shiye-room-settings[data-room-id="${id}"]`)
        .count()) === 1,
    );
    await page.evaluate(() => window.shiyeAndroidChat.back());
    await page.waitForFunction(() => !window.shiyeAndroidChat.snapshot().inConversation);
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(output, 'list-pinned.png') });
    await page.evaluate(() => window.dispatchEvent(new Event('shiye-open-search')));
    await page.waitForSelector('dialog[open]');
    await page.locator('dialog input').fill('QA-INPUT-021');
    await page.getByRole('button', { name: '搜索', exact: true }).click();
    await page.waitForSelector('.room-result');
    check(
      'search returns saved message through original worker',
      await page
        .locator('.room-result')
        .first()
        .textContent()
        .then((t) => t.includes('QA-INPUT-021')),
    );
    await page.screenshot({ path: path.join(output, 'search.png') });
    await page.evaluate(() => window.shiyeAndroidChat.back());
    await page.evaluate(() => window.dispatchEvent(new Event('shiye-new-topic')));
    await page.waitForSelector('dialog[open]');
    await page.locator('dialog input').fill('新的片刻');
    await page.screenshot({ path: path.join(output, 'new-room.png') });
    await page.getByRole('button', { name: '创建', exact: true }).click();
    await page.waitForFunction(
      () =>
        window.shiyeAndroidChat.snapshot().inConversation &&
        document.querySelector('.shiye-android-header strong')?.textContent === '新的片刻',
    );
    check(
      'new room form creates and opens a fully projected chat',
      await page.evaluate(
        () => !!window.getGlobal().chats.byId[window.shiyeAndroidChat.currentId()],
      ),
    );
    await page.evaluate(() => window.shiyeAndroidChat.back());
    await page.waitForFunction(() => !window.shiyeAndroidChat.snapshot().inConversation);
    await page.waitForTimeout(350);
    await page.setViewportSize({ width: 360, height: 740 });
    await page.reload();
    await page.waitForFunction(
      () => window.shiyeAndroidChat?.ready && !window.shiyeAndroidChat.snapshot().inConversation,
    );
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(output, 'list-360.png') });
    check(
      'return from newly created room stays at list after resize',
      await page.evaluate(() => !window.shiyeAndroidChat.snapshot().inConversation),
    );
    check(
      '360px list has no horizontal overflow',
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    );
    check(
      'native back at list returns false',
      (await page.evaluate(() => window.shiyeAndroidChat.back())) === false,
    );
    check('no Teact, page or uncaught errors', report.errors.length === 0);
  }
  if (baseline) {
    await page.evaluate(
      (id) => window.dispatchEvent(new CustomEvent('shiye-refresh-rooms', { detail: { id } })),
      id,
    );
    await page.waitForFunction((id) => !!window.getGlobal().chats.byId[id], id);
    report.afterRefresh = await page.evaluate(
      (id) => ({
        globalChat: !!window.getGlobal().chats.byId[id],
        text: document
          .querySelector('#editable-message-text')
          ?.editor?.getText({ blockSeparator: '\n' }),
      }),
      id,
    );
    try {
      report.afterRefresh.flush = await page.evaluate(() => window.shiyeAndroidChat.flush());
    } catch (error) {
      report.afterRefresh.error = error.message;
    }
    report.afterRefresh.stored = await page.evaluate(
      (id) =>
        new Promise((resolve) => {
          const q = indexedDB.open('shiye-android-telegram-v2', 1);
          q.onsuccess = () => {
            const db = q.result,
              r = db.transaction('preview').objectStore('preview').get('library');
            r.onsuccess = () => {
              db.close();
              resolve(r.result?.dialogs.active.find((d) => d.id === id)?.draft?.message || '');
            };
          };
        }),
      id,
    );
  }
} catch (error) {
  report.failure = error.stack;
  console.log(JSON.stringify({ failure: report.failure }));
  process.exitCode = 1;
} finally {
  await browser.close();
}
await fs.writeFile(
  path.join(output, baseline ? 'draft-baseline.json' : 'chat-check.json'),
  JSON.stringify(report, (_, value) => (typeof value === 'bigint' ? String(value) : value), 2),
);
console.log(
  JSON.stringify({
    baseline,
    flush: report.flush,
    flushError: report.flushError,
    actual: report.before?.text,
    stored: report.stored,
    errors: report.errors,
    failure: report.failure,
  }),
);
