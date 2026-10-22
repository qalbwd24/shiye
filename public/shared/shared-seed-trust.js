import { sharedSeedEntityBytes, validateSharedSeedManifest } from './shared-seed.js';
import { sha256Bytes } from './sync-v2-media.js';
const verifiedSeeds = new WeakMap();
const fail = (code) => {
  throw Object.assign(Error(code), { code });
};
const uuid = (value) =>
  typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const hash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const clone = (value) => structuredClone(value);
function decode(value, length) {
  if (
    typeof value !== 'string' ||
    value.length !== 4 * Math.ceil(length / 3) ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  )
    fail('SHARED_SEED_INVALID_ATTESTATION');
  const bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  if (bytes.length !== length) fail('SHARED_SEED_INVALID_ATTESTATION');
  return bytes;
}
export function sharedSeedManifestPayloadSha256(manifest) {
  const { attestation: _attestation, ...payload } = manifest;
  return sha256Bytes(sharedSeedEntityBytes(payload));
}
export function sharedSeedAttestationPayload(manifest, a) {
  return {
    domain: 'shiye-shared-seed-attestation-v1',
    libraryId: manifest.libraryId,
    epoch: manifest.epoch,
    packageId: manifest.packageId,
    watermark: manifest.watermark,
    manifestPayloadSha256: a.manifestPayloadSha256,
    exportId: a.exportId,
    keyFingerprintSha256: a.keyFingerprintSha256,
    issuedAt: a.issuedAt,
  };
}
export function sharedSeedAttestationBytes(manifest, a) {
  return sharedSeedEntityBytes(sharedSeedAttestationPayload(manifest, a));
}
/** Cryptographic proof only. User TOFU intent and persistent pin are checked
 * in the client's SAME publish transaction, never encoded as trusted:true. */
export async function verifySharedSeedAttestation(manifest, { nativeVerify } = {}) {
  const crypto = globalThis.crypto;
  const m = validateSharedSeedManifest(manifest),
    a = m.attestation;
  if (m.version !== 2 || !m.requiredFeatures?.includes('seed-attestation-ed25519-v1') || !a)
    fail('SHARED_SEED_ATTESTATION_REQUIRED');
  const allowed = [
    'version',
    'algorithm',
    'exportId',
    'issuedAt',
    'publicKeyRawBase64',
    'keyFingerprintSha256',
    'manifestPayloadSha256',
    'signatureBase64',
  ];
  if (
    typeof a !== 'object' ||
    Array.isArray(a) ||
    Object.keys(a).some((key) => !allowed.includes(key)) ||
    a.version !== 1 ||
    a.algorithm !== 'Ed25519' ||
    !uuid(a.exportId) ||
    typeof a.issuedAt !== 'string' ||
    !Number.isFinite(Date.parse(a.issuedAt)) ||
    new Date(a.issuedAt).toISOString() !== a.issuedAt ||
    !hash(a.keyFingerprintSha256) ||
    !hash(a.manifestPayloadSha256)
  )
    fail('SHARED_SEED_INVALID_ATTESTATION');
  const key = decode(a.publicKeyRawBase64, 32),
    signature = decode(a.signatureBase64, 64),
    payload = sharedSeedAttestationBytes(m, a);
  if (
    sha256Bytes(key) !== a.keyFingerprintSha256 ||
    sharedSeedManifestPayloadSha256(m) !== a.manifestPayloadSha256
  )
    fail('SHARED_SEED_ATTESTATION_HASH_MISMATCH');
  let verified = false,
    unsupported = !crypto?.subtle;
  if (!unsupported) {
    try {
      const imported = await crypto.subtle.importKey('raw', key, { name: 'Ed25519' }, false, [
        'verify',
      ]);
      verified = await crypto.subtle.verify({ name: 'Ed25519' }, imported, signature, payload);
    } catch (error) {
      if (error?.name !== 'NotSupportedError') fail('SHARED_SEED_INVALID_SIGNATURE');
      unsupported = true;
    }
  }
  if (unsupported) {
    if (typeof nativeVerify !== 'function') fail('SHARED_SEED_ED25519_UNAVAILABLE');
    verified =
      (await nativeVerify({
        libraryId: m.libraryId,
        epoch: m.epoch,
        packageId: m.packageId,
        watermark: m.watermark,
        attestation: clone(a),
      })) === true;
  }
  if (!verified) fail('SHARED_SEED_INVALID_SIGNATURE');
  const summary = Object.freeze({
    verified: true,
    libraryId: m.libraryId,
    epoch: m.epoch,
    packageId: m.packageId,
    watermark: m.watermark,
    keyFingerprintSha256: a.keyFingerprintSha256,
    publicKeyRawBase64: a.publicKeyRawBase64,
    exportId: a.exportId,
    manifestPayloadSha256: a.manifestPayloadSha256,
    manifestSha256: sha256Bytes(sharedSeedEntityBytes(m)),
  });
  verifiedSeeds.set(summary, clone(summary));
  return summary;
}
export function describeSharedSeedTrust(proof) {
  const verified = verifiedSeeds.get(proof);
  if (!verified) fail('SHARED_SEED_VERIFIED_PROOF_REQUIRED');
  return clone(verified);
}
export function assertSharedSeedTrust(proof, manifest) {
  const verified = verifiedSeeds.get(proof);
  if (
    !verified ||
    verified.manifestSha256 !== sha256Bytes(sharedSeedEntityBytes(manifest)) ||
    verified.manifestPayloadSha256 !== sharedSeedManifestPayloadSha256(manifest)
  )
    fail('SHARED_SEED_VERIFIED_PROOF_REQUIRED');
  return clone(verified);
}
export function assertSharedSeedRemoteTrust(pin, info) {
  if (!pin) return;
  const key = info?.seedSigningKey;
  if (
    info.libraryId !== pin.libraryId ||
    info.epoch !== pin.epoch ||
    key?.algorithm !== 'Ed25519' ||
    key.keyFingerprintSha256 !== pin.keyFingerprintSha256 ||
    key.publicKeyRawBase64 !== pin.publicKeyRawBase64 ||
    sha256Bytes(decode(key.publicKeyRawBase64, 32)) !== pin.keyFingerprintSha256
  )
    fail('SHARED_SEED_KEY_IDENTITY_MISMATCH');
}
