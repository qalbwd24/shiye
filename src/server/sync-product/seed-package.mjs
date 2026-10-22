import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  PRODUCT_SEED_FORMAT,
  PRODUCT_SEED_MAGIC,
  PRODUCT_SEED_POLICY,
  validateSeedManifest,
  validateSeedEntity,
} from '../../../public/shared/product-seed.js';
import { hydrateProductPayload } from '../../../public/shared/sync-product.js';

const bad = (code) => {
  throw Object.assign(new Error(code), { status: 422, code });
};
export async function seedFileHash(file) {
  const digest = createHash('sha256');
  for await (const bytes of createReadStream(file)) digest.update(bytes);
  return digest.digest('hex');
}
async function writeAll(handle, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset);
    if (!bytesWritten) bad('SEED_WRITE_FAILED');
    offset += bytesWritten;
  }
}
async function readExact(handle, size, position) {
  const bytes = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const { bytesRead } = await handle.read(bytes, offset, size - offset, position + offset);
    if (!bytesRead) bad('SEED_TRUNCATED');
    offset += bytesRead;
  }
  return bytes;
}

export async function validateSeedRecords(records, manifest, readAsset) {
  if (records.length !== manifest.entityCount) bad('SEED_RECORD_COUNT_MISMATCH');
  const keys = new Set(),
    assets = new Map();
  for (const record of records) {
    validateSeedEntity(record);
    const key = JSON.stringify([record.entityType, record.entityId]);
    if (keys.has(key)) bad('SEED_DUPLICATE_ENTITY');
    keys.add(key);
    if (record.entityType === 'asset' && record.state === 'active')
      assets.set(record.entityId, record.data);
  }
  if (assets.size !== manifest.assetCount) bad('SEED_ASSET_COUNT_MISMATCH');
  const members = new Map(manifest.members.map((m) => [m.path, m]));
  const required = new Set(['records.ndjson']);
  for (const asset of assets.values()) {
    const member = members.get('media/' + asset.sha256);
    if (!member || member.size !== asset.size) bad('SEED_MEDIA_MISSING');
    required.add(member.path);
  }
  if (required.size !== members.size) bad('SEED_UNDECLARED_MEDIA');
  for (const record of records) {
    if (record.state !== 'active' || record.entityType === 'asset') continue;
    let value = record;
    if (record.data._product.payload) {
      const ref = record.data._product.payload;
      if (!assets.has(ref.assetId)) bad('SEED_PAYLOAD_MISSING');
      // Large entry payloads use the same bounded format as the incremental API.
      if (ref.size > 64 * 1024 ** 2) bad('SEED_PAYLOAD_TOO_LARGE');
      value = hydrateProductPayload(record, await readAsset(assets.get(ref.assetId)));
      validateSeedEntity(value);
    }
    const refs = value.data._product.refs;
    for (const id of [...(refs.assets || []), refs.asset].filter(Boolean))
      if (!assets.has(id)) bad('SEED_ASSET_REFERENCE_MISSING');
    for (const id of [refs.category, ...(refs.tags || [])].filter(Boolean))
      if (!keys.has(JSON.stringify(['taxonomy', id]))) bad('SEED_TAXONOMY_REFERENCE_MISSING');
    for (const id of refs.messages || [])
      if (!keys.has(JSON.stringify(['chatMessage', id]))) bad('SEED_MESSAGE_REFERENCE_MISSING');
  }
  return records;
}

/** Package = magic + u32be manifest length + UTF-8 manifest + ordered member bytes.
 * No member headers, compression, absolute paths, credentials or executable content.
 */
export async function writeSeedPackage({
  file,
  directory,
  records,
  identity,
  openAsset,
  clock = Date.now,
  packageId = randomUUID(),
}) {
  await mkdir(directory, { recursive: true });
  const recordFile = path.join(directory, 'records.ndjson');
  const output = await open(recordFile, 'wx');
  const digest = createHash('sha256');
  let recordSize = 0;
  try {
    for (const record of records) {
      validateSeedEntity(record);
      const bytes = Buffer.from(JSON.stringify(record) + '\n');
      if (bytes.length > 2 * 1024 ** 2) bad('SEED_RECORD_TOO_LARGE');
      recordSize += bytes.length;
      digest.update(bytes);
      await writeAll(output, bytes);
    }
    await output.sync();
  } finally {
    await output.close();
  }
  const sources = [recordFile];
  const members = [{ path: 'records.ndjson', size: recordSize, sha256: digest.digest('hex') }];
  const hashes = new Set();
  for (const record of records.filter((r) => r.entityType === 'asset' && r.state === 'active')) {
    const asset = await openAsset(record.entityId);
    if (asset.sha256 !== record.data.sha256 || asset.size !== record.data.size)
      bad('SEED_ASSET_CHANGED');
    if (hashes.has(asset.sha256)) continue;
    hashes.add(asset.sha256);
    sources.push(asset.contentPath);
    members.push({ path: 'media/' + asset.sha256, size: asset.size, sha256: asset.sha256 });
  }
  const manifest = {
    format: PRODUCT_SEED_FORMAT,
    version: 1,
    mode: 'product-bootstrap',
    packageId,
    libraryId: identity.libraryId,
    epoch: identity.epoch,
    watermark: identity.watermark,
    checkpoint: identity.checkpoint,
    createdAt: new Date(clock()).toISOString(),
    entityCount: records.length,
    assetCount: records.filter((r) => r.entityType === 'asset' && r.state === 'active').length,
    bytes: members.reduce((sum, m) => sum + m.size, 0),
    members,
    policy: { ...PRODUCT_SEED_POLICY },
    containsCredentials: false,
    containsSourceArchives: false,
  };
  validateSeedManifest(manifest);
  await validateSeedRecords(records, manifest, async (asset) => {
    const opened = await openAsset(asset.assetId);
    const f = await open(opened.contentPath, 'r');
    try {
      return await readExact(f, asset.size, 0);
    } finally {
      await f.close();
    }
  });
  const metadata = Buffer.from(JSON.stringify(manifest));
  if (metadata.length > 32 * 1024 ** 2) bad('SEED_MANIFEST_TOO_LARGE');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(metadata.length);
  const target = await open(file, 'wx'),
    totalHash = createHash('sha256');
  let size = 0;
  const put = async (bytes) => {
    await writeAll(target, bytes);
    totalHash.update(bytes);
    size += bytes.length;
  };
  try {
    await put(Buffer.from(PRODUCT_SEED_MAGIC));
    await put(header);
    await put(metadata);
    for (const [index, source] of sources.entries()) {
      const check = createHash('sha256');
      let bytesRead = 0;
      for await (const bytes of createReadStream(source)) {
        check.update(bytes);
        bytesRead += bytes.length;
        await put(bytes);
      }
      if (bytesRead !== members[index].size || check.digest('hex') !== members[index].sha256)
        bad('SEED_SOURCE_HASH_MISMATCH');
    }
    await target.sync();
  } finally {
    await target.close();
  }
  return { manifest, sha256: totalHash.digest('hex'), size };
}

/** Verify all bytes before exposing any records to an importer. Extraction is hash-named only. */
export async function readSeedPackage({ file, directory, expectedSha256 }) {
  if (expectedSha256 && (await seedFileHash(file)) !== expectedSha256)
    bad('SEED_PACKAGE_HASH_MISMATCH');
  const source = await open(file, 'r');
  let manifest, offset;
  try {
    const magic = Buffer.from(PRODUCT_SEED_MAGIC);
    if (!(await readExact(source, magic.length, 0)).equals(magic)) bad('INVALID_SEED_MAGIC');
    const length = (await readExact(source, 4, magic.length)).readUInt32BE();
    if (length > 32 * 1024 ** 2 || length < 2) bad('SEED_MANIFEST_TOO_LARGE');
    try {
      manifest = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(
          await readExact(source, length, magic.length + 4),
        ),
      );
    } catch {
      bad('INVALID_SEED_MANIFEST_JSON');
    }
    validateSeedManifest(manifest);
    offset = magic.length + 4 + length;
    if ((await source.stat()).size !== offset + manifest.bytes) bad('SEED_PACKAGE_LENGTH_MISMATCH');
  } finally {
    await source.close();
  }
  await mkdir(directory, { recursive: true });
  await mkdir(path.join(directory, 'media'), { recursive: true });
  for (const member of manifest.members) {
    const dest = path.join(directory, ...member.path.split('/'));
    // A failed validation directory is private and must never be reused as a complete package.
    const output = await open(dest, 'wx'),
      check = createHash('sha256');
    try {
      if (member.size)
        for await (const bytes of createReadStream(file, {
          start: offset,
          end: offset + member.size - 1,
        })) {
          check.update(bytes);
          await writeAll(output, bytes);
        }
      if (check.digest('hex') !== member.sha256) bad('SEED_MEMBER_HASH_MISMATCH');
      await output.sync();
    } finally {
      await output.close();
    }
    offset += member.size;
  }
  const records = [];
  let pending = '';
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const parse = (line) => {
    if (Buffer.byteLength(line) > 2 * 1024 ** 2) bad('SEED_RECORD_TOO_LARGE');
    try {
      records.push(JSON.parse(line));
    } catch {
      bad('INVALID_SEED_RECORD_JSON');
    }
    if (records.length > manifest.entityCount) bad('SEED_RECORD_COUNT_MISMATCH');
  };
  for await (const bytes of createReadStream(path.join(directory, 'records.ndjson'))) {
    pending += decoder.decode(bytes, { stream: true });
    let index;
    while ((index = pending.indexOf('\n')) !== -1) {
      parse(pending.slice(0, index));
      pending = pending.slice(index + 1);
    }
    if (Buffer.byteLength(pending) > 2 * 1024 ** 2) bad('SEED_RECORD_TOO_LARGE');
  }
  pending += decoder.decode();
  if (pending) bad('SEED_RECORDS_TRUNCATED');
  await validateSeedRecords(records, manifest, async (asset) => {
    const input = await open(path.join(directory, 'media', asset.sha256), 'r');
    try {
      return await readExact(input, asset.size, 0);
    } finally {
      await input.close();
    }
  });
  return {
    manifest,
    records,
    directory,
    size: (await stat(file)).size,
    sha256: await seedFileHash(file),
  };
}
