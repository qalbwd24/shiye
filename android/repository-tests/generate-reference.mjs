import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSyncClient } from '../../public/shared/sync-v2-client.js';
import { createMemorySyncStorage } from '../../tests/helpers/sync-v2-client-memory.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'tmp/android-product-017/repository/reference.json');
const fixture = JSON.parse(await fs.readFile(path.join(root, 'docs/contracts/android-product-sync-v1.fixture.json'), 'utf8'));
const clone = structuredClone;
const initial = { ...clone(fixture.records[0]), revision: 1, state: 'active', updatedAt: '2026-10-18T00:00:00.000Z', extension: { preserved: ['x', null] } };
const type = initial.entityType, id = initial.entityId;
const storage = createMemorySyncStorage();
let row = clone(initial), count = 0, sequence = 0, withdrawal = false, client;
const result = { synthetic: true, oracle: 'public/shared/sync-v2-client.js', initial };
const read = () => clone(storage.persisted.entities.get(JSON.stringify([type, id])));
const edit = (changes) => ({ entityType: type, entityId: id, command: 'updateFields', changes });
const response = (value) => ({ ok: true, status: 200, json: async () => clone(value) });
client = createSyncClient({
  baseUrl: 'http://127.0.0.1:18789/', deviceId: 'synthetic', token: 'synthetic', storage,
  idFactory: () => `oracle-${++sequence}`,
  fetchImpl: async (url, options) => {
    const endpoint = new URL(url).pathname.split('/').at(-1);
    if (endpoint === 'info') return response({ protocol: 1, ...fixture.identityExample });
    if (endpoint === 'snapshot') return response({ entities: [row], hasMore: false, cursor: 'snapshot-a', checkpoint: 'pull-a' });
    if (endpoint === 'pull') return response({ changes: withdrawal ? [{ entity: row }] : [], hasMore: false, cursor: withdrawal ? 'pull-z' : 'pull-a' });
    if (endpoint !== 'push') throw new Error('unexpected fixture endpoint');
    const wire = JSON.parse(options.body).operations[0];
    if (++count === 1) {
      result.firstWireBase = wire.baseRevision;
      await client.enqueue(edit({ name: 'second', list: ['a', null], explicitNull: null }));
      row = { ...row, revision: 2, data: { ...row.data, ...wire.changes } };
      return response({ results: [{ operationId: wire.operationId, status: 'accepted', entity: row }] });
    }
    result.afterFirstAck = read();
    result.secondWireBase = wire.baseRevision;
    return response({ results: [{ operationId: wire.operationId, status: 'rejected', conflictId: 'synthetic-conflict', entity: row }] });
  },
});
await client.sync();
await client.enqueue(edit({ name: 'first' }));
await client.sync();
result.afterRejected = read();
withdrawal = true;
row = { ...row, revision: 3, state: 'withdrawn', data: {} };
await client.sync();
result.afterWithdrawal = read();
result.withdrawalPending = storage.persisted.pending.size;
client.stop();
await fs.mkdir(path.dirname(out), { recursive: true });
await fs.writeFile(out, JSON.stringify(result, null, 2));
process.stdout.write(JSON.stringify({ output: out, synthetic: true, phases: 3 }) + '\n');
