import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

// Extend this structural floor only after the owning schema contract is approved.
// A manifest declares support; it cannot erase a requirement persisted by the store.
export const BACKEND_SCHEMA_FEATURE_FLOORS = Object.freeze([
  Object.freeze({
    marker: '_chatJournalBoundaryVersion',
    versions: [1],
    feature: 'chat-journal-manual-cut-v1',
  }),
  Object.freeze({
    marker: '_chatMessageUnitsVersion',
    versions: [1],
    feature: 'chat-units-unbound-v1',
  }),
  Object.freeze({
    marker: '_serviceSettingsProjectionVersion',
    versions: [1],
    feature: 'service-settings-projection-v1',
  }),
]);
export function requiredBackendBusinessFeatures(db, floors = BACKEND_SCHEMA_FEATURE_FLOORS) {
  const required = new Set();
  for (const { marker, versions, feature } of floors) {
    if (!Object.hasOwn(db, marker)) continue;
    if (!versions.includes(db[marker])) throw Error('BACKEND_SCHEMA_UNSUPPORTED:' + marker);
    required.add(feature);
  }
  if (
    db.messageStore?.units?.some(
      (unit) => unit.origin?.kind === 'chat' && unit.origin.entryId === null,
    ) &&
    db._chatMessageUnitsVersion !== 1
  )
    throw Error('BACKEND_CHAT_SCHEMA_MARKER_REQUIRED');
  if (
    (db.chatJournal?.rooms?.some((room) => Object.hasOwn(room, 'manualSegments')) ||
      db.entries?.some((entry) => Object.hasOwn(entry.chatJournal || {}, 'segmentId'))) &&
    db._chatJournalBoundaryVersion !== 1
  )
    throw Error('BACKEND_CHAT_JOURNAL_BOUNDARY_MARKER_REQUIRED');
  return [...required];
}

/** Optional immutable backend selection for the stable launcher. Test imports of
 * createDiaryServer keep using workspace source. Never load a partial release. */
export async function selectedBackend(root, env = process.env, { dataDir } = {}) {
  let requiredFeatures = [];
  if (dataDir) {
    let handle;
    try {
      handle = await fs.open(path.join(dataDir, 'diary.json'), 'r');
      const stat = await handle.stat();
      if (stat.size > 128 * 1024 * 1024) throw Error('BACKEND_SCHEMA_READ_BUDGET');
      const db = JSON.parse((await handle.readFile('utf8')).replace(/^\uFEFF/, ''));
      requiredFeatures = requiredBackendBusinessFeatures(db);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    } finally {
      await handle?.close();
    }
  }

  let manifestFile = env.DIARY_BACKEND_MANIFEST;
  if (!manifestFile) {
    try {
      const config = JSON.parse(
        (await fs.readFile(path.join(root, 'config/backend-runtime.local.json'), 'utf8')).replace(
          /^\uFEFF/,
          '',
        ),
      );
      manifestFile = config.manifest;
    } catch (error) {
      if (error.code === 'ENOENT') {
        if (requiredFeatures.length) throw Error('BACKEND_CHAT_FEATURE_REQUIRED');
        return undefined;
      }
      throw error;
    }
  }
  const releases = path.resolve(root, 'outputs/backend-runtimes');
  manifestFile = path.resolve(root, manifestFile || '');
  if (!manifestFile.startsWith(releases + path.sep)) throw Error('后台运行清单目录不正确');
  const directory = path.dirname(manifestFile);
  const manifest = JSON.parse((await fs.readFile(manifestFile, 'utf8')).replace(/^\uFEFF/, ''));
  if (
    manifest.protocol !== 1 ||
    manifest.projectRoot !== path.resolve(root) ||
    !Array.isArray(manifest.files)
  )
    throw Error('后台运行清单不正确');
  for (const feature of requiredFeatures)
    if (!Array.isArray(manifest.businessFeatures) || !manifest.businessFeatures.includes(feature))
      throw Error('BACKEND_CHAT_FEATURE_REQUIRED:' + feature);
  for (const item of manifest.files) {
    const file = path.resolve(directory, item.file);
    if (!file.startsWith(directory + path.sep)) throw Error('后台运行文件越界');
    const bytes = await fs.readFile(file);
    if (createHash('sha256').update(bytes).digest('hex') !== item.sha256)
      throw Error('后台运行文件校验失败：' + item.file);
  }
  if (!manifest.files.some((item) => item.file === manifest.entry)) throw Error('后台入口未核验');
  const selected = await import(pathToFileURL(path.join(directory, manifest.entry)).href);
  return {
    ...selected,
    manualCutWrites: manifest.manualCutWrites !== false,
    chatIngestWrites: manifest.chatIngestWrites !== false,
    messageEditWrites: manifest.messageEditWrites !== false,
  };
}
