import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { sharedInfo, sharedSnapshot, sharedPull } from './replication.mjs';
import { createSharedMedia } from './media.mjs';
import { saveSharedClientPreferences } from './preferences.mjs';
import { appendChatMessages } from '../domain/chat-journal.mjs';
import {
  applyLocalMessageEdit,
  applyLocalMessageWithdrawal,
  describeLocalMessageEdit,
} from '../domain/local-message-edits.mjs';
import { validateEntry } from '../domain/entries.mjs';
import { replaceEntry } from '../domain/quick-entry.mjs';
import { createEntryWithId } from '../routes/entries.mjs';
import {
  createLocalDirectoryConversation,
  saveDirectoryOrder,
  updateDirectoryState,
} from '../conversation-services/directory.mjs';
import { saveConversation } from '../conversation-services/conversations.mjs';
import { verifyDeferredMedia, claimDeferredMedia } from './deferred-media.mjs';
import { sharedEntryInput } from './entry-input.mjs';
import { createSharedEntityPayload } from './entity-payload.mjs';
import { resolveSharedSeed, registerSharedSeed, readSharedSeedSigningKey } from './seed.mjs';
import { readSharedConversationFeed, createSharedFeedPayload } from './conversation-feed.mjs';
import {
  readConversationWallpaper,
  validateWallpaperInput,
  verifyWallpaperOriginal,
  saveConversationWallpaper,
} from '../conversation-services/wallpaper.mjs';

const fail = (status, code) => Object.assign(new Error(code), { status, code });
const uuid = (id) =>
  typeof id === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id);
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
const object = (v) => v && typeof v === 'object' && !Array.isArray(v);
const BASE = '/api/shared/v1/';
const LARGE_ENTRY = Symbol('shared-entry-payload');
export const SHARED_ACTIONS = Object.freeze({
  'wallpaper-read': ['POST', '/api/shared/v1/wallpaper/read'],
  'wallpaper-save': ['POST', '/api/shared/v1/wallpaper/save'],
  'conversation-list': ['GET', '/api/conversation-services/conversations'],
  'conversation-create': ['POST', '/api/conversation-services/conversations'],
  'conversation-create-local': ['POST', '/api/shared/v1/command'],
  'conversation-save-local': ['POST', '/api/shared/v1/command'],
  'conversation-state-local': ['POST', '/api/shared/v1/command'],
  'conversation-order-local': ['POST', '/api/shared/v1/command'],
  'conversation-list-state': ['PUT', '/api/conversation-services/conversations/list-state'],
  'conversation-order': ['PUT', '/api/conversation-services/conversations/order'],
  'conversation-read': ['POST', '/api/conversation-services/conversations/state'],
  'conversation-save': ['PUT', '/api/conversation-services/conversations/state'],
  'service-settings-read': ['POST', '/api/conversation-services/settings/read'],
  'service-settings-save': ['POST', '/api/conversation-services/settings/save'],
  'service-request': ['POST', '/api/conversation-services/request'],
  'conversation-feed': ['POST', '/api/conversation-services/conversations/feed'],
  'conversation-context': ['POST', '/api/conversation-services/conversations/context'],
  'conversation-send': ['POST', '/api/conversation-services/conversations/send'],
  'conversation-withdraw': ['POST', '/api/conversation-services/conversations/withdraw'],
  'journal-send': ['POST', '/api/chat-journal/messages'],
  'journal-withdraw': ['POST', '/api/chat-journal/withdraw'],
  'journal-receipts': ['POST', '/api/chat-journal/receipts'],
  'message-edit-local': ['POST', '/api/shared/v1/command'],
  'message-withdraw-local': ['POST', '/api/shared/v1/command'],
  'message-describe-local': ['POST', '/api/shared/v1/command'],
  'entry-read': ['GET', '/api/entries/:entryId'],
  'entry-create': ['POST', '/api/entries'],
  'entry-create-local': ['POST', '/api/shared/v1/command'],
  'entry-save-local': ['POST', '/api/shared/v1/command'],
  'entry-save': ['PUT', '/api/entries/:entryId'],
  'entry-create-ref': ['POST', '/api/entries'],
  'entry-save-ref': ['PUT', '/api/entries/:entryId'],
  'entry-delete': ['PUT', '/api/entries/:entryId'],
  'entry-restore': ['PUT', '/api/entries/:entryId'],
  'taxonomy-save': ['POST', '/api/taxonomy'],
  'taxonomy-order': ['PUT', '/api/taxonomy/order'],
  'template-create': ['POST', '/api/templates'],
  'template-save': ['PUT', '/api/templates/:templateId'],
  'comment-create': ['POST', '/api/entries/:entryId/comments'],
  'comment-save': ['PUT', '/api/entries/:entryId/comments/:commentId'],
  'preferences-save': ['PUT', '/api/preferences'],
  'client-preferences-save': ['POST', '/api/shared/v1/client-preferences'],
  'sticker-catalog': ['GET', '/api/stickers/catalog'],
  'sticker-from-message': ['POST', '/api/stickers/from-message'],
  'sticker-collect': ['POST', '/api/stickers'],
  'sticker-update': ['PUT', '/api/stickers/:stickerId'],
});
const RESULT_KEYS = new Set([
  'id',
  'conversationId',
  'entryId',
  'messageId',
  'localMessageId',
  'instanceId',
  'bindingId',
  'providerId',
  'state',
  'revision',
  'bindingRevision',
  'directoryRevision',
  'listStateRevision',
  'created',
  'deleted',
  'pinned',
  'archived',
  'replayed',
  'accepted',
]);
/** Receipts carry identities/status, never another recoverable copy of withdrawn text. */
function receiptResult(value) {
  if (Array.isArray(value)) return value.map(receiptResult);
  if (!object(value)) return null;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([k]) => RESULT_KEYS.has(k))
      .map(([k, v]) => [k, Array.isArray(v) || object(v) ? receiptResult(v) : v]),
  );
}

/** Same owner/transaction as all existing desktop routes. No second business DB. */
export function createSharedBusinessService({
  store,
  dataDir,
  body,
  reply,
  enabled = false,
  messageUnitsEnabled = false,
  dispatch,
  messageEditWrites = process.env.SHIYE_MESSAGE_EDIT_WRITES !== '0',
}) {
  const scope = new AsyncLocalStorage();
  const media = createSharedMedia({ store, dataDir, body, reply });
  const entityPayload = createSharedEntityPayload({ store, body, reply });
  const feedPayload = createSharedFeedPayload({ store, body, reply });
  const resultInfo = () => sharedInfo(store.getDb());
  const enabledNow = () => enabled || resultInfo().enabled;
  let messageProjectionMigration;
  const ensureMessageProjection = async () => {
    if (store.getDb()._messageEditProjectionVersion === 1) return;
    if (!messageProjectionMigration) {
      messageProjectionMigration = store
        .mutate(() => null)
        .finally(() => {
          messageProjectionMigration = null;
        });
    }
    await messageProjectionMigration;
  };
  const identity = (input) => {
    const info = resultInfo();
    if (!info.enabled) throw fail(503, 'SHARED_SYNC_NOT_ENABLED');
    if (input.libraryId !== info.libraryId || input.epoch !== info.epoch)
      throw fail(409, 'SHARED_LIBRARY_MISMATCH');
    return info;
  };
  const receipts = (db) => db._sharedCommands || [];
  const lookup = (db, command) => {
    const row = receipts(db).find((r) => r.operationId === command.operationId);
    if (row && row.digest !== command.digest) throw fail(409, 'SHARED_OPERATION_REUSED');
    return row;
  };
  const mutate = (fn, options) => {
    const command = scope.getStore();
    if (!command || command.finished) return store.mutate(fn, options);
    return store.mutate((db) => {
      const existing = lookup(db, command);
      if (existing) {
        command.receipt = existing;
        return structuredClone(existing.result);
      }
      if (receipts(db).length >= 50000) throw fail(409, 'SHARED_RECEIPT_CAPACITY');
      if (command.guard) {
        const row = db._sharedSync?.entities.find(
          (row) =>
            row.entityType === command.guard.entityType && row.entityId === command.guard.entityId,
        );
        if (!row || row.revision !== command.guard.revision)
          throw fail(409, 'SHARED_BUSINESS_CONFLICT');
      }
      const value = fn(db);
      if (value?.then) throw fail(500, 'SHARED_ASYNC_MUTATION');
      const receipt = {
        operationId: command.operationId,
        digest: command.digest,
        action: command.action,
        result: receiptResult(value),
        committedAt: new Date().toISOString(),
      };
      db._sharedCommands = [...receipts(db), receipt];
      command.receipt = receipt;
      command.mutations++;
      return value;
    });
  };
  async function execute(input, original) {
    identity(input);
    if (!uuid(input.operationId) || !object(input.input)) throw fail(400, 'SHARED_INVALID_COMMAND');
    if (input.input.actorId !== undefined && input.input.actorId !== 'self')
      throw fail(403, 'SHARED_PROGRAM_ACTOR_FORBIDDEN');
    if (!Object.hasOwn(SHARED_ACTIONS, input.action) && input.action !== 'entry-list')
      throw fail(400, 'SHARED_ACTION_FORBIDDEN');
    if (input.action === 'conversation-feed')
      return {
        info: resultInfo(),
        operationId: input.operationId,
        result: readSharedConversationFeed(store.getDb(), input.input),
        replayed: false,
        readOnly: true,
      };
    if (input.action === 'wallpaper-read')
      return {
        info: resultInfo(),
        operationId: input.operationId,
        result: readConversationWallpaper(store.getDb(), input.input),
        readOnly: true,
      };
    const command = {
      operationId: input.operationId,
      action: input.action,
      digest: hash({ action: input.action, input: input.input }),
      mutations: 0,
      finished: false,
    };
    if (
      ['message-edit-local', 'message-withdraw-local', 'message-describe-local'].includes(
        input.action,
      )
    ) {
      const value = input.input;
      if (input.action !== 'message-describe-local' && !messageEditWrites)
        throw fail(503, 'SHARED_MESSAGE_EDITS_READ_ONLY');
      // Writer UUID is local HLC identity, never an actor/owner credential or a transport principal.
      if (input.action === 'message-edit-local' && !uuid(value.stamp?.deviceId))
        throw fail(400, 'LOCAL_MESSAGE_EDIT_INVALID_WRITER');
      const context = {
        sourceId: value.sourceId,
        roomId: value.roomId,
        actor: { kind: 'self', id: 'self' },
        operationId: input.operationId,
        deviceId: value.stamp?.deviceId ?? 'root-withdraw-v1',
        authenticatedDeviceId: original.sharedDevice?.deviceId ?? 'local-cookie',
        conversationWriter: true,
      };
      if (input.action === 'message-describe-local') {
        if (
          Object.keys(value).some((name) => !['sourceId', 'roomId', 'rootMessageId'].includes(name))
        )
          throw fail(400, 'LOCAL_MESSAGE_EDIT_INVALID');
        return {
          info: resultInfo(),
          operationId: input.operationId,
          result: describeLocalMessageEdit(store.getDb(), value, context),
          readOnly: true,
        };
      }
      const executed = await store.mutate((db) => {
        const existing = lookup(db, command);
        if (
          existing &&
          !db._messageEdits?.operations.some((op) => op.operationId === input.operationId)
        )
          throw fail(409, 'LOCAL_MESSAGE_EDIT_RECEIPT_UNAVAILABLE');
        if (!existing && receipts(db).length >= 50000) throw fail(409, 'SHARED_RECEIPT_CAPACITY');
        const result = (
          input.action === 'message-edit-local'
            ? applyLocalMessageEdit
            : applyLocalMessageWithdrawal
        )(db, value, context);
        if (result.accepted && !existing)
          db._sharedCommands = [
            ...receipts(db),
            {
              operationId: input.operationId,
              digest: command.digest,
              action: input.action,
              result: structuredClone(result),
              committedAt: new Date().toISOString(),
            },
          ];
        return { result, replayed: !!existing };
      });
      // Diagnostic unknown-stale is durable. Throwing inside mutate would erase it.
      if (!executed.result.accepted) throw fail(409, executed.result.code);
      return { info: resultInfo(), operationId: input.operationId, ...executed };
    }
    const prior = lookup(store.getDb(), command);
    if (prior)
      return {
        info: resultInfo(),
        operationId: input.operationId,
        result: prior.result,
        replayed: true,
      };
    if (input.action === 'conversation-create-local') {
      if (
        input.input.operationId !== undefined ||
        !/^desktop:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}:-?\d{1,20}$/.test(
          input.input.conversationId,
        )
      )
        throw fail(400, 'SHARED_INVALID_LOCAL_CONVERSATION');
      await scope.run(command, () =>
        mutate((db) =>
          createLocalDirectoryConversation(db, { ...input.input, operationId: input.operationId }),
        ),
      );
      command.finished = true;
      return {
        info: resultInfo(),
        operationId: input.operationId,
        result: command.receipt.result,
        replayed: false,
      };
    }
    if (input.action === 'conversation-save-local') {
      const { conversationId, baseOperationId, ...changes } = input.input;
      if (
        !uuid(baseOperationId) ||
        !/^desktop:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}:-?\d{1,20}$/.test(conversationId) ||
        Object.keys(changes).some(
          (key) =>
            ![
              'title',
              'category',
              'idleHours',
              'mode',
              'selfName',
              'description',
              'clientMetadata',
            ].includes(key),
        )
      )
        throw fail(400, 'SHARED_INVALID_LOCAL_CONVERSATION');
      await scope.run(command, () =>
        mutate((db) => {
          const base = receipts(db).find((row) => row.operationId === baseOperationId);
          if (
            !base ||
            !['conversation-create-local', 'conversation-save-local', 'conversation-save'].includes(
              base.action,
            ) ||
            base.result?.conversationId !== conversationId ||
            !Number.isSafeInteger(base.result.revision)
          )
            throw fail(409, 'SHARED_CONVERSATION_DEPENDENCY_MISSING');
          return saveConversation(db, {
            conversationId,
            expectedRevision: base.result.revision,
            ...changes,
          });
        }),
      );
      command.finished = true;
      return {
        info: resultInfo(),
        operationId: input.operationId,
        result: command.receipt.result,
        replayed: false,
      };
    }
    if (input.action === 'conversation-state-local') {
      const { conversationId, baseOperationId, ...changes } = input.input;
      if (
        !uuid(baseOperationId) ||
        !/^desktop:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}:-?\d{1,20}$/.test(conversationId) ||
        !Object.keys(changes).length ||
        Object.keys(changes).some((key) => !['pinned', 'archived'].includes(key)) ||
        Object.values(changes).some((value) => typeof value !== 'boolean')
      )
        throw fail(400, 'SHARED_INVALID_LOCAL_CONVERSATION_STATE');
      await scope.run(command, () =>
        mutate((db) => {
          const base = receipts(db).find((row) => row.operationId === baseOperationId);
          if (
            !base ||
            ![
              'conversation-create-local',
              'conversation-list-state',
              'conversation-state-local',
            ].includes(base.action) ||
            base.result?.conversationId !== conversationId ||
            !Number.isSafeInteger(base.result.listStateRevision)
          )
            throw fail(409, 'SHARED_CONVERSATION_STATE_DEPENDENCY_MISSING');
          return updateDirectoryState(db, {
            conversationId,
            expectedRevision: base.result.listStateRevision,
            ...changes,
          });
        }),
      );
      command.finished = true;
      return {
        info: resultInfo(),
        operationId: input.operationId,
        result: command.receipt.result,
        replayed: false,
      };
    }
    if (input.action === 'conversation-order-local') {
      const { order, baseOperationId } = input.input;
      if (
        !uuid(baseOperationId) ||
        !Array.isArray(order) ||
        Object.keys(input.input).some((key) => !['order', 'baseOperationId'].includes(key))
      )
        throw fail(400, 'SHARED_INVALID_LOCAL_ORDER');
      await scope.run(command, () =>
        mutate((db) => {
          const base = receipts(db).find((row) => row.operationId === baseOperationId);
          const revision =
            base?.action === 'conversation-create-local'
              ? base.result?.directoryRevision
              : ['conversation-list-state', 'conversation-state-local'].includes(base?.action)
                ? base.result?.directoryRevision
                : ['conversation-order-local', 'conversation-order'].includes(base?.action)
                  ? base.result?.revision
                  : undefined;
          if (!Number.isSafeInteger(revision))
            throw fail(409, 'SHARED_DIRECTORY_DEPENDENCY_MISSING');
          return saveDirectoryOrder(db, { expectedRevision: revision, order });
        }),
      );
      command.finished = true;
      return {
        info: resultInfo(),
        operationId: input.operationId,
        result: command.receipt.result,
        replayed: false,
      };
    }
    if (input.action === 'entry-create-local') {
      const entry = input.input.entry;
      if (
        !object(entry) ||
        !uuid(entry.id) ||
        input.input.entryId !== entry.id ||
        Object.keys(input.input).some((key) => !['entryId', 'entry'].includes(key))
      )
        throw fail(400, 'SHARED_INVALID_LOCAL_ENTRY');
      await scope.run(command, () =>
        mutate((db) => createEntryWithId(db, entry, entry.id, { messageUnitsEnabled })),
      );
      command.finished = true;
      return {
        info: resultInfo(),
        operationId: input.operationId,
        result: command.receipt.result,
        replayed: false,
      };
    }
    if (input.action === 'entry-save-local') {
      const { entryId, entry, baseOperationId } = input.input;
      if (
        !uuid(entryId) ||
        !object(entry) ||
        entry.id !== entryId ||
        !uuid(baseOperationId) ||
        Object.keys(input.input).some(
          (key) => !['entryId', 'entry', 'baseOperationId'].includes(key),
        )
      )
        throw fail(400, 'SHARED_INVALID_LOCAL_ENTRY');
      await scope.run(command, () =>
        mutate((db) => {
          const base = receipts(db).find((row) => row.operationId === baseOperationId);
          if (
            !base ||
            ![
              'entry-create-local',
              'entry-save-local',
              'entry-save',
              'entry-save-ref',
              'entry-delete',
              'entry-restore',
            ].includes(base.action) ||
            base.result?.id !== entryId ||
            !Number.isSafeInteger(base.result.revision)
          )
            throw fail(409, 'SHARED_ENTRY_DEPENDENCY_MISSING');
          const old = db.entries.find((row) => row.id === entryId);
          if (!old || old.revision !== base.result.revision)
            throw fail(409, 'SHARED_BUSINESS_CONFLICT');
          return replaceEntry(db, old, validateEntry(entry, db, old), { messageUnitsEnabled });
        }),
      );
      command.finished = true;
      return {
        info: resultInfo(),
        operationId: input.operationId,
        result: command.receipt.result,
        replayed: false,
      };
    }
    if (input.action === 'wallpaper-save') {
      const value = validateWallpaperInput(input.input),
        verified = await verifyWallpaperOriginal(store.getDb(), value, dataDir);
      await scope.run(command, () =>
        mutate((db) => saveConversationWallpaper(db, value, verified)),
      );
      command.finished = true;
      return {
        info: resultInfo(),
        operationId: input.operationId,
        result: command.receipt.result,
        replayed: false,
      };
    }
    if (input.action === 'journal-send' && Object.hasOwn(input.input, 'deferredMedia')) {
      const proof = await verifyDeferredMedia(
        store.getDb(),
        input.input,
        input.operationId,
        dataDir,
      );
      await scope.run(command, () =>
        mutate((db) => {
          claimDeferredMedia(db, input.input, input.operationId, proof);
          return appendChatMessages(db, input.input, Date.now(), {
            deferredMedia: true,
            messageUnitsEnabled,
          });
        }),
      );
      command.finished = true;
      return {
        info: resultInfo(),
        operationId: input.operationId,
        result: command.receipt.result,
        replayed: false,
      };
    }
    if (input.action === 'client-preferences-save') {
      await scope.run(command, () => mutate((db) => saveSharedClientPreferences(db, input.input)));
      command.finished = true;
      return {
        info: resultInfo(),
        operationId: input.operationId,
        result: command.receipt.result,
        replayed: false,
      };
    }
    if (input.action === 'entry-list')
      return {
        info: resultInfo(),
        operationId: input.operationId,
        result: structuredClone(store.getDb().entries || []),
        readOnly: true,
      };
    if (
      input.action === 'service-request' &&
      ![
        'status',
        'config',
        'feed',
        'source',
        'media',
        'context',
        'comment',
        'withdraw',
        'comments',
      ].includes(input.input.action)
    )
      throw fail(400, 'SHARED_SERVICE_ACTION_FORBIDDEN');
    const [method, template] = SHARED_ACTIONS[input.action];
    const value = structuredClone(input.input);
    const pathname = template.replace(
      /:(entryId|templateId|commentId|stickerId)/g,
      (_all, name) => {
        if (!uuid(value[name])) throw fail(400, 'SHARED_INVALID_ENTITY_ID');
        return value[name];
      },
    );
    let payload = value;
    if (input.action === 'preferences-save') {
      if (
        !Number.isSafeInteger(value.expectedRevision) ||
        value.expectedRevision < 1 ||
        !object(value.values)
      )
        throw fail(400, 'SHARED_INVALID_INPUT');
      command.guard = {
        entityType: 'settings',
        entityId: 'library',
        revision: value.expectedRevision,
      };
      payload = value.values;
    }
    if (input.action === 'sticker-update') {
      if (!Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 1)
        throw fail(400, 'SHARED_INVALID_INPUT');
      command.guard = {
        entityType: 'sticker',
        entityId: value.stickerId,
        revision: value.expectedRevision,
      };
    }
    if (['entry-save', 'entry-create'].includes(input.action)) payload = value.entry || value;
    if (['entry-save-ref', 'entry-create-ref'].includes(input.action))
      payload = await sharedEntryInput({ store, dataDir, input: value, action: input.action });
    if (input.action === 'entry-delete' || input.action === 'entry-restore') {
      const old = store.getDb().entries.find((e) => e.id === value.entryId);
      if (!old) throw fail(404, 'SHARED_ENTRY_NOT_FOUND');
      payload = {
        ...structuredClone(old),
        revision: value.revision,
        deleted: input.action === 'entry-delete',
      };
    }
    if (
      input.action.startsWith('template-') ||
      input.action.startsWith('comment-') ||
      input.action === 'sticker-update'
    )
      payload = value.value || value;
    if (input.action === 'conversation-create')
      payload = { ...payload, operationId: input.operationId };
    const bytes = Buffer.from(JSON.stringify(payload));
    let captured,
      status = 200;
    const response = {
      setHeader() {},
      getHeader() {},
      writeHead(code) {
        status = code;
      },
      end(text) {
        captured = text ? JSON.parse(String(text)) : null;
      },
    };
    const request = {
      method,
      url: pathname,
      headers: { ...original.headers, 'x-diary-client': 'desktop' },
      socket: original.socket,
      async *[Symbol.asyncIterator]() {
        yield bytes;
      },
    };
    if (['entry-save-ref', 'entry-create-ref'].includes(input.action)) request[LARGE_ENTRY] = true;
    await scope.run(command, async () => {
      if (!(await dispatch(request, response, pathname)))
        throw fail(404, 'SHARED_ACTION_NOT_IMPLEMENTED');
    });
    command.finished = true;
    if (status >= 400) throw fail(status, 'SHARED_BUSINESS_REJECTED');
    if (command.mutations > 1) throw fail(500, 'SHARED_MULTIPLE_MUTATIONS');
    return {
      info: resultInfo(),
      operationId: input.operationId,
      result: command.receipt?.result ?? captured,
      replayed: false,
      readOnly: !command.receipt,
    };
  }
  return {
    mutate,
    enabled: enabledNow,
    body: (req, max) => body(req, req[LARGE_ENTRY] ? 64 * 1024 * 1024 : max),
    async handle(req, res, pathname) {
      if (!pathname.startsWith(BASE)) return false;
      try {
        if (!enabledNow()) throw fail(404, 'SHARED_SYNC_NOT_ENABLED');
        await ensureMessageProjection();
        if (await entityPayload.handle(req, res, pathname)) return true;
        if (await feedPayload.handle(req, res, pathname)) return true;
        if (await media.handle(req, res, pathname)) return true;
        const action = pathname.slice(BASE.length);
        if (action === 'info' && req.method === 'GET')
          return reply(res, 200, {
            ...resultInfo(),
            seedSigningKey: await readSharedSeedSigningKey({ db: store.getDb(), dataDir }),
            service: 'shiye-shared-business',
            sameBusinessStore: true,
            capabilities: {
              seed: {
                containerVersion: 1,
                manifestVersions: [1, 2],
                features: ['conversation-feeds-v1', 'seed-attestation-ed25519-v1'],
              },
              byteBoundPages: 1,
              conversationFeedPayload: {
                version: 1,
                maxChunkBytes: 262144,
                maxBytes: 64 * 1024 * 1024,
              },
              entityPayload: { version: 1, maxChunkBytes: 262144, maxBytes: 64 * 1024 * 1024 },
              originals: { version: 1, maxChunkBytes: 262144, maxBytes: 16 * 1024 ** 3 },
              largeEntryRefs: 1,
              localFirstCreate: { version: 1, entry: true, conversation: true },
              messageEdits: {
                version: 1,
                baseProtocol: 'shiye-message-edit-base-v1',
                writerIdentity: 'local-installation-uuid',
                readOnlyHeadEntity: 'message-edit-head',
                writeEnabled: messageEditWrites,
              },
              clientPreferences: 1,
              conversationWallpaper: 1,
              backendPrograms: {
                version: 1,
                endpoint: '/api/shared/v1/program/',
                independentFrontendLock: true,
                aiExecution: false,
              },
            },
            actions: [...Object.keys(SHARED_ACTIONS), 'entry-list'],
          });
        if (
          req.method !== 'POST' ||
          !['snapshot', 'pull', 'command', 'seed-resolve', 'seed-register'].includes(action)
        )
          throw fail(404, 'SHARED_ACTION_NOT_FOUND');
        const input = JSON.parse(
          (
            await body(
              req,
              ['seed-resolve', 'seed-register'].includes(action) ? 34 * 1024 * 1024 : undefined,
            )
          ).toString('utf8'),
        );
        if (!object(input)) throw fail(400, 'SHARED_INVALID_INPUT');
        identity(input);
        if (action === 'seed-register')
          return reply(res, 200, await registerSharedSeed({ store, dataDir, input }));
        if (action === 'seed-resolve')
          return reply(res, 200, await resolveSharedSeed({ getDb: store.getDb, dataDir, input }));
        if (action === 'command') return reply(res, 200, await execute(input, req));
        const page =
          action === 'snapshot'
            ? sharedSnapshot(store.getDb(), {
                ...(input.afterKey === null || input.afterKey === undefined
                  ? {}
                  : { afterKey: input.afterKey }),
                limit: input.limit,
              })
            : sharedPull(store.getDb(), { after: input.after ?? 0, limit: input.limit });
        return reply(res, 200, {
          info: resultInfo(),
          ...(action === 'snapshot' ? { entities: page.entities } : { changes: page.changes }),
          next: action === 'snapshot' ? page.afterKey : page.after,
          hasMore: page.hasMore,
          watermark: page.watermark,
        });
      } catch (error) {
        const status = error.status || 500;
        return reply(res, status, {
          error: {
            code:
              error.code ||
              (status === 409
                ? 'SHARED_BUSINESS_CONFLICT'
                : status === 401
                  ? 'SHARED_AUTH_REQUIRED'
                  : status === 400
                    ? 'SHARED_INVALID_INPUT'
                    : 'SHARED_REQUEST_FAILED'),
          },
        });
      }
    },
  };
}
