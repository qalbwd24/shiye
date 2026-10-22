import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createDiaryServer } from '../src/server/app.mjs';
import {
  createRevisitHttpClient,
  localRunnerUrl,
  runnerError,
} from '../src/server/revisit-runner/client.mjs';
import { createRevisitRunner } from '../src/server/revisit-runner/runtime.mjs';
import { createRoutes } from '../src/server/routes/revisit-runner.mjs';
import { parseRunnerOptions } from '../tools/revisit/options.mjs';
import { commentLibrary } from './helpers/revisit-comment-fixtures.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const sourceHash = (db) =>
  createHash('sha256')
    .update(JSON.stringify({ entries: db.entries, media: db.media, units: db.messageStore }))
    .digest('hex');
async function until(check, timeout = 5000) {
  const end = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > end) throw Error('isolated condition timed out');
    await delay(5);
  }
}
const abortWait = (ms, signal) => delay(ms, undefined, { signal });
const fakeClient = (tick) => ({ tick, clearSession() {}, async unlock() {}, async authorize() {} });
async function isolated(t, setup = () => {}) {
  const fixture = commentLibrary();
  fixture.db.revisit.cursor = '2026-10-17T00:00:00.000Z';
  setup(fixture.db);
  const dir = path.join(ROOT, 'tmp/revisit-decoupling/stage6', randomUUID());
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'diary.json'), JSON.stringify(fixture.db));
  let server,
    port = 0;
  async function open() {
    server = await createDiaryServer({ dataDir: dir, seed: false, messageUnits: true });
    await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
    port = server.address().port;
  }
  async function close() {
    if (!server?.listening) return;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await open();
  t.after(close);
  const url = `http://127.0.0.1:${port}/`;
  const request = async (route, method = 'GET', payload, cookie = '') => {
    const response = await fetch(new URL(route, url), {
      method,
      redirect: 'manual',
      headers: { 'X-Diary-Client': 'desktop', ...(cookie ? { Cookie: cookie } : {}) },
      ...(method === 'GET' ? {} : { body: JSON.stringify(payload || {}) }),
    });
    return {
      status: response.status,
      cookie: response.headers.get('set-cookie')?.split(';')[0],
      data: await response.json(),
    };
  };
  return {
    dir,
    url,
    request,
    open,
    close,
    db: async () => JSON.parse(await fs.readFile(path.join(dir, 'diary.json'), 'utf8')),
  };
}

test('runner options reject unsafe destinations, unknown/duplicate flags and malformed modes without echoing input', () => {
  for (const url of [
    'https://127.0.0.1:9999',
    'http://example.com:80',
    'http://127.0.0.1',
    'http://127.0.0.1:9999/api',
    'http://user:secret@127.0.0.1:9999',
    'http://127.0.0.1:9999/?x=1',
  ])
    assert.throws(() => localRunnerUrl(url), { code: 'invalid_url' });
  assert.equal(localRunnerUrl('http://localhost:23456').hostname, '127.0.0.1');
  for (const rest of [
    ['--unknown'],
    ['--interval', '4'],
    ['--interval', '5.5'],
    ['--from', 'x'],
    ['--control', '--once'],
    ['--url', 'http://127.0.0.1:2'],
  ])
    assert.throws(() => parseRunnerOptions(['--url', 'http://127.0.0.1:23456', ...rest]));
  assert.equal(parseRunnerOptions(['--url', 'http://127.0.0.1:23456', '--once']).once, true);
});

test('real authentication is memory-only, wrong password is not retried, expired session waits for explicit unlock', async (t) => {
  const lab = await isolated(t),
    password = randomUUID();
  await lab.request('api/access', 'PUT', { password });
  let unlocks = 0;
  const client = createRevisitHttpClient({
    url: lab.url,
    fetchImpl: async (url, options) => {
      if (url.pathname === '/api/unlock') unlocks++;
      return fetch(url, options);
    },
  });
  const runner = createRevisitRunner({ client, intervalMs: 15 });
  t.after(() => runner.stop());
  runner.start();
  await until(() => runner.status().state === 'locked');
  assert.equal(unlocks, 0);
  await assert.rejects(runner.unlock('synthetic-wrong-password'), { code: 'locked' });
  await delay(40);
  assert.equal(unlocks, 1);
  await runner.unlock(password);
  await until(() => !!runner.status().lastSuccessAt);
  assert.equal(unlocks, 2);
  assert.ok(!JSON.stringify(runner.status()).includes(password));
  await lab.close();
  await lab.open();
  await until(() => runner.status().state === 'locked');
  assert.equal(unlocks, 2);
  await runner.unlock(password);
  await until(() => ['waiting', 'running'].includes(runner.status().state));
  await runner.stop();
  assert.equal(runner.status().running, false);
  await assert.rejects(client.tick(), { code: 'locked' });
});

test('real HTTP runner control adopts only the authenticated UI session, starts once and stops independently', async (t) => {
  const lab = await isolated(t),
    initial = sourceHash(await lab.db()),
    password = randomUUID();
  assert.equal((await lab.request('api/health')).data.revisit.runnerControl, 1);
  assert.equal((await lab.request('api/revisit/runner')).data.state, 'stopped');
  await lab.request('api/access', 'PUT', { password });
  assert.equal((await lab.request('api/revisit/runner/start', 'POST', {})).status, 401);
  const login = await lab.request('api/unlock', 'POST', { password });
  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      lab.request('api/revisit/runner/start', 'POST', {}, login.cookie),
    ),
  );
  assert.ok(results.every((r) => r.status === 200));
  let status;
  for (let i = 0; i < 100; i++) {
    status = (await lab.request('api/revisit/runner', 'GET', undefined, login.cookie)).data;
    if (status.lastSuccessAt) break;
    await delay(5);
  }
  assert.ok(status.lastSuccessAt);
  assert.equal(
    (await lab.request('api/revisit/runner/start', 'POST', { intervalSeconds: 5 }, login.cookie))
      .status,
    409,
  );
  assert.equal(
    (await lab.request('api/revisit/runner/start', 'POST', { password }, login.cookie)).status,
    400,
  );
  await lab.request('api/lock', 'POST', {}, login.cookie);
  const nextLogin = await lab.request('api/unlock', 'POST', { password });
  assert.equal(
    (await lab.request('api/revisit/runner/stop', 'POST', {}, nextLogin.cookie)).data.state,
    'stopped',
  );
  assert.equal(
    (
      await lab.request(
        'api/revisit/runner/start',
        'POST',
        { intervalSeconds: 5 },
        nextLogin.cookie,
      )
    ).status,
    200,
  );
  assert.equal(
    (await lab.request('api/revisit/runner/stop', 'POST', {}, nextLogin.cookie)).data.running,
    false,
  );
  assert.equal(sourceHash(await lab.db()), initial);
  const report = {
    isolatedDir: lab.dir,
    authenticatedControl: true,
    sourceUnchanged: true,
    concurrentStarts: 8,
    statusContainsSecrets:
      JSON.stringify(status).includes(password) ||
      JSON.stringify(status).includes(nextLogin.cookie),
  };
  assert.equal(report.statusContainsSecrets, false);
  await fs.mkdir(path.join(ROOT, 'outputs/revisit-decoupling/stage6'), { recursive: true });
  await fs.writeFile(
    path.join(ROOT, 'outputs/revisit-decoupling/stage6/http-control.json'),
    JSON.stringify(report, null, 2),
  );
});

test('single flight start/stop cancels an in-flight request and start cannot race a stopping instance', async () => {
  let attempts = 0;
  const runner = createRevisitRunner({
    client: fakeClient(async (_input, signal) => {
      attempts++;
      await abortWait(60000, signal);
    }),
  });
  for (let i = 0; i < 12; i++) runner.start();
  assert.equal(attempts, 1);
  const stopped = runner.stop();
  assert.equal(runner.status().state, 'stopping');
  assert.throws(() => runner.start(), { code: 'busy' });
  assert.equal(runner.stop(), stopped);
  await stopped;
  runner.start();
  assert.equal(attempts, 2);
  await runner.stop();
  assert.equal(runner.status().state, 'stopped');
});

test('stop interrupts a long backoff and clears next-attempt status promptly', async () => {
  const runner = createRevisitRunner({
    client: fakeClient(async () => {
      throw runnerError('offline', { retryable: true });
    }),
    retryBaseMs: 60000,
    retryMaxMs: 60000,
  });
  runner.start();
  await until(() => !!runner.status().nextAttemptAt);
  const start = Date.now();
  await runner.stop();
  assert.ok(Date.now() - start < 500);
  assert.equal(runner.status().nextAttemptAt, null);
});

test('exponential retry is bounded, success resets failures and catch-up bypasses the normal poll interval', async () => {
  const waits = [];
  let calls = 0;
  const runner = createRevisitRunner({
    client: fakeClient(async () => {
      if (++calls <= 3) throw runnerError('server_error', { retryable: true, status: 503 });
      return { created: 1, remaining: calls === 4, disabled: false };
    }),
    retryBaseMs: 10,
    retryMaxMs: 30,
    intervalMs: 1000,
    catchUpDelayMs: 3,
    random: () => 0.5,
    wait: async (ms, signal) => {
      waits.push(ms);
      if (waits.length < 5) return;
      await abortWait(60000, signal);
    },
  });
  runner.start();
  await until(() => waits.length === 5);
  await runner.stop();
  assert.deepEqual(waits, [10, 20, 30, 3, 1000]);
  assert.equal(runner.status().consecutiveFailures, 0);
});

test('rate limits respect Retry-After; unsupported and authentication failures do not spin', async () => {
  const waits = [];
  const runner = createRevisitRunner({
    client: fakeClient(async () => {
      throw runnerError('rate_limited', { status: 429, retryable: true, retryAfterMs: 300000 });
    }),
    wait: async (ms, signal) => {
      waits.push(ms);
      await abortWait(60000, signal);
    },
  });
  runner.start();
  await until(() => waits.length > 0);
  await runner.stop();
  assert.equal(waits[0], 300000);
  for (const code of [
    'locked',
    'unsupported',
    'forbidden',
    'invalid_request',
    'invalid_response',
  ]) {
    let calls = 0;
    const paused = createRevisitRunner({
      client: fakeClient(async () => {
        calls++;
        throw runnerError(code);
      }),
      intervalMs: 1,
    });
    paused.start();
    await until(() => paused.status().lastError);
    await delay(20);
    assert.equal(calls, 1);
    await paused.stop();
  }
});

test('stop during authentication cannot allow a late response to restart the runner', async () => {
  let calls = 0,
    started;
  const begun = new Promise((resolve) => {
    started = resolve;
  });
  const client = fakeClient(async () => {
    calls++;
    return { created: 0 };
  });
  client.unlock = async (_password, signal) => {
    started();
    await abortWait(60000, signal);
  };
  const runner = createRevisitRunner({ client });
  runner.start();
  await until(() => calls === 1);
  const auth = runner.unlock('synthetic-password');
  const rejected = assert.rejects(auth);
  await begun;
  await runner.stop();
  await rejected;
  assert.equal(runner.status().running, false);
  await delay(20);
  assert.equal(calls, 1);
});

test('real disconnect/reconnect plus lost commit response catches up without duplicate deliveries', async (t) => {
  const lab = await isolated(t, (db) => {
    const originalAt = new Date(Date.now() - 86400000 - 120000).toISOString();
    db.entries = [
      {
        ...db.entries[0],
        attachments: [],
        content: '<p>合成断线消息</p>',
        date: originalAt,
        contentEditedAt: originalAt,
        updatedAt: originalAt,
      },
    ];
    db.media = [];
    db.messageStore = { version: 1, units: [], layouts: {} };
    db.revisit = {
      ...db.revisit,
      config: { ...db.revisit.config, interval: { unit: 'day', count: 1 } },
      cursor: new Date(Date.now() - 600000).toISOString(),
      batches: [],
      deliveries: [],
      comments: [],
    };
  });
  let lose = true,
    committed;
  const client = createRevisitHttpClient({
    url: lab.url,
    timeoutMs: 300,
    fetchImpl: async (url, options) => {
      const response = await fetch(url, options);
      if (lose && url.pathname === '/api/revisit/tick') {
        lose = false;
        assert.ok((await response.json()).created > 0);
        committed = (await lab.db()).revisit.deliveries.map((d) => d.id);
        throw Error('synthetic lost response');
      }
      return response;
    },
  });
  const runner = createRevisitRunner({ client, intervalMs: 20, retryBaseMs: 20, retryMaxMs: 40 });
  t.after(() => runner.stop());
  const initial = sourceHash(await lab.db());
  runner.start();
  await until(() => !!runner.status().lastSuccessAt);
  const deliveries = (await lab.db()).revisit.deliveries.map((d) => d.id);
  assert.ok(deliveries.length > 0);
  assert.deepEqual(deliveries, committed);
  await lab.close();
  await until(() => runner.status().state === 'retrying');
  await lab.open();
  await until(
    () =>
      ['waiting', 'running'].includes(runner.status().state) &&
      runner.status().consecutiveFailures === 0,
  );
  await runner.stop();
  assert.deepEqual(
    (await lab.db()).revisit.deliveries.map((d) => d.id),
    deliveries,
  );
  assert.equal(sourceHash(await lab.db()), initial);
  await fs.writeFile(
    path.join(ROOT, 'outputs/revisit-decoupling/stage6/recovery.json'),
    JSON.stringify(
      {
        isolatedDir: lab.dir,
        createdBeforeLostResponse: committed.length,
        afterRetry: deliveries,
        afterReconnect: (await lab.db()).revisit.deliveries.map((d) => d.id),
        sourceBefore: initial,
        sourceAfter: sourceHash(await lab.db()),
      },
      null,
      2,
    ),
  );
});

test('actual timeout and stop abort a stalled local HTTP request', async (t) => {
  let requests = 0;
  const server = http.createServer(() => {
    requests++;
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const client = createRevisitHttpClient({
    url: `http://127.0.0.1:${server.address().port}/`,
    timeoutMs: 40,
  });
  await assert.rejects(client.tick(), { code: 'timeout', retryable: true });
  const runner = createRevisitRunner({ client });
  runner.start();
  await until(() => requests >= 2);
  const start = Date.now();
  await runner.stop();
  assert.ok(Date.now() - start < 500);
});

for (const status of [401, 403, 404, 429, 503, 302]) {
  test(`HTTP ${status} classification never includes response bodies or follows a redirect`, async () => {
    let request;
    const client = createRevisitHttpClient({
      url: 'http://127.0.0.1:23456',
      fetchImpl: async (_url, options) => {
        request = options;
        return new Response('synthetic-sensitive-body', {
          status,
          headers: { 'retry-after': '7', location: 'https://example.com' },
        });
      },
    });
    await assert.rejects(client.tick(), (error) => {
      assert.ok(!JSON.stringify(error).includes('synthetic-sensitive-body'));
      assert.equal(error.status, status);
      if (status === 429) assert.equal(error.retryAfterMs, 7000);
      return true;
    });
    assert.equal(request.redirect, 'manual');
  });
}

function cli(args) {
  const child = spawn(process.execPath, ['tools/revisit-push.mjs', ...args], {
    cwd: ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let output = '',
    errors = '';
  child.stdout.on('data', (data) => {
    output += data;
  });
  child.stderr.on('data', (data) => {
    errors += data;
  });
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, output, errors }));
  });
  return { child, done, output: () => output, errors: () => errors };
}

test('HTTP host stop cancels pending authorization and interval replacement cannot resurrect an old start', async (t) => {
  let hold = true,
    accesses = 0,
    ticks = 0;
  const held = [];
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/access') {
      accesses++;
      if (hold) held.push(res);
      else res.end(JSON.stringify({ enabled: false, unlocked: true }));
    } else {
      ticks++;
      res.end(JSON.stringify({ created: 0, cursor: null }));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const host = createRoutes({
    body: async (req) => JSON.stringify(req.input),
    reply: (_res, status, data) => ({ status, data }),
    fail: (status, message) => Object.assign(Error(message), { status }),
  });
  t.after(async () => {
    await host.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const request = (action, input = {}) =>
    host.handle(
      { method: 'POST', headers: {}, socket: { localPort: server.address().port }, input },
      {},
      '/api/revisit/runner/' + action,
    );
  const pending = request('start');
  const rejected = assert.rejects(pending, { status: 409 });
  await until(() => accesses === 1);
  assert.equal((await request('stop')).data.state, 'stopped');
  await rejected;
  hold = false;
  for (const res of held) res.end(JSON.stringify({ enabled: false, unlocked: true }));
  await delay(20);
  assert.equal(ticks, 0);
  assert.equal((await request('start', { intervalSeconds: 10 })).status, 200);
  await until(() => ticks === 1);
  await request('stop');
  const replacement = request('start', { intervalSeconds: 5 });
  const cancelled = assert.rejects(replacement, { status: 409 });
  await request('stop');
  await cancelled;
  assert.equal((await request('start', { intervalSeconds: 5 })).data.intervalMs, 5000);
  await request('stop');
});

test('response validation rejects damaged summaries and bounded retry hints avoid timer overflow', async () => {
  for (const value of [
    'not-json',
    JSON.stringify({ created: -1 }),
    JSON.stringify({ created: 1, cursor: 'invalid' }),
    JSON.stringify({ created: 1, initialized: 'yes' }),
    JSON.stringify({ created: 1, remaining: 'yes' }),
    ' '.repeat(1024 * 1024 + 1),
  ]) {
    const client = createRevisitHttpClient({
      url: 'http://127.0.0.1:23456',
      fetchImpl: async () => new Response(value),
    });
    await assert.rejects(client.tick(), { code: 'invalid_response', retryable: false });
  }
  const client = createRevisitHttpClient({
    url: 'http://127.0.0.1:23456',
    fetchImpl: async () =>
      new Response('', { status: 429, headers: { 'retry-after': '999999999999' } }),
  });
  const empty = createRevisitHttpClient({
    url: 'http://127.0.0.1:23456',
    fetchImpl: async () => new Response(null, { status: 204 }),
  });
  await assert.rejects(empty.tick(), { code: 'invalid_response', retryable: false });
  await assert.rejects(client.tick(), { code: 'rate_limited', retryAfterMs: 86400000 });
  assert.throws(() => createRevisitRunner({ client, intervalMs: 2 ** 32 }), {
    code: 'invalid_interval',
  });
});

test('CLI control EOF cancels in-flight delivery and exits instead of orphaning a polling loop', async (t) => {
  let ticks = 0;
  const server = http.createServer(() => {
    ticks++;
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const run = cli(['--url', `http://127.0.0.1:${server.address().port}`, '--control']);
  t.after(async () => {
    if (run.child.exitCode === null) run.child.kill();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  run.child.stdin.write(JSON.stringify({ id: 'start', action: 'start' }) + '\n');
  await until(() => ticks === 1);
  run.child.stdin.end();
  const result = await Promise.race([
    run.done,
    delay(3000).then(() => {
      throw Error('EOF failed to stop runner');
    }),
  ]);
  assert.equal(result.code, 0);
  assert.equal(result.errors, '');
  assert.ok(result.output.includes('"state":"stopped"'));
});

test('real CLI accepts password only through stdin, once stays backward compatible and output contains no credentials', async (t) => {
  const lab = await isolated(t),
    password = randomUUID();
  await lab.request('api/access', 'PUT', { password });
  const run = cli(['--url', lab.url, '--once', '--password-stdin']);
  t.after(() => {
    if (run.child.exitCode === null) run.child.kill();
  });
  run.child.stdin.end(password + '\n');
  const result = await run.done;
  assert.equal(result.code, 0);
  assert.ok(Number.isInteger(JSON.parse(result.output).created));
  assert.ok(!result.output.includes(password) && !result.errors.includes(password));
  const locked = cli(['--url', lab.url, '--once']);
  locked.child.stdin.end();
  const fail = await locked.done;
  assert.equal(fail.code, 1);
  assert.equal(JSON.parse(fail.errors).error.code, 'locked');
});

test('real CLI JSON-line host can authorize, start, stop, resume and exit without a GUI', async (t) => {
  const lab = await isolated(t),
    password = randomUUID();
  await lab.request('api/access', 'PUT', { password });
  const run = cli(['--url', lab.url, '--control', '--interval', '5']);
  t.after(() => {
    if (run.child.exitCode === null) run.child.kill();
  });
  const responses = () =>
    run
      .output()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  async function send(id, action, extra = {}) {
    run.child.stdin.write(JSON.stringify({ id, action, ...extra }) + '\n');
    await until(() => responses().some((v) => v.id === id), 8000);
    return responses().find((v) => v.id === id);
  }
  run.child.stdin.write('null\n[]\n');
  await until(() => responses().filter((v) => v.error?.code === 'invalid_input').length === 2);
  assert.equal((await send('first', 'start')).ok, true);
  await until(() => responses().some((v) => v.status?.state === 'locked'));
  assert.equal((await send('auth', 'unlock', { password })).ok, true);
  await until(() => responses().some((v) => v.status?.lastSuccessAt));
  assert.equal((await send('stop', 'stop')).status.running, false);
  assert.equal((await send('auth-again', 'unlock', { password })).ok, true);
  assert.equal((await send('resume', 'start')).ok, true);
  assert.equal((await send('exit', 'exit')).status.running, false);
  const result = await run.done;
  assert.equal(result.code, 0);
  assert.ok(!result.output.includes(password) && !result.errors.includes(password));
});
