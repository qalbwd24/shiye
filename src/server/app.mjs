import http from 'node:http';
import { APP, VERSION, DEFAULT_DATA_DIR } from './config.mjs';
import { body, reply, fail, guardRequest, replyError } from './http.mjs';
import { createLibraryStore } from './storage/library-store.mjs';
import { localSecurity } from './security/access.mjs';
import { backupStore } from './routes/backups.mjs';
import { largeImporter } from './routes/imports.mjs';
import { offlineRoutes } from './routes/organization.mjs';
import { createRoutes as settingsRoutes } from './routes/settings.mjs';
import { createRoutes as legacyRoutes } from './routes/legacy-backups.mjs';
import { createRoutes as entryRoutes } from './routes/entries.mjs';
import { createRoutes as mediaRoutes } from './routes/media.mjs';
import { staticRoute } from './routes/static.mjs';

/** Composition root: construct storage and explicit route factories once per server. */
export async function createDiaryServer({ dataDir = DEFAULT_DATA_DIR, seed = true } = {}) {
  const store = await createLibraryStore({ dataDir, seed });
  const context = { dataDir, ...store, body, reply, fail };
  const security = await localSecurity(context);
  const routes = [
    backupStore(context),
    largeImporter(context),
    offlineRoutes(context),
    settingsRoutes(context),
    legacyRoutes(context),
    entryRoutes(context),
    mediaRoutes(context),
    staticRoute,
  ];
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = guardRequest(req, res);
      if (await security(req, res, pathname)) return;
      if (pathname === '/api/health' && req.method === 'GET')
        return reply(res, 200, { app: APP.id, version: VERSION });
      if (pathname === '/api/library' && req.method === 'GET')
        return reply(res, 200, store.getDb());
      for (const route of routes) if (await route(req, res, pathname)) return;
      throw fail(404, '未找到内容');
    } catch (error) {
      replyError(res, error);
    }
  });
  server.requestTimeout = 0;
  return server;
}
