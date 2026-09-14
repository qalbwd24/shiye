import { LIMITS } from './limits.js';
import { toBase64, fromBase64 } from './vault.js';
const encoder = new TextEncoder(),
  decoder = new TextDecoder();
async function transform(bytes, mode) {
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(
      mode === 'compress' ? new CompressionStream('gzip') : new DecompressionStream('gzip'),
    );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
export const chunkSize = LIMITS.vaultChunkBytes;
async function keyFor(password, h) {
  if (password.length < 12) throw Error('备份密码至少需要 12 个字符');
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: fromBase64(h.salt), iterations: 600000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}
export async function vaultWriter(password) {
  const header = {
    format: 'shiye-vault',
    version: 2,
    kdf: 'PBKDF2-SHA256',
    iterations: 600000,
    cipher: 'AES-256-GCM',
    salt: toBase64(crypto.getRandomValues(new Uint8Array(16))),
    archiveId: crypto.randomUUID(),
    compression: 'gzip-records',
  };
  const key = await keyFor(password, header);
  let index = 0;
  return {
    header,
    async record(payload) {
      const iv = crypto.getRandomValues(new Uint8Array(12)),
        i = index++;
      return {
        index: i,
        iv: toBase64(iv),
        data: toBase64(
          new Uint8Array(
            await crypto.subtle.encrypt(
              { name: 'AES-GCM', iv, additionalData: encoder.encode(JSON.stringify([header, i])) },
              key,
              await transform(encoder.encode(JSON.stringify(payload)), 'compress'),
            ),
          ),
        ),
      };
    },
  };
}
export async function vaultReader(header, password) {
  if (
    header?.format !== 'shiye-vault' ||
    header.version !== 2 ||
    header.kdf !== 'PBKDF2-SHA256' ||
    header.cipher !== 'AES-256-GCM' ||
    header.iterations !== 600000 ||
    fromBase64(header.salt).length !== 16
  )
    throw Error('不支持的备份格式');
  const key = await keyFor(password, header);
  let index = 0;
  return async (record) => {
    if (record.index !== index) throw Error('备份顺序错误或文件被截断');
    try {
      const data = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: fromBase64(record.iv),
          additionalData: encoder.encode(JSON.stringify([header, index])),
        },
        key,
        fromBase64(record.data),
      );
      index++;
      return JSON.parse(
        decoder.decode(
          header.compression === 'gzip-records' ? await transform(data, 'decompress') : data,
        ),
      );
    } catch {
      throw Error('密码不正确，或备份已损坏');
    }
  };
}
export async function* lines(file) {
  const reader = file.stream().getReader(),
    decode = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decode.decode() : decode.decode(value, { stream: true });
      let p;
      while ((p = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, p);
        buffer = buffer.slice(p + 1);
        if (line.trim()) yield JSON.parse(line);
      }
      if (buffer.length > LIMITS.vaultRecordBytes) throw Error('备份数据块异常');
      if (done) {
        if (buffer.trim()) yield JSON.parse(buffer);
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
export async function createBackup(api, password, progress) {
  const manifest = await api('/api/backup-manifest'),
    writer = await vaultWriter(password);
  const job = await api('/api/backups', { method: 'POST', data: writer.header });
  let chunks = 0,
    bytes = 0;
  const put = async (payload) => {
    await api('/api/backups/' + job.id + '/record', {
      method: 'POST',
      data: await writer.record(payload),
    });
    chunks++;
  };
  try {
    await put({ kind: 'manifest', ...manifest });
    for (const f of manifest.files) {
      for (let offset = 0; offset < f.size; offset += chunkSize) {
        const end = Math.min(offset + chunkSize, f.size) - 1,
          r = await fetch(f.url, { headers: { Range: `bytes=${offset}-${end}` } });
        if (!r.ok) throw Error('读取附件失败：' + f.name);
        const data = new Uint8Array(await r.arrayBuffer());
        if (data.length !== end - offset + 1) throw Error('附件分块长度不符');
        await put({ kind: 'file', folder: f.folder, id: f.id, offset, data: toBase64(data) });
        bytes += data.length;
        progress(bytes, manifest.total);
      }
    }
    await put({ kind: 'end', chunks });
    return await api('/api/backups/' + job.id + '/finish', {
      method: 'POST',
      data: { records: chunks },
    });
  } catch (e) {
    await api('/api/backups/' + job.id + '/cancel', { method: 'POST', data: {} }).catch(() => {});
    throw e;
  }
}
export async function restoreBackup(api, file, password, progress) {
  let read,
    manifest,
    job,
    count = 0,
    ended = false,
    bytes = 0;
  try {
    for await (const record of lines(file)) {
      if (!read) {
        read = await vaultReader(record, password);
        continue;
      }
      if (ended) throw Error('备份结束后仍有额外数据');
      const payload = await read(record);
      if (payload.kind === 'manifest') {
        if (manifest) throw Error('重复备份目录');
        manifest = payload;
        job = await api('/api/restore-jobs', { method: 'POST', data: manifest });
      } else if (payload.kind === 'file') {
        if (!job) throw Error('缺少备份目录');
        const data = fromBase64(payload.data);
        await api(`/api/restore-jobs/${job.id}/file/${payload.folder}/${payload.id}`, {
          method: 'POST',
          raw: data,
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-Offset': String(payload.offset),
          },
        });
        bytes += data.length;
        progress(bytes, manifest.total);
      } else if (payload.kind === 'end') {
        if (payload.chunks !== count) throw Error('备份数据块不完整');
        ended = true;
      } else throw Error('未知备份数据块');
      count++;
    }
    if (!ended || !job) throw Error('备份被截断，没有完整结束标记');
    return await api('/api/restore-jobs/' + job.id + '/commit', { method: 'POST', data: {} });
  } catch (e) {
    if (job)
      await api('/api/restore-jobs/' + job.id + '/cancel', { method: 'POST', data: {} }).catch(
        () => {},
      );
    throw e;
  }
}
