import { promises as fs, openSync, closeSync } from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import {
  verifyRolloutPlan,
  backupRolloutCollection,
  fileSha256,
  treeRoster,
} from '../src/server/shared-sync/rollout-guard.mjs';
const exec = promisify(execFile);
const fail = (code) => {
  throw Object.assign(Error(code), { code });
};
async function powershell(code) {
  const { stdout } = await exec(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(code, 'utf16le').toString('base64'),
    ],
    { windowsHide: true, maxBuffer: 1024 * 1024 },
  );
  return stdout.trim() ? JSON.parse(stdout) : null;
}
function platform(plan) {
  return {
    async inspectProcess(pid) {
      // Paths are encoded data, never interpolated PowerShell source.
      const encoded = Buffer.from(JSON.stringify(plan.frontendExecutables || [])).toString(
        'base64',
      );
      return powershell(
        `$ErrorActionPreference='Stop';$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}';if(!$p){exit 0};$names=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))|ConvertFrom-Json;$front=@(Get-CimInstance Win32_Process|Where-Object {$_.ExecutablePath -in $names});@{executablePath=$p.ExecutablePath;commandLine=$p.CommandLine;createdAt=$p.CreationDate.ToUniversalTime().ToString('o');frontendProcesses=$front.Count}|ConvertTo-Json -Compress`,
      );
    },
    async inspectConnections(pid) {
      return powershell(
        `$ErrorActionPreference='Stop';@(Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue|Where-Object {$_.OwningProcess -eq ${pid}}).Count|ConvertTo-Json`,
      );
    },
  };
}
export async function runSharedRollout(args) {
  const [mode, planFile, ...flags] = args;
  if (
    !['check', 'backup', 'switch', 'rollback'].includes(mode) ||
    !path.isAbsolute(planFile || '') ||
    process.platform !== 'win32'
  )
    fail('ROLLOUT_INVALID_ARGUMENT');
  const approvedIndex = flags.indexOf('--approved-plan-sha256');
  if (
    mode !== 'check' &&
    (flags[0] !== '--execute' ||
      approvedIndex !== 1 ||
      flags.length !== 3 ||
      (await fileSha256(planFile)) !== flags[2])
  )
    fail('ROLLOUT_APPROVED_PLAN_REQUIRED');
  const plan = JSON.parse(await fs.readFile(planFile, 'utf8'));
  if (
    (mode === 'rollback') !== (plan.action === 'rollback') &&
    ['switch', 'rollback'].includes(mode)
  )
    fail('ROLLOUT_ACTION_MISMATCH');
  if (
    !plan.frontendExecutables?.length ||
    !Number.isInteger(plan.port) ||
    plan.port < 1 ||
    plan.port > 65535
  )
    fail('ROLLOUT_INVALID_PLAN');
  const probes = platform(plan),
    checked = await verifyRolloutPlan(plan, probes);
  if (mode === 'check') return checked;
  if (mode === 'backup') {
    const inventory = await backupRolloutCollection(plan);
    return {
      backedUp: true,
      roots: inventory.inventories.length,
      files: inventory.inventories.reduce((n, r) => n + r.files, 0),
      stopped: false,
    };
  }
  const backupFile = path.join(plan.backupDir, 'verified-backup.json');
  if (!plan.backupManifestSha256 || (await fileSha256(backupFile)) !== plan.backupManifestSha256)
    fail('ROLLOUT_BACKUP_NOT_PINNED');
  const backup = JSON.parse(await fs.readFile(backupFile, 'utf8'));
  for (const row of backup.inventories) {
    const root = plan.backupRoots.find((r) => r.name === row.name);
    if (
      !root ||
      JSON.stringify(await treeRoster(root.source)) !== JSON.stringify(row.members) ||
      JSON.stringify(await treeRoster(path.join(plan.backupDir, row.name))) !==
        JSON.stringify(row.members)
    )
      fail('ROLLOUT_BACKUP_CHANGED');
  }
  // Recheck after expensive hashes, just before the bounded Windows stop.
  await verifyRolloutPlan(plan, probes);
  const release = mode === 'rollback' ? plan.sameSchemaRollback : plan.candidate;
  const journal = path.join(plan.backupDir, 'switch-' + Date.now() + '.json');
  await fs.writeFile(
    journal,
    JSON.stringify({
      version: 1,
      phase: 'verified-before-windows-stop',
      gracefulSigterm: false,
      pid: plan.process.pid,
      libraryId: plan.libraryId,
      epoch: plan.epoch,
    }),
    { flag: 'wx', mode: 0o600 },
  );
  await powershell(
    `$ErrorActionPreference='Stop';Stop-Process -Id ${plan.process.pid};Wait-Process -Id ${plan.process.pid} -Timeout 15 -ErrorAction SilentlyContinue;@{stopped=$true}|ConvertTo-Json -Compress`,
  );
  if (await probes.inspectProcess(plan.process.pid)) fail('ROLLOUT_PROCESS_DID_NOT_STOP');
  if ((await fileSha256(path.join(plan.dataDir, 'diary.json'))) !== plan.librarySha256)
    fail('ROLLOUT_LIBRARY_CHANGED_DURING_STOP');
  if ((await fileSha256(plan.pointer)) !== plan.pointerSha256)
    fail('ROLLOUT_POINTER_CHANGED_DURING_STOP');
  const temporary = plan.pointer + '.rollout-' + Date.now();
  await fs.writeFile(temporary, JSON.stringify({ manifest: release.manifest }), {
    flag: 'wx',
    mode: 0o600,
  });
  await fs.rename(temporary, plan.pointer);
  const stdout = openSync(path.join(plan.backupDir, 'new-api.stdout.log'), 'ax', 0o600),
    stderr = openSync(path.join(plan.backupDir, 'new-api.stderr.log'), 'ax', 0o600);
  let child;
  try {
    child = spawn(plan.process.executablePath, [plan.launcher], {
      cwd: plan.projectRoot,
      windowsHide: true,
      detached: true,
      env: {
        ...process.env,
        DIARY_DATA_DIR: plan.dataDir,
        DIARY_PORT: String(plan.port),
        DIARY_SHARED_CONFIG: plan.sharedConfig,
        DIARY_BACKEND_MANIFEST: release.manifest,
        SHIYE_MESSAGE_EDIT_WRITES:
          mode === 'rollback' || plan.messageEditWrites === false ? '0' : '1',
      },
      stdio: ['ignore', stdout, stderr],
    });
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    child.unref();
  } finally {
    closeSync(stdout);
    closeSync(stderr);
  }
  let healthy = false;
  for (let attempt = 0; attempt < 25; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${plan.port}/api/health`, {
          signal: AbortSignal.timeout(1500),
          headers: { Connection: 'close' },
        }),
        value = await response.json();
      if (
        value.sharedBusiness?.enabled === true &&
        value.sharedBusiness.sameBusinessStore === true &&
        value.sharedBusiness.seed?.features?.includes('seed-attestation-ed25519-v1')
      ) {
        healthy = true;
        break;
      }
    } catch {
      /* Keep the failed package/process and journal; no rollback loop. */
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  const current = JSON.parse(await fs.readFile(path.join(plan.dataDir, 'diary.json'), 'utf8'));
  if (
    !healthy ||
    !current._sharedSync ||
    (plan.libraryId && current._sharedSync.libraryId !== plan.libraryId) ||
    (plan.epoch && current._sharedSync.epoch !== plan.epoch)
  )
    fail('ROLLOUT_NEW_OWNER_NOT_VERIFIED_KEEP_EVIDENCE');
  const result = {
    version: 1,
    phase: 'shared-owner-started',
    pid: child.pid,
    healthy,
    gracefulSigterm: false,
    libraryId: current._sharedSync.libraryId,
    epoch: current._sharedSync.epoch,
    postInitializationBackupRequired: true,
    clientsMayResume: false,
    messageEditWrites: mode === 'rollback' ? false : plan.messageEditWrites,
    fallbackPreservesMarker1Reads: true,
  };
  await fs.writeFile(
    path.join(plan.backupDir, 'post-start-identity.json'),
    JSON.stringify(result),
    { flag: 'wx', mode: 0o600 },
  );
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(await runSharedRollout(process.argv.slice(2))));
  } catch (error) {
    console.error(
      /^ROLLOUT_[A-Z_]+$/.test(error.code || '') ? error.code : 'ROLLOUT_FAILED_KEEP_EVIDENCE',
    );
    process.exitCode = 1;
  }
}
