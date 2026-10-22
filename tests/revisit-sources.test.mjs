import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { sourceLibrary, richBody, paragraph } from './helpers/revisit-source-fixtures.mjs';
import { createLibrarySourcePort } from '../src/server/domain/revisit/sources/library-port.mjs';
import { createSourceReader } from '../src/server/domain/revisit/sources/catalog.mjs';
import { createDiarySourceAdapter } from '../src/server/domain/revisit/sources/diary-adapter.mjs';
import { freezeTree } from '../src/server/domain/revisit/sources/identity.mjs';
import {
  openRevisitSources,
  revisitSources,
  readRevisitDiary,
  resolveRevisitSource,
  presentRevisitSource,
  readSourceEntryHtml,
  sourceMediaIds,
} from '../src/server/domain/revisit-sources.mjs';
import { configureRevisit, tickRevisit } from '../src/server/domain/revisit.mjs';
import { createDiaryServer } from '../src/server/app.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const readerFor = (db) => createSourceReader(createLibrarySourcePort(() => db));
const originalAt = '2025-10-17T00:30:00.000Z';

test('source reader captures exactly once and never mutates even frozen originals', () => {
  const db = freezeTree(sourceLibrary());
  const before = JSON.stringify(db);
  let reads = 0;
  const reader = createSourceReader(
    createLibrarySourcePort(() => {
      reads++;
      return db;
    }),
  );
  const session = reader.capture();
  assert.equal(reads, 1);
  assert.equal(session.version, 1);
  assert.equal(session.catalog.sources.length, 13);
  for (const source of session.catalog.sources) {
    assert.equal(session.resolve(source.ref), source);
    presentRevisitSource(source);
    readSourceEntryHtml(source, session);
    sourceMediaIds(source);
  }
  assert.equal(reads, 1);
  assert.equal(JSON.stringify(db), before);
  assert.throws(() => {
    session.catalog.sources[0].entry.title = '污染';
  }, TypeError);
  assert.throws(() => {
    session.catalog.sources[0].unit.state = 'withdrawn';
  }, TypeError);
});

test('fresh snapshots reflect mutable taxonomy while retained read sessions remain coherent', () => {
  const db = sourceLibrary();
  const reader = readerFor(db);
  const previous = reader.capture();
  const source = previous.catalog.sources.find((item) => item.ref.entryId === 'canonical');
  const entry = db.entries.find((item) => item.id === 'canonical');
  entry.title = '改名';
  entry.category = '新的分类';
  entry.tags = ['新标签'];
  const current = reader.capture().resolve(source.ref);
  assert.equal(current.entry.title, '改名');
  assert.equal(current.unit.attributes.category, '新的分类');
  assert.deepEqual(current.unit.attributes.tags, ['新标签']);
  assert.equal(previous.resolve(source.ref).entry.title, '合成条目 canonical');
  assert.equal(current.ref.unitId, source.ref.unitId);
  assert.equal(current.unit.eventTime.instant, source.unit.eventTime.instant);
});

test('legacy content edit invalidates old snapshot refs, taxonomy edits do not', () => {
  const db = sourceLibrary();
  const ref = revisitSources(db).sources.find((item) => item.ref.entryId === 'old-html').ref;
  db.entries[0].category = '新分类';
  db.entries[0].tags = ['新标签'];
  assert.equal(resolveRevisitSource(db, ref).entry.category, '新分类');
  db.entries[0].content += '<p>新内容</p>';
  assert.equal(resolveRevisitSource(db, ref), null);
  assert.equal(presentRevisitSource(resolveRevisitSource(db, ref)).available, false);
});

test('diary cache cannot be poisoned and media metadata invalidates inline conversion across libraries', () => {
  const db = sourceLibrary();
  const entry = db.entries[0];
  entry.attachments = [];
  entry.content = '<p>内嵌图片</p><p><img src="/media/synthetic-image"></p>';
  const first = readRevisitDiary(db, entry);
  assert.ok(JSON.stringify(first).includes('合成图片.png'));
  first.units.length = 0;
  first.issues.push({ code: '污染' });
  const again = readRevisitDiary(db, entry);
  assert.ok(again.units.length > 0);
  assert.ok(!JSON.stringify(again).includes('污染'));
  entry.revision++;
  assert.equal(readRevisitDiary(db, entry).layout.sourceRevision, entry.revision);
  const other = structuredClone(db);
  other.media[0].name = '另一库图片.png';
  assert.ok(JSON.stringify(readRevisitDiary(other, other.entries[0])).includes('另一库图片.png'));
  assert.ok(!JSON.stringify(readRevisitDiary(other, other.entries[0])).includes('合成图片.png'));
  assert.ok(JSON.stringify(readRevisitDiary(db, entry)).includes('合成图片.png'));
});

test('bounded cache eviction and disabled caching preserve the same candidate identities', () => {
  const db = sourceLibrary();
  const port = createLibrarySourcePort(() => db);
  for (const maxBytes of [0, 128, 1024 * 1024]) {
    const adapter = createDiarySourceAdapter({ maxBytes });
    const first = adapter.read(port.capture(), db.entries[0]);
    adapter.read(port.capture(), db.entries[1]);
    assert.deepEqual(adapter.read(port.capture(), db.entries[0]), first);
  }
});

test('legacy standalone attachments use edit fallback and new images/videos retain insertion instants', () => {
  const db = sourceLibrary();
  const session = openRevisitSources(db);
  const old = session.catalog.sources.filter((item) => item.ref.entryId === 'old-html');
  assert.equal(old[0].unit.body.content[0].type, 'image');
  assert.equal(old[0].unit.body.content[0].attrs.insertedAt, null);
  assert.equal(old[0].unit.eventTime.instant, db.entries[0].contentEditedAt);
  assert.equal(old[0].unit.eventTime.source, 'edit-fallback');
  assert.ok(old.some((item) => item.unit.eventTime.instant === originalAt));
  const rich = session.catalog.sources.filter((item) => item.ref.entryId === 'rich-candidate');
  for (const type of ['image', 'video']) {
    const media = rich.find(
      (item) =>
        item.unit.body.content[0].type === type && item.unit.body.content[0].attrs.insertedAt,
    );
    assert.equal(media.unit.eventTime.instant, '2025-10-17T01:23:45.000Z');
    assert.ok(sourceMediaIds(media).has(media.unit.body.content[0].attrs.assetId));
  }
  const canonical = session.catalog.sources.find((item) => item.ref.entryId === 'canonical');
  assert.ok(!Object.hasOwn(canonical.ref, 'snapshot'));
  assert.ok(!JSON.stringify(readSourceEntryHtml(canonical, session)).includes('candidate:'));
});

test('partially adopted chats fill missing IDs once and preserve reply links without writes', () => {
  const db = sourceLibrary();
  const before = structuredClone(db);
  const sources = revisitSources(db).sources.filter((item) => item.ref.entryId === 'partial-chat');
  assert.equal(sources.length, 2);
  assert.equal(new Set(sources.map((item) => item.unit.id)).size, 2);
  assert.equal(sources[1].unit.replyTo, sources[0].unit.id);
  assert.equal(sources[1].unit.eventTime.instant, '2025-10-17T00:32:00.000Z');
  assert.deepEqual(db, before);
});

test('fresh reads suppress hidden/deleted/draft sources and both canonical and legacy withdrawals', () => {
  for (const flag of ['hidden', 'deleted', 'draft']) {
    const db = sourceLibrary();
    const source = revisitSources(db).sources.find((item) => item.ref.entryId === 'canonical');
    db.entries.find((entry) => entry.id === 'canonical')[flag] = true;
    assert.equal(resolveRevisitSource(db, source.ref), null);
  }
  for (const mode of ['registry', 'projection', 'canonical']) {
    const db = sourceLibrary();
    const source = revisitSources(db).sources.find((item) => item.ref.entryId === 'partial-chat');
    if (mode === 'registry') db.chatJournal.withdrawals.push({ ...source.unit.origin });
    if (mode === 'projection')
      db.entries.find((entry) => entry.id === 'partial-chat').chatJournal.messages[0].withdrawn =
        true;
    if (mode === 'canonical')
      db.messageStore.units.find((unit) => unit.id === source.unit.id).state = 'withdrawn';
    assert.equal(resolveRevisitSource(db, source.ref), null);
    assert.equal(
      presentRevisitSource(resolveRevisitSource(db, source.ref)).html.includes('合成消息'),
      false,
    );
  }
});

test('unknown times, malformed legacy and missing canonical records produce review issues without rewriting', () => {
  const db = sourceLibrary();
  db.entries.push(
    {
      id: 'unknown-time',
      contentFormat: 'richdoc',
      body: richBody(paragraph('无时间')),
      attachments: [],
    },
    { id: 'bad-richdoc', contentFormat: 'richdoc', body: { format: 'invalid' }, attachments: [] },
    {
      id: 'missing-canonical',
      messageUnits: { ids: ['missing-id'] },
      content: '<p>不能重新编号</p>',
    },
  );
  db.messageStore.units[0].eventTime.instant = '2025-10-17T00:30:00+00:00';
  db.entries.find((entry) => entry.id === 'canonical').messageUnits.ids.push('missing-partial');
  db.media.push({ id: 'synthetic-audio', type: 'audio/ogg', name: '保留的旧音频' });
  db.entries.push({
    ...db.entries[0],
    id: 'unsupported-attachment',
    attachments: ['synthetic-audio'],
    content: '<p>旧音频原文仍保留</p>',
  });
  const before = structuredClone(db);
  const catalog = revisitSources(db);
  for (const [entryId, code] of [
    ['unknown-time', 'source-time-unavailable'],
    ['bad-richdoc', 'source-adaptation-failed'],
    ['missing-canonical', 'source-canonical-units-missing'],
    ['canonical', 'source-time-unavailable'],
    ['canonical', 'source-canonical-units-missing'],
    ['unsupported-attachment', 'non-image-attachment-body-unsupported'],
  ])
    assert.ok(
      catalog.issues.some((issue) => issue.entryId === entryId && issue.codes.includes(code)),
      `${entryId}: ${code}`,
    );
  assert.ok(catalog.sources.some((item) => item.ref.entryId === 'old-html'));
  assert.deepEqual(db, before);
});

test('catalog and read port keep transport, delivery state and presentation out of their direct dependencies', async () => {
  for (const file of ['catalog.mjs', 'library-port.mjs']) {
    const code = await fs.readFile(
      new URL(`../src/server/domain/revisit/sources/${file}`, import.meta.url),
      'utf8',
    );
    const dependencies = [...code.matchAll(/from ['"]([^'"]+)['"]/g)].map((match) => match[1]);
    assert.ok(
      dependencies.every(
        (dependency) =>
          !/node:fs|routes\/|presentation|revisit-markdown|rich-document-renderer|revisit\.mjs/.test(
            dependency,
          ),
      ),
    );
    assert.ok(!/\bmutate\(|\bsetInterval\(|\bfetch\(/.test(code));
  }
});

test('comments are excluded and indexing compatibility facade resolves against one captured catalog', () => {
  const db = sourceLibrary();
  const comment = structuredClone(db.messageStore.units[0]);
  comment.id = 'synthetic-comment';
  comment.origin.kind = 'comment';
  db.revisit = { comments: [comment] };
  const catalog = revisitSources(db);
  assert.ok(catalog.sources.every((source) => source.unit.origin.kind !== 'comment'));
  assert.equal(resolveRevisitSource(db, catalog.sources[0].ref, catalog), catalog.sources[0]);
  assert.deepEqual(
    resolveRevisitSource(db, catalog.sources[0].ref, structuredClone(catalog)),
    catalog.sources[0],
  );
});

test('isolated HTTP feed/source/media reads preserve diary and media file hashes and leave no migrations', async (t) => {
  const dir = path.resolve('tmp/revisit-decoupling/stage2/http', randomUUID());
  await fs.mkdir(path.join(dir, 'media'), { recursive: true });
  const db = sourceLibrary();
  configureRevisit(db, { expectedRevision: 1, enabled: true });
  tickRevisit(
    db,
    { manual: true, from: '2026-10-17T00:00:00Z', to: '2026-10-17T03:00:00Z' },
    Date.parse('2026-10-17T03:00:00Z'),
  );
  await fs.writeFile(path.join(dir, 'diary.json'), JSON.stringify(db));
  for (const asset of db.media)
    await fs.writeFile(path.join(dir, 'media', asset.id), `synthetic-bytes:${asset.id}`);
  const fileHashes = async () =>
    Object.fromEntries(
      await Promise.all(
        ['diary.json', ...db.media.map((asset) => `media/${asset.id}`)].map(async (name) => [
          name,
          hash(await fs.readFile(path.join(dir, name))),
        ]),
      ),
    );
  const before = await fileHashes();
  const server = await createDiaryServer({ dataDir: dir, seed: false });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (route, data) => {
    const response = await fetch(base + '/api/revisit' + route, {
      method: 'POST',
      headers: { 'X-Diary-Client': 'desktop' },
      body: JSON.stringify(data),
    });
    assert.equal(response.status, 200, route);
    return response.json();
  };
  const feed = await request('/feed', { after: 0, limit: 100 });
  assert.ok(feed.total > 0);
  for (const delivery of feed.deliveries) {
    const source = await request('/source', { deliveryId: delivery.id });
    assert.equal(source.available, true);
    assert.equal(typeof source.entryHtml, 'string');
    for (const assetId of source.media) {
      const media = await request('/media', { deliveryId: delivery.id, assetId });
      assert.equal(Buffer.from(media.bytes, 'base64').toString(), `synthetic-bytes:${assetId}`);
    }
  }
  const denied = await fetch(base + '/api/revisit/media', {
    method: 'POST',
    headers: { 'X-Diary-Client': 'desktop' },
    body: JSON.stringify({ deliveryId: feed.deliveries[0].id, assetId: '../diary.json' }),
  });
  assert.equal(denied.status, 404);
  assert.deepEqual(await fileHashes(), before);
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(dir, 'diary.json'), 'utf8')).entries,
    db.entries,
  );
  await fs.mkdir(path.resolve('outputs/revisit-decoupling/stage2'), { recursive: true });
  await fs.writeFile(
    path.resolve('outputs/revisit-decoupling/stage2/http-readonly.json'),
    JSON.stringify(
      {
        isolationDir: dir,
        deliveriesRead: feed.deliveries.length,
        before,
        after: await fileHashes(),
        unchanged: true,
      },
      null,
      2,
    ),
  );
});
