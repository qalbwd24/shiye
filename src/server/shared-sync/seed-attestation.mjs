import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
} from 'node:crypto';
import { mkdir, readFile, lstat, open, link, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { sharedSeedEntityBytes } from '../../../public/shared/shared-seed.js';
import {
  sharedSeedManifestPayloadSha256,
  sharedSeedAttestationBytes,
} from '../../../public/shared/shared-seed-trust.js';

const fail = (code) => {
  throw Object.assign(Error(code), { code, status: 409 });
};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function noLinks(file) {
  for (let selected = path.resolve(file); ;) {
    if ((await lstat(selected)).isSymbolicLink()) fail('SHARED_SEED_KEY_PATH_UNSAFE');
    const parent = path.dirname(selected);
    if (parent === selected) break;
    selected = parent;
  }
}

/** Private issuer key, never part of business JSON/seed. A previously signed
 * library must restore its real key; absence must never silently rotate trust. */
export async function sharedSeedSigner({
  dataDir,
  libraryId,
  requiredFingerprint,
  initialize = true,
} = {}) {
  if (!path.isAbsolute(dataDir || '') || typeof libraryId !== 'string')
    fail('SHARED_SEED_KEY_IDENTITY');
  await noLinks(dataDir);
  const directory = path.join(dataDir, '.shared-auth');
  if (initialize) await mkdir(directory, { recursive: true, mode: 0o700 });
  else {
    try {
      await lstat(directory);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (requiredFingerprint) fail('SHARED_SEED_KEY_MISSING');
      return null;
    }
  }
  await noLinks(directory);
  const file = path.join(directory, 'seed-signing-key-v1.json');
  let raw;
  try {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384)
      fail('SHARED_SEED_KEY_PATH_UNSAFE');
    raw = await readFile(file, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (requiredFingerprint) fail('SHARED_SEED_KEY_MISSING');
    if (!initialize) return null;
    const { privateKey } = generateKeyPairSync('ed25519');
    const value = {
      version: 1,
      libraryId,
      privateKeyPkcs8Base64: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
    };
    const temporary = path.join(directory, `seed-key-${randomUUID()}.partial`);
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(JSON.stringify(value));
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await link(temporary, file);
    } catch (failure) {
      if (failure.code !== 'EEXIST') throw failure;
    } finally {
      await unlink(temporary);
    }
    // On concurrent first use always read the actual atomic winner.
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384)
      fail('SHARED_SEED_KEY_PATH_UNSAFE');
    raw = await readFile(file, 'utf8');
  }
  let value, privateKey, publicKeyRawBase64;
  try {
    value = JSON.parse(raw);
    if (
      value.version !== 1 ||
      value.libraryId !== libraryId ||
      typeof value.privateKeyPkcs8Base64 !== 'string'
    )
      fail('SHARED_SEED_KEY_IDENTITY');
    privateKey = createPrivateKey({
      key: Buffer.from(value.privateKeyPkcs8Base64, 'base64'),
      type: 'pkcs8',
      format: 'der',
    });
    if (privateKey.asymmetricKeyType !== 'ed25519') fail('SHARED_SEED_KEY_INVALID');
    publicKeyRawBase64 = Buffer.from(
      createPublicKey(privateKey).export({ format: 'jwk' }).x,
      'base64url',
    ).toString('base64');
  } catch (error) {
    if (error.code?.startsWith('SHARED_')) throw error;
    fail('SHARED_SEED_KEY_INVALID');
  }
  const keyFingerprintSha256 = hash(Buffer.from(publicKeyRawBase64, 'base64'));
  if (requiredFingerprint && keyFingerprintSha256 !== requiredFingerprint)
    fail('SHARED_SEED_KEY_MISMATCH');
  return {
    keyFingerprintSha256,
    publicKey: { algorithm: 'Ed25519', publicKeyRawBase64, keyFingerprintSha256 },
    attest(manifest, { exportId, issuedAt }) {
      const attestation = {
        version: 1,
        algorithm: 'Ed25519',
        exportId,
        issuedAt,
        publicKeyRawBase64,
        keyFingerprintSha256,
        manifestPayloadSha256: sharedSeedManifestPayloadSha256(manifest),
      };
      attestation.signatureBase64 = sign(
        null,
        sharedSeedAttestationBytes(manifest, attestation),
        privateKey,
      ).toString('base64');
      return {
        attestation,
        manifestSha256: hash(sharedSeedEntityBytes({ ...manifest, attestation })),
      };
    },
  };
}
