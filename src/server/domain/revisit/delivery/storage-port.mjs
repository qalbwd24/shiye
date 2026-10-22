/** Adapt the existing single-writer library, not a second database or per-service queue. */
export function createLibraryDeliveryPort({ getDb, mutate }) {
  return Object.freeze({
    read: (query) => query(getDb()),
    transaction: (operation, options) =>
      mutate((db) => {
        const result = operation(db);
        if (result && typeof result.then === 'function')
          throw new TypeError('推送事务必须同步完成，不得在提交中等待外部服务');
        return result;
      }, options),
  });
}
