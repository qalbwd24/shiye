// Streaming SHA-256 also works on phone HTTP/LAN pages without crypto.subtle.
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const rotate = (value, n) => (value >>> n) | (value << (32 - n));
export class Sha256 {
  constructor() {
    this.state = new Uint32Array([
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
      0x5be0cd19,
    ]);
    this.pending = new Uint8Array(64);
    this.used = 0;
    this.size = 0;
    this.words = new Uint32Array(64);
  }
  block(bytes, offset) {
    const w = this.words;
    for (let i = 0; i < 16; i++) {
      const p = offset + i * 4;
      w[i] = (bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3];
    }
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15],
        b = w[i - 2];
      const s0 = rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3);
      const s1 = rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = this.state;
    for (let i = 0; i < 64; i++) {
      const s1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
      const t1 = (h + s1 + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const s0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
      const t2 = (s0 + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    for (const [i, value] of [a, b, c, d, e, f, g, h].entries())
      this.state[i] = (this.state[i] + value) >>> 0;
  }
  update(bytes) {
    this.size += bytes.length;
    let offset = 0;
    if (this.used) {
      const length = Math.min(64 - this.used, bytes.length);
      this.pending.set(bytes.subarray(0, length), this.used);
      this.used += length;
      offset += length;
      if (this.used === 64) {
        this.block(this.pending, 0);
        this.used = 0;
      }
    }
    while (offset + 64 <= bytes.length) {
      this.block(bytes, offset);
      offset += 64;
    }
    if (offset < bytes.length) {
      this.pending.set(bytes.subarray(offset));
      this.used = bytes.length - offset;
    }
    return this;
  }
  digest() {
    const ending = new Uint8Array(this.used < 56 ? 64 : 128);
    ending.set(this.pending.subarray(0, this.used));
    ending[this.used] = 0x80;
    const view = new DataView(ending.buffer);
    view.setUint32(ending.length - 8, Math.floor(this.size / 0x20000000));
    view.setUint32(ending.length - 4, (this.size * 8) >>> 0);
    for (let i = 0; i < ending.length; i += 64) this.block(ending, i);
    return Array.from(this.state, (value) => value.toString(16).padStart(8, '0')).join('');
  }
}
export const sha256Bytes = (bytes) => new Sha256().update(asBytes(bytes)).digest();
function asBytes(bytes) {
  if (bytes instanceof Uint8Array) return bytes;
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  if (ArrayBuffer.isView(bytes))
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  throw new TypeError('Original bytes, Blob or File are required');
}
function sourceOf(source) {
  if (source && typeof source.slice === 'function' && typeof source.arrayBuffer === 'function') {
    return {
      size: source.size,
      type: source.type,
      name: source.name,
      read: async (start, end) => new Uint8Array(await source.slice(start, end).arrayBuffer()),
    };
  }
  const bytes = asBytes(source);
  return { size: bytes.byteLength, read: async (start, end) => bytes.subarray(start, end) };
}
function abort(signal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
}
function endpoint(baseUrl, suffix) {
  const base = String(baseUrl).replace(/\/$/, '');
  if (!/^https?:\/\//i.test(base)) throw new TypeError('An HTTP(S) sync baseUrl is required');
  const url = new URL(base);
  if (url.username || url.password || url.search || url.hash)
    throw new TypeError('Credentials and query parameters are not allowed in baseUrl');
  return `${base}/api/sync/v1${suffix}`;
}
async function request(url, { token, signal, fetchImpl, retries, ...options }) {
  for (let attempt = 0; ; attempt++) {
    abort(signal);
    let response;
    try {
      response = await fetchImpl(url, {
        ...options,
        signal,
        headers: { ...options.headers, Authorization: `Bearer ${token}` },
      });
    } catch (error) {
      abort(signal);
      if (attempt >= retries) throw error;
      continue;
    }
    if (response.ok) return response;
    if ((response.status === 429 || response.status >= 500) && attempt < retries) continue;
    const error = new Error(`Media request failed (${response.status})`);
    error.statusCode = response.status;
    // Do not echo response bodies, which can contain private metadata.
    throw error;
  }
}
const jsonBody = (value) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(value),
});

export async function uploadAsset({
  baseUrl,
  token,
  file,
  blob,
  bytes,
  assetId,
  name,
  mime,
  onProgress,
  signal,
  fetchImpl = globalThis.fetch,
  retries = 2,
} = {}) {
  const source = sourceOf(file ?? blob ?? bytes);
  if (!assetId || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(assetId))
    throw new TypeError('A stable assetId is required for resumable upload');
  const hash = new Sha256();
  for (let offset = 0; offset < source.size; offset += 1048576) {
    abort(signal);
    hash.update(await source.read(offset, Math.min(source.size, offset + 1048576)));
  }
  const sha256 = hash.digest();
  const common = { token, signal, fetchImpl, retries };
  const begin = await request(endpoint(baseUrl, '/media/uploads'), {
    ...common,
    ...jsonBody({
      assetId,
      sha256,
      size: source.size,
      mime: mime ?? (source.type || 'application/octet-stream'),
      name: name ?? source.name ?? '',
    }),
  });
  const state = await begin.json();
  if (
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(state.uploadId) ||
    state.assetId !== assetId ||
    state.sha256 !== sha256 ||
    state.size !== source.size ||
    !Number.isSafeInteger(state.chunkSize) ||
    state.chunkSize < 1 ||
    !Array.isArray(state.missingChunks) ||
    state.missingChunks.some(
      (index) =>
        !Number.isSafeInteger(index) ||
        index < 0 ||
        index >= Math.ceil(source.size / state.chunkSize),
    ) ||
    new Set(state.missingChunks).size !== state.missingChunks.length
  )
    throw new Error('Invalid upload status');
  let transferred =
    source.size -
    state.missingChunks.reduce(
      (total, index) => total + Math.min(state.chunkSize, source.size - index * state.chunkSize),
      0,
    );
  onProgress?.({ assetId, uploadId: state.uploadId, transferred, total: source.size });
  for (const index of state.missingChunks) {
    abort(signal);
    const chunk = await source.read(
      index * state.chunkSize,
      Math.min(source.size, (index + 1) * state.chunkSize),
    );
    await request(
      endpoint(baseUrl, `/media/uploads/${encodeURIComponent(state.uploadId)}/chunks/${index}`),
      {
        ...common,
        method: 'PUT',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Chunk-Sha256': sha256Bytes(chunk),
        },
        body: chunk,
      },
    );
    transferred += chunk.byteLength;
    onProgress?.({ assetId, uploadId: state.uploadId, transferred, total: source.size });
  }
  const complete = await request(
    endpoint(baseUrl, `/media/uploads/${encodeURIComponent(state.uploadId)}/complete`),
    { ...common, ...jsonBody({}) },
  );
  const result = await complete.json();
  if (result.sha256 !== sha256 || result.size !== source.size || result.assetId !== assetId)
    throw new Error('Uploaded original receipt does not match');
  return result;
}

export async function downloadAsset({
  baseUrl,
  token,
  assetId,
  sha256,
  signal,
  onProgress,
  fetchImpl = globalThis.fetch,
  retries = 2,
} = {}) {
  if (!assetId || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(assetId))
    throw new TypeError('Invalid assetId');
  const common = { token, signal, fetchImpl, retries };
  const response = await request(
    endpoint(baseUrl, `/media/assets/${encodeURIComponent(assetId)}`),
    common,
  );
  const asset = await response.json();
  if (
    !Number.isSafeInteger(asset.size) ||
    asset.size < 1 ||
    asset.assetId !== assetId ||
    !/^[a-f0-9]{64}$/i.test(asset.sha256) ||
    (sha256 && sha256.toLowerCase() !== asset.sha256)
  )
    throw new Error('Original metadata does not match');
  const bytes = new Uint8Array(asset.size);
  for (let offset = 0; offset < asset.size; offset += 262144) {
    abort(signal);
    const end = Math.min(asset.size - 1, offset + 262143);
    let chunk;
    for (let attempt = 0; ; attempt++) {
      try {
        const chunkResponse = await request(
          endpoint(baseUrl, `/media/assets/${encodeURIComponent(assetId)}/content`),
          { ...common, retries: 0, headers: { Range: `bytes=${offset}-${end}` } },
        );
        chunk = new Uint8Array(await chunkResponse.arrayBuffer());
        if (chunk.byteLength !== end - offset + 1)
          throw new Error('Downloaded original range has invalid size');
        break;
      } catch (error) {
        abort(signal);
        if (
          attempt >= retries ||
          (error.statusCode && error.statusCode !== 429 && error.statusCode < 500)
        )
          throw error;
      }
    }
    bytes.set(chunk, offset);
    onProgress?.({ assetId, transferred: end + 1, total: asset.size });
  }
  if (sha256Bytes(bytes) !== asset.sha256)
    throw new Error('Downloaded original failed SHA-256 verification');
  return bytes;
}
