import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import {
  captureNotesAssets,
  createNotesAssetPersistence,
} from '../public/features/notes-asset-persistence.js';
import {
  openNotesPreviewStore,
  readNotesPreview,
  saveNotesPreview,
} from '../public/features/notes-preview-store.js';

const image = (name = 'one.png') => ({
  id: 'image-one',
  name,
  blob: new Blob(['synthetic-image'], { type: 'image/png' }),
});
const workspace = {
  notes: [{ id: 'note', title: '合成便签' }],
  background: { assetId: 'image-one' },
};

async function fixture(run) {
  const previous = globalThis.indexedDB;
  globalThis.indexedDB = new IDBFactory();
  const db = await openNotesPreviewStore();
  const tracker = createNotesAssetPersistence();
  let revision = 0;
  const writes = [];
  const save = (assets, snapshot = workspace) =>
    tracker.save(assets, async (pending) => {
      writes.push(pending);
      revision = await saveNotesPreview(db, 'main', snapshot, pending, revision);
      return revision;
    });
  try {
    await run({ db, tracker, save, writes });
  } finally {
    db.close();
    globalThis.indexedDB = previous;
  }
}

test('queued duplicate snapshots and repeated unchanged saves submit an asset only once', async () => {
  await fixture(async ({ db, save, writes }) => {
    const asset = image();
    const firstCapture = [asset];
    const secondCapture = [asset];
    let queue = Promise.resolve();
    const first = (queue = queue.then(() => save(firstCapture)));
    const second = (queue = queue.then(() => save(secondCapture)));
    await Promise.all([first, second]);
    await save([asset]);
    assert.deepEqual(
      writes.map((items) => items.length),
      [1, 0, 0],
    );
    const stored = await readNotesPreview(db);
    assert.equal(stored.workspace.revision, 3);
    assert.equal(await stored.assets[0].blob.text(), 'synthetic-image');
  });
});

test('transaction abort after asset put leaves it dirty for an atomic retry', async () => {
  await fixture(async ({ db, save, writes }) => {
    const asset = image();
    const transaction = db.transaction.bind(db);
    let aborted = false;
    db.transaction = (...args) => {
      const tx = transaction(...args);
      if (args[1] === 'readwrite' && !aborted) {
        const objectStore = tx.objectStore.bind(tx);
        tx.objectStore = (name) => {
          const store = objectStore(name);
          if (name === 'assets') {
            const put = store.put.bind(store);
            store.put = (...values) => {
              const request = put(...values);
              request.addEventListener('success', () => {
                aborted = true;
                tx.abort();
              });
              return request;
            };
          }
          return store;
        };
      }
      return tx;
    };
    await assert.rejects(save([asset]));
    assert.equal(aborted, true);
    assert.deepEqual(await readNotesPreview(db), { workspace: null, assets: [] });
    await save([asset]);
    assert.deepEqual(
      writes.map((items) => items.length),
      [1, 1],
    );
    assert.equal((await readNotesPreview(db)).assets.length, 1);
  });
});

test('old in-flight success cannot mark a new same-id object clean', async () => {
  await fixture(async ({ db, tracker, save, writes }) => {
    const first = image();
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    const inFlight = tracker.save([first], async (pending) => {
      await gate;
      return saveNotesPreview(db, 'seed', workspace, pending, 0);
    });
    const replacement = { ...first, name: 'new-name.png', blob: new Blob(['new-bytes']) };
    release();
    await inFlight;
    await save([replacement]);
    assert.equal(writes[0][0], replacement);
    const stored = (await readNotesPreview(db)).assets[0];
    assert.equal(stored.name, 'new-name.png');
    assert.equal(await stored.blob.text(), 'new-bytes');
  });
});

test('same-id metadata replacement is saved even when the Blob identity is unchanged', async () => {
  await fixture(async ({ db, save, writes }) => {
    const first = image();
    await save([first]);
    const replacement = { ...first, name: 'metadata-only.png' };
    await save([replacement]);
    assert.deepEqual(
      writes.map((items) => items.length),
      [1, 1],
    );
    assert.equal((await readNotesPreview(db)).assets[0].name, replacement.name);
  });
});

test('read-back baseline skips original objects and still writes new replacements', async () => {
  await fixture(async ({ db, save, writes }) => {
    await save([image()]);
    const read = await readNotesPreview(db);
    const reopened = createNotesAssetPersistence();
    reopened.markPersisted(read.assets);
    let pending;
    await reopened.save(read.assets, async (items) => {
      pending = items;
      return saveNotesPreview(db, 'main', workspace, items, 1);
    });
    assert.deepEqual(pending, []);
    assert.equal(await (await readNotesPreview(db)).assets[0].blob.text(), 'synthetic-image');
    const replacement = { ...read.assets[0], name: 'after-read.png' };
    await reopened.save([replacement], async (items) => {
      assert.deepEqual(items, [replacement]);
      return saveNotesPreview(db, 'main', workspace, items, 2);
    });
    assert.equal((await readNotesPreview(db)).assets[0].name, replacement.name);
    assert.equal(writes.length, 1);
  });
});

test('revision conflict does not mark new assets committed', async () => {
  await fixture(async ({ db, tracker }) => {
    await saveNotesPreview(db, 'main', workspace, [], 0);
    const asset = image();
    await assert.rejects(
      tracker.save([asset], (items) => saveNotesPreview(db, 'main', workspace, items, 0)),
    );
    await tracker.save([asset], (items) => {
      assert.deepEqual(items, [asset]);
      return saveNotesPreview(db, 'main', workspace, items, 1);
    });
    assert.equal((await readNotesPreview(db)).assets.length, 1);
  });
});

test('capturing references rejects missing originals even if an older asset was committed', () => {
  const asset = image();
  const tracker = createNotesAssetPersistence();
  tracker.markPersisted([asset]);
  assert.throws(() => captureNotesAssets(workspace, new Map()), /图片原件缺失/);
  assert.deepEqual(captureNotesAssets(workspace, new Map([[asset.id, asset]])), [asset]);
});
