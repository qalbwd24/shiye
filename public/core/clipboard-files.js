const emptyMessage =
  '剪贴板中的图片内容为空或已失效，请重新复制图片后粘贴；也可从设置中选择原图文件。';

/** Snapshot OS-backed clipboard Files while the paste event still owns them.
 * Async clipboard access is a recovery path only for a trusted image paste.
 * Plain-text paste never reads the system clipboard.
 */
export function capturePastedFiles(event, { clipboard = globalThis.navigator?.clipboard } = {}) {
  const data = event.clipboardData;
  const items = [...(data?.items || [])].filter((item) => item.kind === 'file');
  const itemFiles = items.map((item) => item.getAsFile?.()).filter(Boolean);
  const files = [...(data?.files || [])];
  if (!files.length) files.push(...itemFiles);
  if (!files.length) return null;
  const candidates = files.map((file, index) =>
    file.size > 0 ? file : itemFiles[index]?.size > 0 ? itemFiles[index] : file,
  );
  const imagePaste = candidates.length === 1 && candidates[0].type?.startsWith('image/');
  const snapshot = async (file) => {
    const bytes = await file.arrayBuffer();
    if (!bytes.byteLength) throw Error(emptyMessage);
    return new File([bytes], file.name || 'image.png', {
      type: file.type,
      lastModified: Number.isFinite(file.lastModified) ? file.lastModified : Date.now(),
    });
  };
  const recover = async () => {
    if (!imagePaste || !event.isTrusted || typeof clipboard?.read !== 'function')
      throw Error(emptyMessage);
    try {
      // Invoke within this user paste task, before losing transient activation.
      const records = await clipboard.read();
      for (const record of records) {
        const type = record.types.find((value) => value.startsWith('image/'));
        if (!type) continue;
        const blob = await record.getType(type);
        if (!blob.size) continue;
        const extension = type.split('/')[1].replace(/[^a-z0-9]/gi, '') || 'png';
        return [await snapshot(new File([blob], `image.${extension}`, { type }))];
      }
    } catch {
      // Denied/unavailable clipboard access must never become an empty upload.
    }
    throw Error(emptyMessage);
  };
  if (candidates.some((file) => file.size === 0)) return recover();
  // Start byte reads synchronously; do not retain DataTransfer-backed handles in a dialog.
  return Promise.all(candidates.map(snapshot)).catch(recover);
}
