import { createBoundedBlobSink } from '../../public/shared/shared-media-sink.js';
export { createBoundedBlobSink } from '../../public/shared/shared-media-sink.js';
import { createSharedSeedImportController } from '../../public/shared/shared-seed-import.js';
export {
  inspectSharedSeedFile,
  inspectSharedSeedNativeTicket,
} from '../../public/shared/shared-seed-import.js';
import { createSharedBusinessClient } from '../../public/shared/shared-business-client.js';
import { createIndexedDbSyncStorage } from '../../public/shared/sync-v2-client.js';
import {
  createSharedDirectoryClient,
  sharedRoomIdentity,
} from '../../public/shared/shared-directory-client.js';
import { createSharedDiaryClient } from '../../public/shared/shared-diary-client.js';
import { createSharedMediaClient } from '../../public/shared/shared-media-client.js';
import { createSharedWallpaperClient } from '../../public/shared/shared-wallpaper-client.js';
import { createSharedUploadJobs } from '../../public/shared/shared-upload-jobs.js';
import { createSharedChatSource } from './shared-source.js';
import {
  createSharedPreferenceCapture,
  readLocalStoragePreferences,
} from '../../public/shared/shared-preference-capture.js';

export const SHARED_RUNTIME_CONFIG = 'shiye-shared-runtime-v1';
export const BLOB_LIMIT = 64 * 1024 * 1024;
const clone = (value) => structuredClone(value);
const fail = (code, message = code) => {
  throw Object.assign(new Error(message), { code });
};
const uuid = (value) =>
  typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const ACTIONS = Object.freeze({
  info: 'sharedInfo',
  snapshot: 'sharedSnapshot',
  pull: 'sharedPull',
  command: 'sharedCommand',
  unlock: 'sharedUnlock',
  pair: 'sharedPair',
  'auth-status': 'sharedAuthStatus',
  'forget-device': 'sharedForgetDevice',
  'media-read': 'sharedMediaRead',
  'media-begin': 'sharedMediaBegin',
  'media-chunk': 'sharedMediaChunk',
  'media-complete': 'sharedMediaComplete',
  'entity-read': 'sharedEntityRead',
  'feed-item-read': 'sharedFeedItemRead',
  'seed-resolve': 'sharedSeedResolve',
  'seed-register': 'sharedSeedRegister',
});

/** Business identities are explicit user choices. Discovery/pairing never replaces this binding. */
export function saveSharedRuntimeConfig(config, store = globalThis.localStorage) {
  if (
    !config ||
    typeof config.enabled !== 'boolean' ||
    (config.enabled && (!uuid(config.libraryId) || !uuid(config.epoch)))
  )
    fail('SHARED_EXPLICIT_IDENTITY_REQUIRED');
  const next = config.enabled
    ? { version: 1, enabled: true, libraryId: config.libraryId, epoch: config.epoch }
    : { version: 1, enabled: false };
  store.setItem(SHARED_RUNTIME_CONFIG, JSON.stringify(next));
  return clone(next);
}
export function readSharedRuntimeConfig(store = globalThis.localStorage) {
  const raw = store?.getItem(SHARED_RUNTIME_CONFIG);
  if (!raw) return null;
  let config;
  try {
    config = JSON.parse(raw);
  } catch {
    fail('SHARED_INVALID_RUNTIME_CONFIG');
  }
  if (config?.enabled === false) return null;
  if (
    config?.version !== 1 ||
    config?.enabled !== true ||
    !uuid(config.libraryId) ||
    !uuid(config.epoch)
  )
    fail('SHARED_INVALID_RUNTIME_CONFIG');
  return clone(config);
}
export function createNativeSharedRequest(
  nativeRequest = (action, input) => {
    if (!globalThis.window?.shiyeProductChat?.request) fail('NATIVE_PRODUCT_CHAT_UNAVAILABLE');
    return window.shiyeProductChat.request(action, input);
  },
) {
  return async (method, input = {}) => {
    const action = ACTIONS[method];
    if (!action) fail('SHARED_NATIVE_ACTION_FORBIDDEN');
    try {
      return await nativeRequest(action, clone(input));
    } catch (error) {
      // Existing product-result exposes machine codes. Give the durable client HTTP classification.
      if (error && typeof error === 'object' && !error.status) {
        if (/AUTH_REQUIRED|UNAUTHORIZED|SHARED_LOCKED/.test(error.code || '')) error.status = 401;
        else if (/FORBIDDEN/.test(error.code || '')) error.status = 403;
        else if (/CONFLICT|MISMATCH|REUSED|REBASE/.test(error.code || '')) error.status = 409;
      }
      throw error;
    }
  };
}

export async function createSharedRuntime({
  config,
  nativeRequest,
  storage,
  indexedDB = globalThis.indexedDB,
  currentRoom,
  contextVersion,
  appearance,
  onChange = () => {},
  onError = () => {},
  idFactory = () => crypto.randomUUID(),
  sinkFactory,
  onSeedProgress = () => {},
  openUploadHandle,
  urlFactory = globalThis.URL,
  pollMs = 30000,
  preferenceStorage = globalThis.localStorage,
  readThoughtPreferences = async () => {
    if (typeof globalThis.window?.shiyeAndroidPreferences?.load !== 'function')
      fail('SHARED_LOCAL_PREFERENCES_UNAVAILABLE');
    return window.shiyeAndroidPreferences.load();
  },
  captureTimers = {
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (timer) => clearTimeout(timer),
  },
} = {}) {
  if (config?.enabled !== true || !uuid(config.libraryId) || !uuid(config.epoch))
    fail('SHARED_EXPLICIT_IDENTITY_REQUIRED');
  const rawNative =
    nativeRequest ||
    ((action, input) => {
      if (!globalThis.window?.shiyeProductChat?.request) fail('NATIVE_PRODUCT_CHAT_UNAVAILABLE');
      return window.shiyeProductChat.request(action, input);
    });
  const request = createNativeSharedRequest(rawNative);
  const media = createSharedMediaClient({
    request,
    libraryId: config.libraryId,
    epoch: config.epoch,
  });
  const ownStorage = !storage;
  storage ||= createIndexedDbSyncStorage({
    dbName: `shiye-sync-v2-shared-${config.libraryId}-${config.epoch}`,
    indexedDB,
    diaryIndex: true,
  });
  let source,
    disposed = false,
    refreshing = null,
    refreshAgain = false;
  let captureTimer = null,
    captureActive = null;
  const captureReports = {};
  const urls = new Set(),
    listeners = new Set();
  async function refreshLocal() {
    if (disposed) return;
    if (refreshing) {
      refreshAgain = true;
      return refreshing;
    }
    refreshing = (async () => {
      do {
        refreshAgain = false;
        await source?.refreshLocal();
        for (const listener of listeners)
          try {
            listener();
          } catch {}
        onChange();
      } while (refreshAgain && !disposed);
    })().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }
  const client = createSharedBusinessClient({
    request,
    storage,
    libraryId: config.libraryId,
    epoch: config.epoch,
    pollMs,
    preparePayload: async (job) => {
      const asset = await media.upload(job.blob, { operationId: job.operationId });
      if (asset.sha256 !== job.sha256 || asset.size !== job.size)
        fail('SHARED_MEDIA_HASH_MISMATCH');
      return asset;
    },
    onChange: () => {
      void refreshLocal().catch(onError);
    },
  });
  await client.status(); // Reject an incompatible persistent identity before exposing any data port.
  const seed = createSharedSeedImportController({
    client,
    storage,
    libraryId: config.libraryId,
    epoch: config.epoch,
    nativeRequest: rawNative,
    onProgress: onSeedProgress,
  });
  const directory = createSharedDirectoryClient({ client, idFactory });
  const diary = createSharedDiaryClient({ client, idFactory, mediaClient: media });
  const wallpaper = createSharedWallpaperClient({ client, scope: 'android', idFactory });
  const uploadJobs = createSharedUploadJobs({
    storage,
    client,
    media,
    libraryId: config.libraryId,
    epoch: config.epoch,
    idFactory,
    openHandle: openUploadHandle,
    onChange: () => {
      void refreshLocal().catch(onError);
    },
  });
  const captureClient = {
    ...client,
    sync: async () => {
      if (disposed) fail('SHARED_CANCELLED');
      return client.sync();
    },
    enqueue: async (job) => {
      if (disposed) fail('SHARED_CANCELLED');
      return client.enqueue(job);
    },
  };
  const captures = [
    {
      scope: 'android:diary',
      capture: createSharedPreferenceCapture({
        client: captureClient,
        scope: 'android:diary',
        idFactory,
        localReader: () =>
          readLocalStoragePreferences({
            storage: preferenceStorage,
            keys: [
              { key: 'shiye.android.diary.presentation.v2', json: true },
              { key: 'shiye.android.diary.entry-image-width.v1', json: true },
              { key: 'shiye.android.diary.image-width-modes.v1', json: true },
            ],
          }),
      }),
    },
    {
      scope: 'android:thoughts',
      capture: createSharedPreferenceCapture({
        client: captureClient,
        scope: 'android:thoughts',
        idFactory,
        localReader: readThoughtPreferences,
      }),
    },
  ];
  function scheduleCapture() {
    if (captureTimer !== null) captureTimers.clearTimeout(captureTimer);
    captureTimer = null;
    if (disposed) return;
    captureTimer = captureTimers.setTimeout(() => {
      captureTimer = null;
      void capturePreferences().finally(scheduleCapture);
    }, 30000);
    captureTimer?.unref?.();
  }
  async function capturePreferences() {
    if (disposed) return { disposed: true };
    if (captureActive) return captureActive;
    captureActive = Promise.all(
      captures.map(async ({ scope, capture }) => {
        try {
          captureReports[scope] = await capture.capture();
        } catch (error) {
          captureReports[scope] = {
            conflicts: [
              { domain: 'preferences', code: error.code || 'SHARED_PREFERENCE_CAPTURE_FAILED' },
            ],
            pending: [],
            excluded: [],
          };
          if (!disposed)
            try {
              onError(error);
            } catch {}
        }
      }),
    )
      .then(() => clone(captureReports))
      .finally(() => {
        captureActive = null;
      });
    return captureActive;
  }
  async function uploadFiles(files) {
    const assets = [];
    for (const file of files) {
      const asset = await media.upload(file, { operationId: idFactory() });
      assets.push(asset.id);
    }
    await client.receive();
    return assets;
  }
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
  async function stickerCommand(action, input, options = {}) {
    const operationId = options.operationId || idFactory();
    await client.enqueue({ operationId, action, input });
    if (options.sync !== false) await client.sync();
    return { operationId, ...(await client.readOperation(operationId)) };
  }
  async function saveSticker(message, options = {}) {
    if (
      !message ||
      message.pending ||
      message.kind === 'withdrawn' ||
      message.readOnly ||
      typeof message.id !== 'string' ||
      !/^\d{1,20}$/.test(message.id)
    )
      fail('STICKER_SOURCE_NOT_CONFIRMED');
    const room = sharedRoomIdentity(message.roomId);
    const active = typeof currentRoom === 'function' ? currentRoom() : currentRoom;
    if (active?.conversationId !== room.conversationId) fail('ROOM_CHANGED');
    const images = [];
    for (const id of [...new Set(message.attachments || [])]) {
      const mediaRecord = await client.read('media', id);
      if (
        mediaRecord?.local?.state === 'active' &&
        /^image\/(png|jpeg|webp|gif|avif)$/.test(mediaRecord.local.data.type)
      )
        images.push(id);
    }
    if (!images.length) fail('STICKER_IMAGE_REQUIRED');
    if (images.length > 1 && !options.mediaId)
      fail('STICKER_IMAGE_SELECTION_REQUIRED', '原消息有多张图片，请明确选择要收藏的图片。');
    const selected = options.mediaId || images[0];
    if (!images.includes(selected)) fail('STICKER_IMAGE_NOT_IN_MESSAGE');
    const input = {
      version: 1,
      source: {
        kind: 'chat',
        sourceId: room.sourceId,
        roomId: room.legacyRoomId,
        messageId: message.id,
      },
      mediaId: selected,
    };
    for (const key of ['name', 'group', 'note'])
      if (options[key] !== undefined) input[key] = options[key];
    return stickerCommand('sticker-from-message', input, options);
  }
  source = createSharedChatSource({
    client,
    uploadJobs,
    currentRoom,
    contextVersion,
    appearance,
    uploadFiles,
    readMedia,
    saveSticker,
    idFactory,
    onError,
    pollMs,
  });
  async function directoryCommand(action, values = {}) {
    if (action === 'list')
      return { rooms: (await directory.list({ includeArchived: true })).rooms };
    if (action === 'flush') return source.flush();
    if (action === 'create') {
      const operationId = values.operationId || idFactory();
      const intentKey = 'android-create-room:' + operationId;
      const previousIntent = await client.readCache(intentKey);
      const category =
        values.category ??
        previousIntent?.category ??
        (await client.list('taxonomy')).find(
          (row) => row.entityType === 'taxonomy' && row.local?.data?.kind === 'category',
        )?.local.data.name;
      if (typeof category !== 'string') fail('SHARED_CATEGORY_REQUIRED');
      const input = {
        title: values.title,
        description: values.description || '',
        idleHours: values.idleHours ?? 5,
        mode: values.mode || 'session',
        selfName: values.selfName || '我',
        category,
      };
      if (previousIntent && JSON.stringify(previousIntent) !== JSON.stringify(input))
        fail(
          'SHARED_OPERATION_INPUT_CHANGED',
          '上次创建的内容仍在确认中，请先确认原操作；当前修改已保留。',
        );
      if (!previousIntent) await client.writeCache(intentKey, input);
      let operation = await client.readOperation(operationId),
        localCommit;
      if (operation && !previousIntent) fail('SHARED_OPERATION_INPUT_CHANGED');
      if (!operation) localCommit = await directory.create(input, { operationId, sync: false });
      const pending = await storage.transaction(async (tx) =>
        (await tx.listPending()).find((row) => row.operationId === operationId),
      );
      if (pending && pending.wire.action !== 'conversation-create-local')
        fail('SHARED_OPERATION_INPUT_CHANGED');
      const id =
        localCommit?.conversationId ||
        pending?.wire.input.conversationId ||
        operation?.result?.conversationId;
      if (!id) fail('SHARED_CREATE_PENDING');
      const committedLocalRevision =
        localCommit?.committedLocalRevision ??
        pending?.localCommitRevisions?.find(
          (row) => row.entityType === 'conversation' && row.entityId === id,
        )?.revision;
      return {
        id,
        rooms: (await directory.list()).rooms,
        operationId,
        localAck: true,
        serverConfirmed: operation?.status === 'acknowledged',
        ...(committedLocalRevision === undefined ? {} : { committedLocalRevision }),
      };
    }
    if (action === 'update') {
      await directory.update(values.id, values);
      return { id: values.id, rooms: (await directory.list()).rooms };
    }
    fail('SHARED_DIRECTORY_ACTION_FORBIDDEN');
  }
  return {
    config: clone(config),
    client,
    source,
    directory,
    diary,
    wallpaper,
    media,
    uploadJobs,
    seed,
    stickers: {
      catalog: async () =>
        (await client.query({ operationId: idFactory(), action: 'sticker-catalog', input: {} }))
          .result,
      fromMessage: saveSticker,
      collect: (input, options) => stickerCommand('sticker-collect', input, options),
      update: (stickerId, value, options) =>
        stickerCommand('sticker-update', { stickerId, value }, options),
    },
    preferences: { capture: capturePreferences, status: () => clone(captureReports) },
    auth: {
      pair: (code, deviceName) => request('pair', { code, deviceName }),
      status: () => request('auth-status'),
      forgetDevice: () => request('forget-device'),
      unlock: (password) => request('unlock', { password }),
    },
    request,
    uploadFiles,
    readMedia,
    directoryCommand,
    async room(id) {
      const room = await directory.row(id);
      return { ...room, ...sharedRoomIdentity(id) };
    },
    refreshLocal,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async start() {
      try {
        await uploadJobs.start();
        const result = await client.start();
        await capturePreferences();
        return result;
      } catch (error) {
        onError(error);
        return { offline: true, errorCode: error.code || 'SHARED_NETWORK_UNAVAILABLE' };
      } finally {
        scheduleCapture();
      }
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      if (captureTimer !== null) captureTimers.clearTimeout(captureTimer);
      captureTimer = null;
      client.stop();
      await uploadJobs.dispose();
      source.dispose();
      listeners.clear();
      for (const url of urls) urlFactory?.revokeObjectURL?.(url);
      if (ownStorage) await storage.close();
    },
  };
}
export async function loadConfiguredRuntime(options = {}) {
  const config = readSharedRuntimeConfig(options.configurationStore);
  return config ? createSharedRuntime({ ...options, config }) : null;
}
