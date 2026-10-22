import { downloadAsset, sha256Bytes, uploadAsset } from './sync-v2-media.js';

const validId = (value) =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
const now = () => new Date().toISOString();
const localId = () => {
  const random = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(random);
  else
    for (let index = 0; index < random.length; index++)
      random[index] = Math.floor(Math.random() * 256);
  return `asset-${Date.now().toString(36)}-${Array.from(random, (value) => value.toString(16).padStart(2, '0')).join('')}`;
};
const summary = (record) => ({
  ...record.metadata,
  uploadState: record.uploadState,
  downloadState: record.downloadState,
  localOriginal: record.downloadState === 'complete',
  error: record.error ?? null,
});
const conflict = () =>
  Object.assign(new Error('Asset ID already identifies different original bytes'), {
    code: 'ASSET_ID_CONFLICT',
    statusCode: 409,
  });
const errorCode = (error) =>
  Number.isInteger(error.statusCode) ? `HTTP_${error.statusCode}` : 'TRANSFER_FAILED';

/** An independent original/task database. Credentials and object URLs are never persisted. */
export async function createSyncMediaCache({
  dbName = 'shiye-sync-v2-media-cache',
  indexedDB = globalThis.indexedDB,
  baseUrl = '',
  token = '',
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof dbName !== 'string' || !/^shiye-sync-v2-[A-Za-z0-9_-]{1,120}$/.test(dbName))
    throw new TypeError('Media cache requires an isolated shiye-sync-v2- database name');
  if (!indexedDB?.open) throw new Error('IndexedDB is required for durable original storage');
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => {
      const records = request.result.createObjectStore('records', { keyPath: 'assetId' });
      records.createIndex('uploadState', 'uploadState');
      records.createIndex('downloadState', 'downloadState');
      request.result.createObjectStore('originals', { keyPath: 'assetId' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Media cache upgrade is blocked by another tab'));
  });
  let connection = { baseUrl, token };
  let closing = false;
  let closed = false;
  let syncQueue = Promise.resolve();
  const controller = new AbortController();
  function active() {
    if (closing || closed) throw new Error('Media cache is closed');
  }
  function transaction(names, mode, work) {
    return new Promise((resolve, reject) => {
      let result, failure;
      const tx = db.transaction(names, mode);
      const set = (value) => {
        result = value;
      };
      const safe = (callback) => (event) => {
        try {
          callback(event);
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(failure || tx.error || new Error('Media cache transaction failed'));
      try {
        work(tx, set, safe);
      } catch (error) {
        failure = error;
        tx.abort();
      }
    });
  }
  function records(index, value) {
    return transaction(['records'], 'readonly', (tx, set) => {
      const store = tx.objectStore('records');
      const request = index ? store.index(index).getAll(value) : store.getAll();
      request.onsuccess = () => set(request.result);
    });
  }
  function change(assetId, apply) {
    return transaction(['records'], 'readwrite', (tx, set, safe) => {
      const store = tx.objectStore('records');
      const request = store.get(assetId);
      request.onsuccess = safe(() => {
        const record = apply(request.result);
        if (record) {
          store.put(record);
          set(record);
        }
      });
    });
  }
  async function status() {
    const all = await records();
    return {
      total: all.length,
      localOriginals: all.filter((record) => record.downloadState === 'complete').length,
      pendingUploads: all.filter((record) => record.uploadState === 'pending').length,
      pendingDownloads: all.filter((record) => record.downloadState === 'pending').length,
      failed: all.filter((record) => record.error).length,
      items: all.map(summary),
    };
  }
  async function get(assetId) {
    if (!validId(assetId)) throw new TypeError('Invalid assetId');
    return transaction(['records', 'originals'], 'readonly', (tx, set, safe) => {
      const recordRequest = tx.objectStore('records').get(assetId);
      recordRequest.onsuccess = safe(() => {
        const record = recordRequest.result;
        if (!record) {
          set(null);
          return;
        }
        const original = tx.objectStore('originals').get(assetId);
        original.onsuccess = () => set({ ...summary(record), blob: original.result?.blob ?? null });
      });
    });
  }
  async function queueRemote(input) {
    if (input?.entityType && input.entityType !== 'asset') return;
    if (input?.state && input.state !== 'active') return;
    const asset = input?.data ?? input;
    if (!asset || asset.available === false) return;
    const assetId = asset.assetId ?? input.entityId;
    if (
      !validId(assetId) ||
      !/^[a-f0-9]{64}$/.test(asset.sha256) ||
      !Number.isSafeInteger(asset.size) ||
      asset.size < 1 ||
      asset.size > 536870912 ||
      typeof asset.mime !== 'string'
    )
      throw new TypeError('Invalid remote original metadata');
    await change(assetId, (old) => {
      if (old && (old.metadata.sha256 !== asset.sha256 || old.metadata.size !== asset.size))
        return { ...old, error: 'ASSET_ID_CONFLICT', updatedAt: now() };
      if (old) return old;
      return {
        assetId,
        metadata: {
          assetId,
          sha256: asset.sha256,
          size: asset.size,
          mime: asset.mime,
          name: asset.name ?? '',
          available: true,
        },
        uploadState: 'none',
        downloadState: 'pending',
        error: null,
        updatedAt: now(),
      };
    });
  }
  async function transfer(assets) {
    for (const asset of assets) await queueRemote(asset);
    const uploads = await records('uploadState', 'pending');
    for (const record of uploads) {
      if (closing) break;
      try {
        if (!connection.baseUrl || !connection.token) {
          await change(record.assetId, (old) => ({ ...old, error: 'CONNECTION_REQUIRED' }));
          continue;
        }
        const local = await get(record.assetId);
        if (!local?.blob) throw new Error('Local original is missing');
        const receipt = await uploadAsset({
          ...connection,
          fetchImpl,
          assetId: record.assetId,
          blob: local.blob,
          name: record.metadata.name,
          mime: record.metadata.mime,
          signal: controller.signal,
        });
        if (receipt.sha256 !== record.metadata.sha256 || receipt.size !== record.metadata.size)
          throw conflict();
        await change(record.assetId, (old) => ({
          ...old,
          metadata: { ...old.metadata, available: true },
          uploadState: 'complete',
          error: null,
          updatedAt: now(),
        }));
      } catch (error) {
        if (!closing)
          await change(record.assetId, (old) => ({
            ...old,
            error: errorCode(error),
            updatedAt: now(),
          }));
      }
    }
    const downloads = await records('downloadState', 'pending');
    for (const record of downloads) {
      if (closing) break;
      try {
        if (!connection.baseUrl || !connection.token) {
          await change(record.assetId, (old) => ({ ...old, error: 'CONNECTION_REQUIRED' }));
          continue;
        }
        const bytes = await downloadAsset({
          ...connection,
          fetchImpl,
          assetId: record.assetId,
          sha256: record.metadata.sha256,
          signal: controller.signal,
        });
        if (bytes.byteLength !== record.metadata.size)
          throw new Error('Original size does not match');
        // Network and hashing finish before the atomic local original/task transaction starts.
        const blob = new Blob([bytes], { type: record.metadata.mime });
        await transaction(['records', 'originals'], 'readwrite', (tx, set, safe) => {
          const store = tx.objectStore('records');
          const request = store.get(record.assetId);
          request.onsuccess = safe(() => {
            const old = request.result;
            if (!old || old.metadata.sha256 !== record.metadata.sha256) throw conflict();
            tx.objectStore('originals').put({ assetId: record.assetId, blob });
            store.put({ ...old, downloadState: 'complete', error: null, updatedAt: now() });
            set(true);
          });
        });
      } catch (error) {
        if (!closing)
          await change(record.assetId, (old) => ({
            ...old,
            error: errorCode(error),
            updatedAt: now(),
          }));
      }
    }
    return status();
  }
  return {
    async add(file, { assetId = localId() } = {}) {
      active();
      if (!validId(assetId)) throw new TypeError('Invalid assetId');
      if (
        !file ||
        typeof file.arrayBuffer !== 'function' ||
        !Number.isSafeInteger(file.size) ||
        file.size < 1 ||
        file.size > 536870912
      )
        throw new TypeError('A nonempty File or Blob up to 512 MiB is required');
      const blob = file.slice(0, file.size, file.type || 'application/octet-stream');
      const metadata = {
        assetId,
        sha256: sha256Bytes(new Uint8Array(await blob.arrayBuffer())),
        size: blob.size,
        mime: blob.type,
        name: file.name ?? '',
        available: false,
      };
      active();
      const record = await transaction(['records', 'originals'], 'readwrite', (tx, set, safe) => {
        const store = tx.objectStore('records');
        const request = store.get(assetId);
        request.onsuccess = safe(() => {
          const old = request.result;
          if (
            old &&
            (old.metadata.sha256 !== metadata.sha256 || old.metadata.size !== metadata.size)
          )
            throw conflict();
          const next = {
            assetId,
            metadata: old?.metadata ?? metadata,
            uploadState: old?.metadata.available ? 'complete' : 'pending',
            downloadState: 'complete',
            error: null,
            updatedAt: now(),
          };
          tx.objectStore('originals').put({ assetId, blob });
          store.put(next);
          set(next);
        });
      });
      return summary(record);
    },
    sync(assets = []) {
      active();
      if (!Array.isArray(assets))
        return Promise.reject(new TypeError('Remote assets must be an array'));
      const result = syncQueue.then(() => transfer(assets));
      syncQueue = result.catch(() => {});
      return result;
    },
    get: (assetId) => {
      active();
      return get(assetId);
    },
    status: () => {
      active();
      return status();
    },
    setConnection(next = {}) {
      active();
      connection = {
        baseUrl: next.baseUrl ?? connection.baseUrl,
        token: next.token ?? connection.token,
      };
    },
    async close() {
      if (closed) return;
      closing = true;
      controller.abort();
      await syncQueue;
      db.close();
      closed = true;
      connection = { baseUrl: '', token: '' };
    },
  };
}
