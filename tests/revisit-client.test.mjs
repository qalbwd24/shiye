import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRevisitClient } from '../previews/telegram-chat/shiye-revisit-client.js';
import { runRevisitIntegrationLab } from '../tools/lib/revisit-integration-lab.mjs';

test('target selection keeps the newest manual intent after a delayed context reply', async () => {
  let releaseFirst;
  let firstStarted;
  const started = new Promise((resolve) => {
    firstStarted = resolve;
  });
  const held = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const committed = [];
  const client = createRevisitClient({
    readLibrary: async () => ({}),
    api: async (_action, payload) => {
      if (payload.batchId === 'first') {
        firstStarted();
        await held;
      }
    },
    command: async (_action, payload) => {
      committed.push(payload.batchId);
    },
  });
  const first = client.select('first');
  await started;
  const second = client.select('second');
  releaseFirst();
  assert.equal(await first, false);
  assert.equal(await second, true);
  assert.deepEqual(committed, ['second']);
  assert.equal(client.status().target.batchId, 'second');
});

test('background selection rechecks typing after its context response', async () => {
  let composing = false;
  const commits = [];
  const client = createRevisitClient({
    readLibrary: async () => ({}),
    isComposing: () => composing,
    command: async (action) => {
      commits.push(action);
    },
    api: async (action) => {
      if (action === 'status') return { config: { enabled: true } };
      if (action === 'context') {
        composing = true;
        return {};
      }
      return { deliveries: [], batches: [{ id: 'latest' }], next: 0, total: 0 };
    },
  });
  await client.sync();
  assert.deepEqual(commits, ['program-feed']);
  assert.equal(client.status().target, undefined);
});

test('background selection respects a stored draft while its room is not visible', async () => {
  const commits = [];
  const client = createRevisitClient({
    readLibrary: async () => ({
      dialogs: { active: [{ id: '-900000001', draft: { message: 'synthetic draft' } }] },
    }),
    isComposing: () => false,
    command: async (action) => {
      commits.push(action);
    },
    api: async (action) =>
      action === 'status'
        ? { config: { enabled: true } }
        : { deliveries: [], batches: [{ id: 'latest' }], next: 0, total: 0 },
  });
  await client.sync();
  assert.deepEqual(commits, ['program-feed']);
  assert.equal(client.status().target, undefined);
});

test('real local backend, actual journal bridge and local worker integrate without a frontend', async () => {
  const report = await runRevisitIntegrationLab();
  assert.equal(report.passed, true);
  assert.ok(report.checks.length >= 18);
  assert.equal(report.sourceBeforeSHA256, report.sourceAfterSHA256);
});

test('receiver rejects stalled pagination before applying a page', async () => {
  let applied = false;
  const client = createRevisitClient({
    readLibrary: async () => undefined,
    command: async () => {
      applied = true;
    },
    api: async (action) =>
      action === 'status'
        ? { config: { enabled: true } }
        : { deliveries: [], batches: [], next: 0, total: 1 },
  });
  await assert.rejects(client.sync(), /没有前进/);
  assert.equal(applied, false);
});

for (const part of [
  { offset: 1, size: 2, bytes: 'AQI=', done: true },
  { offset: 0, size: 2, bytes: 'AQ==', done: true },
  { offset: 0, size: 2, bytes: 'AQID', done: true },
  { offset: 0, size: 2, bytes: '', done: false },
  { offset: 0, size: -1, bytes: '', done: true },
]) {
  test(`media client refuses inconsistent chunks ${JSON.stringify(part)}`, async () => {
    const client = createRevisitClient({ api: async () => part });
    await assert.rejects(client.mediaBytes('synthetic', 'synthetic'));
  });
}
