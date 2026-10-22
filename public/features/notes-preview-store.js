// UI experiment only. This snapshot is not the future notes interchange format.
export const NOTES_PREVIEW_DB = 'shiye-notes-ui-preview-v1';

export function openNotesPreviewStore() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(NOTES_PREVIEW_DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('workspaces');
      request.result.createObjectStore('assets', { keyPath: 'id' });
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error('便签试用区正被另一窗口升级，请关闭旧试用窗口后重试。'));
    request.onsuccess = () => resolve(request.result);
  });
}

export function readNotesPreview(db, key = 'main') {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['workspaces', 'assets']);
    const workspace = tx.objectStore('workspaces').get(key);
    const assets = tx.objectStore('assets').getAll();
    tx.oncomplete = () => resolve({ workspace: workspace.result || null, assets: assets.result });
    tx.onabort = tx.onerror = () => reject(tx.error || new Error('无法读取本机便签草稿。'));
  });
}

export function saveNotesPreview(db, key, workspace, assets = [], expectedRevision = 0) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['workspaces', 'assets'], 'readwrite');
    let revision;
    let failure;
    tx.oncomplete = () => resolve(revision);
    tx.onabort = tx.onerror = () =>
      reject(failure || tx.error || new Error('草稿保存失败，当前输入仍在窗口中。'));
    const store = tx.objectStore('workspaces');
    const request = store.get(key);
    request.onsuccess = () => {
      try {
        if ((request.result?.revision || 0) !== expectedRevision)
          throw new Error('另一便签窗口已保存新版本，未覆盖它。请先导出本窗口草稿，再重新打开。');
        revision = expectedRevision + 1;
        store.put({ ...workspace, revision }, key);
        for (const asset of assets) tx.objectStore('assets').put(asset);
      } catch (error) {
        failure = error;
        tx.abort();
      }
    };
  });
}
