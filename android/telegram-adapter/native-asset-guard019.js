// Android ships every executable asset in the APK. Keep old Web A cache
// workers from taking over later visits; no IDB, localStorage or media cleanup.
(() => {
  window.shiyeNativeAssetBuild = '021';
  const serviceWorkers = navigator.serviceWorker;
  if (serviceWorkers) {
    Object.defineProperty(serviceWorkers, 'register', {
      configurable: true,
      value: () =>
        Promise.reject(
          new DOMException('Assets are provided by the installed APK', 'NotSupportedError'),
        ),
    });
  }
  let invoke;
  const ready = new Promise((resolve) => {
    invoke = resolve;
  });
  window.shiyeProductChat = {
    connect(request) {
      if (typeof request !== 'function') throw Error('PRODUCT_PORT_REQUIRED');
      this.invoke = request;
      invoke(request);
    },
    async request(action, payload = {}) {
      const request =
        this.invoke ||
        (await Promise.race([
          ready,
          new Promise((_, reject) =>
            setTimeout(
              () =>
                reject(
                  Object.assign(Error('本机数据接口尚未就绪，请稍后重试'), {
                    code: 'PRODUCT_PORT_NOT_READY',
                  }),
                ),
              12000,
            ),
          ),
        ]));
      return request(action, payload);
    },
  };
})();
