/** Display-only cropping preserves animated source bytes and is shared by profile/comments. */
export function normalizeAvatarCrop(value = {}) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !['x', 'y', 'zoom'].includes(key))
  )
    throw Error('头像显示范围格式错误');
  const crop = { x: 50, y: 50, zoom: 1, ...value };
  if (
    ![crop.x, crop.y, crop.zoom].every(
      (item) => typeof item === 'number' && Number.isFinite(item),
    ) ||
    crop.x < 0 ||
    crop.x > 100 ||
    crop.y < 0 ||
    crop.y > 100 ||
    crop.zoom < 1 ||
    crop.zoom > 3
  )
    throw Error('头像位置须为0–100，缩放须为1–3');
  return crop;
}
export function avatarStyle(value) {
  let crop;
  try {
    crop = normalizeAvatarCrop(value);
  } catch {
    crop = normalizeAvatarCrop();
  }
  return `object-fit:cover;object-position:${crop.x}% ${crop.y}%;transform:scale(${crop.zoom});transform-origin:${crop.x}% ${crop.y}%`;
}
