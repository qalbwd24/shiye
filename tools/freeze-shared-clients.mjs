import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

// Data/transport artifacts only. Tree-shaken parser dependencies are retained
// for reproducible builds; no UI entry is bundled, APK installed or app switched.
const root = path.resolve(import.meta.dirname, '..');
const output = path.join(
  root,
  'outputs/2026-10-19-shared-business-integration',
  'data-candidate-' + Date.now(),
);
await fs.mkdir(output);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const inputs = new Set();
const emitted = new Set();
const loaded = new Map();
for (const [entry, name] of [
  ['android/qq-chat/shared-runtime.js', 'android-shared-runtime.js'],
  ['previews/telegram-chat/shiye-shared-runtime.js', 'desktop-shared-runtime.js'],
]) {
  const result = await build({
    absWorkingDir: root,
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    write: false,
    metafile: true,
    plugins: [
      {
        name: 'freeze-loaded-bytes',
        setup(builder) {
          builder.onLoad({ filter: /\.[cm]?js$/ }, async ({ path: file }) => {
            const bytes = await fs.readFile(file),
              relative = path.relative(root, file).replaceAll('\\', '/');
            const prior = loaded.get(relative);
            if (prior && sha(prior) !== sha(bytes))
              throw Error('SOURCE_CHANGED_DURING_FREEZE:' + relative);
            loaded.set(relative, bytes);
            return { contents: bytes.toString('utf8'), loader: 'js' };
          });
        },
      },
    ],
  });
  await fs.writeFile(path.join(output, name), result.outputFiles[0].contents, { flag: 'wx' });
  await fs.writeFile(
    path.join(output, name + '.metafile.json'),
    JSON.stringify(result.metafile, null, 2),
    { flag: 'wx' },
  );
  for (const artifact of Object.values(result.metafile.outputs))
    for (const [file, contribution] of Object.entries(artifact.inputs))
      if (contribution.bytesInOutput > 0) emitted.add(file);
  for (const file of Object.keys(result.metafile.inputs)) {
    const parserOnly = [
      'public/vendor/rich-editor.js',
      'public/editor/rich-document-editor.js',
    ].includes(file);
    if (
      !(parserOnly && !emitted.has(file)) &&
      !['public/shared/', 'android/qq-chat/shared-', 'previews/telegram-chat/shiye-shared-'].some(
        (prefix) => file.replaceAll('\\', '/').startsWith(prefix),
      )
    )
      throw Error('UNEXPECTED_CLIENT_DEPENDENCY:' + file);
    inputs.add(file);
  }
}
inputs.add('android/qq-chat/shared-source.js');
inputs.add('android/qq-chat/shared-directory-view.js');
const observed = new Set([
  'previews/telegram-chat/shiye-journal.js',
  'previews/telegram-chat/ChatJournalBridge.cs',
]);
// Frontend owns its full stage/build entry. Record hashes for coordination only;
// never copy those concurrently evolving UI files into this pure data candidate.
const frontendBuildReferences = [
  'previews/telegram-chat/prepare-preview.mjs',
  'previews/telegram-chat/write-manifest.mjs',
];
for (const file of observed) inputs.add(file);
const nativeNames = [
  'SyncCredentials',
  'AndroidSyncTransport',
  'BackendServices',
  'SharedBackendTransport',
  'SharedBackendBridge',
  'SharedSeedFile',
  'SharedSeedBridge',
  'SharedSeedImport',
  'ProductRepository',
  'ProductPayloadReader',
  'ProductPayloadWriter',
  'ProductSeedFile',
  'ProductRetryPolicy',
  'ProductDiaryStore',
  'ProductChatStore',
  'ProductLocalSelection',
  'ProductDownloadQueue',
  'ProductOriginals',
  'ProductMediaBridge',
  'ProductSeedInstaller',
  'ProductSyncCoordinator',
  'ProductUiBridge',
];
for (const name of nativeNames) inputs.add(`android/app/src/main/java/dev/shiye/app/${name}.java`);
const files = [];
for (const file of [...inputs].sort()) {
  const from = path.resolve(root, file),
    relative = path.relative(root, from);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw Error('DATA_SOURCE_ESCAPE');
  const bytes = loaded.get(file.replaceAll('\\', '/')) || (await fs.readFile(from)),
    to = path.join(output, 'sources', relative);
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.writeFile(to, bytes, { flag: 'wx' });
  files.push({
    file: relative.replaceAll('\\', '/'),
    sha256: sha(bytes),
    integrationObservedOnly: observed.has(file),
    parseOnly: loaded.has(file) && !emitted.has(file),
  });
}
const manifest = {
  version: 1,
  createdAt: new Date().toISOString(),
  uiIncluded: false,
  sourceSnapshots: files.length,
  nativeDataSources: nativeNames.length,
  files,
  phoneInstalled: false,
  desktopDeployed: false,
  sharedEnabledByDefault: false,
  integrationSeams: {
    'android/qq-chat/shared-runtime.js':
      'data entry only: runtime.seed/readMedia; no picker or renderer',
    'previews/telegram-chat/shiye-shared-runtime.js':
      'data entry only: runtime.seed/auth/readMedia; no renderer',
    'previews/telegram-chat/shiye-journal.js':
      'observed-only shared(method,payload) fixed whitelist; never replace full frontend file from this candidate',
    'previews/telegram-chat/ChatJournalBridge.cs':
      'observed-only native fixed shared routes, seed wire and private device auth; full host integration/build remains frontend owned',
  },
  frontendBuildReferences: await Promise.all(
    frontendBuildReferences.map(async (file) => ({
      file,
      sha256: sha(await fs.readFile(path.join(root, file))),
      copied: false,
      approval: false,
    })),
  ),
  excludedFrontendOwned: [
    'MainActivity.java',
    'TelegramFrontend.java',
    'DesktopPreview.cs',
    'UI023',
    'PC UI renderer/i18n',
  ],
  validation: 'See independent scope report; file presence does not approve every legacy branch.',
};
await fs.writeFile(path.join(output, 'data-manifest.json'), JSON.stringify(manifest, null, 2), {
  flag: 'wx',
});
console.log(
  JSON.stringify({
    output,
    sources: files.length,
    nativeDataSources: nativeNames.length,
    uiIncluded: false,
    manifestSha256: sha(await fs.readFile(path.join(output, 'data-manifest.json'))),
  }),
);
