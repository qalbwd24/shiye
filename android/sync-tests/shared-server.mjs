import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createDiaryServer } from '../../src/server/app.mjs';

// This standalone fixture never reads the runtime selector or an existing diary library.
const work = path.resolve('tmp/shared-business-native', randomUUID());
await fs.mkdir(work, { recursive: true });
const server = await createDiaryServer({ dataDir: work, seed: false, sharedSync: true });
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(19421, '127.0.0.1', resolve);
});
console.log(
  JSON.stringify({ ready: true, pid: process.pid, port: 19421, dataDir: work, synthetic: true }),
);
async function stop() {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  process.exit(0);
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
