import { normalizeAvatarCrop } from '../../../public/shared/profile.js';
import { randomUUID } from 'node:crypto';

const imageType = /^image\/(png|jpeg|webp|gif|avif)$/;
export function stickerMedia(db, id, fail) {
  const media = db.media.find((m) => m.id === id);
  if (!media || !imageType.test(media.type)) throw fail(400, '表情包须使用库中已有的图片或 GIF');
  return media;
}

/** Validate before backup file writes, retaining optional/unknown collection fields. */
export function prepareStickers(items, media, map, fail) {
  if (items === undefined) return [];
  if (!Array.isArray(items)) throw fail(400, '备份表情包收藏格式错误');
  const ids = new Set();
  return items.map((item) => {
    if (
      !item ||
      typeof item.id !== 'string' ||
      !item.id ||
      ids.has(item.id) ||
      typeof item.name !== 'string' ||
      typeof item.group !== 'string' ||
      typeof item.mediaId !== 'string' ||
      !map.has(item.mediaId)
    )
      throw fail(400, '备份表情包收藏或附件引用错误');
    ids.add(item.id);
    stickerMedia({ media }, item.mediaId, fail);
    const remap = (value) => {
      const copy = structuredClone(value);
      if (copy.mediaId) copy.mediaId = map.get(copy.mediaId) || copy.mediaId;
      if (Array.isArray(copy.importedVersions))
        copy.importedVersions = copy.importedVersions.map(remap);
      return copy;
    };
    return remap(item);
  });
}

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
const equal = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));

/** One collection item per actual media ID. Conflicting imported metadata stays recoverable. */
export function reconcileStickers(db, incoming, mediaMap) {
  if (!incoming.length) return;
  db.stickers ||= [];
  for (const raw of incoming) {
    const remap = (value) => {
      const copy = structuredClone(value);
      if (copy.mediaId) copy.mediaId = mediaMap.get(copy.mediaId) || copy.mediaId;
      if (Array.isArray(copy.importedVersions))
        copy.importedVersions = copy.importedVersions.map(remap);
      return copy;
    };
    const item = remap(raw);
    const existing = db.stickers.find((old) => old.mediaId === item.mediaId);
    if (!existing) {
      db.stickers.push({
        ...item,
        id: randomUUID(),
        restoredFrom: item.restoredFrom || { id: item.id },
      });
      continue;
    }
    // Supplement new fields without changing the user's current collection name/group/deletion.
    for (const [key, value] of Object.entries(item))
      if (!(key in existing)) existing[key] = structuredClone(value);
    const comparable = (value) => {
      const result = structuredClone(value);
      for (const key of ['id', 'restoredFrom', 'importedVersions']) delete result[key];
      return result;
    };
    if (!equal(comparable(existing), comparable(item))) {
      const version = { ...item };
      delete version.importedVersions;
      existing.importedVersions ||= [];
      if (!existing.importedVersions.some((old) => equal(comparable(old), comparable(version))))
        existing.importedVersions.push(version);
    }
    for (const version of item.importedVersions || []) {
      existing.importedVersions ||= [];
      if (!existing.importedVersions.some((old) => equal(comparable(old), comparable(version))))
        existing.importedVersions.push(version);
    }
  }
}

/** Profile is restored only with an explicit option; otherwise the current profile is untouched. */
export function prepareProfile(profile, media, map, fail) {
  if (profile === undefined) return undefined;
  if (!profile || typeof profile !== 'object' || Array.isArray(profile))
    throw fail(400, '备份个人资料格式错误');
  const result = structuredClone(profile);
  if (
    result.authorName !== undefined &&
    (typeof result.authorName !== 'string' ||
      !result.authorName.trim() ||
      result.authorName.trim().length > 80)
  )
    throw fail(400, '备份用户名格式错误');
  if (result.motto !== undefined && (typeof result.motto !== 'string' || result.motto.length > 200))
    throw fail(400, '备份座右铭格式错误');
  if (
    result.authorAvatarId !== undefined &&
    result.authorAvatarId !== null &&
    typeof result.authorAvatarId !== 'string'
  )
    throw fail(400, '备份头像格式错误');
  if (result.authorAvatarCrop !== undefined) {
    try {
      result.authorAvatarCrop = normalizeAvatarCrop(result.authorAvatarCrop);
    } catch (error) {
      throw fail(400, error.message);
    }
  }
  if (result.authorAvatarId) {
    stickerMedia({ media }, result.authorAvatarId, fail);
    if (!map.has(result.authorAvatarId)) throw fail(400, '备份个人头像引用错误');
    result.authorAvatarId = map.get(result.authorAvatarId);
  }
  return result;
}
