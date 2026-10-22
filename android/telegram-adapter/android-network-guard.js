/* Local transport boundary shared by the document and every bundled worker. */
(() => {
  if (globalThis.__shiyeAndroidNetworkGuard) return;
  globalThis.__shiyeAndroidNetworkGuard = true;
  const origin = 'https://appassets.androidplatform.net';
  const allowed = (input) => {
    try {
      const url = new URL(input, `${origin}/telegram/`);
      return (
        url.protocol === 'blob:' ||
        url.protocol === 'data:' ||
        (url.origin === origin && url.pathname.startsWith('/telegram/'))
      );
    } catch {
      return false;
    }
  };
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input, options) =>
    allowed(input instanceof Request ? input.url : input)
      ? originalFetch(input, options)
      : Promise.reject(new TypeError('仅允许本地随想资源'));
  globalThis.WebSocket = class {
    constructor() {
      throw new TypeError('随想不连接聊天服务器');
    }
  };
  if (globalThis.XMLHttpRequest) {
    const open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, ...args) {
      if (!allowed(url)) throw new TypeError('仅允许本地随想资源');
      return open.call(this, method, url, ...args);
    };
  }
  if (globalThis.EventSource) {
    const Original = globalThis.EventSource;
    globalThis.EventSource = class extends Original {
      constructor(url, options) {
        if (!allowed(url)) throw new TypeError('仅允许本地随想资源');
        super(url, options);
      }
    };
  }
  if (globalThis.navigator?.sendBeacon) {
    const beacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (url, body) => allowed(url) && beacon(url, body);
  }
})();
