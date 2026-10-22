import { normalizeSyncBaseUrl } from './sync-v2-client.js';

/** Fixed transport; caller owns a streamed file sink/source, job polling and local Repository. */
export function createProductSeedClient({
  baseUrl,
  token,
  fetchImpl = globalThis.fetch,
  timeoutMs = 30000,
} = {}) {
  const base = normalizeSyncBaseUrl(baseUrl);
  const id = (value) => {
    if (typeof value !== 'string' || !/^[a-f0-9-]{36}$/.test(value))
      throw new Error('INVALID_SEED_JOB');
    return value;
  };
  async function request(
    route,
    { method = 'GET', data, bytes, sha256, range, signal, stream = false } = {},
  ) {
    const credential = typeof token === 'function' ? await token() : token;
    if (typeof credential !== 'string' || !credential || /[\r\n]/.test(credential))
      throw new Error('AUTHENTICATION_REQUIRED');
    const timeout = AbortSignal.timeout(timeoutMs);
    const response = await fetchImpl(`${base}api/product/v1/seed/${route}`, {
      method,
      redirect: 'error',
      credentials: 'omit',
      signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
      headers: {
        Authorization: 'Bearer ' + credential,
        ...(data ? { 'Content-Type': 'application/json' } : {}),
        ...(bytes ? { 'Content-Type': 'application/octet-stream' } : {}),
        ...(sha256 ? { 'X-Chunk-Sha256': sha256 } : {}),
        ...(range ? { Range: range } : {}),
      },
      ...(data ? { body: JSON.stringify(data) } : bytes ? { body: bytes } : {}),
    });
    if (!response.ok) {
      const value = await response.json();
      throw Object.assign(new Error(value.error?.code || 'SEED_REQUEST_FAILED'), {
        status: response.status,
        code: value.error?.code || 'SEED_REQUEST_FAILED',
      });
    }
    return stream ? response : response.json();
  }
  return {
    createExport: (operationId, options) =>
      request('exports', { method: 'POST', data: { operationId }, ...options }),
    exportStatus: (jobId, options) => request(`exports/${id(jobId)}`, options),
    download: (jobId, options) =>
      request(`exports/${id(jobId)}/content`, { ...options, stream: true }),
    resolve: (input, options) => request('resolve', { method: 'POST', data: input, ...options }),
    createImport: (input, options) =>
      request('imports', { method: 'POST', data: input, ...options }),
    importStatus: (jobId, options) => request(`imports/${id(jobId)}`, options),
    uploadChunk: (jobId, index, bytes, options) => {
      if (!Number.isSafeInteger(index) || index < 0) throw new Error('INVALID_SEED_CHUNK');
      return request(`imports/${id(jobId)}/chunks/${index}`, { method: 'PUT', bytes, ...options });
    },
    commit: (jobId, options) =>
      request(`imports/${id(jobId)}/commit`, { method: 'POST', data: {}, ...options }),
  };
}
