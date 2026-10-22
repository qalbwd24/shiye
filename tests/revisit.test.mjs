import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createDiaryServer } from '../src/server/app.mjs';
import {
  configureRevisit,
  tickRevisit,
  revisitFeed,
  addRevisitComment,
  commentsForEntry,
  replayInstant,
} from '../src/server/domain/revisit.mjs';
import { revisitSources } from '../src/server/domain/revisit-sources.mjs';
import { commitChatUnit, readMessageUnits } from '../src/server/domain/message-store.mjs';

const para = (id, text) => ({
  type: 'paragraph',
  attrs: { blockId: id },
  content: [{ type: 'text', text }],
});
const entry = (id, year = 2025) => ({
  id,
  title: '合成日记',
  category: '日常',
  tags: [],
  revision: 1,
  date: `${year}-10-17T00:00:00.000Z`,
  contentEditedAt: `${year}-10-17T02:00:00.000Z`,
  contentFormat: 'richdoc',
  body: {
    format: 'shiye-richdoc',
    version: 1,
    content: [para(id + 'a', `[${year}/10/17 08:30:00]`), para(id + 'b', '合成 **文本**')],
  },
  attachments: [],
});
const library = () => ({
  entries: [entry('a'), entry('b', 2024)],
  categories: ['日常'],
  media: [],
});
const setup = (db) => configureRevisit(db, { expectedRevision: 1, enabled: true });
const now = Date.parse('2026-10-17T00:31:00Z');

test('first tick starts now, annual multiples form fixed group, retries and reload do not duplicate or touch diaries', () => {
  const db = library(),
    originals = structuredClone(db.entries);
  setup(db);
  assert.equal(tickRevisit(db, {}, now).initialized, true);
  assert.equal(revisitFeed(db).total, 0);
  assert.equal(
    tickRevisit(db, { manual: true, from: '2026-10-17T00:00:00Z', to: '2026-10-17T00:31:00Z' }, now)
      .created,
    2,
  );
  const feed = revisitFeed(db);
  assert.equal(feed.batches.length, 1);
  assert.equal(feed.batches[0].targets.length, 2);
  assert.equal(feed.deliveries[0].originalAt, '2024-10-17T00:30:00.000Z');
  assert.equal(
    tickRevisit(db, { manual: true, from: '2026-10-17T00:00:00Z', to: '2026-10-17T00:31:00Z' }, now)
      .created,
    0,
  );
  const restored = JSON.parse(JSON.stringify(db));
  assert.equal(tickRevisit(restored, {}, now + 1000).created, 0);
  assert.deepEqual(db.entries, originals);
  assert.ok(!JSON.stringify(db.revisit.deliveries).includes('合成 **文本**'));
});

test('polling covers half-open windows, midnight and downtime in resumable one-day chunks', () => {
  const db = library();
  setup(db);
  const start = Date.parse('2026-10-16T23:59:00Z');
  tickRevisit(db, {}, start);
  assert.equal(tickRevisit(db, {}, now).created, 2);
  assert.equal(tickRevisit(db, {}, now).created, 0);
  const result = tickRevisit(db, {}, now + 3 * 86400000);
  assert.equal(result.remaining, true);
  assert.equal(result.cursor, new Date(now + 86400000 - 1).toISOString());
});

test('calendar rules skip leap-day and month-end invalid dates and respect Beijing', () => {
  const config = { interval: { unit: 'year', count: 1 }, timeZone: 'Asia/Shanghai' };
  assert.equal(
    replayInstant('2024-02-29T01:00:00Z', Date.parse('2025-02-28T04:00:00Z'), config),
    null,
  );
  assert.equal(
    replayInstant('2025-10-16T16:30:00Z', now, config),
    Date.parse('2026-10-16T16:30:00Z'),
  );
  config.interval = { unit: 'month', count: 1 };
  assert.equal(
    replayInstant('2025-01-31T01:00:00Z', Date.parse('2026-02-28T04:00:00Z'), config),
    null,
  );
  config.interval = { unit: 'year', count: 2 };
  assert.equal(replayInstant('2025-10-17T00:30:00Z', now, config), null);
});

test('whole-minute delivery keeps one group across polls and sender edits do not reset cursor or duplicate sources', () => {
  const db = library();
  db.entries[1].body.content[0].content[0].text = '[2024/10/17 08:30:40]';
  setup(db);
  tickRevisit(db, {}, now - 120000);
  assert.equal(tickRevisit(db, {}, now - 30000).created, 0);
  assert.equal(tickRevisit(db, {}, now).created, 2);
  assert.equal(db.revisit.batches.length, 1);
  const cursor = db.revisit.cursor;
  configureRevisit(db, { expectedRevision: 2, sender: { name: '过去的自己' } });
  assert.equal(db.revisit.cursor, cursor);
  assert.equal(
    tickRevisit(db, { manual: true, from: '2026-10-17T00:00:00Z', to: '2026-10-17T00:31:00Z' }, now)
      .created,
    0,
  );
});

test('comments bind quote to one source or entire fixed batch, remain grouped by diary and never become replay sources', () => {
  const db = library();
  setup(db);
  tickRevisit(db, { manual: true, from: '2026-10-17T00:00:00Z', to: '2026-10-17T00:31:00Z' }, now);
  const { deliveries, batches } = revisitFeed(db),
    batchId = batches[0].id;
  const group = addRevisitComment(
    db,
    { operationId: 'group-comment', batchId, text: '今天的感想' },
    now,
  );
  const quote = addRevisitComment(
    db,
    { operationId: 'quote-comment', batchId, deliveryId: deliveries[0].id, text: '只回复这一条' },
    now,
  );
  assert.equal(group.targets.length, 2);
  assert.equal(group.body.format, 'shiye-richdoc');
  assert.equal(group.origin.kind, 'comment');
  assert.equal(group.eventTime.source, 'comment-created');
  assert.equal(readMessageUnits(db).filter((unit) => unit.origin.kind === 'comment').length, 2);
  assert.equal(quote.targets.length, 1);
  assert.equal(commentsForEntry(db, quote.targets[0].entryId).length, 2);
  assert.equal(
    addRevisitComment(
      db,
      { operationId: 'quote-comment', batchId, deliveryId: deliveries[0].id, text: '只回复这一条' },
      now,
    ).id,
    quote.id,
  );
  assert.throws(
    () =>
      addRevisitComment(db, { operationId: 'quote-comment', batchId, text: '更换目标或正文' }, now),
    { status: 409 },
  );
  configureRevisit(db, { expectedRevision: 2, interval: { unit: 'month', count: 3 } });
  assert.deepEqual(db.revisit.comments[0].targets, group.targets);
  assert.equal(revisitSources(db).sources.length, 2);
});

test('legacy snapshot identity survives taxonomy but never silently targets another text after content edits', () => {
  const db = library();
  setup(db);
  tickRevisit(db, { manual: true, from: '2026-10-17T00:00:00Z', to: '2026-10-17T00:31:00Z' }, now);
  const feed = revisitFeed(db),
    delivery = feed.deliveries.find((item) => item.ref.entryId === 'a');
  db.entries[0].title = '改名';
  assert.equal(
    revisitFeed(db).deliveries.find((item) => item.id === delivery.id).source.title,
    '改名',
  );
  db.entries[0].body.content[1].content[0].text = '更改原文';
  assert.equal(
    revisitFeed(db).deliveries.find((item) => item.id === delivery.id).source.available,
    false,
  );
  db.entries[1].hidden = true;
  assert.ok(revisitFeed(db).deliveries.every((item) => !item.source.available));
  assert.throws(
    () =>
      addRevisitComment(db, {
        operationId: 'bad',
        batchId: feed.batches[0].id,
        text: '引用过期内容',
      }),
    /来源已变化/,
  );
});

test('source adaptation excludes comments, drafts and withdrawn messages; independent old attachments use edit clock', () => {
  const db = library();
  db.entries[1].draft = true;
  db.media.push({ id: 'picture', type: 'image/png', name: '合成图片' });
  db.entries[0].attachments = ['picture'];
  const catalog = revisitSources(db);
  assert.equal(catalog.sources.length, 2);
  const image = catalog.sources.find((source) =>
    source.unit.body.content.some((node) => node.type === 'image'),
  );
  assert.equal(image.unit.eventTime.instant, '2025-10-17T02:00:00.000Z');
  assert.equal(
    image.unit.body.content.find((node) => node.type === 'image').attrs.insertedAt,
    null,
  );
});

test('legacy hidden flags and partially adopted chat history cannot leak or disappear', () => {
  const db = library();
  db.entries[1].legacy = { isHidden: true };
  const messages = [1, 2, 3].map((id) => ({
    id: String(id),
    sentAt: '2025-10-17T00:30:00.000Z',
    text: '合成聊天',
    attachments: [],
  }));
  messages[2].withdrawn = true;
  const chat = {
    id: 'chat-entry',
    title: '旧聊天',
    category: '日常',
    attachments: [],
    chatJournal: { sourceId: randomUUID(), roomId: '-1', messages },
  };
  db.entries.push(chat);
  commitChatUnit(db, chat, messages[0], '<p>合成聊天</p>', { messageUnitsEnabled: true });
  const catalog = revisitSources(db);
  assert.equal(catalog.sources.filter((source) => source.ref.entryId === 'chat-entry').length, 2);
  assert.ok(!catalog.sources.some((source) => source.ref.entryId === 'b'));
  assert.equal(db.messageStore.units.length, 1);
});

test('HTTP config, manual push, media, comment and restart use isolated storage; bad requests rollback', async (t) => {
  const dir = path.resolve('tmp/revisit-push', randomUUID());
  await fs.mkdir(path.join(dir, 'media'), { recursive: true });
  const db = library();
  db.media = [{ id: 'image', type: 'image/png', name: '合成图' }];
  db.entries[0].attachments = ['image'];
  await fs.writeFile(path.join(dir, 'diary.json'), JSON.stringify(db));
  await fs.writeFile(path.join(dir, 'media/image'), 'synthetic-media');
  let server, base;
  const start = async () => {
    server = await createDiaryServer({ dataDir: dir, seed: false });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  };
  const close = async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  };
  await start();
  t.after(close);
  const request = async (route, method = 'POST', data = {}) => {
    const res = await fetch(base + '/api/revisit' + route, {
      method,
      headers: { 'X-Diary-Client': 'desktop' },
      ...(method !== 'GET' ? { body: JSON.stringify(data) } : {}),
    });
    return { status: res.status, data: await res.json() };
  };
  assert.equal(
    (await request('/config', 'PUT', { expectedRevision: 1, enabled: true })).status,
    200,
  );
  assert.equal((await request('/tick')).data.initialized, true);
  assert.equal((await request('/tick', 'POST', { to: '2030-01-01' })).status, 400);
  assert.equal(
    (
      await request('/tick', 'POST', {
        manual: true,
        from: '2026-10-17T00:00:00Z',
        to: '2026-10-17T03:00:00Z',
      })
    ).data.created,
    3,
  );
  const feed = (await request('/feed', 'POST', { after: 0 })).data;
  const media = feed.deliveries.find((item) => item.source.media.includes('image'));
  const chunk = (
    await request('/media', 'POST', { deliveryId: media.id, assetId: 'image', offset: 0 })
  ).data;
  assert.equal(Buffer.from(chunk.bytes, 'base64').toString(), 'synthetic-media');
  const commentInput = {
    operationId: 'api-comment',
    batchId: feed.batches[0].id,
    text: '隔离评论',
  };
  const comment = (await request('/comments', 'POST', commentInput)).data;
  assert.equal(comment.origin.kind, 'comment');
  assert.equal(
    (await request('/comments/withdraw', 'POST', { operationId: 'api-comment' })).status,
    200,
  );
  await request('/comments/withdraw', 'POST', { operationId: 'late-comment' });
  assert.equal(
    (await request('/comments', 'POST', { ...commentInput, operationId: 'late-comment' })).data
      .state,
    'withdrawn',
  );
  const cli = await promisify(execFile)(
    process.execPath,
    ['tools/revisit-push.mjs', '--url', base, '--once'],
    { cwd: path.resolve('.') },
  );
  assert.equal(JSON.parse(cli.stdout).created, 0);
  assert.equal(
    (await request('/media', 'POST', { deliveryId: media.id, assetId: '../diary.json' })).status,
    404,
  );
  await close();
  await start();
  assert.equal((await request('/feed', 'POST', { after: 0 })).data.total, 3);
  const saved = JSON.parse(await fs.readFile(path.join(dir, 'diary.json'), 'utf8'));
  assert.equal(
    saved.revisit.comments.find((item) => item.operationId === 'api-comment').body,
    null,
  );
  assert.deepEqual(saved.entries, db.entries);
});
