import { createHash } from 'node:crypto';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';

const SOURCES = [
  'diary',
  'desktop-chat-profile',
  'desktop-notes-workspace',
  'desktop-application-preferences',
];
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const diaryFields = [
  'entries',
  'media',
  'categories',
  'tags',
  'stickers',
  'chatJournal',
  'messageStore',
  'revisit',
  'conversationServices',
  'settings',
];

function structure(kind, value) {
  if (!object(value)) return { recognized: false, code: 'OBJECT_REQUIRED' };
  if (kind === 'diary') {
    const recognized = Array.isArray(value.entries) && Array.isArray(value.media);
    return {
      recognized,
      code: recognized ? 'LEGACY_DIARY_STRUCTURE' : 'DIARY_ARRAYS_REQUIRED',
      topLevelFieldCount: Object.keys(value).length,
      knownFields: diaryFields.filter((key) => Object.hasOwn(value, key)),
      unknownTopLevelFieldCount: Object.keys(value).filter((key) => !diaryFields.includes(key))
        .length,
      ...(recognized ? { entries: value.entries.length, mediaMetadata: value.media.length } : {}),
    };
  }
  if (kind === 'desktop-notes-workspace') {
    const recognized =
      value.kind === 'shiye-notes-ui-snapshot' &&
      object(value.workspace) &&
      Array.isArray(value.assets);
    return {
      recognized,
      code: recognized ? 'EXPERIMENTAL_NOTES_SNAPSHOT' : 'NOTES_LOGICAL_SNAPSHOT_REQUIRED',
      ...(recognized ? { assetDeclarations: value.assets.length } : {}),
    };
  }
  // No general preference-file schema or portable chat snapshot exists yet.
  // An arbitrary JSON object (even { complete: true }) cannot prove source identity.
  return {
    recognized: false,
    code: 'SOURCE_SCHEMA_NOT_REGISTERED',
    topLevelFieldCount: Object.keys(value).length,
  };
}

async function inspectFile(file, kind, maxJsonBytes, index) {
  const result = { index };
  if (typeof file !== 'string' || !path.isAbsolute(file))
    return { ...result, code: 'EXPLICIT_ABSOLUTE_FILE_REQUIRED' };
  let handle;
  try {
    // Reject links in both final and parent components rather than following them into
    // an unrequested profile or credential directory. No directory traversal is done.
    const info = await lstat(file);
    if (info.isSymbolicLink() || !info.isFile())
      return { ...result, code: 'REGULAR_FILE_REQUIRED' };
    if (path.resolve(await realpath(file)).toLowerCase() !== path.resolve(file).toLowerCase())
      return { ...result, code: 'LINKED_SOURCE_REJECTED' };
    handle = await open(file, 'r');
    const before = await handle.stat();
    if (!before.isFile() || before.ino !== info.ino || before.dev !== info.dev)
      return { ...result, code: 'SOURCE_CHANGED_DURING_READ' };
    const hash = createHash('sha256');
    const chunks = [];
    const parse = kind !== 'desktop-chat-profile' && before.size <= maxJsonBytes;
    let size = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      hash.update(chunk);
      size += chunk.length;
      if (parse && size <= maxJsonBytes) chunks.push(chunk);
    }
    const after = await handle.stat();
    if (
      size !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    )
      return { ...result, code: 'SOURCE_CHANGED_DURING_READ' };
    Object.assign(result, { code: 'INVENTORIED', size, sha256: hash.digest('hex') });
    if (kind === 'desktop-chat-profile') {
      result.structure = { recognized: false, code: 'RECOVERY_ARCHIVE_ONLY' };
    } else if (!parse) {
      result.structure = { recognized: false, code: 'JSON_STRUCTURE_SIZE_LIMIT' };
    } else {
      try {
        result.structure = structure(kind, JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        result.structure = { recognized: false, code: 'INVALID_JSON_OR_RAW_RECOVERY_FILE' };
      }
    }
    return result;
  } catch (error) {
    return {
      ...result,
      code: ['ENOENT', 'EACCES', 'EPERM'].includes(error.code) ? error.code : 'SOURCE_READ_FAILED',
    };
  } finally {
    await handle?.close();
  }
}

/** Metadata-only audit of explicitly supplied files. This never creates a seed,
 * reads default data locations, publishes content, or trusts completeness claims. */
export async function auditComputerData({ sources = {}, maxJsonBytes = 32 * 1024 * 1024 } = {}) {
  if (!object(sources) || Object.keys(sources).some((key) => !SOURCES.includes(key)))
    throw new TypeError('UNKNOWN_SOURCE_KIND');
  if (!Number.isSafeInteger(maxJsonBytes) || maxJsonBytes < 1 || maxJsonBytes > 256 * 1024 * 1024)
    throw new TypeError('INVALID_JSON_LIMIT');
  const reports = [];
  for (const kind of SOURCES) {
    const supplied = sources[kind] ?? [];
    const files = Array.isArray(supplied) ? supplied : [supplied];
    if (files.length > 10000) throw new TypeError('SOURCE_FILE_LIMIT');
    const results = [];
    for (const [index, file] of files.entries())
      results.push(await inspectFile(file, kind, maxJsonBytes, index));
    const present = results.length > 0 && results.every((file) => file.code === 'INVENTORIED');
    reports.push({
      kind,
      present,
      files: results,
      logicalStructureRecognized: present && results.some((file) => file.structure?.recognized),
      portableImportVerified: false,
      disposition: kind === 'desktop-chat-profile' ? 'recovery-archive-only' : 'inventory-only',
      gaps: [
        ...(!present ? ['EXPLICIT_READABLE_SOURCE_REQUIRED'] : []),
        ...(kind === 'desktop-chat-profile' ? ['LOGICAL_CHAT_SNAPSHOT_REQUIRED'] : []),
        ...(kind === 'desktop-notes-workspace'
          ? ['NOTES_ASSET_BYTES_AND_MAPPING_NOT_VERIFIED']
          : []),
        ...(kind === 'desktop-application-preferences'
          ? ['PREFERENCE_SOURCE_SCHEMA_REQUIRED']
          : []),
        'PORTABLE_RECORD_AND_MEDIA_COVERAGE_NOT_VERIFIED',
      ],
    });
  }
  return {
    format: 'shiye-computer-data-inventory',
    version: 1,
    complete: false,
    completeComputerExport: false,
    allSourceFilesPresent: reports.every((source) => source.present),
    sources: reports,
    missingSources: reports.filter((source) => !source.present).map((source) => source.kind),
    policy: { clientWallpaper: 'device-local', stickerMetadata: 'shared' },
    privacy: {
      fileContentsIncluded: false,
      sourcePathsIncluded: false,
      credentialAuditPerformed: false,
      rawSourceSafeToTransport: false,
    },
    gaps: [
      'INVENTORY_IS_NOT_A_SYSEED_EXPORT',
      'CROSS_SOURCE_IDENTITY_AND_COHERENT_SNAPSHOT_NOT_VERIFIED',
    ],
  };
}
