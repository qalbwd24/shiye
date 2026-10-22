import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { networkInterfaces } from 'node:os';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, access } from 'node:fs/promises';
import path from 'node:path';
import { createDiaryServer } from '../src/server/app.mjs';
import { createSharedRemoteAuth } from '../src/server/shared-sync/auth.mjs';
import { body, reply } from '../src/server/http.mjs';

const root = path.resolve('tmp/backend-shared-auth/tests');
const prefix = '/api/shared/v1/';
const admin = { 'X-Diary-Client': 'desktop', 'X-Sync-Client': 'local-admin' };

async function fixture(
  t,
  remote = { enabled: true, allowedHosts: ['shared.test'] },
  listenHost = '127.0.0.1',
) {
  await mkdir(root, { recursive: true });
  const dataDir = await mkdtemp(path.join(root, 'case-'));
  let server, port;
  const open = async (options) => {
    server = await createDiaryServer({
      dataDir,
      seed: false,
      sharedSync: true,
      sharedRemote: options,
    });
    server.listen(0, listenHost);
    await once(server, 'listening');
    port = server.address().port;
  };
  const close = async () => {
    if (server.listening) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  };
  await open(remote);
  t.after(async () => {
    await close();
    await rm(dataDir, { recursive: true, force: true });
  });
  const request = async (pathname, { method, json, headers = {}, address = '127.0.0.1' } = {}) => {
    // Keep control of the real wire Host: fetch may replace it with the URL's host.
    return new Promise((resolve, reject) => {
      const outgoing = http.request(
        {
          hostname: address,
          agent: false,
          port,
          path: pathname,
          method: method || (json === undefined ? 'GET' : 'POST'),
          headers: {
            ...(json === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...headers,
          },
        },
        (incoming) => {
          let text = '';
          incoming.on('data', (chunk) => {
            text += chunk;
          });
          incoming.on('end', () => {
            try {
              resolve({
                status: incoming.statusCode,
                value: text ? JSON.parse(text) : null,
                headers: {
                  get(name) {
                    const value = incoming.headers[name.toLowerCase()];
                    return Array.isArray(value) ? value.join(',') : (value ?? null);
                  },
                },
              });
            } catch (error) {
              reject(error);
            }
          });
        },
      );
      outgoing.on('error', reject);
      outgoing.end(json === undefined ? undefined : JSON.stringify(json));
    });
  };
  const pair = async (cookie) => {
    const code = await request(prefix + 'auth/local-pairing', {
      method: 'POST',
      headers: { ...admin, ...(cookie ? { Cookie: cookie } : {}) },
    });
    assert.equal(code.status, 200, JSON.stringify(code.value));
    const paired = await request(prefix + 'auth/pair', {
      json: { code: code.value.code, deviceName: 'synthetic-phone' },
    });
    assert.equal(paired.status, 201, JSON.stringify(paired.value));
    return paired.value;
  };
  return {
    dataDir,
    request,
    pair,
    close,
    get port() {
      return port;
    },
    async restart(options = remote) {
      await close();
      await open(options);
    },
  };
}
const credentials = (device) => ({
  Authorization: `Bearer ${device.token}`,
  'X-Sync-Device-Id': device.deviceId,
});
const error = (response, status, code) => {
  assert.equal(response.status, status, JSON.stringify(response.value));
  assert.equal(response.value.error.code, code);
};

test('opt-in paired HTTP reads the original JSON identity while tokens persist only as hashes in auth-only SQLite', async (t) => {
  const f = await fixture(t);
  const before = await readFile(path.join(f.dataDir, 'diary.json'));
  error(await f.request(prefix + 'info'), 401, 'DEVICE_UNAUTHORIZED');
  const device = await f.pair();
  const info = await f.request(prefix + 'info', {
    headers: { ...credentials(device), Host: `shared.test:${f.port}` },
  });
  assert.equal(info.status, 200, JSON.stringify(info.value));
  assert.equal(info.value.sameBusinessStore, true);
  const original = JSON.parse(before);
  assert.equal(info.value.libraryId, original._sharedSync.libraryId);
  assert.equal(info.value.epoch, original._sharedSync.epoch);
  assert.equal(JSON.stringify(info.value).includes(device.token), false);
  assert.deepEqual(await readFile(path.join(f.dataDir, 'diary.json')), before);
  const command = await f.request(prefix + 'command', {
    headers: credentials(device),
    json: {
      libraryId: info.value.libraryId,
      epoch: info.value.epoch,
      operationId: randomUUID(),
      action: 'conversation-create',
      input: {
        title: '远端共享房',
        category: '日常',
        idleHours: 5,
        mode: 'session',
        selfName: '共同本人',
      },
    },
  });
  assert.equal(command.status, 200, JSON.stringify(command.value));
  assert.equal(command.value.replayed, false);
  const persisted = JSON.parse(await readFile(path.join(f.dataDir, 'diary.json'), 'utf8'));
  assert.equal(persisted.chatJournal.rooms[0].title, '远端共享房');
  assert.equal(persisted._sharedSync.libraryId, original._sharedSync.libraryId);
  assert.equal(JSON.stringify(persisted).includes(device.token), false);
  const snapshot = await f.request(prefix + 'snapshot', {
    headers: credentials(device),
    json: {
      libraryId: info.value.libraryId,
      epoch: info.value.epoch,
      limit: 100,
    },
  });
  assert.equal(snapshot.status, 200, JSON.stringify(snapshot.value));
  assert.ok(
    snapshot.value.entities.some(
      (row) => row.entityType === 'conversation' && row.data.title === '远端共享房',
    ),
  );
  await access(path.join(f.dataDir, '.shared-auth', 'devices.sqlite'));
  await assert.rejects(access(path.join(f.dataDir, '.shared-auth', 'sync.sqlite')), {
    code: 'ENOENT',
  });
  await f.restart();
  const restarted = await f.request(prefix + 'info', { headers: credentials(device) });
  assert.equal(restarted.status, 200);
  assert.equal(restarted.value.libraryId, info.value.libraryId);
  assert.equal(restarted.value.epoch, info.value.epoch);
});

test('remote host/origin and device binding are checked independently of Bearer; cookie never substitutes for shared device auth', async (t) => {
  const f = await fixture(t),
    device = await f.pair();
  error(
    await f.request(prefix + 'info', {
      headers: { ...credentials(device), Host: 'evil.invalid:80' },
    }),
    403,
    'HOST_NOT_ALLOWED',
  );
  error(
    await f.request(prefix + 'info', {
      headers: { ...credentials(device), Origin: 'https://evil.invalid' },
    }),
    403,
    'ORIGIN_NOT_ALLOWED',
  );
  error(
    await f.request(prefix + 'info', {
      headers: { ...credentials(device), 'X-Sync-Device-Id': 'wrong-device' },
    }),
    403,
    'DEVICE_ID_MISMATCH',
  );
  const locked = await f.request('/api/access', {
    method: 'PUT',
    json: { password: 'synthetic-secret-123' },
    headers: { 'X-Diary-Client': 'desktop' },
  });
  assert.equal(locked.status, 200);
  const cookie = locked.headers.get('set-cookie').split(';')[0];
  assert.equal((await f.request('/api/library', { headers: { Cookie: cookie } })).status, 200);
  error(
    await f.request(prefix + 'info', { headers: { Cookie: cookie, ...admin } }),
    401,
    'DEVICE_UNAUTHORIZED',
  );
  assert.equal((await f.request(prefix + 'info', { headers: credentials(device) })).status, 200);
});

test('only unlocked loopback local-admin manages devices and pairing; revocation survives restart and rejects an old token', async (t) => {
  const f = await fixture(t),
    device = await f.pair();
  const firstCodeRequest = await f.request(prefix + 'auth/local-pairing', {
    method: 'POST',
    headers: credentials(device),
  });
  error(firstCodeRequest, 403, 'LOCAL_ADMIN_REQUIRED');
  error(
    await f.request(prefix + 'auth/devices', { headers: credentials(device) }),
    403,
    'LOCAL_ADMIN_REQUIRED',
  );
  error(
    await f.request(prefix + `auth/devices/${device.deviceId}`, {
      method: 'DELETE',
      headers: credentials(device),
    }),
    403,
    'LOCAL_ADMIN_REQUIRED',
  );
  error(
    await f.request(prefix + 'auth/local-pairing', {
      method: 'POST',
      headers: { ...admin, 'X-Forwarded-For': '10.0.0.2' },
    }),
    403,
    'LOCAL_ADMIN_REQUIRED',
  );
  const locked = await f.request('/api/access', {
    method: 'PUT',
    json: { password: 'synthetic-secret-123' },
    headers: { 'X-Diary-Client': 'desktop' },
  });
  assert.equal(locked.status, 200);
  const cookie = locked.headers.get('set-cookie').split(';')[0];
  error(await f.request(prefix + 'auth/devices', { headers: admin }), 401, 'LOCAL_UNLOCK_REQUIRED');
  const list = await f.request(prefix + 'auth/devices', { headers: { ...admin, Cookie: cookie } });
  assert.equal(list.status, 200);
  assert.equal(list.value.devices[0].id, device.deviceId);
  assert.equal(JSON.stringify(list.value).includes(device.token), false);
  const revoked = await f.request(prefix + `auth/devices/${device.deviceId}`, {
    method: 'DELETE',
    headers: { ...admin, Cookie: cookie },
  });
  assert.equal(revoked.status, 200);
  error(
    await f.request(prefix + 'info', { headers: credentials(device) }),
    401,
    'DEVICE_UNAUTHORIZED',
  );
  await f.restart();
  error(
    await f.request(prefix + 'info', { headers: credentials(device) }),
    401,
    'DEVICE_UNAUTHORIZED',
  );
});

test('legacy routes retain original Host, cookie and client-header controls; remote peers cannot spoof a localhost Host', async (t) => {
  const f = await fixture(t, { enabled: true, allowedHosts: ['shared.test'] }, '0.0.0.0');
  const device = await f.pair();
  assert.equal(
    (
      await f.request('/api/library', {
        headers: { ...credentials(device), Host: `shared.test:${f.port}` },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.request('/api/settings', {
        method: 'PUT',
        json: { shortcuts: {} },
        headers: credentials(device),
      })
    ).status,
    403,
  );
  assert.equal(
    (await f.request('/api/library', { headers: { 'X-Forwarded-For': '10.0.0.2' } })).status,
    403,
  );
  const ip = Object.values(networkInterfaces())
    .flat()
    .find((item) => item.family === 'IPv4' && !item.internal)?.address;
  if (ip) {
    const spoofed = await f.request('/api/library', {
      address: ip,
      headers: { Host: `127.0.0.1:${f.port}` },
    });
    assert.equal(spoofed.status, 403);
    const shared = await f.request(prefix + 'info', { address: ip, headers: credentials(device) });
    assert.equal(shared.status, 200, JSON.stringify(shared.value));
  }
  const response = await new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port: f.port,
        path: `http://127.0.0.1:${f.port}${prefix}info`,
        method: 'GET',
      },
      (incoming) => {
        let text = '';
        incoming.on('data', (chunk) => {
          text += chunk;
        });
        incoming.on('end', () => resolve({ status: incoming.statusCode, value: JSON.parse(text) }));
      },
    );
    request.on('error', reject);
    request.end();
  });
  error(response, 400, 'SHARED_INVALID_REQUEST');
});

test('explicitly disabling remote auth restores only local legacy semantics and disables remote tokens at the shared alias', async (t) => {
  const f = await fixture(t),
    device = await f.pair();
  await f.restart(false);
  assert.equal(
    (
      await f.request(prefix + 'info', {
        headers: { ...credentials(device), Host: `shared.test:${f.port}` },
      })
    ).status,
    403,
  );
  const local = await f.request(prefix + 'info', { headers: { 'X-Diary-Client': 'desktop' } });
  assert.equal(local.status, 200, JSON.stringify(local.value));
  await f.restart({ enabled: true, allowedHosts: ['shared.test'], allowLocalPairing: false });
  error(
    await f.request(prefix + 'auth/local-pairing', { method: 'POST', headers: admin }),
    403,
    'LOCAL_PAIRING_DISABLED',
  );
  assert.equal((await f.request(prefix + 'info', { headers: credentials(device) })).status, 200);
});

test('remote disabled on an explicit wide listener still rejects LAN requests spoofing localhost Host', async (t) => {
  const ip = Object.values(networkInterfaces())
    .flat()
    .find((item) => item.family === 'IPv4' && !item.internal)?.address;
  if (!ip) {
    t.skip('No non-loopback IPv4 interface for a real LAN peer');
    return;
  }
  const f = await fixture(t, false, '0.0.0.0');
  for (const pathname of ['/api/library', prefix + 'info']) {
    const response = await f.request(pathname, {
      address: ip,
      headers: { Host: `127.0.0.1:${f.port}`, 'X-Diary-Client': 'desktop' },
    });
    assert.equal(response.status, 403);
    assert.equal(response.value.error, 'LEGACY_LOCAL_ONLY');
  }
  assert.equal((await f.request('/api/library')).status, 200);
});

test('auth close is idempotent and rejects further real HTTP without touching a closed SQLite handle', async (t) => {
  await mkdir(root, { recursive: true });
  const dataDir = await mkdtemp(path.join(root, 'closed-'));
  const auth = await createSharedRemoteAuth({
    dataDir,
    options: { enabled: true },
    body,
    reply,
    authorizeLocal: async () => false,
    dispatch: async (_req, res) => reply(res, 200, { ok: true }),
  });
  const server = http.createServer((req, res) => auth.handle(req, res));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    auth.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  auth.close();
  auth.close();
  const response = await fetch(`http://127.0.0.1:${server.address().port}${prefix}info`);
  error({ status: response.status, value: await response.json() }, 503, 'SHARED_AUTH_CLOSED');
});
