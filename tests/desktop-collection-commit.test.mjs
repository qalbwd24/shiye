import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { IDBFactory } from 'fake-indexeddb';
import { captureDesktopSource } from '../previews/telegram-chat/shiye-desktop-source-capture.js';
import { createDiaryServer } from '../src/server/app.mjs';
import {
  computerOwnerTransport,
  exportComputerSeed,
  applyComputerSourceCollection,
} from '../src/server/shared-sync/computer-export.mjs';
import {
  sourceMessageFingerprint,
  loadSourceMessageProof,
} from '../src/server/shared-sync/source-message-conflicts.mjs';
import {
  prepareDesktopCollectionCommit,
  commitDesktopCollection,
} from '../src/server/shared-sync/desktop-collection-commit.mjs';
import { readSharedSeed } from '../src/server/shared-sync/seed-package.mjs';
import { evaluateComputerExportCoverage } from '../src/server/shared-sync/computer-coverage.mjs';
import { evaluateCurrentComputerExportCoverage } from '../src/server/shared-sync/computer-coverage.mjs';
import { saveConversationSettings } from '../src/server/conversation-services/settings.mjs';
import {
  createDesktopPreferenceResourceReader,
  createDesktopPreferenceResourceResolver,
} from '../public/shared/desktop-preference-resource.js';
import { readDesktopPreferenceResourceProof } from '../src/server/shared-sync/desktop-preference-resource-proof.mjs';
import { getSourceCollectionCapture } from '../src/server/shared-sync/source-message-conflicts.mjs';
import { verifyWallpaperOriginal } from '../src/server/conversation-services/wallpaper.mjs';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  'base64',
);
async function put(factory, name, store, key, value) {
  await new Promise((resolve, reject) => {
    const r = factory.open(name, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(store);
    r.onerror = () => reject(r.error);
    r.onsuccess = () => {
      const db = r.result,
        t = db.transaction(store, 'readwrite');
      t.objectStore(store).put(value, key);
      t.oncomplete = () => {
        db.close();
        resolve();
      };
      t.onerror = () => reject(t.error);
    };
  });
}
async function fixture(
  t,
  { badSticker = false, programComment = false, bigWallpaper = false, mislabeledJpeg = false } = {},
) {
  const root = path.resolve('tmp/desktop-collection-commit-tests');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'case-')),
    dataDir = path.join(directory, 'data'),
    exportsDir = path.join(directory, 'exports'),
    captureDir = path.join(exportsDir, 'capture');
  await mkdir(dataDir);
  await mkdir(captureDir, { recursive: true });
  const sourceId = randomUUID(),
    messageId = '20000000000000000001',
    entryId = randomUUID(),
    rooms = {},
    assets = [],
    bytes = [];
  const factory = new IDBFactory();
  for (let i = 0; i < 4; i++) {
    const roomId = String(-101 - i),
      assetId = 'wallpaper:room:' + randomUUID(),
      original = Buffer.concat([
        ...(mislabeledJpeg && i === 1
          ? [Buffer.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0])]
          : [png]),
        Buffer.from([i]),
        ...(bigWallpaper && i === 0 ? [Buffer.alloc(900000)] : []),
      ]);
    bytes.push(original);
    rooms[roomId] = {
      id: roomId,
      title: 'fixture ' + i,
      idleHours: 5,
      wallpaperAssetId: assetId,
      isPinned: i === 0,
      isArchived: i === 1,
    };
    assets.push({ id: assetId, blob: new Blob([original], { type: 'image/png' }) });
  }
  if (badSticker)
    assets.push({
      id: 'sticker:' + randomUUID(),
      blob: new Blob([bytes[0]], { type: 'image/png' }),
      name: '',
    });
  await put(factory, 'shiye-journal-link-v1', 'settings', 'link', {
    sourceId,
    rooms: Object.fromEntries(Object.keys(rooms).map((id) => [id, { category: '日常' }])),
  });
  await put(factory, 'shiye-telegram-preview-v1', 'preview', 'library', {
    shiyeRooms: rooms,
    dialogs: {
      active: [{ id: '-101', pinned: true }, { id: '-103' }, { id: '-104' }],
      archived: [{ id: '-102' }],
    },
    messages: {
      '-101': [{ id: messageId, out: true, message: 'source conflict', date: 1760832000 }],
    },
  });
  for (const asset of assets)
    await put(factory, 'shiye-preview-assets-v1', 'assets', asset.id, asset);
  const settings = {
    'shiye-preview-appearance-v1': JSON.stringify({
      fontSize: 18,
      unknown: { kept: true },
      wallpaper: 'data:image/png;base64,' + bytes[0].toString('base64'),
    }),
    'shiye-room-order-v1': '["-104","-101","-102","-103"]',
    'shiye-room-switch-sidebar-v1': '{"previousMode":"manual","effectivePreviousMode":"manual"}',
    'shiye-switch-timing-v2': '1',
  };
  let chunks = [];
  const members = [];
  const summary = await captureDesktopSource({
    indexedDB: factory,
    localStorage: {
      length: Object.keys(settings).length,
      key: (i) => Object.keys(settings)[i],
      getItem: (key) => settings[key] ?? null,
    },
    emit: async (e) => {
      if (e.kind === 'member-start') chunks = [];
      if (e.kind === 'member-chunk') chunks.push(Buffer.from(e.dataBase64, 'base64'));
      if (e.kind === 'member-end') {
        const file = path.join(captureDir, e.path);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, Buffer.concat(chunks));
        members.push({ path: e.path, sha256: e.sha256, size: e.size });
      }
    },
  });
  const manifestBytes = Buffer.from(
    JSON.stringify({
      format: 'shiye-desktop-logical-capture',
      version: 1,
      members,
      summary,
      bytes: members.reduce((n, m) => n + m.size, 0),
    }),
  );
  await writeFile(path.join(captureDir, 'capture-manifest.json'), manifestBytes);
  const message = {
      id: messageId,
      text: 'owner conflict',
      sentAt: '2025-10-19T00:00:00.000Z',
      attachments: [],
    },
    entry = {
      id: entryId,
      title: 'owner',
      content: '<p>owner conflict</p>',
      category: '日常',
      tags: [],
      date: message.sentAt,
      createdAt: message.sentAt,
      updatedAt: message.sentAt,
      revision: 1,
      attachments: [],
      history: [],
      chatJournal: { sourceId, roomId: '-101', messages: [message], status: 'closed' },
    };
  entry.chatJournal.projectionHash = sha(
    Buffer.from(JSON.stringify([entry.title, entry.content, entry.category, entry.attachments])),
  );
  await writeFile(
    path.join(dataDir, 'diary.json'),
    JSON.stringify({
      schema: 1,
      entries: [entry],
      media: [],
      imports: [],
      categories: ['日常'],
      chatJournal: {
        rooms: [{ sourceId, id: '-101', title: 'fixture 0', category: '日常', idleHours: 5 }],
        withdrawals: [],
      },
    }),
  );
  const programConversationId = `desktop:${sourceId}:-998`,
    commentId = randomUUID();
  let programInstanceId;
  if (programComment) {
    const initial = JSON.parse(await readFile(path.join(dataDir, 'diary.json'), 'utf8'));
    initial.chatJournal.rooms.push({
      sourceId,
      id: '-998',
      title: 'synthetic program',
      category: '日常',
      idleHours: 5,
    });
    const binding = saveConversationSettings(initial, {
      conversationId: programConversationId,
      slotId: 'qa',
      providerId: 'external-program',
      expectedBindingRevision: 0,
      expectedConfigRevision: 0,
      config: {
        enabled: true,
        title: 'synthetic',
        kind: 'ai',
        sender: { name: 'synthetic' },
        parameters: {},
      },
    });
    programInstanceId = binding.instanceId;
    initial.conversationServices.instances.find((r) => r.id === binding.instanceId).state.comments =
      [
        {
          id: commentId,
          operationId: commentId,
          createdAt: '2026-10-19T00:00:00.000Z',
          state: 'active',
          text: '中'.repeat(190000),
          body: { format: 'shiye-richdoc', version: 1, content: [] },
          commentOn: [],
          targets: [],
          revision: 1,
        },
      ];
    await writeFile(path.join(dataDir, 'diary.json'), JSON.stringify(initial));
  }
  let server, base;
  async function start() {
    server = await createDiaryServer({
      dataDir,
      seed: false,
      sharedSync: true,
      sourceCollection: { exportsDir },
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() {
    if (server) {
      const s = server;
      server = null;
      s.close();
      await once(s, 'close');
    }
  }
  await start();
  t.after(stop);
  const request = (action, input) => computerOwnerTransport({ baseUrl: base })(action, input),
    db = async () => JSON.parse(await readFile(path.join(dataDir, 'diary.json'), 'utf8'));
  const info = await request('info', {}),
    input = {
      libraryId: info.libraryId,
      epoch: info.epoch,
      operationId: randomUUID(),
      captureRelativePath: 'capture',
      captureManifestSha256: sha(manifestBytes),
    };
  const conflict = {
    operationId: randomUUID(),
    captureRelativePath: 'capture',
    captureManifestSha256: sha(manifestBytes),
    records: [
      { roomId: '-101', messageId, expectedOwnerSha256: sourceMessageFingerprint(message) },
    ],
  };
  async function upload() {
    for (const original of bytes) {
      const operationId = randomUUID(),
        common = { libraryId: info.libraryId, epoch: info.epoch };
      await request('media-begin', {
        ...common,
        operationId,
        metadata: {
          name: 'fixture.png',
          mime: 'image/png',
          size: original.length,
          sha256: sha(original),
        },
      });
      for (let offset = 0; offset < original.length; offset += 256 * 1024) {
        const chunk = original.subarray(offset, offset + 256 * 1024);
        await request('media-chunk', {
          ...common,
          operationId,
          offset,
          bytesBase64: chunk.toString('base64'),
          chunkSha256: sha(chunk),
        });
      }
      await request('media-complete', { ...common, operationId });
    }
  }
  return {
    programConversationId,
    programInstanceId,
    commentId,
    baseUrl: () => base,
    input,
    conflict,
    request,
    db,
    bytes,
    upload,
    dataDir,
    exportsDir,
    captureDir,
    info,
    restart: async () => {
      await stop();
      await start();
    },
  };
}
test('four genuine uploads and conflict receipt enable original-owner atomic directory/preferences/wallpaper CAS; signed package retains every original', async (t) => {
  const f = await fixture(t),
    before = await f.db();
  await assert.rejects(() => f.request('source-collection-apply', f.input), {
    code: 'SOURCE_COLLECTION_MAPPING_INCOMPLETE',
  });
  assert.deepEqual(await f.db(), before);
  await f.upload();
  await f.request('source-conflicts-register', f.conflict);
  const preApply = await f.db();
  const result = await f.request('source-collection-apply', f.input);
  assert.equal(result.registered, true);
  assert.equal(result.receipt.status, 'backend-mapped');
  const mapped = await f.db();
  assert.deepEqual(mapped.entries, preApply.entries);
  assert.equal(mapped.chatJournal.rooms.length, 4);
  assert.ok(mapped.chatJournal.rooms.every((r) => !r.messageOwner || r.messageOwner === 'legacy'));
  assert.equal(mapped.sourceCollections.receipts.length, 1);
  assert.equal(result.receipt.targets.originals.length, 4);
  assert.equal(result.receipt.targets.conflicts.length, 1);
  assert.equal(result.receipt.targets.rooms.length, 4);
  const p = mapped.sharedClientPreferences.profiles.find((p) => p.scope === 'desktop:thoughts');
  assert.equal(p.values['shiye-preview-appearance-v1'].unknown.kept, true);
  assert.ok(p.values['shiye-preview-appearance-v1'].wallpaperAssetId);
  assert.equal(p.values.restoreReceipts.values['shiye-switch-timing-v2'], '1');
  assert.equal(mapped.conversationServices.wallpapers.length, 4);
  await f.restart();
  const replay = await f.request('source-collection-apply', f.input);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.receipt, result.receipt);
  const seed = await exportComputerSeed({
    dataDir: f.dataDir,
    file: path.join(f.exportsDir, 'mapped.syseed'),
    directory: path.join(f.exportsDir, 'seed-work'),
    request: f.request,
    sourceOperationId: f.input.operationId,
  });
  const opened = await readSharedSeed({
    file: seed.file,
    directory: path.join(f.exportsDir, 'seed-read'),
  });
  t.after(() => opened.dispose());
  assert.equal(seed.manifest.assets.length, 4);
  assert.equal(
    opened.prepared.entities.filter((e) => e.entityType === 'source-collection-receipt').length,
    1,
  );
  assert.equal(opened.prepared.entities.filter((e) => e.entityType === 'wallpaper').length, 4);
  assert.equal(
    seed.coverage.snapshotComplete,
    true,
    JSON.stringify(seed.coverage.snapshotBlockers),
  );
  assert.equal(seed.coverage.completeSnapshotAt, seed.manifest.attestation.issuedAt);
  assert.equal(seed.coverage.sourceCaptureGeneration.manifestSha256, f.input.captureManifestSha256);
  assert.equal(seed.coverage.continuousSyncReady, false);
  const owner = await f.db();
  const noReceipt = evaluateComputerExportCoverage({ db: owner, manifest: seed.manifest });
  assert.equal(noReceipt.snapshotComplete, false);
  assert.ok(noReceipt.snapshotBlockers.includes('source-collection-receipt-missing'));
  const changed = structuredClone(owner);
  changed.sharedClientPreferences.profiles[0].values.extra = 'new remote preference';
  const stale = evaluateComputerExportCoverage({
    db: changed,
    manifest: seed.manifest,
    sourceOperationId: f.input.operationId,
  });
  assert.equal(stale.snapshotComplete, false);
  assert.ok(stale.snapshotBlockers.includes('preferences-changed-after-source-collection'));
  const falseFlag = structuredClone(owner);
  delete falseFlag._sharedSeedExports;
  falseFlag.sourceCollections.receipts[0].coverage.computerComplete = true;
  assert.equal(
    evaluateComputerExportCoverage({
      db: falseFlag,
      manifest: seed.manifest,
      sourceOperationId: f.input.operationId,
    }).snapshotComplete,
    false,
  );
});

test('trusted source PNG-declared JPEG correction preserves original asset identity and bytes, records proof and survives replay', async (t) => {
  const f = await fixture(t, { mislabeledJpeg: true });
  await f.upload();
  await f.request('source-conflicts-register', f.conflict);
  const before = await f.db();
  const original = before.media.find((item) => item.sha256 === sha(f.bytes[1]));
  assert.equal(original.type, 'image/png');
  const result = await f.request('source-collection-apply', f.input);
  const after = await f.db(),
    corrected = after.media.find((item) => item.id === original.id);
  assert.equal(corrected.type, 'image/jpeg');
  assert.equal(corrected.sha256, original.sha256);
  assert.equal(corrected.size, original.size);
  assert.equal(after.media.length, before.media.length);
  assert.deepEqual(after.entries, before.entries);
  assert.deepEqual(await readFile(path.join(f.dataDir, 'media', original.id)), f.bytes[1]);
  assert.deepEqual(result.receipt.targets.originalMimeCorrections, [
    {
      assetId: original.id,
      declaredMime: 'image/png',
      verifiedMime: 'image/jpeg',
      sha256: original.sha256,
      size: original.size,
    },
  ]);
  const replay = await f.request('source-collection-apply', f.input);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.receipt, result.receipt);
  assert.equal((await f.db()).media.length, before.media.length);
  const exported = await exportComputerSeed({
    dataDir: f.dataDir,
    file: path.join(f.exportsDir, 'mime-proof.syseed'),
    directory: path.join(f.exportsDir, 'mime-proof-work'),
    request: f.request,
    sourceOperationId: f.input.operationId,
  });
  assert.equal(
    exported.manifest.assets.find((item) => item.assetId === original.id).mime,
    'image/jpeg',
  );
  assert.equal(
    exported.manifest.assets.find((item) => item.assetId === original.id).sha256,
    original.sha256,
  );
  const opened = await readSharedSeed({
    file: exported.file,
    directory: path.join(f.exportsDir, 'mime-open'),
  });
  t.after(() => opened.dispose());
  assert.equal(
    opened.prepared.entities.find(
      (row) => row.entityType === 'media' && row.entityId === original.id,
    ).data.type,
    'image/jpeg',
  );
  assert.equal(exported.coverage.snapshotComplete, true);
});

test('source MIME proof rejects invalid magic or incorrect full SHA without normalizing metadata or writing a receipt', async (t) => {
  const f = await fixture(t, { mislabeledJpeg: true });
  await f.upload();
  await f.request('source-conflicts-register', f.conflict);
  const before = await f.db(),
    media = before.media.find((item) => item.sha256 === sha(f.bytes[1]));
  const file = path.join(f.dataDir, 'media', media.id);
  for (const bytes of [
    Buffer.alloc(media.size),
    Buffer.concat([f.bytes[1].subarray(0, -1), Buffer.from([255])]),
  ]) {
    await writeFile(file, bytes);
    await assert.rejects(f.request('source-collection-apply', f.input));
    assert.deepEqual(await f.db(), before);
  }
});

test('source MIME correction does not authorize unrelated media and leaves global strict image validation unchanged', async (t) => {
  const f = await fixture(t, { mislabeledJpeg: true });
  await f.upload();
  await f.request('source-conflicts-register', f.conflict);
  const db = await f.db(),
    bytes = Buffer.concat([f.bytes[1], Buffer.from('unrelated')]);
  const unrelated = {
    id: randomUUID(),
    type: 'image/png',
    sha256: sha(bytes),
    size: bytes.length,
    name: 'unrelated.png',
  };
  db.media.push(unrelated);
  await writeFile(path.join(f.dataDir, 'media', unrelated.id), bytes);
  const room = db.chatJournal.rooms[0];
  await assert.rejects(
    verifyWallpaperOriginal(
      db,
      {
        conversationId: `desktop:${room.sourceId}:${room.id}`,
        scope: 'shared',
        sharedAssetId: unrelated.id,
      },
      f.dataDir,
    ),
    { code: 'WALLPAPER_IMAGE_REQUIRED' },
  );
  const proof = await loadSourceMessageProof({
    exportsDir: f.exportsDir,
    relativePath: 'capture',
    manifestSha256: f.input.captureManifestSha256,
  });
  const token = await prepareDesktopCollectionCommit({ db, dataDir: f.dataDir, proof, ...f.input });
  commitDesktopCollection(db, token);
  assert.equal(unrelated.type, 'image/png');
  assert.ok(
    db.sourceCollections.receipts[0].targets.originalMimeCorrections.every(
      (row) => row.assetId !== unrelated.id,
    ),
  );
});

test('source MIME preflight rejects later metadata and file changes before any type normalization', async (t) => {
  const f = await fixture(t, { mislabeledJpeg: true });
  await f.upload();
  await f.request('source-conflicts-register', f.conflict);
  const db = await f.db(),
    media = db.media.find((item) => item.sha256 === sha(f.bytes[1]));
  const proof = await loadSourceMessageProof({
    exportsDir: f.exportsDir,
    relativePath: 'capture',
    manifestSha256: f.input.captureManifestSha256,
  });
  const token = await prepareDesktopCollectionCommit({ db, dataDir: f.dataDir, proof, ...f.input });
  const metadataChanged = structuredClone(db);
  metadataChanged.media.find((item) => item.id === media.id).name = 'concurrent metadata';
  assert.throws(() => commitDesktopCollection(metadataChanged, token), {
    code: 'SOURCE_COLLECTION_TARGET_CHANGED',
  });
  assert.equal(metadataChanged.media.find((item) => item.id === media.id).type, 'image/png');
  const fileChanged = structuredClone(db);
  await writeFile(path.join(f.dataDir, 'media', media.id), f.bytes[1]);
  assert.throws(() => commitDesktopCollection(fileChanged, token), {
    code: 'SOURCE_COLLECTION_ORIGINAL_CHANGED',
  });
  assert.deepEqual(fileChanged, db);
});

test('later source transaction failure rolls back MIME normalization with all directory/preferences/receipt writes', async (t) => {
  const f = await fixture(t, { mislabeledJpeg: true, badSticker: true });
  await f.upload();
  await f.request('source-conflicts-register', f.conflict);
  const before = await readFile(path.join(f.dataDir, 'diary.json'), 'utf8');
  await assert.rejects(f.request('source-collection-apply', f.input));
  assert.equal(await readFile(path.join(f.dataDir, 'diary.json'), 'utf8'), before);
  const after = await f.db();
  assert.equal(after.media.find((item) => item.sha256 === sha(f.bytes[1])).type, 'image/png');
  assert.equal(after.sourceCollections, undefined);
});

test('known-resource preference reader uses capture raw SHA and real owner receipt plus full original proof without changing local wallpaper', async (t) => {
  const f = await fixture(t, { bigWallpaper: true });
  const sourceProof = await loadSourceMessageProof({
    exportsDir: f.exportsDir,
    relativePath: 'capture',
    manifestSha256: f.input.captureManifestSha256,
  });
  const capture = getSourceCollectionCapture(sourceProof),
    key = 'shiye-preview-appearance-v1',
    raw = capture.preferences.values[key];
  assert.ok(Buffer.byteLength(raw) > 256 * 1024);
  let currentRaw = raw,
    latestProof;
  const resolveResource = createDesktopPreferenceResourceResolver({
    owner: f.info,
    source: {
      operationId: f.input.operationId,
      captureRelativePath: 'capture',
      captureManifestSha256: f.input.captureManifestSha256,
    },
    request: async (action, input) => {
      latestProof = await f.request(action, input);
      return latestProof;
    },
  });
  const reader = createDesktopPreferenceResourceReader({
    storage: { getItem: (k) => (k === key ? currentRaw : null) },
    keys: [{ key, json: true }],
    resolveResource,
  });
  await assert.rejects(reader, { code: 'SOURCE_RESOURCE_RECEIPT_REQUIRED' });
  await f.upload();
  await f.request('source-conflicts-register', f.conflict);
  await f.request('source-collection-apply', f.input);
  const owner = await f.db();
  const before = structuredClone(owner.sourceCollections),
    result = await reader();
  assert.equal(result[key].wallpaper, undefined);
  assert.equal(result[key].unknown.kept, true);
  assert.ok(result[key].wallpaperAssetId);
  assert.equal(latestProof.captureRawSha256, sha(Buffer.from(raw)));
  assert.notEqual(latestProof.sourceMemberSha256, latestProof.captureRawSha256);
  assert.ok(JSON.stringify(latestProof).length < 2048);
  assert.ok(!JSON.stringify(latestProof).includes('base64'));
  currentRaw = JSON.stringify({
    ...JSON.parse(raw),
    showSendButton: false,
    future: { nested: false },
  });
  const changed = await reader();
  assert.equal(changed[key].showSendButton, false);
  assert.equal(changed[key].future.nested, false);
  assert.equal(latestProof.captureRawSha256, sha(Buffer.from(raw)));
  assert.equal(latestProof.rawSha256, sha(Buffer.from(currentRaw)));
  assert.notEqual(latestProof.rawSha256, latestProof.captureRawSha256);
  const currentOwner = await f.db();
  await assert.rejects(
    readDesktopPreferenceResourceProof({
      getDb: () => structuredClone(currentOwner),
      dataDir: f.dataDir,
      proof: sourceProof,
      operationId: f.input.operationId,
      request: Object.fromEntries(
        ['key', 'sourceField', 'rawSha256', 'rawBytes', 'sha256', 'size', 'mime'].map((name) => [
          name,
          latestProof[name],
        ]),
      ),
    }),
    { code: 'SOURCE_RESOURCE_BUSY' },
  );
  assert.equal(capture.preferences.values[key], raw);
  const corrupted = path.join(f.dataDir, 'media', result[key].wallpaperAssetId);
  await writeFile(
    corrupted,
    Buffer.alloc(owner.media.find((r) => r.id === result[key].wallpaperAssetId).size),
  );
  await assert.rejects(reader);
  assert.deepEqual((await f.db()).sourceCollections, before);
});

test('resource proof is local-admin read-only and rejects a changed authoritative wallpaper pointer', async (t) => {
  const f = await fixture(t, { bigWallpaper: true });
  await f.upload();
  await f.request('source-conflicts-register', f.conflict);
  await f.request('source-collection-apply', f.input);
  const proof = await loadSourceMessageProof({
    exportsDir: f.exportsDir,
    relativePath: 'capture',
    manifestSha256: f.input.captureManifestSha256,
  });
  const key = 'shiye-preview-appearance-v1',
    raw = getSourceCollectionCapture(proof).preferences.values[key];
  let metadata;
  const reader = createDesktopPreferenceResourceReader({
    storage: { getItem: (name) => (name === key ? raw : null) },
    keys: [{ key, json: true }],
    resolveResource: async (request) => {
      metadata = request;
      return f.request('source-preference-resource-proof', {
        operationId: f.input.operationId,
        captureRelativePath: 'capture',
        captureManifestSha256: f.input.captureManifestSha256,
        request,
      });
    },
  });
  const before = await f.db(),
    initial = await reader();
  assert.deepEqual(await f.db(), before);
  const input = {
    operationId: f.input.operationId,
    captureRelativePath: 'capture',
    captureManifestSha256: f.input.captureManifestSha256,
    request: metadata,
  };
  for (const extra of [
    { Authorization: 'Bearer synthetic' },
    { 'X-Sync-Device-Id': randomUUID() },
    { Origin: 'https://invalid.example' },
  ]) {
    const response = await fetch(f.baseUrl() + '/api/source-collection/preference-resource-proof', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Diary-Client': 'desktop', ...extra },
      body: JSON.stringify(input),
    });
    assert.equal(response.status, 403);
  }
  await assert.rejects(
    f.request('source-preference-resource-proof', {
      ...input,
      request: { ...metadata, verified: true },
    }),
  );
  assert.deepEqual(await f.db(), before);
  const profile = before.sharedClientPreferences.profiles.find(
    (row) => row.scope === 'desktop:thoughts',
  );
  const other = before.media.find((row) => row.id !== initial[key].wallpaperAssetId);
  await f.request('command', {
    ...f.info,
    operationId: randomUUID(),
    action: 'client-preferences-save',
    input: {
      scope: 'desktop:thoughts',
      expectedRevision: profile.revision,
      set: { [key]: { ...profile.values[key], wallpaperAssetId: other.id } },
      remove: [],
    },
  });
  const changed = await f.db();
  await assert.rejects(reader, { code: 'SOURCE_RESOURCE_BINDING_CHANGED' });
  assert.deepEqual(await f.db(), changed);
  assert.equal(getSourceCollectionCapture(proof).preferences.values[key], raw);
});

test('current owner feed proof rejects same-seq legacy comment edit/withdraw, stale db and intervening COW', async (t) => {
  const f = await fixture(t, { programComment: true });
  const [, sourceId, roomId] = f.programConversationId.split(':');
  const posted = await fetch(f.baseUrl() + '/api/chat-journal/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Diary-Client': 'desktop' },
    body: JSON.stringify({
      sourceId,
      roomId,
      messages: [
        { id: '7', sentAt: '2026-10-19T00:00:00.000Z', text: 'synthetic context', attachments: [] },
      ],
    }),
  });
  assert.equal(posted.status, 200);
  await f.upload();
  await f.request('source-conflicts-register', f.conflict);
  await f.request('source-collection-apply', f.input);
  const seed = await exportComputerSeed({
    dataDir: f.dataDir,
    file: path.join(f.exportsDir, 'comment.syseed'),
    directory: path.join(f.exportsDir, 'comment-work'),
    request: f.request,
    sourceOperationId: f.input.operationId,
  });
  assert.equal(seed.coverage.snapshotComplete, true);
  const baseline = await f.db();
  assert.equal(
    evaluateComputerExportCoverage({
      db: baseline,
      manifest: seed.manifest,
      sourceOperationId: f.input.operationId,
    }).snapshotComplete,
    false,
    'detached old db cannot prove actual owner current',
  );
  const edited = structuredClone(baseline);
  edited.conversationServices.instances.find(
    (r) => r.id === f.programInstanceId,
  ).state.comments[0].text += 'synthetic edit';
  const editedCoverage = await evaluateCurrentComputerExportCoverage({
    getDb: () => edited,
    manifest: seed.manifest,
    sourceOperationId: f.input.operationId,
  });
  assert.ok(editedCoverage.snapshotBlockers.includes('current-feed-generation-not-packaged'));
  let reads = 0;
  await assert.rejects(
    () =>
      evaluateCurrentComputerExportCoverage({
        getDb: () => (++reads === 1 ? baseline : structuredClone(baseline)),
        manifest: seed.manifest,
        sourceOperationId: f.input.operationId,
      }),
    { code: 'SOURCE_COVERAGE_BUSY' },
  );
  const response = await fetch(f.baseUrl() + '/api/conversation-services/conversations/withdraw', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Diary-Client': 'desktop' },
    body: JSON.stringify({
      conversationId: f.programConversationId,
      kind: 'comment',
      instanceId: f.programInstanceId,
      operationId: f.commentId,
    }),
  });
  assert.equal(response.status, 200);
  assert.equal((await f.request('info')).seq, baseline._sharedSync.seq);
  const replay = await f.request('seed-register', {
    libraryId: seed.manifest.libraryId,
    epoch: seed.manifest.epoch,
    manifest: seed.manifest,
    manifestSha256: sourceMessageFingerprint(seed.manifest),
  });
  assert.equal(replay.replayed, true, 'old legal registration remains a legal historical receipt');
  const current = await f.request('source-collection-coverage', {
    manifest: seed.manifest,
    sourceOperationId: f.input.operationId,
  });
  assert.equal(current.snapshotComplete, false);
  assert.ok(current.snapshotBlockers.includes('current-feed-generation-not-packaged'));
  assert.deepEqual((await f.db()).sourceCollections, baseline.sourceCollections);
  assert.deepEqual(
    (await f.db()).conversationServices.instances[0].config,
    baseline.conversationServices.instances[0].config,
  );
});
test('genuine prepare brand checks full original bytes and scoped owner CAS; downstream failure cannot leave a receipt', async (t) => {
  const f = await fixture(t);
  await f.upload();
  await f.request('source-conflicts-register', f.conflict);
  const db = await f.db();
  const proof = await loadSourceMessageProof({
    exportsDir: f.exportsDir,
    relativePath: 'capture',
    manifestSha256: f.input.captureManifestSha256,
  });
  const token = await prepareDesktopCollectionCommit({ db, dataDir: f.dataDir, proof, ...f.input });
  const changed = structuredClone(db);
  changed.chatJournal.rooms[0].idleHours = 7;
  assert.throws(() => commitDesktopCollection(changed, token), {
    code: 'SOURCE_COLLECTION_TARGET_CHANGED',
  });
  assert.equal(changed.sourceCollections, undefined);
  const corrupt = path.join(f.dataDir, 'media', db.media[0].id);
  await writeFile(corrupt, Buffer.alloc(db.media[0].size));
  await assert.rejects(() => f.request('source-collection-apply', f.input));
  assert.equal((await f.db()).sourceCollections, undefined);
});

test('late original sticker validation failure rolls back earlier profiles/order/preferences/wallpapers and source receipt in the real queue', async (t) => {
  const f = await fixture(t, { badSticker: true });
  await f.upload();
  await f.request('source-conflicts-register', f.conflict);
  const before = await readFile(path.join(f.dataDir, 'diary.json'), 'utf8');
  await assert.rejects(() => f.request('source-collection-apply', f.input));
  assert.equal(await readFile(path.join(f.dataDir, 'diary.json'), 'utf8'), before);
  assert.equal((await f.db()).sourceCollections, undefined);
});

test('streaming collector uploads four missing SHA once and reuses durable collection op after a lost final ACK', async (t) => {
  const f = await fixture(t);
  await f.request('source-conflicts-register', f.conflict);
  const requestFile = path.join(f.exportsDir, 'collection-request.json');
  let lose = true;
  const options = {
    dataDir: f.dataDir,
    captureDir: f.captureDir,
    exportsDir: f.exportsDir,
    requestFile,
    request: async (action, input) => {
      const result = await f.request(action, input);
      if (action === 'source-collection-apply' && lose) {
        lose = false;
        throw Error('synthetic final ACK lost');
      }
      return result;
    },
  };
  await assert.rejects(() => applyComputerSourceCollection(options), /synthetic final ACK lost/);
  const job = await readFile(requestFile, 'utf8'),
    first = await f.db();
  assert.equal(first.media.length, 4);
  assert.equal(first.sourceCollections.receipts.length, 1);
  const replay = await applyComputerSourceCollection(options);
  assert.equal(replay.replayed, true);
  assert.equal(await readFile(requestFile, 'utf8'), job);
  const after = await f.db();
  assert.equal(after.media.length, 4);
  assert.equal(after._sharedMedia.length, 4);
  assert.equal(after.sourceCollections.receipts.length, 1);
});
