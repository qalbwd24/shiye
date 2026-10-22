import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { readSharedSeed } from '../src/server/shared-sync/seed-package.mjs';
import { sharedSeedEntityBytes, sharedSeedLogicalSha256 } from '../public/shared/shared-seed.js';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function rawSeed() {
  const row = {
    entityType: 'settings',
    entityId: 'library',
    revision: 1,
    seq: 1,
    state: 'active',
    data: { synthetic: 'content'.repeat(200000) },
  };
  row.sha256 = sharedSeedLogicalSha256(row);
  const bytes = Buffer.from(sharedSeedEntityBytes(row)),
    hash = sha(bytes),
    member = { path: `entities/${hash}.json`, size: bytes.length, sha256: hash },
    libraryId = randomUUID(),
    epoch = randomUUID();
  const manifest = {
    format: 'shiye-shared-seed',
    version: 1,
    mode: 'shared-bootstrap',
    packageId: randomUUID(),
    libraryId,
    epoch,
    snapshotWatermark: 1,
    watermark: 1,
    cursor: { libraryId, epoch, after: 1 },
    complete: true,
    createdAt: '2026-10-19T00:00:00Z',
    entities: [
      {
        entityType: row.entityType,
        entityId: row.entityId,
        revision: 1,
        seq: 1,
        sha256: row.sha256,
        path: member.path,
      },
    ],
    assets: [],
    members: [member],
    bytes: bytes.length,
    entityBytes: bytes.length,
    entityCount: 1,
    assetCount: 0,
    containsCredentials: false,
    containsSourceArchives: false,
  };
  const m = Buffer.from(JSON.stringify(manifest)),
    size = Buffer.alloc(4);
  size.writeUInt32BE(m.length);
  return Buffer.concat([Buffer.from('SHIYE-SEED-V1\n'), size, m, bytes]);
}
// Deliberately small classic ZIP writer used to exercise real central/local headers.
function zip(entries, { descriptor = false } = {}) {
  const chunks = [],
    central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name),
      raw = Buffer.from(e.data),
      method = e.deflate ? 8 : 0,
      compressed = method === 8 ? deflateRawSync(raw) : raw,
      crc = crc32(raw),
      flags = descriptor ? 8 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(name.length, 26);
    if (!descriptor) {
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(compressed.length, 18);
      local.writeUInt32LE(raw.length, 22);
    }
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(flags, 8);
    directory.writeUInt16LE(method, 10);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(compressed.length, 20);
    directory.writeUInt32LE(raw.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(offset, 42);
    chunks.push(local, name, compressed);
    central.push(directory, name);
    offset += local.length + name.length + compressed.length;
    if (descriptor) {
      const d = Buffer.alloc(16);
      d.writeUInt32LE(0x08074b50);
      d.writeUInt32LE(crc, 4);
      d.writeUInt32LE(compressed.length, 8);
      d.writeUInt32LE(raw.length, 12);
      chunks.push(d);
      offset += d.length;
    }
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, directory, end]);
}
async function fixture(_t) {
  const root = path.resolve('tmp/shared-seed-zip-tests');
  await mkdir(root, { recursive: true });
  const dir = await mkdtemp(path.join(root, 'case-')),
    work = path.join(dir, 'work');
  await mkdir(work);
  const file = path.join(dir, 'package.zip');
  return {
    file,
    work,
    async read(bytes) {
      await writeFile(file, bytes);
      return readSharedSeed({ file, directory: work, expectedSha256: sha(bytes) });
    },
  };
}
test('stored/deflated shared ZIP wrappers with optional data descriptors reach the real shared prepare path', async (t) => {
  const f = await fixture(t),
    raw = rawSeed();
  for (const deflate of [false, true])
    for (const descriptor of [false, true]) {
      const bytes = zip(
          [
            { name: 'coverage.json', data: '{"synthetic":true}', deflate },
            { name: 'data.syseed', data: raw, deflate },
          ],
          { descriptor },
        ),
        result = await f.read(bytes);
      assert.equal(result.container, 'zip');
      assert.equal(result.sha256, sha(bytes));
      assert.equal(result.seedSha256, sha(raw));
      assert.equal(result.manifest.entityCount, 1);
      await result.dispose();
      assert.deepEqual(await readdir(f.work), []);
    }
});
test('real ZIP headers reject traversal, duplicate/local mismatch, CRC corruption and bad declared expansion without leftover staging', async (t) => {
  const f = await fixture(t),
    raw = rawSeed();
  const unsafe = [
    zip([{ name: '../escape', data: raw }]),
    zip([
      { name: 'data.syseed', data: raw },
      { name: 'data.syseed', data: raw },
    ]),
  ];
  const mismatch = zip([{ name: 'data.syseed', data: raw }]);
  mismatch[30] = 'X'.charCodeAt(0);
  unsafe.push(mismatch);
  const corrupt = zip([{ name: 'data.syseed', data: raw }]);
  corrupt[100] ^= 1;
  unsafe.push(corrupt);
  const expanded = zip([{ name: 'data.syseed', data: raw, deflate: true }]);
  const cd = expanded.readUInt32LE(expanded.length - 6);
  expanded.writeUInt32LE(raw.length - 100, cd + 24);
  expanded.writeUInt32LE(raw.length - 100, 22);
  unsafe.push(expanded);
  for (const bytes of unsafe) {
    await assert.rejects(f.read(bytes), /SHARED_SEED_ZIP_/);
    assert.deepEqual(await readdir(f.work), []);
  }
});
