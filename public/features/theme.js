/** One controller per document; OS changes update colors without rebuilding the editor. */
export function createThemeController({ root, mediaQuery, notify = () => {} }) {
  let preference = 'system';
  function render() {
    const theme = preference === 'system' ? (mediaQuery.matches ? 'dark' : 'light') : preference;
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    notify(theme);
  }
  mediaQuery.addEventListener('change', render);
  return {
    apply(mainTheme = 'system', quickTheme = 'inherit') {
      const selected = quickTheme === 'inherit' ? mainTheme : quickTheme;
      preference = ['light', 'dark'].includes(selected) ? selected : 'system';
      render();
    },
    dispose() {
      mediaQuery.removeEventListener('change', render);
    },
  };
}

let controller;
export function applyTheme(preferences, quickTheme) {
  if (!controller) document.dispatchEvent(new Event('shiye-theme-mounted'));
  controller ||= createThemeController({
    root: document.documentElement,
    mediaQuery: window.matchMedia('(prefers-color-scheme: dark)'),
    notify(theme) {
      window.chrome?.webview?.postMessage({ type: 'theme', value: theme });
    },
  });
  controller.apply(
    preferences.theme,
    document.body.classList.contains('quick-capture')
      ? quickTheme || preferences.quickAppearance?.theme || 'inherit'
      : 'inherit',
  );
}
