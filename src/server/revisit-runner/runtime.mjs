import { setTimeout as delay } from 'node:timers/promises';
import { runnerError } from './client.mjs';

const sleep = (ms, signal) => delay(ms, undefined, { signal });
const CODES = new Set([
  'locked',
  'forbidden',
  'unsupported',
  'rate_limited',
  'server_error',
  'invalid_request',
  'invalid_response',
  'offline',
  'timeout',
  'aborted',
  'invalid_session',
  'invalid_password',
  'busy',
]);
const safeError = (error) => ({
  code: CODES.has(error.code) ? error.code : 'internal_error',
  ...(Number.isInteger(error.status) ? { status: error.status } : {}),
});

/** A host owns this instance; progress/deduplication remain exclusively on the server. */
export function createRevisitRunner({
  client,
  intervalMs = 30000,
  retryBaseMs = 1000,
  retryMaxMs = 60000,
  catchUpDelayMs = 250,
  clock = Date.now,
  random = Math.random,
  wait = sleep,
  onStatus = () => {},
}) {
  for (const value of [intervalMs, retryBaseMs, retryMaxMs, catchUpDelayMs])
    if (!Number.isSafeInteger(value) || value < 1 || value > 86400000)
      throw runnerError('invalid_interval');
  if (retryMaxMs < retryBaseMs) throw runnerError('invalid_interval');
  let desired = false,
    task,
    controller,
    authTask,
    authController,
    onceTask,
    stoppingTask;
  let state = {
    protocol: 1,
    running: false,
    state: 'stopped',
    intervalMs,
    consecutiveFailures: 0,
    nextAttemptAt: null,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastError: null,
    lastResult: null,
  };
  const status = () => structuredClone(state);
  function publish(patch) {
    state = { ...state, ...patch, running: desired };
    try {
      onStatus(status());
    } catch {
      /* A status observer cannot stop delivery. */
    }
  }
  async function loop(signal) {
    while (desired && !signal.aborted) {
      let waitMs;
      publish({
        state: 'running',
        nextAttemptAt: null,
        lastAttemptAt: new Date(clock()).toISOString(),
      });
      try {
        const result = await client.tick({}, signal);
        if (signal.aborted || !desired) return;
        waitMs = result.remaining ? catchUpDelayMs : intervalMs;
        publish({
          state: result.disabled ? 'disabled' : result.remaining ? 'catching_up' : 'waiting',
          consecutiveFailures: 0,
          lastError: null,
          lastResult: result,
          lastSuccessAt: new Date(clock()).toISOString(),
        });
      } catch (error) {
        if (signal.aborted || !desired || error.code === 'aborted') return;
        const failures = state.consecutiveFailures + 1;
        if (!error.retryable) {
          if (error.code === 'locked') client.clearSession();
          publish({
            state:
              error.code === 'locked'
                ? 'locked'
                : error.code === 'unsupported'
                  ? 'unsupported'
                  : 'failed',
            lastError: safeError(error),
            consecutiveFailures: failures,
            nextAttemptAt: null,
          });
          return;
        }
        const backoff = Math.min(retryMaxMs, retryBaseMs * 2 ** Math.min(failures - 1, 20));
        const jitter = 0.8 + Math.max(0, Math.min(1, random())) * 0.4;
        waitMs = Math.max(
          1,
          Math.min(retryMaxMs, Math.round(backoff * jitter)),
          error.retryAfterMs || 0,
        );
        publish({ state: 'retrying', lastError: safeError(error), consecutiveFailures: failures });
      }
      publish({ nextAttemptAt: new Date(clock() + waitMs).toISOString() });
      try {
        await wait(waitMs, signal);
      } catch {
        return;
      }
    }
  }
  function launch() {
    if (!desired || task || authTask || onceTask || stoppingTask) return;
    const active = new AbortController();
    controller = active;
    task = loop(active.signal)
      .catch(() => {
        if (!active.signal.aborted)
          publish({ state: 'failed', lastError: { code: 'internal_error' }, nextAttemptAt: null });
      })
      .finally(() => {
        if (controller === active) {
          controller = undefined;
          task = undefined;
        }
      });
  }
  function start() {
    if (onceTask || stoppingTask) throw runnerError('busy');
    desired = true;
    publish({});
    launch();
    return status();
  }
  function stop() {
    if (stoppingTask) return stoppingTask;
    desired = false;
    controller?.abort();
    authController?.abort();
    client.clearSession();
    publish({ state: 'stopping', nextAttemptAt: null });
    stoppingTask = Promise.allSettled([task, authTask, onceTask].filter(Boolean))
      .then(() => {
        publish({ state: 'stopped', nextAttemptAt: null });
        return status();
      })
      .finally(() => {
        stoppingTask = undefined;
      });
    return stoppingTask;
  }
  function authenticate(run) {
    if (authTask || onceTask || stoppingTask) return Promise.reject(runnerError('busy'));
    controller?.abort();
    const previous = task,
      active = new AbortController();
    authController = active;
    publish({ state: 'authenticating', nextAttemptAt: null });
    let success = false;
    authTask = (async () => {
      await previous;
      if (active.signal.aborted) throw runnerError('aborted');
      await run(active.signal);
      if (active.signal.aborted) throw runnerError('aborted');
      success = true;
      publish({ state: desired ? 'waiting' : 'stopped', lastError: null, consecutiveFailures: 0 });
      return status();
    })()
      .catch((error) => {
        if (!active.signal.aborted) {
          client.clearSession();
          publish({
            state: error.code === 'locked' ? 'locked' : 'failed',
            lastError: safeError(error),
          });
        }
        throw error;
      })
      .finally(() => {
        authTask = undefined;
        authController = undefined;
        if (success) launch();
      });
    return authTask;
  }
  function runOnce(input = {}) {
    if (desired || task || authTask || onceTask || stoppingTask)
      return Promise.reject(runnerError('busy'));
    const active = new AbortController();
    controller = active;
    onceTask = client.tick(input, active.signal).finally(() => {
      onceTask = undefined;
      if (controller === active) controller = undefined;
    });
    return onceTask;
  }
  return Object.freeze({
    status,
    start,
    stop,
    runOnce,
    unlock: (password) => authenticate((signal) => client.unlock(password, signal)),
    authorizeSession: (cookie) => authenticate((signal) => client.authorize(cookie, signal)),
  });
}
