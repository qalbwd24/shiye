import path from 'node:path';
import { networkInterfaces } from 'node:os';
import { createSyncAuth } from '../sync-v2/auth.mjs';

const BASE = '/api/shared/v1/';
const fail = (status, code) => {
  throw Object.assign(new Error(code), { status, code });
};
const loopback = (ip) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip);
const forwarded = (req) =>
  Object.keys(req.headers).some((key) => key === 'forwarded' || key.startsWith('x-forwarded-'));
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The desktop's legacy API is local even when the same listener also exposes
 * an explicitly authenticated shared namespace. Host alone is not peer identity. */
export function assertLegacyLocal(req) {
  if (!loopback(req.socket.remoteAddress) || forwarded(req)) fail(403, 'LEGACY_LOCAL_ONLY');
}

/** Opt-in authentication boundary for the shared namespace only. SQLite stores
 * device/pairing hashes, never the authoritative diary or business entities. */
export async function createSharedRemoteAuth({
  dataDir,
  options = false,
  body,
  reply,
  authorizeLocal,
  dispatch,
  dispatchProgram,
  clock = Date.now,
}) {
  if (options === false || options === undefined || options?.enabled === false) return null;
  if (
    !object(options) ||
    options.enabled !== true ||
    !path.isAbsolute(dataDir || '') ||
    Object.keys(options).some(
      (key) =>
        ![
          'enabled',
          'allowedHosts',
          'allowedOrigins',
          'publicOrigin',
          'allowLocalPairing',
        ].includes(key),
    )
  )
    fail(400, 'SHARED_INVALID_REMOTE_CONFIG');
  const knownHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  for (const values of Object.values(networkInterfaces()))
    for (const item of values || [])
      knownHosts.add(item.family === 'IPv6' ? `[${item.address}]` : item.address);
  const origins = new Set();
  const hosts = options.allowedHosts ?? [],
    allowedOrigins = options.allowedOrigins ?? [];
  if (!Array.isArray(hosts) || !Array.isArray(allowedOrigins))
    fail(400, 'SHARED_INVALID_REMOTE_CONFIG');
  for (const host of hosts) {
    let parsed;
    try {
      parsed = new URL(`http://${host}`);
    } catch {
      fail(400, 'SHARED_INVALID_REMOTE_CONFIG');
    }
    if (
      typeof host !== 'string' ||
      parsed.host !== host.toLowerCase() ||
      parsed.port ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash
    )
      fail(400, 'SHARED_INVALID_REMOTE_CONFIG');
    knownHosts.add(parsed.hostname);
  }
  for (const origin of allowedOrigins) {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      fail(400, 'SHARED_INVALID_REMOTE_CONFIG');
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin)
      fail(400, 'SHARED_INVALID_REMOTE_CONFIG');
    origins.add(parsed.origin);
  }
  if (options.publicOrigin !== undefined) {
    let parsed;
    try {
      parsed = new URL(options.publicOrigin);
    } catch {
      fail(400, 'SHARED_INVALID_REMOTE_CONFIG');
    }
    if (parsed.protocol !== 'https:' || parsed.origin !== options.publicOrigin)
      fail(400, 'SHARED_INVALID_REMOTE_CONFIG');
    knownHosts.add(parsed.hostname);
    origins.add(parsed.origin);
  }
  if (options.allowLocalPairing !== undefined && typeof options.allowLocalPairing !== 'boolean')
    fail(400, 'SHARED_INVALID_REMOTE_CONFIG');
  const auth = await createSyncAuth({ dataDir: path.join(dataDir, '.shared-auth'), clock });
  let closed = false;
  function matches(req) {
    if (typeof req.url !== 'string') return false;
    if (req.url.startsWith(BASE)) return true;
    // Absolute-form requests must not fall through into the cookie-only legacy
    // dispatcher with a shared pathname and thus bypass the Bearer boundary.
    try {
      return new URL(req.url, 'http://localhost').pathname.startsWith(BASE);
    } catch {
      return false;
    }
  }
  function guard(req, res) {
    if (
      typeof req.url !== 'string' ||
      !req.url.startsWith('/') ||
      req.url.startsWith('//') ||
      /[\\\u0000-\u0020]/.test(req.url) ||
      typeof req.headers.host !== 'string'
    )
      fail(400, 'SHARED_INVALID_REQUEST');
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host}`);
    } catch {
      fail(400, 'SHARED_INVALID_REQUEST');
    }
    if (url.username || url.password || !knownHosts.has(url.hostname))
      fail(403, 'HOST_NOT_ALLOWED');
    if (!url.pathname.startsWith(BASE)) fail(404, 'SHARED_ACTION_NOT_FOUND');
    const origin = req.headers.origin;
    if (
      origin !== undefined &&
      !origins.has(origin) &&
      origin !== `http://${url.host}` &&
      origin !== `https://${url.host}`
    )
      fail(403, 'ORIGIN_NOT_ALLOWED');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    return url.pathname;
  }
  async function localAdmin(req, res) {
    if (
      !loopback(req.socket.remoteAddress) ||
      forwarded(req) ||
      req.headers['x-sync-client'] !== 'local-admin'
    )
      fail(403, 'LOCAL_ADMIN_REQUIRED');
    try {
      return await authorizeLocal(req, res);
    } catch (error) {
      if (error.status === 401) fail(401, 'LOCAL_UNLOCK_REQUIRED');
      if (error.status === 403) fail(403, 'LOCAL_ADMIN_REQUIRED');
      throw error;
    }
  }
  async function json(req) {
    let value;
    try {
      value = JSON.parse((await body(req, 2048)).toString('utf8'));
    } catch (error) {
      if (error.status) throw error;
      fail(400, 'INVALID_JSON');
    }
    if (!object(value)) fail(400, 'INVALID_JSON');
    return value;
  }
  return {
    matches,
    guardLegacyPeer: assertLegacyLocal,
    async handle(req, res) {
      try {
        const pathname = guard(req, res);
        if (closed) fail(503, 'SHARED_AUTH_CLOSED');
        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
            'Access-Control-Allow-Headers': 'Authorization,Content-Type,X-Sync-Device-Id',
            'Access-Control-Max-Age': '600',
          });
          res.end();
          return true;
        }
        if (pathname === BASE + 'auth/pair' && req.method === 'POST') {
          return reply(res, 201, auth.pair(await json(req), req.socket.remoteAddress));
        }
        const management =
          pathname === BASE + 'auth/local-pairing' ||
          pathname === BASE + 'auth/devices' ||
          pathname.startsWith(BASE + 'auth/devices/');
        if (management) {
          if (await localAdmin(req, res)) return true;
          if (pathname === BASE + 'auth/local-pairing' && req.method === 'POST') {
            if (options.allowLocalPairing === false) fail(403, 'LOCAL_PAIRING_DISABLED');
            return reply(res, 200, auth.pairingCode());
          }
          if (pathname === BASE + 'auth/devices' && req.method === 'GET')
            return reply(res, 200, { devices: auth.listDevices() });
          const match = /^\/api\/shared\/v1\/auth\/devices\/([a-f0-9-]{36})$/.exec(pathname);
          if (match && req.method === 'DELETE') return reply(res, 200, auth.revoke(match[1]));
          fail(405, 'METHOD_NOT_ALLOWED');
        }
        if (pathname.startsWith(BASE + 'program/')) {
          if (dispatchProgram && (await dispatchProgram(req, res, pathname))) return true;
          fail(404, 'PROGRAM_NOT_ENABLED');
        }
        const device = auth.authenticate(req.headers.authorization);
        if (req.headers['x-sync-device-id'] && req.headers['x-sync-device-id'] !== device.deviceId)
          fail(403, 'DEVICE_ID_MISMATCH');
        req.sharedDevice = device;
        if (await dispatch(req, res, pathname)) return true;
        fail(404, 'SHARED_ACTION_NOT_FOUND');
      } catch (error) {
        return reply(res, error.status || 500, {
          error: { code: error.code || 'SHARED_AUTH_FAILED' },
        });
      }
    },
    close() {
      if (!closed) {
        closed = true;
        auth.close();
      }
    },
  };
}
