import { richMediaReferences } from '../shared/rich-document.js';

/** Capture every reference before queueing, even if its asset was saved earlier. */
export function captureNotesAssets(snapshot, assets) {
  const referenced = new Set(
    snapshot.notes.flatMap((note) =>
      note.body ? richMediaReferences(note.body).map((item) => item.assetId) : [],
    ),
  );
  if (snapshot.background?.assetId) referenced.add(snapshot.background.assetId);
  return [...referenced].map((id) => {
    const asset = assets.get(id);
    if (!asset) throw new Error('草稿中的图片原件缺失，未覆盖上次保存。');
    return asset;
  });
}

/** Workspace-local identities only; replacements must use a new asset object. */
export function createNotesAssetPersistence() {
  const persistedAssets = new Map();
  function markPersisted(assets) {
    for (const asset of assets) persistedAssets.set(asset.id, asset);
  }
  return {
    markPersisted,
    // Called inside the workspace save queue, after earlier transactions finish.
    async save(assets, write) {
      const pending = assets.filter((asset) => persistedAssets.get(asset.id) !== asset);
      const result = await write(pending);
      // write resolves only after IDB oncomplete; aborts must leave identities dirty.
      markPersisted(pending);
      return result;
    },
  };
}
