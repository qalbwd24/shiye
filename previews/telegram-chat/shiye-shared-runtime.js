import { createSharedBusinessClient } from '../../public/shared/shared-business-client.js';
import { createIndexedDbSyncStorage } from '../../public/shared/sync-v2-client.js';
import {
  createSharedDirectoryClient,
  sharedRoomIdentity,
} from '../../public/shared/shared-directory-client.js';
import { createSharedDiaryClient } from '../../public/shared/shared-diary-client.js';
import { createSharedMediaClient } from '../../public/shared/shared-media-client.js';
import { createSharedWallpaperClient } from '../../public/shared/shared-wallpaper-client.js';
import { createSharedChatSource } from '../../public/shared/shared-chat-source.js';
import { createSharedUploadJobs } from '../../public/shared/shared-upload-jobs.js';
import { startDesktopDirectoryPort } from './shiye-shared-directory-port.js';
import { createChunkedSharedSeedRequest } from '../../public/shared/shared-seed-wire.js';
import { createSharedSeedImportController } from '../../public/shared/shared-seed-import.js';
export {
  inspectSharedSeedFile,
  inspectSharedSeedNativeTicket,
} from '../../public/shared/shared-seed-import.js';
import { createBoundedBlobSink } from '../../public/shared/shared-media-sink.js';

export const DESKTOP_SHARED_CONFIG = 'shiye-desktop-shared-runtime-v1';
const methods = new Set([
  'pair',
  'unlock',
  'auth-status',
  'forget-device',
  'info',
  'snapshot',
  'pull',
  'command',
  'entity-read',
  'feed-item-read',
  'media-read',
  'media-begin',
  'media-chunk',
  'media-complete',
  'seed-resolve',
  'seed-register',
]);
const uuid = (v) =>
  typeof v === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const fail = (code) => {
  throw Object.assign(Error(code), { code });
};
export function readDesktopSharedConfig(storage = globalThis.localStorage) {
  const raw = storage?.getItem(DESKTOP_SHARED_CONFIG);
  if (!raw) return null;
  let config;
  try {
    config = JSON.parse(raw);
  } catch {
    fail('SHARED_INVALID_RUNTIME_CONFIG');
  }
  if (config.enabled === false) return null;
  if (
    config.version !== 1 ||
    config.enabled !== true ||
    !uuid(config.libraryId) ||
    !uuid(config.epoch)
  )
    fail('SHARED_EXPLICIT_IDENTITY_REQUIRED');
  return { version: 1, enabled: true, libraryId: config.libraryId, epoch: config.epoch };
}
export function createDesktopSharedRequest(journal = globalThis.window?.shiyeJournal) {
  const seedRequest = createChunkedSharedSeedRequest({
    request: (action, payload) => journal.shared(action.slice('shared-'.length), payload),
  });
  return (method, input = {}) => {
    if (!methods.has(method) || typeof journal?.shared !== 'function')
      fail('SHARED_DESKTOP_METHOD_UNAVAILABLE');
    return ['seed-resolve', 'seed-register'].includes(method)
      ? seedRequest(method, input)
      : journal.shared(method, structuredClone(input));
  };
}
/** Explicit binding only. Existing desktop worker/journal remains the legacy
 * owner; incoming rows are durable in shared IDB, never rewritten into TL IDs.
 * A renderer may select source as its data port without changing business IDs.
 */
export async function bootstrapDesktopSharedRuntime({
  preferenceStorage = globalThis.localStorage,
  config = readDesktopSharedConfig(preferenceStorage),
  journal = globalThis.window?.shiyeJournal,
  request,
  storage,
  indexedDB = globalThis.indexedDB,
  currentRoom,
  openUploadHandle,
  readSnapshot,
  readLocalPreferences,
  BroadcastChannel = globalThis.BroadcastChannel,
  events = globalThis.window,
  pollMs = 30000,
  onError = () => {},
  onChange = () => {},
  onSeedProgress = () => {},
  sinkFactory,
  urlFactory = globalThis.URL,
} = {}) {
  if (!config?.enabled) return null;
  if (!uuid(config.libraryId) || !uuid(config.epoch)) fail('SHARED_EXPLICIT_IDENTITY_REQUIRED');
  request ||= createDesktopSharedRequest(journal);
  const sourceId = await journal.sourceId();
  if (!uuid(sourceId)) fail('DESKTOP_JOURNAL_IDENTITY_REQUIRED');
  const ownStorage = !storage;
  storage ||= createIndexedDbSyncStorage({
    indexedDB,
    dbName: `shiye-sync-v2-shared-desktop-${config.libraryId}-${config.epoch}`,
    diaryIndex: true,
  });
  let source,
    directoryPort,
    unsubscribe,
    disposed = false;
  const change = () => {
    if (disposed) return;
    void source?.refreshLocal().catch(onError);
    onChange();
  };
  const media = createSharedMediaClient({
    request,
    libraryId: config.libraryId,
    epoch: config.epoch,
  });
  const client = createSharedBusinessClient({
    request,
    storage,
    libraryId: config.libraryId,
    epoch: config.epoch,
    pollMs,
    onChange: change,
    preparePayload: async (job) => {
      const asset = await media.upload(job.blob, { operationId: job.operationId });
      if (asset.sha256 !== job.sha256 || asset.size !== job.size)
        fail('SHARED_MEDIA_HASH_MISMATCH');
      return asset;
    },
  });
  try {
    await client.status();
  } catch (error) {
    if (ownStorage) await storage.close();
    throw error;
  }
  const directory = createSharedDirectoryClient({ client });
  const seed = createSharedSeedImportController({
    client,
    storage,
    libraryId: config.libraryId,
    epoch: config.epoch,
    onProgress: onSeedProgress,
  });
  const urls = new Set();
  async function readMedia(message) {
    const id =
      typeof message === 'string' ? message : message?.mediaId || message?.attachments?.[0];
    const row = await client.read('media', id),
      asset = row?.local?.state === 'active' ? row.local.data : null;
    if (!asset) fail('SHARED_ORIGINAL_NOT_RECEIVED');
    const sink = sinkFactory
      ? await sinkFactory(asset)
      : createBoundedBlobSink(asset, { urlFactory });
    const local = await seed.copyOriginal(id, { sink });
    const result = local ? local.result : await media.download(asset, { sink });
    if (result?.url) urls.add(result.url);
    return result;
  }
  const uploadJobs = createSharedUploadJobs({
    storage,
    client,
    media,
    libraryId: config.libraryId,
    epoch: config.epoch,
    openHandle: openUploadHandle,
    onChange: change,
  });
  const selected =
    currentRoom ||
    (() => {
      const id = globalThis.window?.shiyeRoomUi?.currentConversationId?.();
      if (id) return { ...sharedRoomIdentity(id) };
      const localId = globalThis.window?.shiyeRoomUi?.currentId?.();
      return localId ? { ...sharedRoomIdentity(`desktop:${sourceId}:${String(localId)}`) } : null;
    });
  source = createSharedChatSource({
    client,
    uploadJobs,
    readMedia,
    currentRoom: selected,
    autoSync: true,
    pollMs,
    onError,
  });
  const roomChanged = () => {
    if (!disposed && selected()) void source.refresh().catch(onError);
  };
  events?.addEventListener('shiye-current-room', roomChanged);
  let started;
  return {
    config: structuredClone(config),
    client,
    directory,
    source,
    media,
    uploadJobs,
    seed,
    readMedia,
    auth: {
      pair: (code, deviceName) => request('pair', { code, deviceName }),
      status: () => request('auth-status'),
      forgetDevice: () => request('forget-device'),
      unlock: (password) => request('unlock', { password }),
    },
    diary: createSharedDiaryClient({ client, mediaClient: media }),
    wallpaper: createSharedWallpaperClient({ client, scope: 'desktop' }),
    async receiveConversation(id) {
      const room = await directory.row(id);
      const receiver = createSharedChatSource({
        client,
        currentRoom: () => ({ ...room, ...sharedRoomIdentity(id) }),
        autoSync: false,
        onError,
      });
      try {
        await receiver.refresh();
        return receiver.getSnapshot();
      } finally {
        receiver.dispose();
      }
    },
    async start() {
      if (disposed) fail('SHARED_CANCELLED');
      if (started) return started;
      started = (async () => {
        await uploadJobs.start();
        await client.start();
        directoryPort = startDesktopDirectoryPort({
          client,
          directory,
          readSnapshot,
          readLocalPreferences,
          BroadcastChannel,
          events,
          pollMs,
          onError,
        });
        await directoryPort.ready;
        unsubscribe = source.subscribe(() => {
          if (!disposed) onChange();
        });
        if (selected()) await source.refresh();
        return { started: true, storage: 'shared-business', rendererAttached: false };
      })().catch(async (error) => {
        unsubscribe?.();
        directoryPort?.stop();
        client.stop();
        started = null;
        if (disposed || error.code === 'SHARED_CANCELLED') throw error;
        // Opening a verified local replica does not require the server, its
        // credentials, or its current key to be reachable/accepted.
        await client.status();
        unsubscribe = source.subscribe(() => {
          if (!disposed) onChange();
        });
        if (selected()) await source.refreshLocal();
        onError(error);
        return {
          started: true,
          offline: true,
          errorCode: error.code || 'SHARED_NETWORK_UNAVAILABLE',
          storage: 'shared-business',
          rendererAttached: false,
        };
      });
      return started;
    },
    async dispose() {
      disposed = true;
      unsubscribe?.();
      source.dispose();
      client.stop();
      directoryPort?.stop();
      await uploadJobs.dispose();
      for (const url of urls) urlFactory?.revokeObjectURL?.(url);
      urls.clear();
      events?.removeEventListener('shiye-current-room', roomChanged);
      if (ownStorage) await storage.close();
    },
  };
}
