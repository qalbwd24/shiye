import { createHash } from 'node:crypto';
import { createSharedMediaClient } from '../../../public/shared/shared-media-client.js';

const actions = new Set([
  'info',
  'read',
  'feed',
  'feed-item/read',
  'context',
  'send',
  'withdraw',
  'media/read',
  'media/begin',
  'media/chunk',
  'media/complete',
]);
const fail = (code) => {
  throw Object.assign(Error(code), { code });
};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
/** Server-only fixed service client. Token remains in this closure, never in a
 * public config/seed/actor or result. The worker owns durable intent IDs; this
 * transport neither retries unknown writes nor executes a model/installer.
 */
export function createBackendProgramClient({
  baseUrl,
  token,
  libraryId,
  epoch,
  fetchImpl = fetch,
  timeoutMs = 30000,
  onRequest = () => {},
}) {
  let base;
  try {
    base = new URL(baseUrl);
  } catch {
    fail('PROGRAM_INVALID_CLIENT_OPTIONS');
  }
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    (base.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) ||
    !/^[a-f0-9]{64}$/.test(token || '') ||
    typeof fetchImpl !== 'function' ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 120000
  )
    fail('PROGRAM_INVALID_CLIENT_OPTIONS');
  const root = base.href.replace(/\/$/, '') + '/api/shared/v1/program/',
    active = new Set();
  let disposed = false;
  async function request(action, input = {}) {
    if (disposed) fail('PROGRAM_CLIENT_DISPOSED');
    if (
      !actions.has(action) ||
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      ['actorId', 'actor', 'sender', 'providerId', 'sourceKind'].some((key) =>
        Object.hasOwn(input, key),
      )
    )
      fail('PROGRAM_INVALID_CLIENT_ACTION');
    const body = JSON.stringify(input);
    if (Buffer.byteLength(body) > 2 * 1024 * 1024) fail('PROGRAM_REQUEST_TOO_LARGE');
    onRequest(action);
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    active.add(controller);
    try {
      const response = await fetchImpl(root + action, {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-Diary-Client': 'desktop',
          Authorization: 'Bearer ' + token,
        },
        body,
      });
      const reader = response.body?.getReader();
      if (!reader) fail('PROGRAM_INVALID_RESPONSE');
      const chunks = [];
      let size = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > 1024 * 1024) fail('PROGRAM_RESPONSE_TOO_LARGE');
          chunks.push(part.value);
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      let value;
      try {
        value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
      } catch {
        fail('PROGRAM_INVALID_RESPONSE');
      }
      if (!response.ok)
        throw Object.assign(Error(value.error?.code || 'PROGRAM_REQUEST_REJECTED'), {
          code: value.error?.code || 'PROGRAM_REQUEST_REJECTED',
          status: response.status,
        });
      return value;
    } finally {
      clearTimeout(timer);
      active.delete(controller);
    }
  }
  async function hydrate(row) {
    if (!row?.payload) return row;
    const payload = row.payload;
    if (
      payload.version !== 1 ||
      payload.kind !== 'shared-feed-item-json' ||
      payload.conversationId !== row.conversationId ||
      payload.messageId !== row.id ||
      !Number.isSafeInteger(payload.byteLength) ||
      payload.byteLength < 1 ||
      payload.byteLength > 64 * 1024 * 1024 ||
      !/^[a-f0-9]{64}$/.test(payload.sha256 || '')
    )
      fail('PROGRAM_INVALID_FEED_PAYLOAD');
    const bytes = Buffer.alloc(payload.byteLength);
    let offset = 0;
    while (offset < bytes.length) {
      const part = await request('feed-item/read', {
        payload,
        offset,
        length: Math.min(256 * 1024, bytes.length - offset),
      });
      if (
        !same(part.payload, payload) ||
        part.offset !== offset ||
        typeof part.bytesBase64 !== 'string' ||
        part.bytesBase64.length > 350000 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(part.bytesBase64)
      )
        fail('PROGRAM_INVALID_FEED_CHUNK');
      const chunk = Buffer.from(part.bytesBase64, 'base64');
      if (
        !chunk.length ||
        chunk.length > 256 * 1024 ||
        offset + chunk.length > bytes.length ||
        part.next !== offset + chunk.length ||
        part.done !== (part.next === bytes.length) ||
        hash(chunk) !== part.chunkSha256
      )
        fail('PROGRAM_INVALID_FEED_CHUNK');
      bytes.set(chunk, offset);
      offset = part.next;
    }
    if (hash(bytes) !== payload.sha256) fail('PROGRAM_FEED_HASH_MISMATCH');
    const full = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (
      full.id !== row.id ||
      full.conversationId !== row.conversationId ||
      full.state !== row.state ||
      full.kind !== row.kind
    )
      fail('PROGRAM_INVALID_FEED_PAYLOAD');
    return full;
  }
  return {
    request,
    info: () => request('info'),
    read: () => request('read'),
    async feed(input = {}) {
      const page = await request('feed', input),
        messages = [];
      for (const row of page.messages || []) messages.push(await hydrate(row));
      return { ...page, messages };
    },
    context: (input) => request('context', input),
    send: (input) => request('send', input),
    withdraw: (input) => request('withdraw', input),
    media() {
      if (!libraryId || !epoch) fail('PROGRAM_MEDIA_IDENTITY_REQUIRED');
      return createSharedMediaClient({
        libraryId,
        epoch,
        request: (action, input) => request(action.replace('media-', 'media/'), input),
      });
    },
    dispose() {
      disposed = true;
      for (const controller of active) controller.abort();
    },
  };
}
