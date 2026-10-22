import { createEditClock, compareEditStamps } from './shared-edit-clock.js';
import { sha256Bytes } from './sync-v2-media.js';
import { scrubInboxMessage } from './shared-inbox.js';
import {
  buildLocalMessageEditBase,
  sharedMessageEditRootId,
  sharedMessageEditUnitId,
} from './shared-message-edit-protocol.js';

const clone = (v) => structuredClone(v);
const fail = (code) => {
  throw Object.assign(new Error(code), { code, status: 409 });
};
const uuid = (v) =>
  typeof v === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v);
const hash = (v) => sha256Bytes(new TextEncoder().encode(JSON.stringify(v)));
const self = (m) => !m.actor || (m.actor.kind === 'self' && m.actor.id === 'self');
const historyType = 'local-message-edit-history';
const action = (p) => ['message-edit-local', 'message-withdraw-local'].includes(p.wire.action);
const scopeOf = (conversationId) => {
  if (
    typeof conversationId !== 'string' ||
    !/^desktop:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}:-?\d{1,20}$/.test(conversationId)
  )
    fail('SHARED_MESSAGE_EDIT_SCOPE');
  const [, sourceId, roomId] = conversationId.split(':');
  return { sourceId, roomId };
};
function chainHead(messages, rootMessageId) {
  const rootedActive = messages.filter(
    (m) =>
      !m.withdrawn && self(m) && (m.id === rootMessageId || m.replacementRootId === rootMessageId),
  );
  if (rootedActive.length !== 1) return null;
  let current = messages.find((m) => m.id === rootMessageId);
  const seen = new Set();
  while (current) {
    if (seen.has(current.id) || !self(current)) return null;
    seen.add(current.id);
    const children = messages.filter((m) => m.replacementOf === current.id);
    if (children.length > 1) return null;
    // Received withdrawn intermediates intentionally omit old replacement
    // metadata. The surviving authority/optimistic head retains its exact root.
    if (!children.length) return current.withdrawn ? rootedActive[0] : current;
    if (!current.withdrawn) return null;
    current = children[0];
  }
  return null;
}
function rootFor(messages, message) {
  if (message?.replacementRootId) {
    const root = messages.find((m) => m.id === message.replacementRootId);
    return root && self(root) ? root.id : null;
  }
  let current = message;
  const seen = new Set();
  while (current?.replacementOf) {
    if (seen.has(current.id)) return null;
    seen.add(current.id);
    current = messages.find((m) => m.id === current.replacementOf);
  }
  return current?.id ?? null;
}
function clean(data) {
  const result = clone(data);
  for (const field of [
    'content',
    'markdownSource',
    'markdownHtml',
    'editorOriginalHtml',
    'richDoc',
    'body',
    'messageUnits',
    '_canonical',
    'searchText',
    'preview',
    'summary',
  ])
    delete result[field];
  result.history = [];
  delete result.restoredFrom;
  return result;
}
function journalText(data) {
  const text = data.chatJournal.messages
    .filter((m) => !m.withdrawn && (!m.state || m.state === 'active'))
    .map((m) => m.text || '')
    .join('\n');
  data.searchText = text;
  data.preview = text.slice(0, 240);
  return data;
}
function maskRoots(local, roots) {
  if (!local?.data?.chatJournal) return local;
  const data = clean(local.data),
    ids = new Set(roots);
  for (const message of data.chatJournal.messages)
    if (
      ids.has(message.id) ||
      roots.includes(message.replacementRootId) ||
      ids.has(message.replacementOf)
    )
      ids.add(message.id);
  data.chatJournal.messages = data.chatJournal.messages.map((m) => {
    if (!ids.has(m.id)) return m;
    const { editBase: _editBase, ...retired } = m;
    return { ...retired, text: '', attachments: [], withdrawn: true, _localEditTerminal: true };
  });
  data.attachments = [...new Set(data.chatJournal.messages.flatMap((m) => m.attachments || []))];
  journalText(data);
  const { canonical: _canonical, ...envelope } = local;
  return { ...envelope, data };
}

/** Private extension of the same client/storage owner. No network in these transactions. */
export function createSharedMessageEditClient({
  storage,
  metadata,
  enqueue,
  entries,
  rebuild,
  changed,
  wireHash,
  advanceLocalRevision,
  now = () => Date.now(),
  newId = () => crypto.randomUUID(),
}) {
  function clock(meta) {
    meta.messageEditWriter ||= { version: 1, deviceId: newId(), lastPhysicalMs: 0, lastLogical: 0 };
    if (!uuid(meta.messageEditWriter.deviceId)) fail('SHARED_MESSAGE_EDIT_WRITER_INVALID');
    return createEditClock({
      deviceId: meta.messageEditWriter.deviceId,
      state: meta.messageEditWriter,
      now,
    });
  }
  async function commit(input, withdraw = false) {
    if (
      !input ||
      !uuid(input.operationId) ||
      typeof input.messageId !== 'string' ||
      (!withdraw && (typeof input.text !== 'string' || input.text.length > 500000))
    )
      fail('SHARED_MESSAGE_EDIT_INVALID');
    const scope = scopeOf(input.conversationId);
    const intentHash = hash({
      conversationId: input.conversationId,
      messageId: input.messageId,
      action: withdraw ? 'withdraw' : 'edit',
      text: withdraw ? null : input.text,
      attachments: input.attachments ?? null,
    });
    const result = await storage.transaction(async (tx) => {
      const meta = await metadata(tx);
      const prior = await tx.getEntity(historyType, input.operationId);
      if (prior) {
        if (prior.local.data.intentHash !== intentHash) fail('SHARED_OPERATION_REUSED');
        return {
          ...clone(prior.local.data.ack),
          replayed: true,
          terminal: prior.local.state === 'withdrawn',
        };
      }
      const records = await entries(tx, meta, input.conversationId);
      let record, rootMessageId;
      for (const candidate of records) {
        const journal = candidate.local?.data?.chatJournal;
        const selected = journal?.messages.find(
          (m) =>
            m.id === input.messageId ||
            sharedMessageEditUnitId(scope.sourceId, scope.roomId, m.id) === input.messageId,
        );
        if (selected) {
          if (record) fail('SHARED_MESSAGE_EDIT_SCOPE');
          record = candidate;
          rootMessageId = rootFor(journal.messages, selected);
        }
      }
      if (
        !record ||
        !rootMessageId ||
        record.local?.state !== 'active' ||
        record.local.data.hidden ||
        record.local.data.deleted ||
        record.local.data.draft
      )
        fail('SHARED_MESSAGE_EDIT_SOURCE_UNAVAILABLE');
      if (
        input.expectedLocalRevision !== undefined &&
        input.expectedLocalRevision !== record.localRevision
      )
        fail('SHARED_LOCAL_REVISION_CONFLICT');
      const authority = chainHead(record.base?.data?.chatJournal?.messages || [], rootMessageId);
      const visible = chainHead(record.local.data.chatJournal.messages, rootMessageId);
      if (!authority || !visible) fail('SHARED_MESSAGE_EDIT_SOURCE_UNAVAILABLE');
      const base = buildLocalMessageEditBase(authority),
        rootKey = sharedMessageEditRootId({ ...scope, rootMessageId });
      const head = await tx.getEntity('message-edit-head', rootKey);
      if (head?.base?.state === 'withdrawn') fail('SHARED_MESSAGE_EDIT_TERMINAL');
      if (
        !withdraw &&
        input.attachments !== undefined &&
        JSON.stringify(input.attachments) !== JSON.stringify(visible.attachments)
      )
        fail('SHARED_MESSAGE_EDIT_NEW_MEDIA_UNSUPPORTED');
      for (const assetId of visible.attachments || []) {
        const media = await tx.getEntity('media', assetId);
        if (media?.local?.state !== 'active') fail('SHARED_MESSAGE_EDIT_MEDIA_UNAVAILABLE');
      }
      const previous = (await tx.listPending())
        .filter((p) => action(p) && sharedMessageEditRootId(p.wire.input) === rootKey)
        .at(-1);
      if (previous?.blocked) fail('SHARED_MESSAGE_EDIT_PENDING_CONFLICT');
      const localClock = clock(meta);
      if (head?.base?.data?.stamp) localClock.observe(head.base.data.stamp);
      const issued = localClock.issue({
        entityType: 'message',
        entityId: rootKey,
        fieldPath: 'body',
        operationId: input.operationId,
        action: withdraw ? 'withdraw' : 'edit',
        value: withdraw ? undefined : { text: input.text, attachments: visible.attachments },
        parentOpId: previous?.operationId ?? base.editOperationId,
        sentAt: visible.sentAt,
      });
      meta.messageEditWriter = localClock.snapshot();
      const command = {
        ...scope,
        rootMessageId,
        operationId: input.operationId,
        base,
        ...(withdraw
          ? {}
          : {
              editedAt: issued.editedAt,
              stamp: issued.stamp,
              message: {
                text: input.text,
                attachments: [...visible.attachments],
                ...(visible.replyTo ? { replyTo: visible.replyTo } : {}),
              },
            }),
      };
      if (!withdraw && !input.text.trim() && !visible.attachments.length)
        fail('SHARED_MESSAGE_EDIT_EMPTY');
      const pending = await enqueue(
        {
          operationId: input.operationId,
          action: withdraw ? 'message-withdraw-local' : 'message-edit-local',
          input: command,
          optimistic: [{ entityType: 'entry', entityId: record.entityId, changes: {} }],
          draftClear: input.draftClear,
        },
        { tx, meta },
      );
      const ack = {
        operationId: input.operationId,
        localAck: true,
        serverConfirmed: !!pending.acknowledged,
        rootMessageId,
        messageId: withdraw
          ? visible.id
          : (BigInt(`0x${input.operationId.replaceAll('-', '')}`) % 10n ** 20n).toString(),
        sentAt: visible.sentAt,
        editedAt: issued.editedAt,
        stamp: issued.stamp,
        parentLocalOperationId: previous?.operationId ?? null,
        committedLocalRevision: pending.localCommitRevisions?.[0]?.revision ?? record.localRevision,
      };
      await tx.putEntity({
        entityType: historyType,
        entityId: input.operationId,
        base: null,
        local: {
          state: 'active',
          data: {
            rootKey,
            entryId: record.entityId,
            intentHash,
            ack,
            before: withdraw ? null : clone(visible),
            after: withdraw ? null : clone(command.message),
          },
        },
      });
      if (withdraw)
        await observe(
          tx,
          { entityType: 'message-edit-head', entityId: rootKey, state: 'withdrawn' },
          meta,
          null,
          input.operationId,
        );
      await tx.setMeta(meta);
      return ack;
    });
    changed();
    return result;
  }
  async function project(tx, record, local, pending) {
    if (!action(pending) || !local?.data?.chatJournal) return local;
    const input = pending.wire.input,
      rootKey = sharedMessageEditRootId(input);
    const head = await tx.getEntity('message-edit-head', rootKey);
    if (head?.base?.state === 'withdrawn') return local;
    if (
      pending.wire.action === 'message-edit-local' &&
      head?.base?.data?.stamp &&
      compareEditStamps(input.stamp, head.base.data.stamp) < 0
    )
      return local;
    const data = clean(local.data),
      rows = data.chatJournal.messages;
    const current = chainHead(rows, input.rootMessageId);
    if (!current) return local;
    const id = (BigInt(`0x${pending.operationId.replaceAll('-', '')}`) % 10n ** 20n).toString();
    if (rows.some((m) => m.id === id || m.operationId === pending.operationId)) return local;
    const old = { ...current, text: '', attachments: [], withdrawn: true, _localEditPending: true };
    delete old.editBase;
    const position = rows.findIndex((m) => m.id === current.id);
    rows.splice(position, 1, old);
    if (pending.wire.action === 'message-edit-local')
      rows.splice(position + 1, 0, {
        id,
        sentAt: current.sentAt,
        ...clone(input.message),
        replacementOf: current.id,
        replacementRootId: input.rootMessageId,
        actor: clone(current.actor || { kind: 'self', id: 'self' }),
        operationId: pending.operationId,
        _localEditPending: true,
      });
    data.attachments = [...new Set(rows.flatMap((m) => m.attachments || []))];
    journalText(data);
    return { ...local, data };
  }
  async function finalize(tx, record, local) {
    if (record.entityType !== 'entry') return local;
    const terminal = await tx.getEntity('local-message-edit-terminal', record.entityId);
    const roots = [
      ...(terminal?.local?.data?.roots || []),
      ...(terminal?.local?.data?.messageIds || []),
    ];
    if (!roots.length) return local;
    record.base = maskRoots(record.base, roots);
    record.terminalRedacted = true;
    return maskRoots(local, roots);
  }
  async function filterInbox(tx, _meta, batch) {
    const ids = new Set();
    for (const terminal of await tx.listEntities('local-message-edit-terminal')) {
      const record = await tx.getEntity('entry', terminal.entityId),
        journal = record?.local?.data?.chatJournal;
      if (!journal || `desktop:${journal.sourceId}:${journal.roomId}` !== batch.conversationId)
        continue;
      for (const message of journal.messages)
        if (
          message._localEditTerminal ||
          terminal.local.data.roots.includes(message.id) ||
          terminal.local.data.messageIds?.includes(message.id)
        ) {
          ids.add(message.id);
          ids.add(sharedMessageEditUnitId(journal.sourceId, journal.roomId, message.id));
        }
    }
    for (const [id, message] of batch.rows)
      if (ids.has(id) || ids.has(message.order?.sequence))
        batch.rows.set(id, scrubInboxMessage(message, 'withdrawn'));
  }
  async function observe(tx, row, meta, previousBase, keepOperationId) {
    if (row.entityType !== 'message-edit-head') return;
    if (row.state === 'active' && row.data?.stamp) {
      const localClock = clock(meta);
      localClock.observe(row.data.stamp);
      meta.messageEditWriter = localClock.snapshot();
    }
    const affected = new Map();
    const retiredIds = new Set();
    const add = (entryId, root) => {
      if (entryId && root)
        affected.set(entryId, [...new Set([...(affected.get(entryId) || []), root])]);
    };
    if (row.state === 'active') {
      if (row.data?.sourceId && row.data?.roomId)
        for (const record of await entries(
          tx,
          meta,
          `desktop:${row.data.sourceId}:${row.data.roomId}`,
        ))
          if (
            record.local?.data?.chatJournal?.messages.some((m) => m.id === row.data.rootMessageId)
          )
            add(record.entityId, row.data.rootMessageId);
      for (const entryId of affected.keys()) {
        const record = await tx.getEntity('entry', entryId);
        if (record) {
          advanceLocalRevision(record);
          await rebuild(tx, record, meta);
        }
      }
      return;
    }
    if (row.state !== 'withdrawn') return;
    if (previousBase?.data?.base?.headMessageId)
      retiredIds.add(previousBase.data.base.headMessageId);
    if (previousBase?.data?.sourceId && previousBase.data.roomId) {
      const d = previousBase.data;
      for (const record of await entries(tx, meta, `desktop:${d.sourceId}:${d.roomId}`))
        if (record.local?.data?.chatJournal?.messages.some((m) => m.id === d.rootMessageId))
          add(record.entityId, d.rootMessageId);
    }
    // A client may receive the first ledger row as an empty terminal tombstone
    // (e.g. withdrawal on another device after an unstamped seed). Recover only
    // exact root identity from the local journal; the tombstone contains no body.
    if (!previousBase?.data?.sourceId)
      for (const record of await tx.listEntities('entry')) {
        const journal = record.local?.data?.chatJournal;
        if (!journal) continue;
        for (const message of journal.messages || [])
          if (
            sharedMessageEditRootId({
              sourceId: journal.sourceId,
              roomId: journal.roomId,
              rootMessageId: message.id,
            }) === row.entityId
          )
            add(record.entityId, message.id);
      }
    for (const history of await tx.listEntities(historyType)) {
      if (history.local?.data?.rootKey !== row.entityId) continue;
      if (history.local.data.ack?.messageId) retiredIds.add(history.local.data.ack.messageId);
      if (history.local.data.before?.id) retiredIds.add(history.local.data.before.id);
      add(history.local.data.entryId, history.local.data.ack.rootMessageId);
      history.local = {
        state: 'withdrawn',
        data: {
          rootKey: row.entityId,
          entryId: history.local.data.entryId,
          intentHash: history.local.data.intentHash,
          ack: { ...history.local.data.ack, terminal: true },
        },
      };
      await tx.putEntity(history);
    }
    for (const pending of await tx.listPending()) {
      if (
        !action(pending) ||
        sharedMessageEditRootId(pending.wire.input) !== row.entityId ||
        pending.operationId === keepOperationId
      )
        continue;
      (meta.commandReceipts ||= []).push({
        operationId: pending.operationId,
        wireSha256: wireHash(pending.wire),
        localCommitRevisions: clone(pending.localCommitRevisions || []),
        result: { state: 'withdrawn', terminal: true, base: null },
        terminalRejected: true,
        serverConfirmed: !keepOperationId,
      });
      for (const effect of pending.optimistic)
        add(effect.entityId, pending.wire.input.rootMessageId);
      await tx.deletePending(pending.operationId);
      if (meta.paused?.operationId === pending.operationId) meta.paused = null;
    }
    meta.recoveredCommands = (meta.recoveredCommands || []).map((p) =>
      p.wire && action(p) && sharedMessageEditRootId(p.wire.input) === row.entityId
        ? {
            operationId: p.operationId,
            terminalRejected: true,
            wireSha256: wireHash(p.wire),
            recoveredReason: p.recoveredReason,
          }
        : p,
    );
    meta.commandReceipts = (meta.commandReceipts || []).map((receipt) => {
      const r = receipt.result;
      if (
        !r?.sourceId ||
        !r.roomId ||
        !r.rootMessageId ||
        sharedMessageEditRootId(r) !== row.entityId
      )
        return receipt;
      return {
        ...receipt,
        terminalRejected: true,
        serverConfirmed: !keepOperationId,
        result: {
          operationId: receipt.operationId,
          sourceId: r.sourceId,
          roomId: r.roomId,
          rootMessageId: r.rootMessageId,
          state: 'withdrawn',
          outcome: 'withdrawn',
          terminal: true,
          base: null,
        },
      };
    });
    for (const [entryId, roots] of affected) {
      const old = await tx.getEntity('local-message-edit-terminal', entryId);
      await tx.putEntity({
        entityType: 'local-message-edit-terminal',
        entityId: entryId,
        base: null,
        local: {
          state: 'active',
          data: {
            roots: [...new Set([...(old?.local?.data?.roots || []), ...roots])],
            messageIds: [...new Set([...(old?.local?.data?.messageIds || []), ...retiredIds])],
          },
        },
      });
      const record = await tx.getEntity('entry', entryId);
      if (record) {
        if (!keepOperationId) advanceLocalRevision(record);
        await rebuild(tx, record, meta);
      }
    }
    await sanitizeStaging(tx, meta);
  }
  async function sanitizeStaging(tx, meta) {
    const affected = new Map(
      (await tx.listEntities('local-message-edit-terminal')).map((record) => [
        record.entityId,
        record.local.data.roots,
      ]),
    );
    if (!affected.size) return;
    const redactedPackages = new Set();
    for (const record of await tx.listEntities('local-seed-entity')) {
      if (record.seed?.entityType !== 'entry' || !affected.has(record.seed.entityId)) continue;
      // Consumed signed staging is never a second historical body owner. Once
      // erased, preserve only identity and require a fresh authority snapshot.
      const { entityType, entityId, revision, seq, state, sha256 } = record.seed;
      const journal = record.seed.data?.chatJournal;
      if (!journal?.messages.some((m) => affected.get(entityId).includes(m.id))) continue;
      record.redactedIdentity = { entityType, entityId, revision, seq, state, sha256 };
      record.seed = null;
      redactedPackages.add(JSON.parse(record.entityId)[0]);
      await tx.putEntity(record);
    }
    for (const type of ['shared-inbox-message', 'local-seed-feed-row']) {
      const batches = new Map();
      for (const record of await tx.listEntities(type)) {
        const message = record.message;
        if (!message?.conversationId) continue;
        const batchKey =
          type === 'local-seed-feed-row'
            ? JSON.stringify([JSON.parse(record.entityId)[0], message.conversationId])
            : message.conversationId;
        const batch = batches.get(batchKey) || {
          conversationId: message.conversationId,
          rows: new Map(),
          records: new Map(),
        };
        batch.rows.set(message.id, message);
        batch.records.set(message.id, record);
        batches.set(batchKey, batch);
      }
      for (const batch of batches.values()) {
        await filterInbox(tx, meta, batch);
        for (const [id, message] of batch.rows) {
          if (type === 'local-seed-feed-row' && message !== batch.records.get(id).message)
            redactedPackages.add(JSON.parse(batch.records.get(id).entityId)[0]);
          await tx.putEntity({ ...batch.records.get(id), message });
        }
      }
    }
    for (const packageId of redactedPackages) {
      const record = await tx.getEntity('local-seed-package', packageId);
      if (!record?.seed) continue;
      record.seed.localBodiesRedacted = true;
      await tx.putEntity(record);
    }
  }
  return {
    editMessage: (input) => commit(input),
    withdrawMessage: (input) => commit(input, true),
    project,
    observe,
    finalize,
    filterInbox,
    sanitizeStaging,
    messageEditHistory: (rootKey) =>
      storage.transaction(async (tx) => {
        await metadata(tx);
        return (await tx.listEntities(historyType))
          .filter((row) => row.local?.data?.rootKey === rootKey)
          .map((row) => clone(row.local));
      }),
  };
}
