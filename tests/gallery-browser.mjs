/** Isolated real-browser acceptance. Usage: node tests/gallery-browser.mjs <playwright/index.mjs> <browser.exe> */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!process.argv[2])
  throw Error('Pass the installed Playwright module path and optional browser executable.');
const { chromium } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const fixture = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Gallery synthetic acceptance</title><link rel="stylesheet" href="/styles/gallery.css"><style>:root{--paper:#fff;--ink:#243b3c;--muted:#708687;--line:#d6dfdf;--accent:#418e82}body{font:16px sans-serif;background:#edf4f1;padding:24px;display:flex;gap:40px}.attachments{display:grid}#attachments{width:340px}#bodyEditor{width:300px;height:140px;padding:20px;background:white}button{cursor:pointer}.secondary{border:1px solid #c5d8d1;background:white;border-radius:6px;padding:7px}</style><body><div id="journalView"><div id="attachments" class="attachments"></div></div><div id="bodyEditor" contenteditable="true">正文不会接收内部排序图片</div><script type="module">
import {createGallery} from '/features/gallery.js';
import {createMediaImport} from '/features/media-import.js';
const entry={id:'synthetic',attachments:['one','two','video','audio']};
const media=[{id:'one',name:'竖图',type:'image/svg+xml',createdAt:'2020-01-01'},{id:'two',name:'横图',type:'image/svg+xml',createdAt:'2021-01-01'},{id:'video',name:'测试视频',type:'video/mp4'},{id:'audio',name:'测试录音',type:'audio/wav'}];
const state={entry,library:{entries:[entry],media},writes:[]};
const c={$:s=>document.querySelector(s),escape:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),toast(){},current:()=>entry,get library(){return state.library},markDirty:e=>state.writes.push([...e.attachments]),flush:async()=>{},renderAttachments:()=>gallery.render(entry)};
const gallery=createGallery(c);createMediaImport(c);gallery.render(entry);window.acceptance=state;
</script></body></html>`;
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/fixture') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(fixture);
      return;
    }
    if (req.url.startsWith('/media/')) {
      res.setHeader('Content-Type', 'image/svg+xml');
      const portrait = req.url.endsWith('/one');
      res.end(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${portrait ? 400 : 800}" height="${portrait ? 800 : 400}"><rect width="100%" height="100%" fill="${portrait ? '#6e9c86' : '#a9bbd4'}"/><text x="30" y="90" font-size="38" fill="white">${portrait ? 'PORTRAIT' : 'LANDSCAPE'}</text></svg>`,
      );
      return;
    }
    const target = path.resolve(root, 'public', '.' + req.url.split('?')[0]);
    if (!target.startsWith(path.join(root, 'public') + path.sep)) throw Error('outside fixture');
    res.setHeader('Content-Type', target.endsWith('.js') ? 'text/javascript' : 'text/css');
    res.end(await readFile(target));
  } catch {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.argv[3] ? { executablePath: process.argv[3] } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1080, height: 900 } });
  const uploads = [];
  page.on('request', (req) => {
    if (req.url().includes('/api/media')) uploads.push(req.url());
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/fixture`);
  await page.waitForFunction(() => !!window.acceptance);
  assert.equal(await page.locator('#attachments .media-item').count(), 1);
  assert.equal(await page.locator('#attachments img').count(), 1);
  assert.equal(await page.locator('#attachments [data-sort-handle]').count(), 0);
  assert.equal(
    await page.locator('#attachments img').evaluate((el) => getComputedStyle(el).objectFit),
    'contain',
  );
  const before = await page.evaluate(() => JSON.stringify(window.acceptance.library.media));
  await page.locator('[data-gallery-step="1"]').click();
  assert.equal(await page.locator('#attachments .media-item').getAttribute('data-media-id'), 'two');
  await page.locator('[data-gallery-step="1"]').click();
  assert.equal(await page.locator('#attachments video').count(), 1);
  assert.equal(await page.locator('#attachments img').count(), 0);
  await page.locator('[data-gallery-step="1"]').click();
  assert.equal(await page.locator('#attachments audio').count(), 1);
  assert.equal(await page.locator('#attachments .media-item').count(), 1);
  assert.deepEqual(await page.evaluate(() => window.acceptance.writes), []);
  await page.evaluate(() => document.body.classList.add('writing-mode'));
  await page.waitForFunction(
    () => document.querySelectorAll('#attachments .media-item').length === 4,
  );
  assert.equal(await page.locator('#attachments [data-sort-handle]').count(), 4);
  await page
    .locator('[data-media-id="one"] [data-sort-handle]')
    .dragTo(page.locator('[data-media-id="audio"]'));
  await page.waitForFunction(() => window.acceptance.entry.attachments.at(-1) === 'one');
  assert.deepEqual(await page.evaluate(() => window.acceptance.entry.attachments), [
    'two',
    'video',
    'audio',
    'one',
  ]);
  const bodyBefore = await page.locator('#bodyEditor').innerHTML();
  await page
    .locator('[data-media-id="one"] [data-sort-handle]')
    .dragTo(page.locator('#bodyEditor'));
  assert.equal(await page.locator('#bodyEditor').innerHTML(), bodyBefore);
  assert.equal(uploads.length, 0);
  const output = path.join(root, 'var', 'gallery-acceptance');
  await mkdir(output, { recursive: true });
  await page.screenshot({ path: path.join(output, 'writing.png'), fullPage: true });
  await page.evaluate(() => document.body.classList.remove('writing-mode'));
  await page.waitForFunction(
    () => document.querySelectorAll('#attachments .media-item').length === 1,
  );
  await page.locator('[data-gallery-step="1"]').click();
  assert.equal(await page.locator('#attachments .media-item').getAttribute('data-media-id'), 'one');
  assert.equal(await page.evaluate(() => JSON.stringify(window.acceptance.library.media)), before);
  await page.screenshot({ path: path.join(output, 'reading.png'), fullPage: true });
  console.log(
    JSON.stringify({
      passed: true,
      checks: [
        'single actual media DOM',
        'image/video/audio navigation',
        'navigation writes nothing',
        'body class changes rebuild mode',
        'native drag persists stable order',
        'editor drop inserts nothing',
        'no uploads on navigation or sorting',
        'media timestamps unchanged',
      ],
      screenshots: output,
    }),
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
