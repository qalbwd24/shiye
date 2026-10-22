import http from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = await realpath(path.join(workspace, 'public'));
const portArgument = process.argv.find((argument) => argument.startsWith('--port='));
const port = Number(portArgument?.slice('--port='.length) || 18770);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid preview port');

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const server = http.createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Referrer-Policy', 'no-referrer');
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  try {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    if (url.pathname === '/notes-preview-health') {
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      const body = JSON.stringify({
        app: 'shiye-notes-ui-preview',
        workspace,
        port,
        pid: process.pid,
      });
      response.end(request.method === 'HEAD' ? undefined : body);
      return;
    }
    const pathname = decodeURIComponent(url.pathname);
    // This service deliberately has no API, data-directory access or write routes.
    if (pathname.startsWith('/api/') || pathname.includes('\0') || pathname.includes('\\')) {
      response.writeHead(404).end();
      return;
    }
    const candidate = path.resolve(publicRoot, `.${pathname === '/' ? '/notes.html' : pathname}`);
    const filename = await realpath(candidate);
    if (!filename.toLowerCase().startsWith(`${publicRoot.toLowerCase()}${path.sep}`)) {
      response.writeHead(404).end();
      return;
    }
    const metadata = await stat(filename);
    if (!metadata.isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader(
      'Content-Type',
      contentTypes[path.extname(filename)] || 'application/octet-stream',
    );
    response.setHeader('Content-Length', metadata.size);
    if (request.method === 'HEAD') response.end();
    else
      createReadStream(filename)
        .on('error', () => response.destroy())
        .pipe(response);
  } catch {
    response.writeHead(404).end();
  }
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`拾页便签 UI preview: http://127.0.0.1:${port}/notes.html\n`);
});
