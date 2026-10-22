import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import assert from 'node:assert/strict';
import { createDiaryServer } from '../src/server/app.mjs';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(
  pathToFileURL(
    process.env.SHIYE_PLAYWRIGHT_PATH ||
      'C:/Users/<用户名>/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs',
  ).href
);

const root = path.resolve(process.env.SHIYE_REVISIT_UI_ROOT || 'outputs/revisit-push/app'),
  out = path.resolve(process.env.SHIYE_REVISIT_UI_OUT || 'outputs/revisit-push');
const dir = path.resolve(process.env.SHIYE_REVISIT_UI_TMP || 'tmp/revisit-push/ui', randomUUID());
await fs.mkdir(out, { recursive: true });
await fs.mkdir(path.join(dir, 'media'), { recursive: true });
const now = new Date(),
  earlier = new Date(now.getTime() - 10 * 60000),
  old = new Date(earlier);
old.setUTCFullYear(old.getUTCFullYear() - 1);
const stamp = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai',
  dateStyle: 'short',
  timeStyle: 'medium',
}).format(old);
function pngChunk(type, data) {
  const payload = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of payload) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const header = Buffer.alloc(4),
    tail = Buffer.alloc(4);
  header.writeUInt32BE(data.length);
  tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([header, payload, tail]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(160);
ihdr.writeUInt32BE(90, 4);
ihdr[8] = 8;
ihdr[9] = 2;
const row = Buffer.concat([
  Buffer.from([0]),
  Buffer.from(Array.from({ length: 160 }, () => [74, 150, 160]).flat()),
]);
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  pngChunk('IHDR', ihdr),
  pngChunk('IDAT', deflateSync(Buffer.concat(Array(90).fill(row)))),
  pngChunk('IEND', Buffer.alloc(0)),
]);
const db = {
  entries: [
    {
      id: 'synthetic-entry',
      title: '隔离回看验收',
      category: '日常',
      tags: [],
      date: old.toISOString(),
      contentEditedAt: old.toISOString(),
      contentFormat: 'html',
      content: `<p>[${stamp}]</p><p><em>过去的思绪</em>，配图留在原件。</p>`,
      revision: 1,
      attachments: ['synthetic-image'],
    },
  ],
  media: [{ id: 'synthetic-image', name: '合成图.png', type: 'image/png', size: png.length }],
  categories: ['日常'],
};
if (process.env.SHIYE_REVISIT_VERIFY_TARGET_DRAFT === '1') {
  const later = new Date(old.getTime() + 120000).toISOString();
  db.entries.push({
    ...db.entries[0],
    id: 'synthetic-later-entry',
    date: later,
    contentEditedAt: later,
    content: '<p>另一组隔离回看来信</p>',
    attachments: [],
  });
}
await fs.writeFile(path.join(dir, 'diary.json'), JSON.stringify(db));
await fs.writeFile(path.join(dir, 'media/synthetic-image'), png);
const server = await createDiaryServer({ dataDir: dir, seed: false });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const request = async (route, method = 'POST', input) => {
  const response = await fetch(base + route, {
    method,
    headers: { 'X-Diary-Client': 'desktop', 'Content-Type': 'application/json' },
    ...(method !== 'GET' ? { body: JSON.stringify(input || {}) } : {}),
  });
  return { status: response.status, data: await response.json() };
};
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
const report = { checks: [], runtimeErrors: [], network: [] };
let denyRevisit = false;
let delayMedia = false;
let failComment = false;
let page;
const expect = (value, name) => {
  assert.ok(value, name);
  report.checks.push(name);
  if (process.env.SHIYE_REVISIT_VERIFY_WITHDRAWAL === '1') console.log(name);
};
try {
  await request('/api/revisit/config', 'PUT', { expectedRevision: 1, enabled: true });
  const result = await request('/api/revisit/tick', 'POST', {
    manual: true,
    from: new Date(earlier.getTime() - 60000).toISOString(),
    to:
      process.env.SHIYE_REVISIT_VERIFY_TARGET_DRAFT === '1'
        ? new Date(earlier.getTime() + 60000).toISOString()
        : now.toISOString(),
  });
  expect(result.data.created === 2, '文字和旧附件均成为独立来源投递');
  const context = await browser.newContext({
    viewport: { width: 1120, height: 800 },
    serviceWorkers: 'block',
  });
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== 'https://shiye-preview.local') {
      report.network.push(url.origin);
      return route.abort();
    }
    const file = path.resolve(
      root,
      '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname),
    );
    if (!file.startsWith(root + path.sep)) return route.abort();
    const types = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.wasm': 'application/wasm',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.woff2': 'font/woff2',
    };
    try {
      await route.fulfill({
        status: 200,
        contentType: types[path.extname(file)] || 'application/octet-stream',
        body: await fs.readFile(file),
      });
    } catch {
      await route.fulfill({ status: 404, body: '' });
    }
  });
  page = await context.newPage();
  page.on('pageerror', (error) => report.runtimeErrors.push(error.message));
  page.on('dialog', async (dialog) => {
    report.runtimeErrors.push(dialog.message().slice(0, 300));
    await dialog.dismiss();
  });
  await page.exposeFunction('__localJournal', async (message) => {
    if (failComment && message.action === 'revisit-comment')
      return { status: 409, data: { error: '隔离验收：评论冲突，请重试' } };
    if (denyRevisit && message.action.startsWith('revisit-'))
      return { status: 401, data: { error: '隔离验收：已锁定' } };
    if (delayMedia && message.action === 'revisit-media')
      await new Promise((resolve) => setTimeout(resolve, 600));
    const map = {
      'revisit-status': ['/api/revisit', 'GET'],
      'revisit-config': ['/api/revisit/config', 'PUT'],
      'revisit-tick': ['/api/revisit/tick', 'POST'],
      'revisit-feed': ['/api/revisit/feed', 'POST'],
      'revisit-context': ['/api/revisit/comments/context', 'POST'],
      'revisit-source': ['/api/revisit/source', 'POST'],
      'revisit-media': ['/api/revisit/media', 'POST'],
      'revisit-comment': ['/api/revisit/comments', 'POST'],
      'revisit-withdraw': ['/api/revisit/comments/withdraw', 'POST'],
      'revisit-runner-status': ['/api/revisit/runner', 'GET'],
      'revisit-runner-start': ['/api/revisit/runner/start', 'POST'],
      'revisit-runner-stop': ['/api/revisit/runner/stop', 'POST'],
      status: ['/api/chat-journal', 'GET'],
    };
    const endpoint = map[message.action];
    return endpoint
      ? request(...endpoint, message.payload)
      : { status: 400, data: { error: '隔离验收仅允许回看接口' } };
  });
  await page.addInitScript(() => {
    window.__revisitUrls = new Set();
    const create = URL.createObjectURL.bind(URL),
      revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const url = create(blob);
      window.__revisitUrls.add(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      window.__revisitUrls.delete(url);
      revoke(url);
    };
    const listeners = [];
    window.chrome ||= {};
    window.chrome.webview = {
      addEventListener: (_name, handler) => listeners.push(handler),
      postMessage(message) {
        if (message.kind !== 'journal-request') return;
        window
          .__localJournal(message)
          .then((result) =>
            listeners.forEach((handler) =>
              handler({ data: { kind: 'journal-result', id: message.id, result } }),
            ),
          );
      },
    };
  });
  await page.goto('https://shiye-preview.local/');
  await page.waitForFunction(() => window.shiyeRoomUi && window.shiyeRevisit, { timeout: 60000 });
  await page.evaluate(() => window.shiyeRevisit.sync());
  report.connection = await page.evaluate(() => window.shiyeRevisit.status?.());
  await fs.writeFile(path.join(out, 'ui-progress.json'), JSON.stringify(report, null, 2));
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent('shiye-refresh-rooms', { detail: { id: '-900000001' } })),
  );
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(out, 'revisit-group-debug.png'), fullPage: true });
  await fs.writeFile(path.join(out, 'group-debug.txt'), await page.locator('body').innerText());
  await page.getByText('过去的思绪', { exact: false }).first().waitFor({ timeout: 30000 });
  expect((await page.locator('.shiye-markdown em').count()) > 0, '群聊里实际渲染旧日记斜体');
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.Message .full-media')].some(
        (image) => image.complete && image.naturalWidth === 160,
      ),
    { timeout: 15000 },
  );
  expect(true, '推送图片使用160像素原图并实际解码显示');
  expect(await page.locator('.shiye-revisit-target').isVisible(), '输入区显示评论目标');
  expect(
    await page.evaluate(() => {
      const target = document.querySelector('.shiye-revisit-target');
      const footer = target.closest('.middle-column-footer');
      const composer = footer?.querySelector('.Composer');
      return Boolean(
        footer &&
        composer &&
        target.getBoundingClientRect().bottom <= composer.getBoundingClientRect().top,
      );
    }),
    '评论目标处于footer正常布局且不覆盖输入框',
  );
  await page.evaluate(() => {
    window.__revisitNodes = [...document.querySelectorAll('.Message')];
    window.__revisitRefreshes = 0;
    window.addEventListener('shiye-refresh-rooms', () => {
      window.__revisitRefreshes++;
    });
  });
  await page.evaluate(() => window.shiyeRevisit.sync());
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__revisitRefreshes === 0), '相同feed不重新加载全部会话');
  expect(
    await page.evaluate(
      () =>
        window.__revisitNodes.length > 0 && window.__revisitNodes.every((node) => node.isConnected),
    ),
    '相同feed保留旧消息DOM节点',
  );
  expect(
    await page.evaluate(() => {
      const summary = document
        .querySelector('#LeftColumn [data-peer-id="-900000001"]')
        ?.closest('.ListItem')
        ?.querySelector('.subtitle');
      return summary && !/\*\*|\]\(https:/.test(summary.textContent);
    }),
    '朝花夕拾列表摘要没有Markdown语法和链接地址',
  );
  for (const scenario of [
    { width: 360, height: 800, manual: 64, font: 20 },
    { width: 868, height: 1649, manual: 240, font: 16 },
  ]) {
    await page.evaluate(({ manual, font }) => {
      localStorage.setItem('shiye-input-manual-height-v1', String(manual));
      const appearance = JSON.parse(localStorage.getItem('shiye-preview-appearance-v1') || '{}');
      appearance.inputFontSize = font;
      localStorage.setItem('shiye-preview-appearance-v1', JSON.stringify(appearance));
    }, scenario);
    await page.setViewportSize({ width: scenario.width, height: scenario.height });
    await page.reload();
    await page.waitForFunction(() => window.shiyeRevisit && window.shiyeRoomUi);
    await page.evaluate(() => window.shiyeRevisit.sync());
    await page.evaluate(() =>
      window.dispatchEvent(new CustomEvent('shiye-open-room', { detail: { id: '-900000001' } })),
    );
    await page.locator('.shiye-revisit-target').waitFor({ state: 'visible' });
    await page.waitForTimeout(350);
    expect(
      await page.evaluate(() => {
        const target = document.querySelector('.shiye-revisit-target'),
          footer = target.closest('.middle-column-footer');
        const composer = footer.querySelector('.Composer'),
          editor = footer.querySelector('#editable-message-text');
        return (
          target.getBoundingClientRect().bottom <= composer.getBoundingClientRect().top &&
          editor.getBoundingClientRect().height > 0 &&
          footer.getBoundingClientRect().right <= innerWidth + 1
        );
      }),
      `${scenario.width}px窗口/${scenario.manual}px手调输入高度保留目标条正常布局`,
    );
    expect(
      await page.evaluate(
        (height) => localStorage.getItem('shiye-input-manual-height-v1') === String(height),
        scenario.manual,
      ),
      '切房/重开保留手调输入高度偏好',
    );
  }
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent('shiye-set-sidebar', { detail: { collapsed: true } })),
  );
  await page.waitForTimeout(300);
  await page.locator('#editable-message-text').click();
  failComment = true;
  await page.keyboard.insertText('今天的隔离回看感想');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  await page.evaluate(() => window.shiyeRevisit.sync());
  expect(
    await page.locator('.shiye-revisit-feedback[role="status"]').isVisible(),
    '评论失败在群聊输入区显示可见错误',
  );
  expect(
    (await request('/api/library', 'GET')).data.revisit.comments.length === 0,
    '冲突未被当成发送成功',
  );
  await page.exposeFunction('__allowCommentRetry', () => {
    failComment = false;
  });
  await page.evaluate(() => {
    const button = document.querySelector('.shiye-revisit-feedback button');
    const original = button.onclick;
    button.onclick = async () => {
      await window.__allowCommentRetry();
      return original();
    };
  });
  await page
    .locator('.shiye-revisit-feedback')
    .getByRole('button', { name: '重试', exact: true })
    .click();
  await page.waitForFunction(() => document.querySelector('.shiye-revisit-feedback').hidden);
  expect(true, '重试成功后清除错误提示');
  const library = (await request('/api/library', 'GET')).data;
  expect(
    library.revisit.comments.length === 1 && library.revisit.comments[0].targets.length === 2,
    '群聊无引用发送评论并关联最近固定组',
  );
  expect(library.entries.length === db.entries.length, '评论没有反向生成日记或回看来源');
  if (process.env.SHIYE_REVISIT_VERIFY_RUNNER === '1') {
    for (const side of ['left', 'right']) {
      const positions = await page.evaluate((side) => {
        document.body.dataset.shiyeAlign = side;
        const own = document
          .querySelector('.Message.own .message-content-wrapper')
          ?.getBoundingClientRect();
        const past = document
          .querySelector('.Message:not(.own) .message-content-wrapper')
          ?.getBoundingClientRect();
        return own && past ? { own: own.x + own.width / 2, past: past.x + past.width / 2 } : null;
      }, side);
      expect(
        positions &&
          (side === 'left' ? positions.own < positions.past : positions.own > positions.past),
        `我的消息靠${side === 'left' ? '左' : '右'}时往日来信居于相对侧`,
      );
    }
  }
  await page.getByText('查看原日记', { exact: true }).first().click();
  await page.locator('.shiye-revisit-dialog[open] article').waitFor();
  expect(
    (await page.locator('.shiye-revisit-dialog[open] article').count()) === 1,
    '群聊可打开只读原记录',
  );
  await page.screenshot({ path: path.join(out, 'revisit-source.png'), fullPage: true });
  await page
    .locator('.shiye-revisit-dialog[open]')
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  const feed = (await request('/api/revisit/feed', 'POST', { after: 0, limit: 50 })).data;
  const mediaDelivery = feed.deliveries.find((item) => item.source.media.length);
  const urlsBefore = await page.evaluate(() => window.__revisitUrls.size);
  delayMedia = true;
  await page.evaluate((id) => {
    void window.shiyeRevisit.openSource(id);
  }, mediaDelivery.id);
  await page.locator('.shiye-revisit-dialog[open] article').waitFor();
  await page
    .locator('.shiye-revisit-dialog[open]')
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  await page.waitForTimeout(900);
  expect(
    await page.evaluate((size) => window.__revisitUrls.size === size, urlsBefore),
    '媒体请求中关闭原文不遗留对象URL',
  );
  delayMedia = false;
  await page.evaluate((id) => window.shiyeRevisit.openSource(id), mediaDelivery.id);
  await page.locator('.shiye-revisit-dialog[open] article img').waitFor();
  denyRevisit = true;
  await page.evaluate(() => window.shiyeRevisit.sync());
  await page.waitForTimeout(100);
  expect(
    (await page.locator('.shiye-revisit-dialog[open] article').count()) === 0,
    '锁定回执关闭已打开原文',
  );
  expect(
    await page.evaluate((size) => window.__revisitUrls.size <= size, urlsBefore),
    '锁定回执回收原文媒体URL',
  );
  denyRevisit = false;
  await page.evaluate(() => window.shiyeRevisit.sync());
  await page.evaluate(() => window.dispatchEvent(new Event('shiye-open-revisit')));
  await page.getByRole('heading', { name: '朝花夕拾 · 推送与回看' }).waitFor();
  expect(await page.getByText('启用程序推送接收').isVisible(), '中文设置面板可打开');
  expect(
    await page.evaluate(() => {
      const dialog = document.querySelector('.shiye-revisit-settings');
      const body = dialog.querySelector('.shiye-revisit-settings-body');
      const actions = dialog.querySelector('.shiye-revisit-actions');
      return (
        getComputedStyle(body).overflowY === 'auto' &&
        !body.contains(actions) &&
        actions.querySelector('button[type="submit"]')?.form
      );
    }),
    '设置参数单独滚动，保存及关闭位于固定动作区',
  );
  await page.screenshot({ path: path.join(out, 'revisit-settings.png'), fullPage: true });
  if (process.env.SHIYE_REVISIT_VERIFY_RUNNER === '1') {
    const runner = page.locator('.shiye-revisit-runner');
    const form = page.locator('.shiye-revisit-settings form');
    await form.locator('[name="mode"]').selectOption('daily-random');
    await form.locator('[name="dailyTime"]').fill('08:00');
    await page
      .locator('.shiye-revisit-actions')
      .getByRole('button', { name: '保存设置', exact: true })
      .click();
    await page.waitForFunction(
      async () => (await window.shiyeJournal.program('status')).config.mode === 'daily-random',
    );
    expect(
      (await request('/api/revisit', 'GET')).data.config.dailyTime === '08:00',
      '随机回看方式与北京时间08:00经真实设置写入后台',
    );
    await page.waitForFunction(
      () => document.querySelector('.shiye-revisit-runner-status')?.textContent === '已停止',
    );
    expect(
      (await request('/api/revisit/runner', 'GET')).data.state === 'stopped',
      '新后台推送器默认停止',
    );
    await runner.getByRole('button', { name: '启动推送', exact: true }).click();
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.shiye-revisit-runner button')].every(
        (button) => !button.disabled,
      ),
    );
    expect(
      (await request('/api/revisit/runner', 'GET')).data.running,
      '真实设置按钮经固定桥启动后台推送',
    );
    await page
      .locator('.shiye-revisit-settings .shiye-revisit-actions')
      .getByRole('button', { name: '关闭', exact: true })
      .click();
    expect(
      (await request('/api/revisit/runner', 'GET')).data.running,
      '关闭设置不停止已启动的推送器',
    );
    await page.evaluate(() => window.dispatchEvent(new Event('shiye-open-revisit')));
    await page.locator('.shiye-revisit-runner').waitFor();
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.shiye-revisit-runner button')].every(
        (button) => !button.disabled,
      ),
    );
    await page
      .locator('.shiye-revisit-runner')
      .getByRole('button', { name: '停止推送', exact: true })
      .click();
    await page.waitForFunction(() =>
      document.querySelector('.shiye-revisit-runner-status')?.textContent?.startsWith('已停止'),
    );
    expect(!(await request('/api/revisit/runner', 'GET')).data.running, '真实设置按钮停止后台推送');
  }
  if (process.env.SHIYE_REVISIT_VERIFY_WITHDRAWAL === '1') {
    await page
      .locator('.shiye-revisit-settings .shiye-revisit-actions')
      .getByRole('button', { name: '关闭', exact: true })
      .click();
    async function withdrawMessage(locator) {
      await locator.click({ button: 'right' });
      await page.getByText('撤回', { exact: true }).last().click();
      const confirmation = page.locator('.Modal.open').filter({
        has: page.getByText('正文将移除，并保留撤回提示；2分钟内可重新编辑。', { exact: true }),
      });
      await confirmation.getByRole('heading', { name: '撤回消息', exact: true }).waitFor();
      expect(
        (await confirmation.getByRole('heading', { name: '撤回消息', exact: true }).count()) ===
          1 &&
          (await confirmation.getByRole('button', { name: '撤回消息', exact: true }).count()) === 1,
        '撤回确认标题/说明/按钮准确且不使用删除文案',
      );
      await confirmation.getByRole('button', { name: '撤回消息', exact: true }).click();
      await page.getByText('你撤回了一条消息', { exact: true }).last().waitFor();
    }
    await withdrawMessage(
      page.locator('#MiddleColumn').getByText('今天的隔离回看感想', { exact: true }).first(),
    );
    expect(
      await page.getByRole('button', { name: '重新编辑', exact: true }).isVisible(),
      '实际消息菜单撤回后出现墓碑和限时重新编辑',
    );
    await page.evaluate(() => window.shiyeRevisit.sync());
    const withdrawn = (await request('/api/library', 'GET')).data.revisit.comments;
    expect(
      withdrawn.length === 1 && withdrawn[0].state === 'withdrawn' && !withdrawn[0].text,
      '真实评论撤回清空后台正文且保留墓碑',
    );
    await page.getByRole('button', { name: '重新编辑', exact: true }).click();
    await page.waitForFunction(() =>
      [...document.querySelectorAll('#MiddleColumn [contenteditable="true"]')].some(
        (node) => node.textContent === '今天的隔离回看感想',
      ),
    );
    expect(true, '墓碑重新编辑恢复原评论到输入草稿');
    await page.locator('#editable-message-text').press('Enter');
    await page.waitForTimeout(700);
    await page.evaluate(() => window.shiyeRevisit.sync());
    const resent = (await request('/api/library', 'GET')).data.revisit.comments;
    expect(
      resent.length === 2 &&
        resent.some(
          (item) => item.state === 'active' && item.operationId !== withdrawn[0].operationId,
        ),
      '恢复后重发使用新操作身份且原撤回不复活',
    );
    await page.reload();
    await page.waitForFunction(() => window.shiyeRevisit && window.shiyeRoomUi);
    await page.evaluate(() => window.shiyeRevisit.sync());
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('shiye-open-room', { detail: { id: '-900000001' } }));
      window.dispatchEvent(new CustomEvent('shiye-set-sidebar', { detail: { collapsed: true } }));
    });
    await page.getByText('你撤回了一条消息', { exact: true }).last().waitFor();
    expect(
      (await page.getByRole('button', { name: '重新编辑', exact: true }).count()) === 0,
      '重开保留撤回墓碑且不持久化恢复正文缓存',
    );
    if (process.env.SHIYE_REVISIT_VERIFY_TARGET_DRAFT === '1') {
      await page.locator('.shiye-revisit-target').click();
      await page
        .locator('.shiye-revisit-dialog[open]')
        .getByRole('button', { name: /最近展示的一组/ })
        .click();
    }
    const mediaRoom = await page.evaluate(async () => {
      const room = await window.shiyeRoomUi.command('create', {
        title: '媒体撤回隔离',
        kind: 'session',
        idleHours: 5,
      });
      window.dispatchEvent(new CustomEvent('shiye-refresh-rooms', { detail: { id: room.id } }));
      return room.id;
    });
    await page.waitForFunction((id) => window.shiyeRoomUi.currentId() === id, mediaRoom);
    await page.waitForTimeout(350);
    await page.locator('#editable-message-text').waitFor({ state: 'visible' });
    await page.locator('#editable-message-text').click();
    await page.evaluate((base64) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], 'withdrawal-synthetic.png', { type: 'image/png' }));
      document.activeElement.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
    }, png.toString('base64'));
    console.log(
      JSON.stringify(
        await page.evaluate(() => ({
          room: window.shiyeRoomUi.currentId(),
          focused: document.activeElement?.outerHTML.slice(0, 400),
          editors: [...document.querySelectorAll('#MiddleColumn [contenteditable]')].map(
            (node) => ({
              id: node.id,
              visible: Boolean(node.getClientRects().length),
              editable: node.getAttribute('contenteditable'),
            }),
          ),
        })),
      ),
    );
    await page.locator('.shiye-attachment-modal .modal-dialog').waitFor({ state: 'visible' });
    if (process.env.SHIYE_REVISIT_VERIFY_TARGET_DRAFT === '1') {
      const readTarget = () =>
        page.evaluate(async () => {
          const database = await new Promise((resolve, reject) => {
            const req = indexedDB.open('shiye-telegram-preview-v1', 1);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });
          try {
            return await new Promise((resolve) => {
              const req = database.transaction('preview').objectStore('preview').get('library');
              req.onsuccess = () => resolve(req.result?.shiyeRevisit?.targetBatchId);
            });
          } finally {
            database.close();
          }
        });
      const before = await readTarget();
      await request('/api/revisit/tick', 'POST', {
        manual: true,
        from: new Date(earlier.getTime() + 60000).toISOString(),
        to: now.toISOString(),
      });
      await page.evaluate(() => window.shiyeRevisit.sync());
      expect((await readTarget()) === before, '附件子弹窗可见时新feed保留原评论目标');
      expect(
        await page.locator('.shiye-attachment-modal .modal-dialog').isVisible(),
        '新feed不清空已开图片待发窗口',
      );
    }
    await page.locator('.shiye-media-send').click();
    await page.waitForTimeout(800);
    const photo = page.locator('.Message.own .full-media').last();
    await photo.waitFor({ state: 'visible' });
    await withdrawMessage(photo);
    await page.getByRole('button', { name: '重新编辑', exact: true }).click();
    await page.locator('.shiye-attachment-modal .modal-dialog').waitFor({ state: 'visible' });
    expect(
      (await page.locator('.shiye-attachment-modal img').count()) > 0,
      '实际图片撤回后可恢复原字节到附件待发窗口',
    );
    await page.screenshot({
      path: path.join(out, 'withdrawal-media-recovery.png'),
      fullPage: true,
    });
  }
  expect(report.network.length === 0, '页面没有外部网络请求');
  expect(report.runtimeErrors.length === 0, '无前端运行异常');
} finally {
  await page.screenshot({ path: path.join(out, 'final-page.png'), fullPage: true }).catch(() => {});
  await fs
    .writeFile(path.join(out, 'final-page.txt'), await page.locator('body').innerText())
    .catch(() => {});
  await fs.writeFile(path.join(out, 'ui-validation.json'), JSON.stringify(report, null, 2));
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
console.log(JSON.stringify({ passed: report.checks.length, errors: report.runtimeErrors.length }));
