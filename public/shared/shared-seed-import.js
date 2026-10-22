import {
  prepareSharedSeed,
  validateSharedSeedManifest,
  SHARED_SEED_MAGIC,
  SHARED_SEED_LIMITS,
  assertPreparedSharedSeed,
} from './shared-seed.js';
import { Sha256, sha256Bytes } from './sync-v2-media.js';
import { createSharedSeedOriginalStore } from './shared-seed-originals.js';
import { verifySharedSeedAttestation, describeSharedSeedTrust } from './shared-seed-trust.js';
const CHUNK = 128 * 1024;
const fail = (code) => {
  throw Object.assign(Error(code), { code });
};
const b64 = (bytes) => {
  let value = '';
  for (let i = 0; i < bytes.length; i += 8192)
    value += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(value);
};
const decode = (value) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
const uuid = (value) =>
  typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const activeSignal = (signal) => {
  if (signal?.aborted) fail('SHARED_SEED_CANCELLED');
};
async function fileHeader(file, { signal } = {}) {
  if (
    !file ||
    !Number.isSafeInteger(file.size) ||
    file.size < 18 ||
    file.size > SHARED_SEED_LIMITS.total + 64 * 1024 * 1024 ||
    typeof file.slice !== 'function'
  )
    fail('SHARED_SEED_EXPLICIT_FILE_REQUIRED');
  const read = async (offset, length) => {
    activeSignal(signal);
    const bytes = new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
    if (bytes.length !== length) fail('SHARED_SEED_TRUNCATED');
    return bytes;
  };
  const magic = new TextEncoder().encode(SHARED_SEED_MAGIC),
    header = await read(0, magic.length + 4);
  if (header[0] === 80 && header[1] === 75) fail('SHARED_SEED_ZIP_NATIVE_READER_REQUIRED');
  if (!magic.every((value, index) => header[index] === value)) fail('SHARED_SEED_MAGIC_MISMATCH');
  const length = new DataView(header.buffer, header.byteOffset + magic.length, 4).getUint32(
    0,
    false,
  );
  if (length < 2 || length > SHARED_SEED_LIMITS.manifest) fail('SHARED_SEED_MANIFEST_TOO_LARGE');
  const manifest = validateSharedSeedManifest(
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await read(header.length, length))),
  );
  if (file.size !== header.length + length + manifest.bytes) fail('SHARED_SEED_LENGTH_MISMATCH');
  return { manifest, read, start: header.length + length, manifestBytes: length };
}
async function verifiedInspection(manifest, readMember, { signal, nativeVerify } = {}) {
  for (const member of manifest.members) {
    const digest = new Sha256();
    for (let offset = 0; offset < member.size; offset += CHUNK) {
      activeSignal(signal);
      const length = Math.min(CHUNK, member.size - offset),
        part = await readMember(member.path, offset, length);
      if (!(part instanceof Uint8Array) || part.length !== length) fail('SHARED_SEED_TRUNCATED');
      digest.update(part);
    }
    if (digest.digest() !== member.sha256) fail('SHARED_SEED_MEMBER_HASH_MISMATCH');
  }
  const proof = await verifySharedSeedAttestation(manifest, { nativeVerify });
  activeSignal(signal);
  return Object.freeze({ ...describeSharedSeedTrust(proof), bytesVerified: true });
}
/** No runtime, entity writes, original copies or trust pin. UI may use this
 * verified summary to choose an explicit identity and show the TOFU fingerprint. */
export async function inspectSharedSeedFile(file, options = {}) {
  const { manifest, read, start } = await fileHeader(file, options),
    positions = new Map();
  let position = start;
  for (const member of manifest.members) {
    positions.set(member.path, position);
    position += member.size;
  }
  return verifiedInspection(
    manifest,
    (path, offset, length) => read(positions.get(path) + offset, length),
    options,
  );
}
export async function inspectSharedSeedNativeTicket(ticket, { nativeRequest, signal } = {}) {
  if (!uuid(ticket?.seedToken))
    throw Object.assign(Error('SHARED_SEED_INVALID_TICKET'), {
      code: 'SHARED_SEED_INVALID_TICKET',
      ticketDisposition: 'unowned',
    });
  const token = ticket.seedToken;
  let retained = false,
    failure;
  try {
    if (typeof nativeRequest !== 'function') fail('SHARED_SEED_NATIVE_PORT_REQUIRED');
    if (
      !Number.isSafeInteger(ticket.manifest?.byteLength) ||
      ticket.manifest.byteLength < 2 ||
      ticket.manifest.byteLength > SHARED_SEED_LIMITS.manifest ||
      !/^[a-f0-9]{64}$/.test(ticket.manifest.sha256 || '')
    )
      fail('SHARED_SEED_INVALID_TICKET');
    const read = async (action, input, offset, length) => {
      activeSignal(signal);
      const result = await nativeRequest(action, { ...input, offset, length }),
        bytes = decode(result.bytesBase64);
      if (
        result.offset !== offset ||
        result.next !== offset + length ||
        bytes.length !== length ||
        sha256Bytes(bytes) !== result.chunkSha256
      )
        fail('SHARED_SEED_NATIVE_RANGE_MISMATCH');
      return bytes;
    };
    const bytes = new Uint8Array(ticket.manifest.byteLength);
    for (let offset = 0; offset < bytes.length; offset += CHUNK)
      bytes.set(
        await read(
          'sharedSeedManifestRead',
          { seedToken: token },
          offset,
          Math.min(CHUNK, bytes.length - offset),
        ),
        offset,
      );
    if (sha256Bytes(bytes) !== ticket.manifest.sha256) fail('SHARED_SEED_MANIFEST_HASH_MISMATCH');
    const manifest = validateSharedSeedManifest(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
    );
    if (
      manifest.packageId !== ticket.packageId ||
      manifest.libraryId !== ticket.libraryId ||
      manifest.epoch !== ticket.epoch
    )
      fail('SHARED_SEED_INVALID_TICKET');
    const summary = await verifiedInspection(
      manifest,
      (path, offset, length) =>
        read('sharedSeedReadMember', { seedToken: token, path }, offset, length),
      {
        signal,
        nativeVerify: async (input) =>
          (await nativeRequest('sharedSeedVerifyAttestation', input)).verified === true,
      },
    );
    retained = true;
    return Object.freeze({ ...summary, ticketDisposition: 'retained' });
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    if (!retained) {
      try {
        if (typeof nativeRequest !== 'function') fail('SHARED_SEED_NATIVE_PORT_REQUIRED');
        await nativeRequest('sharedSeedClose', { seedToken: token });
        if (failure) failure.ticketDisposition = 'closed';
      } catch {
        if (failure) {
          delete failure.ticketDisposition;
          failure.closeFailed = true;
          failure.cleanupRequired = true;
        }
      }
    }
  }
}
/** Shared UI-facing data controller: never binds a library from an untrusted
 * file, never writes Product/legacy data, never reveals service credentials. */
export function createSharedSeedImportController({
  client,
  storage,
  libraryId,
  epoch,
  nativeRequest,
  onProgress = () => {},
} = {}) {
  if (
    !client?.importSeed ||
    !client?.readSeedOriginal ||
    !storage?.transaction ||
    !libraryId ||
    !epoch
  )
    fail('SHARED_SEED_IMPORT_OPTIONS_REQUIRED');
  const originals = createSharedSeedOriginalStore({ storage, libraryId, epoch });
  const report = (phase, done, total) => {
    try {
      onProgress({ phase, completed: done, total });
    } catch {
      /* observer only */
    }
  };
  const active = (signal) => {
    if (signal?.aborted) fail('SHARED_SEED_CANCELLED');
  };
  const identity = (manifest) => {
    if (manifest.libraryId !== libraryId || manifest.epoch !== epoch)
      fail('SHARED_IDENTITY_MISMATCH');
  };
  async function native(action, input) {
    if (typeof nativeRequest !== 'function') fail('SHARED_SEED_NATIVE_PORT_REQUIRED');
    return nativeRequest(action, input);
  }
  async function importPrepared(prepared, options) {
    if (
      options.offlineTrust !== undefined ||
      options.offline === true ||
      typeof options.onTrustRequired === 'function'
    ) {
      const seed = assertPreparedSharedSeed(prepared),
        proof = await verifySharedSeedAttestation(seed.manifest, {
          ...(typeof nativeRequest === 'function'
            ? {
                nativeVerify: async (input) =>
                  (await native('sharedSeedVerifyAttestation', input)).verified === true,
              }
            : {}),
        });
      active(options.signal);
      const intent =
        options.offlineTrust ??
        (options.onTrustRequired
          ? await options.onTrustRequired(
              Object.freeze({ ...describeSharedSeedTrust(proof), bytesVerified: true }),
            )
          : {});
      active(options.signal);
      return client.importSeed(prepared, {
        resolve: false,
        offlineTrust: intent,
        verifiedProof: proof,
      });
    }
    return client.importSeed(prepared, { resolve: options.resolve !== false });
  }
  async function readNative(action, input, offset, length, expected) {
    if (length > CHUNK) {
      const joined = new Uint8Array(length);
      for (let done = 0; done < length; done += CHUNK)
        joined.set(
          await readNative(action, input, offset + done, Math.min(CHUNK, length - done), expected),
          done,
        );
      return joined;
    }
    const result = await native(action, { ...input, offset, length }),
      bytes = decode(result.bytesBase64);
    if (
      result.offset !== offset ||
      result.next !== offset + length ||
      bytes.length !== length ||
      sha256Bytes(bytes) !== result.chunkSha256 ||
      (expected && (result.size !== expected.size || result.sha256 !== expected.sha256))
    )
      fail('SHARED_SEED_NATIVE_RANGE_MISMATCH');
    return bytes;
  }
  async function importNativeTicket(ticket, options = {}) {
    const { signal } = options;
    // Once the native token is structurally valid, this controller owns its
    // close even if a later ticket guard fails. Never route malformed tokens.
    const seedToken =
      typeof ticket?.seedToken === 'string' &&
      /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(ticket.seedToken)
        ? ticket.seedToken
        : null;
    if (!seedToken) fail('SHARED_SEED_INVALID_TICKET');
    let prepared;
    try {
      if (
        !Number.isSafeInteger(ticket.manifest?.byteLength) ||
        ticket.manifest.byteLength < 2 ||
        ticket.manifest.byteLength > SHARED_SEED_LIMITS.manifest ||
        !/^[a-f0-9]{64}$/.test(ticket.manifest.sha256 || '')
      )
        fail('SHARED_SEED_INVALID_TICKET');
      identity(ticket);
      active(signal);
      const bytes = new Uint8Array(ticket.manifest.byteLength);
      for (let offset = 0; offset < bytes.length; offset += CHUNK) {
        active(signal);
        const part = await readNative(
          'sharedSeedManifestRead',
          { seedToken: ticket.seedToken },
          offset,
          Math.min(CHUNK, bytes.length - offset),
        );
        bytes.set(part, offset);
        report('manifest', offset + part.length, bytes.length);
      }
      if (sha256Bytes(bytes) !== ticket.manifest.sha256) fail('SHARED_SEED_MANIFEST_HASH_MISMATCH');
      const manifest = validateSharedSeedManifest(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
      );
      identity(manifest);
      if (manifest.packageId !== ticket.packageId) fail('SHARED_SEED_INVALID_TICKET');
      prepared = await prepareSharedSeed({
        manifest,
        signal,
        readMember: (path, offset, length) => {
          active(signal);
          return readNative(
            'sharedSeedReadMember',
            { seedToken: ticket.seedToken, path },
            offset,
            length,
          );
        },
        stageOriginal: {
          begin: async (asset) => (await native('sharedSeedOriginalBegin', { asset })).token,
          write: async (token, offset, part) => {
            for (let done = 0; done < part.length; done += CHUNK) {
              active(signal);
              const bytes = part.subarray(done, Math.min(part.length, done + CHUNK));
              const ack = await native('sharedSeedOriginalWrite', {
                token,
                offset: offset + done,
                bytesBase64: b64(bytes),
              });
              if (ack.next !== offset + done + bytes.length) fail('SHARED_SEED_INVALID_STAGE_ACK');
            }
          },
          finish: async (token, asset) =>
            (await native('sharedSeedOriginalFinish', { token, asset })).handle,
          abort: (token) => native('sharedSeedOriginalAbort', { token }),
        },
      });
      active(signal);
      report('quarantine', 0, manifest.entityCount);
      return await importPrepared(prepared, options);
    } finally {
      try {
        if (prepared) await prepared.discard();
      } finally {
        await native('sharedSeedClose', { seedToken }).catch(() => {});
      }
    }
  }
  async function inspectFile(file, { signal } = {}) {
    const header = await fileHeader(file, { signal });
    identity(header.manifest);
    return header;
  }
  async function estimateFile(file, options = {}) {
    const { manifest, manifestBytes } = await inspectFile(file, options);
    const originalBytes = manifest.members
      .filter((member) => member.path.startsWith('media/'))
      .reduce((total, member) => total + member.size, 0);
    const additionalBytes =
      originalBytes + manifest.entityBytes * 2 + manifestBytes * 3 + 128 * 1024 * 1024;
    const estimate = await globalThis.navigator?.storage?.estimate?.();
    const available =
      estimate && Number.isFinite(estimate.quota) && Number.isFinite(estimate.usage)
        ? Math.max(0, estimate.quota - estimate.usage)
        : null;
    return {
      packageId: manifest.packageId,
      libraryId: manifest.libraryId,
      epoch: manifest.epoch,
      sourceBytes: file.size,
      originalBytes,
      entityBytes: manifest.entityBytes,
      estimatedAdditionalBytes: additionalBytes,
      estimatedWorkingJsonBytes: manifest.entityBytes * 3 + manifestBytes * 3,
      availableBytes: available,
      enough: available === null ? null : available >= additionalBytes,
      estimateOnly: true,
    };
  }
  async function importFile(file, options = {}) {
    const { expectedSha256, signal } = options;
    const { manifest, read, start } = await inspectFile(file, { signal });
    if (expectedSha256) {
      if (!/^[a-f0-9]{64}$/.test(expectedSha256)) fail('SHARED_SEED_INVALID_EXPECTED_HASH');
      const hash = new Sha256();
      for (let offset = 0; offset < file.size; offset += CHUNK) {
        hash.update(await read(offset, Math.min(CHUNK, file.size - offset)));
        report('package-hash', Math.min(offset + CHUNK, file.size), file.size);
      }
      if (hash.digest() !== expectedSha256) fail('SHARED_SEED_PACKAGE_HASH_MISMATCH');
    }
    const positions = new Map();
    let position = start;
    for (const member of manifest.members) {
      positions.set(member.path, { position, size: member.size });
      position += member.size;
    }
    let prepared;
    try {
      prepared = await prepareSharedSeed({
        manifest,
        signal,
        stageOriginal: originals.stageOriginal,
        readMember: async (path, offset, size) => {
          const member = positions.get(path);
          if (
            !member ||
            !Number.isSafeInteger(offset) ||
            !Number.isSafeInteger(size) ||
            offset < 0 ||
            size < 1 ||
            size > SHARED_SEED_LIMITS.chunk ||
            offset + size > member.size
          )
            fail('SHARED_SEED_INVALID_RANGE');
          return read(member.position + offset, size);
        },
      });
      active(signal);
      return await importPrepared(prepared, options);
    } finally {
      if (prepared) await prepared.discard();
    }
  }
  async function openOriginal(assetId) {
    const indexed = await client.readSeedOriginal(assetId);
    if (!indexed) return null;
    const handle = indexed.handle;
    let opened;
    if (typeof handle === 'string' && handle.startsWith('shared-seed-idb:'))
      opened = await originals.open(handle);
    else if (typeof handle === 'string' && handle.startsWith('shared-seed-original:'))
      opened = {
        size: indexed.size,
        sha256: indexed.sha256,
        read: (start, end) =>
          readNative('sharedSeedOriginalRead', { handle }, start, end - start, indexed),
      };
    else if (typeof Blob === 'function' && handle instanceof Blob)
      opened = {
        size: handle.size,
        sha256: indexed.sha256,
        read: async (start, end) => new Uint8Array(await handle.slice(start, end).arrayBuffer()),
      };
    else fail('SHARED_SEED_INVALID_ORIGINAL_HANDLE');
    if (opened.size !== indexed.size || opened.sha256 !== indexed.sha256)
      fail('SHARED_SEED_ORIGINAL_CHANGED');
    return {
      assetId,
      size: indexed.size,
      sha256: indexed.sha256,
      async read(start, end) {
        const current = await client.readSeedOriginal(assetId);
        const sameHandle =
          current &&
          (typeof handle === 'string'
            ? current.handle === handle
            : typeof Blob === 'function' &&
              current.handle instanceof Blob &&
              current.handle.size === handle.size &&
              current.handle.type === handle.type);
        if (
          !current ||
          !sameHandle ||
          current.sha256 !== indexed.sha256 ||
          current.size !== indexed.size
        )
          fail('SHARED_SEED_ORIGINAL_NO_LONGER_ACTIVE');
        if (
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          start < 0 ||
          end <= start ||
          end - start > CHUNK ||
          end > indexed.size
        )
          fail('SHARED_SEED_INVALID_RANGE');
        const bytes = await opened.read(start, end);
        if (!(bytes instanceof Uint8Array) || bytes.length !== end - start)
          fail('SHARED_SEED_ORIGINAL_CHANGED');
        return bytes;
      },
    };
  }
  async function copyOriginal(assetId, { sink, signal } = {}) {
    const original = await openOriginal(assetId);
    if (!original) return null;
    if (!sink?.write || !sink?.finish) fail('SHARED_MEDIA_SINK_REQUIRED');
    const hash = new Sha256();
    for (let offset = 0; offset < original.size; offset += CHUNK) {
      active(signal);
      const bytes = await original.read(offset, Math.min(original.size, offset + CHUNK));
      hash.update(bytes);
      await sink.write(offset, bytes);
    }
    if (hash.digest() !== original.sha256) fail('SHARED_SEED_ORIGINAL_CHANGED');
    return {
      found: true,
      result: await sink.finish({ id: assetId, size: original.size, sha256: original.sha256 }),
    };
  }
  return {
    importNativeTicket,
    importFile,
    estimateFile,
    inspectFile: (file, options) => inspectSharedSeedFile(file, options),
    inspectNativeTicket: (ticket, options) =>
      inspectSharedSeedNativeTicket(ticket, { ...options, nativeRequest }),
    resume: (packageId) => client.resolveSeed(packageId),
    status: (packageId) => client.readSeedStatus(packageId),
    trust: () => client.readSeedTrust(),
    openOriginal,
    copyOriginal,
    async readOriginal(assetId, { offset, length } = {}) {
      const original = await openOriginal(assetId);
      return original ? original.read(offset, offset + length) : null;
    },
  };
}
