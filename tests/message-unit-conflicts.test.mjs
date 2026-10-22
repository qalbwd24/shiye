import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRoutes } from '../src/server/routes/conflicts.mjs';
import { commitDiaryUnits } from '../src/server/domain/message-store.mjs';
import { commitCommentUnit } from '../src/server/domain/message-comments.mjs';
import { appendChatMessages, saveChatRoom } from '../src/server/domain/chat-journal.mjs';
import { reassembleDiaryUnits } from '../public/shared/message-units.js';
import { richMediaReferences } from '../public/shared/rich-document.js';
import { renderRichDocument } from '../public/shared/rich-document-renderer.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createLibraryStore } from '../src/server/storage/library-store.mjs';
import { createDiaryServer } from '../src/server/app.mjs';

const enabled = { messageUnitsEnabled: true };
const instant = '2026-10-10T01:00:00.000Z';
const media = (id, type = 'image/png') => ({ id, name: `${id}.png`, type });

function harness(initial) {
  let db = structuredClone(initial);
  const route = createRoutes({
    mutate: async (fn) => {
      const copy = structuredClone(db);
      const result = fn(copy);
      db = copy;
      return result;
    },
    body: async (req) => JSON.stringify(req.data),
    reply: () => {},
    fail: (status, message) => Object.assign(Error(message), { status }),
  });
  return {
    get db() {
      return db;
    },
    call: (data) => route({ method: 'PUT', data }, {}, '/api/conflicts/abc'),
  };
}

function canonicalFixture(type = 'image') {
  const mime = type === 'image' ? 'image/png' : 'video/mp4';
  const db = {
    entries: [],
    media: [media('left', mime), media('right', mime)],
    categories: ['日常'],
    conflicts: [{ id: 'abc', kind: 'media', left: 'left', right: 'right', status: 'open' }],
  };
  const body = {
    format: 'shiye-richdoc',
    version: 1,
    content: [
      {
        type: 'paragraph',
        attrs: { blockId: 'paragraph' },
        content: [{ type: 'text', text: '2026-10-10 09:00:00\n合成长文' }],
      },
      {
        type,
        attrs: {
          assetId: 'right',
          blockId: 'media-block',
          occurrenceId: 'occurrence-stable',
          insertedAt: instant,
          widthRatio: 0.75,
          align: 'center',
          caption: '合成说明',
          alt: '',
        },
      },
    ],
  };
  const entry = {
    id: randomUUID(),
    title: '合成',
    category: '日常',
    tags: [],
    body,
    content: renderRichDocument(body),
    contentFormat: 'richdoc',
    date: instant,
    updatedAt: instant,
    revision: 1,
    attachments: ['right'],
    history: [],
  };
  db.entries.push(entry);
  commitDiaryUnits(db, entry, null, enabled);
  return { db, entry };
}

for (const type of ['image', 'video']) {
  test(`media conflict and undo keep canonical ${type} identity, clocks and exact layout`, async () => {
    const { db, entry } = canonicalFixture(type);
    const originalIds = [...entry.messageUnits.ids];
    const originalTimes = db.messageStore.units.map((unit) => unit.eventTime);
    const f = harness(db);
    await f.call({ choice: 'left', targets: [{ id: entry.id, revision: 1 }] });
    const replaced = f.db.entries[0];
    assert.deepEqual(replaced.attachments, ['left']);
    assert.deepEqual(replaced.messageUnits.ids, originalIds);
    assert.deepEqual(
      f.db.messageStore.units.map((unit) => unit.eventTime),
      originalTimes,
    );
    assert.deepEqual(
      reassembleDiaryUnits(f.db.messageStore.units, f.db.messageStore.layouts[entry.id].layout),
      replaced.body,
    );
    assert.equal(richMediaReferences(replaced.body)[0].assetId, 'left');
    assert.equal(richMediaReferences(replaced.body)[0].occurrenceId, 'occurrence-stable');
    assert.equal(richMediaReferences(replaced.body)[0].insertedAt, instant);
    assert.equal(replaced.content, renderRichDocument(replaced.body));
    await f.call({ choice: 'undo', targets: [{ id: entry.id, revision: 2 }] });
    const restored = f.db.entries[0];
    assert.deepEqual(restored.body, entry.body);
    assert.deepEqual(restored.messageUnits.ids, originalIds);
    assert.equal(f.db.conflicts[0].status, 'open');
    const before = structuredClone(restored);
    restored.title = '再改名称';
    commitDiaryUnits(f.db, restored, before);
    assert.deepEqual(
      reassembleDiaryUnits(f.db.messageStore.units, f.db.messageStore.layouts[entry.id].layout),
      restored.body,
    );
  });
}

test('media conflict remaps comment units while their targets and occurrence identities survive undo', async () => {
  const { db, entry } = canonicalFixture();
  const mediaUnit = db.messageStore.units.find((unit) => richMediaReferences(unit.body).length);
  const comment = {
    id: randomUUID(),
    body: '合成评论',
    attachments: ['right'],
    createdAt: instant,
    updatedAt: instant,
    revision: 1,
    commentOn: [
      { kind: 'media', entryId: entry.id, unitId: mediaUnit.id, occurrenceId: 'occurrence-stable' },
    ],
  };
  entry.comments = [comment];
  const unit = commitCommentUnit(db, entry, comment, enabled);
  const originalOccurrence = richMediaReferences(unit.body)[0];
  const f = harness(db);
  await f.call({ choice: 'left', targets: [{ id: entry.id, revision: 1 }] });
  let changed = f.db.messageStore.units.find((item) => item.id === unit.id);
  assert.equal(richMediaReferences(changed.body)[0].assetId, 'left');
  assert.equal(richMediaReferences(changed.body)[0].occurrenceId, originalOccurrence.occurrenceId);
  assert.deepEqual(changed.commentOn, unit.commentOn);
  assert.equal(changed.revision, 2);
  await f.call({ choice: 'undo', targets: [{ id: entry.id, revision: 2 }] });
  changed = f.db.messageStore.units.find((item) => item.id === unit.id);
  assert.equal(richMediaReferences(changed.body)[0].assetId, 'right');
  assert.equal(richMediaReferences(changed.body)[0].occurrenceId, originalOccurrence.occurrenceId);
  assert.deepEqual(changed.commentOn, unit.commentOn);
  assert.equal(changed.revision, 3);
});

test('canonical conflict failure rolls back already processed target and conflict record', async () => {
  const { db, entry } = canonicalFixture();
  const broken = structuredClone(entry);
  broken.id = randomUUID();
  broken.body.content[0].attrs.blockId = 'another-block';
  broken.messageUnits = undefined;
  db.entries.push(broken);
  commitDiaryUnits(db, broken, null, enabled);
  broken.content = '<p>被篡改的投影缓存</p>';
  const f = harness(db),
    before = structuredClone(f.db);
  await assert.rejects(
    f.call({
      choice: 'left',
      targets: [
        { id: entry.id, revision: 1 },
        { id: broken.id, revision: 1 },
      ],
    }),
    { status: 409 },
  );
  assert.deepEqual(f.db, before);
});

test('chat media conflict and historic undo are rejected without mutating message originals', async () => {
  const db = {
    entries: [],
    media: [media('left'), media('right')],
    categories: ['日常'],
    conflicts: [{ id: 'abc', kind: 'media', left: 'left', right: 'right', status: 'open' }],
  };
  const sourceId = randomUUID();
  saveChatRoom(db, { sourceId, id: '-1', title: '合成会话', category: '日常', idleHours: 5 });
  appendChatMessages(
    db,
    {
      sourceId,
      roomId: '-1',
      messages: [{ id: '1', text: '合成聊天', sentAt: instant, attachments: ['right'] }],
    },
    undefined,
    enabled,
  );
  const entry = db.entries[0],
    f = harness(db),
    before = structuredClone(f.db);
  await assert.rejects(
    f.call({ choice: 'left', targets: [{ id: entry.id, revision: entry.revision }] }),
    { status: 409 },
  );
  assert.deepEqual(f.db, before);
  const current = f.db.entries[0];
  current.history = [{ ...structuredClone(current), revision: current.revision - 1 }];
  Object.assign(f.db.conflicts[0], {
    status: 'resolved',
    actions: [
      {
        targets: [
          { id: current.id, beforeRevision: current.revision - 1, afterRevision: current.revision },
        ],
      },
    ],
  });
  const beforeUndo = structuredClone(f.db);
  await assert.rejects(
    f.call({ choice: 'undo', targets: [{ id: current.id, revision: current.revision }] }),
    { status: 409 },
  );
  assert.deepEqual(f.db, beforeUndo);
});

test('entry conflict title and delete are metadata changes that preserve the source edit clock', async () => {
  const { db, entry } = canonicalFixture();
  delete entry.contentEditedAt;
  const right = {
    ...structuredClone(entry),
    id: randomUUID(),
    title: '另一合成篇',
    messageUnits: undefined,
  };
  db.entries.push(right);
  db.conflicts[0] = { id: 'abc', kind: 'entry', left: entry.id, right: right.id, status: 'open' };
  const f = harness(db),
    stored = structuredClone(db.messageStore);
  await f.call({ choice: 'left', title: '元数据改名', leftRevision: 1, rightRevision: 1 });
  assert.equal(f.db.entries[1].contentEditedAt, instant);
  assert.equal(f.db.entries[1].deleted, true);
  assert.deepEqual(f.db.messageStore, stored);
});

test('renaming an intact chat projection preserves the next append path and edit fallback', async () => {
  const db = { entries: [], media: [], categories: ['日常'] },
    sourceId = randomUUID();
  saveChatRoom(db, { sourceId, id: '-1', title: '合成会话', category: '日常', idleHours: 5 });
  const input = (id) => ({
    sourceId,
    roomId: '-1',
    messages: [{ id, text: '合成聊天', sentAt: instant, attachments: [] }],
  });
  appendChatMessages(db, input('1'), undefined, enabled);
  const chat = db.entries[0],
    left = { ...structuredClone(chat), id: randomUUID(), chatJournal: undefined };
  delete chat.contentEditedAt;
  db.entries.push(left);
  db.conflicts = [{ id: 'abc', kind: 'entry', left: left.id, right: chat.id, status: 'open' }];
  const f = harness(db),
    oldClock = chat.updatedAt;
  await f.call({
    choice: 'both',
    title: '聊天篇改名',
    leftRevision: left.revision,
    rightRevision: chat.revision,
  });
  assert.equal(f.db.entries[0].contentEditedAt, oldClock);
  assert.doesNotThrow(() => appendChatMessages(f.db, input('2'), undefined, enabled));
});

test('real isolated HTTP conflict, reopen and undo persist matching canonical owners', async (t) => {
  const dataDir = path.resolve('tmp/message-unification/conflicts', randomUUID());
  const initial = canonicalFixture();
  const store = await createLibraryStore({ dataDir, seed: false });
  await store.mutate((db) => Object.assign(db, initial.db));
  for (const asset of initial.db.media)
    await fs.writeFile(path.join(dataDir, 'media', asset.id), 'synthetic-media-' + asset.id);
  let server;
  const stop = async () => {
    if (!server?.listening) return;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  };
  t.after(stop);
  const start = async () => {
    server = await createDiaryServer({ dataDir, seed: false, messageUnits: true });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${server.address().port}`;
  };
  let base = await start();
  const choose = async (choice, revision) => {
    const response = await fetch(base + '/api/conflicts/abc', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Diary-Client': 'desktop' },
      body: JSON.stringify({ choice, targets: [{ id: initial.entry.id, revision }] }),
    });
    assert.equal(response.status, 200, JSON.stringify(await response.json()));
  };
  await choose('left', 1);
  const replaced = await (await fetch(base + '/api/library')).json();
  const unitIds = replaced.entries[0].messageUnits.ids;
  await stop();
  base = await start();
  const reopened = await (await fetch(base + '/api/library')).json();
  assert.deepEqual(reopened.messageStore, replaced.messageStore);
  assert.equal(richMediaReferences(reopened.entries[0].body)[0].assetId, 'left');
  await choose('undo', 2);
  const restored = await (await fetch(base + '/api/library')).json();
  assert.deepEqual(restored.entries[0].body, initial.entry.body);
  assert.deepEqual(restored.entries[0].messageUnits.ids, unitIds);
  assert.deepEqual(
    reassembleDiaryUnits(
      restored.messageStore.units,
      restored.messageStore.layouts[initial.entry.id].layout,
    ),
    initial.entry.body,
  );
});
