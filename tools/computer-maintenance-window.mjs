import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileSha256, assertNoReparse } from '../src/server/shared-sync/rollout-guard.mjs';

const execute = promisify(execFile);
export const REVIEWED_RUNTIME = Object.freeze({
  directory: 'outputs/backend-runtimes/20261019-shared-rollout-marker1-1792447921466',
  sha256: '9e080882a802e9a364c87e0760432ca5bf4543ca0ad9f03117f00e37000a1ad2',
  fallbackDirectory: 'outputs/backend-runtimes/20261019-shared-marker1-fallback-1792447921466',
  fallbackSha256: '11708e630ea1a3a8810eb16b4fffd1402c14847bfafbdff35e692860cff44da7',
});
const fail = (code) => {
  throw Object.assign(Error(code), { code });
};
const hash = (value) => /^[a-f0-9]{64}$/.test(value || '');
const json = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));

/** Nulls are intentionally NOT defaults. A prepared template cannot execute. */
export function maintenanceTemplate(projectRoot, exportsDir) {
  return {
    version: 1,
    format: 'shiye-computer-maintenance-window',
    projectRoot,
    exportsDir,
    windowGranted: false,
    windowReceipt: null,
    frontendPreparation: null,
    rolloutPlan: null,
    rolloutPlanSha256: null,
    postInitializationPlan: null,
    postInitializationPlanSha256: null,
    postRegistrationBackup: null,
    postRegistrationBackupSha256: null,
    resumeReceipt: null,
    runtime: REVIEWED_RUNTIME,
    unresolved: [
      'Fresh exclusive window reference and actual frontend preparation observation',
      'Normal frontend stop and original save HTTP ACK references',
      'All runner stop ACKs, external request sources paused, staging/connection observations',
      'Current exact process/config/JSON identity, idle deadlines and full stable backup',
      'Post-initialization identity/auth backup, post-registration signing-key/receipt backup',
    ],
  };
}

export function rolloutPlanTemplate(projectRoot, dataDir, stateDir, privateDirectory) {
  const manifest = (directory) => path.join(projectRoot, directory, 'runtime-manifest.json');
  return {
    version: 1,
    format: 'shiye-controlled-shared-rollout',
    action: 'switch',
    projectRoot,
    dataDir,
    stateDir,
    exportsDir: path.dirname(privateDirectory),
    profileDir: path.join(stateDir, 'telegram-chat-preview'),
    backupDir: path.join(privateDirectory, 'pre-switch-backup'),
    pointer: path.join(projectRoot, 'config', 'backend-runtime.local.json'),
    sharedConfig: path.join(privateDirectory, 'shared-config.json'),
    launcher: path.join(projectRoot, 'server.mjs'),
    launcherSha256: null,
    pointerSha256: null,
    sharedConfigSha256: null,
    librarySha256: null,
    libraryId: null,
    epoch: null,
    windowMs: 60000,
    process: { pid: null, executablePath: null, commandLine: null, createdAt: null },
    frontendExecutables: [
      path.join(projectRoot, '拾页快捷记录.exe'),
      path.join(projectRoot, 'outputs', '2026-10-15-Telegram聊天预览', '拾页对话预览.exe'),
    ],
    port: 18765,
    listenHost: '127.0.0.1',
    remoteEnabled: false,
    messageEditWrites: true,
    candidate: { manifest: manifest(REVIEWED_RUNTIME.directory), sha256: REVIEWED_RUNTIME.sha256 },
    sameSchemaRollback: {
      manifest: manifest(REVIEWED_RUNTIME.fallbackDirectory),
      sha256: REVIEWED_RUNTIME.fallbackSha256,
    },
    clientCandidate: {
      manifest: path.join(
        projectRoot,
        'outputs',
        '2026-10-19-shared-business-integration',
        'data-composed-1792446232119',
        'data-manifest.json',
      ),
      sha256: 'e3eec1e75f44a28bf7e2a0eb11f9a6fcfdb0de96b395075b4f6e3639ff55bf20',
    },
    evidence: [],
    backupManifestSha256: null,
    backupRoots: [
      { name: 'data', source: dataDir },
      { name: 'profile', source: path.join(stateDir, 'telegram-chat-preview') },
      { name: 'config', source: path.join(projectRoot, 'config') },
      { name: 'launcher', source: path.join(projectRoot, 'server.mjs') },
      { name: 'shared-config', source: path.join(privateDirectory, 'shared-config.json') },
    ],
  };
}

export async function verifyWindowReference(reference, { now = Date.now(), maxAge = 120000 } = {}) {
  if (!path.isAbsolute(reference?.file || '') || !hash(reference.sha256))
    fail('MAINTENANCE_EVIDENCE_REQUIRED');
  await assertNoReparse(reference.file);
  if ((await fileSha256(reference.file)) !== reference.sha256) fail('MAINTENANCE_EVIDENCE_CHANGED');
  const value = await json(reference.file);
  const age = now - Date.parse(value.observedAt);
  if (!Number.isFinite(age) || age < 0 || age > maxAge) fail('MAINTENANCE_EVIDENCE_EXPIRED');
  return value;
}

export async function verifyPreparation(reference, options) {
  const value = await verifyWindowReference(reference, options);
  if (
    value.version !== 1 ||
    value.kind !== 'frontend-preparation-observed' ||
    value.visibleUnsaved !== false ||
    value.pendingFilePreparation !== false ||
    value.pendingAttachments !== false ||
    value.pendingEditor !== false ||
    value.externalRequestSourcesPaused !== true ||
    !Array.isArray(value.references) ||
    value.references.length === 0
  )
    fail('MAINTENANCE_PREPARATION_UNKNOWN');
  // Fresh observation may reference an older genuine ACK; changing only its
  // timestamp is not a new observation. All original references stay pinned.
  for (const ref of value.references) {
    if (!path.isAbsolute(ref.file || '') || !hash(ref.sha256))
      fail('MAINTENANCE_EVIDENCE_REQUIRED');
    await assertNoReparse(ref.file);
    if ((await fileSha256(ref.file)) !== ref.sha256) fail('MAINTENANCE_EVIDENCE_CHANGED');
  }
  return value;
}

async function defaultDesktop(root, action) {
  const { stdout } = await execute(
    process.execPath,
    [path.join(root, 'tools', 'desktop-control.mjs'), action],
    { cwd: root, windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
  );
  return JSON.parse(stdout);
}
async function request(port, action, method = 'GET') {
  const response = await fetch(`http://127.0.0.1:${port}${action}`, {
    method,
    headers: {
      Connection: 'close',
      'X-Diary-Client': 'desktop',
      Origin: `http://127.0.0.1:${port}`,
      ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(method === 'POST' ? { body: '{}' } : {}),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) fail('MAINTENANCE_NORMAL_AUTH_OR_REQUEST_FAILED');
  return response.json();
}

/** Explicit single steps: never force-stop a frontend or auto-loop rollback. */
export async function runMaintenanceStep(
  step,
  window,
  { desktop = defaultDesktop, call = request, rollout } = {},
) {
  if (
    window?.version !== 1 ||
    window.format !== 'shiye-computer-maintenance-window' ||
    !path.isAbsolute(window.projectRoot || '') ||
    !path.isAbsolute(window.exportsDir || '') ||
    JSON.stringify(window.runtime) !== JSON.stringify(REVIEWED_RUNTIME)
  )
    fail('MAINTENANCE_INVALID_WINDOW');
  if (step === 'status') return desktop(window.projectRoot, 'status');
  if (window.windowGranted !== true || !window.windowReceipt)
    fail('MAINTENANCE_WINDOW_NOT_GRANTED');
  const windowReceipt = await verifyWindowReference(window.windowReceipt, { maxAge: 1800000 });
  if (
    windowReceipt.exclusive !== true ||
    windowReceipt.kind !== 'maintenance-window-granted' ||
    !Number.isFinite(Date.parse(windowReceipt.expiresAt)) ||
    Date.parse(windowReceipt.expiresAt) <= Date.now()
  )
    fail('MAINTENANCE_WINDOW_NOT_GRANTED');
  if (step === 'stop-frontends') {
    await verifyPreparation(window.frontendPreparation);
    const before = await desktop(window.projectRoot, 'status');
    if (before.maintenanceLock || before.foreignWindows?.length || !before.readiness?.ready)
      fail('MAINTENANCE_FRONTEND_NOT_READY');
    // Existing broker normal save protection owns the decision; no kill fallback.
    const result = await desktop(window.projectRoot, 'stop');
    const after = await desktop(window.projectRoot, 'status');
    if (!result.stopped || after.processes?.length !== 0)
      fail('MAINTENANCE_FRONTEND_STOP_NOT_ACKNOWLEDGED');
    return { normalStop: result, status: after, clientsMayResume: false };
  }
  const planFile =
    step === 'post-initialization-backup' ? window.postInitializationPlan : window.rolloutPlan;
  const planSha =
    step === 'post-initialization-backup'
      ? window.postInitializationPlanSha256
      : window.rolloutPlanSha256;
  if (
    !path.isAbsolute(planFile || '') ||
    !hash(planSha) ||
    (await fileSha256(planFile)) !== planSha
  )
    fail('MAINTENANCE_PINNED_PLAN_REQUIRED');
  const plan = await json(planFile);
  const expected = path.join(
    window.projectRoot,
    REVIEWED_RUNTIME.directory,
    'runtime-manifest.json',
  );
  const fallback = path.join(
    window.projectRoot,
    REVIEWED_RUNTIME.fallbackDirectory,
    'runtime-manifest.json',
  );
  if (
    path.resolve(plan.candidate?.manifest || '') !== expected ||
    plan.candidate.sha256 !== REVIEWED_RUNTIME.sha256 ||
    path.resolve(plan.sameSchemaRollback?.manifest || '') !== fallback ||
    plan.sameSchemaRollback.sha256 !== REVIEWED_RUNTIME.fallbackSha256 ||
    plan.remoteEnabled !== false ||
    plan.listenHost !== '127.0.0.1' ||
    plan.exportsDir !== window.exportsDir
  )
    fail('MAINTENANCE_EXACT_RELEASE_REQUIRED');
  if (step === 'stop-runners' || step === 'observe-writers') {
    const status = await desktop(window.projectRoot, 'status');
    if (status.processes?.length !== 0) fail('MAINTENANCE_FRONTENDS_STILL_RUNNING');
    const access = await call(plan.port, '/api/access');
    if (access.enabled !== false || access.unlocked !== true)
      fail('MAINTENANCE_NORMAL_AUTH_REQUIRED');
    await assertNoReparse(path.join(plan.dataDir, 'diary.json'));
    const beforeSha = await fileSha256(path.join(plan.dataDir, 'diary.json'));
    const db = await json(path.join(plan.dataDir, 'diary.json'));
    const ids = (db.conversationServices?.instances || [])
      .filter((x) => x.providerId === 'revisit')
      .map((x) => x.id);
    const legacyBefore = await call(plan.port, '/api/revisit/runner');
    const legacyStop =
      step === 'stop-runners' ? await call(plan.port, '/api/revisit/runner/stop', 'POST') : null;
    const instances = [];
    for (const id of ids) {
      if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id))
        fail('MAINTENANCE_INVALID_INSTANCE');
      const base = `/api/conversation-services/instances/${id}/revisit/runner`;
      instances.push({
        id,
        before: await call(plan.port, base),
        stop: step === 'stop-runners' ? await call(plan.port, base + '/stop', 'POST') : null,
        after: await call(plan.port, base),
      });
    }
    const staging = {};
    for (const name of ['media-staging', 'import-staging', 'restore-staging']) {
      const directory = path.join(plan.dataDir, name);
      try {
        await assertNoReparse(directory);
        staging[name] = { present: true, entries: (await fs.readdir(directory)).length };
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        staging[name] = { present: false, entries: 0 };
      }
    }
    const mediaDir = path.join(plan.dataDir, 'media');
    await assertNoReparse(mediaDir);
    const mediaNames = await fs.readdir(mediaDir);
    const knownMedia = new Set((db.media || []).map((item) => item.id));
    const openDeadlines = (db.entries || [])
      .filter((item) => item.chatJournal?.status === 'open')
      .map((item) => item.chatJournal.deadline);
    const jsonUnchanged = beforeSha === (await fileSha256(path.join(plan.dataDir, 'diary.json')));
    return {
      legacyBefore,
      legacyStop,
      legacyAfter: await call(plan.port, '/api/revisit/runner'),
      instances,
      staging,
      uploadingFiles: mediaNames.filter((name) => name.endsWith('.uploading')).length,
      unindexedMediaNames: mediaNames.filter((name) => !knownMedia.has(name)).length,
      openDeadlines,
      librarySha256: beforeSha,
      jsonUnchanged,
      // Requires normal HTTP ACKs, external source observations and exact CIM /
      // established-connection checks in the reviewed rollout guard as well.
      drainProven: false,
    };
  }
  if (!['check', 'backup', 'switch', 'rollback', 'post-initialization-backup'].includes(step))
    fail('MAINTENANCE_UNKNOWN_STEP');
  // Use ONLY the already reviewed frozen tool + guard closure, never live code.
  const frozenRoot = path.dirname(expected);
  if ((await fileSha256(expected)) !== REVIEWED_RUNTIME.sha256)
    fail('MAINTENANCE_EXACT_RELEASE_REQUIRED');
  let toolRoot = frozenRoot;
  if (window.maintenanceGate) {
    const reference = window.maintenanceGate;
    await assertNoReparse(reference.manifest);
    if (!hash(reference.sha256) || (await fileSha256(reference.manifest)) !== reference.sha256)
      fail('MAINTENANCE_GATE_CHANGED');
    const gate = await json(reference.manifest);
    const names = ['src/server/shared-sync/rollout-guard.mjs', 'tools/shared-backend-rollout.mjs'];
    if (
      gate.format !== 'shiye-maintenance-gate-v1' ||
      gate.businessRuntimeSha256 !== REVIEWED_RUNTIME.sha256 ||
      JSON.stringify(gate.files?.map((row) => row.file).sort()) !== JSON.stringify(names.sort())
    )
      fail('MAINTENANCE_GATE_CHANGED');
    toolRoot = path.dirname(reference.manifest);
    for (const row of gate.files) {
      const file = path.join(toolRoot, row.file);
      await assertNoReparse(file);
      if ((await fileSha256(file)) !== row.sha256) fail('MAINTENANCE_GATE_CHANGED');
    }
  }
  const run =
    rollout ||
    (await import(pathToFileURL(path.join(toolRoot, 'tools', 'shared-backend-rollout.mjs')).href))
      .runSharedRollout;
  const mode = step === 'post-initialization-backup' ? 'backup' : step;
  return run(
    mode === 'check'
      ? [mode, planFile]
      : [mode, planFile, '--execute', '--approved-plan-sha256', planSha],
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [step, windowFile, ...flags] = process.argv.slice(2);
    if (!path.isAbsolute(windowFile || '')) fail('MAINTENANCE_ABSOLUTE_FILE_REQUIRED');
    if (step === 'template') {
      if (flags.length !== 2 || !path.isAbsolute(flags[0]) || !path.isAbsolute(flags[1]))
        fail('MAINTENANCE_TEMPLATE_ARGUMENTS');
      await fs.writeFile(windowFile, JSON.stringify(maintenanceTemplate(...flags), null, 2), {
        flag: 'wx',
        mode: 0o600,
      });
      console.log(JSON.stringify({ templateCreated: true, executable: false }));
    } else {
      await assertNoReparse(windowFile);
      if (
        step !== 'status' &&
        (flags.length !== 2 ||
          flags[0] !== '--execute-window-sha256' ||
          (await fileSha256(windowFile)) !== flags[1])
      )
        fail('MAINTENANCE_APPROVED_WINDOW_REQUIRED');
      const result = await runMaintenanceStep(step, await json(windowFile));
      // Full receipts are private and exclusive; stdout contains no source data.
      const receipt = windowFile + '.' + step + '.' + Date.now() + '.json';
      await fs.writeFile(
        receipt,
        JSON.stringify({ version: 1, step, observedAt: new Date().toISOString(), result }, null, 2),
        { flag: 'wx', mode: 0o600 },
      );
      console.log(
        JSON.stringify({
          step,
          receiptWritten: true,
          receiptSha256: await fileSha256(receipt),
          clientsMayResume: false,
        }),
      );
    }
  } catch (error) {
    console.error(
      /^MAINTENANCE_|^ROLLOUT_/.test(error.code || '')
        ? error.code
        : 'MAINTENANCE_FAILED_KEEP_EVIDENCE',
    );
    process.exitCode = 1;
  }
}
