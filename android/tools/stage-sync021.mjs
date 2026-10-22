import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '../..');
const stage = path.join(root, 'tmp/android-sync021/stage');
const out = path.join(root, 'outputs/2026-10-19-android-sync021');
const sha = (data) => createHash('sha256').update(data).digest('hex');
const owned = {};
const read = async (name) => {
  const data = await fs.readFile(path.join(root, name));
  owned[name] = sha(data);
  return data;
};
async function write(name, data) {
  const target = path.join(stage, name);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, data);
}
await fs.mkdir(out, { recursive: true });
execFileSync(
  'python',
  [
    '-c',
    `from pathlib import Path\nimport zipfile,hashlib\nr=Path(${JSON.stringify(root)});s=r/'tmp/android-sync021/stage/assets';p=r/'outputs/2026-10-18-android-qq-018/Shiye-Android-0.18.0-03a63c09.apk';assert hashlib.sha256(p.read_bytes()).hexdigest()=='03a63c091248712508251599c918961305179084e24fae8b227b38471e717930'\nwith zipfile.ZipFile(p) as z:\n for n in z.namelist():\n  if n.startswith('assets/') and not n.endswith('/'):\n   t=(s/n[7:]).resolve();assert t.is_relative_to(s.resolve());t.parent.mkdir(parents=True,exist_ok=True);t.write_bytes(z.read(n))`,
  ],
  { cwd: root, windowsHide: true },
);

async function copyTree(source, destination, accept = () => true) {
  for (const item of await fs.readdir(path.join(root, source), { withFileTypes: true })) {
    const name = source + '/' + item.name;
    if (item.isDirectory()) await copyTree(name, destination + '/' + item.name, accept);
    else if (accept(name)) await write(destination + '/' + item.name, await read(name));
  }
}
await copyTree('android/app/src/main/java', 'native/java');
await copyTree('android/app/src/main/res', 'native/res');
await write('native/AndroidManifest.xml', await read('android/app/src/main/AndroidManifest.xml'));
await copyTree('android/app/src/main/assets', 'assets');
await copyTree(
  'android/telegram-adapter',
  'assets/telegram',
  (p) => /\.(?:js|css)$/.test(p) && !p.endsWith('.test.mjs'),
);
await copyTree(
  'android/qq-chat',
  'assets/telegram/qq-chat',
  (p) => /\.(?:js|css|html)$/.test(p) && !p.endsWith('.test.mjs'),
);
await write('assets/editor019.css', await read('android/ui-refinement-019/editor.css'));
let editor = await fs.readFile(path.join(stage, 'assets/editor.html'), 'utf8');
if (!editor.includes('/editor019.css'))
  editor = editor.replace(
    '<script src="/editor.js"',
    '<link rel="stylesheet" href="/editor019.css" /><script src="/editor.js"',
  );
await write('assets/editor.html', editor);

const common = {
  absWorkingDir: root,
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'chrome110',
  write: false,
  metafile: true,
  legalComments: 'eof',
};
const product = await build({
  ...common,
  entryPoints: ['android/product-adapter/product-content.js'],
  outfile: 'product-content019.js',
});
await write('assets/product-content019.js', product.outputFiles[0].contents);
const journalName = 'previews/telegram-chat/shiye-journal.js';
// Only this formatter is bundled. Other desktop journal sections have parallel owners.
const journal = await fs.readFile(path.join(root, journalName), 'utf8');
const start = journal.indexOf('  function formatText(message) {');
const end = journal.indexOf('\n  async function sync()', start);
if (start < 0 || end < 0) throw Error('Desktop legacy formatter seam changed');
const helper = journal.slice(start, end).trim();
const formatterSource = {
  path: journalName,
  start: '  function formatText(message) {',
  end: '\n  async function sync()',
  sha256: sha(helper),
};
const content = await build({
  ...common,
  entryPoints: ['android/qq-chat/content.js'],
  outfile: 'content.js',
  plugins: [
    {
      name: 'desktop-legacy-format',
      setup(b) {
        b.onResolve({ filter: /^shiye:desktop-legacy-format$/ }, () => ({
          path: 'desktop-legacy-format',
          namespace: 'shared',
        }));
        b.onLoad({ filter: /.*/, namespace: 'shared' }, () => ({
          contents: 'export ' + helper,
          loader: 'js',
        }));
      },
    },
  ],
});
await write('assets/telegram/qq-chat/content.js', content.outputFiles[0].contents);

// Preserve actual desktop ESM modules/relative imports instead of Android forks.
const editorSources = await build({
  ...common,
  entryPoints: [
    'public/editor/rich-body-adapter.js',
    'public/features/editor-input.js',
    'public/shared/time-zone.js',
    'public/shared/rich-document.js',
    'public/shared/message-units.js',
    'public/shared/diary-paragraph-messages.js',
    'public/shared/legacy-time-segments.js',
    'public/shared/content-preparation.js',
    'public/shared/rich-document-renderer.js',
  ],
  outdir: 'discovery',
});
for (const result of [product, content, editorSources]) {
  for (const name of Object.keys(result.metafile.inputs)) {
    if (name.startsWith('shared:')) continue;
    const data = await read(name);
    if (result === editorSources) await write('assets/' + name, data);
  }
}
await write(
  'assets/public/styles/rich-quick-editor.css',
  await read('public/styles/rich-quick-editor.css'),
);
await write(
  'assets/public/vendor/RICH-EDITOR-LICENSES.txt',
  await read('public/vendor/RICH-EDITOR-LICENSES.txt'),
);

for (const item of await fs.readdir(path.join(stage, 'assets/telegram/qq-chat'))) {
  if (!item.endsWith('.js')) continue;
  const name = 'assets/telegram/qq-chat/' + item;
  let text = await fs.readFile(path.join(stage, name), 'utf8');
  for (const asset of ['view.css', 'panels.css', 'recommendations.css', 'shell.html']) {
    const hash = sha(await fs.readFile(path.join(stage, 'assets/telegram/qq-chat', asset)));
    text = text.replaceAll(`'./${asset}'`, `'./${asset}?v=${hash.slice(0, 24)}'`);
  }
  await write(name, text);
}
const listOwnerName = 'assets/telegram/assets/useConnectionStatus-Dy1kHT8L.js';
let listOwner = await fs.readFile(path.join(stage, listOwnerName), 'utf8');
const emptyDraftPredicate = '!e?.isForum&&!g&&!_&&s&&!i&&(!h||!r)';
if (listOwner.split(emptyDraftPredicate).length !== 2)
  throw Error('Frozen draft presentation predicate changed');
listOwner = listOwner.replace(
  emptyDraftPredicate,
  '!e?.isForum&&!g&&!_&&s&&Boolean(s.text?.text?.trim())&&!i&&(!h||!r)',
);
await write(listOwnerName, listOwner);
let html = await fs.readFile(path.join(stage, 'assets/telegram/index.html'), 'utf8');
const match = html.match(
  /(<script type="importmap" data-shiye-attachment-version="1">)(.*?)(<\/script>)/,
);
if (!match) throw Error('Import map missing');
const old = match[2],
  mapping = JSON.parse(old);
html = html.replace(match[0], '__SHIYE_IMPORT_MAP019__');
for (const dir of ['assets/telegram', 'assets/telegram/qq-chat']) {
  for (const name of await fs.readdir(path.join(stage, dir))) {
    if (!/\.(?:js|css)$/.test(name)) continue;
    const relative = dir.replace('assets', '') + '/' + name;
    mapping.imports[relative] =
      relative + '?v=' + sha(await fs.readFile(path.join(stage, dir, name))).slice(0, 24);
    if (dir === 'assets/telegram')
      html = html.replace(
        new RegExp(name.replaceAll('.', '\\.') + '\\?v=[a-f0-9]+', 'g'),
        name + '?v=' + sha(await fs.readFile(path.join(stage, dir, name))).slice(0, 24),
      );
  }
}
mapping.imports['/telegram/assets/useConnectionStatus-Dy1kHT8L.js'] =
  '/telegram/assets/useConnectionStatus-Dy1kHT8L.js?v=' +
  sha(await fs.readFile(path.join(stage, listOwnerName))).slice(0, 24);
const next = JSON.stringify(mapping);
html = html.replace('__SHIYE_IMPORT_MAP019__', match[1] + next + match[3]);
const csp = (x) => createHash('sha256').update(x).digest('base64');
html = html.replace('sha256-' + csp(old), 'sha256-' + csp(next));
html = html.replace('</head>', '<script src="/telegram/native-asset-guard019.js"></script></head>');
// The guard must run before every existing executable script, not after modules start.
html = html.replace('<script src="/telegram/native-asset-guard019.js"></script></head>', '</head>');
html = html.replace(
  '<script type="importmap"',
  '<script src="/telegram/native-asset-guard019.js"></script><script type="importmap"',
);
await write('assets/telegram/index.html', html);

const hashes = {};
async function collect(folder) {
  for (const item of await fs.readdir(path.join(stage, folder), { withFileTypes: true })) {
    const name = folder + '/' + item.name;
    if (item.isDirectory()) await collect(name);
    else hashes[name] = sha(await fs.readFile(path.join(stage, name)));
  }
}
await collect('native');
await collect('assets');
for (const [name, hash] of Object.entries(owned))
  if (sha(await fs.readFile(path.join(root, name))) !== hash)
    throw Error('Source changed during stage: ' + name);
const currentJournal = await fs.readFile(path.join(root, journalName), 'utf8');
const currentStart = currentJournal.indexOf(formatterSource.start);
const currentEnd = currentJournal.indexOf(formatterSource.end, currentStart);
if (
  currentStart < 0 ||
  currentEnd < 0 ||
  sha(currentJournal.slice(currentStart, currentEnd).trim()) !== formatterSource.sha256
)
  throw Error('Desktop formatter changed during stage');
await fs.writeFile(
  path.join(out, 'stage-manifest.json'),
  JSON.stringify(
    {
      version: '0.21.0',
      code: 23,
      baseline: '03a63c09',
      sources: owned,
      formatterSource,
      stageHashes: hashes,
      sharedProductBytes: product.outputFiles[0].contents.length,
      assetWorkerDisabledWithoutContentDeletion: true,
      chatWriter: 'legacy-idb-until-verified-product-cutover',
      diaryWriter: 'ProductDiaryStore',
      realSeedImport: false,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({ staged: Object.keys(hashes).length, sources: Object.keys(owned).length }),
);
