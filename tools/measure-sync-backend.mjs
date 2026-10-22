import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createSyncServer } from '../src/server/sync-v2/server.mjs';

// Synthetic loopback measurement only. Never imports the daily library.
const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'outputs/sync-backend');
const temporary = path.join(root, 'tmp/sync-backend');
await Promise.all([mkdir(out, { recursive: true }), mkdir(temporary, { recursive: true })]);
const dataDir = await mkdtemp(path.join(temporary, 'measure-'));
const service = await createSyncServer({ dataDir });
try {
  await new Promise((resolve) => service.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${service.server.address().port}/api/sync/v1/`;
  const code = service.auth.pairingCode().code;
  const pair = await fetch(`${base}pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, deviceName: 'synthetic-measure' }),
  });
  const { token } = await pair.json();
  const timings = [];
  let pulledBytes = 0;
  async function request(route, body) {
    const response = await fetch(`${base}${route}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    assert.equal(response.status, 200);
    if (route === 'pull') pulledBytes += Buffer.byteLength(text);
    return JSON.parse(text);
  }
  for (let batch = 0; batch < 10; batch++) {
    const result = await request('push', {
      operations: Array.from({ length: 100 }, (_, offset) => {
        const id = batch * 100 + offset;
        return {
          operationId: `seed-${id}`,
          entityType: 'chatMessage',
          entityId: `message-${id}`,
          baseRevision: 0,
          command: 'create',
          data: { content: `Synthetic ${id} ${'x'.repeat(2000)}` },
        };
      }),
    });
    assert.equal(result.results.filter((item) => item.status === 'accepted').length, 100);
  }
  let cursor,
    more = true,
    firstBytes = 0,
    count = 0;
  while (more) {
    const page = await request('snapshot', { cursor, limit: 200 });
    count += page.entities.length;
    firstBytes += Buffer.byteLength(JSON.stringify(page));
    cursor = page.hasMore ? page.cursor : page.checkpoint;
    more = page.hasMore;
  }
  assert.equal(count, 1000);
  const noChange = await request('pull', { cursor });
  assert.equal(noChange.changes.length, 0);
  cursor = noChange.cursor;
  const idleBytes = pulledBytes;
  pulledBytes = 0;
  for (let i = 0; i < 20; i++) {
    const started = performance.now();
    const watching = fetch(`${base}watch?cursor=${encodeURIComponent(cursor)}&timeout=2000`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((response) => response.json());
    const update = await request('push', {
      operations: [
        {
          operationId: `edit-${i}`,
          entityType: 'chatMessage',
          entityId: 'message-0',
          baseRevision: i + 1,
          command: 'updateFields',
          changes: { content: `Synthetic updated ${i}` },
        },
      ],
    });
    assert.equal(update.results[0].status, 'accepted');
    assert.equal((await watching).changed, true);
    const page = await request('pull', { cursor, limit: 200 });
    assert.equal(page.changes.length, 1);
    assert.equal(page.hasMore, false);
    cursor = page.cursor;
    timings.push(performance.now() - started);
  }
  timings.sort((a, b) => a - b);
  const report = {
    measuredAt: new Date().toISOString(),
    synthetic: true,
    transport: '127.0.0.1 HTTP, no phone/WAN latency included',
    entities: count,
    snapshotBytes: firstBytes,
    idlePullBytes: idleBytes,
    changedEntitiesPerPull: 1,
    samples: timings.length,
    incrementalMeanBytes: Math.round(pulledBytes / timings.length),
    pushWatchPullMeanMs: Number((timings.reduce((a, b) => a + b, 0) / timings.length).toFixed(2)),
    pushWatchPullP95Ms: Number(timings[Math.ceil(timings.length * 0.95) - 1].toFixed(2)),
    dataDir,
  };
  await writeFile(
    path.join(out, 'incremental-measurement.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report));
} finally {
  await service.close();
}
