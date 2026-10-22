/** Format and capacity limits. Changing crypto values requires a format version, not a preference. */
export const MiB = 1024 ** 2;
export const GiB = 1024 ** 3;
export const LIMITS = Object.freeze({
  richDocumentNodes: 50000,
  richDocumentDepth: 64,
  requestBytes: 4 * MiB,
  legacyBundleBytes: 128 * MiB,
  archiveUploadBytes: 64 * GiB,
  archiveExpandedBytes: 64 * GiB,
  archiveMembers: 100000,
  metadataBytes: 64 * MiB,
  mediaUploadBytes: 16 * GiB,
  backgroundBytes: 20 * MiB,
  stickerBytes: 64 * MiB,
  stickerNoteCharacters: 2000,
  vaultChunkBytes: 2 * MiB,
  vaultRecordBytes: 32 * MiB,
  recordingBytes: 100 * MiB,
  historyEntries: 20,
  pageEntries: 100,
  revisitPageEntries: 100,
  revisitPreviewCharacters: 6000,
  revisitCommentCharacters: 100000,
  revisitManualDays: 31,
  revisitMediaChunkBytes: 256 * 1024,
  conversationServiceInstances: 128,
  conversationServiceBindings: 512,
});
