import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createDiaryServer } from '../../src/server/app.mjs';
import {
  createRevisitClient,
  REVISIT_ROOM,
} from '../../previews/telegram-chat/shiye-revisit-client.js';
import { commentLibrary } from '../../tests/helpers/revisit-comment-fixtures.mjs';
import { Channel, loadWorker, loadJournal } from '../../tests/helpers/local-program-worker.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const sourceHash = (db) =>
  hash(JSON.stringify({ entries: db.entries, units: db.messageStore, media: db.media }));

/** Only synthetic fixtures, ephemeral loopback port, private fake IndexedDB; no GUI/production options. */
export async function runRevisitIntegrationLab() {
  const dataDir = path.join(ROOT, 'tmp/revisit-decoupling/stage5', randomUUID());
  const f = commentLibrary();
  for (let index = 0; index < 60; index++)
    f.db.entries.push({
      id: `later-synthetic-entry-${index}`,
      title: '稍后推送的合成日记',
      category: '合成分类',
      tags: [],
      contentFormat: 'html',
      content: '<p>[2025/10/17 12:30:00]</p><p>新的合成分组</p>',
      date: '2025-10-17T04:30:00Z',
      updatedAt: '2025-10-17T04:30:00Z',
      attachments: [],
    });
  await fs.mkdir(path.join(dataDir, 'media'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'diary.json'), JSON.stringify(f.db));
  const image = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
    'base64',
  );
  for (const asset of f.db.media) await fs.writeFile(path.join(dataDir, 'media', asset.id), image);
  const checks = [],
    requests = [];
  const savedGlobals = {
    indexedDB: globalThis.indexedDB,
    BroadcastChannel: globalThis.BroadcastChannel,
  };
  let server,
    base,
    cookie = '',
    dropApi,
    dropCommand,
    composing = false;
  async function start() {
    server = await createDiaryServer({ dataDir, seed: false, messageUnits: true });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() {
    if (!server?.listening) return;
    server.closeAllConnections();
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
  async function request(url, method = 'POST', input = {}) {
    const response = await fetch(base + url, {
      method,
      headers: { 'X-Diary-Client': 'desktop', ...(cookie ? { Cookie: cookie } : {}) },
      ...(method === 'GET' ? {} : { body: JSON.stringify(input) }),
    });
    const next = response.headers.get('set-cookie');
    if (next) cookie = next.split(';')[0];
    return { status: response.status, data: await response.json() };
  }
  const readDb = async () =>
    JSON.parse(await fs.readFile(path.join(dataDir, 'diary.json'), 'utf8'));
  const check = (name) => checks.push(name);
  try {
    await start();
    const initial = sourceHash(await readDb());
    const worker = await loadWorker();
    const seed = () => ({
      shiyeVersion: 2,
      users: [{ id: '1', firstName: '我', self: true }],
      chats: [],
      channels: [],
      dialogs: { active: [], archived: [] },
      messages: {},
      documents: [],
      availableReactions: [],
      dialogFilters: [],
      topPeers: [],
    });
    const local = { mockData: seed(), fireUpdate() {} };
    worker.installLocalRoomCommands(local);
    const channel = new Channel('shiye-local-rooms');
    const pending = new Map();
    channel.onmessage = ({ data }) => {
      const receipt = pending.get(data.requestId);
      if (!receipt) return;
      pending.delete(data.requestId);
      clearTimeout(receipt.timer);
      data.error ? receipt.reject(Error(data.error)) : receipt.resolve(data);
    };
    async function command(action, fields = {}) {
      const result = await new Promise((resolve, reject) => {
        const requestId = randomUUID();
        const timer = setTimeout(() => {
          pending.delete(requestId);
          reject(Error('隔离worker响应超时'));
        }, 3000);
        pending.set(requestId, { resolve, reject, timer });
        channel.postMessage({ action, requestId, ...fields });
      });
      if (dropCommand === action) {
        dropCommand = undefined;
        throw Error('synthetic-local-receipt-loss');
      }
      return result;
    }
    async function readLibrary() {
      const db = await new Promise((resolve, reject) => {
        const r = indexedDB.open('shiye-telegram-preview-v1', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('preview');
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      try {
        return await new Promise((resolve, reject) => {
          const r = db.transaction('preview').objectStore('preview').get('library');
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
      } finally {
        db.close();
      }
    }
    async function rejectNextLocalWrite(action, fields) {
      const factory = globalThis.indexedDB;
      const open = factory.open;
      factory.open = () => {
        const request = { error: Error('synthetic-storage-open-failure') };
        queueMicrotask(() => request.onerror?.());
        return request;
      };
      try {
        await assert.rejects(command(action, fields), /storage-open-failure/);
      } finally {
        factory.open = open;
      }
    }
    // Derive the fixed HTTP mappings from the actual native allowlist; never instantiate the EXE bridge.
    const bridgeSource = await fs.readFile(
      path.join(ROOT, 'previews/telegram-chat/ChatJournalBridge.cs'),
      'utf8',
    );
    const routes = new Map(
      [
        ...bridgeSource.matchAll(
          /case "(revisit-[\w-]+)": method = "(GET|POST|PUT)"; path = "([^"]+)";/g,
        ),
      ].map(([, action, method, url]) => [action, { method, url }]),
    );
    const journal = await loadJournal(
      async ({ action, payload }) => {
        if (action === 'status') return await request('/api/chat-journal', 'GET');
        const route = routes.get(action);
        assert.ok(route, `Native bridge must allow ${action}`);
        const response = await request(route.url, route.method, payload);
        requests.push({ action, status: response.status });
        if (dropApi === action) {
          dropApi = undefined;
          throw Error('synthetic-backend-receipt-loss');
        }
        return response;
      },
      {
        sourceId: 'synthetic-revisit-client',
        rooms: { [REVISIT_ROOM]: { enabled: true, category: '合成分类' } },
      },
    );
    const api = (...args) => journal.program(...args);
    const receiver = () =>
      createRevisitClient({ api, command, readLibrary, isComposing: () => composing });
    let client = receiver();
    const password = randomUUID();
    assert.equal((await request('/api/access', 'PUT', { password })).status, 200);
    await request('/api/lock');
    await assert.rejects(client.sync(), (error) => error.status === 401);
    assert.equal((await readLibrary()).shiyeRevisit, undefined);
    assert.deepEqual((await readLibrary()).messages, {});
    assert.equal((await request('/api/unlock', 'POST', { password })).status, 200);
    check(
      'locked first launch clears an empty cache without creating a program group or exposing sources',
    );
    await Promise.all(Array.from({ length: 8 }, () => client.sync()));
    const incoming = () => local.mockData.messages[REVISIT_ROOM].filter((m) => m.shiyeProgram);
    assert.equal(incoming().length, f.db.revisit.deliveries.length);
    assert.equal(new Set(incoming().map((m) => m.shiyeProgram.deliveryId)).size, incoming().length);
    check(
      'real HTTP → native fixed action mirror → journal bridge → worker → IndexedDB; concurrent sync deduplicates',
    );
    const ids = incoming().map((m) => m.id);
    dropCommand = 'program-feed';
    await assert.rejects(client.sync(), /receipt-loss/);
    await client.sync();
    assert.deepEqual(
      incoming().map((m) => m.id),
      ids,
    );
    check('lost local feed acknowledgement retries without changing local message IDs');
    const bytes = await client.mediaBytes(f.media.id, 'synthetic-image');
    assert.deepEqual(Buffer.from(bytes.bytes), image);
    assert.ok(local.mockData.documents.some((m) => Buffer.from(m.bytes).equals(image)));
    check('original media bytes survive HTTP chunks and actual local document persistence');
    await client.select(f.group.id);
    const selectedBefore = structuredClone(local.mockData.shiyeRevisit);
    await rejectNextLocalWrite('program-target', { batchId: 'uncommitted-target' });
    assert.deepEqual(local.mockData.shiyeRevisit, selectedBefore);
    assert.deepEqual((await readLibrary()).shiyeRevisit, selectedBefore);
    check('failed local target write changes neither in-memory nor persisted draft selection');
    const sent = async (text, replyToMsgId) => {
      await worker.invokeLocalPreview(
        local,
        new worker.Api.messages.SendMessage({
          peer: { roomId: REVISIT_ROOM },
          message: text,
          ...(replyToMsgId
            ? { replyTo: new worker.Api.InputReplyToMessage({ replyToMsgId }) }
            : {}),
        }),
      );
      return local.mockData.messages[REVISIT_ROOM].at(-1);
    };
    const latestBeforeSend = incoming().reduce(
      (last, item) =>
        !last || item.date > last.date || (item.date === last.date && item.id > last.id)
          ? item
          : last,
      undefined,
    );
    const expectedDefault = (await readDb()).revisit.deliveries.find(
      (d) => d.id === latestBeforeSend.shiyeProgram.deliveryId,
    );
    const groupComment = await sent('合成：默认回复最近一条');
    await rejectNextLocalWrite('program-ack', {
      operationId: groupComment.shiyeComment.operationId,
    });
    assert.equal(local.mockData.messages[REVISIT_ROOM].at(-1).shiyeComment.acknowledged, undefined);
    assert.equal(
      (await readLibrary()).messages[REVISIT_ROOM].at(-1).shiyeComment.acknowledged,
      undefined,
    );
    check('failed local acknowledgement write cannot mark an unsent comment acknowledged');
    dropApi = 'revisit-comment';
    await client.sync();
    assert.ok(client.status().lastError.includes('receipt-loss'));
    assert.equal((await readDb()).revisit.comments.length, 1);
    assert.equal(local.mockData.messages[REVISIT_ROOM].at(-1).shiyeComment.acknowledged, undefined);
    local.mockData = await worker.loadLocalPreview(seed());
    client = receiver();
    await client.sync();
    let db = await readDb();
    assert.equal(db.revisit.comments.length, 1);
    assert.deepEqual(db.revisit.comments[0].targets, [expectedDefault.ref]);
    assert.equal(db.revisit.comments[0].deliveryId, expectedDefault.id);
    check(
      'backend commit with lost response, local reload and retry creates exactly one latest-message reply',
    );
    composing = true;
    const oldTarget = client.status().target;
    const pushed = await api('tick', {
      manual: true,
      from: '2026-10-17T04:00:00Z',
      to: '2026-10-17T05:00:00Z',
    });
    assert.equal(pushed.created, 60);
    await client.sync();
    assert.deepEqual(client.status().target, oldTarget);
    assert.ok(incoming().length > 50);
    assert.equal(incoming().length, (await readDb()).revisit.deliveries.length);
    check(
      'new 60-message server batch crosses feed pages, preserving all deliveries and persisted draft target',
    );
    composing = false;
    const quoteMessage = incoming().find((m) => m.shiyeProgram.deliveryId === f.quote.id);
    await client.select(client.status().batches.at(-1).id);
    const quoteComment = await sent('合成：引用单条', quoteMessage.id);
    dropCommand = 'program-ack';
    await client.sync();
    await client.sync();
    db = await readDb();
    assert.equal(db.revisit.comments.length, 2);
    assert.deepEqual(
      db.revisit.comments.find((c) => c.operationId === quoteComment.shiyeComment.operationId)
        .targets,
      [f.quote.ref],
    );
    check(
      'explicit quotation overrides selected group; lost local comment acknowledgement does not duplicate',
    );
    await worker.invokeLocalPreview(
      local,
      new worker.Api.messages.DeleteMessages({ id: [quoteComment.id] }),
    );
    const withdrawalBefore = structuredClone(local.mockData.shiyeWithdrawalOutbox);
    await rejectNextLocalWrite('withdrawal-ack', {
      operationIds: withdrawalBefore.map((item) => item.operationId),
    });
    assert.deepEqual(local.mockData.shiyeWithdrawalOutbox, withdrawalBefore);
    assert.deepEqual((await readLibrary()).shiyeWithdrawalOutbox, withdrawalBefore);
    check('failed withdrawal acknowledgement write keeps the same durable retry operation');
    dropApi = 'revisit-withdraw';
    await client.sync();
    assert.equal((await readLibrary()).shiyeWithdrawalOutbox.length, 1);
    await client.sync();
    const withdrawn = (await readDb()).revisit.comments.find(
      (c) => c.operationId === quoteComment.shiyeComment.operationId,
    );
    assert.equal(withdrawn.state, 'withdrawn');
    assert.equal(withdrawn.body, null);
    assert.equal((await readLibrary()).shiyeWithdrawalOutbox.length, 0);
    check(
      'real worker withdrawal persists, backend receipt loss retries, body-free tombstone remains',
    );
    const unsent = await sent('合成：发送前撤回');
    await worker.invokeLocalPreview(
      local,
      new worker.Api.messages.DeleteMessages({ id: [unsent.id] }),
    );
    await client.sync();
    const tombstone = (await readDb()).revisit.comments.find(
      (c) => c.operationId === unsent.shiyeComment.operationId,
    );
    assert.equal(tombstone.state, 'withdrawn');
    assert.equal(tombstone.body ?? null, null);
    assert.equal(tombstone.text || '', '');
    check('withdraw-before-upload sends a tombstone, never the removed body');
    await journal.flush();
    assert.equal((await readDb()).entries.length, f.db.entries.length);
    check(
      'actual normal journaling bridge excludes the program room even when archiving is configured',
    );
    const beforeReplay = (await readDb()).revisit.deliveries.length;
    await api('tick', { manual: true, from: '2026-10-17T00:00:00Z', to: '2026-10-17T05:00:00Z' });
    assert.equal((await readDb()).revisit.deliveries.length, beforeReplay);
    check(
      'comments never become replay sources; repeated manual tick adds no recursive deliveries',
    );
    const pendingComment = await sent('合成：锁定时保留未发送的个人评论');
    await request('/api/lock');
    await assert.rejects(client.sync(), (error) => error.status === 401);
    const locked = await readLibrary();
    assert.equal(client.status().locked, true);
    assert.ok(
      locked.messages[REVISIT_ROOM].filter((m) => m.shiyeProgram).every(
        (m) => m.message === '正在核对原记录…' && !m.media,
      ),
    );
    assert.equal(locked.documents.length, 0);
    assert.equal(
      locked.messages[REVISIT_ROOM].find((m) => m.id === pendingComment.id).shiyeComment
        .acknowledged,
      undefined,
    );
    check(
      'actual lock/401 clears durable program text/media while preserving personal unsent comments',
    );
    assert.equal((await request('/api/unlock', 'POST', { password })).status, 200);
    await client.sync();
    assert.equal(client.status().locked, false);
    assert.ok(incoming().some((m) => m.media));
    assert.ok(
      local.mockData.messages[REVISIT_ROOM].find((m) => m.id === pendingComment.id).shiyeComment
        .acknowledged,
    );
    check('unlock revalidates source cache and drains the same persisted comment outbox');
    await stop();
    await start();
    cookie = '';
    await request('/api/unlock', 'POST', { password });
    const count = (await readDb()).revisit.comments.length;
    local.mockData = await worker.loadLocalPreview(seed());
    client = receiver();
    await client.sync();
    assert.equal((await readDb()).revisit.comments.length, count);
    assert.equal(incoming().length, beforeReplay);
    check(
      'backend restart plus worker reload preserves source identities, comments and withdrawal receipts',
    );
    assert.equal(sourceHash(await readDb()), initial);
    check(
      'synthetic original entries, media metadata and message units remain byte-equivalent as structured data',
    );
    assert.ok(groupComment.shiyeComment.operationId);
    return {
      passed: true,
      checks,
      requestCount: requests.length,
      dataDir,
      network: 'ephemeral 127.0.0.1 server only; no Telegram or production connection',
      storage: 'synthetic disk library + private fake-indexeddb running actual worker persistence',
      sourceBeforeSHA256: initial,
      sourceAfterSHA256: sourceHash(await readDb()),
      guiUsed: false,
      productionWindowsChanged: false,
      limits: [
        'Native executable/WebView transport, visual UI, IME and physical devices are not exercised',
        'Media-specific comment UI and media comment uploads remain separate work',
      ],
    };
  } finally {
    await stop();
    for (const value of Channel.instances) value.onmessage = undefined;
    globalThis.indexedDB = savedGlobals.indexedDB;
    globalThis.BroadcastChannel = savedGlobals.BroadcastChannel;
  }
}
