import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { parseSyncServerArguments, startSyncServerCli } from './sync-server.mjs';
import { productSyncExtension } from '../src/server/sync-product/service.mjs';
import { seedProductLibrary } from '../src/server/sync-product/import.mjs';

export async function startProductSync(args = []) {
  let libraryFile;
  const remaining = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--seed-library') {
      if (libraryFile || !args[i + 1] || args[i + 1].startsWith('--'))
        throw new Error('INVALID_SEED_ARGUMENT');
      libraryFile = path.resolve(args[++i]);
    } else remaining.push(args[i]);
  }
  const options = parseSyncServerArguments(remaining);
  if (options.help) {
    console.log(
      'product-sync-server --host 127.0.0.1 --port 18789 --data-dir var/product-sync-lab [--seed-library ABSOLUTE/diary.json]',
    );
    return;
  }
  if (!remaining.includes('--port')) options.port = 18789;
  if (!remaining.includes('--data-dir'))
    options.dataDir = path.resolve(import.meta.dirname, '../var/product-sync-lab');
  options.extensionFactory = productSyncExtension();
  if (libraryFile)
    options.beforeListen = async (service) => {
      const report = await seedProductLibrary(service, {
        libraryFile,
        mediaDir: path.join(path.dirname(libraryFile), 'media'),
      });
      await writeFile(
        path.join(options.dataDir, 'seed-report.json'),
        JSON.stringify(report, null, 2),
      );
    };
  return startSyncServerCli(options);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const started = await startProductSync(process.argv.slice(2));
    if (started)
      for (const signal of ['SIGINT', 'SIGTERM'])
        process.on(signal, () => {
          void started.stop().catch(() => {
            process.exitCode = 1;
          });
        });
  } catch (error) {
    console.error(
      /^[A-Z0-9_]{1,80}$/.test(error.code || error.message || '')
        ? error.code || error.message
        : 'PRODUCT_SYNC_START_FAILED',
    );
    process.exitCode = 1;
  }
}
