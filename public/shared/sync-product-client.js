import { normalizeSyncBaseUrl, createSyncOperationId } from './sync-v2-client.js';

const routes = Object.freeze({
  catalog: ['GET', 'catalog'],
  library: ['GET', 'library'],
  saveRoom: ['POST', 'chat/room'],
  sendMessages: ['POST', 'chat/send'],
  withdrawMessage: ['POST', 'chat/withdraw'],
  revisitStatus: ['GET', 'revisit'],
  configureRevisit: ['PUT', 'revisit/config'],
  tickRevisit: ['POST', 'revisit/tick'],
  revisitFeed: ['POST', 'revisit/feed'],
  commentContext: ['POST', 'revisit/comments/context'],
  addComment: ['POST', 'revisit/comments'],
  withdrawComment: ['POST', 'revisit/comments/withdraw'],
  revisitSource: ['POST', 'revisit/source'],
});

/** Business transport only. The caller owns local rendering and durable repositories. */
export function createProductServiceClient({
  baseUrl,
  token,
  fetchImpl = globalThis.fetch,
  timeoutMs = 30000,
} = {}) {
  const base = normalizeSyncBaseUrl(baseUrl);
  return Object.fromEntries(
    Object.entries(routes).map(([name, [method, route]]) => [
      name,
      async (input, { signal } = {}) => {
        const timeout = AbortSignal.timeout(timeoutMs);
        const response = await fetchImpl(`${base}api/product/v1/${route}`, {
          method,
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          ...(method === 'GET' ? {} : { body: JSON.stringify(input || {}) }),
        });
        const result = await response.json();
        if (!response.ok)
          throw Object.assign(new Error(result.error?.code || 'PRODUCT_REQUEST_FAILED'), {
            status: response.status,
            code: result.error?.code || 'PRODUCT_REQUEST_FAILED',
          });
        return result;
      },
    ]),
  );
}

const queued = new Set(['sendMessages', 'withdrawMessage', 'addComment', 'withdrawComment']);
/** Same transaction port as the local authority, NOT an asynchronous copy from a TL store.
 * localCommit(tx, job) must write message/comment + files/task references in this transaction.
 * Assets and taxonomy must already be synchronized before flush().
 */
export function createProductCommandQueue({
  storage,
  client,
  libraryId,
  epoch,
  idFactory = createSyncOperationId,
} = {}) {
  if (!storage?.transaction || !client || !libraryId || !epoch)
    throw new Error('EXPLICIT_PRODUCT_CONTEXT_REQUIRED');
  const identity = { libraryId, epoch };
  let active;
  const check = (meta) => {
    if (meta.identity && (meta.identity.libraryId !== libraryId || meta.identity.epoch !== epoch))
      throw new Error('server-identity-mismatch');
    if (
      meta.productCommands?.some(
        (j) => j.identity.libraryId !== libraryId || j.identity.epoch !== epoch,
      )
    )
      throw new Error('queued-library-mismatch');
  };
  return {
    enqueue(action, input, localCommit) {
      if (!queued.has(action) || typeof localCommit !== 'function')
        throw new Error('ATOMIC_LOCAL_COMMIT_REQUIRED');
      const job = { id: idFactory(), action, input: structuredClone(input), identity };
      if (action === 'addComment') job.input.operationId ||= job.id;
      if (action === 'withdrawComment' && !job.input.operationId)
        throw new Error('ORIGINAL_COMMENT_OPERATION_REQUIRED');
      return storage.transaction(async (tx) => {
        const meta = (await tx.getMeta()) || {};
        check(meta);
        await localCommit(tx, structuredClone(job));
        // Re-read: the local authority may have updated metadata in the same transaction.
        const next = (await tx.getMeta()) || meta;
        next.productCommands = [...(next.productCommands || []), job];
        await tx.setMeta(next);
        return structuredClone(job);
      });
    },
    pending: () =>
      storage.transaction(async (tx) =>
        structuredClone((await tx.getMeta())?.productCommands || []),
      ),
    flush(onReceipt = async () => {}) {
      if (active) return active;
      active = (async () => {
        let accepted = 0;
        const remote = await client.catalog();
        if (remote.libraryId !== libraryId || remote.epoch !== epoch)
          throw new Error('server-identity-mismatch');
        for (;;) {
          const job = await storage.transaction(async (tx) => {
            const meta = (await tx.getMeta()) || {};
            check(meta);
            return meta.productCommands?.[0];
          });
          if (!job) return { accepted };
          const receipt = await client[job.action](job.input);
          await storage.transaction(async (tx) => {
            const meta = (await tx.getMeta()) || {};
            check(meta);
            if (meta.productCommands?.[0]?.id !== job.id) throw new Error('PRODUCT_QUEUE_CHANGED');
            await onReceipt(tx, structuredClone(job), receipt);
            const next = (await tx.getMeta()) || meta;
            next.productCommands = (next.productCommands || []).filter((j) => j.id !== job.id);
            await tx.setMeta(next);
          });
          accepted++;
        }
      })().finally(() => {
        active = null;
      });
      return active;
    },
  };
}
