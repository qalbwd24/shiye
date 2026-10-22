const SESSION = /^(?:diary_session=)?([a-f0-9]{64})$/;

export function runnerError(code, { status, retryable = false, retryAfterMs } = {}) {
  return Object.assign(new Error(code), { code, status, retryable, retryAfterMs });
}

export function localRunnerUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw runnerError('invalid_url');
  }
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    !url.port ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw runnerError('invalid_url');
  url.hostname = '127.0.0.1';
  return url;
}

function httpError(response) {
  const status = response.status;
  const seconds = Number(response.headers.get('retry-after'));
  const date = Date.parse(response.headers.get('retry-after') || '');
  const retryAfterValue =
    Number.isFinite(seconds) && response.headers.has('retry-after')
      ? Math.max(0, seconds * 1000)
      : Number.isFinite(date)
        ? Math.max(0, date - Date.now())
        : undefined;
  const retryAfterMs =
    retryAfterValue === undefined ? undefined : Math.min(86400000, retryAfterValue);
  const code =
    status === 401
      ? 'locked'
      : status === 403
        ? 'forbidden'
        : [404, 405].includes(status)
          ? 'unsupported'
          : status === 429
            ? 'rate_limited'
            : status >= 500
              ? 'server_error'
              : 'invalid_request';
  return runnerError(code, { status, retryable: status === 429 || status >= 500, retryAfterMs });
}

/** Fixed local endpoints only. Passwords/cookies never appear in status, errors or files. */
export function createRevisitHttpClient({ url, fetchImpl = fetch, timeoutMs = 15000, instanceId }) {
  const base = localRunnerUrl(url);
  if (
    instanceId !== undefined &&
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(instanceId)
  )
    throw runnerError('invalid_session');
  if (!Number.isFinite(timeoutMs) || timeoutMs < 10 || timeoutMs > 120000)
    throw runnerError('invalid_timeout');
  let session = '',
    generation = 0;
  async function request(endpoint, method = 'GET', payload, signal, acceptCookie = false) {
    const epoch = generation;
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const scopedEndpoint =
        instanceId && endpoint === 'api/revisit/tick'
          ? `api/conversation-services/instances/${instanceId}/revisit/tick`
          : endpoint;
      const response = await fetchImpl(new URL(scopedEndpoint, base), {
        method,
        redirect: 'manual',
        signal: combined,
        headers: {
          'X-Diary-Client': 'desktop',
          'Content-Type': 'application/json',
          ...(session ? { Cookie: 'diary_session=' + session } : {}),
        },
        ...(method === 'GET' ? {} : { body: JSON.stringify(payload || {}) }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw httpError(response);
      }
      if (!response.body) throw runnerError('invalid_response');
      let size = 0,
        text = '';
      const decoder = new TextDecoder();
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 1024 * 1024) throw runnerError('invalid_response');
        text += decoder.decode(chunk, { stream: true });
      }
      text += decoder.decode();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw runnerError('invalid_response');
      }
      if (!data || typeof data !== 'object' || Array.isArray(data))
        throw runnerError('invalid_response');
      if (combined.aborted || epoch !== generation) throw runnerError('aborted');
      if (acceptCookie) {
        const cookie = response.headers
          .get('set-cookie')
          ?.match(/(?:^|;\s*)diary_session=([a-f0-9]{64})(?:;|$)/)?.[1];
        if (!cookie) throw runnerError('invalid_response');
        session = cookie;
      }
      return data;
    } catch (error) {
      if (signal?.aborted || epoch !== generation) throw runnerError('aborted');
      if (timeout.aborted) throw runnerError('timeout', { retryable: true });
      if (
        error.code &&
        [
          'locked',
          'forbidden',
          'unsupported',
          'rate_limited',
          'server_error',
          'invalid_request',
          'invalid_response',
          'aborted',
        ].includes(error.code)
      )
        throw error;
      throw runnerError('offline', { retryable: true });
    }
  }
  const clearSession = () => {
    session = '';
    generation++;
  };
  function adoptSession(cookie) {
    if (!cookie) {
      clearSession();
      return;
    }
    const token = SESSION.exec(cookie)?.[1];
    if (!token) throw runnerError('invalid_session');
    clearSession();
    session = token;
  }
  async function access(signal) {
    const value = await request('api/access', 'GET', undefined, signal);
    if (typeof value.enabled !== 'boolean' || typeof value.unlocked !== 'boolean')
      throw runnerError('invalid_response');
    return value;
  }
  return Object.freeze({
    clearSession,
    adoptSession,
    async authorize(cookie, signal) {
      adoptSession(cookie);
      const status = await access(signal);
      if (!status.unlocked) {
        clearSession();
        throw runnerError('locked', { status: 401 });
      }
    },
    async unlock(password, signal) {
      if (typeof password !== 'string' || password.length < 8 || password.length > 200)
        throw runnerError('invalid_password');
      const status = await access(signal);
      if (status.unlocked) return;
      await request('api/unlock', 'POST', { password }, signal, true);
    },
    async tick(input = {}, signal) {
      const value = await request('api/revisit/tick', 'POST', input, signal);
      if (
        !Number.isSafeInteger(value.created) ||
        value.created < 0 ||
        (value.initialized !== undefined && typeof value.initialized !== 'boolean') ||
        (value.remaining !== undefined && typeof value.remaining !== 'boolean') ||
        (value.disabled !== undefined && typeof value.disabled !== 'boolean') ||
        (value.cursor !== null &&
          value.cursor !== undefined &&
          (typeof value.cursor !== 'string' || !Number.isFinite(Date.parse(value.cursor))))
      )
        throw runnerError('invalid_response');
      return {
        created: value.created,
        initialized: !!value.initialized,
        disabled: !!value.disabled,
        remaining: !!value.remaining,
        reviewCount: Array.isArray(value.issues) ? value.issues.length : 0,
        cursor: value.cursor || null,
      };
    },
  });
}
