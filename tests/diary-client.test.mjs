import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiaryClient } from '../public/integrations/diary-client.js';

const id = '00000000-0000-4000-8000-000000000001';
const snapshot = 'a'.repeat(64);
const page = (entries, offset, nextOffset, extra = {}) => ({
  apiVersion: 1,
  schemaVersion: 1,
  entries,
  total: 3,
  limit: 2,
  offset,
  nextOffset,
  snapshot,
  timeZone: 'Asia/Shanghai',
  ...extra,
});
function mocked(responses) {
  const calls = [];
  const client = createDiaryClient({
    baseURL: 'http://127.0.0.1:18766',
    fetchImpl: async (url, options) => {
      calls.push({ url: new URL(url), ...options });
      assert.ok(responses.length, 'No unexpected retry or request');
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return new Response(JSON.stringify(response.body), {
        status: response.status || 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
  return { client, calls };
}
const collect = async (iterable) => {
  const result = [];
  for await (const value of iterable) result.push(value);
  return result;
};

test('iterator fixes the first snapshot, carries filters, and stops exactly at the last page', async () => {
  const { client, calls } = mocked([
    { body: page([{ id: 'a' }, { id: 'b' }], 0, 2) },
    { body: page([{ id: 'c' }], 2, null) },
  ]);
  assert.deepEqual(
    await collect(
      client.iterateEntries({ limit: 2, category: '中文 & 工作', ids: [id], includeHidden: false }),
    ),
    [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url.searchParams.has('snapshot'), false);
  assert.equal(calls[1].url.searchParams.get('snapshot'), snapshot);
  assert.equal(calls[1].url.searchParams.get('offset'), '2');
  assert.equal(calls[1].url.searchParams.get('category'), '中文 & 工作');
  assert.equal(calls[1].url.searchParams.get('includeHidden'), 'false');
  assert.equal(calls[1].credentials, 'same-origin');
});

test('iterator supports a starting offset and explicit snapshot without changing inputs', async () => {
  const input = { offset: 2, snapshot, limit: 2 };
  const { client, calls } = mocked([{ body: page([{ id }], 2, null) }]);
  assert.deepEqual(await collect(client.iterateEntries(input)), [{ id }]);
  assert.deepEqual(input, { offset: 2, snapshot, limit: 2 });
  assert.equal(calls[0].url.searchParams.get('snapshot'), snapshot);
});

test('iterator rejects missing or changed snapshots before yielding inconsistent data', async () => {
  for (const invalid of [undefined, '', 'b'.repeat(64)]) {
    const { client } = mocked([{ body: page([{ id }], 0, null, { snapshot: invalid }) }]);
    await assert.rejects(collect(client.iterateEntries({ snapshot })), {
      status: invalid ? 409 : 502,
    });
  }
});

test('iterator rejects empty progress, repeated/skipped offsets and malformed entry arrays', async () => {
  for (const body of [
    page([], 0, 1),
    page([{ id }], 0, 0),
    page([{ id }], 0, 3),
    page([{ id }], 1, null),
    page(null, 0, null),
  ]) {
    const { client, calls } = mocked([{ body }]);
    await assert.rejects(collect(client.iterateEntries()), { status: 502 });
    assert.equal(calls.length, 1);
  }
  const { client, calls } = mocked([]);
  await assert.rejects(collect(client.iterateEntries({ offset: -1 })), { status: 400 });
  assert.equal(calls.length, 0);
});

test('iterator propagates snapshot conflict on later pages without retrying', async () => {
  const { client, calls } = mocked([
    { body: page([{ id }], 0, 1) },
    { status: 409, body: { error: 'changed' } },
  ]);
  const iterator = client.iterateEntries();
  assert.deepEqual((await iterator.next()).value, { id });
  await assert.rejects(iterator.next(), { status: 409, message: 'changed' });
  assert.equal(calls.length, 2);
});

test('versioned read methods preserve envelopes and getEntry unwraps the entry', async () => {
  const envelope = page([{ id }], 0, null);
  const { client, calls } = mocked([
    { body: envelope },
    { body: { entry: { id }, snapshot } },
    { body: { apiVersion: 1 } },
    { body: { ...envelope, seed: 'seed' } },
    { body: envelope },
  ]);
  assert.deepEqual(await client.list(), envelope);
  assert.deepEqual(await client.getEntry(id), { id });
  assert.deepEqual(await client.schema(), { apiVersion: 1 });
  assert.equal((await client.random({ exclude: [id] })).seed, 'seed');
  assert.deepEqual(await client.anniversary({ date: '20260930' }), envelope);
  assert.deepEqual(
    calls.map((call) => call.url.pathname),
    [
      '/api/open/v1/entries',
      `/api/open/v1/entries/${id}`,
      '/api/open/v1/schema',
      '/api/open/v1/random',
      '/api/open/v1/anniversary',
    ],
  );
  assert.equal(calls[3].url.searchParams.has('seed'), false);
  assert.equal(calls[3].url.searchParams.get('exclude'), id);
});

test('HTTP errors retain status and server message; invalid JSON and absent entries fail clearly', async () => {
  for (const status of [400, 401, 403, 409, 500]) {
    const { client } = mocked([{ status, body: { error: 'server detail' } }]);
    await assert.rejects(client.list(), { status, message: 'server detail' });
  }
  const { client } = mocked([{ body: {} }, { body: null }]);
  await assert.rejects(client.getEntry(id), { status: 404 });
  await assert.rejects(client.list(), { status: 502 });
  const bad = createDiaryClient({ fetchImpl: async () => new Response('<html>', { status: 503 }) });
  await assert.rejects(bad.list(), { status: 503 });
});

test('setPinned sends the complete raw entry with expected revision and returns the public entry', async () => {
  const raw = {
    id,
    revision: 4,
    pinned: false,
    content: '<p>old</p>',
    bodyMarkdown: '**old**',
    bodyFormat: 'markdown',
    comments: [{ id: 'comment', body: 'keep' }],
    legacy: { nested: [1, 2] },
    history: [{ content: 'history' }],
    unknownFutureField: { keep: true },
  };
  const expected = { ...raw, pinned: true };
  const saved = { id, revision: 5, state: { pinned: true } };
  const { client, calls } = mocked([{ body: raw }, { body: expected }, { body: { entry: saved } }]);
  assert.deepEqual(await client.setPinned(id, true, 4), saved);
  assert.deepEqual(JSON.parse(calls[1].body), expected);
  assert.equal(calls[1].method, 'PUT');
  assert.equal(calls[1].headers['X-Diary-Client'], 'desktop');
  assert.equal(calls[2].url.searchParams.get('includeComments'), 'true');
  assert.equal(calls[2].url.searchParams.get('includeHidden'), 'true');
  assert.equal(raw.pinned, false);
});

test('setPinned checks stale revisions and does not retry a write race', async () => {
  const stale = mocked([{ body: { id, revision: 5 } }]);
  await assert.rejects(stale.client.setPinned(id, true, 4), { status: 409 });
  assert.equal(stale.calls.length, 1);
  const race = mocked([{ body: { id, revision: 4 } }, { status: 409, body: { error: 'raced' } }]);
  await assert.rejects(race.client.setPinned(id, true, 4), { status: 409 });
  assert.equal(race.calls.length, 2);
  const invalid = mocked([]);
  await assert.rejects(invalid.client.setPinned(id, true, 0), { status: 400 });
  await assert.rejects(invalid.client.setPinned(id, 'yes', 1), { status: 400 });
  assert.equal(invalid.calls.length, 0);
});

test('comment creation uses the revision route without replacing an entry or retrying conflicts', async () => {
  const input = { body: '你好', attachments: ['media-id'], entryRevision: 4 };
  const saved = { id, revision: 5, comments: [{ body: '你好' }] };
  const { client, calls } = mocked([{ status: 201, body: {} }, { body: { entry: saved } }]);
  assert.deepEqual(await client.addComment(id, input), saved);
  assert.equal(calls[0].url.pathname, `/api/entries/${id}/comments`);
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].body), input);
  const conflict = mocked([{ status: 409, body: { error: 'comment conflict' } }]);
  await assert.rejects(conflict.client.addComment(id, input), { status: 409 });
  assert.equal(conflict.calls.length, 1);
});
