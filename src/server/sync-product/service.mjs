import { randomUUID } from 'node:crypto';
import {
  productRecord,
  productValue,
  productLibraryView,
  validateProductRecord,
  prepareProductPayload,
  hydrateProductPayload,
  productConversationId,
} from '../../../public/shared/sync-product.js';
import { createRoutes as revisitRoutes } from '../routes/revisit.mjs';
import { fail as diaryFail } from '../http.mjs';
import {
  saveChatRoom,
  appendChatMessages,
  withdrawChatMessage,
  projectChatEntry,
} from '../domain/chat-journal.mjs';
import { planLegacyProductImport } from './legacy-adapter.mjs';
import { createRevisitDeliveryService } from '../domain/revisit/delivery/service.mjs';
import { canonicalSeedRecord } from './portable.mjs';
import { createProductSeedService } from './seed-service.mjs';
import { setImmediate as yieldImmediate } from 'node:timers/promises';
import { PRODUCT_PAYLOAD_WRITES, guardProductPayloadWrite } from './payload-write-policy.mjs';
import { createSourceSnapshotService, SOURCE_SNAPSHOTS } from './source-snapshots.mjs';

const key = (type, id) => JSON.stringify([type, id]);
const fail = (status, code) => Object.assign(new Error(code), { status, code });
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const RUNTIME_ID = 'product:revisit-state';
const READ_ONLY = new Set([
  'serverState',
  'serviceConfig',
  'binding',
  'comment',
  'delivery',
  'message',
]);

/** Product-specific policy over the same authenticated, durable replication protocol. */
export function productSyncExtension({ autoTickMs = 30000 } = {}) {
  return async ({ store, media, publishPending, notify, clock, dataDir }) => {
    const index = new Map(),
      hydrated = new Map();
    let cursor,
      queue = Promise.resolve(),
      closed = false,
      timer = null;
    let lastTick = null,
      lastError = null,
      ticking = false;
    const serial = (fn) => {
      const next = queue.then(fn);
      queue = next.catch(() => {});
      return next;
    };
    async function readProductPayload(record) {
      const ref = record.data._product.payload;
      if (
        !Number.isSafeInteger(ref.size) ||
        ref.size < 1 ||
        ref.size > PRODUCT_PAYLOAD_WRITES.maxBytes
      )
        throw fail(413, 'PRODUCT_PAYLOAD_TOO_LARGE');
      const asset = await media.getAsset(ref.assetId);
      if (asset.size !== ref.size || asset.sha256 !== ref.sha256)
        throw fail(422, 'PRODUCT_PAYLOAD_HASH_MISMATCH');
      return hydrateProductPayload(record, await media.readContent(ref.assetId));
    }
    async function remember(record) {
      index.set(key(record.entityType, record.entityId), record);
      if (record.state === 'active' && record.data?._product?.payload) {
        if (hydrated.get(key(record.entityType, record.entityId))?.revision !== record.revision) {
          hydrated.set(key(record.entityType, record.entityId), await readProductPayload(record));
        }
      } else hydrated.delete(key(record.entityType, record.entityId));
    }
    async function refresh() {
      if (!cursor) {
        let page, snapshotCursor;
        do {
          page = store.snapshot({ cursor: snapshotCursor, limit: 200 });
          for (const item of page.entities) await remember(item);
          snapshotCursor = page.cursor;
        } while (page.hasMore);
        cursor = page.checkpoint;
      }
      let page;
      do {
        page = store.pull({ cursor, limit: 200 });
        for (const item of page.changes) await remember(item.entity);
        cursor = page.cursor;
      } while (page.hasMore);
    }
    function recordList() {
      return [...index.values()].map((r) => hydrated.get(key(r.entityType, r.entityId)) || r);
    }
    function view() {
      const records = recordList();
      const db = productLibraryView(records);
      db.settings = {
        preferences: db.appearances.find((a) => a.scope === 'library')?.preferences || {},
      };
      db.chatJournal = { version: 1, rooms: db.conversations, withdrawals: [] };
      db.revisit = store.readProductState(RUNTIME_ID) || undefined;
      if (db.revisit?._categoryIds) {
        const names = new Map(
          records
            .filter((r) => r.state === 'active' && r.data?._product?.kind === 'taxonomy')
            .map((r) => [r.entityId, r.data.name]),
        );
        db.revisit.config.categories = db.revisit._categoryIds
          .map((id) => names.get(id))
          .filter(Boolean);
      }
      for (const entry of db.entries)
        if (entry.chatJournal) {
          const source = records.find(
            (r) => r.entityType === 'journalAggregate' && r.entityId === entry.id,
          );
          const ids = source.data._product.refs.messages || [];
          const original = entry.chatJournal.messages || [];
          entry.chatJournal.category = entry.category;
          entry.chatJournal.messages = ids.map((id, i) => {
            const record = index.get(key('chatMessage', id));
            return record?.state === 'active'
              ? productValue(hydrated.get(key('chatMessage', id)) || record)
              : {
                  id: original[i]?.id || id,
                  sentAt: original[i]?.sentAt || entry.date,
                  text: '',
                  attachments: [],
                  withdrawn: true,
                };
          });
          for (const m of entry.chatJournal.messages)
            if (m.withdrawn)
              db.chatJournal.withdrawals.push({
                sourceId: entry.chatJournal.sourceId,
                roomId: entry.chatJournal.roomId,
                messageId: m.id,
                sentAt: m.sentAt,
              });
          projectChatEntry(entry, db, clock(), { historical: true, preserveRevision: true });
        }
      return db;
    }
    async function pack(record) {
      const prepared = prepareProductPayload(record);
      if (prepared.payload) {
        const payload = prepared.payload,
          upload = await media.begin(payload);
        for (const i of upload.missingChunks)
          await media.putChunk(
            upload.uploadId,
            i,
            payload.bytes.subarray(
              i * upload.chunkSize,
              Math.min(payload.size, (i + 1) * upload.chunkSize),
            ),
          );
        await media.complete(upload.uploadId);
        await publishPending();
      }
      return prepared.record;
    }
    async function commit(records, operationPrefix = randomUUID(), productState) {
      const operations = [];
      for (const record of records) {
        const old = store.getEntity(record.entityType, record.entityId);
        const packed = await pack(record);
        if (old?.data?._product?.sourceSnapshot) {
          if (equal(old.data, packed.data) && record.state !== 'withdrawn') continue;
          throw fail(409, 'PRODUCT_SOURCE_READ_ONLY');
        }
        if (old?.state === 'withdrawn') continue;
        if (old && equal(old.data, packed.data) && record.state !== 'withdrawn') continue;
        operations.push({
          operationId: `${operationPrefix}:${operations.length}`,
          entityType: packed.entityType,
          entityId: packed.entityId,
          command: old ? 'updateFields' : 'create',
          baseRevision: old?.revision || 0,
          ...(old ? { changes: packed.data } : { data: packed.data }),
        });
        if (record.state === 'withdrawn')
          operations.push({
            operationId: `${operationPrefix}:${operations.length}`,
            entityType: packed.entityType,
            entityId: packed.entityId,
            command: 'withdraw',
            baseRevision: (old?.revision || 0) + 1,
          });
      }
      if (operations.length || productState) {
        store.push('product-server', operations, { atomic: true, productState, serverWrite: true });
        notify();
      }
      await refresh();
      return operations.length;
    }
    async function validatePush(operations) {
      if (!Array.isArray(operations)) throw fail(400, 'INVALID_BATCH');
      const candidates = new Map(recordList().map((r) => [key(r.entityType, r.entityId), r]));
      for (const op of operations) {
        const previous = index.get(key(op.entityType, op.entityId));
        const payload =
          op.command === 'create'
            ? op.data
            : op.command === 'updateFields'
              ? { ...previous?.data, ...op.changes }
              : previous?.data;
        if (!payload) throw fail(409, 'PRODUCT_ENTITY_NOT_FOUND');
        validateProductRecord(op.entityType, op.entityId, payload);
        const meta = payload._product;
        if (
          READ_ONLY.has(meta.kind) ||
          meta.readOnlyProjection ||
          previous?.data?._product?.readOnlyProjection
        )
          throw fail(403, 'PRODUCT_USE_BUSINESS_COMMAND');
        if (
          previous &&
          (previous.data._product.kind !== meta.kind ||
            !equal(previous.data._product.refs.origin, meta.refs.origin))
        )
          throw fail(409, 'PRODUCT_IDENTITY_IMMUTABLE');
        if (payload.chatJournal) throw fail(403, 'CHAT_PROJECTION_READ_ONLY');
        if (meta.payload)
          await readProductPayload({
            entityType: op.entityType,
            entityId: op.entityId,
            data: payload,
          });
        candidates.set(key(op.entityType, op.entityId), {
          entityType: op.entityType,
          entityId: op.entityId,
          data: payload,
          state: op.command === 'delete' ? 'deleted' : 'active',
        });
      }
      const taxonomy = new Set(
        [...candidates.values()]
          .filter((r) => r.state === 'active' && r.data?._product?.kind === 'taxonomy')
          .map((r) => r.entityId),
      );
      for (const r of candidates.values())
        if (r.state === 'active') {
          const refs = r.data?._product?.refs;
          if (
            refs &&
            [refs.category, ...(refs.tags || [])].filter(Boolean).some((id) => !taxonomy.has(id))
          )
            throw fail(409, 'TAXONOMY_REFERENCE_MISSING');
        }
    }
    async function persistRuntime(next) {
      const records = [];
      if (next.revisit?.config)
        next.revisit._categoryIds = next.revisit.config.categories
          .map(
            (name) =>
              recordList().find(
                (r) =>
                  r.state === 'active' &&
                  r.data?._product?.kind === 'taxonomy' &&
                  r.data.kind === 'category' &&
                  r.data.name === name,
              )?.entityId,
          )
          .filter(Boolean);
      if (next.revisit?.config)
        records.push(
          productRecord('serviceConfig', 'product:revisit-config', { config: next.revisit.config }),
        );
      for (const item of next.revisit?.comments || []) {
        const record = productRecord('comment', item.id, item);
        if (item.state === 'withdrawn' || item.withdrawn) record.state = 'withdrawn';
        records.push(record);
      }
      for (const item of next.revisit?.deliveries || [])
        records.push(productRecord('delivery', item.id, item));
      await commit(records, randomUUID(), { key: RUNTIME_ID, value: next.revisit || null });
    }
    async function mutate(fn) {
      return serial(async () => {
        await refresh();
        const db = view(),
          result = fn(db);
        if (result?.then) throw fail(500, 'ASYNC_PRODUCT_TRANSACTION');
        await persistRuntime(db);
        return result;
      });
    }
    const context = {
      getDb: view,
      mutate,
      fail: diaryFail,
      clock,
      reply: (res, status, value) => {
        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(value));
        return true;
      },
      body: async (req, limit = 4194304) => {
        const chunks = [];
        let size = 0;
        for await (const part of req) {
          size += part.length;
          if (size > limit) throw fail(413, 'REQUEST_TOO_LARGE');
          chunks.push(part);
        }
        return Buffer.concat(chunks);
      },
    };
    const revisit = revisitRoutes(context);
    const delivery = createRevisitDeliveryService(
      { read: (fn) => fn(view()), transaction: mutate },
      { clock },
    );
    const seeds = await createProductSeedService({
      dataDir,
      store,
      media,
      publishPending,
      clock,
      capture: () =>
        serial(async () => {
          await refresh();
          const assets = recordList()
            .filter((r) => r.data?._product?.kind === 'media' && r.state === 'active')
            .map((r) => productValue(r));
          const upgrades = [];
          let inspected = 0;
          for (const record of recordList()) {
            try {
              const prepared = canonicalSeedRecord(record, { media: assets });
              if (prepared !== record) upgrades.push(prepared);
            } catch (error) {
              error.entityId = record.entityId;
              throw error;
            }
            if (++inspected % 25 === 0) await yieldImmediate();
          }
          // All source conversions pass before the independent sync authority is upgraded.
          for (let i = 0; i < upgrades.length; i += 4) await commit(upgrades.slice(i, i + 4));
          const records = [];
          let cursor, page;
          do {
            page = store.snapshot({ cursor, limit: 200 });
            records.push(...page.entities);
            cursor = page.cursor;
          } while (page.hasMore);
          return {
            records,
            identity: { ...store.info(), watermark: page.watermark, checkpoint: page.checkpoint },
          };
        }),
      initialize: (parsed, registerMedia) =>
        serial(async () => {
          const receiptKey = 'seed-initialize:' + parsed.sha256;
          const prior = store.readProductState(receiptKey);
          if (prior) return { ...prior, replayed: true };
          await refresh();
          if (recordList().some((r) => r.entityType !== 'asset'))
            throw fail(409, 'SEED_TARGET_NOT_EMPTY');
          const operations = [];
          for (const record of parsed.records.filter((r) => r.entityType !== 'asset')) {
            operations.push({
              operationId: `seed:${parsed.sha256}:${operations.length}`,
              entityType: record.entityType,
              entityId: record.entityId,
              command: 'create',
              baseRevision: 0,
              data: record.state === 'active' ? record.data : {},
            });
            if (record.state !== 'active')
              operations.push({
                operationId: `seed:${parsed.sha256}:${operations.length}`,
                entityType: record.entityType,
                entityId: record.entityId,
                command: record.state === 'withdrawn' ? 'withdraw' : 'delete',
                baseRevision: 1,
              });
          }
          if (
            operations.length > 10000 ||
            Buffer.byteLength(JSON.stringify(operations)) > 60 * 1024 ** 2
          )
            throw fail(413, 'SEED_INITIALIZE_TRANSACTION_LIMIT');
          await registerMedia();
          const receipt = {
            packageSha256: parsed.sha256,
            sourceLibraryId: parsed.manifest.libraryId,
            targetLibraryId: store.info().libraryId,
            targetEpoch: store.info().epoch,
            entities: parsed.records.length,
            assets: parsed.manifest.assetCount,
            mode: 'initialize-empty',
            requiresPairing: true,
            sourceCursorReusable: false,
          };
          store.push('product-server', operations, {
            atomic: true,
            serverWrite: true,
            productState: { key: receiptKey, value: receipt },
          });
          await refresh();
          notify();
          return receipt;
        }),
    });
    await refresh();
    if (autoTickMs > 0) {
      timer = setInterval(
        () => {
          if (closed) return;
          if (!ticking && view().revisit?.config?.enabled) {
            ticking = true;
            void delivery
              .tick()
              .then(() => {
                lastTick = new Date(clock()).toISOString();
                lastError = null;
              })
              .catch((error) => {
                lastError = error.code || 'REVISIT_TICK_FAILED';
              })
              .finally(() => {
                ticking = false;
              });
          }
        },
        Math.max(1000, autoTickMs),
      );
      timer.unref();
    }
    const sourceSnapshots = createSourceSnapshotService({
      store,
      media,
      publishPending,
      pack,
      serial,
      refresh,
      notify,
      clock,
    });
    return {
      features: {
        schema: 1,
        entities: 1,
        legacyImport: 1,
        payloadAssets: true,
        revisit: 1,
        seed: 1,
        stickerTags: 1,
        migrationMetadata: 1,
        payloadWrites: PRODUCT_PAYLOAD_WRITES,
        sourceSnapshots: SOURCE_SNAPSHOTS,
      },
      status: () => ({ lastTick, lastError, autoTickMs }),
      async push(device, operations) {
        return serial(async () => {
          await refresh();
          await validatePush(operations);
          const result = store.push(device.deviceId, operations, {
            atomic: true,
            beforeApply: guardProductPayloadWrite,
            validateEntity: (record) => {
              try {
                validateProductRecord(record.entityType, record.entityId, record.data);
              } catch {
                throw fail(409, 'PRODUCT_CONCURRENT_STRUCTURE_CONFLICT');
              }
            },
          });
          await refresh();
          return result;
        });
      },
      async importPlan(plan) {
        return serial(async () => {
          let count = 0;
          for (let i = 0; i < plan.records.length; i += 4)
            count += await commit(plan.records.slice(i, i + 4));
          return { count, issues: plan.issues };
        });
      },
      async importRuntime(state) {
        return serial(async () => {
          if (!state || store.readProductState(RUNTIME_ID)) return false;
          const next = view();
          next.revisit = structuredClone(state);
          next.revisit.config.enabled = false;
          next.revisit.cursor = null;
          await persistRuntime(next);
          return true;
        });
      },
      async handle(req, res, { route, url, readJson, json, device }) {
        if (!route.startsWith('api/product/v1/')) return false;
        if (await sourceSnapshots.handle(req, res, { route, readJson, json })) return true;
        if (await seeds.handle(req, res, { route, url, readJson, json, device })) return true;
        await refresh();
        const action = route.slice('api/product/v1/'.length);
        if (action === 'migration/coverage' && req.method === 'GET') {
          const snapshots = recordList().filter(
            (r) =>
              r.state === 'active' &&
              r.data?._product?.kind === 'profile' &&
              r.data.scope === 'migration-metadata',
          );
          json(res, 200, {
            version: 1,
            libraryId: store.info().libraryId,
            epoch: store.info().epoch,
            completeComputerExport: false,
            sources: snapshots.map((r) => ({
              sourceId: r.data.sourceId,
              coverage: r.data.coverage,
            })),
            kinds: Object.fromEntries(
              [
                ...new Set(
                  recordList()
                    .map((r) => r.data?._product?.kind)
                    .filter(Boolean),
                ),
              ].map((kind) => [
                kind,
                recordList().filter((r) => r.data?._product?.kind === kind).length,
              ]),
            ),
          });
          return true;
        }
        if (action === 'catalog' && req.method === 'GET') {
          json(res, 200, {
            schema: 1,
            migrationMetadata: {
              version: 1,
              coverage: 'api/product/v1/migration/coverage',
              readOnlyPreservation: true,
              completeComputerExport: false,
            },
            payloadWrites: PRODUCT_PAYLOAD_WRITES,
            sourceSnapshots: SOURCE_SNAPSHOTS,
            libraryId: store.info().libraryId,
            epoch: store.info().epoch,
            seed: {
              version: 1,
              format: 'shiye-product-seed',
              extension: '.syseed',
              endpoint: 'api/product/v1/seed/',
              clientWallpaper: 'device-local',
              stickerMetadata: 'shared',
              stickerTags: true,
            },
            types: [
              'entry',
              'message',
              'conversation',
              'taxonomy',
              'order',
              'appearance',
              'profile',
              'sticker',
              'commandMapping',
              'media',
            ],
            readOnlyKinds: [...READ_ONLY],
            services: [{ id: 'revisit', endpoint: 'api/product/v1/revisit' }],
          });
          return true;
        }
        if (action === 'library' && req.method === 'GET') {
          json(res, 200, view());
          return true;
        }
        if (action === 'revisit' && req.method === 'GET') {
          json(res, 200, { ...delivery.status(), runner: { autoTickMs, lastTick, lastError } });
          return true;
        }
        if (action === 'revisit' || action.startsWith('revisit/')) {
          const suffix = action === 'revisit' ? '' : action.slice('revisit/'.length);
          if (
            ![
              '',
              'config',
              'tick',
              'feed',
              'comments',
              'comments/context',
              'comments/withdraw',
              'source',
            ].includes(suffix)
          )
            throw fail(404, 'PRODUCT_ACTION_NOT_FOUND');
          const pathname = '/api/revisit' + (suffix ? '/' + suffix : '');
          const facade = {
            method: req.method,
            headers: req.headers,
            socket: req.socket,
            url: pathname + url.search,
            [Symbol.asyncIterator]: () => req[Symbol.asyncIterator](),
          };
          return !!(await revisit(facade, res, pathname));
        }
        if (action === 'chat/room' && req.method === 'POST') {
          const input = await readJson(req);
          const result = await serial(async () => {
            await refresh();
            const db = view();
            const room = saveChatRoom(db, input);
            const targetId = productConversationId(room.sourceId, room.id);
            if (index.get(key('conversation', targetId))?.data?._product?.readOnlyProjection)
              throw fail(409, 'PRODUCT_SOURCE_READ_ONLY');
            const saved = db.chatJournal.rooms.find(
              (r) => r.sourceId === room.sourceId && r.id === room.id,
            );
            if (input.configuration !== undefined) {
              if (
                !input.configuration ||
                typeof input.configuration !== 'object' ||
                Array.isArray(input.configuration)
              )
                throw fail(400, 'INVALID_ROOM_CONFIGURATION');
              saved.configuration = structuredClone(input.configuration);
            }
            const plan = planLegacyProductImport({ ...db, entries: [], media: [] }, planOptions());
            await commit(
              plan.records.filter(
                (r) => r.entityType === 'conversation' && r.entityId === targetId,
              ),
            );
            return saved;
          });
          json(res, 200, result);
          return true;
        }
        if (['chat/send', 'chat/withdraw'].includes(action) && req.method === 'POST') {
          const input = await readJson(req);
          const result = await serial(async () => {
            await refresh();
            if (
              input.sourceId &&
              input.roomId &&
              index.get(key('conversation', productConversationId(input.sourceId, input.roomId)))
                ?.data?._product?.readOnlyProjection
            )
              throw fail(409, 'PRODUCT_SOURCE_READ_ONLY');
            const db = view();
            const outcome = action.endsWith('send')
              ? appendChatMessages(db, input, clock())
              : withdrawChatMessage(db, input, clock());
            const touched = db.entries.filter(
              (e) =>
                e.chatJournal?.sourceId === input.sourceId && e.chatJournal.roomId === input.roomId,
            );
            const plan = planLegacyProductImport({ ...db, entries: touched }, planOptions());
            if (plan.issues.length) throw fail(409, 'CHAT_ADAPTER_REJECTED');
            await commit(
              plan.records.filter(
                (r) => r.entityType === 'journalAggregate' || r.entityType === 'chatMessage',
              ),
            );
            return outcome;
          });
          json(res, 200, result);
          return true;
        }
        throw fail(404, 'PRODUCT_ACTION_NOT_FOUND');
      },
      async close() {
        closed = true;
        if (timer) clearInterval(timer);
        await seeds.close();
        await queue;
      },
    };
    function planOptions() {
      const taxonomyIdentity = {};
      for (const r of recordList())
        if (r.state === 'active' && r.data?._product?.kind === 'taxonomy') {
          taxonomyIdentity[JSON.stringify([r.data.kind, r.data.name])] = r.entityId;
        }
      return { sourceId: store.info().libraryId, taxonomyIdentity };
    }
  };
}
