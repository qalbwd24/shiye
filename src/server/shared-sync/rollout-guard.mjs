import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

// Exact marker1 reader/projection/write-gate implementation independently
// approved as 786abbd3...; presence of similarly named files is not authority.
export const APPROVED_MARKER1_SOURCES = Object.freeze({
  'public/shared/shared-edit-clock.js':
    '686528491297be4fd58d0238961ea5e8f1ad061cd44a57d33906bfce47aa87e5',
  'public/shared/shared-message-edit-protocol.js':
    '34a0a11196eb82ec66dbc78908aa272ea7bb0b3192cc7efc1d28a14f688ec2c2',
  'src/server/domain/local-message-edits.mjs':
    '9b29abf8780e741c22dfe3f51556c411c82f920b3464a1951c493bd1aed42c3a',
  'src/server/shared-sync/message-edit-projection.mjs':
    '36fb1e9d3814e83b7b895b6ce06497b7f342353c19de4beab0ea0f6c91489169',
  'src/server/shared-sync/replication.mjs':
    'd0030cb1ebfdf56738037bc0a41a380b9600dcb5b9476bfa7a702c4bd1868e35',
  'src/server/shared-sync/service.mjs':
    '12128a753fc875002eac9a8177de2ec6d03c980676c8209653dc15e92b296cc2',
});

const fail = (code) => {
  throw Object.assign(Error(code), { code });
};
export const fileSha256 = async (file) => {
  const h = createHash('sha256'),
    handle = await fs.open(file, 'r');
  try {
    for await (const chunk of handle.createReadStream({ autoClose: false })) h.update(chunk);
  } finally {
    await handle.close();
  }
  return h.digest('hex');
};
export async function assertNoReparse(file) {
  for (let item = path.resolve(file); ;) {
    if ((await fs.lstat(item)).isSymbolicLink()) fail('ROLLOUT_REPARSE');
    const parent = path.dirname(item);
    if (parent === item) return;
    item = parent;
  }
}
export async function treeRoster(root) {
  await assertNoReparse(root);
  const files = [];
  async function visit(current, relative) {
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink()) fail('ROLLOUT_REPARSE');
    if (stat.isDirectory()) {
      for (const name of (await fs.readdir(current)).sort())
        await visit(path.join(current, name), relative ? relative + '/' + name : name);
    } else if (stat.isFile()) {
      const sha256 = await fileSha256(current),
        after = await fs.stat(current);
      if (stat.size !== after.size || stat.mtimeMs !== after.mtimeMs)
        fail('ROLLOUT_SOURCE_CHANGED');
      files.push({ path: relative, size: stat.size, sha256 });
    } else fail('ROLLOUT_NON_FILE');
  }
  const rootStat = await fs.lstat(root);
  await visit(root, rootStat.isFile() ? path.basename(root) : '');
  return files;
}
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function verifyFrozenRelease(reference) {
  if (!path.isAbsolute(reference?.manifest || '')) fail('ROLLOUT_EXPLICIT_PATH_REQUIRED');
  await assertNoReparse(reference.manifest);
  if ((await fileSha256(reference.manifest)) !== reference.sha256) fail('ROLLOUT_MANIFEST_CHANGED');
  const value = JSON.parse(await fs.readFile(reference.manifest, 'utf8')),
    root = path.dirname(reference.manifest),
    names = new Set();
  if (!Array.isArray(value.files) || !value.files.length) fail('ROLLOUT_INVALID_MANIFEST');
  for (const row of value.files) {
    if (
      typeof row.file !== 'string' ||
      !/^[a-zA-Z0-9_./-]+$/.test(row.file) ||
      row.file.split('/').some((p) => !p || p === '..' || p === '.') ||
      names.has(row.file)
    )
      fail('ROLLOUT_UNSAFE_MEMBER');
    names.add(row.file);
    const file = path.join(root, ...row.file.split('/'));
    await assertNoReparse(file);
    if ((await fileSha256(file)) !== row.sha256) fail('ROLLOUT_FROZEN_FILE_CHANGED');
  }
  for (const required of [
    'src/server/shared-sync/replication.mjs',
    'src/server/shared-sync/seed-attestation.mjs',
    'src/server/shared-sync/source-collection.mjs',
    'src/server/shared-sync/desktop-collection-commit.mjs',
  ])
    if (!names.has(required)) fail('ROLLOUT_SAME_SCHEMA_RELEASE_REQUIRED');
  for (const [file, hash] of Object.entries(APPROVED_MARKER1_SOURCES))
    if (value.files.find((row) => row.file === file)?.sha256 !== hash)
      fail('ROLLOUT_MARKER1_READER_REQUIRED');
  return value;
}

export async function verifyFrozenClient(reference) {
  if (!path.isAbsolute(reference?.manifest || '')) fail('ROLLOUT_CLIENT_FREEZE_REQUIRED');
  await assertNoReparse(reference.manifest);
  if ((await fileSha256(reference.manifest)) !== reference.sha256)
    fail('ROLLOUT_CLIENT_FREEZE_CHANGED');
  const manifest = JSON.parse(await fs.readFile(reference.manifest, 'utf8')),
    root = path.dirname(reference.manifest);
  if (
    !Array.isArray(manifest.files) ||
    !manifest.files.length ||
    !Array.isArray(manifest.artifacts) ||
    !['android-shared-runtime.js', 'desktop-shared-runtime.js'].every((name) =>
      manifest.artifacts.some((r) => r.file === name),
    )
  )
    fail('ROLLOUT_CLIENT_FREEZE_REQUIRED');
  for (const [prefix, rows] of [
    ['sources', manifest.files],
    ['', manifest.artifacts],
  ])
    for (const row of rows) {
      if (
        typeof row.file !== 'string' ||
        !/^[a-zA-Z0-9_./-]+$/.test(row.file) ||
        row.file.split('/').some((p) => !p || p === '.' || p === '..')
      )
        fail('ROLLOUT_UNSAFE_MEMBER');
      const file = path.join(root, prefix, ...row.file.split('/'));
      await assertNoReparse(file);
      if ((await fileSha256(file)) !== row.sha256) fail('ROLLOUT_CLIENT_FREEZE_CHANGED');
    }
}

/** A reviewed evidence packet pins actual existing ACK/stop receipts. These are
 * not generated by this guard; omitted/unknown preparation is a hard abort. */
export async function verifyRolloutPlan(
  plan,
  { now = Date.now(), inspectProcess, inspectConnections } = {},
) {
  if (
    plan?.version !== 1 ||
    plan.format !== 'shiye-controlled-shared-rollout' ||
    !['switch', 'rollback'].includes(plan.action) ||
    !Number.isInteger(plan.process?.pid) ||
    plan.process.pid <= 0 ||
    ![plan.process.executablePath, plan.process.commandLine, plan.process.createdAt].every(
      (v) => typeof v === 'string' && v.length > 0,
    ) ||
    !Number.isFinite(Date.parse(plan.process.createdAt)) ||
    !Number.isInteger(plan.windowMs) ||
    plan.windowMs < 1000 ||
    plan.windowMs > 120000
  )
    fail('ROLLOUT_INVALID_PLAN');
  if (typeof plan.messageEditWrites !== 'boolean') fail('ROLLOUT_MARKER1_WRITE_MODE_REQUIRED');
  for (const name of [
    'projectRoot',
    'dataDir',
    'stateDir',
    'backupDir',
    'pointer',
    'sharedConfig',
    'launcher',
  ])
    if (!path.isAbsolute(plan[name] || '')) fail('ROLLOUT_EXPLICIT_PATH_REQUIRED');
  if (
    plan.remoteEnabled !== false ||
    plan.listenHost !== '127.0.0.1' ||
    !path.isAbsolute(plan.exportsDir || '') ||
    !plan.evidence?.length
  )
    fail('ROLLOUT_SCOPE_INVALID');
  await verifyFrozenRelease(plan.candidate);
  await verifyFrozenRelease(plan.sameSchemaRollback);
  await verifyFrozenClient(plan.clientCandidate);
  for (const file of [
    plan.dataDir,
    plan.stateDir,
    plan.exportsDir,
    plan.pointer,
    plan.sharedConfig,
    plan.launcher,
  ])
    await assertNoReparse(file);
  if (
    (await fileSha256(plan.launcher)) !== plan.launcherSha256 ||
    (await fileSha256(plan.pointer)) !== plan.pointerSha256 ||
    (await fileSha256(plan.sharedConfig)) !== plan.sharedConfigSha256
  )
    fail('ROLLOUT_LAUNCHER_OR_POINTER_CHANGED');
  const config = JSON.parse(await fs.readFile(plan.sharedConfig, 'utf8'));
  if (
    config.enabled !== true ||
    config.remote !== false ||
    config.listenHost !== '127.0.0.1' ||
    path.resolve(config.sourceCollection?.exportsDir || '') !== path.resolve(plan.exportsDir)
  )
    fail('ROLLOUT_SHARED_CONFIG_INVALID');
  const requiredKinds = new Set([
    'frontend-saved-stopped',
    'legacy-runner-stopped',
    'conversation-runners-stopped',
    'external-writers-paused',
    'uploads-imports-drained',
  ]);
  for (const evidence of plan.evidence) {
    await assertNoReparse(evidence.file);
    if ((await fileSha256(evidence.file)) !== evidence.sha256) fail('ROLLOUT_EVIDENCE_CHANGED');
    const receipt = JSON.parse(await fs.readFile(evidence.file, 'utf8'));
    if (
      receipt.version !== 1 ||
      receipt.kind !== evidence.kind ||
      receipt.complete !== true ||
      !Number.isFinite(Date.parse(receipt.observedAt)) ||
      Date.parse(receipt.observedAt) > now ||
      now - Date.parse(receipt.observedAt) > 120000
    )
      fail('ROLLOUT_DRAIN_NOT_PROVEN');
    if (receipt.kind === 'frontend-saved-stopped') {
      if (
        receipt.standardStopAcknowledged !== true ||
        receipt.visibleUnsaved !== false ||
        receipt.pendingFilePreparation !== false ||
        receipt.pendingAttachments !== false ||
        receipt.pendingEditor !== false
      )
        fail('ROLLOUT_FRONTEND_NOT_SAVED');
      if (receipt.saveHttpAcknowledged !== true) {
        // LocalSaveAck is deliberately separate from delivery. The old owner
        // has no read-only FIFO barrier: this explicitly authorized real old
        // close-idle submission is valid only when it changed no business byte.
        const ref = receipt.serverFifoBarrier;
        if (
          receipt.localSavedAcknowledged !== true ||
          receipt.fifoBarrierApplied !== true ||
          !ref ||
          !receipt.references?.some((row) => row.file === ref.file && row.sha256 === ref.sha256)
        )
          fail('ROLLOUT_FIFO_BARRIER_NOT_PROVEN');
        await assertNoReparse(ref.file);
        if ((await fileSha256(ref.file)) !== ref.sha256) fail('ROLLOUT_FIFO_BARRIER_NOT_PROVEN');
        const barrier = JSON.parse(await fs.readFile(ref.file, 'utf8'));
        if (
          barrier.version !== 1 ||
          barrier.kind !== 'server-fifo-barrier' ||
          barrier.endpoint !== '/api/chat-journal/close-idle' ||
          barrier.method !== 'POST' ||
          barrier.httpStatus !== 200 ||
          barrier.closed !== 0 ||
          barrier.fifoBarrierApplied !== true ||
          barrier.beforeSha256 !== plan.librarySha256 ||
          barrier.afterSha256 !== plan.librarySha256 ||
          !Number.isFinite(Date.parse(barrier.observedAt)) ||
          Date.parse(barrier.observedAt) > Date.parse(receipt.observedAt)
        )
          fail('ROLLOUT_FIFO_BARRIER_NOT_PROVEN');
      }
    }
    if (receipt.kind.endsWith('runner-stopped') || receipt.kind === 'conversation-runners-stopped')
      if (receipt.running !== false || receipt.inFlight !== 0) fail('ROLLOUT_RUNNER_NOT_DRAINED');
    if (
      receipt.kind === 'uploads-imports-drained' &&
      (receipt.uploads !== 0 || receipt.importCommits !== 0)
    )
      fail('ROLLOUT_PENDING_WRITES');
    if (receipt.kind === 'external-writers-paused' && receipt.activeWriters !== 0)
      fail('ROLLOUT_PENDING_WRITES');
    if (!Array.isArray(receipt.references) || !receipt.references.length)
      fail('ROLLOUT_MISSING_RAW_ACKS');
    for (const ref of receipt.references) {
      await assertNoReparse(ref.file);
      if ((await fileSha256(ref.file)) !== ref.sha256) fail('ROLLOUT_RAW_ACK_CHANGED');
    }
    requiredKinds.delete(evidence.kind);
  }
  if (requiredKinds.size) fail('ROLLOUT_DRAIN_NOT_PROVEN');
  if (!inspectProcess || !inspectConnections) fail('ROLLOUT_PLATFORM_PROBE_REQUIRED');
  const current = await inspectProcess(plan.process.pid);
  if (
    !current ||
    current.executablePath !== plan.process.executablePath ||
    current.commandLine !== plan.process.commandLine ||
    current.createdAt !== plan.process.createdAt ||
    current.frontendProcesses !== 0
  )
    fail('ROLLOUT_PROCESS_IDENTITY_CHANGED');
  if ((await inspectConnections(plan.process.pid)) !== 0) fail('ROLLOUT_ACTIVE_CONNECTIONS');
  const file = path.join(plan.dataDir, 'diary.json');
  await assertNoReparse(file);
  if ((await fileSha256(file)) !== plan.librarySha256) fail('ROLLOUT_LIBRARY_CHANGED');
  const db = JSON.parse(await fs.readFile(file, 'utf8'));
  const stoppedInstances = plan.evidence.find((row) => row.kind === 'conversation-runners-stopped');
  const stoppedReceipt = JSON.parse(await fs.readFile(stoppedInstances.file, 'utf8'));
  const instanceIds = (db.conversationServices?.instances || [])
    .filter((row) => row.providerId === 'revisit')
    .map((row) => row.id)
    .sort();
  if (
    !Array.isArray(stoppedReceipt.instanceIds) ||
    JSON.stringify([...stoppedReceipt.instanceIds].sort()) !== JSON.stringify(instanceIds)
  )
    fail('ROLLOUT_RUNNER_NOT_DRAINED');
  if (
    (db._sharedSync?.libraryId || null) !== plan.libraryId ||
    (db._sharedSync?.epoch || null) !== plan.epoch
  )
    fail('ROLLOUT_LIBRARY_IDENTITY_CHANGED');
  for (const entry of db.entries || [])
    if (
      entry.chatJournal?.status === 'open' &&
      (!Number.isFinite(Date.parse(entry.chatJournal.deadline)) ||
        Date.parse(entry.chatJournal.deadline) <= now + plan.windowMs)
    )
      fail('ROLLOUT_IDLE_DEADLINE_WINDOW');
  if (plan.action === 'rollback' && (!db._sharedSync || plan.rollbackRestoresData === true))
    fail('ROLLOUT_UNSAFE_ROLLBACK');
  return {
    version: 1,
    checkedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + plan.windowMs).toISOString(),
    libraryId: db._sharedSync?.libraryId || null,
    epoch: db._sharedSync?.epoch || null,
    processId: plan.process.pid,
    stopped: false,
    gracefulSigterm: false,
  };
}

/** Back up the entire authoritative dataDir (originals, JSON/logs/receipts and
 * private auth/key/WAL files) plus explicitly pinned PC/config roots. Never open
 * the backup as an app. Source and destination are fully SHA checked twice. */
export async function backupRolloutCollection(plan) {
  if (
    !Array.isArray(plan.backupRoots) ||
    !plan.backupRoots.some((r) => path.resolve(r.source) === path.resolve(plan.dataDir)) ||
    !plan.backupRoots.some((r) => path.resolve(r.source) === path.resolve(plan.profileDir || ''))
  )
    fail('ROLLOUT_BACKUP_SCOPE_INCOMPLETE');
  const privateRelative = path.relative(plan.exportsDir, plan.backupDir);
  if (!privateRelative || privateRelative.startsWith('..') || path.isAbsolute(privateRelative))
    fail('ROLLOUT_PRIVATE_BACKUP_REQUIRED');
  const contains = (root, file) => {
    const r = path.relative(root, file);
    return r === '' || (!r.startsWith('..') && !path.isAbsolute(r));
  };
  if (
    [plan.launcher, plan.pointer, plan.sharedConfig].some(
      (file) => !plan.backupRoots.some((r) => contains(r.source, file)),
    )
  )
    fail('ROLLOUT_BACKUP_SCOPE_INCOMPLETE');
  await assertNoReparse(path.dirname(plan.backupDir));
  await fs.mkdir(plan.backupDir);
  const inventories = [];
  for (const root of plan.backupRoots) {
    if (!path.isAbsolute(root.source || '') || !/^[a-z][a-z0-9-]{0,40}$/.test(root.name))
      fail('ROLLOUT_BACKUP_SCOPE_INVALID');
    const relative = path.relative(root.source, plan.backupDir);
    if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)))
      fail('ROLLOUT_BACKUP_RECURSION');
    const before = await treeRoster(root.source),
      target = path.join(plan.backupDir, root.name);
    const sourceBase = (await fs.lstat(root.source)).isFile()
      ? path.dirname(root.source)
      : root.source;
    await fs.mkdir(target);
    for (const item of before) {
      const destination = path.join(target, ...item.path.split('/'));
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.copyFile(
        path.join(sourceBase, ...item.path.split('/')),
        destination,
        fs.constants.COPYFILE_EXCL,
      );
    }
    const after = await treeRoster(root.source),
      copied = await treeRoster(target);
    if (digest(before) !== digest(after) || digest(before) !== digest(copied))
      fail('ROLLOUT_BACKUP_CHANGED');
    inventories.push({
      name: root.name,
      files: before.length,
      bytes: before.reduce((a, b) => a + b.size, 0),
      rosterSha256: digest(before),
      members: before,
    });
  }
  const inventory = { version: 1, libraryId: plan.libraryId, epoch: plan.epoch, inventories };
  await fs.writeFile(path.join(plan.backupDir, 'verified-backup.json'), JSON.stringify(inventory), {
    flag: 'wx',
    mode: 0o600,
  });
  return inventory;
}
