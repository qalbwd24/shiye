const LIMIT = 64 * 1024 * 1024;
const mediaSinkFail = (code) => {
  throw Object.assign(Error(code), { code });
};
/** Bounded whole-Blob sink. Larger originals require a caller-supplied persistent streaming sink. */
export function createBoundedBlobSink(asset, { urlFactory = globalThis.URL } = {}) {
  if (!Number.isSafeInteger(asset?.size) || asset.size < 1 || asset.size > LIMIT)
    mediaSinkFail('SHARED_NATIVE_MEDIA_SINK_REQUIRED');
  const chunks = [];
  let length = 0;
  return {
    checkpoint: async () => 0,
    async write(offset, bytes) {
      if (offset !== length || length + bytes.length > asset.size || length + bytes.length > LIMIT)
        mediaSinkFail('SHARED_INVALID_MEDIA_RANGE');
      chunks.push(new Uint8Array(bytes));
      length += bytes.length;
    },
    async read(start, end) {
      const joined = new Uint8Array(length);
      let offset = 0;
      for (const bytes of chunks) {
        joined.set(bytes, offset);
        offset += bytes.length;
      }
      return joined.slice(start, end);
    },
    async finish() {
      if (length !== asset.size) mediaSinkFail('SHARED_MEDIA_INCOMPLETE');
      const blob = new Blob(chunks, {
        type: asset.type || asset.mime || 'application/octet-stream',
      });
      return { blob, mime: blob.type, name: asset.name, url: urlFactory?.createObjectURL?.(blob) };
    },
  };
}
