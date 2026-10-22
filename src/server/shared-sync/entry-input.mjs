import { promises as fs, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
const fail = (status, code) => {
  throw Object.assign(new Error(code), { status, code });
};
const uuid = (value) =>
  typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
/** A large Entry is an already verified original, referenced by a small immutable
 * command. It still passes the original Entry route/domain and revision checks.
 */
export async function sharedEntryInput({ store, dataDir, input, action }) {
  if (
    Object.keys(input).some(
      (key) =>
        !['payloadAssetId', 'payloadOperationId', 'entryId', 'expectedRevision'].includes(key),
    ) ||
    (Object.hasOwn(input, 'payloadAssetId') && Object.hasOwn(input, 'payloadOperationId'))
  )
    fail(400, 'SHARED_INVALID_ENTRY_PAYLOAD');
  if (
    (!uuid(input.payloadAssetId) && !uuid(input.payloadOperationId)) ||
    (action === 'entry-save-ref' &&
      (!uuid(input.entryId) ||
        !Number.isSafeInteger(input.expectedRevision) ||
        input.expectedRevision < 1))
  )
    fail(400, 'SHARED_INVALID_ENTRY_PAYLOAD');
  const assetId = input.payloadOperationId
    ? store.getDb()._sharedMedia?.find((row) => row.operationId === input.payloadOperationId)
        ?.result.id
    : input.payloadAssetId;
  if (!assetId) fail(503, 'SHARED_ENTRY_PAYLOAD_NOT_UPLOADED');
  const asset = store.getDb().media.find((row) => row.id === assetId);
  if (
    !asset ||
    !['application/vnd.shiye.shared-entry+json', 'application/json'].includes(asset.type) ||
    !Number.isSafeInteger(asset.size) ||
    asset.size < 1 ||
    asset.size > 64 * 1024 * 1024 ||
    !/^[a-f0-9]{64}$/.test(asset.sha256 || '')
  )
    fail(400, 'SHARED_INVALID_ENTRY_PAYLOAD');
  const file = path.join(dataDir, 'media', asset.id);
  if ((await fs.stat(file)).size !== asset.size) fail(409, 'SHARED_ENTRY_PAYLOAD_CHANGED');
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  if (hash.digest('hex') !== asset.sha256) fail(409, 'SHARED_ENTRY_PAYLOAD_CHANGED');
  const bytes = await fs.readFile(file);
  if (
    bytes.length !== asset.size ||
    createHash('sha256').update(bytes).digest('hex') !== asset.sha256
  )
    fail(409, 'SHARED_ENTRY_PAYLOAD_CHANGED');
  let value;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    fail(400, 'SHARED_INVALID_ENTRY_PAYLOAD');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.chatJournal)
    fail(400, 'SHARED_INVALID_ENTRY_PAYLOAD');
  if (action === 'entry-save-ref') {
    if (value.id !== input.entryId || value.revision !== input.expectedRevision)
      fail(409, 'SHARED_ENTRY_PAYLOAD_REVISION');
    if (store.getDb().entries.find((entry) => entry.id === input.entryId)?.chatJournal)
      fail(409, 'SHARED_JOURNAL_COMMAND_REQUIRED');
  }
  return value;
}
