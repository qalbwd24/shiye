import { DatabaseSync } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const fail = (status, code) => Object.assign(new Error(code), { status, code });

/** Single-owner device pairing, deliberately separate from the daily desktop access lock. */
export async function createSyncAuth({ dataDir, clock = Date.now }) {
  await mkdir(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'devices.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS devices(
      id TEXT PRIMARY KEY, name TEXT NOT NULL, tokenHash TEXT NOT NULL UNIQUE,
      createdAt TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS pairing(
      codeHash TEXT PRIMARY KEY, expiresAt INTEGER NOT NULL, remaining INTEGER NOT NULL);
  `);
  const failures = new Map();
  const nowIso = () => new Date(clock()).toISOString();
  function pairingCode({ ttlMs = 600000, uses = 2 } = {}) {
    if (
      !Number.isInteger(ttlMs) ||
      ttlMs < 1000 ||
      ttlMs > 3600000 ||
      !Number.isInteger(uses) ||
      uses < 1 ||
      uses > 10
    )
      throw fail(400, 'INVALID_PAIRING_OPTIONS');
    const code = String(randomInt(100000000)).padStart(8, '0');
    db.prepare('DELETE FROM pairing').run();
    db.prepare('INSERT INTO pairing VALUES(?,?,?)').run(digest(code), clock() + ttlMs, uses);
    return { code, expiresAt: new Date(clock() + ttlMs).toISOString(), uses };
  }
  function pair({ code, deviceName }, remote = 'unknown') {
    let failure = failures.get(remote);
    if (failure?.blockedUntil > clock()) throw fail(429, 'PAIRING_RATE_LIMITED');
    if (failure?.blockedUntil && failure.blockedUntil <= clock()) {
      failures.delete(remote);
      failure = undefined;
    }
    if (typeof deviceName !== 'string' || !deviceName.trim() || deviceName.length > 80)
      throw fail(400, 'INVALID_DEVICE_NAME');
    const rejectPairing = () => {
      const attempts = (failure?.attempts || 0) + 1;
      if (failures.size >= 1000) failures.delete(failures.keys().next().value);
      failures.set(remote, { attempts, blockedUntil: attempts >= 5 ? clock() + 300000 : 0 });
      throw fail(401, 'PAIRING_INVALID');
    };
    if (typeof code !== 'string' || !/^\d{8}$/.test(code)) rejectPairing();
    const deviceId = randomUUID(),
      token = randomBytes(32).toString('hex');
    db.exec('BEGIN IMMEDIATE');
    try {
      const consumed = db
        .prepare(
          'UPDATE pairing SET remaining=remaining-1 WHERE codeHash=? AND expiresAt>? AND remaining>0',
        )
        .run(digest(code), clock());
      if (!consumed.changes) rejectPairing();
      db.prepare('INSERT INTO devices(id,name,tokenHash,createdAt) VALUES(?,?,?,?)').run(
        deviceId,
        deviceName.trim(),
        digest(token),
        nowIso(),
      );
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    failures.delete(remote);
    return { deviceId, token, deviceName: deviceName.trim() };
  }
  function authenticate(value) {
    if (typeof value !== 'string' || !/^Bearer [a-f0-9]{64}$/.test(value))
      throw fail(401, 'DEVICE_UNAUTHORIZED');
    const hash = digest(value.slice(7));
    const row = db.prepare('SELECT * FROM devices WHERE tokenHash=? AND revoked=0').get(hash);
    if (!row || !timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(row.tokenHash, 'hex')))
      throw fail(401, 'DEVICE_UNAUTHORIZED');
    return { deviceId: row.id, name: row.name };
  }
  return {
    pairingCode,
    pair,
    authenticate,
    listDevices: () =>
      db.prepare('SELECT id,name,createdAt,revoked FROM devices ORDER BY createdAt').all(),
    revoke: (deviceId) => {
      const result = db.prepare('UPDATE devices SET revoked=1 WHERE id=?').run(deviceId);
      if (!result.changes) throw fail(404, 'DEVICE_NOT_FOUND');
      return { deviceId, revoked: true };
    },
    close: () => db.close(),
  };
}
