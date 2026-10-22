import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
export function windowsDesktopRuntime(root) {
  const chat = path.join(root, 'outputs', '2026-10-15-Telegram聊天预览', '拾页对话预览.exe');
  const broker = path.join(root, '拾页快捷记录.exe');
  const options = { cwd: root, windowsHide: true, maxBuffer: 1024 * 1024 };
  let lastInventory,
    inventoryAt = 0;
  async function inventory() {
    if (process.platform !== 'win32') throw Error('桌面维护仅支持 Windows');
    if (lastInventory && Date.now() - inventoryAt < 250) return lastInventory;
    // No user-supplied shell source: paths are passed through environment variables.
    const command = `[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false); Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and ($_.Name -eq '拾页对话预览.exe' -or $_.Name -eq '拾页快捷记录.exe') -and $_.CommandLine -notmatch '--verify|--bridge-test|--host-test' } | ForEach-Object { [pscustomobject]@{ pid=$_.ProcessId; executablePath=$_.ExecutablePath; sessionId=$_.SessionId; createdAtUtc=$_.CreationDate.ToUniversalTime().ToString('o') } } | ConvertTo-Json -Compress`;
    const { stdout } = await execute(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(command, 'utf16le').toString('base64'),
      ],
      {
        ...options,
        timeout: 10000,
        env: { ...process.env, SHIYE_CONTROL_CHAT: chat, SHIYE_CONTROL_BROKER: broker },
      },
    );
    const result = stdout.trim() ? JSON.parse(stdout.replace(/^\uFEFF/, '')) : [];
    lastInventory = Array.isArray(result) ? result : [result];
    inventoryAt = Date.now();
    return lastInventory;
  }
  const owned = (item) =>
    [chat.toLowerCase(), broker.toLowerCase()].includes(item.executablePath.toLowerCase());
  async function processes() {
    return (await inventory()).filter(owned);
  }
  async function readiness(current) {
    let installed;
    try {
      installed = JSON.parse(
        await fs.readFile(path.join(path.dirname(chat), 'UPSTREAM.json'), 'utf8'),
      );
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (!installed?.desktopControlProtocol)
      return {
        ready: current.some((p) => p.executablePath.toLowerCase() === chat.toLowerCase()),
        verification: 'processes-only',
        runningRevision: null,
      };
    const config = JSON.parse(
      await fs.readFile(path.join(root, 'config', 'deployment.local.json'), 'utf8'),
    );
    try {
      const receipt = JSON.parse(
        await fs.readFile(
          path.join(config.stateDirectory, 'telegram-chat-preview', 'runtime-status.json'),
          'utf8',
        ),
      );
      const running = current.find(
        (item) =>
          item.pid === receipt.pid &&
          path.resolve(item.executablePath).toLowerCase() === chat.toLowerCase(),
      );
      const fresh =
        receipt.protocol === 1 &&
        receipt.executable?.toLowerCase() === chat.toLowerCase() &&
        running &&
        Date.parse(receipt.atUtc) >= Date.parse(running.createdAtUtc);
      return {
        ready: Boolean(fresh && receipt.ready && receipt.uiRevision === installed.uiRevision),
        verification: 'native-runtime-receipt',
        runningRevision: fresh && receipt.ready ? receipt.uiRevision : null,
        receipt: fresh ? receipt : null,
      };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return { ready: false, verification: 'native-runtime-receipt', runningRevision: null };
    }
  }
  return {
    processes,
    conflicts: async () => (await inventory()).filter((item) => !owned(item)),
    readiness,
    async requestStop() {
      await execute(broker, ['--exit-host'], { ...options, timeout: 10000 });
    },
    async start() {
      for (const [file, args] of [
        [broker, ['--resident']],
        [chat, []],
      ]) {
        const child = spawn(file, args, { ...options, detached: true, stdio: 'ignore' });
        await new Promise((resolve, reject) => {
          child.once('spawn', resolve);
          child.once('error', reject);
        });
        child.unref();
      }
    },
    async health() {
      try {
        const config = JSON.parse(await fs.readFile(path.join(root, 'config', 'app.json'), 'utf8'));
        const response = await fetch(`http://127.0.0.1:${config.port}/api/health`, {
          signal: AbortSignal.timeout(1500),
        });
        const value = await response.json();
        return { reachable: response.ok, ...value };
      } catch {
        return { reachable: false };
      }
    },
  };
}
