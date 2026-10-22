import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fixture, sample } from './helpers.mjs';
import { createDiaryServer } from '../server.mjs';
import { resolveQuickEntry } from '../src/server/domain/quick-entry.mjs';

const create = (request, entry = sample, clientToken = randomUUID()) =>
  request('/api/quick-entries', 'POST', { entry, clientToken });

test('quick creation serializes concurrent retries and persists idempotence across restart', async (t) => {
  const { request, dir } = await fixture(t);
  const clientToken = randomUUID();
  const responses = await Promise.all([
    create(request, sample, clientToken),
    create(request, sample, clientToken),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 201]);
  const entries = await Promise.all(responses.map((r) => r.json()));
  assert.equal(entries[0].id, entries[1].id);
  assert.equal((await (await request('/api/library')).json()).entries.length, 1);
  const server = await createDiaryServer({ dataDir: dir, seed: false });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/quick-entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Diary-Client': 'desktop' },
      body: JSON.stringify({ entry: sample, clientToken }),
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).id, entries[0].id);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('changed token payload and edits after unknown create result require conflict recovery', async (t) => {
  const { request } = await fixture(t);
  const clientToken = randomUUID();
  const entry = await (await create(request, sample, clientToken)).json();
  const changed = await create(request, { ...sample, title: 'different' }, clientToken);
  assert.equal(changed.status, 409);
  assert.equal((await changed.json()).existingEntryId, entry.id);
  const updated = await (
    await request('/api/entries/' + entry.id, 'PUT', { ...entry, title: 'later saved' })
  ).json();
  const retried = await create(request, sample, clientToken);
  assert.equal(retried.status, 409);
  assert.equal((await retried.json()).existingEntryId, entry.id);
  assert.deepEqual(
    await (await request('/api/quick-entries/by-token/' + clientToken)).json(),
    updated,
  );
  assert.deepEqual(await (await request('/api/entries/' + entry.id)).json(), updated);
});

test('quick creation validates UUID, meaningful content and ignores client provenance/history/comments', async (t) => {
  const { request } = await fixture(t);
  assert.equal((await create(request, sample, 'not-uuid')).status, 400);
  assert.equal(
    (await create(request, { ...sample, title: '', content: '<p>&emsp;&nbsp;<br></p>' })).status,
    400,
  );
  const entry = await (
    await create(request, {
      ...sample,
      id: 'injected',
      sourceEntryId: 'injected',
      comments: [{ body: 'injected' }],
      history: [{ content: 'injected' }],
    })
  ).json();
  assert.notEqual(entry.id, 'injected');
  assert.equal(entry.sourceEntryId, undefined);
  assert.equal(entry.comments, undefined);
  assert.deepEqual(entry.history, []);
});

test('keep-local preserves comments, full server-only metadata and preceding revision', async (t) => {
  const { request } = await fixture(t);
  const initial = await (await create(request)).json();
  await request(`/api/entries/${initial.id}/comments`, 'POST', {
    body: 'synthetic comment',
    entryRevision: initial.revision,
  });
  const before = await (await request('/api/entries/' + initial.id)).json();
  const response = await request(`/api/entries/${initial.id}/resolve`, 'POST', {
    action: 'keep-local',
    expectedRevision: before.revision,
    entry: { ...before, title: 'chosen local', comments: [], history: [] },
  });
  assert.equal(response.status, 200);
  const saved = await response.json();
  assert.equal(saved.title, 'chosen local');
  assert.deepEqual(saved.comments, before.comments);
  assert.equal(saved.history[0].revision, before.revision);
  assert.equal(saved.history[0].title, before.title);
  assert.equal(saved.revision, before.revision + 1);
  // Unknown imported fields are preserved by the same domain operation.
  const db = {
    entries: [{ ...saved, legacy: { futureField: 42 } }],
    categories: [saved.category],
    media: [],
  };
  assert.deepEqual(
    resolveQuickEntry(db, saved.id, {
      action: 'keep-local',
      expectedRevision: saved.revision,
      entry: { ...saved, title: 'again' },
    }).entry.legacy,
    { futureField: 42 },
  );
});

test('keep-both preserves editable fields and shared media, without cloning comments or history', async (t) => {
  const { request, base } = await fixture(t);
  const upload = await fetch(base + '/api/media', {
    method: 'POST',
    headers: { 'X-Diary-Client': 'desktop', 'Content-Type': 'image/png' },
    body: Buffer.from('synthetic-media'),
  });
  const media = await upload.json();
  const initial = await (await create(request, { ...sample, attachments: [media.id] })).json();
  await request(`/api/entries/${initial.id}/comments`, 'POST', {
    body: 'source comment',
    entryRevision: initial.revision,
  });
  const before = await (await request('/api/entries/' + initial.id)).json();
  const payload = {
    action: 'keep-both',
    expectedRevision: before.revision,
    clientToken: randomUUID(),
    entry: {
      ...before,
      title: 'new copy',
      content: '<p>markdown copy</p>',
      contentFormat: 'markdown',
      markdownSource: 'markdown copy',
      markdownHtml: '<p>markdown copy</p>',
      category: 'copied category',
      tags: ['new tag'],
      sourceEntryId: 'forged',
    },
  };
  const res = await request(`/api/entries/${initial.id}/resolve`, 'POST', payload);
  assert.equal(res.status, 201);
  const copied = await res.json();
  assert.notEqual(copied.id, initial.id);
  assert.equal(copied.sourceEntryId, initial.id);
  assert.equal(copied.markdownSource, 'markdown copy');
  assert.equal(copied.editorOriginalHtml, before.content);
  assert.equal(copied.date, before.date);
  assert.equal(copied.category, 'copied category');
  assert.deepEqual(copied.tags, ['new tag']);
  assert.deepEqual(copied.attachments, [media.id]);
  assert.equal(copied.comments, undefined);
  assert.deepEqual(copied.history, []);
  assert.deepEqual(await (await request('/api/entries/' + before.id)).json(), before);
  const retry = await request(`/api/entries/${initial.id}/resolve`, 'POST', payload);
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).id, copied.id);
  const library = await (await request('/api/library')).json();
  assert.equal(library.entries.length, 2);
  assert.equal(library.media.length, 1);
});

test('identical resolutions reuse saved entry and recheck expected revision before any decision', async (t) => {
  const { request } = await fixture(t);
  const entry = await (await create(request)).json();
  for (const action of ['keep-local', 'keep-both']) {
    const res = await request(`/api/entries/${entry.id}/resolve`, 'POST', {
      action,
      clientToken: randomUUID(),
      expectedRevision: entry.revision,
      entry,
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), entry);
  }
  const changed = await (
    await request('/api/entries/' + entry.id, 'PUT', { ...entry, title: 'third edit' })
  ).json();
  for (const action of ['keep-local', 'keep-both']) {
    const response = await request(`/api/entries/${entry.id}/resolve`, 'POST', {
      action,
      clientToken: randomUUID(),
      expectedRevision: entry.revision,
      entry: changed,
    });
    assert.equal(response.status, 409);
  }
  assert.deepEqual(await (await request('/api/entries/' + entry.id)).json(), changed);
  assert.equal((await (await request('/api/library')).json()).entries.length, 1);
});

test('competing keep-local decisions cannot overwrite a third edit', async (t) => {
  const { request } = await fixture(t);
  const entry = await (await create(request)).json();
  const results = await Promise.all(
    ['one', 'two'].map((title) =>
      request(`/api/entries/${entry.id}/resolve`, 'POST', {
        action: 'keep-local',
        expectedRevision: entry.revision,
        entry: { ...entry, title },
      }),
    ),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const saved = await (await request('/api/entries/' + entry.id)).json();
  assert.equal(saved.revision, 2);
  assert.equal(saved.history.length, 1);
});

test('empty cleanup requires original creation token, fresh revision and genuinely blank content', async (t) => {
  const { request, dir } = await fixture(t);
  const clientToken = randomUUID();
  const initial = await (await create(request, sample, clientToken)).json();
  const route = `/api/quick-entries/${initial.id}/discard-empty`;
  assert.equal((await request(route, 'POST', { clientToken, expectedRevision: 1 })).status, 409);
  const empty = await (
    await request('/api/entries/' + initial.id, 'PUT', {
      ...initial,
      title: '',
      content: '<p>　　<br></p>',
    })
  ).json();
  assert.equal(
    (await request(route, 'POST', { clientToken: randomUUID(), expectedRevision: empty.revision }))
      .status,
    403,
  );
  assert.equal(
    (await request(route, 'POST', { clientToken, expectedRevision: initial.revision })).status,
    409,
  );
  const result = await request(route, 'POST', { clientToken, expectedRevision: empty.revision });
  assert.equal(result.status, 200);
  const deleted = await result.json();
  assert.equal(deleted.deleted, true);
  assert.equal(deleted.history.at(-1).content, initial.content);
  assert.equal(deleted.revision, empty.revision + 1);
  const disk = JSON.parse(await fs.readFile(path.join(dir, 'diary.json'), 'utf8'));
  assert.equal(disk.entries.length, 1);
  assert.equal(disk.quickEntryTokens[clientToken].entryId, initial.id);
});

test('empty cleanup protects comments and records created through ordinary entry API', async (t) => {
  const { request } = await fixture(t);
  const clientToken = randomUUID();
  const initial = await (await create(request, sample, clientToken)).json();
  await request(`/api/entries/${initial.id}/comments`, 'POST', {
    body: 'keep comment',
    entryRevision: initial.revision,
  });
  const withComments = await (await request('/api/entries/' + initial.id)).json();
  const empty = await (
    await request('/api/entries/' + initial.id, 'PUT', { ...withComments, title: '', content: '' })
  ).json();
  assert.equal(
    (
      await request(`/api/quick-entries/${initial.id}/discard-empty`, 'POST', {
        clientToken,
        expectedRevision: empty.revision,
      })
    ).status,
    409,
  );
  const ordinary = await (
    await request('/api/entries', 'POST', { ...sample, title: '', content: '' })
  ).json();
  assert.equal(
    (
      await request(`/api/quick-entries/${ordinary.id}/discard-empty`, 'POST', {
        clientToken,
        expectedRevision: ordinary.revision,
      })
    ).status,
    403,
  );
});

test('quick edit history merges concurrent touches and persists IDs without blank records', async (t) => {
  const { request, dir } = await fixture(t);
  const one = await (await create(request)).json();
  const two = await (await create(request, { ...sample, title: 'second' })).json();
  await Promise.all(
    [one, two].map((entry) => request('/api/quick-history', 'POST', { entryId: entry.id })),
  );
  const history = await (await request('/api/quick-history')).json();
  assert.deepEqual(new Set(history.ids), new Set([one.id, two.id]));
  assert.deepEqual(
    (await (await request('/api/quick-history', 'POST', { entryId: one.id })).json()).ids,
    [one.id, two.id],
  );
  const empty = await (
    await request('/api/entries', 'POST', { ...sample, title: '', content: '' })
  ).json();
  assert.equal((await request('/api/quick-history', 'POST', { entryId: empty.id })).status, 400);
  assert.equal(
    (await request('/api/quick-history', 'POST', { entryId: randomUUID() })).status,
    400,
  );
  const disk = JSON.parse(await fs.readFile(path.join(dir, 'diary.json'), 'utf8'));
  assert.deepEqual(disk.quickCaptureHistory, [one.id, two.id]);
});

test('new quick endpoints inherit library access lock and private response headers', async (t) => {
  const { request } = await fixture(t);
  const clientToken = randomUUID();
  const entry = await (await create(request, sample, clientToken)).json();
  assert.equal(
    (await request('/api/entries/' + entry.id)).headers.get('cache-control'),
    'no-store',
  );
  await request('/api/access', 'PUT', { password: 'synthetic-quick-password' });
  for (const p of [
    '/api/entries/' + entry.id,
    '/api/quick-history',
    '/api/quick-entries/by-token/' + clientToken,
  ])
    assert.equal((await request(p)).status, 401);
  for (const p of [
    '/api/quick-entries',
    '/api/quick-history',
    `/api/entries/${entry.id}/resolve`,
    `/api/quick-entries/${entry.id}/discard-empty`,
  ])
    assert.equal((await request(p, 'POST', {})).status, 401);
});
