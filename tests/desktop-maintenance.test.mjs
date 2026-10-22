import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createDesktopController } from '../tools/lib/desktop-maintenance.mjs';
import { windowsDesktopRuntime } from '../tools/lib/desktop-runtime.mjs';
import {
  controlFailure,
  formatControlHuman,
  parseControlArguments,
  runControl,
} from '../tools/desktop-control.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const chat = '拾页对话预览.exe';
const protocol = 'shiye-desktop-maintenance-v1';
async function fixture(t, options = {}) {
  const temp = path.join(project, 'tmp');
  await fs.mkdir(temp, { recursive: true });
  const root = await fs.mkdtemp(path.join(temp, 'desktop-maintenance-'));
  t.after(async () => {
    assert.ok(root.startsWith(temp + path.sep));
    await fs.rm(root, { recursive: true, force: true });
  });
  const target = path.join(root, 'outputs', '2026-10-15-Telegram聊天预览');
  const source = path.join(root, 'outputs', 'ui4', 'candidate');
  async function write(file, bytes) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, bytes);
  }
  for (const [directory, revision, label] of [
    [target, 'ui-old', 'old'],
    [source, '20261016-ui4', 'new'],
  ]) {
    await write(path.join(directory, chat), label + '-exe');
    await write(
      path.join(directory, 'UPSTREAM.json'),
      JSON.stringify({ appVersion: '0.9.20', uiRevision: revision }),
    );
    await write(path.join(directory, 'app', 'index.html'), label + '-page');
    if (label === 'new') await write(path.join(directory, 'app', 'theme.css'), 'new-style');
  }
  await write(path.join(root, 'data', 'diary.json'), 'PRIVATE-FIXTURE-ORIGINAL');
  await write(path.join(root, 'var', 'quick-window.json'), '{"height":700}');
  await write(
    path.join(root, 'config', 'deployment.local.json'),
    JSON.stringify({ stateDirectory: path.join(root, 'var'), dataDir: path.join(root, 'data') }),
  );
  const files = [];
  for (const name of [chat, 'UPSTREAM.json', 'app/index.html', 'app/theme.css'])
    files.push({
      file: 'candidate/' + name,
      sha256: hash(await fs.readFile(path.join(source, name))),
    });
  await write(
    path.join(path.dirname(source), 'delivery-manifest-ui4.json'),
    JSON.stringify({ revision: '20261016-ui4', checks: { chat: 118, image: 9 }, files }),
  );
  let ticks = Date.parse('2026-10-16T12:00:00Z');
  let running = [
    { pid: 1, executablePath: path.join(root, '拾页快捷记录.exe') },
    { pid: 2, executablePath: path.join(target, chat) },
  ];
  const calls = [];
  const runtime = {
    processes: async () => running,
    health: async () => ({ version: '0.9.20' }),
    requestStop: async () => {
      calls.push('stop');
      if (!options.saveFails) running = [];
    },
    start: async () => {
      calls.push('start');
      running = [
        { pid: 3, executablePath: path.join(root, '拾页快捷记录.exe') },
        { pid: 4, executablePath: path.join(target, chat) },
      ];
    },
    readiness: async () => ({ ready: !options.startFails, verification: 'isolated-fake-receipt' }),
  };
  const controller = createDesktopController({
    root,
    runtime,
    timeoutMs: 250,
    now: () => ticks,
    pause: async (ms) => {
      ticks += ms;
    },
    ...options,
  });
  return {
    root,
    target,
    source,
    controller,
    calls,
    write,
    runtime,
    setRunning: (value) => {
      running = value;
    },
  };
}

test('desktop command parser rejects arbitrary commands, incomplete paths and conflicting options', () => {
  for (const args of [
    [],
    ['exec', 'whoami'],
    ['upgrade'],
    ['stop', '--from', 'x'],
    ['upgrade', '--from'],
    ['upgrade', '--from', 'x', '--from', 'y'],
    ['start', '--no-start'],
    ['status', '--force'],
  ])
    assert.throws(() => parseControlArguments(args));
  assert.deepEqual(
    parseControlArguments(['upgrade', '--from', 'outputs/a b/candidate', '--dry-run']),
    { command: 'upgrade', options: { source: 'outputs/a b/candidate', dryRun: true } },
  );
});

test('status and upgrade dry-run do not stop windows or write install files', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.controller.status()).installed.revision, 'ui-old');
  const result = await f.controller.upgrade(f.source, { dryRun: true });
  assert.equal(result.writes, false);
  assert.deepEqual(f.calls, []);
  assert.equal(await fs.readFile(path.join(f.target, chat), 'utf8'), 'old-exe');
  await assert.rejects(fs.access(path.join(f.root, 'outputs', 'desktop-maintenance')));
});

test('candidate proof requires positive integer check counts and a file list', async (t) => {
  const f = await fixture(t);
  const file = path.join(path.dirname(f.source), 'delivery-manifest-ui4.json');
  const proof = JSON.parse(await fs.readFile(file, 'utf8'));
  for (const bad of [
    { ...proof, checks: {} },
    { ...proof, checks: { chat: '118', image: 9 } },
    { ...proof, checks: { chat: 118, image: 0 } },
    { ...proof, files: null },
  ]) {
    await fs.writeFile(file, JSON.stringify(bad));
    await assert.rejects(f.controller.upgrade(f.source, { dryRun: true }), /验收记录/);
  }
  assert.deepEqual(f.calls, []);
});

test('upgrade waits for normal save exit, snapshots, installs and starts without changing private data', async (t) => {
  const phases = [];
  const f = await fixture(t, {
    onPhase: async (phase) => {
      phases.push(phase);
    },
  });
  const result = await runControl(['upgrade', '--from', f.source], f.controller);
  assert.equal(result.revision, '20261016-ui4');
  assert.deepEqual(f.calls, ['stop', 'start']);
  assert.deepEqual(phases, [
    'prepared',
    'stopped',
    'backed-up',
    'applying',
    'installed',
    'started',
    'complete',
  ]);
  assert.equal(await fs.readFile(path.join(f.target, chat), 'utf8'), 'new-exe');
  assert.equal(await fs.readFile(path.join(result.backup, chat), 'utf8'), 'old-exe');
  assert.equal(
    await fs.readFile(path.join(f.root, 'data', 'diary.json'), 'utf8'),
    'PRIVATE-FIXTURE-ORIGINAL',
  );
  assert.equal(
    await fs.readFile(path.join(f.root, 'var', 'quick-window.json'), 'utf8'),
    '{"height":700}',
  );
  assert.equal(
    await fs.readFile(path.join(result.backup, 'preferences', 'quick-window.json'), 'utf8'),
    '{"height":700}',
  );
});

test('save rejection or timeout leaves all installed program files intact', async (t) => {
  const f = await fixture(t, { saveFails: true });
  await assert.rejects(f.controller.upgrade(f.source), /保存退出未完成/);
  assert.deepEqual(f.calls, ['stop']);
  assert.equal(await fs.readFile(path.join(f.target, chat), 'utf8'), 'old-exe');
  assert.equal(await fs.readFile(path.join(f.target, 'app', 'index.html'), 'utf8'), 'old-page');
});

test('a chat without its broker prevents unattended overwrite instead of killing it', async (t) => {
  const f = await fixture(t);
  f.setRunning([{ pid: 2, executablePath: path.join(f.target, chat) }]);
  await assert.rejects(f.controller.upgrade(f.source), /统一后台不存在/);
  assert.deepEqual(f.calls, []);
});

test('candidate corruption is detected before asking windows to exit', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.source, chat), 'tampered');
  await assert.rejects(f.controller.upgrade(f.source), /交付清单不匹配/);
  assert.deepEqual(f.calls, []);
});

test('foreign project windows block exit requests before any program replacement', async (t) => {
  const f = await fixture(t);
  f.runtime.conflicts = async () => [{ pid: 99, executablePath: 'F:/other/拾页快捷记录.exe' }];
  await assert.rejects(f.controller.upgrade(f.source), /另一个目录/);
  assert.deepEqual(f.calls, []);
});

test('candidate and manifest traversal cannot reach the library or outside project outputs', async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.controller.upgrade(path.join(f.root, 'data')), /维护路径/);
  const proof = path.join(path.dirname(f.source), 'delivery-manifest-ui4.json');
  const data = JSON.parse(await fs.readFile(proof, 'utf8'));
  data.files.push({ file: 'candidate/../../outside', sha256: 'fake' });
  await fs.writeFile(proof, JSON.stringify(data));
  await assert.rejects(f.controller.upgrade(f.source), /维护路径/);
  assert.deepEqual(f.calls, []);
});

test('junctions in app assets are rejected while preserving their target', async (t) => {
  const f = await fixture(t);
  try {
    await fs.symlink(
      path.join(f.root, 'data'),
      path.join(f.source, 'app', 'linked-data'),
      'junction',
    );
  } catch (error) {
    if (['EPERM', 'EACCES'].includes(error.code)) {
      t.skip('OS does not permit test junctions');
      return;
    }
    throw error;
  }
  await assert.rejects(f.controller.upgrade(f.source), /符号链接/);
  assert.deepEqual(f.calls, []);
  assert.equal(
    await fs.readFile(path.join(f.root, 'data', 'diary.json'), 'utf8'),
    'PRIVATE-FIXTURE-ORIGINAL',
  );
});

test('a mid-copy failure restores previous executable and page from verified snapshot', async (t) => {
  let f;
  f = await fixture(t, {
    onPhase: async (phase) => {
      if (phase === 'applying') await fs.mkdir(path.join(f.target, 'app', 'theme.css'));
    },
  });
  await assert.rejects(f.controller.upgrade(f.source), /备份/);
  assert.equal(await fs.readFile(path.join(f.target, chat), 'utf8'), 'old-exe');
  assert.equal(await fs.readFile(path.join(f.target, 'app', 'index.html'), 'utf8'), 'old-page');
  const operation = JSON.parse(
    await fs.readFile(
      path.join(f.root, 'outputs', 'desktop-maintenance', 'active-operation.json'),
      'utf8',
    ),
  );
  assert.equal(operation.rolledBack, true);
  assert.equal(operation.failedPhase, 'installing');
  assert.equal(operation.lastSuccessfulPhase, 'backed-up');
});

test('rollback restores only program bytes and preserves subsequent drafts and diary edits', async (t) => {
  const f = await fixture(t);
  const first = await f.controller.upgrade(f.source);
  await fs.writeFile(path.join(f.root, 'var', 'quick-window.json'), '{"height":900}');
  await fs.writeFile(path.join(f.root, 'data', 'diary.json'), 'USER-EDIT-AFTER-UPGRADE');
  await f.controller.rollback(first.backup);
  assert.equal(await fs.readFile(path.join(f.target, chat), 'utf8'), 'old-exe');
  assert.equal(
    await fs.readFile(path.join(f.root, 'var', 'quick-window.json'), 'utf8'),
    '{"height":900}',
  );
  assert.equal(
    await fs.readFile(path.join(f.root, 'data', 'diary.json'), 'utf8'),
    'USER-EDIT-AFTER-UPGRADE',
  );
});

test('a damaged backup is rejected before stopping current windows', async (t) => {
  const f = await fixture(t);
  const result = await f.controller.upgrade(f.source);
  await fs.writeFile(path.join(result.backup, chat), 'broken');
  f.calls.length = 0;
  await assert.rejects(f.controller.rollback(result.backup), /SHA-256/);
  assert.deepEqual(f.calls, []);
});

test('maintenance lock prevents concurrent changes and no-start leaves windows stopped', async (t) => {
  let release;
  let reached;
  const waiting = new Promise((resolve) => {
    reached = resolve;
  });
  const hold = new Promise((resolve) => {
    release = resolve;
  });
  const f = await fixture(t, {
    onPhase: async (phase) => {
      if (phase === 'prepared') {
        reached();
        await hold;
      }
    },
  });
  const first = f.controller.upgrade(f.source, { noStart: true });
  await waiting;
  await assert.rejects(f.controller.upgrade(f.source), /维护锁/);
  release();
  assert.equal((await first).restarted, false);
  assert.deepEqual(f.calls, ['stop']);
});

test('a process that never publishes readiness is not reported as a successful upgrade', async (t) => {
  const f = await fixture(t, { startFails: true });
  await assert.rejects(f.controller.upgrade(f.source), /新版未在限时内/);
  const status = await f.controller.status();
  assert.equal(status.lastOperation.phase, 'failed');
  assert.equal(status.readiness.ready, false);
});

test('stale lock recovery archives only a known dead owner and refuses live owners', async (t) => {
  const f = await fixture(t, { isProcessAlive: () => false });
  const lock = path.join(f.root, 'outputs', 'desktop-maintenance', 'maintenance.lock');
  const owner = JSON.stringify({ protocol, root: f.root, pid: 12345, nonce: 'test' });
  await f.write(lock, owner);
  const result = await f.controller.recoverLock();
  assert.equal(await fs.readFile(result.archived, 'utf8'), owner);
  await f.write(lock, owner);
  const busy = createDesktopController({
    root: f.root,
    runtime: f.runtime,
    isProcessAlive: () => true,
  });
  await assert.rejects(busy.recoverLock(), /仍在运行/);
});

test('runtime receipt requires the live PID, matching executable, fresh time and matching revision', async (t) => {
  const f = await fixture(t);
  await f.write(
    path.join(f.target, 'UPSTREAM.json'),
    JSON.stringify({ uiRevision: '20261016-ui4', desktopControlProtocol: 1 }),
  );
  const runtime = windowsDesktopRuntime(f.root);
  const receipt = path.join(f.root, 'var', 'telegram-chat-preview', 'runtime-status.json');
  const correct = {
    protocol: 1,
    pid: 9,
    executable: path.join(f.target, chat),
    ready: true,
    uiRevision: '20261016-ui4',
    atUtc: '2026-10-16T12:00:01Z',
  };
  const current = [
    { pid: 9, executablePath: path.join(f.target, chat), createdAtUtc: '2026-10-16T12:00:00Z' },
  ];
  for (const change of [
    { pid: 8 },
    { executable: 'other.exe' },
    { atUtc: '2026-10-15T12:00:00Z' },
    { uiRevision: 'old' },
    { ready: false },
  ]) {
    await f.write(receipt, JSON.stringify({ ...correct, ...change }));
    assert.equal((await runtime.readiness(current)).ready, false);
  }
  await f.write(receipt, JSON.stringify(correct));
  assert.equal((await runtime.readiness(current)).ready, true);
  assert.equal((await runtime.readiness([])).ready, false);
});

test('human output is opt-in and limited to readonly commands', async () => {
  for (const command of ['status', 'doctor', 'help'])
    assert.deepEqual(parseControlArguments([command, '--human']), {
      command,
      options: { human: true },
    });
  for (const command of ['start', 'stop', 'restart', 'upgrade', 'rollback', 'recover-lock'])
    assert.throws(() => parseControlArguments([command, '--human']));
  assert.throws(() => parseControlArguments(['doctor', '--human', '--human']));
  const result = {
    installed: { revision: 'ui-example' },
    processes: [],
    api: { reachable: true, version: '0.9.24' },
  };
  assert.deepEqual(await runControl(['status'], { status: async () => result }), result);
  assert.match(formatControlHuman(result), /已退出，无需保存退出/);
  assert.match(formatControlHuman(result), /日记 API：运行中 0.9.24/);
});

test('doctor and stopped upgrade do not request save or confuse a live API with open windows', async (t) => {
  const f = await fixture(t);
  f.setRunning([]);
  f.runtime.health = async () => ({ reachable: true, version: '0.9.24' });
  const before = hash(await fs.readFile(path.join(f.target, chat)));
  const report = await runControl(['doctor'], f.controller);
  assert.equal(report.readOnly, true);
  assert.equal(report.saveDisposition, 'already-stopped');
  assert.equal(report.status.api.reachable, true);
  assert.deepEqual(f.calls, []);
  assert.equal(hash(await fs.readFile(path.join(f.target, chat))), before);
  await assert.rejects(fs.access(path.join(f.root, 'outputs', 'desktop-maintenance')));
  await f.controller.upgrade(f.source, { noStart: true });
  assert.deepEqual(f.calls, []);
  assert.equal((await f.controller.status()).lastOperation.saveDisposition, 'already-stopped');
});

test('doctor blocks foreign ownership and a chat without its broker without sending requests', async (t) => {
  const f = await fixture(t);
  f.setRunning([{ pid: 2, executablePath: path.join(f.target, chat) }]);
  f.runtime.conflicts = async () => [
    { pid: 3, executablePath: path.join(f.root, 'foreign', chat) },
  ];
  const report = await f.controller.doctor();
  assert.equal(report.saveDisposition, 'blocked-without-broker');
  assert.ok(report.issues.some((issue) => issue.code === 'missing-broker'));
  assert.ok(report.issues.some((issue) => issue.code === 'foreign-processes'));
  assert.equal(report.nextAction.automaticAllowed, false);
  assert.deepEqual(f.calls, []);
});

test('a resident broker with the chat window closed is a normal maintainable state', async (t) => {
  const f = await fixture(t);
  f.setRunning([{ pid: 1, executablePath: path.join(f.root, '拾页快捷记录.exe') }]);
  f.runtime.readiness = async () => ({ ready: false, runningRevision: null });
  const report = await f.controller.doctor();
  assert.equal(report.ok, true);
  assert.equal(report.saveDisposition, 'save-required-if-stopping');
  assert.equal(report.issues.find((issue) => issue.code === 'missing-chat').level, 'warning');
  assert.ok(!report.issues.some((issue) => issue.code === 'not-ready'));
  assert.equal(report.nextAction.automaticAllowed, true);
  assert.match(report.nextAction.reason, /托盘正常驻留/);
  assert.match(formatControlHuman(report), /运行 UI：已退出/);
  assert.deepEqual(f.calls, []);
});

test('doctor never recovers a lock and only recommends recovery for a known dead owner', async (t) => {
  const f = await fixture(t, { isProcessAlive: () => false });
  const lock = path.join(f.root, 'outputs', 'desktop-maintenance', 'maintenance.lock');
  const bytes = JSON.stringify({ protocol, root: f.root, pid: 12345 });
  await f.write(lock, bytes);
  const report = await f.controller.doctor();
  assert.equal(report.nextAction.command, 'recover-lock');
  assert.equal(report.nextAction.automaticAllowed, true);
  assert.equal(await fs.readFile(lock, 'utf8'), bytes);
  const busy = createDesktopController({
    root: f.root,
    runtime: f.runtime,
    isProcessAlive: () => true,
  });
  assert.equal((await busy.doctor()).nextAction.automaticAllowed, false);
  await f.write(lock, '{broken');
  const broken = await f.controller.doctor();
  assert.equal(broken.saveDisposition, 'unknown');
  assert.equal(broken.nextAction.automaticAllowed, false);
  assert.match(formatControlHuman(broken), /运行状态未知/);
  assert.equal(await fs.readFile(lock, 'utf8'), '{broken');
  assert.deepEqual(f.calls, []);
});

test('backup failure identifies the failed action separately from the last successful stop', async (t) => {
  let f;
  f = await fixture(t, {
    onPhase: async (phase) => {
      if (phase === 'stopped') await fs.unlink(path.join(f.target, 'UPSTREAM.json'));
    },
  });
  let failure;
  try {
    await f.controller.upgrade(f.source);
  } catch (error) {
    failure = error;
  }
  assert.ok(failure);
  const envelope = controlFailure(failure);
  assert.equal(envelope.failedPhase, 'backing-up');
  assert.equal(envelope.lastSuccessfulPhase, 'stopped');
  assert.equal(envelope.nextAction.automaticAllowed, false);
  const operation = (await f.controller.status()).lastOperation;
  assert.equal(operation.failedPhase, 'backing-up');
  assert.equal(operation.lastSuccessfulPhase, 'stopped');
  assert.equal(operation.source, f.source);
  assert.equal(await fs.readFile(path.join(f.target, chat), 'utf8'), 'old-exe');
});

test('readiness failure records starting after installed and never recommends unattended reinstall', async (t) => {
  const f = await fixture(t, { startFails: true });
  await assert.rejects(f.controller.upgrade(f.source), (error) => {
    assert.equal(error.diagnostics.failedPhase, 'starting');
    assert.equal(error.diagnostics.lastSuccessfulPhase, 'installed');
    assert.equal(error.diagnostics.nextAction.automaticAllowed, false);
    return true;
  });
  const report = await f.controller.doctor();
  assert.ok(report.issues.some((issue) => issue.code === 'failed-operation'));
  assert.equal(report.nextAction.automaticAllowed, false);
  assert.match(formatControlHuman(report), /失败动作：starting/);
  assert.deepEqual(f.calls, ['stop', 'start']);
});

test('unknown old failures and rollback failures cannot trigger an automatic recovery recommendation', async (t) => {
  const f = await fixture(t);
  f.setRunning([]);
  for (const detail of [
    {},
    {
      rollbackError: 'fixture rollback failed',
      nextAction: { command: 'upgrade', automaticAllowed: true },
    },
  ]) {
    await f.write(
      path.join(f.root, 'outputs', 'desktop-maintenance', 'active-operation.json'),
      JSON.stringify({ phase: 'failed', ...detail }),
    );
    const report = await f.controller.doctor();
    assert.equal(report.nextAction.automaticAllowed, false);
    assert.notEqual(report.nextAction.command, 'upgrade');
  }
  assert.deepEqual(f.calls, []);
  assert.equal(controlFailure(new Error('unknown')).nextAction.automaticAllowed, false);
});
