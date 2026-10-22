// This page is outside /telegram/, so a previous Web A Service Worker cannot
// serve an old index/CSP after an APK upgrade. User content remains in IDB.
(() => {
  const origin = 'https://appassets.androidplatform.net';
  let running = false;
  async function open() {
    if (running) return;
    running = true;
    document.querySelector('#retry').hidden = true;
    try {
      if (location.origin !== origin) throw Error('ORIGIN_REQUIRED');
      const registrations = (await navigator.serviceWorker?.getRegistrations?.()) || [];
      for (const registration of registrations) {
        if (registration.scope !== origin + '/telegram/') continue;
        if (!(await registration.unregister())) throw Error('ASSET_WORKER_RELEASE_FAILED');
      }
      location.replace('/telegram/index.html?nativeBuild=019');
    } catch {
      document.querySelector('#status').textContent = '本机会话界面未能打开。数据已保留，请重试。';
      document.querySelector('#retry').hidden = false;
      running = false;
    }
  }
  document.querySelector('#retry').onclick = open;
  open();
})();
