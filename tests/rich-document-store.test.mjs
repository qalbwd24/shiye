import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import {
  openLabStore,
  readLabDraft,
  saveLabDraft,
} from '../public/features/rich-text-lab-store.js';

test('parallel editors use optimistic revisions and cannot silently overwrite each other', async () => {
  globalThis.indexedDB = new IDBFactory();
  const first = await openLabStore();
  const second = await openLabStore();
  const writes = await Promise.allSettled([
    saveLabDraft(first, { body: 'first' }, [], { expectedRevision: 0 }),
    saveLabDraft(second, { body: 'second' }, [], { expectedRevision: 0 }),
  ]);
  assert.equal(writes.filter((r) => r.status === 'fulfilled').length, 1);
  assert.match(writes.find((r) => r.status === 'rejected').reason.message, /另一试验页/);
  const saved = await readLabDraft(first);
  assert.equal(saved.draft.revision, 1);
  const next = await saveLabDraft(second, { body: 'fresh version' }, [], { expectedRevision: 1 });
  assert.equal(next, 2);
  assert.equal((await readLabDraft(first)).draft.body, 'fresh version');
  first.close();
  second.close();
});
test('import body, image originals and recovery snapshot commit atomically or all roll back', async () => {
  globalThis.indexedDB = new IDBFactory();
  const db = await openLabStore();
  await saveLabDraft(db, { body: 'original' }, [
    { id: 'image-before', blob: new Blob(['before']) },
  ]);
  await assert.rejects(
    saveLabDraft(db, { body: 'should not survive' }, [{ invalid: true }], {
      expectedRevision: 1,
      recovery: { body: 'recovery must not survive' },
    }),
  );
  const unchanged = await readLabDraft(db);
  assert.equal(unchanged.draft.body, 'original');
  assert.equal(unchanged.draft.revision, 1);
  assert.equal(unchanged.recovery, null);
  assert.equal(unchanged.assets.length, 1);
  await saveLabDraft(db, { body: 'imported' }, [{ id: 'image-after', blob: new Blob(['after']) }], {
    expectedRevision: 1,
    recovery: { body: 'unsaved original draft' },
  });
  const saved = await readLabDraft(db);
  assert.equal(saved.draft.body, 'imported');
  assert.equal(saved.recovery.body, 'unsaved original draft');
  assert.deepEqual(
    saved.assets.map((a) => a.id),
    ['image-after', 'image-before'],
  );
  db.close();
});
