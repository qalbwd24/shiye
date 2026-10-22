import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import assert from 'node:assert/strict';

// Approved query63 + approved knownrefs delta + this exact data slice.
const root = path.resolve(import.meta.dirname, '..');
const baseline = path.join(
  root,
  'outputs/2026-10-19-shared-business-integration/diary-query-final-client-1792449420689',
);
const backend = path.join(root, 'outputs/backend-runtimes/20261019-message-edits-1792447465520');
const output = path.join(root, 'outputs/2026-10-19-local-message-edits/client-' + Date.now());
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const baseBytes = await fs.readFile(path.join(baseline, 'data-manifest.json'));
assert.equal(sha(baseBytes), 'a360f6dababaeea03652c6c375db45576e82a1ffc4b622bca20c67eefda6f596');
const serverBytes = await fs.readFile(path.join(backend, 'runtime-manifest.json'));
assert.equal(sha(serverBytes), '786abbd316a79058b1c4334da7bde60c772579cf197ab72c8c7c4b6eeed5c84d');
const files = new Map();
for (const entry of JSON.parse(baseBytes).files) {
  const bytes = await fs.readFile(path.join(baseline, 'sources', entry.file));
  assert.equal(sha(bytes), entry.sha256, entry.file);
  files.set(entry.file, { ...entry, bytes, origin: 'approved-query63' });
}
const knownrefs = path.join(
  root,
  'outputs/2026-10-19-shared-business-integration/data-knownrefs-1792445885744',
);
const knownrefBytes = await fs.readFile(path.join(knownrefs, 'data-manifest.json'));
assert.equal(
  sha(knownrefBytes),
  'a2e96f9ae2ce07d97b52adb903bc8fd31f84fdca36faa959953fbde1ec02c081',
);
const seedFile = 'public/shared/shared-seed.js';
const seedBytes = await fs.readFile(path.join(knownrefs, 'sources', seedFile));
assert.equal(sha(seedBytes), '539c7f090b74fb34a533a8131e996e79475a24109d730377afed6d21cbbe4d4d');
files.set(seedFile, {
  ...files.get(seedFile),
  bytes: seedBytes,
  sha256: sha(seedBytes),
  origin: 'approved-knownrefs61',
});
const overlays = [
  'public/shared/shared-business-client.js',
  'public/shared/shared-message-edit-client.js',
  'public/shared/shared-message-edit-protocol.js',
  'public/shared/shared-edit-clock.js',
  'public/shared/shared-chat-source.js',
  'public/shared/shared-inbox.js',
  'public/shared/shared-seed-client.js',
  'android/qq-chat/shared-runtime.js',
  'android/app/src/main/java/dev/shiye/app/SharedBackendTransport.java',
];
for (const file of overlays) {
  const text = await fs.readFile(path.join(root, file), 'utf8');
  const bytes = Buffer.from(text);
  files.set(file, {
    ...(files.get(file) || { file, integrationObservedOnly: false, parseOnly: false }),
    bytes,
    sha256: sha(bytes),
    origin: 'message-edit-client-overlay',
  });
}
async function put(base, file, bytes) {
  const target = path.join(base, file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, bytes);
}
const sources = path.join(output, 'sources'),
  qa = path.join(output, 'qa');
for (const [file, entry] of files) await put(sources, file, entry.bytes);
const bundles = [];
for (const [entry, name] of [
  ['android/qq-chat/shared-runtime.js', 'android-shared-runtime.js'],
  ['previews/telegram-chat/shiye-shared-runtime.js', 'desktop-shared-runtime.js'],
]) {
  const result = await build({
    absWorkingDir: sources,
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    write: false,
    metafile: true,
  });
  for (const file of Object.keys(result.metafile.inputs))
    assert.ok(files.has(file.replaceAll('\\', '/')), 'unfrozen dependency:' + file);
  await put(output, name, result.outputFiles[0].contents);
  await put(output, name + '.metafile.json', JSON.stringify(result.metafile, null, 2));
  bundles.push({ file: name, sha256: sha(result.outputFiles[0].contents) });
}
for (const entry of JSON.parse(serverBytes).files) {
  const bytes = await fs.readFile(path.join(backend, entry.file));
  assert.equal(sha(bytes), entry.sha256, entry.file);
  await put(qa, entry.file, bytes);
}
for (const [file, entry] of files) await put(qa, file, entry.bytes);
const fixtureFiles = [
  'tests/shared-message-edit-client.test.mjs',
  'tests/shared-business-client.test.mjs',
  'tests/shared-chat-source.test.mjs',
  'tests/shared-inbox.test.mjs',
  'tests/shared-edit-clock.test.mjs',
  'tests/shared-seed-import.test.mjs',
  'tests/shared-seed-feeds-import.test.mjs',
  'tests/helpers/sync-v2-client-memory.mjs',
  'android/qq-chat/panels.js',
  'android/qq-chat/sticker-ranking.js',
  'android/qq-chat/touch-range.js',
  'android/sync-tests/SharedLocalMessageHostProbe.java',
  'android/sync-tests/host-platform/android/content/Context.java',
  'android/sync-tests/host-platform/android/content/SharedPreferences.java',
  'android/sync-tests/host-platform/android/os/Looper.java',
];
const fixtures = [];
for (const file of fixtureFiles) {
  const bytes = await fs.readFile(path.join(root, file));
  await put(qa, file, bytes);
  fixtures.push({ file, sha256: sha(bytes), fixtureOnly: true });
}
await put(output, 'freeze-message-edit-client.mjs', await fs.readFile(import.meta.filename));
const manifest = {
  version: 1,
  createdAt: new Date().toISOString(),
  uiIncluded: false,
  baseline: { path: path.relative(root, baseline).replaceAll('\\', '/'), sha256: sha(baseBytes) },
  approvedBackend: {
    path: path.relative(root, backend).replaceAll('\\', '/'),
    sha256: sha(serverBytes),
  },
  knownrefs: {
    path: path.relative(root, knownrefs).replaceAll('\\', '/'),
    sha256: sha(knownrefBytes),
  },
  excludedPendingQuery: false,
  transformations: [],
  sourceSnapshots: files.size,
  nativeDataSources: 22,
  overlays,
  files: [...files.values()]
    .map(({ bytes, ...entry }) => entry)
    .sort((a, b) => a.file.localeCompare(b.file)),
  bundles,
  fixtures,
  deviceInstalled: false,
  desktopDeployed: false,
  formalDataTouched: false,
};
await put(output, 'data-manifest.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(
  JSON.stringify(
    {
      output,
      manifestSha256: sha(await fs.readFile(path.join(output, 'data-manifest.json'))),
      sourceSnapshots: files.size,
      bundles,
    },
    null,
    2,
  ),
);
