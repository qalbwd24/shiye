import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash, createPublicKey, verify } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createDiaryServer } from '../src/server/app.mjs';
import { configureRevisit, tickRevisit } from '../src/server/domain/revisit.mjs';
import {
  exportComputerSeed,
  computerOwnerTransport,
} from '../src/server/shared-sync/computer-export.mjs';
import { readSharedSeed, exportSharedSeed } from '../src/server/shared-sync/seed-package.mjs';
import {
  sharedSeedEntityBytes,
  validateSharedSeedManifest,
  validateSharedSeedFeedPart,
} from '../public/shared/shared-seed.js';
import { sharedSeedAttestationBytes } from '../public/shared/shared-seed-trust.js';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function fixture(t) {
  const root = path.resolve('tmp/shared-seed-feed-tests');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'case-')),
    dataDir = path.join(directory, 'data');
  await mkdir(dataDir);
  const db = {
    schema: 1,
    categories: ['日常'],
    media: [],
    imports: [],
    entries: [
      {
        id: randomUUID(),
        title: 'synthetic source',
        content: '<p>one historical paragraph</p><p>second historical paragraph</p>',
        date: '2025-10-17T00:00:00.000Z',
        updatedAt: '2025-10-17T01:00:00.000Z',
        createdAt: '2025-10-17T00:00:00.000Z',
        revision: 1,
        category: '日常',
        tags: [],
        attachments: [],
        history: [],
        unknown: { nested: ['preserved', false] },
      },
    ],
  };
  configureRevisit(db, { expectedRevision: 1, enabled: true, timeZone: 'Asia/Shanghai' });
  tickRevisit(
    db,
    { manual: true, from: '2026-10-17T00:00:00Z', to: '2026-10-17T03:00:00Z' },
    Date.parse('2026-10-17T03:01:00Z'),
  );
  assert.ok(db.revisit.deliveries.length);
  await writeFile(path.join(dataDir, 'diary.json'), JSON.stringify(db));
  const server = await createDiaryServer({
    dataDir,
    seed: false,
    sharedSync: true,
    messageUnits: true,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.close();
    await once(server, 'close');
  });
  const base = `http://127.0.0.1:${server.address().port}`,
    request = computerOwnerTransport({ baseUrl: base });
  const local = async (url, input, method = 'POST') => {
    const response = await fetch(base + url, {
      method,
      headers: { 'X-Diary-Client': 'desktop', 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const value = await response.json();
    assert.equal(response.ok, true, JSON.stringify(value));
    return value;
  };
  const sourceId = randomUUID(),
    roomId = '-900000001',
    conversationId = `desktop:${sourceId}:${roomId}`;
  await local(
    '/api/chat-journal/rooms',
    { sourceId, id: roomId, title: 'synthetic revisit', category: '日常', idleHours: 5 },
    'PUT',
  );
  const delivery = db.revisit.deliveries[0],
    operationId = randomUUID();
  await local('/api/conversation-services/conversations/send', {
    conversationId,
    kind: 'comment',
    operationId,
    text: 'program comment retained offline',
    displayedTarget: {
      instanceId: 'legacy-revisit',
      batchId: delivery.batchId,
      deliveryId: delivery.id,
    },
  });
  return { directory, dataDir, request, local, conversationId, operationId, sourceId, roomId };
}

test('v2 real HTTP exports full original programme/comment projections and large hydrated rows; v1 is explicit core-only', async (t) => {
  const f = await fixture(t);
  const text = '大'.repeat(300000);
  await f.local('/api/chat-journal/messages', {
    sourceId: f.sourceId,
    roomId: f.roomId,
    messages: [
      { id: '20000000000000000001', sentAt: new Date().toISOString(), text, attachments: [] },
    ],
  });
  const info = await f.request('info', {});
  const page = await f.request('command', {
    libraryId: info.libraryId,
    epoch: info.epoch,
    operationId: randomUUID(),
    action: 'conversation-feed',
    input: { conversationId: f.conversationId, limit: 100 },
  });
  assert.ok(page.result.messages.some((row) => row.payload));
  const file = path.join(f.directory, 'full.syseed');
  const exported = await exportComputerSeed({
    dataDir: f.dataDir,
    file,
    directory: path.join(f.directory, 'work'),
    request: f.request,
  });
  assert.equal(exported.manifest.version, 2);
  assert.deepEqual(exported.manifest.requiredFeatures, [
    'conversation-feeds-v1',
    'seed-attestation-ed25519-v1',
  ]);
  const a = exported.manifest.attestation;
  assert.ok(a);
  assert.equal(a.keyFingerprintSha256, sha(Buffer.from(a.publicKeyRawBase64, 'base64')));
  const publicKey = createPublicKey({
    key: {
      kty: 'OKP',
      crv: 'Ed25519',
      x: Buffer.from(a.publicKeyRawBase64, 'base64').toString('base64url'),
    },
    format: 'jwk',
  });
  assert.equal(
    verify(
      null,
      sharedSeedAttestationBytes(exported.manifest, a),
      publicKey,
      Buffer.from(a.signatureBase64, 'base64'),
    ),
    true,
  );
  assert.equal(JSON.stringify(exported.manifest).includes('privateKey'), false);
  const { attestation: _attestation, ...intent } = exported.manifest;
  assert.throws(() => validateSharedSeedManifest(intent), {
    code: 'SHARED_SEED_INVALID_ATTESTATION',
  });
  const replay = await f.request('seed-register', {
    libraryId: intent.libraryId,
    epoch: intent.epoch,
    manifest: intent,
    manifestSha256: sha(sharedSeedEntityBytes(intent)),
  });
  assert.deepEqual(replay.attestation, a);
  assert.equal(replay.manifestSha256, exported.manifestSha256);
  assert.equal(replay.replayed, true);
  assert.throws(
    () =>
      validateSharedSeedManifest({
        ...structuredClone(exported.manifest),
        requiredFeatures: ['unknown-required-feature'],
      }),
    { code: 'SHARED_SEED_UNSUPPORTED_FEATURE' },
  );
  assert.throws(
    () => validateSharedSeedManifest({ ...structuredClone(exported.manifest), version: 1 }),
    { code: 'SHARED_SEED_UNSUPPORTED_FEATURE' },
  );
  const descriptor = exported.manifest.conversationFeeds.find(
    (feed) => feed.conversationId === f.conversationId,
  );
  assert.ok(descriptor.rowCount >= 3);
  assert.ok(descriptor.parts.some((part) => part.size > 1024 * 1024));
  const opened = await readSharedSeed({ file, directory: path.join(f.directory, 'read') });
  t.after(() => opened.dispose());
  const feed = opened.prepared.feeds[0];
  assert.ok(feed.messages.some((row) => row.kind === 'history' && row.source?.available));
  assert.ok(
    feed.messages.some(
      (row) => row.kind === 'comment' && row.markdown === 'program comment retained offline',
    ),
  );
  assert.equal(feed.messages.find((row) => row.kind === 'message').markdown, text);
  assert.ok(feed.messages.every((row) => !row.payload));
  const core = await exportSharedSeed({
    file: path.join(f.directory, 'core.syseed'),
    directory: path.join(f.directory, 'work'),
    request: f.request,
    coreOnly: true,
  });
  assert.equal(core.manifest.version, 1);
  assert.equal(core.manifest.conversationFeeds, undefined);
});

test('runtime-only comment withdrawal invalidates feed proof even with unchanged shared seq; forged old projection cannot newly register', async (t) => {
  const f = await fixture(t),
    file = path.join(f.directory, 'before.syseed');
  const old = await exportComputerSeed({
    dataDir: f.dataDir,
    file,
    directory: path.join(f.directory, 'work'),
    request: f.request,
  });
  const before = await f.request('info', {});
  await f.local('/api/conversation-services/conversations/withdraw', {
    conversationId: f.conversationId,
    kind: 'comment',
    instanceId: 'legacy-revisit',
    operationId: f.operationId,
  });
  const after = await f.request('info', {});
  assert.equal(after.seq, before.seq);
  const resolve = await f.request('seed-register', {
    libraryId: old.manifest.libraryId,
    epoch: old.manifest.epoch,
    manifest: old.manifest,
    manifestSha256: old.manifestSha256,
  });
  assert.equal(resolve.replayed, true);
  const { attestation: _attestation, ...copied } = {
    ...structuredClone(old.manifest),
    packageId: randomUUID(),
  };
  await assert.rejects(
    () =>
      f.request('seed-register', {
        libraryId: copied.libraryId,
        epoch: copied.epoch,
        manifest: copied,
        manifestSha256: sha(sharedSeedEntityBytes(copied)),
      }),
    { code: 'SHARED_SEED_FEED_ROSTER_MISMATCH' },
  );
  const latest = await exportComputerSeed({
    dataDir: f.dataDir,
    file: path.join(f.directory, 'after.syseed'),
    directory: path.join(f.directory, 'work'),
    request: f.request,
  });
  assert.notEqual(
    latest.manifest.conversationFeeds[0].feedRevision,
    old.manifest.conversationFeeds[0].feedRevision,
  );
  const opened = await readSharedSeed({
    file: latest.file,
    directory: path.join(f.directory, 'read'),
  });
  t.after(() => opened.dispose());
  const row = opened.prepared.feeds[0].messages.find((row) => row.kind === 'comment');
  assert.equal(row.state, 'withdrawn');
  assert.equal(row.markdown, '');
  assert.equal(row.body, null);
});

test('v2 rejects unknown required features, disguised v1 feed data and nonempty tombstone payloads', () => {
  const base = {
    format: 'shiye-conversation-feed-part',
    version: 1,
    conversationId: `desktop:${randomUUID()}:-1`,
    watermark: 1,
    feedRevision: '0'.repeat(64),
    messages: [],
    redactions: [],
  };
  assert.throws(
    () =>
      validateSharedSeedFeedPart({
        ...base,
        messages: [
          {
            id: 'x',
            conversationId: base.conversationId,
            kind: 'comment',
            state: 'withdrawn',
            body: { unknown: 'secret' },
          },
        ],
      }),
    { code: 'SHARED_SEED_FEED_TOMBSTONE_BODY' },
  );
  assert.throws(() => validateSharedSeedManifest({ version: 2, requiredFeatures: ['unknown'] }));
});
