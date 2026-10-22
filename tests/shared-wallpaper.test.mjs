import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createDiaryServer } from '../src/server/app.mjs';
import { createSharedBusinessClient } from '../public/shared/shared-business-client.js';
import { createSharedWallpaperClient } from '../public/shared/shared-wallpaper-client.js';
import { createMemorySyncStorage } from './helpers/sync-v2-client-memory.mjs';
async function fixture(t) {
  const root = path.resolve('tmp/shared-wallpaper-tests');
  await mkdir(root, { recursive: true });
  const dataDir = await mkdtemp(path.join(root, 'case-')),
    sourceId = randomUUID(),
    conversationId = `desktop:${sourceId}:-1`,
    otherId = `desktop:${sourceId}:-2`,
    assets = [];
  await mkdir(path.join(dataDir, 'media'));
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
    'base64',
  );
  for (let n = 0; n < 3; n++) {
    const id = randomUUID(),
      bytes = Buffer.concat([png, Buffer.from([n])]);
    assets.push({
      id,
      size: bytes.length,
      type: 'image/png',
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
    await writeFile(path.join(dataDir, 'media', id), bytes);
  }
  await writeFile(
    path.join(dataDir, 'diary.json'),
    JSON.stringify({
      schema: 1,
      categories: ['日常'],
      entries: [],
      media: assets,
      chatJournal: {
        rooms: ['-1', '-2'].map((id) => ({
          id,
          sourceId,
          title: id,
          category: '日常',
          idleHours: 5,
        })),
        withdrawals: [],
      },
    }),
  );
  const server = await createDiaryServer({ dataDir, seed: false, sharedSync: true });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(
    () =>
      new Promise((r) => {
        server.closeAllConnections();
        server.close(r);
      }),
  );
  const base = `http://127.0.0.1:${server.address().port}`;
  const http = async (route, input, method = input === undefined ? 'GET' : 'POST') => {
    const response = await fetch(base + route, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Diary-Client': 'desktop' },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    });
    const value = await response.json();
    if (!response.ok)
      throw Object.assign(Error(value.error?.code || value.error), {
        code: value.error?.code,
        status: response.status,
      });
    return value;
  };
  const info = await http('/api/shared/v1/info');
  const command = (action, input, operationId = randomUUID()) =>
    http('/api/shared/v1/command', {
      libraryId: info.libraryId,
      epoch: info.epoch,
      operationId,
      action,
      input,
    });
  const client = (scope) => {
    const client = createSharedBusinessClient({
      libraryId: info.libraryId,
      epoch: info.epoch,
      storage: createMemorySyncStorage(),
      request: (action, input) =>
        http('/api/shared/v1/' + action, action === 'info' ? undefined : input),
    });
    return { client, wallpaper: createSharedWallpaperClient({ client, scope }) };
  };
  return { dataDir, conversationId, otherId, assets, command, client, http };
}
test('two clients preserve shared and independent images, restore original shared image, isolate rooms and endpoint CAS', async (t) => {
  const f = await fixture(t),
    pc = f.client('desktop'),
    phone = f.client('android'),
    id = f.conversationId,
    [shared, desktop, android] = f.assets.map((a) => a.id);
  const defaultValue = (await f.command('wallpaper-read', { conversationId: id })).result;
  assert.equal(defaultValue.syncEnabled, true);
  assert.equal(defaultValue.sharedAssetId, null);
  await pc.wallpaper.save(id, { sharedAssetId: shared }, { expectedRevision: 0 });
  await pc.wallpaper.save(id, { assetId: desktop }, { domain: 'desktop', expectedRevision: 0 });
  await phone.wallpaper.save(id, { assetId: android }, { domain: 'android', expectedRevision: 0 });
  await pc.wallpaper.save(id, { syncEnabled: false }, { expectedRevision: 1 });
  await phone.client.sync();
  await pc.client.sync();
  const off = await pc.wallpaper.read(id);
  assert.equal(pc.wallpaper.effective(off), desktop);
  assert.equal(phone.wallpaper.effective(off), android);
  assert.equal((await phone.wallpaper.read(f.otherId)).syncEnabled, true);
  await phone.wallpaper.save(id, { syncEnabled: true }, { expectedRevision: 2 });
  await pc.client.sync();
  const on = await pc.wallpaper.read(id);
  assert.equal(pc.wallpaper.effective(on), shared);
  assert.equal(phone.wallpaper.effective(on), shared);
  assert.equal(on.independent.desktop.assetId, desktop);
  assert.equal(on.independent.android.assetId, android);
  await assert.rejects(
    () =>
      f.command('wallpaper-save', {
        conversationId: id,
        scope: 'desktop',
        expectedRevision: 0,
        assetId: shared,
      }),
    { code: 'WALLPAPER_REVISION_CONFLICT' },
  );
  const reopened = f.client('desktop');
  await reopened.client.sync();
  assert.deepEqual(await reopened.wallpaper.read(id), on);
});
test('same immutable operation replays without overwriting later images; wrong identity/body and missing/corrupt originals fail closed', async (t) => {
  const f = await fixture(t),
    id = f.conversationId,
    op = randomUUID(),
    input = { conversationId: id, expectedRevision: 0, sharedAssetId: f.assets[0].id };
  await f.command('wallpaper-save', input, op);
  await f.command('wallpaper-save', {
    conversationId: id,
    expectedRevision: 1,
    sharedAssetId: f.assets[1].id,
  });
  assert.equal((await f.command('wallpaper-save', input, op)).replayed, true);
  assert.equal(
    (await f.command('wallpaper-read', { conversationId: id })).result.sharedAssetId,
    f.assets[1].id,
  );
  await assert.rejects(
    () => f.command('wallpaper-save', { ...input, sharedAssetId: f.assets[2].id }, op),
    { code: 'SHARED_OPERATION_REUSED' },
  );
  await assert.rejects(
    () =>
      f.command('wallpaper-save', {
        conversationId: id,
        expectedRevision: 2,
        sharedAssetId: randomUUID(),
      }),
    { code: 'WALLPAPER_IMAGE_REQUIRED' },
  );
  await writeFile(path.join(f.dataDir, 'media', f.assets[2].id), Buffer.alloc(f.assets[2].size));
  await assert.rejects(
    () =>
      f.command('wallpaper-save', {
        conversationId: id,
        expectedRevision: 2,
        sharedAssetId: f.assets[2].id,
      }),
    { code: 'WALLPAPER_ORIGINAL_UNAVAILABLE' },
  );
  const before = (await f.command('wallpaper-read', { conversationId: id })).result;
  await f.http(
    '/api/conversation-services/conversations/state',
    {
      conversationId: id,
      expectedRevision: 0,
      title: 'new title',
      mode: 'session',
      selfName: '我',
      category: '日常',
      idleHours: 5,
      wallpaper: { sharedAssetId: null, syncEnabled: false },
    },
    'PUT',
  );
  assert.deepEqual((await f.command('wallpaper-read', { conversationId: id })).result, before);
  const db = JSON.parse(await readFile(path.join(f.dataDir, 'diary.json'), 'utf8'));
  assert.equal(db.conversationServices.wallpapers.length, 1);
  assert.ok(db._sharedSync.entities.some((r) => r.entityType === 'wallpaper' && r.entityId === id));
});
