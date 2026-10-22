import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import readline from 'node:readline';
import assert from 'node:assert/strict';
import { createDiaryServer } from '../src/server/app.mjs';
import { collectSharedSeedSnapshot } from '../src/server/shared-sync/seed-package.mjs';
import { sharedSeedEntityBytes } from '../public/shared/shared-seed.js';
const exec = promisify(execFile),
  sha = (bytes) => createHash('sha256').update(bytes).digest('hex'),
  id = randomUUID();
const work = path.resolve('tmp/shared-pc-native', id),
  output = path.resolve('outputs/2026-10-19-shared-business-integration', 'pc-native-' + id);
await fs.mkdir(path.join(work, 'config'), { recursive: true });
await fs.mkdir(output, { recursive: true });
const sourceId = randomUUID(),
  conversationId = `desktop:${sourceId}:-103`,
  dataDir = path.join(work, 'data');
await fs.mkdir(dataDir);
await fs.writeFile(
  path.join(dataDir, 'diary.json'),
  JSON.stringify({
    schema: 1,
    categories: ['日常'],
    tags: [],
    media: [],
    chatJournal: {
      rooms: [{ sourceId, id: '-103', title: 'C# synthetic', category: '日常', idleHours: 5 }],
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
const server = await createDiaryServer({ dataDir, seed: false, sharedSync: true }),
  requests = [];
server.on('request', (req) => requests.push({ method: req.method, path: req.url }));
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
await fs.writeFile(
  path.join(work, 'config/app.json'),
  JSON.stringify({ port: server.address().port }),
);
async function request(action, input = {}) {
  const response = await fetch(
    base + '/api/shared/v1/' + (action === 'entity-read' ? 'entity/read' : action),
    {
      method: action === 'info' ? 'GET' : 'POST',
      headers: { 'X-Diary-Client': 'desktop', 'Content-Type': 'application/json' },
      ...(action === 'info' ? {} : { body: JSON.stringify(input) }),
    },
  );
  const value = await response.json();
  assert.equal(response.status, 200, JSON.stringify(value));
  return value;
}
let child,
  stderr = '';
const checks = [];
const check = (name, ok) => {
  assert.ok(ok, name);
  checks.push(name);
};
try {
  const sources = [
      'previews/telegram-chat/ChatJournalBridge.cs',
      'tests/helpers/SharedPcBridgeProbe.cs',
    ],
    exe = path.join(work, 'shared-pc-console-probe.exe');
  const compiled = await exec('C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe', [
    '/nologo',
    '/target:exe',
    '/out:' + exe,
    '/r:System.Web.Extensions.dll',
    ...sources.map((file) => path.resolve(file)),
  ]);
  await fs.writeFile(path.join(output, 'compile.log'), compiled.stdout + compiled.stderr);
  await fs.writeFile(
    path.join(output, 'sources.json'),
    JSON.stringify(
      await Promise.all(
        sources.map(async (file) => ({ file, sha256: sha(await fs.readFile(file)) })),
      ),
      null,
      2,
    ),
  );
  child = spawn(exe, [work], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = [];
  child.stderr.on('data', (bytes) => (stderr += bytes));
  child.on('error', (error) => {
    while (pending.length) pending.shift().reject(error);
  });
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    const next = pending.shift();
    if (next)
      try {
        next.resolve(JSON.parse(line));
      } catch (error) {
        next.reject(error);
      }
  });
  const call = (action, payload = {}) =>
    new Promise((resolve, reject) => {
      pending.push({ resolve, reject });
      child.stdin.write(JSON.stringify({ action, payload }) + '\n');
    });
  async function ok(action, payload = {}) {
    const before = requests.length,
      result = await call('shared-' + action, payload);
    check('bridge-' + action + '-success', result.ok && result.result.status === 200);
    check(
      'bridge-' + action + '-fixed-loopback-route',
      requests.length === before + 1 &&
        requests.at(-1).path ===
          '/api/shared/v1/' +
            action
              .replace(/^media-/, 'media/')
              .replace(/^entity-read$/, 'entity/read')
              .replace(/^feed-item-read$/, 'feed-item/read'),
    );
    return result.result.data;
  }
  const info = await ok('info'),
    identity = { libraryId: info.libraryId, epoch: info.epoch };
  check('same-business-owner', info.sameBusinessStore === true);
  const wire = {
    ...identity,
    operationId: randomUUID(),
    action: 'conversation-feed',
    input: { conversationId, limit: 100 },
  };
  const feed = (await ok('command', wire)).result;
  const snapshot = await collectSharedSeedSnapshot({ request });
  const members = snapshot.entities.map((row) => {
      const bytes = Buffer.from(sharedSeedEntityBytes(row));
      return { path: `entities/${sha(bytes)}.json`, size: bytes.length, sha256: sha(bytes) };
    }),
    bytes = members.reduce((total, m) => total + m.size, 0);
  const manifest = {
    format: 'shiye-shared-seed',
    version: 1,
    mode: 'shared-bootstrap',
    packageId: randomUUID(),
    ...identity,
    snapshotWatermark: snapshot.snapshotWatermark,
    watermark: snapshot.watermark,
    cursor: { ...identity, after: snapshot.watermark },
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
  const seed = { ...identity, manifest, manifestSha256: sha(sharedSeedEntityBytes(manifest)) };
  check('seed-register-real-current-roster', (await ok('seed-register', seed)).registered === true);
  check('seed-resolve-real-current-roster', (await ok('seed-resolve', seed)).resolved === true);
  const page = await ok('snapshot', { ...identity, limit: 200 });
  await ok('pull', { ...identity, after: 0, limit: 200 });
  const descriptor = page.entities.find((row) => row.payload).payload;
  const entity = await ok('entity-read', {
    ...identity,
    entityType: descriptor.entityType,
    entityId: descriptor.entityId,
    revision: descriptor.revision,
    offset: 0,
    length: 262144,
  });
  check(
    'entity-real-chunk-sha',
    sha(Buffer.from(entity.bytesBase64, 'base64')) === entity.chunkSha256,
  );
  const part = await ok('feed-item-read', {
    ...identity,
    payload: feed.messages[0].payload,
    offset: 0,
    length: 262144,
  });
  check('feed-real-chunk-sha', sha(Buffer.from(part.bytesBase64, 'base64')) === part.chunkSha256);
  const original = Buffer.from('synthetic C# original\0'),
    operationId = randomUUID(),
    scope = { ...identity, operationId };
  await ok('media-begin', {
    ...scope,
    metadata: {
      size: original.length,
      sha256: sha(original),
      name: 'C-sharp.dat',
      mime: 'application/octet-stream',
    },
  });
  await ok('media-chunk', {
    ...scope,
    offset: 0,
    bytesBase64: original.toString('base64'),
    chunkSha256: sha(original),
  });
  const completed = await ok('media-complete', scope),
    downloaded = await ok('media-read', {
      ...identity,
      assetId: completed.asset.id,
      offset: 0,
      length: 262144,
    });
  check('media-original-roundtrip', Buffer.from(downloaded.bytesBase64, 'base64').equals(original));
  const before = requests.length,
    unknown = await call('shared-https://arbitrary.invalid', { url: 'https://arbitrary.invalid' });
  check('unknown-action-no-network', unknown.ok === false && requests.length === before);
  await fs.writeFile(
    path.join(output, 'summary.json'),
    JSON.stringify(
      {
        ok: true,
        checks,
        realHttp: true,
        realCSharp: true,
        consoleHarnessOnly: true,
        productUiStarted: false,
        rendererAttached: false,
        tlIdbWritten: false,
        deviceUsed: false,
        productionServiceTouched: false,
        probeExeSha256: sha(await fs.readFile(exe)),
      },
      null,
      2,
    ),
  );
  console.log(`Shared PC C# bridge: ${checks.length} checks; ${output}`);
} finally {
  if (child) {
    child.stdin.end();
    await new Promise((resolve) => child.once('exit', resolve));
  }
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await fs.writeFile(
    path.join(output, 'cleanup.json'),
    JSON.stringify(
      {
        syntheticServiceClosed: !server.listening,
        productUiStarted: false,
        rendererAttached: false,
        stderr,
      },
      null,
      2,
    ),
  );
}
