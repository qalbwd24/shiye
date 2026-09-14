import { LIMITS } from '../../../public/shared/limits.js';
import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import { createInflateRaw } from 'node:zlib';
import { randomUUID, createHash } from 'node:crypto';
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
  return n >>> 0;
});
export async function extractZip(file, dir) {
  const handle = await fs.open(file, 'r'),
    stat = await handle.stat(),
    members = new Map();
  const read = async (pos, length) => {
    if (!Number.isSafeInteger(pos) || pos < 0 || pos + length > stat.size)
      throw Error('ZIP 偏移超出文件');
    const b = Buffer.alloc(length);
    const result = await handle.read(b, 0, length, pos);
    if (result.bytesRead !== length) throw Error('ZIP 文件截断');
    return b;
  };
  const u64 = (b, pos) => {
    const n = Number(b.readBigUInt64LE(pos));
    if (!Number.isSafeInteger(n)) throw Error('ZIP 文件过大');
    return n;
  };
  try {
    const tailStart = Math.max(0, stat.size - 65557),
      tail = await read(tailStart, stat.size - tailStart);
    let end = -1;
    for (let i = tail.length - 22; i >= 0; i--)
      if (
        tail.readUInt32LE(i) === 0x06054b50 &&
        i + 22 + tail.readUInt16LE(i + 20) === tail.length
      ) {
        end = i;
        break;
      }
    if (end < 0) throw Error('ZIP 目录不存在，文件可能没有复制完整');
    if (tail.readUInt16LE(end + 4) || tail.readUInt16LE(end + 6)) throw Error('请先合并分卷 ZIP');
    let count = tail.readUInt16LE(end + 10),
      position = tail.readUInt32LE(end + 16);
    if (count === 65535 || position === 0xffffffff) {
      const locator = await read(tailStart + end - 20, 20);
      if (locator.readUInt32LE(0) !== 0x07064b50) throw Error('ZIP64 目录缺失');
      const record = await read(u64(locator, 8), 56);
      if (
        record.readUInt32LE(0) !== 0x06064b50 ||
        record.readUInt32LE(16) ||
        record.readUInt32LE(20)
      )
        throw Error('ZIP64 目录无效');
      count = u64(record, 32);
      position = u64(record, 48);
    }
    if (count > LIMITS.archiveMembers) throw Error('ZIP 文件数量超过 100000');
    let total = 0;
    const names = new Set();
    for (let i = 0; i < count; i++) {
      const h = await read(position, 46);
      if (h.readUInt32LE(0) !== 0x02014b50) throw Error('ZIP 中央目录损坏');
      const flags = h.readUInt16LE(8),
        method = h.readUInt16LE(10),
        expectedCrc = h.readUInt32LE(16),
        nameLength = h.readUInt16LE(28),
        extraLength = h.readUInt16LE(30);
      let compressed = h.readUInt32LE(20),
        size = h.readUInt32LE(24),
        offset = h.readUInt32LE(42);
      const fields = await read(position + 46, nameLength + extraLength),
        name = new TextDecoder(flags & 0x800 ? 'utf-8' : 'gb18030').decode(
          fields.subarray(0, nameLength),
        );
      position += 46 + nameLength + extraLength + h.readUInt16LE(32);
      const extra = fields.subarray(nameLength);
      for (let x = 0; x + 4 <= extra.length;) {
        const tag = extra.readUInt16LE(x),
          len = extra.readUInt16LE(x + 2);
        x += 4;
        if (x + len > extra.length) throw Error('ZIP 扩展损坏');
        if (tag === 1) {
          let q = x;
          if (size === 0xffffffff) {
            size = u64(extra, q);
            q += 8;
          }
          if (compressed === 0xffffffff) {
            compressed = u64(extra, q);
            q += 8;
          }
          if (offset === 0xffffffff) offset = u64(extra, q);
        }
        x += len;
      }
      if (
        !name ||
        /^[\\/]|^[a-z]:|\\|\0/i.test(name) ||
        name.split('/').includes('..') ||
        names.has(name.toLowerCase())
      )
        throw Error('ZIP 含不安全或重复路径');
      names.add(name.toLowerCase());
      if (name.endsWith('/')) continue;
      if (flags & 1) throw Error('这是带 ZIP 密码的压缩包，请先在本地解开外层 ZIP 密码');
      if (![0, 8].includes(method)) throw Error('ZIP 压缩方法暂不支持');
      total += size;
      if (total > LIMITS.archiveExpandedBytes) throw Error('解压总量超过 64 GB');
      const local = await read(offset, 30);
      if (local.readUInt32LE(0) !== 0x04034b50) throw Error('ZIP 局部文件头损坏');
      const start = offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
      if (start + compressed > stat.size) throw Error('ZIP 文件数据截断');
      const output = path.join(dir, randomUUID()),
        out = await fs.open(output, 'wx'),
        hash = createHash('sha256');
      let actual = 0,
        crc = 0xffffffff;
      try {
        if (compressed) {
          const source = createReadStream(file, { start, end: start + compressed - 1 }),
            stream = method === 8 ? source.pipe(createInflateRaw()) : source;
          source.on('error', (e) => stream.destroy(e));
          try {
            for await (const chunk of stream) {
              actual += chunk.length;
              if (actual > size) throw Error('ZIP 解压长度与目录不符');
              for (const b of chunk) crc = (crc >>> 8) ^ crcTable[(crc ^ b) & 255];
              hash.update(chunk);
              await out.writeFile(chunk);
            }
          } finally {
            source.destroy();
            stream.destroy();
          }
        }
      } finally {
        await out.close();
      }
      if (actual !== size || (crc ^ 0xffffffff) >>> 0 !== expectedCrc)
        throw Error('ZIP 文件 CRC 校验失败：' + path.posix.basename(name));
      if (
        ['source.json', 'category.json', 'tag.json', 'model.json', 'version'].includes(
          path.posix.basename(name),
        )
      ) {
        if (size > LIMITS.metadataBytes) throw Error('日记元数据超过 64 MB');
        members.set(name, await fs.readFile(output));
      } else members.set(name, { sourcePath: output, size, sha256: hash.digest('hex') });
    }
    return members;
  } finally {
    await handle.close();
  }
}
