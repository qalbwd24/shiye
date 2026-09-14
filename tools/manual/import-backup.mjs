import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import { createDiaryServer } from '../../server.mjs';
import { APP_ROOT } from '../../src/server/config.mjs';
const arg = process.argv.indexOf('--file'),
  file = arg >= 0 ? process.argv[arg + 1] : null;
if (!file) throw Error('Usage: node tools/manual/import-backup.mjs --file <local backup>');
const area = path.join(APP_ROOT, 'var', 'manual-imports');
await fs.mkdir(area, { recursive: true });
const dataDir = await fs.mkdtemp(path.join(area, 'run-')),
  server = await createDiaryServer({ dataDir, seed: false });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
try {
  const response = await fetch(base + '/api/import-upload', {
      method: 'POST',
      headers: {
        'X-Diary-Client': 'desktop',
        'X-File-Name': encodeURIComponent(path.basename(file)),
      },
      body: createReadStream(file),
      duplex: 'half',
    }),
    job = await response.json();
  if (!response.ok) throw Error(job.error);
  const commit = await fetch(base + '/api/import-upload/' + job.id + '/commit', {
      method: 'POST',
      headers: { 'X-Diary-Client': 'desktop', 'Content-Type': 'application/json' },
      body: '{}',
    }),
    result = await commit.json();
  if (!commit.ok) throw Error(result.error);
  await fs.writeFile(path.join(dataDir, 'result.json'), JSON.stringify(result, null, 2), 'utf8');
  console.log(JSON.stringify({ dataDir, ...result }, null, 2));
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
