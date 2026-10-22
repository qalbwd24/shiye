// Stable entrypoint used by the Windows launcher and external callers.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDiaryServer } from './src/server/app.mjs';
import { runtimeConfig } from './src/server/config.mjs';
import { selectedBackend } from './src/server/runtime-release.mjs';
export { createDiaryServer };
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = runtimeConfig();
  const runtime = await selectedBackend(path.dirname(fileURLToPath(import.meta.url)), process.env, {
    dataDir: config.dataDir,
  });
  const server = await (runtime?.createDiaryServer || createDiaryServer)({
    dataDir: config.dataDir,
    revisitAutoStart: true,
    sharedSync: config.sharedSync,
    sharedRemote: config.sharedRemote,
    sourceCollection: config.sourceCollection,
    manualCutWrites: runtime?.manualCutWrites !== false,
  });
  server.on('error', (error) => {
    console.error(error.code);
    process.exitCode = 1;
  });
  server.listen(config.port, config.host, () =>
    console.log(`Diary desktop: http://${config.host}:${config.port}`),
  );
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => server.close(() => process.exit()));
}
