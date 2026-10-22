import { sha256Bytes } from './sync-v2-media.js';
const LIMIT = 34 * 1024 * 1024,
  CHUNK = 128 * 1024;
const fail = (code) => {
  throw Object.assign(Error(code), { code });
};
const b64 = (bytes) => {
  let value = '';
  for (let offset = 0; offset < bytes.length; offset += 8192)
    value += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(value);
};
/** request(action,payload) carries only fixed small host messages. The 34 MiB
 * envelope is assembled in private native staging, never the renderer outer JSON.
 * Ordinary business requests retain their existing transport and limits. */
export function createChunkedSharedSeedRequest({ request } = {}) {
  if (typeof request !== 'function') fail('SHARED_SEED_WIRE_PORT_REQUIRED');
  return async (method, input, { signal } = {}) => {
    if (!['seed-register', 'seed-resolve'].includes(method))
      fail('SHARED_SEED_WIRE_METHOD_FORBIDDEN');
    const bytes = new TextEncoder().encode(JSON.stringify(input));
    if (bytes.length < 2 || bytes.length > LIMIT) fail('SHARED_SEED_WIRE_TOO_LARGE');
    const active = () => {
      if (signal?.aborted) fail('SHARED_SEED_CANCELLED');
    };
    active();
    let token;
    try {
      const begin = await request('shared-seed-wire-begin', {
        method,
        byteLength: bytes.length,
        sha256: sha256Bytes(bytes),
      });
      token = begin?.token;
      if (
        typeof token !== 'string' ||
        !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(token) ||
        begin.maxChunkBytes < CHUNK
      )
        fail('SHARED_SEED_WIRE_INVALID_ACK');
      for (let offset = 0; offset < bytes.length; offset += CHUNK) {
        active();
        const part = bytes.subarray(offset, Math.min(bytes.length, offset + CHUNK));
        const ack = await request('shared-seed-wire-chunk', {
          token,
          offset,
          bytesBase64: b64(part),
          chunkSha256: sha256Bytes(part),
        });
        if (ack.next !== offset + part.length) fail('SHARED_SEED_WIRE_INVALID_ACK');
      }
      active();
      return await request('shared-seed-wire-finish', { token });
    } finally {
      if (token) await request('shared-seed-wire-cancel', { token }).catch(() => {});
    }
  };
}
