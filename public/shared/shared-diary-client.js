import { sha256Bytes } from './sync-v2-media.js';
/** Full Entry records remain authoritative on the existing desktop backend.
 * Editing overlays touched fields on the received record, retaining unknown data.
 */
const clone = (value) => structuredClone(value);
const fail = (code) => {
  throw Object.assign(new Error(code), { code });
};
export function createSharedDiaryClient({ client, idFactory = () => crypto.randomUUID() } = {}) {
  if (!client?.enqueue || !client?.read) fail('SHARED_CLIENT_REQUIRED');
  async function read(id) {
    const record = await client.read('entry', id);
    if (!record?.local || record.local.state === 'withdrawn') fail('SHARED_ENTRY_NOT_RECEIVED');
    return clone(record);
  }
  async function commit(action, input, options = {}) {
    const operationId = options.operationId || idFactory();
    let localPayload;
    if (['entry-create', 'entry-save'].includes(action)) {
      const serialized = JSON.stringify(input.entry),
        bytes = new TextEncoder().encode(serialized);
      if (bytes.length > 64 * 1024 * 1024) fail('SHARED_ENTRY_PAYLOAD_TOO_LARGE');
      if (bytes.length > 3 * 1024 * 1024) {
        localPayload = {
          operationId,
          blob: new Blob([serialized], { type: 'application/vnd.shiye.shared-entry+json' }),
          sha256: sha256Bytes(bytes),
          size: bytes.length,
        };
        input = {
          payloadOperationId: operationId,
          ...(action === 'entry-save'
            ? { entryId: input.entryId, expectedRevision: input.entry.revision }
            : {}),
        };
        action += '-ref';
      }
    }
    const enqueued = await client.enqueue({
      operationId,
      action,
      input,
      optimistic: options.optimistic || [],
      expectedLocalRevisions: options.expectedLocalRevisions || [],
      ...(localPayload ? { localPayload } : {}),
    });
    const effect = options.optimistic?.[0];
    const committedLocalRevision = enqueued.localCommitRevisions?.find(
      (revision) =>
        revision.entityType === effect?.entityType && revision.entityId === effect?.entityId,
    )?.revision;
    const local = effect ? await client.read(effect.entityType, effect.entityId) : null;
    const strict =
      options.sync === true || (options.sync === undefined && !options.optimistic?.length);
    if (strict) {
      try {
        await client.sync();
      } catch (error) {
        error.localCommitted = true;
        error.operationId = operationId;
        if (effect) error.entityId = effect.entityId;
        if (effect?.entityType === 'entry') error.entryId = effect.entityId;
        if (committedLocalRevision !== undefined)
          error.committedLocalRevision = committedLocalRevision;
        throw error;
      }
    } else if (options.sync !== false) void client.sync().catch(() => {});
    const operation = client.readOperation ? await client.readOperation(operationId) : {};
    if (strict && client.readOperation && operation?.status !== 'acknowledged') {
      const error = Object.assign(new Error('SHARED_REMOTE_NOT_CONFIRMED'), {
        code: 'SHARED_REMOTE_NOT_CONFIRMED',
        localCommitted: true,
        operationId,
        ...(effect?.entityType === 'entry' ? { entryId: effect.entityId } : {}),
        ...(committedLocalRevision === undefined ? {} : { committedLocalRevision }),
      });
      throw error;
    }
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
  return {
    read,
    listPage: (options) => client.listDiaryPage(options),
    count: (options) => client.readDiarySummary('count', options),
    calendarDates: (options) => client.readDiarySummary('calendar', options),
    currentStreak: (options) => client.readDiarySummary('streak', options),
    neighbor: (options) => client.readDiarySummary('neighbor', options),
    suggestedTitle: (options) => client.readDiarySuggestedTitle(options),
    readDraft: (entryId) => client.readDiarySidecar(entryId, 'draft'),
    readDraftState: (entryId) => client.readDiarySidecar(entryId, 'draft', true),
    saveDraft: (entryId, value, { expectedDraftRevision, baseLocalRevision }) =>
      client.writeDiarySidecar({
        entryId,
        kind: 'draft',
        expectedRevision: expectedDraftRevision,
        baseLocalRevision,
        value,
      }),
    discardDraft: (entryId, { expectedDraftRevision, baseLocalRevision }) =>
      client.writeDiarySidecar({
        entryId,
        kind: 'draft',
        expectedRevision: expectedDraftRevision,
        baseLocalRevision,
        value: null,
      }),
    readReadingState: (entryId) => client.readDiarySidecar(entryId, 'reading'),
    readReadingStateRevision: (entryId) => client.readDiarySidecar(entryId, 'reading', true),
    saveReadingState: (entryId, value, { expectedRevision, baseLocalRevision }) =>
      client.writeDiarySidecar({
        entryId,
        kind: 'reading',
        expectedRevision,
        baseLocalRevision,
        value,
      }),
    async list({ deleted = false, includeChat = false } = {}) {
      return (await client.list('entry'))
        .filter(
          (row) =>
            row.entityType === 'entry' &&
            row.local &&
            row.local.state !== 'withdrawn' &&
            !!row.local.data.deleted === deleted &&
            (includeChat || !row.local.data.chatJournal),
        )
        .map(clone);
    },
    async create(entry, options = {}) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail('SHARED_INVALID_ENTRY');
      const id = entry.id || idFactory();
      if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id))
        fail('SHARED_INVALID_ENTRY_ID');
      if (await client.read('entry', id)) fail('SHARED_ENTRY_ID_COLLISION');
      const complete = { ...clone(entry), id };
      const result = await commit(
        'entry-create-local',
        { entryId: id, entry: complete },
        {
          ...options,
          optimistic: [
            { entityType: 'entry', entityId: id, changes: { ...complete, revision: 0 } },
          ],
        },
      );
      return { ...result, id };
    },
    async save(id, changes, expectedLocalRevision, options) {
      const record = await read(id);
      if (record.localRevision !== expectedLocalRevision) fail('SHARED_LOCAL_REVISION_CONFLICT');
      if (
        !changes ||
        typeof changes !== 'object' ||
        Array.isArray(changes) ||
        Object.keys(changes).some((k) => ['id', 'revision', 'history', 'chatJournal'].includes(k))
      )
        fail('SHARED_INVALID_ENTRY_EDIT');
      if (record.local.data.chatJournal) fail('SHARED_JOURNAL_COMMAND_REQUIRED');
      const head = await client.localHeadOperation?.('entry', id);
      if (!record.base && !head) fail('SHARED_ENTRY_CREATE_DEPENDENCY_MISSING');
      if (
        head &&
        ![
          'entry-create-local',
          'entry-save-local',
          'entry-save',
          'entry-save-ref',
          'entry-delete',
          'entry-restore',
        ].includes(head.action)
      )
        fail('SHARED_ENTRY_DEPENDENCY_UNSUPPORTED');
      const entry = {
        ...clone(record.local.data),
        ...clone(changes),
        revision: record.base?.data.revision ?? 0,
      };
      return commit(
        head ? 'entry-save-local' : 'entry-save',
        { entryId: id, entry, ...(head ? { baseOperationId: head.operationId } : {}) },
        {
          ...options,
          expectedLocalRevisions: [
            { entityType: 'entry', entityId: id, revision: expectedLocalRevision },
          ],
          optimistic: [{ entityType: 'entry', entityId: id, changes: clone(changes) }],
        },
      );
    },
    async setDeleted(id, deleted, options = {}) {
      const record = await read(id);
      // Existing fresh-read callers keep their behavior. A confirmation based on
      // a previously displayed row must carry that row's editor generation.
      const expected = options.expectedLocalRevision;
      if (expected !== undefined && record.localRevision !== expected)
        fail('SHARED_LOCAL_REVISION_CONFLICT');
      if (record.local.data.chatJournal) fail('SHARED_JOURNAL_COMMAND_REQUIRED');
      const head = await client.localHeadOperation?.('entry', id);
      if (head || !record.base) {
        if (
          !head ||
          ![
            'entry-create-local',
            'entry-save-local',
            'entry-save',
            'entry-save-ref',
            'entry-delete',
            'entry-restore',
          ].includes(head.action)
        )
          fail('SHARED_ENTRY_CREATE_DEPENDENCY_MISSING');
        return commit(
          'entry-save-local',
          {
            entryId: id,
            entry: {
              ...clone(record.local.data),
              deleted,
              revision: record.base?.data.revision || 0,
            },
            baseOperationId: head.operationId,
          },
          {
            ...options,
            expectedLocalRevisions: [
              { entityType: 'entry', entityId: id, revision: record.localRevision },
            ],
            optimistic: [{ entityType: 'entry', entityId: id, changes: { deleted } }],
          },
        );
      }
      return commit(
        deleted ? 'entry-delete' : 'entry-restore',
        { entryId: id, revision: record.base.data.revision },
        {
          ...options,
          expectedLocalRevisions: [
            ...(options.expectedLocalRevisions || []),
            ...(expected === undefined
              ? []
              : [{ entityType: 'entry', entityId: id, revision: expected }]),
          ],
          optimistic: [{ entityType: 'entry', entityId: id, changes: { deleted } }],
        },
      );
    },
    async preferences() {
      return clone(await client.read('settings', 'library'));
    },
    async savePreferences(values, expectedRevision, options = {}) {
      const current = await client.read('settings', 'library');
      if (
        !current?.local ||
        current.base?.revision !== expectedRevision ||
        (await client.localHeadOperation?.('settings', 'library'))
      )
        fail('SHARED_PREFERENCES_BASE_REQUIRED');
      return commit(
        'preferences-save',
        { values: clone(values), expectedRevision },
        {
          ...options,
          expectedLocalRevisions: [
            { entityType: 'settings', entityId: 'library', revision: current.localRevision },
          ],
          optimistic: [
            {
              entityType: 'settings',
              entityId: 'library',
              changes: {
                preferences: { ...clone(current.local.data.preferences || {}), ...clone(values) },
              },
            },
          ],
        },
      );
    },
    clientPreferences: (scope) => client.read('client-preferences', scope),
    async saveClientPreferences(scope, set, expectedRevision, options = {}) {
      const current = await client.read('client-preferences', scope);
      if (
        (current?.base?.data?.revision || 0) !== expectedRevision ||
        (await client.localHeadOperation?.('client-preferences', scope))
      )
        fail('SHARED_PREFERENCES_BASE_REQUIRED');
      const values = { ...clone(current?.local?.data?.values || {}), ...clone(set) };
      for (const key of options.remove || []) delete values[key];
      return commit(
        'client-preferences-save',
        { scope, set: clone(set), expectedRevision, remove: clone(options.remove || []) },
        {
          ...options,
          expectedLocalRevisions: [
            {
              entityType: 'client-preferences',
              entityId: scope,
              revision: current?.localRevision || 0,
            },
          ],
          optimistic: [
            {
              entityType: 'client-preferences',
              entityId: scope,
              changes: { scope, revision: expectedRevision + 1, values },
            },
          ],
        },
      );
    },
    templates: async () =>
      (await client.list('template'))
        .filter((r) => r.entityType === 'template' && r.local?.state === 'active')
        .map(clone),
    saveTemplate: (templateId, value, options) =>
      commit(
        templateId ? 'template-save' : 'template-create',
        templateId ? { templateId, value: clone(value) } : { value: clone(value) },
        options,
      ),
    saveTaxonomy: (value, options) => commit('taxonomy-save', clone(value), options),
    saveTaxonomyOrder: (value, options) => commit('taxonomy-order', clone(value), options),
    saveComment: (entryId, commentId, value, options) =>
      commit(
        commentId ? 'comment-save' : 'comment-create',
        { entryId, ...(commentId ? { commentId } : {}), value: clone(value) },
        options,
      ),
    refresh: () => client.sync(),
    operation: (operationId) => client.readOperation(operationId),
  };
}
