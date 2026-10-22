import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// A real Android application UID tests the VPN path, never an ADB reverse to the service.
const serial = process.argv[2];
assert.match(serial || '', /^[A-Za-z0-9:._-]+$/, 'Explicit physical device required');
const baseUrl = process.env.SHIYE_SYNC_PHONE_BASE_URL;
assert.ok(baseUrl && new URL(baseUrl).hostname.startsWith('100.'), 'Explicit tailnet URL required');
const admin = process.env.SHIYE_SYNC_ADMIN_BASE_URL || 'http://127.0.0.1:18779/';
const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'outputs/flclash-tailscale');
const pkg = 'dev.shiye.syncprobe.p20261018';
const adb = (args, input) =>
  execFileSync('D:/codex-tools/android-sdk/platform-tools/adb.exe', ['-s', serial, ...args], {
    input,
    timeout: 15000,
    maxBuffer: 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).toString('utf8');
async function api(route, body, token, extra = {}) {
  const response = await fetch(`${admin}api/sync/v1/${route}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extra,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  assert.ok(response.ok, `${route}: HTTP ${response.status}`);
  return response.json();
}
const idPrefix = `tailnet-${randomUUID()}-`;
const report = {
  measuredAt: new Date().toISOString(),
  baseUrl,
  isolated: true,
  idPrefix,
  checks: [],
};
async function probe(config) {
  const requestId = randomUUID();
  adb(
    ['shell', `run-as ${pkg} sh -c 'mkdir -p files; cat > files/request.json'`],
    JSON.stringify({ baseUrl, idPrefix, ...config, requestId }),
  );
  adb([
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
  for (let i = 0; i < 65; i++) {
    await delay(250);
    try {
      const result = JSON.parse(adb(['shell', 'run-as', pkg, 'cat', 'files/report.json']));
      if (result.requestId === requestId) return result;
    } catch {
      /* Wait only for this probe, no arbitrary logcat. */
    }
  }
  throw new Error('Native probe timed out');
}
await mkdir(output, { recursive: true });
try {
  const health = await api('health');
  assert.equal(health.service, 'shiye-sync');
  assert.equal(health.isolated, true);
  const vpnBefore = adb(['shell', 'pidof', 'com.follow.clash']).trim();
  assert.ok(vpnBefore);
  let independentRunning = false;
  try {
    independentRunning = !!adb(['shell', 'pidof', 'com.tailscale.ipn']).trim();
  } catch {
    /* not running */
  }
  assert.equal(independentRunning, false);
  adb(['shell', 'am', 'start', '-n', `${pkg}/.ProbeActivity`]);
  const { code } = await api('local-pairing', {}, null, { 'X-Sync-Client': 'local-admin' });
  const desktop = await api('pair', { code, deviceName: '电脑Tailnet隔离验收' });
  const seed = await api(
    'push',
    {
      operations: [
        {
          entityType: 'chatMessage',
          entityId: `${idPrefix}device-test-pc`,
          data: {
            title: 'Tailnet电脑合成消息',
            body: {
              format: 'shiye-richdoc',
              version: 1,
              content: [
                {
                  type: 'paragraph',
                  attrs: { blockId: 'pc-tailnet-paragraph' },
                  content: [{ type: 'text', text: '通过内嵌Tailscale接收电脑消息。' }],
                },
              ],
            },
            eventTime: new Date().toISOString(),
            categoryId: `${idPrefix}test-category`,
          },
        },
        {
          entityType: 'conversation',
          entityId: `${idPrefix}device-test-room`,
          data: { name: 'Tailnet隔离验收', categoryId: `${idPrefix}test-category` },
        },
      ].map((item, index) => ({
        ...item,
        operationId: `${idPrefix}seed-${index}`,
        command: 'create',
        baseRevision: 0,
      })),
    },
    desktop.token,
  );
  assert.ok(seed.results.every((r) => r.status === 'accepted'));
  const snapshot = await api('snapshot', { limit: 100 }, desktop.token);
  const messageText = '手机经FlClash内嵌Tailscale与100地址发送的合成消息';
  report.initial = await probe({ code, phase: 'initial', messageText });
  assert.equal(report.initial.ok, true, report.initial.error);
  assert.equal(report.initial.health, true);
  assert.equal(report.initial.desktopMessageReceived, true);
  assert.equal(report.initial.phoneMessageAccepted, true);
  report.checks.push(
    'native-app-health-and-pairing-via-100',
    'native-app-received-PC-message',
    'native-app-uploaded-phone-message',
  );
  const received = await api('pull', { cursor: snapshot.checkpoint, limit: 100 }, desktop.token);
  const created = received.changes.filter(
    (r) => r.entity.entityId === `${idPrefix}device-test-phone`,
  );
  assert.equal(created.length, 1);
  assert.equal(created[0].entity.data.body.content[0].content[0].text, messageText);
  report.checks.push('PC-received-unique-phone-message');
  const changed = await api(
    'push',
    {
      operations: [
        {
          operationId: `${idPrefix}metadata`,
          entityType: 'conversation',
          entityId: `${idPrefix}device-test-room`,
          baseRevision: 1,
          command: 'updateFields',
          changes: { categoryId: `${idPrefix}phone-verification-category` },
        },
      ],
    },
    desktop.token,
  );
  assert.equal(changed.results[0].status, 'accepted');
  report.followup = await probe({ phase: 'verify', cursor: received.cursor });
  assert.equal(report.followup.ok, true, report.followup.error);
  assert.equal(report.followup.metadataChangeReceived, true);
  assert.equal(report.followup.incrementalChanges, 1);
  report.checks.push('native-app-received-one-incremental-change');
  assert.equal(adb(['shell', 'pidof', 'com.follow.clash']).trim(), vpnBefore);
  report.flclashSameProcess = true;
  try {
    independentRunning = !!adb(['shell', 'pidof', 'com.tailscale.ipn']).trim();
  } catch {
    independentRunning = false;
  }
  assert.equal(independentRunning, false);
  report.independentTailscaleRunning = false;
  report.checks.push('FlClash-preserved-independent-Tailscale-off');
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = error.message;
  process.exitCode = 1;
} finally {
  await writeFile(path.join(output, 'native-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
}
