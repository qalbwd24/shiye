import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { planLegacyProductImport } from '../src/server/sync-product/legacy-adapter.mjs';
import {
  planMigrationMetadata,
  portableConfiguration,
} from '../src/server/sync-product/migration-metadata.mjs';
import { createSyncServer } from '../src/server/sync-v2/server.mjs';
import { productSyncExtension } from '../src/server/sync-product/service.mjs';
import { seedProductLibrary } from '../src/server/sync-product/import.mjs';
import { readSeedPackage } from '../src/server/sync-product/seed-package.mjs';
import { createProductSeedClient } from '../public/shared/product-seed-client.js';

const sourceId = 'aa001122-3344-4555-8666-778899aabbcc';
const library = () => ({
  schema: 1,
  entries: [],
  media: [],
  categories: ['日常'],
  tags: [],
  stickers: [],
  settings: {
    shortcuts: { insertTime: 'Alt+T' },
    preferences: {
      theme: 'dark',
      fontSize: 18,
      windowPosition: { x: 77 },
      nested: { apiKey: 'do-not-export', roundness: 12 },
    },
    sync: { url: 'https://example.invalid/sync', username: 'owner', password: 'do-not-export' },
    future: { array: [null, { retained: true }] },
  },
  templates: [{ id: 'template-stable', name: '合成模板', future: { retained: true } }],
  conversationServices: {
    version: 1,
    instances: [
      {
        id: sourceId,
        providerId: 'external-program',
        parameters: { name: '合成角色', temperature: 0.7 },
      },
    ],
    bindings: [{ id: 'stable-binding', instanceId: sourceId }],
  },
  futureRoot: { nested: [1, null, '原值'] },
  sourceArchives: 'separate-private-archive',
});

test('settings, templates, program parameters and unknown fields survive without mutating source', () => {
  const source = library(),
    before = structuredClone(source),
    plan = planLegacyProductImport(source, { sourceId });
  const record = plan.records.find((r) => r.data.scope === 'migration-metadata');
  assert.deepEqual(source, before);
  assert.equal(record.data._product.readOnlyProjection, true);
  assert.deepEqual(record.data.values.settings.shortcuts, before.settings.shortcuts);
  assert.deepEqual(record.data.values.templates, before.templates);
  assert.deepEqual(record.data.values.conversationServices, before.conversationServices);
  assert.deepEqual(record.data.values.futureRoot, before.futureRoot);
  assert.deepEqual(record.data.values.settings.future, before.settings.future);
  assert.equal(record.data.values.settings.preferences.windowPosition, undefined);
  assert.equal(record.data.values.settings.preferences.nested.apiKey, undefined);
  assert.equal(record.data.values.settings.sync.password, undefined);
  assert.equal(record.data.values.sourceArchives, undefined);
  assert.equal(JSON.stringify(plan.records).includes('do-not-export'), false);
  const paths = new Set([...plan.coverage.fields, ...plan.coverage.excluded].map((r) => r.path));
  for (const key of Object.keys(source)) assert.ok(paths.has(key), key);
  assert.equal(plan.coverage.completeComputerExport, false);
  assert.ok(plan.coverage.externalSourcesRequired.includes('desktop-chat-profile'));
});

test('configuration filtering preserves null, arrays and unknown values; excluded report contains no values', () => {
  const excluded = [];
  const value = portableConfiguration(
    {
      a: null,
      b: [{ cookie: 'private', parameters: { x: 0, flag: false } }],
      localPath: 'C:/private',
    },
    { excluded },
  );
  assert.deepEqual(value, { a: null, b: [{ parameters: { x: 0, flag: false } }] });
  assert.deepEqual(
    excluded.map((r) => r.path),
    ['b[0].cookie', 'localPath'],
  );
  assert.equal(JSON.stringify(excluded).includes('C:/private'), false);
});

test('known credential names are normalized only within configuration; ordinary keys survive', () => {
  const excluded = [];
  const value = portableConfiguration(
    {
      api_key: 'HIDDEN_API',
      'CLIENT-SECRET': 'HIDDEN_CLIENT',
      session_token: 'HIDDEN_SESSION',
      secretKey: 'HIDDEN_SECRET',
      bearerToken: 'HIDDEN_BEARER',
      nested: [{ access_token: 'HIDDEN_ACCESS', key: 'Alt+T', keyboard: 'preserved' }],
      shortcut: { key: 'F14', command: 'insertTime' },
      futureOrdinary: { retained: true },
    },
    { excluded },
  );
  assert.deepEqual(value, {
    nested: [{ key: 'Alt+T', keyboard: 'preserved' }],
    shortcut: { key: 'F14', command: 'insertTime' },
    futureOrdinary: { retained: true },
  });
  assert.equal(excluded.length, 6);
  assert.equal(
    excluded.every((row) => row.reason === 'credential-device-private'),
    true,
  );
  assert.equal(JSON.stringify({ value, excluded }).includes('HIDDEN_'), false);
  const source = library();
  source.client_secret = 'HIDDEN_ROOT';
  source.settings.provider = { api_key: 'HIDDEN_PROVIDER', shortcut: { key: 'Alt+T' } };
  const plan = planLegacyProductImport(source, { sourceId });
  assert.equal(JSON.stringify(plan).includes('HIDDEN_'), false);
  assert.deepEqual(
    plan.records.find((row) => row.data.scope === 'migration-metadata').data.values.settings
      .provider.shortcut,
    { key: 'Alt+T' },
  );
});

test('HTTP configuration URLs strip userinfo and every known credential query parameter', () => {
  const excluded = [];
  const original = {
    endpoint:
      'https://OWNER:HIDDEN_PASSWORD@example.invalid/sync?token=HIDDEN_ONE&mode=pull&api_key=HIDDEN_TWO&token=HIDDEN_THREE&client_secret=HIDDEN_FOUR#section',
    mirrors: ['http://example.invalid/?SESSION_TOKEN=HIDDEN_FIVE&key=business-id&future=kept'],
    plain: 'https://example.invalid/raw?future=kept%20exactly',
    documentation: 'Use https://user:pass@example.invalid as an example',
    nonHttp: 'custom://user:pass@example.invalid/?token=custom',
  };
  const before = structuredClone(original);
  const value = portableConfiguration(original, { path: 'settings', excluded });
  assert.deepEqual(original, before);
  assert.equal(value.endpoint, 'https://example.invalid/sync?mode=pull#section');
  assert.equal(value.mirrors[0], 'http://example.invalid/?key=business-id&future=kept');
  assert.equal(value.plain, original.plain);
  assert.equal(value.documentation, original.documentation);
  assert.equal(value.nonHttp, original.nonHttp);
  assert.deepEqual(excluded, [
    { path: 'settings.endpoint', reason: 'credential-url-userinfo' },
    { path: 'settings.endpoint', reason: 'credential-url-query' },
    { path: 'settings.mirrors[0]', reason: 'credential-url-query' },
  ]);
  assert.equal(JSON.stringify({ value, excluded }).includes('HIDDEN_'), false);
});

test('chatJournal reports rooms separately and blocks unowned subdomains without copying bodies', () => {
  const source = library();
  source.chatJournal = {
    rooms: [{ id: 'room' }],
    pending: [{ text: 'UNOWNED_PRIVATE_BODY' }],
    futureJournal: { text: 'UNOWNED_PRIVATE_BODY' },
  };
  const { records, coverage } = planMigrationMetadata(source, sourceId);
  assert.deepEqual(
    coverage.fields.find((row) => row.path === 'chatJournal.rooms'),
    {
      path: 'chatJournal.rooms',
      disposition: 'typed-conversation-adapter',
      count: 1,
    },
  );
  assert.deepEqual(
    coverage.unmapped.map(({ path, count }) => [path, count]),
    [
      ['chatJournal.pending', 1],
      ['chatJournal.futureJournal', 1],
    ],
  );
  assert.ok(coverage.blockers.includes('UNMAPPED_SOURCE_SUBDOMAINS'));
  assert.equal(coverage.completeComputerExport, false);
  assert.equal(JSON.stringify({ records, coverage }).includes('UNOWNED_PRIVATE_BODY'), false);
  assert.equal(records[0].data.values.chatJournal, undefined);
});

test('messageStore counts only units/layouts attached to non-chat diary entries', () => {
  const source = library();
  source.entries = [{ id: 'diary' }, { id: 'no-layout' }, { id: 'chat', chatJournal: {} }];
  source.messageStore = {
    units: [
      { id: 'mapped', origin: { kind: 'diary', entryId: 'diary' } },
      { id: 'no-layout', origin: { kind: 'diary', entryId: 'no-layout' } },
      { id: 'chat', origin: { kind: 'diary', entryId: 'chat' } },
      { id: 'non-diary', origin: { kind: 'chat', entryId: 'diary' } },
      { id: 'orphan', origin: { kind: 'diary', entryId: 'missing' }, text: 'UNOWNED_BODY' },
    ],
    layouts: { diary: { order: [] }, chat: { order: [] }, missing: { order: [] } },
    futureMessages: [{ body: 'UNOWNED_BODY' }],
  };
  const before = structuredClone(source);
  const { records, coverage } = planMigrationMetadata(source, sourceId);
  assert.deepEqual(source, before);
  const units = coverage.fields.find((row) => row.path === 'messageStore.units');
  assert.equal(units.mappedCount, 1);
  assert.equal(units.unmappedCount, 4);
  const layouts = coverage.fields.find((row) => row.path === 'messageStore.layouts');
  assert.equal(layouts.mappedCount, 1);
  assert.equal(layouts.unmappedCount, 2);
  assert.equal(coverage.unmappedItemCount, 7);
  assert.equal(JSON.stringify({ records, coverage }).includes('UNOWNED_BODY'), false);
  assert.equal(records[0].data.values.messageStore, undefined);
});

test('revisit public subdomains are conditional runtime adapters; all other state stays private', () => {
  const source = library();
  source.revisit = {
    config: { enabled: true },
    comments: [{ text: 'COMMENT_BODY' }],
    deliveries: [{ id: 'd' }],
    cursor: 'PRIVATE_CURSOR',
    receipts: [{ id: 'PRIVATE_RECEIPT' }],
    futureRuntime: { x: 1 },
  };
  const { records, coverage } = planMigrationMetadata(source, sourceId);
  for (const field of ['config', 'comments', 'deliveries']) {
    assert.equal(
      coverage.fields.find((row) => row.path === `revisit.${field}`).disposition,
      'business-adapter-via-import-runtime',
    );
  }
  for (const field of ['cursor', 'receipts', 'futureRuntime']) {
    assert.equal(
      coverage.fields.find((row) => row.path === `revisit.${field}`).disposition,
      'server-private-runtime-not-exported',
    );
    assert.ok(coverage.excluded.some((row) => row.path === `revisit.${field}`));
  }
  assert.equal(coverage.unmappedItemCount, 0);
  assert.deepEqual(coverage.blockers, []);
  assert.equal(coverage.completeComputerExport, false);
  const output = JSON.stringify({ records, coverage });
  for (const body of ['COMMENT_BODY', 'PRIVATE_CURSOR', 'PRIVATE_RECEIPT'])
    assert.equal(output.includes(body), false);
});

test('malformed mapped domains are explicit blockers even when they contain zero items', () => {
  const source = {
    entries: [],
    media: [],
    chatJournal: null,
    messageStore: { units: {}, layouts: [] },
  };
  const { coverage } = planMigrationMetadata(source, sourceId);
  assert.equal(coverage.unmapped.length, 3);
  assert.equal(coverage.unmappedItemCount, 0);
  assert.ok(coverage.blockers.includes('UNMAPPED_SOURCE_SUBDOMAINS'));
  assert.equal(
    coverage.fields.some(
      (row) => row.path === 'messageStore' && row.disposition === 'typed-business-adapter',
    ),
    false,
  );
});

test('program configuration survives while private cursors, receipts and withdrawn bodies stay private', () => {
  const source = library();
  source.conversationServices.settingsOperations = [{ key: 'private-idempotency' }];
  source.conversationServices.instances[0].state = {
    config: { enabled: true, futureParameter: { preserve: true } },
    cursor: 'private-cursor',
    batches: [{ privateRuntime: true }],
    futureRuntime: 'private',
    comments: [
      {
        id: 'withdrawn-comment',
        state: 'withdrawn',
        text: 'old-private-body',
        futureBody: 'old-private-body',
      },
      { id: 'active-comment', text: '保留评论' },
    ],
    deliveries: [{ id: 'delivery-1', source: { snapshot: 'original-snapshot' } }],
  };
  const result = planLegacyProductImport(source, { sourceId });
  const registry = result.records.find((r) => r.data.scope === 'migration-metadata').data.values
    .conversationServices;
  assert.deepEqual(
    registry.instances[0].state.config,
    source.conversationServices.instances[0].state.config,
  );
  assert.deepEqual(
    registry.instances[0].state.deliveries,
    source.conversationServices.instances[0].state.deliveries,
  );
  assert.equal(registry.instances[0].state.comments[1].text, '保留评论');
  assert.equal(JSON.stringify(registry).includes('private'), false);
  assert.ok(
    result.coverage.excluded.some(
      (row) => row.path.endsWith('.state.cursor') && row.reason === 'server-private-runtime',
    ),
  );
  const prototypeField = portableConfiguration(JSON.parse('{"__proto__":{"preserved":true}}'));
  assert.deepEqual(Object.keys(prototypeField), ['__proto__']);
  assert.equal(Object.getPrototypeOf(prototypeField), Object.prototype);
});

test('v1 front-end calls and pairing survive backend restart; coverage and packages include settings', async (t) => {
  const root = path.resolve('tmp/backend-data-completion/tests', randomUUID());
  await fs.mkdir(path.join(root, 'source', 'media'), { recursive: true });
  const source = path.join(root, 'source', 'diary.json');
  await fs.writeFile(source, JSON.stringify(library()));
  let service = await createSyncServer({
    dataDir: path.join(root, 'server'),
    extensionFactory: productSyncExtension({ autoTickMs: 0 }),
  });
  t.after(() => service.close());
  const report = await seedProductLibrary(service, {
    libraryFile: source,
    mediaDir: path.join(root, 'source', 'media'),
    sourceId,
  });
  assert.equal(report.coverage.completeComputerExport, false);
  const device = service.auth.pair({
    code: service.auth.pairingCode().code,
    deviceName: 'v1-existing-client',
  });
  const serve = async () => {
    service.server.listen(0, '127.0.0.1');
    await once(service.server, 'listening');
    return `http://127.0.0.1:${service.server.address().port}/`;
  };
  let base = await serve();
  const get = async (route) => {
    const r = await fetch(base + route, { headers: { Authorization: `Bearer ${device.token}` } });
    assert.equal(r.status, 200);
    return r.json();
  };
  const info = await get('api/sync/v1/info');
  assert.equal(info.protocol, 1);
  const view = await get('api/product/v1/library');
  assert.equal(view.profiles[0].values.templates[0].id, 'template-stable');
  const coverage = await get('api/product/v1/migration/coverage');
  assert.equal(coverage.sources[0].coverage.completeComputerExport, false);
  const api = createProductSeedClient({ baseUrl: base, token: device.token });
  let job = await api.createExport(randomUUID());
  for (let i = 0; i < 300 && job.status === 'building'; i++) {
    await new Promise((r) => setTimeout(r, 10));
    job = await api.exportStatus(job.id);
  }
  assert.equal(job.status, 'ready');
  const file = path.join(root, 'settings.syseed');
  await fs.writeFile(file, Buffer.from(await (await api.download(job.id)).arrayBuffer()));
  const pack = await readSeedPackage({
    file,
    directory: path.join(root, 'unpack'),
    expectedSha256: job.sha256,
  });
  const profile = pack.records.find((r) => r.data?.scope === 'migration-metadata');
  assert.equal(profile.data.values.settings.shortcuts.insertTime, 'Alt+T');
  assert.deepEqual(profile.data.values.futureRoot, library().futureRoot);
  await service.close();
  service = await createSyncServer({
    dataDir: path.join(root, 'server'),
    extensionFactory: productSyncExtension({ autoTickMs: 0 }),
  });
  base = await serve();
  const after = await get('api/sync/v1/info');
  assert.equal(after.libraryId, info.libraryId);
  assert.equal(after.epoch, info.epoch);
  assert.equal(after.deviceId, info.deviceId);
  assert.deepEqual((await get('api/product/v1/library')).profiles, view.profiles);
  assert.equal((await get('api/product/v1/catalog')).schema, 1);
  const denied = await fetch(base + 'api/sync/v1/push', {
    method: 'POST',
    headers: { Authorization: `Bearer ${device.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operations: [
        {
          operationId: randomUUID(),
          entityType: 'profile',
          entityId: profile.entityId,
          baseRevision: profile.revision,
          command: 'updateFields',
          changes: { values: {} },
        },
      ],
    }),
  });
  assert.equal(denied.status, 403);
  const tokenFile = path.join(root, 'private-token.json'),
    incompleteFile = path.join(root, 'must-not-publish.syseed');
  await fs.writeFile(tokenFile, JSON.stringify({ token: device.token }));
  await assert.rejects(
    promisify(execFile)(process.execPath, [
      'tools/product-seed.mjs',
      'export',
      '--scope',
      'computer',
      '--server',
      base,
      '--token-file',
      tokenFile,
      '--file',
      incompleteFile,
    ]),
    (error) => error.stderr.includes('COMPUTER_EXPORT_SOURCES_INCOMPLETE'),
  );
  await assert.rejects(fs.access(incompleteFile), { code: 'ENOENT' });
});
