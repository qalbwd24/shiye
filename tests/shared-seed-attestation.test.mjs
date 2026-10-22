import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash, createPublicKey, verify } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { sharedSeedSigner } from '../src/server/shared-sync/seed-attestation.mjs';
import { sharedSeedAttestationBytes } from '../public/shared/shared-seed-trust.js';
import { sharedSeedEntityBytes } from '../public/shared/shared-seed.js';
import { exportSharedSeed } from '../src/server/shared-sync/seed-package.mjs';
import { computerOwnerTransport } from '../src/server/shared-sync/computer-export.mjs';
import { createDiaryServer } from '../src/server/app.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function directory() {
  const root = path.resolve('tmp/shared-seed-attestation-tests');
  await mkdir(root, { recursive: true });
  return mkdtemp(path.join(root, 'case-'));
}
test('issuer initializes atomically, survives reopen and epoch changes, and refuses cross-library/key-loss rotation', async () => {
  const dataDir = await directory(),
    libraryId = randomUUID();
  const signers = await Promise.all(
    Array.from({ length: 6 }, () => sharedSeedSigner({ dataDir, libraryId })),
  );
  assert.equal(new Set(signers.map((s) => s.keyFingerprintSha256)).size, 1);
  const signer = await sharedSeedSigner({
    dataDir,
    libraryId,
    requiredFingerprint: signers[0].keyFingerprintSha256,
  });
  const manifest = {
    libraryId,
    epoch: randomUUID(),
    packageId: randomUUID(),
    watermark: 15,
    unknown: { nested: [1, '中文'] },
  };
  const signed = signer.attest(manifest, {
    exportId: randomUUID(),
    issuedAt: '2026-10-19T00:00:00.000Z',
  });
  const a = signed.attestation;
  const key = createPublicKey({
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
      sharedSeedAttestationBytes(manifest, a),
      key,
      Buffer.from(a.signatureBase64, 'base64'),
    ),
    true,
  );
  assert.equal(
    verify(
      null,
      sharedSeedAttestationBytes({ ...manifest, epoch: randomUUID() }, a),
      key,
      Buffer.from(a.signatureBase64, 'base64'),
    ),
    false,
  );
  const reopened = await sharedSeedSigner({ dataDir, libraryId });
  assert.deepEqual(
    reopened.attest(manifest, { exportId: a.exportId, issuedAt: a.issuedAt }),
    signed,
  );
  const nextEpoch = { ...manifest, epoch: randomUUID() };
  const epochSigned = reopened.attest(nextEpoch, { exportId: randomUUID(), issuedAt: a.issuedAt });
  assert.equal(epochSigned.attestation.keyFingerprintSha256, a.keyFingerprintSha256);
  assert.equal(
    verify(
      null,
      sharedSeedAttestationBytes(nextEpoch, epochSigned.attestation),
      key,
      Buffer.from(epochSigned.attestation.signatureBase64, 'base64'),
    ),
    true,
  );
  await assert.rejects(() => sharedSeedSigner({ dataDir, libraryId: randomUUID() }), {
    code: 'SHARED_SEED_KEY_IDENTITY',
  });
  await assert.rejects(
    () => sharedSeedSigner({ dataDir, libraryId, requiredFingerprint: '0'.repeat(64) }),
    { code: 'SHARED_SEED_KEY_MISMATCH' },
  );
  await unlink(path.join(dataDir, '.shared-auth', 'seed-signing-key-v1.json'));
  await assert.rejects(
    () => sharedSeedSigner({ dataDir, libraryId, requiredFingerprint: a.keyFingerprintSha256 }),
    { code: 'SHARED_SEED_KEY_MISSING' },
  );
});

test('real HTTP signed register/resolve are durable; caller signatures and missing private key cannot issue or replay', async (t) => {
  const root = await directory(),
    dataDir = path.join(root, 'data');
  await mkdir(dataDir);
  await writeFile(
    path.join(dataDir, 'diary.json'),
    JSON.stringify({ schema: 1, entries: [], media: [], imports: [] }),
  );
  let server;
  async function start() {
    server = await createDiaryServer({ dataDir, seed: false, sharedSync: true });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return computerOwnerTransport({ baseUrl: `http://127.0.0.1:${server.address().port}` });
  }
  async function stop() {
    if (server) {
      const closing = server;
      server = null;
      closing.close();
      await once(closing, 'close');
    }
  }
  t.after(stop);
  let request = await start();
  assert.equal((await request('info', {})).seedSigningKey, null);
  await assert.rejects(
    () => readFile(path.join(dataDir, '.shared-auth', 'seed-signing-key-v1.json')),
    { code: 'ENOENT' },
  );
  const exported = await exportSharedSeed({
    file: path.join(root, 'signed.syseed'),
    directory: path.join(root, 'stage'),
    request,
  });
  const manifest = exported.manifest,
    manifestSha256 = exported.manifestSha256;
  const payload = {
    libraryId: manifest.libraryId,
    epoch: manifest.epoch,
    manifest,
    manifestSha256,
  };
  assert.deepEqual((await request('info', {})).seedSigningKey, {
    algorithm: 'Ed25519',
    publicKeyRawBase64: manifest.attestation.publicKeyRawBase64,
    keyFingerprintSha256: manifest.attestation.keyFingerprintSha256,
  });
  const before = JSON.parse(await readFile(path.join(dataDir, 'diary.json'), 'utf8'));
  assert.equal(before._sharedSeedExports.length, 1);
  assert.equal(JSON.stringify(before).includes('privateKey'), false);
  await stop();
  request = await start();
  const replay = await request('seed-register', payload);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.attestation, manifest.attestation);
  const resolved = await request('seed-resolve', payload);
  assert.equal(resolved.keyFingerprintSha256, manifest.attestation.keyFingerprintSha256);
  const { attestation: _attestation, ...unsigned } = manifest;
  const badSize = structuredClone(unsigned);
  badSize.packageId = randomUUID();
  const changedMember = badSize.members.find((row) => row.path === badSize.entities[0].path);
  changedMember.size++;
  badSize.bytes++;
  badSize.entityBytes++;
  await assert.rejects(
    () =>
      request('seed-register', {
        ...payload,
        manifest: badSize,
        manifestSha256: sha(sharedSeedEntityBytes(badSize)),
      }),
    { code: 'SHARED_SEED_ROSTER_MISMATCH' },
  );
  assert.deepEqual(
    JSON.parse(await readFile(path.join(dataDir, 'diary.json'), 'utf8'))._sharedSeedExports,
    before._sharedSeedExports,
  );
  await assert.rejects(
    () =>
      request('seed-resolve', {
        ...payload,
        manifest: unsigned,
        manifestSha256: sha(sharedSeedEntityBytes(unsigned)),
      }),
    { code: 'SHARED_SEED_INVALID_ATTESTATION' },
  );
  const forged = structuredClone(manifest);
  forged.attestation.signatureBase64 = Buffer.alloc(64).toString('base64');
  await assert.rejects(
    () =>
      request('seed-register', {
        ...payload,
        manifest: forged,
        manifestSha256: sha(sharedSeedEntityBytes(forged)),
      }),
    { code: 'SHARED_SEED_EXPORT_REUSED' },
  );
  const unknownSigned = { ...manifest, packageId: randomUUID() };
  unknownSigned.attestation = {
    ...manifest.attestation,
    manifestPayloadSha256: sha(
      sharedSeedEntityBytes({ ...unsigned, packageId: unknownSigned.packageId }),
    ),
  };
  await assert.rejects(
    () =>
      request('seed-register', {
        ...payload,
        manifest: unknownSigned,
        manifestSha256: sha(sharedSeedEntityBytes(unknownSigned)),
      }),
    { code: 'SHARED_SEED_CALLER_ATTESTATION_FORBIDDEN' },
  );
  await assert.rejects(
    () =>
      request('seed-resolve', {
        ...payload,
        manifest: unknownSigned,
        manifestSha256: sha(sharedSeedEntityBytes(unknownSigned)),
      }),
    { code: 'SHARED_SEED_EXPORT_UNREGISTERED' },
  );
  await unlink(path.join(dataDir, '.shared-auth', 'seed-signing-key-v1.json'));
  await assert.rejects(() => request('seed-register', payload), {
    code: 'SHARED_SEED_KEY_MISSING',
  });
  const after = JSON.parse(await readFile(path.join(dataDir, 'diary.json'), 'utf8'));
  assert.equal(after._sharedSync.seq, before._sharedSync.seq);
  assert.deepEqual(after._sharedSeedExports, before._sharedSeedExports);
});
