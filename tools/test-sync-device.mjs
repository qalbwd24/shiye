import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// Explicit physical device, dedicated service only. Never starts the diary Activity.
const device = process.argv[2];
if (!device || !/^[A-Za-z0-9:._-]+$/.test(device)) throw new Error('Explicit ADB device required');
const root = path.resolve(import.meta.dirname, '..');
const adb = 'D:/codex-tools/android-sdk/platform-tools/adb.exe';
const pkg = 'dev.shiye.syncprobe.p20261018';
const runtime = JSON.parse(
  await readFile(path.join(root, 'var/sync-device-lab/runtime.json'), 'utf8'),
);
assert.equal(runtime.port, 18779);
assert.equal(runtime.state, 'running');
const pc = `http://127.0.0.1:${runtime.port}/`;
const phone = process.env.SHIYE_SYNC_PHONE_BASE_URL;
if (!phone || new URL(phone).port !== String(runtime.port))
  throw new Error('Explicit phone base URL required');
const output = path.join(root, 'outputs/sync-device-test');
await mkdir(output, { recursive: true });
const adbRun = (args, options = {}) =>
  execFileSync(adb, ['-s', device, ...args], {
    timeout: 12000,
    maxBuffer: 2 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
    ...options,
  }).toString('utf8');
async function api(route, body, token, extra = {}) {
  const response = await fetch(`${pc}api/sync/v1/${route}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extra,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const value = await response.json();
  assert.ok(response.ok, `${route}: HTTP ${response.status}`);
  return value;
}
async function probe(config) {
  const requestId = randomUUID();
  // Pairing codes go through stdin into this helper's private directory, never argv/logs.
  adbRun(['shell', `run-as ${pkg} sh -c 'mkdir -p files; cat > files/request.json'`], {
    input: JSON.stringify({ ...config, requestId }),
  });
  adbRun([
    'shell',
    'am',
    'broadcast',
    '--receiver-foreground',
    '--include-stopped-packages',
    '-a',
    'dev.shiye.syncprobe.RUN',
    '-n',
    `${pkg}/.ProbeReceiver`,
  ]);
  for (let attempt = 0; attempt < 50; attempt++) {
    await delay(200);
    try {
      const report = JSON.parse(adbRun(['shell', 'run-as', pkg, 'cat', 'files/report.json']));
      if (report.requestId === requestId) return report;
    } catch {
      /* receiver still running; do not print credentials or arbitrary logcat */
    }
  }
  throw new Error('Native probe timed out');
}
const report = {
  measuredAt: new Date().toISOString(),
  isolated: true,
  baseUrl: phone,
  package: pkg,
  checks: [],
};
try {
  const health = await api('health');
  assert.equal(health.service, 'shiye-sync');
  assert.equal(health.isolated, true);
  const vpnBefore = adbRun(['shell', 'pidof', 'com.follow.clash']).trim();
  assert.ok(vpnBefore, 'FlClash must stay running during test');
  adbRun(['shell', 'am', 'start', '-n', `${pkg}/.ProbeActivity`]);
  const { code } = await api('local-pairing', {}, null, { 'X-Sync-Client': 'local-admin' });
  const desktop = await api('pair', { code, deviceName: '电脑自动通信测试' });
  const info = await api('info', null, desktop.token);
  const operations = [
    [
      'chatMessage',
      'device-test-pc',
      {
        title: '电脑测试消息',
        body: {
          format: 'shiye-richdoc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              attrs: { blockId: 'pc-paragraph' },
              content: [{ type: 'text', text: '电脑发出的合成消息，供手机通信测试。' }],
            },
          ],
        },
        eventTime: new Date().toISOString(),
        categoryId: 'test-category',
      },
    ],
    ['conversation', 'device-test-room', { name: '手机电脑通信测试', categoryId: 'test-category' }],
    ['taxonomy', 'test-category', { name: '通信测试分类', kind: 'category' }],
  ].map(([entityType, entityId, data]) => ({
    operationId: `seed-${entityId}`,
    entityType,
    entityId,
    data,
    baseRevision: 0,
    command: 'create',
  }));
  if (info.seq === 0) {
    const seeded = await api('push', { operations }, desktop.token);
    assert.ok(seeded.results.every((item) => item.status === 'accepted'));
  } else {
    const existing = await api('snapshot', { limit: 100 }, desktop.token);
    const allowed = new Set([
      'device-test-pc',
      'device-test-room',
      'test-category',
      'device-test-phone',
    ]);
    assert.ok(existing.entities.every((item) => allowed.has(item.entityId)));
    assert.equal(
      existing.entities.filter((item) => item.entityId !== 'device-test-phone').length,
      3,
    );
  }
  const snapshot = await api('snapshot', { limit: 100 }, desktop.token);
  const recoveredPhone = snapshot.entities.find((item) => item.entityId === 'device-test-phone');
  const initial = recoveredPhone
    ? JSON.parse(adbRun(['shell', 'run-as', pkg, 'cat', 'files/report.json']))
    : await probe({ baseUrl: phone, code, phase: 'initial' });
  report.recoveredInitialProbe = !!recoveredPhone;
  report.initial = initial;
  assert.equal(initial.ok, true, initial.error);
  assert.equal(initial.health, true);
  assert.equal(initial.desktopMessageReceived, true);
  assert.equal(initial.phoneMessageAccepted, true);
  report.checks.push(
    'native-app-health-pairing-and-PC-message-download',
    'native-app-phone-message-upload',
  );
  const received = await api('pull', { cursor: snapshot.checkpoint, limit: 100 }, desktop.token);
  assert.equal(received.changes.length, recoveredPhone ? 0 : 1);
  const phoneEntity = recoveredPhone || received.changes[0].entity;
  assert.equal(phoneEntity.entityId, 'device-test-phone');
  assert.equal(phoneEntity.revision, 1);
  assert.equal(phoneEntity.data.body.content[0].content[0].text, '手机应用经局域网发送的合成消息');
  report.checks.push('PC-received-phone-message-exactly-once');
  const changed = await api(
    'push',
    {
      operations: [
        {
          operationId: 'pc-metadata-edit',
          entityType: 'conversation',
          entityId: 'device-test-room',
          baseRevision: 1,
          command: 'updateFields',
          changes: { categoryId: 'phone-verification-category' },
        },
      ],
    },
    desktop.token,
  );
  assert.equal(changed.results[0].status, 'accepted');
  const followup = await probe({ baseUrl: phone, phase: 'verify', cursor: received.cursor });
  report.followup = followup;
  assert.equal(followup.ok, true, followup.error);
  assert.equal(followup.metadataChangeReceived, true);
  assert.equal(followup.incrementalChanges, 1);
  report.checks.push('native-app-received-one-incremental-metadata-change');
  const vpnAfter = adbRun(['shell', 'pidof', 'com.follow.clash']).trim();
  report.flclashSameProcess = vpnBefore === vpnAfter;
  assert.equal(report.flclashSameProcess, true);
  report.checks.push('FlClash-process-preserved');
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = error.message;
  process.exitCode = 1;
} finally {
  await writeFile(
    path.join(output, 'physical-phone-report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report));
}
