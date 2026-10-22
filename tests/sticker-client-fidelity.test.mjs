import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('../previews/telegram-chat/vendor/web-a/node_modules/playwright');

test('shared favorites retain backend DTOs and originals in actual IndexedDB, normalize ACKs and reject stale overwrites', async () => {
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  });
  const page = await browser.newPage();
  try {
    await page.route('https://sticker-fidelity.test/**', async (route) => {
      const name = new URL(route.request().url()).pathname.slice(1);
      if (!name)
        return route.fulfill({
          contentType: 'text/html',
          body: '<!doctype html><script src="/shiye-local-assets.js"></script><script src="/shiye-stickers.js"></script>',
        });
      if (!['shiye-local-assets.js', 'shiye-stickers.js'].includes(name)) return route.abort();
      return route.fulfill({
        contentType: 'application/javascript',
        body: await fs.readFile(new URL('../previews/telegram-chat/' + name, import.meta.url)),
      });
    });
    await page.goto('https://sticker-fidelity.test/');
    const result = await page.evaluate(async () => {
      const store = window.shiyeLocalAssets,
        api = window.shiyeStickers;
      const checks = [];
      function check(label, valid) {
        if (!valid) throw Error(label);
        checks.push(label);
      }
      const bytes = async (blob) => [...new Uint8Array(await blob.arrayBuffer())].join(',');
      const original = new Blob([new Uint8Array([71, 73, 70, 56, 57, 97, 1])], {
        type: 'image/gif',
      });
      const preview = new Blob(['preview'], { type: 'image/webp' });
      const stamp = '2026-10-18T10:00:00.000Z';
      const dto = (id, fields = {}) => ({
        id,
        mediaId: 'media-' + id,
        name: 'normalized',
        note: 'server note',
        group: 'portable group',
        createdAt: '2020-01-01T01:02:03.004Z',
        updatedAt: stamp,
        deleted: false,
        schemaVersion: 7,
        extra: { nested: ['preserved', 2], empty: null },
        ...fields,
      });
      const server = new Map([['remote', dto('remote')]]);
      let fail = false,
        gate,
        entered,
        captured,
        catalogGate,
        catalogEntered,
        uploads = 0;
      const calls = [];
      api.setTransport({
        uploadSticker: async () => {
          uploads++;
          return 'media-local';
        },
        stickerSource: async () => ({
          kind: 'chat',
          sourceId: 'verified',
          roomId: '-1',
          messageId: '9',
        }),
        stickers: async (action, payload) => {
          calls.push({ action, payload });
          if (fail) throw Error('synthetic offline');
          if (action === 'catalog') {
            const response = {
              version: 1,
              items: structuredClone([...server.values()].filter((x) => !x.deleted)),
            };
            if (catalogGate) {
              catalogEntered();
              await catalogGate;
              catalogGate = undefined;
            }
            return response;
          }
          if (action === 'collect' || action === 'from-message') {
            const item = dto(action === 'from-message' ? 'source' : 'local', {
              mediaId: payload.mediaId,
            });
            server.set(item.id, item);
            return action === 'from-message'
              ? { version: 1, sticker: item, source: payload.source }
              : item;
          }
          if (action === 'update') {
            check(
              'writes remain explicit metadata whitelist',
              Object.keys(payload).every((k) =>
                ['id', 'name', 'note', 'group', 'deleted'].includes(k),
              ),
            );
            if (gate) {
              captured = structuredClone(payload);
              entered();
              await gate;
              gate = undefined;
            }
            const item = {
              ...server.get(payload.id),
              ...Object.fromEntries(
                Object.entries(payload)
                  .filter(([k]) => k !== 'id')
                  .map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]),
              ),
              updatedAt: '2026-10-18T10:00:01.000Z',
            };
            server.set(item.id, item);
            return structuredClone(item);
          }
          throw Error('unexpected action ' + action);
        },
      });
      await store.put({
        id: 'sticker:old',
        name: ' local ',
        note: ' local note ',
        blob: original,
        previewBlob: preview,
        localSource: { roomId: '-1', messageId: '5' },
        unknownLocal: { retain: 1 },
      });
      await store.saveMapping({
        id: 'mapping:old',
        kind: 'sticker',
        assetId: 'sticker:old',
        futureAlias: true,
      });
      await api.sync();
      let local = await store.get('sticker:old'),
        remote = await store.get('sticker:server:remote');
      check(
        'collect and placeholder keep full unknown DTO, group and original timestamps',
        local.serverStickerSnapshot.schemaVersion === 7 &&
          remote.serverStickerSnapshot.extra.nested[0] === 'preserved' &&
          remote.group === 'portable group' &&
          remote.createdAt === '2020-01-01T01:02:03.004Z' &&
          local.updatedAt === stamp,
      );
      check(
        'ACK preserves local ID, alias, localSource, unknown fields and both original blobs',
        local.id === 'sticker:old' &&
          (await store.get('mapping:old')).assetId === local.id &&
          local.localSource.messageId === '5' &&
          local.unknownLocal.retain === 1 &&
          (await bytes(local.blob)) === (await bytes(original)) &&
          (await bytes(local.previewBlob)) === (await bytes(preview)),
      );
      local = await api.edit(local, {
        name: '  trimmed name  ',
        note: '  ',
        group: '  trimmed group  ',
        unknownWrite: 'never upload',
      });
      check(
        'explicit backend normalized metadata wins including empty note',
        local.name === 'trimmed name' &&
          local.note === '' &&
          local.group === 'trimmed group' &&
          local.serverStickerSnapshot.note === '' &&
          !local.pendingMetadata,
      );
      let releaseCatalog;
      const catalogStarted = new Promise((resolve) => {
        catalogEntered = resolve;
      });
      catalogGate = new Promise((resolve) => {
        releaseCatalog = resolve;
      });
      const oldCatalog = api.sync();
      await catalogStarted;
      const previousStamp = local.serverUpdatedAt;
      local = await api.edit(local, { name: 'post-catalog name' });
      releaseCatalog();
      await oldCatalog;
      local = await store.get(local.id);
      check(
        'stale catalog cannot overwrite same-millisecond confirmed edit',
        local.name === 'post-catalog name' &&
          local.serverUpdatedAt === previousStamp &&
          local.serverStickerSnapshot.name === 'post-catalog name',
      );
      await store.put({ ...local, pendingMetadata: { group: 'still pending' } });
      fail = true;
      try {
        await api.edit(local, { note: 'retry note' });
      } catch {
        /* intended offline */
      }
      local = await store.get(local.id);
      check(
        'failed metadata keeps prior pending fields and latest request',
        local.pendingMetadata.group === 'still pending' &&
          local.pendingMetadata.note === 'retry note' &&
          local.serverStickerSnapshot.note === '',
      );
      fail = false;
      await api.sync();
      local = await store.get(local.id);
      check(
        'retry uses whitelist and adopts ACK without losing original bytes',
        !local.pendingMetadata &&
          local.group === 'still pending' &&
          local.note === 'retry note' &&
          (await bytes(local.blob)) === (await bytes(original)),
      );
      // Delayed ACK races a newer persisted user edit; current local fields win, backend cache remains explicit.
      let release;
      const started = new Promise((r) => {
        entered = r;
      });
      gate = new Promise((r) => {
        release = r;
      });
      const editing = api.edit(local, { note: 'old outgoing note' });
      await started;
      const staged = await store.get(local.id);
      await store.put({
        ...staged,
        name: 'newer local name',
        note: 'newer local note',
        pendingMetadata: { name: 'newer local name', note: 'newer local note', group: 'new group' },
        newerUnknown: 9,
      });
      release();
      await editing;
      local = await store.get(local.id);
      check(
        'late metadata ACK never overwrites newer user edit or clears newer pending',
        captured.note === 'old outgoing note' &&
          local.note === 'newer local note' &&
          local.name === 'newer local name' &&
          local.pendingMetadata.note === 'newer local note' &&
          local.pendingMetadata.group === 'new group' &&
          local.newerUnknown === 9 &&
          local.serverStickerSnapshot.note === 'old outgoing note',
      );
      // A new original while network is in flight must not acquire the old original's ACK.
      let releaseOriginal;
      const originalStarted = new Promise((r) => {
        entered = r;
      });
      gate = new Promise((r) => {
        releaseOriginal = r;
      });
      const replacing = api.edit(local, { note: 'old original ACK' });
      await originalStarted;
      const next = await store.get(local.id),
        replacement = new Blob(['replacement-original'], { type: 'image/png' });
      await store.put({
        ...next,
        blob: replacement,
        previewBlob: new Blob(['new-preview']),
        note: 'replacement note',
        pendingMetadata: { note: 'replacement note' },
      });
      releaseOriginal();
      await replacing;
      local = await store.get(local.id);
      check(
        'old ACK cannot overwrite replacement original, preview or metadata snapshot',
        (await local.blob.text()) === 'replacement-original' &&
          (await local.previewBlob.text()) === 'new-preview' &&
          local.note === 'replacement note' &&
          local.serverStickerSnapshot.note === 'old outgoing note',
      );
      // Catalog absence is not a fabricated deleted DTO.
      server.delete('remote');
      await api.sync();
      remote = await store.get(remote.id);
      check(
        'missing catalog item keeps last snapshot without inventing deleted DTO',
        remote.removed &&
          remote.serverStickerSnapshot.deleted === false &&
          remote.serverStickerSnapshot.extra.nested[0] === 'preserved',
      );
      await api.remove(local);
      local = await store.get(local.id);
      check(
        'remove stores actual deleted ACK and preserves replacement original and alias',
        local.removed &&
          local.deleted &&
          local.serverStickerSnapshot.deleted &&
          local.serverStickerSnapshot.createdAt === '2020-01-01T01:02:03.004Z' &&
          (await local.blob.text()) === 'replacement-original' &&
          (await store.get('mapping:old')).futureAlias,
      );
      const sourceBytes = new Uint8Array([71, 73, 70, 56, 57, 97, 9]);
      api.setLibraryReader(async () => ({
        messages: { '-1': [{ id: 9, media: { id: 9 } }] },
        documents: [{ id: 9, mimeType: 'image/gif', bytes: sourceBytes }],
      }));
      const saved = await api.saveMessage({
        roomId: '-1',
        messageId: '9',
        name: ' source name ',
        note: ' source note ',
      });
      check(
        'from-message envelope adopts complete DTO and normalized metadata without rewriting source',
        !saved.localOnly &&
          saved.asset.serverStickerSnapshot.id === 'source' &&
          saved.asset.serverStickerSnapshot.extra.nested[0] === 'preserved' &&
          saved.asset.name === 'source name' &&
          saved.asset.note === 'source note' &&
          saved.asset.localSource.messageId === '9' &&
          (await bytes(saved.asset.blob)) === [...sourceBytes].join(',') &&
          calls.some((c) => c.action === 'from-message'),
      );
      return { checks, uploads, indexedDB: true };
    });
    assert.equal(result.indexedDB, true);
    assert.ok(result.checks.length >= 14);
    const output = path.resolve(
      'outputs/2026-10-18-android-media-014/chat-ui/client-fidelity.json',
    );
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
});
