import { createDesktopDirectoryAdapter } from './shiye-shared-directory-adapter.js';
import { readLocalStoragePreferences } from '../../public/shared/shared-preference-capture.js';
import {
  createDesktopPreferenceResourceReader,
  createDesktopPreferenceResourceResolver,
} from '../../public/shared/desktop-preference-resource.js';
export { createDesktopPreferenceResourceResolver };

export const DESKTOP_PORTABLE_PREFERENCE_KEYS = Object.freeze([
  { key: 'shiye-preview-appearance-v1', json: true },
  { key: 'shiye-room-appearance-v1', json: true },
  { key: 'shiye-input-commands-v1', json: true },
  'shiye-message-render-mode',
  'shiye-input-cap-v2',
  'shiye-input-manual-height-v1',
  'shiye-bubble-spacing',
  'shiye-bubble-padding',
  'shiye-time-gap-minutes',
  'shiye-image-quality',
  'shiye-markdown-enabled',
  'shiye-room-enter-arrows-v1',
  'shiye-room-switch-mode-v1',
  'shiye-sidebar-motion',
  'shiye-revisit-date-style-v1',
  'shiye-switch-delay',
]);

/** Uses explicit existing UI setting keys only. Resource/device/private members
 * are filtered by shared capture; no directory order, usage history or draft keys.
 */
export function readDesktopPortablePreferences({ storage = globalThis.localStorage } = {}) {
  return readLocalStoragePreferences({ storage, keys: DESKTOP_PORTABLE_PREFERENCE_KEYS });
}
export async function readDesktopPortablePreferencesWithResources(options = {}) {
  return createDesktopPreferenceResourceReader({
    ...options,
    keys: DESKTOP_PORTABLE_PREFERENCE_KEYS,
  })();
}

/** Only opens already initialized worker/journal databases, never creates a new
 * source identity. IDB necessarily reads one legacy library record; only selected
 * directory metadata escapes this port (no messages/documents/media scan).
 */
export async function readDesktopDirectorySnapshot({
  indexedDB = globalThis.indexedDB,
  localStorage = globalThis.localStorage,
} = {}) {
  async function read(name, store, key) {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open(name);
      open.onupgradeneeded = () => {
        open.transaction.abort();
        reject(Error('DESKTOP_WORKER_NOT_INITIALIZED'));
      };
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains(store)) {
          db.close();
          reject(Error('DESKTOP_WORKER_NOT_INITIALIZED'));
          return;
        }
        const tx = db.transaction(store, 'readonly'),
          request = tx.objectStore(store).get(key);
        let result;
        request.onsuccess = () => {
          result = request.result;
        };
        tx.oncomplete = () => {
          db.close();
          resolve(result);
        };
        tx.onerror = tx.onabort = () => {
          db.close();
          reject(tx.error);
        };
      };
    });
  }
  const link = await read('shiye-journal-link-v1', 'settings', 'link');
  if (!link?.sourceId) throw Error('DESKTOP_JOURNAL_IDENTITY_REQUIRED');
  const library = await read('shiye-telegram-preview-v1', 'preview', 'library');
  const order = JSON.parse(localStorage.getItem('shiye-room-order-v1') || '[]');
  const self = library?.users?.find((user) => user.self === true || user.id === '1');
  const selfName =
    [self?.firstName, self?.lastName]
      .filter((part) => typeof part === 'string' && part.trim())
      .join(' ') || '我';
  return {
    sourceId: link.sourceId,
    journalRooms: link.rooms,
    rooms: library?.shiyeRooms,
    selfName,
    dialogs: {
      active: (library?.dialogs?.active || []).map(({ id, pinned }) => ({
        id,
        ...(pinned === undefined ? {} : { pinned }),
      })),
      archived: (library?.dialogs?.archived || []).map(({ id, pinned }) => ({
        id,
        ...(pinned === undefined ? {} : { pinned }),
      })),
    },
    order,
  };
}

/** Explicit callable integration entry. Bootstrap supplies the same shared client
 * and directory controller used by Android. No UI or native owner is replaced.
 * Worker save broadcasts + storage events + polling cover continuous metadata.
 */
export function startDesktopDirectoryPort({
  client,
  directory,
  readSnapshot = readDesktopDirectorySnapshot,
  BroadcastChannel = globalThis.BroadcastChannel,
  events = globalThis.window,
  pollMs = 30000,
  onError = () => {},
  onResult,
  readLocalPreferences,
  resolvePreferenceResource,
  preferenceResource,
  preferenceStorage = globalThis.localStorage,
} = {}) {
  const adapter = createDesktopDirectoryAdapter({ client, directory, readSnapshot });
  if (
    preferenceResource &&
    (resolvePreferenceResource || typeof readLocalPreferences === 'function')
  )
    throw Error('DESKTOP_RESOURCE_RESOLVER_CONFLICT');
  const resourceResolver =
    resolvePreferenceResource ||
    (preferenceResource && createDesktopPreferenceResourceResolver(preferenceResource));
  const preferenceReader =
    readLocalPreferences === null || readLocalPreferences === false
      ? null
      : readLocalPreferences ||
        createDesktopPreferenceResourceReader({
          storage: preferenceStorage,
          keys: DESKTOP_PORTABLE_PREFERENCE_KEYS,
          resolveResource: resourceResolver,
        });
  let stopped = false,
    timer,
    active,
    dirty = false;
  const channel = BroadcastChannel ? new BroadcastChannel('shiye-journal-changes') : null;
  const collect = () => {
    if (stopped) return Promise.resolve(null);
    dirty = true;
    if (!active)
      active = (async () => {
        let result;
        while (dirty && !stopped) {
          dirty = false;
          result = await adapter.collect();
          if (preferenceReader)
            result.preferences = await adapter.capturePreferences(await preferenceReader());
          onResult?.(result);
        }
        return result;
      })().finally(() => {
        active = null;
      });
    return active;
  };
  const schedule = () => {
    collect().catch(onError);
  };
  const storage = (event) => {
    if (
      event.key === 'shiye-room-order-v1' ||
      DESKTOP_PORTABLE_PREFERENCE_KEYS.some(
        (spec) => (typeof spec === 'string' ? spec : spec.key) === event.key,
      )
    )
      schedule();
  };
  if (channel) channel.onmessage = schedule;
  events?.addEventListener('storage', storage);
  if (pollMs > 0) timer = setInterval(schedule, pollMs);
  const ready = collect();
  ready.catch(onError);
  return {
    ready,
    collect,
    capturePreferences: adapter.capturePreferences,
    stop() {
      stopped = true;
      clearInterval(timer);
      channel?.close?.();
      events?.removeEventListener('storage', storage);
    },
  };
}
