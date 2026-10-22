import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { compileNotesSnapshot } from '../src/server/sync-product/notes-snapshot.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
function fixture() {
  const bytes = Buffer.from('synthetic original bytes');
  const id = `sha256:${sha(bytes)}`;
  return {
    kind: 'shiye-notes-ui-snapshot',
    experimental: true,
    exportedAt: '2026-10-19T00:00:00Z',
    workspace: {
      revision: 7,
      notes: [
        {
          id: 'draft-one',
          title: '',
          updatedAt: null,
          body: {
            type: 'doc',
            content: [{ type: 'image', attrs: { assetId: id, occurrenceId: 'one' } }],
          },
          selection: { from: 1, to: 1 },
          scroll: 55,
          unknown: { tasks: ['源码 **保留**'] },
        },
      ],
      openIds: ['draft-one'],
      closedIds: [],
      activeId: 'draft-one',
      background: { assetId: id, opacity: 0.2 },
      unknownPreference: { keep: true },
    },
    assets: [
      {
        id,
        name: '../not-a-path.png',
        type: 'image/png',
        dataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
      },
    ],
  };
}
const compile = (input, extra = {}) =>
  compileNotesSnapshot(input, { sourceId: 'desktop:notes:main', ...extra });
const rejects = (value, code, extra) => assert.throws(() => compile(value, extra), { code });

test('actual unversioned export preserves exact workspace, originals, identities and unknown fields', () => {
  const input = fixture();
  const original = structuredClone(input);
  const plan = compile(input);
  assert.deepEqual(input, original);
  assert.deepEqual(plan.records[0].data.workspace, input.workspace);
  assert.equal(plan.records[0].entityType, 'profile');
  assert.equal(plan.records[0].data._product.readOnlyProjection, true);
  assert.equal(plan.records[0].data.scope, 'notes-workspace-snapshot');
  assert.equal(plan.assets[0].bytes.toString(), 'synthetic original bytes');
  assert.equal(plan.assets[0].size, plan.assets[0].bytes.length);
  assert.equal(plan.assets[0].sha256, sha(plan.assets[0].bytes));
  assert.deepEqual(plan.records[0].data._product.refs.assets, [plan.assets[0].assetId]);
  assert.equal(plan.records[0].data.assetMapping[0].sourceAssetId, input.assets[0].id);
  assert.equal(plan.records[0].data.assetMapping[0].assetId, plan.assets[0].assetId);
  assert.equal(JSON.stringify(plan.records).includes('base64,'), false);
  assert.equal(plan.assets[0].name, '../not-a-path.png');
  assert.equal(plan.coverage.participatesInRevisit, false);
  assert.equal(plan.coverage.completeComputerExport, false);
  assert.deepEqual(plan.issues, []);
});
test('version 1, text JSON and UTF-8 bytes compile equivalently', () => {
  const input = fixture();
  delete input.experimental;
  input.version = 1;
  const plan = compile(input);
  assert.deepEqual(compile(JSON.stringify(input)), plan);
  assert.deepEqual(compile(Buffer.from(JSON.stringify(input))), plan);
  input.version = 2;
  rejects(input, 'NOTES_INVALID_FORMAT');
});
test('source identity and revision are explicit, stable and isolated from diary and other sources', () => {
  const input = fixture();
  const first = compile(input);
  assert.deepEqual(compile(input), first);
  const other = compile(input, { sourceId: 'other-source' });
  assert.notEqual(first.assets[0].assetId, input.assets[0].id);
  assert.notEqual(other.assets[0].assetId, first.assets[0].assetId);
  assert.notEqual(other.records[0].entityId, first.records[0].entityId);
  input.workspace.revision++;
  const next = compile(input);
  assert.equal(next.records[0].entityId, first.records[0].entityId);
  assert.notEqual(next.records[0].data.snapshotId, first.records[0].data.snapshotId);
  assert.throws(() => compileNotesSnapshot(input), { code: 'NOTES_SOURCE_ID_REQUIRED' });
  rejects(input, 'NOTES_REVISION_CONFLICT', { snapshotRevision: 10 });
  delete input.workspace.revision;
  rejects(input, 'NOTES_REVISION_REQUIRED');
  assert.equal(compile(input, { snapshotRevision: 0 }).snapshotRevision, 0);
});
test('all exported originals, including unattached assets, are registered in refs', () => {
  const input = fixture();
  const orphan = { ...input.assets[0], id: 'orphan-asset' };
  input.assets.push(orphan);
  const plan = compile(input);
  assert.equal(plan.assets.length, 2);
  assert.equal(plan.records[0].data._product.refs.assets.length, 2);
  assert.equal(plan.coverage.requiredAssetCount, 1);
});
test('logical source hash ignores export time but detects stable business changes', () => {
  const input = fixture();
  const first = compile(input);
  input.exportedAt = '2026-10-19T01:02:03Z';
  const repeated = compile(input);
  assert.equal(first.sourceSha256, repeated.sourceSha256);
  assert.deepEqual(first.records, repeated.records);
  assert.notDeepEqual(first.captureInfo, repeated.captureInfo);
  assert.equal(Object.hasOwn(first.records[0].data, 'exportedAt'), false);
  input.workspace.notes[0].title = 'changed business data';
  assert.notEqual(first.sourceSha256, compile(input).sourceSha256);
  input.workspace.notes[0].title = '';
  input.assets[0].name = 'changed filename.png';
  assert.notEqual(first.sourceSha256, compile(input).sourceSha256);
  const differentSource = compile(fixture(), { sourceId: 'second-source' });
  assert.notEqual(first.sourceSha256, differentSource.sourceSha256);
});
test('same-byte rename retains transport identity and full portable source metadata while hash changes', () => {
  const input = fixture();
  input.assets[0].unknown = {
    keep: ['元信息', 7],
    localPath: 'C:/private/original',
    token: 'private-secret',
  };
  input.assets[0].rawBytes = [1, 2, 3];
  input.assets[0].base64 = 'private-byte-copy';
  input.assets[0].auth = { secret: 'private-secret' };
  const first = compile(input);
  const metadata = first.records[0].data.assetMapping[0].sourceMetadata;
  assert.deepEqual(metadata.unknown, { keep: ['元信息', 7] });
  assert.equal(metadata.id, input.assets[0].id);
  assert.equal(metadata.type, input.assets[0].type);
  assert.equal(metadata.name, input.assets[0].name);
  for (const key of ['dataUrl', 'rawBytes', 'base64', 'auth'])
    assert.equal(Object.hasOwn(metadata, key), false);
  assert.equal(JSON.stringify(first.records).includes('private-secret'), false);
  assert.equal(JSON.stringify(first.coverage.excluded).includes('C:/private'), false);
  input.assets[0].name = 'https://example.com/name?token=literal-filename';
  const renamed = compile(input);
  assert.equal(first.assets[0].assetId, renamed.assets[0].assetId);
  assert.equal(renamed.records[0].data.assetMapping[0].sourceMetadata.name, input.assets[0].name);
  assert.notEqual(first.sourceSha256, renamed.sourceSha256);
  input.workspace.revision++;
  const next = compile(input);
  assert.equal(first.assets[0].assetId, next.assets[0].assetId);
  assert.equal(next.records[0].data.assetMapping[0].sourceMetadata.name, input.assets[0].name);
});
test('transport IDs and MIME fit existing media safeId and Android ProductOriginals.Spec', () => {
  const input = fixture();
  const plan = compile(input);
  for (const asset of plan.assets) {
    assert.match(asset.assetId, /^notes-asset-[a-f0-9]{64}$/);
    assert.match(asset.assetId, /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
    assert.match(asset.mime, /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/);
  }
  assert.equal(plan.records[0].data.assetMapping[0].sourceAssetId, input.assets[0].id);
  input.assets[0].dataUrl = input.assets[0].dataUrl.replace('image/png', 'image//png');
  rejects(input, 'NOTES_INVALID_ASSET_MIME');
});
test('missing content, background and unknown resource references reject the entire plan', () => {
  for (const mutate of [
    (v) => {
      v.assets = [];
    },
    (v) => {
      v.workspace.background.assetId = 'missing';
    },
    (v) => {
      v.workspace.future = { assetId: 'missing' };
    },
    (v) => {
      delete v.workspace.notes[0].body.content[0].attrs.assetId;
    },
  ]) {
    const input = fixture();
    mutate(input);
    rejects(input, 'NOTES_MISSING_ASSET');
  }
});
test('strict base64 rejects whitespace, noncanonical pad bits, truncation, URLs and extra payload', () => {
  for (const url of [
    'blob:http://localhost/temporary',
    'data:image/png;base64,Zg=',
    'data:image/png;base64,Zh==',
    'data:image/png;base64,Zg==\n',
    'data:image/png;base64,Zg==junk',
    'data:image/png,abc',
    'data:image/png;base64,',
  ]) {
    const input = fixture();
    input.assets[0].dataUrl = url;
    rejects(input, 'NOTES_INVALID_BASE64');
  }
});
test('declared MIME, size, hash and sha256 source identities must match actual bytes', () => {
  for (const [key, value, code] of [
    ['type', 'image/jpeg', 'NOTES_ASSET_MIME_MISMATCH'],
    ['size', 999, 'NOTES_ASSET_SIZE_MISMATCH'],
    ['sha256', '0'.repeat(64), 'NOTES_ASSET_HASH_MISMATCH'],
    ['id', `sha256:${'0'.repeat(64)}`, 'NOTES_ASSET_HASH_MISMATCH'],
  ]) {
    const input = fixture();
    input.assets[0][key] = value;
    rejects(input, code);
  }
});
test('temporary URLs and inline base64 cannot masquerade as portable workspace originals', () => {
  for (const src of ['blob:http://localhost/temp', 'data:image/png;base64,Zg==']) {
    const input = fixture();
    input.workspace.notes[0].body.content[0].attrs.src = src;
    rejects(input, 'NOTES_NONPORTABLE_INLINE_RESOURCE');
  }
});
test('duplicate resource/note identity and dangling tabs fail without partial results', () => {
  let input = fixture();
  input.assets.push(input.assets[0]);
  rejects(input, 'NOTES_INVALID_ASSET_ID');
  input = fixture();
  input.workspace.notes.push(input.workspace.notes[0]);
  rejects(input, 'NOTES_INVALID_NOTE_ID');
  input = fixture();
  input.workspace.openIds.push('missing');
  rejects(input, 'NOTES_INVALID_TAB_REFERENCE');
});
test('bounded JSON, asset count, per-file/total bytes, depth and nodes reject early', () => {
  for (const limits of [
    { maxJsonBytes: 10 },
    { maxAssetBytes: 2 },
    { maxTotalAssetBytes: 2 },
    { maxDepth: 2 },
    { maxNodes: 2 },
  ])
    rejects(
      fixture(),
      limits.maxAssetBytes || limits.maxTotalAssetBytes
        ? 'NOTES_ASSETS_TOO_LARGE'
        : 'NOTES_JSON_TOO_LARGE',
      { limits },
    );
  const input = fixture();
  input.assets.push({ ...input.assets[0], id: 'second' });
  rejects(input, 'NOTES_ASSETS_TOO_LARGE', { limits: { maxAssets: 1 } });
  rejects(input, 'NOTES_INVALID_LIMIT', { limits: { maxAssets: 999999 } });
});
test('inert JSON compiler never invokes accessor/toJSON, rejects cycles and malformed JSON', () => {
  const input = fixture();
  let calls = 0;
  Object.defineProperty(input.workspace, 'getter', {
    enumerable: true,
    get() {
      calls++;
      return '';
    },
  });
  rejects(input, 'NOTES_INVALID_JSON');
  assert.equal(calls, 0);
  const cycle = fixture();
  cycle.workspace.loop = cycle;
  rejects(cycle, 'NOTES_INVALID_JSON');
  const method = fixture();
  method.toJSON = () => {
    calls++;
    return {};
  };
  rejects(method, 'NOTES_INVALID_JSON');
  assert.equal(calls, 0);
  rejects('{oops', 'NOTES_INVALID_JSON');
  rejects(Buffer.from([0xff]), 'NOTES_INVALID_JSON');
  const sparse = fixture();
  sparse.workspace.unknown = new Array(99);
  rejects(sparse, 'NOTES_INVALID_JSON');
});
