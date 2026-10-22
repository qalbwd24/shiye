import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { parse } from 'espree';

// Freezes only a named original release plus reviewed data-layer overlays.
// Never switches the live pointer, starts a process, or copies business data.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = path.join(root, 'outputs/backend-runtimes/20261019-chat-reedit2');
const baseline = JSON.parse(
  await fs.readFile(path.join(baselinePath, 'runtime-manifest.json'), 'utf8'),
);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
for (const row of baseline.files)
  if (sha(await fs.readFile(path.join(baselinePath, row.file))) !== row.sha256)
    throw Error('BASELINE_HASH_CHANGED:' + row.file);
const release = '20261019-shared-business-' + Date.now();
const output = path.join(root, 'outputs/backend-runtimes', release);
await fs.mkdir(output);
const overlays = new Set([
  'src/server/app.mjs',
  'src/server/config.mjs',
  'src/server/storage/library-store.mjs',
  'src/server/domain/chat-journal.mjs',
  'src/server/conversation-services/conversations.mjs',
  'src/server/conversation-services/directory.mjs',
  'src/server/conversation-services/registry.mjs',
  'src/server/routes/conversation-services.mjs',
  'src/server/conversation-services/program-client.mjs',
  'src/server/conversation-services/synthetic-worker.mjs',
  'tools/program-credential.mjs',
  'src/server/domain/import-reconciliation.mjs',
  'src/server/imports/legacy.mjs',
  'src/server/imports/one-diary-source.mjs',
  'src/server/routes/imports.mjs',
  'src/server/routes/legacy-backups.mjs',
  'tools/computer-export.mjs',
  'src/server/shared-sync/computer-export.mjs',
]);
const originals = new Set(baseline.files.map((row) => row.file));
const sources = new Map(),
  edges = [];
async function visit(file) {
  if (sources.has(file)) return;
  if (file.includes('..') || path.isAbsolute(file)) throw Error('SOURCE_PATH_ESCAPE');
  const from =
    originals.has(file) && !overlays.has(file)
      ? path.join(baselinePath, file)
      : path.join(root, file);
  let bytes = await fs.readFile(from);
  if (file === 'server.mjs') {
    const text = bytes.toString('utf8');
    const call = 'createDiaryServer({ dataDir: config.dataDir, revisitAutoStart: true })';
    if (!text.includes(call)) throw Error('BASELINE_ENTRY_CHANGED');
    bytes = Buffer.from(
      text.replace(
        call,
        'createDiaryServer({ dataDir: config.dataDir, revisitAutoStart: true, sharedSync: config.sharedSync, sharedRemote: config.sharedRemote, sourceCollection: config.sourceCollection })',
      ),
    );
  }
  if (file === 'src/server/config.mjs') {
    const text = bytes.toString('utf8'),
      anchor = "fileURLToPath(new URL('../../', import.meta.url))";
    if (!text.includes(anchor)) throw Error('CONFIG_ANCHOR_CHANGED');
    bytes = Buffer.from(
      text.replace(
        anchor,
        `fileURLToPath(new URL(${JSON.stringify(pathToFileURL(root + path.sep).href)}))`,
      ),
    );
  }
  sources.set(file, {
    bytes,
    origin:
      from === path.join(baselinePath, file) ? 'frozen-baseline' : 'workspace-reviewed-overlay',
  });
  if (!/\.[cm]?js$/.test(file)) return;
  const ast = parse(bytes.toString('utf8'), { ecmaVersion: 'latest', sourceType: 'module' });
  const pending = [];
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (
      [
        'ImportDeclaration',
        'ExportNamedDeclaration',
        'ExportAllDeclaration',
        'ImportExpression',
      ].includes(node.type) &&
      node.source
    ) {
      if (typeof node.source.value !== 'string') throw Error('DYNAMIC_IMPORT_NOT_FROZEN:' + file);
      const specifier = node.source.value;
      if (specifier.startsWith('.')) {
        const next = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
        edges.push({ from: file, to: next });
        pending.push(next);
      }
    }
    for (const value of Object.values(node))
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object') walk(value);
  }
  walk(ast);
  for (const next of pending) await visit(next);
}
for (const file of [...originals, ...overlays]) await visit(file);
const files = [];
for (const [file, { bytes, origin }] of [...sources].sort(([a], [b]) => a.localeCompare(b))) {
  const destination = path.join(output, file);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, bytes, { flag: 'wx' });
  files.push({ file, sha256: sha(bytes), origin });
}
const manifest = {
  protocol: 1,
  projectRoot: root,
  entry: 'src/server/app.mjs',
  release,
  baseline: baseline.release,
  createdAt: new Date().toISOString(),
  deployed: false,
  files,
};
await fs.writeFile(path.join(output, 'runtime-manifest.json'), JSON.stringify(manifest, null, 2), {
  flag: 'wx',
});
await fs.writeFile(
  path.join(output, 'dependency-audit.json'),
  JSON.stringify(
    {
      baselineUnchanged: true,
      files: files.length,
      relativeImports: edges.length,
      edges,
      livePointerChanged: false,
    },
    null,
    2,
  ),
  { flag: 'wx' },
);
console.log(
  JSON.stringify({
    manifest: path.join(output, 'runtime-manifest.json'),
    files: files.length,
    relativeImports: edges.length,
    livePointerChanged: false,
  }),
);
