import { sharedInfo, sharedEntityRead } from './replication.mjs';

/** Fixed bounded JSON transport; bytes are derived from the current owner/index,
 * never a client-selected file or URL, and have no independent business store. */
export function createSharedEntityPayload({ store, body, reply }) {
  return {
    async handle(req, res, pathname) {
      if (pathname !== '/api/shared/v1/entity/read') return false;
      try {
        if (req.method !== 'POST')
          throw Object.assign(Error(), { status: 404, code: 'SHARED_ACTION_NOT_FOUND' });
        const input = JSON.parse((await body(req, 16384)).toString('utf8'));
        if (
          !input ||
          typeof input !== 'object' ||
          Array.isArray(input) ||
          Object.keys(input).some(
            (k) =>
              ![
                'libraryId',
                'epoch',
                'entityType',
                'entityId',
                'revision',
                'offset',
                'length',
              ].includes(k),
          )
        )
          throw Object.assign(Error(), { status: 400, code: 'SHARED_INVALID_INPUT' });
        const db = store.getDb(),
          info = sharedInfo(db);
        if (!info.enabled)
          throw Object.assign(Error(), { status: 503, code: 'SHARED_SYNC_NOT_ENABLED' });
        if (input.libraryId !== info.libraryId || input.epoch !== info.epoch)
          throw Object.assign(Error(), { status: 409, code: 'SHARED_LIBRARY_MISMATCH' });
        return reply(res, 200, { info, ...sharedEntityRead(db, input) });
      } catch (error) {
        return reply(res, error.status || 500, {
          error: { code: /^SHARED_/.test(error.code) ? error.code : 'SHARED_ENTITY_READ_FAILED' },
        });
      }
    },
  };
}
