import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const PROTOCOL = 'shiye-desktop-maintenance-v1';
const CHAT = '拾页对话预览.exe';
const SUPPORT = [
  CHAT,
  'Microsoft.Web.WebView2.Core.dll',
  'Microsoft.Web.WebView2.WinForms.dll',
  'WebView2Loader.dll',
  'WebView2-LICENSE.txt',
  'Telegram-Web-A-LICENSE',
  'UPSTREAM.json',
];
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const json = (value) => JSON.stringify(value, null, 2) + '\n';

function fail(message) {
  throw new Error(message);
}
function inside(root, value) {
  const result = path.resolve(root, value);
  const relative = path.relative(root, result);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
    fail('维护路径必须位于指定目录内部：' + value);
  return result;
}
async function plainPath(root, file) {
  inside(root, file);
  for (let current = file; current !== root; current = path.dirname(current)) {
    try {
      if ((await fs.lstat(current)).isSymbolicLink())
        fail('维护不跟随符号链接或目录联接：' + current);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}
async function readJSON(file) {
  return JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
}
async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}
async function writeJSON(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = file + '.' + crypto.randomUUID() + '.tmp';
  await fs.writeFile(temporary, json(value), { flag: 'wx' });
  await fs.rename(temporary, file);
}
function deployable(name) {
  return SUPPORT.includes(name) || name.startsWith('app/');
}
function relativeFile(value) {
  if (
    typeof value !== 'string' ||
    value.includes('\\') ||
    value.includes(':') ||
    value.includes('\0')
  )
    fail('安装包文件名无效');
  if (value.split('/').some((part) => !part || part === '.' || part === '..'))
    fail('安装包含越界路径');
  if (!deployable(value)) fail('安装包包含非程序文件：' + value);
  return value;
}

/** Only chat program files are deployable. Library/profile paths are never targets. */
export function createDesktopController({
  root,
  runtime,
  timeoutMs = 30000,
  pause = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = () => Date.now(),
  onPhase = async () => {},
  isProcessAlive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      if (error.code === 'ESRCH') return false;
      return true;
    }
  },
}) {
  root = path.resolve(root);
  const outputs = path.join(root, 'outputs');
  const target = path.join(outputs, '2026-10-15-Telegram聊天预览');
  const maintenance = path.join(outputs, 'desktop-maintenance');
  const lockPath = path.join(maintenance, 'maintenance.lock');
  const activePath = path.join(maintenance, 'active-operation.json');
  const stamp = () =>
    new Date(now()).toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomUUID().slice(0, 8);

  async function tree(directory, prefix = '') {
    await plainPath(root, directory);
    const files = [];
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      const file = inside(directory, entry.name);
      if (entry.isSymbolicLink()) fail('程序包不能包含符号链接：' + relative);
      if (entry.isDirectory()) files.push(...(await tree(file, relative + '/')));
      else if (entry.isFile()) {
        const bytes = await fs.readFile(file);
        files.push({ file: relative, bytes: bytes.length, sha256: digest(bytes) });
      } else fail('程序包不能包含特殊文件：' + relative);
    }
    return files;
  }
  async function programFiles(directory) {
    const files = [];
    for (const name of SUPPORT) {
      const file = inside(directory, name);
      await plainPath(root, file);
      if (await exists(file)) {
        if (!(await fs.stat(file)).isFile()) fail('程序文件不是普通文件：' + file);
        const bytes = await fs.readFile(file);
        files.push({ file: name, bytes: bytes.length, sha256: digest(bytes) });
      }
    }
    if (await exists(path.join(directory, 'app')))
      files.push(
        ...(await tree(path.join(directory, 'app'))).map((entry) => ({
          ...entry,
          file: 'app/' + entry.file,
        })),
      );
    return files;
  }
  async function validateSnapshot(directory, manifest) {
    if (manifest.protocol !== PROTOCOL || !Array.isArray(manifest.files))
      fail('无法识别的程序快照');
    const names = new Set();
    for (const entry of manifest.files) {
      const name = relativeFile(entry.file);
      if (names.has(name.toLowerCase())) fail('安装包含重复文件：' + name);
      names.add(name.toLowerCase());
      const source = inside(directory, name);
      await plainPath(root, source);
      if (digest(await fs.readFile(source)) !== entry.sha256) fail('SHA-256 校验失败：' + name);
    }
    if (!names.has(CHAT.toLowerCase()) || !names.has('app/index.html'))
      fail('缺少聊天宿主或页面入口');
  }
  async function snapshot(source, destination, metadata) {
    await plainPath(root, source);
    const files = await programFiles(source);
    const manifest = {
      protocol: PROTOCOL,
      root,
      createdAtUtc: new Date(now()).toISOString(),
      ...metadata,
      files,
    };
    await fs.mkdir(destination, { recursive: true });
    for (const entry of files) {
      const out = inside(destination, entry.file);
      await plainPath(root, out);
      await fs.mkdir(path.dirname(out), { recursive: true });
      await fs.copyFile(inside(source, entry.file), out, fs.constants.COPYFILE_EXCL);
    }
    await validateSnapshot(destination, manifest);
    await writeJSON(path.join(destination, 'manifest.json'), manifest);
    return manifest;
  }
  async function candidate(from) {
    const source = inside(outputs, path.resolve(root, from));
    await plainPath(root, source);
    if (source === target || source.startsWith(maintenance + path.sep))
      fail('候选包不能是当前安装目录或维护备份');
    const metadata = await readJSON(path.join(source, 'UPSTREAM.json'));
    if (typeof metadata.uiRevision !== 'string' || !/^[\w.-]{1,128}$/.test(metadata.uiRevision))
      fail('候选缺少有效 uiRevision');
    const proofFile = path.join(
      path.dirname(source),
      'delivery-manifest-' + metadata.uiRevision.split('-').at(-1) + '.json',
    );
    const proof = await readJSON(proofFile);
    if (
      proof.revision !== metadata.uiRevision ||
      !Number.isInteger(proof.checks?.chat) ||
      proof.checks.chat < 1 ||
      !Number.isInteger(proof.checks?.image) ||
      proof.checks.image < 1 ||
      !Array.isArray(proof.files)
    )
      fail('候选缺少隔离 UI 验收记录');
    const prefix = path.basename(source) + '/';
    for (const entry of proof.files.filter((entry) => entry.file.startsWith(prefix))) {
      const file = inside(source, entry.file.slice(prefix.length));
      await plainPath(root, file);
      if (digest(await fs.readFile(file)) !== entry.sha256)
        fail('候选交付清单不匹配：' + entry.file);
    }
    if (!proof.files.some((entry) => entry.file === prefix + CHAT)) fail('候选清单没有宿主哈希');
    if (!proof.files.some((entry) => entry.file === prefix + 'app/index.html'))
      fail('候选清单没有页面哈希');
    return {
      source,
      revision: metadata.uiRevision,
      version: metadata.appVersion,
      checks: proof.checks,
    };
  }
  async function exclusive(work) {
    await plainPath(root, maintenance);
    await fs.mkdir(maintenance, { recursive: true });
    const nonce = crypto.randomUUID();
    let lock;
    try {
      lock = await fs.open(lockPath, 'wx');
    } catch (error) {
      if (error.code === 'EEXIST')
        fail('另一个维护任务或未恢复的维护锁存在；先查看 status，不同时执行升级');
      throw error;
    }
    try {
      await lock.writeFile(
        json({
          protocol: PROTOCOL,
          root,
          pid: process.pid,
          nonce,
          createdAtUtc: new Date(now()).toISOString(),
        }),
      );
      return await work();
    } finally {
      await lock.close();
      let owner;
      try {
        owner = await readJSON(lockPath);
      } catch {
        /* Preserve an incomplete lock for inspection. */
      }
      if (owner?.nonce === nonce) await fs.unlink(lockPath);
    }
  }
  async function processes() {
    return runtime.processes();
  }
  async function stop() {
    if (runtime.conflicts && (await runtime.conflicts()).length)
      fail('另一个目录的普通拾页后台或聊天仍在运行；请先核对归属，维护未发送退出请求');
    const before = await processes();
    if (!before.length) return { stopped: true, alreadyStopped: true };
    // Existing broker exit waits for each WebView save approval, including chat.
    if (
      !before.some(
        (p) =>
          path.resolve(p.executablePath).toLowerCase() ===
          path.join(root, '拾页快捷记录.exe').toLowerCase(),
      )
    )
      fail('聊天仍在运行但统一后台不存在；请正常保存退出聊天后重试，不强制结束进程');
    await runtime.requestStop();
    const deadline = now() + timeoutMs;
    while ((await processes()).length) {
      if (now() >= deadline)
        fail('保存退出未完成，取消维护；未替换程序文件。请保留窗口处理保存提示');
      await pause(100);
    }
    return { stopped: true, pids: before.map((p) => p.pid) };
  }
  async function start() {
    if (runtime.conflicts && (await runtime.conflicts()).length)
      fail('另一个目录的普通拾页仍在运行，未启动重复后台');
    await plainPath(root, path.join(root, '拾页快捷记录.exe'));
    await plainPath(root, path.join(target, CHAT));
    await runtime.start();
    const deadline = now() + timeoutMs;
    while (true) {
      const current = await processes();
      const readiness = runtime.readiness
        ? await runtime.readiness(current)
        : { ready: true, verification: 'processes-only' };
      if (
        current.some(
          (p) =>
            path.resolve(p.executablePath).toLowerCase() === path.join(target, CHAT).toLowerCase(),
        ) &&
        current.some(
          (p) =>
            path.resolve(p.executablePath).toLowerCase() ===
            path.join(root, '拾页快捷记录.exe').toLowerCase(),
        ) &&
        readiness.ready
      )
        return { started: true, processes: current, readiness };
      if (now() >= deadline) fail('新版未在限时内出现聊天和托盘进程；程序备份已保留');
      await pause(100);
    }
  }
  async function apply(source, manifest) {
    await validateSnapshot(source, manifest);
    // No directory removal: old hashed assets remain available for rollback.
    // Replace the EXE first so a file lock aborts before any page is overwritten.
    const ordered = [...manifest.files].sort((a, b) =>
      a.file === CHAT ? -1 : b.file === CHAT ? 1 : 0,
    );
    for (const entry of ordered) {
      const destination = inside(target, entry.file);
      await plainPath(root, destination);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      if ((await exists(destination)) && digest(await fs.readFile(destination)) === entry.sha256)
        continue;
      await fs.copyFile(inside(source, entry.file), destination);
      if (digest(await fs.readFile(destination)) !== entry.sha256)
        fail('安装后文件校验失败：' + entry.file);
    }
  }
  async function savePreferences(backup) {
    const configFile = path.join(root, 'config', 'deployment.local.json');
    if (!(await exists(configFile))) return;
    const config = await readJSON(configFile);
    if (!path.isAbsolute(config.stateDirectory || '')) fail('正式状态目录不是绝对路径');
    const saved = [];
    for (const name of [
      'quick-host.json',
      'quick-window.json',
      'telegram-chat-preview/window.json',
      'telegram-chat-preview/image-window.json',
    ]) {
      const file = inside(config.stateDirectory, name);
      if (!(await exists(file))) continue;
      await plainPath(path.resolve(config.stateDirectory), file);
      const bytes = await fs.readFile(file);
      const out = inside(backup, 'preferences/' + name);
      await fs.mkdir(path.dirname(out), { recursive: true });
      await fs.writeFile(out, bytes, { flag: 'wx' });
      saved.push({ file: name, sha256: digest(bytes) });
    }
    await writeJSON(path.join(backup, 'preferences-manifest.json'), {
      stateDirectory: config.stateDirectory,
      files: saved,
      rollback: 'program only; never restore or overwrite user data/preferences',
    });
  }
  async function install(source, metadata, { dryRun = false, noStart = false } = {}) {
    if (dryRun)
      return {
        dryRun: true,
        source,
        target,
        revision: metadata.revision,
        version: metadata.version,
        running: await processes(),
        writes: false,
      };
    return exclusive(async () => {
      await plainPath(root, target);
      const id = stamp();
      const release = path.join(maintenance, 'releases', id);
      const sealed = await snapshot(source, release, metadata);
      const operation = {
        protocol: PROTOCOL,
        id,
        root,
        target,
        release,
        source,
        revision: metadata.revision,
        phase: 'prepared',
        createdAtUtc: new Date(now()).toISOString(),
      };
      async function phase(value) {
        operation.phase = value;
        await writeJSON(activePath, operation);
        await writeJSON(path.join(maintenance, 'operations', id + '.json'), operation);
        await onPhase(value, operation);
      }
      let backupManifest;
      let failedAction = 'stopping';
      let lastSuccessfulPhase = 'prepared';
      await phase('prepared');
      try {
        const stopped = await stop();
        operation.saveDisposition = stopped.alreadyStopped ? 'already-stopped' : 'save-requested';
        lastSuccessfulPhase = 'stopped';
        await phase('stopped');
        failedAction = 'backing-up';
        const backup = (operation.backup = path.join(maintenance, 'backups', id));
        backupManifest = await snapshot(target, backup, {
          revision:
            (await readJSON(path.join(target, 'UPSTREAM.json'))).uiRevision || 'legacy-unreported',
          version: (await readJSON(path.join(target, 'UPSTREAM.json'))).appVersion,
        });
        await savePreferences(backup);
        lastSuccessfulPhase = 'backed-up';
        await phase('backed-up');
        failedAction = 'checking-stopped-state';
        if ((await processes()).length) fail('备份时又有窗口启动，取消替换');
        failedAction = 'installing';
        await phase('applying');
        await apply(release, sealed);
        lastSuccessfulPhase = 'installed';
        await phase('installed');
        if (!noStart) {
          failedAction = 'starting';
          await start();
          lastSuccessfulPhase = 'started';
          await phase('started');
        }
        failedAction = 'finalizing';
        await phase('complete');
        return {
          installed: true,
          revision: metadata.revision,
          backup,
          restarted: !noStart,
          operation: id,
        };
      } catch (error) {
        operation.error = error.message;
        operation.failedPhase = failedAction;
        operation.lastSuccessfulPhase = lastSuccessfulPhase;
        // Never overwrite program files if an editor still owns them.
        if (
          backupManifest &&
          ['applying', 'installed', 'started'].includes(operation.phase) &&
          !(await processes()).length
        ) {
          try {
            await apply(operation.backup, backupManifest);
            operation.rolledBack = true;
          } catch (rollbackError) {
            operation.rollbackError = rollbackError.message;
          }
        }
        operation.nextAction = {
          command: 'doctor',
          args: [],
          automaticAllowed: false,
          reason: operation.rollbackError
            ? '程序恢复失败；保留现场，核对操作记录、备份和实际程序哈希后决定恢复'
            : '先核对失败动作、运行进程、封存包和备份；不自动重装或覆盖数据',
        };
        await phase('failed');
        const failure = new Error(
          error.message + (operation.backup ? '；备份：' + operation.backup : ''),
          {
            cause: error,
          },
        );
        failure.diagnostics = {
          operation: id,
          failedPhase: operation.failedPhase,
          lastSuccessfulPhase: operation.lastSuccessfulPhase,
          backup: operation.backup || null,
          nextAction: operation.nextAction,
        };
        throw failure;
      }
    });
  }
  return {
    async status() {
      const read = async (file) => ((await exists(file)) ? readJSON(file) : null);
      const current = await processes();
      return {
        root,
        target,
        installed: await read(path.join(target, 'UPSTREAM.json')).then((p) =>
          p ? { version: p.appVersion, revision: p.uiRevision || 'legacy-unreported' } : null,
        ),
        processes: current,
        foreignWindows: runtime.conflicts ? await runtime.conflicts() : [],
        readiness: runtime.readiness ? await runtime.readiness(current) : null,
        api: await runtime.health(),
        maintenanceLock: await read(lockPath),
        lastOperation: await read(activePath),
      };
    },
    async doctor() {
      let status;
      try {
        status = await this.status();
      } catch (error) {
        return {
          ok: false,
          readOnly: true,
          status: null,
          saveDisposition: 'unknown',
          issues: [{ code: 'unreadable-state', level: 'error', message: error.message }],
          nextAction: {
            command: null,
            args: [],
            automaticAllowed: false,
            reason: '状态或记录无法读取；保留原文件并核对，不能推断已退出或自动恢复',
          },
        };
      }
      const issues = [];
      const stopped = status.processes.length === 0;
      const roles = status.processes.map((item) => path.basename(item.executablePath));
      let nextAction = {
        command: stopped ? 'start' : 'status',
        args: [],
        automaticAllowed: true,
        reason: stopped
          ? '当前聊天和托盘已退出；如需恢复当前安装版，可执行 start'
          : roles.includes(CHAT)
            ? '当前进程已就绪'
            : '托盘正常驻留、聊天窗口已关闭；维护时可通过托盘保存退出',
      };
      if (!status.installed)
        issues.push({
          code: 'missing-installation',
          level: 'error',
          message: '未找到当前安装元数据',
        });
      if (!stopped && !roles.includes(CHAT))
        issues.push({
          code: 'missing-chat',
          level: 'warning',
          message: '托盘后台运行、聊天窗口已关闭；这是正常状态，维护时通过托盘保存退出',
        });
      if (!stopped && !roles.includes('拾页快捷记录.exe'))
        issues.push({
          code: 'missing-broker',
          level: 'error',
          message: '聊天仍在运行但统一后台不存在；须正常保存退出，不能强杀',
        });
      if (roles.includes(CHAT) && !status.readiness?.ready)
        issues.push({
          code: 'not-ready',
          level: 'error',
          message: '已有进程尚未报告匹配的运行版本；不要重复启动',
        });
      if (status.foreignWindows.length)
        issues.push({
          code: 'foreign-processes',
          level: 'error',
          message: '其他目录的普通拾页进程仍在运行；先核对归属',
        });
      if (status.lastOperation?.phase === 'failed')
        issues.push({
          code: 'failed-operation',
          level: 'error',
          message: '最近维护失败；须先核对操作记录和程序状态',
        });
      if (status.maintenanceLock) {
        const owner = status.maintenanceLock;
        const valid =
          owner.protocol === PROTOCOL &&
          owner.root === root &&
          Number.isInteger(owner.pid) &&
          owner.pid > 0;
        const alive = valid && isProcessAlive(owner.pid);
        issues.push({
          code: !valid ? 'invalid-lock' : alive ? 'active-lock' : 'stale-lock',
          level: 'error',
          message: !valid
            ? '维护锁身份无效；保留原文件'
            : alive
              ? '维护任务仍在执行；等待其完成'
              : '维护锁持有进程已退出；可核对后归档死锁',
        });
        if (valid && !alive && issues.length === 1)
          nextAction = {
            command: 'recover-lock',
            args: [],
            automaticAllowed: true,
            reason: '仅归档已确认死亡的本项目维护锁；不会继续安装',
          };
      }
      if (!status.api?.reachable)
        issues.push({
          code: 'api-unreachable',
          level: 'warning',
          message: '日记 API 暂不可达；桌面维护不负责重启 API',
        });
      const blocking = issues.filter((issue) => issue.level === 'error');
      if (blocking.length && !(blocking.length === 1 && blocking[0].code === 'stale-lock'))
        nextAction = {
          command: 'status',
          args: [],
          automaticAllowed: false,
          reason: '存在阻塞；先核对诊断和操作记录，不自动启动、恢复或安装',
        };
      return {
        ok: blocking.length === 0,
        readOnly: true,
        scope: '聊天与托盘；API 仅查询，不构建、不部署、不启动或停止',
        saveDisposition: stopped
          ? 'already-stopped'
          : roles.includes('拾页快捷记录.exe')
            ? 'save-required-if-stopping'
            : 'blocked-without-broker',
        status,
        issues,
        nextAction,
      };
    },
    stop: () => exclusive(stop),
    start: () => exclusive(start),
    restart: () =>
      exclusive(async () => {
        await stop();
        return start();
      }),
    async recoverLock() {
      await plainPath(root, lockPath);
      const bytes = await fs.readFile(lockPath);
      const owner = JSON.parse(bytes);
      if (
        owner.protocol !== PROTOCOL ||
        owner.root !== root ||
        !Number.isInteger(owner.pid) ||
        owner.pid <= 0
      )
        fail('维护锁身份无效，保留原文件');
      if (isProcessAlive(owner.pid)) fail('锁的持有进程仍在运行，不能解除');
      const archived = inside(maintenance, 'abandoned-lock-' + stamp() + '.json');
      await plainPath(root, archived);
      if (digest(await fs.readFile(lockPath)) !== digest(bytes)) fail('维护锁在核对期间发生变化');
      await fs.rename(lockPath, archived);
      if (digest(await fs.readFile(archived)) !== digest(bytes)) fail('维护锁归档校验失败');
      return {
        recovered: true,
        archived,
        sha256: digest(bytes),
        note: '请查看 status 的 lastOperation，再决定回滚或继续；未替换任何程序',
      };
    },
    async upgrade(from, options) {
      const ready = await candidate(from);
      return install(ready.source, { revision: ready.revision, version: ready.version }, options);
    },
    async rollback(from, options) {
      const source = inside(path.join(maintenance, 'backups'), path.resolve(root, from));
      await plainPath(root, source);
      const manifest = await readJSON(path.join(source, 'manifest.json'));
      if (manifest.root !== root) fail('快照属于另一个项目');
      await validateSnapshot(source, manifest);
      return install(source, { revision: manifest.revision, version: manifest.version }, options);
    },
  };
}
