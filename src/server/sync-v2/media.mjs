import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

const fail = (statusCode, code, message) => {
  const error = new Error(message);
  Object.assign(error, { statusCode, code });
  throw error;
};
const safeId = (value) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value))
    fail(400, 'invalid-id', 'Invalid media identifier');
  return value;
};
const hashBytes = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fileHash = async (file) => {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
};
const metadata = (row) => ({
  assetId: row.asset_id,
  sha256: row.sha256,
  size: row.size,
  mime: row.mime,
  name: row.name,
  available: true,
});

// One dataDir is one authorized library. No process-global hash lookup is used.
export async function createSyncMediaStore({
  dataDir,
  chunkSize = 262144,
  maxBytes = 536870912,
} = {}) {
  if (!dataDir || !path.isAbsolute(dataDir))
    throw new Error('An absolute isolated dataDir is required');
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1 || chunkSize > 8388608)
    throw new Error('Invalid chunkSize');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Invalid maxBytes');
  const directory = path.join(dataDir, 'media');
  const originals = path.join(directory, 'originals');
  const staging = path.join(directory, 'staging');
  await mkdir(originals, { recursive: true });
  await mkdir(staging, { recursive: true });
  const db = new DatabaseSync(path.join(directory, 'media.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS uploads (
      upload_id TEXT PRIMARY KEY, asset_id TEXT NOT NULL UNIQUE, sha256 TEXT NOT NULL,
      size INTEGER NOT NULL, mime TEXT NOT NULL, name TEXT NOT NULL,
      chunk_size INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'uploading');
    CREATE TABLE IF NOT EXISTS chunks (
      upload_id TEXT NOT NULL REFERENCES uploads(upload_id), chunk_index INTEGER NOT NULL,
      sha256 TEXT NOT NULL, bytes BLOB NOT NULL, PRIMARY KEY(upload_id, chunk_index));
    CREATE TABLE IF NOT EXISTS assets (
      asset_id TEXT PRIMARY KEY, sha256 TEXT NOT NULL, size INTEGER NOT NULL,
      mime TEXT NOT NULL, name TEXT NOT NULL, pending_publish INTEGER NOT NULL DEFAULT 1);
    CREATE INDEX IF NOT EXISTS pending_media_publish ON assets(pending_publish) WHERE pending_publish=1;
    CREATE INDEX IF NOT EXISTS media_content_hash ON assets(sha256, size);`);
  let queue = Promise.resolve();
  let closed = false;
  const serial = (action) => {
    if (closed) return Promise.reject(new Error('Media store is closed'));
    const result = queue.then(action);
    queue = result.catch(() => {});
    return result;
  };
  const transaction = (action) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };
  const uploadRow = (uploadId) => {
    safeId(uploadId);
    const row = db.prepare('SELECT * FROM uploads WHERE upload_id=?').get(uploadId);
    if (!row) fail(404, 'upload-not-found', 'Upload not found');
    return row;
  };
  const assetRow = (assetId) => {
    safeId(assetId);
    const row = db.prepare('SELECT * FROM assets WHERE asset_id=?').get(assetId);
    if (!row) fail(404, 'asset-not-found', 'Media original is not available');
    return row;
  };
  const statusOf = (row) => {
    const totalChunks = Math.ceil(row.size / row.chunk_size);
    const receivedChunks =
      row.state === 'complete'
        ? Array.from({ length: totalChunks }, (_, index) => index)
        : db
            .prepare('SELECT chunk_index FROM chunks WHERE upload_id=? ORDER BY chunk_index')
            .all(row.upload_id)
            .map((chunk) => chunk.chunk_index);
    const received = new Set(receivedChunks);
    return {
      ...metadata(row),
      available: row.state === 'complete',
      uploadId: row.upload_id,
      chunkSize: row.chunk_size,
      totalChunks,
      receivedChunks,
      missingChunks: Array.from({ length: totalChunks }, (_, index) => index).filter(
        (index) => !received.has(index),
      ),
      status: row.state,
    };
  };
  const finish = async (row) => {
    if (row.state === 'complete') return metadata(assetRow(row.asset_id));
    const count = db
      .prepare('SELECT COUNT(*) AS count FROM chunks WHERE upload_id=?')
      .get(row.upload_id).count;
    if (count !== Math.ceil(row.size / row.chunk_size))
      fail(409, 'missing-chunks', 'Upload has missing chunks');
    // This durable intent makes a crash between byte finalization and registration recoverable.
    db.prepare("UPDATE uploads SET state='finalizing' WHERE upload_id=?").run(row.upload_id);
    const temporary = path.join(staging, `${row.upload_id}.part`);
    const contentPath = path.join(originals, row.sha256);
    const output = await open(temporary, 'w');
    const hash = createHash('sha256');
    let size = 0;
    try {
      for (let index = 0; index < count; index++) {
        const chunk = db
          .prepare('SELECT * FROM chunks WHERE upload_id=? AND chunk_index=?')
          .get(row.upload_id, index);
        if (!chunk || hashBytes(chunk.bytes) !== chunk.sha256)
          fail(409, 'chunk-corrupt', 'Stored chunk failed verification');
        const expected = Math.min(row.chunk_size, row.size - index * row.chunk_size);
        if (chunk.bytes.byteLength !== expected)
          fail(409, 'chunk-size', 'Stored chunk has invalid length');
        hash.update(chunk.bytes);
        let written = 0;
        while (written < chunk.bytes.byteLength) {
          const result = await output.write(
            chunk.bytes,
            written,
            chunk.bytes.byteLength - written,
            size + written,
          );
          if (!result.bytesWritten) throw new Error('Media write made no progress');
          written += result.bytesWritten;
        }
        size += chunk.bytes.byteLength;
      }
      if (size !== row.size || hash.digest('hex') !== row.sha256)
        fail(422, 'hash-mismatch', 'Original size or SHA-256 does not match');
      await output.sync();
    } catch (error) {
      db.prepare("UPDATE uploads SET state='uploading' WHERE upload_id=?").run(row.upload_id);
      throw error;
    } finally {
      await output.close();
    }
    // Existing bytes are never overwritten without verifying the immutable hash.
    let exists = false;
    try {
      const info = await stat(contentPath);
      if (info.size !== row.size || (await fileHash(contentPath)) !== row.sha256)
        fail(409, 'original-corrupt', 'Existing original failed verification');
      exists = true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (!exists) await rename(temporary, contentPath);
    // Only remove a staging file owned by this upload; unknown files are never scanned.
    if (exists) {
      await unlink(temporary);
    }
    transaction(() => {
      db.prepare(
        'INSERT OR IGNORE INTO assets(asset_id,sha256,size,mime,name) VALUES(?,?,?,?,?)',
      ).run(row.asset_id, row.sha256, row.size, row.mime, row.name);
      db.prepare("UPDATE uploads SET state='complete' WHERE upload_id=?").run(row.upload_id);
      db.prepare('DELETE FROM chunks WHERE upload_id=?').run(row.upload_id);
    });
    return metadata(assetRow(row.asset_id));
  };
  // Recovery touches only durable finalize intents, never all media or unknown files.
  for (const row of db.prepare("SELECT * FROM uploads WHERE state='finalizing'").all()) {
    try {
      await finish(row);
    } catch {
      /* Client status/retry can repair a failed upload. */
    }
  }
  return {
    begin: (input = {}) =>
      serial(async () => {
        safeId(input.assetId);
        if (typeof input.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(input.sha256))
          fail(400, 'invalid-hash', 'A SHA-256 digest is required');
        if (!Number.isSafeInteger(input.size) || input.size < 1 || input.size > maxBytes)
          fail(413, 'invalid-size', 'Original size is outside the configured limit');
        const sha256 = input.sha256.toLowerCase();
        const mime = input.mime ?? 'application/octet-stream';
        const name = input.name ?? '';
        if (
          typeof mime !== 'string' ||
          !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(mime) ||
          mime.length > 200
        )
          fail(400, 'invalid-mime', 'Invalid media type');
        if (typeof name !== 'string' || name.length > 1024 || /[\u0000-\u001f\u007f]/.test(name))
          fail(400, 'invalid-name', 'Invalid original name');
        const previous = db.prepare('SELECT * FROM uploads WHERE asset_id=?').get(input.assetId);
        if (previous) {
          if (previous.sha256 !== sha256 || previous.size !== input.size)
            fail(409, 'asset-conflict', 'Asset ID already identifies different bytes');
          return statusOf(previous);
        }
        const uploadId = randomUUID();
        const reusable = db
          .prepare('SELECT * FROM assets WHERE sha256=? AND size=? LIMIT 1')
          .get(sha256, input.size);
        if (reusable) {
          const info = await stat(path.join(originals, sha256));
          if (info.size !== input.size)
            fail(409, 'original-corrupt', 'Existing original is unavailable');
        }
        transaction(() => {
          db.prepare(
            'INSERT INTO uploads(upload_id,asset_id,sha256,size,mime,name,chunk_size,state) VALUES(?,?,?,?,?,?,?,?)',
          ).run(
            uploadId,
            input.assetId,
            sha256,
            input.size,
            mime,
            name,
            chunkSize,
            reusable ? 'complete' : 'uploading',
          );
          if (reusable)
            db.prepare('INSERT INTO assets(asset_id,sha256,size,mime,name) VALUES(?,?,?,?,?)').run(
              input.assetId,
              sha256,
              input.size,
              mime,
              name,
            );
        });
        return statusOf(uploadRow(uploadId));
      }),
    status: (uploadId) => serial(() => statusOf(uploadRow(uploadId))),
    putChunk: (uploadId, index, bytes, expected = {}) =>
      serial(async () => {
        const row = uploadRow(uploadId);
        if (
          !Number.isSafeInteger(index) ||
          index < 0 ||
          index >= Math.ceil(row.size / row.chunk_size)
        )
          fail(400, 'invalid-chunk-index', 'Invalid chunk index');
        if (!(bytes instanceof Uint8Array)) fail(400, 'invalid-chunk', 'Chunk must contain bytes');
        const length = Math.min(row.chunk_size, row.size - index * row.chunk_size);
        if (bytes.byteLength !== length) fail(400, 'chunk-size', 'Chunk has invalid length');
        const sha256 = hashBytes(bytes);
        if (
          expected.sha256 &&
          (typeof expected.sha256 !== 'string' || expected.sha256.toLowerCase() !== sha256)
        )
          fail(422, 'chunk-hash-mismatch', 'Chunk SHA-256 does not match');
        if (row.state === 'complete') {
          const original = await open(path.join(originals, row.sha256), 'r');
          try {
            const existing = Buffer.alloc(length);
            const { bytesRead } = await original.read(existing, 0, length, index * row.chunk_size);
            if (bytesRead !== length || hashBytes(existing) !== sha256)
              fail(409, 'chunk-conflict', 'Completed chunk contains different bytes');
          } finally {
            await original.close();
          }
          return statusOf(row);
        }
        const previous = db
          .prepare('SELECT sha256 FROM chunks WHERE upload_id=? AND chunk_index=?')
          .get(uploadId, index);
        if (previous && previous.sha256 !== sha256)
          fail(409, 'chunk-conflict', 'Chunk already contains different bytes');
        db.prepare(
          'INSERT OR IGNORE INTO chunks(upload_id,chunk_index,sha256,bytes) VALUES(?,?,?,?)',
        ).run(uploadId, index, sha256, bytes);
        return statusOf(row);
      }),
    complete: (uploadId) => serial(() => finish(uploadRow(uploadId))),
    getAsset: (assetId) => serial(() => metadata(assetRow(assetId))),
    openContent: (assetId) =>
      serial(async () => {
        const row = assetRow(assetId);
        const contentPath = path.join(originals, row.sha256);
        const info = await stat(contentPath);
        if (info.size !== row.size) fail(409, 'original-corrupt', 'Original size does not match');
        return { ...metadata(row), contentPath };
      }),
    readContent: (assetId, { start = 0, end } = {}) =>
      serial(async () => {
        const row = assetRow(assetId);
        end ??= row.size - 1;
        if (
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          start < 0 ||
          end < start ||
          end >= row.size
        )
          fail(416, 'invalid-range', 'Invalid original byte range');
        const input = await open(path.join(originals, row.sha256), 'r');
        try {
          const bytes = Buffer.alloc(end - start + 1);
          let offset = 0;
          while (offset < bytes.length) {
            const result = await input.read(bytes, offset, bytes.length - offset, start + offset);
            if (!result.bytesRead) fail(409, 'original-corrupt', 'Original is truncated');
            offset += result.bytesRead;
          }
          return bytes;
        } finally {
          await input.close();
        }
      }),
    listUnpublished: () =>
      serial(() => db.prepare('SELECT * FROM assets WHERE pending_publish=1').all().map(metadata)),
    markPublished: (assetId) =>
      serial(() => {
        assetRow(assetId);
        db.prepare('UPDATE assets SET pending_publish=0 WHERE asset_id=?').run(assetId);
      }),
    close: async () => {
      if (closed) return;
      closed = true;
      await queue;
      db.close();
    },
  };
}
