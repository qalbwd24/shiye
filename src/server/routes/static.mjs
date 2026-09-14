import path from 'node:path';
import { promises as fs } from 'node:fs';
import { PUBLIC_ROOT } from '../config.mjs';
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

/** Only public assets are reachable; data, resources, tests and source are never served. */
export async function staticRoute(req, res, p) {
  if (!['GET', 'HEAD'].includes(req.method)) return false;
  const relative = decodeURIComponent(p === '/' ? 'index.html' : p.slice(1));
  const file = path.resolve(PUBLIC_ROOT, relative),
    type = mime[path.extname(file)];
  if (!type || !file.startsWith(PUBLIC_ROOT + path.sep)) return false;
  let resolved;
  try {
    resolved = await fs.realpath(file);
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return false;
    throw e;
  }
  if (!resolved.startsWith(PUBLIC_ROOT + path.sep) || (await fs.stat(resolved)).isDirectory())
    return false;
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  res.end(req.method === 'HEAD' ? undefined : await fs.readFile(resolved));
  return true;
}
