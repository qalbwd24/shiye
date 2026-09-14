// Development UI always uses its own data directory and a different port.
import path from 'node:path';
import { createDiaryServer } from '../server.mjs';
import { APP_ROOT } from '../src/server/config.mjs';
const server = await createDiaryServer({ dataDir: path.join(APP_ROOT, 'var', 'dev-data') });
server.on('error', (error) => {
  console.error(error.code);
  process.exitCode = 1;
});
server.listen(18766, '127.0.0.1', () =>
  console.log('Isolated development UI: http://127.0.0.1:18766'),
);
