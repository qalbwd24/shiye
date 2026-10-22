import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { parse } from 'espree';
import {
  formatDesktopJournalText,
  DESKTOP_JOURNAL_FORMATTER_BODY_SHA256,
} from '../src/server/shared-sync/desktop-journal-format.mjs';
import { captureDesktopSource } from '../previews/telegram-chat/shiye-desktop-source-capture.js';
import {
  readDesktopCapture,
  planDesktopSource,
  decodeDesktopRecoveryGraph,
} from '../src/server/shared-sync/desktop-source-plan.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function put(db, name, store, key, value) {
  await new Promise((resolve, reject) => {
    const o = db.open(name, 1);
    o.onupgradeneeded = () => o.result.createObjectStore(store);
    o.onerror = () => reject(o.error);
    o.onsuccess = () => {
      const d = o.result,
        t = d.transaction(store, 'readwrite');
      t.objectStore(store).put(value, key);
      t.oncomplete = () => {
        d.close();
        resolve();
      };
      t.onerror = () => reject(t.error);
    };
  });
}
async function captureFixture() {
  const indexedDB = new IDBFactory(),
    sourceId = randomUUID(),
    serviceId = randomUUID();
  const m = (id, changes = {}) => ({
    id: String(id),
    out: true,
    message: 'same',
    date: 1760832000,
    ...changes,
  });
  const original = Uint8Array.from([1, 2, 255]);
  const library = {
    shiyeRooms: { '-103': { title: 'fixture' } },
    documents: [{ id: 'doc', size: 3n, bytes: original }],
    messages: {
      '-103': [
        m('20000000000000000001', { media: { id: 'doc' } }),
        m('2'),
        m('3'),
        m('4', { localForward: { requestId: 'pending' } }),
        m('5'),
        m('6', { message: 'different' }),
        m('7', { entities: [{ shiyeType: 'MessageEntityBold', offset: 0, length: 4 }] }),
        m('8', { shiyeProgram: { instanceId: randomUUID() } }),
        m('9', {
          out: false,
          shiyeProgram: { instanceId: serviceId, deliveryId: 'delivery', batchId: 'batch' },
        }),
        m('10', {
          shiyeComment: { instanceId: serviceId, operationId: 'comment', batchId: 'batch' },
        }),
      ],
    },
    shiyeWithdrawnMessages: [{ roomId: '-103', messageId: '3' }],
  };
  await put(indexedDB, 'shiye-journal-link-v1', 'settings', 'link', {
    sourceId,
    rooms: { '-103': { enabled: true } },
  });
  await put(indexedDB, 'shiye-telegram-preview-v1', 'preview', 'library', library);
  const root = path.resolve('tmp/desktop-source-plan-tests');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'capture-')),
    members = [];
  let active = [];
  const summary = await captureDesktopSource({
    indexedDB,
    localStorage: { getItem: () => null, length: 0, key: () => null },
    emit: async (event) => {
      if (event.kind === 'member-start') active = [];
      if (event.kind === 'member-chunk') active.push(Buffer.from(event.dataBase64, 'base64'));
      if (event.kind === 'member-end') {
        const file = path.join(directory, event.path);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, Buffer.concat(active));
        members.push({ path: event.path, size: event.size, sha256: event.sha256 });
      }
    },
  });
  await writeFile(
    path.join(directory, 'capture-manifest.json'),
    JSON.stringify({
      format: 'shiye-desktop-logical-capture',
      version: 1,
      summary,
      members,
      bytes: members.reduce((n, m) => n + m.size, 0),
    }),
  );
  return { directory, sourceId, original, serviceId };
}

test('validated private capture produces exact-identity dryrun with permanent withdrawal, pending and unknown history protection', async () => {
  const f = await captureFixture(),
    capture = await readDesktopCapture(f.directory),
    assetId = randomUUID();
  const record = (id, changes = {}) => ({
    id: String(id),
    sentAt: '2025-10-19T00:00:00.000Z',
    text: 'same',
    attachments: [],
    ...changes,
  });
  const db = {
    entries: [
      {
        chatJournal: {
          sourceId: f.sourceId,
          roomId: '-103',
          messages: [
            record('20000000000000000001', { attachments: [assetId] }),
            record('2', { withdrawn: true }),
            record('3'),
            record('6'),
            record('7', { text: '**same**' }),
          ],
        },
      },
    ],
    media: [{ id: assetId, size: f.original.length, sha256: sha(f.original) }],
    chatJournal: { rooms: [{ sourceId: f.sourceId, id: '-103' }] },
    conversationServices: {
      version: 1,
      revision: 0,
      bindings: [],
      instances: [
        {
          id: f.serviceId,
          conversationId: `desktop:${f.sourceId}:-103`,
          state: {
            deliveries: [{ id: 'delivery', batchId: 'batch' }],
            comments: [{ operationId: 'comment', batchId: 'batch', state: 'withdrawn' }],
          },
        },
      ],
    },
  };
  const before = structuredClone(db),
    plan = planDesktopSource(db, capture);
  assert.deepEqual(db, before);
  const disposition = (id) => plan.messages.find((m) => m.messageId === id).disposition;
  assert.equal(disposition('20000000000000000001'), 'existing-exact-reused');
  assert.equal(disposition('2'), 'server-withdrawn-final');
  assert.equal(disposition('3'), 'source-withdrawn-never-resend');
  assert.equal(disposition('4'), 'pending-or-unproven-private');
  assert.equal(disposition('5'), 'missing-history-requires-proven-backfill');
  assert.equal(disposition('6'), 'same-identity-content-conflict');
  assert.equal(disposition('7'), 'existing-exact-reused');
  assert.equal(disposition('8'), 'program-or-comment-requires-original-domain');
  assert.equal(disposition('9'), 'authoritative-program-domain-reused');
  assert.equal(disposition('10'), 'authoritative-comment-withdrawn-final');
  assert.equal(plan.binaries[0].disposition, 'existing-original-sha-candidate');
  assert.deepEqual(plan.binaries[0].candidateAssetIds,[assetId]);
  assert.equal(plan.summary.completeComputerExport, false);
  assert.equal(plan.summary.writesPerformed, false);
  assert.ok(!JSON.stringify(plan.summary).includes('20000000000000000001'));
});

test('planning reuses the original PC journal formatter body byte-for-byte and preserves its AST', async () => {
  const original = await readFile('previews/telegram-chat/shiye-journal.js', 'utf8');
  const extracted = await readFile('src/server/shared-sync/desktop-journal-format.mjs', 'utf8');
  function body(text, name, type) {
    let found;
    const ast = parse(text, { ecmaVersion: 'latest', sourceType: type, range: true });
    function walk(node) {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'FunctionDeclaration' && node.id?.name === name) found = node.body;
      for (const value of Object.values(node))
        if (Array.isArray(value)) value.forEach(walk);
        else if (value && typeof value === 'object') walk(value);
    }
    walk(ast);
    return { text: text.slice(...found.range), node: found };
  }
  const a = body(original, 'formatText', 'script'),
    b = body(extracted, 'formatDesktopJournalText', 'module');
  assert.equal(sha(Buffer.from(a.text)), DESKTOP_JOURNAL_FORMATTER_BODY_SHA256);
  assert.equal(b.text, a.text);
  const clean = (value) =>
    Array.isArray(value)
      ? value.map(clean)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .filter(([key]) => !['range', 'start', 'end'].includes(key))
              .map(([key, item]) => [key, clean(item)]),
          )
        : value;
  assert.deepEqual(clean(a.node), clean(b.node));
  assert.equal(
    formatDesktopJournalText({
      message: '字abc',
      entities: [{ shiyeType: 'MessageEntityBold', offset: 1, length: 3 }],
    }),
    '字**abc**',
  );
});

test('member corruption, unsafe manifests, forged summary and binary descriptors are refused before planning', async () => {
  const f = await captureFixture(),
    file = path.join(f.directory, 'capture-manifest.json');
  const raw = await readFile(file, 'utf8'),
    manifest = JSON.parse(raw);
  manifest.members.push({ ...manifest.members[0], path: '../outside' });
  await writeFile(file, JSON.stringify(manifest));
  await assert.rejects(() => readDesktopCapture(f.directory), {
    code: 'DESKTOP_PLAN_INVALID_MANIFEST',
  });
  await writeFile(file, raw);
  const original = JSON.parse(raw);
  original.summary.contentSha256 = '0'.repeat(64);
  await writeFile(file, JSON.stringify(original));
  await assert.rejects(() => readDesktopCapture(f.directory), {
    code: 'DESKTOP_PLAN_CAPTURE_DIGEST_MISMATCH',
  });
  await writeFile(file, raw);
  const media = JSON.parse(raw).members.find((m) => m.path.startsWith('media/'));
  await writeFile(path.join(f.directory, media.path), 'bad');
  await assert.rejects(() => readDesktopCapture(f.directory), {
    code: 'DESKTOP_PLAN_MEMBER_MISMATCH',
  });
  assert.throws(
    () =>
      decodeDesktopRecoveryGraph(
        {
          format: 'shiye-desktop-private-graph',
          version: 1,
          root: ['ref', 0],
          nodes: [
            {
              type: 'Uint8Array',
              path: 'media/' + '0'.repeat(64),
              size: 3,
              sha256: '0'.repeat(64),
            },
          ],
        },
        new Map(),
      ),
    { code: 'DESKTOP_PLAN_BINARY_MISMATCH' },
  );
});
