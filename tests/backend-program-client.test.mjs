import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createBackendProgramClient } from '../src/server/conversation-services/program-client.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const options = { baseUrl: 'http://127.0.0.1:1', token: 'a'.repeat(64) };
test('program client confines transport, identity and response bytes', async () => {
  for (const baseUrl of [
    'http://example.com',
    'https://u:p@example.com',
    'https://example.com/?token=x',
  ])
    assert.throws(
      () => createBackendProgramClient({ ...options, baseUrl }),
      /PROGRAM_INVALID_CLIENT_OPTIONS/,
    );
  let calls = 0;
  const client = createBackendProgramClient({
    ...options,
    fetchImpl: async (url, init) => {
      calls++;
      assert.equal(url, options.baseUrl + '/api/shared/v1/program/info');
      assert.equal(init.redirect, 'error');
      assert.equal(init.headers.Authorization, 'Bearer ' + options.token);
      return new Response('x'.repeat(1024 * 1024 + 1));
    },
  });
  await assert.rejects(client.send({ actorId: 'self' }), /PROGRAM_INVALID_CLIENT_ACTION/);
  await assert.rejects(client.request('../settings', {}), /PROGRAM_INVALID_CLIENT_ACTION/);
  assert.equal(calls, 0);
  await assert.rejects(client.info(), /PROGRAM_RESPONSE_TOO_LARGE/);
  client.dispose();
  await assert.rejects(client.info(), /PROGRAM_CLIENT_DISPOSED/);
});

test('program client validates large feed chunk hashes and publishes only complete pages', async () => {
  const row = {
    id: 'unit',
    conversationId: 'room',
    state: 'active',
    kind: 'message',
    text: '中'.repeat(400000),
  };
  const bytes = Buffer.from(JSON.stringify(row));
  const payload = {
    version: 1,
    kind: 'shared-feed-item-json',
    conversationId: row.conversationId,
    messageId: row.id,
    byteLength: bytes.length,
    sha256: digest(bytes),
  };
  let corrupt = false,
    reads = 0;
  const client = createBackendProgramClient({
    ...options,
    fetchImpl: async (url, init) => {
      const input = JSON.parse(init.body);
      if (url.endsWith('/feed'))
        return Response.json({
          messages: [{ ...row, text: undefined, payload }],
          next: { watermark: 7 },
        });
      assert.ok(url.endsWith('/feed-item/read'));
      reads++;
      const chunk = bytes.subarray(input.offset, input.offset + input.length);
      return Response.json({
        payload,
        offset: input.offset,
        next: input.offset + chunk.length,
        done: input.offset + chunk.length === bytes.length,
        bytesBase64: chunk.toString('base64'),
        chunkSha256: corrupt && input.offset > 0 ? '0'.repeat(64) : digest(chunk),
      });
    },
  });
  assert.deepEqual((await client.feed()).messages, [row]);
  assert.ok(reads > 1);
  corrupt = true;
  await assert.rejects(client.feed(), /PROGRAM_INVALID_FEED_CHUNK/);
  client.dispose();
});

test('disposing program client aborts a pending request and never retries a write', async () => {
  let calls = 0;
  const client = createBackendProgramClient({
    ...options,
    fetchImpl: async (_url, { signal }) => {
      calls++;
      return new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(Error('aborted')), { once: true }),
      );
    },
  });
  const pending = client.send({ operationId: 'intent', text: 'once' });
  client.dispose();
  await assert.rejects(pending, /aborted/);
  assert.equal(calls, 1);
});
