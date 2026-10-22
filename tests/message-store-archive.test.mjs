import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createDiaryServer } from '../src/server/app.mjs';
import { createBackup, restoreBackup } from '../public/shared/vault2.js';
import { reassembleDiaryUnits } from '../public/shared/message-units.js';
import { renderRichDocument } from '../public/shared/rich-document-renderer.js';

async function fixture(t) {
  const dataDir = path.resolve('tmp/message-unification/backend/archive', randomUUID());
  const server = await createDiaryServer({ dataDir, seed: false, messageUnits: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const nativeFetch = globalThis.fetch;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const request = (url, { method = 'GET', data, raw, headers = {} } = {}) =>
    nativeFetch(base + url, {
      method,
      headers: {
        'X-Diary-Client': 'desktop',
        ...(data ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: raw ?? (data ? JSON.stringify(data) : undefined),
    });
  const api = async (url, options) => {
    const response = await request(url, options);
    const value = await response.json();
    if (!response.ok) throw Object.assign(Error(value.error), { status: response.status });
    return value;
  };
  return { base, dataDir, request, api };
}

async function populate(source) {
  const asset = await source.api('/api/media', {
    method: 'POST',
    raw: Buffer.from('GIF89a-synthetic-archive-media'),
    headers: { 'Content-Type': 'image/gif', 'X-File-Name': encodeURIComponent('合成.gif') },
  });
  const body = {
    format: 'shiye-richdoc',
    version: 1,
    content: [
      {
        type: 'paragraph',
        attrs: { blockId: 'text-block' },
        content: [{ type: 'text', text: '合成长文' }],
      },
      {
        type: 'image',
        attrs: {
          blockId: 'image-block',
          occurrenceId: 'archive-occurrence',
          assetId: asset.id,
          insertedAt: '2026-10-10T00:01:00.000Z',
          widthRatio: 0.75,
          align: 'center',
          caption: '合成图注',
          alt: '合成',
        },
      },
    ],
  };
  const entry = await source.api('/api/entries', {
    method: 'POST',
    data: {
      title: '合成长文备份',
      date: '2026-10-10T00:00:00.000Z',
      contentFormat: 'richdoc',
      body,
      category: '日常',
      tags: ['合成'],
      attachments: [asset.id],
    },
  });
  let db = await source.api('/api/library');
  const mediaUnit = db.messageStore.units.find(
    (unit) =>
      unit.origin.entryId === entry.id && unit.body.content.some((node) => node.type === 'image'),
  );
  const commented = await source.api(`/api/entries/${entry.id}/comments`, {
    method: 'POST',
    data: {
      body: '合成评论',
      entryRevision: entry.revision,
      attachments: [asset.id],
      commentOn: [
        {
          kind: 'media',
          entryId: entry.id,
          unitId: mediaUnit.id,
          occurrenceId: 'archive-occurrence',
        },
      ],
    },
  });
  await source.api(`/api/entries/${entry.id}/comments`, {
    method: 'POST',
    data: {
      body: '合成回复',
      entryRevision: commented.revision,
      replyTo: commented.comments[0].id,
    },
  });
  const sourceId = randomUUID();
  await source.api('/api/chat-journal/rooms', {
    method: 'PUT',
    data: { sourceId, id: '-1', title: '合成聊天', category: '日常', idleHours: 5 },
  });
  await source.api('/api/chat-journal/messages', {
    method: 'POST',
    data: {
      sourceId,
      roomId: '-1',
      messages: [
        {
          id: '1',
          text: '**合成待撤回**',
          sentAt: '2026-10-10T02:00:00.000Z',
          attachments: [asset.id],
        },
        {
          id: '2',
          text: '合成引用',
          sentAt: '2026-10-10T02:01:00.000Z',
          attachments: [],
          replyTo: '1',
        },
      ],
    },
  });
  db = await source.api('/api/library');
  return { db, asset, sourceId, entry };
}

function verifyCanonical(db) {
  assert.ok(db.messageStore.units.length >= 6);
  const ids = new Set(db.messageStore.units.map((unit) => unit.id));
  for (const unit of db.messageStore.units) {
    assert.ok(db.entries.some((entry) => entry.id === unit.origin.entryId));
    if (unit.origin.kind === 'comment')
      for (const target of unit.commentOn) {
        assert.equal(target.entryId, unit.origin.entryId);
        if (target.unitId) assert.ok(ids.has(target.unitId));
      }
    if (unit.replyTo) assert.ok(ids.has(unit.replyTo));
    const visit = (node) => {
      if (node.attrs?.assetId) assert.ok(db.media.some((media) => media.id === node.attrs.assetId));
      (node.content || []).forEach(visit);
    };
    unit.body?.content.forEach(visit);
  }
  for (const [entryId, saved] of Object.entries(db.messageStore.layouts)) {
    const entry = db.entries.find((item) => item.id === entryId);
    assert.ok(entry);
    assert.deepEqual(
      reassembleDiaryUnits(
        db.messageStore.units.filter(
          (unit) => unit.origin.kind === 'diary' && unit.origin.entryId === entryId,
        ),
        saved.layout,
      ),
      entry.body,
    );
    assert.equal(renderRichDocument(entry.body), entry.content);
    assert.ok(entry.messageUnits.ids.every((id) => ids.has(id)));
  }
}

test('bundle and actual syvault2 restore canonical messages, media, comments, conflicts and withdrawal precedence', async (t) => {
  const source = await fixture(t),
    bundleTarget = await fixture(t),
    vaultTarget = await fixture(t);
  const { db: original, asset, sourceId } = await populate(source);
  const bundle = await source.api('/api/bundle');
  assert.deepEqual((await source.api('/api/export')).messageStore, original.messageStore);
  assert.deepEqual(
    (await source.api('/api/backup-manifest')).library.messageStore,
    original.messageStore,
  );
  const imported = await bundleTarget.api('/api/restore', { method: 'POST', data: bundle });
  assert.equal(imported.entries, 2);
  let restored = await bundleTarget.api('/api/library');
  verifyCanonical(restored);
  assert.deepEqual(
    new Set(restored.messageStore.units.map((unit) => unit.id)),
    new Set(original.messageStore.units.map((unit) => unit.id)),
  );
  assert.notEqual(
    restored.entries.find((entry) => !entry.chatJournal).id,
    original.entries.find((entry) => !entry.chatJournal).id,
  );
  assert.notEqual(restored.media[0].id, asset.id);
  const afterFirst = structuredClone(restored);
  const duplicate = await bundleTarget.api('/api/restore', { method: 'POST', data: bundle });
  assert.equal(duplicate.entries, 0);
  assert.equal(duplicate.mergedMedia, 1);
  restored = await bundleTarget.api('/api/library');
  assert.equal(restored.entries.length, afterFirst.entries.length);
  assert.equal(restored.media.length, 1);
  verifyCanonical(restored);

  const conflict = structuredClone(bundle);
  const changed = conflict.library.messageStore.units.find(
    (unit) => unit.origin.kind === 'diary' && JSON.stringify(unit.body).includes('合成长文'),
  );
  const changeText = (node) => {
    if (node.type === 'text') node.text = '全局编号冲突';
    (node.content || []).forEach(changeText);
  };
  changed.body.content.forEach(changeText);
  const changedEntry = conflict.library.entries.find(
    (entry) => entry.id === changed.origin.entryId,
  );
  changedEntry.body = reassembleDiaryUnits(
    conflict.library.messageStore.units.filter(
      (unit) => unit.origin.kind === 'diary' && unit.origin.entryId === changedEntry.id,
    ),
    conflict.library.messageStore.layouts[changedEntry.id].layout,
  );
  changedEntry.content = renderRichDocument(changedEntry.body);
  const snapshot = await bundleTarget.api('/api/library');
  const beforeFiles = await fs.readdir(path.join(bundleTarget.dataDir, 'media'));
  const rejected = await bundleTarget.request('/api/restore', { method: 'POST', data: conflict });
  assert.equal(rejected.status, 409);
  assert.deepEqual(await bundleTarget.api('/api/library'), snapshot);
  assert.deepEqual(await fs.readdir(path.join(bundleTarget.dataDir, 'media')), beforeFiles);

  let commentEntry = (await bundleTarget.api('/api/library')).entries.find(
    (entry) => !entry.chatJournal,
  );
  const commentId = commentEntry.comments[0].id;
  await bundleTarget.api(`/api/entries/${commentEntry.id}/comments/${commentId}`, {
    method: 'PUT',
    data: {
      deleted: true,
      revision: commentEntry.comments[0].revision,
      entryRevision: commentEntry.revision,
    },
  });
  await bundleTarget.api('/api/restore', { method: 'POST', data: bundle });
  commentEntry = (await bundleTarget.api('/api/library')).entries.find(
    (entry) => !entry.chatJournal,
  );
  assert.equal(commentEntry.comments[0].deleted, true);
  assert.equal(commentEntry.comments[0].body, '合成评论');
  const recoveredComment = await bundleTarget.api(
    `/api/entries/${commentEntry.id}/comments/${commentId}`,
    {
      method: 'PUT',
      data: {
        deleted: false,
        revision: commentEntry.comments[0].revision,
        entryRevision: commentEntry.revision,
      },
    },
  );
  assert.equal(recoveredComment.comments[0].body, '合成评论');
  assert.equal(recoveredComment.comments[0].deleted, false);

  const native = globalThis.fetch;
  let currentBase = source.base;
  globalThis.fetch = (url, options) => native(new URL(url, currentBase), options);
  t.after(() => {
    globalThis.fetch = native;
  });
  const password = 'synthetic-message-archive-pass';
  const saved = await createBackup(source.api, password, () => {});
  const encrypted = new Blob([await fs.readFile(saved.path)]);
  currentBase = vaultTarget.base;
  await restoreBackup(vaultTarget.api, encrypted, password, () => {});
  verifyCanonical(await vaultTarget.api('/api/library'));
  const again = await restoreBackup(vaultTarget.api, encrypted, password, () => {});
  assert.equal(again.entries, 0);
  assert.equal(again.mergedMedia, 1);

  await source.api('/api/chat-journal/withdraw', {
    method: 'POST',
    data: { sourceId, roomId: '-1', messageId: '1', expectedRevision: 1 },
  });
  const withTombstone = await source.api('/api/bundle');
  await vaultTarget.api('/api/restore', { method: 'POST', data: withTombstone });
  assert.ok(!JSON.stringify(await vaultTarget.api('/api/library')).includes('合成待撤回'));
  currentBase = vaultTarget.base;
  await restoreBackup(vaultTarget.api, encrypted, password, () => {});
  assert.ok(!JSON.stringify(await vaultTarget.api('/api/library')).includes('合成待撤回'));

  const sourceEntry = (await source.api('/api/library')).entries.find(
    (entry) => !entry.chatJournal,
  );
  sourceEntry.body.content[0].content[0].text = '真实加密冲突正文';
  await source.api(`/api/entries/${sourceEntry.id}`, { method: 'PUT', data: sourceEntry });
  currentBase = source.base;
  const conflictingVault = await createBackup(source.api, password, () => {});
  currentBase = vaultTarget.base;
  const vaultBefore = await vaultTarget.api('/api/library');
  const vaultFilesBefore = await fs.readdir(path.join(vaultTarget.dataDir, 'media'));
  const conflictingBlob = new Blob([await fs.readFile(conflictingVault.path)]);
  await assert.rejects(
    () => restoreBackup(vaultTarget.api, conflictingBlob, password, () => {}),
    /全局编号内容冲突/,
  );
  assert.deepEqual(await vaultTarget.api('/api/library'), vaultBefore);
  assert.deepEqual(await fs.readdir(path.join(vaultTarget.dataDir, 'media')), vaultFilesBefore);

  await bundleTarget.api('/api/chat-journal/withdraw', {
    method: 'POST',
    data: { sourceId, roomId: '-1', messageId: '1', expectedRevision: 1 },
  });
  await bundleTarget.api('/api/restore', { method: 'POST', data: bundle });
  restored = await bundleTarget.api('/api/library');
  const withdrawn = restored.messageStore.units.find(
    (unit) => unit.origin.kind === 'chat' && unit.origin.messageId === '1',
  );
  assert.equal(withdrawn.state, 'withdrawn');
  assert.equal(withdrawn.body, null);
  assert.ok(!JSON.stringify(restored).includes('合成待撤回'));
  assert.equal(restored.entries.length, 2);
  const preCanonical = structuredClone(bundle);
  delete preCanonical.library.messageStore;
  for (const entry of preCanonical.library.entries) {
    delete entry.messageUnits;
    delete entry.comments;
  }
  await bundleTarget.api('/api/restore', { method: 'POST', data: preCanonical });
  assert.ok(!JSON.stringify(await bundleTarget.api('/api/library')).includes('合成待撤回'));
});

test('body-free unarchived withdrawals survive restore and prevent old canonical and legacy backups from reviving text', async (t) => {
  const source = await fixture(t),
    target = await fixture(t),
    empty = await fixture(t);
  const { sourceId } = await populate(source);
  const active = await source.api('/api/bundle');
  const registryOnly = await empty.api('/api/bundle');
  const record = {
    sourceId,
    roomId: '-1',
    messageId: '1',
    operationId: randomUUID(),
    sentAt: '2026-10-10T02:00:00.000Z',
    requestedAt: '2026-10-10T02:02:00.000Z',
    text: '不允许保留的撤回原文',
  };
  registryOnly.library.chatJournal = {
    version: 1,
    rooms: active.library.chatJournal.rooms,
    withdrawals: [record, record],
  };
  await target.api('/api/restore', { method: 'POST', data: registryOnly });
  let db = await target.api('/api/library');
  assert.equal(db.entries.length, 0);
  assert.equal(db.chatJournal.withdrawals.length, 1);
  assert.equal(db.chatJournal.withdrawals[0].text, undefined);
  const encryptedTarget = await fixture(t);
  const nativeFetch = globalThis.fetch;
  let currentBase = target.base;
  globalThis.fetch = (url, options) => nativeFetch(new URL(url, currentBase), options);
  try {
    const password = 'synthetic-withdrawal-registry-only';
    const saved = await createBackup(target.api, password, () => {});
    currentBase = encryptedTarget.base;
    await restoreBackup(
      encryptedTarget.api,
      new Blob([await fs.readFile(saved.path)]),
      password,
      () => {},
    );
  } finally {
    globalThis.fetch = nativeFetch;
  }
  const encryptedDb = await encryptedTarget.api('/api/library');
  assert.equal(encryptedDb.entries.length, 0);
  assert.deepEqual(encryptedDb.chatJournal.withdrawals, db.chatJournal.withdrawals);
  await target.api('/api/restore', { method: 'POST', data: active });
  db = await target.api('/api/library');
  assert.ok(!JSON.stringify(db).includes('合成待撤回'));
  assert.equal(
    db.messageStore.units.find((unit) => unit.origin.messageId === '1').state,
    'withdrawn',
  );
  assert.equal(db.chatJournal.withdrawals.length, 1);

  const legacy = structuredClone(active);
  delete legacy.library.messageStore;
  for (const entry of legacy.library.entries) {
    delete entry.messageUnits;
    delete entry.comments;
  }
  const legacyTarget = await fixture(t);
  await legacyTarget.api('/api/restore', { method: 'POST', data: registryOnly });
  await legacyTarget.api('/api/restore', { method: 'POST', data: legacy });
  assert.ok(!JSON.stringify(await legacyTarget.api('/api/library')).includes('合成待撤回'));
  const count = (await legacyTarget.api('/api/library')).entries.length;
  await legacyTarget.api('/api/restore', { method: 'POST', data: legacy });
  assert.equal((await legacyTarget.api('/api/library')).entries.length, count);

  const invalid = structuredClone(registryOnly);
  invalid.library.chatJournal.withdrawals[0].messageId = 'not-an-id';
  const before = await target.api('/api/library');
  assert.equal(
    (await target.request('/api/restore', { method: 'POST', data: invalid })).status,
    400,
  );
  assert.deepEqual(await target.api('/api/library'), before);
  const conflictRegistry = structuredClone(registryOnly);
  conflictRegistry.library.chatJournal.withdrawals = [{ ...record, messageId: '2' }];
  assert.equal(
    (await target.request('/api/restore', { method: 'POST', data: conflictRegistry })).status,
    409,
  );
  assert.deepEqual(await target.api('/api/library'), before);
  const internalConflict = structuredClone(registryOnly);
  internalConflict.library.chatJournal.withdrawals = [record, { ...record, messageId: '2' }];
  const fresh = await fixture(t);
  const freshBefore = await fresh.api('/api/library');
  assert.equal(
    (await fresh.request('/api/restore', { method: 'POST', data: internalConflict })).status,
    409,
  );
  assert.deepEqual(await fresh.api('/api/library'), freshBefore);
});
