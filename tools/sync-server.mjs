import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';
import { mkdir, open, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { createSyncServer, localSyncAddresses } from '../src/server/sync-v2/server.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const failure = (code) => Object.assign(new Error(code), { code });
export const SYNC_SERVER_USAGE =
  'node tools/sync-server.mjs [--host 127.0.0.1] [--port 18769] [--data-dir var/sync-lab] [--base-path /] [--public-origin https://example.invalid] [--allowed-host host]';

export function parseSyncServerArguments(args, { root = ROOT } = {}) {
  const options = {
    host: '127.0.0.1',
    port: 18769,
    dataDir: path.join(root, 'var', 'sync-lab'),
    basePath: '/',
    allowedHosts: [],
  };
  const known = new Set([
    '--host',
    '--port',
    '--data-dir',
    '--base-path',
    '--public-origin',
    '--allowed-host',
  ]);
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (name === '--help' && args.length === 1) return { help: true };
    if (!known.has(name)) throw failure('UNKNOWN_ARGUMENT');
    const value = args[++i];
    if (!value || value.startsWith('--')) throw failure('MISSING_ARGUMENT_VALUE');
    if (seen.has(name) && name !== '--allowed-host') throw failure('DUPLICATE_ARGUMENT');
    seen.add(name);
    if (name === '--host') {
      if (!isIP(value) && value !== 'localhost') throw failure('INVALID_LISTEN_HOST');
      options.host = value;
    }
    if (name === '--port') {
      if (!/^\d{1,5}$/u.test(value) || Number(value) > 65535) throw failure('INVALID_PORT');
      options.port = Number(value);
    }
    if (name === '--data-dir') {
      if (/[\x00-\x1f]/u.test(value) || /\.json$/iu.test(value))
        throw failure('INVALID_DATA_DIRECTORY');
      options.dataDir = path.resolve(root, value);
    }
    if (name === '--base-path') {
      if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/u.test(value)) throw failure('INVALID_BASE_PATH');
      options.basePath = value;
    }
    if (name === '--public-origin') {
      let url;
      try {
        url = new URL(value);
      } catch {
        throw failure('INVALID_PUBLIC_ORIGIN');
      }
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== '/' ||
        /[?#\\\s]/u.test(value)
      )
        throw failure('INVALID_PUBLIC_ORIGIN');
      options.publicOrigin = url.origin;
    }
    if (name === '--allowed-host') {
      let url;
      try {
        url = new URL(`http://${value}`);
      } catch {
        throw failure('INVALID_ALLOWED_HOST');
      }
      if (
        !value ||
        /[\s\\/?#@]/u.test(value) ||
        url.username ||
        url.password ||
        url.port ||
        url.host !== value.toLowerCase()
      )
        throw failure('INVALID_ALLOWED_HOST');
      options.allowedHosts.push(url.hostname);
    }
  }
  return options;
}

async function validateDataDirectory(dataDir) {
  if (typeof dataDir !== 'string' || !path.isAbsolute(dataDir))
    throw failure('EXPLICIT_DATA_DIRECTORY_REQUIRED');
  const resolved = path.resolve(dataDir);
  const forbidden = [
    path.parse(resolved).root,
    ROOT,
    path.join(ROOT, 'data'),
    path.join(ROOT, 'var', 'dev-data'),
    process.env.USERPROFILE,
  ]
    .filter(Boolean)
    .map((value) => path.resolve(value).toLowerCase());
  if (forbidden.includes(resolved.toLowerCase())) throw failure('UNSAFE_DATA_DIRECTORY');
  let existing = resolved;
  for (;;) {
    try {
      const info = await stat(existing);
      if (!info.isDirectory()) throw failure('INVALID_DATA_DIRECTORY');
      const physical = await realpath(existing);
      if (forbidden.includes(physical.toLowerCase()) && existing === resolved)
        throw failure('UNSAFE_DATA_DIRECTORY');
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = path.dirname(existing);
      if (parent === existing) throw failure('INVALID_DATA_DIRECTORY');
      existing = parent;
    }
  }
  // Reject descendants of a live diary directory as well as the directory itself.
  for (const startingPoint of new Set([existing, await realpath(existing)])) {
    let ancestor = startingPoint;
    for (;;) {
      try {
        await stat(path.join(ancestor, 'diary.json'));
        throw failure('DIARY_DIRECTORY_REFUSED');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      const parent = path.dirname(ancestor);
      if (parent === ancestor) break;
      ancestor = parent;
    }
  }
  await mkdir(resolved, { recursive: true });
  // Recheck after creation and resolve junctions before opening any database files.
  const physical = await realpath(resolved);
  if (forbidden.includes(physical.toLowerCase())) throw failure('UNSAFE_DATA_DIRECTORY');
  return physical;
}

export async function startSyncServerCli(
  options,
  { log = (record) => console.log(JSON.stringify(record)) } = {},
) {
  const dataDir = await validateDataDirectory(options.dataDir);
  const lockPath = path.join(dataDir, 'sync-server.lock');
  let lock;
  try {
    lock = await open(lockPath, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') throw failure('SYNC_DIRECTORY_ALREADY_LOCKED');
    throw error;
  }
  let service,
    runtime,
    stopped = null;
  const runtimePath = path.join(dataDir, 'runtime.json');
  async function writeRuntime() {
    const temporary = path.join(dataDir, `.runtime-${process.pid}.tmp`);
    await writeFile(temporary, `${JSON.stringify(runtime, null, 2)}\n`, 'utf8');
    await rename(temporary, runtimePath);
  }
  async function release() {
    await lock.close();
    await unlink(lockPath);
  }
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    service = await createSyncServer({
      dataDir,
      basePath: options.basePath,
      publicOrigin: options.publicOrigin,
      allowedHosts: options.allowedHosts,
      extensionFactory: options.extensionFactory,
    });
    await options.beforeListen?.(service);
    await new Promise((resolve, reject) => {
      const fail = (error) => reject(error);
      service.server.once('error', fail);
      service.server.listen(options.port, options.host, () => {
        service.server.off('error', fail);
        resolve();
      });
    });
    const port = service.server.address().port;
    const host = options.host.includes(':') ? `[${options.host}]` : options.host;
    const addresses =
      options.host === '0.0.0.0' || options.host === '::'
        ? localSyncAddresses(port, service.basePath)
        : [`http://${host}:${port}${service.basePath}`];
    if (options.publicOrigin) addresses.push(`${options.publicOrigin}${service.basePath}`);
    runtime = {
      service: 'shiye-sync',
      protocol: 1,
      state: 'running',
      pid: process.pid,
      port,
      host: options.host,
      basePath: service.basePath,
      startedAt: new Date().toISOString(),
      addresses: [...new Set(addresses)],
    };
    await writeRuntime();
    log({ service: runtime.service, protocol: 1, state: 'running', addresses: runtime.addresses });
    return {
      service,
      runtime: structuredClone(runtime),
      stop() {
        if (stopped) return stopped;
        stopped = (async () => {
          try {
            await service.close();
          } finally {
            runtime.state = 'stopped';
            runtime.stoppedAt = new Date().toISOString();
            try {
              await writeRuntime();
            } finally {
              await release();
            }
          }
          log({ service: runtime.service, protocol: 1, state: 'stopped' });
        })();
        return stopped;
      },
    };
  } catch (error) {
    await service?.close().catch(() => {});
    await release().catch(() => {});
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseSyncServerArguments(process.argv.slice(2));
    if (options.help) console.log(SYNC_SERVER_USAGE);
    else {
      const started = await startSyncServerCli(options);
      let stopping = false;
      const stop = () => {
        if (stopping) return;
        stopping = true;
        void started.stop().catch(() => {
          console.error('SYNC_STOP_FAILED');
          process.exitCode = 1;
        });
      };
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
    }
  } catch (error) {
    const code = /^[A-Z0-9_]{1,80}$/u.test(error.code || '') ? error.code : 'SYNC_START_FAILED';
    console.error(code);
    process.exitCode = 1;
  }
}
