import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createSyncServer } from '../src/server/sync-v2/server.mjs';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'tmp',
  'sync-backend',
  'server-tests',
);
async function fixture(t, options = {}) {
  const dataDir = path.join(root, randomUUID());
  let now = 1792281600000;
  const service = await createSyncServer({ dataDir, clock: () => now, ...options });
  t.after(() => service.close());
  service.server.listen(0, '127.0.0.1');
  await once(service.server, 'listening');
  return {
    service,
    dataDir,
    port: service.server.address().port,
    advance: (ms) => {
      now += ms;
    },
  };
}
function pending(fixture, route, { method = 'GET', body, headers = {} } = {}) {
  const bytes =
    body === undefined ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  let req;
  const promise = new Promise((resolve, reject) => {
    req = http.request(
      {
        host: '127.0.0.1',
        port: fixture.port,
        path: `${fixture.service.basePath}${route}`,
        method,
        agent: false,
        headers: {
          ...(bytes ? { 'Content-Type': 'application/json', 'Content-Length': bytes.length } : {}),
          ...headers,
        },
      },
      (res) => {
        const parts = [];
        res.on('data', (part) => parts.push(part));
        res.on('error', reject);
        res.on('end', () => {
          const text = Buffer.concat(parts).toString('utf8');
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            /* Static assets and byte responses are not JSON. */
          }
          resolve({ status: res.statusCode, headers: res.headers, text, json });
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('HTTP fixture request timed out')));
    req.end(bytes);
  });
  return { req, promise };
}
const request = (fixture, route, options) => pending(fixture, route, options).promise;
const authorized = (device) => ({
  Authorization: `Bearer ${device.token}`,
  'X-Sync-Device-Id': device.deviceId,
});
async function pair(fixture, { code, name = '合成设备' } = {}) {
  code ??= fixture.service.auth.pairingCode({ uses: 1 }).code;
  const response = await request(fixture, 'api/sync/v1/pair', {
    method: 'POST',
    body: { code, deviceName: name },
  });
  assert.equal(response.status, 201);
  assert.equal(typeof response.json.deviceId, 'string');
  assert.equal(/^[a-f0-9]{64}$/.test(response.json.token), true);
  return response.json;
}
function requestStarted(service, route) {
  return new Promise((resolve) => {
    const listener = (req) => {
      if (req.url.includes(route)) {
        service.server.off('request', listener);
        resolve();
      }
    };
    service.server.on('request', listener);
  });
}
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

test('sync HTTP pairing is single use, expires, and new pairing invalidates old codes', async (t) => {
  const f = await fixture(t);
  const first = f.service.auth.pairingCode({ ttlMs: 1000, uses: 1 });
  await pair(f, { code: first.code });
  assert.equal(
    (
      await request(f, 'api/sync/v1/pair', {
        method: 'POST',
        body: { code: first.code, deviceName: '耗尽' },
      })
    ).status,
    401,
  );
  const expired = f.service.auth.pairingCode({ ttlMs: 1000 });
  f.advance(1001);
  const response = await request(f, 'api/sync/v1/pair', {
    method: 'POST',
    body: { code: expired.code, deviceName: '过期' },
  });
  assert.equal(response.status, 401);
  assert.equal(response.json.error.code, 'PAIRING_INVALID');
  const previous = f.service.auth.pairingCode();
  let current = f.service.auth.pairingCode();
  while (current.code === previous.code) current = f.service.auth.pairingCode();
  assert.equal(
    (
      await request(f, 'api/sync/v1/pair', {
        method: 'POST',
        body: { code: previous.code, deviceName: '旧码' },
      })
    ).status,
    401,
  );
  await pair(f, { code: current.code });
});

test('sync HTTP pairing rate limits failed attempts and permits a valid code after cooldown', async (t) => {
  const f = await fixture(t);
  for (let n = 0; n < 5; n++) {
    const response = await request(f, 'api/sync/v1/pair', {
      method: 'POST',
      body: { code: 'not-a-code', deviceName: '限流样本' },
    });
    assert.equal(response.status, 401);
  }
  const code = f.service.auth.pairingCode().code;
  const blocked = await request(f, 'api/sync/v1/pair', {
    method: 'POST',
    body: { code, deviceName: '冷却前' },
  });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.json.error.code, 'PAIRING_RATE_LIMITED');
  f.advance(300001);
  await pair(f, { code });
});

test('sync HTTP device tokens are only returned at pairing and persisted only as hashes', async (t) => {
  const f = await fixture(t);
  const device = await pair(f);
  const headers = authorized(device);
  for (const route of ['api/sync/v1/health', 'api/sync/v1/info', 'api/sync/v1/devices']) {
    const response = await request(f, route, { headers });
    assert.equal(response.status, 200);
    assert.equal(response.text.includes(device.token), false);
    assert.equal(response.text.includes('tokenHash'), false);
    assert.equal(response.headers['cache-control'], 'no-store');
  }
  const inspector = new DatabaseSync(path.join(f.dataDir, 'devices.sqlite'));
  try {
    const rows = inspector.prepare('SELECT * FROM devices').all();
    assert.equal(JSON.stringify(rows).includes(device.token), false);
    assert.equal(
      rows[0].tokenHash === createHash('sha256').update(device.token).digest('hex'),
      true,
    );
  } finally {
    inspector.close();
  }
  const revoked = await request(f, `api/sync/v1/devices/${device.deviceId}`, {
    method: 'DELETE',
    headers,
  });
  assert.equal(revoked.status, 200);
  const denied = await request(f, 'api/sync/v1/info', { headers });
  assert.equal(denied.status, 401);
  assert.equal(denied.text.includes(device.token), false);
});

test('sync HTTP rejects missing credentials, forged device IDs, foreign Host and foreign Origin', async (t) => {
  const f = await fixture(t);
  assert.equal((await request(f, 'api/sync/v1/info')).status, 401);
  assert.equal(
    (await request(f, 'api/sync/v1/push', { method: 'POST', body: { operations: [] } })).status,
    401,
  );
  const device = await pair(f);
  const mismatch = await request(f, 'api/sync/v1/info', {
    headers: { ...authorized(device), 'X-Sync-Device-Id': 'forged-device' },
  });
  assert.equal(mismatch.status, 403);
  assert.equal(mismatch.json.error.code, 'DEVICE_ID_MISMATCH');
  const host = await request(f, 'api/sync/v1/info', {
    headers: { ...authorized(device), Host: 'attacker.invalid' },
  });
  assert.equal(host.status, 403);
  assert.equal(host.json.error.code, 'HOST_NOT_ALLOWED');
  const origin = await request(f, 'api/sync/v1/info', {
    headers: { ...authorized(device), Origin: 'https://attacker.invalid' },
  });
  assert.equal(origin.status, 403);
  assert.equal(origin.json.error.code, 'ORIGIN_NOT_ALLOWED');
  assert.equal(origin.headers['access-control-allow-origin'], undefined);
});

test('sync HTTP local pairing requires the explicit local header and refuses proxy forwarding', async (t) => {
  const f = await fixture(t);
  const options = { method: 'POST', body: {} };
  assert.equal((await request(f, 'api/sync/v1/local-pairing', options)).status, 403);
  for (const proxy of [
    { Forwarded: 'for=203.0.113.1' },
    { 'X-Forwarded-For': '203.0.113.1' },
    { 'X-Forwarded-Host': 'sync.example.invalid' },
  ]) {
    const response = await request(f, 'api/sync/v1/local-pairing', {
      ...options,
      headers: { 'X-Sync-Client': 'local-admin', ...proxy },
    });
    assert.equal(response.status, 403);
    assert.equal(response.json.error.code, 'LOCAL_PAIRING_ONLY');
  }
  const allowed = await request(f, 'api/sync/v1/local-pairing', {
    ...options,
    headers: { 'X-Sync-Client': 'local-admin' },
  });
  assert.equal(allowed.status, 200);
  assert.equal(/^\d{8}$/.test(allowed.json.code), true);
  const publicServer = await fixture(t, { publicOrigin: 'https://sync.example.invalid' });
  assert.equal(
    (
      await request(publicServer, 'api/sync/v1/local-pairing', {
        ...options,
        headers: { 'X-Sync-Client': 'local-admin' },
      })
    ).status,
    403,
  );
});

test('sync HTTP static and API routes honor a configured prefix and expose no filesystem paths', async (t) => {
  const f = await fixture(t, { basePath: '/private-sync/' });
  const response = await request(f, 'assets/sync-v2-client.js');
  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /^text\/javascript/);
  assert.match(response.text, /createSyncOperationId/);
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  const health = await request(f, 'api/sync/v1/health');
  assert.equal(health.status, 200);
  const outside = await new Promise((resolve, reject) => {
    const req = http.get(
      { host: '127.0.0.1', port: f.port, path: '/api/sync/v1/health', agent: false },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      },
    );
    req.on('error', reject);
  });
  assert.equal(outside, 404);
  const escape = await request(f, '../package.json');
  assert.equal(escape.status, 404);
  assert.equal(escape.text.includes(f.dataDir), false);
});

test('sync HTTP service refuses an existing diary directory before creating sync databases', async () => {
  const dataDir = path.join(root, randomUUID());
  await mkdir(dataDir, { recursive: true });
  await writeFile(path.join(dataDir, 'diary.json'), JSON.stringify({ fixture: true }), 'utf8');
  await assert.rejects(createSyncServer({ dataDir }), { code: 'DIARY_DIRECTORY_REFUSED' });
  assert.deepEqual(await readdir(dataDir), ['diary.json']);
  await assert.rejects(createSyncServer({ dataDir: 'relative-path' }), {
    code: 'EXPLICIT_DATA_DIRECTORY_REQUIRED',
  });
});

test('sync HTTP watch detects a committed push and subsequent empty watch times out without a change', async (t) => {
  const f = await fixture(t);
  const device = await pair(f);
  const headers = authorized(device);
  const info = await request(f, 'api/sync/v1/info', { headers });
  const started = requestStarted(f.service, 'api/sync/v1/watch');
  const watch = pending(
    f,
    `api/sync/v1/watch?cursor=${encodeURIComponent(info.json.cursor)}&timeout=1000`,
    { headers },
  );
  await started;
  await nextTurn();
  const pushed = await request(f, 'api/sync/v1/push', {
    method: 'POST',
    headers,
    body: {
      operations: [
        {
          operationId: randomUUID(),
          entityType: 'conversation',
          entityId: 'watch-room',
          baseRevision: 0,
          command: 'create',
          data: { title: '合成' },
        },
      ],
    },
  });
  assert.equal(pushed.status, 200);
  const changed = await watch.promise;
  assert.equal(changed.status, 200);
  assert.equal(changed.json.changed, true);
  assert.equal(changed.json.seq, 1);
  const latest = await request(f, 'api/sync/v1/info', { headers });
  const empty = await request(
    f,
    `api/sync/v1/watch?cursor=${encodeURIComponent(latest.json.cursor)}&timeout=100`,
    { headers },
  );
  assert.equal(empty.json.changed, false);
});

test('sync HTTP pending watch rechecks revocation before returning metadata', async (t) => {
  const f = await fixture(t);
  const observer = await pair(f);
  const admin = await pair(f);
  const info = await request(f, 'api/sync/v1/info', { headers: authorized(observer) });
  const started = requestStarted(f.service, 'api/sync/v1/watch');
  const watch = pending(
    f,
    `api/sync/v1/watch?cursor=${encodeURIComponent(info.json.cursor)}&timeout=150`,
    { headers: authorized(observer) },
  );
  await started;
  await nextTurn();
  const revoked = await request(f, `api/sync/v1/devices/${observer.deviceId}`, {
    method: 'DELETE',
    headers: authorized(admin),
  });
  assert.equal(revoked.status, 200);
  const denied = await watch.promise;
  assert.equal(denied.status, 401);
  assert.equal(denied.json.error.code, 'DEVICE_UNAUTHORIZED');
  assert.equal(denied.json.seq, undefined);
});

test('sync HTTP watch disconnect and server close release pending requests and timers', async (t) => {
  const f = await fixture(t);
  const device = await pair(f);
  const info = await request(f, 'api/sync/v1/info', { headers: authorized(device) });
  let started = requestStarted(f.service, 'api/sync/v1/watch');
  const disconnected = pending(
    f,
    `api/sync/v1/watch?cursor=${encodeURIComponent(info.json.cursor)}&timeout=30000`,
    { headers: authorized(device) },
  );
  const disconnectedResult = disconnected.promise.then(
    () => 'response',
    () => 'disconnected',
  );
  await started;
  await nextTurn();
  disconnected.req.destroy();
  assert.equal(await disconnectedResult, 'disconnected');
  started = requestStarted(f.service, 'api/sync/v1/watch');
  const shuttingDown = pending(
    f,
    `api/sync/v1/watch?cursor=${encodeURIComponent(info.json.cursor)}&timeout=30000`,
    { headers: authorized(device) },
  );
  const result = shuttingDown.promise.then(
    (response) => response.status,
    () => 'closed',
  );
  await started;
  await nextTurn();
  await f.service.close();
  assert.equal(['closed', 503].includes(await result), true);
  assert.equal(f.service.server.listening, false);
  await f.service.close();
});

test('sync HTTP watch enforces its pending-request cap and releases disconnected slots', async (t) => {
  const f = await fixture(t);
  const device = await pair(f);
  const headers = authorized(device);
  const info = await request(f, 'api/sync/v1/info', { headers });
  const route = `api/sync/v1/watch?cursor=${encodeURIComponent(info.json.cursor)}&timeout=30000`;
  let received = 0;
  let complete;
  const observed = new Promise((resolve) => {
    complete = resolve;
  });
  const listener = (req) => {
    if (req.url.includes('api/sync/v1/watch') && ++received === 64) {
      f.service.server.off('request', listener);
      complete();
    }
  };
  f.service.server.on('request', listener);
  const requests = Array.from({ length: 64 }, () => pending(f, route, { headers }));
  const completions = requests.map(({ promise }) => promise.catch(() => null));
  t.after(() => {
    f.service.server.off('request', listener);
    for (const item of requests) item.req.destroy();
  });
  await observed;
  await nextTurn();
  const limited = await request(f, route, { headers });
  assert.equal(limited.status, 429);
  assert.equal(limited.json.error.code, 'WATCH_LIMIT');
  for (const item of requests) item.req.destroy();
  await Promise.all(completions);
  await nextTurn();
  const available = await request(
    f,
    `api/sync/v1/watch?cursor=${encodeURIComponent(info.json.cursor)}&timeout=100`,
    { headers },
  );
  assert.equal(available.status, 200);
  assert.equal(available.json.changed, false);
});

test('sync HTTP authentication and revocation remain durable across service restart', async (t) => {
  const f = await fixture(t);
  const revoked = await pair(f);
  const active = await pair(f);
  assert.equal(
    (
      await request(f, `api/sync/v1/devices/${revoked.deviceId}`, {
        method: 'DELETE',
        headers: authorized(active),
      })
    ).status,
    200,
  );
  await f.service.close();
  const service = await createSyncServer({ dataDir: f.dataDir });
  t.after(() => service.close());
  service.server.listen(0, '127.0.0.1');
  await once(service.server, 'listening');
  const reopened = { service, port: service.server.address().port };
  assert.equal(
    (await request(reopened, 'api/sync/v1/info', { headers: authorized(active) })).status,
    200,
  );
  assert.equal(
    (await request(reopened, 'api/sync/v1/info', { headers: authorized(revoked) })).status,
    401,
  );
});
