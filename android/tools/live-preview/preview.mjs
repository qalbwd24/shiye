import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, open } from 'node:fs/promises';
import { watchFile, unwatchFile } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import {
  Cdp,
  SOURCES,
  EXTRA_SOURCES,
  hash,
  pageKind,
  endpoint,
  variables,
  variableControl,
  checkedOverrides,
  previewCss,
  layeredPreviewCss,
  replaceVariables,
  injectionExpression,
  hasOwnedForward,
} from './core.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const run = promisify(execFile);
function options(args) {
  const result = { package: 'dev.shiye.app', port: 0, adb: process.env.ADB ?? 'adb', once: false };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--help') {
      result.help = true;
      continue;
    }
    if (flag === '--once') {
      result.once = true;
      continue;
    }
    if (
      !['--serial', '--package', '--port', '--adb'].includes(flag) ||
      !args[i + 1] ||
      args[i + 1].startsWith('--')
    )
      throw Error(`Unknown/incomplete argument: ${flag}`);
    result[flag.slice(2)] = args[++i];
  }
  if (result.help) return result;
  if (!result.serial || !/^[\w.:-]+$/.test(result.serial))
    throw Error('--serial is required (no implicit device selection)');
  if (!/^[a-zA-Z]\w*(\.\w+)+$/.test(result.package)) throw Error('Invalid package name');
  result.port = Number(result.port);
  if (!Number.isInteger(result.port) || result.port < 0 || result.port > 65535)
    throw Error('--port must be 0..65535');
  return result;
}
const help = `Android WebView live CSS preview (Node >=22.13)\nUsage: node android/tools/live-preview/preview.mjs --serial emulator-5554 [--adb PATH] [--package dev.shiye.app] [--port 0] [--once]\nDefault: watch allowlisted CSS and reconnect, local control page on 127.0.0.1 random port.\n--once: read-only discover/debuggable check; does not inject or start a server.\nOpen the app/page manually. No reload, process launch/kill, database access or preference changes.\nCtrl+C removes owned styles/forwards. Native screens/system bars still require a build.\n`;
let config;
try {
  config = options(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
if (config.help) {
  console.log(help);
  process.exit(0);
}
const adb = async (...args) =>
  (
    await run(config.adb, ['-s', config.serial, ...args], {
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
    })
  ).stdout.trim();
const owner = randomBytes(24).toString('hex');
const sources = {};
const forwards = new Map();
const sessions = new Map();
let enabled = true,
  stopping = false,
  busy = false,
  dirty = true,
  server,
  interval,
  debounce;
let status = {
  state: 'starting',
  serial: config.serial,
  package: config.package,
  pages: [],
  errors: [],
};
async function loadSources() {
  for (const [kind, path] of Object.entries(SOURCES)) {
    const css = await readFile(resolve(root, path), 'utf8');
    const overlayPath = EXTRA_SOURCES[kind];
    const overlayCss = overlayPath ? await readFile(resolve(root, overlayPath), 'utf8') : '';
    const previous = sources[kind];
    sources[kind] = {
      path,
      css,
      hash: hash(css),
      overlayPath,
      overlayCss,
      overlayHash: hash(overlayCss),
      values: variables(css),
      overrides: previous?.hash === hash(css) ? previous.overrides : {},
    };
  }
}
async function removeForward(pid) {
  const port = forwards.get(pid);
  if (!port) return;
  // A selected-device reconnect/reboot removes its listeners. Forget stale
  // ownership instead of blocking discovery, and do not remove a reused port.
  if (hasOwnedForward(await adb('forward', '--list'), config.serial, pid, port))
    await adb('forward', '--remove', `tcp:${port}`);
  forwards.delete(pid);
}
async function apply(session) {
  const source = sources[session.kind];
  const css =
    session.kind === 'editor'
      ? layeredPreviewCss(source.css, source.overlayCss, source.overrides)
      : previewCss(source.css, source.overrides);
  const shadowCss = session.kind === 'chat' ? source.overlayCss : '';
  const sourceHash = hash(css + shadowCss);
  const result = await session.cdp.evaluate(
    injectionExpression({ kind: session.kind, css, shadowCss, owner, sourceHash, enabled }),
  );
  session.injectedHash = enabled ? sourceHash : null;
  session.sourceHash = hash(source.css + source.overlayCss);
  session.error = null;
  return result;
}
async function discover() {
  // run-as rejects non-debuggable packages; read-only id never reads app files.
  const identity = await adb('shell', 'run-as', config.package, 'id');
  if (!/uid=\d+/.test(identity)) throw Error('Package is not debuggable (run-as refused)');
  const pids = (await adb('shell', 'pidof', config.package))
    .split(/\s+/)
    .filter((pid) => /^\d+$/.test(pid));
  if (!pids.length) throw Error('Package not running; open it manually');
  const sockets = await adb('shell', 'cat', '/proc/net/unix');
  const found = [];
  for (const pid of pids) {
    const socket = `webview_devtools_remote_${pid}`;
    if (!sockets.split('\n').some((line) => line.trim().endsWith(`@${socket}`))) continue;
    if (!forwards.has(pid)) {
      const port = await adb('forward', 'tcp:0', `localabstract:${socket}`);
      if (!/^\d+$/.test(port)) throw Error('ADB did not allocate a forward port');
      forwards.set(pid, port);
    }
    const port = forwards.get(pid);
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw Error('DevTools page list unavailable');
    for (const page of await response.json()) {
      const kind = pageKind(page.url);
      if (!kind || page.type !== 'page') continue;
      found.push({
        key: `${pid}:${page.id}`,
        pid,
        kind,
        path: new URL(page.url).pathname,
        websocket: endpoint(page.webSocketDebuggerUrl, port),
      });
    }
  }
  for (const pid of forwards.keys()) if (!pids.includes(pid)) await removeForward(pid);
  return found;
}
async function tick() {
  if (busy || stopping) return;
  busy = true;
  try {
    if (dirty) {
      await loadSources();
      dirty = false;
    }
    const pages = await discover();
    const keys = new Set(pages.map((p) => p.key));
    for (const [key, session] of sessions)
      if (!keys.has(key)) {
        session.cdp.close();
        sessions.delete(key);
      }
    for (const page of pages) {
      let session = sessions.get(page.key);
      try {
        if (!session) {
          session = { ...page, cdp: await Cdp.connect(page.websocket) };
          sessions.set(page.key, session);
        }
        // Reapply also detects rebuilt documents, without touching app lifecycle or contents.
        await apply(session);
      } catch (error) {
        if (session) {
          session.cdp.close();
          sessions.delete(page.key);
        }
        page.error = error.message;
      }
    }
    status = {
      ...status,
      state: pages.length
        ? pages.some((p) => p.error)
          ? 'error'
          : enabled
            ? 'previewing'
            : 'disabled'
        : 'waiting-page',
      errors: pages.filter((p) => p.error).map((p) => p.error),
    };
  } catch (error) {
    status = { ...status, state: 'waiting', errors: [error.message] };
  } finally {
    status.pages = [...sessions.values()].map(({ key, kind, path, sourceHash, injectedHash }) => ({
      key,
      kind,
      path,
      sourceHash,
      injectedHash,
    }));
    busy = false;
  }
}
function snapshot() {
  return {
    ...status,
    enabled,
    sources: Object.fromEntries(
      Object.entries(sources).map(([kind, s]) => [
        kind,
        {
          path: s.path,
          hash: s.hash,
          overlayPath: s.overlayPath,
          overlayHash: s.overlayHash,
          variables: s.values,
          overrides: s.overrides,
          controls: Object.fromEntries(
            Object.keys(s.values).map((name) => [name, variableControl(name)]),
          ),
        },
      ]),
    ),
  };
}
async function body(req) {
  let value = '';
  for await (const chunk of req) {
    value += chunk;
    if (value.length > 16000) throw Error('Request too large');
  }
  return JSON.parse(value || '{}');
}
function json(res, code, value) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}
async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearInterval(interval);
  clearTimeout(debounce);
  for (const path of [...Object.values(SOURCES), ...Object.values(EXTRA_SOURCES)])
    unwatchFile(resolve(root, path));
  while (busy) await new Promise((r) => setTimeout(r, 50));
  const failures = [];
  for (const session of sessions.values()) {
    try {
      await session.cdp.evaluate(
        injectionExpression({ kind: session.kind, css: '', owner, sourceHash: '', enabled: false }),
      );
    } catch (error) {
      failures.push(`Style cleanup ${session.kind}: ${error.message}`);
    }
    session.cdp.close();
  }
  for (const pid of [...forwards.keys()]) {
    try {
      await removeForward(pid);
    } catch (error) {
      failures.push(`Forward cleanup: ${error.message}`);
    }
  }
  server?.close();
  server?.closeAllConnections();
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  } else console.log('Preview styles and owned forwards removed.');
}
try {
  await loadSources();
  if (config.once) {
    try {
      const pages = await discover();
      console.log(
        JSON.stringify(
          {
            serial: config.serial,
            package: config.package,
            pages: pages.map(({ kind, path }) => ({ kind, path })),
            sources: snapshot().sources,
          },
          null,
          2,
        ),
      );
      if (!pages.length) process.exitCode = 1;
    } finally {
      for (const pid of [...forwards.keys()]) await removeForward(pid);
    }
  } else {
    const html = await readFile(new URL('./control.html', import.meta.url), 'utf8');
    server = createServer(async (req, res) => {
      try {
        const address = server.address();
        const origin = `http://127.0.0.1:${address.port}`;
        if (req.headers.host !== `127.0.0.1:${address.port}`) {
          json(res, 403, { error: 'Invalid Host' });
          return;
        }
        if (req.method === 'GET' && req.url === '/') {
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            'Content-Security-Policy':
              "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
            'Referrer-Policy': 'no-referrer',
          });
          res.end(html.replaceAll('__SESSION_TOKEN__', owner));
          return;
        }
        if (req.method === 'GET' && req.url === '/status') {
          json(res, 200, snapshot());
          return;
        }
        if (
          req.method !== 'POST' ||
          req.headers.origin !== origin ||
          req.headers['x-preview-token'] !== owner ||
          req.headers['content-type'] !== 'application/json'
        ) {
          json(res, 403, { error: 'Session token and same Origin required' });
          return;
        }
        const data = await body(req);
        if (req.url === '/enabled') {
          enabled = data.enabled === true;
          await tick();
          json(res, 200, snapshot());
        } else if (req.url === '/stop') {
          json(res, 200, { stopping: true });
          void shutdown();
        } else if (req.url === '/preview') {
          const source = sources[data.kind];
          if (!source) throw Error('Unknown source');
          if (data.hash !== source.hash) throw Error('Source changed; refresh parameters');
          source.overrides = checkedOverrides(source.css, data.values);
          await tick();
          json(res, 200, snapshot());
        } else if (req.url === '/save') {
          const source = sources[data.kind];
          if (!source) throw Error('Unknown source');
          const path = resolve(root, source.path);
          // Compare immediately before writing; do not overwrite edits seen since UI read.
          const file = await open(path, 'r+');
          try {
            const current = await file.readFile('utf8');
            if (hash(current) !== data.hash || data.hash !== source.hash)
              throw Error('CAS conflict: source changed; nothing saved');
            const next = replaceVariables(current, checkedOverrides(current, data.values));
            await file.write(Buffer.from(next), 0, Buffer.byteLength(next), 0);
            await file.truncate(Buffer.byteLength(next));
          } finally {
            await file.close();
          }
          dirty = true;
          await tick();
          json(res, 200, snapshot());
        } else if (req.url === '/screenshot') {
          const session = sessions.get(data.key);
          if (!session) throw Error('Connected page unavailable');
          const current = await session.cdp.evaluate('location.origin+location.pathname');
          if (pageKind(current) !== session.kind) throw Error('Page changed; screenshot refused');
          const screenshot = await session.cdp.send('Page.captureScreenshot', {
            format: 'png',
            captureBeyondViewport: false,
          });
          json(res, 200, { png: screenshot.data });
        } else json(res, 404, { error: 'Unknown action' });
      } catch (error) {
        json(res, 409, { error: error.message });
      }
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, '127.0.0.1', resolve);
    });
    console.log(
      `Control: http://127.0.0.1:${server.address().port}/ (serial ${config.serial}; Ctrl+C restores package styles)`,
    );
    for (const path of [...Object.values(SOURCES), ...Object.values(EXTRA_SOURCES)])
      watchFile(resolve(root, path), { interval: 250 }, () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          dirty = true;
          void tick();
        }, 120);
      });
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    await tick();
    if (!stopping) interval = setInterval(tick, 1000);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
  await shutdown();
}
