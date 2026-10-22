import { createReadStream } from 'node:fs';
import { open, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createInflateRaw } from 'node:zlib';
import path from 'node:path';

const MAX_SEED = 64 * 1024 ** 3 + 64 * 1024 ** 2;
const fail = (code) => {
  throw Object.assign(Error(code), { code, status: 422 });
};
const crcTable = Uint32Array.from({ length: 256 }, (_, i) => {
  let value = i;
  for (let n = 0; n < 8; n++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});
async function exact(file, count, at) {
  const bytes = Buffer.alloc(count);
  let offset = 0;
  while (offset < count) {
    const read = await file.read(bytes, offset, count - offset, at + offset);
    if (!read.bytesRead) fail('SHARED_SEED_ZIP_TRUNCATED');
    offset += read.bytesRead;
  }
  return bytes;
}
// ZIP is a wrapper of one data.syseed and optional inert coverage.json only.
// No entry name becomes a filesystem path; output names are chosen here.
// ZIP64 is explicitly unsupported; large packages use raw .syseed framing.
export async function unwrapSharedSeedZip({ file, directory, expectedSha256, signal }) {
  if (!path.isAbsolute(file || '') || !path.isAbsolute(directory || ''))
    fail('SHARED_SEED_EXPLICIT_FILE_REQUIRED');
  await mkdir(directory, { recursive: true });
  const root = path.resolve(directory),
    task = await mkdtemp(path.join(root, 'shared-seed-zip-'));
  const cleanup = async () => {
    if (path.dirname(task) !== root || !path.basename(task).startsWith('shared-seed-zip-'))
      fail('SHARED_SEED_CLEANUP_BOUNDARY');
    await rm(task, { recursive: true, force: true });
  };
  let source;
  try {
    source = await open(file, 'r');
    const size = (await source.stat()).size;
    if (size < 22 || size > MAX_SEED) fail('SHARED_SEED_ZIP_SIZE');
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file, { highWaterMark: 256 * 1024 })) {
      if (signal?.aborted) fail('SHARED_SEED_CANCELLED');
      hash.update(chunk);
    }
    const sha256 = hash.digest('hex');
    if (expectedSha256 && expectedSha256 !== sha256) fail('SHARED_SEED_PACKAGE_HASH_MISMATCH');
    const tailStart = Math.max(0, size - 65557),
      tail = await exact(source, size - tailStart, tailStart);
    let end = -1;
    for (let n = tail.length - 22; n >= 0; n--)
      if (
        tail.readUInt32LE(n) === 0x06054b50 &&
        n + 22 + tail.readUInt16LE(n + 20) === tail.length
      ) {
        end = n;
        break;
      }
    if (end < 0) fail('SHARED_SEED_ZIP_DIRECTORY');
    const count = tail.readUInt16LE(end + 10),
      length = tail.readUInt32LE(end + 12),
      offset = tail.readUInt32LE(end + 16),
      endAt = tailStart + end;
    if (count === 0xffff || length === 0xffffffff || offset === 0xffffffff)
      fail('SHARED_SEED_ZIP64_UNSUPPORTED');
    if (
      tail.readUInt16LE(end + 4) ||
      tail.readUInt16LE(end + 6) ||
      tail.readUInt16LE(end + 8) !== count ||
      count < 1 ||
      count > 2 ||
      length > 512 * 1024 ||
      offset + length !== endAt
    )
      fail('SHARED_SEED_ZIP_DIRECTORY');
    const central = await exact(source, length, offset),
      entries = [],
      names = new Set();
    let position = 0;
    for (let n = 0; n < count; n++) {
      if (position + 46 > length || central.readUInt32LE(position) !== 0x02014b50)
        fail('SHARED_SEED_ZIP_DIRECTORY');
      const flags = central.readUInt16LE(position + 8),
        method = central.readUInt16LE(position + 10),
        crc = central.readUInt32LE(position + 16),
        compressed = central.readUInt32LE(position + 20),
        unpacked = central.readUInt32LE(position + 24),
        nameLength = central.readUInt16LE(position + 28),
        extra = central.readUInt16LE(position + 30),
        comment = central.readUInt16LE(position + 32),
        disk = central.readUInt16LE(position + 34),
        attributes = central.readUInt32LE(position + 38),
        local = central.readUInt32LE(position + 42);
      const total = 46 + nameLength + extra + comment;
      if (position + total > length) fail('SHARED_SEED_ZIP_DIRECTORY');
      const nameBytes = central.subarray(position + 46, position + 46 + nameLength),
        name = nameBytes.toString('utf8'),
        mode = (attributes >>> 16) & 0xf000;
      if (
        !['data.syseed', 'coverage.json'].includes(name) ||
        !Buffer.from(name).equals(nameBytes) ||
        names.has(name) ||
        disk ||
        (mode && mode !== 0x8000) ||
        flags & ~0x080e ||
        ![0, 8].includes(method)
      )
        fail('SHARED_SEED_ZIP_MEMBER');
      if ([compressed, unpacked, local].includes(0xffffffff)) fail('SHARED_SEED_ZIP64_UNSUPPORTED');
      if (unpacked < 1 || unpacked > (name === 'coverage.json' ? 1024 * 1024 : MAX_SEED))
        fail('SHARED_SEED_ZIP_MEMBER_SIZE');
      names.add(name);
      entries.push({ name, nameBytes, flags, method, crc, compressed, unpacked, local });
      position += total;
    }
    if (position !== length || !names.has('data.syseed')) fail('SHARED_SEED_ZIP_DIRECTORY');
    entries.sort((a, b) => a.local - b.local);
    let previousEnd = 0;
    for (const entry of entries) {
      if (entry.local !== previousEnd || entry.local + 30 > offset) fail('SHARED_SEED_ZIP_OVERLAP');
      const header = await exact(source, 30, entry.local);
      if (
        header.readUInt32LE(0) !== 0x04034b50 ||
        header.readUInt16LE(6) !== entry.flags ||
        header.readUInt16LE(8) !== entry.method ||
        header.readUInt16LE(26) !== entry.nameBytes.length
      )
        fail('SHARED_SEED_ZIP_LOCAL_HEADER');
      const name = await exact(source, entry.nameBytes.length, entry.local + 30);
      if (!name.equals(entry.nameBytes)) fail('SHARED_SEED_ZIP_LOCAL_HEADER');
      const start = entry.local + 30 + entry.nameBytes.length + header.readUInt16LE(28),
        stop = start + entry.compressed;
      if (stop > offset) fail('SHARED_SEED_ZIP_TRUNCATED');
      if (
        !(entry.flags & 8) &&
        (header.readUInt32LE(14) !== entry.crc ||
          header.readUInt32LE(18) !== entry.compressed ||
          header.readUInt32LE(22) !== entry.unpacked)
      )
        fail('SHARED_SEED_ZIP_LOCAL_HEADER');
      let end = stop;
      if (entry.flags & 8) {
        const first = await exact(source, 4, stop),
          signature = first.readUInt32LE() === 0x08074b50;
        const descriptor = await exact(source, 12, stop + (signature ? 4 : 0));
        if (
          descriptor.readUInt32LE(0) !== entry.crc ||
          descriptor.readUInt32LE(4) !== entry.compressed ||
          descriptor.readUInt32LE(8) !== entry.unpacked
        )
          fail('SHARED_SEED_ZIP_DESCRIPTOR');
        end += signature ? 16 : 12;
      }
      if (end > offset) fail('SHARED_SEED_ZIP_TRUNCATED');
      previousEnd = end;
      const target = path.join(
          task,
          entry.name === 'data.syseed' ? 'payload.syseed' : 'coverage.json',
        ),
        output = await open(target, 'wx');
      const compressedStream = entry.compressed
        ? createReadStream(file, { start, end: stop - 1, highWaterMark: 256 * 1024 })
        : undefined;
      const stream =
        entry.method === 8 && compressedStream
          ? compressedStream.pipe(createInflateRaw())
          : compressedStream;
      if (stream && stream !== compressedStream)
        compressedStream.on('error', (error) => stream.destroy(error));
      let received = 0,
        crc = 0xffffffff;
      try {
        if (stream)
          for await (const bytes of stream) {
            if (signal?.aborted) fail('SHARED_SEED_CANCELLED');
            received += bytes.length;
            if (received > entry.unpacked) fail('SHARED_SEED_ZIP_MEMBER_SIZE');
            for (const b of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ b) & 255];
            let written = 0;
            while (written < bytes.length) {
              const part = await output.write(bytes, written, bytes.length - written);
              if (!part.bytesWritten) fail('SHARED_SEED_WRITE_FAILED');
              written += part.bytesWritten;
            }
          }
        if (received !== entry.unpacked || (crc ^ 0xffffffff) >>> 0 !== entry.crc)
          fail('SHARED_SEED_ZIP_CRC');
        if (entry.method === 8 && stream?.bytesWritten !== entry.compressed)
          fail('SHARED_SEED_ZIP_COMPRESSED_LENGTH');
        await output.sync();
      } finally {
        stream?.destroy();
        compressedStream?.destroy();
        await output.close();
      }
      if (entry.name === 'coverage.json') {
        const handle = await open(target, 'r');
        try {
          JSON.parse(
            new TextDecoder('utf-8', { fatal: true }).decode(
              await exact(handle, entry.unpacked, 0),
            ),
          );
        } catch {
          fail('SHARED_SEED_ZIP_COVERAGE');
        } finally {
          await handle.close();
        }
      }
    }
    if (previousEnd !== offset) fail('SHARED_SEED_ZIP_OVERLAP');
    const payload = path.join(task, 'payload.syseed'),
      handle = await open(payload, 'r');
    try {
      if (!(await exact(handle, 14, 0)).equals(Buffer.from('SHIYE-SEED-V1\n')))
        fail('SHARED_SEED_MAGIC_MISMATCH');
    } finally {
      await handle.close();
    }
    return { file: payload, sha256, size, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  } finally {
    await source?.close();
  }
}
