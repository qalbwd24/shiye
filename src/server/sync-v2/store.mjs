import { DatabaseSync } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

const TYPES = new Set([
  'journalAggregate',
  'chatMessage',
  'conversation',
  'taxonomy',
  'relation',
  'order',
  'appearance',
  'profile',
  'sticker',
  'commandMapping',
  'serviceConfig',
  'binding',
  'comment',
]);
const COMMANDS = new Set(['create', 'updateFields', 'delete', 'withdraw', 'restore']);
const ENVELOPE = new Set([
  'operationId',
  'entityType',
  'entityId',
  'baseRevision',
  'command',
  'data',
  'changes',
]);
const OWNED = new Set([
  'serverOwned',
  'serverRevision',
  'lastSeq',
  'changeSeq',
  'receivedAt',
  'runtime',
  'serviceOutput',
  'ruleRevision',
  'runnerState',
  'lease',
  'fencingToken',
  'deliveryCursor',
  'scheduleCursor',
  'deduplication',
  'libraryId',
  'epoch',
]);
const DEVICE_LOCAL = new Set([
  'localPath',
  'filePath',
  'absolutePath',
  'dataDir',
  'mediaDir',
  'authToken',
  'password',
]);
const BODY = new Set([
  'body',
  'content',
  'markdownSource',
  'markdownHtml',
  'editorOriginalHtml',
  'contentFormat',
  'messageUnits',
  'units',
  'layout',
  '_canonical',
]);
const MAX_OPERATION = 1024 * 1024;
const MAX_BATCH = 4 * 1024 * 1024;
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const object = (value) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fail = (status, code, message) => Object.assign(new Error(message), { status, code });
const validId = (value) => typeof value === 'string' && /^[A-Za-z0-9_:@.-]{1,160}$/.test(value);

function assertJson(value) {
  let count = 0;
  const seen = new Set();
  function visit(item, depth) {
    if (++count > 100000 || depth > 64)
      throw fail(400, 'INVALID_JSON', 'JSON structure exceeds limits');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return;
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (typeof item !== 'object' || (!Array.isArray(item) && !object(item)) || seen.has(item)) {
      throw fail(400, 'INVALID_JSON', 'Only finite JSON values are accepted');
    }
    seen.add(item);
    for (const key of Object.keys(item)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key))
        throw fail(400, 'INVALID_JSON_KEY', 'Unsafe object key');
      if (DEVICE_LOCAL.has(key))
        throw fail(
          400,
          'DEVICE_LOCAL_FIELD',
          'Device paths and credentials cannot be synchronized',
        );
      visit(item[key], depth + 1);
    }
    seen.delete(item);
  }
  visit(value, 0);
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
const equal = (a, b) => canonical(a) === canonical(b);

function validateOperation(op, { serverWrite = false } = {}) {
  assertJson(op);
  if (!object(op) || Object.keys(op).some((key) => !ENVELOPE.has(key)))
    throw fail(400, 'INVALID_OPERATION', 'Unknown or invalid operation envelope');
  if (!validId(op.operationId) || !validId(op.entityId))
    throw fail(400, 'INVALID_ID', 'Stable operation and entity IDs are required');
  if (!TYPES.has(op.entityType))
    throw fail(400, 'ENTITY_TYPE_FORBIDDEN', 'Entity type is not client writable');
  if (!COMMANDS.has(op.command)) throw fail(400, 'INVALID_COMMAND', 'Unsupported command');
  if (!Number.isSafeInteger(op.baseRevision) || op.baseRevision < 0)
    throw fail(400, 'INVALID_REVISION', 'baseRevision must be a nonnegative integer');
  if (Buffer.byteLength(JSON.stringify(op)) > MAX_OPERATION)
    throw fail(413, 'OPERATION_TOO_LARGE', 'Operation exceeds 1 MiB');
  if (op.command === 'create') {
    if (!object(op.data) || has(op, 'changes') || op.baseRevision !== 0)
      throw fail(400, 'INVALID_CREATE', 'Create requires data and baseRevision 0');
  } else if (op.command === 'updateFields') {
    if (!object(op.changes) || !Object.keys(op.changes).length || has(op, 'data'))
      throw fail(400, 'INVALID_CHANGES', 'Update requires nonempty changes');
  } else if (has(op, 'data') || has(op, 'changes')) {
    throw fail(400, 'INVALID_OPERATION', 'State commands do not carry data');
  }
  const payload = op.data || op.changes;
  if (!serverWrite && payload && Object.keys(payload).some((key) => OWNED.has(key)))
    throw fail(403, 'SERVER_OWNED_FIELD', 'Server-owned fields cannot be written');
  if (
    !serverWrite &&
    op.entityType === 'serviceConfig' &&
    payload &&
    ['cursor', 'state', 'running', 'deliveries', 'selectedDate', 'ruleVersion', 'nextRunAt'].some(
      (key) => has(payload, key),
    )
  ) {
    throw fail(403, 'SERVER_OWNED_FIELD', 'Service execution state is server-owned');
  }
  if (op.command === 'withdraw' && !['chatMessage', 'comment'].includes(op.entityType))
    throw fail(400, 'INVALID_WITHDRAW', 'Withdrawal is only available for messages and comments');
  if (op.command === 'restore' && ['chatMessage', 'comment'].includes(op.entityType))
    throw fail(409, 'TOMBSTONE_FINAL', 'Messages are resent with new identities');
}

export { validateOperation as validateSyncOperation };

/** Independent sync database. This module never opens the existing diary store. */
export async function openSyncStore({ dataDir, clock = Date.now } = {}) {
  if (typeof dataDir !== 'string' || !path.isAbsolute(dataDir))
    throw fail(400, 'DATA_DIR_REQUIRED', 'An explicit absolute dataDir is required');
  await mkdir(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'sync.sqlite'));
  db.exec(`
    PRAGMA busy_timeout=5000;
    PRAGMA journal_mode=WAL;
    PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS entities(type TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,state TEXT NOT NULL,data TEXT NOT NULL,updatedAt TEXT NOT NULL,lastSeq INTEGER NOT NULL,PRIMARY KEY(type,id));
    CREATE TABLE IF NOT EXISTS changes(seq INTEGER PRIMARY KEY AUTOINCREMENT,type TEXT NOT NULL,id TEXT NOT NULL,operationId TEXT NOT NULL,entity TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS changes_entity ON changes(type,id,seq);
    CREATE TABLE IF NOT EXISTS versions(type TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,entity TEXT NOT NULL,PRIMARY KEY(type,id,revision));
    CREATE TABLE IF NOT EXISTS receipts(operationId TEXT PRIMARY KEY,digest TEXT NOT NULL,type TEXT NOT NULL,id TEXT NOT NULL,result TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS receipts_entity ON receipts(type,id);
    CREATE TABLE IF NOT EXISTS conflicts(conflictId TEXT PRIMARY KEY,type TEXT NOT NULL,id TEXT NOT NULL,operationId TEXT NOT NULL,detail TEXT NOT NULL,createdAt TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS conflicts_entity ON conflicts(type,id);
  `);
  db.exec('BEGIN IMMEDIATE');
  try {
    const put = db.prepare('INSERT OR IGNORE INTO metadata(key,value) VALUES (?,?)');
    put.run('libraryId', randomUUID());
    put.run('epoch', randomUUID());
    put.run('cursorKey', randomBytes(32).toString('hex'));
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    db.close();
    throw error;
  }
  const meta = Object.fromEntries(
    db
      .prepare('SELECT key,value FROM metadata')
      .all()
      .map((row) => [row.key, row.value]),
  );
  let closed = false;
  const active = () => {
    if (closed) throw fail(503, 'STORE_CLOSED', 'Sync store is closed');
  };
  const seq = () => Number(db.prepare('SELECT COALESCE(MAX(seq),0) AS seq FROM changes').get().seq);
  function encode(mode, after, watermark = null) {
    const body = Buffer.from(
      JSON.stringify({
        protocol: 1,
        libraryId: meta.libraryId,
        epoch: meta.epoch,
        mode,
        after,
        watermark,
      }),
    ).toString('base64url');
    const mac = createHmac('sha256', meta.cursorKey).update(body).digest('base64url');
    return `${body}.${mac}`;
  }
  function decode(cursor, mode) {
    if (cursor === undefined || cursor === null || cursor === '')
      return { after: 0, watermark: null };
    if (typeof cursor !== 'string' || cursor.length > 2048)
      throw fail(400, 'INVALID_CURSOR', 'Invalid cursor');
    const [body, mac, extra] = cursor.split('.');
    if (!body || !mac || extra) throw fail(400, 'INVALID_CURSOR', 'Invalid cursor');
    const expected = createHmac('sha256', meta.cursorKey).update(body).digest();
    const received = Buffer.from(mac, 'base64url');
    if (expected.length !== received.length || !timingSafeEqual(expected, received))
      throw fail(
        409,
        'RESNAPSHOT_REQUIRED',
        'Cursor belongs to another library or server epoch, or is invalid',
      );
    let value;
    try {
      value = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
      throw fail(400, 'INVALID_CURSOR', 'Invalid cursor');
    }
    if (value.protocol !== 1 || value.libraryId !== meta.libraryId || value.epoch !== meta.epoch)
      throw fail(409, 'RESNAPSHOT_REQUIRED', 'Cursor belongs to another library or server epoch');
    if (
      value.mode !== mode ||
      !Number.isSafeInteger(value.after) ||
      value.after < 0 ||
      (value.watermark !== null &&
        (!Number.isSafeInteger(value.watermark) || value.watermark < value.after)) ||
      value.after > seq() ||
      value.watermark > seq()
    ) {
      throw fail(400, 'INVALID_CURSOR', 'Cursor mode, sequence or watermark is invalid');
    }
    return value;
  }
  function rowEntity(row) {
    return row
      ? {
          entityType: row.type,
          entityId: row.id,
          revision: Number(row.revision),
          state: row.state,
          data: JSON.parse(row.data),
          updatedAt: row.updatedAt,
          lastSeq: Number(row.lastSeq),
        }
      : null;
  }
  const current = (type, id) =>
    rowEntity(db.prepare('SELECT * FROM entities WHERE type=? AND id=?').get(type, id));
  // Read protections are evaluated at response time, including old fixed-watermark pages.
  function safe(entity, hideDeleted = true) {
    if (!entity) return null;
    const latest = current(entity.entityType, entity.entityId);
    if (latest && (latest.state === 'withdrawn' || (hideDeleted && latest.state === 'deleted')))
      return { ...latest, data: {} };
    return entity.state !== 'active' ? { ...entity, data: {} } : entity;
  }
  function safeResult(result) {
    if (result.entity) result.entity = safe(result.entity);
    return result;
  }
  function saveEntity(entity, operationId) {
    const inserted = db
      .prepare('INSERT INTO changes(type,id,operationId,entity) VALUES (?,?,?,?)')
      .run(entity.entityType, entity.entityId, operationId, '{}');
    entity.lastSeq = Number(inserted.lastInsertRowid);
    const json = JSON.stringify(entity);
    db.prepare('UPDATE changes SET entity=? WHERE seq=?').run(json, entity.lastSeq);
    db.prepare(
      'INSERT INTO entities(type,id,revision,state,data,updatedAt,lastSeq) VALUES (?,?,?,?,?,?,?) ON CONFLICT(type,id) DO UPDATE SET revision=excluded.revision,state=excluded.state,data=excluded.data,updatedAt=excluded.updatedAt,lastSeq=excluded.lastSeq',
    ).run(
      entity.entityType,
      entity.entityId,
      entity.revision,
      entity.state,
      JSON.stringify(entity.data),
      entity.updatedAt,
      entity.lastSeq,
    );
    db.prepare('INSERT INTO versions(type,id,revision,entity) VALUES (?,?,?,?)').run(
      entity.entityType,
      entity.entityId,
      entity.revision,
      json,
    );
    return entity;
  }
  function scrubWithdrawn(entity) {
    // Clear every server response/history copy. Digests retain no reversible plaintext.
    const tombstone = JSON.stringify({ ...entity, data: {} });
    db.prepare('UPDATE changes SET entity=? WHERE type=? AND id=?').run(
      tombstone,
      entity.entityType,
      entity.entityId,
    );
    db.prepare('UPDATE versions SET entity=? WHERE type=? AND id=?').run(
      tombstone,
      entity.entityType,
      entity.entityId,
    );
    db.prepare('UPDATE conflicts SET detail=? WHERE type=? AND id=?').run(
      JSON.stringify({ redacted: true }),
      entity.entityType,
      entity.entityId,
    );
    for (const receipt of db
      .prepare('SELECT operationId,result FROM receipts WHERE type=? AND id=?')
      .all(entity.entityType, entity.entityId)) {
      const result = JSON.parse(receipt.result);
      if (result.entity) result.entity = { ...entity, data: {} };
      delete result.conflict;
      db.prepare('UPDATE receipts SET result=? WHERE operationId=?').run(
        JSON.stringify(result),
        receipt.operationId,
      );
    }
  }
  function conflict(op, entity, reason, fields = [], base = null) {
    const conflictId = randomUUID();
    const detail = {
      conflictId,
      entityType: op.entityType,
      entityId: op.entityId,
      reason,
      fields,
      baseRevision: op.baseRevision,
      base,
      local: op,
      remote: entity,
    };
    db.prepare(
      'INSERT INTO conflicts(conflictId,type,id,operationId,detail,createdAt) VALUES (?,?,?,?,?,?)',
    ).run(
      conflictId,
      op.entityType,
      op.entityId,
      op.operationId,
      JSON.stringify(detail),
      new Date(clock()).toISOString(),
    );
    return {
      operationId: op.operationId,
      status: 'conflict',
      conflictId,
      entity: safe(entity),
      error: { code: reason, message: 'Operation requires explicit reconciliation' },
    };
  }
  function apply(op, replacementData) {
    const entity = current(op.entityType, op.entityId);
    if (entity?.state === 'withdrawn') {
      if (op.command === 'withdraw')
        return { operationId: op.operationId, status: 'accepted', entity };
      return {
        operationId: op.operationId,
        status: 'rejected',
        entity: { ...entity, data: {} },
        error: {
          code: 'TOMBSTONE_FINAL',
          message: 'Withdrawn identity cannot be recreated, edited or restored',
        },
      };
    }
    const messageDelete =
      op.command === 'delete' && ['chatMessage', 'comment'].includes(op.entityType);
    if (op.command === 'withdraw' || messageDelete) {
      if (entity && op.baseRevision > entity.revision) return conflict(op, entity, 'FUTURE_BASE');
      const next = saveEntity(
        {
          entityType: op.entityType,
          entityId: op.entityId,
          revision: (entity?.revision || 0) + 1,
          state: 'withdrawn',
          data: {},
          updatedAt: new Date(clock()).toISOString(),
        },
        op.operationId,
      );
      scrubWithdrawn(next);
      return { operationId: op.operationId, status: 'accepted', entity: next };
    }
    if (op.command === 'create') {
      if (entity) return conflict(op, entity, 'ENTITY_EXISTS');
      return {
        operationId: op.operationId,
        status: 'accepted',
        entity: saveEntity(
          {
            entityType: op.entityType,
            entityId: op.entityId,
            revision: 1,
            state: 'active',
            data: replacementData || op.data,
            updatedAt: new Date(clock()).toISOString(),
          },
          op.operationId,
        ),
      };
    }
    if (!entity)
      return {
        operationId: op.operationId,
        status: 'rejected',
        error: { code: 'ENTITY_NOT_FOUND', message: 'Create the entity before changing it' },
      };
    if (op.baseRevision > entity.revision || op.baseRevision === 0)
      return conflict(op, entity, 'INVALID_BASE');
    let nextData = entity.data;
    let nextState = entity.state;
    let conflictId;
    if (op.command === 'updateFields') {
      if (entity.state !== 'active') return conflict(op, entity, 'ENTITY_DELETED');
      let changes = op.changes;
      if (op.baseRevision !== entity.revision) {
        const stored = db
          .prepare('SELECT entity FROM versions WHERE type=? AND id=? AND revision=?')
          .get(op.entityType, op.entityId, op.baseRevision);
        if (!stored) return conflict(op, entity, 'BASE_UNAVAILABLE');
        const base = JSON.parse(stored.entity);
        if (base.state !== 'active') return conflict(op, entity, 'BASE_NOT_ACTIVE', [], base);
        const fields = [];
        changes = {};
        for (const key of Object.keys(op.changes)) {
          const incoming = op.changes[key];
          if (equal(incoming, base.data[key]) || equal(incoming, entity.data[key])) continue;
          if (!equal(base.data[key], entity.data[key])) fields.push(key);
          changes[key] = incoming;
        }
        const bodyIncoming = Object.keys(changes).some((key) => BODY.has(key));
        const bodyRemote = [...BODY].some((key) => !equal(base.data[key], entity.data[key]));
        if (bodyIncoming && bodyRemote && !fields.some((key) => BODY.has(key))) fields.push('body');
        if (fields.length) {
          conflictId = randomUUID();
          const detail = {
            conflictId,
            entityType: op.entityType,
            entityId: op.entityId,
            operationId: op.operationId,
            reason: 'FIELD_CONFLICT',
            fields,
            baseRevision: op.baseRevision,
            base,
            local: op,
            remote: entity,
            resolvedBy: 'server-commit-order',
          };
          db.prepare(
            'INSERT INTO conflicts(conflictId,type,id,operationId,detail,createdAt) VALUES (?,?,?,?,?,?)',
          ).run(
            conflictId,
            op.entityType,
            op.entityId,
            op.operationId,
            JSON.stringify(detail),
            new Date(clock()).toISOString(),
          );
        }
      }
      nextData = replacementData || { ...entity.data, ...changes };
    } else {
      if (op.baseRevision !== entity.revision) return conflict(op, entity, 'STATE_CONFLICT');
      if (op.command === 'restore') {
        if (entity.state !== 'deleted')
          return {
            operationId: op.operationId,
            status: 'rejected',
            error: { code: 'NOT_DELETED', message: 'Only deleted entities can be restored' },
          };
        nextState = 'active';
      } else nextState = 'deleted';
    }
    const next = saveEntity(
      {
        ...entity,
        revision: entity.revision + 1,
        state: nextState,
        data: nextData,
        updatedAt: new Date(clock()).toISOString(),
      },
      op.operationId,
    );
    return {
      operationId: op.operationId,
      status: 'accepted',
      entity: next.state === 'active' ? next : { ...next, data: {} },
      ...(conflictId ? { conflictId, conflict: true, resolvedBy: 'server-commit-order' } : {}),
    };
  }

  return {
    info() {
      active();
      const latest = seq();
      return {
        protocol: 1,
        libraryId: meta.libraryId,
        epoch: meta.epoch,
        seq: latest,
        cursor: encode('pull', latest),
        storage: 'sqlite',
        limits: { push: 100, page: 200, operationBytes: MAX_OPERATION, batchBytes: MAX_BATCH },
      };
    },
    push(
      deviceId,
      operations,
      { atomic = false, productState, serverWrite = false, validateEntity, beforeApply } = {},
    ) {
      active();
      if (!validId(deviceId)) throw fail(400, 'INVALID_DEVICE_ID', 'A stable deviceId is required');
      if (productState) {
        if (!atomic || !validId(productState.key))
          throw fail(400, 'INVALID_PRODUCT_STATE', 'Invalid internal state');
        assertJson(productState.value);
      }
      if (
        !Array.isArray(operations) ||
        (operations.length < 1 && !productState) ||
        operations.length > (productState ? 10000 : 100)
      )
        throw fail(400, 'INVALID_BATCH', 'Push accepts 1 to 100 operations');
      let bytes = 0;
      for (const op of operations) {
        assertJson(op);
        bytes += Buffer.byteLength(JSON.stringify(op));
        if (bytes > (productState ? 67108864 : MAX_BATCH))
          throw fail(413, 'BATCH_TOO_LARGE', 'Batch exceeds transaction limit');
      }
      const results = [];
      if (atomic) db.exec('BEGIN IMMEDIATE');
      try {
        for (const op of operations) {
          const digest = createHash('sha256')
            .update(canonical({ deviceId, operation: op }))
            .digest('hex');
          if (!atomic) db.exec('BEGIN IMMEDIATE');
          try {
            const old =
              validId(op?.operationId) &&
              db
                .prepare('SELECT digest,result FROM receipts WHERE operationId=?')
                .get(op.operationId);
            if (old) {
              if (old.digest !== digest)
                throw fail(
                  409,
                  'OPERATION_ID_REUSED',
                  'operationId was already used with a different request',
                );
              results.push(safeResult(JSON.parse(old.result)));
            } else {
              let result;
              try {
                validateOperation(op, { serverWrite });
              } catch (error) {
                result = {
                  operationId: typeof op?.operationId === 'string' ? op.operationId : null,
                  status: 'rejected',
                  error: { code: error.code || 'INVALID_OPERATION', message: error.message },
                };
              }
              if (!result) {
                // Policy runs after immutable receipt replay and inside this transaction.
                // It cannot change the digest-bound operation or perform asynchronous work.
                const checked = beforeApply?.(
                  structuredClone(op),
                  structuredClone(current(op.entityType, op.entityId)),
                );
                if (checked?.then)
                  throw fail(
                    500,
                    'ASYNC_TRANSACTION_POLICY',
                    'Transaction policy must be synchronous',
                  );
                if (checked?.replaceData) {
                  assertJson(checked.replaceData);
                  if (
                    !object(checked.replaceData) ||
                    !['create', 'updateFields'].includes(op.command)
                  )
                    throw fail(
                      500,
                      'INVALID_TRANSACTION_POLICY',
                      'Invalid internal replacement data',
                    );
                }
                result = apply(op, checked?.replaceData);
              }
              if (result.status === 'accepted' && result.entity?.state === 'active')
                validateEntity?.(result.entity);
              if (validId(op?.operationId))
                db.prepare(
                  'INSERT INTO receipts(operationId,digest,type,id,result) VALUES (?,?,?,?,?)',
                ).run(
                  op.operationId,
                  digest,
                  typeof op.entityType === 'string' ? op.entityType : '',
                  typeof op.entityId === 'string' ? op.entityId : '',
                  JSON.stringify(result),
                );
              results.push(result);
            }
            if (atomic && results.at(-1)?.status !== 'accepted')
              throw fail(409, 'ATOMIC_BATCH_REJECTED', 'No operation in this batch was committed');
            if (!atomic) db.exec('COMMIT');
          } catch (error) {
            if (!atomic) db.exec('ROLLBACK');
            throw error;
          }
        }
        if (productState)
          db.prepare(
            'INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
          ).run(`product-state:${productState.key}`, JSON.stringify(productState.value));
        if (atomic) db.exec('COMMIT');
      } catch (error) {
        if (atomic) db.exec('ROLLBACK');
        throw error;
      }
      return { results: results.map(safeResult), cursor: encode('pull', seq()) };
    },
    readProductState(key) {
      active();
      if (!validId(key)) throw fail(400, 'INVALID_PRODUCT_STATE', 'Invalid internal state');
      const row = db.prepare('SELECT value FROM metadata WHERE key=?').get(`product-state:${key}`);
      return row ? JSON.parse(row.value) : null;
    },
    pull({ cursor, limit = 100 } = {}) {
      active();
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200)
        throw fail(400, 'INVALID_LIMIT', 'Page size must be 1 to 200');
      const decoded = decode(cursor, 'pull');
      const watermark = decoded.watermark ?? seq();
      const rows = db
        .prepare(
          'SELECT seq,operationId,entity FROM changes WHERE seq>? AND seq<=? ORDER BY seq LIMIT ?',
        )
        .all(decoded.after, watermark, limit + 1);
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const after = hasMore ? Number(page.at(-1).seq) : watermark;
      return {
        changes: page.map((row) => ({
          seq: Number(row.seq),
          operationId: row.operationId,
          entity: safe(JSON.parse(row.entity)),
        })),
        cursor: encode('pull', after, hasMore ? watermark : null),
        hasMore,
        watermark,
      };
    },
    snapshot({ cursor, limit = 100 } = {}) {
      active();
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200)
        throw fail(400, 'INVALID_LIMIT', 'Page size must be 1 to 200');
      const decoded = decode(cursor, 'snapshot');
      const watermark = decoded.watermark ?? seq();
      const rows = db
        .prepare(
          `SELECT c.seq,c.entity FROM changes c WHERE c.seq>? AND c.seq<=? AND NOT EXISTS(SELECT 1 FROM changes newer WHERE newer.type=c.type AND newer.id=c.id AND newer.seq>c.seq AND newer.seq<=?) ORDER BY c.seq LIMIT ?`,
        )
        .all(decoded.after, watermark, watermark, limit + 1);
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const after = hasMore ? Number(page.at(-1).seq) : watermark;
      return {
        entities: page.map((row) => safe(JSON.parse(row.entity))),
        cursor: encode('snapshot', after, watermark),
        checkpoint: encode('pull', watermark),
        hasMore,
        watermark,
      };
    },
    getEntity(type, id) {
      active();
      if ((!TYPES.has(type) && type !== 'asset') || !validId(id))
        throw fail(400, 'INVALID_ENTITY', 'Invalid entity identity');
      return safe(current(type, id));
    },
    listConflicts({ entityType, entityId, limit = 100, offset = 0 } = {}) {
      active();
      if (
        (entityType !== undefined && !TYPES.has(entityType)) ||
        (entityId !== undefined && !validId(entityId)) ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 200 ||
        !Number.isSafeInteger(offset) ||
        offset < 0
      )
        throw fail(400, 'INVALID_CONFLICT_QUERY', 'Invalid conflict query');
      const clauses = [];
      const params = [];
      if (entityType) {
        clauses.push('type=?');
        params.push(entityType);
      }
      if (entityId) {
        clauses.push('id=?');
        params.push(entityId);
      }
      return {
        conflicts: db
          .prepare(
            `SELECT conflictId,type,id,detail,createdAt FROM conflicts ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY rowid LIMIT ? OFFSET ?`,
          )
          .all(...params, limit, offset)
          .map((row) => ({
            conflictId: row.conflictId,
            entityType: row.type,
            entityId: row.id,
            createdAt: row.createdAt,
            ...JSON.parse(row.detail),
          })),
      };
    },
    getConflict(conflictId) {
      active();
      if (!validId(conflictId)) throw fail(400, 'INVALID_ID', 'Invalid conflict ID');
      const row = db.prepare('SELECT * FROM conflicts WHERE conflictId=?').get(conflictId);
      return row
        ? {
            conflictId: row.conflictId,
            entityType: row.type,
            entityId: row.id,
            createdAt: row.createdAt,
            ...JSON.parse(row.detail),
          }
        : null;
    },
    publishAsset(asset) {
      active();
      assertJson(asset);
      if (
        !object(asset) ||
        !validId(asset.assetId) ||
        !/^[a-f0-9]{64}$/.test(asset.sha256) ||
        !Number.isSafeInteger(asset.size) ||
        asset.size < 0 ||
        typeof asset.mime !== 'string' ||
        asset.mime.length > 200 ||
        (asset.name !== undefined && (typeof asset.name !== 'string' || asset.name.length > 1024))
      )
        throw fail(400, 'INVALID_ASSET', 'Invalid verified asset metadata');
      db.exec('BEGIN IMMEDIATE');
      try {
        const old = current('asset', asset.assetId);
        if (old && old.data.sha256 !== asset.sha256)
          throw fail(
            409,
            'ASSET_ID_REUSED',
            'Asset identity already has different immutable bytes',
          );
        if (old) {
          db.exec('COMMIT');
          return safe(old);
        }
        const entity = saveEntity(
          {
            entityType: 'asset',
            entityId: asset.assetId,
            revision: 1,
            state: 'active',
            data: asset,
            updatedAt: new Date(clock()).toISOString(),
          },
          `media-ready:${asset.assetId}:${asset.sha256}`,
        );
        db.exec('COMMIT');
        return entity;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    close() {
      if (!closed) {
        db.close();
        closed = true;
      }
    },
  };
}
