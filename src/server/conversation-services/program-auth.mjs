import { DatabaseSync } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { registry } from './registry.mjs';
import { sharedInfo } from '../shared-sync/replication.mjs';

export const PROGRAM_SCOPES = Object.freeze([
  'read',
  'feed',
  'context',
  'send',
  'reply',
  'comment',
  'withdraw',
  'media:read',
  'media:upload',
]);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const fail = (status, code) => {
  throw Object.assign(Error(code), { status, code });
};
export function validateProgramScope(db, credential, action) {
  const info = sharedInfo(db),
    r = registry(db);
  if (
    !info.enabled ||
    credential.backgroundAccess !== true ||
    credential.libraryId !== info.libraryId ||
    credential.epoch !== info.epoch
  )
    fail(403, 'PROGRAM_LIBRARY_MISMATCH');
  const instance = r.instances.find((item) => item.id === credential.instanceId);
  const binding = r.bindings.find((item) => item.id === credential.bindingId);
  if (
    !instance ||
    !binding ||
    !binding.active ||
    binding.instanceId !== instance.id ||
    binding.conversationId !== credential.conversationId ||
    binding.revision !== credential.bindingRevision ||
    instance.conversationId !== credential.conversationId ||
    instance.state?.config?.enabled !== true
  )
    fail(403, 'PROGRAM_BINDING_INACTIVE');
  if (action && !credential.scopes.includes(action)) fail(403, 'PROGRAM_SCOPE_FORBIDDEN');
  return { instance, binding, actorId: `program:${instance.id}` };
}

/** Trusted backend issuer only: no HTTP mint endpoint. This private SQLite holds
 * credential hashes/grants, never another owner for messages/configuration. */
export async function createProgramAuth({ dataDir }) {
  await mkdir(path.join(dataDir, '.program-auth'), { recursive: true });
  const sql = new DatabaseSync(path.join(dataDir, '.program-auth', 'credentials.sqlite'));
  sql.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS credentials(id TEXT PRIMARY KEY, tokenHash TEXT UNIQUE NOT NULL,
      scope TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS mediaGrants(credentialId TEXT NOT NULL, operationId TEXT NOT NULL,
      assetId TEXT NOT NULL, PRIMARY KEY(credentialId,operationId));
    CREATE TABLE IF NOT EXISTS uploads(operationId TEXT PRIMARY KEY, owner TEXT NOT NULL);`);
  let closed = false;
  function read(id) {
    if (closed) fail(503, 'PROGRAM_AUTH_CLOSED');
    const row = sql.prepare('SELECT * FROM credentials WHERE id=?').get(id);
    if (!row || row.revoked) fail(401, 'PROGRAM_UNAUTHORIZED');
    return { ...JSON.parse(row.scope), credentialId: row.id };
  }
  const issue = (db, { instanceId, scopes } = {}) => {
    if (
      !Array.isArray(scopes) ||
      !scopes.length ||
      new Set(scopes).size !== scopes.length ||
      scopes.some((value) => !PROGRAM_SCOPES.includes(value))
    )
      fail(400, 'PROGRAM_INVALID_SCOPES');
    const info = sharedInfo(db),
      binding = registry(db).bindings.find((item) => item.instanceId === instanceId && item.active);
    if (!binding) fail(409, 'PROGRAM_BINDING_INACTIVE');
    const credential = {
      libraryId: info.libraryId,
      epoch: info.epoch,
      instanceId,
      bindingId: binding.id,
      bindingRevision: binding.revision,
      conversationId: binding.conversationId,
      scopes: [...scopes],
      backgroundAccess: true,
    };
    validateProgramScope(db, credential);
    const credentialId = randomUUID(),
      token = randomBytes(32).toString('hex');
    sql
      .prepare('INSERT INTO credentials VALUES(?,?,?,0)')
      .run(credentialId, hash(token), JSON.stringify(credential));
    return { credentialId, token, ...credential };
  };
  function publish(create, persist) {
    sql.exec('BEGIN IMMEDIATE');
    try {
      const issued = create();
      if (persist) {
        const result = persist(issued);
        if (result && typeof result.then === 'function') fail(500, 'PROGRAM_SYNC_PERSIST_REQUIRED');
      }
      sql.exec('COMMIT');
      return issued;
    } catch (error) {
      sql.exec('ROLLBACK');
      throw error;
    }
  }
  return {
    // A trusted synchronous persistence callback must finish before the grant
    // becomes usable. Failed output also rolls back rotation of the old token.
    issue(db, input, persist) {
      return publish(() => issue(db, input), persist);
    },
    rotate(db, id, persist) {
      return publish(() => {
        const old = read(id);
        validateProgramScope(db, old);
        const next = issue(db, old);
        sql.prepare('UPDATE credentials SET revoked=1 WHERE id=?').run(id);
        return next;
      }, persist);
    },
    revoke(id) {
      sql.prepare('UPDATE credentials SET revoked=1 WHERE id=?').run(id);
      return { credentialId: id, revoked: true };
    },
    authenticate(authorization, db) {
      if (typeof authorization !== 'string' || !/^Bearer [a-f0-9]{64}$/.test(authorization))
        fail(401, 'PROGRAM_UNAUTHORIZED');
      const row = sql
        .prepare('SELECT id FROM credentials WHERE tokenHash=? AND revoked=0')
        .get(hash(authorization.slice(7)));
      if (!row) fail(401, 'PROGRAM_UNAUTHORIZED');
      const credential = read(row.id);
      validateProgramScope(db, credential);
      return credential;
    },
    revalidate(db, credential, action) {
      const current = read(credential.credentialId);
      validateProgramScope(db, current, action);
      return current;
    },
    grantMedia(credentialId, operationId, assetId) {
      read(credentialId);
      sql
        .prepare('INSERT OR REPLACE INTO mediaGrants VALUES(?,?,?)')
        .run(credentialId, operationId, assetId);
    },
    upload(credentialId, operationId, begin = false) {
      const c = read(credentialId),
        owner = JSON.stringify([c.libraryId, c.epoch, c.instanceId]);
      if (
        typeof operationId !== 'string' ||
        !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(operationId)
      )
        fail(400, 'PROGRAM_INVALID_OPERATION');
      const row = sql.prepare('SELECT owner FROM uploads WHERE operationId=?').get(operationId);
      if (!row && begin === null) return false;
      if (!row && begin) sql.prepare('INSERT INTO uploads VALUES(?,?)').run(operationId, owner);
      else if (!row || row.owner !== owner) fail(403, 'PROGRAM_MEDIA_FORBIDDEN');
      return true;
    },
    ownsMedia(credentialId, assetId) {
      const c = read(credentialId);
      // Rotation preserves instance identity; a new instance cannot inherit files.
      const rows = sql
        .prepare(
          'SELECT credentials.scope FROM mediaGrants JOIN credentials ON credentials.id=mediaGrants.credentialId WHERE assetId=?',
        )
        .all(assetId);
      return rows.some((row) => {
        const owner = JSON.parse(row.scope);
        return (
          owner.instanceId === c.instanceId &&
          owner.libraryId === c.libraryId &&
          owner.epoch === c.epoch
        );
      });
    },
    close() {
      if (!closed) {
        closed = true;
        sql.close();
      }
    },
  };
}
