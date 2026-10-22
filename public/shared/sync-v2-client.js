/** Standalone sync transport/repository. It never opens the existing TL database.
 * Storage.transaction(fn) must commit entity, outbox and metadata writes together,
 * serialize writers (including other tabs), roll back on throw, and return only
 * after durable commit. Callbacks may await tx methods, never network/timers.
 */
import {
  decodeDiaryCursor,
  diaryHeaderFitsPage,
  diaryHeaderFromEntity,
  diarySearchFromEntity,
  diaryMatches,
  diaryDayKey,
  diaryStreak,
  diaryPublicHeader,
  diaryTitleFromEntity,
  diarySuggestedTitle,
  diaryPageBytes,
  diaryPageOptions,
  diaryQueryKey,
  encodeDiaryCursor,
  DIARY_INDEX_VERSION,
  DIARY_PAGE_MAX_BYTES,
  validateDiarySidecar,
} from './shared-diary-index.js';

const copy = (value) => structuredClone(value);
const entityKey = (type, id) => JSON.stringify([type, id]);
const commands = new Set(['create', 'updateFields', 'delete', 'withdraw', 'restore']);

export function normalizeSyncBaseUrl(value) {
  if (typeof value !== 'string' || /[\\\s?#]/u.test(value)) throw new Error('invalid-base-url');
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('invalid-base-url');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('invalid-base-url');
  if (/%(?:2f|5c|2e)/iu.test(url.pathname)) throw new Error('invalid-base-url');
  return `${url.origin}${url.pathname.replace(/\/+$/u, '')}/`;
}

export function createSyncOperationId(cryptoImpl = globalThis.crypto) {
  const bytes = new Uint8Array(20);
  if (cryptoImpl?.getRandomValues) cryptoImpl.getRandomValues(bytes);
  else {
    // HTTP LAN WebViews can lack Web Crypto. Timestamp + process counter + entropy
    // provides operation identity, never an authentication credential.
    for (let n = 0; n < bytes.length; n++) bytes[n] = Math.floor(Math.random() * 256);
  }
  createSyncOperationId.counter = (createSyncOperationId.counter || 0) + 1;
  return `op-${Date.now().toString(36)}-${createSyncOperationId.counter.toString(36)}-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function applyIntent(base, intent) {
  const current = copy(
    base || {
      entityType: intent.entityType,
      entityId: intent.entityId,
      revision: 0,
      state: 'active',
      data: {},
    },
  );
  if (intent.command === 'create') current.data = copy(intent.data || {});
  if (intent.command === 'updateFields')
    current.data = { ...current.data, ...copy(intent.changes || {}) };
  if (intent.command === 'delete') current.state = 'deleted';
  if (intent.command === 'withdraw') {
    current.state = 'withdrawn';
    current.data = {};
  }
  if (intent.command === 'restore') current.state = 'active';
  return current;
}

function validateEntity(entity) {
  if (
    !entity ||
    typeof entity.entityType !== 'string' ||
    !entity.entityType ||
    typeof entity.entityId !== 'string' ||
    !entity.entityId ||
    !Number.isSafeInteger(entity.revision) ||
    entity.revision < 1 ||
    !['active', 'deleted', 'withdrawn'].includes(entity.state)
  )
    throw new Error('invalid-server-entity');
  return entity.state === 'withdrawn' ? { ...copy(entity), data: {} } : copy(entity);
}

async function rebuild(tx, record) {
  const pending = (await tx.listPending()).filter(
    (p) => p.intent.entityType === record.entityType && p.intent.entityId === record.entityId,
  );
  record.local = pending.reduce((base, item) => applyIntent(base, item.intent), record.base);
  // An acknowledged remote withdrawal cannot be resurrected by an offline edit.
  if (record.base?.state === 'withdrawn') record.local = copy(record.base);
  await tx.putEntity(record);
}

export function createSyncClient({
  baseUrl,
  deviceId,
  token,
  storage,
  fetchImpl = globalThis.fetch,
  onState = () => {},
  onChange = () => {},
  idFactory = createSyncOperationId,
  retryBaseMs = 1000,
  retryMaxMs = 60000,
  pollMs = 30000,
  requestTimeoutMs = 30000,
  pageLimit = 100,
  watch,
  supportedEntityTypes,
} = {}) {
  let base = normalizeSyncBaseUrl(baseUrl);
  if (
    !deviceId ||
    typeof deviceId !== 'string' ||
    !storage?.transaction ||
    typeof fetchImpl !== 'function'
  )
    throw new Error('invalid-sync-options');
  let credential = token;
  let running = false,
    active = null,
    controller = null,
    timer = null,
    unwatch = null;
  let generation = 0,
    failures = 0,
    paused = null,
    state = { phase: 'idle', pending: 0, conflicts: 0, retryAt: null, error: null };
  let importingSeed = false;
  const types = supportedEntityTypes ? new Set(supportedEntityTypes) : null;
  function emit(patch) {
    state = { ...state, ...patch };
    try {
      onState(copy(state));
    } catch {
      /* observers cannot invalidate committed data */
    }
    return copy(state);
  }
  function changed() {
    try {
      onChange();
    } catch {
      /* notifications carry no body */
    }
  }
  async function counts() {
    return storage.transaction(async (tx) => ({
      pending: (await tx.listPending()).length,
      conflicts: (await tx.listConflicts()).length,
    }));
  }
  function schedule(ms) {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (!running || paused) return;
    timer = setTimeout(() => {
      timer = null;
      void sync();
    }, ms);
    timer.unref?.();
  }
  function check(signal, gen) {
    if (signal.aborted || gen !== generation) throw new Error('cancelled');
  }
  async function request(path, body, signal, gen, namespace = 'sync') {
    check(signal, gen);
    const auth = typeof credential === 'function' ? await credential() : credential;
    check(signal, gen);
    if (typeof auth !== 'string' || !auth || /[\r\n]/u.test(auth))
      throw new Error('authentication-required');
    const response = await fetchImpl(new URL(`api/${namespace}/v1/${path}`, base).href, {
      method: body === undefined ? 'GET' : 'POST',
      redirect: 'error',
      credentials: 'omit',
      signal,
      headers: {
        Authorization: `Bearer ${auth}`,
        'Content-Type': 'application/json',
        'X-Sync-Device-Id': deviceId,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    check(signal, gen);
    if (response.status === 401 || response.status === 403)
      throw new Error('authentication-required');
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error('invalid-server-response');
    }
    check(signal, gen);
    if (!response.ok) {
      const code = data?.error?.code || data?.code;
      if (
        ['resnapshot-required', 'RESNAPSHOT_REQUIRED', 'CURSOR_EXPIRED', 'EPOCH_MISMATCH'].includes(
          code,
        )
      )
        throw new Error('resnapshot-required');
      throw new Error(`http-${response.status}`);
    }
    return data;
  }
  async function acceptEntity(tx, value) {
    const entity = validateEntity(value);
    if (types && !types.has(entity.entityType)) throw new Error('unsupported-entity-type');
    const record = (await tx.getEntity(entity.entityType, entity.entityId)) || {
      entityType: entity.entityType,
      entityId: entity.entityId,
      localRevision: 0,
      base: null,
      local: null,
    };
    if (!record.base || entity.revision >= record.base.revision) record.base = entity;
    if (record.base?.state === 'withdrawn') {
      for (const pending of await tx.listPending()) {
        if (
          pending.intent.entityType !== entity.entityType ||
          pending.intent.entityId !== entity.entityId
        )
          continue;
        await tx.deletePending(pending.operationId);
        await tx.putConflict({
          operationId: pending.operationId,
          status: 'withdrawn',
          conflictId: null,
        });
      }
    }
    await rebuild(tx, record);
  }
  async function identity(signal, gen) {
    const info = await request('info', undefined, signal, gen);
    if (
      info?.protocol !== 1 ||
      typeof info.libraryId !== 'string' ||
      !info.libraryId ||
      typeof info.epoch !== 'string' ||
      !info.epoch
    )
      throw new Error('unsupported-server-identity');
    await storage.transaction(async (tx) => {
      check(signal, gen);
      const meta = (await tx.getMeta()) || {};
      if (
        meta.identity &&
        (meta.identity.libraryId !== info.libraryId || meta.identity.epoch !== info.epoch)
      )
        throw new Error('server-identity-mismatch');
      if (!meta.identity) {
        meta.identity = { libraryId: info.libraryId, epoch: info.epoch };
        check(signal, gen);
        await tx.setMeta(meta);
      }
    });
  }
  async function receive(mode, signal, gen) {
    let more = true;
    while (more) {
      check(signal, gen);
      const meta = await storage.transaction((tx) => tx.getMeta());
      const cursor = mode === 'snapshot' ? (meta.snapshotCursor ?? null) : (meta.cursor ?? null);
      const page = await request(mode, { cursor, limit: pageLimit }, signal, gen);
      const entities = page.entities || page.changes?.map((item) => item.entity || item);
      const next = page.cursor ?? page.nextCursor;
      more = Boolean(page.hasMore);
      if (
        !Array.isArray(entities) ||
        next === undefined ||
        (more && JSON.stringify(next) === JSON.stringify(cursor))
      )
        throw new Error('invalid-sync-page');
      await storage.transaction(async (tx) => {
        check(signal, gen);
        const current = await tx.getMeta();
        const seen = new Set(current.snapshotKeys || []);
        for (const entity of entities) {
          await acceptEntity(tx, entity);
          if (mode === 'snapshot') seen.add(entityKey(entity.entityType, entity.entityId));
        }
        if (mode === 'snapshot' && more) {
          current.snapshotCursor = next;
          current.snapshotKeys = [...seen];
        } else {
          if (mode === 'snapshot') {
            // Snapshot is the only deliberate complete inventory; normal pull never scans entities.
            for (const record of await tx.listEntities()) {
              if (!seen.has(entityKey(record.entityType, record.entityId))) {
                record.base = null;
                await rebuild(tx, record);
              }
            }
            delete current.snapshotCursor;
            delete current.snapshotKeys;
            current.initialized = true;
          }
          current.cursor = mode === 'snapshot' ? (page.checkpoint ?? next) : next;
          if (mode === 'pull' && !more) delete current.seedCatchUpRequired;
        }
        check(signal, gen);
        await tx.setMeta(current);
      });
      changed();
    }
  }
  async function push(signal, gen) {
    const visited = new Set();
    for (;;) {
      const selected = await storage.transaction(async (tx) => {
        check(signal, gen);
        const heads = new Set();
        for (const item of await tx.listPending()) {
          const key = entityKey(item.intent.entityType, item.intent.entityId);
          if (heads.has(key)) continue;
          heads.add(key);
          if (item.blocked || visited.has(item.operationId)) continue;
          if (!item.wire) {
            const record = await tx.getEntity(item.intent.entityType, item.intent.entityId);
            if (record.base?.state === 'withdrawn') {
              item.blocked = 'withdrawn';
              await tx.putPending(item);
              continue;
            }
            item.wire = {
              ...copy(item.intent),
              operationId: item.operationId,
              baseRevision: record.base?.revision || 0,
            };
            await tx.putPending(item);
          }
          return item;
        }
        return null;
      });
      if (!selected) return;
      visited.add(selected.operationId);
      const response = await request('push', { operations: [selected.wire] }, signal, gen);
      const result = response?.results?.find((r) => r.operationId === selected.operationId);
      if (!result || !['accepted', 'conflict', 'rejected'].includes(result.status))
        throw new Error('invalid-push-result');
      if (
        result.entity &&
        (result.entity.entityType !== selected.intent.entityType ||
          result.entity.entityId !== selected.intent.entityId)
      )
        throw new Error('invalid-ack-entity');
      await storage.transaction(async (tx) => {
        check(signal, gen);
        const pending = (await tx.listPending()).find(
          (p) => p.operationId === selected.operationId,
        );
        if (!pending) return;
        if (result.status === 'accepted') {
          if (!result.entity) throw new Error('missing-ack-entity');
          await tx.deletePending(selected.operationId);
          await acceptEntity(tx, result.entity);
          if (result.conflict || result.conflictId)
            await tx.putConflict({
              operationId: pending.operationId,
              status: 'accepted-conflict',
              conflictId: result.conflictId || null,
            });
        } else {
          pending.blocked = result.status;
          await tx.putPending(pending);
          await tx.putConflict({
            operationId: pending.operationId,
            status: result.status,
            conflictId: result.conflictId || null,
          });
          if (result.entity) await acceptEntity(tx, result.entity);
        }
        check(signal, gen);
      });
      changed();
    }
  }
  async function run(signal, gen) {
    let timeout;
    try {
      // An overall bounded cycle also covers a stalled response.json().
      timeout = setTimeout(() => controller?.abort(), requestTimeoutMs);
      emit({ phase: 'syncing', error: null, retryAt: null });
      await identity(signal, gen);
      const meta = await storage.transaction((tx) => tx.getMeta());
      if (!meta.initialized) await receive('snapshot', signal, gen);
      if (meta.seedCatchUpRequired) await receive('pull', signal, gen);
      await push(signal, gen);
      await receive('pull', signal, gen);
      failures = 0;
      const totals = await counts();
      check(signal, gen);
      emit({ ...totals, phase: running ? 'online' : 'idle', error: null, retryAt: null });
      schedule(pollMs);
    } catch (error) {
      const code = error.message;
      if (gen !== generation) return copy(state);
      if (
        [
          'authentication-required',
          'server-identity-mismatch',
          'unsupported-server-identity',
          'unsupported-entity-type',
        ].includes(code)
      ) {
        paused = code;
        emit({ phase: 'paused', error: code, retryAt: null, ...(await counts()) });
      } else {
        const delay = Math.min(retryMaxMs, retryBaseMs * 2 ** Math.min(failures++, 16));
        emit({
          phase: 'retrying',
          error: /^http-\d+$/u.test(code)
            ? code
            : ['resnapshot-required', 'invalid-sync-page', 'invalid-push-result'].includes(code)
              ? code
              : 'network-or-storage-error',
          retryAt: Date.now() + delay,
          ...(await counts()),
        });
        if (code === 'resnapshot-required')
          await storage.transaction(async (tx) => {
            const meta = await tx.getMeta();
            meta.initialized = false;
            delete meta.snapshotCursor;
            delete meta.snapshotKeys;
            await tx.setMeta(meta);
          });
        schedule(delay);
      }
    } finally {
      clearTimeout(timeout);
    }
    return copy(state);
  }
  function sync() {
    if (importingSeed) return Promise.reject(new Error('seed-import-busy'));
    if (active) return active;
    if (paused) return Promise.resolve(copy(state));
    if (timer !== null) clearTimeout(timer);
    timer = null;
    controller = new AbortController();
    const promise = run(controller.signal, generation);
    active = promise.finally(() => {
      if (active === wrapped) {
        active = null;
        controller = null;
      }
    });
    const wrapped = active;
    return active;
  }
  async function enqueue(input) {
    const intent = copy(input);
    if (
      !intent ||
      typeof intent.entityType !== 'string' ||
      !intent.entityType ||
      typeof intent.entityId !== 'string' ||
      !intent.entityId ||
      !commands.has(intent.command)
    )
      throw new Error('invalid-operation');
    if (intent.entityType === 'asset') throw new Error('server-owned-entity-type');
    if (types && !types.has(intent.entityType)) throw new Error('unsupported-entity-type');
    if (
      intent.command === 'updateFields' &&
      (!intent.changes || typeof intent.changes !== 'object' || Array.isArray(intent.changes))
    )
      throw new Error('invalid-changes');
    // Caller does not choose transport revision or reuse a prior wire operation ID.
    delete intent.operationId;
    delete intent.baseRevision;
    delete intent.deviceId;
    const operationId = idFactory();
    const saved = await storage.transaction(async (tx) => {
      const record = (await tx.getEntity(intent.entityType, intent.entityId)) || {
        entityType: intent.entityType,
        entityId: intent.entityId,
        base: null,
        local: null,
        localRevision: 0,
      };
      if (record.base?.state === 'withdrawn') throw new Error('entity-withdrawn');
      if ((await tx.listPending()).some((item) => item.operationId === operationId))
        throw new Error('duplicate-operation-id');
      record.localRevision++;
      await tx.putPending({ operationId, intent, wire: null, localRevision: record.localRevision });
      await rebuild(tx, record);
      return copy(record.local);
    });
    changed();
    emit(await counts());
    if (running) schedule(0);
    return { operationId, entity: saved };
  }
  function stop() {
    running = false;
    generation++;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    controller?.abort();
    try {
      unwatch?.();
    } catch {
      /* stop must still cancel transport if an observer fails */
    }
    unwatch = null;
    emit({ phase: 'stopped', retryAt: null });
  }
  async function start() {
    if (importingSeed) throw new Error('seed-import-busy');
    running = true;
    if (watch && !unwatch)
      unwatch =
        watch({
          notify: () => {
            if (running && !paused) schedule(0);
          },
        }) || null;
    return sync();
  }
  return {
    /** File adapter must verify package/member hashes before passing decoded records.
     * No network or file work occurs inside the atomic authority transaction.
     */
    async importSeed({ manifest, records, sha256 }) {
      const { validateSeedManifest, validateSeedEntity } = await import('./product-seed.js');
      if (running || active || importingSeed) throw new Error('sync-must-be-stopped-for-seed');
      validateSeedManifest(manifest);
      if (
        !/^[a-f0-9]{64}$/.test(sha256 || '') ||
        !Array.isArray(records) ||
        records.length !== manifest.entityCount
      )
        throw new Error('invalid-verified-seed');
      const keys = new Set();
      for (const record of records) {
        validateSeedEntity(record);
        const key = entityKey(record.entityType, record.entityId);
        if (keys.has(key)) throw new Error('duplicate-seed-entity');
        keys.add(key);
      }
      importingSeed = true;
      const gen = generation;
      const abort = new AbortController();
      controller = abort;
      const timeout = setTimeout(() => abort.abort(), requestTimeoutMs);
      try {
        await identity(abort.signal, gen);
        const proof = await request(
          'seed/resolve',
          {
            packageId: manifest.packageId,
            sha256,
            libraryId: manifest.libraryId,
            epoch: manifest.epoch,
            checkpoint: manifest.checkpoint,
          },
          abort.signal,
          gen,
          'product',
        );
        if (
          proof.verified !== true ||
          proof.sha256 !== sha256 ||
          proof.packageId !== manifest.packageId ||
          proof.libraryId !== manifest.libraryId ||
          proof.epoch !== manifest.epoch ||
          proof.checkpoint !== manifest.checkpoint ||
          proof.watermark !== manifest.watermark
        )
          throw new Error('seed-verification-mismatch');
        if (!Array.isArray(proof.redactions)) throw new Error('seed-verification-mismatch');
        for (const redaction of proof.redactions) {
          validateSeedEntity(redaction);
          if (redaction.state === 'active') throw new Error('invalid-seed-redaction');
        }
        const result = await storage.transaction(async (tx) => {
          check(abort.signal, gen);
          const meta = (await tx.getMeta()) || {};
          if (
            meta.identity?.libraryId !== manifest.libraryId ||
            meta.identity?.epoch !== manifest.epoch
          )
            throw new Error('server-identity-mismatch');
          if (meta.seedPackages?.includes(sha256)) return { imported: false, replayed: true };
          if (meta.initialized || meta.snapshotCursor)
            throw new Error('seed-target-already-initialized');
          for (const record of records) await acceptEntity(tx, record);
          // The server can scrub an old offline package without forcing a second
          // full media transfer. Apply its tombstones before publishing any rows.
          for (const redaction of proof.redactions) await acceptEntity(tx, redaction);
          // acceptEntity rebases existing intents; it never re-enqueues incoming records.
          const next = (await tx.getMeta()) || meta;
          next.initialized = true;
          next.cursor = manifest.checkpoint;
          next.seedCatchUpRequired = true;
          next.seedPackages = [...(next.seedPackages || []), sha256].slice(-16);
          next.seedPolicy = copy(manifest.policy);
          check(abort.signal, gen);
          await tx.setMeta(next);
          return { imported: true, entities: records.length, catchUpRequired: true };
        });
        changed();
        return result;
      } finally {
        clearTimeout(timeout);
        importingSeed = false;
        if (controller === abort) controller = null;
      }
    },
    enqueue,
    edit: enqueue,
    sync,
    start,
    stop,
    notify() {
      if (!paused) {
        if (running) schedule(0);
        else return sync();
      }
    },
    status: () => copy(state),
    read: (type, id) =>
      storage.transaction(async (tx) => copy((await tx.getEntity(type, id))?.local || null)),
    list: (type) =>
      storage.transaction(async (tx) =>
        (await tx.listEntities(type)).map((r) => copy(r.local)).filter(Boolean),
      ),
    conflicts: () => storage.transaction((tx) => tx.listConflicts()),
    setToken(value) {
      credential = value;
      if (paused === 'authentication-required') {
        paused = null;
        emit({ phase: 'idle', error: null });
        if (running) schedule(0);
      }
    },
    async setBaseUrl(value) {
      const next = normalizeSyncBaseUrl(value);
      const resume = running;
      stop();
      if (active) await active;
      base = next;
      paused = null;
      emit({ phase: 'idle', error: null });
      if (resume) return start();
    },
  };
}

/** A separate database must be explicitly named by the caller. No TL migration,
 * deletion, token persistence or browser-window dependency occurs here. */
export function createIndexedDbSyncStorage({
  dbName,
  indexedDB = globalThis.indexedDB,
  diaryIndex = false,
} = {}) {
  if (!indexedDB || typeof dbName !== 'string' || !dbName.startsWith('shiye-sync-v2-'))
    throw new Error('explicit-sync-database-required');
  if (diaryIndex && !dbName.startsWith('shiye-sync-v2-shared-'))
    throw new Error('SHARED_DIARY_INDEX_SHARED_DB_REQUIRED');
  let versionChanged = false;
  let upgradeFailure = null;
  let blocked = false;
  const opened = new Promise((resolve, reject) => {
    // Only shared diary callers opt into v2. Existing v1 callers open the
    // current version and maintain v2 headers whenever they find that schema.
    const request = diaryIndex ? indexedDB.open(dbName, 3) : indexedDB.open(dbName);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (request.transaction.db.version >= 1 && !db.objectStoreNames.contains('entities')) {
        db.createObjectStore('meta');
        const entities = db.createObjectStore('entities', { keyPath: 'key' });
        entities.createIndex('entityType', 'entityType');
        db.createObjectStore('pending', { keyPath: 'operationId' });
        db.createObjectStore('conflicts', { keyPath: 'operationId' });
      }
      if (db.version < 2) return;
      const headers = db.objectStoreNames.contains('diaryHeaders')
        ? request.transaction.objectStore('diaryHeaders')
        : db.createObjectStore('diaryHeaders', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('diarySidecars'))
        db.createObjectStore('diarySidecars', { keyPath: 'key' });
      const indexState = db.objectStoreNames.contains('diaryIndexState')
        ? request.transaction.objectStore('diaryIndexState')
        : db.createObjectStore('diaryIndexState');
      const search = db.objectStoreNames.contains('diarySearch')
        ? request.transaction.objectStore('diarySearch')
        : db.createObjectStore('diarySearch', { keyPath: 'id' });
      const title = db.objectStoreNames.contains('diaryTitle')
        ? request.transaction.objectStore('diaryTitle')
        : db.createObjectStore('diaryTitle', { keyPath: 'id' });
      if (!headers.indexNames.contains('displayKey'))
        headers.createIndex('displayKey', 'displayKey', { unique: true });
      if (!headers.indexNames.contains('bootstrapKey'))
        headers.createIndex('bootstrapKey', 'bootstrapKey', { unique: true });
      headers.clear();
      search.clear();
      title.clear();
      indexState.put({ revision: 1, version: DIARY_INDEX_VERSION }, 'state');
      const cursor = request.transaction.objectStore('entities').openCursor();
      cursor.onsuccess = () => {
        const item = cursor.result;
        if (!item) return;
        try {
          const header = diaryHeaderFromEntity(item.value);
          if (header) {
            if (!diaryHeaderFitsPage(header)) throw new Error('SHARED_DIARY_HEADER_TOO_LARGE');
            headers.put(header);
            search.put(diarySearchFromEntity(item.value));
          }
          const titleRow = diaryTitleFromEntity(item.value);
          if (titleRow) title.put(titleRow);
          item.continue();
        } catch (error) {
          upgradeFailure = error;
          request.transaction.abort();
        }
      };
      cursor.onerror = () => {
        upgradeFailure = new Error('SHARED_DIARY_INDEX_REBUILD_FAILED');
        request.transaction.abort();
      };
    };
    request.onsuccess = () => {
      if (blocked) {
        request.result.close();
        return;
      }
      request.result.onversionchange = () => {
        versionChanged = true;
        request.result.close();
      };
      resolve(request.result);
    };
    request.onerror = () => reject(upgradeFailure || new Error('indexeddb-open-failed'));
    request.onblocked = () => {
      blocked = true;
      reject(new Error('SHARED_DB_UPGRADE_BLOCKED_RELOAD'));
    };
  });
  const requestValue = (request) =>
    new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('indexeddb-request-failed'));
    });
  return {
    async transaction(fn) {
      const db = await opened;
      if (versionChanged) throw new Error('SHARED_DB_VERSION_CHANGED_RELOAD');
      const indexed = db.objectStoreNames.contains('diaryHeaders');
      const searchable = db.objectStoreNames.contains('diarySearch');
      const titled = db.objectStoreNames.contains('diaryTitle');
      if (diaryIndex && !indexed) throw new Error('SHARED_DIARY_INDEX_UNAVAILABLE');
      const transaction = db.transaction(
        [
          'meta',
          'entities',
          'pending',
          'conflicts',
          ...(indexed ? ['diaryHeaders', 'diaryIndexState'] : []),
          ...(searchable ? ['diarySearch'] : []),
          ...(titled ? ['diaryTitle'] : []),
        ],
        'readwrite',
        { durability: 'strict' },
      );
      const store = (name) => transaction.objectStore(name);
      const done = new Promise((resolve, reject) => {
        transaction.oncomplete = resolve;
        transaction.onabort = () => reject(new Error('indexeddb-transaction-aborted'));
        transaction.onerror = () => {};
      });
      // Attach immediately to avoid an unhandled rejection while fn unwinds.
      done.catch(() => {});
      const bumpDiaryRevision = async () => {
        const stateStore = store('diaryIndexState');
        const state = await requestValue(stateStore.get('state'));
        if (
          !(
            (searchable && state?.version === DIARY_INDEX_VERSION) ||
            (!searchable && state?.version === 1)
          ) ||
          !Number.isSafeInteger(state.revision) ||
          state.revision >= Number.MAX_SAFE_INTEGER
        )
          throw new Error('SHARED_DIARY_INDEX_INVALID');
        await requestValue(stateStore.put({ ...state, revision: state.revision + 1 }, 'state'));
      };
      const updateDiaryHeader = async (record) => {
        if (!indexed) return;
        if (record.entityType === 'taxonomy') return bumpDiaryRevision();
        if (record.entityType !== 'entry') return;
        const headers = store('diaryHeaders');
        const previous = await requestValue(headers.get(record.entityId));
        const next = diaryHeaderFromEntity(record);
        const search = searchable ? diarySearchFromEntity(record) : null;
        if (next && !diaryHeaderFitsPage(next)) throw new Error('SHARED_DIARY_HEADER_TOO_LARGE');
        const searchStore = searchable ? store('diarySearch') : null;
        const priorSearch = searchStore
          ? await requestValue(searchStore.get(record.entityId))
          : null;
        const titleStore = titled ? store('diaryTitle') : null;
        const titleRow = titled ? diaryTitleFromEntity(record) : null;
        const priorTitle = titleStore ? await requestValue(titleStore.get(record.entityId)) : null;
        if (
          JSON.stringify(previous || null) === JSON.stringify(next || null) &&
          JSON.stringify(priorSearch || null) === JSON.stringify(search || null) &&
          JSON.stringify(priorTitle || null) === JSON.stringify(titleRow || null)
        )
          return;
        if (next) await requestValue(headers.put(next));
        else await requestValue(headers.delete(record.entityId));
        if (searchStore) {
          if (search) await requestValue(searchStore.put(search));
          else await requestValue(searchStore.delete(record.entityId));
        }
        if (titleStore) {
          if (titleRow) await requestValue(titleStore.put(titleRow));
          else await requestValue(titleStore.delete(record.entityId));
        }
        await bumpDiaryRevision();
      };
      let result;
      try {
        result = await fn({
          getMeta: () => requestValue(store('meta').get('state')),
          setMeta: (value) => requestValue(store('meta').put(copy(value), 'state')),
          getEntity: async (type, id) => {
            const row = await requestValue(store('entities').get(entityKey(type, id)));
            if (row) delete row.key;
            return row;
          },
          putEntity: async (record) => {
            await requestValue(
              store('entities').put({
                ...copy(record),
                key: entityKey(record.entityType, record.entityId),
              }),
            );
            await updateDiaryHeader(record);
          },
          deleteEntity: async (type, id) => {
            await requestValue(store('entities').delete(entityKey(type, id)));
            if (type === 'entry' || type === 'taxonomy')
              await updateDiaryHeader({ entityType: type, entityId: id, local: null });
          },
          listEntities: async (type) =>
            (
              await requestValue(
                type
                  ? store('entities').index('entityType').getAll(type)
                  : store('entities').getAll(),
              )
            ).map(({ key: _key, ...row }) => row),
          listPending: async () =>
            (await requestValue(store('pending').getAll())).sort((a, b) => a.order - b.order),
          putPending: async (record) => {
            const current = await requestValue(store('pending').get(record.operationId));
            const meta = (await requestValue(store('meta').get('queueSequence'))) || 0;
            if (!current) await requestValue(store('meta').put(meta + 1, 'queueSequence'));
            return requestValue(
              store('pending').put({ ...copy(record), order: current?.order ?? meta + 1 }),
            );
          },
          deletePending: (id) => requestValue(store('pending').delete(id)),
          listConflicts: () => requestValue(store('conflicts').getAll()),
          putConflict: (record) => requestValue(store('conflicts').put(copy(record))),
        });
      } catch (error) {
        try {
          transaction.abort();
        } catch {
          /* already aborted */
        }
        await done.catch(() => {});
        throw error;
      }
      await done;
      return result;
    },
    async readDiaryPage({ libraryId, epoch, ...input } = {}) {
      const db = await opened;
      if (versionChanged) throw new Error('SHARED_DB_VERSION_CHANGED_RELOAD');
      if (!db.objectStoreNames.contains('diaryHeaders'))
        throw new Error('SHARED_DIARY_INDEX_UNAVAILABLE');
      const options = diaryPageOptions(input);
      if (!db.objectStoreNames.contains('diarySearch'))
        throw new Error('SHARED_DIARY_INDEX_UNAVAILABLE');
      const transaction = db.transaction(
        ['meta', 'diaryHeaders', 'diarySearch', 'diaryIndexState'],
        'readonly',
      );
      const done = new Promise((resolve, reject) => {
        transaction.oncomplete = resolve;
        transaction.onabort = () => reject(new Error('indexeddb-transaction-aborted'));
        transaction.onerror = () => {};
      });
      done.catch(() => {});
      try {
        const meta = await requestValue(transaction.objectStore('meta').get('state'));
        if (!meta || meta.libraryId !== libraryId || meta.epoch !== epoch)
          throw new Error('SHARED_IDENTITY_MISMATCH');
        const state = await requestValue(transaction.objectStore('diaryIndexState').get('state'));
        if (state?.version !== DIARY_INDEX_VERSION || !Number.isSafeInteger(state.revision))
          throw new Error('SHARED_DIARY_INDEX_INVALID');
        const queryKey = diaryQueryKey(options);
        const prior = options.cursor ? decodeDiaryCursor(options.cursor) : null;
        if (
          prior &&
          (prior.libraryId !== libraryId ||
            prior.epoch !== epoch ||
            prior.queryKey !== queryKey ||
            prior.queryRevision !== state.revision)
        )
          throw new Error('SHARED_DIARY_CURSOR_STALE');
        const items = [];
        let scanned = 0,
          bytes = 512,
          after = prior?.after || null,
          hasMore = false,
          lookahead = false;
        await new Promise((resolve, reject) => {
          const cursorRequest = transaction
            .objectStore('diaryHeaders')
            .index('displayKey')
            .openCursor();
          cursorRequest.onerror = () => reject(new Error('indexeddb-request-failed'));
          cursorRequest.onsuccess = async () => {
            const cursor = cursorRequest.result;
            if (!cursor) return resolve();
            if (after && indexedDB.cmp(cursor.key, after) <= 0) {
              if (indexedDB.cmp(cursor.key, after) < 0) cursor.continue(after);
              else cursor.continue();
              return;
            }
            if (scanned >= Math.max(400, options.limit * 10)) {
              hasMore = true;
              return resolve();
            }
            scanned++;
            const row = cursor.value;
            const included =
              (options.deleted === undefined || row.deleted === options.deleted) &&
              (options.includeChat || !row.chat);
            try {
              const search = included
                ? await requestValue(transaction.objectStore('diarySearch').get(row.id))
                : null;
              if (included && diaryMatches(row, search, options)) {
                if (lookahead) {
                  hasMore = true;
                  return resolve();
                }
                const publicRow = diaryPublicHeader(row);
                const size = diaryPageBytes(publicRow) + 1;
                if (bytes + size > DIARY_PAGE_MAX_BYTES - 2048) {
                  hasMore = true;
                  return resolve();
                }
                items.push(publicRow);
                bytes += size;
              }
              after = cursor.key;
              if (items.length === options.limit) lookahead = true;
              cursor.continue();
            } catch (error) {
              reject(error);
            }
          };
        });
        const result = {
          items,
          nextCursor: hasMore
            ? encodeDiaryCursor({
                version: DIARY_INDEX_VERSION,
                libraryId,
                epoch,
                queryKey,
                queryRevision: state.revision,
                after,
              })
            : null,
          hasMore,
          queryRevision: state.revision,
          sort: 'product-created-v1',
        };
        if (diaryPageBytes(result) > DIARY_PAGE_MAX_BYTES)
          throw new Error('SHARED_DIARY_PAGE_TOO_LARGE');
        await done;
        return result;
      } catch (error) {
        try {
          transaction.abort();
        } catch {
          /* already complete */
        }
        await done.catch(() => {});
        throw error;
      }
    },
    async readDiarySummary({ libraryId, epoch, kind, today, currentId, ...input } = {}) {
      const db = await opened;
      if (versionChanged) throw new Error('SHARED_DB_VERSION_CHANGED_RELOAD');
      if (!db.objectStoreNames.contains('diarySearch'))
        throw new Error('SHARED_DIARY_INDEX_UNAVAILABLE');
      if (!['count', 'calendar', 'streak', 'neighbor'].includes(kind))
        throw new Error('SHARED_DIARY_QUERY_INVALID');
      const options = diaryPageOptions(input);
      const tx = db.transaction(
        ['meta', 'diaryHeaders', 'diarySearch', 'diaryIndexState'],
        'readonly',
      );
      const done = new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onabort = () => reject(new Error('indexeddb-transaction-aborted'));
        tx.onerror = () => {};
      });
      done.catch(() => {});
      try {
        const meta = await requestValue(tx.objectStore('meta').get('state'));
        if (!meta || meta.libraryId !== libraryId || meta.epoch !== epoch)
          throw new Error('SHARED_IDENTITY_MISMATCH');
        const state = await requestValue(tx.objectStore('diaryIndexState').get('state'));
        if (state?.version !== DIARY_INDEX_VERSION) throw new Error('SHARED_DIARY_INDEX_INVALID');
        const dates = new Set();
        let count = 0,
          neighborId = '',
          latestCreatedAt = '',
          scanned = 0;
        const rows = tx.objectStore('diaryHeaders');
        const cursorSource = kind === 'neighbor' ? rows.index('bootstrapKey') : rows;
        await new Promise((resolve, reject) => {
          const request = cursorSource.openCursor();
          request.onerror = () => reject(new Error('indexeddb-request-failed'));
          request.onsuccess = async () => {
            const cursor = request.result;
            if (!cursor) return resolve();
            try {
              if (++scanned > 1000000) throw new Error('SHARED_DIARY_QUERY_SCAN_LIMIT');
              const row = cursor.value;
              if (kind === 'neighbor') {
                if (row.id !== currentId && (!neighborId || row.createdAt > latestCreatedAt)) {
                  neighborId = row.id;
                  latestCreatedAt = row.createdAt;
                }
              } else if (kind === 'streak') {
                const day = diaryDayKey(row.date, options.timeZone);
                if (day) dates.add(day);
              } else if (
                (options.deleted === undefined || row.deleted === options.deleted) &&
                (options.includeChat || !row.chat)
              ) {
                const search = await requestValue(tx.objectStore('diarySearch').get(row.id));
                if (diaryMatches(row, search, options, kind === 'calendar')) {
                  count++;
                  const day = diaryDayKey(row.date, options.timeZone);
                  if (day) dates.add(day);
                }
              }
              cursor.continue();
            } catch (error) {
              reject(error);
            }
          };
        });
        let value;
        if (kind === 'count') value = count;
        else if (kind === 'calendar') value = [...dates].sort();
        else if (kind === 'neighbor') value = { found: !!neighborId, id: neighborId };
        else {
          if (
            !/^\d{4}-\d{2}-\d{2}$/.test(today || '') ||
            diaryDayKey(today, options.timeZone) !== today
          )
            throw new Error('SHARED_DIARY_TODAY_INVALID');
          value = diaryStreak(dates, today);
        }
        await done;
        return { value, queryRevision: state.revision };
      } catch (error) {
        try {
          tx.abort();
        } catch {
          /* already complete */
        }
        await done.catch(() => {});
        throw error;
      }
    },
    async readDiarySuggestedTitle({
      libraryId,
      epoch,
      entryId,
      date,
      categoryId = null,
      timeZone,
      sourceCoverage,
    } = {}) {
      const db = await opened;
      if (versionChanged) throw new Error('SHARED_DB_VERSION_CHANGED_RELOAD');
      if (!db.objectStoreNames.contains('diaryTitle'))
        throw new Error('SHARED_DIARY_INDEX_UNAVAILABLE');
      if (
        sourceCoverage?.complete !== true ||
        sourceCoverage?.productComplete !== true ||
        !Array.isArray(sourceCoverage.legacyEntries) ||
        sourceCoverage.legacyEntries.length > 100000
      )
        throw new Error('SHARED_DIARY_TITLE_SOURCE_COVERAGE_REQUIRED');
      const zone = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
      const tx = db.transaction(['meta', 'entities', 'diaryTitle', 'diaryIndexState'], 'readonly');
      const done = new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onabort = () => reject(new Error('indexeddb-transaction-aborted'));
        tx.onerror = () => {};
      });
      done.catch(() => {});
      try {
        const meta = await requestValue(tx.objectStore('meta').get('state'));
        if (!meta || meta.libraryId !== libraryId || meta.epoch !== epoch)
          throw new Error('SHARED_IDENTITY_MISMATCH');
        const state = await requestValue(tx.objectStore('diaryIndexState').get('state'));
        if (state?.version !== DIARY_INDEX_VERSION) throw new Error('SHARED_DIARY_INDEX_INVALID');
        let categoryName = sourceCoverage.categoryName;
        let stableCategoryIdentity = false;
        if (categoryId) {
          const taxonomy = await requestValue(
            tx.objectStore('entities').get(entityKey('taxonomy', categoryId)),
          );
          if (taxonomy) {
            if (
              taxonomy.local?.state !== 'active' ||
              taxonomy.local?.data?.kind !== 'category' ||
              typeof taxonomy.local.data.name !== 'string'
            )
              throw new Error('SHARED_DIARY_TITLE_CATEGORY_UNVERIFIED');
            if (
              categoryName !== null &&
              categoryName !== undefined &&
              categoryName !== taxonomy.local.data.name
            )
              throw new Error('SHARED_DIARY_TITLE_CATEGORY_CONFLICT');
            categoryName = taxonomy.local.data.name;
            stableCategoryIdentity = true;
          }
        }
        const products = [];
        await new Promise((resolve, reject) => {
          const request = tx.objectStore('diaryTitle').openCursor();
          request.onerror = () => reject(new Error('indexeddb-request-failed'));
          request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) return resolve();
            if (products.length >= 100000)
              return reject(new Error('SHARED_DIARY_QUERY_SCAN_LIMIT'));
            products.push(cursor.value);
            cursor.continue();
          };
        });
        const value = diarySuggestedTitle({
          entryId,
          date,
          categoryId,
          draft: sourceCoverage.draft,
          legacyEntries: sourceCoverage.legacyEntries,
          products,
          categoryName,
          stableCategoryIdentity,
          timeZone: zone,
        });
        await done;
        return { ...value, queryRevision: state.revision };
      } catch (error) {
        try {
          tx.abort();
        } catch {
          /* already complete */
        }
        await done.catch(() => {});
        throw error;
      }
    },
    async readDiarySidecar({ libraryId, epoch, entryId, kind, includeDiscarded = false }) {
      const db = await opened;
      if (versionChanged) throw new Error('SHARED_DB_VERSION_CHANGED_RELOAD');
      if (!db.objectStoreNames.contains('diarySidecars'))
        throw new Error('SHARED_DIARY_INDEX_UNAVAILABLE');
      if (typeof entryId !== 'string' || !entryId || !['draft', 'reading'].includes(kind))
        throw new Error('SHARED_DIARY_SIDECAR_INVALID');
      const tx = db.transaction(['meta', 'diarySidecars'], 'readonly');
      const meta = await requestValue(tx.objectStore('meta').get('state'));
      if (!meta || meta.libraryId !== libraryId || meta.epoch !== epoch)
        throw new Error('SHARED_IDENTITY_MISMATCH');
      const row =
        (await requestValue(
          tx.objectStore('diarySidecars').get(JSON.stringify([libraryId, epoch, entryId, kind])),
        )) || null;
      return copy(row?.discarded && !includeDiscarded ? null : row);
    },
    async writeDiarySidecar({
      libraryId,
      epoch,
      entryId,
      kind,
      expectedRevision,
      baseLocalRevision,
      value,
    }) {
      const db = await opened;
      if (versionChanged) throw new Error('SHARED_DB_VERSION_CHANGED_RELOAD');
      if (!db.objectStoreNames.contains('diarySidecars'))
        throw new Error('SHARED_DIARY_INDEX_UNAVAILABLE');
      if (
        typeof entryId !== 'string' ||
        !entryId ||
        !['draft', 'reading'].includes(kind) ||
        !Number.isSafeInteger(expectedRevision) ||
        expectedRevision < 0 ||
        !Number.isSafeInteger(baseLocalRevision) ||
        baseLocalRevision < 0
      )
        throw new Error('SHARED_DIARY_SIDECAR_INVALID');
      const safe = value === null ? null : validateDiarySidecar(value, kind);
      const tx = db.transaction(['meta', 'entities', 'diarySidecars'], 'readwrite', {
        durability: 'strict',
      });
      const done = new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onabort = () => reject(new Error('indexeddb-transaction-aborted'));
        tx.onerror = () => {};
      });
      done.catch(() => {});
      try {
        const meta = await requestValue(tx.objectStore('meta').get('state'));
        if (!meta || meta.libraryId !== libraryId || meta.epoch !== epoch)
          throw new Error('SHARED_IDENTITY_MISMATCH');
        const entity = await requestValue(
          tx.objectStore('entities').get(entityKey('entry', entryId)),
        );
        if ((entity?.localRevision ?? 0) !== baseLocalRevision)
          throw new Error('SHARED_DIARY_BASE_LOCAL_REVISION_CONFLICT');
        const key = JSON.stringify([libraryId, epoch, entryId, kind]);
        const sidecars = tx.objectStore('diarySidecars');
        const prior = await requestValue(sidecars.get(key));
        if ((prior?.revision ?? 0) !== expectedRevision)
          throw new Error('SHARED_DIARY_DRAFT_REVISION_CONFLICT');
        await requestValue(
          sidecars.put({
            key,
            kind,
            entryId,
            revision: expectedRevision + 1,
            baseLocalRevision,
            value: safe,
            discarded: safe === null,
          }),
        );
        await done;
        return safe === null
          ? { entryId, kind, revision: expectedRevision + 1, discarded: true }
          : { entryId, kind, revision: expectedRevision + 1, baseLocalRevision, value: safe };
      } catch (error) {
        try {
          tx.abort();
        } catch {
          /* already complete */
        }
        await done.catch(() => {});
        throw error;
      }
    },
    async close() {
      (await opened).close();
    },
  };
}
