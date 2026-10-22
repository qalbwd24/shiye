import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};
export async function createLegacyConversionLab({
  runDir,
  token = randomBytes(24).toString('hex'),
} = {}) {
  if (!runDir) throw Error('Explicit private run directory required');
  const snapshot = JSON.parse(await fs.readFile(path.join(runDir, 'source-snapshot.json'), 'utf8'));
  const source = new URL(snapshot.sourceUrl);
  if (source.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(source.hostname))
    throw Error('Loopback media source required');
  const media = new Map(snapshot.media.map((m) => [m.id, m]));
  const originals = new Map(snapshot.entries.map((e) => [e.id, e]));
  const rows = [];
  for (const phase of ['development', 'holdout']) {
    try {
      const report = JSON.parse(
        await fs.readFile(path.join(runDir, phase + '-report.json'), 'utf8'),
      );
      rows.push(...report.rows);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const { createHash } = await import('node:crypto');
  const byHash = new Map(
    [...originals.values()].map((e) => [createHash('sha256').update(e.id).digest('hex'), e]),
  );
  const send = (res, status, value) => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    res.end(JSON.stringify(value));
  };
  const server = http.createServer(async (req, res) => {
    try {
      if (!['GET', 'HEAD'].includes(req.method)) return send(res, 405, { error: '试验页只读' });
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/health')
        return send(res, 200, { ready: true, samples: rows.length, readOnly: true });
      if (url.pathname.startsWith('/api/')) {
        const provided = Buffer.from(String(req.headers['x-lab-session'] || ''));
        const expected = Buffer.from(token);
        if (provided.length !== expected.length || !timingSafeEqual(provided, expected))
          return send(res, 403, { error: '请从本次试验入口打开' });
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`)
          return send(res, 403, { error: '来源不匹配' });
        if (url.pathname === '/api/samples')
          return send(res, 200, {
            samples: rows.map((r) => ({
              ...r,
              title: byHash.get(r.key)?.title || '无标题',
              category: byHash.get(r.key)?.category || '',
            })),
          });
        const entry = /^\/api\/entry\/([a-f0-9]{64})$/.exec(url.pathname);
        if (entry && byKey.has(entry[1])) {
          const p = JSON.parse(
            await fs.readFile(path.join(runDir, 'entries', entry[1] + '.json'), 'utf8'),
          );
          return send(res, 200, {
            source: p.source,
            original: {
              title: p.original.title,
              content: p.original.content,
              category: p.original.category,
              tags: p.original.tags,
            },
            candidate: p.candidate,
            temporal: p.temporal,
            validation: p.validation,
            media: p.media,
          });
        }
        const asset = /^\/api\/media\/([^/]+)$/.exec(url.pathname);
        if (asset && media.has(decodeURIComponent(asset[1]))) {
          const fetched = await fetch(
            new URL('/media/' + encodeURIComponent(decodeURIComponent(asset[1])), source),
            { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(30000) },
          );
          if (!fetched.ok) return send(res, fetched.status, { error: '原资源不可用或已锁定' });
          res.writeHead(200, {
            'Content-Type': fetched.headers.get('content-type') || 'application/octet-stream',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
          });
          if (req.method === 'HEAD') return res.end();
          Readable.fromWeb(fetched.body)
            .on('error', () => res.destroy())
            .pipe(res);
          return;
        }
        return send(res, 404, { error: '样本或资源不存在' });
      }
      const publicRoot = path.join(root, 'public');
      const relative = decodeURIComponent(
        url.pathname === '/' ? 'legacy-conversion-lab.html' : url.pathname.slice(1),
      );
      const resolved = path.resolve(publicRoot, relative),
        type = mime[path.extname(resolved)];
      if (!type || !resolved.startsWith(publicRoot + path.sep))
        return send(res, 404, { error: '未找到' });
      const real = await fs.realpath(resolved);
      if (!real.startsWith(publicRoot + path.sep)) return send(res, 404, { error: '未找到' });
      const bytes = await fs.readFile(real);
      res.writeHead(200, {
        'Content-Type': type,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch {
      if (!res.headersSent) send(res, 404, { error: '读取失败，原数据未改变' });
      else res.destroy();
    }
  });
  return { server, token };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const runAt = process.argv.indexOf('--run-dir');
  if (runAt < 0) throw Error('--run-dir required');
  const runDir = path.resolve(process.argv[runAt + 1]);
  if (!runDir.startsWith(path.join(root, 'var', 'migration-lab') + path.sep))
    throw Error('Private project run directory required');
  const { server, token } = await createLegacyConversionLab({ runDir });
  await new Promise((resolve) => server.listen(18767, '127.0.0.1', resolve));
  await fs.writeFile(
    path.join(runDir, 'preview-runtime.json'),
    JSON.stringify({ pid: process.pid, url: 'http://127.0.0.1:18767/#' + token, port: 18767 }),
  );
  console.log(JSON.stringify({ ready: true, port: 18767, readOnly: true }));
}
