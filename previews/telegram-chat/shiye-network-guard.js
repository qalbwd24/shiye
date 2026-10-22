/* Local-only transport boundary for the document and the local data worker. */
(() => {
  const localOrigin = 'https://shiye-preview.local';
  const isAllowed = (value) => {
    const url = new URL(value, localOrigin);
    return url.origin === localOrigin || url.protocol === 'blob:' || url.protocol === 'data:';
  };
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input, options) => {
    if (!isAllowed(input instanceof Request ? input.url : input)) {
      return Promise.reject(new TypeError('拾页预览仅允许本地资源'));
    }
    return originalFetch(input, options);
  };
  globalThis.WebSocket = class LocalOnlyWebSocket {
    constructor() {
      throw new TypeError('拾页预览不使用远程聊天连接');
    }
  };
  if (globalThis.XMLHttpRequest) {
    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, ...args) {
      if (!isAllowed(url)) throw new TypeError('拾页预览仅允许本地资源');
      return originalOpen.call(this, method, url, ...args);
    };
  }
  if (globalThis.EventSource) {
    const OriginalEventSource = globalThis.EventSource;
    globalThis.EventSource = class LocalEventSource extends OriginalEventSource {
      constructor(url, options) {
        if (!isAllowed(url)) throw new TypeError('拾页预览仅允许本地资源');
        super(url, options);
      }
    };
  }
  if (globalThis.navigator?.sendBeacon) {
    const originalBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (url, data) => isAllowed(url) && originalBeacon(url, data);
  }
})();
