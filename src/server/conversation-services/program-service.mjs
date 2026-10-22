import { AsyncLocalStorage } from 'node:async_hooks';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createProgramAuth, validateProgramScope } from './program-auth.mjs';
import {
  describeConversation,
  readConversationFeed,
  conversationContext,
  sendConversationMessage,
  withdrawConversationMessage,
} from './conversations.mjs';
import { sharedInfo } from '../shared-sync/replication.mjs';
import {
  readSharedConversationFeed,
  readSharedFeedItem,
} from '../shared-sync/conversation-feed.mjs';
import { createSharedMedia } from '../shared-sync/media.mjs';
import { portableConfiguration } from '../sync-product/migration-metadata.mjs';

const BASE = '/api/shared/v1/program/';
const fail = (status, code) => {
  throw Object.assign(Error(code), { status, code });
};
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const mediaCaches = new WeakMap();
function referencedMedia(db, conversationId, published = true) {
  let cache = published ? mediaCaches.get(db) : null;
  if (!cache) {
    cache = new Map();
    if (published) mediaCaches.set(db, cache);
  }
  if (!cache.has(conversationId)) {
    const ids = new Set();
    let after,
      pages = 0;
    do {
      const page = readConversationFeed(db, { conversationId, after, limit: 100 });
      for (const row of page.messages)
        if (row.state === 'active') {
          for (const id of row.attachments || []) ids.add(id);
          for (const media of row.source?.media || []) {
            if (typeof media === 'string') ids.add(media);
            else if (media.id) ids.add(media.id);
          }
        }
      if (!page.hasMore) break;
      after = page.next;
      if (++pages > 10000) fail(413, 'PROGRAM_FEED_TOO_LARGE');
    } while (after);
    cache.set(conversationId, ids);
  }
  return cache.get(conversationId);
}
export async function createProgramService({ store, dataDir, body, reply }) {
  const auth = await createProgramAuth({ dataDir }),
    context = new AsyncLocalStorage();
  const guardedStore = {
    ...store,
    mutate(fn, options) {
      const current = context.getStore();
      return store.mutate((db) => {
        auth.revalidate(db, current.credential, 'media:upload');
        return fn(db);
      }, options);
    },
  };
  const media = createSharedMedia({
    store: guardedStore,
    dataDir,
    body,
    reply(res, status, value) {
      const current = context.getStore();
      if (status === 200 && current.action !== 'media/read' && value.asset)
        auth.grantMedia(current.credential.credentialId, current.input.operationId, value.asset.id);
      return reply(res, status, value);
    },
  });
  const issuer = {
    issue: (options) => auth.issue(store.getDb(), options),
    rotate: (id) => auth.rotate(store.getDb(), id),
    revoke: (id) => auth.revoke(id),
  };
  return {
    issuer,
    matches: (pathname) => typeof pathname === 'string' && pathname.startsWith(BASE),
    close: () => auth.close(),
    async handle(req, res, pathname) {
      if (!pathname.startsWith(BASE)) return false;
      try {
        if (req.method !== 'POST') fail(405, 'PROGRAM_METHOD_NOT_ALLOWED');
        const credential = auth.authenticate(req.headers.authorization, store.getDb());
        const input = JSON.parse((await body(req, 2 * 1024 * 1024)).toString('utf8'));
        if (!object(input)) fail(400, 'PROGRAM_INVALID_INPUT');
        if (Object.hasOwn(input, 'replacementOf') || Object.hasOwn(input, 'replacementRootId'))
          fail(400, 'PROGRAM_REPLACEMENT_UNSUPPORTED');
        if (
          Object.keys(input).some((k) =>
            ['actorId', 'actor', 'sender', 'sourceKind', 'providerId'].includes(k),
          )
        )
          fail(403, 'PROGRAM_ACTOR_FORBIDDEN');
        if (
          input.conversationId !== undefined &&
          input.conversationId !== credential.conversationId
        )
          fail(403, 'PROGRAM_CONVERSATION_FORBIDDEN');
        if (
          (input.libraryId !== undefined && input.libraryId !== credential.libraryId) ||
          (input.epoch !== undefined && input.epoch !== credential.epoch)
        )
          fail(403, 'PROGRAM_LIBRARY_MISMATCH');
        const action = pathname.slice(BASE.length),
          db = store.getDb();
        const requireScope = (scope) => auth.revalidate(db, credential, scope);
        const bound = {
          ...input,
          conversationId: credential.conversationId,
          actorId: `program:${credential.instanceId}`,
        };
        if (action === 'info') {
          requireScope('read');
          const { instance } = validateProgramScope(db, credential);
          return reply(res, 200, {
            version: 1,
            instanceId: instance.id,
            conversationId: credential.conversationId,
            actorId: bound.actorId,
            name: instance.state.config.sender.name,
            providerId: instance.providerId,
            kind: instance.state.config.kind || 'program',
            sourceKind: 'backend-service',
            scopes: credential.scopes,
            config: portableConfiguration(instance.state.config),
            aiExecution: false,
          });
        }
        if (action === 'read') {
          requireScope('read');
          return reply(res, 200, portableConfiguration(describeConversation(db, bound)));
        }
        if (action === 'feed') {
          requireScope('feed');
          return reply(res, 200, readSharedConversationFeed(db, bound));
        }
        if (action === 'feed-item/read') {
          requireScope('feed');
          if (input.payload?.conversationId !== credential.conversationId)
            fail(403, 'PROGRAM_CONVERSATION_FORBIDDEN');
          return reply(res, 200, { info: sharedInfo(db), ...readSharedFeedItem(db, input) });
        }
        if (action === 'context') {
          requireScope('context');
          return reply(res, 200, conversationContext(db, bound));
        }
        if (action === 'send' || action === 'withdraw') {
          const needed =
            action === 'withdraw' ? 'withdraw' : input.kind === 'comment' ? 'comment' : 'send';
          requireScope(needed);
          if (action === 'send' && input.replyToMessageId) requireScope('reply');
          if (
            action === 'send' &&
            input.attachments?.some(
              (id) =>
                !referencedMedia(db, credential.conversationId).has(id) &&
                !auth.ownsMedia(credential.credentialId, id),
            )
          )
            fail(403, 'PROGRAM_MEDIA_FORBIDDEN');
          const result = await store.mutate((next) => {
            auth.revalidate(next, credential, needed);
            if (action === 'send' && input.replyToMessageId)
              auth.revalidate(next, credential, 'reply');
            if (
              action === 'send' &&
              input.attachments?.some(
                (id) =>
                  !referencedMedia(next, credential.conversationId, false).has(id) &&
                  !auth.ownsMedia(credential.credentialId, id),
              )
            )
              fail(403, 'PROGRAM_MEDIA_FORBIDDEN');
            return action === 'send'
              ? sendConversationMessage(next, bound, Date.now(), { allowLegacyService: true })
              : withdrawConversationMessage(next, bound, Date.now(), { serviceParticipant: true });
          });
          return reply(res, 200, result);
        }
        if (['media/read', 'media/begin', 'media/chunk', 'media/complete'].includes(action)) {
          requireScope(action === 'media/read' ? 'media:read' : 'media:upload');
          if (action === 'media/read') {
            if (
              !referencedMedia(db, credential.conversationId).has(input.assetId) &&
              !auth.ownsMedia(credential.credentialId, input.assetId)
            )
              fail(403, 'PROGRAM_MEDIA_FORBIDDEN');
          } else {
            if (
              action === 'media/begin' &&
              !auth.upload(credential.credentialId, input.operationId, null)
            ) {
              let staged = false;
              try {
                await fs.stat(path.join(dataDir, '.shared-uploads', input.operationId + '.json'));
                staged = true;
              } catch (error) {
                if (error.code !== 'ENOENT') throw error;
              }
              if (staged || db._sharedMedia?.some((row) => row.operationId === input.operationId))
                fail(403, 'PROGRAM_MEDIA_FORBIDDEN');
            }
            auth.upload(credential.credentialId, input.operationId, action === 'media/begin');
          }
          const wire = Buffer.from(
            JSON.stringify({ ...input, libraryId: credential.libraryId, epoch: credential.epoch }),
          );
          return context.run({ credential, action, input }, () =>
            media.handle(
              {
                method: 'POST',
                async *[Symbol.asyncIterator]() {
                  yield wire;
                },
              },
              res,
              '/api/shared/v1/' + action,
            ),
          );
        }
        fail(404, 'PROGRAM_ACTION_FORBIDDEN');
      } catch (error) {
        return reply(res, error.status || 500, {
          error: {
            code:
              error.code || (error.status ? 'PROGRAM_BUSINESS_REJECTED' : 'PROGRAM_REQUEST_FAILED'),
          },
        });
      }
    },
  };
}
