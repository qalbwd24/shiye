import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { commentLibrary, commentNow } from './helpers/revisit-comment-fixtures.mjs';
import {
  addRevisitComment,
  withdrawRevisitComment,
  commentsForEntry,
  configureRevisit,
  tickRevisit,
} from '../src/server/domain/revisit.mjs';
import { resolveCommentContext } from '../src/server/domain/revisit/comments/context.mjs';
import {
  commentBody,
  assertCommentContent,
} from '../src/server/domain/revisit/comments/content.mjs';
import {
  planRevisitComment,
  planRevisitWithdrawal,
  commitCommentPlan,
} from '../src/server/domain/revisit/comments/persistence.mjs';
import { describeCommentsForEntry } from '../src/server/domain/revisit/comments/query.mjs';
import { createRevisitCommentService } from '../src/server/domain/revisit/comments/service.mjs';
import { createLibraryDeliveryPort } from '../src/server/domain/revisit/delivery/storage-port.mjs';
import {
  exportRevisitArchive,
  restoreRevisitArchive,
  stateToken,
} from '../src/server/domain/revisit/delivery/archive.mjs';
import { revisitSources } from '../src/server/domain/revisit-sources.mjs';
import { freezeTree } from '../src/server/domain/revisit/sources/identity.mjs';
import { readMessageUnits } from '../src/server/domain/message-store.mjs';
import { createLibraryStore } from '../src/server/storage/library-store.mjs';
import { createDiaryServer } from '../src/server/app.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const groupInput = (fixture, extra = {}) => ({
  operationId: 'synthetic-group-comment',
  batchId: fixture.group.id,
  text: '合成评论',
  ...extra,
});
async function storeFor(db) {
  const dir = path.resolve('tmp/revisit-decoupling/stage4/stores', randomUUID());
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'diary.json'), JSON.stringify(db));
  const store = await createLibraryStore({ dataDir: dir, seed: false });
  const service = createRevisitCommentService(createLibraryDeliveryPort(store), {
    clock: () => commentNow,
  });
  return { dir, store, service };
}

test('explicit quotation targets one message; no quotation targets the selected fixed group', () => {
  const f = commentLibrary();
  const quote = resolveCommentContext(f.db, { batchId: f.group.id, deliveryId: f.quote.id });
  assert.equal(quote.scope, 'message');
  assert.deepEqual(quote.targets, [f.quote.ref]);
  const group = resolveCommentContext(f.db, { batchId: f.group.id });
  assert.equal(group.scope, 'group');
  assert.deepEqual(group.targets, f.group.targets);
  assert.equal(group.replyTo, null);
  assert.equal(group.entries.length, new Set(f.group.targets.map((ref) => ref.entryId)).size);
  assert.throws(() => {
    group.targets.length = 0;
  }, TypeError);
  const written = addRevisitComment(
    f.db,
    groupInput(f, {
      operationId: 'ignore-client-relations',
      deliveryId: f.quote.id,
      targets: [f.media.ref],
      replyTo: f.media.ref,
      commentOn: [{ kind: 'entry', entryId: 'wrong' }],
    }),
    commentNow,
  );
  assert.deepEqual(written.targets, [f.quote.ref]);
  assert.deepEqual(written.replyTo, f.quote.ref);
});

test('a later displayed group or rule change cannot steal an existing selected draft target', () => {
  const f = commentLibrary();
  const chosen = resolveCommentContext(f.db, { batchId: f.group.id });
  assert.notEqual(f.group.id, f.db.revisit.batches.at(-1).id);
  configureRevisit(f.db, { expectedRevision: 2, interval: { unit: 'month', count: 3 } });
  tickRevisit(
    f.db,
    { manual: true, from: '2026-10-17T00:00:00Z', to: '2026-10-17T03:00:00Z' },
    commentNow,
  );
  const comment = addRevisitComment(f.db, groupInput(f), commentNow);
  assert.deepEqual(comment.targets, chosen.targets);
  assert.equal(comment.batchId, chosen.batchId);
  assert.equal(f.db.revisit.comments.length, 1);
});

test('missing selection, foreign quote, media without a quote and unavailable members are rejected without writes', () => {
  for (const input of [
    { operationId: 'bad', batchId: null, text: '不能隐式选择最新组' },
    { deliveryId: 'wrong-id' },
    { deliveryId: 'media-from-another-group' },
    { occurrenceId: 'unknown-image' },
  ]) {
    const f = commentLibrary();
    const value = groupInput(f, input);
    if (value.deliveryId === 'media-from-another-group') value.deliveryId = f.media.id;
    const before = structuredClone(f.db);
    assert.throws(() => addRevisitComment(f.db, value, commentNow), { status: 409 });
    assert.deepEqual(f.db, before);
  }
  const f = commentLibrary();
  f.db.entries.find((entry) => entry.id === f.group.targets[0].entryId).hidden = true;
  const before = structuredClone(f.db);
  assert.throws(() => addRevisitComment(f.db, groupInput(f), commentNow), { status: 409 });
  assert.deepEqual(f.db, before);
});

test('media comments retain occurrence identity and are annotated under the owning diary', () => {
  const f = commentLibrary();
  const input = groupInput(f, {
    batchId: f.media.batchId,
    deliveryId: f.media.id,
    occurrenceId: f.occurrence.occurrenceId,
  });
  const comment = addRevisitComment(f.db, input, commentNow);
  assert.deepEqual(comment.replyTo, f.media.ref);
  assert.equal(comment.commentOn[0].kind, 'media');
  assert.equal(comment.commentOn[0].occurrenceId, f.occurrence.occurrenceId);
  const view = describeCommentsForEntry(f.db, f.media.ref.entryId);
  assert.equal(view.comments[0].context.scope, 'media');
  assert.equal(view.comments[0].context.targets[0].available, true);
  assert.throws(
    () =>
      addRevisitComment(
        f.db,
        { ...input, operationId: 'bad-media', occurrenceId: 'other-occurrence' },
        commentNow,
      ),
    { status: 409 },
  );
  const videoSource = revisitSources(f.db).sources.find(
    (source) => source.unit.body.content[0]?.type === 'video',
  );
  const videoDelivery = f.db.revisit.deliveries.find(
    (delivery) =>
      delivery.ref.entryId === videoSource.ref.entryId &&
      delivery.ref.unitId === videoSource.ref.unitId,
  );
  const video = addRevisitComment(
    f.db,
    groupInput(f, {
      operationId: 'video-comment',
      batchId: videoDelivery.batchId,
      deliveryId: videoDelivery.id,
      occurrenceId: videoSource.unit.body.content[0].attrs.occurrenceId,
    }),
    commentNow,
  );
  assert.equal(video.commentOn[0].kind, 'media');
  const unit = f.db.messageStore.units.find((item) => item.id === f.media.ref.unitId);
  unit.body.content = [];
  const missing = describeCommentsForEntry(f.db, f.media.ref.entryId).comments.find(
    (item) => item.id === comment.id,
  );
  assert.equal(missing.context.targets[0].available, false);
  assert.deepEqual(missing.commentOn, comment.commentOn);
});

test('a cross-diary group stores one authoritative comment and shows the same ID under every target diary', () => {
  const f = commentLibrary();
  const originals = structuredClone({
    entries: f.db.entries,
    units: f.db.messageStore,
    media: f.db.media,
  });
  const comment = addRevisitComment(f.db, groupInput(f), commentNow);
  for (const entryId of new Set(comment.targets.map((ref) => ref.entryId))) {
    const view = describeCommentsForEntry(f.db, entryId);
    assert.equal(view.comments.length, 1);
    assert.equal(view.comments[0].id, comment.id);
    assert.ok(view.comments[0].context.targets.every((target) => target.entryId === entryId));
  }
  assert.equal(f.db.revisit.comments.length, 1);
  assert.equal(readMessageUnits(f.db).filter((unit) => unit.origin.kind === 'comment').length, 1);
  assert.deepEqual(
    { entries: f.db.entries, units: f.db.messageStore, media: f.db.media },
    originals,
  );
});

test('plain-text body preserves Chinese, emoji, literal Markdown, spacing and mixed newlines; divergent caches fail', () => {
  const f = commentLibrary();
  const text = '  中文🙂 **字面标记**\r\n\r\n第二行\r末行  ';
  const comment = addRevisitComment(f.db, groupInput(f, { text }), commentNow);
  assert.deepEqual(comment.body, commentBody(text));
  assert.equal(comment.text, text);
  assert.equal(comment.body.content.length, 4);
  assert.equal(comment.body.content[0].content[0].text.startsWith('  '), true);
  const bad = structuredClone(comment);
  bad.text = '不相同';
  assert.throws(() => assertCommentContent(bad), { status: 409 });
  for (const text of ['', ' \n\t'])
    assert.throws(
      () => addRevisitComment(f.db, groupInput(f, { operationId: 'empty', text }), commentNow),
      { status: 400 },
    );
});

test('identical retries preserve timestamps and ID; changed text, quote, group, media or sentAt gets 409', () => {
  const f = commentLibrary();
  const input = groupInput(f, {
    batchId: f.media.batchId,
    deliveryId: f.media.id,
    occurrenceId: f.occurrence.occurrenceId,
    sentAt: new Date(commentNow).toISOString(),
  });
  const first = addRevisitComment(f.db, input, commentNow);
  assert.deepEqual(addRevisitComment(f.db, input, commentNow + 1000), first);
  for (const patch of [
    { text: 'changed' },
    { deliveryId: null },
    { batchId: f.group.id },
    { occurrenceId: 'changed' },
    { sentAt: new Date(commentNow + 1000).toISOString() },
  ]) {
    const before = structuredClone(f.db);
    assert.throws(() => addRevisitComment(f.db, { ...input, ...patch }, commentNow + 1000), {
      status: 409,
    });
    assert.deepEqual(f.db, before);
  }
});

test('read and write results are detached from the stored association and comment body', () => {
  const f = commentLibrary();
  const returned = addRevisitComment(f.db, groupInput(f), commentNow);
  returned.targets.length = 0;
  returned.text = '污染';
  returned.body.content.length = 0;
  const entryId = f.group.targets[0].entryId;
  const comments = commentsForEntry(f.db, entryId);
  comments[0].commentOn.length = 0;
  comments[0].replyTo = '污染';
  const described = describeCommentsForEntry(f.db, entryId);
  described.comments[0].context.targets.length = 0;
  assert.ok(!JSON.stringify(f.db.revisit.comments).includes('污染'));
  assert.deepEqual(f.db.revisit.comments[0].targets, f.group.targets);
});

test('withdrawal removes raw text/body once, preserves targets, and rejects late resurrection', () => {
  const f = commentLibrary();
  const original = addRevisitComment(f.db, groupInput(f), commentNow);
  withdrawRevisitComment(f.db, { operationId: original.operationId });
  const withdrawn = structuredClone(f.db.revisit.comments[0]);
  assert.equal(withdrawn.text, '');
  assert.equal(withdrawn.body, null);
  assert.deepEqual(withdrawn.targets, original.targets);
  assert.equal(withdrawn.revision, 2);
  withdrawRevisitComment(f.db, { operationId: original.operationId });
  assert.deepEqual(f.db.revisit.comments[0], withdrawn);
  assert.equal(addRevisitComment(f.db, groupInput(f), commentNow).state, 'withdrawn');
  assert.deepEqual(commentsForEntry(f.db, original.targets[0].entryId), []);
});

test('withdraw-before-send creates one body-free tombstone that survives state archive roundtrip', () => {
  const f = commentLibrary();
  const originalEntries = structuredClone(f.db.entries);
  withdrawRevisitComment(f.db, { operationId: 'late-operation' });
  const target = structuredClone(f.db);
  delete target.revisit;
  restoreRevisitArchive(target, {
    archive: exportRevisitArchive(f.db),
    expectedToken: stateToken(target),
  });
  const reply = addRevisitComment(
    target,
    groupInput(f, { operationId: 'late-operation' }),
    commentNow,
  );
  assert.equal(reply.state, 'withdrawn');
  assert.equal(target.revisit.comments.length, 1);
  assert.ok(!JSON.stringify(target.revisit.comments).includes('合成评论'));
  assert.deepEqual(target.entries, originalEntries);
});

test('frozen planning is read-only and stale create/withdraw plans cannot overwrite new source or comment state', () => {
  const f = commentLibrary();
  const before = structuredClone(f.db);
  const plan = planRevisitComment(freezeTree(structuredClone(f.db)), groupInput(f), commentNow);
  assert.deepEqual(f.db, before);
  withdrawRevisitComment(f.db, { operationId: 'parallel-operation' });
  assert.throws(() => commitCommentPlan(f.db, plan), { status: 409 });
  const withdrawal = planRevisitWithdrawal(f.db, { operationId: 'not-yet-sent' });
  f.db.entries[0].tags.push('新标签');
  assert.throws(() => commitCommentPlan(f.db, withdrawal), { status: 409 });
});

test('old source content changes keep saved targets and mark them unavailable; taxonomy never rebinds', () => {
  const f = commentLibrary();
  const delivery = f.db.revisit.deliveries.find((item) => item.ref.entryId === 'old-html');
  const comment = addRevisitComment(
    f.db,
    groupInput(f, { batchId: delivery.batchId, deliveryId: delivery.id }),
    commentNow,
  );
  const entry = f.db.entries.find((item) => item.id === 'old-html');
  entry.title = '新标题';
  entry.category = '新分类';
  entry.tags = ['新标签'];
  assert.equal(
    describeCommentsForEntry(f.db, entry.id).comments[0].context.targets[0].available,
    true,
  );
  entry.content += '<p>源正文更新</p>';
  const view = describeCommentsForEntry(f.db, entry.id);
  assert.equal(view.comments[0].context.targets[0].available, false);
  assert.deepEqual(view.comments[0].targets, comment.targets);
  assert.throws(
    () =>
      addRevisitComment(
        f.db,
        groupInput(f, {
          operationId: 'changed-source',
          batchId: delivery.batchId,
          deliveryId: delivery.id,
        }),
        commentNow,
      ),
    { status: 409 },
  );
  entry.hidden = true;
  assert.deepEqual(commentsForEntry(f.db, entry.id), []);
});

test('comments containing timestamps never become replay sources before or after restart/restore', () => {
  const f = commentLibrary();
  const before = revisitSources(f.db).sources.map((source) => source.ref);
  addRevisitComment(
    f.db,
    groupInput(f, { text: '[2026/10/17 11:01:00]\n未来也不是日记来源' }),
    commentNow,
  );
  assert.deepEqual(
    revisitSources(f.db).sources.map((source) => source.ref),
    before,
  );
  const restored = structuredClone(f.db);
  assert.deepEqual(
    revisitSources(restored).sources.map((source) => source.ref),
    before,
  );
  tickRevisit(
    restored,
    { manual: true, from: '2027-10-17T00:00:00Z', to: '2027-10-17T23:59:00Z' },
    Date.parse('2027-10-18T00:00:00Z'),
  );
  assert.ok(
    restored.revisit.deliveries.every(
      (delivery) => !delivery.ref.unitId.startsWith('revisit-comment:'),
    ),
  );
});

test('archive validation rejects body/text divergence and rewired replyTo/commentOn even with recomputed checksum', () => {
  const f = commentLibrary();
  addRevisitComment(f.db, groupInput(f), commentNow);
  const archive = exportRevisitArchive(f.db);
  for (const change of [
    (comment) => {
      comment.text = '缓存分歧';
    },
    (comment) => {
      comment.replyTo = f.quote.ref;
    },
    (comment) => {
      comment.commentOn[0].unitId = 'another-unit';
    },
    (comment) => {
      comment.origin.entryId = 'another-entry';
    },
  ]) {
    const bad = structuredClone(archive);
    change(bad.state.comments[0]);
    bad.checksum = hash(JSON.stringify([bad.sourceFingerprint, bad.state]));
    const target = structuredClone(f.db);
    delete target.revisit;
    const before = structuredClone(target);
    assert.throws(
      () => restoreRevisitArchive(target, { archive: bad, expectedToken: stateToken(target) }),
      { status: 400 },
    );
    assert.deepEqual(target, before);
  }
});

test('concurrent create/retry/withdraw share the real library queue and reopen without duplicates', async () => {
  const f = commentLibrary();
  const { dir, store, service } = await storeFor(f.db);
  const other = createRevisitCommentService(createLibraryDeliveryPort(store), {
    clock: () => commentNow,
  });
  const input = groupInput(f);
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, index) => (index % 2 ? service : other).add(input)),
  );
  assert.equal(new Set(results.map((result) => result.id)).size, 1);
  assert.equal(store.getDb().revisit.comments.length, 1);
  await Promise.all([
    other.withdraw({ operationId: input.operationId }),
    ...Array.from({ length: 10 }, () => service.add(input)),
  ]);
  const reopened = await createLibraryStore({ dataDir: dir, seed: false });
  const resumed = createRevisitCommentService(createLibraryDeliveryPort(reopened), {
    clock: () => commentNow,
  });
  assert.equal((await resumed.add(input)).state, 'withdrawn');
  assert.equal(reopened.getDb().revisit.comments.length, 1);
  assert.deepEqual(reopened.getDb().entries, f.db.entries);
});

test('real write failure preserves comments and source bytes; retry creates one comment', async () => {
  const f = commentLibrary();
  const { dir, store, service } = await storeFor(f.db);
  const disk = await fs.readFile(path.join(dir, 'diary.json'));
  const memory = structuredClone(store.getDb());
  const blocker = path.resolve(dir, 'diary.json.tmp');
  assert.equal(path.dirname(blocker), path.resolve(dir));
  await fs.mkdir(blocker);
  await assert.rejects(service.add(groupInput(f)));
  assert.deepEqual(store.getDb(), memory);
  assert.equal(hash(await fs.readFile(path.join(dir, 'diary.json'))), hash(disk));
  await fs.rmdir(blocker);
  const first = await service.add(groupInput(f));
  assert.equal((await service.add(groupInput(f))).id, first.id);
  assert.equal(store.getDb().revisit.comments.length, 1);
});

test('comment modules have no UI, HTTP routing, scheduler or direct file-write dependencies', async () => {
  for (const name of await fs.readdir(
    new URL('../src/server/domain/revisit/comments/', import.meta.url),
  )) {
    const code = await fs.readFile(
      new URL(`../src/server/domain/revisit/comments/${name}`, import.meta.url),
      'utf8',
    );
    assert.ok(!/from ['"][^'"]*(?:node:fs|routes\/|previews\/|desktop\/)/.test(code), name);
    assert.ok(!/\bsetInterval\(|\bsetTimeout\(|\bfetch\(/.test(code), name);
  }
});

test('isolated HTTP context, per-diary annotations, conflict retry, withdrawal and restart retain fixed targets', async (t) => {
  const f = commentLibrary();
  const dir = path.resolve('tmp/revisit-decoupling/stage4/http', randomUUID());
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'diary.json'), JSON.stringify(f.db));
  const initialSource = hash(
    JSON.stringify({ entries: f.db.entries, units: f.db.messageStore, media: f.db.media }),
  );
  let server, base;
  const open = async () => {
    server = await createDiaryServer({ dataDir: dir, seed: false });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  };
  const close = async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  };
  await open();
  t.after(close);
  const request = async (suffix, method = 'POST', input = {}) => {
    const response = await fetch(base + '/api/revisit' + suffix, {
      method,
      headers: { 'X-Diary-Client': 'desktop' },
      ...(method !== 'GET' ? { body: JSON.stringify(input) } : {}),
    });
    return { status: response.status, data: await response.json() };
  };
  const context = await request('/comments/context', 'POST', { batchId: f.group.id });
  assert.equal(context.status, 200);
  assert.deepEqual(context.data.targets, f.group.targets);
  const input = groupInput(f, { operationId: 'http-group-comment' });
  const response = await request('/comments', 'POST', input);
  assert.equal(response.status, 201);
  assert.equal((await request('/comments', 'POST', { ...input, text: '冲突正文' })).status, 409);
  const entryId = f.group.targets[0].entryId;
  const byEntry = await request('/comments?entryId=' + encodeURIComponent(entryId), 'GET');
  assert.equal(byEntry.status, 200);
  assert.equal(byEntry.data.comments[0].id, response.data.id);
  assert.ok(byEntry.data.comments[0].context.targets.every((target) => target.entryId === entryId));
  const source = await request('/source', 'POST', { deliveryId: f.quote.id });
  assert.equal(source.data.comments[0].id, response.data.id);
  await close();
  await open();
  assert.equal((await request('/comments', 'POST', input)).data.id, response.data.id);
  await request('/comments/withdraw', 'POST', { operationId: input.operationId });
  assert.equal((await request('/comments', 'POST', input)).data.state, 'withdrawn');
  const final = JSON.parse(await fs.readFile(path.join(dir, 'diary.json'), 'utf8'));
  assert.equal(
    hash(JSON.stringify({ entries: final.entries, units: final.messageStore, media: final.media })),
    initialSource,
  );
  assert.deepEqual(final.revisit.comments[0].targets, f.group.targets);
  assert.equal(final.revisit.comments[0].body, null);
  await fs.mkdir('outputs/revisit-decoupling/stage4', { recursive: true });
  await fs.writeFile(
    'outputs/revisit-decoupling/stage4/http-isolation.json',
    JSON.stringify(
      {
        isolationDir: dir,
        beforeSourceSHA256: initialSource,
        afterSourceSHA256: hash(
          JSON.stringify({ entries: final.entries, units: final.messageStore, media: final.media }),
        ),
        originalSourcesUnchanged: true,
        fixedTargetsUnchanged: true,
        conflictingRetryStatus: 409,
        withdrawalPreservedAfterRetry: true,
      },
      null,
      2,
    ),
  );
});
