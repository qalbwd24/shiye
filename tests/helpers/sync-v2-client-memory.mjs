/** Synthetic transactional port; persisted is shared by reopened instances. */
export function createMemorySyncStorage(
  persisted = { meta: undefined, entities: new Map(), pending: new Map(), conflicts: new Map() },
) {
  let tail = Promise.resolve();
  return {
    persisted,
    transaction(fn) {
      const task = tail.then(async () => {
        const draft = structuredClone(persisted);
        const key = (type, id) => JSON.stringify([type, id]);
        const result = await fn({
          getMeta: async () => structuredClone(draft.meta),
          setMeta: async (value) => {
            draft.meta = structuredClone(value);
          },
          getEntity: async (type, id) => structuredClone(draft.entities.get(key(type, id))),
          putEntity: async (record) => {
            draft.entities.set(key(record.entityType, record.entityId), structuredClone(record));
          },
          listEntities: async (type) =>
            structuredClone(
              [...draft.entities.values()].filter((r) => !type || r.entityType === type),
            ),
          listPending: async () => structuredClone([...draft.pending.values()]),
          putPending: async (record) => {
            draft.pending.set(record.operationId, structuredClone(record));
          },
          deletePending: async (id) => {
            draft.pending.delete(id);
          },
          listConflicts: async () => structuredClone([...draft.conflicts.values()]),
          putConflict: async (record) => {
            draft.conflicts.set(record.operationId, structuredClone(record));
          },
        });
        Object.assign(persisted, draft);
        return structuredClone(result);
      });
      tail = task.catch(() => {});
      return task;
    },
  };
}
