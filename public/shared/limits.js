/** Format and capacity limits. Changing crypto values requires a format version, not a preference. */
export const MiB = 1024 ** 2;
export const GiB = 1024 ** 3;
export const LIMITS = Object.freeze({
  requestBytes: 4 * MiB,
  legacyBundleBytes: 128 * MiB,
  archiveUploadBytes: 64 * GiB,
  archiveExpandedBytes: 64 * GiB,
  archiveMembers: 100000,
  metadataBytes: 64 * MiB,
  mediaUploadBytes: 16 * GiB,
  vaultChunkBytes: 2 * MiB,
  vaultRecordBytes: 32 * MiB,
  recordingBytes: 100 * MiB,
  historyEntries: 20,
  pageEntries: 100,
});
