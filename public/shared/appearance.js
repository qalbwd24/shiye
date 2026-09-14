export const regions = [
  ['app', '整体窗口'],
  ['sidebar', '左侧导航'],
  ['list', '日记列表'],
  ['editor', '正文编辑区'],
  ['topbar', '顶部栏'],
];
export const fills = [
  ['cover', '铺满（裁切边缘）'],
  ['contain', '完整显示'],
  ['tile', '平铺'],
];
export const positions = [
  ['center', '居中'],
  ['top', '顶部'],
  ['bottom', '底部'],
  ['left', '左侧'],
  ['right', '右侧'],
];
export const defaults = () => ({ accent: '#05a6b2', backgrounds: [] });
const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function normalizeAppearance(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('外观格式错误');
  const accent = input.accent ?? defaults().accent;
  if (!/^#[a-f0-9]{6}$/i.test(accent)) throw Error('主题色应为六位十六进制颜色');
  const backgrounds = input.backgrounds ?? [];
  if (!Array.isArray(backgrounds) || backgrounds.length > regions.length)
    throw Error('背景分区格式错误');
  const seen = new Set();
  return {
    accent,
    backgrounds: backgrounds.map((b) => {
      if (
        !b ||
        !regions.some(([r]) => r === b.region) ||
        seen.has(b.region) ||
        !idPattern.test(b.id)
      )
        throw Error('背景分区或图片ID错误');
      seen.add(b.region);
      const opacity = b.opacity ?? 0.2,
        fill = b.fill ?? 'cover',
        position = b.position ?? 'center';
      if (
        typeof opacity !== 'number' ||
        !Number.isFinite(opacity) ||
        opacity < 0 ||
        opacity > 1 ||
        !fills.some(([f]) => f === fill) ||
        !positions.some(([p]) => p === position)
      )
        throw Error('背景透明度、填充或位置错误');
      return { region: b.region, id: b.id, opacity, fill, position };
    }),
  };
}
export function normalizeLayout(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (k) => !['categories', 'tags', 'list'].includes(k) || typeof value[k] !== 'boolean',
    )
  )
    throw Error('折叠设置错误');
  return { categories: false, tags: false, list: false, ...value };
}
export function imageType(bytes) {
  const hex = Array.from(bytes.slice(0, 12), (b) => b.toString(16).padStart(2, '0')).join('');
  if (hex.startsWith('89504e470d0a1a0a')) return 'image/png';
  if (hex.startsWith('ffd8ff')) return 'image/jpeg';
  if (hex.startsWith('474946383761') || hex.startsWith('474946383961')) return 'image/gif';
  if (hex.startsWith('52494646') && hex.slice(16) === '57454250') return 'image/webp';
  return null;
}
