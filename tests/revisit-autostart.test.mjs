import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { spawn } from 'node:child_process';
import { createDiaryServer } from '../src/server/app.mjs';
import { configureRevisit, tickRevisit } from '../src/server/domain/revisit.mjs';

const root = path.resolve(import.meta.dirname, '..');
async function waitFor(read, accept, timeout = 10000) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await read();
    if (accept(value)) return value;
    if (Date.now() >= end) throw Error('isolated auto-start condition timed out');
    await delay(10);
  }
}
async function lab(t, { enabled = true, automatic = true } = {}) {
  const dir = path.join(root, 'tmp/revisit-autostart', randomUUID());
  await fs.mkdir(dir, { recursive: true });
  const past = new Date(Date.now() - 120000);
  past.setUTCFullYear(past.getUTCFullYear() - 1);
  const db = {
    schema: 1,
    categories: ['测试'],
    media: [],
    entries: [
      {
        id: 'synthetic-history',
        title: '合成',
        content: '<p>合成来信</p>',
        category: '测试',
        tags: [],
        attachments: [],
        date: past.toISOString(),
        createdAt: past.toISOString(),
        updatedAt: past.toISOString(),
        revision: 1,
      },
    ],
  };
  configureRevisit(db, {
    expectedRevision: 1,
    enabled: true,
    mode: 'daily-random',
    dailyTime: '08:00',
    timeZone: 'Asia/Shanghai',
  });
  tickRevisit(db, {}, Date.now() - 300000);
  db.revisit.config.enabled = enabled;
  await fs.writeFile(path.join(dir, 'diary.json'), JSON.stringify(db));
  let server;
  let url;
  const open = async (auto = automatic) => {
    server = await createDiaryServer({ dataDir: dir, seed: false, revisitAutoStart: auto });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${server.address().port}/`;
  };
  const close = async () => {
    if (!server?.listening) return;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  };
  const request = async (endpoint, method = 'GET', payload, cookie = '') => {
    const response = await fetch(new URL(endpoint, url), {
      method,
      headers: { 'X-Diary-Client': 'desktop', ...(cookie ? { Cookie: cookie } : {}) },
      ...(method !== 'GET' ? { body: JSON.stringify(payload || {}) } : {}),
    });
    return {
      status: response.status,
      data: await response.json(),
      cookie: response.headers.get('set-cookie')?.split(';')[0],
    };
  };
  const read = async () => JSON.parse(await fs.readFile(path.join(dir, 'diary.json'), 'utf8'));
  const running = (cookie) =>
    waitFor(
      async () => (await request('api/revisit/runner', 'GET', undefined, cookie)).data,
      (value) => value.running && !!value.lastSuccessAt,
    );
  await open();
  t.after(close);
  return {
    dir,
    db,
    request,
    read,
    open,
    close,
    running,
    get url() {
      return url;
    },
  };
}

test('background alone resumes an enabled daily selection, catches missed messages once and preserves progress across restart', async (t) => {
  const l = await lab(t);
  assert.equal((await l.request('api/health')).data.revisit.autoStart, true);
  await l.running();
  const first = await l.read();
  assert.equal(first.revisit.deliveries.length, 1);
  assert.deepEqual(first.entries, l.db.entries);
  assert.deepEqual(first.media, l.db.media);
  assert.deepEqual(first.revisit.randomDays[0], l.db.revisit.randomDays[0]);
  assert.ok(first.revisit.cursor >= l.db.revisit.cursor);
  // No browser/window exists in this test; closing HTTP clients does not own the runner.
  assert.equal((await l.request('api/revisit/runner')).data.running, true);
  await l.close();
  await l.open();
  await l.running();
  const second = await l.read();
  assert.deepEqual(second.revisit.deliveries, first.revisit.deliveries);
  assert.deepEqual(second.revisit.randomDays, first.revisit.randomDays);
  assert.deepEqual(second.revisit.comments, first.revisit.comments);
  assert.deepEqual(second.entries, first.entries);
  assert.ok(second.revisit.cursor >= first.revisit.cursor);
});

test('disabled rules stay stopped; saving enabled config starts automatically; explicit stop lasts until next background restart', async (t) => {
  const l = await lab(t, { enabled: false });
  await delay(30);
  assert.equal((await l.request('api/revisit/runner')).data.running, false);
  assert.equal((await l.read()).revisit.cursor, l.db.revisit.cursor);
  const config = (await l.request('api/revisit')).data.config;
  assert.equal(
    (
      await l.request('api/revisit/config', 'PUT', {
        expectedRevision: config.revision,
        enabled: true,
      })
    ).status,
    200,
  );
  await l.running();
  const stopped = await l.request('api/revisit/runner/stop', 'POST');
  assert.equal(stopped.data.running, false);
  for (let i = 0; i < 3; i++) await l.request('api/revisit');
  assert.equal((await l.request('api/revisit/runner')).data.running, false);
  const paused = await l.read();
  await l.close();
  await l.open();
  await l.running();
  assert.deepEqual((await l.read()).revisit.deliveries, paused.revisit.deliveries);
});

test('locked startup preserves progress and resumes after normal unlock without storing credentials or a manual start', async (t) => {
  const l = await lab(t, { automatic: false });
  const password = randomUUID();
  assert.equal((await l.request('api/access', 'PUT', { password })).status, 200);
  await l.close();
  await l.open(true);
  // Access remains locked; startup must not bypass it or advance the cursor.
  await delay(50);
  assert.equal((await l.request('api/revisit')).status, 401);
  assert.equal((await l.read()).revisit.cursor, l.db.revisit.cursor);
  assert.equal(
    (await l.request('api/unlock', 'POST', { password: 'synthetic-wrong-password' })).status,
    401,
  );
  const login = await l.request('api/unlock', 'POST', { password });
  assert.equal(login.status, 200);
  const state = await l.running(login.cookie);
  assert.equal(state.lastError, null);
  const disk = await fs.readFile(path.join(l.dir, 'diary.json'), 'utf8');
  assert.ok(!disk.includes(password));
  assert.ok(!disk.includes(login.cookie));
  assert.equal((await l.read()).revisit.deliveries.length, 1);
});

test('the real server entrypoint opts into automatic resume without a desktop window or start request', async (t) => {
  const l = await lab(t, { automatic: false });
  const port = new URL(l.url).port;
  await l.close();
  const child = spawn(process.execPath, [path.join(root, 'server.mjs')], {
    cwd: root,
    env: { ...process.env, DIARY_DATA_DIR: l.dir, DIARY_PORT: port },
    windowsHide: true,
    stdio: 'ignore',
  });
  t.after(() => child.kill());
  await waitFor(
    async () => {
      try {
        return await l.request('api/health');
      } catch {
        return null;
      }
    },
    (value) => value?.data?.revisit?.autoStart === true,
  );
  await l.running();
  assert.equal((await l.read()).revisit.deliveries.length, 1);
});
