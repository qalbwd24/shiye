import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { createSyncServer } from '../src/server/sync-v2/server.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const lanOnly = process.argv.includes('--lan-only');
const reportName = lanOnly ? 'browser-lan-report.json' : 'browser-report.json';
const output = path.join(ROOT, 'outputs', 'sync-backend');
const tempRoot = path.join(ROOT, 'tmp', 'sync-backend');
await Promise.all([mkdir(output, { recursive: true }), mkdir(tempRoot, { recursive: true })]);
const dataDir = await mkdtemp(path.join(tempRoot, 'ui-'));
const browserTemp = path.join(dataDir, 'browser-temp');
await mkdir(browserTemp);
const oldTemp = process.env.TEMP,
  oldTmp = process.env.TMP;
process.env.TEMP = browserTemp;
process.env.TMP = browserTemp;
const report = {
  passed: false,
  checks: [],
  browserErrors: 0,
  dataDir,
  boundaries: [
    'Headless Edge with two isolated browser contexts; no existing desktop or phone was controlled.',
    'Offline save is verified in an already loaded page; reopening is verified after network restoration. Offline browser cold bootstrap is not implemented by this lab.',
  ],
};
let browser, service, desktop, phone, currentCheck;
async function check(name, fn) {
  currentCheck = name;
  const start = Date.now();
  await fn();
  report.checks.push({ name, passed: true, ms: Date.now() - start });
  console.log(JSON.stringify({ check: name, passed: true }));
}
async function until(fn, description, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${description}`);
}
async function records(page, storeName = 'entities', media = false) {
  return page.evaluate(
    async ({ storeName, media }) => {
      const settings = JSON.parse(localStorage.getItem('shiye-sync-v2-lab-connection'));
      const name = `shiye-sync-v2-lab-${media ? 'media-' : ''}${settings.profile}`;
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open(name);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(new Error('test-db-open'));
      });
      try {
        return await new Promise((resolve, reject) => {
          const req = db.transaction(storeName).objectStore(storeName).getAll();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(new Error('test-db-read'));
        });
      } finally {
        db.close();
      }
    },
    { storeName, media },
  );
}
async function saved(page) {
  await page.locator('#save').click();
  await page.locator('#saved').filter({ hasText: '本地已保存' }).waitFor();
}
async function newRecord(page, type, title, body = '', category = '') {
  await page.locator('#new').click();
  await page.locator('#type').selectOption(type);
  await page.locator('#title').fill(title);
  await page.locator('#category').fill(category);
  await page.locator('#body').fill(body);
}
async function openRecord(page, title) {
  await page.locator('#records .record').filter({ hasText: title }).first().click();
  await until(async () => (await page.locator('#title').inputValue()) === title, 'editor opened');
}
async function synchronized(page, title) {
  await page
    .locator('#records .record')
    .filter({ hasText: title })
    .first()
    .waitFor({ timeout: 20000 });
}
async function originals(page) {
  return page.evaluate(async () => {
    const { sha256Bytes } = await import('./assets/sync-v2-media.js');
    const settings = JSON.parse(localStorage.getItem('shiye-sync-v2-lab-connection'));
    const db = await new Promise((resolve) => {
      const req = indexedDB.open(`shiye-sync-v2-lab-media-${settings.profile}`);
      req.onsuccess = () => resolve(req.result);
    });
    try {
      const all = await new Promise((resolve) => {
        const req = db.transaction('originals').objectStore('originals').getAll();
        req.onsuccess = () => resolve(req.result);
      });
      return await Promise.all(
        all.map(async (row) => ({
          size: row.blob.size,
          mime: row.blob.type,
          sha256: sha256Bytes(await row.blob.arrayBuffer()),
        })),
      );
    } finally {
      db.close();
    }
  });
}
try {
  const { chromium } = await import(
    pathToFileURL(
      'C:/Users/<用户名>/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs',
    ).href
  );
  service = await createSyncServer({ dataDir });
  await new Promise((resolve) =>
    service.server.listen(0, lanOnly ? '0.0.0.0' : '127.0.0.1', resolve),
  );
  const baseUrl = `http://127.0.0.1:${service.server.address().port}/`;
  const phoneUrl = lanOnly ? `http://100.77.215.104:${service.server.address().port}/` : baseUrl;
  browser = await chromium.launch({
    channel: 'msedge',
    headless: true,
    downloadsPath: path.join(dataDir, 'downloads'),
    args: ['--no-proxy-server'],
  });
  const desktopContext = await browser.newContext({ viewport: { width: 1120, height: 940 } });
  const phoneContext = await browser.newContext({
    viewport: { width: 412, height: 915 },
    isMobile: true,
    hasTouch: true,
  });
  desktop = await desktopContext.newPage();
  phone = await phoneContext.newPage();
  for (const page of [desktop, phone]) {
    page.on('dialog', (dialog) => dialog.accept());
    page.on('pageerror', () => {
      report.browserErrors++;
    });
  }
  await Promise.all([desktop.goto(baseUrl), phone.goto(phoneUrl)]);
  await check('pair-two-browser-profiles-through-ui', async () => {
    await desktop.locator('#generate').click();
    await until(
      async () => /^\d{8}$/u.test(await desktop.locator('#pair-code').textContent()),
      'pairing code',
    );
    const code = await desktop.locator('#pair-code').textContent();
    await desktop.locator('#device-name').fill('桌面合成设备');
    await desktop.locator('#pair').click();
    await desktop.locator('#workspace').waitFor();
    await phone.locator('#device-name').fill('手机合成设备');
    await phone.locator('#code').fill(code);
    await phone.locator('#pair').click();
    await phone.locator('#workspace').waitFor();
    await until(
      async () =>
        !(await desktop.locator('#state').textContent()).includes('正在同步') &&
        !(await phone.locator('#state').textContent()).includes('正在同步'),
      'initial sync',
    );
  });
  if (lanOnly) {
    await check('insecure-tailscale-http-richdoc-originals-and-watch', async () => {
      const capabilities = await phone.evaluate(() => ({
        secureContext: isSecureContext,
        subtleAvailable: Boolean(globalThis.crypto?.subtle),
        randomUUIDAvailable: typeof globalThis.crypto?.randomUUID === 'function',
      }));
      assert.equal(capabilities.secureContext, false);
      assert.equal(capabilities.subtleAvailable, false);
      assert.equal(capabilities.randomUUIDAvailable, false);
      report.phoneCapabilities = capabilities;
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jTHkAAAAASUVORK5CYII=',
        'base64',
      );
      const expected = createHash('sha256').update(png).digest('hex');
      await newRecord(
        phone,
        'journalAggregate',
        '不安全HTTP合成长文',
        '中文段落一。\n\n中文段落二：无subtle和randomUUID时仍能本地保存和同步。',
      );
      await phone
        .locator('#files')
        .setInputFiles([{ name: 'synthetic-lan.png', mimeType: 'image/png', buffer: png }]);
      await until(
        async () => (await phone.locator('#attachments .asset').count()) === 1,
        'LAN phone original saved',
      );
      await saved(phone);
      await synchronized(desktop, '不安全HTTP合成长文');
      await openRecord(desktop, '不安全HTTP合成长文');
      await until(
        async () => (await originals(desktop)).length === 1,
        'desktop receives original from insecure phone',
      );
      await openRecord(desktop, '不安全HTTP合成长文');
      for (const page of [desktop, phone]) {
        assert.deepEqual(
          (await originals(page)).map((item) => item.sha256),
          [expected],
        );
        await page.waitForFunction(
          () => document.querySelector('#attachments img')?.naturalWidth === 1,
          undefined,
          { timeout: 12000 },
        );
      }
      const entry = (await records(desktop)).find((row) => row.entityType === 'journalAggregate');
      assert.equal(entry.local.data.body.format, 'shiye-richdoc');
      assert.equal(entry.local.data.body.content.length, 3);
      await newRecord(
        desktop,
        'chatMessage',
        '桌面向LAN手机回传',
        '不同origin、同库的双向自动watch。',
      );
      await saved(desktop);
      await synchronized(phone, '桌面向LAN手机回传');
      await openRecord(phone, '不安全HTTP合成长文');
      await phone.screenshot({ path: path.join(output, 'phone-lan.png'), fullPage: true });
      assert.equal(report.browserErrors, 0);
      report.originals = {
        files: 1,
        contexts: 2,
        matchingSha256: true,
        imageDecode: true,
        secureContextIndependent: true,
      };
    });
  } else {
    const longText =
      '第一段：这是一份完全虚构的中文长文。\n\n第二段：保留段落与原始富文本格式，验证桌面和手机互通。\n' +
      '持续记录一些用于验证的中文内容。'.repeat(40);
    await check('chinese-longform-and-message-auto-watch', async () => {
      await newRecord(desktop, 'journalAggregate', '合成长文', longText, 'category-demo');
      await saved(desktop);
      await synchronized(phone, '合成长文');
      await openRecord(phone, '合成长文');
      assert.equal(await phone.locator('#body').inputValue(), longText);
      const entry = (await records(phone)).find((r) => r.entityType === 'journalAggregate');
      assert.equal(entry.local.data.body.format, 'shiye-richdoc');
      assert.ok(entry.local.data.body.content.length >= 4);
      await newRecord(phone, 'chatMessage', '手机合成消息', '从手机发出的合成消息。');
      await saved(phone);
      await synchronized(desktop, '手机合成消息');
    });
    await check('offline-save-close-reopen-and-resume', async () => {
      await phone.locator('#pause').click();
      await phoneContext.setOffline(true);
      await newRecord(phone, 'chatMessage', '离线合成消息', '无网络时本地事务仍能保存。');
      await saved(phone);
      assert.ok((await records(phone, 'pending')).length >= 1);
      assert.equal(
        await desktop.locator('#records .record').filter({ hasText: '离线合成消息' }).count(),
        0,
      );
      await phone.close();
      await phoneContext.setOffline(false);
      phone = await phoneContext.newPage();
      phone.on('dialog', (dialog) => dialog.accept());
      phone.on('pageerror', () => {
        report.browserErrors++;
      });
      await phone.goto(baseUrl);
      await phone.locator('#workspace').waitFor();
      await synchronized(phone, '离线合成消息');
      await synchronized(desktop, '离线合成消息');
      await until(
        async () => (await records(phone, 'pending')).length === 0,
        'persisted outbox drained',
      );
      assert.equal(
        await phone.locator('#records .record').filter({ hasText: '离线合成消息' }).count(),
        1,
      );
    });
    await check('png-gif-video-original-cache-and-preview-both-contexts', async () => {
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jTHkAAAAASUVORK5CYII=',
        'base64',
      );
      const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
      const ffmpeg =
        process.env.SYNC_LAB_FFMPEG ||
        'C:/Users/<用户名>/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0-full_build/bin/ffmpeg.exe';
      const videoPath = path.join(dataDir, 'synthetic.webm');
      await promisify(execFile)(
        ffmpeg,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-f',
          'lavfi',
          '-i',
          'testsrc=size=32x32:rate=5:duration=1',
          '-c:v',
          'libvpx',
          '-pix_fmt',
          'yuv420p',
          '-an',
          '-y',
          videoPath,
        ],
        { cwd: dataDir, windowsHide: true },
      );
      const video = await readFile(videoPath);
      const files = [
        { name: 'synthetic.png', mimeType: 'image/png', buffer: png },
        { name: 'synthetic.gif', mimeType: 'image/gif', buffer: gif },
        { name: 'synthetic.webm', mimeType: 'video/webm', buffer: video },
      ];
      const expected = files.map((f) => createHash('sha256').update(f.buffer).digest('hex')).sort();
      await newRecord(
        desktop,
        'chatMessage',
        '原件附件合成消息',
        '包含PNG、GIF与可播放的WebM原件。',
      );
      await desktop.locator('#files').setInputFiles(files);
      await until(
        async () => (await desktop.locator('#attachments .asset').count()) === 3,
        'local attachment commit',
      );
      await saved(desktop);
      await synchronized(phone, '原件附件合成消息');
      await openRecord(phone, '原件附件合成消息');
      await until(async () => (await originals(phone)).length === 3, 'phone original downloads');
      // Reopen reads persisted originals and updates previews without assuming a network URL is local storage.
      await openRecord(phone, '原件附件合成消息');
      for (const page of [desktop, phone]) {
        assert.deepEqual((await originals(page)).map((r) => r.sha256).sort(), expected);
        try {
          await page.waitForFunction(
            () =>
              [...document.querySelectorAll('#attachments img')].length === 2 &&
              [...document.querySelectorAll('#attachments img')].every(
                (image) => image.complete && image.naturalWidth > 0,
              ) &&
              document.querySelector('#attachments video')?.videoWidth > 0,
            undefined,
            { timeout: 12000 },
          );
        } catch (error) {
          report.previewDiagnostics = await page.evaluate(() =>
            [...document.querySelectorAll('#attachments img, #attachments video')].map((node) => ({
              tag: node.tagName,
              complete: node.complete,
              naturalWidth: node.naturalWidth,
              videoWidth: node.videoWidth,
              error: node.error?.code,
              readyState: node.readyState,
            })),
          );
          throw error;
        }
        assert.equal(await page.locator('#attachments a[download]').count(), 3);
      }
      report.originals = {
        files: 3,
        contexts: 2,
        bytes: files.reduce((sum, file) => sum + file.buffer.length, 0),
        matchingSha256: true,
        imageDecode: true,
        videoMetadata: true,
      };
    });
    await check('category-and-conversation-settings-roundtrip', async () => {
      await newRecord(desktop, 'taxonomy', '合成分类', '分类说明');
      await saved(desktop);
      await synchronized(phone, '合成分类');
      await openRecord(phone, '合成分类');
      await phone.locator('#title').fill('手机改名分类');
      await saved(phone);
      await synchronized(desktop, '手机改名分类');
      await newRecord(phone, 'conversation', '合成会话', '会话说明', 'category-demo');
      await saved(phone);
      await synchronized(desktop, '合成会话');
      await openRecord(desktop, '合成会话');
      assert.equal(await desktop.locator('#category').inputValue(), 'category-demo');
      await desktop.locator('#body').fill('桌面更新会话说明');
      await saved(desktop);
      await until(
        async () =>
          (await records(phone)).find((r) => r.entityType === 'conversation')?.local.data
            .description === '桌面更新会话说明',
        'conversation description synced',
      );
    });
    await check('same-field-newest-primary-and-conflict-history-ui', async () => {
      await openRecord(desktop, '合成长文');
      await openRecord(phone, '合成长文');
      await desktop.locator('#pause').click();
      await phone.locator('#pause').click();
      await desktop.locator('#body').fill('先提交的合成长文版本。');
      await saved(desktop);
      await phone.locator('#body').fill('后提交的合成长文主版本。');
      await saved(phone);
      await desktop.locator('#pause').click();
      await until(async () => (await records(desktop, 'pending')).length === 0, 'first commit');
      await phone.locator('#pause').click();
      await until(async () => (await records(phone, 'pending')).length === 0, 'newest commit');
      await until(
        async () =>
          (await records(desktop)).find((r) => r.entityType === 'journalAggregate')?.local.data.body
            .content[0]?.content[0]?.text === '后提交的合成长文主版本。',
        'newest visible primary',
      );
      await desktop.locator('#history').click();
      await desktop.locator('#conflict-items .history').first().waitFor();
      assert.ok(
        (await desktop.locator('#conflict-items').textContent()).includes('先提交的合成长文版本。'),
      );
      assert.equal(
        (await records(desktop)).filter(
          (r) => r.entityType === 'journalAggregate' && r.local?.state === 'active',
        ).length,
        1,
      );
    });
    await check('final-render-and-secret-free-screenshots', async () => {
      for (const page of [desktop, phone]) {
        await page.evaluate(() => {
          document.getElementById('connection').open = false;
          document.getElementById('conflicts').open = false;
          document.getElementById('code').value = '';
          document.getElementById('pair-code').textContent = '';
        });
        await openRecord(page, '原件附件合成消息');
        assert.equal(await page.locator('#notice').textContent(), '');
      }
      await desktop.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
      await phone.screenshot({ path: path.join(output, 'phone.png'), fullPage: true });
      assert.equal(report.browserErrors, 0);
    });
  }
  report.passed = true;
} catch (error) {
  report.failedCheck = currentCheck;
  report.error = String(error.message || 'BROWSER_CHECK_FAILED')
    .replace(/[a-f0-9]{64}/giu, '[redacted]')
    .replace(/\b\d{8}\b/gu, '[redacted]');
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  await service?.close().catch(() => {});
  if (oldTemp === undefined) delete process.env.TEMP;
  else process.env.TEMP = oldTemp;
  if (oldTmp === undefined) delete process.env.TMP;
  else process.env.TMP = oldTmp;
  await writeFile(path.join(output, reportName), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(
    JSON.stringify({
      passed: report.passed,
      checks: report.checks.length,
      failedCheck: report.failedCheck || null,
      report: path.join(output, reportName),
    }),
  );
}
