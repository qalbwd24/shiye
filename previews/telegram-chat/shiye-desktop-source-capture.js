// Private recovery capture only. This module has no application/worker imports,
// never creates a source identity, and never submits a business message.
export const DESKTOP_CAPTURE_PREFERENCE_KEYS = Object.freeze([
  'shiye-preview-appearance-v1',
  'shiye-room-appearance-v1',
  'shiye-input-commands-v1',
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
const encoder = new TextEncoder();
const jsonBytes = (value) => encoder.encode(JSON.stringify(value));
const fail = (code) => {
  throw Object.assign(Error(code), { code });
};
const digest = async (bytes) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
const count = (v) => (v && typeof v === 'object' ? Object.keys(v).length : 0);
const base64 = (bytes) => {
  let text = '';
  for (let offset = 0; offset < bytes.length; offset += 16384)
    text += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
  return btoa(text);
};

function readExisting(indexedDB, name, store, key, { optional = false, all = false } = {}) {
  return new Promise((resolve, reject) => {
    let missing = false;
    const open = indexedDB.open(name);
    open.onupgradeneeded = () => {
      missing = true;
      open.transaction.abort();
      if (!optional) reject(Error('DESKTOP_CAPTURE_DATABASE_MISSING'));
    };
    open.onerror = () =>
      missing && optional
        ? resolve(undefined)
        : reject(Error('DESKTOP_CAPTURE_DATABASE_UNREADABLE'));
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(store)) {
        db.close();
        reject(Error('DESKTOP_CAPTURE_STORE_MISSING'));
        return;
      }
      const tx = db.transaction(store, 'readonly'),
        request = all ? tx.objectStore(store).getAll() : tx.objectStore(store).get(key);
      let value, keys;
      if (all) {
        const names = tx.objectStore(store).getAllKeys();
        names.onsuccess = () => {
          keys = names.result;
        };
      }
      request.onsuccess = () => {
        value = request.result;
      };
      tx.oncomplete = () => {
        db.close();
        resolve(all ? { keys, values: value } : value);
      };
      tx.onerror = tx.onabort = () => {
        db.close();
        reject(Error('DESKTOP_CAPTURE_READ_FAILED'));
      };
    };
  });
}

/** An explicit tagged object graph prevents reserved-key collisions and keeps
 * bigint, undefined, sparse arrays, aliases and binary types out of raw JSON.
 * Binary members are private worker bytes, not server asset registrations. */
async function recoveryGraph(root, members) {
  const seen = new Map(),
    nodes = [];
  async function encode(value) {
    if (value === null) return ['null'];
    const type = typeof value;
    if (type === 'string' || type === 'boolean') return [type, value];
    if (type === 'number') return ['number', Object.is(value, -0) ? '-0' : String(value)];
    if (type === 'bigint') return ['bigint', value.toString()];
    if (type === 'undefined') return ['undefined'];
    if (type !== 'object') fail('DESKTOP_CAPTURE_UNSUPPORTED_VALUE');
    if (seen.has(value)) return ['ref', seen.get(value)];
    const id = nodes.length;
    if (id >= 1000000) fail('DESKTOP_CAPTURE_GRAPH_TOO_LARGE');
    seen.set(value, id);
    nodes.push(null);
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value) || value instanceof Blob) {
      const bytes =
        value instanceof Blob
          ? new Uint8Array(await value.arrayBuffer())
          : value instanceof ArrayBuffer
            ? new Uint8Array(value)
            : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      const sha256 = await digest(bytes),
        path = 'media/' + sha256;
      if (!members.has(path)) members.set(path, bytes);
      const file = typeof File !== 'undefined' && value instanceof File;
      nodes[id] = {
        type: file
          ? 'File'
          : value instanceof Blob
            ? 'Blob'
            : value instanceof ArrayBuffer
              ? 'ArrayBuffer'
              : value.constructor.name,
        path,
        size: bytes.length,
        sha256,
        ...(value instanceof Blob ? { mime: value.type } : {}),
        ...(file ? { name: value.name, lastModified: value.lastModified } : {}),
      };
    } else if (value instanceof Date) nodes[id] = { type: 'Date', value: value.toISOString() };
    else if (value instanceof Map) {
      const values = [];
      for (const [key, item] of value) values.push([await encode(key), await encode(item)]);
      nodes[id] = { type: 'Map', values };
    } else if (value instanceof Set) {
      const values = [];
      for (const item of value) values.push(await encode(item));
      nodes[id] = { type: 'Set', values };
    } else {
      if (
        !Array.isArray(value) &&
        Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null
      )
        fail('DESKTOP_CAPTURE_UNSUPPORTED_VALUE');
      const values = [];
      for (const key of Object.keys(value).sort()) values.push([key, await encode(value[key])]);
      nodes[id] = {
        type: Array.isArray(value) ? 'Array' : 'Object',
        ...(Array.isArray(value) ? { length: value.length } : {}),
        values,
      };
    }
    return ['ref', id];
  }
  const value = await encode(root);
  return { format: 'shiye-desktop-private-graph', version: 1, root: value, nodes };
}

export async function captureDesktopSource({
  emit,
  signal,
  indexedDB = globalThis.indexedDB,
  localStorage = globalThis.localStorage,
} = {}) {
  if (typeof emit !== 'function' || !indexedDB || !localStorage?.getItem)
    fail('DESKTOP_CAPTURE_DEPENDENCIES_REQUIRED');
  const active = () => {
    if (signal?.aborted) fail('DESKTOP_CAPTURE_CANCELLED');
  };
  async function collect() {
    active();
    const before = await readExisting(indexedDB, 'shiye-journal-link-v1', 'settings', 'link');
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(before?.sourceId || ''))
      fail('DESKTOP_CAPTURE_SOURCE_ID_REQUIRED');
    const library = await readExisting(
      indexedDB,
      'shiye-telegram-preview-v1',
      'preview',
      'library',
    );
    if (!library || typeof library !== 'object') fail('DESKTOP_CAPTURE_LIBRARY_MISSING');
    const after = await readExisting(indexedDB, 'shiye-journal-link-v1', 'settings', 'link');
    const members = new Map();
    const firstLink = jsonBytes(await recoveryGraph(before, members));
    if (
      (await digest(firstLink)) !== (await digest(jsonBytes(await recoveryGraph(after, new Map()))))
    )
      fail('DESKTOP_SOURCE_CHANGED');
    const preferences = {};
    const keys = [
      ...DESKTOP_CAPTURE_PREFERENCE_KEYS,
      'shiye-room-order-v1',
      'shiye-symbol-usage-v1',
      'shiye-room-viewports-v1',
      // Legacy PC-only state/recovery receipts, never portable Android flags.
      'shiye-input-height',
      'shiye-room-state-v1',
      'shiye-room-switch-sidebar-v1',
      'shiye-switch-timing-v2',
    ];
    for (const key of keys) {
      const raw = localStorage.getItem(key);
      if (raw === null) continue;
      if (typeof raw !== 'string' || raw.length > 16 * 1024 ** 2)
        fail('DESKTOP_CAPTURE_SETTING_TOO_LARGE');
      Object.defineProperty(preferences, key, { value: raw, enumerable: true });
    }
    const uncollectedKeys = [];
    for (let i = 0; i < (localStorage.length || 0); i++) {
      const key = localStorage.key(i);
      if (typeof key === 'string' && !keys.includes(key)) uncollectedKeys.push(key);
    }
    members.set('logical/link.typed.json', firstLink);
    members.set('logical/library.typed.json', jsonBytes(await recoveryGraph(library, members)));
    const assets = await readExisting(indexedDB, 'shiye-preview-assets-v1', 'assets', undefined, {
      optional: true,
      all: true,
    });
    const recoveries = await readExisting(
      indexedDB,
      'shiye-withdrawal-recovery-v2',
      'recoveries',
      undefined,
      { optional: true, all: true },
    );
    if (assets)
      members.set('logical/assets.typed.json', jsonBytes(await recoveryGraph(assets, members)));
    if (recoveries)
      members.set(
        'logical/withdrawal-recovery.typed.json',
        jsonBytes(await recoveryGraph(recoveries, members)),
      );
    const dataUrlMedia = [];
    let appearance;
    try {
      appearance = JSON.parse(preferences['shiye-preview-appearance-v1'] || '{}');
    } catch {
      fail('DESKTOP_CAPTURE_APPEARANCE_INVALID');
    }
    if (typeof appearance.wallpaper === 'string' && appearance.wallpaper.startsWith('data:')) {
      const match = /^data:([^;,]*)(;base64)?,([\s\S]*)$/.exec(appearance.wallpaper);
      if (!match) fail('DESKTOP_CAPTURE_DATA_URL_INVALID');
      let bytes;
      try {
        bytes = match[2]
          ? Uint8Array.from(atob(match[3]), (c) => c.charCodeAt(0))
          : encoder.encode(decodeURIComponent(match[3]));
      } catch {
        fail('DESKTOP_CAPTURE_DATA_URL_INVALID');
      }
      const sha256 = await digest(bytes),
        path = 'media/' + sha256;
      if (!members.has(path)) members.set(path, bytes);
      dataUrlMedia.push({
        sourceKey: 'shiye-preview-appearance-v1',
        field: 'wallpaper',
        path,
        size: bytes.length,
        sha256,
        mime: match[1],
      });
    }
    members.set(
      'logical/preferences.json',
      jsonBytes({
        version: 1,
        values: preferences,
        dataUrlMedia,
        uncollectedKeys: uncollectedKeys.sort(),
        excludedKeys: uncollectedKeys
          .filter((key) => key === 'tt-last-activity')
          .map((key) => ({
            key,
            reason: 'device-private-autolock-activity-never-uploaded-or-restored',
          })),
      }),
    );
    const roster = [];
    for (const [path, bytes] of [...members].sort(([a], [b]) => a.localeCompare(b))) {
      if (path.startsWith('logical/') && bytes.length > 128 * 1024 ** 2)
        fail('DESKTOP_CAPTURE_METADATA_TOO_LARGE');
      roster.push({ path, size: bytes.length, sha256: await digest(bytes) });
    }
    return {
      sourceId: before.sourceId,
      members,
      roster,
      contentSha256: await digest(jsonBytes(roster)),
      counts: {
        messages: count(library.messages),
        documents: count(library.documents),
        rooms: count(library.shiyeRooms),
        preferences: Object.keys(preferences).length,
        uncollectedStorageKeys: uncollectedKeys.length,
        assetRecords: assets?.values.length || 0,
        withdrawalRecoveryRecords: recoveries?.values.length || 0,
        assetsDatabasePresent: !!assets,
        withdrawalRecoveryDatabasePresent: !!recoveries,
      },
    };
  }
  const captured = await collect();
  for (const member of captured.roster) {
    active();
    await emit({ kind: 'member-start', path: member.path, size: member.size });
    const bytes = captured.members.get(member.path);
    for (let offset = 0, index = 0; offset < bytes.length; offset += 128 * 1024, index++) {
      active();
      await emit({
        kind: 'member-chunk',
        path: member.path,
        index,
        dataBase64: base64(bytes.subarray(offset, offset + 128 * 1024)),
      });
    }
    await emit({ kind: 'member-end', ...member });
  }
  const verified = await collect();
  if (verified.sourceId !== captured.sourceId || verified.contentSha256 !== captured.contentSha256)
    fail('DESKTOP_SOURCE_CHANGED');
  const summary = {
    version: 1,
    kind: 'desktop-private-logical-recovery',
    sourceId: captured.sourceId,
    contentSha256: captured.contentSha256,
    counts: captured.counts,
    members: captured.roster.length,
    bytes: captured.roster.reduce((n, m) => n + m.size, 0),
    completeComputerExport: false,
    directlyImportable: false,
    coverage: {
      library: 'existing-worker-record-complete-private-graph',
      binary: 'all-worker-graph-binary-members',
      settings: '16-portable-keys-plus-explicit-pc-only-recovery-and-migration-receipts',
      assets: captured.counts.assetsDatabasePresent
        ? 'existing-assets-original-and-preview-blobs-with-id-mapping-private'
        : 'database-absent-no-assets-collected',
      withdrawalRecovery: captured.counts.withdrawalRecoveryDatabasePresent
        ? 'private-only-never-published-as-active-messages'
        : 'database-absent-no-recovery-collected',
      otherStorage: 'key-inventory-only-values-not-collected',
      pendingAndDrafts: 'private-recovery-only-never-implicitly-sent',
      sharedProjection: 'requires-explicit-owner-reconciliation',
    },
  };
  await emit({ kind: 'complete', summary });
  return summary;
}
