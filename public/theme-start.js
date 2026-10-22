// Parser-blocking head script: no module graph, storage, diary fetch or editor work.
(() => {
  const root = document.documentElement;
  const choice = root.dataset.themePreference;
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  const paint = () => {
    const theme = choice === 'dark' || (choice !== 'light' && system.matches) ? 'dark' : 'light';
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    window.chrome?.webview?.postMessage({ type: 'theme', value: theme });
  };
  paint();
  system.addEventListener('change', paint);
  document.addEventListener(
    'shiye-theme-mounted',
    () => system.removeEventListener('change', paint),
    { once: true },
  );
})();
