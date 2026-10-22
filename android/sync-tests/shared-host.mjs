import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import assert from 'node:assert/strict';
import { createDiaryServer } from '../../src/server/app.mjs';
import { collectSharedSeedSnapshot } from '../../src/server/shared-sync/seed-package.mjs';
import { sharedSeedEntityBytes } from '../../public/shared/shared-seed.js';

const exec = promisify(execFile);
const work = path.resolve('tmp/shared-business-native-host', randomUUID());
const output = path.resolve(
  'outputs/2026-10-19-shared-business-integration',
  `host-auth-${randomUUID()}`,
);
await fs.mkdir(work, { recursive: true });
await fs.mkdir(output, { recursive: true });
const jar = path.resolve('tmp/shared-business-native-host/deps/json-20240303.jar');
try {
  await fs.access(jar);
} catch {
  await fs.mkdir(path.dirname(jar), { recursive: true });
  const dependency = await fetch(
    'https://repo.maven.apache.org/maven2/org/json/json/20240303/json-20240303.jar',
  );
  assert.equal(dependency.status, 200);
  await fs.writeFile(jar, Buffer.from(await dependency.arrayBuffer()));
}
assert.equal(
  createHash('sha256')
    .update(await fs.readFile(jar))
    .digest('hex'),
  '3cf6cd6892e32e2b4c1c39e0f52f5248a2f5b37646fdfbb79a66b46b618414ed',
);
const javaHome = process.env.JAVA_HOME || 'D:/codex-tools/android-studio/jbr';
const java = path.join(javaHome, 'bin/java.exe');
const javac = path.join(javaHome, 'bin/javac.exe');
const sources = [
  'android/sync-tests/host-platform/android/content/Context.java',
  'android/sync-tests/host-platform/android/content/SharedPreferences.java',
  'android/sync-tests/host-platform/android/os/Looper.java',
  ...['BackendServices', 'SharedBackendTransport', 'SharedBackendBridge'].map(
    (name) => `android/app/src/main/java/dev/shiye/app/${name}.java`,
  ),
  'android/sync-tests/SharedBackendHostProbe.java',
];
const classes = path.join(work, 'classes');
await fs.mkdir(classes);
const compilation = await exec(javac, [
  '-encoding',
  'UTF-8',
  '-cp',
  jar,
  '-d',
  classes,
  ...sources,
]);
await fs.writeFile(path.join(output, 'host-build.log'), compilation.stdout + compilation.stderr);
await fs.writeFile(
  path.join(output, 'sources.json'),
  JSON.stringify(
    await Promise.all(
      sources.map(async (file) => ({
        file,
        sha256: createHash('sha256')
          .update(await fs.readFile(file))
          .digest('hex'),
      })),
    ),
    null,
    2,
  ),
);
const dataDir = path.join(work, 'data'),
  sourceId = randomUUID();
const conversationId = `desktop:${sourceId}:-103`;
await fs.mkdir(dataDir);
await fs.writeFile(
  path.join(dataDir, 'diary.json'),
  JSON.stringify({
    schema: 1,
    categories: ['日常'],
    tags: [],
    media: [],
    chatJournal: {
      rooms: [
        { sourceId, id: '-103', title: 'native feed fixture', category: '日常', idleHours: 5 },
      ],
      withdrawals: [],
    },
    entries: [
      {
        id: randomUUID(),
        revision: 1,
        title: 'synthetic',
        content: '<p>synthetic</p>',
        date: '2026-10-19T00:00:00Z',
        category: '日常',
        tags: [],
        attachments: [],
        chatJournal: {
          sourceId,
          roomId: '-103',
          messages: [
            { id: '1', sentAt: '2026-10-19T00:00:00Z', text: '中'.repeat(400000), attachments: [] },
          ],
        },
      },
    ],
  }),
);
const server = await createDiaryServer({
  dataDir,
  seed: false,
  sharedSync: true,
  sharedRemote: { enabled: true },
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let fixtureCredential;
async function sharedRequest(action, input = {}) {
  if (!fixtureCredential) {
    const code = (await admin('local-pairing')).code;
    const paired = await fetch(base + '/api/shared/v1/auth/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, deviceName: 'synthetic fixture builder' }),
    });
    assert.equal(paired.ok, true);
    fixtureCredential = await paired.json();
  }
  const routes = { 'entity-read': 'entity/read' };
  const response = await fetch(base + '/api/shared/v1/' + (routes[action] || action), {
    method: action === 'info' ? 'GET' : 'POST',
    headers: {
      'X-Diary-Client': 'desktop',
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + fixtureCredential.token,
      'X-Sync-Device-Id': fixtureCredential.deviceId,
    },
    ...(action === 'info' ? {} : { body: JSON.stringify(input) }),
  });
  const value = await response.json();
  assert.equal(response.status, 200, JSON.stringify(value));
  return value;
}
async function seedFixture() {
  const warm = await sharedRequest('info');
  const command = await sharedRequest('command', {
    libraryId: warm.libraryId,
    epoch: warm.epoch,
    operationId: randomUUID(),
    action: 'conversation-feed',
    input: { conversationId, limit: 100 },
  });
  const snapshot = await collectSharedSeedSnapshot({ request: sharedRequest });
  const members = snapshot.entities.map((row) => {
    const bytes = Buffer.from(sharedSeedEntityBytes(row));
    return {
      path: `entities/${createHash('sha256').update(bytes).digest('hex')}.json`,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  });
  const bytes = members.reduce((n, m) => n + m.size, 0),
    info = snapshot.info;
  const manifest = {
    format: 'shiye-shared-seed',
    version: 1,
    mode: 'shared-bootstrap',
    packageId: randomUUID(),
    libraryId: info.libraryId,
    epoch: info.epoch,
    snapshotWatermark: snapshot.snapshotWatermark,
    watermark: snapshot.watermark,
    cursor: { libraryId: info.libraryId, epoch: info.epoch, after: snapshot.watermark },
    complete: true,
    entities: snapshot.entities.map((row, n) => ({
      entityType: row.entityType,
      entityId: row.entityId,
      revision: row.revision,
      seq: row.seq,
      sha256: row.sha256,
      path: members[n].path,
    })),
    assets: [],
    members,
    bytes,
    entityBytes: bytes,
    entityCount: snapshot.entities.length,
    assetCount: 0,
    containsCredentials: false,
    containsSourceArchives: false,
  };
  const payload = command.result.messages[0].payload;
  const { entityType, entityId, revision } = (
    await sharedRequest('snapshot', { libraryId: info.libraryId, epoch: info.epoch, limit: 200 })
  ).entities.find((row) => row.payload).payload;
  return {
    seedInput: {
      libraryId: info.libraryId,
      epoch: info.epoch,
      manifest,
      manifestSha256: createHash('sha256').update(sharedSeedEntityBytes(manifest)).digest('hex'),
    },
    feedInput: { libraryId: info.libraryId, epoch: info.epoch, payload, offset: 0, length: 262144 },
    entityInput: {
      libraryId: info.libraryId,
      epoch: info.epoch,
      entityType,
      entityId,
      revision,
      offset: 0,
      length: 262144,
    },
  };
}
async function admin(route, method = 'POST') {
  const response = await fetch(base + '/api/shared/v1/auth/' + route, {
    method,
    headers: {
      'X-Sync-Client': 'local-admin',
      'X-Diary-Client': 'desktop',
      'Content-Type': 'application/json',
    },
    ...(method === 'POST' ? { body: '{}' } : {}),
  });
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  return data;
}
let initialFixture;
async function probe(phase, code) {
  const result = path.join(output, `${phase}.json`),
    fixture = path.join(work, `${phase}-fixture.json`);
  await fs.writeFile(
    fixture,
    JSON.stringify({
      base,
      phase,
      code,
      media: process.env.SHIYE_NATIVE_MEDIA === '1',
      preferences: path.join(work, 'private-preferences'),
      result,
      ...(phase === 'paired' ? initialFixture : {}),
    }),
  );
  const answer = await exec(java, [
    '-cp',
    classes + path.delimiter + jar,
    'dev.shiye.app.SharedBackendHostProbe',
    fixture,
  ]);
  await fs.writeFile(path.join(output, `${phase}.log`), answer.stdout + answer.stderr);
  return JSON.parse(await fs.readFile(result));
}
try {
  initialFixture = await seedFixture();
  const paired = await probe('paired', (await admin('local-pairing')).code);
  await admin('devices/' + paired.authStatus.deviceId, 'DELETE');
  const revoked = await probe('revoked');
  const forgotten = await probe('forget', (await admin('local-pairing')).code);
  const checks = paired.checks.length + revoked.checks.length + forgotten.checks.length;
  await fs.writeFile(
    path.join(output, 'summary.json'),
    JSON.stringify(
      {
        ok: true,
        checks,
        hostJava: true,
        actualAndroid: false,
        realHttp: true,
        mediaTested: process.env.SHIYE_NATIVE_MEDIA === '1',
        synthetic: true,
        androidPortsReplaced: ['Context', 'SharedPreferences', 'Looper'],
        noDeviceUsed: true,
        work,
      },
      null,
      2,
    ),
  );
  console.log(`Native shared host auth: ${checks} assertions passed; ${output}`);
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await fs.writeFile(
    path.join(output, 'cleanup.json'),
    JSON.stringify(
      {
        syntheticServiceClosed: !server.listening,
        deviceStarted: false,
        apkInstalled: false,
        productionServiceTouched: false,
      },
      null,
      2,
    ),
  );
}
