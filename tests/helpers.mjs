import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createCipheriv } from 'node:crypto';
import { createDiaryServer } from '../server.mjs';
import { crc32 } from '../src/server/imports/legacy.mjs';

export const sample = {
  title: '中文与 emoji 🌿',
  content: '<p>第一行</p><blockquote>有格式的内容</blockquote>',
  date: '2026-09-14T05:00:00.000Z',
  category: '学习',
  tags: ['数学'],
  attachments: [],
  mood: '平静',
  weather: '晴',
  location: '书桌',
};
export async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'diary-frontend-test-'));
  const server = await createDiaryServer({ dataDir: dir, seed: false });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    const absolute = path.resolve(dir);
    assert.ok(
      absolute.startsWith(path.resolve(os.tmpdir()) + path.sep) &&
        path.basename(absolute).startsWith('diary-frontend-test-'),
    );
    await fs.rm(absolute, { recursive: true, force: true });
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  const request = (p, method = 'GET', data) =>
    fetch(base + p, {
      method,
      headers: {
        'X-Diary-Client': 'desktop',
        ...(data ? { 'Content-Type': 'application/json' } : {}),
      },
      body: data ? JSON.stringify(data) : undefined,
    });
  return { dir, server, base, request };
}
export function zip(items) {
  const pieces = [],
    central = [];
  let offset = 0;
  for (const [name, data] of Object.entries(items)) {
    const n = Buffer.from(name),
      local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    pieces.push(local, n, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x800, 8);
    c.writeUInt32LE(crc32(data), 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, n);
    offset += 30 + n.length + data.length;
  }
  const c = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length / 2, 8);
  end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(c.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...pieces, c, end]);
}
export async function compatKeys() {
  const source = await fs.readFile(
    new URL('../resources/legacy/backup_reader.py', import.meta.url),
    'utf8',
  );
  return {
    win: Buffer.from(source.match(/WINDOWS_KEY = '([^']+)'/)[1], 'hex'),
    keys: Object.fromEntries(
      [...source.match(/KEYS = (\{[^}]+\})/s)[1].matchAll(/'([^']+)'\s*:\s*'([^']+)'/g)].map(
        (m) => [m[1], m[2]],
      ),
    ),
  };
}
export function encrypt(b, key, mode) {
  const c = createCipheriv(mode, key, mode.endsWith('cbc') ? Buffer.alloc(16) : null);
  return Buffer.concat([c.update(b), c.final()]);
}
export const legacyData = {
  uuid: 'old-entry-uuid',
  content: '# 原格式\n**重点** 🌿',
  title: '迁移验证',
  createTime: 1726000000000,
  recordTime: 1726000000000,
  updateTime: 1726000000001,
  category: 'cat-1',
  tag: 'tag-1',
  images: 'https://example.invalid/one.png|missing.jpg',
  contentType: 1,
  unknownFutureField: { a: 17 },
  isHidden: true,
};
