import { promises as fs } from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import readline from 'node:readline';
import { randomUUID, createHash } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { createDiaryServer } from '../src/server/app.mjs';
import { collectSharedSeedSnapshot } from '../src/server/shared-sync/seed-package.mjs';
import { sharedSeedEntityBytes } from '../public/shared/shared-seed.js';
import { createChunkedSharedSeedRequest } from '../public/shared/shared-seed-wire.js';
const exec = promisify(execFile),
  MiB = 1024 * 1024,
  sha = (bytes) => createHash('sha256').update(bytes).digest('hex'),
  id = randomUUID();
const work = path.resolve('tmp/shared-pc-capacity', id),
  output = path.resolve('outputs/2026-10-19-shared-business-integration', 'pc-capacity-' + id);
await fs.mkdir(path.join(work, 'config'), { recursive: true });
await fs.mkdir(output, { recursive: true });
const sources = [
    'previews/telegram-chat/ChatJournalBridge.cs',
    'tests/helpers/SharedPcBridgeProbe.cs',
  ],
  exe = path.join(work, 'shared-pc-capacity-probe.exe');
const build = await exec('C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe', [
  '/nologo',
  '/target:exe',
  '/out:' + exe,
  '/r:System.Web.Extensions.dll',
  ...sources.map((file) => path.resolve(file)),
]);
await fs.writeFile(path.join(output, 'compile.log'), build.stdout + build.stderr);
const checks = [],
  servers = [],
  children = [],
  seen = [];
const check = (name, condition) => {
  assert.ok(condition, name);
  checks.push(name);
};
async function listen(server) {
  servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}
async function bridge(port, label) {
  const root = path.join(work, label);
  await fs.mkdir(path.join(root, 'config'), { recursive: true });
  await fs.writeFile(path.join(root, 'config/app.json'), JSON.stringify({ port }));
  const child = spawn(exe, [root], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }),
    pending = [];
  children.push(child);
  let stderr = '';
  child.stderr.on('data', (bytes) => (stderr += bytes));
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    const item = pending.shift();
    if (item)
      try {
        item.resolve(JSON.parse(line));
      } catch (error) {
        item.reject(error);
      }
  });
  child.on('error', (error) => {
    while (pending.length) pending.shift().reject(error);
  });
  return {
    call: (action, payload = {}) =>
      new Promise((resolve, reject) => {
        pending.push({ resolve, reject });
        child.stdin.write(JSON.stringify({ action, payload }) + '\n');
      }),
    stderr: () => stderr,
  };
}
try {
  const dataDir = path.join(work, 'business');
  const owner = await createDiaryServer({ dataDir, seed: false, sharedSync: true });
  const port = await listen(owner);
  let ownerRequests = 0;
  owner.on('request', () => ownerRequests++);
  async function request(action, input = {}) {
    const response = await fetch(`http://127.0.0.1:${port}/api/shared/v1/` + action, {
      method: action === 'info' ? 'GET' : 'POST',
      headers: { 'X-Diary-Client': 'desktop', 'Content-Type': 'application/json' },
      ...(action === 'info' ? {} : { body: JSON.stringify(input) }),
    });
    const value = await response.json();
    assert.equal(response.status, 200);
    return value;
  }
  const snapshot = await collectSharedSeedSnapshot({ request }),
    members = snapshot.entities.map((row) => {
      const bytes = Buffer.from(sharedSeedEntityBytes(row));
      return { path: `entities/${sha(bytes)}.json`, sha256: sha(bytes), size: bytes.length };
    }),
    bytes = members.reduce((n, m) => n + m.size, 0),
    identity = { libraryId: snapshot.info.libraryId, epoch: snapshot.info.epoch };
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
  const largeEntities = Array.from({ length: 22000 }, (_, n) => {
    const hash = sha(Buffer.from('synthetic-large-roster-' + n));
    return {
      entityType: 'entry',
      entityId: randomUUID(),
      revision: 1,
      seq: 0,
      sha256: hash,
      path: `entities/${hash}.json`,
    };
  });
  const largeMembers = largeEntities.map((row) => ({
    path: row.path,
    sha256: row.sha256,
    size: 1,
  }));
  const largeManifest = {
    ...manifest,
    packageId: randomUUID(),
    entities: largeEntities,
    members: largeMembers,
    entityCount: largeEntities.length,
    entityBytes: largeEntities.length,
    bytes: largeEntities.length,
  };
  const manifestBytes = Buffer.byteLength(JSON.stringify(largeManifest));
  check(
    'synthetic-roster-manifest-over-8MiB-under-32MiB',
    manifestBytes > 8 * MiB && manifestBytes < 32 * MiB,
  );
  const input = { ...identity, manifest, manifestSha256: sha(sharedSeedEntityBytes(manifest)) },
    business = await bridge(port, 'real-owner');
  for (const action of ['shared-seed-register', 'shared-seed-resolve']) {
    const result = await business.call(action, input);
    check(
      action + '-current-roster-real-business-success',
      result.ok &&
        result.result.status === 200 &&
        (result.result.data.registered || result.result.data.resolved),
    );
    const before = ownerRequests,
      large = await business.call(action, {
        ...identity,
        manifest: largeManifest,
        manifestSha256: sha(sharedSeedEntityBytes(largeManifest)),
      });
    check(
      action + '-large-roster-reaches-business-roster-validation',
      large.ok &&
        large.result.status === 409 &&
        large.result.data.error.code === 'SHARED_SEED_ROSTER_MISMATCH',
    );
    check(action + '-exactly-one-request', ownerRequests === before + 1);
  }
  const before = ownerRequests,
    ordinary = await business.call('shared-command', { padding: 'x'.repeat(9 * MiB) });
  check(
    'ordinary-request-over-8MiB-rejected-before-network',
    ordinary.ok === false && ownerRequests === before,
  );
  let outerMax = 0,
    wireMessages = 0;
  const smallWire = async (action, payload) => {
    const outer = { kind: 'journal-request', id: randomUUID(), action, payload },
      encoded = JSON.stringify(outer);
    outerMax = Math.max(outerMax, Buffer.byteLength(encoded));
    wireMessages++;
    assert.ok(
      Buffer.byteLength(encoded) <= 256 * 1024,
      'outer frame fits 256KiB and old 8MiB host cap',
    );
    const native = await business.call(action, JSON.parse(encoded).payload);
    assert.ok(
      Buffer.byteLength(JSON.stringify(native)) <= 256 * 1024,
      'real seed proof fits old outer response cap',
    );
    if (!native.ok) throw Object.assign(Error('native rejected'), { code: 'NATIVE_REJECTED' });
    if (native.result.status >= 400)
      throw Object.assign(Error(native.result.data.error.code), {
        code: native.result.data.error.code,
        status: native.result.status,
      });
    return native.result.data ?? native.result;
  };
  const chunkedSeed = createChunkedSharedSeedRequest({ request: smallWire });
  const smallProof = await chunkedSeed('seed-resolve', input);
  check('small-wire-real-resolve-proof', smallProof.resolved === true);
  await assert.rejects(
    chunkedSeed('seed-resolve', {
      ...identity,
      manifest: largeManifest,
      manifestSha256: sha(sharedSeedEntityBytes(largeManifest)),
    }),
    { code: 'SHARED_SEED_ROSTER_MISMATCH', status: 409 },
  );
  check(
    'over-8MiB-roster-crosses-old-outer-through-small-fixed-frames',
    wireMessages > 70 && outerMax <= 256 * 1024,
  );
  const badMethod = await business.call('shared-seed-wire-begin', {
    method: 'http://arbitrary.invalid',
    byteLength: 2,
    sha256: sha(Buffer.from('{}')),
  });
  check('seed-wire-rejects-arbitrary-method-url', badMethod.ok === false);
  const ticket1 = await smallWire('shared-seed-wire-begin', {
      method: 'seed-resolve',
      byteLength: 2,
      sha256: sha(Buffer.from('{}')),
    }),
    ticket2 = await smallWire('shared-seed-wire-begin', {
      method: 'seed-register',
      byteLength: 2,
      sha256: sha(Buffer.from('{}')),
    });
  const limited = await business.call('shared-seed-wire-begin', {
    method: 'seed-register',
    byteLength: 2,
    sha256: sha(Buffer.from('{}')),
  });
  check('seed-wire-two-ticket-limit', limited.ok === false);
  const corrupt = await business.call('shared-seed-wire-chunk', {
    token: ticket1.token,
    offset: 0,
    bytesBase64: 'e30=',
    chunkSha256: '0'.repeat(64),
  });
  check('seed-wire-chunk-hash-rejected', corrupt.ok === false);
  const truncated = await business.call('shared-seed-wire-finish', { token: ticket1.token });
  check('seed-wire-truncated-finish-rejected', truncated.ok === false);
  await smallWire('shared-seed-wire-cancel', { token: ticket1.token });
  await smallWire('shared-seed-wire-cancel', { token: ticket2.token });
  const cancelled = await business.call('shared-seed-wire-chunk', {
    token: ticket1.token,
    offset: 0,
    bytesBase64: 'e30=',
    chunkSha256: sha(Buffer.from('{}')),
  });
  check('seed-wire-cancel-revokes-ticket', cancelled.ok === false);
  let responsePadding = 9 * MiB,
    chunked = true;
  const transport = http.createServer(async (req, res) => {
    let size = 0;
    for await (const chunk of req) size += chunk.length;
    seen.push({ path: req.url, requestBytes: size });
    res.setHeader('Content-Type', 'application/json');
    const prefix = Buffer.from('{"synthetic":true,"padding":"'),
      suffix = Buffer.from('"}');
    if (!chunked) res.setHeader('Content-Length', prefix.length + responsePadding + suffix.length);
    res.write(prefix);
    const block = Buffer.alloc(MiB, 120);
    for (let offset = 0; offset < responsePadding && !res.destroyed; offset += MiB) {
      if (!res.write(block.subarray(0, Math.min(MiB, responsePadding - offset))))
        await new Promise((resolve) => {
          const done = () => {
            res.off('drain', done);
            res.off('close', done);
            resolve();
          };
          res.once('drain', done);
          res.once('close', done);
        });
    }
    if (!res.destroyed) res.end(suffix);
  });
  const synthetic = await bridge(await listen(transport), 'transport-boundary');
  for (const action of ['shared-seed-register', 'shared-seed-resolve']) {
    const result = await synthetic.call(action, { padding: 'x'.repeat(9 * MiB) });
    check(
      action + '-over-8MiB-request-and-response-fixed-transport-success',
      result.ok && result.result.status === 200 && result.result.data.padding.length === 9 * MiB,
    );
    check(
      action + '-request-byte-size-verified',
      seen.at(-1).requestBytes > 8 * MiB && seen.at(-1).requestBytes < 34 * MiB,
    );
  }
  for (const action of ['shared-command', 'shared-info']) {
    const result = await synthetic.call(action, {});
    check(action + '-response-over-8MiB-rejected', result.ok === false);
  }
  responsePadding = 35 * MiB;
  for (const action of ['shared-seed-register', 'shared-seed-resolve']) {
    const result = await synthetic.call(action, {});
    check(action + '-chunked-response-over-34MiB-rejected', result.ok === false);
  }
  chunked = false;
  const declared = await synthetic.call('shared-seed-resolve', {});
  check('seed-declared-length-over-34MiB-rejected', declared.ok === false);
  responsePadding = 0;
  chunked = true;
  for (const action of ['shared-seed-register', 'shared-seed-resolve']) {
    const count = seen.length,
      result = await synthetic.call(action, { padding: 'x'.repeat(35 * MiB) });
    check(
      action + '-request-over-34MiB-rejected-before-network',
      result.ok === false && seen.length === count,
    );
    const unicode = await synthetic.call(action, { padding: '中'.repeat(12 * MiB) });
    check(
      action + '-utf8-byte-cap-not-just-character-count',
      unicode.ok === false && seen.length === count,
    );
  }
  check('console-harness-stderr-empty', business.stderr() === '' && synthetic.stderr() === '');
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
  await fs.writeFile(
    path.join(output, 'summary.json'),
    JSON.stringify(
      {
        ok: true,
        checks,
        largeManifestBytes: manifestBytes,
        sharedSeedRequestResponseLimit: 34 * MiB,
        ordinarySharedRequestResponseLimit: 8 * MiB,
        realCSharp: true,
        realBusinessHttp: true,
        syntheticResponseTransportFixture: true,
        rendererAttached: false,
        desktopPreviewChanged: false,
        productUiStarted: false,
        deviceUsed: false,
        productionServiceTouched: false,
      },
      null,
      2,
    ),
  );
  console.log(`PC shared seed capacity: ${checks.length} checks; ${output}`);
} finally {
  for (const child of children) {
    child.stdin.end();
    await new Promise((resolve) => child.once('exit', resolve));
  }
  for (const server of servers) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await fs.writeFile(
    path.join(output, 'cleanup.json'),
    JSON.stringify(
      {
        syntheticServersClosed: servers.every((s) => !s.listening),
        productUiStarted: false,
        deviceUsed: false,
        productionServiceTouched: false,
      },
      null,
      2,
    ),
  );
}
