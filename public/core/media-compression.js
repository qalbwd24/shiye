/** Local upload preprocessing only. Existing library media is never rewritten. */
export const IMAGE_COMPRESSION_PRESETS = Object.freeze({
  original: { label: '原图', longEdge: Infinity, quality: 1 },
  balanced: { label: '均衡', longEdge: 2048, quality: 0.6 },
  high: { label: '清晰', longEdge: 2560, quality: 0.82 },
});
const MAX_SOURCE_BYTES = 32 * 1024 * 1024;
const MAX_SOURCE_PIXELS = 40_000_000;
const text = (bytes, start, count) => String.fromCharCode(...bytes.subarray(start, start + count));

/** Keep EXIF date text as evidence. Missing offsets never become an invented UTC date. */
export function readExifCapture(bytes) {
  const empty = {};
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return empty;
  const all = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    for (let offset = 2, segments = 0; offset + 4 <= bytes.length && segments < 256; segments++) {
      if (bytes[offset++] !== 0xff) return empty;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) return empty;
      if (marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      const length = all.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) return empty;
      if (marker !== 0xe1 || text(bytes, offset + 2, 6) !== 'Exif\0\0') {
        offset += length;
        continue;
      }
      const start = offset + 8,
        end = offset + length;
      if (start + 8 > end) return empty;
      const endian = text(bytes, start, 2),
        little = endian === 'II';
      if (!little && endian !== 'MM') return empty;
      const view = new DataView(bytes.buffer, bytes.byteOffset + start, end - start);
      const within = (at, size) => at >= 0 && size >= 0 && at + size <= view.byteLength;
      if (view.getUint16(2, little) !== 42) return empty;
      const tags = new Map();
      function readIfd(at, allowExif = true) {
        if (!within(at, 2)) return;
        const count = view.getUint16(at, little);
        if (count > 512 || !within(at + 2, count * 12 + 4)) return;
        for (let i = 0; i < count; i++) {
          const entry = at + 2 + i * 12,
            tag = view.getUint16(entry, little),
            type = view.getUint16(entry + 2, little),
            size = view.getUint32(entry + 4, little);
          if (allowExif && tag === 0x8769 && type === 4 && size === 1)
            readIfd(view.getUint32(entry + 8, little), false);
          if (
            ![0x0132, 0x9003, 0x9010, 0x9011].includes(tag) ||
            type !== 2 ||
            size < 2 ||
            size > 64
          )
            continue;
          const valueAt = size <= 4 ? entry + 8 : view.getUint32(entry + 8, little);
          if (within(valueAt, size))
            tags.set(
              tag,
              text(bytes, start + valueAt, size)
                .replace(/\0.*$/, '')
                .trim(),
            );
        }
      }
      readIfd(view.getUint32(4, little));
      const original = tags.get(0x9003),
        raw = original || tags.get(0x0132);
      if (!raw || !/^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) return empty;
      const values = raw.match(/\d+/g).map(Number),
        [year, month, day, hour, minute, second] = values;
      const check = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
      if (
        year < 1900 ||
        check.getUTCFullYear() !== year ||
        check.getUTCMonth() !== month - 1 ||
        check.getUTCDate() !== day ||
        hour > 23 ||
        minute > 59 ||
        second > 59
      )
        return empty;
      const candidate = tags.get(original ? 0x9011 : 0x9010);
      const validOffset = candidate && /^[+-](0\d|1[0-4]):[0-5]\d$/.test(candidate);
      return {
        sourceCapturedAtRaw: raw,
        sourceCapturedTag: original ? 'DateTimeOriginal' : 'DateTime',
        ...(validOffset ? { sourceCapturedOffset: candidate } : {}),
      };
    }
  } catch {
    return empty;
  }
  return empty;
}

/** Bounded signature/chunk inspection prevents accidentally flattening animation. */
export function inspectUploadImage(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 12) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (text(bytes, 0, 6) === 'GIF87a' || text(bytes, 0, 6) === 'GIF89a')
    return { type: 'image/gif', animated: true };
  if (bytes[0] === 0x89 && text(bytes, 1, 7) === 'PNG\r\n\x1a\n') {
    let width,
      height,
      animated = false;
    for (let offset = 8, count = 0; offset + 12 <= bytes.length && count < 100_000; count++) {
      const length = view.getUint32(offset),
        type = text(bytes, offset + 4, 4);
      if (length > bytes.length - offset - 12) return null;
      if (type === 'IHDR') {
        if (offset !== 8 || length !== 13) return null;
        width = view.getUint32(offset + 8);
        height = view.getUint32(offset + 12);
      }
      if (type === 'acTL') animated = true;
      if (type === 'IEND')
        return width && height ? { type: 'image/png', width, height, animated } : null;
      offset += length + 12;
    }
    return null;
  }
  if (text(bytes, 0, 4) === 'RIFF' && text(bytes, 8, 4) === 'WEBP') {
    const end = view.getUint32(4, true) + 8;
    if (end > bytes.length || end < 12) return null;
    let width,
      height,
      animated = false;
    for (let offset = 12, count = 0; offset + 8 <= end && count < 100_000; count++) {
      const kind = text(bytes, offset, 4),
        length = view.getUint32(offset + 4, true),
        start = offset + 8;
      if (length > end - start) return null;
      if (kind === 'ANIM' || kind === 'ANMF') animated = true;
      if (kind === 'VP8X' && length >= 10) {
        animated ||= !!(bytes[start] & 2);
        width = 1 + bytes[start + 4] + (bytes[start + 5] << 8) + (bytes[start + 6] << 16);
        height = 1 + bytes[start + 7] + (bytes[start + 8] << 8) + (bytes[start + 9] << 16);
      } else if (
        kind === 'VP8 ' &&
        length >= 10 &&
        bytes[start + 3] === 0x9d &&
        bytes[start + 4] === 1 &&
        bytes[start + 5] === 0x2a
      ) {
        width ||= view.getUint16(start + 6, true) & 0x3fff;
        height ||= view.getUint16(start + 8, true) & 0x3fff;
      } else if (kind === 'VP8L' && length >= 5 && bytes[start] === 0x2f) {
        width ||= 1 + bytes[start + 1] + ((bytes[start + 2] & 0x3f) << 8);
        height ||=
          1 + (bytes[start + 2] >> 6) + (bytes[start + 3] << 2) + ((bytes[start + 4] & 0x0f) << 10);
      }
      offset = start + length + (length % 2);
    }
    return width && height ? { type: 'image/webp', width, height, animated } : null;
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let offset = 2, count = 0; offset + 4 <= bytes.length && count < 100_000; count++) {
      if (bytes[offset] !== 0xff) return null;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) return null;
      if (marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) return null;
      const length = view.getUint16(offset);
      if (length < 2 || length > bytes.length - offset) return null;
      if (
        [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
          marker,
        )
      ) {
        if (length < 8) return null;
        return {
          type: 'image/jpeg',
          width: view.getUint16(offset + 5),
          height: view.getUint16(offset + 3),
          animated: false,
        };
      }
      offset += length;
    }
  }
  return null;
}

export function compressionDimensions(width, height, longEdge) {
  const scale = Math.min(1, longEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export async function compressUpload(file, settings = {}) {
  const mode =
    typeof settings === 'string'
      ? settings
      : settings.quality || settings.imageCompression || 'balanced';
  const preset = IMAGE_COMPRESSION_PRESETS[mode] || IMAGE_COMPRESSION_PRESETS.balanced;
  const sourceLastModified =
    Number.isFinite(file.lastModified) && file.lastModified >= 0 ? file.lastModified : null;
  let captured = {};
  if (/^image\/jpe?g$/i.test(file.type || '')) {
    try {
      captured = readExifCapture(new Uint8Array(await file.slice(0, 1024 * 1024).arrayBuffer()));
    } catch {
      /* The original remains uploadable. */
    }
  }
  const keep = (reason) => ({
    file,
    originalSize: file.size,
    changed: false,
    reason,
    sourceLastModified,
    ...captured,
  });
  if (mode === 'original') return keep('按设置保留原图');
  if (!/^(image\/(jpeg|png|webp|gif))$/i.test(file.type || '')) return keep('此格式保留原文件');
  if (file.size <= 300 * 1024) return keep('图片较小，保留原图');
  if (file.size > MAX_SOURCE_BYTES) return keep('图片超过安全处理容量，保留原图');
  let bitmap, canvas;
  try {
    const info = inspectUploadImage(new Uint8Array(await file.arrayBuffer()));
    if (!info) return keep('无法安全识别图片，保留原图');
    if (info.animated) return keep('动画图片保留原文件');
    if (!info.width || !info.height || info.width * info.height > MAX_SOURCE_PIXELS)
      return keep('图片像素过大，保留原图');
    if (typeof globalThis.createImageBitmap !== 'function' || !globalThis.document?.createElement)
      return keep('当前环境不支持图片压缩，保留原图');
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    if (bitmap.width * bitmap.height > MAX_SOURCE_PIXELS) return keep('图片像素过大，保留原图');
    const size = compressionDimensions(bitmap.width, bitmap.height, preset.longEdge);
    canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) return keep('无法创建图片画布，保留原图');
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    // WebP retains PNG transparency; JPEG remains JPEG. Never paint alpha black.
    const outputType = info.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp';
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, outputType, preset.quality));
    if (!blob || !['image/jpeg', 'image/png', 'image/webp'].includes(blob.type))
      return keep('图片编码不可用，保留原图');
    if (blob.size >= file.size) return keep('压缩后未变小，保留原图');
    if (sourceLastModified === null) return keep('源文件修改时间缺失，保留原图');
    const extension = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[
      blob.type
    ];
    const name = file.name.replace(/\.[^.]+$/, '') + extension;
    const output = new File([blob], name, {
      type: blob.type,
      lastModified: sourceLastModified ?? 0,
    });
    return {
      file: output,
      originalSize: file.size,
      changed: true,
      reason: `${preset.label}压缩`,
      sourceLastModified,
      ...captured,
      metadataWarning: '压缩副本不保留完整 EXIF；读取到的 EXIF 日期另存，原图模式保留原文件信息',
    };
  } catch {
    return keep('图片处理失败，已保留原图');
  } finally {
    bitmap?.close();
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}
