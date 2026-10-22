import { promises as fs } from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import readline from 'node:readline';
import { randomUUID, createHash } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { createDiaryServer } from '../src/server/app.mjs';
const id = randomUUID(),
  work = path.resolve('tmp/shared-pc-auth', id),
  output = path.resolve('outputs/2026-10-19-shared-business-integration', 'pc-auth-' + id);
await fs.mkdir(work, { recursive: true });
await fs.mkdir(output, { recursive: true });
const sources = [
    'previews/telegram-chat/ChatJournalBridge.cs',
    'tests/helpers/SharedPcBridgeProbe.cs',
  ],
  exe = path.join(work, 'probe.exe');
const build = await promisify(execFile)('C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe', [
  '/nologo',
  '/target:exe',
  '/out:' + exe,
  '/r:System.Web.Extensions.dll',
  ...sources.map((f) => path.resolve(f)),
]);
await fs.writeFile(path.join(output, 'compile.log'), build.stdout + build.stderr);
const checks = [],
  children = [],
  servers = [],
  scopes = [];
const check = (name, condition) => {
  assert.ok(condition, name);
  checks.push(name);
};
async function listen(server) {
  servers.push(server);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return server.address().port;
}
async function bridge(root, port) {
  await fs.mkdir(path.join(root, 'config'), { recursive: true });
  await fs.writeFile(path.join(root, 'config/app.json'), JSON.stringify({ port }));
  const child = spawn(exe, [root], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }),
    pending = [];
  children.push(child);
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    const item = pending.shift();
    if (item)
      try {
        item.resolve(JSON.parse(line));
      } catch (e) {
        item.reject(e);
      }
  });
  child.on('error', (e) => {
    while (pending.length) pending.shift().reject(e);
  });
  return {
    child,
    call: (action, payload = {}) =>
      new Promise((resolve, reject) => {
        pending.push({ resolve, reject });
        child.stdin.write(JSON.stringify({ action, payload }) + '\n');
      }),
  };
}
async function close(child) {
  child.stdin.end();
  if (child.exitCode === null) await new Promise((r) => child.once('exit', r));
}
const admin = { 'X-Diary-Client': 'desktop', 'X-Sync-Client': 'local-admin' };
let cookie = '',
  held,
  notifyHeld,
  holdNext = false;
try {
  const owner = await createDiaryServer({
      dataDir: path.join(work, 'data'),
      seed: false,
      sharedSync: true,
      sharedRemote: { enabled: true },
    }),
    ownerPort = await listen(owner),
    base = 'http://127.0.0.1:' + ownerPort;
  async function management(route, method = 'POST', body) {
    const r = await fetch(base + route, {
      method,
      headers: {
        ...admin,
        ...(cookie ? { Cookie: cookie } : {}),
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: r.status, data: await r.json(), headers: r.headers };
  }
  const proxy = http.createServer((req, res) => {
    const upstream = http.request(
      {
        hostname: '127.0.0.1',
        port: ownerPort,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: '127.0.0.1:' + ownerPort },
      },
      (incoming) => {
        const chunks = [];
        incoming.on('data', (x) => chunks.push(x));
        incoming.on('end', () => {
          const finish = () => {
            res.writeHead(incoming.statusCode, incoming.headers);
            res.end(Buffer.concat(chunks));
          };
          if (holdNext && req.url === '/api/shared/v1/info' && incoming.statusCode === 401) {
            holdNext = false;
            held = finish;
            notifyHeld();
          } else finish();
        });
      },
    );
    upstream.on('error', () => {
      res.writeHead(502);
      res.end('{}');
    });
    req.pipe(upstream);
  });
  const port = await listen(proxy),
    root = path.join(work, 'same-root');
  let a = await bridge(root, port);
  scopes.push(a);
  check(
    'unpaired-local-status-no-token',
    JSON.stringify((await a.call('shared-auth-status')).result) === '{"paired":false}',
  );
  check(
    'loopback-shared-requires-device-bearer',
    (await a.call('shared-info')).result.status === 401,
  );
  const code = await management('/api/shared/v1/auth/local-pairing');
  assert.equal(code.status, 200);
  const paired = await a.call('shared-pair', { code: code.data.code, deviceName: 'synthetic PC' }),
    deviceId = paired.result.deviceId;
  check(
    'pair-intercept-redacted',
    paired.ok && paired.result.paired === true && !JSON.stringify(paired).includes('token'),
  );
  check('paired-real-shared-info', (await a.call('shared-info')).result.status === 200);
  const authScope = createHash('sha256')
      .update(
        path
          .resolve(root)
          .replace(/[\\/]$/, '')
          .toUpperCase() +
          '\0http://127.0.0.1:' +
          port,
      )
      .digest('hex'),
    authFile = path.join(process.env.LOCALAPPDATA, 'Shiye/shared-native-auth', authScope + '.bin'),
    encrypted = await fs.readFile(authFile);
  check(
    'dpapi-file-not-plaintext',
    !encrypted.includes(Buffer.from(deviceId)) && !encrypted.includes(Buffer.from('synthetic PC')),
  );
  await close(a.child);
  a = await bridge(root, port);
  scopes.push(a);
  check(
    'credential-real-process-restart',
    (await a.call('shared-auth-status')).result.deviceId === deviceId &&
      (await a.call('shared-info')).result.status === 200,
  );
  const other = await bridge(path.join(work, 'other-root'), port);
  scopes.push(other);
  check(
    'different-project-scope-unpaired',
    (await other.call('shared-auth-status')).result.paired === false,
  );
  const otherPort = await listen(
      http.createServer((req, res) => {
        res.end('{}');
      }),
    ),
    addressScope = await bridge(root, otherPort);
  scopes.push(addressScope);
  check(
    'different-fixed-address-unpaired',
    (await addressScope.call('shared-auth-status')).result.paired === false,
  );
  await close(addressScope.child);
  await fs.writeFile(path.join(root, 'config/app.json'), JSON.stringify({ port }));
  check('bad-auth-type-refused', !(await a.call('shared-pair', { code: 123, deviceName: 'x' })).ok);
  check(
    'arbitrary-auth-url-refused',
    !(await a.call('shared-auth-status', { url: 'http://evil.invalid' })).ok,
  );
  const lock = await management('/api/access', 'PUT', { password: 'synthetic-secret-123' });
  assert.equal(lock.status, 200);
  cookie = lock.headers.get('set-cookie').split(';')[0];
  check(
    'native-unlock-fixed-existing-lock',
    (await a.call('shared-unlock', { password: 'synthetic-secret-123' })).result.status === 200,
  );
  check(
    'paired-device-independent-of-page-lock',
    (await a.call('shared-info')).result.status === 200,
  );
  assert.equal((await management('/api/shared/v1/auth/devices/' + deviceId, 'DELETE')).status, 200);
  check('revoked-native-call-401', (await a.call('shared-info')).result.status === 401);
  check(
    'revoked-current-credential-cleared',
    (await a.call('shared-auth-status')).result.paired === false,
  );
  const code2 = await management('/api/shared/v1/auth/local-pairing');
  assert.equal(code2.status, 200);
  const pair2 = await a.call('shared-pair', {
    code: code2.data.code,
    deviceName: 'synthetic second',
  });
  assert.equal(pair2.result.paired, true);
  assert.equal(
    (await management('/api/shared/v1/auth/devices/' + pair2.result.deviceId, 'DELETE')).status,
    200,
  );
  holdNext = true;
  const waiting = new Promise((r) => {
    notifyHeld = r;
  });
  const late = a.call('shared-info');
  await waiting;
  const b = await bridge(root, port);
  scopes.push(b);
  const code3 = await management('/api/shared/v1/auth/local-pairing');
  assert.equal(code3.status, 200);
  const pair3 = await b.call('shared-pair', {
    code: code3.data.code,
    deviceName: 'synthetic third',
  });
  assert.equal(pair3.result.paired, true);
  held();
  held = null;
  check('old-generation-late-401-returned', (await late).result.status === 401);
  check(
    'late-401-cannot-clear-new-pair',
    (await a.call('shared-auth-status')).result.deviceId === pair3.result.deviceId &&
      (await a.call('shared-info')).result.status === 200,
  );
  check('forget-local-redacted', (await b.call('shared-forget-device')).result.paired === false);
  check(
    'forget-observed-other-process',
    (await a.call('shared-auth-status')).result.paired === false &&
      (await a.call('shared-info')).result.status === 401,
  );
  const list = await management('/api/shared/v1/auth/devices', 'GET');
  check(
    'local-forget-not-server-revocation',
    list.data.devices.some(
      (x) => x.deviceId === pair3.result.deviceId || x.id === pair3.result.deviceId,
    ),
  );
  await fs.writeFile(
    path.join(output, 'result.json'),
    JSON.stringify(
      {
        ok: true,
        rendererAttached: false,
        device: false,
        formal: false,
        checks,
        sources: await Promise.all(
          sources.map(async (file) => ({
            file,
            sha256: createHash('sha256')
              .update(await fs.readFile(file))
              .digest('hex'),
          })),
        ),
      },
      null,
      2,
    ),
  );
  console.log(`PC shared native auth: ${checks.length} checks; ${output}`);
} finally {
  held?.();
  for (const s of scopes)
    if (s.child.exitCode === null)
      try {
        await s.call('shared-forget-device');
      } catch {}
  for (const child of children) if (child.exitCode === null) await close(child);
  for (const server of servers.reverse()) {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
}
