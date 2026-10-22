import { normalizeAppearance } from './appearance.js';

export const quickFontFamilies = [
  ['sans', '无衬线（微软雅黑）'],
  ['serif', '衬线（宋体）'],
  ['mono', '等宽'],
];
export const quickAppearanceDefaults = () => ({
  theme: 'inherit',
  backgroundMode: 'inherit',
  background: null,
  blur: 0,
  inheritTypography: true,
  fontFamily: 'sans',
  fontSize: 16,
  fontWeight: 400,
  lineHeight: 1.6,
  titleSize: 28,
  titleWeight: 700,
});

/** Separate optional preferences; main-window appearance is never mutated. */
export function normalizeQuickAppearance(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw Error('快捷窗口外观格式错误');
  const value = { ...quickAppearanceDefaults(), ...input };
  if (
    !['inherit', 'system', 'light', 'dark'].includes(value.theme) ||
    !['inherit', 'custom', 'none'].includes(value.backgroundMode) ||
    typeof value.inheritTypography !== 'boolean' ||
    !quickFontFamilies.some(([key]) => key === value.fontFamily)
  )
    throw Error('快捷窗口背景或字体设置错误');
  for (const [key, min, max, integer] of [
    ['blur', 0, 20, true],
    ['fontSize', 12, 32, true],
    ['fontWeight', 300, 800, true],
    ['lineHeight', 1.2, 2.5, false],
    ['titleSize', 20, 56, true],
    ['titleWeight', 300, 800, true],
  ]) {
    const n = value[key];
    if (
      typeof n !== 'number' ||
      !Number.isFinite(n) ||
      n < min ||
      n > max ||
      (integer && !Number.isInteger(n))
    )
      throw Error('快捷窗口字号、字重、行距或模糊参数超出范围');
  }
  const background =
    value.background === null
      ? null
      : normalizeAppearance({
          backgrounds: [{ ...value.background, region: 'app' }],
        }).backgrounds[0];
  if (value.backgroundMode === 'custom' && !background) throw Error('请先选择快捷窗口背景图片');
  return Object.fromEntries(
    Object.keys(quickAppearanceDefaults()).map((key) => [
      key,
      key === 'background' ? background : value[key],
    ]),
  );
}

export function quickFontStack(family) {
  return family === 'serif'
    ? 'Georgia, SimSun, serif'
    : family === 'mono'
      ? 'Consolas, monospace'
      : '"Microsoft YaHei", sans-serif';
}
