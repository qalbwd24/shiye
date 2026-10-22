// Portable stage-one experiment only; not a production diary backup format.
import { richMediaReferences, validateRichDocument } from './rich-document.js';
import { imageType } from './appearance.js';

export async function richMediaAssetFromBlob(blob, name = '') {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let type = imageType(bytes);
  // AVIF uses an ISO BMFF ftyp box with avif/avis as major or compatible brand.
  if (!type && bytes.length >= 16 && String.fromCharCode(...bytes.slice(4, 8)) === 'ftyp') {
    const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
    if (size >= 16 && size <= bytes.length) {
      for (let at = 8; at + 4 <= size; at += 4) {
        if (at === 12) continue;
        if (['avif', 'avis'].includes(String.fromCharCode(...bytes.slice(at, at + 4))))
          type = 'image/avif';
      }
    }
  }
  if (!type && bytes.length >= 16 && String.fromCharCode(...bytes.slice(4, 8)) === 'ftyp') {
    const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
    if (size >= 16 && size <= bytes.length) {
      const major = String.fromCharCode(...bytes.slice(8, 12));
      if (major === 'qt  ') type = 'video/quicktime';
      else if (
        [
          'isom',
          'iso2',
          'iso3',
          'iso4',
          'iso5',
          'iso6',
          'mp41',
          'mp42',
          'avc1',
          'M4V ',
          'M4VH',
          'M4VP',
          'MSNV',
          'dash',
        ].includes(major)
      )
        type = 'video/mp4';
    }
  }
  if (
    !type &&
    bytes.length >= 8 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) {
    // EBML DocType element 0x4282, four-byte value "webm"; do not infer from the filename.
    for (let at = 4; at + 7 <= Math.min(bytes.length, 4096); at++) {
      if (
        bytes[at] === 0x42 &&
        bytes[at + 1] === 0x82 &&
        bytes[at + 2] === 0x84 &&
        String.fromCharCode(...bytes.slice(at + 3, at + 7)) === 'webm'
      ) {
        type = 'video/webm';
        break;
      }
    }
  }
  if (!type) throw new Error('无法识别图片或视频文件，请选择受支持的原件。');
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
  // MIME follows the file signature; metadata never changes the original bytes.
  return {
    id: `sha256:${sha256}`,
    blob: new Blob([bytes], { type }),
    name,
    type,
    size: bytes.length,
    sha256,
  };
}

// Existing image pickers keep their image-only contract; archive traversal is generic.
export async function richAssetFromBlob(blob, name = '') {
  const asset = await richMediaAssetFromBlob(blob, name);
  if (!asset.type.startsWith('image/')) throw new Error('请选择受支持的图片原件。');
  return asset;
}

function encodeBase64(bytes) {
  const chunks = [];
  for (let at = 0; at < bytes.length; at += 32768)
    chunks.push(String.fromCharCode(...bytes.subarray(at, at + 32768)));
  return btoa(chunks.join(''));
}
function noUnknownFields(object, allowed, message) {
  if (
    !object ||
    typeof object !== 'object' ||
    Array.isArray(object) ||
    Object.keys(object).some((key) => !allowed.includes(key))
  )
    throw new Error(message);
}
function checkAssetMetadata(asset) {
  if (
    typeof asset.name !== 'string' ||
    !/^[a-f0-9]{64}$/.test(asset.sha256 || '') ||
    asset.id !== `sha256:${asset.sha256}` ||
    !Number.isSafeInteger(asset.size) ||
    asset.size < 1
  )
    throw new Error('图片元信息无效，未替换草稿。');
}
export async function encodeRichArchive(body, assets) {
  const snapshot = structuredClone(validateRichDocument(body));
  const refs = richMediaReferences(snapshot);
  const references = [...new Set(refs.map((ref) => ref.assetId))];
  const media = [];
  for (const id of references) {
    const asset = assets.get(id);
    if (!asset?.blob)
      throw new Error(
        `${refs.find((ref) => ref.assetId === id)?.type === 'video' ? '视频' : '图片'}原件缺失，无法导出完整原件。`,
      );
    checkAssetMetadata(asset);
    const verified = await richMediaAssetFromBlob(asset.blob, asset.name);
    if (verified.id !== id || verified.type !== asset.type || verified.size !== asset.size)
      throw new Error('图片原件校验失败。');
    if (refs.some((ref) => ref.assetId === id && !verified.type.startsWith(ref.type + '/')))
      throw new Error('图片/视频节点与原件类型不符。');
    media.push({
      id,
      name: asset.name,
      type: verified.type,
      size: verified.size,
      sha256: verified.sha256,
      base64: encodeBase64(new Uint8Array(await verified.blob.arrayBuffer())),
    });
  }
  return { format: 'shiye-richdoc-lab', version: 1, body: snapshot, assets: media };
}
export async function decodeRichArchive(text) {
  const original = JSON.parse(text);
  noUnknownFields(
    original,
    ['format', 'version', 'body', 'assets'],
    '原件含未知字段，未替换草稿。',
  );
  if (
    original.format !== 'shiye-richdoc-lab' ||
    original.version !== 1 ||
    !Array.isArray(original.assets)
  )
    throw new Error('不是受支持的试验原件。');
  validateRichDocument(original.body);
  const assets = new Map();
  for (const item of original.assets) {
    noUnknownFields(
      item,
      ['id', 'name', 'type', 'size', 'sha256', 'base64'],
      '图片含未知字段，未替换草稿。',
    );
    checkAssetMetadata(item);
    if (assets.has(item.id)) throw new Error('原件含重复图片 ID，未替换草稿。');
    if (
      typeof item.base64 !== 'string' ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item.base64)
    )
      throw new Error('图片编码无效，未替换草稿。');
    const binary = atob(item.base64);
    if (binary.length !== item.size) throw new Error('图片大小校验失败，未替换草稿。');
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const verified = await richMediaAssetFromBlob(new Blob([bytes]), item.name);
    if (verified.id !== item.id || verified.type !== item.type)
      throw new Error('图片校验失败，未替换草稿。');
    assets.set(verified.id, verified);
  }
  const refs = richMediaReferences(original.body);
  const referenced = new Set(refs.map((ref) => ref.assetId));
  for (const id of referenced)
    if (!assets.has(id))
      throw new Error(
        `原件缺${refs.find((ref) => ref.assetId === id)?.type === 'video' ? '视频' : '图片'}文件，未替换草稿。`,
      );
  for (const ref of refs)
    if (!assets.get(ref.assetId).type.startsWith(ref.type + '/'))
      throw new Error('图片/视频节点与原件类型不符，未替换草稿。');
  for (const id of assets.keys())
    if (!referenced.has(id)) throw new Error('原件含无关联图片，未替换草稿。');
  return { body: original.body, assets };
}
