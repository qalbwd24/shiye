import { createSharedPreferenceCapture } from '../../public/shared/shared-preference-capture.js';

/** Data-only bridge from the persisted PC worker directory to the shared JSON owner.
 * servicePlan/program/participants are inert metadata, never program installation.
 * No message, document, media byte or user credential collection takes place here.
 */
const fail = (code) => {
  throw Object.assign(Error(code), { code });
};
const stable = (value) =>
  JSON.stringify(
    value === undefined
      ? null
      : value && typeof value === 'object'
        ? Array.isArray(value)
          ? value.map((v) => JSON.parse(stable(v)))
          : Object.fromEntries(
              Object.keys(value)
                .sort()
                .map((k) => [k, JSON.parse(stable(value[k]))]),
            )
        : value,
  );
const privateFields = new Set(
  'password passwd secret token authtoken accesstoken refreshtoken apikey privatekey encryptionkey pairingkey cookie credentials sessioncookie authorization clientsecret sessiontoken secretkey bearertoken window windowPosition windowSize displays dpi deviceId localPath filePath absolutePath downloadDirectory stateDirectory profileDirectory sourceArchives rawArchive archiveBytes backupBytes'
    .split(' ')
    .map((k) => k.toLowerCase()),
);
function metadata(value, excluded, path = '', depth = 0) {
  if (depth > 24) fail('DESKTOP_DIRECTORY_METADATA_TOO_DEEP');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))
      fail('DESKTOP_DIRECTORY_UNSAFE_NUMBER');
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > 256 * 1024) fail('DESKTOP_DIRECTORY_TOO_LARGE');
    if (/^https?:\/\//i.test(value)) {
      const url = new URL(value);
      if (
        url.username ||
        url.password ||
        [...url.searchParams.keys()].some((k) =>
          privateFields.has(k.replace(/[_\-\s]/g, '').toLowerCase()),
        )
      ) {
        excluded.push({ path, reason: 'credential-url' });
        return null;
      }
    }
    return value;
  }
  if (Array.isArray(value) && value.length > 10000) fail('DESKTOP_DIRECTORY_TOO_LARGE');
  if (Array.isArray(value))
    return value.map((v, i) => metadata(v, excluded, `${path}[${i}]`, depth + 1));
  if (!value || Object.getPrototypeOf(value) !== Object.prototype)
    fail('DESKTOP_DIRECTORY_INVALID_METADATA');
  const result = {};
  if (Object.keys(value).length > 10000) fail('DESKTOP_DIRECTORY_TOO_LARGE');
  for (const [key, item] of Object.entries(value)) {
    const at = path ? `${path}.${key}` : key;
    // The actual worker encode() retains optional own undefined properties in IDB.
    if (item === undefined) {
      excluded.push({ path: at, reason: 'non-json-undefined' });
      continue;
    }
    if (privateFields.has(key.replace(/[_\-\s]/g, '').toLowerCase())) {
      excluded.push({ path: at, reason: 'device-or-credential' });
      continue;
    }
    Object.defineProperty(result, key, {
      value: metadata(item, excluded, at, depth + 1),
      enumerable: true,
    });
  }
  return result;
}
const identity = (sourceId, roomId) => {
  if (
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(sourceId || '') ||
    typeof roomId !== 'string' ||
    !/^-?\d{1,20}$/.test(roomId)
  )
    fail('DESKTOP_DIRECTORY_IDENTITY_REQUIRED');
  return `desktop:${sourceId}:${roomId}`;
};
const fields = [
  'title',
  'category',
  'idleHours',
  'description',
  'mode',
  'selfName',
  'clientMetadata',
];
const stateFields = ['pinned', 'archived'];
const pick = (row, keys) => Object.fromEntries(keys.map((key) => [key, row[key]]));
const equal = (a, b) => stable(a) === stable(b);

/** input is selected PC directory metadata, not a raw profile or backup. */
export function captureDesktopDirectory({
  sourceId,
  rooms,
  dialogs = {},
  journalRooms = {},
  order = [],
  selfName = '我',
}) {
  identity(sourceId, '0');
  if (!rooms || typeof rooms !== 'object' || Array.isArray(rooms))
    fail('DESKTOP_WORKER_DIRECTORY_REQUIRED');
  if (Object.keys(rooms).length > 2000 || !Array.isArray(order))
    fail('DESKTOP_DIRECTORY_TOO_LARGE');
  const excluded = [];
  const active = (dialogs.active || []).map((d) => d.id);
  const archived = (dialogs.archived || []).map((d) => d.id);
  if (
    [...order, ...active, ...archived].some(
      (id) => typeof id !== 'string' || !/^-?\d{1,20}$/.test(id),
    )
  )
    fail('DESKTOP_DIRECTORY_IDENTITY_REQUIRED');
  const rows = Object.entries(rooms).map(([roomId, room]) => {
    const conversationId = identity(sourceId, roomId);
    if (!room || (room.id !== undefined && room.id !== roomId))
      fail('DESKTOP_DIRECTORY_ROOM_ID_MISMATCH');
    const {
      title,
      category,
      idleHours,
      description,
      mode,
      selfName: localName,
      isPinned,
      isArchived,
      ...rest
    } = room;
    const clientMetadata = { desktop: metadata(rest, excluded, roomId) };
    const row = {
      conversationId,
      title,
      category: category || journalRooms[roomId]?.category || '',
      idleHours: idleHours ?? 5,
      description: description ?? '',
      mode: mode ?? (room.kind === 'group' || room.program === 'revisit' ? 'group' : 'session'),
      selfName: localName ?? selfName,
      clientMetadata,
      pinned:
        isPinned ??
        !![...(dialogs.active || []), ...(dialogs.archived || [])].find((d) => d.id === roomId)
          ?.pinned,
      archived: isArchived ?? archived.includes(roomId),
    };
    if (
      typeof title !== 'string' ||
      !title.trim() ||
      title.length > 80 ||
      typeof row.selfName !== 'string' ||
      !row.selfName.trim() ||
      row.selfName.length > 80 ||
      !['session', 'group'].includes(row.mode) ||
      typeof row.category !== 'string' ||
      row.category.length > 80 ||
      typeof row.description !== 'string' ||
      row.description.length > 2000 ||
      !Number.isFinite(row.idleHours) ||
      row.idleHours < 0 ||
      typeof row.pinned !== 'boolean' ||
      typeof row.archived !== 'boolean'
    )
      fail('DESKTOP_DIRECTORY_INVALID_ROOM');
    if (roomId === '-900000001' && row.archived) fail('DESKTOP_FIXED_ROOM_ARCHIVE_FORBIDDEN');
    return row;
  });
  const ids = new Set(Object.keys(rooms));
  const localOrder = [...new Set([...order, ...active, ...archived, ...ids])]
    .filter((id) => ids.has(id))
    .map((id) => identity(sourceId, id));
  const result = { sourceId, rooms: rows, order: localOrder, excluded };
  if (
    stable(result).length > 512 * 1024 ||
    rows.some((r) => stable(r.clientMetadata).length > 65536)
  )
    fail('DESKTOP_DIRECTORY_TOO_LARGE');
  return result;
}

/** Baselines detect PC/Android concurrent edits. A conflict retains both copies;
 * resolving it requires the caller to explicitly reconcile local worker metadata.
 * Missing local rooms never delete/withdraw server rooms or their messages.
 */
export function createDesktopDirectoryAdapter({
  client,
  directory,
  readSnapshot,
  onResult = () => {},
}) {
  let running;
  async function collect() {
    const snapshot = captureDesktopDirectory(await readSnapshot());
    const scope = `desktop-directory:${snapshot.sourceId}`;
    await client.sync();
    let view = await directory.list({ includeArchived: true });
    const baseline = (await client.readCache(scope)) || { rooms: {}, order: null };
    const remoteOrderChanged = baseline.order && !equal(baseline.order.remote, view.order);
    const next = structuredClone(baseline),
      conflicts = [],
      pending = [];
    for (const local of snapshot.rooms) {
      let remote = view.rooms.find((r) => r.id === local.conversationId);
      const before = baseline.rooms[local.conversationId];
      const changed = before
        ? fields.filter((key) => !equal(local[key], before.local[key]))
        : fields;
      const stateChanged = before
        ? stateFields.filter((key) => !equal(local[key], before.local[key]))
        : stateFields;
      if (!remote || (!before && remote.revision === 0)) {
        const receipt = await directory.register({
          ...pick(local, fields),
          clientMetadata: {
            ...remote?.clientMetadata,
            desktop: { ...remote?.clientMetadata?.desktop, ...local.clientMetadata.desktop },
          },
          conversationId: local.conversationId,
          expectedRevision: 0,
        });
        if (receipt.status !== 'acknowledged') {
          pending.push(receipt.operationId);
          continue;
        }
        view = await directory.list({ includeArchived: true });
        remote = view.rooms.find((r) => r.id === local.conversationId);
      } else if (
        !before &&
        !equal(pick(local, fields), {
          ...pick(remote, fields),
          category: remote.category ?? '',
          clientMetadata: { desktop: remote.clientMetadata?.desktop ?? {} },
        })
      ) {
        conflicts.push({
          conversationId: local.conversationId,
          domain: 'registration',
          code: 'DESKTOP_EXISTING_ROOM_REQUIRES_RECONCILIATION',
        });
        continue;
      }
      const profileDiffers = !equal(pick(local, changed), pick(remote, changed));
      if (before && changed.length && profileDiffers && remote.revision !== before.revision) {
        conflicts.push({
          conversationId: local.conversationId,
          domain: 'profile',
          code: 'DESKTOP_REMOTE_PROFILE_CHANGED',
        });
        continue;
      }
      if (
        before &&
        stateChanged.some((key) => local[key] !== remote[key]) &&
        remote.listStateRevision !== before.listStateRevision
      ) {
        conflicts.push({
          conversationId: local.conversationId,
          domain: 'state',
          code: 'DESKTOP_REMOTE_STATE_CHANGED',
        });
        continue;
      }
      if (before && changed.length && profileDiffers) {
        const changes = pick(local, changed);
        // Preserve other clients' namespaces when replacing PC-owned metadata.
        if (changes.clientMetadata)
          changes.clientMetadata = {
            ...remote.clientMetadata,
            desktop: { ...remote.clientMetadata?.desktop, ...changes.clientMetadata.desktop },
          };
        const r = await directory.update(local.conversationId, changes, {
          expectedRevision: remote.revision,
        });
        if (r.status !== 'acknowledged') {
          pending.push(r.operationId);
          continue;
        }
      }
      const changes = Object.fromEntries(
        stateChanged.filter((key) => local[key] !== remote[key]).map((key) => [key, local[key]]),
      );
      if (Object.keys(changes).length) {
        const r = await directory.setState(local.conversationId, changes, {
          expectedRevision: remote.listStateRevision,
        });
        if (r.status !== 'acknowledged') {
          pending.push(r.operationId);
          continue;
        }
      }
      view = await directory.list({ includeArchived: true });
      remote = view.rooms.find((r) => r.id === local.conversationId);
      next.rooms[local.conversationId] = {
        local,
        revision: remote.revision,
        listStateRevision: remote.listStateRevision,
      };
    }
    if (!conflicts.length && !pending.length && !equal(snapshot.order, baseline.order?.local)) {
      view = await directory.list({ includeArchived: true });
      if (remoteOrderChanged)
        conflicts.push({ domain: 'order', code: 'DESKTOP_REMOTE_ORDER_CHANGED' });
      else {
        const ours = new Set(snapshot.order),
          remaining = [...snapshot.order];
        const merged = view.order.map((id) => (ours.has(id) ? remaining.shift() : id));
        merged.push(...remaining);
        if (!equal(merged, view.order)) {
          const r = await directory.setOrder(merged, { expectedRevision: view.revision });
          if (r.status !== 'acknowledged') pending.push(r.operationId);
        }
        if (!pending.length) {
          view = await directory.list({ includeArchived: true });
          next.order = { local: snapshot.order, remote: view.order, revision: view.revision };
        }
      }
    } else if (baseline.order && equal(snapshot.order, baseline.order.local)) {
      next.order = { local: snapshot.order, remote: view.order, revision: view.revision };
    }
    await client.writeCache(scope, next);
    const result = {
      sourceId: snapshot.sourceId,
      roomCount: snapshot.rooms.length,
      conflicts,
      pending,
      excluded: snapshot.excluded,
    };
    onResult(result);
    return result;
  }
  const preferenceCaptures = new Map();
  function capturePreferences(values, { scope = 'desktop:thoughts' } = {}) {
    if (!['desktop:thoughts', 'shared:thoughts'].includes(scope))
      fail('DESKTOP_INVALID_PREFERENCES_SCOPE');
    if (!preferenceCaptures.has(scope))
      preferenceCaptures.set(scope, createSharedPreferenceCapture({ client, scope }));
    return preferenceCaptures
      .get(scope)
      .capture(values)
      .then((result) => ({
        ...result,
        conflicts: result.conflicts.map((conflict) => ({
          ...conflict,
          code: conflict.code.replace(/^SHARED_/, 'DESKTOP_'),
        })),
      }));
  }
  return {
    capturePreferences,
    collect() {
      if (!running)
        running = collect().finally(() => {
          running = null;
        });
      return running;
    },
  };
}
