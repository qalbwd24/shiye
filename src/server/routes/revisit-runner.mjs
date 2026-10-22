import { createRevisitHttpClient } from '../revisit-runner/client.mjs';
import { createRevisitRunner } from '../revisit-runner/runtime.mjs';

/** One host per server. Production may resume enabled rules after listening/unlock. */
export function createRoutes({
  body,
  reply,
  fail,
  getDb = () => ({}),
  createClient = createRevisitHttpClient,
}) {
  let runner,
    intervalMs,
    pendingStart,
    pendingInterval,
    epoch = 0,
    automaticPaused = false,
    closed = false;
  const status = () =>
    runner?.status() || {
      protocol: 1,
      running: false,
      state: 'stopped',
      intervalMs: 30000,
      consecutiveFailures: 0,
      nextAttemptAt: null,
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastError: null,
      lastResult: null,
    };
  async function stop() {
    epoch++;
    return runner ? runner.stop() : status();
  }
  async function start(port, cookie = '', seconds = 30) {
    if (closed) throw fail(409, '后台正在关闭');
    if (!Number.isInteger(seconds) || seconds < 5 || seconds > 3600)
      throw fail(400, '轮询间隔须为5–3600秒的整数');
    if (runner?.status().running && intervalMs !== seconds * 1000)
      throw fail(409, '请先停止推送，再修改轮询间隔');
    if (pendingStart) {
      if (pendingInterval !== seconds * 1000) throw fail(409, '推送正在启动，请稍后修改间隔');
      try {
        return await pendingStart;
      } catch {
        throw fail(409, '推送启动未完成，请重试');
      }
    }
    if (
      runner?.status().running &&
      ['running', 'waiting', 'retrying', 'catching_up', 'disabled'].includes(runner.status().state)
    )
      return runner.status();
    const generation = epoch;
    pendingInterval = seconds * 1000;
    pendingStart = (async () => {
      if (!runner || intervalMs !== seconds * 1000) {
        if (runner) await runner.stop();
        if (generation !== epoch) throw fail(409, '启动已取消');
        // Socket address, never a URL supplied by a web request.
        const client = createClient({
          url: `http://127.0.0.1:${port}/`,
        });
        intervalMs = seconds * 1000;
        runner = createRevisitRunner({ client, intervalMs });
      }
      // Existing access middleware authenticates the UI. Adopt only that current session in memory.
      await runner.authorizeSession(cookie);
      if (generation !== epoch) throw fail(409, '启动已取消');
      return runner.start();
    })();
    try {
      return await pendingStart;
    } catch (error) {
      if (error.status && !error.code) throw error;
      throw fail(
        error.code === 'locked' ? 401 : 409,
        error.code === 'locked' ? '请先解锁日记库' : '推送启动未完成，请重试',
      );
    } finally {
      pendingStart = undefined;
      pendingInterval = undefined;
    }
  }
  async function autoStart(port, cookie = '') {
    if (closed || automaticPaused || !getDb().revisit?.config?.enabled) return;
    try {
      return await start(port, cookie, intervalMs ? intervalMs / 1000 : 30);
    } catch {
      // Authentication failure is already represented by runner.status(). Never log a session.
    }
  }
  async function handle(req, res, p) {
    if (!p.startsWith('/api/revisit/runner')) return false;
    if (p === '/api/revisit/runner' && req.method === 'GET') return reply(res, 200, status());
    if (
      !['/api/revisit/runner/start', '/api/revisit/runner/stop'].includes(p) ||
      req.method !== 'POST'
    )
      return false;
    const input = JSON.parse(await body(req, 1024));
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).some((key) => (p.endsWith('/start') ? key !== 'intervalSeconds' : true))
    )
      throw fail(400, '运行器控制参数不正确');
    if (p.endsWith('/stop')) {
      automaticPaused = true;
      return reply(res, 200, await stop());
    }
    automaticPaused = false;
    const cookie =
      req.headers.cookie?.match(/(?:^|;\s*)(diary_session=[a-f0-9]{64})(?:;|$)/)?.[1] || '';
    return reply(res, 200, await start(req.socket.localPort, cookie, input.intervalSeconds ?? 30));
  }
  return {
    handle,
    autoStart,
    async close() {
      closed = true;
      return stop();
    },
  };
}
