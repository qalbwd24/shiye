/* Local-only wallpaper and sticker files. No Telegram media identifiers. */
(() => {
  const database = new Promise((resolve, reject) => {
    const request = indexedDB.open('shiye-preview-assets-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('assets', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  async function run(mode, operation) {
    const db = await database;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('assets', mode);
      const request = operation(transaction.objectStore('assets'));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = transaction.onerror = () => reject(transaction.error || request.error);
    });
  }
  async function list(prefix) {
    if (prefix === undefined) return run('readonly', (store) => store.getAll());
    if (typeof prefix !== 'string' || !prefix.length)
      throw TypeError('Asset prefix must be a non-empty string');
    let upper;
    for (let index = prefix.length - 1; index >= 0; index--) {
      const code = prefix.charCodeAt(index);
      if (code < 0xffff) {
        upper = prefix.slice(0, index) + String.fromCharCode(code + 1);
        break;
      }
    }
    const range =
      upper === undefined
        ? IDBKeyRange.lowerBound(prefix)
        : IDBKeyRange.bound(prefix, upper, false, true);
    const assets = await run('readonly', (store) => store.getAll(range));
    return upper === undefined
      ? assets.filter((asset) => typeof asset.id === 'string' && asset.id.startsWith(prefix))
      : assets;
  }
  window.shiyeLocalAssets = {
    get: (id) => run('readonly', (store) => store.get(id)),
    list,
    put: (asset) => run('readwrite', (store) => store.put(asset)),
    remove: (id) => run('readwrite', (store) => store.delete(id)),
    saveMapping: async (mapping, previousId) => {
      const db = await database;
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('assets', 'readwrite');
        const store = transaction.objectStore('assets');
        let failure;
        const request = store.get(mapping.id);
        request.onsuccess = () => {
          if (request.result && mapping.id !== previousId) {
            failure = Error('这个名称已经有映射，请换一个名称或编辑原映射');
            transaction.abort();
            return;
          }
          store.put(mapping);
          if (previousId && previousId !== mapping.id) store.delete(previousId);
        };
        transaction.oncomplete = resolve;
        transaction.onabort = transaction.onerror = () => reject(failure || transaction.error);
      });
    },
  };
  // Surface a failed open when a feature uses the store, without an unhandled rejection at startup.
  database.catch(() => {});
})();
