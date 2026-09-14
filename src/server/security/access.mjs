import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
export async function localSecurity({ dataDir, body, reply, fail }) {
  const file = path.join(dataDir, 'access.json');
  let config;
  try {
    config = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    config = null;
  }
  const sessions = new Map();
  let failures = 0,
    blockedUntil = 0;
  const verify = (value) => {
    if (!config || typeof value !== 'string' || value.length > 200) return false;
    return timingSafeEqual(scryptSync(value, config.salt, 32), Buffer.from(config.hash, 'hex'));
  };
  const token = (req) => req.headers.cookie?.match(/(?:^|;\s*)diary_session=([a-f0-9]{64})/)?.[1];
  const valid = (req) => {
    const t = token(req),
      until = sessions.get(t);
    if (until && until > Date.now()) {
      sessions.set(t, Date.now() + 30 * 60000);
      return true;
    }
    return false;
  };
  const cookie = (res, t) =>
    res.setHeader(
      'Set-Cookie',
      `diary_session=${t}; HttpOnly; SameSite=Strict; Path=/; ${t ? '' : 'Max-Age=0;'}`,
    );
  return async (req, res, p) => {
    if (p === '/api/access' && req.method === 'GET') {
      reply(res, 200, { enabled: !!config, unlocked: !config || valid(req) });
      return true;
    }
    if (p === '/api/unlock' && req.method === 'POST') {
      if (Date.now() < blockedUntil) throw fail(429, '尝试过多，请五分钟后再试');
      const data = JSON.parse(await body(req));
      if (!verify(data.password)) {
        if (++failures >= 5) {
          blockedUntil = Date.now() + 300000;
          failures = 0;
        }
        throw fail(401, '本地锁密码不正确');
      }
      failures = 0;
      const t = randomBytes(32).toString('hex');
      sessions.set(t, Date.now() + 30 * 60000);
      cookie(res, t);
      reply(res, 200, { unlocked: true });
      return true;
    }
    if (
      config &&
      (p.startsWith('/api/') || p.startsWith('/media/')) &&
      p !== '/api/health' &&
      !valid(req)
    )
      throw fail(401, '日记库已锁定，请先解锁');
    if (p === '/api/lock' && req.method === 'POST') {
      sessions.delete(token(req));
      cookie(res, '');
      reply(res, 200, { locked: !!config });
      return true;
    }
    if (p === '/api/access' && req.method === 'PUT') {
      const data = JSON.parse(await body(req));
      if (config && !verify(data.oldPassword)) throw fail(403, '请输入当前本地锁密码');
      if (data.disable) {
        config = null;
        await fs.unlink(file).catch((e) => {
          if (e.code !== 'ENOENT') throw e;
        });
        sessions.clear();
        cookie(res, '');
        reply(res, 200, { enabled: false });
        return true;
      }
      if (
        typeof data.password !== 'string' ||
        data.password.length < 8 ||
        data.password.length > 200
      )
        throw fail(400, '本地锁密码需要 8 到 200 个字符');
      const salt = randomBytes(16).toString('hex');
      config = { salt, hash: scryptSync(data.password, salt, 32).toString('hex') };
      await fs.writeFile(file + '.tmp', JSON.stringify(config), 'utf8');
      await fs.rename(file + '.tmp', file);
      sessions.clear();
      const t = randomBytes(32).toString('hex');
      sessions.set(t, Date.now() + 30 * 60000);
      cookie(res, t);
      reply(res, 200, { enabled: true });
      return true;
    }
    return false;
  };
}
