import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  appendChatMessages,
  saveChatRoom,
  withdrawChatMessage,
} from '../src/server/domain/chat-journal.mjs';
import { chatUnitId } from '../src/server/domain/message-store.mjs';
import { reconcileImport } from '../src/server/domain/import-reconciliation.mjs';
import { reconcileMessageArchive } from '../src/server/domain/message-store-archive.mjs';

const sourceId = '11111111-1111-4111-8111-111111111111';
const start = Date.parse('2026-10-10T00:00:00Z');
const iso = (offset = 0) => new Date(start + offset).toISOString();
const msg = (id, extra = {}) => ({
  id: String(id),
  sentAt: iso(),
  text: `body ${id}`,
  attachments: [],
  ...extra,
});
function fixture() {
  const db = { entries: [], media: [], categories: ['日常'] };
  for (const id of ['-10', '-20'])
    saveChatRoom(db, { sourceId, id, title: 'test', category: '日常', idleHours: 5 });
  return db;
}
const append = (db, messages, options = {}, roomId = '-10') =>
  appendChatMessages(db, { sourceId, roomId, messages }, start + 100000, options);
const withdraw = (db, id) =>
  withdrawChatMessage(
    db,
    {
      sourceId,
      roomId: '-10',
      messageId: String(id),
      sentAt: iso(),
      expectedRevision: db.messageStore?.units.find(
        (u) => u.id === chatUnitId(sourceId, '-10', String(id)),
      )?.revision,
    },
    start + 10000,
  );
const replace = (id, target, extra = {}) => msg(id, { replacementOf: String(target), ...extra });

test('replacement stays after tombstone among same-second neighbours; canonical body and deadlines remain correct', () => {
  const db = fixture();
  append(db, [msg(1), msg(2), msg(3, { sentAt: iso(1000) })]);
  const entry = db.entries[0];
  const times = [
    entry.chatJournal.firstAt,
    entry.chatJournal.lastAt,
    entry.chatJournal.deadline,
    entry.chatJournal.status,
  ];
  withdraw(db, 1);
  append(db, [replace(4, 1)]);
  assert.deepEqual(
    entry.chatJournal.messages.map((m) => m.id),
    ['1', '4', '2', '3'],
  );
  assert.deepEqual(
    [
      entry.chatJournal.firstAt,
      entry.chatJournal.lastAt,
      entry.chatJournal.deadline,
      entry.chatJournal.status,
    ],
    times,
  );
  assert.equal(entry.chatJournal.messages[0].text, '');
  assert.equal(
    db.messageStore.units.find((u) => u.id === chatUnitId(sourceId, '-10', '1')).body,
    null,
  );
  assert.equal(
    db.messageStore.units.find((u) => u.id === chatUnitId(sourceId, '-10', '4')).eventTime.instant,
    iso(),
  );
  assert.ok(entry.content.indexOf('消息已撤回') < entry.content.indexOf('body 4'));
});

test('lost receipt retry is inert, changed body and competing successor conflict; repeated editing forms a chain', () => {
  const db = fixture();
  append(db, [msg(1)]);
  withdraw(db, 1);
  append(db, [replace(2, 1)]);
  const saved = structuredClone(db);
  append(db, [replace(2, 1)]);
  assert.deepEqual(db, saved);
  assert.throws(() => append(db, [replace(2, 1, { text: 'changed' })]), /内容不同/);
  assert.throws(() => append(db, [replace(3, 1)]), /已有替代/);
  withdraw(db, 2);
  append(db, [replace(3, 2)]);
  assert.deepEqual(
    db.entries[0].chatJournal.messages.map((m) => [m.id, !!m.withdrawn]),
    [
      ['1', true],
      ['2', true],
      ['3', false],
    ],
  );
});

test('withdraw before first archive creates separate closed historical entry without moving current deadline', () => {
  const db = fixture();
  append(db, [msg(9, { sentAt: iso(3600000) })]);
  const latest = structuredClone(db.entries[0]);
  withdraw(db, 1);
  append(db, [replace(10, 1)]);
  assert.equal(db.entries.length, 2);
  assert.deepEqual(
    db.entries.find((e) => e.id === latest.id),
    latest,
  );
  const historical = db.entries.find((e) => e.id !== latest.id);
  assert.equal(historical.chatJournal.status, 'closed');
  assert.deepEqual(
    historical.chatJournal.messages.map((m) => m.id),
    ['1', '10'],
  );
  assert.equal(historical.chatJournal.messages[0].text, '');
  const saved = structuredClone(db);
  append(db, [replace(10, 1)]);
  assert.deepEqual(db, saved);
});

test('replacement preserves attachments and reply while withdrawn original retains neither body nor media', () => {
  const db = fixture();
  db.media.push({
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    type: 'image/png',
    name: 'test.png',
  });
  const attachments = [db.media[0].id];
  append(db, [msg(1, { attachments }), msg(2)]);
  withdraw(db, 1);
  append(db, [replace(3, 1, { attachments, replyTo: '2' })]);
  const entry = db.entries[0];
  assert.deepEqual(entry.chatJournal.messages[0].attachments, []);
  const unit = db.messageStore.units.find((u) => u.origin.messageId === '3');
  assert.deepEqual(unit.attachments, attachments);
  assert.equal(unit.replyTo, chatUnitId(sourceId, '-10', '2'));
});

test('wrong scope, time, target identity and active target are rejected without mutation', () => {
  const db = fixture();
  append(db, [msg(1), msg(2)]);
  withdraw(db, 1);
  const saved = structuredClone(db);
  assert.throws(() => append(db, [replace(3, 1)], {}, '-20'), /未撤回/);
  assert.throws(() => append(db, [replace(3, 1, { sentAt: iso(1) })]), /原消息时间/);
  assert.throws(() => append(db, [replace(3, 2)]), /未撤回/);
  assert.throws(() => append(db, [replace(3, 3)]), /标识/);
  assert.throws(() => append(db, [replace(3, '../1')]), /标识/);
  assert.deepEqual(db, saved);
});

test('manual edits and deleted old entries cannot be overwritten even with a later current entry', () => {
  for (const change of [
    (e) => {
      e.content += 'manual';
    },
    (e) => {
      e.deleted = true;
    },
  ]) {
    const db = fixture();
    append(db, [msg(1)]);
    const old = db.entries[0];
    withdraw(db, 1);
    append(db, [msg(9, { sentAt: iso(36000000) })]);
    change(old);
    const saved = structuredClone(db);
    assert.throws(() => append(db, [replace(10, 1)]), /删除或修改/);
    assert.deepEqual(db, saved);
  }
});

test('legacy self and explicit self are compatible but other actors cannot replace their messages', () => {
  const db = fixture();
  append(db, [msg(1)]);
  withdraw(db, 1);
  assert.throws(
    () => append(db, [replace(2, 1)], { actor: { id: 'bot', kind: 'program' } }),
    /作者/,
  );
  append(db, [replace(2, 1)], { actor: { id: 'self', kind: 'self', name: 'renamed' } });
  assert.equal(db.entries[0].chatJournal.messages[1].actor.kind, 'self');
});

test('archive reconciliation preserves replacement chain, old timestamp and canonical tombstone', () => {
  const db = fixture();
  append(db, [msg(1), msg(2)]);
  withdraw(db, 1);
  append(db, [replace(3, 1)]);
  const restored = fixture();
  restored.imports = [];
  const mapping = reconcileImport(restored, structuredClone(db));
  reconcileMessageArchive(restored, structuredClone(db), mapping);
  assert.deepEqual(
    restored.entries[0].chatJournal.messages.map((m) => m.id),
    ['1', '3', '2'],
  );
  assert.equal(restored.entries[0].chatJournal.messages[1].replacementOf, '1');
  assert.equal(restored.entries[0].chatJournal.messages[1].sentAt, iso());
  assert.equal(restored.messageStore.units.find((u) => u.origin.messageId === '1').body, null);
  assert.ok(restored.messageStore.units.find((u) => u.origin.messageId === '3').body);
});

test('archived root with unarchived withdrawn predecessor stays in original entry', () => {
  const db = fixture();
  append(db, [msg(1), msg(9, { sentAt: iso(1000) })]);
  const entry = db.entries[0],
    deadline = entry.chatJournal.deadline;
  withdraw(db, 1);
  withdraw(db, 2);
  const replacement = replace(3, 2, { replacementRootId: '1' });
  append(db, [replacement]);
  assert.equal(db.entries.length, 1);
  assert.deepEqual(
    entry.chatJournal.messages.map((m) => m.id),
    ['1', '2', '3', '9'],
  );
  assert.equal(entry.chatJournal.messages[1].replacementOf, '1');
  assert.equal(entry.chatJournal.messages[1].text, '');
  assert.equal(entry.chatJournal.deadline, deadline);
  const saved = structuredClone(db);
  append(db, [replacement]);
  assert.deepEqual(db, saved);
  withdraw(db, 3);
  append(db, [replace(4, 3, { replacementRootId: '1' })]);
  assert.deepEqual(
    entry.chatJournal.messages.map((m) => m.id),
    ['1', '2', '3', '4', '9'],
  );
});

test('root hints cannot splice an unrelated chain, change time, or bypass deleted/manual entries', () => {
  for (const mode of ['other-room', 'time', 'successor', 'manual', 'deleted', 'unrelated-chain']) {
    const db = fixture();
    append(db, [msg(1), msg(8)]);
    withdraw(db, 1);
    withdraw(db, 2);
    if (mode === 'other-room') {
      append(db, [msg(7)], {}, '-20');
      withdrawChatMessage(
        db,
        { sourceId, roomId: '-20', messageId: '7', sentAt: iso() },
        start + 1,
      );
    }
    if (mode === 'successor') append(db, [replace(5, 1)]);
    if (mode === 'manual') db.entries[0].content += 'manual';
    if (mode === 'deleted') db.entries[0].deleted = true;
    if (mode === 'unrelated-chain') {
      withdraw(db, 8);
      append(db, [replace(6, 8)]);
      withdraw(db, 6);
    }
    const saved = structuredClone(db);
    assert.throws(() =>
      append(db, [
        replace(10, mode === 'unrelated-chain' ? 6 : 2, {
          replacementRootId: mode === 'other-room' ? '7' : '1',
          ...(mode === 'time' ? { sentAt: iso(1) } : {}),
        }),
      ]),
    );
    assert.deepEqual(db, saved);
  }
});

test('fully unarchived edit chain accepts root hint and can be edited again after archiving', () => {
  const db = fixture();
  withdraw(db, 1);
  withdraw(db, 2);
  append(db, [replace(3, 2, { replacementRootId: '1' })]);
  assert.deepEqual(
    db.entries[0].chatJournal.messages.map((m) => m.id),
    ['2', '3'],
  );
  withdraw(db, 3);
  append(db, [replace(4, 3, { replacementRootId: '1' })]);
  assert.equal(db.entries.length, 1);
  assert.deepEqual(
    db.entries[0].chatJournal.messages.map((m) => m.id),
    ['2', '3', '4'],
  );
  assert.throws(() => append(db, [msg(5, { replacementRootId: '1' })]), /根标识/);
});

test('missing predecessor extends the withdrawn known chain tip instead of rejecting an old root child', () => {
  const db = fixture();
  append(db, [msg(1), msg(9, { sentAt: iso(1000) })]);
  withdraw(db, 1);
  append(db, [replace(2, 1, { replacementRootId: '1' })]);
  withdraw(db, 2);
  withdraw(db, 3);
  append(db, [replace(4, 3, { replacementRootId: '1' })]);
  assert.equal(db.entries.length, 1);
  assert.deepEqual(
    db.entries[0].chatJournal.messages.map((m) => m.id),
    ['1', '2', '3', '4', '9'],
  );
  assert.equal(db.entries[0].chatJournal.messages[2].replacementOf, '2');
  const saved = structuredClone(db);
  append(db, [replace(4, 3, { replacementRootId: '1' })]);
  assert.deepEqual(db, saved);
});
