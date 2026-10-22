import { Sha256, sha256Bytes } from './sync-v2-media.js';
const CHUNK = 256 * 1024;
const fail = (code) => {
  throw Object.assign(new Error(code), { code });
};
const b64 = (bytes) => {
  let value = '';
  for (let i = 0; i < bytes.length; i += 8192)
    value += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(value);
};
const decode = (value) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
/** Fixed native request port; streaming source/sink keep whole originals out of
 * the JSON business replica. Persist operationId and sink checkpoint to resume.
 */
export function createSharedMediaClient({ request, libraryId, epoch } = {}) {
  if (typeof request !== 'function' || !libraryId || !epoch) fail('SHARED_INVALID_MEDIA_OPTIONS');
  async function call(action, input) {
    const result = await request('media-' + action, { libraryId, epoch, ...input });
    if (result.info?.libraryId !== libraryId || result.info?.epoch !== epoch)
      fail('SHARED_LIBRARY_MISMATCH');
    return result;
  }
  function sourceOf(file) {
    if (
      !file ||
      !Number.isSafeInteger(file.size) ||
      file.size < 1 ||
      file.size > 16 * 1024 ** 3 ||
      typeof file.slice !== 'function'
    )
      fail('SHARED_INVALID_ORIGINAL');
    return {
      size: file.size,
      name: file.name || '附件',
      mime: file.type || 'application/octet-stream',
      read: async (start, end) => new Uint8Array(await file.slice(start, end).arrayBuffer()),
    };
  }
  async function upload(file, { operationId, onProgress, signal } = {}) {
    if (
      typeof operationId !== 'string' ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(operationId)
    )
      fail('SHARED_OPERATION_ID_REQUIRED');
    const source = sourceOf(file),
      hash = new Sha256();
    const active = () => {
      if (signal?.aborted) throw signal.reason || new Error('SHARED_CANCELLED');
    };
    for (let offset = 0; offset < source.size; offset += CHUNK) {
      active();
      hash.update(await source.read(offset, Math.min(source.size, offset + CHUNK)));
    }
    const metadata = {
      name: source.name,
      mime: source.mime,
      size: source.size,
      sha256: hash.digest(),
    };
    const begin = await call('begin', { operationId, metadata });
    let offset = begin.next;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > source.size)
      fail('SHARED_INVALID_MEDIA_ACK');
    while (offset < source.size) {
      active();
      const bytes = await source.read(offset, Math.min(source.size, offset + CHUNK));
      const reply = await call('chunk', {
        operationId,
        offset,
        bytesBase64: b64(bytes),
        chunkSha256: sha256Bytes(bytes),
      });
      if (
        !Number.isSafeInteger(reply.next) ||
        reply.next < offset + bytes.length ||
        reply.next > source.size
      )
        fail('SHARED_INVALID_MEDIA_ACK');
      offset = reply.next;
      onProgress?.({ transferred: offset, total: source.size });
    }
    active();
    const result = begin.complete ? begin : await call('complete', { operationId });
    if (
      !result.complete ||
      result.asset?.sha256 !== metadata.sha256 ||
      result.asset?.size !== metadata.size
    )
      fail('SHARED_MEDIA_HASH_MISMATCH');
    return result.asset;
  }
  async function download(asset, { sink, onProgress, signal } = {}) {
    if (
      !asset?.id ||
      !Number.isSafeInteger(asset.size) ||
      asset.size < 1 ||
      !/^[a-f0-9]{64}$/.test(asset.sha256 || '')
    )
      fail('SHARED_INVALID_ORIGINAL');
    // A resumed sink provides read() so verification covers already committed bytes.
    if (!sink?.write || !sink?.read || !sink?.finish) fail('SHARED_MEDIA_SINK_REQUIRED');
    const checkpoint = (await sink.checkpoint?.(asset)) || 0;
    if (!Number.isSafeInteger(checkpoint) || checkpoint < 0 || checkpoint > asset.size)
      fail('SHARED_INVALID_MEDIA_CHECKPOINT');
    const hash = new Sha256();
    for (let offset = 0; offset < checkpoint; offset += CHUNK) {
      const bytes = await sink.read(offset, Math.min(checkpoint, offset + CHUNK));
      if (bytes.length !== Math.min(CHUNK, checkpoint - offset))
        fail('SHARED_MEDIA_CHECKPOINT_CHANGED');
      hash.update(bytes);
    }
    for (let offset = checkpoint; offset < asset.size;) {
      if (signal?.aborted) throw signal.reason || new Error('SHARED_CANCELLED');
      const value = await call('read', {
          assetId: asset.id,
          offset,
          length: Math.min(CHUNK, asset.size - offset),
        }),
        bytes = decode(value.bytesBase64);
      if (
        value.asset?.sha256 !== asset.sha256 ||
        value.asset?.size !== asset.size ||
        value.offset !== offset ||
        value.next !== offset + bytes.length ||
        bytes.length !== Math.min(CHUNK, asset.size - offset) ||
        sha256Bytes(bytes) !== value.chunkSha256
      )
        fail('SHARED_MEDIA_HASH_MISMATCH');
      await sink.write(offset, bytes);
      hash.update(bytes);
      offset = value.next;
      await sink.saveCheckpoint?.(offset, asset);
      onProgress?.({ transferred: offset, total: asset.size });
    }
    if (hash.digest() !== asset.sha256) fail('SHARED_MEDIA_HASH_MISMATCH');
    return sink.finish(asset);
  }
  return { upload, download };
}
