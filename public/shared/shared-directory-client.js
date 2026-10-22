/** Shared directory/controller over the same durable outbox as diary and chat.
 * Canonical IDs are opaque strings. No title matching, local room copy or owner change.
 */
const clone = (value) => structuredClone(value);
const fail = (code) => {
  throw Object.assign(new Error(code), { code });
};
const canonicalId = (value) =>
  typeof value === 'string' &&
  /^desktop:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}:-?\d{1,20}$/.test(value);
export function sharedRoomIdentity(conversationId) {
  if (!canonicalId(conversationId)) fail('SHARED_ROOM_ID_REQUIRED');
  const [, sourceId, roomId] = conversationId.split(':');
  return { conversationId, sourceId, roomId, legacyRoomId: roomId };
}
export function createSharedDirectoryClient({
  client,
  idFactory = () => crypto.randomUUID(),
} = {}) {
  if (!client?.enqueue || !client?.list) fail('SHARED_CLIENT_REQUIRED');
  async function list({ includeArchived = false } = {}) {
    const [rows, orderRecord] = await Promise.all([
      client.list('conversation'),
      client.read('order', 'conversation-directory'),
    ]);
    const order = orderRecord?.local?.data;
    const rooms = rows
      .filter((r) => r.entityType === 'conversation' && r.local?.state === 'active')
      .map((r) => ({
        ...clone(r.local.data),
        ...sharedRoomIdentity(r.entityId),
        id: r.entityId,
        localRevision: r.localRevision,
      }));
    const rank = new Map((order?.order || []).map((id, i) => [id, i]));
    rooms.sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) ||
        a.id.localeCompare(b.id),
    );
    const completeOrder = [
      ...(order?.order || []).filter((id) => rooms.some((room) => room.id === id)),
      ...rooms.map((room) => room.id).filter((id) => !(order?.order || []).includes(id)),
    ];
    return {
      rooms: rooms.filter((r) => includeArchived || !r.archived),
      order: clone(completeOrder),
      revision: order?.revision ?? 0,
    };
  }
  async function row(id) {
    const found = (await list({ includeArchived: true })).rooms.find((r) => r.id === id);
    if (!found) fail('SHARED_ROOM_NOT_RECEIVED');
    return found;
  }
  async function commit(
    action,
    input,
    {
      operationId = idFactory(),
      optimistic = [],
      expectedLocalRevisions = [],
      localCacheCommit,
      sync,
    } = {},
  ) {
    const enqueued = await client.enqueue({
      operationId,
      action,
      input,
      optimistic,
      expectedLocalRevisions,
      ...(localCacheCommit ? { localCacheCommit } : {}),
    });
    const effect = optimistic[0];
    const committedLocalRevision = enqueued.localCommitRevisions?.find(
      (revision) =>
        revision.entityType === effect?.entityType && revision.entityId === effect?.entityId,
    )?.revision;
    const local = effect ? await client.read(effect.entityType, effect.entityId) : null;
    const strict = sync === true || (sync === undefined && !optimistic.length && !localCacheCommit);
    if (strict) {
      try {
        await client.sync();
      } catch (error) {
        error.localCommitted = true;
        error.operationId = operationId;
        if (effect) error.entityId = effect.entityId;
        if (effect?.entityType === 'conversation') error.conversationId = effect.entityId;
        if (committedLocalRevision !== undefined)
          error.committedLocalRevision = committedLocalRevision;
        throw error;
      }
    } else if (sync !== false) void client.sync().catch(() => {});
    const operation = client.readOperation ? await client.readOperation(operationId) : {};
    if (strict && client.readOperation && operation?.status !== 'acknowledged')
      throw Object.assign(new Error('SHARED_REMOTE_NOT_CONFIRMED'), {
        code: 'SHARED_REMOTE_NOT_CONFIRMED',
        localCommitted: true,
        operationId,
        ...(effect?.entityType === 'conversation' ? { conversationId: effect.entityId } : {}),
        ...(committedLocalRevision === undefined ? {} : { committedLocalRevision }),
      });
    const finalLocal = effect ? await client.read(effect.entityType, effect.entityId) : local;
    return {
      operationId,
      localAck: true,
      serverConfirmed: operation?.status === 'acknowledged',
      serverRevision:
        operation?.status === 'acknowledged' && Number.isSafeInteger(operation.result?.revision)
          ? operation.result.revision
          : null,
      ...(finalLocal ? { localRevision: finalLocal.localRevision } : {}),
      ...(committedLocalRevision === undefined ? {} : { committedLocalRevision }),
      ...operation,
    };
  }
  const project = (id, changes) => [{ entityType: 'conversation', entityId: id, changes }];
  const settingsScope = (id, slotId) => `service-settings:${id}:${slotId || 'default'}`;
  return {
    list,
    row,
    refresh: async (options) => {
      await client.sync();
      return list(options);
    },
    async create(input, options = {}) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) fail('SHARED_INVALID_ROOM');
      const conversationId =
        input.conversationId || (await client.reserveLocalConversationId?.(options.sourceId));
      sharedRoomIdentity(conversationId);
      if (await client.read('conversation', conversationId)) fail('SHARED_ROOM_ID_COLLISION');
      const { conversationId: _provided, ...attributes } = clone(input);
      const value = {
        selfName: '我',
        description: '',
        clientMetadata: {},
        category: null,
        idleHours: 5,
        mode: 'session',
        ...attributes,
        conversationId,
      };
      const result = await commit('conversation-create-local', value, {
        ...options,
        optimistic: [
          {
            entityType: 'conversation',
            entityId: conversationId,
            changes: {
              ...value,
              id: conversationId,
              revision: 0,
              pinned: false,
              archived: false,
              listStateRevision: 0,
            },
          },
        ],
      });
      return { ...result, conversationId };
    },
    async update(id, changes, options) {
      const old = await row(id);
      if (options?.expectedRevision !== undefined && options.expectedRevision !== old.revision)
        fail('SHARED_BUSINESS_CONFLICT');
      const input = {
        conversationId: id,
        expectedRevision: old.revision,
        title: changes.title ?? old.title,
        mode: changes.mode ?? old.mode,
        selfName: changes.selfName ?? old.selfName,
        category: changes.category === undefined ? old.category : changes.category,
        idleHours: changes.idleHours ?? old.idleHours,
        description: changes.description ?? old.description,
        clientMetadata: changes.clientMetadata ?? old.clientMetadata ?? {},
      };
      const head = await client.localHeadOperation?.('conversation', id, [
        'conversation-create-local',
        'conversation-save-local',
        'conversation-save',
      ]);
      if (
        head &&
        !['conversation-create-local', 'conversation-save-local', 'conversation-save'].includes(
          head.action,
        )
      )
        fail('SHARED_CONVERSATION_DEPENDENCY_UNSUPPORTED');
      const { expectedRevision: _expectedRevision, ...localInput } = input;
      return commit(
        head ? 'conversation-save-local' : 'conversation-save',
        head ? { ...localInput, baseOperationId: head.operationId } : input,
        {
          ...options,
          expectedLocalRevisions: [
            { entityType: 'conversation', entityId: id, revision: old.localRevision },
          ],
          optimistic: project(id, changes),
        },
      );
    },
    async setState(id, changes, options) {
      if (Object.keys(changes).some((k) => !['pinned', 'archived'].includes(k)))
        fail('SHARED_INVALID_ROOM_STATE');
      const old = await row(id);
      if (
        options?.expectedRevision !== undefined &&
        options.expectedRevision !== old.listStateRevision
      )
        fail('SHARED_BUSINESS_CONFLICT');
      const head = await client.localHeadOperation?.('conversation', id, [
        'conversation-create-local',
        'conversation-list-state',
        'conversation-state-local',
      ]);
      return commit(
        head ? 'conversation-state-local' : 'conversation-list-state',
        head
          ? { conversationId: id, baseOperationId: head.operationId, ...changes }
          : { conversationId: id, expectedRevision: old.listStateRevision, ...changes },
        {
          ...options,
          expectedLocalRevisions: [
            { entityType: 'conversation', entityId: id, revision: old.localRevision },
          ],
          optimistic: project(id, { ...changes, listStateRevision: old.listStateRevision + 1 }),
        },
      );
    },
    async setOrder(order, options) {
      const directory = await list({ includeArchived: true });
      if (
        options?.expectedRevision !== undefined &&
        options.expectedRevision !== directory.revision
      )
        fail('SHARED_BUSINESS_CONFLICT');
      const record = await client.read('order', 'conversation-directory');
      if ((record?.local?.data.revision ?? 0) !== directory.revision)
        fail('SHARED_BUSINESS_CONFLICT');
      if (
        !Array.isArray(order) ||
        order.length !== directory.rooms.length ||
        new Set(order).size !== order.length ||
        order.some((id) => !directory.rooms.some((r) => r.id === id))
      )
        fail('SHARED_ORDER_INCOMPLETE');
      const head = await client.localDirectoryHeadOperation?.();
      return commit(
        head ? 'conversation-order-local' : 'conversation-order',
        head
          ? { baseOperationId: head.operationId, order: clone(order) }
          : { expectedRevision: directory.revision, order: clone(order) },
        {
          ...options,
          expectedLocalRevisions: [
            {
              entityType: 'order',
              entityId: 'conversation-directory',
              revision: record?.localRevision ?? 0,
            },
          ],
          optimistic: [
            {
              entityType: 'order',
              entityId: 'conversation-directory',
              changes: { order: clone(order), revision: directory.revision + 1 },
            },
          ],
        },
      );
    },
    async settings(id, slotId, { refresh = false } = {}) {
      sharedRoomIdentity(id);
      const scope = settingsScope(id, slotId);
      const cached = await client.readCache?.(scope);
      if (cached?.operationId) {
        const operation = await client.readOperation(cached.operationId);
        if (operation?.status !== 'acknowledged')
          return {
            ...clone(cached.value),
            localAck: true,
            serverConfirmed: false,
            operationStatus: operation?.status || 'pending',
          };
        if (!refresh)
          return {
            ...clone(cached.value),
            localAck: true,
            serverConfirmed: true,
            authoritative: false,
          };
      }
      if (cached && !refresh && !cached.operationId) return clone(cached.value);
      const value = (
        await client.query({
          operationId: idFactory(),
          action: 'service-settings-read',
          input: { conversationId: id, ...(slotId === undefined ? {} : { slotId }) },
        })
      ).result;
      await client.writeCache?.(scope, { value: clone(value) });
      return value;
    },
    saveSettings: async (input, options = {}) => {
      sharedRoomIdentity(input.conversationId);
      const scope = settingsScope(input.conversationId, input.slotId);
      const cached = await client.readCache?.(scope);
      if (
        cached?.operationId &&
        (await client.readOperation(cached.operationId))?.status !== 'acknowledged'
      )
        fail('SHARED_SETTINGS_PENDING');
      const operationId = options.operationId || idFactory();
      const value = {
        ...(cached?.value || {}),
        conversationId: input.conversationId,
        slotId: input.slotId,
        providerId: input.providerId,
        config: clone(input.config || {}),
        bindingRevision: input.expectedBindingRevision + 1,
      };
      return commit('service-settings-save', clone(input), {
        ...options,
        operationId,
        localCacheCommit: { scope, expectedValue: cached || null, value: { operationId, value } },
      });
    },
    /** Explicit PC registration: preserves journalSourceUUID + original string roomId.
     * Re-reading never registers a same-name room or changes an existing owner.
     */
    async register(input, options) {
      sharedRoomIdentity(input.conversationId);
      if (input.expectedRevision !== 0) fail('SHARED_INITIAL_REGISTRATION_REQUIRED');
      return commit('conversation-save', input, options);
    },
    operation: (operationId) => client.readOperation(operationId),
  };
}
