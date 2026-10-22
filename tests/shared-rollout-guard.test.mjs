import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  verifyRolloutPlan,
  backupRolloutCollection,
  fileSha256,
  verifyFrozenRelease,
  APPROVED_MARKER1_SOURCES,
} from '../src/server/shared-sync/rollout-guard.mjs';

async function fixture() {
  const root = await mkdtemp(path.resolve('tmp/rollout-guard-'));
  for (const name of ['data', 'profile', 'config', 'exports', 'release'])
    await mkdir(path.join(root, name));
  const put = async (name, value) => {
    const file = path.join(root, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, typeof value === 'string' ? value : JSON.stringify(value));
    return file;
  };
  await put('data/diary.json', { entries: [], media: [] });
  await put('data/.shared-auth/key-private-fixture', 'private-synthetic');
  await put('data/.program-auth/credentials.sqlite-wal', 'synthetic-wal');
  await put('profile/window.json', '{}');
  await put('config/pointer.json', {});
  await put('config/shared.json', {
    enabled: true,
    remote: false,
    listenHost: '127.0.0.1',
    sourceCollection: { exportsDir: path.join(root, 'exports') },
  });
  await put('server.mjs', '// synthetic launcher');
  const files = [];
  for (const file of [
    'replication.mjs',
    'seed-attestation.mjs',
    'source-collection.mjs',
    'desktop-collection-commit.mjs',
  ]) {
    const relative = 'src/server/shared-sync/' + file;
    await put('release/' + relative, '// synthetic');
    files.push({ file: relative, sha256: await fileSha256(path.join(root, 'release', relative)) });
  }
  for (const [file, hash] of Object.entries(APPROVED_MARKER1_SOURCES)) {
    const bytes = await readFile(
      path.resolve('outputs/backend-runtimes/20261019-message-edits-1792447465520', file),
    );
    const target = path.join(root, 'release', file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
    const prior = files.find((row) => row.file === file);
    if (prior) prior.sha256 = hash;
    else files.push({ file, sha256: hash });
  }
  const manifest = await put('release/runtime-manifest.json', { files });
  const clientFile = await put(
    'client/sources/public/shared/shared-seed.js',
    '// synthetic client',
  );
  const artifacts = [];
  for (const file of ['android-shared-runtime.js', 'desktop-shared-runtime.js']) {
    await put('client/' + file, '// synthetic bundle');
    artifacts.push({ file, sha256: await fileSha256(path.join(root, 'client', file)) });
  }
  const clientManifest = await put('client/data-manifest.json', {
    files: [{ file: 'public/shared/shared-seed.js', sha256: await fileSha256(clientFile) }],
    artifacts,
  });
  const process = {
    pid: 1024,
    executablePath: 'synthetic-node',
    commandLine: 'synthetic-command',
    createdAt: '2026-10-19T10:00:00.0000000Z',
  };
  const now = Date.parse('2026-10-19T12:00:00Z');
  const raw = await put('raw-ack.json', { synthetic: true });
  const evidence = [];
  for (const kind of [
    'frontend-saved-stopped',
    'legacy-runner-stopped',
    'conversation-runners-stopped',
    'external-writers-paused',
    'uploads-imports-drained',
  ]) {
    const file = await put('evidence/' + kind + '.json', {
      version: 1,
      kind,
      complete: true,
      observedAt: new Date(now).toISOString(),
      saveHttpAcknowledged: true,
      standardStopAcknowledged: true,
      visibleUnsaved: false,
      pendingFilePreparation: false,
      pendingAttachments: false,
      pendingEditor: false,
      running: false,
      inFlight: 0,
      uploads: 0,
      importCommits: 0,
      activeWriters: 0,
      instanceIds: [],
      references: [{ file: raw, sha256: await fileSha256(raw) }],
    });
    evidence.push({ kind, file, sha256: await fileSha256(file) });
  }
  const reference = { manifest, sha256: await fileSha256(manifest) };
  const plan = {
    version: 1,
    format: 'shiye-controlled-shared-rollout',
    action: 'switch',
    projectRoot: root,
    dataDir: path.join(root, 'data'),
    stateDir: root,
    backupDir: path.join(root, 'exports', 'backup'),
    exportsDir: path.join(root, 'exports'),
    profileDir: path.join(root, 'profile'),
    pointer: path.join(root, 'config', 'pointer.json'),
    sharedConfig: path.join(root, 'config', 'shared.json'),
    launcher: path.join(root, 'server.mjs'),
    launcherSha256: await fileSha256(path.join(root, 'server.mjs')),
    pointerSha256: await fileSha256(path.join(root, 'config', 'pointer.json')),
    sharedConfigSha256: await fileSha256(path.join(root, 'config', 'shared.json')),
    librarySha256: await fileSha256(path.join(root, 'data', 'diary.json')),
    libraryId: null,
    epoch: null,
    windowMs: 30000,
    messageEditWrites: false,
    process,
    listenHost: '127.0.0.1',
    remoteEnabled: false,
    candidate: reference,
    sameSchemaRollback: reference,
    clientCandidate: { manifest: clientManifest, sha256: await fileSha256(clientManifest) },
    evidence,
    backupRoots: [
      { name: 'data', source: path.join(root, 'data') },
      { name: 'profile', source: path.join(root, 'profile') },
      { name: 'config', source: path.join(root, 'config') },
      { name: 'launcher', source: path.join(root, 'server.mjs') },
    ],
  };
  const probes = {
    now,
    inspectProcess: async () => ({ ...process, frontendProcesses: 0 }),
    inspectConnections: async () => 0,
  };
  return { root, plan, probes, put };
}

test('local save proof needs a pinned actual zero-change FIFO acknowledgement; LocalSaveAck alone is insufficient', async () => {
  const f = await fixture();
  const item = f.plan.evidence.find((row) => row.kind === 'frontend-saved-stopped');
  const receipt = JSON.parse(await readFile(item.file, 'utf8'));
  receipt.saveHttpAcknowledged = false;
  receipt.localSavedAcknowledged = true;
  receipt.fifoBarrierApplied = true;
  async function save() {
    await writeFile(item.file, JSON.stringify(receipt));
    item.sha256 = await fileSha256(item.file);
  }
  await save();
  await assert.rejects(verifyRolloutPlan(f.plan, f.probes), {
    code: 'ROLLOUT_FIFO_BARRIER_NOT_PROVEN',
  });
  const barrier = {
    version: 1,
    kind: 'server-fifo-barrier',
    observedAt: new Date(f.probes.now - 1000).toISOString(),
    endpoint: '/api/chat-journal/close-idle',
    method: 'POST',
    httpStatus: 200,
    closed: 0,
    fifoBarrierApplied: true,
    beforeSha256: f.plan.librarySha256,
    afterSha256: f.plan.librarySha256,
  };
  const file = await f.put('barrier.json', barrier);
  const reference = { file, sha256: await fileSha256(file) };
  receipt.serverFifoBarrier = reference;
  receipt.references.push(reference);
  await save();
  assert.equal((await verifyRolloutPlan(f.plan, f.probes)).stopped, false);
  for (const change of [
    { closed: 1 },
    { afterSha256: '0'.repeat(64) },
    { httpStatus: 500 },
    { endpoint: '/api/unrelated' },
  ]) {
    await writeFile(file, JSON.stringify({ ...barrier, ...change }));
    reference.sha256 = await fileSha256(file);
    await save();
    await assert.rejects(verifyRolloutPlan(f.plan, f.probes), {
      code: 'ROLLOUT_FIFO_BARRIER_NOT_PROVEN',
    });
  }
});
test('read-only quiescence guard and full collection backup preserve auth/WAL/profile/config, never initialize identity', async () => {
  const f = await fixture(),
    before = await readFile(path.join(f.plan.dataDir, 'diary.json'), 'utf8');
  const checked = await verifyRolloutPlan(f.plan, f.probes);
  assert.equal(checked.stopped, false);
  assert.equal(checked.gracefulSigterm, false);
  const backup = await backupRolloutCollection(f.plan);
  assert.equal(backup.inventories.length, 4);
  assert.ok(
    backup.inventories
      .find((r) => r.name === 'data')
      .members.some((r) => r.path === '.program-auth/credentials.sqlite-wal'),
  );
  assert.equal(await readFile(path.join(f.plan.dataDir, 'diary.json'), 'utf8'), before);
});

test('old149 file presence cannot authorize marker1 rollback; approved exact reader implementation can', async () => {
  const old = path.resolve(
    'outputs/backend-runtimes/20261019-shared-business-1792445229399/runtime-manifest.json',
  );
  await assert.rejects(
    () =>
      verifyFrozenRelease({
        manifest: old,
        sha256: '633399b4960abd38be666bef6348e4714e37ffe15758a9661bf2a77f5286f50d',
      }),
    { code: 'ROLLOUT_MARKER1_READER_REQUIRED' },
  );
  const current = path.resolve(
    'outputs/backend-runtimes/20261019-message-edits-1792447465520/runtime-manifest.json',
  );
  await assert.doesNotReject(() =>
    verifyFrozenRelease({
      manifest: current,
      sha256: '786abbd316a79058b1c4334da7bde60c772579cf197ab72c8c7c4b6eeed5c84d',
    }),
  );
});
test('unknown file preparation, active connections, stale ACK and crossed idle deadline abort before any stop', async () => {
  const f = await fixture();
  await assert.rejects(
    () => verifyRolloutPlan(f.plan, { ...f.probes, inspectConnections: async () => 1 }),
    { code: 'ROLLOUT_ACTIVE_CONNECTIONS' },
  );
  await assert.rejects(
    () => verifyRolloutPlan(f.plan, { ...f.probes, now: f.probes.now + 121000 }),
    { code: 'ROLLOUT_DRAIN_NOT_PROVEN' },
  );
  const receipt = JSON.parse(await readFile(f.plan.evidence[0].file, 'utf8'));
  delete receipt.pendingFilePreparation;
  await writeFile(f.plan.evidence[0].file, JSON.stringify(receipt));
  f.plan.evidence[0].sha256 = await fileSha256(f.plan.evidence[0].file);
  await assert.rejects(() => verifyRolloutPlan(f.plan, f.probes), {
    code: 'ROLLOUT_FRONTEND_NOT_SAVED',
  });
  receipt.pendingFilePreparation = false;
  await writeFile(f.plan.evidence[0].file, JSON.stringify(receipt));
  f.plan.evidence[0].sha256 = await fileSha256(f.plan.evidence[0].file);
  await f.put('data/diary.json', {
    entries: [
      { chatJournal: { status: 'open', deadline: new Date(f.probes.now + 1000).toISOString() } },
    ],
  });
  f.plan.librarySha256 = await fileSha256(path.join(f.plan.dataDir, 'diary.json'));
  await assert.rejects(() => verifyRolloutPlan(f.plan, f.probes), {
    code: 'ROLLOUT_IDLE_DEADLINE_WINDOW',
  });
});
test('wide listener and nonshared rollback reject; lost or changed sources cannot satisfy backup proof', async () => {
  const f = await fixture();
  f.plan.action = 'rollback';
  await assert.rejects(() => verifyRolloutPlan(f.plan, f.probes), {
    code: 'ROLLOUT_UNSAFE_ROLLBACK',
  });
  f.plan.action = 'switch';
  await f.put('config/shared.json', {
    enabled: true,
    remote: false,
    listenHost: '0.0.0.0',
    sourceCollection: { exportsDir: f.plan.exportsDir },
  });
  f.plan.sharedConfigSha256 = await fileSha256(f.plan.sharedConfig);
  await assert.rejects(() => verifyRolloutPlan(f.plan, f.probes), {
    code: 'ROLLOUT_SHARED_CONFIG_INVALID',
  });
  f.plan.backupRoots = f.plan.backupRoots.filter((r) => r.name !== 'profile');
  await assert.rejects(() => backupRolloutCollection(f.plan), {
    code: 'ROLLOUT_BACKUP_SCOPE_INCOMPLETE',
  });
});
