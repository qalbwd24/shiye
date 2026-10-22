import path from 'node:path';
import { promises as fs } from 'node:fs';
import { PUBLIC_ROOT } from '../config.mjs';
import { startupTheme } from '../../../public/shared/theme.js';
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
export function createStaticRoute({ getDb }) {
  return async function staticRoute(req, res, p) {
    if (!['GET', 'HEAD'].includes(req.method)) return false;
    const quick = new URL(req.url, 'http://127.0.0.1').searchParams.get('quick') === '1';
    const theme = startupTheme(getDb().settings?.preferences, quick);
    // Public like the HTML shell; no library, wallpaper IDs or other preferences.
    if (p === '/startup-theme.json') {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ theme }));
      return true;
    }
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
    const isShell = resolved === path.join(PUBLIC_ROOT, 'index.html');
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': isShell ? 'no-store' : 'no-cache',
    });
    let content;
    if (req.method !== 'HEAD') {
      content = await fs.readFile(resolved);
      if (isShell) {
        content = content
          .toString('utf8')
          .replace('data-theme-preference="system"', `data-theme-preference="${theme}"`);
        if (quick) content = content.replace('<body>', '<body class="quick-capture">');
      }
    }
    res.end(content);
    return true;
  };
}
