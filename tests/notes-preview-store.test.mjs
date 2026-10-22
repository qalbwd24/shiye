import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import {
  NOTES_PREVIEW_DB,
  openNotesPreviewStore,
  readNotesPreview,
  saveNotesPreview,
} from '../public/features/notes-preview-store.js';

test('notes preview stores workspace and image bytes together without diary APIs', async () => {
  const previous = globalThis.indexedDB;
  globalThis.indexedDB = new IDBFactory();
  let db;
  try {
    assert.equal(NOTES_PREVIEW_DB, 'shiye-notes-ui-preview-v1');
    db = await openNotesPreviewStore();
    const empty = await readNotesPreview(db);
    assert.equal(empty.workspace, null);
    assert.deepEqual(empty.assets, []);
    const workspace = {
      notes: [{ id: 'first', title: '本周待办', body: { type: 'doc', content: [] } }],
      openIds: ['first'],
      activeId: 'first',
    };
    const blob = new Blob(['synthetic-image'], { type: 'image/png' });
    assert.equal(await saveNotesPreview(db, 'main', workspace, [{ id: 'image-one', blob }], 0), 1);
    const saved = await readNotesPreview(db);
    assert.deepEqual(saved.workspace, { ...workspace, revision: 1 });
    assert.equal(saved.assets.length, 1);
    assert.equal(saved.assets[0].id, 'image-one');
    assert.equal(saved.assets[0].blob.type, 'image/png');
    assert.equal(await saved.assets[0].blob.text(), 'synthetic-image');
  } finally {
    db?.close();
    globalThis.indexedDB = previous;
  }
});

test('stale preview revision and failed image cloning preserve last committed workspace', async () => {
  const previous = globalThis.indexedDB;
  globalThis.indexedDB = new IDBFactory();
  let db;
  try {
    db = await openNotesPreviewStore();
    const first = { notes: [{ id: 'first', title: '已保存版本' }] };
    assert.equal(await saveNotesPreview(db, 'main', first, [], 0), 1);
    await assert.rejects(saveNotesPreview(db, 'main', { notes: [] }, [], 0));
    assert.deepEqual((await readNotesPreview(db)).workspace, { ...first, revision: 1 });
    await assert.rejects(
      saveNotesPreview(
        db,
        'main',
        { notes: [{ id: 'first', title: '不应部分提交' }] },
        [{ id: 'cannot-clone', blob: () => {} }],
        1,
      ),
    );
    const after = await readNotesPreview(db);
    assert.deepEqual(after.workspace, { ...first, revision: 1 });
    assert.deepEqual(after.assets, []);
    assert.equal(
      await saveNotesPreview(db, 'main', { notes: [{ id: 'first', title: '下一版' }] }, [], 1),
      2,
    );
  } finally {
    db?.close();
    globalThis.indexedDB = previous;
  }
});

test('two preview windows cannot silently overwrite the same revision', async () => {
  const previous = globalThis.indexedDB;
  globalThis.indexedDB = new IDBFactory();
  let first;
  let second;
  try {
    first = await openNotesPreviewStore();
    second = await openNotesPreviewStore();
    const candidates = [
      { notes: [{ id: 'first', title: '窗口甲' }] },
      { notes: [{ id: 'first', title: '窗口乙' }] },
    ];
    const attempts = await Promise.allSettled([
      saveNotesPreview(first, 'main', candidates[0], [], 0),
      saveNotesPreview(second, 'main', candidates[1], [], 0),
    ]);
    assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(attempts.filter((result) => result.status === 'rejected').length, 1);
    const winner = attempts.findIndex((result) => result.status === 'fulfilled');
    assert.deepEqual((await readNotesPreview(first)).workspace, {
      ...candidates[winner],
      revision: 1,
    });
    assert.deepEqual((await readNotesPreview(second)).workspace, {
      ...candidates[winner],
      revision: 1,
    });
  } finally {
    first?.close();
    second?.close();
    globalThis.indexedDB = previous;
  }
});
