const copy = (value) => structuredClone(value);
const fail = (code) => {
  throw Object.assign(Error(code), { code });
};
export const defaultSharedWallpaper = (conversationId) => ({
  version: 1,
  conversationId,
  revision: 0,
  syncEnabled: true,
  sharedAssetId: null,
  independent: { desktop: { revision: 0, assetId: null }, android: { revision: 0, assetId: null } },
});
// The two image domains use server asset identity. Display/crop parameters stay
// on each endpoint and are deliberately absent from this business adapter.
export function createSharedWallpaperClient({
  client,
  scope,
  idFactory = () => crypto.randomUUID(),
}) {
  if (
    !client?.query ||
    !client?.enqueue ||
    !client?.read ||
    !['desktop', 'android'].includes(scope)
  )
    fail('SHARED_WALLPAPER_OPTIONS_REQUIRED');
  return {
    async read(conversationId, { fresh = false } = {}) {
      if (fresh)
        return (
          await client.query({
            operationId: idFactory(),
            action: 'wallpaper-read',
            input: { conversationId },
          })
        ).result;
      const row = await client.read('wallpaper', conversationId);
      if (row?.local?.state === 'active') return copy(row.local.data);
      if (!(await client.read('conversation', conversationId))?.local)
        fail('SHARED_ROOM_NOT_RECEIVED');
      return defaultSharedWallpaper(conversationId);
    },
    async save(
      conversationId,
      changes,
      { domain = 'shared', expectedRevision, operationId = idFactory(), sync = true } = {},
    ) {
      if (
        !['shared', scope].includes(domain) ||
        !Number.isSafeInteger(expectedRevision) ||
        expectedRevision < 0
      )
        fail('SHARED_WALLPAPER_REVISION_REQUIRED');
      await client.enqueue({
        operationId,
        action: 'wallpaper-save',
        input: { ...copy(changes), conversationId, scope: domain, expectedRevision },
      });
      if (sync) await client.sync();
      // A local outbox ACK is not a successful server binding ACK.
      return { operationId, ...(await client.readOperation(operationId)) };
    },
    effective(wallpaper) {
      return wallpaper.syncEnabled ? wallpaper.sharedAssetId : wallpaper.independent[scope].assetId;
    },
  };
}
