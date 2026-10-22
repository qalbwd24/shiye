import { createHash } from 'node:crypto';
import { compilePreferenceSnapshot } from './preference-snapshot.mjs';
import { compileNotesSnapshot } from './notes-snapshot.mjs';
import { compileChatSnapshot } from './chat-snapshot.mjs';
import { validateSyncOperation } from '../sync-v2/store.mjs';
import { prepareProductPayload } from '../../../public/shared/sync-product.js';

const STATE_KEY = 'product:source-snapshots';
const MAX_SOURCES = 64;
const MAX_RECORDS = 8192;
const fail = (code, status = 409) => Object.assign(new Error(code), { status, code });
const canonical = (v) =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical(v[k])]),
        )
      : v;
const hash = (v) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(v)))
    .digest('hex');
const identity = (r) => JSON.stringify([r.entityType, r.entityId]);
const fingerprint = (r) => hash([r ? r.state || 'active' : 'absent', r?.data || {}]);
const tuple = (r) => [r.entityType, r.entityId, r.revision, fingerprint(r)];
const sameTarget = (a, b) =>
  (!a && !b) || (a && b && a.revision === b.revision && fingerprint(a) === fingerprint(b));
export const SOURCE_SNAPSHOTS = Object.freeze({
  version: 1,
  endpoint: 'api/product/v1/migration/snapshots',
  kinds: ['preferences', 'notes', 'chat'],
  readOnlyPreservation: true,
  automaticApplication: false,
  completeComputerExport: false,
});

/** Explicit logical inputs only. The ledger and every business row share one
 * SQLite transaction; immutable original files are verified before that commit. */
export function createSourceSnapshotService({
  store,
  media,
  publishPending,
  pack,
  serial,
  refresh,
  notify,
  clock,
}) {
  const state = () => store.readProductState(STATE_KEY) || { version: 1, sources: [] };
  const status = () => ({
    ...SOURCE_SNAPSHOTS,
    sources: state().sources.map(({ owned: _owned, ...head }) => head),
  });
  function compile(kind, body) {
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).some((k) => !['snapshot', 'sourceId', 'snapshotRevision'].includes(k))
    )
      throw fail('INVALID_SOURCE_SNAPSHOT_REQUEST', 400);
    let plan;
    if (kind === 'notes')
      plan = compileNotesSnapshot(body.snapshot, {
        sourceId: body.sourceId,
        ...(body.snapshotRevision === undefined ? {} : { snapshotRevision: body.snapshotRevision }),
      });
    else if (kind === 'preferences') plan = compilePreferenceSnapshot(body.snapshot);
    else plan = compileChatSnapshot(body.snapshot);
    if (
      (body.sourceId !== undefined && body.sourceId !== plan.sourceId) ||
      (body.snapshotRevision !== undefined && body.snapshotRevision !== plan.snapshotRevision)
    )
      throw fail('SOURCE_IDENTITY_MISMATCH', 400);
    if (plan.records.length > MAX_RECORDS) throw fail('SOURCE_RECORD_LIMIT', 413);
    return plan;
  }
  async function verifyOriginal(spec) {
    const asset = await media.getAsset(spec.assetId);
    if (asset.sha256 !== spec.sha256 || asset.size !== spec.size || asset.mime !== spec.mime)
      throw fail('SOURCE_ASSET_MISMATCH', 422);
    const digest = createHash('sha256');
    for (let start = 0; start < spec.size; start += 1048576) {
      const end = Math.min(spec.size - 1, start + 1048575);
      const bytes = await media.readContent(spec.assetId, { start, end });
      if (bytes.length !== end - start + 1) throw fail('SOURCE_ASSET_MISMATCH', 422);
      digest.update(bytes);
    }
    if (digest.digest('hex') !== spec.sha256) throw fail('SOURCE_ASSET_MISMATCH', 422);
  }
  async function publishOriginal(spec) {
    if (
      !Buffer.isBuffer(spec.bytes) ||
      spec.bytes.length !== spec.size ||
      createHash('sha256').update(spec.bytes).digest('hex') !== spec.sha256
    )
      throw fail('SOURCE_ASSET_MISMATCH', 422);
    const upload = await media.begin(spec);
    for (const i of upload.missingChunks)
      await media.putChunk(
        upload.uploadId,
        i,
        spec.bytes.subarray(i * upload.chunkSize, Math.min(spec.size, (i + 1) * upload.chunkSize)),
      );
    await media.complete(upload.uploadId);
    await publishPending();
    await verifyOriginal(spec);
  }
  async function ingest(kind, body) {
    const plan = compile(kind, body);
    return serial(async () => {
      const ledger = state();
      const sourceIndex = ledger.sources.findIndex(
        (s) => s.kind === kind && s.sourceId === plan.sourceId,
      );
      const prior = ledger.sources[sourceIndex];
      if (prior) {
        if (plan.snapshotRevision < prior.snapshotRevision) throw fail('SOURCE_REVISION_OLD');
        if (plan.snapshotRevision === prior.snapshotRevision) {
          if (plan.sourceSha256 !== prior.sourceSha256) throw fail('SOURCE_REVISION_CONFLICT');
          return { ...prior.receipt, replayed: true };
        }
      } else if (ledger.sources.length >= MAX_SOURCES) throw fail('SOURCE_LIMIT', 413);
      const owned = new Map((prior?.owned || []).map((r) => [JSON.stringify(r.slice(0, 2)), r]));
      const targets = new Map();
      const planned = plan.records.map((r) =>
        r.state === 'withdrawn' ? r : prepareProductPayload(r).record,
      );
      for (const record of planned) {
        const id = identity(record),
          old = store.getEntity(record.entityType, record.entityId);
        const proof = owned.get(id);
        targets.set(id, old);
        if (proof && (!old || old.revision !== proof[2] || fingerprint(old) !== proof[3]))
          throw fail('SOURCE_TARGET_CHANGED');
        if (old?.state === 'withdrawn' && record.state !== 'withdrawn')
          throw fail('SOURCE_TOMBSTONE_FINAL');
        if (!proof && old && fingerprint(old) !== fingerprint(record))
          throw fail('SOURCE_TARGET_EXISTS');
        if (old && old.state !== 'active' && record.state !== 'withdrawn')
          throw fail('SOURCE_TARGET_CHANGED');
        if (
          record.entityType === 'chatMessage' &&
          old?.state === 'active' &&
          record.state === 'active' &&
          fingerprint(old) !== fingerprint(record)
        )
          throw fail('SOURCE_MESSAGE_IMMUTABLE');
      }
      if (
        new Set([...owned.keys(), ...targets.keys()]).size > MAX_RECORDS ||
        ledger.sources.reduce((n, s) => n + (s === prior ? 0 : s.owned.length), 0) +
          new Set([...owned.keys(), ...targets.keys()]).size >
          MAX_RECORDS
      )
        throw fail('SOURCE_RECORD_LIMIT', 413);
      // Declarations are never accepted as proof that originals arrived.
      for (const spec of plan.requiredAssets || []) await verifyOriginal(spec);
      for (const spec of plan.assets || []) await publishOriginal(spec);
      const available = new Set(
        [...(plan.assets || []), ...(plan.requiredAssets || [])].map((a) => a.assetId),
      );
      for (const record of plan.records)
        for (const id of record.data?._product?.refs?.assets || [])
          if (!available.has(id)) throw fail('SOURCE_ASSET_UNDECLARED', 422);
      const operations = [],
        replacement = new Map();
      const prefix = `source:${hash([kind, plan.sourceId, plan.snapshotRevision, plan.sourceSha256])}`;
      for (const raw of plan.records) {
        const id = identity(raw),
          old = targets.get(id);
        const record = raw.state === 'withdrawn' ? raw : await pack(raw);
        if (old && fingerprint(old) === fingerprint(record)) {
          owned.set(id, tuple(old));
          continue;
        }
        const op = {
          operationId: `${prefix}:${operations.length}`,
          entityType: record.entityType,
          entityId: record.entityId,
          baseRevision: old?.revision || 0,
          command: record.state === 'withdrawn' ? 'withdraw' : old ? 'updateFields' : 'create',
          ...(record.state === 'withdrawn' ? {} : { [old ? 'changes' : 'data']: record.data }),
        };
        validateSyncOperation(op, { serverWrite: true });
        operations.push(op);
        if (record.state !== 'withdrawn') replacement.set(op.operationId, record.data);
        owned.set(
          id,
          tuple({ ...record, revision: (old?.revision || 0) + 1, state: record.state || 'active' }),
        );
      }
      const receipt = {
        kind,
        sourceId: plan.sourceId,
        snapshotRevision: plan.snapshotRevision,
        sourceSha256: plan.sourceSha256,
        recordCount: plan.records.length,
        changedRecords: operations.length,
        assetCount: (plan.assets || []).length + (plan.requiredAssets || []).length,
        completeComputerExport: false,
        replayed: false,
      };
      const head = {
        kind,
        sourceId: plan.sourceId,
        snapshotRevision: plan.snapshotRevision,
        sourceSha256: plan.sourceSha256,
        appliedAt: new Date(clock()).toISOString(),
        coverage: { ...plan.coverage, originalBytesVerified: true },
        receipt,
        owned: [...owned.values()],
      };
      if (sourceIndex < 0) ledger.sources.push(head);
      else ledger.sources[sourceIndex] = head;
      store.push('product-source-import', operations, {
        atomic: true,
        serverWrite: true,
        productState: { key: STATE_KEY, value: ledger },
        beforeApply: (op, actual) => {
          if (!sameTarget(targets.get(identity(op)), actual)) throw fail('SOURCE_TARGET_CHANGED');
          return replacement.has(op.operationId)
            ? { replaceData: replacement.get(op.operationId) }
            : undefined;
        },
      });
      await refresh();
      notify();
      return receipt;
    });
  }
  return {
    status,
    async handle(req, res, { route, readJson, json }) {
      const base = 'api/product/v1/migration/snapshots';
      if (route === base && req.method === 'GET') {
        json(res, 200, status());
        return true;
      }
      const kind = route.startsWith(base + '/') ? route.slice(base.length + 1) : '';
      if (!SOURCE_SNAPSHOTS.kinds.includes(kind)) return false;
      if (req.method !== 'POST') throw fail('METHOD_NOT_ALLOWED', 405);
      const maxBytes = (kind === 'notes' ? 48 : kind === 'chat' ? 16 : 4) * 1024 * 1024 + 4096;
      json(res, 200, await ingest(kind, await readJson(req, maxBytes)));
      return true;
    },
  };
}
