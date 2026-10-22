import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createDiaryServer } from '../src/server/app.mjs';
import { decodeLegacy } from '../src/server/imports/legacy.mjs';
import { legacySourceOptions } from '../src/server/imports/one-diary-source.mjs';
import { reconcileImport } from '../src/server/domain/import-reconciliation.mjs';

const options = { sourcePolicy: 'one-diary', sourceId: randomUUID() };
const original = {
  uuid: 'original-stable-id',
  title: '同名',
  content: '原文',
  createTime: 1700000000000,
  recordTime: 1700000000000,
  updateTime: 1700000000000,
  customUnknown: { nested: [1, 2] },
};
const decode = (rows, opts = options) =>
  decodeLegacy(Buffer.from(JSON.stringify(rows)), 'fixture.json', opts);
const empty = () => ({ entries: [], media: [], imports: [], categories: [] });

test('explicit one-diary lineage reuses old imported UUID identity and preserves changed versions/local drafts as conflicts', async () => {
  const db = empty();
  const old = await decode([original], {});
  reconcileImport(db, old);
  const oldId = db.entries[0].id;
  assert.equal(reconcileImport(db, await decode([original])).report.mergedEntries, 1);
  assert.equal(db.entries[0].id, oldId);
  assert.deepEqual(db.entries[0].legacy.source, {
    provider: 'one-diary',
    sourceId: options.sourceId,
    recordType: 'uuid',
    recordId: original.uuid,
  });
  db.entries[0].content = '<p>电脑已改且有草稿</p>';
  db.entries[0].draft = true;
  const preserved = structuredClone(db.entries[0]);
  const changed = await decode([{ ...original, content: 'App继续写的新版' }]);
  assert.equal(reconcileImport(db, changed).report.conflicts, 1);
  assert.deepEqual(db.entries[0], preserved);
  assert.equal(db.entries.length, 2);
  assert.deepEqual(db.entries[1].legacy.original.customUnknown, original.customUnknown);
  assert.equal(
    reconcileImport(db, await decode([{ ...original, content: 'App继续写的新版' }])).report
      .mergedEntries,
    1,
  );
  assert.equal(db.entries.length, 2);
});

test('primary UUID cannot match another record alternate ID or an ID-type identity, even for identical content', async () => {
  for (const previous of [
    { ...original, uuid: 'A', id: 'B' },
    { ...original, uuid: undefined, id: 'B' },
  ]) {
    const db = empty();
    reconcileImport(db, await decode([previous], {}));
    const before = structuredClone(db.entries[0]);
    const report = reconcileImport(db, await decode([{ ...original, uuid: 'B', id: 'C' }])).report;
    assert.equal(report.mergedEntries, 0);
    assert.equal(db.entries.length, 2);
    assert.deepEqual(db.entries[0], before);
  }
  const db = empty();
  reconcileImport(db, await decode([{ ...original, uuid: undefined, id: 'B' }]));
  reconcileImport(db, await decode([{ ...original, uuid: 'B', id: 'C' }]));
  assert.equal(db.entries.length, 2);
});

test('explicit unknown IDs do not merge by title/date/body or row index; source namespaces remain separate', async () => {
  const db = empty();
  const { uuid: _, ...missing } = original;
  const input = await decode([missing, missing]);
  assert.equal(input.report.unidentifiedEntries, 2);
  reconcileImport(db, input);
  assert.equal(db.entries.length, 2);
  reconcileImport(db, await decode([original]));
  reconcileImport(db, await decode([original], { ...options, sourceId: randomUUID() }));
  assert.equal(db.entries.length, 4);
  assert.equal(new Set(db.entries.map((e) => e.id)).size, 4);
  const preProvenance = empty();
  reconcileImport(preProvenance, await decode([original], {}));
  reconcileImport(preProvenance, await decode([original]));
  reconcileImport(preProvenance, await decode([original], { ...options, sourceId: randomUUID() }));
  assert.equal(preProvenance.entries.length, 2);
});

test('explicit source header validation is strict and older unspecified import behavior is retained', async () => {
  assert.deepEqual(legacySourceOptions({}), {});
  assert.throws(() => legacySourceOptions({ 'x-import-source': 'one-diary' }), {
    code: 'ONE_DIARY_SOURCE_REQUIRED',
  });
  assert.deepEqual(
    legacySourceOptions({ 'x-import-source': 'one-diary', 'x-import-source-id': options.sourceId }),
    options,
  );
  await assert.rejects(() => decode([], { ...options, sourceId: 'title' }), {
    code: 'ONE_DIARY_SOURCE_REQUIRED',
  });
  const db = empty();
  const { uuid: _, ...missing } = original;
  reconcileImport(db, await decode([missing], {}));
  assert.equal(reconcileImport(db, await decode([missing], {})).report.mergedEntries, 1);
});

test('both real legacy upload routes preserve explicit lineage; invalid source cannot commit and old entry IDs survive changed export', async (t) => {
  const root = path.resolve('tmp/one-diary-source-tests');
  await mkdir(root, { recursive: true });
  const dataDir = await mkdtemp(path.join(root, 'case-'));
  const server = await createDiaryServer({ dataDir, seed: false });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.close();
    await once(server, 'close');
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (url, rows, headers = {}) => {
    const response = await fetch(base + url, {
      method: 'POST',
      headers: {
        'X-Diary-Client': 'desktop',
        'Content-Type': 'application/octet-stream',
        ...headers,
      },
      body: rows === undefined ? '{}' : JSON.stringify(rows),
    });
    return { status: response.status, value: await response.json() };
  };
  const headers = { 'x-import-source': 'one-diary', 'x-import-source-id': options.sourceId };
  assert.equal((await request('/api/import', [original], headers)).status, 200);
  let db = JSON.parse(await readFile(path.join(dataDir, 'diary.json'), 'utf8'));
  const originalId = db.entries[0].id;
  const staged = await request(
    '/api/import-upload',
    [{ ...original, content: 'new exported version' }],
    headers,
  );
  assert.equal(staged.status, 201);
  assert.equal((await request('/api/import-upload/' + staged.value.id + '/commit')).status, 200);
  db = JSON.parse(await readFile(path.join(dataDir, 'diary.json'), 'utf8'));
  assert.equal(db.entries.length, 2);
  assert.equal(db.entries[0].id, originalId);
  assert.equal(db.entries[1].legacy.source.sourceId, options.sourceId);
  assert.equal(db.conflicts.length, 1);
  const before = await readFile(path.join(dataDir, 'diary.json'), 'utf8');
  assert.equal(
    (await request('/api/import-upload', [], { ...headers, 'x-import-source-id': 'bad' })).status,
    400,
  );
  assert.equal(await readFile(path.join(dataDir, 'diary.json'), 'utf8'), before);
});
