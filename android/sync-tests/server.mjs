import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createSyncServer } from '../../src/server/sync-v2/server.mjs';
import { productSyncExtension } from '../../src/server/sync-product/service.mjs';
import { prepareProductEntry } from '../../public/shared/sync-product.js';
import { planMigrationMetadata } from '../../src/server/sync-product/migration-metadata.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const override = (name, fallback, allowed) => {
  if (!process.env[name]) return fallback;
  const value = path.resolve(process.env[name]);
  const relative = path.relative(path.join(root, allowed), value);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error('QA_PATH_OUTSIDE_TASK_ROOT');
  return value;
};
const area = path.join(override('SHIYE_SYNC_QA_WORK_ROOT', path.join(root, 'tmp/android-sync021/network'), 'tmp/backend-source-snapshots'), randomUUID());
const out = override('SHIYE_SYNC_QA_OUTPUT_ROOT', path.join(root, 'outputs/2026-10-19-android-sync021'), 'outputs/2026-10-19-backend-source-snapshots');
const fixturePath = override('SHIYE_SYNC_QA_FIXTURE_FILE', path.join(root, 'tmp/android-sync021/probe/src/main/assets/fixture.json'), 'tmp/backend-source-snapshots');
await fs.mkdir(area, { recursive: true });
await fs.mkdir(out, { recursive: true });
await fs.mkdir(path.dirname(fixturePath), { recursive: true });
const fixture = JSON.parse(
  await fs.readFile(path.join(root, 'docs/contracts/android-product-sync-v1.fixture.json'), 'utf8'),
);
const service = await createSyncServer({
  dataDir: area,
  extensionFactory: productSyncExtension({ autoTickMs: 0 }),
});
const bytes = Buffer.from(fixture.original.base64, 'base64');
const upload = await service.media.begin({
  ...fixture.original,
  mime: 'image/png',
  name: 'synthetic.png',
});
for (const index of upload.missingChunks)
  await service.media.putChunk(
    upload.uploadId,
    index,
    bytes.subarray(index * upload.chunkSize, (index + 1) * upload.chunkSize),
  );
await service.media.complete(upload.uploadId);
await service.publishPending();
await service.extension.importPlan({ records: fixture.records, issues: [] });
await service.extension.importPlan({
  records: planMigrationMetadata(
    {
      settings: { shortcuts: { insertTime: 'Alt+T' }, preferences: { theme: 'dark' } },
      templates: [{ id: 'backend-template', name: '合成模板' }],
      futureSetting: { preserved: true },
    },
    service.store.info().libraryId,
  ).records,
  issues: [],
});
const original = fixture.records.find((x) => x.entityType === 'journalAggregate');
const entry = structuredClone(original.data);
delete entry._product;
delete entry._canonical;
delete entry.messageUnits;
entry.id = '11111111-1111-4111-8111-111111111121';
entry.title = '手机合成记录021';
entry.category = '手机合成分类021';
entry.tags = [];
entry.draftOnly = false;
entry.futureExtension = { preserve: 'sync021' };
const prepared = prepareProductEntry(entry, {
  refs: { category: 'taxonomy:local021', tags: [], assets: ['fixture-image'] },
  media: [fixture.records.find((x) => x.entityType === 'relation').data],
});
const payloadValue = structuredClone(entry);
payloadValue.id = '11111111-1111-4111-8111-111111111122';
payloadValue.title = 'Native payload QA';
payloadValue.category = null;
payloadValue.categoryId = null;
payloadValue.tags = [];
payloadValue.attachments = [];
payloadValue.futurePayloadInvariant = { unknownField: 'preserved', version: 99 };
delete payloadValue.content;
payloadValue.body = { format: 'shiye-richdoc', version: 1, content: [{ type: 'paragraph', attrs: { blockId: 'payload-qa-paragraph' }, content: [{ type: 'text', text: 'payload-body-'.repeat(75000) }] }] };
const payloadEntry = prepareProductEntry(payloadValue, { refs: { assets: [], tags: [] } });
const smallPayloadValue = structuredClone(payloadValue);
smallPayloadValue.body = { format: 'shiye-richdoc', version: 1, content: [{ type: 'paragraph', attrs: { blockId: 'payload-qa-paragraph' }, content: [{ type: 'text', text: 'small payload body' }] }] };
const payloadSmallEntry = prepareProductEntry(smallPayloadValue, { refs: { assets: [], tags: [] } });
const info = {
  synthetic: true,
  protocol: 1,
  entry: prepared,
  remoteEntryId: original.entityId,
  original: fixture.original,
  pairCode: service.auth.pairingCode().code,
  payloadEntry,
  payloadSmallEntry,
};
await fs.writeFile(
  fixturePath,
  JSON.stringify(info),
);
await fs.writeFile(
  path.join(out, 'network-server.json'),
  JSON.stringify(
    {
      synthetic: true,
      port: 19421,
      dataDir: path.relative(root, area),
      library: service.store.info(),
    },
    null,
    2,
  ),
);
service.server.listen(19421, '127.0.0.1');
await once(service.server, 'listening');
let edited = false;
const timer = setInterval(() => {
  if (process.env.SHIYE_SYNC_QA_DISABLE_PC_EDIT === '1') return;
  const value = service.store.getEntity('journalAggregate', entry.id);
  if (edited || !value) return;
  edited = true;
  const result = service.store.push('pc-synthetic-021', [
    {
      operationId: 'pc-edit-021-' + randomUUID(),
      entityType: 'journalAggregate',
      entityId: entry.id,
      baseRevision: value.revision,
      command: 'updateFields',
      changes: { title: '电脑合成修改021' },
    },
  ]);
  fs.writeFile(
    path.join(out, 'pc-receipt.json'),
    JSON.stringify(
      {
        synthetic: true,
        phoneEntryReceived: true,
        unknownFieldPreserved: value.data.futureExtension?.preserve === 'sync021',
        pcEditAccepted: result.results[0].status === 'accepted',
      },
      null,
      2,
    ),
  ).catch(() => {});
}, 150);
for (const signal of ['SIGTERM', 'SIGINT'])
  process.once(signal, async () => {
    clearInterval(timer);
    await service.close();
    process.exit();
  });
console.log(JSON.stringify({ ready: true, synthetic: true, port: 19421 }));
