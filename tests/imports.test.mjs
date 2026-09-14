import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { createHash } from 'node:crypto';

import { decodeLegacy, sha } from '../src/server/imports/legacy.mjs';
import { encryptVault, decryptVault } from '../public/shared/vault.js';

import { extractZip } from '../src/server/imports/zip-stream.mjs';
import { fixture, zip, compatKeys, encrypt, legacyData } from './helpers.mjs';
test('stream ZIP rejects unsafe paths and checks CRC without whole archive extraction in memory', async (t) => {
  const { dir } = await fixture(t);
  const file = path.join(dir, 'test.zip'),
    out = path.join(dir, 'extracted');
  await fs.mkdir(out);
  await fs.writeFile(
    file,
    zip({ 'source.json': Buffer.from('[]'), 'image.png': Buffer.from('media-bytes') }),
  );
  const members = await extractZip(file, out);
  assert.equal(members.get('source.json').toString(), '[]');
  assert.equal((await fs.readFile(members.get('image.png').sourcePath)).toString(), 'media-bytes');
  await fs.writeFile(file, zip({ '../escape': Buffer.from('bad') }));
  await assert.rejects(() => extractZip(file, out));
});
test('large import endpoint preserves original hash and uses diary date rather than record timestamp', async (t) => {
  const { base, request } = await fixture(t);
  const raw = zip({
    'source.json': Buffer.from(
      JSON.stringify([
        {
          ...legacyData,
          category: undefined,
          type: 'cat-1',
          createTime: 1726000000000,
          recordTime: 1728000000000,
        },
      ]),
    ),
    'category.json': Buffer.from(JSON.stringify([{ uuid: 'cat-1', name: '原分类' }])),
    version: Buffer.from('3'),
  });
  const upload = await (
    await fetch(base + '/api/import-upload', {
      method: 'POST',
      headers: { 'X-Diary-Client': 'desktop' },
      body: raw,
    })
  ).json();
  const r = await request('/api/import-upload/' + upload.id + '/commit', 'POST', {});
  assert.equal(r.status, 200);
  const lib = await (await request('/api/library')).json();
  assert.equal(lib.entries[0].category, '原分类');
  assert.equal(lib.entries[0].date, new Date(1726000000000).toISOString());
  assert.match(lib.entries[0].content, /<h1>/);
  assert.equal(lib.imports[0].sha256, sha(raw));
});
test('ZIP64 central directory and 64-bit member fields are supported; corrupt payload leaves library untouched', async (t) => {
  const { dir, base, request } = await fixture(t),
    name = 'source.json',
    data = Buffer.from('[]'),
    raw = zip({ [name]: data }),
    centralOffset = 30 + Buffer.byteLength(name) + data.length;
  const central = Buffer.from(raw.subarray(centralOffset, centralOffset + 46)),
    extra = Buffer.alloc(28);
  extra.writeUInt16LE(1);
  extra.writeUInt16LE(24, 2);
  extra.writeBigUInt64LE(BigInt(data.length), 4);
  extra.writeBigUInt64LE(BigInt(data.length), 12);
  extra.writeBigUInt64LE(0n, 20);
  central.writeUInt32LE(0xffffffff, 20);
  central.writeUInt32LE(0xffffffff, 24);
  central.writeUInt32LE(0xffffffff, 42);
  central.writeUInt16LE(extra.length, 30);
  const directory = Buffer.concat([central, Buffer.from(name), extra]),
    record = Buffer.alloc(56);
  record.writeUInt32LE(0x06064b50);
  record.writeBigUInt64LE(44n, 4);
  record.writeBigUInt64LE(1n, 24);
  record.writeBigUInt64LE(1n, 32);
  record.writeBigUInt64LE(BigInt(directory.length), 40);
  record.writeBigUInt64LE(BigInt(centralOffset), 48);
  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50);
  locator.writeBigUInt64LE(BigInt(centralOffset + directory.length), 8);
  locator.writeUInt32LE(1, 16);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(0xffff, 8);
  end.writeUInt16LE(0xffff, 10);
  end.writeUInt32LE(0xffffffff, 12);
  end.writeUInt32LE(0xffffffff, 16);
  const file = path.join(dir, 'zip64.zip'),
    out = path.join(dir, 'zip64-out');
  await fs.mkdir(out);
  await fs.writeFile(
    file,
    Buffer.concat([raw.subarray(0, centralOffset), directory, record, locator, end]),
  );
  assert.equal((await extractZip(file, out)).get(name).toString(), '[]');
  const corrupt = Buffer.from(raw);
  corrupt[30 + Buffer.byteLength(name)] ^= 1;
  const upload = await (
    await fetch(base + '/api/import-upload', {
      method: 'POST',
      headers: { 'X-Diary-Client': 'desktop' },
      body: corrupt,
    })
  ).json();
  const result = await request('/api/import-upload/' + upload.id + '/commit', 'POST', {});
  assert.equal(result.status, 422);
  assert.match((await result.json()).error, /CRC/);
  assert.equal((await (await request('/api/library')).json()).entries.length, 0);
  assert.deepEqual(await fs.readdir(path.join(dir, 'import-staging')), []);
  assert.deepEqual(await fs.readdir(path.join(dir, 'originals')), []);
});
test('Windows AES-ECB and WebDAV JSON preserve raw unknown fields and category/tag IDs', async () => {
  const { win } = await compatKeys();
  const obj = {
    diaryList: [legacyData],
    categoryList: [{ uuid: 'cat-1', name: '旧分类' }],
    tagList: [{ uuid: 'tag-1', name: '旧标签' }],
    modelList: [],
    otherRoot: 'retained',
  };
  const encrypted = encrypt(Buffer.from(JSON.stringify(obj)), win, 'aes-256-ecb').toString('hex');
  const w = await decodeLegacy(Buffer.from(encrypted), 'windows.enc');
  assert.deepEqual(w.entries[0].legacy.original, legacyData);
  assert.equal(w.entries[0].category, '旧分类');
  assert.deepEqual(w.entries[0].tags, ['旧标签']);
  assert.equal(w.archive.tables._original.otherRoot, 'retained');
  const dav = await decodeLegacy(
    Buffer.from(
      JSON.stringify({
        json: JSON.stringify(obj.diaryList),
        catagory: JSON.stringify(obj.categoryList),
        tag: JSON.stringify(obj.tagList),
        model: '[]',
      }),
    ),
    'diary.json',
  );
  assert.equal(dav.entries[0].category, '旧分类');
  assert.equal(dav.report.unresolved, 2);
});
test('Android encrypted ZIP, original bytes, media candidates, duplicate prevention and vault archive retention', async (t) => {
  const { keys } = await compatKeys();
  const tables = {
    'source.json': [legacyData],
    'category.json': [{ uuid: 'cat-1', name: '旧分类' }],
    'tag.json': [{ uuid: 'tag-1', name: '旧标签' }],
    'model.json': [],
    version: 3,
  };
  const items = {};
  for (const [name, obj] of Object.entries(tables))
    items[name] = Buffer.from(
      encrypt(
        Buffer.from(JSON.stringify(obj)),
        createHash('sha256').update(keys[name]).digest(),
        'aes-256-cbc',
      ).toString('base64'),
    );
  items['one.png'] = Buffer.from('synthetic-media');
  const raw = zip(items),
    { base, request } = await fixture(t);
  const upload = () =>
    fetch(base + '/api/import', {
      method: 'POST',
      headers: {
        'X-Diary-Client': 'desktop',
        'X-File-Name': encodeURIComponent('原始加密备份.zip'),
      },
      body: raw,
    });
  const response = await upload();
  assert.equal(response.status, 200);
  const report = await response.json();
  assert.equal(report.entries, 1);
  assert.equal(report.unresolved, 1);
  assert.equal(report.candidateMatches, 1);
  const lib = await (await request('/api/library')).json();
  assert.deepEqual(lib.entries[0].legacy.original, legacyData);
  assert.equal(lib.entries[0].legacy.isHidden, true);
  assert.deepEqual(
    Buffer.from(await (await fetch(base + '/api/original/' + lib.imports[0].id)).arrayBuffer()),
    raw,
  );
  assert.equal((await upload()).status, 409);
  const bundle = await (await request('/api/bundle')).json();
  const archived = bundle.files.find((f) => f.folder === 'originals');
  assert.equal(archived.sha256, sha(raw));
  const v = await encryptVault(bundle, 'retained-archive-password');
  const roundtrip = await decryptVault(v, 'retained-archive-password');
  assert.deepEqual(
    Buffer.from(roundtrip.files.find((f) => f.folder === 'originals').data, 'base64'),
    raw,
  );
});
test('Android plaintext ZIP accepted; unsafe path, corruption and unknown format rejected', async () => {
  const raw = zip({
    'source.json': Buffer.from(JSON.stringify([legacyData])),
    version: Buffer.from('3'),
  });
  assert.equal((await decodeLegacy(raw)).entries.length, 1);
  await assert.rejects(() => decodeLegacy(zip({ '../source.json': Buffer.from('[]') })));
  const bad = Buffer.from(raw);
  bad[45] ^= 1;
  await assert.rejects(() => decodeLegacy(bad));
  await assert.rejects(() => decodeLegacy(Buffer.from('not-a-backup')));
});
