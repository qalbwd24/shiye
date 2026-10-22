/** Only a small public display preference may enter startup HTML/native hints. */
export function startupTheme(preferences = {}, quick = false) {
  const override = preferences?.quickAppearance?.theme;
  const choice = quick && override && override !== 'inherit' ? override : preferences?.theme;
  return ['light', 'dark'].includes(choice) ? choice : 'system';
}
