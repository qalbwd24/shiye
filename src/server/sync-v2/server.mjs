import http from 'node:http';
import path from 'node:path';
import { access, readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { EventEmitter } from 'node:events';
import { openSyncStore } from './store.mjs';
import { createSyncAuth } from './auth.mjs';
import { createSyncMediaStore } from './media.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const fail = (status, code) => Object.assign(new Error(code), { status, code });
const loopback = (ip) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip);
export function localSyncAddresses(port, basePath = '/') {
  const hosts = new Set(['127.0.0.1']);
  for (const values of Object.values(networkInterfaces()))
    for (const item of values || [])
      if (item.family === 'IPv4' && !item.internal) hosts.add(item.address);
  return [...hosts].map((host) => `http://${host}:${port}${basePath}`);
}
function prefix(value = '/') {
  if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(value)) throw fail(400, 'INVALID_BASE_PATH');
  return value;
}
async function readBody(req, max = 4 * 1024 * 1024) {
  const parts = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw fail(413, 'REQUEST_TOO_LARGE');
    parts.push(chunk);
  }
  return Buffer.concat(parts);
}
async function readJson(req, max) {
  let value;
  try {
    value = JSON.parse((await readBody(req, max)).toString('utf8'));
  } catch (error) {
    if (error.status) throw error;
    throw fail(400, 'INVALID_JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail(400, 'INVALID_JSON');
  return value;
}
function json(res, status, data) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

/** Independent single-owner service. Never mounts the desktop /api or reads a diary.json. */
export async function createSyncServer({
  dataDir,
  basePath = '/',
  allowedHosts = [],
  allowedOrigins = [],
  publicOrigin,
  allowLocalPairing = !publicOrigin,
  clock = Date.now,
  watchTimeoutMs = 25000,
  extensionFactory,
} = {}) {
  if (!dataDir || !path.isAbsolute(dataDir)) throw fail(400, 'EXPLICIT_DATA_DIRECTORY_REQUIRED');
  try {
    await access(path.join(dataDir, 'diary.json'));
    throw fail(400, 'DIARY_DIRECTORY_REFUSED');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  basePath = prefix(basePath);
  if (publicOrigin && new URL(publicOrigin).protocol !== 'https:')
    throw fail(400, 'HTTPS_PUBLIC_ORIGIN_REQUIRED');
  const store = await openSyncStore({ dataDir, clock });
  let auth, media;
  try {
    auth = await createSyncAuth({ dataDir, clock });
    media = await createSyncMediaStore({ dataDir });
  } catch (error) {
    store.close();
    auth?.close();
    throw error;
  }
  const events = new EventEmitter();
  events.setMaxListeners(100);
  const sockets = new Set();
  let closed = false,
    watchCount = 0;
  const knownHosts = new Set(['localhost', '127.0.0.1', '[::1]', ...allowedHosts]);
  for (const url of localSyncAddresses(1)) knownHosts.add(new URL(url).hostname);
  if (publicOrigin) knownHosts.add(new URL(publicOrigin).hostname);
  const staticFiles = new Map([
    ['', ['public/sync-lab/index.html', 'text/html; charset=utf-8']],
    ['app.js', ['public/sync-lab/app.js', 'text/javascript; charset=utf-8']],
    ['style.css', ['public/sync-lab/style.css', 'text/css; charset=utf-8']],
    [
      'assets/sync-v2-client.js',
      ['public/shared/sync-v2-client.js', 'text/javascript; charset=utf-8'],
    ],
    [
      'assets/sync-v2-media.js',
      ['public/shared/sync-v2-media.js', 'text/javascript; charset=utf-8'],
    ],
    [
      'assets/sync-v2-media-cache.js',
      ['public/shared/sync-v2-media-cache.js', 'text/javascript; charset=utf-8'],
    ],
    [
      'assets/rich-document.js',
      ['public/shared/rich-document.js', 'text/javascript; charset=utf-8'],
    ],
    ['assets/limits.js', ['public/shared/limits.js', 'text/javascript; charset=utf-8']],
  ]);
  for (const name of [
    'product-seed',
    'product-seed-client',
    'sync-product',
    'sync-v2-client',
    'sync-v2-media',
    'rich-document',
    'message-units',
    'legacy-time-segments',
    'content-preparation',
    'time-zone',
    'rich-document-renderer',
    'limits',
  ]) {
    const entry = [`public/shared/${name}.js`, 'text/javascript; charset=utf-8'];
    staticFiles.set(`assets/${name}.js`, entry);
    staticFiles.set(`shared/${name}.js`, entry);
  }
  staticFiles.set('vendor/rich-editor.js', [
    'public/vendor/rich-editor.js',
    'text/javascript; charset=utf-8',
  ]);
  staticFiles.set('editor/rich-document-editor.js', [
    'public/editor/rich-document-editor.js',
    'text/javascript; charset=utf-8',
  ]);
  async function publishPending() {
    for (const asset of await media.listUnpublished()) {
      await store.publishAsset(asset);
      await media.markPublished(asset.assetId);
    }
  }
  try {
    await publishPending();
  } catch (error) {
    await media.close();
    auth.close();
    store.close();
    throw error;
  }
  function guard(req, res) {
    if (!req.url?.startsWith('/') || req.url.startsWith('//') || !req.headers.host)
      throw fail(400, 'INVALID_REQUEST');
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (!knownHosts.has(url.hostname)) throw fail(403, 'HOST_NOT_ALLOWED');
    const ownOrigins = new Set([`http://${url.host}`, `https://${url.host}`, ...allowedOrigins]);
    if (publicOrigin) ownOrigins.add(new URL(publicOrigin).origin);
    if (req.headers.origin && !ownOrigins.has(req.headers.origin))
      throw fail(403, 'ORIGIN_NOT_ALLOWED');
    if (req.headers.origin) {
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
    if (!url.pathname.startsWith(basePath)) throw fail(404, 'NOT_FOUND');
    return { url, route: url.pathname.slice(basePath.length) };
  }
  function localAdmin(req) {
    if (
      !allowLocalPairing ||
      !loopback(req.socket.remoteAddress) ||
      req.headers['x-sync-client'] !== 'local-admin' ||
      req.headers.forwarded ||
      req.headers['x-forwarded-for'] ||
      req.headers['x-forwarded-host']
    )
      throw fail(403, 'LOCAL_PAIRING_ONLY');
  }
  let extension;
  try {
    extension = await extensionFactory?.({
      dataDir,
      store,
      media,
      publishPending,
      clock,
      notify: () => events.emit('change'),
    });
  } catch (error) {
    await media.close();
    auth.close();
    store.close();
    throw error;
  }
  const server = http.createServer(async (req, res) => {
    try {
      const { url, route } = guard(req, res);
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
          'Access-Control-Allow-Headers':
            'Authorization,Content-Type,X-Sync-Client,X-Sync-Device-Id,X-Chunk-Sha256',
          'Access-Control-Max-Age': '600',
        });
        return res.end();
      }
      if (closed) throw fail(503, 'SERVICE_STOPPING');
      if (req.method === 'GET' && staticFiles.has(route)) {
        const [file, contentType] = staticFiles.get(route);
        const bytes = await readFile(path.join(ROOT, file));
        res.writeHead(200, { 'Content-Type': contentType });
        return res.end(bytes);
      }
      if (route === 'api/sync/v1/health' && req.method === 'GET')
        return json(res, 200, {
          service: 'shiye-sync',
          protocol: 1,
          isolated: true,
          ...(extension?.features ? { product: extension.features } : {}),
        });
      if (route === 'api/sync/v1/local-pairing' && req.method === 'POST') {
        localAdmin(req);
        return json(res, 200, auth.pairingCode());
      }
      if (route === 'api/sync/v1/pair' && req.method === 'POST')
        return json(res, 201, auth.pair(await readJson(req, 2048), req.socket.remoteAddress));
      const device = auth.authenticate(req.headers.authorization);
      if (req.headers['x-sync-device-id'] && req.headers['x-sync-device-id'] !== device.deviceId)
        throw fail(403, 'DEVICE_ID_MISMATCH');
      if (await extension?.handle?.(req, res, { route, url, device, readJson, json })) return;
      if (route === 'api/sync/v1/info' && req.method === 'GET')
        return json(res, 200, {
          ...(await store.info()),
          deviceId: device.deviceId,
          features: {
            media: true,
            watch: true,
            conflicts: true,
            ...(extension?.features ? { product: extension.features } : {}),
          },
        });
      if (route === 'api/sync/v1/devices' && req.method === 'GET')
        return json(res, 200, { devices: auth.listDevices() });
      const revoke = /^api\/sync\/v1\/devices\/([\w-]+)$/.exec(route);
      if (revoke && req.method === 'DELETE') return json(res, 200, auth.revoke(revoke[1]));
      if (route === 'api/sync/v1/push' && req.method === 'POST') {
        const input = await readJson(req);
        const result = extension?.push
          ? await extension.push(device, input.operations)
          : await store.push(device.deviceId, input.operations);
        events.emit('change');
        return json(res, 200, result);
      }
      if (['api/sync/v1/pull', 'api/sync/v1/snapshot'].includes(route) && req.method === 'POST') {
        const input = await readJson(req, 16384);
        return json(
          res,
          200,
          route.endsWith('snapshot') ? await store.snapshot(input) : await store.pull(input),
        );
      }
      if (route === 'api/sync/v1/conflicts' && req.method === 'GET')
        return json(
          res,
          200,
          await store.listConflicts({
            entityType: url.searchParams.get('entityType') || undefined,
            entityId: url.searchParams.get('entityId') || undefined,
            limit: 100,
          }),
        );
      const conflict = /^api\/sync\/v1\/conflicts\/([\w:@.-]+)$/.exec(route);
      if (conflict && req.method === 'GET') {
        const result = await store.getConflict(conflict[1]);
        if (!result) throw fail(404, 'CONFLICT_NOT_FOUND');
        return json(res, 200, result);
      }
      if (route === 'api/sync/v1/watch' && req.method === 'GET') {
        if (watchCount >= 64) throw fail(429, 'WATCH_LIMIT');
        const cursor = url.searchParams.get('cursor') || undefined;
        const hasChanges = async () =>
          cursor
            ? (await store.pull({ cursor, limit: 1 })).changes.length > 0
            : (await store.info()).seq > 0;
        if (await hasChanges())
          return json(res, 200, { changed: true, seq: (await store.info()).seq });
        if (watchCount >= 64) throw fail(429, 'WATCH_LIMIT');
        watchCount++;
        const wait = Number(url.searchParams.get('timeout') || watchTimeoutMs);
        if (!Number.isFinite(wait) || wait < 100 || wait > 30000) {
          watchCount--;
          throw fail(400, 'INVALID_WATCH_TIMEOUT');
        }
        let timer;
        await new Promise((resolve) => {
          const finish = () => {
            clearTimeout(timer);
            events.off('change', finish);
            res.off('close', finish);
            resolve();
          };
          events.on('change', finish);
          res.once('close', finish);
          timer = setTimeout(finish, wait);
          // Register first, then check, so no commit can fall into a subscription gap.
          hasChanges()
            .then((changed) => {
              if (changed) finish();
            })
            .catch(finish);
        });
        watchCount--;
        if (closed) throw fail(503, 'SERVICE_STOPPING');
        auth.authenticate(req.headers.authorization);
        return json(res, 200, { changed: await hasChanges(), seq: (await store.info()).seq });
      }
      if (route === 'api/sync/v1/media/uploads' && req.method === 'POST')
        return json(res, 201, await media.begin(await readJson(req, 4096)));
      const upload = /^api\/sync\/v1\/media\/uploads\/([\w-]+)(?:\/(complete|chunks\/\d+))?$/.exec(
        route,
      );
      if (upload) {
        const [, id, action] = upload;
        if (!action && req.method === 'GET') return json(res, 200, await media.status(id));
        if (action?.startsWith('chunks/') && req.method === 'PUT')
          return json(
            res,
            200,
            await media.putChunk(id, Number(action.slice(7)), await readBody(req, 262144), {
              sha256: req.headers['x-chunk-sha256'],
            }),
          );
        if (action === 'complete' && req.method === 'POST') {
          const asset = await media.complete(id);
          await publishPending();
          events.emit('change');
          return json(res, 200, asset);
        }
      }
      const asset = /^api\/sync\/v1\/media\/assets\/([\w:@.-]+)(\/content)?$/.exec(route);
      if (asset && req.method === 'GET') {
        if (!asset[2]) return json(res, 200, await media.getAsset(asset[1]));
        const file = await media.openContent(asset[1]);
        let start = 0,
          end = file.size - 1,
          status = 200;
        if (req.headers.range) {
          const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
          if (!match) throw fail(416, 'INVALID_RANGE');
          start = Number(match[1]);
          if (match[2] && !Number.isSafeInteger(Number(match[2]))) throw fail(416, 'INVALID_RANGE');
          end = match[2] ? Math.min(Number(match[2]), end) : end;
          if (!Number.isSafeInteger(start) || start < 0 || start > end || start >= file.size)
            throw fail(416, 'INVALID_RANGE');
          status = 206;
          res.setHeader('Content-Range', `bytes ${start}-${end}/${file.size}`);
        }
        const inline =
          /^(?:image\/(?:png|jpeg|gif|webp|avif|bmp)|video\/(?:mp4|webm|ogg|quicktime)|audio\/(?:mpeg|mp4|ogg|wav|webm))$/.test(
            file.mime,
          );
        res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
        res.writeHead(status, {
          'Content-Type': inline ? file.mime : 'application/octet-stream',
          'Content-Length': end - start + 1,
          'Accept-Ranges': 'bytes',
          'Content-Disposition': inline ? 'inline' : 'attachment',
        });
        const stream = createReadStream(file.contentPath, { start, end });
        stream.on('error', () => res.destroy());
        res.once('close', () => stream.destroy());
        return stream.pipe(res);
      }
      throw fail(404, 'NOT_FOUND');
    } catch (error) {
      const status = error.status || error.statusCode || 500;
      if (res.headersSent) return res.destroy();
      const normalized = String(error.code || '')
        .replaceAll('-', '_')
        .toUpperCase();
      const code =
        status >= 500
          ? 'SYNC_SERVICE_ERROR'
          : /^[A-Z0-9_]{1,80}$/.test(normalized)
            ? normalized
            : 'REQUEST_REJECTED';
      json(res, status, { error: { code } });
    }
  });
  server.requestTimeout = 60000;
  server.headersTimeout = 15000;
  server.keepAliveTimeout = 5000;
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  async function close() {
    if (closed) return;
    closed = true;
    events.emit('change');
    for (const socket of sockets) socket.destroy();
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    await extension?.close?.();
    await media.close();
    auth.close();
    store.close();
  }
  return { server, store, auth, media, basePath, close, publishPending, extension };
}
