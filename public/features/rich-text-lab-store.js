// Deliberately separate from both diary.json and the chat profile database.
export const LAB_DB = 'shiye-rich-text-lab-v1';
export function openLabStore() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LAB_DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('drafts');
      request.result.createObjectStore('assets', { keyPath: 'id' });
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('试验库正在另一窗口升级，请先关闭该试验页。'));
    request.onsuccess = () => resolve(request.result);
  });
}
export async function readLabDraft(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['drafts', 'assets']);
    const draft = tx.objectStore('drafts').get('current');
    const assets = tx.objectStore('assets').getAll();
    const recovery = tx.objectStore('drafts').get('before-import');
    tx.oncomplete = () =>
      resolve({
        draft: draft.result || null,
        assets: assets.result,
        recovery: recovery.result || null,
      });
    tx.onabort = tx.onerror = () => reject(tx.error || new Error('试验库读取失败。'));
  });
}
export async function saveLabDraft(db, draft, assets, { expectedRevision, recovery } = {}) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['drafts', 'assets'], 'readwrite');
    let nextRevision;
    let failure;
    tx.oncomplete = () => resolve(nextRevision);
    tx.onabort = tx.onerror = () =>
      reject(failure || tx.error || new Error('试验保存失败，正文仍保留在当前窗口。'));
    const current = tx.objectStore('drafts').get('current');
    current.onsuccess = () => {
      try {
        const revision = current.result?.revision || 0;
        if (expectedRevision !== undefined && expectedRevision !== revision)
          throw new Error('另一试验页已保存了新草稿；当前内容未覆盖，可先导出原件，再重新打开。');
        nextRevision = revision + 1;
        tx.objectStore('drafts').put({ ...draft, revision: nextRevision }, 'current');
        if (recovery) tx.objectStore('drafts').put(recovery, 'before-import');
        for (const asset of assets) tx.objectStore('assets').put(asset);
      } catch (error) {
        failure = error;
        tx.abort();
      }
    };
  });
}
