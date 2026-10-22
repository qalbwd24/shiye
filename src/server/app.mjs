import { createRoutes as conflictRoutes } from './routes/conflicts.mjs';
import { createRoutes as commentRoutes } from './routes/comments.mjs';
import { createRoutes as compressionRoutes } from './routes/media-compression.mjs';
import { createRoutes as stickerRoutes } from './routes/stickers.mjs';
import http from 'node:http';
import { preserveLegacyMetadata } from './storage/legacy-metadata.mjs';
import { ensureMediaHashes } from './storage/media-hashes.mjs';
import { APP, VERSION, DEFAULT_DATA_DIR } from './config.mjs';
import { body, reply, fail, guardRequest, replyError } from './http.mjs';
import { createLibraryStore } from './storage/library-store.mjs';
import { localSecurity } from './security/access.mjs';
import { backupStore } from './routes/backups.mjs';
import { largeImporter } from './routes/imports.mjs';
import { createRoutes as preferenceRoutes } from './routes/preferences.mjs';
import { createRoutes as taxonomyRoutes } from './routes/taxonomy.mjs';
import { createRoutes as templateRoutes } from './routes/templates.mjs';
import { createRoutes as settingsRoutes } from './routes/settings.mjs';
import { createRoutes as legacyRoutes } from './routes/legacy-backups.mjs';
import { createRoutes as entryRoutes } from './routes/entries.mjs';
import { createRoutes as entryReadingRoutes } from './routes/entry-reading-document.mjs';
import { createRoutes as mediaRoutes } from './routes/media.mjs';
import { createStaticRoute } from './routes/static.mjs';
import { createAppearanceRoutes } from './routes/appearance.mjs';
import { createRoutes as syncRoutes } from './routes/sync.mjs';
import { createRoutes as openDataRoutes } from './routes/open-data.mjs';
import { preserveOldBackgrounds } from './storage/appearance-compat.mjs';
import { createRoutes as chatJournalRoutes } from './routes/chat-journal.mjs';
import { closeIdleChatEntries } from './domain/chat-journal.mjs';
import { createRoutes as messageUnitRoutes } from './routes/message-units.mjs';
import { createRoutes as revisitRoutes } from './routes/revisit.mjs';
import { createRoutes as revisitRunnerRoutes } from './routes/revisit-runner.mjs';
import { createRoutes as conversationServiceRoutes } from './routes/conversation-services.mjs';
import { createSharedBusinessService } from './shared-sync/service.mjs';
import { createSharedRemoteAuth, assertLegacyLocal } from './shared-sync/auth.mjs';
import { createProgramService } from './conversation-services/program-service.mjs';
import { createSourceCollectionRoute } from './shared-sync/source-collection.mjs';

/** Composition root: construct storage and explicit route factories once per server. */
export async function createDiaryServer({
  dataDir = DEFAULT_DATA_DIR,
  seed = true,
  messageUnits = process.env.SHIYE_MESSAGE_UNITS === '1',
  revisitAutoStart = false,
  sharedSync = false,
  sharedRemote = false,
  sourceCollection = false,
} = {}) {
  const store = await createLibraryStore({ dataDir, seed, sharedSync });
  if (sourceCollection && !store.getDb()._sharedSync)
    throw fail(400, 'SOURCE_COLLECTION_SHARED_OWNER_REQUIRED');
  let routes;
  const shared = createSharedBusinessService({
    dataDir,
    store,
    body,
    reply,
    enabled: sharedSync,
    messageUnitsEnabled: messageUnits,
    dispatch: async (req, res, pathname) => {
      for (const route of routes) if (await route(req, res, pathname)) return true;
      return false;
    },
  });
  const context = {
    dataDir,
    ...store,
    mutate: shared.mutate,
    body: shared.body,
    reply,
    fail,
    messageUnitsEnabled: messageUnits,
  };
  await preserveOldBackgrounds(context);
  await preserveLegacyMetadata(context);
  await ensureMediaHashes(context);
  const security = await localSecurity(context);
  const programs = store.getDb()._sharedSync
    ? await createProgramService({ store, dataDir, body, reply })
    : null;
  const dispatchProgram = async (req, res, pathname) => {
    if (!programs?.matches(pathname)) return false;
    // Explicit user policy (2026-10-19): trusted backend credentials are
    // independent of the frontend password session and separately revocable.
    return programs.handle(req, res, pathname);
  };
  const runnerHost = revisitRunnerRoutes(context);
  const conversationServices = conversationServiceRoutes(context);
  routes = [
    ...(sourceCollection
      ? [
          createSourceCollectionRoute({
            exportsDir: sourceCollection.exportsDir,
            dataDir,
            store,
            body,
            reply,
          }),
        ]
      : []),
    backupStore(context),
    largeImporter(context),
    preferenceRoutes(context),
    taxonomyRoutes(context),
    conflictRoutes(context),
    commentRoutes(context),
    compressionRoutes(context),
    stickerRoutes(context),
    templateRoutes(context),
    settingsRoutes(context),
    legacyRoutes(context),
    entryRoutes(context),
    messageUnitRoutes(context),
    entryReadingRoutes(context),
    mediaRoutes(context),
    createAppearanceRoutes(context),
    syncRoutes(context),
    openDataRoutes(context),
    chatJournalRoutes(context),
    runnerHost.handle,
    revisitRoutes(context),
    conversationServices.handle,
    createStaticRoute(context),
  ];
  if (sharedRemote?.enabled && !sharedSync && !store.getDb()._sharedSync)
    throw fail(400, 'SHARED_SYNC_REQUIRED_FOR_REMOTE');
  const sharedRemoteAuth = await createSharedRemoteAuth({
    dataDir,
    options: sharedRemote,
    body,
    reply,
    authorizeLocal: async (req, res) => security(req, res, guardRequest(req, res)),
    dispatch: shared.handle,
    dispatchProgram,
  });
  const server = http.createServer(async (req, res) => {
    try {
      if (sharedRemoteAuth?.matches(req)) {
        await sharedRemoteAuth.handle(req, res);
        return;
      }
      assertLegacyLocal(req);
      const pathname = guardRequest(req, res);
      if (programs?.matches(pathname)) {
        if (!req.url.startsWith('/') || req.url.startsWith('//'))
          throw Object.assign(fail(400, '程序请求路径不正确'), { code: 'PROGRAM_INVALID_REQUEST' });
        await dispatchProgram(req, res, pathname);
        return;
      }
      const resumeRevisit = (cookie = req.headers.cookie || '') => {
        if (revisitAutoStart) {
          const session = cookie.match(/(?:^|;\s*)(diary_session=[a-f0-9]{64})(?:;|$)/)?.[1] || '';
          void runnerHost.autoStart(req.socket.localPort, session);
          void conversationServices.autoStart(req.socket.localPort, session);
        }
      };
      if (await security(req, res, pathname)) {
        if (
          res.statusCode === 200 &&
          (pathname === '/api/unlock' || (pathname === '/api/access' && req.method === 'PUT'))
        )
          resumeRevisit(String(res.getHeader('Set-Cookie') || ''));
        return;
      }
      if (await shared.handle(req, res, pathname)) {
        resumeRevisit();
        return;
      }
      if (
        pathname.startsWith('/api/') &&
        pathname !== '/api/health' &&
        !pathname.startsWith('/api/revisit/runner')
      )
        resumeRevisit();
      if (pathname === '/api/health' && req.method === 'GET')
        return reply(res, 200, {
          app: APP.id,
          version: VERSION,
          sharedBusiness: {
            version: 1,
            enabled: shared.enabled(),
            configured: sharedSync,
            sameBusinessStore: true,
            seed: {
              enabled: shared.enabled(),
              containerVersion: 1,
              manifestVersions: [1, 2],
              features: ['conversation-feeds-v1', 'seed-attestation-ed25519-v1'],
            },
            backendPrograms: {
              version: 1,
              enabled: !!programs,
              endpoint: '/api/shared/v1/program/',
              independentFrontendLock: true,
              aiExecution: false,
            },
          },
          contentFormats: ['html', 'markdown', 'richdoc'],
          inlineMedia: ['image', 'video'],
          entryReadingDocuments: true,
          messageUnits: { version: 1, enabled: !!messageUnits },
          stickerCollection: {
            version: 1,
            metadata: 1,
            catalog: true,
            fromMessage: true,
            sourceKinds: ['chat', 'unit'],
          },
          revisit: {
            version: 1,
            paragraphMessages: 1,
            paragraphIndentation: 1,
            inertLegacyParsing: 1,
            idleTickPreflight: 1,
            sourceSessionCache: 1,
            scheduler: 'external',
            runnerControl: 1,
            autoStart: revisitAutoStart,
          },
          conversationServices: {
            version: 1,
            providers: ['revisit', 'external-program'],
            isolatedInstances: true,
            atomicConversationSettings: 1,
            conversationMessaging: 1,
            sharedDirectory: 1,
            autoStart: revisitAutoStart,
          },
        });
      if (pathname === '/api/library' && req.method === 'GET')
        return reply(res, 200, store.getDb());
      for (const route of routes)
        if (await route(req, res, pathname)) {
          if (
            pathname === '/api/revisit/config' ||
            pathname.startsWith('/api/conversation-services')
          )
            resumeRevisit();
          return;
        }
      throw fail(404, '未找到内容');
    } catch (error) {
      replyError(res, error);
    }
  });
  server.requestTimeout = 0;
  if (programs) Object.defineProperty(server, 'programIssuer', { value: programs.issuer });
  if (revisitAutoStart)
    server.once('listening', () => {
      void runnerHost.autoStart(server.address().port);
      void conversationServices.autoStart(server.address().port);
    });
  const closeIdle = () => {
    if (
      store
        .getDb()
        .entries.some(
          (e) =>
            e.chatJournal?.status === 'open' && Date.parse(e.chatJournal.deadline) <= Date.now(),
        )
    )
      return store.mutate((d) => closeIdleChatEntries(d));
  };
  try {
    await closeIdle();
  } catch (error) {
    sharedRemoteAuth?.close();
    programs?.close();
    throw error;
  }
  const idleTimer = setInterval(() => {
    Promise.resolve(closeIdle()).catch(() => {});
  }, 60000);
  idleTimer.unref();
  server.once('close', () => clearInterval(idleTimer));
  server.once('close', () => {
    sharedRemoteAuth?.close();
    programs?.close();
    void runnerHost.close();
    void conversationServices.close();
  });
  return server;
}
