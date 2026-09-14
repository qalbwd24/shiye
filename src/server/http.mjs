import { LIMITS } from '../../public/shared/limits.js';
export const fail = (status, message) => Object.assign(new Error(message), { status });

export async function body(req, max = LIMITS.requestBytes) {
  let size = 0;
  const parts = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw fail(413, '文件或内容超出大小限制');
    parts.push(chunk);
  }
  return Buffer.concat(parts);
}

/** A handled route returns true. Never include private data in error logs. */
export function reply(res, status, value) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(value));
  return true;
}

export function guardRequest(req, res) {
  const host = req.headers.host || '';
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw fail(403, '仅允许本机访问');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  );
  if (
    !['GET', 'HEAD'].includes(req.method) &&
    (req.headers['x-diary-client'] !== 'desktop' ||
      (req.headers.origin && req.headers.origin !== 'http://' + host))
  )
    throw fail(403, '请求来源不匹配');
  return new URL(req.url, 'http://' + host).pathname;
}

export function replyError(res, error) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const messages = {
    ENOSPC: '磁盘空间不足，请释放空间后重试',
    EACCES: '文件被占用或没有写入权限',
    ENOENT: '所需文件不存在，请检查附件和本地数据目录',
  };
  reply(res, error.status || (error instanceof SyntaxError ? 400 : 500), {
    error: error.status
      ? error.message
      : error instanceof SyntaxError
        ? '请求格式不正确'
        : messages[error.code] || '本地操作失败，请保留编辑内容并查看磁盘状态',
  });
}
