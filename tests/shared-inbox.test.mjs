import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { createIndexedDbSyncStorage } from '../public/shared/sync-v2-client.js';
import { createSharedBusinessClient } from '../public/shared/shared-business-client.js';

async function fixture(t) {
  const indexedDB = new IDBFactory(),
    dbName = 'shiye-sync-v2-inbox-' + randomUUID(),
    libraryId = randomUUID(),
    epoch = randomUUID();
  let storage;
  const open = () => {
    storage = createIndexedDbSyncStorage({ indexedDB, dbName });
    return createSharedBusinessClient({
      storage,
      libraryId,
      epoch,
      request: async () => {
        throw Error('offline');
      },
    });
  };
  let client = open();
  t.after(() => storage.close());
  const id = `desktop:${randomUUID()}:-1`;
  return {
    id,
    get client() {
      return client;
    },
    get storage() {
      return storage;
    },
    async reopen() {
      await storage.close();
      client = open();
    },
  };
}
const message = (conversationId, id, text = 'synthetic') => ({
  conversationId,
  id,
  kind: 'history',
  state: 'active',
  markdown: text,
  attachments: ['synthetic-image'],
  source: { markdown: text, attachments: ['synthetic-image'] },
  actor: { kind: 'program' },
  instanceId: 'fixed-instance',
  batchId: 'fixed-batch',
  deliveryId: id,
});
async function publish(f, messages, redactions = []) {
  const ticket = await f.client.beginInbox(f.id);
  return f.client.replaceInbox(ticket, { details: { conversationId: f.id }, messages, redactions });
}
test('real IDB inbox above generic cache cap preserves each message, target and draft across reopen', async (t) => {
  const f = await fixture(t),
    messages = Array.from({ length: 15 }, (_, i) => message(f.id, String(i), 'x'.repeat(100000)));
  await f.client.setDraft(f.id, { text: 'retained local draft', replyId: '0' });
  await publish(f, messages);
  await f.reopen();
  assert.deepEqual((await f.client.readInbox(f.id)).messages, messages);
  assert.equal((await f.client.readDraft(f.id)).text, 'retained local draft');
  const meta = await f.storage.transaction((tx) => tx.getMeta());
  assert.ok(JSON.stringify(meta).length < 2000, 'roster must not duplicate multi-MiB bodies');
});
test('failed/late refresh never replaces published inbox; another room has independent generation', async (t) => {
  const f = await fixture(t);
  await publish(f, [message(f.id, 'old')]);
  const stale = await f.client.beginInbox(f.id),
    latest = await f.client.beginInbox(f.id);
  assert.equal((await f.client.readInbox(f.id)).messages[0].id, 'old', 'begin is not publish');
  await f.client.replaceInbox(latest, {
    details: { conversationId: f.id },
    messages: [message(f.id, 'new')],
  });
  await assert.rejects(
    () =>
      f.client.replaceInbox(stale, {
        details: { conversationId: f.id },
        messages: [message(f.id, 'stale')],
      }),
    { code: 'SHARED_INBOX_SUPERSEDED' },
  );
  const other = `desktop:${randomUUID()}:-2`,
    ticket = await f.client.beginInbox(other);
  await assert.rejects(
    () =>
      f.client.replaceInbox(ticket, {
        details: { conversationId: other },
        messages: [message(f.id, 'wrong-room')],
      }),
    { code: 'SHARED_INVALID_INBOX' },
  );
  assert.equal((await f.client.readInbox(f.id)).messages[0].id, 'new');
  assert.equal(await f.client.readInbox(other), null);
});
test('redaction and disappearance erase cached text, source, body and attachment bytes in same transaction', async (t) => {
  const f = await fixture(t),
    secret = 'synthetic-retired-body';
  await publish(f, [message(f.id, 'withdraw', secret), message(f.id, 'disappeared', secret)]);
  await publish(f, [message(f.id, 'withdraw', secret)], [{ id: 'withdraw', state: 'withdrawn' }]);
  await f.reopen();
  const inbox = await f.client.readInbox(f.id),
    records = await f.client.list('shared-inbox-message');
  assert.equal(inbox.messages[0].state, 'withdrawn');
  assert.equal(inbox.messages[0].deliveryId, 'withdraw');
  assert.ok(!JSON.stringify(records).includes(secret));
  assert.ok(!JSON.stringify(records).includes('synthetic-image'));
  assert.deepEqual(inbox.messages[0].attachments, []);
  assert.equal(records.find((r) => r.entityId.endsWith('"disappeared"]')).message, null);
});
test('IDB abort restores old roster and rows when a publish storage write fails', async (t) => {
  const f = await fixture(t);
  await publish(f, [message(f.id, 'old')]);
  const storage = {
    transaction: (fn) =>
      f.storage.transaction((tx) =>
        fn({
          ...tx,
          putEntity: async (record) => {
            if (record.message?.id === 'new') throw Error('injected storage failure');
            return tx.putEntity(record);
          },
        }),
      ),
  };
  const client = createSharedBusinessClient({
    storage,
    request: async () => {
      throw Error('offline');
    },
    libraryId: (await f.client.status()).libraryId,
    epoch: (await f.client.status()).epoch,
  });
  const ticket = await client.beginInbox(f.id);
  await assert.rejects(
    () =>
      client.replaceInbox(ticket, {
        details: { conversationId: f.id },
        messages: [message(f.id, 'new')],
      }),
    /injected storage failure/,
  );
  assert.equal((await client.readInbox(f.id)).messages[0].id, 'old');
  assert.ok(!(await f.client.list('shared-inbox-message')).some((r) => r.message?.id === 'new'));
});
