import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { exportSharedSeed } from './seed-package.mjs';
import { sharedInfo } from './replication.mjs';
import { readDesktopCapture, planDesktopSource } from './desktop-source-plan.mjs';
import { sourceMessageFingerprint } from './source-message-conflicts.mjs';
import { randomUUID } from 'node:crypto';
import { desktopCollectionRecipe } from './desktop-collection-recipe.mjs';
import { createSharedMediaClient } from '../../../public/shared/shared-media-client.js';
import { evaluateComputerExportCoverage } from './computer-coverage.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = (code) => {
  throw Object.assign(Error(code), { code });
};
const explicit = (value) => {
  if (!path.isAbsolute(value || '')) fail('COMPUTER_EXPLICIT_PATH_REQUIRED');
};
const safeId = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);

/** Recovery material only, not a new owner or a shared-bootstrap package. The
 * exact source JSON (including private runtime state) remains in a private root.
 * Existing media/originals are immutable under the owner rename contract. */
export async function captureComputerSource({ dataDir, exportsDir } = {}) {
  explicit(dataDir);
  explicit(exportsDir);
  await fs.mkdir(exportsDir, { recursive: true, mode: 0o700 });
  const directory = await fs.mkdtemp(path.join(exportsDir, 'computer-source-'));
  const input = await fs.open(path.join(dataDir, 'diary.json'), 'r');
  let bytes;
  try {
    const before = await input.stat();
    if (!before.isFile() || before.size > 128 * 1024 ** 2) fail('COMPUTER_SOURCE_TOO_LARGE');
    bytes = await input.readFile();
    const after = await input.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs)
      fail('COMPUTER_SOURCE_CHANGED');
  } finally {
    await input.close();
  }
  const db = JSON.parse(bytes.toString('utf8'));
  if (!Array.isArray(db.entries) || !Array.isArray(db.media) || !Array.isArray(db.imports))
    fail('COMPUTER_SOURCE_INVALID');
  await fs.writeFile(path.join(directory, 'diary.json'), bytes, { flag: 'wx', mode: 0o600 });
  const files = [],
    seen = new Set();
  let total = bytes.length;
  for (const [folder, items] of [
    ['media', db.media],
    ['originals', db.imports],
  ]) {
    await fs.mkdir(path.join(directory, folder), { mode: 0o700 });
    for (const item of items) {
      if (!safeId(item.id) || seen.has(folder + '/' + item.id)) fail('COMPUTER_SOURCE_INVALID_ID');
      seen.add(folder + '/' + item.id);
      const source = path.join(dataDir, folder, item.id),
        target = path.join(directory, folder, item.id);
      if (!(await fs.lstat(source)).isFile()) fail('COMPUTER_ORIGINAL_NOT_FILE');
      const reader = await fs.open(source, 'r'),
        writer = await fs.open(target, 'wx', 0o600);
      const digest = createHash('sha256');
      let size = 0;
      try {
        const before = await reader.stat();
        for await (const chunk of reader.createReadStream({
          highWaterMark: 256 * 1024,
          autoClose: false,
        })) {
          size += chunk.length;
          total += chunk.length;
          if (size > 16 * 1024 ** 3 || total > 64 * 1024 ** 3) fail('COMPUTER_CAPTURE_TOO_LARGE');
          digest.update(chunk);
          await writer.writeFile(chunk);
        }
        const after = await reader.stat();
        if (before.size !== size || before.size !== after.size || before.mtimeMs !== after.mtimeMs)
          fail('COMPUTER_ORIGINAL_CHANGED');
        await writer.sync();
      } finally {
        await reader.close();
        await writer.close();
      }
      const sha256 = digest.digest('hex');
      if (
        (item.size !== undefined && item.size !== size) ||
        (item.sha256 && item.sha256 !== sha256)
      )
        fail('COMPUTER_ORIGINAL_MISMATCH');
      files.push({ folder, id: item.id, size, sha256 });
    }
  }
  const report = {
    version: 1,
    kind: 'computer-source-recovery',
    sourceSha256: hash(bytes),
    sourceBytes: bytes.length,
    sharedEnabled: !!db._sharedSync,
    completeComputerExport: false,
    directlyImportable: false,
    counts: {
      entries: db.entries.length,
      media: db.media.length,
      archives: db.imports.length,
      rooms: db.chatJournal?.rooms?.length || 0,
      templates: db.templates?.length || 0,
      files: files.length,
      fileBytes: total - bytes.length,
    },
    coverage: {
      ownerJson: 'captured-exact-private-generation',
      originals: 'all-indexed-size-sha256-verified',
      desktopDirectory: 'requires-explicit-ui-logical-capture',
      desktopPreferences: 'requires-explicit-ui-logical-capture',
      unsavedDrafts: 'requires-frontend-save-ack',
      notes: 'excluded-by-user-scope',
      continuation: db._sharedSync
        ? 'requires-original-owner-seed-registration'
        : 'original-owner-shared-not-enabled',
    },
  };
  // This marker is written only after every indexed original verifies. Partial
  // directories have no success marker and must never be advertised as a seed.
  await fs.writeFile(
    path.join(directory, 'capture-manifest.json'),
    JSON.stringify({ ...report, files }),
    { flag: 'wx', mode: 0o600 },
  );
  return { directory, report };
}

/** Explicit authenticated fixed transport to the live owner; no getDb fallback
 * or identity generation in a copy. The existing exporter registers the seed. */
export async function exportComputerSeed({
  dataDir,
  file,
  directory,
  request,
  sourceOperationId,
} = {}) {
  explicit(dataDir);
  // Reading the selected owner's persisted identity never initializes or repairs it.
  const expected = sharedInfo(
    JSON.parse(await fs.readFile(path.join(dataDir, 'diary.json'), 'utf8')),
  );
  if (!expected.enabled) fail('COMPUTER_ORIGINAL_OWNER_NOT_SHARED');
  const info = await request('info', {});
  if (!info.enabled || !info.libraryId || !info.epoch) fail('COMPUTER_ORIGINAL_OWNER_NOT_SHARED');
  if (info.libraryId !== expected.libraryId || info.epoch !== expected.epoch)
    fail('COMPUTER_ORIGINAL_OWNER_IDENTITY_MISMATCH');
  const result = await exportSharedSeed({
    file,
    directory,
    request,
    openOriginal: async function* (assetId, row) {
      for (let offset = 0; offset < row.data.size;) {
        const value = await request('media-read', {
          libraryId: info.libraryId,
          epoch: info.epoch,
          assetId,
          offset,
          length: Math.min(256 * 1024, row.data.size - offset),
        });
        const chunk = Buffer.from(value.bytesBase64 || '', 'base64');
        if (
          value.info?.libraryId !== info.libraryId ||
          value.info?.epoch !== info.epoch ||
          value.asset?.id !== assetId ||
          value.asset?.sha256 !== row.data.sha256 ||
          value.asset?.size !== row.data.size ||
          value.offset !== offset ||
          !chunk.length ||
          chunk.length > 256 * 1024 ||
          value.next !== offset + chunk.length ||
          value.done !== (value.next === row.data.size) ||
          hash(chunk) !== value.chunkSha256
        )
          fail('COMPUTER_ORIGINAL_CHANGED');
        yield chunk;
        offset = value.next;
      }
    },
  });
  const persisted = JSON.parse(await fs.readFile(path.join(dataDir, 'diary.json'), 'utf8'));
  return {
    ...result,
    coverage: sourceOperationId
      ? await request('source-collection-coverage', {
          manifest: result.manifest,
          sourceOperationId,
        })
      : evaluateComputerExportCoverage({
          db: persisted,
          manifest: result.manifest,
          sourceOperationId,
        }),
  };
}

export function computerOwnerTransport({
  baseUrl,
  token,
  cookie,
  deviceId,
  fetchImpl = fetch,
} = {}) {
  const base = new URL(baseUrl);
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.pathname !== '/' ||
    base.search ||
    base.hash ||
    (base.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))
  )
    fail('COMPUTER_OWNER_URL_INVALID');
  const actions = {
    info: 'info',
    snapshot: 'snapshot',
    pull: 'pull',
    'entity-read': 'entity/read',
    'media-read': 'media/read',
    'media-begin': 'media/begin',
    'media-chunk': 'media/chunk',
    'media-complete': 'media/complete',
    'seed-register': 'seed-register',
    'seed-resolve': 'seed-resolve',
    command: 'command',
    'feed-item-read': 'feed-item/read',
    'source-conflicts-register': '/api/source-collection/messages',
    'source-collection-apply': '/api/source-collection/apply',
    'source-collection-coverage': '/api/source-collection/coverage',
    'source-preference-resource-proof': '/api/source-collection/preference-resource-proof',
  };
  return async (action, input) => {
    if (!Object.hasOwn(actions, action)) fail('COMPUTER_FIXED_ACTION_REQUIRED');
    const response = await fetchImpl(
      new URL(
        actions[action].startsWith('/') ? actions[action] : '/api/shared/v1/' + actions[action],
        base,
      ),
      {
        method: action === 'info' ? 'GET' : 'POST',
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json',
          'X-Diary-Client': 'desktop',
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
          ...(deviceId ? { 'X-Sync-Device-Id': deviceId } : {}),
        },
        ...(action === 'info' ? {} : { body: JSON.stringify(input) }),
        signal: AbortSignal.timeout(120000),
      },
    );
    const value = await response.json();
    if (!response.ok)
      fail(
        value.error?.code ||
          (/^SOURCE_[A-Z0-9_]+$/.test(value.error) ? value.error : 'COMPUTER_OWNER_REQUEST_FAILED'),
      );
    return value;
  };
}

/** Explicit local-admin collection. Reads real owner identity; never writes its
 * JSON. Durable private request keeps its operation ID across lost HTTP ACK. */
export async function registerComputerSourceConflicts({
  dataDir,
  captureDir,
  exportsDir,
  requestFile,
  request,
}) {
  for (const selected of [dataDir, captureDir, exportsDir, requestFile]) explicit(selected);
  const relative = (file) => {
    const value = path.relative(exportsDir, file);
    if (!value || value.startsWith('..') || path.isAbsolute(value))
      fail('COMPUTER_PRIVATE_PLAN_REQUIRED');
    return value.split(path.sep).join('/');
  };
  const captureRelativePath = relative(captureDir);
  relative(requestFile);
  const captured = await readDesktopCapture(captureDir);
  const db = JSON.parse(await fs.readFile(path.join(dataDir, 'diary.json'), 'utf8'));
  const info = sharedInfo(db),
    remote = await request('info', {});
  if (!info.enabled || info.libraryId !== remote.libraryId || info.epoch !== remote.epoch)
    fail('COMPUTER_OWNER_IDENTITY_REQUIRED');
  let job;
  try {
    job = JSON.parse(await fs.readFile(requestFile, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (!job) {
    const plan = planDesktopSource(db, captured);
    const conflicts = plan.messages.filter(
      (row) => row.disposition === 'same-identity-content-conflict',
    );
    if (!conflicts.length || conflicts.length > 2) fail('COMPUTER_CONFLICT_SCOPE_REQUIRED');
    const records = conflicts.map((row) => {
      const matches = (db.entries || [])
        .filter(
          (entry) =>
            entry.chatJournal?.sourceId === captured.sourceId &&
            String(entry.chatJournal.roomId) === row.roomId,
        )
        .flatMap((entry) =>
          entry.chatJournal.messages.filter((message) => String(message.id) === row.messageId),
        );
      if (matches.length !== 1) fail('COMPUTER_CONFLICT_SCOPE_REQUIRED');
      return {
        roomId: row.roomId,
        messageId: row.messageId,
        expectedOwnerSha256: sourceMessageFingerprint(matches[0]),
      };
    });
    job = {
      format: 'shiye-private-source-conflict-request',
      version: 1,
      libraryId: info.libraryId,
      epoch: info.epoch,
      request: {
        operationId: randomUUID(),
        captureRelativePath,
        captureManifestSha256: captured.manifestSha256,
        records,
      },
    };
    await fs.mkdir(path.dirname(requestFile), { recursive: true, mode: 0o700 });
    await fs.writeFile(requestFile, JSON.stringify(job, null, 2), { flag: 'wx', mode: 0o600 });
  }
  if (
    job.format !== 'shiye-private-source-conflict-request' ||
    job.version !== 1 ||
    job.libraryId !== info.libraryId ||
    job.epoch !== info.epoch ||
    job.request?.captureManifestSha256 !== captured.manifestSha256 ||
    job.request.captureRelativePath !== captureRelativePath
  )
    fail('COMPUTER_CONFLICT_REQUEST_REUSED');
  return request('source-conflicts-register', job.request);
}

export async function applyComputerSourceCollection({
  dataDir,
  captureDir,
  exportsDir,
  requestFile,
  request,
}) {
  for (const selected of [dataDir, captureDir, exportsDir, requestFile]) explicit(selected);
  const relative = (file) => {
    const value = path.relative(exportsDir, file);
    if (!value || value.startsWith('..') || path.isAbsolute(value))
      fail('COMPUTER_PRIVATE_PLAN_REQUIRED');
    return value.split(path.sep).join('/');
  };
  const captureRelativePath = relative(captureDir);
  relative(requestFile);
  const capture = await readDesktopCapture(captureDir),
    readDb = async () => JSON.parse(await fs.readFile(path.join(dataDir, 'diary.json'), 'utf8'));
  const db = await readDb(),
    info = sharedInfo(db),
    remote = await request('info', {});
  if (!info.enabled || info.libraryId !== remote.libraryId || info.epoch !== remote.epoch)
    fail('COMPUTER_OWNER_IDENTITY_REQUIRED');
  let job;
  try {
    job = JSON.parse(await fs.readFile(requestFile, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (!job) {
    job = {
      format: 'shiye-private-source-collection-request',
      version: 1,
      sourceId: capture.sourceId,
      request: {
        libraryId: info.libraryId,
        epoch: info.epoch,
        operationId: randomUUID(),
        captureRelativePath,
        captureManifestSha256: capture.manifestSha256,
      },
    };
    await fs.mkdir(path.dirname(requestFile), { recursive: true, mode: 0o700 });
    await fs.writeFile(requestFile, JSON.stringify(job, null, 2), { flag: 'wx', mode: 0o600 });
  }
  if (
    job.format !== 'shiye-private-source-collection-request' ||
    job.version !== 1 ||
    job.sourceId !== capture.sourceId ||
    job.request?.captureManifestSha256 !== capture.manifestSha256 ||
    job.request.captureRelativePath !== captureRelativePath ||
    job.request.libraryId !== info.libraryId ||
    job.request.epoch !== info.epoch
  )
    fail('COMPUTER_COLLECTION_REQUEST_REUSED');
  if (
    !(db.sourceCollections?.receipts || []).some(
      (row) => row.operationId === job.request.operationId,
    )
  ) {
    const recipe = desktopCollectionRecipe(db, capture);
    if (recipe.summary.blockers.some((reason) => reason !== 'required-original-upload-needed'))
      fail('COMPUTER_COLLECTION_RECONCILIATION_REQUIRED');
    const unique = new Map(
      recipe.resources
        .filter((row) => row.required && !row.mediaId)
        .map((row) => [row.original.sha256, row.original]),
    );
    for (const original of unique.values()) {
      const member = capture.members.get(original.path);
      if (!member || member.sha256 !== original.sha256 || member.size !== original.size)
        fail('COMPUTER_CAPTURE_ORIGINAL_CHANGED');
      const file = path.join(captureDir, ...original.path.split('/'));
      const handle = await fs.open(file, 'r');
      try {
        const before = await handle.stat();
        if (before.size !== original.size) fail('COMPUTER_CAPTURE_ORIGINAL_CHANGED');
        const fileSource = {
          size: original.size,
          type: original.mime,
          name:
            'desktop-resource-' +
            original.sha256.slice(0, 16) +
            '.' +
            ({
              'image/png': 'png',
              'image/jpeg': 'jpg',
              'image/webp': 'webp',
              'image/gif': 'gif',
              'image/avif': 'avif',
            }[original.mime] || 'bin'),
          slice(start, end) {
            return {
              async arrayBuffer() {
                const bytes = Buffer.alloc(end - start);
                let offset = 0;
                while (offset < bytes.length) {
                  const read = await handle.read(
                    bytes,
                    offset,
                    bytes.length - offset,
                    start + offset,
                  );
                  if (!read.bytesRead) fail('COMPUTER_CAPTURE_ORIGINAL_CHANGED');
                  offset += read.bytesRead;
                }
                return bytes;
              },
            };
          },
        };
        const client = createSharedMediaClient({
          libraryId: info.libraryId,
          epoch: info.epoch,
          request: (action, input) => {
            if (
              action === 'media-begin' &&
              (input.metadata.sha256 !== original.sha256 || input.metadata.size !== original.size)
            )
              fail('COMPUTER_CAPTURE_ORIGINAL_CHANGED');
            return request(action, input);
          },
        });
        const digest = hash(
          Buffer.from(
            JSON.stringify([
              'shiye-desktop-source-media-v1',
              info.libraryId,
              capture.sourceId,
              original.sha256,
              original.size,
              original.mime,
            ]),
          ),
        );
        const operationId = [
          digest.slice(0, 8),
          digest.slice(8, 12),
          digest.slice(12, 16),
          digest.slice(16, 20),
          digest.slice(20, 32),
        ].join('-');
        const asset = await client.upload(fileSource, { operationId });
        const after = await handle.stat();
        if (
          before.size !== after.size ||
          before.mtimeMs !== after.mtimeMs ||
          asset.sha256 !== original.sha256 ||
          asset.size !== original.size
        )
          fail('COMPUTER_CAPTURE_ORIGINAL_CHANGED');
      } finally {
        await handle.close();
      }
    }
  }
  return request('source-collection-apply', job.request);
}
